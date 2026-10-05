// ════════════════════════════════════════
//  チュートリアル（はじめて触る生徒向け）
// ════════════════════════════════════════
//  ★2026-09-28、ユーザーの指示で新設。読み手は生徒。1枚に1つの機能だけを紹介し、
//    画面の文字だけで「何を押すと何が起きるか」を辿れるようにする。
//  ★シーンの中の注釈はツールバーやパネルを指せない（ワールド座標なのでキャンバスの縁まで）。
//    ボタンは「上の ▶実行」「左の □」のように場所と見た目を文字で書いて補う。
//    ★説明は画面上のボタンで書き、ショートカットキーは（　）書きで添える（ユーザーの指示）。
//    ★↶ などの記号は本文のフォントに無く化ける（実測）。アイコンのボタンは形を言葉で書く。
//  ★「実行する前に戻す」は シミュレーション ›「実行前に戻す」で書く（2026-09-28）。上の戻るボタンは
//    編集の取り消しで、実行してから押すとその前の編集（置いた物・変えた値）まで消える（history.js の★）。
//    戻るボタンと書くのは「置いた物を取り消す」ときだけ。
//  ★進み具合は検知しない。手順は番号付きで1枚に並べ、どこからやり直してもよい形にする。

// 画面の x（基準の窓 998px での位置）をワールドの x へ。★題材は本文の右（画面 x>540）に置く
function tutScreenX(sx) {
  return cam.x + (sx * demoFitScale() - canvas.width / 2) / cam.zoom;
}
function tutScreenY(sy) {
  return cam.y + (sy * demoFitScale() - canvas.height / 2) / cam.zoom;
}

// ── ボタンのアイコン ───────────────────────────────────────
//  ★本文ではボタン名の横にアイコンを並べる（2026-09-28、ユーザーの指示）。名前だけだと、
//    左のツールバーの縦に並んだ小さな絵のどれを押すのか、初めての生徒には探しにくい。
//  ★注釈は文字・折れ線・楕円しか持たない（手で作れる部品だけで組む約束）。そこでツールバーの
//    SVG の記号（<symbol id="ti-…">）をその場でなぞり、お絵描きの折れ線として置く。
//    記号を手で写し直すと、アイコンを描き直したときに本文だけ古い絵のまま残るので、
//    必ず画面の記号そのものから作る。色も記号の色（style="color:…" と 2色目の stroke）をそのまま使う。
//  ★塗りだけの図形（一時停止の2本の棒・気体の粒など）は輪郭の線になる。
const _tutIconCache = {};
function tutIconStrokes(symId) {
  if (_tutIconCache[symId]) return _tutIconCache[symId];
  const out = [];
  const sym = document.getElementById(symId);
  if (!sym) return out;
  const NS = 'http://www.w3.org/2000/svg';
  // ★長さを測るには描画される木の中に置く必要がある（display:none の <svg> の中では測れない）
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
  svg.style.cssText = 'position:absolute;left:-9999px;top:0;color:#eceff1;stroke:currentColor;fill:none';
  const g = document.createElementNS(NS, 'g');
  const st = sym.getAttribute('style');
  if (st) g.setAttribute('style', st);
  for (const c of sym.children) g.appendChild(c.cloneNode(true));
  svg.appendChild(g);
  document.body.appendChild(svg);
  const toHex = c => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    return m ? '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('') : c;
  };
  const sample = el => {
    const cs = getComputedStyle(el);
    const col = cs.stroke && cs.stroke !== 'none' ? cs.stroke : cs.fill;
    if (!col || col === 'none') return;
    const L = el.getTotalLength ? el.getTotalLength() : 0;
    if (!(L > 0)) return;
    // ★0.4 単位（24 単位の箱）ごとに拾う。本文の大きさでは画面 0.3px 間隔＝折れ目は見えない。
    //   M で飛ぶところ（1本の path に離れた線が複数ある）は、隣の点との距離で切り分ける。
    const n = Math.max(2, Math.ceil(L / 0.4));
    let cur = [], prev = null;
    for (let i = 0; i <= n; i++) {
      const q = el.getPointAtLength(L * i / n);
      if (prev && Math.hypot(q.x - prev.x, q.y - prev.y) > 1.2) {
        if (cur.length > 1) out.push({ col: toHex(col), pts: cur });
        cur = [];
      }
      cur.push({ x: q.x, y: q.y }); prev = q;
    }
    if (cur.length > 1) out.push({ col: toHex(col), pts: cur });
  };
  const walk = el => { for (const c of el.children) (c.tagName === 'g' ? walk : sample)(c); };
  walk(g);
  svg.remove();
  return (_tutIconCache[symId] = out);
}
// アイコンを左うえ (x, y)・一辺 s のワールド px で置く。線の太さはツールバーと同じ比（1.7/24）
function tutIcon(symId, x, y, s) {
  const k = s / 24;
  for (const st of tutIconStrokes(symId))
    // ★_inText：本文の一部（サムネイルの切り出しで文字と同じく数えない。tools/thumbs.js）
    demoPath(st.pts.map(q => ({ x: x + q.x * k, y: y + q.y * k })), st.col, Math.max(1.5, 1.7 * k))._inText = true;
}
// ボタンの記号と名前を画面のボタンから引く（名前を本文に二重に持たない）
function tutButton(id) {
  const b = document.getElementById(id);
  if (!b) return { sym:null, label:id };
  const u = b.querySelector('use');
  const lab = b.querySelector('.label') || b.querySelector('.lbl');
  return { sym: u ? (u.getAttribute('href') || '').replace(/^#/, '') : null,
           label: (lab ? lab.textContent : b.textContent).trim() };
}

// 左うえに題名と手順を置く。★本文は画面の幅 500px に収める（1行 33字ほどまで）
//  ★本文の {t-pointer} は「アイコン＋ボタン名」に置き換わる。{btn-reset|戻る} のように | の後ろを
//    書くと名前を差し替える（戻るボタンは画面に名前が出ていない）。
//  ★1行を「文字・アイコン・文字…」に割って横に並べる。行送りは注釈の行送り（ANNOT_LINE_H）と同じ。
//  ★pin を渡すと画面に貼る（カメラを物体に接続する回。ワールドに置くと画面が動いたときに流れて消える）。
//    大きさは demoTitlePinned / demoNotePinned と同じ画面 px。
function tutText(title, lines, pin) {
  let p, size, lh, isz, gap, y;
  if (pin) {
    demoTitlePinned(title);
    p = { x: DEMO_PIN_MARGIN, y: DEMO_PIN_MARGIN };
    size = DEMO_PIN_NOTE; y = p.y + 35;
  } else {
    p = demoTextTopLeft();
    demoTitle(p.x, p.y, title);
    size = DEMO_NOTE_SIZE; y = p.y + 54;
  }
  lh = size * ANNOT_LINE_H; isz = size * 1.3; gap = size * 0.2;
  const before = annotations.length;
  for (const line of lines) {
    let x = p.x, last = 0, m;
    const put = t => {
      if (!t) return;
      demoNote(x, y, t, size);   // ★pin のときも同じ座標系（最後にまとめて screenPin にする）
      x += annotMeasure(t, size, undefined, false).w;
    };
    const re = /\{([a-z-]+)(?:\|([^}]*))?\}/g;
    while ((m = re.exec(line))) {
      put(line.slice(last, m.index));
      const b = tutButton(m[1]);
      if (b.sym) { tutIcon(b.sym, x + gap / 2, y + (lh - isz) / 2, isz); x += isz + gap; }
      put(m[2] !== undefined ? m[2] : b.label);
      last = re.lastIndex;
    }
    put(line.slice(last));
    y += lh;
  }
  if (pin) for (let i = before; i < annotations.length; i++) annotations[i].screenPin = true;
}
// 下書きに付ける手順の番号（丸で囲んだ数字＋ひとこと）。★番号は左うえの手順の番号と揃える。
const TUT_BADGE_COLOR = '#ffca28';
function tutBadge(x, y, n, text) {
  const r = 15, size = 22;
  annotations.push(new Annotation({ type:'ellipse', x:x - r - 1.5, y:y - r - 1.5, rx:r, ry:r,
    color:TUT_BADGE_COLOR, width:3 }));
  // ★_thumbKeep：サムネイルにも残す文字（tools/thumbs.js は文字の注釈を外して撮るが、
  //   下書きしか無い回は番号と名前が消えると空の丸だけの絵になる）
  const t = String(n), w = annotMeasure(t, size, undefined, true).w;
  const put = o => { const an = new Annotation(o); an._thumbKeep = true; annotations.push(an); };
  put({ type:'text', x:x - w / 2, y:y - size * ANNOT_LINE_H / 2, text:t, size, bold:true, color:TUT_BADGE_COLOR });
  if (text) put({ type:'text', x:x + r + 8, y:y - size * ANNOT_LINE_H / 2, text, size, bold:true, color:TUT_BADGE_COLOR });
}
const TUT_EDGE = { strokeColor:'#263238', strokeWidth:1.5 };
function tutBody(o) { const b = new Body(Object.assign({}, TUT_EDGE, o)); objects.push(b); return b; }
function tutWall(x, y, w, h) {
  return tutBody({ type:'box', isStatic:true, x, y, w, h, fillColor:'#78909c' });
}
// 共通の始め方。★倍率はどの回も 0.65（文字の大きさと題材の置き場所を揃える）
function tutBegin() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.65);
  return ground.y;
}

