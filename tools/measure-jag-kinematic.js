#!/usr/bin/env node
// 連結棒（rod ジョイント）が供給源かを決める対照。1条件＝1ページ。
//   node tools/measure-jag-kinematic.js <rod|kin> <damp> [secs] [押すtick]
//
//   rod … 合成波デモそのまま（クランク＋連結棒で台を動かす）
//   kin … 連結棒とクランクを全部外し、台を解析的な速度 v = R·ω·sin(ωt) で動かす。
//         端の軌跡はクランクと同じ R(1−cosθ) だが、拘束ソルバを一切通らない。
//         ★ここでがたつきが消えれば供給源は連結棒の実装、残れば端の駆動そのもの。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const mode  = process.argv[2] || 'kin';
const damp  = Number(process.argv[3] ?? 0.3);
const secs  = Number(process.argv[4] ?? 45);
const press = Number(process.argv[5] ?? 300);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const out = await page.evaluate(({ mode, damp, secs, press }) => {
    let s = 88172645463325252n;
    Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
      return Number(s & 0xffffffffn) / 4294967296; };
    demoWaveSuperposition();
    for (const S of slinkies) { S.damp = damp; S._sync(); }
    const S = slinkies[0], rem = remotes[0];

    let bars = [];
    if (mode === 'kin') {
      // 連結棒・軸を全部外し、円板も止める（台だけを運動学で動かす）
      joints.length = 0;
      for (const b of objects) {
        if (b.label === 'クランク（左）' || b.label === 'クランク（右）') { b.isStatic = true; b.setMass(1); }
        if (b.label && b.label.startsWith('台')) {
          b.constVel = true; b.setMass(0.4);
          // 左の台と右上の台は同じ向き、右下の台は逆向き（山と山／山と谷を保つ）
          bars.push({ b, sgn: (b.label === '台（下）') ? +1 : -1 });
        }
      }
    }
    const R = 28, W = 2 * Math.PI * 1.4;        // SP_CRANK と SP_FREQ
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
      if (mode === 'kin') {
        const on = t < press, th = t / 60 * W;
        for (const { b, sgn } of bars) { b.vx = 0; b.vy = on ? sgn * R * W * Math.sin(th) : 0; }
      } else rem._on = (t < press);
      simTick();
      if (t % 10 === 0) { const q = spec(); hiAcc += q.hi; loAcc += q.lo; nAcc++; }
      if ((t + 1) % 300 === 0) { series.push([(t+1)/60, hiAcc/nAcc, loAcc/nAcc]); hiAcc = loAcc = nAcc = 0; }
    }
    let jagPk = 0;
    for (let i = 1; i < S.nodes.length - 1; i++) {
      const d = (S.nodes[i].y - base[i]) - ((S.nodes[i-1].y - base[i-1]) + (S.nodes[i+1].y - base[i+1])) / 2;
      jagPk = Math.max(jagPk, Math.abs(d));
    }
    return { series, jagPk, bars: bars.length };
  }, { mode, damp, secs, press });

  const last = out.series[out.series.length - 1];
  console.log(`■ ${mode}　damp ${damp}　押す${press}tick`
    + (out.bars ? `（台 ${out.bars} 個を運動学で駆動）` : ''));
  console.log(`  ${out.series.map(([t, hi]) => `${t}s:${hi.toFixed(3)}`).join('  ')}`);
  console.log(`  山 ${last[2].toFixed(1)}px　最後の折れの最大 ${out.jagPk.toFixed(2)}px`);
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,3).forEach(e => console.error(e)); }
})();
