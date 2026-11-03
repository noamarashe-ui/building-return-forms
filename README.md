# Field signature forms

Offline-first PWA for filling building forms and collecting on-site signatures.

- Import buildings from Excel/CSV, fill the form, collect signatures, export a PDF per form, a CSV, and a ZIP.
- Works without a network connection after the first load (service worker + IndexedDB).
- The form text, logo and signer names come from a private JSON config that is loaded on the device and is **not** part of this repository.

Serve the folder over HTTPS (e.g. GitHub Pages) and open it in Chrome.
