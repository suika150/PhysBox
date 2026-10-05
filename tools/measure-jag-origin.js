#!/usr/bin/env node
// 節点スケールのがたつきは「どこから注がれているか」を切り分ける。1条件＝1ページ。
//   node tools/measure-jag-origin.js <driven|pinned> <substeps> [secs]
//
//   driven … 合成波デモそのまま（両端が台＋連結棒＋モーター、ワールドのサブステップ境界で
//            端の位置が更新される）
//   pinned … 同じ媒質を背景にピン留めしただけの裸のばね。山は初期変位で立てる。
//            ＝端の機構と駆動を全部外した対照。ここでも育つなら供給源はばねの中にある。
//   substeps を増やすと端の扱いの刻みが細かくなる。数値由来ならここで減る。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const mode = process.argv[2] || 'driven';
const subs = Number(process.argv[3] ?? 8);
const secs = Number(process.argv[4] ?? 60);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const out = await page.evaluate(({ mode, subs, secs }) => {
    let s = 88172645463325252n;
    Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
      return Number(s & 0xffffffffn) / 4294967296; };

    let S, rem = null;
    if (mode === 'driven') {
      demoWaveSuperposition();
      for (const T of slinkies) { T.damp = 0; T._sync(); }
      S = slinkies[0]; rem = remotes[0];
    } else {
      resetDemoWorld();
      setDemoGravity(0);
      world.sleeping = false;
      updateGroundTerrain(false);
      S = _waveMedium(0, 0, 800, {});      // 両端ピン。デモと同じ媒質・同じ長さ
      S.damp = 0; S._sync();
      slinkies.push(S);
      // 山を1つ、初期変位で立てる（幅はデモの山と同じ 2.0m ＝ 200px 相当）
      const nd = S.nodes, N = nd.length, i0 = N * 0.25, w = N * 0.125;
      for (let i = 1; i < N - 1; i++)
        nd[i].y += 28 * Math.exp(-Math.pow((i - i0) / w, 2));
    }
    world.substeps = subs;

    const base = S.nodes.map(n => n.y);
    const spec = () => {
      const nd = S.nodes, M = nd.length - 1;
      let lo = 0, hi = 0;
      for (let n = 1; n < M; n++) {
        let a = 0;
        for (let i = 1; i < M; i++) a += (nd[i].y - base[i]) * Math.sin(Math.PI * n * i / M);
        a *= 2 / M;
        if (n > M / 4) hi += a*a; else lo += a*a;
      }
      return { hi: Math.sqrt(hi/2), lo: Math.sqrt(lo/2) };
    };

    const series = [];
    let hiAcc = 0, loAcc = 0, nAcc = 0;
    const T = Math.round(secs * 60);
    for (let t = 0; t < T; t++) {
      if (rem) rem._on = (t < 43);
      simTick();
      if (t % 10 === 0) { const q = spec(); hiAcc += q.hi; loAcc += q.lo; nAcc++; }
      if ((t + 1) % 60 === 0) { series.push([(t+1)/60, hiAcc/nAcc, loAcc/nAcc]); hiAcc = loAcc = nAcc = 0; }
    }
    return { series, nodes: S.nodes.length };
  }, { mode, subs, secs });

  console.log(`■ ${mode} / substeps ${subs}（節点 ${out.nodes} 個）`);
  console.log('  秒 │ ギザギザ │ 山');
  for (const [t, hi, lo] of out.series)
    if (t === 1 || t === 5 || t % 10 === 0)
      console.log(`  ${String(t).padStart(2)} │ ${hi.toFixed(3).padStart(6)} px │ ${lo.toFixed(2).padStart(6)} px`);
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,5).forEach(e => console.error(e)); }
})();
