#!/usr/bin/env python3
"""Generate the shared SOL12 Mars miniature logo assets from the 2K source map.

Outputs:
  - assets/logo/mars_logo_512x256.jpg (512x256 equirectangular texture, POT for WebGL1)
  - assets/logo/mars-logo-fallback.png (112x112 RGBA static fallback matching shader frame 0)
"""
from __future__ import annotations

import math
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE_TEXTURE = ROOT / "assets" / "mars_texture_2k.jpg"
OUT_DIR = ROOT / "assets" / "logo"
OUT_TEXTURE = OUT_DIR / "mars_logo_512x256.jpg"
OUT_FALLBACK = OUT_DIR / "mars-logo-fallback.png"

# Shared visual specification (must match js/sol12-mars-logo.js)
SPHERE_RADIUS = 0.80
CAM_Z = 3.2075
FOCAL = SPHERE_RADIUS * math.sqrt(CAM_Z * CAM_Z - 1.0)
SUN_VEC = (5.8, 1.8, 3.4)
TILT_Z_RAD = -25.2 * math.pi / 180.0
TILT_X_RAD = 0.14
INITIAL_ROTATION_Y = 0.05
EXPOSURE = 1.08


def srgb_to_linear(c: float) -> float:
    return max(0.0, c) ** 2.2


def linear_to_srgb(c: float) -> float:
    return max(0.0, min(1.0, c)) ** (1.0 / 2.2)


