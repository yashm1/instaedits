// Usage: node capture.mjs <targets.json> <outDir>
// targets.json = [{ key, url }]. For each URL: re-validate (SSRF guard), open it in Remotion's bundled headless Chrome,
// wait for it to settle, save a 1280x800 JPEG and the page metadata. One JSON line per target on stdout.
import {ensureBrowser, openBrowser} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import {assertPublicHttpUrl} from '../server/netguard.mjs';

const [targetsFile, outDir] = process.argv.slice(2);
const targets = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));
fs.mkdirSync(outDir, {recursive: true});
const emit = (o) => console.log(JSON.stringify(o));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`${what} timed out`)), ms))]);

await ensureBrowser();
const browser = await openBrowser('chrome', {chromiumOptions: {}, logLevel: 'error'});
try {
  for (const [i, t] of targets.entries()) {
    let page;
    try {
      await assertPublicHttpUrl(t.url); // again, right before navigating
      page = await browser.newPage({context: {indent: false, logLevel: 'error'}, logLevel: 'error', indent: false, pageIndex: i, onBrowserLog: null, onLog: () => {}});
      await page.setViewport({width: 1280, height: 800, deviceScaleFactor: 1});
      await withTimeout(page.goto({url: t.url, timeout: 15000}), 20000, 'navigation');
      await new Promise((r) => setTimeout(r, 1500)); // let fonts / hero animation settle
      const finalUrl = page.url();
      await assertPublicHttpUrl(finalUrl); // a redirect must not have taken us somewhere private
      const meta = await page.evaluate(() => ({
        title: document.title || '',
        description: document.querySelector('meta[name=description]')?.content || document.querySelector('meta[property="og:description"]')?.content || '',
        icon: document.querySelector('link[rel~=icon]')?.href || document.querySelector('link[rel="apple-touch-icon"]')?.href || '',
      }));
      const shot = await withTimeout(page._client().send('Page.captureScreenshot', {format: 'jpeg', quality: 80}), 10000, 'screenshot');
      const b64 = shot?.value?.data ?? shot?.data; // Remotion's CDP session wraps the reply as {value: {data}, size}
      if (typeof b64 !== 'string' || !b64) throw new Error('screenshot returned no data');
      const file = path.join(outDir, `${t.key}.jpg`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      emit({key: t.key, ok: true, file, finalUrl, ...meta});
    } catch (e) {
      emit({key: t.key, ok: false, error: String(e.message || e).slice(0, 200)});
    } finally { try { await page?.close(); } catch {} }
  }
} finally { await browser.close({silent: true}); }
