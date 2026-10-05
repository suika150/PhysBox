#!/usr/bin/env node
// 内部減衰を入れた費用を測る。1条件＝1ページ。
//   node tools/measure-damp-cost.js
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const url = pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href;
  console.log(' damp │ 内部サブステップ │ ms/tick（simTick 300回の平均） │ 実測FPS');
  for (const damp of [0, 0.3, 0, 0.3]) {         // ★往復して測る（1回目は暖まっていない）
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#main-canvas');
    const r = await page.evaluate(async (damp) => {
      let s = 88172645463325252n;
      Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
        return Number(s & 0xffffffffn) / 4294967296; };
      demoWaveSuperposition();
      for (const S of slinkies) { S.damp = damp; S._sync(); }
      const S = slinkies[0], rem = remotes[0];
      const sub = Math.ceil((1 / SIM_HZ / Math.max(1, world.substeps)) / (S.dtMax * SLINKY_CFL));
      for (let t = 0; t < 180; t++) { rem._on = (t < 43); simTick(); }   // 波を入れて暖める
      const t0 = performance.now();
      for (let t = 0; t < 300; t++) simTick();
      const ms = (performance.now() - t0) / 300;
      // 実測FPS：描画も含めて 3秒ぶん回す
      simPlay();
      await new Promise(r => setTimeout(r, 3000));
      return { sub, ms, fps: typeof fps === 'number' ? fps : null };
    }, damp);
    await page.close();
    console.log(` ${String(damp).padStart(4)} │ ${String(r.sub).padStart(15)}`
      + ` │ ${r.ms.toFixed(3).padStart(29)} │ ${r.fps ?? '—'}`);
  }
  await browser.close();
})();