def smoothstep(e0: float, e1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def aces_filmic_threejs(r: float, g: float, b: float, exposure: float = EXPOSURE) -> tuple[float, float, float]:
    s = exposure / 0.6
    r, g, b = r * s, g * s, b * s
    ir = 0.59719 * r + 0.35458 * g + 0.04823 * b
    ig = 0.07600 * r + 0.90834 * g + 0.01566 * b
    ib = 0.02840 * r + 0.13383 * g + 0.83777 * b

    def rrt_odt(v: float) -> float:
        a = v * (v + 0.0245786) - 0.000090537
        b_ = v * (0.983729 * v + 0.4329510) + 0.238081
        return a / b_

    fr, fg, fb = rrt_odt(ir), rrt_odt(ig), rrt_odt(ib)
    or_ = 1.60475 * fr - 0.53108 * fg - 0.07367 * fb
    og = -0.10208 * fr + 1.10813 * fg - 0.00605 * fb
    ob = -0.00327 * fr - 0.07276 * fg + 1.07602 * fb
    return (
        max(0.0, min(1.0, or_)),
        max(0.0, min(1.0, og)),
        max(0.0, min(1.0, ob)),
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    src = Image.open(SOURCE_TEXTURE).convert("RGB")
    tex = src.resize((512, 256), Image.Resampling.LANCZOS)
    tex.save(OUT_TEXTURE, format="JPEG", quality=88, subsampling=0, optimize=True)

    width, height = 112, 112
    tex_w, tex_h = tex.size
    tex_px = tex.load()

    sx, sy, sz = SUN_VEC
    s_len = math.sqrt(sx * sx + sy * sy + sz * sz)
    sx, sy, sz = sx / s_len, sy / s_len, sz / s_len

    cos_rz, sin_rz = math.cos(-TILT_Z_RAD), math.sin(-TILT_Z_RAD)
    cos_rx, sin_rx = math.cos(-TILT_X_RAD), math.sin(-TILT_X_RAD)

    def sample_bilinear(u: float, v: float) -> list[float]:
        u = (u % 1.0) * (tex_w - 1)
        v = max(0.0, min(1.0, v)) * (tex_h - 1)
        x0 = int(math.floor(u))
        y0 = int(math.floor(v))
        x1 = (x0 + 1) % tex_w
        y1 = min(tex_h - 1, y0 + 1)
        fx = u - x0
        fy = v - y0
        c00 = tex_px[x0, y0]
        c10 = tex_px[x1, y0]
        c01 = tex_px[x0, y1]
        c11 = tex_px[x1, y1]
        out = []
        for i in range(3):
            v0 = c00[i] * (1.0 - fx) + c10[i] * fx
            v1 = c01[i] * (1.0 - fx) + c11[i] * fx
            out.append(srgb_to_linear((v0 * (1.0 - fy) + v1 * fy) / 255.0))
        return out

    out_img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    out_px = out_img.load()
    tint = (srgb_to_linear(0.96), srgb_to_linear(0.92), srgb_to_linear(0.88))
    sun_col = (1.0, srgb_to_linear(0.969), srgb_to_linear(0.933))
    atmos_col = (0.96, 0.46, 0.24)

    for py in range(height):
        for px in range(width):
            ndc_x = ((px + 0.5) / width) * 2.0 - 1.0
            ndc_y = 1.0 - ((py + 0.5) / height) * 2.0
            r_clip = math.sqrt(ndc_x * ndc_x + ndc_y * ndc_y)
            aa_width = 2.0 / width
            if r_clip > SPHERE_RADIUS + aa_width:
                continue
            edge_alpha = 1.0 - smoothstep(SPHERE_RADIUS - aa_width, SPHERE_RADIUS + aa_width, r_clip)

            scale = ((SPHERE_RADIUS - 1e-4) / max(r_clip, 1e-6)) if r_clip >= SPHERE_RADIUS else 1.0
            rx_clip = ndc_x * scale
            ry_clip = ndc_y * scale

            dx, dy, dz = rx_clip, ry_clip, -FOCAL
            d_len = math.sqrt(dx * dx + dy * dy + dz * dz)
            dx, dy, dz = dx / d_len, dy / d_len, dz / d_len

            b = CAM_Z * dz
            c = CAM_Z * CAM_Z - 1.0
            disc = max(0.0, b * b - c)
            t = -b - math.sqrt(disc)
            nx = t * dx
            ny = t * dy
            nz = CAM_Z + t * dz
            n_len = math.sqrt(nx * nx + ny * ny + nz * nz)
            nx, ny, nz = nx / n_len, ny / n_len, nz / n_len

            x1 = nx
            y1 = ny * cos_rx - nz * sin_rx
            z1 = ny * sin_rx + nz * cos_rx
            x2 = x1 * cos_rz - y1 * sin_rz
            y2 = x1 * sin_rz + y1 * cos_rz
            z2 = z1

            theta = math.acos(max(-1.0, min(1.0, y2)))
            phi = math.atan2(z2, -x2)
            if phi < 0.0:
                phi += 2.0 * math.pi
            u = (phi / (2.0 * math.pi) - INITIAL_ROTATION_Y / (2.0 * math.pi)) % 1.0
            v = 0.04 + 0.92 * (theta / math.pi)

            tex_rgb = sample_bilinear(u, v)
            albedo = [tex_rgb[i] * tint[i] for i in range(3)]

            ndotl = nx * sx + ny * sy + nz * sz
            diff = max(0.0, ndotl)
            shadow = smoothstep(0.0, 0.10, ndotl)
            irr = diff * shadow * 2.5 + 0.002

            col = [albedo[i] * irr * sun_col[i] for i in range(3)]
            tr, tg, tb = aces_filmic_threejs(col[0], col[1], col[2], EXPOSURE)
            col = [linear_to_srgb(tr), linear_to_srgb(tg), linear_to_srgb(tb)]

            vx, vy, vz = -dx, -dy, -dz
            ndotv = max(0.0, nx * vx + ny * vy + nz * vz)
            fresnel = (1.0 - ndotv) ** 4.2
            sun_mask = smoothstep(0.04, 0.45, ndotl)
            atmos_alpha = fresnel * sun_mask * 0.45

            for i in range(3):
                col[i] = min(1.0, col[i] + atmos_col[i] * atmos_alpha)

            out_px[px, py] = (
                int(round(col[0] * 255)),
                int(round(col[1] * 255)),
                int(round(col[2] * 255)),
                int(round(edge_alpha * 255)),
            )

    out_img.save(OUT_FALLBACK, format="PNG", optimize=True)
    print(f"Generated {OUT_TEXTURE.relative_to(ROOT)} ({OUT_TEXTURE.stat().st_size} bytes)")
    print(f"Generated {OUT_FALLBACK.relative_to(ROOT)} ({OUT_FALLBACK.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
