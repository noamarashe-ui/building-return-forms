// Copies the web app into www/ so Capacitor can bundle it into the APK (no service worker needed there).
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
const items = ['index.html', 'app.js', 'style.css', 'lib', 'fonts', 'icons'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });
for (const it of items) if (existsSync(it)) cpSync(it, `www/${it}`, { recursive: true });
console.log('www ready:', items.join(', '));
