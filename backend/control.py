# Adapted from SOL12-NET/tor-monitor at 23fb06810e20fac08a1415caa0ab4a89c08ec726.
"""Hardened Tor Stem controller wrapper with strict read-only security policy.

Security Rules enforced:
1. Handshake allowance: PROTOCOLINFO, AUTHCHALLENGE, AUTHENTICATE allowed ONLY during handshake.
2. Post-auth strict whitelist: Only GETINFO, GETCONF, SETEVENTS with explicit whitelists.
3. Explicit rejection of mutating commands: SETCONF, SIGNAL, TAKEOWNERSHIP, ADD_ONION, DEL_ONION, etc.
4. SAFECOOKIE authentication strictly required (no plain cookie fallback).
5. Privacy: Circuit and ORConn data are aggregated to counts only in memory, zero IP/identity logging.
6. Per-relay connection manager with exponential backoff + jitter, auto-closing raw controller on failure.
7. Background Stem poller (20s) via asyncio.to_thread so HTTP handlers never make blocking Stem calls.
8. Bounded event fan-out queues; the public API limits concurrent SSE clients.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import socket
import threading
import time
from typing import Any, AsyncIterator, Callable

import stem
from stem.control import Controller
from stem.response import ControlMessage

from backend.health import NetworkLivenessTracker
from collections import deque

logger = logging.getLogger("tor_monitor.stem")


class StemSecurityViolationError(Exception):
    """Raised when an unauthorized or mutating Tor ControlPort command is attempted."""
    pass


# Commands allowed ONLY before authentication is completed
HANDSHAKE_ALLOWED_COMMANDS = {
    "PROTOCOLINFO",
    "AUTHCHALLENGE",
    "AUTHENTICATE",
}

# Verbs strictly permitted after successful authentication
POST_AUTH_ALLOWED_VERBS = {
    "GETINFO",
    "GETCONF",
    "SETEVENTS",
}

# Verbs explicitly forbidden and blocked
FORBIDDEN_COMMANDS = {
    "SETCONF",
    "RESETCONF",
    "SIGNAL",
    "SAVECONF",
    "LOADCONF",
    "TAKEOWNERSHIP",
    "DROPGUARDS",
    "POSTDESCRIPTOR",
    "QUIT",
    "USEFEATURE",
    "MAPADDRESS",
    "EXTENDCIRCUIT",
    "SETCIRCUITPURPOSE",
    "CLOSECIRCUIT",
    "ATTACHSTREAM",
    "REDIRECTSTREAM",
    "CLOSESTREAM",
    "RESOLVE",
    "ADD_ONION",
    "DEL_ONION",
    "HSFETCH",
    "HSPOST",
    "DROPOWNERSHIP",
    "DROPTIMEOUTS",
    "ONION_CLIENT_AUTH_ADD",
    "ONION_CLIENT_AUTH_REMOVE",
    "ONION_CLIENT_AUTH_VIEW",
}

# Tor 0.4.9 control-spec verified GETINFO keys
ALLOWED_GETINFO_KEYS = {
    "fingerprint",
    "version",
    "status/version/current",
    "status/version/recommended",
    "status/circuit-established",
    "status/bootstrap-phase",
    "status/enough-dir-info",
    "status/reachability-succeeded/or",
    "status/reachability-succeeded/dir",
    "status/accepted-server-descriptor",
    "status/good-server-descriptor",
    "uptime",
    "traffic/read",
    "traffic/written",
    "network-liveness",
    "accounting/bytes",
    "accounting/bytes-left",
    "accounting/enabled",
    "accounting/hibernating",
    "orconn-status",   # Aggregated only, strictly anonymized
    "circuit-status",  # Aggregated only, strictly anonymized
    "events/names",
}

# Allowed GETCONF keys in lowercase for case-insensitive matching
ALLOWED_GETCONF_KEYS = {
    "relaybandwidthrate",
    "relaybandwidthburst",
    "maxadvertisedbandwidth",
    "accountingmax",
    "accountingstart",
    "contactinfo",
    "nickname",
    "orport",
    "dirport",
    "__owningcontrollerprocess",
}

# Allowed SETEVENTS types (including SIGNAL used by Stem Controller internal listeners)
ALLOWED_EVENTS = {
    "BW",
    "STATUS_CLIENT",
    "STATUS_SERVER",
    "CONF_CHANGED",
    "SIGNAL",
}


def validate_control_command(raw_msg: str, authenticated: bool) -> None:
    """Validate a raw control port command string against security whitelist."""
    if not raw_msg:
        return

    # Multiline / CRLF injection protection: validate every line individually
    if "\r" in raw_msg or "\n" in raw_msg:
        lines = [line.strip() for line in raw_msg.replace("\r", "\n").split("\n") if line.strip()]
        for line in lines:
            validate_control_command(line, authenticated)
        return

    clean = raw_msg.strip()
    if not clean:
        return

    verb = clean.split()[0].upper()

    if not authenticated:
        if verb not in HANDSHAKE_ALLOWED_COMMANDS:
            raise StemSecurityViolationError(
                f"Handshake security violation: '{verb}' is not permitted during authentication."
            )
        return

    # Post-handshake checks
    if verb in FORBIDDEN_COMMANDS:
        raise StemSecurityViolationError(
            f"Read-only security violation: Command '{verb}' is strictly forbidden."
        )

    if verb not in POST_AUTH_ALLOWED_VERBS:
        raise StemSecurityViolationError(
            f"Read-only security violation: Command '{verb}' is not in the authorized whitelist."
        )

    parts = clean.split()
    if verb == "GETINFO":
        for arg in parts[1:]:
            key = arg.split("=")[0].strip('"').strip("'")
            if key not in ALLOWED_GETINFO_KEYS:
                raise StemSecurityViolationError(
                    f"Read-only security violation: GETINFO key '{key}' is not permitted."
                )
    elif verb == "GETCONF":
        for arg in parts[1:]:
            key = arg.strip('"').strip("'").lower()
            if key not in ALLOWED_GETCONF_KEYS:
                raise StemSecurityViolationError(
                    f"Read-only security violation: GETCONF key '{key}' is not permitted."
                )
    elif verb == "SETEVENTS":
        for arg in parts[1:]:
            event = arg.strip().upper()
            if event not in ALLOWED_EVENTS:
                raise StemSecurityViolationError(
                    f"Read-only security violation: SETEVENTS event '{event}' is not permitted."
                )


class SecureStemController:
    """Wrapper around stem.control.Controller enforcing read-only security."""

    def __init__(self, raw_controller: Controller):
        self._controller = raw_controller
        self._authenticated = False
        self._wrap_msg_method()

    def _wrap_msg_method(self) -> None:
        original_msg = self._controller.msg

        def secure_msg(message: str) -> ControlMessage:
            validate_control_command(message, self._authenticated)
            return original_msg(message)

        self._controller.msg = secure_msg

    def authenticate_cookie(self, cookie_path: str) -> None:
        """Authenticate strictly using SAFECOOKIE with Stem."""
        if not os.path.exists(cookie_path):
            raise FileNotFoundError(f"Tor control auth cookie not found at {cookie_path}")

        try:
            import stem.connection
            stem.connection.authenticate_safecookie(
                self._controller, cookie_path, suppress_ctl_errors=False
            )

            # Crucial: set self._authenticated = True BEFORE calling _post_authentication()
            # because Stem calls GETINFO events/names and GETCONF during _post_authentication()
            self._authenticated = True

            if hasattr(self._controller, "_post_authentication"):
                self._controller._post_authentication()

            logger.info("Tor ControlPort authentication succeeded (SAFECOOKIE). Read-only mode ACTIVE.")
        except Exception as e:
            self._authenticated = False
            raise e

    def is_authenticated(self) -> bool:
        return self._authenticated

    def is_alive(self) -> bool:
        return self._controller.is_alive()

    def close(self) -> None:
        try:
            self._controller.close()
        except Exception:
            pass

    def get_info(self, param: str, default: Any = None) -> Any:
        clean_param = param.strip()
        if clean_param not in ALLOWED_GETINFO_KEYS:
            raise StemSecurityViolationError(f"GETINFO key '{clean_param}' is not permitted.")
        return self._controller.get_info(clean_param, default)

    def get_conf(self, param: str, default: Any = None) -> Any:
        clean_param = param.strip().lower()
        if clean_param not in ALLOWED_GETCONF_KEYS:
            raise StemSecurityViolationError(f"GETCONF key '{clean_param}' is not permitted.")
        return self._controller.get_conf(clean_param, default)

    def add_event_listener(self, listener: Callable, event: str) -> None:
        clean_event = event.strip().upper()
        if clean_event not in ALLOWED_EVENTS:
            raise StemSecurityViolationError(f"Event '{clean_event}' is not permitted.")
        self._controller.add_event_listener(listener, clean_event)

    def get_aggregated_circuits(self) -> int:
        """Anonymized count of circuits originating from local relay/controller."""
        raw = self.get_info("circuit-status", "")
        if not raw:
            return 0
        lines = [line for line in raw.strip().split("\n") if line.strip()]
        return len(lines)

    def get_aggregated_orconns(self) -> dict[str, int]:
        """Anonymized OR connection count grouped by status."""
        raw = self.get_info("orconn-status", "")
        summary: dict[str, int] = {"connected": 0, "connecting": 0, "other": 0, "total": 0, "open": 0}
        if not raw:
            return summary

        for line in raw.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            summary["total"] += 1
            if "CONNECTED" in line:
                summary["connected"] += 1
                summary["open"] += 1  # Alias for backward compatibility
            elif "LAUNCHED" in line or "NEW" in line:
                summary["connecting"] += 1
            else:
                summary["other"] += 1

        return summary


class StemTimeoutControlPort(stem.socket.ControlPort):
    """Subclass of stem.socket.ControlPort connecting via socket.create_connection with timeout."""

    def __init__(self, address: str = "127.0.0.1", port: int = 9051, connect_timeout: float = 5.0):
        self._connect_timeout = connect_timeout
        super().__init__(address=address, port=port, connect=False)
        self.connect()

    def _make_socket(self) -> socket.socket:
        try:
            return socket.create_connection((self.address, self.port), timeout=self._connect_timeout)
        except socket.error as exc:
            raise stem.SocketError(exc)


class TorControlManager:
    """Per-relay connection manager for Tor ControlPort with automatic reconnection and background poller."""

    def __init__(self, settings) -> None:
        self.settings = settings
        self.tracker = NetworkLivenessTracker()
        self.controller: SecureStemController | None = None
        self._is_connected = False
        self._last_error: str | None = None
        self._reconnect_task: asyncio.Task | None = None
        self._poller_task: asyncio.Task | None = None
        self._bw_subscribers: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._running = False
        self._latest_bw: dict[str, Any] | None = None
        self._cached_stem_data: dict[str, Any] = {
            "stem_info": {},
            "local_circuits": None,
            "or_connections": None,
            "polled_at": 0.0,
        }
        self._minute_bw_events = deque(maxlen=60)
        self._bw_lock = threading.Lock()
        self._stem_lock = threading.Lock()
        self._started_at = time.time()
        self._has_collected_once = False

    @property
    def is_connected(self) -> bool:
        return self._is_connected and self.controller is not None and self.controller.is_alive()

    @property
    def has_collected_once(self) -> bool:
        return self._has_collected_once

    @property
    def is_startup_grace_period(self) -> bool:
        if self._has_collected_once:
            return False
        return (time.time() - self._started_at) < self.settings.STARTUP_GRACE_PERIOD_SECONDS

    @property
    def last_error(self) -> str | None:
        return self._last_error


    @property
    def latest_bw(self) -> dict[str, Any] | None:
        return self._latest_bw

    @property
    def subscriber_count(self) -> int:
        return len(self._bw_subscribers)

    def record_stem_data(self, data: dict[str, Any]) -> None:
        """Update cached stem data and record network-liveness measurement once per poll."""
        with self._stem_lock:
            self._cached_stem_data = data
            if data.get("polled_at", 0) > 0:
                self._has_collected_once = True
            raw_net = data.get("stem_info", {}).get("network-liveness")
            if raw_net:
                is_up = raw_net.strip().lower() == "up"
                self.tracker.record_measurement(is_up, now=data.get("polled_at"))

    def get_cached_data(self) -> dict[str, Any]:
        with self._stem_lock:
            return dict(self._cached_stem_data)

    def _reset_connection_state(self) -> None:
        """Reset connection flags and purge in-memory stem caches."""
        self._is_connected = False
        self._latest_bw = None
        self._cached_stem_data = {
            "stem_info": {},
            "local_circuits": None,
            "or_connections": None,
            "polled_at": 0.0,
        }
        with self._bw_lock:
            self._minute_bw_events.clear()

    def consume_minute_bw_average(self) -> tuple[int, int] | None:
        """Returns (avg_read_bps, avg_write_bps) of events received during the minute, or None."""
        if not self.is_connected:
            with self._bw_lock:
                self._minute_bw_events.clear()
            return None
        with self._bw_lock:
            if not self._minute_bw_events:
                return None
            total_read = sum(r for r, _ in self._minute_bw_events)
            total_write = sum(w for _, w in self._minute_bw_events)
            count = len(self._minute_bw_events)
            self._minute_bw_events.clear()
            return (int(total_read / count), int(total_write / count))

    async def start(self) -> None:
        """Start the manager, background reconnection, and background Stem poller."""
        self._loop = asyncio.get_running_loop()
        self._running = True
        self._reconnect_task = asyncio.create_task(self._maintain_connection())
        self._poller_task = asyncio.create_task(self._stem_poller_loop())

    async def stop(self) -> None:
        """Gracefully stop connection and background loops."""
        self._running = False
        if self._reconnect_task:
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass
        if self._poller_task:
            self._poller_task.cancel()
            try:
                await self._poller_task
            except asyncio.CancelledError:
                pass
        if self.controller:
            try:
                self.controller.close()
            except Exception:
                pass
            self.controller = None
        self._reset_connection_state()

    def _connect_sync(self) -> SecureStemController:
        """Synchronous connect executed in worker thread (resolution + connect + auth + listeners)."""
        host = self.settings.TOR_CONTROL_HOST
        port = self.settings.TOR_CONTROL_PORT
        cookie_path = self.settings.TOR_COOKIE_CONTAINER_PATH

        raw_ctrl: Controller | None = None
        try:
            # 1. Resolve hostname to IPv4 address at each connection attempt
            addrinfo = socket.getaddrinfo(host, port, family=socket.AF_INET, type=socket.SOCK_STREAM)
            if not addrinfo:
                raise socket.gaierror(f"Could not resolve host: {host}")
            ip_address = addrinfo[0][4][0]

            # 2. Connect with 5-second socket timeout via custom ControlPort
            control_port = StemTimeoutControlPort(address=ip_address, port=port, connect_timeout=5.0)
            raw_ctrl = Controller(control_port)

            # 3. SecureStemController wrapper
            secure_ctrl = SecureStemController(raw_ctrl)

            # 4. Authenticate via SAFECOOKIE
            secure_ctrl.authenticate_cookie(cookie_path)

            if secure_ctrl.get_info("fingerprint", "").upper() != self.settings.TOR_FINGERPRINT:
                raise ValueError("Connected relay fingerprint does not match the configured relay")

            # 5. Register for BW events
            secure_ctrl.add_event_listener(self._on_bw_event, "BW")

            # 6. Reset underlying socket timeout back to None for persistent reader thread
            if hasattr(control_port, "_socket") and control_port._socket:
                control_port._socket.settimeout(None)

            return secure_ctrl
        except Exception:
            if raw_ctrl is not None:
                try:
                    raw_ctrl.close()
                except Exception:
                    pass
            raise

    async def _maintain_connection(self) -> None:
        backoff = 2.0
        max_backoff = 30.0

        while self._running:
            if not self.is_connected:
                # Reset state & close previous broken controller
                self._reset_connection_state()
                if self.controller:
                    try:
                        self.controller.close()
                    except Exception:
                        pass
                    self.controller = None

                logger.info(
                    "Connecting to Tor ControlPort %s:%d...",
                    self.settings.TOR_CONTROL_HOST,
                    self.settings.TOR_CONTROL_PORT,
                )
                try:
                    secure_ctrl = await asyncio.to_thread(self._connect_sync)
                    self.controller = secure_ctrl
                    self._is_connected = True
                    self._last_error = None
                    backoff = 2.0
                    logger.info("Successfully connected to Tor ControlPort (SAFECOOKIE).")
                except Exception as exc:
                    self._reset_connection_state()
                    self._last_error = str(exc)
                    jitter = random.uniform(0.8, 1.2)
                    sleep_time = min(backoff * jitter, max_backoff)
                    logger.warning(
                        "Tor ControlPort connection failed: %s. Retrying in %.1fs...",
                        exc,
                        sleep_time,
                    )
                    await asyncio.sleep(sleep_time)
                    backoff = min(backoff * 2.0, max_backoff)
                    continue

            # Heartbeat check every 5 seconds
            await asyncio.sleep(5.0)

    def _fetch_stem_status_sync(self) -> dict[str, Any]:
        """Synchronous fetcher executed in worker thread via asyncio.to_thread."""
        ctrl = self.controller
        if not ctrl or not ctrl.is_alive():
            return {
                "stem_info": {},
                "local_circuits": None,
                "or_connections": None,
                "polled_at": 0.0,
            }

        keys_to_fetch = [
            "version",
            "status/version/current",
            "status/version/recommended",
            "status/circuit-established",
            "status/bootstrap-phase",
            "status/enough-dir-info",
            "status/reachability-succeeded/or",
            "status/reachability-succeeded/dir",
            "status/accepted-server-descriptor",
            "status/good-server-descriptor",
            "uptime",
            "traffic/read",
            "traffic/written",
            "network-liveness",
        ]
        info: dict[str, Any] = {}
        for k in keys_to_fetch:
            try:
                info[k] = ctrl.get_info(k, "")
            except Exception as e:
                logger.debug("Failed to read stem key '%s': %s", k, e)
                info[k] = ""

        try:
            local_circuits = ctrl.get_aggregated_circuits()
        except Exception:
            local_circuits = None

        try:
            or_conns = ctrl.get_aggregated_orconns()
        except Exception:
            or_conns = None

        return {
            "stem_info": info,
            "local_circuits": local_circuits,
            "or_connections": or_conns,
            "polled_at": time.time(),
        }

    async def _stem_poller_loop(self) -> None:
        """Background poller (20s) running blocking stem calls in a thread pool."""
        while self._running:
            if self.is_connected:
                try:
                    data = await asyncio.to_thread(self._fetch_stem_status_sync)
                    self.record_stem_data(data)
                except Exception as exc:
                    logger.debug("Stem background poller failed: %s", exc)
            await asyncio.sleep(20.0)

    def _on_bw_event(self, event: Any) -> None:
        """Handle BW event from Stem thread and fan out to asyncio subscribers."""
        read_bps = getattr(event, "read", 0)
        write_bps = getattr(event, "written", 0)
        payload = {
            "read_bps": read_bps,
            "write_bps": write_bps,
            "timestamp": time.time(),
        }
        self._latest_bw = payload
        with self._bw_lock:
            self._minute_bw_events.append((read_bps, write_bps))

        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._fanout_bw, payload)

    def _fanout_bw(self, payload: dict[str, Any]) -> None:
        for queue in list(self._bw_subscribers):
            try:
                if queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                queue.put_nowait(payload)
            except Exception as e:
                logger.debug("Failed to dispatch BW event to subscriber: %s", e)

    async def subscribe_bw(self) -> AsyncIterator[dict[str, Any]]:
        """Subscribe to live bandwidth events with a dedicated asyncio.Queue (max 10)."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=10)
        if self._latest_bw is not None:
            queue.put_nowait(self._latest_bw)
        self._bw_subscribers.add(queue)
        try:
            while self._running:
                item = await queue.get()
                yield item
        finally:
            self._bw_subscribers.discard(queue)
