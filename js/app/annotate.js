// ════════════════════════════════════════
//  PHYSBOX 注釈（テキスト・お絵描き）
// ════════════════════════════════════════
//  背景に文字や線を置くための層。教材の説明書き・補助線・板書のためのもので、
//  物理には一切参加しない。
//
//  ★不変条件①「なににも干渉しない」
//    注釈は annotations 配列だけに入り、objects / joints / particles のどれにも
//    入らない。したがって衝突・レーザー・波・回路・電磁気のどのモジュールからも
//    構造的に見えない。ここを崩す（＝物理側から annotations を読む）と、
//    「背景の落書きが物理を変える」という説明のつかない挙動になる。
//
//  ★不変条件②「編集ツールの対象外」
//    編集ツール（pointer）の当たり判定の列（js/input/mouse.js）には一切割り込まない。
//    注釈を掴めるのは、注釈グループのツール（ANNOT_TOOLS）を選んでいる間だけ。
//    こうしておくと、背景に敷いた注釈が物体の選択を邪魔することが原理的に起きない。
//    そのぶん選択の状態も selectedElement とは別系統（selectedAnnotation）で持つ。
//
//  ★不変条件③「x, y は常に左うえの角」
//    中心ではなく左うえを持つ。文字を打つと右と下へ伸びる（ふつうの文字入力と同じ）
//    ので、書いている間ずっとクリックした場所が動かない。中心を持つと、1文字打つ
//    たびに文字全体が左へずれていく。
//    回転だけは見た目の自然さを優先して「箱の中心まわり」で回し、そのつど左うえの
//    角を計算し直す（rotateAnnotTo）。持っている値の意味は回転後も変わらない。
//
//  ★内部表現は3つだけ
//    text    … 文字（Phase 1）
//    path    … 折れ線 {pts, closed}。自由ペン・直線・多角形・四角・三角を兼ねる
//    ellipse … 円・楕円
//    四角や三角に専用の型を作らないのは、平行移動・回転・当たり判定・保存の
//    コードを1本に保つため。Phase 1 では text だけを作るが、器は3つぶん用意してある。
// ════════════════════════════════════════

// 注釈グループのツール。ここに挙がっているツールを選んでいる間だけ注釈を掴める。
//   ★Phase 2 で 'draw'（お絵描き）を足す。足したツールは自動で「注釈を掴める」側に入る。
const ANNOT_TOOLS = ['text', 'draw'];
const isAnnotToolActive = () => ANNOT_TOOLS.indexOf(currentTool) >= 0;
// いま「掴む」側か「描く」側か。お絵描きツールの選択モードと、テキストツールが掴む側。
const isAnnotSelectMode = () =>
  currentTool === 'text' || (currentTool === 'draw' && annotDrawMode === 'select');
// ★どのツールがどの注釈を掴めるか。
//   テキストツールは文字だけ。線や図形まで掴めると、文字を置きたいだけの人が
//   背景の補助線を掴んでしまう（逆に、線を触りたい人は線を描いたツールに戻る方が自然）。
//   お絵描きツールの「選択」モードは、注釈をすべて掴める。
function annotToolCanSelect(a, tool, drawMode) {
  if (!a) return true;
  tool = tool === undefined ? currentTool : tool;
  drawMode = drawMode === undefined ? annotDrawMode : drawMode;
  if (tool === 'text') return a.type === 'text';
  if (tool === 'draw') return drawMode === 'select';
  return false;
}
// いま掴める注釈だけを通すふるい（annotationAtPoint に渡す）
function annotSelectFilter() {
  return a => annotToolCanSelect(a);
}
// ツールやモードを変えたとき、掴めなくなった注釈の選択を外す。
// 残すと「枠は出ているのに触れない」状態になり、Delete の行き先も分からなくなる。
function syncAnnotSelectionToTool() {
  if (selectedAnnotation && !annotToolCanSelect(selectedAnnotation)) {
    selectedAnnotation = null;
    cancelAnnotInteractions();
    updatePropsPanel(null);
    const el = document.getElementById('st-sel');
    if (el) el.textContent = 'なし';
  }
}
// 一覧などから注釈へ飛ぶとき、それを掴めるツールへ切り替えてから選ぶ
function focusAnnotation(a) {
  if (!a) return;
  if (a.type === 'text') setTool('text');
  else { annotDrawMode = 'select'; setTool('draw'); }
  selectAnnotation(a);
}

const ANNOT_LINE_H  = 1.3;   // 行送り（文字の大きさの何倍か）
const ANNOT_PAD     = 6;     // [px] 当たり判定と選択枠の余裕（ワールド単位）
const ANNOT_ROT_PX  = 30;    // [画面px] 枠の上から回転ハンドルまでの距離
const ANNOT_MIN_HIT = 10;    // [px] 中身が空でも、これだけの当たり判定は残す
const ANNOT_PICK_TOL_PX = 5; // [画面px] 線を掴むときの許容（細い線でも掴めるように）
// ─── お絵描き ───────────────────────────────────────────
const ANNOT_DRAW_MODES = [
  { v: 'select',   label: '⬉ 選択' },
  { v: 'pen',      label: '✎ 自由ペン' },
  { v: 'line',     label: '／ 直線' },
  { v: 'rect',     label: '▭ 四角' },
  { v: 'triangle', label: '◺ 三角' },
  { v: 'ellipse',  label: '◯ 丸' },
  { v: 'poly',     label: '⬠ 多角' },
  { v: 'eraser',   label: '⌫ 消しゴム' },
];
// 押して引いて離す＝1ドラッグで決まるモード。'poly' はクリックを重ねる、
// 'eraser' はなでる、で操作の型が違うので、この一覧から外してある。
const ANNOT_DRAG_MODES = ['pen', 'line', 'rect', 'triangle', 'ellipse'];
const ANNOT_CLOSE_PX = 12;   // [画面px] 多角：この距離まで始点へ戻ると閉じて確定
const ANNOT_PEN_MIN_PX   = 2.5;  // [画面px] これだけ動くごとに点を打つ
const ANNOT_SIMPLIFY_PX  = 1.0;  // [画面px] 描き終わりに間引く許容誤差
const ANNOT_MAX_PTS      = 2000; // 1本の上限。青天井だと保存とUndoが際限なく重くなる
const ANNOT_ERASER_PX    = 12;   // [画面px] 消しゴムの半径
const ANNOT_MIN_LINE_PX  = 3;    // [画面px] これ未満の直線は事故クリックとみなして捨てる

// ─── フォント ───────────────────────────────────────────
//   キーだけを保存し、実際の CSS 指定はここで引く。こうしておくと、あとから
//   フォントの積み方（環境ごとの代替）を直しても、保存済みのシーンがそのまま読める。
//   ★日本語が出ることを最優先に積む。1つ目が無ければ次、という順で、
//     macOS（ヒラギノ）→ Windows（游・メイリオ・MS）→ 総称名、の順に並べてある。
const ANNOT_FONTS = [
  { v: 'gothic', label: 'ゴシック体',
    css: '"Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","MS PGothic",sans-serif' },
  { v: 'mincho', label: '明朝体',
    css: '"Hiragino Mincho ProN","Yu Mincho","MS PMincho",serif' },
  { v: 'mono',   label: '等幅',
    css: 'ui-monospace,Consolas,"MS Gothic",monospace' },
];
const ANNOT_FONT_CSS = {};
for (const f of ANNOT_FONTS) ANNOT_FONT_CSS[f.v] = f.css;
const annotFontFamily = key => ANNOT_FONT_CSS[key] || ANNOT_FONT_CSS.gothic;
function annotFontSpec(size, fontKey, bold) {
  return (bold ? 'bold ' : '') + size + 'px ' + annotFontFamily(fontKey);
}
// canvas に font を設定し、実際に効いた指定（ブラウザが正規化したもの）を返す。
// 返った文字列をそのまま textarea の font にも入れるので、canvas で測った幅・高さと
// 入力欄の見え方が必ず一致する。
//   ★canvas は解釈できない font 指定を例外も出さずに無視し、直前のフォント（既定の
//     10px sans-serif）のまま測り続ける。そうなると枠だけが極端に小さくなるので、
//     効いたかどうかを字の大きさで確かめ、駄目なら確実に通る書き方へ落とす。
function annotApplyFont(size, fontKey, bold) {
  ctx.font = annotFontSpec(size, fontKey, bold);
  const px = ctx.font.match(/(\d+(?:\.\d+)?)px/);
  if (!px || Math.abs(parseFloat(px[1]) - size) > 0.05)
    ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';
  return ctx.font;
}
// 1行の中で文字を乗せる高さ（行ボックスの上からベースラインまで）。
//   ★CSS と同じ数え方にすることが肝心。CSS の行ボックスの高さは size×ANNOT_LINE_H で、
//     文字の乗る領域はフォントの ascent+descent、余り（leading）は上下へ半分ずつ配られる。
//     canvas の textBaseline='middle' は em 四角の中心を基準にしていて、この数え方とは
//     一致しない。ずれ方はフォントごとに違うので、編集中（textarea＝CSS）と確定後
//     （canvas）で文字が上下にずれて見えていた。
//   ★ctx.font は呼ぶ前に設定しておくこと（annotApplyFont のあとで呼ぶ）。
function annotBaselineInLine(size) {
  const m = ctx.measureText('M');
  const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
  const step = size * ANNOT_LINE_H;
  // 古いブラウザは fontBoundingBox* を持たない。その場合は一般的な比率で近似する
  if (!(asc >= 0) || !(desc >= 0)) return step / 2 + size * 0.35;
  return (step - (asc + desc)) / 2 + asc;
}

