"""Unit tests for the Mars hero reveal state machine in js/mars-globe.js.

The browser script is evaluated with Node.js in an isolated vm context without `document`,
so only the pure state machine runs (no DOM, no WebGL). Skipped when node is not installed.
"""

import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARS_JS = os.path.join(ROOT, "js", "mars-globe.js")

NODE_SCENARIOS = r"""
const fs = require('fs');
const vm = require('vm');
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(process.argv[1], 'utf8'), sandbox);
const api = sandbox.SOL12MarsGlobeReveal;
const out = { fadeMs: api.REVEAL_FADE_MS, timeoutMs: api.LOAD_TIMEOUT_MS, attempts: api.MAX_LOAD_ATTEMPTS };

let m = api.createRevealMachine(['planet', 'phobos', 'deimos']);
out.initial = m.getState();
m.resourceLoaded('planet');
m.resourceLoaded('phobos');
out.partialAll = m.allResourcesLoaded();
out.partialPending = Array.from(m.getPendingKeys());
out.earlyFrame = m.firstFrameRendered();
out.earlyReveal = m.reveal();
m.resourceLoaded('deimos');
out.completeAll = m.allResourcesLoaded();
out.stillLoading = m.getState();
out.readyFrame = m.firstFrameRendered();
out.reveal1 = m.reveal();
out.reveal2 = m.reveal();
out.finalState = m.getState();

m = api.createRevealMachine(['planet', 'phobos']);
m.resourceLoaded('planet');
out.fail1 = m.fail('phobos 404');
m.resourceLoaded('phobos');
out.failAll = m.allResourcesLoaded();
out.failFrame = m.firstFrameRendered();
out.failReveal = m.reveal();
out.fail2 = m.fail('again');
out.failReason = m.getFailureReason();

m = api.createRevealMachine(['planet']);
m.resourceLoaded('planet');
m.firstFrameRendered();
m.fail('context lost');
out.lateFailReveal = m.reveal();
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def result():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    proc = subprocess.run(
        [node, "-e", NODE_SCENARIOS, MARS_JS],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    return json.loads(proc.stdout)


def test_constants(result):
    assert result["fadeMs"] == 1500
    assert result["timeoutMs"] > result["fadeMs"]
    assert 1 <= result["attempts"] <= 3


def test_not_ready_until_all_required_resources_loaded(result):
    assert result["initial"] == "loading"
    assert result["partialAll"] is False
    assert result["partialPending"] == ["deimos"]
    assert result["earlyFrame"] == "loading"
    assert result["earlyReveal"] is False


def test_ready_only_after_first_frame(result):
    assert result["completeAll"] is True
    assert result["stillLoading"] == "loading"
    assert result["readyFrame"] == "ready"


def test_reveal_once(result):
    assert result["reveal1"] is True
    assert result["reveal2"] is False
    assert result["finalState"] == "revealed"


def test_failure_is_terminal(result):
    assert result["fail1"] is True
    assert result["failAll"] is False
    assert result["failFrame"] == "failed"
    assert result["failReveal"] is False
    assert result["fail2"] is False
    assert result["failReason"] == "phobos 404"


def test_failure_after_ready_blocks_reveal(result):
    assert result["lateFailReveal"] is False
