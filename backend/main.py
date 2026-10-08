"""Freedom: independent Tor collectors and a small public telemetry API."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.control import TorControlManager
from backend.health import evaluate_relay_health

ROOT = Path(__file__).resolve().parent.parent
logger = logging.getLogger("freedom")


@dataclass(frozen=True)
class ControlSettings:
    TOR_CONTROL_HOST: str
    TOR_CONTROL_PORT: int
    TOR_COOKIE_CONTAINER_PATH: str
    TOR_FINGERPRINT: str
    STARTUP_GRACE_PERIOD_SECONDS: int = 60


def load_registry(path: Path = ROOT / "relays.json") -> list[dict]:
    relays = json.loads(path.read_text(encoding="utf-8"))
    seen = set()
    for relay in relays:
        relay_id = relay["id"]
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,47}", relay_id) or relay_id in seen:
            raise ValueError("Relay IDs must be unique lowercase environment-safe names")
        if not re.fullmatch(r"[A-Fa-f0-9]{40}", relay["fingerprint"]):
            raise ValueError("Invalid relay fingerprint")
        if urlparse(relay["stats_url"]).scheme != "https":
            raise ValueError("Relay statistics links must use HTTPS")
        seen.add(relay_id)
    return relays


def describe_health(health: dict) -> str:
    status = health["status"]
    if status == "OK":
        return "The relay is operational and passes its health checks."
    if status == "STARTING":
        return "The relay is starting up. Waiting for its initial health checks."
    names = {
        "control_port": "Relay control connection unavailable",
        "or_port_reachability": "Relay port reachability check failed",
        "network_liveness": "Tor network connectivity needs attention",
        "directory_info": "Tor directory information is still synchronizing",
        "descriptor_published": "Waiting for the relay descriptor to be accepted",
        "tor_version": "The Tor version needs attention",
        "overload": "An overload has been reported by the Tor directory",
    }
    reasons = [names[rule["id"]] for rule in health["rules"] if rule["status"] in {"WARN", "FAIL"} and rule["id"] in names]
    present = {flag["name"] for flag in health["flags"] if flag["present"]}
    if not present:
        reasons.append("Consensus data is unavailable")
    else:
        missing = {"Running", "Valid", "Fast"} - present
        if missing:
            reasons.append("Missing consensus flags: " + ", ".join(sorted(missing)))
        if health["uptime_seconds"] and health["uptime_seconds"] > 120 * 3600 and "HSDir" not in present:
            reasons.append("The HSDir consensus flag has not yet been assigned")
    return ". ".join(reasons) + "." if reasons else "The relay needs attention. See the full statistics for details."


class Relay:
    def __init__(self, metadata: dict):
        self.metadata = metadata
        prefix = metadata["id"].upper()
        settings = ControlSettings(
            TOR_CONTROL_HOST=os.getenv(prefix + "_CONTROL_HOST", ""),
            TOR_CONTROL_PORT=int(os.getenv(prefix + "_CONTROL_PORT", "9052")),
            TOR_COOKIE_CONTAINER_PATH=os.getenv(prefix + "_COOKIE_PATH", "/run/tor/" + metadata["id"] + "/control_auth_cookie"),
            TOR_FINGERPRINT=metadata["fingerprint"].upper(),
        )
        self.configured = bool(settings.TOR_CONTROL_HOST) and Path(settings.TOR_COOKIE_CONTAINER_PATH).is_file()
        self.control = TorControlManager(settings)
        self.details: dict = {}
        self.details_at = 0.0
        self.refresh_task = None

    async def collect_directory(self, client: httpx.AsyncClient):
        """One background request per relay per hour; retry failures after 5 minutes."""
        while True:
            delay = 300
            try:
                response = await client.get("https://onionoo.torproject.org/details", params={
                    "lookup": self.metadata["fingerprint"],
                    "fields": "fingerprint,flags,country_name,as_name,version,version_status,overload_general_timestamp",
                })
                response.raise_for_status()
                candidates = response.json().get("relays", [])
                details = next((relay for relay in candidates if relay.get("fingerprint", "").upper() == self.metadata["fingerprint"].upper()), {})
                if details:
                    self.details = details
                    self.details_at = time.time()
                    delay = 3600
            except (httpx.HTTPError, ValueError, TypeError):
                logger.warning("Directory refresh unavailable for %s", self.metadata["id"])
            await asyncio.sleep(delay)

    def snapshot(self) -> dict:
        now = time.time()
        result = dict(self.metadata)
        cached = self.control.get_cached_data()
        connected = self.control.is_connected
        details = self.details if now - self.details_at < 7200 else {}
        result.update(country_name=details.get("country_name"), as_name=details.get("as_name"), flags=details.get("flags", []), directory_updated_at=self.details_at or None)
        info = cached.get("stem_info", {})
        health = evaluate_relay_health(connected, info, details, self.control.settings.TOR_CONTROL_PORT, self.control.is_startup_grace_period, tracker=self.control.tracker)
        if not self.configured:
            result.update(status="UNKNOWN", reason="Telemetry is not connected yet. Full statistics remain available.", evaluated_at=None)
        elif connected and now - cached.get("polled_at", 0) > 60:
            result.update(status="UNKNOWN", reason="Status measurements are temporarily unavailable.", evaluated_at=None)
        else:
            result.update(status=health["status"], reason=describe_health(health), evaluated_at=datetime.now(timezone.utc).isoformat())
        current = connected and now - cached.get("polled_at", 0) <= 60
        result["uptime_seconds"] = health["uptime_seconds"] if current else None
        result["version"] = info.get("version") if current else None
        flags = set(details.get("flags", []))
        result["role"] = "Exit relay" if "Exit" in flags else "Guard / middle relay" if "Guard" in flags else "Middle relay" if flags else None
        live = self.control.latest_bw
        result["live"] = live if connected and live and 0 <= now - live["timestamp"] < 15 else None
        return result


class Fleet:
    def __init__(self, registry: list[dict]):
        self.relays = [Relay(metadata) for metadata in registry]
        self.clients: set[asyncio.Queue] = set()
        self.tasks: list[asyncio.Task] = []

    async def forward_bandwidth(self, relay: Relay):
        async for sample in relay.control.subscribe_bw():
            payload = {"id": relay.metadata["id"], **sample}
            for queue in list(self.clients):
                if queue.full():
                    queue.get_nowait()
                queue.put_nowait(payload)

    async def start(self, client: httpx.AsyncClient):
        for relay in self.relays:
            self.tasks.append(asyncio.create_task(relay.collect_directory(client)))
            if relay.configured:
                await relay.control.start()
                self.tasks.append(asyncio.create_task(self.forward_bandwidth(relay)))
            else:
                logger.warning("Collector not configured for %s", relay.metadata["id"])

    async def stop(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        for relay in self.relays:
            await relay.control.stop()


@asynccontextmanager
async def lifespan(app: FastAPI):
    fleet = Fleet(load_registry())
    app.state.fleet = fleet
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "sol12-freedom/1.0", "Accept-Encoding": "gzip, deflate"}) as client:
        await fleet.start(client)
        try:
            yield
        finally:
            await fleet.stop()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com; font-src 'self'; connect-src 'self' blob: https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://*.analytics.google.com https://*.googletagmanager.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "no-cache"
    return response


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/api/relays")
async def relay_status():
    return {"relays": [relay.snapshot() for relay in app.state.fleet.relays]}


@app.get("/api/relays/live")
async def relay_stream():
    fleet = app.state.fleet
    if len(fleet.clients) >= 32:
        raise HTTPException(503, "Live stream capacity reached. Please retry later.")
    queue = asyncio.Queue(maxsize=max(10, len(fleet.relays) * 2))
    fleet.clients.add(queue)

    async def events():
        try:
            for relay in fleet.relays:
                sample = relay.snapshot()["live"]
                if sample:
                    yield "event: bw\ndata: " + json.dumps({"id": relay.metadata["id"], **sample}) + "\n\n"
            while True:
                try:
                    sample = await asyncio.wait_for(queue.get(), timeout=10)
                    if time.time() - sample["timestamp"] < 15:
                        yield "event: bw\ndata: " + json.dumps(sample) + "\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            fleet.clients.discard(queue)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"})


# Tor ContactInfo Information Sharing Specification (CIISS) proof for url:https://freedom.sol12.net.
# One RSA fingerprint per line; add new relays that use this ContactInfo here.
TOR_RELAY_RSA_FINGERPRINTS = ("DD567C87E657AC4B1C7DADB536C394020C6A1B03",)


@app.api_route("/.well-known/tor-relay/rsa-fingerprint.txt", methods=["GET", "HEAD"], include_in_schema=False)
async def tor_relay_rsa_fingerprint():
    return PlainTextResponse("".join(fingerprint + "\n" for fingerprint in TOR_RELAY_RSA_FINGERPRINTS))


# Explicit static allowlist: never serve source code, environment files, or cookies.
for directory in ("assets", "css", "fonts", "js"):
    app.mount("/" + directory, StaticFiles(directory=ROOT / directory), name=directory)


@app.get("/{page:path}", include_in_schema=False)
async def static_page(page: str):
    allowed = {"": "index.html", "index.html": "index.html", "relays.html": "relays.html", "relays.json": "relays.json", "favicon.ico": "favicon.ico", "favicon.svg": "favicon.svg"}
    if page not in allowed:
        raise HTTPException(404, "Not found")
    return FileResponse(ROOT / allowed[page])
