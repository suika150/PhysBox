#!/usr/bin/env node
// 浮力の沈み具合を測る。乱数固定・900tick 落ち着かせ・400tick の時間平均。
//
//   node tools/measure-buoyancy.js single    密度7点を1個ずつ
//   node tools/measure-buoyancy.js demo      浮力デモ（3つ同時）
//   node tools/measure-buoyancy.js both
//   node tools/measure-buoyancy.js knob      浮力デモの木の密度を、落ち着いた水の中でつまみと同じ
//                                            書き込み口（applyBodyProp）から順に変える（上り→下り）
//
// ★水面の物差しは「粒子1個ぶんの幅（11.2px）の列ごとの最上点＋半間隔 5.6px」で揃える。
//   列を広く取ると極値統計で高く出る（26px 幅で +5〜9px＝40px のブロックなら 20 ポイント）。

const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const SETTLE = 900, AVG = 400;

const HARNESS = `
window.__seedRandom = function (seed) {
  let s = seed >>> 0 || 1;
  Math.random = function () {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
// 列ごとの最上点の平均で水面を出す。
//   ★列はコップの内寸 [-240,240] をちょうど 42 等分（1列 11.43px ≒ 粒子間隔 11.2px）。
//     端を半端に切った列を混ぜると、その列に数個しか粒子が入らず最上点が数十px 下に
//     出る（実測：x=±241 の細い列だけ -82px、まわりは -213px）。
//   ★最上点は粒子の中心なので半間隔 5.6px を足して水の上面にする。
const CUP_IW = 240, NCOL = 42, COLW = 2 * CUP_IW / NCOL, HALF_SP = 5.6;
window.__waterLevel = function (keep) {
  let sum = 0, n = 0;
  const top = new Array(NCOL).fill(Infinity);
  for (const p of particles) {
    if (p.type !== 'fluid') continue;
    if (p.x < -CUP_IW || p.x >= CUP_IW) continue;
    const i = ((p.x + CUP_IW) / COLW) | 0;
    if (p.y < top[i]) top[i] = p.y;       // 内部 y は下向きが正＝上端は小さいほう
  }
  for (let i = 0; i < NCOL; i++) {
    if (top[i] === Infinity) continue;
    if (!keep(-CUP_IW + (i + 0.5) * COLW)) continue;
    sum += top[i] - HALF_SP; n++;
  }
  return n ? sum / n : null;
};
window.__sink = function (b, level) {      // 沈み具合 [%]
  const a = b._aabb;
  const h = a.maxY - a.minY;
  return Math.max(0, Math.min(100, (a.maxY - level) / h * 100));
};
`;

// ── コップ＋水＋ブロック（デモと同じ寸法）──────────────────────
const SCENE = `
window.__buildCup = function (cubes) {
  clearScene();              // ★デモ実行と同じ前処理。resetDemoWorld は物を消さない
  resetDemoWorld();
  world.sleeping = false;
  updateGroundTerrain(true);
  const IW = 240, IH = 260, T = 22, WATER = 170, STEP = 11.2;
  const gy = ground.y;
  objects.push(new Body({
    type:'polygon', x:0, y:gy - T, isStatic:true, mass:0,
    friction:0.4, frictionStatic:0.5, restitution:0,
    verts:[{ x:-(IW+T), y:-IH }, { x:-IW, y:-IH }, { x:-IW, y:0 },
           { x:IW, y:0 }, { x:IW, y:-IH }, { x:(IW+T), y:-IH },
           { x:(IW+T), y:T }, { x:-(IW+T), y:T }],
    fillColor:'#37474f', strokeColor:'#b0bec5', strokeWidth:2.5, label:'コップ' }));
  const floorY = gy - T;
  for (let y = floorY - STEP*0.5; y > floorY - WATER; y -= STEP)
    for (let x = -IW + STEP*0.6; x < IW - STEP*0.6; x += STEP)
      particles.push(new Particle(x, y, 'fluid'));
  const made = [];
  for (const c of cubes) {
    const b = new Body({
      type:'box', w:76, h:40, x:c.x, y:floorY - WATER - 90, density:c.d,
      friction:0.3, frictionStatic:0.4, restitution:0,
      fillColor:'#8d6e63', strokeColor:'#d7ccc8', strokeWidth:1.5, label:String(c.d) });
    b.setMass(b.massFromDensity());
    objects.push(b);
    made.push(b);
  }
  return made;
};
`;

