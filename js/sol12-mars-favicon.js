/**
 * SOL12 Shared Animated Mars Favicon (2D Canvas CPU Ray-Casted Sphere & Same-Origin Frames Mode)
 * Exact CPU port of sol12-mars-logo.js fragment shader at 32x32 (~10 fps in canvas mode,
 * or pre-rendered same-origin PNG sequence via data-frames-pattern + data-frames-count for strict CSP).
 * Reusable standalone component for sol12-website, Freedom, Tor Monitor, and ifconfig.
 * Version: 1.2.0
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.Sol12MarsFavicon = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const capturedScriptAttrs = (function () {
    try {
      if (typeof document !== 'undefined' && document.currentScript && typeof document.currentScript.getAttribute === 'function') {
        return {
          textureSrc: document.currentScript.getAttribute('data-texture-src'),
          framesPattern: document.currentScript.getAttribute('data-frames-pattern'),
          framesCount: document.currentScript.getAttribute('data-frames-count'),
          staticSrc: document.currentScript.getAttribute('data-static-src')
        };
      }
    } catch (_) {}
    return {
      textureSrc: null,
      framesPattern: null,
      framesCount: null,
      staticSrc: null
    };
  })();

  const DEFAULT_SPEC = Object.freeze({
    version: '1.2.0',
    textureUrl: 'assets/logo/mars_logo_512x256.jpg?v=20261013',
    sphereRadius: 0.80,
    cameraZ: 3.2075,
    sunDirection: Object.freeze([0.833219, 0.258585, 0.488439]),
    axialTiltZDeg: -25.2,
    axialTiltXRad: 0.14,
    initialRotationYRad: 0.05,
    rotationPeriodSec: 75.0,
    faviconSize: 32,
    intervalMs: 100
  });

  const PI = 3.141592653589793;
  const TWO_PI = 2.0 * PI;
  const SPHERE_RADIUS = 0.80;
  const CAM_Z = 3.2075;
  const FOCAL = 2.438104;
  const SUN_DIR_X = 0.833219;
  const SUN_DIR_Y = 0.258585;
  const SUN_DIR_Z = 0.488439;
  const COS_RZ = 0.904827;
  const SIN_RZ = 0.425779;
  const COS_RX = 0.990216;
  const SIN_RX = -0.139543;

  function srgbToLinearScalar(c) {
    return Math.pow(Math.max(c, 0.0), 2.2);
  }

  function linearToSrgbScalar(c) {
    const clamped = Math.max(0.0, Math.min(1.0, c));
    return Math.pow(clamped, 1.0 / 2.2);
  }

  function smoothstep(edge0, edge1, x) {
    const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3.0 - 2.0 * t);
  }

  function rrtAndOdtFitScalar(v) {
    const a = v * (v + 0.0245786) - 0.000090537;
    const b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }

  function acesFilmicToneMapping(r, g, b) {
    const scale = 1.08 / 0.6;
    const cr = r * scale;
    const cg = g * scale;
    const cb = b * scale;

    // ACESInputMat (GLSL column-major: col0=(0.59719,0.07600,0.02840), col1=(0.35458,0.90834,0.13383), col2=(0.04823,0.01566,0.83777))
    const ir = 0.59719 * cr + 0.35458 * cg + 0.04823 * cb;
    const ig = 0.07600 * cr + 0.90834 * cg + 0.01566 * cb;
    const ib = 0.02840 * cr + 0.13383 * cg + 0.83777 * cb;

    const fr = rrtAndOdtFitScalar(ir);
    const fg = rrtAndOdtFitScalar(ig);
    const fb = rrtAndOdtFitScalar(ib);

    // ACESOutputMat (GLSL column-major: col0=(1.60475,-0.10208,-0.00327), col1=(-0.53108,1.10813,-0.07276), col2=(-0.07367,-0.00605,1.07602))
    const or = 1.60475 * fr - 0.53108 * fg - 0.07367 * fb;
    const og = -0.10208 * fr + 1.10813 * fg - 0.00605 * fb;
    const ob = -0.00327 * fr - 0.07276 * fg + 1.07602 * fb;

    return [
      Math.max(0.0, Math.min(1.0, or)),
      Math.max(0.0, Math.min(1.0, og)),
      Math.max(0.0, Math.min(1.0, ob))
    ];
  }

  const TINT_R = srgbToLinearScalar(0.96);
  const TINT_G = srgbToLinearScalar(0.92);
  const TINT_B = srgbToLinearScalar(0.88);

  const SUN_COL_R = srgbToLinearScalar(1.0);
  const SUN_COL_G = srgbToLinearScalar(0.969);
  const SUN_COL_B = srgbToLinearScalar(0.933);

  const ATMOS_COL_R = 0.96;
  const ATMOS_COL_G = 0.46;
  const ATMOS_COL_B = 0.24;

  const precomputedCache = new Map();

  function getPrecomputedGrid(size) {
    const dim = Math.max(1, size | 0);
    if (precomputedCache.has(dim)) {
      return precomputedCache.get(dim);
    }

    const total = dim * dim;
    const active = new Uint8Array(total);
    const edgeAlphaByte = new Uint8Array(total);
    const baseU = new Float32Array(total);
    const vCoord = new Float32Array(total);
    const irrR = new Float32Array(total);
    const irrG = new Float32Array(total);
    const irrB = new Float32Array(total);
    const atmosR = new Float32Array(total);
    const atmosG = new Float32Array(total);
    const atmosB = new Float32Array(total);

    const aaWidth = 2.0 / Math.max(dim, 64.0);
    const c = CAM_Z * CAM_Z - 1.0;

    let idx = 0;
    for (let py = 0; py < dim; py++) {
      const ndcY = 1.0 - ((py + 0.5) / dim) * 2.0;
      for (let px = 0; px < dim; px++, idx++) {
        const ndcX = ((px + 0.5) / dim) * 2.0 - 1.0;
        const rClip = Math.hypot(ndcX, ndcY);
        if (rClip > SPHERE_RADIUS + aaWidth) {
          continue;
        }

        const eAlpha = 1.0 - smoothstep(SPHERE_RADIUS - aaWidth, SPHERE_RADIUS + aaWidth, rClip);
        const alphaByte = Math.round(Math.max(0.0, Math.min(1.0, eAlpha)) * 255.0);
        if (alphaByte === 0) {
          continue;
        }

        active[idx] = 1;
        edgeAlphaByte[idx] = alphaByte;

        const scale = (rClip >= SPHERE_RADIUS)
          ? ((SPHERE_RADIUS - 0.0001) / Math.max(rClip, 0.0001))
          : 1.0;
        const rxyX = ndcX * scale;
        const rxyY = ndcY * scale;

        const rayLen = Math.hypot(rxyX, rxyY, -FOCAL);
        const rayDirX = rxyX / rayLen;
        const rayDirY = rxyY / rayLen;
        const rayDirZ = -FOCAL / rayLen;

        const b = CAM_Z * rayDirZ;
        const disc = Math.max(0.0, b * b - c);
        const t = -b - Math.sqrt(disc);

        const rawNx = t * rayDirX;
        const rawNy = t * rayDirY;
        const rawNz = CAM_Z + t * rayDirZ;
        const nLen = Math.hypot(rawNx, rawNy, rawNz);
        const nx = rawNx / nLen;
        const ny = rawNy / nLen;
        const nz = rawNz / nLen;

        const n1x = nx;
        const n1y = ny * COS_RX - nz * SIN_RX;
        const n1z = ny * SIN_RX + nz * COS_RX;

        const n2x = n1x * COS_RZ - n1y * SIN_RZ;
        const n2y = n1x * SIN_RZ + n1y * COS_RZ;
        const n2z = n1z;

        const theta = Math.acos(Math.max(-1.0, Math.min(1.0, n2y)));
        let phi = Math.atan2(n2z, -n2x);
        if (phi < 0.0) {
          phi += TWO_PI;
        }

        baseU[idx] = phi / TWO_PI;
        vCoord[idx] = 0.04 + 0.92 * (theta / PI);

        const ndotl = nx * SUN_DIR_X + ny * SUN_DIR_Y + nz * SUN_DIR_Z;
        const diff = Math.max(0.0, ndotl);
        const shadow = smoothstep(0.0, 0.10, ndotl);
        const irr = diff * shadow * 2.5 + 0.002;

        irrR[idx] = TINT_R * irr * SUN_COL_R;
        irrG[idx] = TINT_G * irr * SUN_COL_G;
        irrB[idx] = TINT_B * irr * SUN_COL_B;

        const ndotv = Math.max(0.0, -(nx * rayDirX + ny * rayDirY + nz * rayDirZ));
        const fresnel = Math.pow(1.0 - ndotv, 4.2);
        const sunMask = smoothstep(0.04, 0.45, ndotl);
        const atmosAlpha = fresnel * sunMask * 0.45;

        atmosR[idx] = ATMOS_COL_R * atmosAlpha;
        atmosG[idx] = ATMOS_COL_G * atmosAlpha;
        atmosB[idx] = ATMOS_COL_B * atmosAlpha;
      }
    }

    const grid = {
      size: dim,
      active: active,
      edgeAlphaByte: edgeAlphaByte,
      baseU: baseU,
      vCoord: vCoord,
      irrR: irrR,
      irrG: irrG,
      irrB: irrB,
      atmosR: atmosR,
      atmosG: atmosG,
      atmosB: atmosB
    };
    precomputedCache.set(dim, grid);
    return grid;
  }

  function fract(x) {
    return x - Math.floor(x);
  }

  function sampleTextureBilinear(texData, texW, texH, u, v, outRgb) {
    const uWrapped = fract(u);
    const vClamped = Math.max(0.0, Math.min(1.0, v));

    const gx = uWrapped * texW - 0.5;
    const gy = vClamped * texH - 0.5;

    const x0Floor = Math.floor(gx);
    const y0Floor = Math.floor(gy);
    const fx = gx - x0Floor;
    const fy = gy - y0Floor;

    const x0 = ((x0Floor % texW) + texW) % texW;
    const x1 = (x0 + 1) % texW;
    const y0 = Math.max(0, Math.min(texH - 1, y0Floor));
    const y1 = Math.max(0, Math.min(texH - 1, y0Floor + 1));

    const idx00 = (y0 * texW + x0) * 4;
    const idx10 = (y0 * texW + x1) * 4;
    const idx01 = (y1 * texW + x0) * 4;
    const idx11 = (y1 * texW + x1) * 4;

    const w00 = (1.0 - fx) * (1.0 - fy);
    const w10 = fx * (1.0 - fy);
    const w01 = (1.0 - fx) * fy;
    const w11 = fx * fy;

    outRgb[0] = (texData[idx00] * w00 + texData[idx10] * w10 + texData[idx01] * w01 + texData[idx11] * w11) / 255.0;
    outRgb[1] = (texData[idx00 + 1] * w00 + texData[idx10 + 1] * w10 + texData[idx01 + 1] * w01 + texData[idx11 + 1] * w11) / 255.0;
    outRgb[2] = (texData[idx00 + 2] * w00 + texData[idx10 + 2] * w10 + texData[idx01 + 2] * w01 + texData[idx11 + 2] * w11) / 255.0;
  }

  /**
   * Pure CPU pixel renderer matching sol12-mars-logo.js FRAGMENT_SHADER_SOURCE.
   * Writes non-premultiplied RGBA bytes (col in RGB, edgeAlpha in A).
   */
  function renderPixels(texData, texW, texH, rotationY, size, outBuffer) {
    const dim = Math.max(1, (size || DEFAULT_SPEC.faviconSize) | 0);
    const totalPixels = dim * dim;
    const out = outBuffer || new Uint8ClampedArray(totalPixels * 4);
    if (!texData || !texW || !texH) {
      return out;
    }

    const grid = getPrecomputedGrid(dim);
    const rotNorm = (Number(rotationY) || 0.0) / TWO_PI;
    const sampledRgb = [0.0, 0.0, 0.0];

    for (let i = 0; i < totalPixels; i++) {
      const p4 = i * 4;
      if (!grid.active[i]) {
        out[p4] = 0;
        out[p4 + 1] = 0;
        out[p4 + 2] = 0;
        out[p4 + 3] = 0;
        continue;
      }

      const u = fract(grid.baseU[i] - rotNorm);
      const v = grid.vCoord[i];
      sampleTextureBilinear(texData, texW, texH, u, v, sampledRgb);

      const linR = srgbToLinearScalar(sampledRgb[0]);
      const linG = srgbToLinearScalar(sampledRgb[1]);
      const linB = srgbToLinearScalar(sampledRgb[2]);

      const colLinR = linR * grid.irrR[i];
      const colLinG = linG * grid.irrG[i];
      const colLinB = linB * grid.irrB[i];

      const aces = acesFilmicToneMapping(colLinR, colLinG, colLinB);
      let srgbR = linearToSrgbScalar(aces[0]);
      let srgbG = linearToSrgbScalar(aces[1]);
      let srgbB = linearToSrgbScalar(aces[2]);

      srgbR = Math.min(1.0, srgbR + grid.atmosR[i]);
      srgbG = Math.min(1.0, srgbG + grid.atmosG[i]);
      srgbB = Math.min(1.0, srgbB + grid.atmosB[i]);

      out[p4] = Math.round(srgbR * 255.0);
      out[p4 + 1] = Math.round(srgbG * 255.0);
      out[p4 + 2] = Math.round(srgbB * 255.0);
      out[p4 + 3] = grid.edgeAlphaByte[i];
    }

    return out;
  }

  function resolveLogoSpec() {
    const logoGlobal = typeof globalThis !== 'undefined' && globalThis.Sol12MarsLogo && globalThis.Sol12MarsLogo.SPEC;
    if (logoGlobal) {
      return {
        textureUrl: logoGlobal.textureUrl || DEFAULT_SPEC.textureUrl,
        initialRotationYRad: Number.isFinite(logoGlobal.initialRotationYRad)
          ? logoGlobal.initialRotationYRad
          : DEFAULT_SPEC.initialRotationYRad,
        rotationPeriodSec: Number(logoGlobal.rotationPeriodSec) > 0
          ? Number(logoGlobal.rotationPeriodSec)
          : DEFAULT_SPEC.rotationPeriodSec
      };
    }
    return {
      textureUrl: DEFAULT_SPEC.textureUrl,
      initialRotationYRad: DEFAULT_SPEC.initialRotationYRad,
      rotationPeriodSec: DEFAULT_SPEC.rotationPeriodSec
    };
  }

  function resolveTextureUrl() {
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const logoEl = document.querySelector('[data-sol12-mars-logo][data-texture-src]');
      if (logoEl) {
        const attr = logoEl.getAttribute('data-texture-src');
        if (attr) return attr;
      }
    }
    if (typeof globalThis !== 'undefined' &&
        globalThis.Sol12MarsLogo &&
        globalThis.Sol12MarsLogo.SPEC &&
        globalThis.Sol12MarsLogo.SPEC.textureUrl) {
      return globalThis.Sol12MarsLogo.SPEC.textureUrl;
    }
    if (capturedScriptAttrs.textureSrc) {
      return capturedScriptAttrs.textureSrc;
    }
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const scriptEl = document.querySelector('script[src*="sol12-mars-favicon"][data-texture-src]');
      if (scriptEl) {
        const sAttr = scriptEl.getAttribute('data-texture-src');
        if (sAttr) return sAttr;
      }
    }
    return DEFAULT_SPEC.textureUrl;
  }

  function parseValidFramesConfig(patternAttr, countAttr) {
    if (typeof patternAttr !== 'string' || patternAttr.indexOf('{i}') === -1) {
      return null;
    }
    const rawCount = typeof countAttr === 'string' ? countAttr.trim() : String(countAttr || '').trim();
    if (!/^\d+$/.test(rawCount)) {
      return null;
    }
    const count = Number(rawCount);
    if (!Number.isInteger(count) || count < 2 || count > 1000) {
      return null;
    }
    return {
      pattern: patternAttr,
      count: count
    };
  }

  function resolveFramesConfig() {
    const fromCaptured = parseValidFramesConfig(capturedScriptAttrs.framesPattern, capturedScriptAttrs.framesCount);
    if (fromCaptured) {
      return fromCaptured;
    }
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const scriptEl = document.querySelector('script[data-frames-pattern][data-frames-count]');
      if (scriptEl) {
        const fromDom = parseValidFramesConfig(
          scriptEl.getAttribute('data-frames-pattern'),
          scriptEl.getAttribute('data-frames-count')
        );
        if (fromDom) {
          return fromDom;
        }
      }
    }
    return null;
  }

  function frameRotation(i, count) {
    const spec = resolveLogoSpec();
    const n = Math.max(1, Number(count) || 1);
    const idx = Number(i) || 0;
    return spec.initialRotationYRad + (TWO_PI * idx) / n;
  }

  function padFrameIndex(index) {
    const n = Math.max(0, index | 0);
    return String(n).padStart(3, '0');
  }

  function formatFrameUrl(pattern, index) {
    return String(pattern).replace('{i}', padFrameIndex(index));
  }

  function computeFrameIndex(currentRotationY, baseRotationY, count) {
    const norm = fract((currentRotationY - baseRotationY) / TWO_PI);
    const idx = Math.floor(norm * count);
    return Math.max(0, Math.min(count - 1, idx));
  }

  // Runtime state for browser favicon animation
  let isStarted = false;
  let isDestroyed = false;
  let isPaused = false;
  let isCspBlocked = false;
  let hasWarnedCsp = false;
  let timerId = null;

  let framesConfig = null;
  let activeIntervalMs = DEFAULT_SPEC.intervalMs;
  let lastFrameIndex = -1;
  let preloadImg = null;

  let texPixels = null;
  let texWidth = 0;
  let texHeight = 0;
  let isTextureLoaded = false;
  let isTextureLoading = false;

  let renderCanvas = null;
  let renderCtx = null;
  let renderImageData = null;

  let initialRotationY = DEFAULT_SPEC.initialRotationYRad;
  let rotationY = DEFAULT_SPEC.initialRotationYRad;
  let rotationSpeed = TWO_PI / DEFAULT_SPEC.rotationPeriodSec;
  let lastTickTime = 0;

  let motionQuery = null;
  let isReducedMotion = false;
  let isDocumentVisible = true;
  let listenersAttached = false;

  function warnCspOnce(reason) {
    if (hasWarnedCsp) return;
    hasWarnedCsp = true;
    try {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[sol12-mars-favicon] Animated favicon disabled by Content-Security-Policy (' + reason + '); keeping static favicon.');
      }
    } catch (_) {}
  }

  // Chromium prefers a scalable SVG icon over any PNG <link>, whatever the order,
  // so the static icons are switched off (rel renamed, markup untouched) only while
  // the animated favicon is active, and restored as soon as it stops.
  const SUSPENDED_REL_ATTR = 'data-sol12-suspended-rel';

  function suspendStaticIcons() {
    if (typeof document === 'undefined' || !document.head) return;
    try {
      const links = document.head.querySelectorAll('link[rel]');
      for (let i = 0; i < links.length; i++) {
        const l = links[i];
        if (l.id === 'sol12-animated-favicon') continue;
        const rel = String(l.getAttribute('rel') || '').toLowerCase().split(/\s+/);
        if (rel.indexOf('icon') === -1) continue;
        l.setAttribute(SUSPENDED_REL_ATTR, l.getAttribute('rel'));
        l.setAttribute('rel', 'sol12-suspended-icon');
      }
    } catch (_) {}
  }

  function restoreStaticIcons() {
    if (typeof document === 'undefined') return;
    try {
      const links = document.querySelectorAll('link[' + SUSPENDED_REL_ATTR + ']');
      for (let i = 0; i < links.length; i++) {
        links[i].setAttribute('rel', links[i].getAttribute(SUSPENDED_REL_ATTR));
        links[i].removeAttribute(SUSPENDED_REL_ATTR);
      }
    } catch (_) {}
  }

  function removeAnimatedLink() {
    lastFrameIndex = -1;
    if (typeof document === 'undefined') return;
    try {
      const link = document.getElementById('sol12-animated-favicon');
      if (link && link.parentNode) {
        link.parentNode.removeChild(link);
      }
    } catch (_) {}
    restoreStaticIcons();
  }

  function ensureAnimatedLink() {
    if (typeof document === 'undefined' || !document.head) return null;
    let link = document.getElementById('sol12-animated-favicon');
    if (!link) {
      link = document.createElement('link');
      link.id = 'sol12-animated-favicon';
      link.rel = 'icon';
      link.type = 'image/png';
      link.setAttribute('sizes', '32x32');
      document.head.appendChild(link);
    } else if (document.head.lastElementChild !== link) {
      document.head.appendChild(link);
    }
    suspendStaticIcons();
    return link;
  }

  function resolveStaticHref() {
    if (capturedScriptAttrs.staticSrc) {
      return capturedScriptAttrs.staticSrc;
    }
    if (typeof document === 'undefined') {
      return null;
    }
    try {
      if (typeof document.querySelector === 'function') {
        const scriptEl = document.querySelector('script[src*="sol12-mars-favicon"][data-static-src]') ||
          document.querySelector('script[src*="sol12-mars-favicon"]');
        if (scriptEl && typeof scriptEl.getAttribute === 'function') {
          const sAttr = scriptEl.getAttribute('data-static-src');
          if (sAttr) return sAttr;
        }
      }
      const staticEl = (typeof document.getElementById === 'function' && document.getElementById('sol12-static-favicon')) ||
        (typeof document.querySelector === 'function' && document.querySelector('#sol12-static-favicon'));
      if (staticEl && typeof staticEl.getAttribute === 'function') {
        const staticHref = staticEl.getAttribute('href');
        if (staticHref) return staticHref;
      }
      let links = (typeof document.querySelectorAll === 'function') ? document.querySelectorAll('link') : null;
      if ((!links || !links.length) && document.head) {
        if (typeof document.head.querySelectorAll === 'function') {
          links = document.head.querySelectorAll('link');
          if (!links || !links.length) {
            links = document.head.querySelectorAll('link[rel]');
          }
        }
        if ((!links || !links.length) && Array.isArray(document.head.children)) {
          links = document.head.children;
        }
      }
      if (links) {
        for (let i = 0; i < links.length; i++) {
          const l = links[i];
          if (!l || l.id === 'sol12-animated-favicon' || typeof l.getAttribute !== 'function') continue;
          const origRel = String(l.getAttribute(SUSPENDED_REL_ATTR) || l.getAttribute('rel') || '').toLowerCase();
          if (origRel.indexOf('icon') === -1 || origRel.indexOf('apple-touch-icon') !== -1) continue;
          const typeAttr = String(l.getAttribute('type') || '').toLowerCase();
          if (typeAttr !== 'image/png') continue;
          const href = l.getAttribute('href');
          if (href) return href;
        }
      }
    } catch (_) {}
    return null;
  }

  function showStaticFrame() {
    try {
      stopTimer();
      const staticHref = resolveStaticHref();
      if (staticHref) {
        const link = ensureAnimatedLink();
        if (link) {
          link.type = 'image/png';
          link.href = staticHref;
        }
        lastFrameIndex = -1;
      } else {
        removeAnimatedLink();
      }
    } catch (_) {}
  }

  function ensureRenderCanvas() {
    if (typeof document === 'undefined') return false;
    if (renderCanvas && renderCtx && renderImageData) return true;
    try {
      const size = DEFAULT_SPEC.faviconSize;
      renderCanvas = document.createElement('canvas');
      renderCanvas.width = size;
      renderCanvas.height = size;
      renderCtx = renderCanvas.getContext('2d');
      if (!renderCtx) return false;
      renderImageData = renderCtx.createImageData(size, size);
      return true;
    } catch (_) {
      return false;
    }
  }

  function renderFrameDataUrl(customRotationY) {
    if (!isTextureLoaded || !texPixels || !ensureRenderCanvas()) {
      return null;
    }
    const angle = Number.isFinite(customRotationY) ? customRotationY : rotationY;
    renderPixels(texPixels, texWidth, texHeight, angle, DEFAULT_SPEC.faviconSize, renderImageData.data);
    renderCtx.putImageData(renderImageData, 0, 0);
    try {
      return renderCanvas.toDataURL('image/png');
    } catch (_) {
      return null;
    }
  }

  function preloadNextFrame(cfg, nextIdx) {
    if (typeof Image === 'undefined' || isDestroyed) return;
    try {
      if (!preloadImg) {
        preloadImg = new Image();
        preloadImg.decoding = 'async';
      }
      preloadImg.src = formatFrameUrl(cfg.pattern, nextIdx);
    } catch (_) {}
  }

  function applyFaviconFrame() {
    if (isCspBlocked) return false;
    if (framesConfig !== null) {
      const link = ensureAnimatedLink();
      if (!link) return false;
      const idx = computeFrameIndex(rotationY, initialRotationY, framesConfig.count);
      if (idx !== lastFrameIndex || !link.getAttribute('href')) {
        link.href = formatFrameUrl(framesConfig.pattern, idx);
        lastFrameIndex = idx;
        preloadNextFrame(framesConfig, (idx + 1) % framesConfig.count);
      }
      return true;
    }
    if (!isTextureLoaded) return false;
    try {
      const dataUrl = renderFrameDataUrl(rotationY);
      if (!dataUrl) return false;
      const link = ensureAnimatedLink();
      if (!link) return false;
      link.href = dataUrl;
      return true;
    } catch (_) {
      isCspBlocked = true;
      warnCspOnce('toDataURL/href error');
      stopTimer();
      removeAnimatedLink();
      return false;
    }
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function canAnimateNow() {
    const isReady = framesConfig !== null ? true : isTextureLoaded;
    return (
      isStarted &&
      !isDestroyed &&
      !isPaused &&
      !isCspBlocked &&
      isReady &&
      isDocumentVisible &&
      !isReducedMotion
    );
  }

  function onIntervalTick() {
    if (!canAnimateNow()) {
      stopTimer();
      return;
    }
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    if (!lastTickTime) {
      lastTickTime = now;
    }
    const rawDtSec = Math.max(0.0, (now - lastTickTime) / 1000.0);
    lastTickTime = now;
    if (framesConfig !== null) {
      const stepSec = activeIntervalMs / 1000.0;
      const maxDtSec = Math.max(0.25, stepSec * 1.25);
      const effectiveDtSec = rawDtSec >= stepSec * 0.95
        ? Math.min(Math.max(rawDtSec, stepSec + 1e-6), maxDtSec)
        : Math.min(rawDtSec, 0.25);
      rotationY = initialRotationY + fract((rotationY - initialRotationY + effectiveDtSec * rotationSpeed) / TWO_PI) * TWO_PI;
    } else {
      const dtSec = Math.min(rawDtSec, 0.25);
      rotationY = (rotationY + dtSec * rotationSpeed) % TWO_PI;
    }
    applyFaviconFrame();
  }

  function syncLoopState() {
    if (canAnimateNow()) {
      if (timerId === null) {
        lastTickTime = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
        applyFaviconFrame();
        if (!isCspBlocked) {
          timerId = setInterval(onIntervalTick, activeIntervalMs);
        }
      }
    } else {
      stopTimer();
      const notReady = framesConfig === null && !isTextureLoaded;
      if (!isDocumentVisible && !isReducedMotion && !isCspBlocked && !isDestroyed && isStarted && !isPaused) {
        showStaticFrame();
      } else if (isReducedMotion || !isDocumentVisible || isCspBlocked || notReady || isPaused) {
        removeAnimatedLink();
      }
    }
  }

  function onVisibilityChange() {
    if (typeof document === 'undefined') return;
    isDocumentVisible = !document.hidden;
    syncLoopState();
  }

  function onPageHide() {
    isDocumentVisible = false;
    syncLoopState();
  }

  function onPageShow() {
    if (typeof document === 'undefined') return;
    isDocumentVisible = !document.hidden;
    syncLoopState();
  }

  function onMotionChange(event) {
    isReducedMotion = Boolean(event ? event.matches : (motionQuery && motionQuery.matches));
    syncLoopState();
  }

  function onSecurityPolicyViolation(event) {
    if (!event) return;
    const blockedUri = String(event.blockedURI || '').toLowerCase();
    const directive = String(event.violatedDirective || event.effectiveDirective || '').toLowerCase();
    // Only data: URIs concern this script (canvas mode). blob: violations come from
    // other page code (e.g. GLTFLoader textures) and must not disable the favicon.
    const isData = blockedUri === 'data' || blockedUri.indexOf('data:') === 0;
    const isImgDirective = directive.indexOf('img-src') !== -1 || directive.indexOf('default-src') !== -1;
    if (isData && isImgDirective) {
      isCspBlocked = true;
      warnCspOnce(directive || 'img-src');
      stopTimer();
      removeAnimatedLink();
    }
  }

  function attachListeners() {
    if (listenersAttached || typeof document === 'undefined') return;
    listenersAttached = true;

    isDocumentVisible = typeof document.hidden === 'boolean' ? !document.hidden : true;
    document.addEventListener('visibilitychange', onVisibilityChange, false);
    document.addEventListener('securitypolicyviolation', onSecurityPolicyViolation, false);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', onPageHide, false);
      window.addEventListener('pageshow', onPageShow, false);
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      isReducedMotion = Boolean(motionQuery && motionQuery.matches);
      if (motionQuery) {
        if (typeof motionQuery.addEventListener === 'function') {
          motionQuery.addEventListener('change', onMotionChange);
        } else if (typeof motionQuery.addListener === 'function') {
          motionQuery.addListener(onMotionChange);
        }
      }
    }
  }

  function detachListeners() {
    if (!listenersAttached || typeof document === 'undefined') return;
    listenersAttached = false;
    document.removeEventListener('visibilitychange', onVisibilityChange, false);
    document.removeEventListener('securitypolicyviolation', onSecurityPolicyViolation, false);
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pagehide', onPageHide, false);
      window.removeEventListener('pageshow', onPageShow, false);
    }
    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === 'function') {
        motionQuery.removeEventListener('change', onMotionChange);
      } else if (typeof motionQuery.removeListener === 'function') {
        motionQuery.removeListener(onMotionChange);
      }
      motionQuery = null;
    }
  }

  function loadTextureOnce() {
    if (isTextureLoaded || isTextureLoading || typeof Image === 'undefined' || typeof document === 'undefined') {
      return;
    }
    isTextureLoading = true;
    const spec = resolveLogoSpec();
    initialRotationY = spec.initialRotationYRad;
    rotationY = spec.initialRotationYRad;
    rotationSpeed = TWO_PI / Math.max(10.0, spec.rotationPeriodSec);

    const url = resolveTextureUrl();
    const img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      isTextureLoading = false;
      if (isDestroyed) return;
      try {
        const w = 512;
        const h = 256;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        texPixels = imgData.data;
        texWidth = w;
        texHeight = h;
        isTextureLoaded = true;
        syncLoopState();
      } catch (_) {
        isTextureLoaded = false;
      }
    };
    img.onerror = function () {
      isTextureLoading = false;
      isTextureLoaded = false;
      stopTimer();
      removeAnimatedLink();
    };
    img.src = url;
  }

  function start() {
    if (typeof document === 'undefined') return;
    isDestroyed = false;
    isStarted = true;
    isPaused = false;
    framesConfig = resolveFramesConfig();
    const spec = resolveLogoSpec();
    initialRotationY = spec.initialRotationYRad;
    const periodSec = Math.max(10.0, spec.rotationPeriodSec);
    rotationSpeed = TWO_PI / periodSec;

    if (framesConfig !== null) {
      activeIntervalMs = Math.max(20, Math.round((periodSec * 1000.0) / framesConfig.count));
      if (lastFrameIndex === -1) {
        rotationY = initialRotationY;
      }
      attachListeners();
      syncLoopState();
      return;
    }

    activeIntervalMs = DEFAULT_SPEC.intervalMs;
    attachListeners();
    if (!isTextureLoaded && !isTextureLoading) {
      loadTextureOnce();
    } else {
      syncLoopState();
    }
  }

  function stop() {
    isPaused = true;
    stopTimer();
    removeAnimatedLink();
  }

  function destroy() {
    isDestroyed = true;
    isStarted = false;
    isPaused = false;
    stopTimer();
    detachListeners();
    removeAnimatedLink();
  }

  function isAnimating() {
    return Boolean(timerId !== null && canAnimateNow());
  }

  if (typeof document !== 'undefined' && (typeof window === 'undefined' || window.SOL12_MARS_FAVICON_MANUAL_INIT !== true)) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        start();
      });
    } else {
      start();
    }
  }

  return {
    SPEC: DEFAULT_SPEC,
    start: start,
    stop: stop,
    destroy: destroy,
    isAnimating: isAnimating,
    showStaticFrame: showStaticFrame,
    resolveStaticHref: resolveStaticHref,
    frameRotation: frameRotation,
    renderFrameDataUrl: renderFrameDataUrl,
    renderPixels: renderPixels
  };
});
