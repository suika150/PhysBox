#!/usr/bin/env node
// 複数の液体（水・油・食塩水）を測る。乱数固定・時間平均（CLAUDE.md 第2章）。
//
//   node tools/measure-liquids.js separate   水と油を混ぜた状態から、層に分かれるまでの時間と界面の高さ
//   node tools/measure-liquids.js sink       水だけ・油だけ・油の層の下に水、それぞれに浮かべた箱の沈み具合
//   node tools/measure-liquids.js all
//   --control      軽い液体の粒の質量比 mrel を 1 にする対照（粒どうしの補正を等分）。
//                  浮力の層の表は密度のままなので、sink の層の結果は参考にならない
//   --kappa a,b,v  液体 a と b の付着の比 κ を v に上書き（対照・感度を見るため。1 で付着の差なし）
//   --liq JSON     液体のパラメータを上書き。例: --liq '{"oil":{"viscosity":0.05}}'
//   --pairs LIST   separate で測る組（重い/軽い をカンマ区切り）。既定 water/oil,brine/water
//   --ticks N      separate の長さ（既定 3600）
//   --init K       separate の始め方。mixed（既定・粒ごとに半々で混ぜる）／inverted（軽いほうを下に置く）／
//                  pourLight（重いほうの上に軽いほうを注ぐ）／pourHeavy（軽いほうの上に重いほうを注ぐ）
//
// ★コップは measure-buoyancy.js と同じ寸法（内寸 480px・深さ 260px）。
// ★物差し：
//   ・分離度 S ＝ (油の平均の高さ − 水の平均の高さ) ÷ (完全に分かれたときのその差 = 全液柱の半分)。
//     よく混ぜた状態で 0、きれいに2層なら 1。毎tick 測り、60tick ごとに平均して時間の列にする。
//   ・界面の高さ：箱から離れた列だけで、高さの段（5.6px）ごとに水の割合を数え、下から見て
//     0.5 を割る高さ（段の中は一次補間）。300tick の時間平均。
//   ・理論の界面：水の粒の数 × 1粒の面積 126px² ÷ 内寸 480px（液体はどれも同じ間隔で詰まる）。
//   ・沈み具合：箱の底から上面（液面）までの割合（measure-buoyancy.js と同じ定義）。
//     層のときは「界面より下にある割合」も出す（理論：(ρ箱 − ρ油)/(ρ水 − ρ油)）。

