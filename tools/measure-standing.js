#!/usr/bin/env node
// 定常波デモ：内部減衰を入れると腹の育ち方がどう変わるかを測る（1条件＝1ページ）。
//   node tools/measure-standing.js [damp] [secs]
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const damp = Number(process.argv[2] ?? 0);
const secs = Number(process.argv[3] ?? 60);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const out = await page.evaluate(({ damp, secs }) => {
    let s = 88172645463325252n;
    Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
      return Number(s & 0xffffffffn) / 4294967296; };
    demoStandingWave();
    for (const S of slinkies) { S.damp = damp; S._sync(); }
    const A = slinkies[0];
    const disp = S => {
      const nd = S.nodes, N = nd.length, o = new Array(N);
      const x0 = nd[0].x, y0 = nd[0].y, x1 = nd[N-1].x, y1 = nd[N-1].y;
      const L = Math.hypot(x1-x0, y1-y0) || 1, ux = (x1-x0)/L, uy = (y1-y0)/L;
      for (let i = 0; i < N; i++) o[i] = -(nd[i].x-x0)*uy + (nd[i].y-y0)*ux;
      return o;
    };
    const series = [];
    let pk = 0, jag = 0, n = 0;
    const T = Math.round(secs * 60);
    for (let t = 0; t < T; t++) {
      simTick();
      const y = disp(A);
      let p = 0, j = 0;
      for (let i = 1; i < y.length - 1; i++) {
        p = Math.max(p, Math.abs(y[i]));
        j = Math.max(j, Math.abs(y[i] - (y[i-1] + y[i+1]) / 2));
      }
      pk += p; jag += j; n++;
      if ((t + 1) % 300 === 0) { series.push([ (t+1)/60, pk/n, jag/n ]); pk = 0; jag = 0; n = 0; }
    }
    return { series };
  }, { damp, secs });

  console.log(`定常波 damp=${damp}`);
  console.log('  秒 │ 腹の振れ幅(5秒平均) │ 折れの最大(5秒平均)');
  for (const [t, p, j] of out.series)
    console.log(`  ${String(t).padStart(2)} │ ${p.toFixed(1).padStart(7)} px        │ ${j.toFixed(2).padStart(5)} px`);
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,5).forEach(e => console.error(e)); }
})();
