// Measures real-GPU fps by launching HEADED Chromium (briefly shows a window) at 1920x1080.
// Usage: node tools/fps-probe.mjs [url] [poses...]   → prints JSON {pose: fps}
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
function findChromium(){const cache=path.join(process.env.HOME||'','Library','Caches','ms-playwright');if(!fs.existsSync(cache))return undefined;const c=[];for(const d of fs.readdirSync(cache)){const m=/^chromium-(\d+)$/.exec(d);if(!m)continue;for(const sub of ['chrome-mac-arm64','chrome-mac']){const p=path.join(cache,d,sub,'Chromium.app','Contents','MacOS','Chromium');if(fs.existsSync(p))c.push({rev:+m[1],p});}}c.sort((a,b)=>b.rev-a.rev);return c[0]?.p;}

const url = process.argv[2] && process.argv[2].startsWith('http') ? process.argv[2] : 'http://localhost:5173';
const poses = process.argv.slice(2).filter((a) => !a.startsWith('http'));
const list = poses.length ? poses : ['vista', 'combat'];

const browser = await chromium.launch({
  headless: false,
  executablePath: findChromium(),
  args: ['--window-size=1920,1080', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-frame-rate-limit=false'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
await page.evaluate(() => window.__game.startExpedition && window.__game.startExpedition('Wylder'));
await page.waitForTimeout(1500);
const out = {};
for (const pose of list) {
  await page.evaluate((p) => window.__game.screenshotPose(p), pose);
  await page.waitForTimeout(1500); // settle
  // sample fps over 4s using rAF in-page
  out[pose] = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
          else res(Math.round((n / (performance.now() - t0)) * 1000));
        };
        requestAnimationFrame(tick);
      }),
  );
}
out.errors = errors.slice(0, 5);
console.log(JSON.stringify(out));
await browser.close();
