#!/usr/bin/env node
// 物体に触れている液体の粒の「ぷるぷる」を測る。乱数固定・900tick 落ち着かせ・300tick の時間平均。
//
//   node tools/measure-body-jitter.js            全条件
//   node tools/measure-body-jitter.js --sph JSON SPH の設定を上書きして対照を取る（例: '{"coupleGain":0}'）
//                                                 '{"lockFlip":true}' は走査の向きの毎tick反転を止める
//
// ★粒を3つに分けて比べる（分けるのは平均を取り始める瞬間の位置で、以後は固定）：
//   物体ぎわ … 測る物体（コップ以外）の面から 半径＋4px 以内
//   容器ぎわ … コップ（静止した容器）の面から 半径＋4px 以内で、物体ぎわでない
//   中        … どちらからも 2間隔（22px）以上離れている
// ★物差し：1tick に動いた距離の平均 [px/tick]、位置の標準偏差 [px]（300tick の平均位置まわり）、
//   静止率（1tick の移動が 0.05px 未満だった tick の割合）。物体そのものの y の標準偏差も出す。
// ★条件：
//   float   コップの水に浮かべた箱（密度 500・動く）
//   heavy   コップの水の底に沈んだ箱（密度 3000・動く）
//   fixed   コップの水の中に固定した箱（静止。動く物体との対照）
//   restDyn 床に置いた動く箱（密度 3000）。heavy と同じだが落とさずに最初から床に置く
//   restFix restDyn と同じ位置の箱を固定にしたもの（動く物体であることが効いているかの対照）
//   drop    水たまりの無いところで、固定した箱の上に載せた水の粒 30 個（張り付いたしずく）
//   dropDyn 床に置いた動く箱（密度 1000）の上に載せた水の粒 30 個
//   tank    （別の物差し）密閉水槽の走査順の渦：左右の vy・上下の vx の時間平均（--modes tank で指定）

