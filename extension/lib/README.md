# PDF.js Library Files for AutoFill AI

To adhere strictly to Chrome Web Store Manifest V3 policies, all executable scripts must be bundled inside the extension package (no remote CDN `<script>` tags are permitted).

## Quick Setup Instructions

Download the standard prebuilt PDF.js distribution (version 3.11.174 or 4.x) and place these two files into this folder (`extension/lib/`):

1. `pdf.min.js`
2. `pdf.worker.min.js`

### Option A: Using curl / wget in terminal
Run these commands from your extension folder:
```bash
curl -L -o lib/pdf.min.js "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
curl -L -o lib/pdf.worker.min.js "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
```

### Option B: Direct Browser Download
1. Open https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js -> Right click -> Save As `pdf.min.js` in `/lib`.
2. Open https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js -> Right click -> Save As `pdf.worker.min.js` in `/lib`.

Once added, the options page and popup can extract text completely offline and client-side without sending your raw document anywhere!
