/**
 * SOL12 - Minimal Telemetry Application
 * SpaceX Noir Interface & Swiss Privacy Infrastructure
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    initClock();
    initScrollEffects();
  }

  /* -------------------------------------------------------------
   * 1. Mission Control Clock (UTC Zulu Time)
   * ----------------------------------------------------------- */
  function initClock() {
    const clockUtc = document.getElementById('telemetry-clock-utc');
    if (!clockUtc) return;

    function updateTime() {
      const now = new Date();
      clockUtc.textContent = now.toISOString().substring(11, 19) + ' UTC';
    }

    updateTime();
    setInterval(updateTime, 1000);
  }

  /* -------------------------------------------------------------
   * 2. Smooth Scroll Reveal Animations
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