const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const HARNESS = `
window.__seedRandom = function (seed) {
  let s = seed >>> 0 || 1;
  Math.random = function () {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
const IW = 240, IH = 260, T = 22, STEP = 11.2, NCOL = 42, COLW = 2 * IW / NCOL, HALF_SP = 5.6;
window.__cup = function () {
  clearScene();
  resetDemoWorld();
  world.sleeping = false;
  updateGroundTerrain(true);
  const gy = ground.y;
  objects.push(new Body({
    type:'polygon', x:0, y:gy - T, isStatic:true, mass:0,
    friction:0.4, frictionStatic:0.5, restitution:0,
    verts:[{ x:-(IW+T), y:-IH }, { x:-IW, y:-IH }, { x:-IW, y:0 },
           { x:IW, y:0 }, { x:IW, y:-IH }, { x:(IW+T), y:-IH },
           { x:(IW+T), y:T }, { x:-(IW+T), y:T }],
    fillColor:'#37474f', strokeColor:'#b0bec5', strokeWidth:2.5, label:'コップ' }));
  return gy - T;                                   // 床の y
};
// 床から高さ height ぶん、行ごとに液体を詰める。kindOf(行番号, 列番号) が液体の名前を返す
window.__fill = function (floorY, height, kindOf) {
  let row = 0;
  for (let y = floorY - STEP*0.5; y > floorY - height; y -= STEP, row++) {
    let col = 0;
    for (let x = -IW + STEP*0.6; x < IW - STEP*0.6; x += STEP, col++)
      particles.push(new Particle(x, y, 'fluid', kindOf(row, col)));
  }
};
window.__box = function (floorY, d, x, yTop) {
  const b = new Body({
    type:'box', w:76, h:40, x, y:yTop, density:d,
    friction:0.3, frictionStatic:0.4, restitution:0,
    fillColor:'#8d6e63', strokeColor:'#d7ccc8', strokeWidth:1.5, label:String(d) });
  b.setMass(b.massFromDensity());
  objects.push(b);
  return b;
};
// 液面：列ごとの最上点の平均＋半間隔（keep(x) が真の列だけ）
window.__level = function (keep) {
  const top = new Array(NCOL).fill(Infinity);
  for (const p of particles) {
    if (p.type !== 'fluid' || p.x < -IW || p.x >= IW) continue;
    const i = ((p.x + IW) / COLW) | 0;
    if (p.y < top[i]) top[i] = p.y;
  }
  let s = 0, n = 0;
  for (let i = 0; i < NCOL; i++) {
    if (top[i] === Infinity || !keep(-IW + (i + 0.5) * COLW)) continue;
    s += top[i] - HALF_SP; n++;
  }
  return n ? s / n : null;
};
// 界面：下から見て水（heavy の液体）の割合が 0.5 を割る y
window.__interface = function (floorY, heavy, keep) {
  const BIN = 5.6, NB = 60;
  const nH = new Array(NB).fill(0), nA = new Array(NB).fill(0);
  for (const p of particles) {
    if (p.type !== 'fluid' || p.x < -IW || p.x >= IW || !keep(p.x)) continue;
    const k = ((floorY - p.y) / BIN) | 0;
    if (k < 0 || k >= NB) continue;
    nA[k]++; if (p.liq === heavy) nH[k]++;
  }
  let prev = 1;
  for (let k = 0; k < NB; k++) {
    if (!nA[k]) continue;
    const f = nH[k] / nA[k];
    if (f < 0.5) {
      const t = (prev - 0.5) / Math.max(1e-9, prev - f);     // 段 k−1 と k の中心の間で補間
      return floorY - ((k - 0.5 + t) * BIN);
    }
    prev = f;
  }
  return null;
};
window.__sep = function (light) {
  let hL = 0, nL = 0, hH = 0, nH = 0, top = Infinity, bot = -Infinity;
  for (const p of particles) {
    if (p.type !== 'fluid') continue;
    if (p.liq === light) { hL -= p.y; nL++; } else { hH -= p.y; nH++; }
    if (p.y < top) top = p.y; if (p.y > bot) bot = p.y;
  }
  const H = (bot - top) + STEP;                      // 全液柱の高さ
  return ((hL/nL) - (hH/nH)) / (H / 2);
};
`;

