/**
 * SOL12 - Telemetry Application & Interactive Dashboard
 * Inspired by tor-monitor SpaceX Noir interface & privacy advocacy mission
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    initClocks();
    initCopyButtons();
    initExportMetrics();
    initCircuitSimulator();
    initLiveBandwidthGraph();
    initMobileNav();
    initScrollEffects();
  }

  /* -------------------------------------------------------------
   * 1. Mission Control Clocks (UTC Zulu & Mars Sol Time)
   * ----------------------------------------------------------- */
  function initClocks() {
    const clockUtc = document.getElementById('telemetry-clock-utc');
    const clockSol = document.getElementById('telemetry-clock-sol');

    function updateTime() {
      const now = new Date();
      if (clockUtc) {
        clockUtc.textContent = now.toISOString().substring(11, 19) + ' UTC';
      }

      if (clockSol) {
        // Mars Sol calculation simulation (reference Sol 742 + Martian day ratio ~1.027)
        const epoch2024 = new Date('2024-01-01T00:00:00Z').getTime();
        const diffDays = (now.getTime() - epoch2024) / (86400000 * 1.02749125);
        const solDay = Math.floor(742 + diffDays);
        const solSec = Math.floor((diffDays % 1) * 86400);
        const solH = String(Math.floor(solSec / 3600)).padStart(2, '0');
        const solM = String(Math.floor((solSec % 3600) / 60)).padStart(2, '0');
        const solS = String(solSec % 60).padStart(2, '0');
        clockSol.textContent = `SOL ${solDay} ${solH}:${solM}:${solS} MTC`;
      }
    }

    updateTime();
    setInterval(updateTime, 1000);
  }

  /* -------------------------------------------------------------
   * 2. Fingerprint Copy Utility with Feedback
   * ----------------------------------------------------------- */
  function initCopyButtons() {
    const copyBtns = document.querySelectorAll('[data-copy-target]');

    copyBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-copy-target');
        const textToCopy = btn.getAttribute('data-copy-text') || 
          (targetId ? document.getElementById(targetId)?.textContent?.trim() : '');

        if (!textToCopy) return;

        navigator.clipboard.writeText(textToCopy).then(() => {
          const originalText = btn.innerHTML;
          btn.innerHTML = `<span class="text-space-ok flex items-center gap-1 font-semibold">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            COPIÉ !
          </span>`;
          btn.classList.add('border-space-ok');

          setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('border-space-ok');
          }, 2000);
        }).catch(err => {
          console.warn('Clipboard write error:', err);
        });
      });
    });
  }

  /* -------------------------------------------------------------
   * 3. Export Relay Metrics in JSON (tor-monitor feature)
   * ----------------------------------------------------------- */
  function initExportMetrics() {
    const exportBtn = document.getElementById('btn-export-metrics');
    if (!exportBtn) return;

    exportBtn.addEventListener('click', () => {
      const data = {
        organization: "SOL12 Privacy Infrastructure Network",
        jurisdiction: "Switzerland (Swiss Federal Constitution Art. 13 & FADP)",
        mission: "Defense of free speech and online privacy against EU mass surveillance directives",
        policy: "Middle Relay Zero-Log Guarantee & RAM-only Operation",
        timestamp: new Date().toISOString(),
        relays: [
          {
            nickname: "SOL12NET_CH01",
            fingerprint: "4A9D 8F21 C765 0BE3 9812 56AD EF34 1198 77AC 09E1",
            type: "Tor Middle / Guard Consensus Eligible",
            status: "ONLINE",
            uptime_pct: 99.99,
            datacenter: "Zurich Tier IV (Green Datacenter)",
            or_port: 9001,
            dir_port: 9030,
            bandwidth_capacity: "10 Gbps unmetered",
            current_traffic_mbit: 842.6,
            consensus_flags: ["Fast", "Running", "Stable", "Valid", "V2Dir"]
          },
          {
            nickname: "SOL12NET_CH02",
            fingerprint: "B1E8 3490 FE45 2210 98A7 65DC BA43 1290 88FE 4321",
            type: "Tor Middle Relay",
            status: "ONLINE",
            uptime_pct: 99.98,
            datacenter: "Geneva Alpine Redoubt (Bunker Fort)",
            or_port: 9001,
            dir_port: 9030,
            bandwidth_capacity: "10 Gbps unmetered",
            current_traffic_mbit: 765.4,
            consensus_flags: ["Fast", "Running", "Stable", "Valid", "V2Dir"]
          }
        ]
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sol12-tor-relays-telemetry-${new Date().toISOString().substring(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  /* -------------------------------------------------------------
   * 4. Interactive Tor Circuit Simulator
   * ----------------------------------------------------------- */
  function initCircuitSimulator() {
    const hopCards = document.querySelectorAll('.circuit-hop-card');
    const infoTitle = document.getElementById('circuit-detail-title');
    const infoDesc = document.getElementById('circuit-detail-desc');
    const infoKnown = document.getElementById('circuit-detail-known');
    const infoHidden = document.getElementById('circuit-detail-hidden');

    const circuitDetails = {
      'hop-client': {
        title: "01. CLIENT (Navigateur / Ordinateur)",
        desc: "L'utilisateur chiffre son message avec 3 couches cryptographiques imbriquées (comme les couches d'un oignon). Chaque nœud du circuit ne pourra déchiffrer que sa propre enveloppe.",
        known: "Connaît l'ensemble du circuit choisi, le contenu initial et la destination finale.",
        hidden: "Rien n'est caché pour l'émetteur."
      },
      'hop-guard': {
        title: "02. NŒUD D'ENTRÉE (Guard Relay)",
        desc: "Le premier relais reçoit le paquet de l'utilisateur. Il retire la 1ère couche de chiffrement pour découvrir l'adresse du Middle Relay.",
        known: "Adresse IP réelle du client. Sait qu'il doit relayer le flux vers le Middle Relay SOL12.",
        hidden: "IGNORE TOUT DU CONTENU. IGNORE TOTALEMENT LA DESTINATION FINALE (site web ou service contacté)."
      },
      'hop-middle': {
        title: "03. MIDDLE RELAY SOL12 (Suisse - Cœur Étanche)",
        desc: "Le relais SOL12 en Suisse retire la 2e couche de chiffrement. C'est le pivot fondamental qui casse la traçabilité statistique et empêche les attaques par corrélation de trafic de l'UE.",
        known: "Connaît seulement l'IP du Guard et l'IP du nœud de sortie (Exit Relay).",
        hidden: "IGNORE L'ADRESSE IP DU CLIENT ! IGNORE LA DESTINATION FINALE ! IGNORE TOTALEMENT LE CONTENU DES DONNÉES !"
      },
      'hop-exit': {
        title: "04. NŒUD DE SORTIE (Exit Relay)",
        desc: "Le dernier relais retire la 3e couche de chiffrement et achemine le paquet vers le serveur web de destination.",
        known: "Adresse IP du serveur de destination et adresse du Middle Relay SOL12.",
        hidden: "IGNORE COMPLÈTEMENT QUI EST LE CLIENT INITIAL. Pour le site web cible, le trafic provient de l'Exit, jamais de vous."
      }
    };

    hopCards.forEach((card) => {
      card.addEventListener('click', () => {
        const hopKey = card.getAttribute('data-hop');
        if (!hopKey || !circuitDetails[hopKey]) return;

        hopCards.forEach(c => c.classList.remove('active-hop'));
        card.classList.add('active-hop');

        const detail = circuitDetails[hopKey];
        if (infoTitle) infoTitle.textContent = detail.title;
        if (infoDesc) infoDesc.textContent = detail.desc;
        if (infoKnown) infoKnown.textContent = detail.known;
        if (infoHidden) infoHidden.textContent = detail.hidden;
      });
    });
  }

  /* -------------------------------------------------------------
   * 5. Live Bandwidth Graph (Canvas Telemetry in tor-monitor style)
   * ----------------------------------------------------------- */
  function initLiveBandwidthGraph() {
    const canvas1 = document.getElementById('live-bw-canvas-01');
    const canvas2 = document.getElementById('live-bw-canvas-02');

    function setupSparkline(canvas, baseSpeedRx, baseSpeedTx) {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const pointsRx = Array(35).fill(baseSpeedRx);
      const pointsTx = Array(35).fill(baseSpeedTx);

      function render() {
        const w = canvas.width = canvas.parentElement.clientWidth || 320;
        const h = canvas.height = 70;

        // Shift new values
        const noiseRx = (Math.random() - 0.48) * 45;
        const noiseTx = (Math.random() - 0.48) * 40;
        const nextRx = Math.max(200, Math.min(1000, pointsRx[pointsRx.length - 1] + noiseRx));
        const nextTx = Math.max(200, Math.min(1000, pointsTx[pointsTx.length - 1] + noiseTx));

        pointsRx.shift();
        pointsRx.push(nextRx);
        pointsTx.shift();
        pointsTx.push(nextTx);

        ctx.clearRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.33);
        ctx.lineTo(w, h * 0.33);
        ctx.moveTo(0, h * 0.66);
        ctx.lineTo(w, h * 0.66);
        ctx.stroke();

        const step = w / (pointsRx.length - 1);
        const maxVal = 1100;

        // Draw RX (Cyan / Sky Blue)
        ctx.beginPath();
        for (let i = 0; i < pointsRx.length; i++) {
          const x = i * step;
          const y = h - (pointsRx[i] / maxVal) * (h - 10);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#7DD3FC';
        ctx.lineWidth = 1.75;
        ctx.stroke();

        // Draw TX (Mars Ember / Orange)
        ctx.beginPath();
        for (let i = 0; i < pointsTx.length; i++) {
          const x = i * step;
          const y = h - (pointsTx[i] / maxVal) * (h - 10);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#F97316';
        ctx.lineWidth = 1.75;
        ctx.stroke();

        // Update textual readouts if present
        const rxEl = canvas.closest('.telemetry-card')?.querySelector('.readout-rx');
        const txEl = canvas.closest('.telemetry-card')?.querySelector('.readout-tx');
        if (rxEl) rxEl.textContent = `${nextRx.toFixed(1)} Mb/s`;
        if (txEl) txEl.textContent = `${nextTx.toFixed(1)} Mb/s`;
      }

      setInterval(render, 1500);
      render();
    }

    setupSparkline(canvas1, 680, 620);
    setupSparkline(canvas2, 590, 540);
  }

  /* -------------------------------------------------------------
   * 6. Mobile Navigation Toggle
   * ----------------------------------------------------------- */
  function initMobileNav() {
    const toggle = document.querySelector('.mobile-nav-toggle');
    const menu = document.getElementById('nav-links');

    if (!toggle || !menu) return;

    toggle.addEventListener('click', () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', !isExpanded);
      menu.classList.toggle('open');
    });

    menu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggle.setAttribute('aria-expanded', 'false');
        menu.classList.remove('open');
      });
    });
  }

  /* -------------------------------------------------------------
   * 7. Subtle Scroll Reveal Animations
   * ----------------------------------------------------------- */
  function initScrollEffects() {
    const reveals = document.querySelectorAll('.scroll-reveal');

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1 });

      reveals.forEach(el => observer.observe(el));
    } else {
      reveals.forEach(el => el.classList.add('revealed'));
    }
  }

})();
