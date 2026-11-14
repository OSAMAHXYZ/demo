# Report Sheet

Stock & Back Order Excel dashboard — separate from Delivery Hub.

## Open

- **Live Sales Report:** `report-sheet/index.html`
- **Admin Control:** `report-sheet/admin.html` (upload Excel + targets · Push to live)
- Hub links from repo root

## Flow

1. Open **Admin** → upload Excel (especially **Sales Raw**) → set monthly targets → **Push to live**
2. Open **Live Sales Report** — it builds automatically from the Admin Push
3. Push again from Admin anytime; keep the live tab open to see Ach% / Diff / sheets refresh

## Sales Report

- Builds when **Sales Raw Data** is pushed
- **Cancelled Back Orders** is optional (cancel % / gap columns stay at 0 until pushed)
- Other files (Back Order / RTL / Central) power the Stock & BO dashboard

## Notes

- Client-side only — files stay in the browser (IndexedDB + localStorage)
- Targets and workbooks are broadcast to the live tab on Push
- Sales formulas use Col **A** (name), **P** (proforma date), **V** (delivery date)

## Code layout (speed)

- `index.html` holds the markup only; the dashboard code lives in **`report-app.js`** (it used to be a 950 KB inline script, re-downloaded on every visit because HTML is `no-store`).
- Every `<script>` in `index.html` uses `defer`: the page paints first, scripts still run in the same order before `DOMContentLoaded`.
- After editing any JS/CSS file, change its `?v=` value in `index.html`.
- `server.js` gzip/brotli-compresses HTML/JS/CSS/JSON (about 5× smaller); Cache-Control rules are unchanged.
- Panel switch animation speed: `SPEED` at the top of `scroll-transition.js` (1 = original 3.2 s, 0.5 = 1.6 s).
