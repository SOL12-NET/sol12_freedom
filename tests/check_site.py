import os
import re
import sys

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print(f"Checking project at: {root}")
    
    html = ""
    for page in ("index.html", "relays.html"):
        with open(os.path.join(root, page), "r", encoding="utf-8") as f:
            html += f.read()

    css_path = os.path.join(root, "css", "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    fonts_path = os.path.join(root, "css", "fonts.css")
    with open(fonts_path, "r", encoding="utf-8") as f:
        fonts_css = f.read()

    mars_path = os.path.join(root, "js", "mars-globe.js")
    with open(mars_path, "r", encoding="utf-8") as f:
        mars_js = f.read()

    print("\n--- 1. Checking HTML links and media ---")
    matches = re.findall(r'(?:href|src)=["\']([^"\']+)["\']', html)
    errors = 0
    for m in matches:
        if m.startswith("http") or m.startswith("#") or m.startswith("mailto:"):
            continue
        rel = m.split("?")[0].replace("/", os.sep)
        full = os.path.join(root, rel)
        if os.path.exists(full):
            print(f"  [OK] {rel}")
        else:
            print(f"  [FAIL] Missing: {rel} ({full})")
            errors += 1

    print("\n--- 2. Checking Fonts referenced in fonts.css ---")
    font_matches = re.findall(r'url\(["\']?([^"\'\)]+)["\']?\)', fonts_css)
    for m in font_matches:
        rel = os.path.normpath(os.path.join("css", m)).replace("/", os.sep)
        full = os.path.join(root, rel)
        if os.path.exists(full):
            print(f"  [OK] Font: {rel}")
        else:
            print(f"  [FAIL] Missing Font: {rel}")
            errors += 1

    print("\n--- 3. Checking Assets referenced in mars-globe.js ---")
    asset_matches = re.findall(r'["\'](assets/[^"\']+)["\']', mars_js)
    for m in asset_matches:
        rel = m.replace("/", os.sep)
        full = os.path.join(root, rel)
        if os.path.exists(full):
            print(f"  [OK] 3D Asset: {rel}")
        else:
            print(f"  [FAIL] Missing 3D Asset: {rel}")
            errors += 1

    print(f"\nCompleted check with {errors} errors.")
    if errors > 0:
        sys.exit(1)
    print("SUCCESS: All assets, links, fonts and 3D files exist and are verified!")

if __name__ == "__main__":
    main()
