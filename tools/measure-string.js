#!/usr/bin/env node
// 弦の振動デモ：3本（線密度 1:4:9）が同じ回転速度で腹 1/2/3 個になっているかを測る。
//   node tools/measure-string.js [omega] [warmTicks] [measTicks] [blocks]
// 1条件＝1ページ（作り直すと再現しないため）。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const omega = process.argv[2] === undefined ? null : Number(process.argv[2]);
const warm  = Number(process.argv[3] ?? 900);
const meas  = Number(process.argv[4] ?? 600);
const blocks = Number(process.argv[5] ?? 1);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const out = await page.evaluate(({ omega, warm, meas, blocks }) => {
    let s = 88172645463325252n;
    Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
      return Number(s & 0xffffffffn) / 4294967296; };
    // ★デモは demoRunAhead(900) 済みで開く。ここでは素の状態から測りたいので組み直す
    clearScene();
    const r = demoStringVibration();
    const om = omega === null ? r.rig.axle.motorSpeed : omega;
    r.rig.axle.motorSpeed = om;
    // 軸に直交する変位 [px]
    const disp = S => {
      const nd = S.nodes, N = nd.length, o = new Array(N);
      const x0 = nd[0].x, y0 = nd[0].y, x1 = nd[N-1].x, y1 = nd[N-1].y;
      const L = Math.hypot(x1-x0, y1-y0) || 1, ux = (x1-x0)/L, uy = (y1-y0)/L;
      for (let i = 0; i < N; i++) o[i] = -(nd[i].x-x0)*uy + (nd[i].y-y0)*ux;
      return o;
    };
    const theory = r.S.map(S => {
      const m = S.measure();
      return { T: m.T, vT: m.vT, mu: S.linDensity, strain: m.strain,
               f1: m.vT / (2 * toM(300)) };
    });
    for (let t = 0; t < warm; t++) simTick();
    let blow = false;
    const all = [];
    for (let b = 0; b < blocks; b++) {
    // 包絡線（節点ごとの時間最大 |y|）
    const env = r.S.map(S => new Array(S.nodes.length).fill(0));
    let peakSum = r.S.map(() => 0), n = 0;
    for (let t = 0; t < meas; t++) {
      simTick();
      r.S.forEach((S, k) => {
        const y = disp(S);
        let p = 0;
        for (let i = 0; i < y.length; i++) {
          const a = Math.abs(y[i]);
          if (a > env[k][i]) env[k][i] = a;
          if (a > p) p = a;
        }
        if (!isFinite(p) || p > 1e5) blow = true;
        peakSum[k] += p;
      });
      n++;
    }
    // 腹（包絡線の内部の山）と節（内部の谷）を数える
    const shape = env.map((e, k) => {
      const N = e.length, A = Math.max(...e);
      // 節＝内部で包絡線が A の 45% を下回る「ひと続きの区間」の数（両端の 5% は数えない）
      //   ★端は必ず節（振幅 0）なので、しきい値を上から下へ横切る所を端から数えては
      //     いけない。しきい値を超えている最初と最後の節点の**あいだ**だけを見る。
      let first = -1, last = -1;
      for (let i = 0; i < N; i++) if (e[i] >= 0.45 * A) { if (first < 0) first = i; last = i; }
      let nodes = 0, deepest = 1, inRun = false;
      for (let i = first; i <= last; i++) {
        const below = e[i] < 0.45 * A;
        if (below && !inRun) nodes++;
        if (below) deepest = Math.min(deepest, e[i] / A);
        inRun = below;
      }
      // 包絡線を 21 点に間引いて返す（形を目で見るため）
      const prof = [];
      for (let q = 0; q <= 20; q++) prof.push(e[Math.round(q * (N - 1) / 20)] / (A || 1));
      return { amp: A, mean: peakSum[k] / n, nodes, bellies: nodes + 1,
               depth: deepest, mu: r.S[k].linDensity, prof };
    });
    all.push(shape);
    }
    return { om, theory, blocks: all, blow };
  }, { omega, warm, meas, blocks });

  console.log(`ω = ${out.om.toFixed(2)} rad/s（f = ${(out.om / (2*Math.PI)).toFixed(3)} Hz）`
            + `  暖機 ${warm}tick → ${meas}tick 測定${out.blow ? '  ※発散' : ''}`);
  console.log('  μ    │ T [N] │ v [m/s] │ 理論f1 │ 理論n │ 腹 │ 振れ幅(最大/平均) │ 節の深さ');
  out.blocks.forEach((shape, b) => {
  if (out.blocks.length > 1) console.log(`  ── ${warm + b*meas} 〜 ${warm + (b+1)*meas} tick`);
  shape.forEach((s, i) => {
    const th = out.theory[i];
    const nTh = (out.om / (2 * Math.PI)) / th.f1;
    console.log(`  ${s.mu.toFixed(2)} │ ${th.T.toFixed(2)}  │  ${th.vT.toFixed(2)}   │`
      + ` ${th.f1.toFixed(3)} │ ${nTh.toFixed(2)}  │ ${s.bellies}  │`
      + ` ${s.amp.toFixed(1).padStart(6)} / ${s.mean.toFixed(1).padStart(5)} px │ ${s.depth.toFixed(2)}`);
    console.log('        包絡線 ' + s.prof.map(v => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(v * 8))]).join(''));
  }); });
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,5).forEach(e => console.error(e)); }
})();