// keepSpec: 各ブロックについて「水面を読む列」を選ぶ関数のソース
const RUN = `
window.__run = function (cubes, settle, avg, cfg) {
  __seedRandom(12345);
  if (cfg) Object.assign(SPH, cfg);          // 対照を取るための SPH 設定の上書き
  const bodies = __buildCup(cubes);
  for (let i = 0; i < settle; i++) simTick();
  // ブロックが占める x の帯（±半幅＋余裕）を避けて水面を読む
  const bands = cubes.map(c => [c.x - 60, c.x + 60]);
  const keep = x => bands.every(([lo, hi]) => x < lo || x > hi);
  const acc = bodies.map(() => 0);
  const tilt = bodies.map(() => 0);
  let lvSum = 0;
  for (let i = 0; i < avg; i++) {
    simTick();
    const lv = __waterLevel(keep);
    lvSum += lv;
    bodies.forEach((b, k) => { acc[k] += __sink(b, lv); tilt[k] += Math.abs(b.angle); });
  }
  let escaped = 0;
  for (const p of particles) if (p.type === 'fluid' && Math.abs(p.x) > 262) escaped++;
  return {
    sink: acc.map(v => +(v / avg).toFixed(1)),
    tiltDeg: tilt.map(v => +(v / avg * 180 / Math.PI).toFixed(2)),
    level: +(lvSum / avg).toFixed(1),
    escaped,
  };
};
`;

// ★つまみの題材：一度落ち着いた水の中で密度だけを変える。新しく落とす single とは
//   初期条件が違う（ブロックはすでに水面にいる）ので、同じ値に落ち着くかを別に測る。
const KNOB = `
window.__knob = function (dens, settle0, settle, avg) {
  __seedRandom(12345);
  const bodies = __buildCup([{ d: 400, x: -150 }, { d: 1000, x: 0 }, { d: 2000, x: 150 }]);
  const wood = bodies[0];
  for (let i = 0; i < settle0; i++) simTick();
  const keep = x => [[-210, -90], [-60, 60], [90, 210]].every(([lo, hi]) => x < lo || x > hi);
  const out = [];
  for (const d of dens) {
    applyBodyProp(wood, "density", d);
    for (let i = 0; i < settle; i++) simTick();
    let acc = 0, accMid = 0, ys = 0, ys2 = 0;
    for (let i = 0; i < avg; i++) {
      simTick();
      const lv = __waterLevel(keep);
      acc += __sink(wood, lv); accMid += __sink(bodies[1], lv);
      ys += wood.y; ys2 += wood.y * wood.y;
    }
    const m = ys / avg;
    out.push({ d, sink: +(acc / avg).toFixed(1), mid: +(accMid / avg).toFixed(1),
               sdY: +Math.sqrt(Math.max(0, ys2 / avg - m * m)).toFixed(2) });
  }
  return out;
};
`;

(async () => {
  const mode = process.argv[2] || 'both';
  const gi = process.argv.indexOf('--sph');     // 例: --sph '{"mirrorFaces":1}'
  const CFG = gi === -1 ? null : JSON.parse(process.argv[gi + 1]);
  if (CFG) console.log('SPH 上書き:', CFG);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');
  await page.evaluate(HARNESS + SCENE + RUN + KNOB);
  await page.evaluate('stopSim && stopSim()').catch(() => {});

  if (mode === 'single' || mode === 'both') {
    const DENS = [200, 400, 600, 800, 1000, 1200, 1500];
    const out = [];
    for (const d of DENS) {
      const r = await page.evaluate(
        ([d, s, a, c]) => __run([{ d, x: 0 }], s, a, c), [d, SETTLE, AVG, CFG]);
      out.push({ 密度: d, 沈み: r.sink[0], 理論: Math.min(100, d / 10),
                 傾き: r.tiltDeg[0], 水面: r.level, こぼれ: r.escaped });
    }
    console.log('── 1個ずつ（' + SETTLE + 'tick 落ち着かせ／' + AVG + 'tick 平均）──');
    console.table(out);
    const err = out.reduce((s, r) => s + Math.abs(r.沈み - r.理論), 0) / out.length;
    console.log('平均誤差 [ポイント]:', err.toFixed(1));
  }

  if (mode === 'demo' || mode === 'both') {
    const CUBES = [{ d: 400, x: -150 }, { d: 1000, x: 0 }, { d: 2000, x: 150 }];
    const r = await page.evaluate(
      ([c, s, a, g]) => __run(c, s, a, g), [CUBES, SETTLE, AVG, CFG]);
    console.log('── 浮力デモ（3つ同時）──');
    console.table(CUBES.map((c, i) => ({
      密度: c.d, 沈み: r.sink[i], 理論: Math.min(100, c.d / 10), 傾き: r.tiltDeg[i] })));
    console.log('水面:', r.level, ' こぼれ:', r.escaped);
  }

  if (mode === "knob") {
    const DENS = [200, 400, 600, 800, 1000, 1200, 800, 400];
    const r = await page.evaluate(([d, s0, s, a]) => __knob(d, s0, s, a), [DENS, SETTLE, 600, AVG]);
    console.log("── 浮力デモの木の密度をつまみで変える（" + SETTLE + "tick 落ち着かせ → 1段ごとに 600tick 待って " + AVG + "tick 平均）──");
    console.table(r.map(x => ({ 密度: x.d, 沈み: x.sink, 理論: Math.min(100, x.d / 10),
                                 "y の σ[px]": x.sdY, "中央(1000)の沈み": x.mid })));
  }

  await browser.close();
  if (errors.length) {
    console.error('--- ページ内エラー ---');
    for (const e of errors) console.error(e);
  }
  process.exit(errors.length ? 1 : 0);
})();
