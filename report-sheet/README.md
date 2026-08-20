# Report Sheet

Stock & Back Order Excel dashboard — separate from Delivery Hub.

## Open

- Local: open `report-sheet/index.html` in the browser  
- Hub link: from repo root → **Report Sheet** card  
- Direct path: `/report-sheet/`

## What’s inside

1. Upload Excel files (Back Order, RTL, Central, Sales Raw, Cancelled)
2. Admin Targets (employee monthly targets)
3. Sales Report (live Proforma / Delivery daily + monthly from Sales Raw Data)
4. Stock & BO dashboard panels

## Notes

- Client-side only — files stay in the browser  
- Targets are saved in `localStorage`  
- Sales formulas use Col **A** (name), **P** (proforma date), **V** (delivery date)
