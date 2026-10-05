#!/usr/bin/env node
// 端の機構のどこが節点スケールのがたつきを生んでいるかを切り分ける。1条件＝1ページ。
//   node tools/measure-jag-source.js <barMass> <damp> [secs] [押すtick]
//
// ★狙い：台の質量に比例するなら「重い端が波を散らす」＝物理。質量に依らないなら
//   連結棒（rod ジョイント）の実装が漏らしている＝直せる。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const barMass = Number(process.argv[2] ?? 0.4);
const damp    = Number(process.argv[3] ?? 0.3);
const secs    = Number(process.argv[4] ?? 45);
const press   = Number(process.argv[5] ?? 43);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const out = await page.evaluate(({ barMass, damp, secs, press }) => {
    let s = 88172645463325252n;
    Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
      return Number(s & 0xffffffffn) / 4294967296; };
    demoWaveSuperposition();
    for (const S of slinkies) { S.damp = damp; S._sync(); }
    // 台（左の1本と右の2つ）の質量を差し替える
    let n = 0;
    for (const b of objects)
      if (b.label && b.label.startsWith('台')) { b.setMass(barMass); n++; }
    const S = slinkies[0], rem = remotes[0];
    const base = S.nodes.map(v => v.y);
    const spec = () => {
      const nd = S.nodes, M = nd.length - 1;
      let lo = 0, hi = 0;
      for (let q = 1; q < M; q++) {
        let a = 0;
        for (let i = 1; i < M; i++) a += (nd[i].y - base[i]) * Math.sin(Math.PI * q * i / M);
        a *= 2 / M;
        if (q > M / 4) hi += a*a; else lo += a*a;
      }
      return { hi: Math.sqrt(hi/2), lo: Math.sqrt(lo/2) };
    };
    const series = [];
    let hiAcc = 0, loAcc = 0, nAcc = 0;
    const T = Math.round(secs * 60);
    for (let t = 0; t < T; t++) {
      rem._on = (t < press);
      simTick();
      if (t % 10 === 0) { const q = spec(); hiAcc += q.hi; loAcc += q.lo; nAcc++; }
      if ((t + 1) % 300 === 0) { series.push([(t+1)/60, hiAcc/nAcc, loAcc/nAcc]); hiAcc = loAcc = nAcc = 0; }
    }
    let jagPk = 0;
    for (let i = 1; i < S.nodes.length - 1; i++) {
      const d = (S.nodes[i].y - base[i]) - ((S.nodes[i-1].y - base[i-1]) + (S.nodes[i+1].y - base[i+1])) / 2;
      jagPk = Math.max(jagPk, Math.abs(d));
    }
    return { series, jagPk, bars: n };
  }, { barMass, damp, secs, press });

  console.log(`■ 台 ${barMass}kg（${out.bars}個） damp ${damp} 押す${press}tick`);
  const last = out.series[out.series.length - 1];
  console.log(`  ${out.series.map(([t, hi]) => `${t}s:${hi.toFixed(3)}`).join('  ')}`);
  console.log(`  山 ${last[2].toFixed(1)}px　最後の折れの最大 ${out.jagPk.toFixed(2)}px`);
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,3).forEach(e => console.error(e)); }
})();
