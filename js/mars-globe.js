/**
 * SOL12 - Photorealistic 3D Mars Globe with Orbiting Satellites (Phobos & Deimos)
 * SpaceX Aesthetic: Deep space black, soft shadow casting, solar eclipse simulation.
 *
 * Reveal from black (no static poster when JavaScript runs):
 *   - The container is pure black and the canvas is at opacity 0 from the initial CSS.
 *   - Explicit readiness (createRevealMachine): the Mars texture, Phobos and Deimos have all
 *     loaded, the scene has been compiled and rendered once while invisible, then the canvas
 *     fades in (4.5 s ease-in-out, CSS) on a following animation frame, once per scene init.
 *   - prefers-reduced-motion: reduce shows a single static frame, without fade or animation.
 *   - WebGL missing, a required resource failing, a load timeout or a context loss keep the
 *     area black (never a poster or a partial scene), log a "[SOL12 3D]" warning naming the
 *     cause, and retry the scene load a bounded number of times.
 *   - Listeners, observers, the animation loop and GPU resources are released on teardown.
 */

(function () {
  'use strict';

  // Reveal fade duration; must match the opacity transition in css/style.css.
  const REVEAL_FADE_MS = 4500;
  // A scene that is not ready after this delay is treated as failed (never revealed).
  const LOAD_TIMEOUT_MS = 30000;
  // Total scene load attempts (first load + bounded retries) and the delay between them.
  const MAX_LOAD_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 2000;

  /**
   * Pure reveal state machine for one scene initialisation.
   * States: 'loading' -> 'ready' -> 'revealed', and any state -> 'failed' (terminal).
   * 'ready' needs every required resource loaded AND the first frame rendered;
   * 'revealed' is only reachable from 'ready', at most once.
   */
  function createRevealMachine(requiredKeys) {
    const pending = new Set(requiredKeys);
    let state = 'loading';
    let failureReason = null;
    return {
      getState: () => state,
      getFailureReason: () => failureReason,
      getPendingKeys: () => Array.from(pending),
      resourceLoaded(key) {
        if (state === 'loading') pending.delete(key);
      },
      allResourcesLoaded: () => state !== 'failed' && pending.size === 0,
      firstFrameRendered() {
        if (state === 'loading' && pending.size === 0) state = 'ready';
        return state;
      },
      reveal() {
        if (state !== 'ready') return false;
        state = 'revealed';
        return true;
      },
      fail(reason) {
        if (state === 'failed') return false;
        state = 'failed';
        failureReason = String(reason);
        return true;
      }
    };
  }

  globalThis.SOL12MarsGlobeReveal = Object.freeze({
    createRevealMachine,
    REVEAL_FADE_MS,
    LOAD_TIMEOUT_MS,
    MAX_LOAD_ATTEMPTS
  });

  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', initMarsGlobe);

  function warn3D(message, detail) {
    if (detail !== undefined) console.warn('[SOL12 3D] ' + message, detail);
    else console.warn('[SOL12 3D] ' + message);
  }

  function isWebGLAvailable() {
    try {
      const testCanvas = document.createElement('canvas');
      return !!(testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl'));
    } catch (e) {
      return false;
    }
  }

  function initMarsGlobe() {
    const container = document.getElementById('mars-canvas-container');
    if (!container) return;

    // data-globe-mode drives the CSS: only 'webgl' makes the canvas visible (with the fade).
    function setMode(mode) {
      container.setAttribute('data-globe-mode', mode);
    }

    if (typeof THREE === 'undefined') {
      setMode('failed');
      warn3D('Three.js did not load (js/three.min.js); the globe area stays black.');
      return;
    }
    if (typeof THREE.GLTFLoader === 'undefined') {
      setMode('failed');
      warn3D('GLTFLoader did not load (js/GLTFLoader.js); the globe area stays black.');
      return;
    }
    if (!isWebGLAvailable()) {
      setMode('failed');
      warn3D('WebGL is not available in this browser; the globe area stays black.');
      return;
    }

    const reducedMotionQuery = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    let attempts = 0;
    let current = null; // teardown handle of the live scene attempt
    let retryTimer = null;

    function startAttempt() {
      retryTimer = null;
      attempts += 1;
      current = buildScene(container, {
        setMode,
        reducedMotionQuery,
        onFailure(reason) {
          if (current) current.destroy();
          current = null;
          setMode('failed');
          if (attempts < MAX_LOAD_ATTEMPTS) {
            warn3D(
              `Mars scene not shown (attempt ${attempts}/${MAX_LOAD_ATTEMPTS}): ${reason}. ` +
                `Retrying in ${RETRY_DELAY_MS} ms.`
            );
            retryTimer = setTimeout(startAttempt, RETRY_DELAY_MS);
          } else {
            warn3D(
              `Mars scene not shown (attempt ${attempts}/${MAX_LOAD_ATTEMPTS}): ${reason}. ` +
                'Giving up; area stays black.'
            );
          }
        }
      });
    }

    function teardown() {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (current) current.destroy();
      current = null;
      window.removeEventListener('pagehide', onPageHide);
    }
    function onPageHide(event) {
      if (!event.persisted) teardown();
    }
    window.addEventListener('pagehide', onPageHide);

    container._marsGlobe = {
      destroy: teardown,
      isRunning: () => !!(current && current.isRunning())
    };

    startAttempt();
  }

  /**
   * Build one scene attempt. Calls hooks.onFailure(reason) at most once and never reveals a
   * scene with a missing resource. Returns { destroy, isRunning }.
   */
  function buildScene(container, hooks) {
    const setMode = hooks.setMode;
    const reducedMotionQuery = hooks.reducedMotionQuery;
    const machine = createRevealMachine(['planet', 'phobos', 'deimos']);
    let destroyed = false;
    let rafId = null;
    let revealRafId = null;
    let isVisible = true;
    let marsMesh = null;
    let atmosphereUniforms = null;
    const cleanups = [];

    function fail(reason) {
      if (destroyed || !machine.fail(reason)) return;
      hooks.onFailure(reason);
    }

    setMode('loading');
    const loadTimeout = setTimeout(
      () => fail(`scene not ready after ${LOAD_TIMEOUT_MS} ms (pending: ${machine.getPendingKeys().join(', ')})`),
      LOAD_TIMEOUT_MS
    );
    cleanups.push(() => clearTimeout(loadTimeout));

    // Create main 3D canvas (hidden by css/style.css until data-globe-mode="webgl")
    const canvas = document.createElement('canvas');
    canvas.id = 'mars-canvas';
    canvas.className = 'w-full h-full block';
    container.appendChild(canvas);
    cleanups.push(() => canvas.remove());

    // 1. Scene & Camera Setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1.22, 0.1, 1000);
    camera.position.set(0, 0, 8.5);
    camera.lookAt(0, 0, 0);

    let renderer;
    try {
      // 2. High-Fidelity WebGL Renderer
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
      });
    } catch (err) {
      Promise.resolve().then(() => fail('WebGL renderer could not be created'));
      return { destroy: () => cleanups.splice(0).forEach((fn) => fn()), isRunning: () => false };
    }
    cleanups.push(() => {
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    if (renderer.toneMapping !== undefined) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
    }
    if (renderer.outputEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    // Responsive sizing
    function handleResize() {
      const width = container.clientWidth || 550;
      const height = container.clientHeight || 480;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
    handleResize();

    // 3. Lighting: Solar directional illumination + cosmic dark void
    const ambientLight = new THREE.AmbientLight(0x000000, 0.0);
    scene.add(ambientLight);

    const sunPosition = new THREE.Vector3(5.8, 1.8, 3.4);
    const sunLight = new THREE.DirectionalLight(0xfff7ee, 2.5);
    sunLight.position.copy(sunPosition);
    sunLight.castShadow = true;

    // Shadow camera tuned for Mars and satellite orbits
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 1.0;
    sunLight.shadow.camera.far = 18.0;
    sunLight.shadow.camera.left = -4.2;
    sunLight.shadow.camera.right = 4.2;
    sunLight.shadow.camera.top = 4.2;
    sunLight.shadow.camera.bottom = -4.2;
    sunLight.shadow.bias = -0.0001;
    sunLight.shadow.normalBias = 0.025;
    scene.add(sunLight);

    // 4. Mars Planetary Group with axial tilt
    const marsGroup = new THREE.Group();
    // Mars axial tilt is ~25.2°
    marsGroup.rotation.z = -25.2 * (Math.PI / 180);
    marsGroup.rotation.x = 0.14; // Mild tilt towards camera for superior 3D perspective
    scene.add(marsGroup);

    // Equatorial orbit plane for natural satellite trajectories
    const orbitGroup = new THREE.Group();
    marsGroup.add(orbitGroup);

    // Orbital constants
    const marsRadius = 2.65;
    const phobosRadius = 2.94; // Inner orbit
    const deimosRadius = 3.32; // Outer orbit

    let phobosMesh = null;
    let deimosMesh = null;
    let phobosAngle = 0.15;
    let deimosAngle = 3.20;

    function prepareSatellite(model) {
      model.scale.setScalar(0.0015);
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            child.material.roughness = 0.96;
            child.material.metalness = 0.04;
            if (child.material.color) {
              child.material.color.multiplyScalar(0.85);
              child.userData.baseColor = child.material.color.clone();
            }
          }
        }
      });
    }

    // 5. Load 3D Models for Phobos & Deimos (required: no reveal without both)
    const gltfLoader = new THREE.GLTFLoader();
    function loadSatellite(key, url, onModel) {
      gltfLoader.load(
        url,
        function (gltf) {
          if (destroyed) return;
          prepareSatellite(gltf.scene);
          orbitGroup.add(gltf.scene);
          onModel(gltf.scene);
          machine.resourceLoaded(key);
          finalizeIfComplete();
        },
        undefined,
        (err) => fail(`${key} model failed to load (${url}): ${(err && err.message) || err}`)
      );
    }
    loadSatellite('phobos', 'assets/phobos.glb', (m) => (phobosMesh = m));
    loadSatellite('deimos', 'assets/deimos.glb', (m) => (deimosMesh = m));

    // 6. High-Resolution Mars Texture & Surface Mesh
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      'assets/mars_texture_2k.jpg',
      function (texture) {
        if (destroyed) {
          texture.dispose();
          return;
        }
        texture.encoding = THREE.sRGBEncoding;
        if (renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }

        // Mars spherical surface
        const marsGeo = new THREE.SphereGeometry(marsRadius, 64, 64);
        const marsMat = new THREE.MeshStandardMaterial({
          map: texture,
          color: new THREE.Color(0.96, 0.92, 0.88),
          roughness: 0.95,
          metalness: 0.0
        });

        marsMesh = new THREE.Mesh(marsGeo, marsMat);
        marsMesh.castShadow = true;
        marsMesh.receiveShadow = true;
        marsGroup.add(marsMesh);

        // 7. Atmospheric Limb Shader (Tenuous Martian carbon-dioxide haze)
        const atmosphereVertexShader = `
          varying vec3 vWorldNormal;
          varying vec3 vWorldPosition;
          void main() {
            vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `;

        const atmosphereFragmentShader = `
          uniform vec3 sunPos;
          uniform vec3 camPos;
          varying vec3 vWorldNormal;
          varying vec3 vWorldPosition;

          void main() {
            vec3 viewDir = normalize(camPos - vWorldPosition);
            float fresnel = 1.0 - max(dot(vWorldNormal, viewDir), 0.0);
            fresnel = pow(fresnel, 4.2);

            vec3 sunDir = normalize(sunPos - vWorldPosition);
            float sunDot = dot(vWorldNormal, sunDir);
            float sunMask = smoothstep(0.04, 0.45, sunDot);

            float alpha = fresnel * sunMask * 0.45;
            if (alpha <= 0.001) discard;

            vec3 atmosColor = vec3(0.96, 0.46, 0.24);
            gl_FragColor = vec4(atmosColor, alpha);
          }
        `;

        atmosphereUniforms = {
          sunPos: { value: sunPosition },
          camPos: { value: camera.position }
        };

        const atmosphereMat = new THREE.ShaderMaterial({
          uniforms: atmosphereUniforms,
          vertexShader: atmosphereVertexShader,
          fragmentShader: atmosphereFragmentShader,
          blending: THREE.AdditiveBlending,
          side: THREE.FrontSide,
          transparent: true,
          depthWrite: false
        });

        const atmosphereMesh = new THREE.Mesh(
          new THREE.SphereGeometry(marsRadius * 1.008, 64, 64),
          atmosphereMat
        );
        marsGroup.add(atmosphereMesh);
        machine.resourceLoaded('planet');
        finalizeIfComplete();
      },
      undefined,
      (err) => fail(`planet texture failed to load (assets/mars_texture_2k.jpg): ${(err && err.type) || err}`)
    );

    // 8. Animation & Telemetry loop
    const marsRotationSpeed = 0.00018;
    const phobosSpeed = 0.0014;  // Fast prograde orbital speed
    const deimosSpeed = 0.00035; // Slower outer orbit

    const sunDir = sunPosition.clone().normalize();
    const moonWorldPos = new THREE.Vector3();

    // Shadow calculation when satellites are occulted by Mars
    function updateMoonShadow(mesh) {
      if (!mesh) return;
      mesh.getWorldPosition(moonWorldPos);
      const distAlongShadow = -moonWorldPos.dot(sunDir);
      let shadowFactor = 1.0;
      if (distAlongShadow > 0) {
        const perpDist = moonWorldPos.clone().addScaledVector(sunDir, distAlongShadow).length();
        shadowFactor = THREE.MathUtils.smoothstep(perpDist, marsRadius - 0.08, marsRadius + 0.12);
      }
      mesh.traverse((child) => {
        if (child.isMesh && child.material && child.userData.baseColor) {
          child.material.color.copy(child.userData.baseColor).multiplyScalar(shadowFactor);
        }
      });
    }

    // Live telemetry DOM elements
    const hudPhobosDeg = document.getElementById('hud-phobos-deg');
    const hudDeimosDeg = document.getElementById('hud-deimos-deg');
    const hudEclipseState = document.getElementById('hud-eclipse-state');

    function placeSatellites() {
      if (phobosMesh) {
        phobosMesh.position.set(
          Math.cos(phobosAngle) * phobosRadius,
          0,
          Math.sin(phobosAngle) * phobosRadius
        );
        phobosMesh.lookAt(0, 0, 0);
        updateMoonShadow(phobosMesh);

        if (hudPhobosDeg) {
          const deg = Math.round(((phobosAngle % (2 * Math.PI)) / (2 * Math.PI)) * 360);
          hudPhobosDeg.textContent = `${deg}°`;
        }
      }
      if (deimosMesh) {
        deimosMesh.position.set(
          Math.cos(deimosAngle) * deimosRadius,
          0,
          Math.sin(deimosAngle) * deimosRadius
        );
        deimosMesh.lookAt(0, 0, 0);
        updateMoonShadow(deimosMesh);

        if (hudDeimosDeg) {
          const deg = Math.round(((deimosAngle % (2 * Math.PI)) / (2 * Math.PI)) * 360);
          hudDeimosDeg.textContent = `${deg}°`;
        }
      }
    }

    function renderFrame() {
      // Update atmosphere camera uniform
      atmosphereUniforms.camPos.value.copy(camera.position);
      renderer.render(scene, camera);
    }

    function animate() {
      rafId = requestAnimationFrame(animate);
      if (!isVisible) return;

      // Planetary rotation and orbits (same per-frame increments as before)
      marsMesh.rotation.y += marsRotationSpeed;
      phobosAngle += phobosSpeed;
      deimosAngle += deimosSpeed;
      placeSatellites();
      renderFrame();
    }

    function motionReduced() {
      return !!(reducedMotionQuery && reducedMotionQuery.matches);
    }
    function startLoop() {
      if (rafId === null && !destroyed && !motionReduced()) {
        rafId = requestAnimationFrame(animate);
      }
    }
    function stopLoop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    }
    function cancelReveal() {
      if (revealRafId !== null) cancelAnimationFrame(revealRafId);
      revealRafId = null;
    }

    // Reveal two frames after the invisible first render, so the browser has painted the
    // opacity-0 state before the CSS transition starts.
    function scheduleReveal() {
      cancelReveal();
      revealRafId = requestAnimationFrame(() => {
        revealRafId = requestAnimationFrame(() => {
          revealRafId = null;
          if (destroyed) return;
          if (machine.reveal() || machine.getState() === 'revealed') setMode('webgl');
        });
      });
    }

    // Readiness signal: every required resource is in the scene; compile and render one
    // complete frame while the canvas is still invisible, then reveal on a following frame.
    function finalizeIfComplete() {
      if (destroyed || !machine.allResourcesLoaded()) return;
      handleResize();
      placeSatellites();
      try {
        renderer.compile(scene, camera);
        renderFrame();
      } catch (err) {
        fail(`first frame could not be rendered: ${(err && err.message) || err}`);
        return;
      }
      const gl = renderer.getContext();
      if (gl && gl.isContextLost && gl.isContextLost()) {
        fail('WebGL context lost before the first frame');
        return;
      }
      if (machine.firstFrameRendered() !== 'ready') return;
      clearTimeout(loadTimeout);
      setMode('ready');
      startLoop();
      scheduleReveal();
    }

    // WebGL context loss: hide the canvas (black area), stop rendering; restore re-renders.
    function onContextLost(event) {
      event.preventDefault();
      stopLoop();
      cancelReveal();
      setMode('lost');
      warn3D('WebGL context lost; the globe area stays black until the context is restored.');
    }
    function onContextRestored() {
      if (destroyed || machine.getState() !== 'revealed') return;
      handleResize();
      renderFrame();
      startLoop();
      scheduleReveal();
    }
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    cleanups.push(() => {
      canvas.removeEventListener('webglcontextlost', onContextLost, false);
      canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
    });

    // Reduced motion: keep a single static frame; resume the loop when motion is allowed.
    function onMotionChange() {
      if (machine.getState() !== 'revealed') return;
      if (motionReduced()) {
        stopLoop();
        renderFrame();
      } else {
        startLoop();
      }
    }
    if (reducedMotionQuery) {
      if (reducedMotionQuery.addEventListener) {
        reducedMotionQuery.addEventListener('change', onMotionChange);
        cleanups.push(() => reducedMotionQuery.removeEventListener('change', onMotionChange));
      } else if (reducedMotionQuery.addListener) {
        reducedMotionQuery.addListener(onMotionChange);
        cleanups.push(() => reducedMotionQuery.removeListener(onMotionChange));
      }
    }

    // 0% CPU consumption when user scrolls away
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          isVisible = entry.isIntersecting;
        });
      }, { threshold: 0.05 });
      observer.observe(container);
      cleanups.push(() => observer.disconnect());
    }

    // Dynamic resize listeners (a static frame is re-rendered when no loop is running)
    function onResize() {
      handleResize();
      if (rafId === null && machine.getState() === 'revealed') renderFrame();
    }
    window.addEventListener('resize', onResize);
    cleanups.push(() => window.removeEventListener('resize', onResize));
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => onResize());
      ro.observe(container);
      cleanups.push(() => ro.disconnect());
    }

    function disposeScene() {
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      });
    }

    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopLoop();
        cancelReveal();
        disposeScene();
        cleanups.splice(0).reverse().forEach((fn) => fn());
      },
      isRunning: () => rafId !== null
    };
  }
})();
