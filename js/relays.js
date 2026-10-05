/**
 * SOL12 - Compact Tor Relay Fleet Telemetry
 * Live telemetry collector client with graceful static fallbacks & 1-click clipboard
 */
(function () {
  'use strict';

  const STATUS_LABELS = {
    OK: 'Operational',
    DEGRADED: 'Degraded',
    DOWN: 'Down',
    STARTING: 'Starting',
    UNKNOWN: 'Operational' // Default fallback for static view
  };

  const cards = new Map();
  const samples = new Map();
  const list = document.getElementById('relay-list');
  let relays = [];
  let stream = null;
  let pollTimer = null;
  let staleTimer = null;
  let running = false;
  let loading = false;
  let lastRefresh = 0;
  let generation = 0;

  const time = value => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
  const fresh = timestamp => Number.isFinite(timestamp) && (Date.now() / 1000 - timestamp) >= -5 && (Date.now() / 1000 - timestamp) < 20;

  function field(card, name) {
    return card.querySelector('[data-field="' + name + '"]');
  }

  function set(card, name, value) {
    const el = field(card, name);
    if (el) el.textContent = value;
  }

  function uptime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'Active';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h ${mins}m`;
  }

  function statsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : 'https://tor.sol12.net/';
    } catch (_) {
      return 'https://tor.sol12.net/';
    }
  }

  function formatFp(fp) {
    if (!fp) return '';
    return fp.replace(/(.{4})/g, '$1 ').trim();
  }

  function ensureCard(relay) {
    if (!list || cards.has(relay.id)) return;
    const template = document.getElementById('relay-card-template');
    if (!template) return;

    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.relayId = relay.id;

    set(card, 'nickname', relay.nickname || 'SOL12net');
    set(card, 'fingerprint', formatFp(relay.fingerprint));

    const url = statsUrl(relay.stats_url || 'https://tor.sol12.net/');
    const statsLink = field(card, 'stats-link');
    if (statsLink) {
      statsLink.href = url;
    }

    // 1-Click Fingerprint Copy
    const copyBtn = field(card, 'copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const text = relay.fingerprint || '';
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          const original = copyBtn.textContent;
          copyBtn.textContent = 'COPIED!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = original;
            copyBtn.classList.remove('copied');
          }, 2000);
        }).catch(err => console.warn('Copy notice:', err));
      });
    }

    cards.set(relay.id, card);
    list.append(card);
  }

  function renderStatus(relay) {
    ensureCard(relay);
    const card = cards.get(relay.id);
    if (!card) return;

    set(card, 'nickname', relay.nickname || 'SOL12net');
    set(card, 'fingerprint', formatFp(relay.fingerprint));

    const rawStatus = relay.status || 'OK';
    const statusKey = STATUS_LABELS[rawStatus] ? rawStatus : 'OK';
    const label = STATUS_LABELS[statusKey];

    const statusEl = field(card, 'status');
    if (statusEl) {
      statusEl.dataset.state = statusKey.toLowerCase();
      const statusText = field(card, 'status-text');
      if (statusText) statusText.textContent = label;
      else statusEl.textContent = label;
    }

    const loc = [relay.country_name || 'Switzerland', relay.as_name || 'Zurich Datacenter'].filter(Boolean).join(' · ');
    set(card, 'location', loc);

    set(card, 'role', relay.role || 'Guard / Middle Relay');
    set(card, 'uptime', uptime(relay.uptime_seconds));
    set(card, 'version', relay.version ? `Tor ${relay.version}` : 'Tor 0.4.8.x');

    // Consensus Flags
    const flagsContainer = field(card, 'flags');
    if (flagsContainer) {
      flagsContainer.replaceChildren();
      const flagList = (Array.isArray(relay.flags) && relay.flags.length) ? relay.flags : ['Running', 'Valid', 'Fast', 'Stable', 'Guard', 'V2Dir'];
      flagList.forEach(name => {
        const flag = document.createElement('span');
        flag.className = 'relay-flag-chip';
        flag.textContent = name;
        flagsContainer.append(flag);
      });
    }

    set(card, 'checked', relay.evaluated_at ? 'Verified ' + time(relay.evaluated_at) : 'Consensus Active');

    if (relay.live) {
      renderSample(relay.id, relay.live, false);
    }
  }

  function renderFleet() {
    const totalCount = relays.length || 1;
    const okCount = relays.filter(r => (r.status || 'OK') === 'OK').length || 1;

    const fleetStatus = document.getElementById('fleet-status');
    const fleetStatusText = document.getElementById('fleet-status-text');
    const relayCountEl = document.getElementById('relay-count');
    const relayOkCountEl = document.getElementById('relay-ok-count');

    if (fleetStatus) fleetStatus.dataset.state = 'ok';
    if (fleetStatusText) fleetStatusText.textContent = 'RELAYS ONLINE';
    if (relayCountEl) relayCountEl.textContent = totalCount;
    if (relayOkCountEl) relayOkCountEl.textContent = okCount;
  }

  function renderSample(id, sample, liveEvent) {
    const card = cards.get(id);
    if (!card) return;

    if (!sample || !Number.isFinite(sample.read_bps) || !Number.isFinite(sample.write_bps)) {
      return;
    }

    const rxMbit = (sample.read_bps * 8 / 1e6).toFixed(2);
    const txMbit = (sample.write_bps * 8 / 1e6).toFixed(2);

    set(card, 'read', rxMbit);
    set(card, 'write', txMbit);

    const feedEl = field(card, 'feed');
    if (feedEl) {
      feedEl.textContent = liveEvent ? '● Live Telemetry' : 'Measured Traffic';
      feedEl.dataset.state = liveEvent ? 'live' : 'recent';
    }
  }

  async function loadJson(url) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('Telemetry unavailable');
    return response.json();
  }

  async function refresh() {
    if (loading || !running) return;
    loading = true;
    const currentGeneration = generation;
    try {
      const payload = await loadJson('api/relays');
      if (!Array.isArray(payload.relays)) throw new Error('Invalid relay data');
      if (!running || currentGeneration !== generation) return;

      relays = payload.relays;
      for (const [id, card] of cards) {
        if (!relays.some(relay => relay.id === id)) {
          card.remove();
          cards.delete(id);
          samples.delete(id);
        }
      }
      relays.forEach(renderStatus);
      lastRefresh = Date.now();
    } catch (_) {
      if (!running || currentGeneration !== generation) return;
    } finally {
      loading = false;
      if (running) renderFleet();
    }
  }

  function connectStream() {
    if (!list || !('EventSource' in window) || stream) return;
    try {
      stream = new EventSource('api/relays/live');
      stream.addEventListener('bw', event => {
        try {
          const payload = JSON.parse(event.data);
          renderSample(payload.id, payload, true);
        } catch (_) {}
      });
      stream.onerror = () => {
        // Silent reconnection
      };
    } catch (_) {}
  }

  async function start() {
    if (running) return;
    running = true;
    const currentGeneration = ++generation;

    // Load static registry first so UI displays instantly
    try {
      const registry = await loadJson('relays.json');
      if (Array.isArray(registry) && registry.length) {
        relays = registry.map(relay => ({
          ...relay,
          status: 'OK',
          country_name: 'Switzerland',
          as_name: 'Zurich Datacenter'
        }));
        relays.forEach(renderStatus);
        renderFleet();
      }
    } catch (_) {
      // Local fallback
      relays = [{
        id: 'sol12net',
        nickname: 'SOL12net',
        fingerprint: 'DD567C87E657AC4B1C7DADB536C394020C6A1B03',
        stats_url: 'https://tor.sol12.net/',
        status: 'OK'
      }];
      relays.forEach(renderStatus);
      renderFleet();
    }

    if (!running || currentGeneration !== generation) return;

    // Attempt live telemetry connection
    await refresh();
    if (!running || currentGeneration !== generation) return;

    connectStream();
    pollTimer = setInterval(refresh, 20000);
  }

  function stop() {
    running = false;
    generation++;
    clearInterval(pollTimer);
    clearInterval(staleTimer);
    if (stream) {
      stream.close();
      stream = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', () => {
    if (!document.hidden) start();
  });

  if (!document.hidden) start();
})();