const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const SCRIPT = `
window.__seedRandom = function (seed) {
  let s = seed >>> 0 || 1;
  Math.random = function () {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};
const IW = 240, IH = 260, T = 22, STEP = 11.2;
// 密閉した水槽（蓋つき・熱なし・一様20℃）の、走査順が作る系統的な渦を測る（particles.js ②の★と同じ物差し）。
//   左右 1/3 の平均 vy と、上下 1/3 の平均 vx を 300tick の時間平均で。理想は全部 0。
window.__tank = function (cfg) {
  __seedRandom(1357);
  clearScene(); resetDemoWorld(); world.sleeping = false; world.thermalOn = false; updateGroundTerrain(true);
  if (cfg) { const c = Object.assign({}, cfg);
    if ('lockFlip' in c) { const v = !!c.lockFlip; delete c.lockFlip; Object.defineProperty(SPH, '_flip', { get: () => v, set: () => {}, configurable: true }); }
    Object.assign(SPH, c); }
  const gy = ground.y, W = 280, H = 280, T2 = 20;
  objects.push(new Body({ type:'polygon', x:0, y:gy - T2, isStatic:true, mass:0, friction:0.4, restitution:0,
    verts:[{x:-W-T2,y:-H-T2},{x:W+T2,y:-H-T2},{x:W+T2,y:T2},{x:-W-T2,y:T2}],
    holes:[[{x:-W,y:-H},{x:W,y:-H},{x:W,y:0},{x:-W,y:0}]], fillColor:'#37474f' }));
  const fy = gy - T2;
  for (let y = fy - 5.6; y > fy - H + 5; y -= 11.2)
    for (let x = -W + 6.7; x < W - 6.7; x += 11.2) particles.push(new Particle(x, y, 'fluid'));
  for (let i = 0; i < 900; i++) simTick();
  let L = 0, R = 0, U = 0, D = 0, nL = 0, nR = 0, nU = 0, nD = 0;
  let ys = particles.map(p => p.y).sort((a, b) => a - b);
  const yTop = ys[0], yBot = ys[ys.length - 1], hT = yBot - yTop;
  for (let t = 0; t < 300; t++) {
    simTick();
    for (const p of particles) {
      if (p.x < -W/3) { L += p.vy; nL++; } else if (p.x > W/3) { R += p.vy; nR++; }
      if (p.y < yTop + hT/3) { U += p.vx; nU++; } else if (p.y > yBot - hT/3) { D += p.vx; nD++; }
    }
  }
  return { 粒: particles.length, 左vy: +(L/nL).toFixed(2), 右vy: +(R/nR).toFixed(2), 上vx: +(U/nU).toFixed(2), 下vx: +(D/nD).toFixed(2) };
};
window.__jit = function (mode, cfg) {
  __seedRandom(2468);
  clearScene(); resetDemoWorld(); world.sleeping = false; updateGroundTerrain(true);
  if (cfg) { const c = Object.assign({}, cfg);
    // lockFlip：走査の向きを毎tick反転させない対照（_flip を固定値にする）
    if ('lockFlip' in c) { const v = !!c.lockFlip; delete c.lockFlip; Object.defineProperty(SPH, '_flip', { get: () => v, set: () => {}, configurable: true }); }
    Object.assign(SPH, c); }
  const gy = ground.y;
  let cup = null;
  const floorY = gy - T;
  const mkBox = (d, x, y, stat, w = 76, h = 40) => {
    const b = new Body({ type:'box', w, h, x, y, density:d, isStatic:!!stat, mass: stat ? 0 : undefined,
      friction:0.3, frictionStatic:0.4, restitution:0, fillColor:'#8d6e63' });
    if (!stat) b.setMass(b.massFromDensity());
    objects.push(b); return b;
  };
  let target;
  if (mode === 'drop' || mode === 'dropDyn') {
    target = mode === 'drop' ? mkBox(0, 0, gy - 140, true, 160, 40) : mkBox(1000, 0, gy - 20, false, 160, 40);
    const top = target.y - 20;
    for (let k = 0; k < 30; k++)          // 箱の上に3段に積んでおく（落ちて広がる）
      particles.push(new Particle(-50 + (k % 10) * 11.2, top - 6 - Math.floor(k / 10) * 11.2, 'fluid'));
  } else {
    cup = new Body({ type:'polygon', x:0, y:floorY, isStatic:true, mass:0, friction:0.4, frictionStatic:0.5, restitution:0,
      verts:[{ x:-(IW+T), y:-IH }, { x:-IW, y:-IH }, { x:-IW, y:0 }, { x:IW, y:0 }, { x:IW, y:-IH },
             { x:(IW+T), y:-IH }, { x:(IW+T), y:T }, { x:-(IW+T), y:T }], fillColor:'#37474f' });
    objects.push(cup);
    for (let y = floorY - STEP*0.5; y > floorY - 170; y -= STEP)
      for (let x = -IW + STEP*0.6; x < IW - STEP*0.6; x += STEP) particles.push(new Particle(x, y, 'fluid'));
    target = mode === 'float' ? mkBox(500, 0, floorY - 260, false)
           : mode === 'heavy' ? mkBox(3000, 0, floorY - 260, false)
           : mode === 'restFix' ? mkBox(0, 0, floorY - 20, true)   // heavy と同じ位置（床に着いた箱）を固定で
           : mode === 'restDyn' ? mkBox(3000, 0, floorY - 20, false)  // heavy を最初から床に置いたもの
           : mkBox(0, 0, floorY - 90, true);
  }
  for (let i = 0; i < 900; i++) simTick();
  const pad = PARTICLE_TYPES.fluid.radius + 4;
  const cls = particles.map(p => {
    const dB = SPH._surfDist(p, target);
    const inB = target.containsPoint(p.x, p.y);
    if (dB <= pad || inB) return 0;
    const dC = cup ? SPH._surfDist(p, cup) : Infinity;
    if (dC <= pad) return 1;
    const dG = (world.terrain && ground.layers !== 0) ? Math.abs(signedDistToGround(p.x, p.y)) : Infinity;
    if (Math.min(dB, dC, dG) >= 22) return 2;
    return -1;
  });
  // 物体ぎわの粒の場所：0 上面 / 1 側面 / 2 床との隅（箱の下端から 15px 以内の側面）/ 3 下面
  const sub = particles.map((p, i) => {
    if (cls[i] !== 0) return -1;
    const c = Math.cos(-target.angle), s2 = Math.sin(-target.angle);
    const lx = c*(p.x-target.x) - s2*(p.y-target.y), ly = s2*(p.x-target.x) + c*(p.y-target.y);
    const hw = target.w/2, hh = target.h/2;
    if (Math.abs(lx) <= hw) return ly < 0 ? 0 : 3;
    return ly > hh - 15 ? 2 : 1;
  });
  const sStep = [0,0,0,0], sCnt = [0,0,0,0], sAc = [0,0,0,0], sA0 = [0,0,0,0], sN = [0,0,0,0];
  sub.forEach(k => { if (k >= 0) sN[k]++; });
  const cAc = [0,0,0], cA0 = [0,0,0];
  const n = particles.length, AV = 300;
  const sx = new Float64Array(n), sy = new Float64Array(n), sxx = new Float64Array(n), syy = new Float64Array(n);
  const step = [0,0,0], still = [0,0,0], cnt = [0,0,0];
  const prevD = new Float64Array(n * 2); let ac = 0, a0 = 0;
  let by = 0, byy = 0;
  for (let t = 0; t < AV; t++) {
    const ox = particles.map(p => p.x), oy = particles.map(p => p.y);
    simTick();
    for (let i = 0; i < n; i++) {
      const p = particles[i], c = cls[i];
      sx[i] += p.x; sy[i] += p.y; sxx[i] += p.x*p.x; syy[i] += p.y*p.y;
      if (c < 0) continue;
      const dx = p.x - ox[i], dy = p.y - oy[i];
      if (t > 0) {
        const pr = dx*prevD[2*i] + dy*prevD[2*i+1], sq = dx*dx + dy*dy;
        cAc[c] += pr; cA0[c] += sq;
        if (c === 0) { ac += pr; a0 += sq; const k = sub[i]; sAc[k] += pr; sA0[k] += sq; }
      }
      if (c === 0) { const k = sub[i]; sStep[k] += Math.hypot(dx, dy); sCnt[k]++; }
      prevD[2*i] = dx; prevD[2*i+1] = dy;
      const d = Math.hypot(dx, dy);
      step[c] += d; cnt[c]++; if (d < 0.05) still[c]++;
    }
    by += target.y; byy += target.y * target.y;
  }
  const sd = [0,0,0], nc = [0,0,0];
  for (let i = 0; i < n; i++) {
    const c = cls[i]; if (c < 0) continue;
    const vx = sxx[i]/AV - (sx[i]/AV)**2, vy = syy[i]/AV - (sy[i]/AV)**2;
    sd[c] += Math.sqrt(Math.max(0, vx + vy)); nc[c]++;
  }
  const out = {};
  ['物体ぎわ','容器ぎわ','中'].forEach((k, c) => {
    out[k] = nc[c] ? { 粒: nc[c], '動き[px/tick]': +(step[c]/cnt[c]).toFixed(3),
                       '位置のσ[px]': +(sd[c]/nc[c]).toFixed(3), 静止率: +(still[c]/cnt[c]).toFixed(3) } : null;
  });
  const m = by / AV;
  out.場所別 = ['上面','側面','床との隅','下面'].map((k, j) => sN[j] ? k + ' ' + sN[j] + '粒: ' + (sStep[j]/sCnt[j]).toFixed(3) + 'px/tick・相関 ' + (sAc[j]/sA0[j]).toFixed(2) : null).filter(Boolean).join(' ／ ');
  out.区分の相関 = cAc.map((v, c) => cA0[c] ? +(v / cA0[c]).toFixed(2) : null);
  out.往復 = a0 ? +(ac / a0).toFixed(2) : null;   // 物体ぎわの1tickの動きの lag1 相関（−1 に近いほど往復）
  out.物体のσ = +Math.sqrt(Math.max(0, byy/AV - m*m)).toFixed(3);
  return out;
};
`;

