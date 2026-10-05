#!/usr/bin/env node
// 気柱デモ：2本（①両端が節 ／②節と腹）の縦波の定常波を測る。
//   node tools/measure-gascolumn.js [omega] [warmTicks] [measTicks] [blocks]
// 1条件＝1ページ（波のデモは作り直すと再現しないため）。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const omega  = process.argv[2] === undefined ? null : Number(process.argv[2]);
const warm   = Number(process.argv[3] ?? 900);
const meas   = Number(process.argv[4] ?? 600);
const blocks = Number(process.argv[5] ?? 1);
const damp   = process.argv[6] === undefined ? null : Number(process.argv[6]);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const out = await page.evaluate(({ omega, warm, meas, blocks, damp }) => {
    let s = 88172645463325252n;
    Math.random = () => { s ^= s << 13n; s ^= s >> 7n; s ^= s << 17n;
      return Number(s & 0xffffffffn) / 4294967296; };
    clearScene();
    const r = demoGasColumn();
    const om = omega === null ? r.rig.axle.motorSpeed : omega;
    r.rig.axle.motorSpeed = om;
    const list = [r.Sc, r.So];
    if (damp !== null) for (const S of list) { S.damp = damp; S._sync(); }
    // 縦波の変位＝軸方向のずれ [px]。★静止時の節点位置を基準にする（一様な伸びを引く
    //   やり方では、端が腹になる②で端の変位を 0 に潰してしまう）
    const rest = list.map(S => S.nodes.map(n => n.x));
    const theory = list.map(S => {
      const m = S.measure();
      // ★縦波の速さは (1+ε)·√(EA/μ)。節点の間隔が ℓ0(1+ε) に伸びるのに対し、
      //   ばね定数 EA/ℓ0 も節点質量 μ·ℓ0 も**自然長**で決まるため。
      //   √(EA(1+ε)/μ) と書くと 3.97 m/s になり、実測の共鳴（① 10.2）と 25% 食い違う。
      //   正しい式は 4.86 m/s で、「横波と縦波」の実測 λ=3.19m・f=1.5Hz（v=4.79 m/s）と合う。
      return { vL: (1 + m.strain) * Math.sqrt(S.stiffEA / S.linDensity), T: m.T };
    });
    for (let t = 0; t < warm; t++) simTick();
    const all = [];
    let blow = false;
    for (let b = 0; b < blocks; b++) {
      // ★振れ幅は節点ごとの (max−min)/2 で読む＝**基準の位置を持たない**。
      //   静止時の位置を基準に |x − rest| を読むやり方は、デモが demoRunAhead() で
      //   すでに何十秒か回してから開く以上、rest が「揺れている途中の一瞬」になり、
      //   波が消えたあとも差が残り続ける（実測：口に制動器を入れて②が静かになった
      //   条件で、(max−min)/2 なら 4.0px のところを 29.4px と読んでいた）。
      const lo = list.map(S => S.nodes.map(() => Infinity));
      const hi = list.map(S => S.nodes.map(() => -Infinity));
      const drift = [0, 0];
      let n = 0;
      for (let t = 0; t < meas; t++) {
        simTick();
        list.forEach((S, k) => {
          let sum = 0, p = 0;
          for (let i = 0; i < S.nodes.length; i++) {
            const x = S.nodes[i].x;
            if (x < lo[k][i]) lo[k][i] = x;
            if (x > hi[k][i]) hi[k][i] = x;
            const u = x - rest[k][i];
            sum += u;
            if (Math.abs(u) > p) p = Math.abs(u);
          }
          if (!isFinite(p) || p > 1e5) blow = true;
          drift[k] += sum / S.nodes.length;
        });
        n++;
      }
      const env = lo.map((L, k) => L.map((v, i) => (hi[k][i] - v) / 2));
      const peak = env.map(e => Math.max(...e));
      all.push(env.map((e, k) => {
        const N = e.length, A = Math.max(...e);
        // 節＝包絡線が A の 45% を下回るひと続きの区間。★端は数えない
        //   （しきい値を超えている最初と最後の節点のあいだだけを見る）
        let first = -1, last = -1;
        for (let i = 0; i < N; i++) if (e[i] >= 0.45 * A) { if (first < 0) first = i; last = i; }
        let nodes = 0, deepest = 1, inRun = false;
        for (let i = first; i <= last; i++) {
          const below = e[i] < 0.45 * A;
          if (below && !inRun) nodes++;
          if (below) deepest = Math.min(deepest, e[i] / A);
          inRun = below;
        }
        const prof = [];
        for (let q = 0; q <= 20; q++) prof.push(e[Math.round(q * (N - 1) / 20)] / (A || 1));
        return { amp: A, end: e[N - 1], drift: drift[k] / n, nodes, depth: deepest, prof,
                 endAmp: e[N - 1] / (A || 1) };
      }));
    }
    return { om, blow, theory, blocks: all };
  }, { omega, warm, meas, blocks, damp });

  const L = 3.0, v = out.theory[0].vL;
  console.log(`v_L = ${v.toFixed(2)} m/s（T = ${out.theory[0].T.toFixed(2)} N）`
            + `　理論の共鳴 ω：① ${[1,2,3].map(n => (2*Math.PI*n*v/(2*L)).toFixed(2)).join(' / ')}`
            + `　② ${[1,3,5].map(n => (2*Math.PI*n*v/(4*L)).toFixed(2)).join(' / ')}`);
  console.log(`ω = ${out.om.toFixed(2)} rad/s（f = ${(out.om/(2*Math.PI)).toFixed(3)} Hz）`
            + `  暖機 ${warm}tick → ${meas}tick 測定` + (damp === null ? '' : `  damp=${damp}`) + (out.blow ? '  ※発散' : ''));
  const NAME = ['① 両端が節', '② 節と腹  '];
  out.blocks.forEach((sh, b) => {
    if (out.blocks.length > 1) console.log(`  ── ${warm + b*meas} 〜 ${warm + (b+1)*meas} tick`);
    sh.forEach((s, i) => {
      console.log(`  ${NAME[i]} │ 節 ${s.nodes} │ 振れ幅 ${s.amp.toFixed(1).padStart(6)} px`
        + ` │ 右端 ${s.end.toFixed(1).padStart(5)} px │ 節の深さ ${s.depth.toFixed(2)}`
        + ` │ 端/腹 ${s.endAmp.toFixed(2)} │ ずれ ${s.drift.toFixed(1)}px`);
      console.log('              包絡線 ' + s.prof.map(x => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(x*8))]).join(''));
    });
  });
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,5).forEach(e => console.error(e)); }
})();
