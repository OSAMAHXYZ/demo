# Master Page (standalone)

Independent static web app. **Not part of Delivery Hub** and not wired to any backend API.

## Structure

```
master-page.html              ← entry redirect into this folder
master-page/
├── index.html
├── css/styles.css
├── js/app.js
└── assets/
    ├── section-a.docx            ← Section A
    ├── section-a-preview.jpeg    ← DOCX embedded preview
    ├── section-b.pdf             ← Section B
    └── section-c.png             ← Section C
```

## Store uploaded files here

| Section | Put file at |
|---------|-------------|
| A | `master-page/assets/section-a.docx` |
| B | `master-page/assets/section-b.pdf` |
| C | `master-page/assets/section-c.png` |

Optional preview for image-based DOCX: `section-a-preview.jpeg`

## Run (any static server)

```bash
# from master-page/
npx --yes serve .
```

Or open `/master-page/` / `/master-page.html` from any local static host.

No Node app, no Delivery Hub server, and no shared libraries are required.

## Libraries

None (vanilla HTML / CSS / JS). Fonts optional via Google Fonts CDN.