// ════════════════════════════════════════
//  はじめの一歩
// ════════════════════════════════════════

// ── 1 動かしてみる（実行・停止・戻す・つかむ）──────────────────
//   ★最初の1枚なので、置いてある物を動かすだけ。何も作らせない。
//     坂の球が転がって積み木を崩す＝押した瞬間に何かが起きて、元に戻したくなる題材にした。
function demoTutorialRun() {
  const gy = tutBegin();
  // 坂（左が高い）
  const RX = tutScreenX(650), RW = 120, RH = 150;
  tutBody({ type:'polygon', isStatic:true, x:RX, y:gy, fillColor:'#78909c',
    verts:[{ x:-RW, y:-RH }, { x:RW, y:0 }, { x:-RW, y:0 }] });
  // 坂の上の球
  tutBody({ type:'circle', x:RX - RW + 22, y:gy - RH - 22, radius:20, mass:1, fillColor:'#ef5350' });
  // 積み木（3段×2列）
  const BX = tutScreenX(880), S = 40;
  const colors = ['#42a5f5', '#66bb6a', '#ffca28'];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 2; col++)
      tutBody({ type:'box', x:BX + (col - 0.5) * S, y:gy - S / 2 - row * S, w:S, h:S, mass:0.3,
        fillColor:colors[row] });
  tutText('1 動かしてみる', [
    '1. 上の {btn-play} ボタンを押す（Z）',
    '　 → 球が坂を転がって、積み木にぶつかる',
    '2. 同じ場所の {btn-pause} ボタンを押すと止まる（Z）',
    '3. 上の シミュレーション →「実行前に戻す」で、',
    '　 実行する前の位置に戻る',
    '4. 左の {t-pan} ボタンを選び、実行中に物体をドラッグ',
    '　 （Space を押している間も つかむ になる）',
    '　 → つかんで動かせる。勢いをつけて放すと投げられる',
    '',
    '何度でもやり直してよい。崩しても「実行前に戻す」で元どおり',
    '（上の {btn-reset|戻る} ボタンは、置いた物・変えた設定の取り消し。',
    '　 実行したあとに押すと、その前にした変更まで消える）']);
}

// ── 3 形を描く（円・四角・三角・多角形・フリー）─────────────────
//   ★何も置かない。描く場所の目安に点線の枠だけ引く（注釈なので物理には無関係）。
function demoTutorialShapes() {
  const gy = tutBegin();
  const x0 = tutScreenX(570), x1 = tutScreenX(970), y0 = gy - 560, y1 = gy - 60;
  const c = '#90a4ae';
  demoDashedPath(x0, y0, x1, y0, c); demoDashedPath(x1, y0, x1, y1, c);
  demoDashedPath(x1, y1, x0, y1, c); demoDashedPath(x0, y1, x0, y0, c);
  // ★手順 1〜4 の番号を、描く場所の目安として枠の四隅に置く（左うえの番号と揃える）
  const bx = [x0 + 40, (x0 + x1) / 2 + 30], by = [y0 + 40, (y0 + y1) / 2 + 30];
  tutBadge(bx[0], by[0], 1, '円');
  tutBadge(bx[1], by[0], 2, '四角・三角');
  tutBadge(bx[0], by[1], 3, '多角形');
  tutBadge(bx[1], by[1], 4, 'フリー');
  tutText('3 形を描く', [
    '1. 左の {t-circle} ボタンを選び、中心から外へドラッグ',
    '　 → 放すと円ができる（Shift を押すと真円）',
    '2. {t-box} … 角から向かいの角へドラッグ',
    '　 {t-triangle} … 直角になる角からドラッグ',
    '3. {t-polygon} … 角を1つずつクリックし、',
    '　 最初の点をもう一度クリックして閉じる',
    '4. {t-freehand} … なぞって放すと、その形になる',
    '5. 左上の {t-pointer} ボタンで描く道具をやめる（Esc）',
    '6. {btn-play} すると、描いた形が落ちてぶつかる（Z）']);
}

// ── 4 選んで動かす・増やす・消す（編集ツール）───────────────────
function demoTutorialEdit() {
  const gy = tutBegin();
  tutBody({ type:'box', x:tutScreenX(620), y:gy - 40, w:90, h:80, mass:1, fillColor:'#42a5f5' });
  tutBody({ type:'circle', x:tutScreenX(760), y:gy - 40, radius:40, mass:1, fillColor:'#ef5350' });
  tutBody({ type:'polygon', x:tutScreenX(900), y:gy, mass:1, fillColor:'#66bb6a',
    verts:[{ x:-45, y:-80 }, { x:45, y:0 }, { x:-45, y:0 }] });
  tutText('4 選んで動かす・増やす・消す', [
    '1. 左上の {t-pointer} ボタンを選ぶ（Esc）',
    '2. 物体をクリックすると選ばれ、右にプロパティが出る',
    '3. ドラッグで移動する。選択枠の ■ で大きさ、',
    '　 ○ で向きを変えられる',
    '4. 右クリック →「複製」で同じ物体が増える',
    '　 （Ctrl+C のあと Ctrl+V でも）',
    '5. 右クリック →「削除」で消える（Delete）',
    '6. 何もない所からドラッグすると、',
    '　 囲んだ物体をまとめて選べる']);
}

// ── 5 性質を変える（プロパティの反発係数・質量・色）─────────────
//   ★同じ球を2つ並べ、片方だけ変えて比べる。反発係数は差が一目で出る。
//     質量は「変えても落ち方は同じ」を見せる（空気抵抗なし）。
function demoTutorialProps() {
  const gy = tutBegin();
  const xa = tutScreenX(680), xb = tutScreenX(860), y = gy - 420;
  tutBody({ type:'circle', x:xa, y, radius:28, mass:1, fillColor:'#42a5f5' });
  tutBody({ type:'circle', x:xb, y, radius:28, mass:1, fillColor:'#42a5f5' });
  demoLabel(xa - 12, y - 80, 'A', '#eceff1', 30);
  demoLabel(xb - 12, y - 80, 'B', '#eceff1', 30);
  tutText('5 性質を変える', [
    '1. {btn-play} すると、A と B は同じように跳ねる',
    '2. シミュレーション →「実行前に戻す」で戻し、',
    '　 左上の {t-pointer} ボタンで B を選ぶ',
    '3. 右の プロパティ の「反発係数」を 0.9 にする',
    '　 → {btn-play} すると、B のほうが高く跳ね返る',
    '4. 今度は「質量」を大きくしてみる',
    '　 → 落ちる速さは変わらない',
    '5. 下のほうの 外観 の「塗りつぶし」で色も変えられる',
    '',
    '何もない所をクリックすると、選ぶのをやめられる']);
}

// ════════════════════════════════════════
//  組み立てる
// ════════════════════════════════════════

// ── 6 固定とヒンジ ─────────────────────────────────────
function demoTutorialPin() {
  const gy = tutBegin();
  tutBody({ type:'box', x:tutScreenX(700), y:gy - 520, w:260, h:24, mass:1, fillColor:'#ffb74d' });
  tutBody({ type:'box', x:tutScreenX(900), y:gy - 420, w:40, h:160, mass:1, fillColor:'#ab47bc' });
  demoLabel(tutScreenX(610), gy - 590, '板', '#eceff1', 24);
  demoLabel(tutScreenX(880), gy - 540, '棒', '#eceff1', 24);
  tutText('6 背景に留める', [
    '1. {btn-play} すると、板も棒も落ちる。',
    '　 シミュレーション →「実行前に戻す」で戻す',
    '2. {t-pointer} ボタンで 板 を選び、プロパティの',
    '　 「背景に固定」にチェック（右クリックにもある）',
    '　 → {btn-play} しても板は宙に止まったまま',
    '3. 左の {t-hinge} ボタンを選び、棒の上の端をクリック',
    '　 → 棒がそこで背景に留まる',
    '4. {t-pan} ボタンで棒を横に引いて放す',
    '　 → ヒンジを中心に振り子のように揺れる',
    '',
    '溶接 は、重なった2つの物体の上をクリックすると',
    '1つにくっつける（ヒンジと違って回らない）']);
}

