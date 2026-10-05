#!/usr/bin/env node
// デモ一覧窓のサムネイルを撮って js/data/demo-thumbs.js に書き出す。
//   node tools/thumbs.js                 目録の全デモを撮り直す
//   node tools/thumbs.js --only 単振動   分野名・単元名・デモ名のどれかに一致するものだけ撮り直す
//                                        （他のデモの絵は既存のファイルから引き継ぐ）
//   node tools/thumbs.js --sheet out.png 撮った絵を並べた確認用の1枚も出す
//
// ★画像ファイルではなく data URI を並べた JS にする。bundle.gs は script / css を
//   埋め込んで1枚の HTML にするだけで、<img src="thumbs/…"> は結合後に切れる。
//   file:// では fetch も使えないので、script で読ませるのが唯一どちらでも動く形。
// ★キーはデモの関数名（fn.name）。デモ名は目録で書き換えることがあるが、
//   関数名は変わりにくい。絵の無いデモは一覧で文字だけのカードになる（壊れない）。
// ★撮るのはキャンバスの絵だけ（canvas から直接写す）。グラフの窓・操作の窓は DOM なので写らない。
//   最初はページのスクリーンショットで撮ったが、右うえのグラフの窓が題材に被って
//   「物体の運動」11件中5件が窓の絵になった（どれも同じに見える）。
// ★切り出す範囲は「題材の外接矩形」から決める（物体・粒子・ばね・回路・場の領域・
//   文字以外の注釈）。本文の札（文字の注釈）は撮る間だけ外す。
//   「題材は画面 x>540」の約束で決め打ちに切ると、台車が左端から出るデモ
//   （正の加速度の運動）で題材が写らなかった。
// ★走らせないと何のデモか分からないもの（投射の軌跡など）は、目録の行に
//   thumbTicks: N を書くと、N tick 回してから撮る。
//   キーで始まるデモ（Enter で打ち出す、など）は thumbKey: 'Enter' も書くと、そのキーの
//   プログラムを発火させてから回す（キーを押さないと、何も起きていない絵になる）。
// ★題材が画面より縦に長いと、切り出しが画面いっぱいまで広がって絵が潰れる
//   （リレーの足し算機：回路の線が 0.24 倍になり、一覧で真っ黒に見えた）。
//   そういうデモは目録の行に thumbCrop: { x, y, w }（基準の窓 998x736 のキャンバス px。
//   高さはサムネイルの縦横比から決まる）を書いて、見どころの部分だけを撮る。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const OUT = path.resolve(__dirname, '..', 'js', 'data', 'demo-thumbs.js');
const THUMB_W = 240, THUMB_H = 150;
const QUALITY = 0.8;           // webp の画質
const PAD = 0.12;              // 題材の外接矩形のまわりに足す余白（辺の長さに対する比）
const MIN_CROP_W = 360;        // [canvas px] 小さな題材でも、これより狭くは切らない（拡大しすぎると潰れる）

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

function loadExisting() {
  if (!fs.existsSync(OUT)) return {};
  const src = fs.readFileSync(OUT, 'utf8');
  const m = src.match(/=\s*(\{[\s\S]*\});?\s*$/);
  return m ? JSON.parse(m[1]) : {};
}

// ページ内で走らせる：いま描かれているキャンバスから題材の部分を切り出して webp にする
function captureInPage({ W, H, q, PAD, MIN_CROP_W, crop }) {
  if (crop) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, crop.x, crop.y, crop.w, crop.w * H / W, 0, 0, W, H);
    return c.toDataURL('image/webp', q);
  }
  // ── 題材の外接矩形（画面座標）──
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => {
    if (!isFinite(x) || !isFinite(y)) return;
    const p = worldToScreen(x, y);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  };
  const addBox = (ax, ay, bx, by) => { add(ax, ay); add(bx, by); add(ax, by); add(bx, ay); };
  for (const o of objects) { const b = o._aabb; addBox(b.minX, b.minY, b.maxX, b.maxY); }
  for (const p of particles) add(p.x, p.y);
  for (const s of slinkies) for (const n of s.nodes || []) add(n.x, n.y);
  for (const e of circuitElements) { add(e.ax, e.ay); add(e.bx, e.by); }
  for (const f of [...emFields, ...heatFields, ...flowFields])
    addBox(f.x - f.w / 2, f.y - f.h / 2, f.x + f.w / 2, f.y + f.h / 2);
  for (const l of [...lasers, ...waveSources]) add(l.x, l.y);
  // ★注釈の点は「左うえの角 (a.x, a.y) からの相対・a.angle で回した」座標で持っている
  //   （annotate.js の Annotation）。素のまま足すとワールドの原点のまわりを切り出す
  //   （実測：線・丸の下書きしか無いチュートリアル4本が、原点付近の地面だけの絵になっていた）。
  //   画面に貼った注釈（screenPin）は画面 px なので外す。文字は従来どおり数えない（本文が
  //   画面の左うえ全体を占めるので、数えると題材が小さくなる）。
  const annotPt = (a, lx, ly) => {
    const c = Math.cos(a.angle || 0), s = Math.sin(a.angle || 0);
    add(a.x + lx * c - ly * s, a.y + lx * s + ly * c);
  };
  for (const a of annotations) {
    if (a.screenPin || a._inText) continue;   // ★_inText は本文に並べたアイコン（demos-tutorial.js）
    for (const p of a.pts || []) annotPt(a, p.x, p.y);
    if (a.type === 'text' && a._thumbKeep) {
      const m = annotSize(a);
      annotPt(a, 0, 0); annotPt(a, m.w, 0); annotPt(a, 0, m.h); annotPt(a, m.w, m.h);
    }
    if (a.type === 'ellipse') {
      const w = a.rx * 2 + a.width, h = a.ry * 2 + a.width;
      annotPt(a, 0, 0); annotPt(a, w, 0); annotPt(a, 0, h); annotPt(a, w, h);
    }
  }
  const cw = canvas.width, ch = canvas.height;
  if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = cw; y1 = ch; }
  // ── 余白を足し、サムネイルの縦横比へ広げる ──
  let w = (x1 - x0) * (1 + 2 * PAD), h = (y1 - y0) * (1 + 2 * PAD);
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  w = Math.max(w, MIN_CROP_W, h * W / H);
  h = w * H / W;
  // 画面より大きければ画面に収まるまで縮める（縦横比は保つ＝はみ出た題材は切れる）
  if (w > cw) { w = cw; h = w * H / W; }
  if (h > ch) { h = ch; w = h * W / H; }
  cx = Math.min(Math.max(cx, w / 2), cw - w / 2);
  cy = Math.min(Math.max(cy, h / 2), ch - h / 2);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, cx - w / 2, cy - h / 2, w, h, 0, 0, W, H);
  return c.toDataURL('image/webp', q);
}