(async () => {
  const gi = process.argv.indexOf('--sph');
  const CFG = gi === -1 ? null : JSON.parse(process.argv[gi + 1]);
  const mi = process.argv.indexOf('--modes');
  const MODES = mi === -1 ? ['float', 'heavy', 'fixed', 'drop', 'dropDyn'] : process.argv[mi + 1].split(',');
  if (CFG) console.log('SPH 上書き:', CFG);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href, { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');
  await page.evaluate(SCRIPT);
  await page.evaluate('stopSim && stopSim()').catch(() => {});
  for (const mode of MODES) {
    if (mode === 'tank') {
      const t = await page.evaluate((c) => __tank(c), CFG);
      console.log('── tank（密閉水槽の走査順の渦。理想は全部 0）──', JSON.stringify(t));
      continue;
    }
    const r = await page.evaluate(([m, c]) => __jit(m, c), [mode, CFG]);
    console.log(`── ${mode}（物体の y のσ ${r.物体のσ} px／物体ぎわの動きの lag1 相関 ${r.往復}）──`);
    const rows = [];
    for (const k of ['物体ぎわ', '容器ぎわ', '中']) if (r[k]) rows.push({ 粒の場所: k, ...r[k] });
    console.table(rows);
    console.log('  物体ぎわの内訳:', r.場所別);
    console.log('  lag1 相関（物体ぎわ／容器ぎわ／中）:', r.区分の相関.join(' / '));
  }
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); for (const e of errors) console.error(e); }
  process.exit(errors.length ? 1 : 0);
})();