// ── 7 ばね・ロープ・連結棒 ─────────────────────────────────
function demoTutorialConnect() {
  const gy = tutBegin();
  const cx = tutScreenX(770), top = gy - 640;
  tutWall(cx, top, 420, 20);
  const xs = [cx - 140, cx, cx + 140], names = ['A', 'B', 'C'];
  xs.forEach((x, i) => {
    tutBody({ type:'circle', x, y:top + 260, radius:22, mass:1, fillColor:['#42a5f5', '#66bb6a', '#ffca28'][i] });
    demoLabel(x - 10, top + 300, names[i], '#eceff1', 26);
  });
  demoLabel(cx - 40, top - 50, '天井', '#eceff1', 24);
  tutText('7 ばね・ロープ・連結棒でつなぐ', [
    '1. 左の {t-slinky} ボタンを選び、天井 → 球A の順にクリック',
    '2. {t-rope} ボタンで、天井 → 球B の順にクリック',
    '3. {t-rod} ボタンで、天井 → 球C の順にクリック',
    '4. {btn-play} する',
    '　 A … 伸び縮みして上下に揺れる',
    '　 B … ぴんと張って止まる（押せばたるむ）',
    '　 C … 長さが決して変わらない',
    '5. {t-pan} ボタンで球を横に引いて放すと振り子になる',
    '',
    '端を何もない所でクリックすると、そこに留まる']);
}

// ── 10 動力とモーター ──────────────────────────────────────
function demoTutorialMotor() {
  const gy = tutBegin();
  tutWall(tutScreenX(975), gy - 60, 20, 120);
  tutBody({ type:'box', x:tutScreenX(610), y:gy - 25, w:80, h:50, mass:2, fillColor:'#42a5f5' });
  tutBody({ type:'box', x:tutScreenX(820), y:gy - 450, w:220, h:20, mass:1, fillColor:'#ab47bc' });
  demoLabel(tutScreenX(585), gy - 95, '箱', '#eceff1', 24);
  demoLabel(tutScreenX(790), gy - 520, '羽根', '#eceff1', 24);
  tutText('10 動力とモーター', [
    '1. 左の {t-thruster} ボタンを選び、箱の上をクリック',
    '　 → 押したい向きの先をもう一度クリック',
    '2. {btn-play} → 動力に押されて箱が動き出す',
    '3. シミュレーション →「実行前に戻す」で戻し、',
    '　 左の {t-axle} ボタンを選ぶ',
    '4. 羽根の中心をクリック → 背景に留めた軸ができる',
    '5. {btn-play} → モーターが羽根を回す',
    '',
    '動力は実行しているあいだずっと押し続ける。',
    'キーで入り切りしたいときは 11「リモコンで動かす」へ']);
}

// ── 11 リモコン ───────────────────────────────────────────
//   ★動力は最初から付けておく（付け方は 10 で済んでいる）。リモコンの無い動力は
//     ずっと押し続けるので、付ける前に実行すると台車が壁まで走る＝違いが見える。
function demoTutorialRemote() {
  const gy = tutBegin();
  tutWall(tutScreenX(560), gy - 60, 20, 120);
  tutWall(tutScreenX(975), gy - 60, 20, 120);
  const cart = tutBody({ type:'box', x:tutScreenX(760), y:gy - 20, w:90, h:40, mass:2,
    friction:0.2, frictionStatic:0.2, fillColor:'#42a5f5' });
  cart.thrusters.push(new Thruster({ force:10, dir:0 }, cart));
  demoLabel(tutScreenX(725), gy - 95, '台車', '#eceff1', 24);
  tutText('11 リモコンで動かす', [
    '台車には右向きの動力が付いている。',
    '1. {btn-play} すると、台車は右の壁まで押され続ける',
    '2. シミュレーション →「実行前に戻す」で戻し、',
    '　 左の {t-remote} ボタンで台車をクリック',
    '　 → 小さな窓が出る。キーは → になっている',
    '3. {btn-play} → → キーを押している間だけ動力が効く',
    '4. もう一度 台車にリモコンを付け、窓の「キー」を',
    '　 押してから ← キーを押す。動きを',
    '　 「押すと 逆に効く」にする → ← で左へ戻る']);
}

// ════════════════════════════════════════
//  調べる
// ════════════════════════════════════════

// ── 12 速度を与えて投げる・軌跡・ストロボ ─────────────────────
function demoTutorialVelocity() {
  const gy = tutBegin();
  tutBody({ type:'circle', x:tutScreenX(580), y:gy - 22, radius:22, mass:1, fillColor:'#ef5350' });
  const BX = tutScreenX(920), S = 36;
  for (let row = 0; row < 4; row++)
    tutBody({ type:'box', x:BX, y:gy - S / 2 - row * S, w:S, h:S, mass:0.3, fillColor:'#ffca28' });
  tutText('12 速度を与えて投げる', [
    '1. 左の {t-velocity} ボタンを選ぶ',
    '2. 球を押して、飛ばしたい向きと逆へ引いて放す',
    '　 （パチンコのように。引いた長さが速さになる）',
    '3. {btn-play} → 放物線を描いて飛ぶ',
    '4. 左の {t-tracer} ボタンで球をクリック',
    '　 → 実行すると、通った道すじが線で残る',
    '5. 上の {btn-strobe|ストロボ} ボタンを押す',
    '　 → 一定の時間ごとの位置が残る',
    '',
    '右上の積み木を倒せるか、角度と速さを変えて試そう']);
}

// ── 13 力の矢印とグラフ ────────────────────────────────────
//   ★斜面をすべる箱：重力・垂直抗力・摩擦力の3本が別々の向きに出る。
//     傾き 30°（tan30°=0.58）に対して静止摩擦は 0.6×0.6=0.36（合成は積）＝必ずすべり出す。
function demoTutorialGraph() {
  const gy = tutBegin();
  const RX = tutScreenX(760), RW = 190, RH = 220;   // tan(RH/2RW) ≒ 30°
  tutBody({ type:'polygon', isStatic:true, x:RX, y:gy, fillColor:'#78909c',
    verts:[{ x:-RW, y:-RH }, { x:RW, y:0 }, { x:-RW, y:0 }] });
  const ang = Math.atan2(RH, 2 * RW);
  const s = 0.2, h = 40;                      // 斜面の上から 2割の位置
  const sx = RX - RW + 2 * RW * s, sy = gy - RH * (1 - s);
  tutBody({ type:'box', x:sx + Math.sin(ang) * h / 2, y:sy - Math.cos(ang) * h / 2, w:60, h,
    angle:ang, mass:1, fillColor:'#42a5f5' });
  tutText('13 力の矢印とグラフ', [
    '1. 左上の {t-pointer} ボタンで箱を選ぶ',
    '2. プロパティの 表示 で「力を表示」と',
    '　 「速度を表示」にチェック（右クリックにもある）',
    '3. プロパティの グラフ の「変位・速度・加速度」を押す',
    '　 → グラフの窓が開く',
    '4. {btn-play} → 箱がすべり下り、',
    '　 速度のグラフが一定の割合で増えていく',
    '5. 矢印は 重力・垂直抗力・摩擦力 の3本',
    '',
    'グラフの窓は右上の × で閉じる']);
}

// ════════════════════════════════════════
//  いろいろな道具
// ════════════════════════════════════════

// ── 17 水と気体 ─────────────────────────────────────────
function demoTutorialFluid() {
  const gy = tutBegin();
  // 左：上の開いた水槽
  const wx = tutScreenX(680), ww = 220, wh = 200;
  tutWall(wx - ww / 2, gy - wh / 2, 16, wh);
  tutWall(wx + ww / 2, gy - wh / 2, 16, wh);
  demoLabel(wx - 40, gy - wh - 50, '水槽', '#eceff1', 24);
  // 右：閉じた箱（気体が逃げないように）
  const bx = tutScreenX(900), bw = 150, bh = 200, by = gy - 380;
  tutWall(bx, by - bh / 2, bw + 16, 16);
  tutWall(bx, by + bh / 2, bw + 16, 16);
  tutWall(bx - bw / 2, by, 16, bh);
  tutWall(bx + bw / 2, by, 16, bh);
  demoLabel(bx - 30, by - bh / 2 - 50, '箱', '#eceff1', 24);
  tutText('17 水と気体', [
    '1. 左の {t-particle} ボタンで 液体 を選び、水槽をドラッグ',
    '　 → 水の粒が入る',
    '2. {btn-play} → 水が底にたまって水面ができる',
    '3. 円 を描いて水に落としてみる',
    '　 （プロパティの「密度」で浮き沈みが変わる）',
    '4. 同じ窓で 気体 に切り替え、箱の中をドラッグ',
    '　 → 気体の分子が飛び回り、壁にぶつかり続ける']);
}

