#!/usr/bin/env node
// コップの水を「壁ぎわ／床ぎわ／隅／中」に分けて、震え具合を測る。
// 乱数固定・900tick 落ち着かせ・400tick の時間平均（1tick 読みは結論が逆転する）。
//
//   node tools/measure-corner.js            既定（wallMirror ON）
//   node tools/measure-corner.js off        対照（wallMirror OFF）

const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const SETTLE = 900, AVG = 400;

const CODE = `
window.__seedRandom = function (seed) {
  let s = seed >>> 0 || 1;
  Math.random = function () {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
window.__buildCup = function () {
  clearScene(); resetDemoWorld();
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
  return { floorY, IW };
};

// 粒子を4群に分ける。しきい値は SPH.h=26（緩和の届く距離）で揃える。
//   隅   : 側壁からも床からも 26px 以内
//   壁ぎわ: 側壁 26px 以内・床から 60px 以上（隅と混ざらないよう余裕を取る）
//   床ぎわ: 床 26px 以内・側壁から 60px 以上
//   中   : どちらからも 60px 以上
window.__classify = function (geo) {
  const H = 26, FAR = 60;
  const g = { 隅: [], 壁ぎわ: [], 床ぎわ: [], 中: [] };
  for (const p of particles) {
    if (p.type !== 'fluid') continue;
    const dw = geo.IW - Math.abs(p.x);      // 側壁までの距離
    const df = geo.floorY - p.y;            // 床までの距離
    if (dw <= H && df <= H) g.隅.push(p);
    else if (dw <= H && df >= FAR) g.壁ぎわ.push(p);
    else if (df <= H && dw >= FAR) g.床ぎわ.push(p);
    else if (dw >= FAR && df >= FAR) g.中.push(p);
  }
  return g;
};

window.__run = function (settle, avg, mirror, cfg) {
  __seedRandom(12345);
  SPH.wallMirror = mirror;
  if (cfg) Object.assign(SPH, cfg);          // 対照を取るための SPH 設定の上書き
  const geo = __buildCup();
  const t0 = performance.now();
  for (let i = 0; i < settle; i++) simTick();
  window.__ms = (performance.now() - t0) / settle;
  const g = __classify(geo);
  const names = Object.keys(g);
  const acc = {}, still = {}, flip = {}, normDisp = {}, tanDisp = {};
  for (const k of names) { acc[k] = 0; still[k] = 0; flip[k] = 0; normDisp[k] = 0; tanDisp[k] = 0; }
  const prev = new Map(), prevN = new Map();
  for (const k of names) for (const p of g[k]) { prev.set(p, [p.x, p.y]); prevN.set(p, null); }
  for (let i = 0; i < avg; i++) {
    simTick();
    for (const k of names) for (const p of g[k]) {
      const o = prev.get(p);
      const dx = p.x - o[0], dy = p.y - o[1];
      o[0] = p.x; o[1] = p.y;
      const d = Math.hypot(dx, dy);
      acc[k] += d * 60;                       // px/s
      if (d < 0.01) still[k]++;               // 「1tickも動かなかった」割合
      // 壁の鏡像が向いている面（tick に1回だけ決まる）が前tickから変わったか
      const n = p._wn ? [p._wnx, p._wny] : null;
      const pn = prevN.get(p);
      if (n && pn && (n[0]*pn[0] + n[1]*pn[1]) < 0.7) flip[k]++;   // 45度以上向きが変わった
      prevN.set(p, n);
      if (n) { normDisp[k] += Math.abs(dx*n[0] + dy*n[1]); tanDisp[k] += Math.abs(-dx*n[1] + dy*n[0]); }
    }
  }
  const out = [];
  for (const k of names) {
    const n = g[k].length || 1;
    out.push({ 群: k, 個数: g[k].length,
      速さ: +(acc[k] / n / avg).toFixed(1),
      静止率: +(still[k] / n / avg).toFixed(3),
      面の入替率: +(flip[k] / n / avg).toFixed(3),
      法線変位: +(normDisp[k] / n / avg).toFixed(2),
      接線変位: +(tanDisp[k] / n / avg).toFixed(2) });
  }
  return out;
};
`;

(async () => {
  const mirror = process.argv[2] !== 'off';
  const gi = process.argv.indexOf('--sph');     // 例: --sph '{"mirrorFaces":1}'
  const CFG = gi === -1 ? null : JSON.parse(process.argv[gi + 1]);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');
  await page.evaluate(CODE);
  await page.evaluate('stopSim && stopSim()').catch(() => {});

  const r = await page.evaluate(([s, a, m, c]) => __run(s, a, m, c), [SETTLE, AVG, mirror, CFG]);
  const ms = await page.evaluate(() => __ms);
  console.log(`── wallMirror: ${mirror ? 'ON' : 'OFF'} / ${CFG ? JSON.stringify(CFG) : '既定'}`
            + `（${SETTLE}tick 落ち着かせ／${AVG}tick 平均）──`);
  console.table(r);
  console.log('1tick あたり:', ms.toFixed(2), 'ms');

  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); for (const e of errors) console.error(e); }
  process.exit(errors.length ? 1 : 0);
})();