(async () => {
  const only = arg('--only');
  const sheet = arg('--sheet');
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  // ★1280x800 でキャンバスが 998x736 ＝ デモの基準の窓（DEMO_REF_W/H）と同じ大きさになる
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  let current = '(起動)';
  page.on('pageerror', e => errors.push(`${current}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${current}: ${m.text()}`); });
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const { list, alive } = await page.evaluate(only => {
    const list = [], alive = [];
    for (const f of DEMO_CATALOG) for (const u of f.units) for (const d of u.demos) {
      if (!d.fn) continue;
      alive.push(d.fn.name);
      if (only && ![f.field, u.name, d.name].includes(only)) continue;
      list.push({ key: d.fn.name, name: d.name, crop: d.thumbCrop || null });
    }
    return { list, alive };
  }, only);
  console.log(`デモ ${list.length} 件を撮ります`);

  const thumbs = loadExisting();
  for (const { key, name, crop } of list) {
    current = name;
    await page.evaluate(key => {
      let d = null;
      for (const f of DEMO_CATALOG) for (const u of f.units) for (const x of u.demos)
        if (x.fn && x.fn.name === key) d = x;
      // ★窓から開くときと同じ手順（js/ui/demo-browser.js の runDemo）
      closeToolPopups(); setTool('pointer'); clearScene(); simPause();
      buildingScene = true;
      try { d.fn(); } finally { buildingScene = false; }
      updatePropsPanel(null); syncWorldPanel();
      if (d.thumbKey) fireProgramsByKey(d.thumbKey);   // ★キーで始まるデモ（冒頭の★）
      for (let t = 0; t < (d.thumbTicks || 0); t++) simTick();
      // 本文の札を外して描き直させる（撮り終えたら戻す）
      window.__annotKeep = annotations;
      annotations = annotations.filter(a => a.type !== 'text' || a._thumbKeep);   // ★_thumbKeep は下書きの札（demos-tutorial.js の tutBadge）
    }, key);
    await page.waitForTimeout(80);   // 描画を数フレーム回す
    thumbs[key] = await page.evaluate(captureInPage,
      { W: THUMB_W, H: THUMB_H, q: QUALITY, PAD, MIN_CROP_W, crop });
    await page.evaluate(() => { annotations = window.__annotKeep; });
  }

  // 目録に無くなったデモの絵は捨てる
  const aliveSet = new Set(alive);
  for (const k of Object.keys(thumbs)) if (!aliveSet.has(k)) delete thumbs[k];

  const body = '// ★自動生成（node tools/thumbs.js）。手で書き換えない。\n' +
    '//   デモ一覧窓（js/ui/demo-browser.js）のサムネイル。キーはデモの関数名。\n' +
    'const DEMO_THUMBS = ' + JSON.stringify(thumbs).replace(/","/g, '",\n"') + ';\n';
  fs.writeFileSync(OUT, body);
  console.log(`書き出し: ${OUT}（${Object.keys(thumbs).length} 件、${(body.length / 1024).toFixed(0)} KB）`);
  await page.close();

  if (sheet) {
    const sp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await sp.setContent('<body style="margin:0;background:#111;display:flex;flex-wrap:wrap;gap:6px;padding:6px;width:1260px;font:12px sans-serif;color:#ccc">' +
      list.map(x => `<div><img src="${thumbs[x.key]}" style="display:block"><div>${x.name}</div></div>`).join('') + '</body>');
    await sp.screenshot({ path: path.resolve(sheet), fullPage: true });
    console.log(`確認用: ${path.resolve(sheet)}`);
  }

  await browser.close();
  if (errors.length) {
    console.error('--- ページ内エラー ---');
    for (const e of errors.slice(0, 40)) console.error(e);
    process.exit(1);
  }
})();