// ── 18 光と波 ──────────────────────────────────────────
function demoTutorialLight() {
  const gy = tutBegin();
  // ★手順の番号を置き場所の目安に：1 レーザーの出る所 → 2 凸レンズ（点線が置く位置）→ 3 波源
  const ly = gy - 600, lensX = tutScreenX(820);
  tutBadge(tutScreenX(590), ly - 50, 1, 'レーザー');
  tutBadge(lensX, ly - 150, 2, '凸レンズ');
  demoDashedPath(lensX, ly - 110, lensX, ly + 110, '#90a4ae');
  tutBadge(tutScreenX(700), gy - 250, 3, '波源');
  tutText('18 光と波', [
    '1. 左の {t-laser} ボタンを選び、光の出る所をクリック',
    '　 → 向ける先をもう一度クリック',
    '2. 左の {t-optic} ボタンを押し、窓で 凸レンズ を選ぶ',
    '　 → 光の通り道を横切るようにドラッグして置く',
    '　 → 光がレンズで曲げられる',
    '3. 左の {t-wave} ボタンを選び、何もない所をクリック',
    '4. {btn-play} → 水面の波が輪になって広がる',
    '　 波源をもう1つ置くと、波が重なり合う']);
}

// ── 19 文字と保存 ────────────────────────────────────────
function demoTutorialSave() {
  const gy = tutBegin();
  tutBadge(tutScreenX(600), gy - 560, 1, '文字はこのあたり');
  tutBadge(tutScreenX(600), gy - 380, 2, '絵はこのあたり');
  tutText('19 文字を書く・保存する', [
    '1. 左の {t-text} ボタンを選び、何もない所をクリック',
    '　 → 文字を書ける。Ctrl+Enter か外をクリックで確定',
    '2. 左の {t-draw} ボタンで、線や丸を描ける',
    '　 （どちらも物体とはぶつからない）',
    '3. 上の シーン →「シーンを保存」でファイルに保存（Ctrl+S）',
    '4. シーン →「シーンを読み込み」で保存した続きから',
    '5. シーン →「新規作成(クリア)」で何もない画面に',
    '6. シーン →「デモシーンを読み込み…」で',
    '　 物理のいろいろなデモを開ける']);
}

// ════════════════════════════════════════
//  電気と磁気
// ════════════════════════════════════════
// ★電荷の2本は真上から見た図（重力 0・地面なし）。横から見た図だと、電荷の力より先に
//   球が床へ落ちて転がり、何に押されたのかが分からない。

// ── 21 電荷どうしの力 ───────────────────────────────────
//   ★電荷は生徒が入れる（最初は 0）。値は ±0.5 C を案内する：
//     実測（質量 0.3kg・2m 離して同符号 0.5C）2秒で 3.4m まで離れる＝見て分かる速さ。
//     1C だと 6.1m で画面の外へ出る。
function demoTutorialCharge() {
  resetDemoWorld();
  setDemoGravity(0);
  updateGroundTerrain(false);
  setDemoCam(0, 0.65);
  const cy = cam.y + 60;
  const xs = [tutScreenX(650), tutScreenX(820)], names = ['A', 'B'];
  xs.forEach((x, i) => {
    tutBody({ type:'circle', x, y:cy, radius:22, mass:0.3, fillColor:['#ef5350', '#42a5f5'][i] });
    demoLabel(x - 10, cy - 70, names[i], '#eceff1', 26);
  });
  demoLabel(tutScreenX(600), cy + 120, '真上から見た図（重力なし）', '#90a4ae', 20);
  tutText('21 電荷どうしの力', [
    '1. 左上の {t-pointer} ボタンで 球A を選び、',
    '　 プロパティの「電荷 q」を 0.5 にする',
    '2. 球B も 0.5 にする',
    '3. {btn-play} → A と B は離れていく',
    '　 （同じ符号の電荷は反発する）',
    '4. シミュレーション →「実行前に戻す」で戻し、',
    '　 B を -0.5 にする',
    '　 → {btn-play} すると、引き合って近づく',
    '5. 上の 表示 →「場の表示」→「電気力線を表示」',
    '　 → 電荷のまわりの電気力線が見える']);
}

// ── 22 電場と磁場 ──────────────────────────────────────
//   ★球は1つだけ（2つ置くと互いのクーロン力で軌道が曲がり、場の効きと混ざる）。
//   ★実測（質量 0.3kg・電荷 1C・2m/s）：磁場の既定 0.5T で半径 1.2m の円（r = mv/qB どおり）。
//     ★円は球の下側へ直径 2.4m ぶん広がる（＋の電荷・磁場は既定の手前向き）。球の右側だけを
//     囲むと、入った縁で半円を描いて場の外へ戻る（実測）。だから「球ごと・下を広めに」と案内する。
//     電場の既定 5 V/m では加速度 17m/s² で、1秒足らずで枠の外へ飛び出し放物線に見えない（実測）。
//     強さ 0.5 に下げさせる：1.7m/s² で、3m の枠を渡るあいだに 1.9m 曲がる。
function demoTutorialFields() {
  resetDemoWorld();
  setDemoGravity(0);
  updateGroundTerrain(false);
  setDemoCam(0, 0.65);
  const y = cam.y - 60, x = tutScreenX(590);
  tutBody({ type:'circle', x, y, radius:16, mass:0.3, charge:1, vx:200, fillColor:'#ef5350' });
  demoLabel(x - 20, y - 70, '＋の電荷の球（右へ進む）', '#eceff1', 20);
  demoArrow(x + 30, y - 13, 90, 1, '#ef5350');
  demoLabel(tutScreenX(600), y + 300, '真上から見た図（重力なし）', '#90a4ae', 20);
  tutText('22 電場と磁場', [
    '1. {btn-play} → 球はまっすぐ進む。',
    '　 シミュレーション →「実行前に戻す」で戻す',
    '2. 左の {t-bfield} ボタンを選び、球ごと大きく囲むように',
    '　 ドラッグする（球より下を広めに）',
    '3. {btn-play} → 磁場の中で球が円をえがく',
    '4. 上の {btn-reset|戻る} ボタンで、磁場を置く前に戻す',
    '5. 左の {t-efield} ボタンで同じように囲み、枠を選んで',
    '　 プロパティの「強さ」を 0.5 にする',
    '　 → {btn-play} すると、電場の向きへ放物線をえがく',
    '',
    '左の {t-tracer} ボタンで球をクリックすると道すじが残る'
  ]);
}

// ★回路は生徒が導線から組む（2026-09-28、ユーザーの指示「最初から回路が出てくるのでは
//   普通のデモと変わらない」）。置くのは形の目安の点線だけ（注釈なので回路とはつながらない）。
//   ★チュートリアル全体の線引き：その回で紹介する機能は生徒が作る。舞台にあたる物
//     （つなぐ相手の球・載せる斜面など）は置いてよい。
// 点線の枠（丸なし）。領域を置く・形を描く場所の目安
function tutGuideBox(L, T, R, B, c) {
  c = c || '#90a4ae';
  demoDashedPath(L, T, R, T, c); demoDashedPath(R, T, R, B, c);
  demoDashedPath(R, B, L, B, c); demoDashedPath(L, B, L, T, c);
}
// 点線の円（歯車の目安）
function tutGuideCircle(cx, cy, r) {
  const n = 36;
  for (let i = 0; i < n; i += 2) {
    const a0 = i / n * 2 * Math.PI, a1 = (i + 1) / n * 2 * Math.PI;
    demoPath([{ x:cx + r * Math.cos(a0), y:cy + r * Math.sin(a0) }, { x:cx + r * Math.cos(a1), y:cy + r * Math.sin(a1) }], '#90a4ae', 3);
  }
}
// 点線の四角（目安）。角に小さな丸を付けて「ここをクリック」を見せる
function tutGuideRect(L, T, R, B) {
  const c = '#90a4ae';
  demoDashedPath(L, T, R, T, c); demoDashedPath(R, T, R, B, c);
  demoDashedPath(R, B, L, B, c); demoDashedPath(L, B, L, T, c);
  for (const [x, y] of [[L, T], [R, T], [R, B], [L, B]]) tutDot(x, y, c);
}
function tutDot(x, y, c) {
  annotations.push(new Annotation({ type:'ellipse', x:x - 10.5, y:y - 10.5, rx:9, ry:9, color:c, width:3 }));
}
// 素子を入れる場所（下書き）。★素子は導線の上を2か所クリックして入れるので、
//   その2点に番号の色の丸を打つ。間は太い帯で塗って「ここに1つ入る」を見せる。
function tutSlot(x1, y1, x2, y2) {
  demoPath([{ x:x1, y:y1 }, { x:x2, y:y2 }], 'rgba(255,202,40,0.35)', 18);
  tutDot(x1, y1, TUT_BADGE_COLOR); tutDot(x2, y2, TUT_BADGE_COLOR);
}

