"""Integration test: Fake Tor ControlPort TCP server verifying SAFECOOKIE HMAC handshake and read-only command whitelist."""

import asyncio
import hashlib
import hmac
import os
import secrets
import tempfile
import pytest

from stem.control import Controller
from backend.control import (
    SecureStemController,
    StemSecurityViolationError,
)

SERVER_KEY = b"Tor safe cookie authentication server-to-controller hash"
CLIENT_KEY = b"Tor safe cookie authentication controller-to-server hash"


class FakeTorControlServer:
    """Minimal TCP server mimicking Tor 0.4.9.12 ControlPort SAFECOOKIE authentication."""

    def __init__(self, cookie_bytes: bytes):
        self.cookie_bytes = cookie_bytes
        self.recorded_commands: list[str] = []
        self.server: asyncio.Server | None = None
        self.port: int = 0
        self.client_nonce: bytes = b""
        self.server_nonce: bytes = secrets.token_bytes(32)

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            while True:
                line_bytes = await reader.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                self.recorded_commands.append(line)
                parts = line.split()
                verb = parts[0].upper()

                if verb == "PROTOCOLINFO":
                    resp = (
                        "250-PROTOCOLINFO 1\r\n"
                        '250-AUTH METHODS=SAFECOOKIE COOKIEFILE="/run/tor/control_auth_cookie"\r\n'
                        '250-VERSION Tor="0.4.9.12"\r\n'
                        "250 OK\r\n"
                    )
                    writer.write(resp.encode("ascii"))
                    await writer.drain()

                elif verb == "AUTHCHALLENGE":
                    self.client_nonce = bytes.fromhex(parts[2])
                    msg = self.cookie_bytes + self.client_nonce + self.server_nonce
                    server_hash = hmac.new(SERVER_KEY, msg, hashlib.sha256).hexdigest().upper()
                    server_nonce_hex = self.server_nonce.hex().upper()
                    resp = f"250 AUTHCHALLENGE SERVERHASH={server_hash} SERVERNONCE={server_nonce_hex}\r\n"
                    writer.write(resp.encode("ascii"))
                    await writer.drain()

                elif verb == "AUTHENTICATE":
                    client_hash = parts[1].lower() if len(parts) > 1 else ""
                    msg = self.cookie_bytes + self.client_nonce + self.server_nonce
                    expected_client_hash = hmac.new(CLIENT_KEY, msg, hashlib.sha256).hexdigest().lower()
                    if client_hash == expected_client_hash:
                        writer.write(b"250 OK\r\n")
                    else:
                        writer.write(b"515 Bad client authentication\r\n")
                    await writer.drain()

                elif verb == "GETINFO":
                    arg = parts[1] if len(parts) > 1 else "version"
                    if arg == "events/names":
                        writer.write(b"250-events/names=BW STATUS_CLIENT STATUS_SERVER CONF_CHANGED SIGNAL\r\n250 OK\r\n")
                    elif arg == "fingerprint":
                        writer.write(b"250-fingerprint=DD567C87E657AC4B1C7DADB536C394020C6A1B03\r\n250 OK\r\n")
                    else:
                        writer.write(f"250-{arg}=0.4.9.12\r\n250 OK\r\n".encode("ascii"))
                    await writer.drain()

                elif verb == "GETCONF":
                    arg = parts[1] if len(parts) > 1 else ""
                    writer.write(f"250 {arg}=SOL12net\r\n".encode("ascii"))
                    await writer.drain()

                elif verb == "SETEVENTS":
                    writer.write(b"250 OK\r\n")
                    await writer.drain()
                    if "BW" in parts:
                        async def send_bw():
                            await asyncio.sleep(0.1)
                            if not writer.is_closing():
                                writer.write(b"650 BW 12500000 12000000\r\n")
                                await writer.drain()
                        asyncio.create_task(send_bw())

                elif verb == "QUIT":
                    writer.write(b"250 OK\r\n")
                    await writer.drain()
                    break

                else:
                    writer.write(b"250 OK\r\n")
                    await writer.drain()

        except Exception:
            pass
        finally:
            writer.close()

    async def start(self) -> int:
        self.server = await asyncio.start_server(self.handle_client, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]
        return self.port

    async def stop(self):
        if self.server:
            self.server.close()
            await self.server.wait_closed()


