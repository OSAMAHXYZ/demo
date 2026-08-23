# Report Sheet

Stock & Back Order Excel dashboard — separate from Delivery Hub.

## Open

- **Live Sales Report:** `report-sheet/index.html`
- **Admin Targets:** `report-sheet/admin.html` (Push targets to live page)
- Hub links from repo root

## Flow

1. Open **Admin Targets** → set monthly targets → click **Push targets**
2. Open **Live Sales Report** → upload Excel (especially Sales Raw) → Build dashboard
3. When you Push again from Admin, the live page updates Ach% / Diff automatically (keep both tabs open)

## Notes

- Client-side only — files stay in the browser
- Targets are saved in `localStorage` and broadcast to the live tab
- Sales formulas use Col **A** (name), **P** (proforma date), **V** (delivery date)