// ── 23 回路をつくる ─────────────────────────────────────
//   ★電源の電圧は生徒に 2.5V へ下げさせる。既定の 10V のままだと、定格 2.5V の豆電球が
//     入れた瞬間に切れる（実測）。「上げすぎると切れる」は最後に自分で戻して確かめる。
//   ★下書きの番号は左うえの手順の番号と同じ（2 導線・3 電源・5 豆電球・7 電流計）。
function demoTutorialCircuit() {
  const gy = tutBegin();
  const L = tutScreenX(620), R = tutScreenX(930), T = gy - 600, B = gy - 240;
  tutGuideRect(L, T, R, B);
  tutBadge(L + 5, T - 45, 2, '導線（角を順に）');
  const my = (T + B) / 2;
  tutSlot(L, my - 50, L, my + 50);  tutBadge(L + 45, my, 3, '直流電源');
  tutSlot(R, my - 50, R, my + 50);  tutBadge(R - 125, my, 5, '豆電球');
  const mx = (L + R) / 2;
  tutSlot(mx - 50, T, mx + 50, T);  tutBadge(mx - 55, T + 50, 7, '電流計');
  tutText('23 回路をつくる', [
    '1. 左の {t-circuit} ボタンを押すと、素子の窓が出る',
    '2. 窓の 導線 を選び、点線の四角の角を順にクリック。',
    '　 最初の角をもう一度クリックして閉じる',
    '3. 窓の 直流電源 を選び、3 の黄色い ○ を2つクリック',
    '4. 左上の {t-pointer} ボタンで電源を選び、',
    '　 プロパティの「電圧 V」を 2.5 にする',
    '5. 窓の 豆電球 を選び、5 の ○ を2つクリック',
    '6. {btn-play} → 電流が流れて豆電球が光る',
    '7. 窓の 電流計 を 7 の ○ に入れる → 電流が出る',
    '　 （向きが逆だと − がつく）',
    '8. 電圧を 10 にすると、大きすぎて豆電球が切れる',
    '',
    '窓が閉じたら、左の {t-circuit} ボタンでまた出せる']);
}

// ── 24 枝分かれした回路（並列）とスイッチ ───────────────────────
//   ★23 の続きから始めたいが、デモを開くとシーンが消える。輪と電源は 23 の復習として作り直させる。
function demoTutorialParallel() {
  const gy = tutBegin();
  const L = tutScreenX(600), R = tutScreenX(940), M = (L + R) / 2, T = gy - 600, B = gy - 240;
  const my = (T + B) / 2;
  tutGuideRect(L, T, R, B);
  tutBadge(L + 5, T - 45, 1, '外の四角');
  tutSlot(L, my - 50, L, my + 50);  tutBadge(L + 45, my, 1, '直流電源');
  demoDashedPath(M, T, M, B, '#90a4ae');
  tutDot(M, T, TUT_BADGE_COLOR); tutDot(M, B, TUT_BADGE_COLOR);
  tutBadge(M + 5, T - 45, 2, 'まん中の導線');
  tutSlot(M, my - 110, M, my - 10); tutBadge(M - 125, my - 60, 3, '豆電球');
  tutSlot(R, my - 110, R, my - 10); tutBadge(R - 125, my - 60, 3, '豆電球');
  tutSlot(R, my + 40, R, my + 110); tutBadge(R - 140, my + 75, 5, 'スイッチ');
  tutText('24 枝分かれした回路とスイッチ', [
    '1. 23 と同じように、窓の 導線 で外の四角を1周つくり、',
    '　 1 の ○ に 直流電源 を入れて「電圧 V」を 2.5 にする',
    '2. 導線 で、2 の上の ○ → 下の ○ をクリック',
    '　 → まん中の縦の導線ができる',
    '　 （回路の上をクリックすると、その1本で終わる）',
    '3. 豆電球 を 3 の ○ に1つずつ、2つ入れる',
    '4. {btn-play} → 2つの豆電球が並列につながって光る',
    '5. 窓の スイッチ を 5 の ○ に入れ、選んで',
    '　 プロパティの「閉じる（ON）」を外す',
    '　 → 右の豆電球だけが消える',
    '',
    '窓は左の {t-circuit} ボタンで出す']);
}

// ── 25 導体棒で電流をつくる（電磁誘導）──────────────────────────
//   ★真上から見た図（重力 0）。導線はコの字に1本で引かせる（右上→左上→左下→右下、最後の点を
//     もう一度クリックして終わる＝回路の作図の約束 placeCircuitSecondClick の「近すぎる」）。
//   ★導体棒は 2 本のレールの両方をはみ出して横切らないと回路に入らない（circuit.js の★）。
//     下書きの線はレールの外へ 30px ずつ出してある。
//   ★電流計にしたのは、導体棒の 0.5Ω だけの回路で I = BLv/R が大きく出るから（豆電球は
//     速さによって切れる／点かないが揺れる）。流れると棒に逆向きの力がかかって減速する。
//   ★実測（マウスで手順どおり・初速 9m/s）：0.5 秒で 0.9m/s まで落ちる（τ = mR/(BL)² = 0.29 秒）。
//     速すぎて見逃すので、最後に B を 0.1 へ下げさせる（τ が 25 倍の 7 秒になる）。
function demoTutorialInduction() {
  resetDemoWorld();
  setDemoGravity(0);
  updateGroundTerrain(false);
  setDemoCam(0, 0.65);
  const L = tutScreenX(590), R = tutScreenX(960), T = tutScreenY(340), B = tutScreenY(470);
  const c = '#90a4ae';
  // 1〜2 導線（コの字）
  demoDashedPath(R, T, L, T, c); demoDashedPath(L, T, L, B, c); demoDashedPath(L, B, R, B, c);
  for (const [x, y] of [[R, T], [L, T], [L, B], [R, B]]) tutDot(x, y, c);
  tutBadge(R - 130, T - 50, 2, '右上から');
  // 3 電流計
  const my = (T + B) / 2;
  tutSlot(L, my - 50, L, my + 50); tutBadge(L + 45, my, 3, '電流計');
  // 4 磁場の枠
  tutGuideBox(tutScreenX(640), T - 90, R + 40, B + 90, '#81c784');
  tutBadge(tutScreenX(655), B + 130, 4, '磁場');
  // 5 導体棒
  const rx = tutScreenX(760);
  demoDashedPath(rx, T - 40, rx, B + 40, TUT_BADGE_COLOR, 5);
  tutBadge(rx + 40, T - 60, 5, '導体棒');
  demoLabel(tutScreenX(600), B + 230, '真上から見た図（重力なし）', '#90a4ae', 20);
  tutText('25 導体棒で電流をつくる', [
    '1. 左の {t-circuit} ボタンで窓を出し、導線 を選ぶ',
    '2. 右上 → 左上 → 左下 → 右下 の ○ を順にクリックし、',
    '　 右下をもう一度クリックして終わる（2本のレール）',
    '3. 窓の 電流計 を 3 の ○ に入れる',
    '4. 左の {t-bfield} ボタンで 4 の点線の枠をドラッグ',
    '5. 左の {t-condrod} ボタンで 5 の点線を上から下へドラッグ',
    '　 （2本のレールを両方ともはみ出して横切る）',
    '6. 左の {t-velocity} ボタンで棒を押し、左へ引いて放す',
    '7. {btn-play} → 棒が動くと電流が流れ、',
    '　 棒は流れた電流にブレーキをかけられて止まっていく',
    '8. 磁場の枠を選び、プロパティの「強さ」を 0.1 にする',
    '　 → ブレーキが弱くなり、長く走る']);
}

// ════════════════════════════════════════
//  形をくふうする
// ════════════════════════════════════════

// ── 26 図形をくっつける・くりぬく（図形和）─────────────────────
//   ★型抜きは「最初に選んだ形 − あとから選んだ形」（clipper.js の★）。選ぶ順を本文に書く。
function demoTutorialBoolean() {
  const gy = tutBegin();
  const x1 = tutScreenX(650), x2 = tutScreenX(870);
  tutBody({ type:'box', x:x1, y:gy - 50, w:120, h:60, mass:1, fillColor:'#42a5f5' });
  tutBody({ type:'circle', x:x1 + 40, y:gy - 90, radius:40, mass:1, fillColor:'#42a5f5' });
  tutBody({ type:'box', x:x2, y:gy - 70, w:140, h:140, mass:1, fillColor:'#66bb6a' });
  tutBody({ type:'circle', x:x2, y:gy - 70, radius:35, mass:0.2, fillColor:'#ffca28' });
  tutBadge(x1 - 60, gy - 220, 1, '結合');
  tutBadge(x2 - 60, gy - 220, 3, '型抜き');
  tutText('26 図形をくっつける・くりぬく', [
    '1. 左上の {t-pointer} ボタンで 1 の四角をクリックし、',
    '　 Ctrl を押しながら円の上のほうをクリック（2つを選ぶ。',
    '　 選択枠の ■ や ○ を押すと形が変わるので避ける）',
    '2. 左の {t-boolean} ボタン →「結合 (A∪B)」',
    '　 → 2つが1つの形になる',
    '3. 3 の緑の四角をクリックし、Ctrl を押しながら',
    '　 黄色い円をクリック（選ぶ順が大事）',
    '4. {t-boolean} ボタン →「型抜き (A−B)」',
    '　 → 最初に選んだ四角から、円の形がくりぬかれる',
    '5. {btn-play} → くっつけた形は1つの物体として動く']);
}

