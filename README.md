# Field signature forms

Offline-first app for filling building forms and collecting on-site signatures.

- Web/PWA version: serve this folder over HTTPS (GitHub Pages).
- Android app: built by GitHub Actions (`.github/workflows/android.yml`); the APK is published under Releases → `latest`.
- Import buildings (and a `נמענים` recipients sheet) from Excel/CSV, collect signatures, get one PDF per form saved to `Documents/<folder>`, export CSV/ZIP, and open the email app with the PDFs attached (one email per site).
- The form text, logo, signer names and folder name come from a private JSON config that is loaded on the device and is **not** part of this repository.
- `android/app/fieldforms-debug.keystore` is a fixed test signing key so builds can update each other. Replace it with a private key before wider distribution.
