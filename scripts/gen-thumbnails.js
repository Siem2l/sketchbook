// Generates public/sketches/<slug>/thumb.png for every real sketch by
// building the site, serving dist/ locally, and screenshotting each
// sketch page with Playwright. Run manually (`npm run thumbs`) and
// commit the resulting PNGs — this does NOT run as part of `build`.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readdirSync, statSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const sketchesDir = resolve(root, 'sketches');

const VIEWPORT = { width: 1200, height: 900 };
const SETTLE_MS = 1500;
const MAX_BYTES = 400 * 1024;
const MAX_WIDTH = 800;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function startStaticServer(dir) {
  const server = createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    let filePath = join(dir, urlPath);
    try {
      const stat = statSync(filePath);
      if (stat.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      // fall through to 404 below
    }
    try {
      const data = readFileSync(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolvePort) => {
    server.listen(0, '127.0.0.1', () => {
      resolvePort({ server, port: server.address().port });
    });
  });
}

async function main() {
  console.log('[thumbs] building site...');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });

  if (!existsSync(distDir)) {
    throw new Error('dist/ not found after build');
  }

  const slugs = readdirSync(sketchesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_template')
    .map((d) => d.name);

  const { server, port } = await startStaticServer(distDir);
  console.log(`[thumbs] serving dist/ on http://127.0.0.1:${port}`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

    for (const slug of slugs) {
      const url = `http://127.0.0.1:${port}/sketches/${slug}/`;
      console.log(`[thumbs] navigating to ${url}`);
      await page.goto(url, { waitUntil: 'load' });

      // Wait for the canvas to exist, then let the sketch settle
      // (data fetch + first render / animation) before capturing. Not every
      // sketch is canvas-based — festival-season is laid out in HTML — so a
      // missing canvas is a reason to shoot the page as-is, not to fail.
      await page.waitForSelector('canvas', { timeout: 15000 }).catch(() => {
        console.log(`[thumbs] ${slug}: no canvas, capturing the page as rendered`);
      });
      await page.waitForTimeout(SETTLE_MS);

      const outDir = resolve(root, 'public', 'sketches', slug);
      mkdirSync(outDir, { recursive: true });
      const outPath = resolve(outDir, 'thumb.png');

      let buffer = await page.screenshot({ type: 'png' });

      // Downscale if the full-viewport capture is larger than we want
      // to commit. Do the resize in-browser (canvas) so we don't need
      // an extra image-processing dependency.
      if (buffer.length > MAX_BYTES) {
        const base64In = buffer.toString('base64');
        const resizedBase64 = await page.evaluate(
          async ({ base64In, maxWidth }) => {
            const img = new Image();
            const loaded = new Promise((res, rej) => {
              img.onload = res;
              img.onerror = rej;
            });
            img.src = `data:image/png;base64,${base64In}`;
            await loaded;
            const scale = Math.min(1, maxWidth / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png').split(',')[1];
          },
          { base64In, maxWidth: MAX_WIDTH }
        );
        buffer = Buffer.from(resizedBase64, 'base64');
      }

      writeFileSync(outPath, buffer);
      console.log(`[thumbs] wrote ${outPath} (${buffer.length} bytes)`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('[thumbs] done.');
}

main().catch((err) => {
  console.error('[thumbs] failed:', err);
  process.exit(1);
});
