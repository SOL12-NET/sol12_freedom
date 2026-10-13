# SOL12 Shared Miniature Mars Logo (`sol12-mars-logo`)

This document specifies the shared miniature Mars logo component, its derived local assets, its attribution and generation procedure, and its integration across the three SOL12 repositories:

- `SOL12-NET/sol12_freedom` (`https://freedom.sol12.net/`)
- `SOL12-NET/tor-monitor` (`https://tor.sol12.net/`)
- `SOL12-NET/ifconfig.sol12.net` (`https://ifconfig.sol12.net/`)

---

## 1. Visual & Technical Specification

The miniature logo reproduces the visual appearance of Freedom's large 3D Mars (`js/mars-globe.js`) in a standalone, zero-dependency WebGL1 shader (`js/sol12-mars-logo.js`), without loading Three.js or satellite models.

| Parameter | Value | Description |
|---|---|---|
| Component version | `1.0.0` | Frozen on `Sol12MarsLogo.SPEC` |
| Desktop container size | `52 × 52 px` (`48–56 px` range) | Reserved in HTML/CSS to prevent layout shift (`CLS = 0`) |
| Mobile container size | `44 × 44 px` | Preserves a minimum `44 × 44 px` touch target on navigation links |
| Planet disk ratio | `0.80` (`SPHERE_RADIUS = 0.80`) | Planet occupies `~41.6 px` inside a `52 px` container (`36–44 px` target) |
| Camera distance | `CAM_Z = 3.2075` | Matches `8.5 / 2.65` perspective foreshortening from `js/mars-globe.js` |
| Directional sun vector | `normalize(5.8, 1.8, 3.4)` = `(0.833219, 0.258585, 0.488439)` | Upper-right-front illumination with stable day/night terminator on lower-left |
| Axial tilt | `Z = -25.2°`, `X = +0.14 rad` | Matches `marsGroup.rotation` in `js/mars-globe.js` |
| Surface shading | Matte (`roughness = 0.95`), tint `(0.96, 0.92, 0.88)`, sun `#fff7ee` (`2.5`) | Followed by Three.js `ACESFilmicToneMapping` (`exposure = 1.08`) and sunlit limb haze `(0.96, 0.46, 0.24)` |
| Initial longitude phase | `0.05 rad` | Displays Valles Marineris, Tharsis, and Acidalia Planitia at frame 0 |
| Rotation period | `75.0 s` per revolution (`60–90 s` target) | Smooth prograde rotation around the tilted planetary Y axis; lighting remains fixed |
| Frame rate & DPR | `28 fps` target, `maxDpr = 2` | Delta-time driven (`performance.now()`), independent of monitor refresh rate |
| Orbits & satellites | None | Omitted on the navigation icon to prioritize planetary legibility |

---

## 2. Assets & Checksums

All three repositories must bundle the exact same local asset files (no cross-domain hotlinking):

| File | Dimensions | Format | Size | SHA-256 |
|---|---|---|---|---|
| `assets/logo/mars_logo_512x256.jpg` | `512 × 256` | JPEG (Q88, 4:4:4, POT) | `43,198 B` | `540aae4e684a8d997fde688faf33cff60c43f51e1de6d7a8e8c243c1c5e1563f` |
| `assets/logo/mars-logo-fallback.png` | `112 × 112` | PNG (RGBA, 2× DPR) | `12,568 B` | `8fb1711988b4a9140c087fbf6d6a5ab91fd948487ac8e5ee2b017df8b89a6a88` |

### Attribution & License of the Source Texture

- **Source file**: `sol12_freedom/assets/mars_texture_2k.jpg` (`2048 × 1024` equirectangular Martian albedo map).
- **Origin & Attribution**: Solar System Scope / INOVE (`https://www.solarsystemscope.com/textures/`), reconstructed from NASA / USGS Astrogeology Viking Global Mosaic and Mars Global Surveyor (MGS) MOLA data.
- **License**: Creative Commons Attribution 4.0 International (**CC BY 4.0**) / NASA Public Domain planetary imagery.

