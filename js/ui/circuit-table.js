// ════════════════════════════════════════
//  回路の表（素子ごとの 電圧・電流・抵抗・電気量 を、その素子のすぐ横に出す札）
// ════════════════════════════════════════
//  素子を選んで、右パネルの「表を出す」・右クリック・上メニュー〈表示〉の「回路の表を表示」の
//  どれかで出す（もう一度で消える）。表は編集ツールかつかむツールでドラッグして動かせる。
//  ★以前は回路ツールの窓に「回路の表」という道具があったが外した（2026-09-27 ユーザーの指示）。
//    素子の列に素子でないものが混ざっていた。入口は回路のグラフと同じ3つに揃えた。
//
//  ★1つの表＝1つの素子。はじめは1枚の窓に行を並べ、各行から素子へ点線を引いていたが、
//    素子が3つで線が画面を横切り、どの線がどの行か追えなかった（ユーザーの指摘）。
//    表を素子の横に置けば、どの素子の値かは位置で分かる＝長い線が要らない。
//    素子とのあいだには短い点線を1本だけ引く（ドラッグで離したときの手がかり）。
//  ★窓（DOM）ではなくキャンバスに描く。回路と一緒に動き、画面を動かしてもついてくる。
//    文字の大きさは画面 px で一定（倍率を下げても読める）。
//  ★計器（電流計・電圧計）を置き換えるものではない。計器は回路の一部で、内部抵抗が
//    回路を変える（CIRCUIT_DEFAULTS の★）。表は回路に何も足さず、ソルバが解いた値を
//    そのまま読むだけ＝「回路の外から覗く目」。計器の題材（内部抵抗で読みが狂う）とは
//    役割が重ならない。
//  ★出す量は素子の種類で決まる（CT_TYPE_COLS）。電源・コイル・ダイオードは V と I、
//    抵抗と豆電球は R も、コンデンサーは電気量 Q = CV も。
//  ★値は大きさ（絶対値）で出す。解いた値の符号は素子の端 a→b の向き基準で、抵抗や
//    コンデンサーの a→b は「どちらから引いたか」で決まるだけの向きなので、同じ回路でも
//    描き方で符号が変わってしまう（実測：直流電源→抵抗→コンデンサーの輪で、電源の I は
//    −0.607 A・抵抗の V は −6.07 V・コンデンサーの I は +0.607 A と符号がばらばらに出た）。
//    流れる向きは回路の上の黄色い点（drawCircuitFlow）が受け持つ。
//  ★保存形式：{ id, elemId, dx, dy }。dx・dy は素子の中点から表の中心までのずれ [画面px]。
//    null なら自動（素子の札＝「10V」「1000Ω」の反対側）。

const CT_COLOR  = '#ffb74d';        // 枠と短い点線（リモコンの水色・プログラムの黄と分ける）
const CT_FONT   = 12;               // [画面px] 値の文字
const CT_GAP    = 18;               // [画面px] 素子の線から表の近い辺まで（記号の半分の幅＋余白）
// 列：見出し・単位と、その素子での値の取り出し方
//   ★豆電球の R は「いまの V/I」ではなくフィラメントの温度から出した R(T)（bulbR）。
//     電流 0 でも決まる値で、点灯して温まると上がる＝非直線抵抗であることが表で読める。
const CT_COLS = {
  V: { head:'電圧',   unit:'V', get: e => Math.abs(e.Vread || 0) },
  I: { head:'電流',   unit:'A', get: e => Math.abs(e.I || 0) },
  R: { head:'抵抗',   unit:'Ω', get: e => e.type === 'bulb' ? bulbR(e) : (e.R || 0) },
  Q: { head:'電気量', unit:'C', get: e => Math.abs((e.C || 0) * (e.Vread || 0)) },
};
// 表の分解能。これより小さい値は 0 と出す（実際のテスターにも最小桁がある）。
//   ★充電しきった回路の電流は解の丸めで 0 にならず、電源 23.6nA・抵抗 18.6nA のように
//     素子ごとに違う「ほぼ 0」が出る（実測：平行板コンデンサーのデモで 50秒充電したあと）。
//     有効数字3桁で見せると、直列なのに電流が食い違う表になる。
//     μA の回路（電圧計 10MΩ に流れる電流）は読めるよう、電流の分解能は 1μA より下に置く。
const CT_FLOOR = { V: 1e-4, I: 1e-7, Q: 1e-7 };
const CT_TYPE_COLS = {
  dcsource:  ['V', 'I'],
  acsource:  ['V', 'I'],
  resistor:  ['V', 'I', 'R'],
  bulb:      ['V', 'I', 'R'],
  capacitor: ['V', 'I', 'Q'],
  inductor:  ['V', 'I'],
  diode:     ['V', 'I'],
};

let circTables = [];
let circTableSeq = 0;
let _ctDrag = null;                 // 表をドラッグ中 { t, ox, oy }

class CircTable {
  constructor(o) {
    o = o || {};
    this.id = o.id !== undefined ? o.id : ++circTableSeq;
    if (this.id > circTableSeq) circTableSeq = this.id;
    this.elemId = o.elemId;
    this.dx = (o.dx === undefined) ? null : o.dx;
    this.dy = (o.dy === undefined) ? null : o.dy;
  }
  elem() { return circuitElements.find(c => c.id === this.elemId) || null; }
}

