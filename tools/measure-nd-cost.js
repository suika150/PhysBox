#!/usr/bin/env node
// 節点密度を上げたときの費用（内部サブステップ数と 1tick の実時間）を測る。
//   node tools/measure-nd-cost.js
// ★合成波デモの媒質（自然長 5.33m）で測る。セグメント数は SLINKY_SEG_MAX=200 で頭打ち。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const url = pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href;
  console.log(' 密度 │ セグメント │ 内部サブステップ │ ms/tick │ 60fps に対する余裕');
  for (const nd of [10, 20, 37, 60, 120]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#main-canvas');
    const r = await page.evaluate((nd) => {
      let s = 88172645463325252n;
      Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
        return Number(s & 0xffffffffn) / 4294967296; };
      demoWaveSuperposition();
      for (const S of slinkies) { S.nodeDensity = nd; S.rebuild(); S._sync(); }
      const S = slinkies[0], rem = remotes[0];
      const sub = Math.ceil((1 / SIM_HZ / Math.max(1, world.substeps)) / (S.dtMax * SLINKY_CFL));
      for (let t = 0; t < 120; t++) { rem._on = (t < 43); simTick(); }   // 山を入れてから測る
      const t0 = performance.now();
      for (let t = 0; t < 180; t++) simTick();
      const ms = (performance.now() - t0) / 180;
      return { segs: S.nodes.length - 1, sub, ms };
    }, nd);
    await page.close();
    console.log(` ${String(nd).padStart(4)} │ ${String(r.segs).padStart(9)}`
      + ` │ ${String(r.sub).padStart(15)} │ ${r.ms.toFixed(2).padStart(7)}`
      + ` │ ${(16.7 / r.ms).toFixed(1)}倍`);
  }
  await browser.close();
})();