// ── 27 歯車 ─────────────────────────────────────────
//   ★歯数はドラッグの長さ（ピッチ円の半径）で決まる。既定の歯の大きさ 10cm で、半径 1m なら 20 枚。
//     2つ目を1つ目に重ねて描くと、かみ合う位置へ吸い付く（gear.js の★）。
function demoTutorialGear() {
  const gy = tutBegin();
  const cy = gy - 380, c1 = tutScreenX(670), r1 = 100, r2 = 70, c2 = c1 + r1 + r2;
  tutGuideCircle(c1, cy, r1); tutGuideCircle(c2, cy, r2);
  tutDot(c1, cy, TUT_BADGE_COLOR); tutDot(c2, cy, TUT_BADGE_COLOR);
  tutBadge(c1 - 30, cy - r1 - 45, 1, '');
  tutBadge(c2 - 10, cy - r2 - 45, 2, '');
  demoLabel(c1 - 45, cy + r1 + 20, '3 モーター', TUT_BADGE_COLOR, 20);
  demoLabel(c2 - 35, cy + r2 + 20, '4 ヒンジ', TUT_BADGE_COLOR, 20);
  tutText('27 歯車をかみ合わせる', [
    '1. 左の {t-gear} ボタンを押し、窓で「歯車を描く」を選ぶ。',
    '　 1 の中心の ○ から点線の円までドラッグ',
    '2. 2 の中心から点線の円までドラッグ',
    '　 → 1 に重なると、歯がかみ合う位置に吸い付く',
    '3. 左の {t-axle} ボタンで、1 の中心をクリック',
    '4. 左の {t-hinge} ボタンで、2 の中心をクリック',
    '5. {btn-play} → モーターが 1 を回し、',
    '　 かみ合った 2 は逆向きに回る',
    '',
    '歯の数は、描いたあとプロパティの「歯数」でも変えられる']);
}

// ════════════════════════════════════════
//  仕掛けをつくる
// ════════════════════════════════════════

// ── 28 プログラム ─────────────────────────────────────
//   ★箱は球が当たる相手。プログラムは箱に結ぶ（相手の既定「つないだ物体」＝箱そのもの）。
function demoTutorialProgram() {
  const gy = tutBegin();
  const x = tutScreenX(760);
  tutBody({ type:'box', x, y:gy - 30, w:120, h:60, mass:2, fillColor:'#42a5f5' });
  tutBody({ type:'circle', x, y:gy - 400, radius:22, mass:0.5, fillColor:'#ffca28' });
  demoLabel(x - 20, gy - 110, '箱', '#eceff1', 24);
  tutText('28 プログラムで仕掛けをつくる', [
    '1. 左の {t-program} ボタンで 箱 をクリック',
    '　 → 右上にプログラムの窓が出る',
    '2. 窓の「トリガー」を「何かが当たったら」にする',
    '3. 窓の「すること」を「色を変える」にする',
    '4. {btn-play} → 球が当たった瞬間に箱の色が変わる',
    '5. シミュレーション →「実行前に戻す」で戻し、「すること」を',
    '　 「削除する」にする → 当たると箱が消える',
    '',
    'トリガーは「キーを押した瞬間」「○ステップごと」など、',
    'すること は「複製」「合図を出す」などもある']);
}

// ── 29 カウンタ ───────────────────────────────────────
function demoTutorialCounter() {
  const gy = tutBegin();
  const RX = tutScreenX(700), RW = 120, RH = 140;
  tutBody({ type:'polygon', isStatic:true, x:RX, y:gy, fillColor:'#78909c',
    verts:[{ x:-RW, y:-RH }, { x:RW, y:0 }, { x:-RW, y:0 }] });
  for (let i = 0; i < 5; i++)
    tutBody({ type:'circle', x:RX - RW + 20 + i * 36, y:gy - RH - 20 - i * 60, radius:16, mass:0.3,
      fillColor:'#ef5350' });
  const lx = tutScreenX(880);
  demoDashedPath(lx, gy - 160, lx, gy - 5, TUT_BADGE_COLOR, 5);
  tutBadge(lx + 30, gy - 190, 1, '');
  tutText('29 通った数を数える', [
    '1. 左の {t-measure} ボタンを押すと、測定の窓が出る',
    '2. 窓の 通過カウンタ を選び、1 の点線を',
    '　 上から下へドラッグ → 数える線ができる',
    '3. {btn-play} → 球が線を横切るたびに1つ数える',
    '　 （右上の窓の「正味の数」）',
    '4. 矢印と逆向きに通ると −1 になる。',
    '　 窓の「向きを反転」で数える向きを変えられる',
    '',
    '「毎秒」は、1秒あたり何個通ったか']);
}

// ── 30 流れの場（風・水流）──────────────────────────────
//   ★既定の効かせ方は「速度の合成」：枠の中の物体は流れと一緒に動く（抗力係数によらない）。
function demoTutorialFlow() {
  const gy = tutBegin();
  const xs = [tutScreenX(620), tutScreenX(680), tutScreenX(740)];
  xs.forEach((x, i) => tutBody({ type:'circle', x, y:gy - 20, radius:18, mass:0.3,
    fillColor:['#42a5f5', '#66bb6a', '#ffca28'][i] }));
  tutGuideBox(tutScreenX(580), gy - 220, tutScreenX(900), gy - 2);
  tutBadge(tutScreenX(595), gy - 260, 1, '流れの枠');
  tutText('30 風を吹かせる', [
    '1. 左の {t-flowfield} ボタンで、1 の点線の枠をドラッグ',
    '2. {btn-play} → 枠の中の球が流れに運ばれる',
    '　 （枠を出ると流れを受けなくなる）',
    '3. 枠を選び、プロパティの「流速」や「向き」を変える',
    '　 → 向き 90 で上向きの風。球が吹き上がる',
    '',
    '窓の「効かせ方」を「流体の抗力」にすると、',
    '物体の「抗力係数 Cd」に応じて押される']);
}

// ════════════════════════════════════════
//  熱と気体
// ════════════════════════════════════════

// ── 31 加熱と冷却 ─────────────────────────────────────
//   ★塊は 0.1kg（熱容量 = 比熱 1000 × 質量 = 100 J/K）。出力 1000W で毎秒 10℃ 上がる。
//     既定の 1kg・200W では毎秒 0.2℃ で、色の変化が見えない（C = heatCap × mass の計算どおり）。
function demoTutorialHeat() {
  const gy = tutBegin();
  const xa = tutScreenX(650), xb = tutScreenX(850);
  tutBody({ type:'box', x:xa, y:gy - 30, w:60, h:60, mass:0.1, fillColor:'#b0bec5' });
  tutBody({ type:'box', x:xb, y:gy - 30, w:60, h:60, mass:0.1, fillColor:'#b0bec5' });
  demoLabel(xa - 10, gy - 100, 'A', '#eceff1', 26);
  demoLabel(xb - 10, gy - 100, 'B', '#eceff1', 26);
  tutGuideBox(xa - 70, gy - 150, xa + 70, gy - 2, '#ff8a65');
  tutGuideBox(xb - 70, gy - 150, xb + 70, gy - 2, '#4fc3f7');
  tutBadge(xa - 55, gy - 190, 3, '加熱');
  tutBadge(xb - 55, gy - 190, 4, '冷却');
  tutText('31 温める・冷やす', [
    '1. 上の シミュレーション →「熱」→',
    '　 「温度で色をつける」にチェック',
    '2. 左の {t-heater} ボタンを押し、窓の「出力」を 1000 にする',
    '3. 窓で「♨ 加熱」を選び、3 の枠（A を囲む）をドラッグ',
    '4. 窓で「❄ 冷却」を選び、4 の枠（B を囲む）をドラッグ',
    '5. {btn-play} → A は赤く、B は青くなっていく',
    '6. {t-pan} ボタンで A を B にくっつける',
    '　 → 熱が伝わって、2つの温度が近づく',
    '',
    '物体を選ぶと、プロパティに温度が出る']);
}

