# Report Sheet

Stock & Back Order Excel dashboard — separate from Delivery Hub.

## Open

- **Live Sales Report:** `report-sheet/index.html`
- **Admin Control:** `report-sheet/admin.html` (upload Excel + targets · Push to live)
- Hub links from repo root

## Flow

1. Open **Admin** → upload Excel (especially **Sales Raw** + **Cancelled BO**) → set monthly targets → **Push to live**
2. Open **Live Sales Report** — it builds automatically from the Admin Push
3. Push again from Admin anytime; keep the live tab open to see Ach% / Diff / sheets refresh

## Sales Report gate

Sales Report is generated only when **both** are pushed:

- Sales Raw Data
- Cancelled Back Orders

Other files (Back Order / RTL / Central) power the Stock & BO dashboard.

## Notes

- Client-side only — files stay in the browser (IndexedDB + localStorage)
- Targets and workbooks are broadcast to the live tab on Push
- Sales formulas use Col **A** (name), **P** (proforma date), **V** (delivery date)
