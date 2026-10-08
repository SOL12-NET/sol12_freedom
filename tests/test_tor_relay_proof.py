from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.main import Relay, app

PATH = "/.well-known/tor-relay/rsa-fingerprint.txt"
EXPECTED = b"DD567C87E657AC4B1C7DADB536C394020C6A1B03\n"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(Relay, "collect_directory", AsyncMock())
    with TestClient(app) as test_client:
        yield test_client


def test_ciiss_proof_get_serves_exact_plain_text(client):
    response = client.get(PATH, follow_redirects=False)
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    assert response.content == EXPECTED
    assert "location" not in response.headers


def test_ciiss_proof_head_is_allowed(client):
    response = client.head(PATH, follow_redirects=False)
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    assert response.headers["content-length"] == str(len(EXPECTED))


def test_ciiss_proof_keeps_security_headers(client):
    proof = client.get(PATH)
    page = client.get("/")
    for header in ("content-security-policy", "x-content-type-options", "referrer-policy", "x-frame-options", "cache-control"):
        assert proof.headers[header] == page.headers[header]


@pytest.mark.parametrize("path", ["/.well-known/", "/.well-known/tor-relay/", "/.well-known/tor-relay/other.txt", PATH + "/"])
def test_other_well_known_paths_still_404(client, path):
    assert client.get(path, follow_redirects=False).status_code == 404
