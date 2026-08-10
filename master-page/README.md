# Master Page

Responsive dashboard that displays the three **Vehicle Delivery Inspection Checklist** files (قائمة فحص السيارات وقت التسليم).

## Folder structure

```
demo/
├── master-page.html          ← shortcut entry (redirects here)
└── master-page/
    ├── index.html            ← Master Page UI
    ├── css/
    │   └── styles.css
    ├── js/
    │   └── app.js
    └── assets/
        ├── delivery_check_note.docx      ← Section A (Upload File 1)
        ├── delivery_check_note.pdf       ← Section B (Upload File 2)
        ├── delivery-check-note-form.png  ← Section C (Upload File 3)
        └── docx-embedded-preview.jpeg    ← extracted DOCX preview image
```

## Where to store uploaded files

| Section | Original location in repo | Place a copy in |
|---------|---------------------------|-----------------|
| **A** | `delivery_check_note.docx` | `master-page/assets/delivery_check_note.docx` |
| **B** | `delivery_check_note.pdf` | `master-page/assets/delivery_check_note.pdf` |
| **C** | `images/delivery-check-note-form.png` | `master-page/assets/delivery-check-note-form.png` |

Optional: if the DOCX is image-based, also keep `docx-embedded-preview.jpeg` in `assets/` (JPEG extracted from `word/media/` inside the DOCX).

## How to open

1. Serve the project root (or `master-page/`) over HTTP — required for PDF embed + `fetch` metadata.
2. Open either:
   - `http://localhost:<port>/master-page.html`
   - `http://localhost:<port>/master-page/`

With the existing Delivery Hub server:

```bash
node server.js
```

Then visit `/master-page.html`.

## Libraries required

**None.** Pure HTML5 + CSS3 + Vanilla JavaScript.

Optional (CDN only for fonts):

- [IBM Plex Sans Arabic](https://fonts.google.com/specimen/IBM+Plex+Sans+Arabic) + IBM Plex Mono via Google Fonts

## File roles

1. **DOCX** — editable Word template / API fallback  
2. **PDF** — preferred printable template (`generate-check-note`)  
3. **PNG** — agent on-screen preview + field overlay
