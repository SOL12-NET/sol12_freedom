/* Direct relay telemetry served by Freedom's collector. No tor.sol12.net API calls. */
(function () {
  'use strict';
  const STATUS_LABELS = { OK: 'Operational', DEGRADED: 'Degraded', DOWN: 'Down', STARTING: 'Starting', UNKNOWN: 'Unavailable' };
  const cards = new Map();
  const samples = new Map();
  const list = document.getElementById('relay-list');
  const notice = document.getElementById('relays-notice');
  let relays = [];
  let stream;
  let pollTimer;
  let staleTimer;
  let running = false;
  let loading = false;
  let lastRefresh = 0;
  let generation = 0;
  const time = value => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
  const fresh = timestamp => Number.isFinite(timestamp) && Date.now() / 1000 - timestamp >= -5 && Date.now() / 1000 - timestamp < 15;

  function field(card, name) { return card.querySelector('[data-field="' + name + '"]'); }
  function set(card, name, value) { field(card, name).textContent = value; }
  function uptime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    return Math.floor(seconds / 86400) + 'd ' + Math.floor(seconds % 86400 / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm';
  }
  function statsUrl(value) {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch (_) { return null; }
  }

  function ensureCard(relay) {
    if (!list || cards.has(relay.id)) return;
    const card = document.getElementById('relay-card-template').content.firstElementChild.cloneNode(true);
    card.dataset.relayId = relay.id;
    set(card, 'nickname', relay.nickname);
    set(card, 'fingerprint', relay.fingerprint);
    const url = statsUrl(relay.stats_url);
    if (url) field(card, 'stats-link').href = url;
    else field(card, 'stats-link').remove();
    cards.set(relay.id, card);
    list.append(card);
  }

  function renderStatus(relay) {
    ensureCard(relay);
    const card = cards.get(relay.id);
    if (!card) return;
    set(card, 'nickname', relay.nickname);
    set(card, 'fingerprint', relay.fingerprint);
    const status = STATUS_LABELS[relay.status] ? relay.status : 'UNKNOWN';
    set(card, 'status', STATUS_LABELS[status]);
    field(card, 'status').dataset.state = status.toLowerCase();
    set(card, 'reason', relay.reason || 'Telemetry is temporarily unavailable. Open the full statistics for more information.');
    set(card, 'location', [relay.country_name, relay.as_name].filter(Boolean).join(' · ') || 'Location unavailable');
    set(card, 'uptime', uptime(relay.uptime_seconds));
    set(card, 'version', relay.version || '—');
    set(card, 'role', relay.role || '—');
    const flags = field(card, 'flags');
    flags.replaceChildren();
    (relay.flags || []).forEach(name => { const flag = document.createElement('span'); flag.className = 'relay-flag'; flag.textContent = name; flags.append(flag); });
    if (!flags.childElementCount) flags.textContent = 'Consensus data unavailable';
    set(card, 'checked', relay.evaluated_at ? 'Status checked ' + time(relay.evaluated_at) : 'Status not yet available');
    if (relay.live) renderSample(relay.id, relay.live, false);
    else clearSample(relay.id);
  }

  function renderFleet() {
    const counts = { OK: 0, DEGRADED: 0, DOWN: 0, STARTING: 0, UNKNOWN: 0 };
    relays.forEach(relay => { counts[STATUS_LABELS[relay.status] ? relay.status : 'UNKNOWN']++; });
    let state = 'unknown', label = 'STATUS UNAVAILABLE';
    if (relays.length && counts.UNKNOWN === 0) {
      if (counts.DOWN) { state = 'down'; label = counts.DOWN + ' RELAY' + (counts.DOWN > 1 ? 'S' : '') + ' DOWN'; }
      else if (counts.DEGRADED) { state = 'degraded'; label = 'RELAYS DEGRADED'; }
      else if (counts.STARTING) { state = 'starting'; label = 'RELAYS STARTING'; }
      else { state = 'ok'; label = 'RELAYS OPERATIONAL'; }
    }
    document.getElementById('fleet-status').dataset.state = state;
    document.getElementById('fleet-status-text').textContent = label;
    if (list) {
      document.getElementById('relay-count').textContent = relays.length;
      document.getElementById('relay-ok-count').textContent = counts.OK;
      document.getElementById('relay-attention-count').textContent = counts.DEGRADED + counts.DOWN;
    }
  }

  function clearSample(id) {
    samples.delete(id);
    const card = cards.get(id);
    if (!card) return;
    set(card, 'read', '—'); set(card, 'write', '—');
    set(card, 'feed', 'Live traffic unavailable'); field(card, 'feed').dataset.state = 'unknown';
    set(card, 'sample-time', '');
    ['read-chart', 'write-chart'].forEach(name => field(card, name).querySelector('polyline').setAttribute('points', ''));
  }

  function renderSample(id, sample, liveEvent) {
    const card = cards.get(id);
    if (!card) return;
    if (!sample || !fresh(sample.timestamp) || !Number.isFinite(sample.read_bps) || !Number.isFinite(sample.write_bps) || sample.read_bps < 0 || sample.write_bps < 0) { clearSample(id); return; }
    const previous = samples.get(id);
    if (previous && sample.timestamp < previous.timestamp) return;
    const history = previous ? previous.history : [];
    if (!previous || sample.timestamp > previous.timestamp) history.push(sample);
    if (history.length > 60) history.shift();
    samples.set(id, { ...sample, history });
    set(card, 'read', (sample.read_bps * 8 / 1e6).toFixed(2));
    set(card, 'write', (sample.write_bps * 8 / 1e6).toFixed(2));
    set(card, 'feed', liveEvent ? '● Live traffic' : 'Latest traffic measurement');
    field(card, 'feed').dataset.state = liveEvent ? 'live' : 'recent';
    set(card, 'sample-time', time(sample.timestamp * 1000));
    const maximum = Math.max(1, ...history.flatMap(item => [item.read_bps, item.write_bps]));
    ['read', 'write'].forEach(direction => {
      const points = history.map((item, index) => ((60 - history.length + index) * 360 / 59).toFixed(1) + ',' + (50 - item[direction + '_bps'] / maximum * 46).toFixed(1)).join(' ');
      field(card, direction + '-chart').querySelector('polyline').setAttribute('points', points);
    });
  }

  async function loadJson(url) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
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
      for (const [id, card] of cards) if (!relays.some(relay => relay.id === id)) { card.remove(); cards.delete(id); samples.delete(id); }
      relays.forEach(renderStatus);
      lastRefresh = Date.now();
      if (notice) notice.textContent = relays.length ? 'Status and traffic from our relay infrastructure.' : 'No relays have been configured yet.';
    } catch (_) {
      if (!running || currentGeneration !== generation) return;
      relays = relays.map(relay => ({ ...relay, status: 'UNKNOWN', reason: 'Telemetry is temporarily unavailable. The relay may still be running.', live: null, evaluated_at: null }));
      relays.forEach(renderStatus);
      if (notice) notice.textContent = 'Telemetry is temporarily unavailable. Retrying automatically; full statistics remain accessible.';
    } finally { loading = false; if (running) renderFleet(); }
  }

  function connectStream() {
    if (!list || !('EventSource' in window) || stream) return;
    stream = new EventSource('api/relays/live');
    stream.addEventListener('bw', event => {
      try { const payload = JSON.parse(event.data); renderSample(payload.id, payload, true); } catch (_) { /* Keep the last verified measurement until it expires. */ }
    });
    stream.onerror = () => { cards.forEach(card => { set(card, 'feed', 'Live connection interrupted · reconnecting'); field(card, 'feed').dataset.state = 'unknown'; }); };
  }

  async function start() {
    if (running) return;
    running = true;
    const currentGeneration = ++generation;
    if (!relays.length) {
      try { relays = (await loadJson('relays.json')).map(relay => ({ ...relay, status: 'UNKNOWN' })); relays.forEach(renderStatus); renderFleet(); } catch (_) { /* The API can still provide the registry. */ }
    }
    if (!running || currentGeneration !== generation) return;
    await refresh();
    if (!running || currentGeneration !== generation) return;
    connectStream();
    pollTimer = setInterval(refresh, 20000);
    staleTimer = setInterval(() => {
      samples.forEach((sample, id) => { if (!fresh(sample.timestamp)) clearSample(id); });
      if (lastRefresh && Date.now() - lastRefresh > 45000) {
        relays = relays.map(relay => ({ ...relay, status: 'UNKNOWN', reason: 'Status data is stale. Reconnecting to telemetry.', evaluated_at: null }));
        relays.forEach(renderStatus); renderFleet();
      }
    }, 1000);
  }
  function stop() { running = false; generation++; clearInterval(pollTimer); clearInterval(staleTimer); if (stream) { stream.close(); stream = null; } }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', () => { if (!document.hidden) start(); });
  if (!document.hidden) start();
})();