// ── 置く・消す・動かす ────────────────────────────────────
function circTableAccepts(e) { return !!(e && CT_TYPE_COLS[e.type]); }
function circTableOf(e) { return e ? circTables.find(t => t.elemId === e.id) || null : null; }
// 表の上を押したら掴んで動かす（mouse.js の mousedown から。編集ツール・つかむツールで呼ぶ）
//   ★物体・素子の当たり判定より先に見る。表は素子の横に重なって出ることがあり、
//     素子を先に拾うと表を掴めない。
function beginCircTableDragIfHit(wp) {
  const s = worldToScreen(wp.x, wp.y);
  const hit = circTableAtScreen(s.x, s.y);
  if (!hit) return false;
  beginCircTableDrag(hit, s);
  return true;
}
// 表を出し入れする相手＝選んでいる素子のうち表を出せるものすべて。
//   ★まとめて選んでいれば全員（他の操作と同じく、複数選んで右クリックでまとめて効く）。
//     仲間は bulkPeers ではなく一括選択そのものから取る。bulkPeers は「代表と同じ型」に
//     絞るので、範囲選択で電源・抵抗・コンデンサーを一度に囲んでも代表の型にしか出ない。
//     代表が導線（表を出せない）でも、囲んだ中の抵抗には出す。
function circTableTargets() {
  const e = selectedCircuit;
  if (!e) return [];
  const list = (bulkKind === 'circuit' && bulkIds.has(e.id)) ? bulkCircuitList() : [e];
  return list.filter(circTableAccepts);
}
// 1人でも表が無ければ「出す」（無い人にだけ出す）、全員にあれば「消す」。
//   ★グラフの「全員が窓を持っていれば ✔」と同じ決め方。混在のまま押して、出ている表が
//     消えてしまうことが無いように出すほうへ倒す。
function circTablesAllShown(list) { return list.length > 0 && list.every(e => circTableOf(e)); }
function setCircTablesFor(list, show) {
  const todo = show ? list.filter(e => !circTableOf(e)) : list.map(circTableOf).filter(Boolean);
  if (!todo.length) return;
  pushUndo();                  // ★まとめて1回の Undo で戻るように、履歴はここで1つだけ積む
  if (show) for (const e of todo) circTables.push(new CircTable({ elemId: e.id }));
  else circTables = circTables.filter(t => todo.indexOf(t) < 0);
}
// 上メニュー〈表示〉の「回路の表を表示」。表を出せる素子を選んでいればその表を出し入れし、
//   選んでいなければ出ている表をすべて畳む（グラフの窓を閉じるのと同じ「見せ方」の操作）。
function circTablesViewUsable() { return circTableTargets().length > 0 || circTables.length > 0; }
function circTablesViewOn() {
  const list = circTableTargets();
  return list.length ? circTablesAllShown(list) : circTables.length > 0;
}
function toggleCircTablesView() {
  if (circTableTargets().length) { toggleCircTableOfSelected(); return; }
  if (!circTables.length) return;
  pushUndo();
  circTables = [];
  _ctDrag = null;
}
// 右パネル・右クリックの「表を出す／消す」。表を出せる素子が1つも選ばれていなければボタンごと隠す
function toggleCircTableOfSelected() {
  const list = circTableTargets();
  if (!list.length) return;
  setCircTablesFor(list, !circTablesAllShown(list));
  refreshCircTableButton();
}
function refreshCircTableButton() {
  const b = document.getElementById('c-table-btn');
  if (!b) return;
  const list = circTableTargets();
  b.style.display = list.length ? '' : 'none';
  const on = circTablesAllShown(list);
  // ★まとめて効くときは何個に効くかを出す（導線などは数えない＝押して増える表の数と一致）
  b.textContent = (on ? '表を消す' : '表を出す') + (list.length > 1 ? `（${list.length}個）` : '');
  b.classList.toggle('active', on);
}
function addCircTable(elemId, dx, dy) {
  if (circTables.some(t => t.elemId === elemId)) return null;   // 1つの素子に1枚
  pushUndo();
  const t = new CircTable({ elemId, dx, dy });
  circTables.push(t);
  return t;
}
function removeCircTable(t) {
  const i = circTables.indexOf(t);
  if (i >= 0) { pushUndo(); circTables.splice(i, 1); }
}
function clearCircTables() {
  circTables = [];
  circTableSeq = 0;           // ★番号は1から振り直す（読み込み時は保存された id が上書きする）
  _ctDrag = null;
}
// 表のドラッグ。★道具の mousemove/mouseup の流れには乗せず、掴んだ間だけ window で拾う
//   （表はキャンバスの上の札で、物体の移動とは別の話。mouse.js の分岐を増やさない）
function beginCircTableDrag(t, s) {
  const e = t.elem(); if (!e) return;
  const p = circTableCenter(t, e);
  pushUndo();
  _ctDrag = { t, ox: s.x - p.x, oy: s.y - p.y };
  const move = ev => {
    if (!_ctDrag) return;
    const e2 = _ctDrag.t.elem(); if (!e2) return;
    const cr = canvas.getBoundingClientRect();
    const m = worldToScreen((e2.ax + e2.bx) / 2, (e2.ay + e2.by) / 2);
    _ctDrag.t.dx = ev.clientX - cr.left - _ctDrag.ox - m.x;
    _ctDrag.t.dy = ev.clientY - cr.top  - _ctDrag.oy - m.y;
  };
  const up = () => { _ctDrag = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// ── 保存・復元 ───────────────────────────────────────────
//   ★素子が消えた表は書き出さない（Undo の中では残す：素子ごと戻ってくるので）
function serializeCircTable(t) { return { id: t.id, elemId: t.elemId, dx: t.dx, dy: t.dy }; }
function serializeCircTables() { return circTables.filter(t => t.elem()).map(serializeCircTable); }
function deserializeCircTables(arr) {
  clearCircTables();
  circTables = (arr || []).map(d => new CircTable(d));
  return circTables;
}

// ── 描く ─────────────────────────────────────────────────
//   ★置き場所の既定は、素子の札（drawCircuitElement の label＝法線 +n 側）の反対の −n 側。
//     札と表が重ならず、同じ素子ならいつも同じ側に出る。
function _ctLines(e) {
  const out = [];
  for (const k of CT_TYPE_COLS[e.type] || []) {
    const c = CT_COLS[k];
    let v = c.get(e);
    if (CT_FLOOR[k] && Math.abs(v) < CT_FLOOR[k]) v = 0;
    out.push([c.head + ' ' + k, cgSI(v, c.unit, 3)]);
  }
  return out;
}
// 表の大きさ。★値の欄は「000mA」ぶんを最低幅にする。値の桁で幅が毎フレーム変わると、
//   素子の横に置いた表が充電のあいだ左右に震える。
function _ctSize(lines) {
  ctx.save();
  ctx.font = CT_FONT + 'px sans-serif';
  let wl = 0, wr = ctx.measureText('000.0mA').width;
  for (const [l, r] of lines) { wl = Math.max(wl, ctx.measureText(l).width); wr = Math.max(wr, ctx.measureText(r).width); }
  ctx.restore();
  return { w: Math.ceil(wl + wr + 22), h: lines.length * (CT_FONT + 5) + 8 };
}
function circTableCenter(t, e, size) {
  const a = worldToScreen(e.ax, e.ay), b = worldToScreen(e.bx, e.by);
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (t.dx !== null && t.dy !== null) return { x: m.x + t.dx, y: m.y + t.dy };
  size = size || _ctSize(_ctLines(e));
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (b.y - a.y) / L, ny = -(b.x - a.x) / L;          // −n（札の反対側）
  // 表の近い辺が素子の線から CT_GAP だけ離れるよう、法線方向の半分の厚みを足す
  const half = Math.abs(nx) * size.w / 2 + Math.abs(ny) * size.h / 2;
  return { x: m.x + nx * (CT_GAP + half), y: m.y + ny * (CT_GAP + half) };
}
function circTableAtScreen(x, y) {
  for (let i = circTables.length - 1; i >= 0; i--) {
    const r = circTables[i]._rect;
    if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return circTables[i];
  }
  return null;
}
// render() の画面座標の段で呼ぶ（リモコンのつなぎ線と同じ所）
function drawCircTables() {
  if (!circTables.length) return;
  ctx.save();
  ctx.textBaseline = 'middle';
  for (const t of circTables) {
    const e = t.elem();
    if (!e) { t._rect = null; continue; }
    const lines = _ctLines(e);
    const sz = _ctSize(lines);
    const c = circTableCenter(t, e, sz);
    const r = { x: Math.round(c.x - sz.w / 2), y: Math.round(c.y - sz.h / 2), w: sz.w, h: sz.h };
    t._rect = r;
    // 素子の中点への短い点線（表の縁から）。離れていなければ引かない
    const m = worldToScreen((e.ax + e.bx) / 2, (e.ay + e.by) / 2);
    const ex = Math.max(r.x, Math.min(r.x + r.w, m.x)), ey = Math.max(r.y, Math.min(r.y + r.h, m.y));
    if (Math.hypot(m.x - ex, m.y - ey) > CT_GAP + 16) {
      ctx.strokeStyle = CT_COLOR; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(m.x, m.y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(26,28,35,0.9)';
    ctx.strokeStyle = (_ctDrag && _ctDrag.t === t) ? '#fff' : CT_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w, r.h, 4); else ctx.rect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    ctx.fill(); ctx.stroke();
    ctx.font = CT_FONT + 'px sans-serif';
    lines.forEach(([l, v], i) => {
      const y = r.y + 4 + (CT_FONT + 5) * (i + 0.5);
      ctx.textAlign = 'left';  ctx.fillStyle = '#9aa4b2'; ctx.fillText(l, r.x + 7, y);
      ctx.textAlign = 'right'; ctx.fillStyle = '#eceff1'; ctx.fillText(v, r.x + r.w - 7, y);
    });
  }
  ctx.restore();
}
