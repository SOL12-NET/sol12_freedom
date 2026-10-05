/**
 * SOL12 - Telemetry Application & Mini 3D Orbital Logo Simulator
 * SpaceX Noir Interface & Swiss Privacy Infrastructure
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    initLogoSimulator();
    initClock();
    initScrollEffects();
  }

  /* -------------------------------------------------------------
   * 1. Mini Simulateur Orbital 3D (Logo Canvas en haut à gauche)
   *    Repris fidèlement de sol12-website avec rendu orbital 3D
   * ----------------------------------------------------------- */
  function initLogoSimulator() {
    const canvas = document.getElementById('logo-simulator');
    const navLogo = document.querySelector('.nav-brand');

    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = 54;
    const height = 54;

    let pitch = 0.6;
    let yaw = 0.3;
    let targetPitch = 0.6;
    let targetYaw = 0.3;

    const marsRadius = 9;
    const phobos = {
      radius: 16,
      angle: 0,
      speed: 0.005,
      color: '#d64513',
      size: 1.5
    };
    const deimos = {
      radius: 24,
      angle: Math.PI,
      speed: 0.0027,
      color: '#94a3b8',
      size: 1.2
    };

    if (navLogo) {
      navLogo.addEventListener('mousemove', (e) => {
        const rect = navLogo.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        targetPitch = 0.45 + (mouseY / rect.height) * 0.3;
        targetYaw = 0.1 + (mouseX / rect.width) * 1.2;
      });

      navLogo.addEventListener('mouseleave', () => {
        targetPitch = 0.6;
      });
    }

    function project3D(x, y, z) {
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;

      const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
      const y2 = y * cosP - z1 * sinP;
      const z2 = y * sinP + z1 * cosP;

      return {
        x: width / 2 + x1,
        y: height / 2 + y2,
        depth: z1
      };
    }

    function drawMars(centerX, centerY) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, marsRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#06060a';
      ctx.fill();

      const marsGlow = ctx.createRadialGradient(
        centerX - 1.5,
        centerY - 1.5,
        1,
        centerX,
        centerY,
        marsRadius
      );
      marsGlow.addColorStop(0, '#ff6622');
      marsGlow.addColorStop(0.8, '#d64513');
      marsGlow.addColorStop(1, '#8c2505');

      ctx.beginPath();
      ctx.arc(centerX, centerY, marsRadius, 0, Math.PI * 2);
      ctx.fillStyle = marsGlow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(centerX, centerY, marsRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(214, 69, 19, 0.4)';
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }

    function drawOrbitTrack(orbitRadius, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5;

      for (let angle = 0; angle <= Math.PI * 2 + 0.1; angle += 0.1) {
        const x = orbitRadius * Math.cos(angle);
        const y = 0;
        const z = orbitRadius * Math.sin(angle);
        const p = project3D(x, y, z);

        if (angle === 0) {
          ctx.moveTo(p.x, p.y);
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }

    function drawMoon(moon) {
      const x = moon.radius * Math.cos(moon.angle);
      const y = 0;
      const z = moon.radius * Math.sin(moon.angle);
      const p = project3D(x, y, z);

      ctx.beginPath();
      ctx.arc(p.x, p.y, moon.size, 0, Math.PI * 2);
      ctx.fillStyle = moon.color === '#d64513' ? '#ffaa77' : '#cbd5e1';
      ctx.fill();
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);

      pitch += (targetPitch - pitch) * 0.05;
      targetYaw += 0.0003;
      yaw += (targetYaw - yaw) * 0.05;

      const marsX = width / 2;
      const marsY = height / 2;

      drawOrbitTrack(phobos.radius, 'rgba(214, 69, 19, 0.16)');
      drawOrbitTrack(deimos.radius, 'rgba(148, 163, 184, 0.16)');

      const pPhobos = project3D(
        phobos.radius * Math.cos(phobos.angle),
        0,
        phobos.radius * Math.sin(phobos.angle)
      );
      const pDeimos = project3D(
        deimos.radius * Math.cos(deimos.angle),
        0,
        deimos.radius * Math.sin(deimos.angle)
      );

      const drawList = [
        { type: 'mars', depth: 0 },
        { type: 'moon', obj: phobos, depth: pPhobos.depth },
        { type: 'moon', obj: deimos, depth: pDeimos.depth }
      ];

      // Depth sorting for accurate 3D occultation
      drawList.sort((a, b) => b.depth - a.depth);

      drawList.forEach(item => {
        if (item.type === 'mars') {
          drawMars(marsX, marsY);
        } else {
          drawMoon(item.obj);
        }
      });

      phobos.angle += phobos.speed;
      deimos.angle += deimos.speed;

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  }

  /* -------------------------------------------------------------
   * 2. Mission Control Clock (UTC Zulu Time)
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
   * 3. Smooth Scroll Reveal Animations
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
