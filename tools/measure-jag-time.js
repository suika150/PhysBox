#!/usr/bin/env node
// 合成波デモのがたつきが「時間とともに育つか」を測る（1条件＝1ページ）。
//   node tools/measure-jag-time.js [damp] [nd] [secs] [押す tick 数]
//   ★押す tick 数を増やすと山が続けて出る＝波の列（デモ本文の「押し続けると波の列になる」）。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const damp = Number(process.argv[2] ?? 0);
const nd   = Number(process.argv[3] ?? 20);
const secs = Number(process.argv[4] ?? 60);
const press = Number(process.argv[5] ?? 43);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const out = await page.evaluate(async ({ damp, nd, secs, press }) => {
    let s = 88172645463325252n;
    Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
      return Number(s & 0xffffffffn) / 4294967296; };
    demoWaveSuperposition();
    for (const S of slinkies) {
      S.damp = damp;
      if (nd !== S.nodeDensity) { S.nodeDensity = nd; S.rebuild(); }
      S._sync();
    }
    const rem = remotes[0], A = slinkies[0];
    const disp = S => {
      const ndv = S.nodes, N = ndv.length, o = new Array(N);
      const x0 = ndv[0].x, y0 = ndv[0].y, x1 = ndv[N-1].x, y1 = ndv[N-1].y;
      const L = Math.hypot(x1-x0, y1-y0) || 1, ux = (x1-x0)/L, uy = (y1-y0)/L;
      for (let i = 0; i < N; i++) o[i] = -(ndv[i].x-x0)*uy + (ndv[i].y-y0)*ux;
      return o;
    };
    const spec = S => {
      const y = disp(S), M = y.length - 1;
      let lo = 0, hi = 0;
      for (let n = 1; n < M; n++) {
        let a = 0;
        for (let i = 1; i < M; i++) a += y[i] * Math.sin(Math.PI * n * i / M);
        a *= 2 / M;
        if (n > M / 4) hi += a*a; else lo += a*a;
      }
      return { hi: Math.sqrt(hi/2), lo: Math.sqrt(lo/2) };
    };
    // 1秒ごとに、その1秒間（10tickおき6標本）の時間平均を積む
    const series = [];
    const T = Math.round(secs * 60);
    let hiAcc = 0, loAcc = 0, nAcc = 0;
    for (let t = 0; t < T; t++) {
      rem._on = (t < press);
      simTick();
      if (t % 10 === 0) { const q = spec(A); hiAcc += q.hi; loAcc += q.lo; nAcc++; }
      if ((t + 1) % 60 === 0) {
        series.push([ (t+1)/60, hiAcc/nAcc, loAcc/nAcc ]);
        hiAcc = 0; loAcc = 0; nAcc = 0;
      }
    }
    // 最後の瞬間の、隣り合う節点どうしの折れ角（画面のギザギザの見え方に近い）
    const y = disp(A);
    let jagPk = 0;
    for (let i = 1; i < y.length - 1; i++)
      jagPk = Math.max(jagPk, Math.abs(y[i] - (y[i-1] + y[i+1]) / 2));
    return { series, jagPk, nodes: A.nodes.length };
  }, { damp, nd, secs, press });

  console.log(`damp=${damp} nd=${nd} 押す${press}tick 節点${out.nodes}個`);
  console.log('  秒 │ ギザギザ(高波数RMS) │ 山(低波数RMS)');
  for (const [t, hi, lo] of out.series) {
    if (t <= 10 || t % 5 === 0)
      console.log(`  ${String(t).padStart(2)} │ ${hi.toFixed(3).padStart(8)} px       │ ${lo.toFixed(2).padStart(6)} px`);
  }
  console.log(`  最後の折れの最大 ${out.jagPk.toFixed(2)} px`);
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,5).forEach(e => console.error(e)); }
})();
