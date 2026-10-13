/**
 * SOL12 Shared Miniature Mars Logo (WebGL1 Ray-Casted Sphere + Static Fallback)
 * Reusable standalone component for Freedom, Tor Monitor, and ifconfig.
 * Version: 1.0.0
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.Sol12MarsLogo = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SPEC = Object.freeze({
    version: '1.0.0',
    textureUrl: 'assets/logo/mars_logo_512x256.jpg?v=20261013',
    fallbackUrl: 'assets/logo/mars-logo-fallback.png?v=20261013',
    sphereRadius: 0.80,
    cameraZ: 3.2075,
    sunDirection: Object.freeze([0.833219, 0.258585, 0.488439]),
    axialTiltZDeg: -25.2,
    axialTiltXRad: 0.14,
    initialRotationYRad: 0.05,
    rotationPeriodSec: 75.0,
    targetFps: 28,
    maxDpr: 2
  });

  const VERTEX_SHADER_SOURCE = [
    'attribute vec2 aPosition;',
    'varying vec2 vNdc;',
    'void main() {',
    '  vNdc = aPosition;',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n');

  const FRAGMENT_SHADER_SOURCE = [
    'precision highp float;',
    'varying vec2 vNdc;',
    'uniform sampler2D uTexture;',
    'uniform float uRotationY;',
    'uniform float uResolution;',
    '',
    'const float PI = 3.141592653589793;',
    'const float SPHERE_RADIUS = 0.80;',
    'const float CAM_Z = 3.2075;',
    'const float FOCAL = 2.438104;',
    'const vec3 SUN_DIR = vec3(0.833219, 0.258585, 0.488439);',
    'const float COS_RZ = 0.904827;',
    'const float SIN_RZ = 0.425779;',
    'const float COS_RX = 0.990216;',
    'const float SIN_RX = -0.139543;',
    '',
    'vec3 srgbToLinear(vec3 c) {',
    '  return pow(max(c, vec3(0.0)), vec3(2.2));',
    '}',
    '',
    'vec3 linearToSrgb(vec3 c) {',
    '  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));',
    '}',
    '',
    'vec3 rrtAndOdtFit(vec3 v) {',
    '  vec3 a = v * (v + 0.0245786) - 0.000090537;',
    '  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;',
    '  return a / b;',
    '}',
    '',
    'vec3 acesFilmicToneMapping(vec3 color) {',
    '  const mat3 ACESInputMat = mat3(',
    '    vec3(0.59719, 0.07600, 0.02840),',
    '    vec3(0.35458, 0.90834, 0.13383),',
    '    vec3(0.04823, 0.01566, 0.83777)',
    '  );',
    '  const mat3 ACESOutputMat = mat3(',
    '    vec3( 1.60475, -0.10208, -0.00327),',
    '    vec3(-0.53108,  1.10813, -0.07276),',
    '    vec3(-0.07367, -0.00605,  1.07602)',
    '  );',
    '  color *= 1.08 / 0.6;',
    '  color = ACESInputMat * color;',
    '  color = rrtAndOdtFit(color);',
    '  color = ACESOutputMat * color;',
    '  return clamp(color, 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '  float rClip = length(vNdc);',
    '  float aaWidth = 2.0 / max(uResolution, 64.0);',
    '  if (rClip > SPHERE_RADIUS + aaWidth) {',
    '    discard;',
    '  }',
    '  float edgeAlpha = 1.0 - smoothstep(SPHERE_RADIUS - aaWidth, SPHERE_RADIUS + aaWidth, rClip);',
    '',
    '  float scale = (rClip >= SPHERE_RADIUS) ? ((SPHERE_RADIUS - 0.0001) / max(rClip, 0.0001)) : 1.0;',
    '  vec2 rxy = vNdc * scale;',
    '',
    '  vec3 rayDir = normalize(vec3(rxy, -FOCAL));',
    '  float b = CAM_Z * rayDir.z;',
    '  float c = CAM_Z * CAM_Z - 1.0;',
    '  float disc = max(0.0, b * b - c);',
    '  float t = -b - sqrt(disc);',
    '  vec3 n = normalize(vec3(t * rayDir.x, t * rayDir.y, CAM_Z + t * rayDir.z));',
    '',
    '  vec3 n1 = vec3(',
    '    n.x,',
    '    n.y * COS_RX - n.z * SIN_RX,',
    '    n.y * SIN_RX + n.z * COS_RX',
    '  );',
    '  vec3 n2 = vec3(',
    '    n1.x * COS_RZ - n1.y * SIN_RZ,',
    '    n1.x * SIN_RZ + n1.y * COS_RZ,',
    '    n1.z',
    '  );',
    '',
    '  float theta = acos(clamp(n2.y, -1.0, 1.0));',
    '  float phi = atan(n2.z, -n2.x);',
    '  if (phi < 0.0) phi += 2.0 * PI;',
    '',
    '  float u = fract(phi / (2.0 * PI) - uRotationY / (2.0 * PI));',
    '  float v = 0.04 + 0.92 * (theta / PI);',
    '',
    '  vec3 texSrgb = texture2D(uTexture, vec2(u, v)).rgb;',
    '  vec3 albedo = srgbToLinear(texSrgb) * srgbToLinear(vec3(0.96, 0.92, 0.88));',
    '',
    '  float ndotl = dot(n, SUN_DIR);',
    '  float diff = max(0.0, ndotl);',
    '  float shadow = smoothstep(0.0, 0.10, ndotl);',
    '  float irr = diff * shadow * 2.5 + 0.002;',
    '',
    '  vec3 sunCol = srgbToLinear(vec3(1.0, 0.969, 0.933));',
    '  vec3 col = albedo * irr * sunCol;',
    '  col = linearToSrgb(acesFilmicToneMapping(col));',
    '',
    '  vec3 viewDir = -rayDir;',
    '  float ndotv = max(0.0, dot(n, viewDir));',
    '  float fresnel = pow(1.0 - ndotv, 4.2);',
    '  float sunMask = smoothstep(0.04, 0.45, ndotl);',
    '  float atmosAlpha = fresnel * sunMask * 0.45;',
    '  vec3 atmosCol = vec3(0.96, 0.46, 0.24);',
    '',
    '  col = min(vec3(1.0), col + atmosCol * atmosAlpha);',
    '  gl_FragColor = vec4(col * edgeAlpha, edgeAlpha);',
    '}'
  ].join('\n');

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vsSource, fsSource) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  function mount(container, options) {
    if (!container || typeof document === 'undefined') return null;
    if (container._sol12MarsLogo) {
      return container._sol12MarsLogo;
    }

    const opts = Object.assign({}, SPEC, options || {});
    const datasetTex = container.getAttribute && container.getAttribute('data-texture-src');
    const textureUrl = (options && options.textureUrl) || datasetTex || opts.textureUrl;
    const rotationSpeed = (2.0 * Math.PI) / Math.max(10.0, Number(opts.rotationPeriodSec) || SPEC.rotationPeriodSec);
    const frameIntervalMs = 1000.0 / Math.max(1, Math.min(60, Number(opts.targetFps) || SPEC.targetFps));
    const maxDpr = Math.max(1, Math.min(2, Number(opts.maxDpr) || SPEC.maxDpr));

    const fallbackImg = container.querySelector('.sol12-mars-logo-fallback, img');

    let canvas = null;
    let gl = null;
    let program = null;
    let quadBuffer = null;
    let texture = null;
    let uRotationYLoc = null;
    let uResolutionLoc = null;
    let uTextureLoc = null;
    let aPositionLoc = -1;

    let rafId = null;
    let isDestroyed = false;
    let isTextureReady = false;
    let isContextLost = false;
    let isDocumentVisible = typeof document.hidden === 'boolean' ? !document.hidden : true;
    let isInViewport = true;
    let isPausedManually = false;
    let isWebGLReady = false;

    let rotationY = Number.isFinite(opts.initialRotationYRad) ? opts.initialRotationYRad : SPEC.initialRotationYRad;
    let lastFrameTime = 0;
    let lastRenderTime = 0;
    let loadedImage = null;

    const motionQuery = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    let isReducedMotion = Boolean(motionQuery && motionQuery.matches);

    function showFallback() {
      isWebGLReady = false;
      if (canvas) {
        canvas.style.opacity = '0';
      }
      if (fallbackImg) {
        fallbackImg.style.opacity = '1';
        fallbackImg.style.visibility = 'visible';
      }
      container.setAttribute('data-logo-mode', 'fallback');
    }

    function showCanvas() {
      isWebGLReady = true;
      if (canvas) {
        canvas.style.opacity = '1';
      }
      if (fallbackImg) {
        fallbackImg.style.opacity = '0';
        fallbackImg.style.visibility = 'hidden';
      }
      container.setAttribute('data-logo-mode', 'webgl');
    }

    function releaseGlResources() {
      if (!gl) return;
      try {
        if (texture) {
          gl.deleteTexture(texture);
          texture = null;
        }
        if (quadBuffer) {
          gl.deleteBuffer(quadBuffer);
          quadBuffer = null;
        }
        if (program) {
          gl.deleteProgram(program);
          program = null;
        }
      } catch (_) {}
    }

    function syncSize() {
      if (!canvas || !gl || isContextLost) return 0;
      const rect = container.getBoundingClientRect();
      const cssW = Math.max(24, Math.round(rect.width || container.clientWidth || 52));
      const cssH = Math.max(24, Math.round(rect.height || container.clientHeight || 52));
      const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, maxDpr);
      const pxW = Math.round(cssW * dpr);
      const pxH = Math.round(cssH * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      return Math.min(canvas.width, canvas.height);
    }

    function renderFrame() {
      if (isDestroyed || !gl || !program || !isTextureReady || isContextLost) return false;
      const minDim = syncSize();
      if (!minDim) return false;

      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(aPositionLoc);
      gl.vertexAttribPointer(aPositionLoc, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (uTextureLoc !== null) gl.uniform1i(uTextureLoc, 0);
      if (uRotationYLoc !== null) gl.uniform1f(uRotationYLoc, rotationY);
      if (uResolutionLoc !== null) gl.uniform1f(uResolutionLoc, minDim);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    }

    function shouldAnimate() {
      return (
        !isDestroyed &&
        isTextureReady &&
        !isContextLost &&
        isDocumentVisible &&
        isInViewport &&
        !isReducedMotion &&
        !isPausedManually
      );
    }

    function tick(now) {
      rafId = null;
      if (!shouldAnimate()) return;

      if (!lastFrameTime) {
        lastFrameTime = now;
        lastRenderTime = now;
      }

      const elapsedSinceRender = now - lastRenderTime;
      if (elapsedSinceRender >= frameIntervalMs) {
        const dtSec = Math.min(Math.max(0.0, (now - lastFrameTime) / 1000.0), 0.25);
        lastFrameTime = now;
        lastRenderTime = now;
        rotationY = (rotationY + dtSec * rotationSpeed) % (2.0 * Math.PI);
        renderFrame();
      }

      rafId = requestAnimationFrame(tick);
    }

    function updateLoopState() {
      if (shouldAnimate()) {
        if (rafId === null) {
          lastFrameTime = 0;
          lastRenderTime = 0;
          rafId = requestAnimationFrame(tick);
        }
      } else if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    function initGlPipeline() {
      if (!gl) return false;
      releaseGlResources();

      program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
      if (!program) return false;

      aPositionLoc = gl.getAttribLocation(program, 'aPosition');
      uRotationYLoc = gl.getUniformLocation(program, 'uRotationY');
      uResolutionLoc = gl.getUniformLocation(program, 'uResolution');
      uTextureLoc = gl.getUniformLocation(program, 'uTexture');
      if (aPositionLoc < 0) {
        releaseGlResources();
        return false;
      }

      quadBuffer = gl.createBuffer();
      if (!quadBuffer) {
        releaseGlResources();
        return false;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0]),
        gl.STATIC_DRAW
      );

      if (loadedImage) {
        return uploadTexture(loadedImage);
      }
      return true;
    }

    function uploadTexture(img) {
      if (!gl || !program || isContextLost) return false;
      try {
        if (texture) {
          gl.deleteTexture(texture);
        }
        texture = gl.createTexture();
        if (!texture) return false;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        isTextureReady = true;
        if (renderFrame()) {
          showCanvas();
          updateLoopState();
          return true;
        }
      } catch (_) {}
      isTextureReady = false;
      showFallback();
      return false;
    }

    // Create overlay canvas inside container
    canvas = document.createElement('canvas');
    canvas.className = 'sol12-mars-logo-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none';
    canvas.style.opacity = '0';

    try {
      const glAttrs = {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power'
      };
      gl = canvas.getContext('webgl', glAttrs) || canvas.getContext('experimental-webgl', glAttrs);
    } catch (_) {
      gl = null;
    }

    if (!gl || !initGlPipeline()) {
      showFallback();
      const fallbackInstance = {
        destroy: function () {
          isDestroyed = true;
          delete container._sol12MarsLogo;
        },
        pause: function () {},
        resume: function () {},
        isWebGLActive: function () { return false; }
      };
      container._sol12MarsLogo = fallbackInstance;
      return fallbackInstance;
    }

    container.appendChild(canvas);

    function onContextLost(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      isContextLost = true;
      isTextureReady = false;
      updateLoopState();
      showFallback();
    }

    function onContextRestored() {
      if (isDestroyed) return;
      isContextLost = false;
      if (!initGlPipeline()) {
        showFallback();
      }
    }

    function onVisibilityChange() {
      isDocumentVisible = !document.hidden;
      updateLoopState();
    }

    function onMotionChange(event) {
      isReducedMotion = Boolean(event ? event.matches : (motionQuery && motionQuery.matches));
      if (isReducedMotion && isTextureReady && !isContextLost) {
        renderFrame();
      }
      updateLoopState();
    }

    function onResize() {
      if (isTextureReady && !isContextLost) {
        renderFrame();
      }
    }

    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    document.addEventListener('visibilitychange', onVisibilityChange, false);

    if (motionQuery) {
      if (typeof motionQuery.addEventListener === 'function') {
        motionQuery.addEventListener('change', onMotionChange);
      } else if (typeof motionQuery.addListener === 'function') {
        motionQuery.addListener(onMotionChange);
      }
    }

    let intersectionObserver = null;
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver(function (entries) {
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].target === container) {
            isInViewport = entries[i].isIntersecting;
          }
        }
        updateLoopState();
      }, { threshold: 0.01 });
      intersectionObserver.observe(container);
    }

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(container);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize, false);
    }

    // Load texture asynchronously; keep static fallback visible until ready
    const img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      if (isDestroyed) return;
      loadedImage = img;
      uploadTexture(img);
    };
    img.onerror = function () {
      if (isDestroyed) return;
      isTextureReady = false;
      updateLoopState();
      showFallback();
    };
    img.src = textureUrl;

    const instance = {
      destroy: function () {
        if (isDestroyed) return;
        isDestroyed = true;
        updateLoopState();
        if (intersectionObserver) {
          intersectionObserver.disconnect();
          intersectionObserver = null;
        }
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        } else if (typeof window !== 'undefined') {
          window.removeEventListener('resize', onResize, false);
        }
        document.removeEventListener('visibilitychange', onVisibilityChange, false);
        if (motionQuery) {
          if (typeof motionQuery.removeEventListener === 'function') {
            motionQuery.removeEventListener('change', onMotionChange);
          } else if (typeof motionQuery.removeListener === 'function') {
            motionQuery.removeListener(onMotionChange);
          }
        }
        if (canvas) {
          canvas.removeEventListener('webglcontextlost', onContextLost, false);
          canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
        }
        releaseGlResources();
        if (canvas && canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
        canvas = null;
        gl = null;
        showFallback();
        delete container._sol12MarsLogo;
      },
      pause: function () {
        isPausedManually = true;
        updateLoopState();
      },
      resume: function () {
        isPausedManually = false;
        updateLoopState();
      },
      isWebGLActive: function () {
        return Boolean(isWebGLReady && isTextureReady && !isContextLost && !isDestroyed);
      }
    };

    container._sol12MarsLogo = instance;
    return instance;
  }

  function initAll(rootOrSelector, options) {
    if (typeof document === 'undefined') return [];
    let elements = [];
    if (!rootOrSelector) {
      elements = Array.from(document.querySelectorAll('[data-sol12-mars-logo]'));
    } else if (typeof rootOrSelector === 'string') {
      elements = Array.from(document.querySelectorAll(rootOrSelector));
    } else if (rootOrSelector.querySelectorAll) {
      if (rootOrSelector.hasAttribute && rootOrSelector.hasAttribute('data-sol12-mars-logo')) {
        elements = [rootOrSelector];
      } else {
        elements = Array.from(rootOrSelector.querySelectorAll('[data-sol12-mars-logo]'));
      }
    }
    return elements.map(function (el) {
      return mount(el, options);
    }).filter(Boolean);
  }

  if (typeof document !== 'undefined' && (typeof window === 'undefined' || !window.SOL12_MARS_LOGO_MANUAL_INIT)) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        initAll();
      });
    } else {
      initAll();
    }
  }

  return {
    SPEC: SPEC,
    mount: mount,
    initAll: initAll
  };
});