const RUN = `
window.__separate = function (heavy, light, total, ticks, control, init) {
  __seedRandom(4242);
  const floorY = __cup();
  let pour = null;
  if (init === 'pourLight' || init === 'pourHeavy') {
    // ★注ぐ：片方を下半分に詰め、もう片方を上から2秒かけて注ぐ（粒子ツールと同じく
    //   置く位置に ±10px の乱れ）。pourLight＝重いほうの上に軽いほうを注ぐ（そのまま上に残るはず）、
    //   pourHeavy＝軽いほうの上に重いほうを注ぐ（沈んで下に入れ替わるはず）。
    const below = init === 'pourLight' ? heavy : light;
    pour = init === 'pourLight' ? light : heavy;
    __fill(floorY, total / 2, () => below);
    pour = { kind: pour, left: particles.length, y: floorY - total / 2 - 50 };
  } else if (init === 'inverted') {
    // ★逆さの2層：軽い液体を下半分、重い液体を上半分に置く（レイリー・テイラー型の入れ替わり）
    const rows = Math.ceil(total / STEP);
    __fill(floorY, total, (row) => row < rows / 2 ? light : heavy);
  } else {
    // ★よく混ぜた状態：粒ごとに半々の確率で油か水（固定シード）
    __fill(floorY, total, () => Math.random() < 0.5 ? light : heavy);
  }
  if (control) LIQUID_TYPES[light].mrel = 1;
  let nH = 0, nL = 0;
  for (const p of particles) (p.liq === heavy ? nH++ : nL++);
  if (pour) (pour.kind === heavy ? nH += pour.left : nL += pour.left);
  const series = [];
  let acc = 0;
  for (let i = 1; i <= ticks; i++) {
    if (pour && pour.left > 0) {                 // 1tick に数粒ずつ注ぐ（2〜3秒で注ぎ終わる）
      for (let k = 0; k < 3 && pour.left > 0; k++, pour.left--)
        particles.push(new Particle((Math.random() - 0.5) * 440, pour.y - Math.random() * 20, 'fluid', pour.kind));
    }
    simTick();
    acc += __sep(light);
    if (i % 60 === 0) { series.push(+(acc / 60).toFixed(3)); acc = 0; }
  }
  // 最後の 300tick：界面と液面の時間平均
  const all = () => true;
  let iSum = 0, iN = 0, lSum = 0, sSum = 0, vmSum = 0, bad = 0;
  for (let i = 0; i < 300; i++) {
    simTick();
    let vm = 0;
    for (const p of particles) { const v = Math.hypot(p.vx, p.vy); if (v > vm) vm = v; if (!Number.isFinite(v)) bad++; }
    vmSum += vm;
    const yi = __interface(floorY, heavy, all);
    if (yi !== null) { iSum += floorY - yi; iN++; }
    lSum += floorY - __level(all);
    sSum += __sep(light);
  }
  // 層の「取り残し」：界面より下にいる軽い粒・上にいる重い粒（最後の配置で1回数える）
  const yi = __interface(floorY, heavy, all);
  let strayL = 0, strayH = 0;
  for (const p of particles) {
    if (p.type !== 'fluid') continue;
    if (p.liq === light && p.y > yi + STEP) strayL++;
    if (p.liq === heavy && p.y < yi - STEP) strayH++;
  }
  if (control) LIQUID_TYPES[light].mrel = LIQUID_TYPES[light].density / LIQUID_TYPES.water.density;
  let out = 0;
  for (const p of particles) if (Math.abs(p.x) > IW + 2 || p.y < floorY - IH - 40) out++;
  return { nH, nL, series, iface: iN ? iSum / iN : null, surf: lSum / 300, S: sSum / 300,
           strayL, strayH, vmax: vmSum / 300, out, bad };
};
// 箱1個を液体に浮かべる。layers = [[液体, 高さ], …]（下から）
window.__sink = function (layers, d, settle, avg) {
  __seedRandom(12345);
  const floorY = __cup();
  let base = 0;
  for (const [kind, h] of layers) {
    __fill(floorY - base, h, () => kind);
    base += Math.ceil(h / STEP) * STEP;            // 行の数ぶん積む（__fill の行と同じ刻み）
  }
  const b = __box(floorY, d, 0, floorY - base - 90);
  for (let i = 0; i < settle; i++) simTick();
  // ★水面・界面を読む列は「いまの箱の外接矩形から 1 列ぶん以上離れた列」。以前は x=±60 の
  //   固定の帯で、箱が横へ流れると箱の下の水（最上の粒＝箱の底）を水面として読んでいた
  //   （2026-11-20 実測：油に密度400 の箱が x=89〜165 へ流れ、物差しの水面が 3.3px 低く出て
  //   沈み具合 35.0%。エンジンの水面基準では 43.4%＝理論 43.5）。
  const keep = x => x < b._aabb.minX - COLW || x > b._aabb.maxX + COLW;
  const heavy = layers[0][0];
  let sSum = 0, uSum = 0, iSum = 0, ys = 0, ys2 = 0, ySurf = 0;
  for (let i = 0; i < avg; i++) {
    simTick();
    const lv = __level(keep);
    const a = b._aabb, h = a.maxY - a.minY;
    sSum += Math.max(0, Math.min(100, (a.maxY - lv) / h * 100));
    ySurf += floorY - lv;
    if (layers.length > 1) {
      const yi = __interface(floorY, heavy, keep);
      iSum += floorY - yi;
      uSum += Math.max(0, Math.min(100, (a.maxY - yi) / h * 100));
    }
    ys += b.y; ys2 += b.y * b.y;
  }
  const m = ys / avg;
  return { sink: sSum / avg, under: uSum / avg, iface: iSum / avg, surf: ySurf / avg,
           sdY: Math.sqrt(Math.max(0, ys2 / avg - m * m)), bottom: floorY - b._aabb.maxY };
};
`;