// ── 32 気体の入った容器 ─────────────────────────────────
function demoTutorialVessel() {
  const gy = tutBegin();
  const L = tutScreenX(700), R = tutScreenX(820);
  tutGuideBox(L, gy - 300, R, gy - 2);
  tutBadge(L - 20, gy - 340, 1, '容器');
  tutText('32 気体の入った容器', [
    '1. 左の {t-vessel} ボタンで、1 の点線の枠をドラッグ',
    '　 → 器・蓋（オレンジ）・中の気体（水色）ができる',
    '2. 水色の気体をクリック → プロパティに',
    '　 圧力 P・体積 V・温度 T が出る',
    '3. 「温度 T」を 200 にする',
    '4. {btn-play} → 気体がふくらみ、蓋が押し上げられる',
    '5. 左の {t-heater} ボタンで器を囲むと、',
    '　 温め続けることもできる',
    '',
    'プロパティの「グラフ」から P-V 図も開ける']);
}

// ── 33 速さの分布 ─────────────────────────────────────
function demoTutorialSpeedDist() {
  const gy = tutBegin();
  const bx = tutScreenX(780), bw = 260, bh = 260, by = gy - 330;
  tutWall(bx, by - bh / 2, bw + 16, 16);
  tutWall(bx, by + bh / 2, bw + 16, 16);
  tutWall(bx - bw / 2, by, 16, bh);
  tutWall(bx + bw / 2, by, 16, bh);
  tutGuideBox(bx - bw / 2 + 20, by - bh / 2 + 20, bx + bw / 2 - 20, by + bh / 2 - 20, TUT_BADGE_COLOR);
  tutBadge(bx - bw / 2, by - bh / 2 - 45, 1, '気体');
  tutBadge(bx - bw / 2 + 110, by - bh / 2 - 45, 2, '分布計の枠');
  tutText('33 分子の速さの分布', [
    '1. 左の {t-particle} で 気体 を選び、箱を何度かドラッグ',
    '　 → 気体の分子が入る',
    '2. 左の {t-measure} ボタンで測定の窓を出し、',
    '　 速さの分布計 を選んで 2 の点線の枠をドラッグ',
    '　 → 窓に、速さごとの分子の数が棒グラフで出る',
    '3. {btn-play} → 分子はばらばらの速さで飛び回る。',
    '　 棒グラフと、理論の曲線（マクスウェル分布）を比べる',
    '4. 左の {t-heater} ボタンで箱を囲んで温めると、',
    '　 分布が速い側へ広がる']);
}

// ════════════════════════════════════════
//  画面の使い方
// ════════════════════════════════════════

// ── 34 コマ送り・速さ・スナップ ─────────────────────────────
function demoTutorialStep() {
  const gy = tutBegin();
  tutBody({ type:'circle', x:tutScreenX(700), y:gy - 450, radius:22, mass:1, restitution:0.8,
    fillColor:'#ef5350' });
  tutBody({ type:'box', x:tutScreenX(860), y:gy - 40, w:80, h:80, mass:1, fillColor:'#42a5f5' });
  tutText('34 コマ送り・速さ・スナップ', [
    '1. 上の {btn-step} ボタンを押すたびに、',
    '　 1/60 秒だけ進む（落ちる球をコマ送りで見る）',
    '2. 上の「1×」の横のつまみで、進む速さを変える',
    '　 （0.1 倍のスローから 2 倍まで）',
    '3. 上の {btn-grid} ボタンを入れて形を描くと、',
    '　 目盛りに吸い付く（右の ▾ で間隔を変える）',
    '4. 上の {btn-osnap} ボタンを入れると、',
    '　 物体の角・辺のまん中・中心に吸い付く',
    '　 （箱の角に円の中心をぴったり合わせられる）']);
}

// ── 35 カメラを物体に付ける ──────────────────────────────
//   ★本文は画面に貼る（tutText の pin）。ワールドに置くと、カメラが台車を追ったとたんに流れ去る。
function demoTutorialCamera() {
  const gy = tutBegin();
  const cart = tutBody({ type:'box', x:tutScreenX(620), y:gy - 25, w:100, h:50, mass:2,
    constVel:true, vx:100, fillColor:'#42a5f5' });
  // 目印の旗（流れて見えるように、長い範囲に並べる）。★注釈の線にする：物体の柱にすると
  //   走る台車がぶつかって止まる（実測）。注釈なら物理に参加しない。
  for (let i = 0; i < 30; i++) {
    const x = tutScreenX(700) + i * 200;
    demoPath([{ x, y:gy }, { x, y:gy - 140 }], '#90a4ae', 5);
    demoPath([{ x, y:gy - 140 }, { x:x + 40, y:gy - 125 }, { x, y:gy - 110 }], '#ffca28', 4);
  }
  demoLabel(cart.x - 25, gy - 100, '台車', '#eceff1', 24);
  tutText('35 カメラを物体に付ける', [
    '1. {btn-play} → 台車は旗の前を通って画面から出ていく。戻す',
    '2. 左上の {t-pointer} ボタンで台車を選ぶ',
    '3. 上の {btn-follow|カメラ} ボタン →',
    '　 「選択中の物体にカメラを接続」',
    '4. {btn-play} → 画面が台車についていく',
    '　 （旗のほうが後ろへ流れて見える）',
    '5. もう一度 カメラ ボタン →「カメラを外す」'], true);
}

// ── 36 重力を変える ───────────────────────────────────
function demoTutorialGravity() {
  const gy = tutBegin();
  tutBody({ type:'circle', x:tutScreenX(700), y:gy - 500, radius:22, mass:1, restitution:0.6,
    fillColor:'#ef5350' });
  tutBody({ type:'circle', x:tutScreenX(860), y:gy - 500, radius:22, mass:1, restitution:0.6,
    fillColor:'#42a5f5' });
  tutText('36 重力を変える', [
    '1. {btn-play} → 球が落ちる。',
    '　 シミュレーション →「実行前に戻す」で戻す',
    '2. 上の シミュレーション →「重力」→「月 −1.6」',
    '　 → {btn-play} すると、ゆっくり落ちる',
    '3. 「無重力 0」にすると、落ちずに浮いたまま',
    '4. 右の「全体設定」タブの「重力Y」に',
    '　 好きな値を入れてもよい（−9.8 が地球）',
    '',
    '重力の設定は、別のデモを開くと地球に戻る']);
}

// ════════════════════════════════════════
//  2026-09-28 追加分（目録では各単元の中へ差し込む。番号は目録の並び順）
// ════════════════════════════════════════

// ── 2 画面を動かす・拡大縮小する ────────────────────────────────
//   ★右ドラッグで平行移動・ホイールでカーソル中心の拡大縮小（js/input/mouse.js の wheel と buttons===2）。
//     画面の外に旗を立てておき、「探しに行く」ことを手順にする。
function demoTutorialView() {
  const gy = tutBegin();
  tutBody({ type:'box', x:tutScreenX(760), y:gy - 40, w:80, h:80, mass:1, fillColor:'#42a5f5' });
  const fx = tutScreenX(998) + 900;       // 画面の右の外
  tutWall(fx, gy - 150, 12, 300);
  demoPath([{ x:fx + 6, y:gy - 300 }, { x:fx + 120, y:gy - 265 }, { x:fx + 6, y:gy - 230 }], '#ffca28', 6);
  demoLabel(fx - 60, gy - 360, 'ここまで来られたら成功', '#ffca28', 26);
  demoArrow(tutScreenX(880), gy - 200, 110, 1, '#ffca28');
  demoLabel(tutScreenX(820), gy - 250, '画面の外にも…', '#ffca28', 22);
  tutText('2 画面を動かす・拡大縮小する', [
    '1. 画面の上で、マウスの右ボタンを押したままドラッグ',
    '　 → 見ている場所が動く（右ボタンを押して離すだけだと',
    '　 　 メニューが出る）',
    '2. マウスのホイールを回す → カーソルの所を中心に',
    '　 拡大・縮小する（倍率は画面の右下の「ズーム」）',
    '3. 右のほうへずらして、画面の外の旗を探してみよう',
    '4. 上の 表示 →「画面を原点(0,0)へ戻す」で',
    '　 最初の場所へ戻る',
    '',
    '見る場所を変えても、物体の動きは変わらない']);
}

