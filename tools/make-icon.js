#!/usr/bin/env electron
// Render build/icon.png (1024×1024) from a pure-SVG source using Electron's
// bundled Chromium. No external deps. Run with `npm run icon`.

const { app, BrowserWindow } = require('electron');
const fs   = require('fs');
const path = require('path');

const SIZE = 1024;

// Brand glyph: a diamond (◆) in the app's accent orange over the noir
// background gradient. Mirrors the in-app logo and theme palette.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body {
    margin: 0; padding: 0; width: ${SIZE}px; height: ${SIZE}px;
    background: transparent;
    -webkit-font-smoothing: antialiased;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Inter, Helvetica, Arial, sans-serif;
  }
  .wrap {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(circle at 30% 20%, #2a1a30 0%, #11151f 45%, #050810 100%);
    border-radius: 22%;
    position: relative;
    overflow: hidden;
  }
  .wrap::before {
    /* subtle texture glow top-left */
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(circle at 25% 25%, rgba(240,138,95,.22), transparent 55%);
  }
  .wrap::after {
    /* lower-right cool glow */
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(circle at 80% 85%, rgba(126,182,255,.10), transparent 55%);
  }
  .glyph {
    position: relative; z-index: 2;
    font-size: 640px; line-height: 1;
    background: linear-gradient(135deg, #ffb78d 0%, #f08a5f 40%, #d96f3f 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 28px 60px rgba(0,0,0,.55))
            drop-shadow(0 0 36px rgba(240,138,95,.32));
  }
  .ring {
    position: absolute; inset: 8%;
    border: 6px solid rgba(240,138,95,.18);
    border-radius: 22%;
    z-index: 1;
  }
  .ring::before, .ring::after {
    content: ''; position: absolute;
    width: 18px; height: 18px;
    background: var(--accent);
    border-radius: 50%;
    background: radial-gradient(circle, #ffd9c2 0%, #f08a5f 60%, #c25a30 100%);
    box-shadow: 0 0 18px rgba(240,138,95,.7);
  }
  .ring::before { top: -10px; left: 50%; transform: translateX(-50%); }
  .ring::after  { bottom: -10px; right: 12%; }
</style></head><body>
  <div class="wrap">
    <div class="ring"></div>
    <div class="glyph">◆</div>
  </div>
</body></html>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: SIZE,
    height: SIZE,
    transparent: true,
    frame: false,
    resizable: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  // give the renderer a tick to settle (fonts, gradients, filters)
  await new Promise(r => setTimeout(r, 250));

  const image = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  console.log(`✔ Wrote ${out} (${(image.toPNG().length / 1024).toFixed(1)} KB)`);
  app.quit();
});
