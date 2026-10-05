#!/usr/bin/env node
// オームの法則モデルの電流・速さ・詰まりを測る（demos-em.js の★の数値はこれで取る）。
//
//   node tools/measure-ohm.js                        既定のまま
//   node tools/measure-ohm.js --E 7                  電場を上書き（つまみを回した状態）
//   node tools/measure-ohm.js --q -0.002             電気量を上書き（対照）
//   node tools/measure-ohm.js --k 2                  実効クーロン定数を上書き
//   node tools/measure-ohm.js --off --avg 1500       スイッチを切ってから測る（行列の詰まり）
//   node tools/measure-ohm.js --settle 1500 --avg 3000
//
// ★1 tick 読みでは結論が逆転する（CLAUDE.md 第2章）。乱数を固定し、落ち着かせてから
//   時間平均で読む。電流は「左の辺の中央を横切った回数／3000tick」で、★の表と同じ単位。
// ★通路外 は幾何の健全性の見張り。電子が壁をすり抜けていたら、指標より先にこれを疑う
//   （角丸の通路では中心線からの距離、直角の通路では Chebyshev で測る）。
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i+1]; };
const SETTLE = Number(arg('--settle', 1500)), AVG = Number(arg('--avg', 3000));
const E = arg('--E', null), Q = arg('--q', null), K = arg('--k', null);
const OFFSW = process.argv.includes('--off');

const CODE = `
window.__seedRandom = function (seed) {
  let s = seed >>> 0 || 1;
  Math.random = function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
};
// 通路の中心線（角丸長方形）からの距離 [px]
window.__offAxis = function (x, y, CR) {
  const A = Math.abs(OHM_XR), B = Math.abs(OHM_YB);
  const qx = Math.abs(x) - (A - CR), qy = Math.abs(y) - (B - CR);
  if (CR > 0 && qx > 0 && qy > 0) return Math.abs(Math.hypot(qx, qy) - CR);
  return Math.abs(Math.max(qx, qy) - CR);   // 直角の角は通路も四角いので Chebyshev で測る
};
window.__ohm = function (settle, avg, cfg) {
  __seedRandom(20260922);
  // ★窓から開くときと同じ手順を踏む（js/ui/demo-browser.js の runDemo）
  closeToolPopups(); setTool('pointer'); clearScene(); simPause();
  buildingScene = true;
  try { demoOhmModel(); } finally { buildingScene = false; }
  const CR = (typeof OHM_CR === 'number') ? OHM_CR : 0;
  if (cfg.E != null) for (const f of emFields) f.strength = cfg.E;
  if (cfg.k != null) world.coulombK = cfg.k;
  const es = objects.filter(o => o.charge);
  if (cfg.q != null) for (const b of es) b.charge = cfg.q;
  if (cfg.off) objects.find(o => o.label === 'スイッチの板').layers = OHM_LAYER_WALL;
  // 輪の中心は壁（静止した多角形）の重心そのもの。cam から作り直すと開きかたで狂う
  const walls = objects.filter(o => o.isStatic && o.type === 'polygon');
  const CX = walls[0].x, CY = walls[0].y;
  const inRes = b => (b.y - CY) > OHM_YB - OHM_CORR/2 && Math.abs(b.x - CX) <= OHM_RES_HALF;
  for (let i = 0; i < settle; i++) simTick();
  let cross = 0, outside = 0, still = 0, touch = 0;
  let nRes = 0, nWire = 0, sRes = 0, sWire = 0, minGapSum = 0;
  const prev = es.map(b => ({ x:b.x, y:b.y, run:0, still:0 }));
  for (let t = 0; t < avg; t++) {
    const py = es.map(b => b.y);
    simTick();
    for (let i = 0; i < es.length; i++) {
      const b = es[i], p = prev[i];
      // 電流＝左の辺の中央を横切った回数（向きは問わない）
      if (b.x - CX < OHM_XL + OHM_CORR/2 && ((py[i] > CY) !== (b.y > CY))) cross++;
      if (__offAxis(b.x - CX, b.y - CY, CR) > OHM_CORR/2 + 1) outside++;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      p.x = b.x; p.y = b.y; p.run += d;
      if (d < 0.01) { p.still++; still++; }       // 1tick も動かなかった割合
      const v = Math.hypot(b.vx, b.vy);
      if (inRes(b)) { nRes++; sRes += v; } else { nWire++; sWire += v; }
      let mg = 1e9;                               // いちばん近い相手との距離
      for (const o of es) if (o !== b) mg = Math.min(mg, Math.hypot(o.x - b.x, o.y - b.y));
      minGapSum += mg;
      if (mg < 2*OHM_E_R + 0.5) touch++;
    }
  }
  const n = es.length, vw = sWire / Math.max(nWire, 1), vr = sRes / Math.max(nRes, 1);
  return {
    電子: n,
    電流: +(cross / (avg/3000)).toFixed(0),        // ★3000tick あたり（★の表と同じ単位）
    一周の秒: cross ? +(n * avg / 60 / cross).toFixed(1) : '—',   // 流れていなければ出さない
    速さ導線: +vw.toFixed(1), 速さ抵抗: +vr.toFixed(1),
    比: vr > 0.5 ? +(vw / vr).toFixed(2) : '—',
    抵抗滞在率: +(nRes / (n*avg)).toFixed(3),
    隣との距離: +(minGapSum / (n*avg)).toFixed(1),
    接触率: +(touch / (n*avg)).toFixed(3),
    静止率: +(still / (n*avg)).toFixed(3),
    最大静止率: +Math.max(...prev.map(p => p.still/avg)).toFixed(2),
    最短走行: +Math.min(...prev.map(p => p.run)).toFixed(0),
    平均走行: +(prev.reduce((s,p) => s + p.run, 0)/n).toFixed(0),
    通路外: outside,
  };
};
`;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');
  await page.evaluate(CODE);
  const cfg = { E: E == null ? null : Number(E), q: Q == null ? null : Number(Q),
                k: K == null ? null : Number(K), off: OFFSW };
  const r = await page.evaluate(([s, a, c]) => __ohm(s, a, c), [SETTLE, AVG, cfg]);
  console.log(JSON.stringify({ cfg, settle:SETTLE, avg:AVG }));
  console.log(r);
  await browser.close();
  if (errors.length) {
    console.error('--- ページ内エラー ---');
    for (const e of errors) console.error(e);
    process.exit(1);
  }
})();
