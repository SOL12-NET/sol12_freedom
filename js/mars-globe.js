/**
 * SOL12 - Photorealistic 3D Mars Globe with Orbiting Satellites (Phobos & Deimos)
 * SpaceX Aesthetic: Deep space black, soft shadow casting, solar eclipse simulation.
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', initMarsGlobe);

  function initMarsGlobe() {
    const container = document.getElementById('mars-canvas-container');
    const fallbackPic = document.getElementById('mars-fallback-image');

    if (!container || typeof THREE === 'undefined') {
      console.warn('[SOL12 3D] Three.js is not available or container missing.');
      return;
    }

    // WebGL capability check
    try {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
      if (!gl) {
        console.info('[SOL12 3D] WebGL not supported, keeping static fallback.');
        return;
      }
    } catch (e) {
      return;
    }

    // Create main 3D canvas
    const canvas = document.createElement('canvas');
    canvas.id = 'mars-canvas';
    canvas.className = 'w-full h-full block opacity-0 transition-opacity duration-1000';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1)';
    container.appendChild(canvas);

    // 1. Scene & Camera Setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1.22, 0.1, 1000);
    camera.position.set(0, 0, 8.5);
    camera.lookAt(0, 0, 0);

    // 2. High-Fidelity WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

    // 5. Load 3D Models for Phobos & Deimos using GLTFLoader
    if (typeof THREE.GLTFLoader !== 'undefined') {
      const gltfLoader = new THREE.GLTFLoader();

      // Phobos: Inner satellite
      gltfLoader.load(
        'assets/phobos.glb',
        function (gltf) {
          phobosMesh = gltf.scene;
          phobosMesh.scale.setScalar(0.0015);
          phobosMesh.traverse((child) => {
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
          orbitGroup.add(phobosMesh);
        },
        undefined,
        (err) => console.warn('[SOL12 3D] Note: Phobos model load notice:', err)
      );

      // Deimos: Outer satellite
      gltfLoader.load(
        'assets/deimos.glb',
        function (gltf) {
          deimosMesh = gltf.scene;
          deimosMesh.scale.setScalar(0.0015);
          deimosMesh.traverse((child) => {
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
          orbitGroup.add(deimosMesh);
        },
        undefined,
        (err) => console.warn('[SOL12 3D] Note: Deimos model load notice:', err)
      );
    }

    // 6. High-Resolution Mars Texture & Surface Mesh
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      'assets/mars_texture_2k.jpg',
      function (texture) {
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

        const marsMesh = new THREE.Mesh(marsGeo, marsMat);
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

        const atmosphereUniforms = {
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

        // Reveal canvas smoothly
        if (fallbackPic) {
          fallbackPic.style.display = 'none';
        }
        canvas.style.opacity = '1';

        // 8. Animation & Telemetry loop
        let isVisible = true;
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

        function animate() {
          requestAnimationFrame(animate);
          if (!isVisible) return;

          // Planetary rotation
          marsMesh.rotation.y += marsRotationSpeed;

          // Phobos orbit
          if (phobosMesh) {
            phobosAngle += phobosSpeed;
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

          // Deimos orbit
          if (deimosMesh) {
            deimosAngle += deimosSpeed;
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

          // Update atmosphere camera uniform
          atmosphereUniforms.camPos.value.copy(camera.position);

          renderer.render(scene, camera);
        }
        animate();

        // 0% CPU consumption when user scrolls away
        if ('IntersectionObserver' in window) {
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              isVisible = entry.isIntersecting;
            });
          }, { threshold: 0.05 });
          observer.observe(container);
        }

        // Dynamic resize listeners
        window.addEventListener('resize', handleResize);
        if (window.ResizeObserver) {
          const ro = new ResizeObserver(() => handleResize());
          ro.observe(container);
        }
      },
      undefined,
      function (err) {
        console.warn('[SOL12 3D] Fallback active due to texture loading notice:', err);
      }
    );
  }
})();