(async () => {
  const mode = process.argv[2] || 'all';
  const control = process.argv.includes('--control');
  const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : process.argv[i + 1]; };
  const kappa = arg('--kappa'), liqOv = arg('--liq'), pairsArg = arg('--pairs');
  const TICKS = +(arg('--ticks') || 3600);
  const INIT = arg('--init') || 'mixed';
  const PAIRS = (pairsArg || 'water/oil,brine/water').split(',').map(s => s.split('/'));
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href, { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');
  await page.evaluate(HARNESS + RUN);
  await page.evaluate('stopSim && stopSim()').catch(() => {});
  if (control) console.log('★対照：軽い液体の mrel = 1（粒どうしの補正を等分）');
  if (kappa) {
    const [a, b, v] = kappa.split(',');
    await page.evaluate(([a, b, v]) => { LIQUID_TYPES[a].adh[b] = v; LIQUID_TYPES[b].adh[a] = v; }, [a, b, +v]);
    console.log(`★κ(${a},${b}) = ${v} に上書き`);
  }
  if (liqOv) {
    await page.evaluate((o) => { for (const k in o) Object.assign(LIQUID_TYPES[k], o[k]); }, JSON.parse(liqOv));
    console.log('★液体の上書き:', liqOv);
  }
  console.log('κ:', JSON.stringify(await page.evaluate(() =>
    Object.fromEntries(Object.keys(LIQUID_TYPES).map(k => [k, LIQUID_TYPES[k].adh])))));

  if (mode === 'separate' || mode === 'all') {
    for (const [heavy, light] of PAIRS) {
      const r = await page.evaluate(([h, l, c, n, i]) => __separate(h, l, 200, n, c, i), [heavy, light, control, TICKS, INIT]);
      const W = 480, A = 126;
      const ifTh = r.nH * A / W, sfTh = (r.nH + r.nL) * A / W;
      console.log(`── ${heavy}（${r.nH}粒）＋ ${light}（${r.nL}粒）（始め方 ${INIT}）${TICKS}tick ──`);
      console.log('分離度 S（1秒＝60tick ごとの平均）:');
      console.log(r.series.map((v, i) => `${i + 1}s:${v}`).join(' '));
      const t90 = r.series.findIndex(v => v >= 0.9);
      console.log('S が 0.9 に届いた時刻:', t90 < 0 ? '届かず' : `${t90 + 1} 秒`);
      console.table([{ 量: '界面の高さ [px]', 実測: +r.iface.toFixed(1), 理論: +ifTh.toFixed(1) },
                     { 量: '液面の高さ [px]', 実測: +r.surf.toFixed(1), 理論: +sfTh.toFixed(1) },
                     { 量: '最後の300tick の S', 実測: +r.S.toFixed(3), 理論: 1 }]);
      console.log(`取り残し：界面より下の ${light} ${r.strayL} 粒 ／ 界面より上の ${heavy} ${r.strayH} 粒`);
      console.log(`最後の300tick の速さ最大の平均 ${r.vmax.toFixed(1)} px/s ／ コップの外 ${r.out} 粒 ／ 数値の破綻 ${r.bad}`);
    }
  }

  if (mode === 'sink' || mode === 'all') {
    const S = 900, AV = 300;
    const rows = [];
    for (const [name, layers, rhoL] of [['水だけ', [['water', 170]], 1000], ['油だけ', [['oil', 170]], 920]]) {
      for (const d of [400, 800, 900]) {
        const r = await page.evaluate(([l, d, s, a]) => __sink(l, d, s, a), [layers, d, S, AV]);
        rows.push({ 液体: name, 箱の密度: d, 沈み: +r.sink.toFixed(1),
                    理論: +Math.min(100, d / rhoL * 100).toFixed(1), 'yのσ[px]': +r.sdY.toFixed(2) });
      }
    }
    console.log(`── 1種類の液体に浮かべる（${S}tick 落ち着かせ／${AV}tick 平均）──`);
    console.table(rows);
    const lay = [['water', 90], ['oil', 100]];
    const rows2 = [];
    for (const d of [800, 950, 980, 1100]) {
      const r = await page.evaluate(([l, d, s, a]) => __sink(l, d, s, a), [lay, d, S, AV]);
      const thUnder = d >= 1000 ? 100 : d <= 920 ? 0 : (d - 920) / (1000 - 920) * 100;
      rows2.push({ 箱の密度: d, '界面より下[%]': +r.under.toFixed(1), '理論[%]': +thUnder.toFixed(1),
                   '液面下[%]': +r.sink.toFixed(1), '界面[px]': +r.iface.toFixed(1),
                   '底の高さ[px]': +r.bottom.toFixed(1), 'yのσ[px]': +r.sdY.toFixed(2) });
    }
    console.log(`── 水 90px の上に油 100px（${S}tick 落ち着かせ／${AV}tick 平均）──`);
    console.log('  理論：920 未満は油に浮く（界面より下 0%）、920〜1000 は境目で止まり、');
    console.log('        界面より下の割合 = (ρ箱 − 920)/(1000 − 920)。1000 超は水の底へ沈む。');
    console.table(rows2);
  }

  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); for (const e of errors) console.error(e); }
  process.exit(errors.length ? 1 : 0);
})();
