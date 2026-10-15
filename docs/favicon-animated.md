# Animated Mars Favicon (`sol12-mars-favicon`)

This document describes the shared animated Mars favicon (`sol12-mars-favicon.js`) integrated across the four SOL12 repositories (`sol12-website`, `ifconfig.sol12.net`, `sol12_freedom`, `tor-monitor`).

---

## 1. Design & Operating Principle

`sol12-mars-favicon.js` renders an animated `32 × 32 px` favicon identical to the miniature header Mars logo (`sol12-mars-logo.js`), without reading the WebGL canvas or touching WebGL state:

1. **Exact CPU port of the fragment shader**: The `main()` function of `FRAGMENT_SHADER_SOURCE` in `sol12-mars-logo.js` is ported to pure 2D JavaScript (`createImageData(32, 32)`).
   - Identical optical and geometric constants: `SPHERE_RADIUS = 0.80`, `CAM_Z = 3.2075`, `FOCAL = 2.438104`, `SUN_DIR = (0.833219, 0.258585, 0.488439)`, axial tilt `Z = -25.2°` / `X = +0.14 rad`, `aaWidth = 2.0 / 64.0`.
   - Identical shading pipeline: bilinear texture sampling (`REPEAT` on `u`, `CLAMP` on `v`), `srgbToLinear` (`pow 2.2`), surface tint `(0.96, 0.92, 0.88)`, diffuse + soft terminator shadow (`× 2.5 + 0.002`), sun color `(1.0, 0.969, 0.933)`, ACES filmic tone mapping (`exposure = 1.08`), `linearToSrgb`, and Fresnel atmospheric limb haze (`pow 4.2`, `(0.96, 0.46, 0.24) * 0.45`).
   - All rotation-invariant pixel terms (disk coverage, surface normals, base spherical coordinates, irradiance, atmospheric haze) are precomputed once.
2. **Two operating modes in the shared script**:
   - **Canvas `data:` mode (~10 fps)**: Loads `assets/logo/mars_logo_512x256.jpg` once and exports `canvas.toDataURL('image/png')` every `100 ms` (`rotationPeriodSec = 75`, `initialRotationYRad = 0.05`, delta-time capped at `0.25 s`) to `<link id="sol12-animated-favicon" rel="icon" type="image/png" sizes="32x32">` appended last in `<head>`.
   - **Same-origin frames mode (`data-frames-pattern` + `data-frames-count`)**: Cycles through pre-rendered same-origin PNG frames (`150 PNG`, `2 frames/s` on `ifconfig.sol12.net`) without any `data:` URI.
3. **Pause & accessibility**:
   - Stops the timer and removes `#sol12-animated-favicon` when `document.hidden` is true (`visibilitychange`) or when `prefers-reduced-motion: reduce` is enabled (`matchMedia`).
   - Existing static `<link>` tags (`favicon.svg`, `favicon-32.png`, `favicon.ico`, `apple-touch-icon.png`) remain untouched as fallbacks.
4. **Public API**: `globalThis.Sol12MarsFavicon = { SPEC, start(), stop(), destroy(), isAnimating(), frameRotation(i, count), renderFrameDataUrl(rotationY), renderPixels(...) }`.

---

## 2. File Paths & Dockerfile (`sol12_freedom`)

| File | Purpose |
|---|---|
| `js/sol12-mars-favicon.js` | Shared UMD favicon script (byte-for-byte identical across all 4 repos) |
| `index.html`, `relays.html` | Adds `id="sol12-static-favicon"` on `favicon-32.png` and includes `js/sol12-mars-favicon.js?v=20261015` |
| `docs/screenshots/favicon-animated/` | Playwright Chromium proof screenshots (`chrome-frame-1..4.png`, `reduced-motion.png`) |

- **Dockerfile & FastAPI static mount**: `Dockerfile` already contains `COPY js/ /app/js/` and `backend/main.py` mounts `/js` via `StaticFiles`. No Dockerfile or backend allowlist changes are needed.
- **Note on `sol12-website`**: `sol12-website` has no `Dockerfile` on `main` (PR #1 `ops/docker-npm-publish` is frozen), so Administrator will copy `sol12-mars-favicon.js` manually to production for that site.

---

## 3. Content-Security-Policy (CSP) Behavior

- **`sol12_freedom`**, **`sol12-website`**, and **`tor-monitor`** allow `img-src 'self' data:` (in `sol12_freedom`: `img-src 'self' data: blob:`) and use the **canvas `data:` mode** (`~10 frames/s`).
- **`ifconfig.sol12.net`** enforces `img-src 'self' https://*.leak.sol12.net` (without `data:`) and uses the **same-origin frames mode** (`150 PNG` frames under `/static/favicon-frames/`, `2 frames/s`, identical rendering, compliant with `img-src 'self'`, CSP unchanged, zero CSP violations).

---

## 4. Browser Proofs

Playwright Chromium screenshots (devbox): `chrome-frame-1..4.png`, `reduced-motion.png`. Tab captures from real windowed browsers (Google Chrome and Firefox under Xvfb, production CSP reproduced): `tabs-chrome.png` and `tabs-firefox.png` (4 tab states 700 ms apart + zoomed icon).

## Browser integration details

- **Chromium and SVG favicons**: Chrome always prefers a `<link rel="icon" type="image/svg+xml">` over a PNG, whatever the order. While animating, the script temporarily renames the static icons' `rel` (`rel="sol12-suspended-icon"`, original value kept in `data-sol12-suspended-rel`) and restores it as soon as the animation stops (hidden tab, `prefers-reduced-motion`, CSP, `stop()`/`destroy()`). The served HTML is unchanged: without JavaScript, Safari and `apple-touch-icon` get the original static icons.
- **CSP**: only `img-src` violations on a `data:` URI stop the animation; `blob:` violations from other page scripts are ignored.
