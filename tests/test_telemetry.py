import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.control import TorControlManager, validate_control_command, StemSecurityViolationError
from backend.health import NetworkLivenessTracker
from backend.main import app, ControlSettings, Fleet, Relay, load_registry, relay_stream

METADATA = {"id": "sol12net", "nickname": "SOL12net", "fingerprint": "DD567C87E657AC4B1C7DADB536C394020C6A1B03", "stats_url": "https://tor.sol12.net/"}
INFO = {"version": "0.4.9.12", "status/version/current": "recommended", "status/bootstrap-phase": "NOTICE BOOTSTRAP PROGRESS=100", "status/circuit-established": "0", "status/reachability-succeeded/or": "1", "status/enough-dir-info": "1", "status/accepted-server-descriptor": "1", "network-liveness": "up", "uptime": "1106400"}


def active_relay(monkeypatch, flags=None):
    relay = Relay(METADATA)
    relay.configured = True
    relay.control.controller = Mock(is_alive=Mock(return_value=True))
    relay.control._is_connected = True
    relay.control.record_stem_data({"stem_info": dict(INFO), "polled_at": time.time()})
    relay.details = {"flags": flags or ["Running", "Valid", "Fast", "Stable", "Guard", "HSDir", "V2Dir"], "country_name": "Switzerland", "as_name": "Infomaniak Network SA"}
    relay.details_at = time.time()
    return relay


@pytest.mark.parametrize("command", ["SETCONF RelayBandwidthRate=1", "SIGNAL RELOAD", "GETCONF HashedControlPassword", "GETINFO config-text", "SETEVENTS STREAM", "GETINFO version\r\nSETCONF Nickname=other"])
def test_controller_blocks_mutation_and_private_data(command):
    with pytest.raises(StemSecurityViolationError):
        validate_control_command(command, authenticated=True)


def test_real_zero_traffic_is_not_unavailable(monkeypatch):
    relay = active_relay(monkeypatch)
    relay.control._latest_bw = {"read_bps": 0, "write_bps": 0, "timestamp": time.time()}
    result = relay.snapshot()
    assert result["status"] == "OK"
    assert result["live"]["read_bps"] == 0
    assert result["role"] == "Guard / middle relay"
    assert result["uptime_seconds"] == 1106400


def test_hsdir_missing_has_same_degraded_rule_as_monitor(monkeypatch):
    relay = active_relay(monkeypatch, ["Running", "Valid", "Fast", "Stable", "Guard", "V2Dir"])
    result = relay.snapshot()
    assert result["status"] == "DEGRADED"
    assert "HSDir" in result["reason"]


def test_disconnected_relay_clears_bandwidth_and_uptime(monkeypatch):
    relay = active_relay(monkeypatch)
    relay.control._is_connected = False
    relay.control._latest_bw = {"read_bps": 20, "write_bps": 20, "timestamp": time.time()}
    result = relay.snapshot()
    assert result["status"] == "DOWN"
    assert result["live"] is None
    assert result["uptime_seconds"] is None


def test_old_measurements_never_claim_live_or_operational(monkeypatch):
    relay = active_relay(monkeypatch)
    relay.control._cached_stem_data["polled_at"] = time.time() - 61
    relay.control._latest_bw = {"read_bps": 20, "write_bps": 20, "timestamp": time.time() - 16}
    result = relay.snapshot()
    assert result["status"] == "UNKNOWN"
    assert result["live"] is None


def test_unconfigured_relay_reports_unknown_not_down():
    relay = Relay(METADATA)
    relay.configured = False
    assert relay.snapshot()["status"] == "UNKNOWN"


def test_each_relay_has_independent_liveness_tracker():
    first = TorControlManager(ControlSettings("relay-a", 9052, "/cookie-a", METADATA["fingerprint"]))
    second = TorControlManager(ControlSettings("relay-b", 9052, "/cookie-b", METADATA["fingerprint"]))
    for _ in range(3):
        first.record_stem_data({"stem_info": {"network-liveness": "down"}, "polled_at": time.time()})
    assert first.tracker.get_state()[0]
    assert not second.tracker.get_state()[0]


