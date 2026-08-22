// Probe terrain heights around a POI in its local frame. Usage: node probe.mjs church 0
import { chromium } from 'playwright';
const [type = 'church', idx = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://localhost:5173', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 180000 });
const out = await page.evaluate(([type, idx]) => {
  const g = window.__game.game, T = g.terrain, p = g.limveld.poi(type, +idx);
  const local = (lx, lz) => ({ x: p.x + lx * Math.cos(p.yaw) + lz * Math.sin(p.yaw), z: p.z - lx * Math.sin(p.yaw) + lz * Math.cos(p.yaw) });
  const y0 = T.getHeight(p.x, p.z);
  const rows = [];
  for (let lz = -24; lz <= 30; lz += 3) {
    const row = [];
    for (let lx = -24; lx <= 24; lx += 3) { const w = local(lx, lz); row.push((T.getHeight(w.x, w.z) - y0).toFixed(2).padStart(6)); }
    rows.push(String(lz).padStart(4) + ' |' + row.join(''));
  }
  const fires = g.limveld.fires.map((f) => [f.x.toFixed(1), f.y.toFixed(1), f.z.toFixed(1)]);
  return { poi: { x: p.x, z: p.z, yaw: p.yaw, y: y0 }, header: '  lz |' + Array.from({ length: 17 }, (_, i) => String(-24 + i * 3).padStart(6)).join(''), rows, nFires: fires.length };
}, [type, idx]);
console.log(JSON.stringify(out.poi));
console.log(out.header);
for (const r of out.rows) console.log(r);
await browser.close();