class Annotation {
  constructor(opts) {
    opts = opts || {};
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.type  = opts.type || 'text';                  // 'text' | 'path' | 'ellipse'
    this.x     = opts.x || 0;                          // ★左うえの角 [px]（不変条件③）
    this.y     = opts.y || 0;
    this.angle = opts.angle || 0;                      // 左うえの角を原点とした回転 [rad]
    this.color = opts.color || '#ffffff';
    // 既定は背面（物体より下）。要望どおり「背景に置く」のが基本で、物体に隠れて
    // 読めないときだけ前面へ出す、という運用にする。
    this.front = !!opts.front;
    // ── text ──
    this.text = opts.text !== undefined ? String(opts.text) : '';
    this.size = opts.size > 0 ? opts.size : 40;        // [px] 文字の大きさ（ワールド単位）
    this.font = ANNOT_FONT_CSS[opts.font] ? opts.font : 'gothic';
    this.bold = !!opts.bold;
    // ── path / ellipse（Phase 2 で使う。ここでは器だけ持つ）──
    this.pts    = opts.pts ? opts.pts.map(p => ({ x: p.x, y: p.y })) : null;   // 左うえからの相対座標
    this.closed = !!opts.closed;
    this.width  = opts.width > 0 ? opts.width : 3;     // [px] 線の太さ
    this.rx     = opts.rx || 0;
    this.ry     = opts.ry || 0;
    // ★カメラを物体に向きごと固定したとき（js/app/camera.js）、この注釈も世界と一緒に回るか。
    //   true＝回さない。デモの題名・本文のような「図の外の札」に付ける。回してしまうと、
    //   回転系の画面で説明文が裏返って読めなくなる。図の中の見出し（demoLabel）は false のまま
    //   ＝ 指している場所と一緒に回ってほしいので。
    //   ★既定は false。カメラが回っていなければ true でも見え方は1pxも変わらない。
    this.noCamSpin = !!opts.noCamSpin;
    // ★画面に貼り付ける札。true のとき x,y は「キャンバスの左うえからの画面px」、
    //   size と width も画面px で、カメラ（位置・拡大率・回転）の影響を一切受けない。
    //   カメラを物体に接続すると視点がその物体について行くので、ワールドに置いた
    //   説明文は地面と一緒に流れて画面から消える。走る電車に乗って見せるデモは、
    //   これが無いと本文を出したまま配れない。
    //   ★既定は false。ワールドに置いた注釈（図の中の見出し・お絵描き）はこれまで通り。
    this.screenPin = !!opts.screenPin;
    // ★物体に貼り付いた注釈（2026-10-01）。bodyId の物体と一緒に動き・回る（紙に書いた線と同じ）。
    //   bodyLocal は左うえの角と向きを「その物体から見た」値で持つ。x, y, angle は毎フレーム
    //   ここから書き直す（syncAttachedAnnotations）ので、ほかの注釈のコードはワールドの値だけを見ればよい。
    //   ★参照は「注釈 → 物体」の一方向だけ。物理の側は annotations を一切読まない（不変条件①）。
    this.bodyId    = opts.bodyId != null ? opts.bodyId : null;
    this.bodyLocal = opts.bodyLocal ? { x: opts.bodyLocal.x, y: opts.bodyLocal.y, angle: opts.bodyLocal.angle } : null;
  }
}
// 注釈を画面へ載せるときの原点・向き・拡大率。
//   ★画面に貼る札はカメラを素通し（位置も向きも倍率も）。「回さない」札は回転だけ素通し。
function annotScreenAnchor(a) {
  if (a.screenPin) return { x: a.x, y: a.y };
  return (a.noCamSpin && cam.angle) ? worldToScreenFlat(a.x, a.y) : worldToScreen(a.x, a.y);
}
function annotScreenAngle(a) {
  if (a.screenPin) return a.angle;
  return (a.noCamSpin && cam.angle) ? a.angle : a.angle + cam.angle;
}
// 以降をワールド単位で描くための倍率。画面に貼る札だけ 1（大きさも画面px）
function annotScreenScale(a) { return a.screenPin ? 1 : cam.zoom; }
// ★掴めるのはワールドに置いた注釈だけ。当たり判定はワールド座標で組んであり
//   （annotContains ほか）、画面に貼り付いた札だけ別座標で判定するのは、選択・ドラッグ・
//   拡大縮小・回転の全部を二重化することになる。触れない、で割り切る。
//   カメラを回している間の「回さない」札も同じ理由で外す。
function annotPickable(a) { return !a.screenPin && !(a.noCamSpin && cam.angle); }
function serializeAnnotation(a) {
  const o = { id: a.id, type: a.type, x: a.x, y: a.y, angle: a.angle, color: a.color, front: a.front,
              noCamSpin: a.noCamSpin, screenPin: a.screenPin };
  if (a.bodyId != null) { o.bodyId = a.bodyId; o.bodyLocal = a.bodyLocal; }
  if (a.type === 'text') { o.text = a.text; o.size = a.size; o.font = a.font; o.bold = a.bold; }
  else {
    o.width = a.width; o.closed = a.closed; o.rx = a.rx; o.ry = a.ry;
    if (a.pts) o.pts = a.pts.map(p => ({ x: p.x, y: p.y }));
  }
  return o;
}
function deserializeAnnotations(arr) { return (arr || []).map(d => new Annotation(d)); }

// ─── 物体に貼り付ける（2026-10-01）──────────────────────────────
//   ★吊り下げ法（重心の求め方）で、板に引いた鉛直線が板と一緒に振れるようにするため。
//     背景に引いた線は板を掛け替えると置き去りになり、2本の線の交点が作れない。
//   ★お絵描きで物体の上から描き始めると、その物体に貼り付く（annotDrawMouseDown）。
//     右パネルのチェックで外せる。貼り付けた線は手前に出す：既定の背面のままだと
//     貼った物体そのものに隠れて見えない。
//   ★物体が消えたら、貼ってあった線も消える（紙ごと捨てたのと同じ）。戻すは Undo。
function _annotBakeLocal(a, b) {
  const c = Math.cos(-b.angle), s = Math.sin(-b.angle), dx = a.x - b.x, dy = a.y - b.y;
  a.bodyLocal = { x: dx * c - dy * s, y: dx * s + dy * c, angle: a.angle - b.angle };
  a._lastW = { x: a.x, y: a.y, angle: a.angle };
}
function annotAttachToBody(a, b) {
  if (!a) return;
  a._lastW = null;
  if (!b || a.screenPin) { a.bodyId = null; a.bodyLocal = null; return; }
  a.bodyId = b.id;
  a.front = true;
  _annotBakeLocal(a, b);
}
// 毎フレーム描く前に呼ぶ（render）。
//   ★人が注釈を動かした・回した・拡げた（x, y, angle が前のフレームに書いた値と違う）なら、
//     その位置で貼り直す。こうしておけば、ドラッグ・回転・右パネルの欄のどれも
//     貼り付けを知らなくてよい。
function syncAttachedAnnotations() {
  let byId = null;
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    if (a.bodyId == null) continue;
    if (!byId) byId = new Map(objects.map(o => [o.id, o]));
    const b = byId.get(a.bodyId);
    if (!b) {
      annotations.splice(i, 1);
      if (selectedAnnotation === a) { selectedAnnotation = null; cancelAnnotInteractions(); updatePropsPanel(null); }
      continue;
    }
    const w = a._lastW;
    if (!a.bodyLocal || (w && (w.x !== a.x || w.y !== a.y || w.angle !== a.angle))) _annotBakeLocal(a, b);
    const L = a.bodyLocal, c = Math.cos(b.angle), s = Math.sin(b.angle);
    a.x = b.x + L.x * c - L.y * s;
    a.y = b.y + L.x * s + L.y * c;
    a.angle = b.angle + L.angle;
    a._lastW = { x: a.x, y: a.y, angle: a.angle };
  }
}
// 描き終えた線を、描き始めた所（無ければ描き終えた所）の物体に貼る
function _annotAttachStroke(a, s, lastPt) {
  if (!a) return;
  let b = s.body && objects.includes(s.body) ? s.body : null;
  if (!b && lastPt) b = frontmostBodyAtPoint(lastPt.x, lastPt.y);
  if (b) annotAttachToBody(a, b);
}