def test_directory_unavailable_degrades_instead_of_inventing_flags(monkeypatch):
    relay = active_relay(monkeypatch)
    relay.details_at = time.time() - 7201
    result = relay.snapshot()
    assert result["status"] == "DEGRADED"
    assert result["flags"] == []
    assert result["country_name"] is None


def test_api_reads_cached_data_without_tor_or_directory_requests(monkeypatch):
    monkeypatch.setattr(Relay, "collect_directory", AsyncMock())
    relay = active_relay(monkeypatch)
    fleet = Fleet([])
    fleet.relays = [relay]
    app.state.fleet = fleet
    with TestClient(app) as client:
        # Lifespan creates an unconfigured fleet; inject the already collected test cache.
        app.state.fleet = fleet
        for _ in range(3):
            response = client.get("/api/relays")
            assert response.status_code == 200
            assert response.json()["relays"][0]["status"] == "OK"
            assert "no-store" in response.headers["cache-control"]
        relay.control.controller.get_info.assert_not_called()


@pytest.mark.parametrize("path", ["/.env", "/backend/main.py", "/docker-compose.yml", "/api/nope", "/js/..%2Fbackend%2Fmain.py", "/run/tor/control_auth_cookie"])
def test_private_files_never_served(path, monkeypatch):
    monkeypatch.setattr(Relay, "collect_directory", AsyncMock())
    with TestClient(app) as client:
        assert client.get(path).status_code == 404


def test_both_pages_and_future_relay_registry(monkeypatch, tmp_path):
    registry = tmp_path / "relays.json"
    registry.write_text(json.dumps([METADATA, {**METADATA, "id": "future", "nickname": "SOL12future"}]))
    assert len(Fleet(load_registry(registry)).relays) == 2
    monkeypatch.setattr(Relay, "collect_directory", AsyncMock())
    with TestClient(app) as client:
        for page in ("/", "/relays.html"):
            response = client.get(page)
            assert response.status_code == 200
            assert "Our Tor Relays" in response.text
            assert "connect-src 'self'" in response.headers["content-security-policy"]


def test_directory_collector_uses_onionoo_directly(monkeypatch):
    async def run():
        called = []
        async def handle(request):
            called.append(str(request.url))
            return httpx.Response(200, json={"relays": [{"fingerprint": METADATA["fingerprint"], "flags": ["Running"]}]})
        relay = Relay(METADATA)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            task = asyncio.create_task(relay.collect_directory(client))
            for _ in range(20):
                if called:
                    break
                await asyncio.sleep(0.01)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        assert len(called) == 1
        assert called[0].startswith("https://onionoo.torproject.org/details?")
        assert relay.details["flags"] == ["Running"]
    asyncio.run(run())


def test_sse_fans_out_real_measurements_and_releases_clients():
    async def run():
        fleet = Fleet([])
        app.state.fleet = fleet
        response = await relay_stream()
        assert response.headers["x-accel-buffering"] == "no"
        assert len(fleet.clients) == 1
        queue = next(iter(fleet.clients))
        queue.put_nowait({"id": "sol12net", "read_bps": 1000000, "write_bps": 2000000, "timestamp": time.time()})
        event = await anext(response.body_iterator)
        assert "event: bw\n" in event
        assert '"read_bps": 1000000' in event
        await response.body_iterator.aclose()
        assert not fleet.clients
    asyncio.run(run())


def test_sse_rejects_extra_clients():
    from fastapi import HTTPException
    async def run():
        fleet = Fleet([])
        fleet.clients = {asyncio.Queue() for _ in range(32)}
        app.state.fleet = fleet
        with pytest.raises(HTTPException) as error:
            await relay_stream()
        assert error.value.status_code == 503
    asyncio.run(run())
