#!/usr/bin/env node
// 合成波（重ね合わせ）デモの「がくがく」＝節点スケールのがたつきを測る。
//
// ★1条件＝1ページ。同じページでデモを作り直すと前の条件が残って再現しない
//   （実測：単独の山が 57→140px まで動いた。光学の受光面と同じ罠）。
// ★指標は空間スペクトル。節点の横変位を正弦級数に分けて
//     ギザギザ … 波長が節点間隔の8倍より短い成分（n > N/4）の RMS [px]
//     山       … 波長が長い側（n ≤ N/4）の RMS [px]（山が痩せていないかの対照）
//   山（λ≈2m＝27節点ぶん）とがたつき（λ≈2〜4節点ぶん）は n で完全に分かれる。
// ★見出しの実測値（単独 57px・山と山 1.83倍・山と谷 6.1%・1.62秒）も毎回出して、
//   がたつきを消す代わりにデモが壊れていないかを並べて読む。
// 使い方: node tools/measure-jag.js
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const CONDS = [
  { name: '既定（damp 0, nd 20）', damp: 0,   nd: 20 },
  { name: 'damp 0.1',              damp: 0.1, nd: 20 },
  { name: 'damp 0.3',              damp: 0.3, nd: 20 },
  { name: 'damp 1.0',              damp: 1.0, nd: 20 },
  { name: 'nd 10（節点を半分）',    damp: 0,   nd: 10 },
  { name: 'nd 37（節点を倍）',      damp: 0,   nd: 37 },
  { name: '曲げ β 0.02',           damp: 0,   nd: 20, bend: 0.02 },
  { name: '曲げ β 0.2',            damp: 0,   nd: 20, bend: 0.2 },
];

const MEASURE = async (c) => {
  let s = 88172645463325252n;
  Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
    return Number(s & 0xffffffffn) / 4294967296; };
  demoWaveSuperposition();
  for (const S of slinkies) {
    S.damp = c.damp;
    if (c.bend !== undefined) S.bendRatio = c.bend;
    if (c.nd !== S.nodeDensity) { S.nodeDensity = c.nd; S.rebuild(); }
    S._sync();
  }
  const rem = remotes[0];

  // 節点の横変位（両端を結ぶ直線からのずれ）
  const disp = S => {
    const nd = S.nodes, N = nd.length, out = new Array(N);
    const x0 = nd[0].x, y0 = nd[0].y, x1 = nd[N-1].x, y1 = nd[N-1].y;
    const L = Math.hypot(x1-x0, y1-y0) || 1, ux = (x1-x0)/L, uy = (y1-y0)/L;
    for (let i = 0; i < N; i++) out[i] = -(nd[i].x-x0)*uy + (nd[i].y-y0)*ux;
    return out;
  };
  // 正弦級数に分けて、高波数側と低波数側の RMS を返す
  const spec = S => {
    const y = disp(S), N = y.length, M = N - 1;
    let lo = 0, hi = 0;
    for (let n = 1; n < M; n++) {
      let a = 0;
      for (let i = 1; i < M; i++) a += y[i] * Math.sin(Math.PI * n * i / M);
      a *= 2 / M;
      if (n > M / 4) hi += a * a; else lo += a * a;
    }
    return { hi: Math.sqrt(hi / 2), lo: Math.sqrt(lo / 2) };
  };
  const centerMax = S => {                    // 中央20%の変位の最大（デモの★と同じ）
    const y = disp(S), N = y.length;
    let m = 0;
    for (let i = Math.floor(N*0.4); i <= Math.ceil(N*0.6); i++) m = Math.max(m, Math.abs(y[i]));
    return m;
  };

  const A = slinkies[0], B = slinkies[1];     // 上＝山と山／下＝山と谷
  let hiSum = 0, loSum = 0, nSum = 0;
  let best = -1, bestT = 0, bestOpp = 0, aloneA = 0, aloneB = 0;
  for (let t = 0; t < 420; t++) {             // 7秒
    rem._on = (t < 43);                       // X を 43tick 押して放す
    simTick();
    if (t < 80) {                             // すれ違う前の単独の山（左35%の区間）
      const yA = disp(A), yB = disp(B), N = yA.length;
      for (let i = 0; i < N*0.35; i++) {
        aloneA = Math.max(aloneA, Math.abs(yA[i]));
        aloneB = Math.max(aloneB, Math.abs(yB[i]));
      }
    }
    const cm = centerMax(A);
    if (cm > best) { best = cm; bestT = t; bestOpp = centerMax(B); }
    if (t >= 120) {                           // 山が通り過ぎたあと 300tick の時間平均
      const sa = spec(A), sb = spec(B);
      hiSum += sa.hi + sb.hi; loSum += sa.lo + sb.lo; nSum += 2;
    }
  }
  return { nodes: A.nodes.length, hi: hiSum/nSum, lo: loSum/nSum,
           aloneA, aloneB, same: best, opp: bestOpp, tCross: bestT/60 };
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const url = pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href;
  for (const c of CONDS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#main-canvas');
    const r = await page.evaluate(MEASURE, c);
    await page.close();
    console.log(
      (c.name + '                      ').slice(0, 22) +
      `節点 ${String(r.nodes).padStart(3)}` +
      ` │ ギザギザ ${r.hi.toFixed(3).padStart(6)} px` +
      ` │ 山 ${r.lo.toFixed(2).padStart(6)} px` +
      ` │ 単独 ${r.aloneA.toFixed(1)}/${r.aloneB.toFixed(1)}` +
      ` │ 山と山 ${r.same.toFixed(1)} (${(r.same/r.aloneA).toFixed(2)}倍)` +
      ` 山と谷 ${r.opp.toFixed(1)} (${(r.opp/r.aloneB*100).toFixed(1)}%)` +
      ` @${r.tCross.toFixed(2)}s` +
      (errors.length ? `  ※エラー ${errors.length}件` : ''));
    if (errors.length) errors.slice(0, 3).forEach(e => console.error('    ' + e));
  }
  await browser.close();
})();