// ── 8 動きを制限する（回転しない・運動方向固定・一定の速度）──────────────
function demoTutorialLimits() {
  const gy = tutBegin();
  const RX = tutScreenX(640), RW = 90, RH = 150;
  tutBody({ type:'polygon', isStatic:true, x:RX, y:gy, fillColor:'#78909c',
    verts:[{ x:-RW, y:-RH }, { x:RW, y:0 }, { x:-RW, y:0 }] });
  tutBody({ type:'circle', x:RX - RW + 25, y:gy - RH - 5, radius:24, mass:1, fillColor:'#ef5350' });
  tutBody({ type:'circle', x:tutScreenX(820), y:gy - 450, radius:24, mass:1, fillColor:'#66bb6a' });
  tutBody({ type:'box', x:tutScreenX(780), y:gy - 25, w:60, h:50, mass:1, fillColor:'#42a5f5' });
  demoLabel(RX - RW + 10, gy - RH - 90, 'A', '#eceff1', 26);
  demoLabel(tutScreenX(810), gy - 530, 'B', '#eceff1', 26);
  demoLabel(tutScreenX(770), gy - 110, 'C', '#eceff1', 26);
  tutText('8 動きを制限する', [
    '1. {btn-play} → A は坂を転がり、B は落ちる。',
    '　 シミュレーション →「実行前に戻す」で戻す',
    '2. {t-pointer} ボタンで A を選び、プロパティの',
    '　 「回転しない」にチェック → 転がらずにすべり落ちる',
    '3. B を選び「運動方向固定」にチェックし、',
    '　 「動ける向き」を 0 にする → 落ちずに横にだけ動く',
    '　 （{t-pan} ボタンで押してみる）',
    '4. {t-velocity} ボタンで C に右向きの速さを与え、',
    '　 「一定の速度で動かし続ける」にチェック',
    '　 → 床の摩擦があっても同じ速さで進み続ける']);
}

// ── 9 衝突レイヤー ───────────────────────────────────────
//   ★レイヤーはマスク方式：1つでも共有すれば当たる（CLAUDE.md の不変条件）。
function demoTutorialLayers() {
  const gy = tutBegin();
  const sx = tutScreenX(780);
  tutWall(sx, gy - 250, 320, 16);
  tutBody({ type:'circle', x:sx - 80, y:gy - 450, radius:22, mass:1, fillColor:'#42a5f5' });
  tutBody({ type:'circle', x:sx + 80, y:gy - 450, radius:22, mass:1, fillColor:'#ef5350' });
  demoLabel(sx - 90, gy - 530, 'A', '#eceff1', 26);
  demoLabel(sx + 70, gy - 530, 'B', '#eceff1', 26);
  demoLabel(sx - 25, gy - 220, '棚', '#eceff1', 22);
  tutText('9 すり抜ける・ぶつかる（衝突レイヤー）', [
    '1. {btn-play} → A も B も棚に乗る。',
    '　 シミュレーション →「実行前に戻す」で戻す',
    '2. {t-pointer} ボタンで B を選び、プロパティの 衝突 の',
    '　 「衝突レイヤー」で 1 を外し、2 にチェック',
    '3. {btn-play} → B だけ棚をすり抜けて落ちる',
    '　 （棚は 1、B は 2。同じ番号を持つ物どうしだけが当たる）',
    '4. 棚を選んで 2 にもチェック → B も棚に乗る',
    '5. 上の 表示 →「衝突レイヤーを表示」で、',
    '　 それぞれの番号が色の点で見える']);
}

// ── 14 エネルギーと運動量のグラフ ──────────────────────────────
//   ★台車は摩擦 0（合成は積なので床の摩擦も効かない）。反発係数は既定の 0.4 のまま：
//     ぶつかると運動量の和は変わらず、力学的エネルギーだけ減る＝2つのグラフの違いが出る。
function demoTutorialEnergy() {
  const gy = tutBegin();
  tutBody({ type:'box', x:tutScreenX(620), y:gy - 25, w:70, h:50, mass:1, friction:0, frictionStatic:0,
    fillColor:'#42a5f5' });
  tutBody({ type:'box', x:tutScreenX(800), y:gy - 25, w:70, h:50, mass:1, friction:0, frictionStatic:0,
    fillColor:'#ef5350' });
  demoLabel(tutScreenX(610), gy - 100, 'A', '#eceff1', 26);
  demoLabel(tutScreenX(790), gy - 100, 'B', '#eceff1', 26);
  tutText('14 エネルギーと運動量のグラフ', [
    '1. 左の {t-velocity} ボタンで、A を右向きに飛ばす',
    '　 （A を押して左へ引いて放す）',
    '2. {t-pointer} ボタンで A を選び、Ctrl を押しながら B も選ぶ',
    '3. 上の 表示 →「グラフを表示」→',
    '　 「運動量（選択した物体の系）」と',
    '　 「エネルギー（選択した物体の系）」を開く',
    '4. {btn-play} → ぶつかっても運動量の和は変わらない。',
    '　 エネルギーはぶつかった瞬間に減る',
    '5. 2台の「反発係数」を 1 にすると、エネルギーも減らない']);
}

// ── 15 空気抵抗 ─────────────────────────────────────────
//   ★軽い球（0.01kg・半径 30px）。断面積は「幅 × 奥行き world.depth」で取る（body.js の空気抵抗）。
//     実測（Cd=1・空気密度 1.2・7m）：抵抗なしは 1.15 秒で着地、抵抗ありは 0.5 秒で 2.29 m/s に
//     頭打ちして 3.08 秒で着地。0.05kg では終端速度 5.18 m/s・着地 1.9 秒で、差が小さく見えた。
function demoTutorialDrag() {
  const gy = tutBegin();
  const y = gy - 700;
  tutBody({ type:'circle', x:tutScreenX(700), y, radius:30, mass:0.01, fillColor:'#42a5f5' });
  tutBody({ type:'circle', x:tutScreenX(860), y, radius:30, mass:0.01, fillColor:'#ef5350' });
  demoLabel(tutScreenX(690), y - 80, 'A', '#eceff1', 26);
  demoLabel(tutScreenX(850), y - 80, 'B', '#eceff1', 26);
  tutText('15 空気抵抗', [
    '1. {btn-play} → A と B は同時に落ちる（空気抵抗なし）。',
    '　 シミュレーション →「実行前に戻す」で戻す',
    '2. {t-pointer} ボタンで B を選び、プロパティの',
    '　 「抗力係数 Cd」を 1 にする',
    '3. {btn-play} → B は空気抵抗を受けてゆっくり落ちる。',
    '　 速さはある値で頭打ちになる（終端速度）',
    '4. B の「変位・速度・加速度」のグラフを開くと、',
    '　 速度が途中から一定になるのが見える',
    '5. シミュレーション →「空気」で空気の密度を変えると、',
    '　 抵抗の強さが変わる']);
}

// ── 16 記録を残す（スクリーンショット・GIF）──────────────────────────
function demoTutorialRecord() {
  const gy = tutBegin();
  for (let i = 0; i < 3; i++)
    tutBody({ type:'circle', x:tutScreenX(680 + i * 100), y:gy - 300 - i * 120, radius:20, mass:1,
      restitution:0.8, fillColor:['#42a5f5', '#66bb6a', '#ffca28'][i] });
  tutGuideBox(tutScreenX(600), gy - 560, tutScreenX(960), gy - 2);
  tutBadge(tutScreenX(615), gy - 600, 2, '録画する範囲');
  tutText('16 記録を残す', [
    '1. 上の シーン →「スクリーンショットを保存」',
    '　 → いまの画面が画像のファイルで保存される',
    '2. シーン →「GIFアニメを保存」を選び、',
    '　 2 の点線の枠をドラッグ（録画する範囲）',
    '3. 出てきた窓の「録画開始」を押し、{btn-play}',
    '4. 跳ねるようすを撮ったら、窓の「停止」',
    '5. 「保存」で動く画像（GIF）のファイルになる',
    '　 （やめるときは「破棄」）']);
}

// ── 20 物体の一覧と素材 ───────────────────────────────────
function demoTutorialMaterial() {
  const gy = tutBegin();
  const x = tutScreenX(660);
  tutBody({ type:'box', x, y:gy - 200, w:120, h:120, isStatic:true, fillColor:'#ef5350', label:'赤' });
  tutBody({ type:'box', x:x + 50, y:gy - 160, w:120, h:120, isStatic:true, fillColor:'#66bb6a', label:'緑' });
  tutWall(tutScreenX(860), gy - 150, 200, 16);
  tutBody({ type:'circle', x:tutScreenX(860), y:gy - 400, radius:24, mass:1, fillColor:'#42a5f5' });
  demoLabel(tutScreenX(845), gy - 480, '球', '#eceff1', 24);
  tutText('20 物体の一覧と素材', [
    '1. 右の「オブジェ」タブ → 物体の一覧が出る。',
    '　 下にある物ほど手前に描かれる',
    '2. 一覧の 赤 の行をいちばん下へドラッグ',
    '　 → 赤い四角が緑の手前に出る',
    '3. 「プロパティ」タブに戻り、{t-pointer} ボタンで球を選ぶ',
    '4. 下のほうの 素材プリセット の「ゴム」を押す',
    '　 → 質量・摩擦・反発・色がまとめてゴムになる',
    '5. {btn-play} で跳ね方を見る。「金属」「木材」「スポンジ」',
    '　 に変えて比べる（毎回「実行前に戻す」で戻す）']);
}