// ─── 寸法と座標変換 ─────────────────────────────────────
//   ローカル座標の原点は「左うえの角」。x は右、y は下が正（画面と同じ向き）。
//   文字の幅は実際に測る（フォントに依るので決め打ちできない）。測るのは
//   ワールド単位のフォントサイズなので、返る値もそのままワールド px。
function annotMeasure(text, size, fontKey, bold) {
  const lines = String(text === undefined || text === null ? '' : text).split('\n');
  ctx.save();
  const spec = annotApplyFont(size, fontKey, bold);
  let w = 0;
  for (const L of lines) w = Math.max(w, ctx.measureText(L).width);
  const base = annotBaselineInLine(size);
  ctx.restore();
  return { w, h: lines.length * size * ANNOT_LINE_H, lines, spec, base };
}
// 中身そのものの大きさ（余白を含まない）。左うえが原点なので 0..w, 0..h に載る。
function annotSize(a) {
  if (a.type === 'text') {
    const m = annotMeasure(a.text, a.size, a.font, a.bold);
    return { w: m.w, h: m.h };
  }
  // 楕円も折れ線と同じで、線の太さの半分ぶん外へ出る。それを含めた大きさを返す
  if (a.type === 'ellipse') return { w: a.rx * 2 + a.width, h: a.ry * 2 + a.width };
  // 折れ線。点は「線の太さの半分」だけ内側に置いてあるので（_makePath）、
  // 反対側にも同じだけ足すと、線の縁がちょうど 0..w / 0..h に収まる。
  let w = 0, h = 0;
  for (const p of (a.pts || [])) { w = Math.max(w, p.x); h = Math.max(h, p.y); }
  return { w: w + a.width / 2, h: h + a.width / 2 };
}
// 当たり判定・選択枠に使うローカル矩形（余白こみ）。種類ごとの違いはここだけに閉じる。
//   extra を渡すと、そのぶん外側へ広げる（消しゴムの半径ぶんなど）。
function annotBounds(a, extra) {
  const s = annotSize(a);
  const pad = ANNOT_PAD + (extra || 0);
  const w = Math.max(s.w, ANNOT_MIN_HIT), h = Math.max(s.h, ANNOT_MIN_HIT);
  return { x0: -pad, y0: -pad, x1: w + pad, y1: h + pad };
}
// 点と線分の距離。折れ線の当たり判定と間引きの両方で使う
function _annotDistPtSeg(p, a, b) {
  const ex = b.x - a.x, ey = b.y - a.y;
  const L2 = ex * ex + ey * ey;
  let t = L2 > 1e-12 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - a.x - ex * t, p.y - a.y - ey * t);
}
function annotLocalToWorld(a, lx, ly) {
  const c = Math.cos(a.angle), s = Math.sin(a.angle);
  return { x: a.x + lx * c - ly * s, y: a.y + lx * s + ly * c };
}
function annotWorldToLocal(a, wx, wy) {
  const c = Math.cos(-a.angle), s = Math.sin(-a.angle);
  const dx = wx - a.x, dy = wy - a.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
// 箱の中心（ワールド）。回転の軸に使う
function annotCenterWorld(a) {
  const s = annotSize(a);
  return annotLocalToWorld(a, s.w / 2, s.h / 2);
}
// 外接する箱に入っているか（粗い判定。速いので precise の前置きに使う）
function annotContains(a, wx, wy, extra) {
  const p = annotWorldToLocal(a, wx, wy);
  const b = annotBounds(a, extra);
  return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
}
// 実際に「線や文字の上」を指しているか。
//   ★折れ線を箱で判定してはいけない。斜めに引いた1本の線は箱が画面いっぱいになるので、
//     線から遠く離れた何もない所を指しても当たったことになる（消しゴムが巻き添えで
//     別の線を消す・掴むつもりのない線を掴む）。線そのものからの距離で見る。
function annotHit(a, wx, wy, tol) {
  tol = tol || 0;
  if (!annotContains(a, wx, wy, tol)) return false;   // 粗く弾く
  if (a.type === 'text') return true;                 // 文字は箱そのものが実体
  const p = annotWorldToLocal(a, wx, wy);
  if (a.type === 'ellipse') {
    // 枠線だけなので、楕円の縁までの距離で見る（内側の空白は当たらない）
    const s = annotSize(a);
    const cx = s.w / 2, cy = s.h / 2;
    const rx = Math.max(1e-6, a.rx), ry = Math.max(1e-6, a.ry);
    const k = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
    const r = Math.min(rx, ry);
    return Math.abs(k - 1) * r <= a.width / 2 + tol;
  }
  const pts = a.pts || [];
  if (!pts.length) return false;
  const r = a.width / 2 + tol;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= r;
  for (let i = 0; i + 1 < pts.length; i++)
    if (_annotDistPtSeg(p, pts[i], pts[i + 1]) <= r) return true;
  if (a.closed && pts.length > 2 && _annotDistPtSeg(p, pts[pts.length - 1], pts[0]) <= r) return true;
  return false;
}
// いちばん手前（配列の後ろ）から探す。描画順と拾う順を揃えるため。
//   掴むときの許容は画面px で決める（どの倍率でも同じ掴み心地になる）。
//   filter を渡すと、それを通ったものだけを拾う（ツールごとに掴める種類が違うため）。
function annotationAtPoint(wx, wy, tolPx, filter) {
  const tol = (tolPx === undefined ? ANNOT_PICK_TOL_PX : tolPx) / cam.zoom;
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    if (filter && !filter(a)) continue;
    if (!annotPickable(a)) continue;   // ★カメラを回している間、画面に貼り付いた札は掴めない
    if (annotHit(a, wx, wy, tol)) return a;
  }
  return null;
}
// ★選択枠とハンドルは、当たり判定の箱よりさらに外側へ出す。
//   内側のままだと、小さな注釈では四隅のハンドルが本体そのものに重なり、
//   真ん中を押したつもりでハンドルを掴んでしまう＝選ぶことも書き直すこともできない。
//   離す量は画面px で決める（どの倍率でも同じ間隔に見える。物体のギズモと同じ流儀）。
function _annotGizmoPad() { return ANNOT_PAD + GIZMO_PAD / cam.zoom; }
function annotGizmoBounds(a) {
  const s = annotSize(a);
  const pad = _annotGizmoPad();
  const w = Math.max(s.w, ANNOT_MIN_HIT), h = Math.max(s.h, ANNOT_MIN_HIT);
  return { x0: -pad, y0: -pad, x1: w + pad, y1: h + pad };
}
// 回転ハンドルは上辺の中央から、画面上で一定の距離だけ上に出す
function annotRotHandlePos(a) {
  const b = annotGizmoBounds(a);
  return annotLocalToWorld(a, (b.x0 + b.x1) / 2, b.y0 - ANNOT_ROT_PX / cam.zoom);
}
// 拡大縮小ハンドル＝選択枠の四隅。left/top は「その角が枠のどちら側か」。
//   掴んだ角の対角を固定して伸ばすので、四隅ぶんあれば縦・横・両方のすべてを操作できる
//   （辺の中央にも置くとハンドルが8個になり、小さな注釈では潰し合う）。
function annotScaleHandles(a) {
  const b = annotGizmoBounds(a);
  const out = [];
  for (const top of [true, false])
    for (const left of [true, false]) {
      const lx = left ? b.x0 : b.x1, ly = top ? b.y0 : b.y1;
      out.push({ left, top, world: annotLocalToWorld(a, lx, ly) });
    }
  return out;
}

