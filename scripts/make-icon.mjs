// Renders build/icon.svg to build/icon.png (1024x1024) and copies the SVG to the web favicon.
// Run with `npm run icon` after editing build/icon.svg. Uses Electron's renderer, so no extra deps.
// electron-builder derives the .ico (Windows) and .icns (macOS) from build/icon.png.
import { app, BrowserWindow } from 'electron';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const svgPath = fileURLToPath(new URL('../build/icon.svg', import.meta.url));
const pngPath = fileURLToPath(new URL('../build/icon.png', import.meta.url));
const faviconPath = fileURLToPath(new URL('../web/public/favicon.svg', import.meta.url));

app.whenReady().then(async () => {
  try {
    const svg = await readFile(svgPath, 'utf8');
    const win = new BrowserWindow({ show: false });
    await win.loadURL('data:text/html,<html></html>');
    // Draw the SVG on a canvas in the page and read it back as a PNG data URL.
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ${SIZE};
        canvas.getContext('2d').drawImage(img, 0, 0, ${SIZE}, ${SIZE});
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not load build/icon.svg'));
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    })`);
    await writeFile(pngPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await copyFile(svgPath, faviconPath);
    console.log(`Wrote ${pngPath} and ${faviconPath}`);
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