### Deterministic Regeneration Procedure

Run `scripts/generate_mars_logo_assets.py` from the repository root with Pillow:

```bash
python3 scripts/generate_mars_logo_assets.py
```

The script performs two deterministic operations:
1. Downsamples `assets/mars_texture_2k.jpg` (`2048 × 1024`) to `assets/logo/mars_logo_512x256.jpg` (`512 × 256`, power-of-two dimensions for WebGL1 `gl.REPEAT` wrap support) using `Image.Resampling.LANCZOS`.
2. Renders `assets/logo/mars-logo-fallback.png` (`112 × 112` RGBA) at `INITIAL_ROTATION_Y = 0.05` using the exact same ray-casted sphere equation, lighting vector, axial tilt, and ACES filmic tone-mapping matrix as `js/sol12-mars-logo.js`.

---

## 3. Lifecycle, Accessibility & Resilience Guarantees

1. **Immediate static fallback in HTML**: The `<img>` pointing to `mars-logo-fallback.png` is present in the initial HTML markup with explicit `width` and `height`. If JavaScript is disabled, WebGL is unavailable, shader compilation fails, or texture loading fails, the static fallback image remains visible without layout shift.
2. **Brand link permanence**: The `<a class="nav-brand">` wrapper is never conditionally removed on error.
3. **WebGL context loss recovery**: The component listens for `webglcontextlost` (calling `event.preventDefault()`, pausing the loop, and revealing the static fallback image immediately) and `webglcontextrestored` (rebuilding the shader program, quad buffer, and texture).
4. **Reduced motion (`prefers-reduced-motion: reduce`)**: Checked on initialization and subscribed via `matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', ...)`. When reduced motion is active, a single static frame is rendered and the `requestAnimationFrame` loop is stopped.
5. **Zero background CPU/GPU waste**: Only one `requestAnimationFrame` loop can exist per mounted instance, and it automatically pauses when `document.hidden` is `true` (`visibilitychange`) or when the logo scrolls out of view (`IntersectionObserver`).
6. **Clean teardown (`destroy()`)**: Cancels any pending animation frame, disconnects `IntersectionObserver` and `ResizeObserver`, removes all event listeners, deletes the WebGL texture, vertex buffer, and program, and removes the overlay `<canvas>`.

---

## 4. Reuse Guide Across Repositories

### A. Static HTML (`sol12_freedom` and `ifconfig.sol12.net`)

```html
<a href="index.html" class="nav-brand" aria-label="SOL12 Home">
  <span class="sol12-mars-logo" id="logo-simulator" data-sol12-mars-logo data-texture-src="assets/logo/mars_logo_512x256.jpg?v=20261013" aria-hidden="true">
    <img
      src="assets/logo/mars-logo-fallback.png?v=20261013"
      alt=""
      width="52"
      height="52"
      class="sol12-mars-logo-fallback"
      decoding="async"
    >
  </span>
  <span class="brand-name">SOL<span class="brand-orange">12</span></span>
</a>
```

```css
.sol12-mars-logo {
  position: relative;
  width: 52px;
  height: 52px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  user-select: none;
}

.sol12-mars-logo-fallback,
.sol12-mars-logo-canvas {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  pointer-events: none;
}

@media (max-width: 768px) {
  .sol12-mars-logo {
    width: 44px;
    height: 44px;
  }
}
```

Include `<script src="js/sol12-mars-logo.js?v=20261013"></script>` (or adapt the static path prefix in `ifconfig`, e.g., `/static/sol12-mars-logo.js` and `data-texture-src="/static/logo/mars_logo_512x256.jpg"`).

### B. Vue 3 Adapter (`tor-monitor/frontend/src/components/Sol12Logo.vue`)

In `tor-monitor`, keep the `<a>` link unconditionally rendered (never gated by `v-if="!hasError"`), render the fallback `<img>` inside the logo container, and call `Sol12MarsLogo.mount(containerRef.value, { textureUrl })` in `onMounted` and `instance?.destroy()` in `onBeforeUnmount`.
