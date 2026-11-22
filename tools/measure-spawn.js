#!/usr/bin/env node
// 粒子ツールで液体を置いたときの「飛び散り」を測る。乱数固定。
//
//   node tools/measure-spawn.js            既定（1度に置く数 30）
//   node tools/measure-spawn.js --n 10     1度に置く数を変える
//
// ★飛び散りだけを見るため、重力を 0 にして宙に置く（落下の速さと混ざらない）。
//   静かに置けていれば、置いた粒は凝集でまとまるだけで、速さはほぼ 0 のまま。
// ★条件：
//   click … 1回クリック（1イベントで N 個）
//   drag  … 同じ場所で 20 イベント続けて置く（マウスを押したまま止めている／なぞり始め）
//   pool  … 静止した水たまりの水面すぐ上を、なぞるように 20 イベント置く（重力あり。
//           落下の速さを除くため、測るのは水平方向の速さ）
// ★物差し（置き終わってから 120tick）：
//   ・速さの最大値の時間平均（毎 tick の最大値を平均）と、120tick 中の最大
//   ・置いた中心から 80px より遠くへ出た粒の割合（最後の tick）
//   ・置けた数（置き場が塞がっていると減る＝重ねて置かない）

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
window.__spawnRun = function (mode, n) {
  __seedRandom(777);
  clearScene();
  resetDemoWorld();
  world.sleeping = false;
  const g0 = world.gravY;
  const prevN = particleSpawnPerEvent;
  particleSpawnPerEvent = n;
  particleColor = null;
  particleLiquid = 'water';
  let cx = 0, cy = ground.y - 300, events = 1;
  if (mode === 'pool') {
    // 床の上に静止した水たまり（幅 400px・深さ 60px）を作ってから、水面のすぐ上をなぞる
    const fy = ground.y;
    for (let y = fy - 5.6; y > fy - 60; y -= 11.2)
      for (let x = -200; x < 200; x += 11.2) particles.push(new Particle(x, y, 'fluid'));
    for (let i = 0; i < 300; i++) simTick();
    cy = fy - 75; events = 20;
  } else {
    world.gravY = 0;
    if (mode === 'drag') events = 20;
  }
  const n0 = particles.length;
  const placed0 = new Set(particles.map(p => p.id));
  for (let e = 0; e < events; e++) {
    const x = mode === 'pool' ? cx - 150 + e * 15 : cx;
    spawnParticles({ x, y: cy }, 'fluid');
    simTick();
  }
  const mine = particles.filter(p => !placed0.has(p.id));
  // pool：置いた粒のいちばん高いもの（置き終わった時点）から水面（床から 60px）までを
  //   自由落下したときの着水の速さ √(2gh)。しぶきの速さはこの程度まで出るのが物理として正しい
  let top = Infinity;
  for (const p of mine) if (p.y < top) top = p.y;
  const vff = mode === 'pool' ? Math.sqrt(2 * gravPxY() * Math.max(0, (ground.y - 60) - top)) : 0;
  let sumMax = 0, peak = 0;
  for (let i = 0; i < 120; i++) {
    simTick();
    let m = 0;
    for (const p of mine) {
      const v = mode === 'pool' ? Math.abs(p.vx) : Math.hypot(p.vx, p.vy);
      if (v > m) m = v;
    }
    sumMax += m; if (m > peak) peak = m;
  }
  let far = 0;
  for (const p of mine) {
    const ex = mode === 'pool' ? Math.max(0, Math.abs(p.x - cx) - 150) : p.x - cx;
    const ey = mode === 'pool' ? 0 : p.y - cy;
    if (Math.hypot(ex, ey) > 80) far++;
  }
  world.gravY = g0;
  particleSpawnPerEvent = prevN;
  return { placed: particles.length - n0, meanMax: sumMax / 120, peak,
           farPct: mine.length ? far / mine.length * 100 : 0, vff };
};
`;

(async () => {
  const ni = process.argv.indexOf('--n');
  const N = ni < 0 ? 30 : +process.argv[ni + 1];
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href, { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');
  await page.evaluate(SCRIPT);
  await page.evaluate('stopSim && stopSim()').catch(() => {});
  const rows = [];
  for (const mode of ['click', 'drag', 'pool']) {
    const r = await page.evaluate(([m, n]) => __spawnRun(m, n), [mode, N]);
    rows.push({ 条件: mode, 置けた数: r.placed, '速さ最大の平均[px/s]': +r.meanMax.toFixed(1),
                '速さ最大[px/s]': +r.peak.toFixed(1), '80px より遠く[%]': +r.farPct.toFixed(1),
                '自由落下の着水[px/s]': mode === 'pool' ? +r.vff.toFixed(0) : '—' });
  }
  console.log(`── 1度に置く数 ${N}（置き終わってから 120tick）──`);
  console.table(rows);
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); for (const e of errors) console.error(e); }
  process.exit(errors.length ? 1 : 0);
})();
