# Rustlox UI

Frontend for the Rustlox Roblox launcher (Tauri 2 + vanilla HTML/CSS/JS).

## Files
- `index.html` - views, modal, play bar, launch overlay
- `styles.css` - dark product theme (single accent, 16:9 cards, featured banner)
- `main.js` - view routing, game cards, search, mods, settings, launch flow
- `assets/` - icons

## Dev preview
Serve the folder over HTTP (Tauri loads via `tauri://` in prod; `file://` is blocked):

```
npx serve . -l 8611
# or
python -m http.server 8611
```

Then open http://127.0.0.1:8611/

Note: the frontend talks to Tauri commands (`invoke(...)`). In a plain browser the `window.__TAURI__` global is missing - use the shim in `oc-tools` or mock it for UI-only work.