async def safecookie_scenario():
    """Verify SAFECOOKIE authentication against fake TCP ControlPort and check command whitelist."""
    cookie_data = secrets.token_bytes(32)

    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(cookie_data)
        cookie_path = f.name

    fake_server = FakeTorControlServer(cookie_data)
    port = await fake_server.start()

    def run_stem_client():
        raw_ctrl = Controller.from_port(address="127.0.0.1", port=port)
        secure_ctrl = SecureStemController(raw_ctrl)

        try:
            # 1. Authenticate via SAFECOOKIE
            secure_ctrl.authenticate_cookie(cookie_path)
            assert secure_ctrl.is_authenticated() is True

            # 2. Test allowed GETINFO
            v = secure_ctrl.get_info("version")
            assert "0.4.9.12" in v

            # 3. Test allowed GETCONF (case insensitive)
            c = secure_ctrl.get_conf("Nickname")
            assert c in ["SOL12net", ""]

            # 4. Test forbidden mutating commands rejected locally
            with pytest.raises(StemSecurityViolationError):
                raw_ctrl.msg("TAKEOWNERSHIP")

            with pytest.raises(StemSecurityViolationError):
                raw_ctrl.msg("SETCONF RelayBandwidthRate=1000")

            with pytest.raises(StemSecurityViolationError):
                raw_ctrl.msg("ADD_ONION NEW:BEST")

        finally:
            raw_ctrl.close()

    try:
        # Run blocking Stem client in a separate thread so event loop handles TCP server
        await asyncio.to_thread(run_stem_client)

        # Verify recorded commands at server side
        verbs_recorded = {cmd.split()[0].upper() for cmd in fake_server.recorded_commands}
        authorized_verbs = {
            "PROTOCOLINFO",
            "AUTHCHALLENGE",
            "AUTHENTICATE",
            "GETINFO",
            "GETCONF",
            "SETEVENTS",
            "QUIT",
        }

        assert verbs_recorded.issubset(authorized_verbs)
        assert "TAKEOWNERSHIP" not in verbs_recorded
        assert "SETCONF" not in verbs_recorded
        assert "ADD_ONION" not in verbs_recorded

    finally:
        await fake_server.stop()
        if os.path.exists(cookie_path):
            os.remove(cookie_path)


def test_fake_controlport_safecookie_and_command_whitelist():
    asyncio.run(safecookie_scenario())


def test_direct_collector_receives_bw_and_checks_relay_identity(tmp_path):
    from backend.control import TorControlManager
    from backend.main import ControlSettings

    async def scenario():
        cookie = secrets.token_bytes(32)
        path = tmp_path / "control_auth_cookie"
        path.write_bytes(cookie)
        server = FakeTorControlServer(cookie)
        port = await server.start()
        settings = ControlSettings("localhost", port, str(path), "DD567C87E657AC4B1C7DADB536C394020C6A1B03")
        manager = TorControlManager(settings)
        try:
            await manager.start()
            subscription = manager.subscribe_bw()
            sample = await asyncio.wait_for(anext(subscription), timeout=5)
            assert sample["read_bps"] == 12500000
            assert sample["write_bps"] == 12000000
            assert manager.is_connected
            assert "GETINFO fingerprint" in server.recorded_commands
            await subscription.aclose()
        finally:
            await manager.stop()
            await server.stop()
    asyncio.run(scenario())


def test_wrong_relay_fingerprint_is_rejected(tmp_path):
    from backend.control import TorControlManager
    from backend.main import ControlSettings

    async def scenario():
        cookie = secrets.token_bytes(32)
        path = tmp_path / "control_auth_cookie"
        path.write_bytes(cookie)
        server = FakeTorControlServer(cookie)
        port = await server.start()
        manager = TorControlManager(ControlSettings("localhost", port, str(path), "0" * 40))
        try:
            with pytest.raises(ValueError, match="fingerprint"):
                await asyncio.to_thread(manager._connect_sync)
            assert not manager.is_connected
        finally:
            await server.stop()
    asyncio.run(scenario())