// ─── 描画 ───────────────────────────────────────────────
//   front=false なら背面（物体より下）、true なら前面のものだけを描く。
//   render のループから2回呼ばれる（js/render/vectors.js）。
function drawAnnotations(front) {
  for (const a of annotations) if (!!a.front === front) drawAnnotation(a);
}
function drawAnnotation(a) {
  // 編集中のものは textarea が実体を出しているので、二重に描かない
  if (annotEditing && annotEditing.a === a) return;
  const sp = annotScreenAnchor(a);
  ctx.save();
  if (a.screenPin) ctx.setTransform(1, 0, 0, 1, 0, 0);   // ★画面へ貼る札はカメラを素通し
  ctx.translate(sp.x, sp.y);       // ★原点＝左うえの角
  ctx.rotate(annotScreenAngle(a)); // ★カメラの回転ぶんを足す（「回さない」札だけ素通し）
  const _z = annotScreenScale(a);
  ctx.scale(_z, _z);               // 以降はワールド単位で描ける＝拡大すると一緒に大きくなる
  if (a.type === 'text') drawAnnotText(a);
  else if (a.type === 'ellipse') drawAnnotEllipse(a);
  else if (a.type === 'path') drawAnnotPath(a);
  ctx.restore();
}
// 組み上げた現在のパスを2度なぞる。1度目は暗い縁取り、2度目が本体。
//   背景色は全体設定タブで明るくも暗くもできるので、縁が無いと背景に溶ける。
//   ★塗りはしない。図形は枠線のみ（中を塗ると背景の物体が隠れて、注釈が
//     「背景に置くもの」でなくなる）。
function _annotStrokeTwice(color, width) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = width + Math.max(1.5, width * 0.35);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
// 折れ線。自由ペン・直線・多角・四角・三角をこれ1本で描く
function drawAnnotPath(a) {
  const pts = a.pts || [];
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (a.closed && pts.length > 2) ctx.closePath();
  _annotStrokeTwice(a.color, a.width);
}
function drawAnnotEllipse(a) {
  const s = annotSize(a);
  ctx.beginPath();
  ctx.ellipse(s.w / 2, s.h / 2, Math.max(a.rx, 0.01), Math.max(a.ry, 0.01), 0, 0, Math.PI * 2);
  _annotStrokeTwice(a.color, a.width);
}
function drawAnnotText(a) {
  const m = annotMeasure(a.text, a.size, a.font, a.bold);
  ctx.font = m.spec;               // 測ったときと同じ指定（annotApplyFont が正規化したもの）
  ctx.textAlign = 'left';          // 左うえ基準なので左揃え（入力欄の見え方と揃える）
  ctx.textBaseline = 'alphabetic'; // ★ベースラインは自前で置く（annotBaselineInLine の★）
  ctx.lineJoin = 'round';
  // 背景色は全体設定タブで変えられる（明るくも暗くもなる）ので、文字そのものに
  // 縁取りを付けてどちらでも読めるようにする。地面や物体の上に重なっても同じ。
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = Math.max(2, a.size * 0.09);
  ctx.fillStyle = a.color;
  const step = a.size * ANNOT_LINE_H;
  for (let i = 0; i < m.lines.length; i++) {
    const L = m.lines[i];
    if (!L) continue;
    const y = i * step + m.base;    // 入力欄（CSSの行ボックス）とまったく同じ高さ
    ctx.strokeText(L, 0, y);
    ctx.fillText(L, 0, y);
  }
}
// 選択枠と回転ハンドル。注釈グループのツール中しか出さない
// （＝ほかのツールでは注釈は「ただの背景」として振る舞う）。
function drawAnnotationOverlay() {
  syncAnnotEditor();                                  // 編集中の textarea をカメラへ追従させる
  if (selectedAnnotation && !annotations.includes(selectedAnnotation)) selectedAnnotation = null;
  if (!isAnnotToolActive()) return;
  const a = selectedAnnotation;
  if (!a) return;
  const b = annotGizmoBounds(a);
  const sp = annotScreenAnchor(a);
  ctx.save();
  ctx.translate(sp.x, sp.y);
  ctx.rotate(annotScreenAngle(a));   // ★同上
  ctx.scale(cam.zoom, cam.zoom);
  ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 1.5 / cam.zoom;
  ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  ctx.restore();
  // 四隅の拡大縮小ハンドル（物体の変形ギズモと同じ見た目に揃える）
  const scOn = !!annotScale;
  ctx.save();
  ctx.setLineDash([]);
  for (const hd of annotScaleHandles(a)) {
    const s = worldToScreen(hd.world.x, hd.world.y);
    ctx.beginPath(); ctx.rect(s.x - 4, s.y - 4, 8, 8);
    ctx.fillStyle = scOn ? '#ffd54f' : '#4fc3f7'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.restore();
  // 回転ハンドル
  const sh = worldToScreen(annotRotHandlePos(a).x, annotRotHandlePos(a).y);
  const tw = annotLocalToWorld(a, (b.x0 + b.x1) / 2, b.y0);   // 上辺の中央（線の根元）
  const top = worldToScreen(tw.x, tw.y);
  const active = !!(annotRotate && annotRotate.a === a);
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(sh.x, sh.y);
  ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(sh.x, sh.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = active ? '#ffd54f' : '#4fc3f7';
  ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  if (active) {                                       // 右向き0°・上向き正（速度ツールと同じ規約）
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(_dispDeg(a.angle).toFixed(1) + '°', sh.x + 10, sh.y - 8);
  }
  ctx.restore();
}

// ─── カーソル ───────────────────────────────────────────
//   「いま押したら何が起きるか」をカーソルで見せる。注釈は編集ツールの対象外なので、
//   ここが「掴めるかどうか」を伝える唯一の手がかりになる。
//     crosshair … 何もない所＝ここに新しい文字を置く
//     move      … 置いてある文字の上＝クリックで選択、ドラッグで移動
//     text      … 選択済みの文字の上＝もう一度クリックすると中身を編集できる
//     grab      … 回転ハンドルの上
function annotHoverCursor(wp) {
  if (!isAnnotToolActive()) return null;
  if (annotEditing) return 'default';
  if (annotRotate || annotDrag || annotScale) return 'grabbing';
  // 描くモード中は掴む対象を探さない（描くのが目的なので、常に「描ける」形にする）。
  // 消しゴムは当たる範囲を円で描いてあるので、カーソル自体は十字のままでよい。
  if (!isAnnotSelectMode()) return 'crosshair';
  const a = selectedAnnotation;
  if (a) {
    if (annotRotHandleHit(a, wp)) return 'grab';
    // 四隅のハンドル。どの向きへ伸びるかをカーソルの形で見せる（枠が回っていても、
    // 画面上でどちらへ引けばよいかが分かるように、角の画面位置から決める）
    const sp = worldToScreen(wp.x, wp.y);
    for (const h of annotScaleHandles(a)) {
      const s = worldToScreen(h.world.x, h.world.y);
      if (!(Math.hypot(s.x - sp.x, s.y - sp.y) <= GIZMO_HIT)) continue;
      const cen = annotCenterWorld(a), sc = worldToScreen(cen.x, cen.y);
      return ((s.x < sc.x) === (s.y < sc.y)) ? 'nwse-resize' : 'nesw-resize';
    }
    // 文字は「もう一度クリックで書き直し」、線・図形はそれが無いので掴む形のまま
    if (annotContains(a, wp.x, wp.y)) return a.type === 'text' ? 'text' : 'move';
  }
  if (annotationAtPoint(wp.x, wp.y, undefined, annotSelectFilter())) return 'move';
  // テキストツールは何もない所で文字を置ける。選択モードは置くものが無いので矢印
  return currentTool === 'text' ? 'crosshair' : 'default';
}
function refreshAnnotCursor(wp) {
  const c = annotHoverCursor(wp);
  if (c) canvas.parentElement.style.cursor = c;
}

// ─── 選択・平行移動・回転 ───────────────────────────────
function selectAnnotation(a) {
  clearAllSelections();                 // 物体などの選択とは同時に持たない（削除の行き先を1つに保つ）
  selectedAnnotation = a;
  if (a) updateAnnotPanel(a); else updatePropsPanel(null);
  document.getElementById('st-sel').textContent = a ? 'テキスト' : 'なし';
  syncAnnotPopup();
}
// ツール設定ウィンドウが開いていれば、選択中の注釈の値を映す。
// （開いていなければ何もしない＝窓の有無をこの関数の外で気にしなくてよい）
function syncAnnotPopup() {
  const a = selectedAnnotation;
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('an-swatch', el => el.style.background = a ? a.color : annotColor);
  set('dr-swatch', el => el.style.background = a ? a.color : annotColor);
  const lw = ((a && a.type !== 'text') ? a.width : annotLineWidth) * PX2M;
  set('dr-w',     el => el.value = lw.toFixed(3));
  set('dr-w-val', el => el.textContent = lw.toFixed(3));
  set('an-front',  el => el.checked = !!(a && a.front));
  set('an-bold',   el => el.checked = a ? !!a.bold : annotBold);
  set('an-font',   el => el.value = a ? a.font : annotFont);
  const m = ((a && a.type === 'text') ? a.size : annotTextSize) * PX2M;
  set('an-size',     el => el.value = m.toFixed(2));
  set('an-size-val', el => el.textContent = m.toFixed(2));
}
function beginAnnotDrag(a, wp, editOnClick) {
  annotDrag = { a, dx: a.x - wp.x, dy: a.y - wp.y, armed: true, moved: false, editOnClick: !!editOnClick };
}
function dragAnnotTo(wp) {
  const d = annotDrag;
  if (!d) return;
  let nx = wp.x + d.dx, ny = wp.y + d.dy;
  if (snapEnabled) { const s = snapPt({ x: nx, y: ny }); nx = s.x; ny = s.y; }
  if (Math.abs(nx - d.a.x) < 1e-9 && Math.abs(ny - d.a.y) < 1e-9) return;
  if (d.armed) { pushUndo(); d.armed = false; }   // 実際に動いた時だけ履歴を積む
  d.moved = true;
  d.a.x = nx; d.a.y = ny;
}
// 回転は「箱の中心まわり」。左うえの角を軸にすると、少し回しただけで文字が大きく
// 振り回されて狙いが定まらない。中心を固定して回し、そのつど左うえの角を出し直す
// （持っている値の意味＝不変条件③は保たれる）。
function beginAnnotRotate(a, wp) {
  const c = annotCenterWorld(a);
  annotRotate = { a, cx: c.x, cy: c.y, ang0: a.angle,
                  p0: Math.atan2(wp.y - c.y, wp.x - c.x), armed: true, moved: false };
}
function rotateAnnotTo(wp) {
  const r = annotRotate;
  if (!r) return;
  const cur = Math.atan2(wp.y - r.cy, wp.x - r.cx);
  let ang = r.ang0 + (cur - r.p0);
  if (modShift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);   // Shift＝15°刻み
  if (Math.abs(ang - r.a.angle) < 1e-9) return;
  if (r.armed) { pushUndo(); r.armed = false; }
  r.moved = true;
  setAnnotAngleAboutCenter(r.a, ang, r.cx, r.cy);
}
// 中心 (cx,cy) を動かさずに角度を ang にする
function setAnnotAngleAboutCenter(a, ang, cx, cy) {
  const s = annotSize(a);
  const c = Math.cos(ang), sn = Math.sin(ang);
  a.angle = ang;
  a.x = cx - (s.w / 2 * c - s.h / 2 * sn);
  a.y = cy - (s.w / 2 * sn + s.h / 2 * c);
}
// カーソルが回転ハンドルの上にあるか（当たり半径は画面px固定＝どの倍率でも同じ掴み心地）。
//   ★判定は「近いときだけ true」と書く。`dist > HIT なら false` の形にすると、距離が
//     NaN になったとき比較が偽になって素通りし、画面のどこを押しても回転ハンドルを
//     掴んだことになってしまう（＝文字を選ぶことも動かすこともできなくなる）。
//     距離が NaN になるのは worldToScreen がまだ画面サイズを知らないときなど。
function annotRotHandleHit(a, wp) {
  const hp = annotRotHandlePos(a);
  const sh = worldToScreen(hp.x, hp.y);
  const sp = worldToScreen(wp.x, wp.y);
  return Math.hypot(sh.x - sp.x, sh.y - sp.y) <= GIZMO_HIT;
}
// ─── 拡大縮小 ───────────────────────────────────────────
//   掴んだ角の「対角」をワールドに固定したまま、中身の寸法だけを変える。
//   ★倍率は毎フレーム「掴んだ時点の値」から作り直す（前フレームの結果に掛け足さない）。
//     掛け足すと、行きつ戻りつするうちに丸め誤差が積もって、カーソルへ戻しても
//     元の大きさに戻らなくなる。
//   ★文字だけは等倍。横だけ伸ばした文字を表すには size とは別に倍率を持つ必要があり、
//     保存の型が増えるわりに、教材の注釈で使う場面がない。
const ANNOT_MIN_SCALE_PX = 4;   // [px] これ以下には縮めない（潰すと二度と掴めない）
function beginAnnotScaleIfHit(wp) {
  const a = selectedAnnotation;
  if (!a || !isAnnotToolActive()) return false;
  const sp = worldToScreen(wp.x, wp.y);
  for (const h of annotScaleHandles(a)) {
    const s = worldToScreen(h.world.x, h.world.y);
    if (!(Math.hypot(s.x - sp.x, s.y - sp.y) <= GIZMO_HIT)) continue;   // ★NaN は掴まない側へ倒す
    const size = annotSize(a);
    // 対角＝固定する角
    const b = annotGizmoBounds(a);
    const fx = h.left ? b.x1 : b.x0, fy = h.top ? b.y1 : b.y0;
    annotScale = {
      a, left: !h.left, top: !h.top,            // 固定側がどちらか
      fixed: annotLocalToWorld(a, fx, fy),
      w0: Math.max(size.w, 1e-6), h0: Math.max(size.h, 1e-6),
      size0: a.size, rx0: a.rx, ry0: a.ry,
      pts0: a.pts ? a.pts.map(p => ({ x: p.x, y: p.y })) : null,
      armed: true, moved: false,
    };
    return true;
  }
  return false;
}
function updateAnnotScaleTo(wp) {
  const s = annotScale;
  if (!s) return;
  const a = s.a;
  // 固定した角から見た、カーソルまでの距離（注釈の向きに合わせて測る）
  const c = Math.cos(-a.angle), sn = Math.sin(-a.angle);
  const dx = wp.x - s.fixed.x, dy = wp.y - s.fixed.y;
  const lx = Math.abs(dx * c - dy * sn), ly = Math.abs(dx * sn + dy * c);
  const minC = ANNOT_MIN_SCALE_PX;
  // 枠は中身の外側へ左右・上下それぞれ pad ずつ出ているので、その分を引くと中身の寸法になる
  const pad = _annotGizmoPad();
  let sx = Math.max(minC, lx - pad * 2) / s.w0;
  let sy = Math.max(minC, ly - pad * 2) / s.h0;
  if (modShift) { const u = Math.max(sx, sy); sx = u; sy = u; }   // Shift＝縦横の比を保つ
  if (a.type === 'text') { const u = (sx + sy) / 2; sx = u; sy = u; }
  if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9 && !s.moved) return;
  if (s.armed) { pushUndo(); s.armed = false; }
  s.moved = true;
  _applyAnnotScale(a, s, sx, sy);
  _reanchorAnnotAfterScale(a, s);
}
// 掴んだ時点の値へ倍率を掛け直す（積み上げない）
function _applyAnnotScale(a, s, sx, sy) {
  if (a.type === 'text') { a.size = Math.max(1, s.size0 * sx); return; }
  if (a.type === 'ellipse') {
    a.rx = Math.max(0.5, s.rx0 * sx);
    a.ry = Math.max(0.5, s.ry0 * sy);
    return;
  }
  if (!s.pts0) return;
  // 点は「線の太さの半分」だけ内側にある。その分を外してから伸ばし、また戻す
  // （そうしないと線の縁が箱からはみ出したり内側に食い込んだりする）。
  const h = a.width / 2;
  for (let i = 0; i < s.pts0.length; i++) {
    a.pts[i].x = (s.pts0[i].x - h) * sx + h;
    a.pts[i].y = (s.pts0[i].y - h) * sy + h;
  }
}
// 固定した角がワールドで動かないように、左うえの角を置き直す（不変条件③を保つ）
function _reanchorAnnotAfterScale(a, s) {
  const size = annotSize(a);
  const pad = _annotGizmoPad();
  const fx = s.left ? -pad : size.w + pad;
  const fy = s.top  ? -pad : size.h + pad;
  const c = Math.cos(a.angle), sn = Math.sin(a.angle);
  a.x = s.fixed.x - (fx * c - fy * sn);
  a.y = s.fixed.y - (fx * sn + fy * c);
}
// 回転ハンドルを掴んだか（選択中の注釈だけが持つ）
function beginAnnotRotateIfHit(wp) {
  const a = selectedAnnotation;
  if (!a || !isAnnotToolActive()) return false;
  if (!annotRotHandleHit(a, wp)) return false;
  beginAnnotRotate(a, wp);
  return true;
}
function deleteSelectedAnnotation() {
  const a = selectedAnnotation;
  if (!a) return false;
  const i = annotations.indexOf(a);
  if (i < 0) { selectedAnnotation = null; return false; }
  pushUndo();
  annotations.splice(i, 1);
  selectedAnnotation = null;
  updatePropsPanel(null);
  document.getElementById('st-sel').textContent = 'なし';
  return true;
}
// ツール切替・Esc・Undo から呼ぶ後始末
function cancelAnnotInteractions() {
  annotDrag = null;
  annotRotate = null;
  annotScale = null;
  annotStroke = null;        // 描きかけの線も捨てる
  annotErasing = false;
  annotEraseArmed = false;
}

// ─── お絵描き（自由ペン・直線・消しゴム）───────────────────
//   ★描いたものは type:'path' の折れ線ひとつに揃える。自由ペンも直線も、Phase 3 の
//     多角・四角・三角も同じ型なので、平行移動・回転・当たり判定・保存・Undo の
//     コードはすべて共用できる（増えるのは「点をどう作るか」だけ）。

// 折れ線を1本作って置く。points はワールド座標。
//   ★左うえの角を x, y に持つ（不変条件③）。点は角からの相対にし、線の太さの半分だけ
//     内側へ寄せる＝線の縁がちょうど箱に収まる。
function _makeAnnotPath(points, closed) {
  if (!points || points.length < 2) return null;
  let minX = Infinity, minY = Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
  const w = annotLineWidth;
  const ax = minX - w / 2, ay = minY - w / 2;
  const a = new Annotation({
    type: 'path', x: ax, y: ay, color: annotColor, width: w, closed: !!closed,
    pts: points.map(p => ({ x: p.x - ax, y: p.y - ay })),
  });
  pushUndo();
  annotations.push(a);
  return a;
}
// 楕円を1つ置く。左うえの角は「線の縁を含めた外接箱」の角にする（折れ線と同じ約束）。
function _makeAnnotEllipse(cx, cy, rx, ry) {
  const w = annotLineWidth;
  const a = new Annotation({ type: 'ellipse', x: cx - rx - w / 2, y: cy - ry - w / 2,
                             rx, ry, width: w, color: annotColor });
  pushUndo();
  annotations.push(a);
  return a;
}
// ドラッグ1回で決まる図形。始点と現在位置から形を作る。
//   ★作法は物体の図形ツール（js/core/geometry.js の buildDragShape）に合わせる。
//     同じ操作で違う結果になるほうが覚えづらいので、始点の意味も Shift の効き方も揃える。
//       四角 … 始点＝角、Shift で正方形
//       三角 … 始点＝直角の頂点、Shift で直角二等辺
//       丸　 … 始点＝中心、Shift で正円
function _annotDragShape(mode, start, cur, shift) {
  let w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
  if (shift) { const s = Math.max(w, h); w = s; h = s; }
  const sx = Math.sign(cur.x - start.x) || 1, sy = Math.sign(cur.y - start.y) || 1;
  if (mode === 'ellipse') return { kind: 'ellipse', cx: start.x, cy: start.y, rx: w, ry: h };
  if (mode === 'rect') {
    const x1 = start.x + sx * w, y1 = start.y + sy * h;
    return { kind: 'path', closed: true, pts: [
      { x: start.x, y: start.y }, { x: x1, y: start.y }, { x: x1, y: y1 }, { x: start.x, y: y1 }] };
  }
  // 三角：直角の頂点が始点、脚が x 方向と y 方向
  return { kind: 'path', closed: true, pts: [
    { x: start.x, y: start.y },
    { x: start.x + sx * w, y: start.y },
    { x: start.x, y: start.y + sy * h }] };
}
// Douglas–Peucker。手で描いた線はそのままだと点が多すぎて、保存した .json も
// Undo のスナップショットも際限なく太る。見た目が変わらない範囲で間引く。
function _simplifyAnnotPath(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bd = eps;
    for (let k = i + 1; k < j; k++) {
      const d = _annotDistPtSeg(pts[k], pts[i], pts[j]);
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  const out = [];
  for (let k = 0; k < pts.length; k++) if (keep[k]) out.push(pts[k]);
  return out;
}
// 消しゴム：触れた線を1本まるごと消す（部分的には削らない）。
//   ★ベクタで持っているので、途中だけ消すには線を分割することになる。自由ペンなら
//     できるが、四角や丸では「枠線の一部が欠けた図形」を表す型が要る。1本単位なら
//     どの型でも同じ扱いで済み、Undo とも素直に噛み合う。
//   ★文字は消さない。書いた説明文の上をうっかり撫でて消えるほうが事故が大きく、
//     文字はテキストツールで選んで Delete すれば消せる。
function annotEraseAt(wp) {
  const r = ANNOT_ERASER_PX / cam.zoom;
  let erased = false;
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    if (a.type === 'text') continue;
    if (!annotHit(a, wp.x, wp.y, r)) continue;
    if (annotEraseArmed) { pushUndo(); annotEraseArmed = false; }   // 1なでにつき1回だけ積む
    annotations.splice(i, 1);
    if (selectedAnnotation === a) { selectedAnnotation = null; updatePropsPanel(null); }
    erased = true;
  }
  return erased;
}
function annotDrawMouseDown(wp) {
  if (annotDrawMode === 'eraser') {
    annotErasing = true;         // 押している間だけ消す
    annotEraseArmed = true;      // このなでで最初に消すときだけ履歴を積む
    annotEraseAt(wp);
    return true;
  }
  const p = _annotPlacePoint(wp);
  // ── 多角：ドラッグではなくクリックを重ねて頂点を打つ ──
  if (annotDrawMode === 'poly') {
    if (!annotStroke || annotStroke.mode !== 'poly') {
      annotStroke = { mode: 'poly', pts: [p], body: frontmostBodyAtPoint(p.x, p.y) };
      return true;
    }
    const s = annotStroke;
    // 始点まで戻ってきた＝ここで閉じて確定（物体の多角形ツールと同じ作法）
    if (s.pts.length >= 3 && _nearAnnotPolyStart(s, wp)) { _finishAnnotPoly(); return true; }
    if (s.pts.length < ANNOT_MAX_PTS) s.pts.push(p);
    return true;
  }
  // 直線は2点目をドラッグ中に動かすので、最初から2点入れておく
  // ★描き始めた所に物体があれば、その物体に貼り付ける（_annotAttachStroke）
  annotStroke = { mode: annotDrawMode, start: p, cur: p, body: frontmostBodyAtPoint(p.x, p.y),
                  pts: annotDrawMode === 'line' ? [p, p] : [p] };
  return true;
}
function _nearAnnotPolyStart(s, wp) {
  const a = worldToScreen(s.pts[0].x, s.pts[0].y);
  const b = worldToScreen(wp.x, wp.y);
  return Math.hypot(a.x - b.x, a.y - b.y) <= ANNOT_CLOSE_PX;
}
// 多角を閉じて確定する。頂点が3つ未満なら図形にならないので捨てる。
//   ★同じ場所の頂点は落とす。ダブルクリックで終えると、2回のクリックが同じ点に
//     重なって「動かない頂点」が増えるため。
function _finishAnnotPoly() {
  const s = annotStroke;
  annotStroke = null;
  if (!s || s.mode !== 'poly') return false;
  const eps = 1e-6;
  const pts = [];
  for (const p of s.pts) {
    const q = pts[pts.length - 1];
    if (!q || Math.abs(q.x - p.x) > eps || Math.abs(q.y - p.y) > eps) pts.push(p);
  }
  if (pts.length < 3) return false;
  _annotAttachStroke(_makeAnnotPath(pts, true), s, pts[pts.length - 1]);
  return true;
}
function annotDrawMouseMove(wp) {
  if (annotErasing) { annotEraseAt(wp); return true; }
  const s = annotStroke;
  if (!s) return false;
  const snapped = _annotPlacePoint(wp);
  if (s.mode === 'poly') return true;   // 次の1本は mouseWorld から毎フレーム引く
  if (s.mode === 'line') {
    s.pts[1] = modShift ? angleSnappedPoint(s.start, wp) : snapped;   // Shift＝角度スナップ
    return true;
  }
  if (s.mode === 'pen') {
    const last = s.pts[s.pts.length - 1];
    const minD = ANNOT_PEN_MIN_PX / cam.zoom;
    if (s.pts.length < ANNOT_MAX_PTS && Math.hypot(wp.x - last.x, wp.y - last.y) >= minD)
      s.pts.push({ x: wp.x, y: wp.y });
    return true;
  }
  s.cur = snapped;                       // 四角・三角・丸は現在位置だけを持つ
  return true;
}
function annotDrawMouseUp() {
  if (annotErasing) { annotErasing = false; annotEraseArmed = false; return true; }
  const s = annotStroke;
  if (!s) return false;
  if (s.mode === 'poly') return true;    // クリックで積む方式なので、離しても確定しない
  annotStroke = null;
  const minD = ANNOT_MIN_LINE_PX / cam.zoom;
  if (s.mode === 'line') {
    // 動かしていない＝置くつもりのないクリック。長さ0の線は残しても掴めない
    if (Math.hypot(s.pts[1].x - s.pts[0].x, s.pts[1].y - s.pts[0].y) < minD) return true;
    _annotAttachStroke(_makeAnnotPath(s.pts, false), s, s.pts[1]);
    return true;
  }
  if (s.mode === 'pen') {
    let pts = _simplifyAnnotPath(s.pts, ANNOT_SIMPLIFY_PX / cam.zoom);
    // 動かさずに押しただけ＝点を打つ。同じ点を2つ並べると、丸い線端がそのまま点になる
    if (pts.length === 1) pts = [pts[0], { x: pts[0].x, y: pts[0].y }];
    _annotAttachStroke(_makeAnnotPath(pts, false), s, pts[pts.length - 1]);
    return true;
  }
  // 四角・三角・丸。つぶれたものは事故クリックとみなして捨てる
  const shape = _annotDragShape(s.mode, s.start, s.cur, modShift);
  if (shape.kind === 'ellipse') {
    if (shape.rx < minD && shape.ry < minD) return true;
    _annotAttachStroke(_makeAnnotEllipse(shape.cx, shape.cy, Math.max(shape.rx, minD), Math.max(shape.ry, minD)), s, s.cur);
    return true;
  }
  let w = 0, h = 0;
  for (const p of shape.pts) {
    w = Math.max(w, Math.abs(p.x - s.start.x));
    h = Math.max(h, Math.abs(p.y - s.start.y));
  }
  if (w < minD && h < minD) return true;
  _annotAttachStroke(_makeAnnotPath(shape.pts, shape.closed), s, s.cur);
  return true;
}
// 描いている最中の線と、消しゴムの当たる範囲。まだ annotations に入れていないので
// ここで描く（確定してはじめて配列に入る＝途中でツールを変えても残骸が出ない）。
function drawAnnotDrawing() {
  if (!isAnnotToolActive() || currentTool !== 'draw' || annotDrawMode === 'select') return;
  ctx.save();
  if (annotDrawMode === 'eraser') {
    const c = worldToScreen(mouseWorld.x, mouseWorld.y);
    ctx.beginPath();
    ctx.arc(c.x, c.y, ANNOT_ERASER_PX, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const s = annotStroke;
  if (s) {
    ctx.setLineDash([]);
    const shape = _annotPreviewShape(s);
    ctx.beginPath();
    if (shape.kind === 'ellipse') {
      const c = worldToScreen(shape.cx, shape.cy);
      ctx.ellipse(c.x, c.y, Math.max(shape.rx, 0.01) * cam.zoom,
                  Math.max(shape.ry, 0.01) * cam.zoom, 0, 0, Math.PI * 2);
    } else if (shape.pts.length) {
      const p0 = worldToScreen(shape.pts[0].x, shape.pts[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < shape.pts.length; i++) {
        const p = worldToScreen(shape.pts[i].x, shape.pts[i].y);
        ctx.lineTo(p.x, p.y);
      }
      if (shape.closed && shape.pts.length > 2) ctx.closePath();
    }
    _annotStrokeTwice(annotColor, annotLineWidth * cam.zoom);
    // 多角：始点に印を出す。ここへ戻ってくれば閉じられる、という手がかり
    if (s.mode === 'poly') {
      const a0 = worldToScreen(s.pts[0].x, s.pts[0].y);
      const canClose = s.pts.length >= 3 && _nearAnnotPolyStart(s, mouseWorld);
      ctx.beginPath();
      ctx.arc(a0.x, a0.y, ANNOT_CLOSE_PX / 2, 0, Math.PI * 2);
      ctx.fillStyle = canClose ? '#ffd54f' : 'rgba(79,195,247,0.6)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.restore();
}
// 描いている最中の形。確定したときとまったく同じ作り方をするので、
// 「見えていた形」と「置かれた形」が食い違わない。
//   ★多角の「次の1本」は、マウス移動のイベントではなく毎フレームの mouseWorld から
//     作る。canvas の mousemove はボタンを押している間しか注釈へ回ってこないので、
//     イベント側で持つと、頂点を打った後から次に押すまでの間だけ線が止まる
//     （＝カーソルにとぎれとぎれに付いてくる）。物体の多角形ツールのプレビューも
//     同じく mouseWorld を直接見ている。
function _annotPreviewShape(s) {
  if (s.mode === 'poly')
    return { kind: 'path', closed: false, pts: s.pts.concat([_annotPlacePoint(mouseWorld)]) };
  if (s.mode === 'pen' || s.mode === 'line')
    return { kind: 'path', closed: false, pts: s.pts };
  return _annotDragShape(s.mode, s.start, s.cur || s.start, modShift);
}
// 置く点。グリッドスナップが入っていれば格子へ乗せる（プレビューと確定で共用）
function _annotPlacePoint(wp) {
  return snapEnabled ? snapPt(wp) : { x: wp.x, y: wp.y };
}

// ─── テキストの入力（キャンバス上のその場編集）─────────────
//   ダイアログではなく textarea を重ねるのは、書いている文字が置かれる場所と
//   大きさのまま見えるようにするため。フォント指定は canvas と同じ文字列を入れるので、
//   確定した瞬間に見た目が変わらない。
//   ★枠は border ではなく outline で描く。border は場所を取るので、文字の左うえと
//     クリックした点がずれてしまう（outline はレイアウトに影響しない）。
//   ★グローバルのキーボードショートカットは js/input/keyboard.js の先頭で
//     TEXTAREA を弾いているので、ここで stopPropagation する必要はない。
let annotEditing = null;   // { a, ta, isNew, text0 }
function beginAnnotEdit(a, isNew) {
  finishAnnotEdit();
  const ta = document.createElement('textarea');
  ta.value = a.text || '';
  ta.spellcheck = false;
  ta.wrap = 'off';        // ★自動折り返しを切る。折り返すと、確定して canvas に描いた
                          //   ときの行数と食い違い、確定の瞬間に見た目が飛ぶ
  ta.style.cssText =
    'position:absolute; z-index:900; margin:0; padding:0; border:none;' +
    'background:rgba(0,0,0,0.55); border-radius:2px;' +
    'outline:1px dashed #4fc3f7; outline-offset:3px;' +
    'resize:none; overflow:hidden; text-align:left; transform-origin:0 0;';
  ta.style.color = a.color;
  // ★入れ先は canvas の親（#canvas-wrap）でなければならない。
  //   worldToScreen が返すのは「canvas の左うえを原点とした座標」で、canvas 自体は
  //   左ツールバー（52px）と上のメニューバーのぶん、ページの原点から右下にある。
  //   document.body へ入れると、その差だけ入力欄が左うえへずれ、確定した瞬間に
  //   canvas 側の正しい位置（＝右下）へ文字が飛ぶ。
  //   #canvas-wrap は position:relative かつ canvas と同じ大きさなので、ここへ入れれば
  //   left/top にそのまま画面座標を入れられる（overflow:hidden の切り取りも canvas と揃う）。
  canvas.parentElement.appendChild(ta);
  annotEditing = { a, ta, isNew, text0: a.text };
  syncAnnotEditor();
  ta.focus();
  ta.select();
  ta.addEventListener('input', syncAnnotEditor);
  ta.addEventListener('blur', () => finishAnnotEdit());
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); finishAnnotEdit(true); }
    // Enter は改行（複数行を書けるようにするため）。確定は Ctrl+Enter か、外をクリック。
    else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finishAnnotEdit(); }
  });
}
// 編集中の textarea を注釈の位置・大きさ・向きへ合わせる。
// 毎フレーム呼ばれるので、カメラを動かしても文字が置き去りにならない。
function syncAnnotEditor() {
  if (!annotEditing) return;
  const { a, ta } = annotEditing;
  const m = annotMeasure(ta.value, a.size, a.font, a.bold);
  const sp = worldToScreen(a.x, a.y);
  const z = cam.zoom;
  // ★canvas が実際に使った指定をそのまま入れる。同じ文字列を渡すことで、
  //   測った幅・高さと入力欄の見え方が食い違わない。
  //   font の一括指定は line-height を初期値へ戻すので、必ずそのあとで入れ直す。
  ta.style.font = annotApplyFont(a.size * z, a.font, a.bold);
  ta.style.lineHeight = ANNOT_LINE_H;
  ta.style.width  = (Math.max(m.w, a.size) * z) + 'px';
  ta.style.height = (m.h * z) + 'px';
  // 左うえの角をクリック点に合わせ、そこを軸に回す（canvas 側の描画とまったく同じ）
  ta.style.left = sp.x + 'px';
  ta.style.top  = sp.y + 'px';
  ta.style.transform = 'rotate(' + a.angle + 'rad)';
}
// cancel=true なら書き換えを捨てる（Esc）。
//   ★空文字のまま確定したものは残さない。見えない当たり判定だけが背景に residual として
//     残り、あとから掴めも消せもしなくなるため。
function finishAnnotEdit(cancel) {
  if (!annotEditing) return;
  const { a, ta, isNew, text0 } = annotEditing;
  annotEditing = null;                       // ★先に降ろす（remove が blur を呼んでも再入しない）
  const next = cancel ? text0 : ta.value;
  ta.remove();
  if (!next.trim()) {
    if (isNew) return;                       // まだ配列に入れていない＝捨てるだけ
    const i = annotations.indexOf(a);
    if (i >= 0) { pushUndo(); annotations.splice(i, 1); }
    if (selectedAnnotation === a) {
      selectedAnnotation = null;
      updatePropsPanel(null);
      document.getElementById('st-sel').textContent = 'なし';
    }
    return;
  }
  if (isNew) {
    pushUndo();                              // 先に積む＝Undo でこの注釈が消える
    a.text = next;
    annotations.push(a);
    selectAnnotation(a);
    return;
  }
  if (next !== text0) { pushUndo(); a.text = next; }
  if (selectedAnnotation === a) updateAnnotPanel(a);
}

// ─── マウス（js/input/mouse.js から、注釈ツールのときだけ呼ばれる）─────
//   戻り値 true ＝ このイベントは注釈が処理した（呼び出し元はそこで打ち切る）
function annotMouseDown(wp, e) {
  if (!isAnnotToolActive()) return false;
  // 編集中はまず確定させる。ここで確定せずに進めると、クリックのたびに空の
  // テキストが増えていく（canvas の mousedown は preventDefault するので、
  // textarea の blur が自動では飛んでこない）。
  if (annotEditing) { finishAnnotEdit(); return true; }
  if (e.button !== 0) return false;
  // ★描くモード中は、既にある線の上でも「描く」を優先する。そうしないと引いた線の上へ
  //   重ねて描けない（選ぶだけになってしまう）。掴みたいときは「選択」モードへ。
  if (!isAnnotSelectMode()) return annotDrawMouseDown(wp);
  if (beginAnnotRotateIfHit(wp)) return true;
  if (beginAnnotScaleIfHit(wp)) return true;   // 回転ハンドルより後（枠の外側にある回転を優先）
  const hit = annotationAtPoint(wp.x, wp.y, undefined, annotSelectFilter());
  if (hit) {
    // ★すでに選ばれているものをもう一度クリック＝中身の編集に入る。ただし判定は
    //   離したときに行う（押した瞬間に編集へ入ると、掴んで動かすことができなくなる）。
    const again = selectedAnnotation === hit;
    if (!again) selectAnnotation(hit);
    beginAnnotDrag(hit, wp, again);
    return true;
  }
  if (currentTool === 'text') {
    // 何も無いところ＝新しいテキストを置く。クリックした点が左うえの角になり、
    // 打った文字は右と下へ伸びる。配列へ入れるのは確定できたときだけ。
    if (selectedAnnotation) selectAnnotation(null);
    const p = snapEnabled ? snapPt(wp) : wp;
    const a = new Annotation({ type: 'text', x: p.x, y: p.y, color: annotColor,
                               size: annotTextSize, font: annotFont, bold: annotBold });
    beginAnnotEdit(a, true);
    return true;
  }
  if (selectedAnnotation) selectAnnotation(null);
  return true;
}
function annotMouseMove(wp) {
  if (annotScale)  { updateAnnotScaleTo(wp); return true; }
  if (annotRotate) { rotateAnnotTo(wp); return true; }
  if (annotDrag)   { dragAnnotTo(wp);   return true; }
  if (isAnnotToolActive() && !isAnnotSelectMode()) return annotDrawMouseMove(wp);
  return false;
}
function annotMouseUp() {
  if (isAnnotToolActive() && !isAnnotSelectMode() && annotDrawMouseUp()) return true;
  if (annotScale) {
    const a = annotScale.a;
    annotScale = null;
    if (selectedAnnotation === a) { refreshAnnotFields(a); syncAnnotPopup(); }
    return true;
  }
  const d = annotDrag;
  if (!annotRotate && !d) return false;
  annotRotate = null;
  annotDrag = null;
  // 動かさずに離した＋すでに選ばれていた＝編集に入る（2回目のクリック）
  if (d && !d.moved && d.editOnClick && d.a.type === 'text') beginAnnotEdit(d.a, false);
  return true;
}
function annotDblClick(wp) {
  if (!isAnnotToolActive()) return false;
  // 多角は始点へ戻らなくても、ダブルクリックでそこまでを閉じて確定できる
  if (annotStroke && annotStroke.mode === 'poly') { _finishAnnotPoly(); return true; }
  if (!isAnnotSelectMode()) return true;        // 描いている最中は文字の編集に入らない
  const hit = annotationAtPoint(wp.x, wp.y, undefined, annotSelectFilter());
  if (!hit || hit.type !== 'text') return false;
  if (selectedAnnotation !== hit) selectAnnotation(hit);
  beginAnnotEdit(hit, false);
  return true;
}

// ─── 設定の反映 ─────────────────────────────────────────
//   選択中の注釈があればそれを、無ければ「次に置くものの既定値」を変える。
//   ★色・大きさ・フォントは履歴に積まない。ピッカーやスライダーは動かすたびに連続で
//     呼ばれるので、積むと履歴が中間状態で埋まり、Ctrl+Z が本来戻したい編集まで
//     届かなくなる（既存の updateTracerColor と同じ扱い）。
function applyAnnotColor(v) {
  annotColor = v;
  for (const id of ['an-swatch', 'dr-swatch']) {   // テキスト側とお絵描き側の両方の見本
    const sw = document.getElementById(id);
    if (sw) sw.style.background = v;
  }
  if (selectedAnnotation) selectedAnnotation.color = v;
  if (annotEditing) { annotEditing.a.color = v; annotEditing.ta.style.color = v; }
  const psw = document.getElementById('annot-color-swatch');
  if (psw) psw.style.background = v;
}
// 大きさ・フォントは箱の寸法を変える。左うえを固定したまま右下へ伸びるので、
// 位置の作り直しは要らない（不変条件③）。
function applyAnnotSize(v) {
  annotTextSize = v;
  if (selectedAnnotation && selectedAnnotation.type === 'text') selectedAnnotation.size = v;
  if (annotEditing) { annotEditing.a.size = v; syncAnnotEditor(); }
}
function applyAnnotFont(v) {
  if (!ANNOT_FONT_CSS[v]) return;
  annotFont = v;
  if (selectedAnnotation && selectedAnnotation.type === 'text') selectedAnnotation.font = v;
  if (annotEditing) { annotEditing.a.font = v; syncAnnotEditor(); }
}
function applyAnnotBold(v) {
  annotBold = !!v;
  if (selectedAnnotation && selectedAnnotation.type === 'text') selectedAnnotation.bold = !!v;
  if (annotEditing) { annotEditing.a.bold = !!v; syncAnnotEditor(); }
}
function applyAnnotLineWidth(v) {
  annotLineWidth = Math.max(0.5, v);
  if (selectedAnnotation && selectedAnnotation.type !== 'text') selectedAnnotation.width = annotLineWidth;
}
function applyAnnotFront(v) {
  if (!selectedAnnotation) return;
  pushUndo();
  selectedAnnotation.front = !!v;
}

// ─── 右パネル（プロパティタブ）───────────────────────────
//   注釈は物体のプロパティ（質量・材質・衝突…）を1つも持たないので、専用の短い欄になる。
// フォントの一覧を作る（一度だけ）。項目そのものをそのフォントで描いて、
// 選ぶ前に見た目が分かるようにする。
function fillAnnotFontSelect(sel) {
  if (!sel || sel.options.length) return;
  for (const f of ANNOT_FONTS) {
    const op = document.createElement('option');
    op.value = f.v;
    op.textContent = f.label;
    op.style.fontFamily = f.css;
    sel.appendChild(op);
  }
}
function updateAnnotPanel(a) {
  _hideAllPropForms();
  const form = document.getElementById('annot-form');
  if (!form) return;
  form.style.display = '';
  fillAnnotFontSelect(document.getElementById('annot-font'));
  const set = (id, fn) => { const el = document.getElementById(id);
                            if (el && document.activeElement !== el) fn(el); };
  const isText = a.type === 'text';
  document.getElementById('annot-title').textContent =
    (isText ? 'テキスト' : '線・図形') + 'を選択中（物理には影響しません）';
  // 文字の欄と線の欄は入れ替える（持っていない値の欄を残すと、押せるのに効かない欄になる）
  const show = (id, on) => { const el = document.getElementById(id);
                             if (el) el.style.display = on ? '' : 'none'; };
  show('annot-text-section', isText);
  show('annot-size-row',  isText);
  show('annot-font-row',  isText);
  show('annot-bold-row',  isText);
  show('annot-width-row', !isText);
  document.getElementById('annot-color-label').textContent = isText ? '文字の色' : '線の色';
  set('annot-text', el => el.value = a.text);
  document.getElementById('annot-color-swatch').style.background = a.color;
  set('annot-width', el => el.value = (a.width * PX2M).toFixed(3));
  set('annot-size',  el => el.value = (a.size * PX2M).toFixed(2));
  set('annot-font',  el => el.value = a.font);
  set('annot-bold',  el => el.checked = !!a.bold);
  set('annot-front', el => el.checked = !!a.front);
  set('annot-attach', el => el.checked = a.bodyId != null);
  show('annot-attach-row', !a.screenPin);
  set('annot-nospin', el => el.checked = !!a.noCamSpin);
  set('annot-angle', el => el.value = _dispDeg(a.angle).toFixed(1));
  set('annot-x', el => el.value = (a.x * PX2M).toFixed(2));
  set('annot-y', el => el.value = yUI(a.y * PX2M).toFixed(2));
  syncSliders();
}
// 右パネルの各欄から呼ばれる。キーごとに単位の換算だけが違う。
//   skipUndo=true はスライダーから。スライダーは動かしている間ずっと呼ばれるので、
//   履歴はドラッグの開始時に1回だけ積む（bindSlider の onArm。ほかのパネルと同じ流儀）。
function updateAnnotProp(key, v, skipUndo) {
  const a = selectedAnnotation;
  if (!a) return;
  const mark = () => { if (!skipUndo) pushUndo(); };
  if (key === 'text') {
    if (v === a.text) return;
    if (!v.trim()) { deleteSelectedAnnotation(); return; }   // 空にしたら消す（配置と同じ規則）
    mark(); a.text = v;
  }
  else if (key === 'size')  { mark(); applyAnnotSize(Math.max(0.01, parseFloat(v) || 0.4) * M2PX); }
  else if (key === 'width') { mark(); applyAnnotLineWidth(Math.max(0.005, parseFloat(v) || 0.04) * M2PX); }
  else if (key === 'font')  { mark(); applyAnnotFont(v); }
  else if (key === 'bold')  { mark(); applyAnnotBold(v); }
  else if (key === 'front') { applyAnnotFront(v); }          // ここは自前で履歴を積む
  else if (key === 'noCamSpin') { mark(); a.noCamSpin = !!v; }
  else if (key === 'attach') {
    // ★入れるときは、線の下にある物体を探す（描き始めの点 → 箱の中心の順）
    let b = null;
    if (v) {
      const p0 = a.pts && a.pts.length ? annotLocalToWorld(a, a.pts[0].x, a.pts[0].y) : annotCenterWorld(a);
      const c = annotCenterWorld(a);
      b = frontmostBodyAtPoint(p0.x, p0.y) || frontmostBodyAtPoint(c.x, c.y);
      if (!b) { flashHint('線の下に物体がありません（物体の上に動かしてから入れてください）'); updateAnnotPanel(a); return; }
    }
    mark(); annotAttachToBody(a, b);
    updateAnnotPanel(a);       // ★貼ると手前へ出る（annotAttachToBody）ので、その欄も出し直す
  }
  else if (key === 'angle') {
    // 表示は右向き0°・反時計回りが正。内部は y 下向き正なので符号が反転する。
    // 中心を保って回す＝キャンバスの回転ハンドルと同じ挙動にする。
    const c = annotCenterWorld(a);
    mark();
    setAnnotAngleAboutCenter(a, -(parseFloat(v) || 0) * Math.PI / 180, c.x, c.y);
  }
  else if (key === 'x') { mark(); a.x = (parseFloat(v) || 0) * M2PX; }
  else if (key === 'y') { mark(); a.y = yUI(parseFloat(v) || 0) * M2PX; }
  refreshAnnotFields(a, 'annot-' + key);
  syncAnnotPopup();
}
// 欄の値だけを現在の状態に合わせ直す。パネルを組み直さないので、スライダーを
// 動かしている最中に呼んでも、掴んでいるつまみや入力中の欄を横取りしない。
//   ★大きさや向きを変えると左うえの角も動く（中心を保って回すため）ので、
//     操作していない欄のほうを追従させる必要がある。
//   ★いま操作している欄そのもの（exceptId）は書き戻さない。向きは ±180° が同じ向きを
//     指すので、180 と打った直後に −180 へ正規化して返すと、スライダーのつまみが
//     右端から左端へ飛ぶ。
function refreshAnnotFields(a, exceptId) {
  const set = (id, val) => { if (id === exceptId) return;
                             const el = document.getElementById(id);
                             if (el && document.activeElement !== el) el.value = val; };
  set('annot-size',  (a.size * PX2M).toFixed(2));
  set('annot-width', (a.width * PX2M).toFixed(3));
  set('annot-angle', _dispDeg(a.angle).toFixed(1));
  set('annot-x',     (a.x * PX2M).toFixed(2));
  set('annot-y',     yUI(a.y * PX2M).toFixed(2));
  syncSliders();
}
function openAnnotColorPicker(el) { openColorPicker(el, 'annotNew'); }

// ─── コピー／貼り付け ───────────────────────────────────
//   控えは直列化した素の値で持つ（Undo のスナップショットと同じ形）。オブジェクトの
//   参照を持つと、コピー元を消したあとに貼り付けたとき何が起きるか読みにくくなる。
function pasteAnnotation() {
  if (!annotClipboard) return null;
  pushUndo();
  const off = 30;                    // 少しずらして置く（物体の貼り付けと同じ量）
  // ★物体に貼った線の写しは、同じ物体のずらした所に貼り直す（bodyLocal を捨てて置いた位置で測り直す）
  const a = new Annotation({ ...annotClipboard, id: undefined, bodyLocal: null,
                             x: annotClipboard.x + off, y: annotClipboard.y + off });
  annotations.push(a);
  // いまのツールで掴めないものは選択しない（掴めない状態で枠だけ出ても混乱する）
  if (annotToolCanSelect(a)) selectAnnotation(a);
  return a;
}

// ─── 右クリックメニューから ───────────────────────────
function ctxEditAnnotation() {
  const a = selectedAnnotation;
  if (a && a.type === 'text') beginAnnotEdit(a, false);
}
// ★メニューを組み直さず✔だけ書き換える（開いたまま続けて切り替えられる。
//   「背景に固定」などと同じ流儀。context-menu.js の★を参照）。
function ctxToggleAnnotFront() {
  const a = selectedAnnotation;
  if (!a) return;
  applyAnnotFront(!a.front);
  const el = document.getElementById('ctx-chk-annot-front');
  if (el) el.textContent = a.front ? '✔' : '';
  syncAnnotPopup();
  updateAnnotPanel(a);
}
