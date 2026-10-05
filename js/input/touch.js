// ════════════════════════════════════════
//  タッチ操作（スマホ・iPad）
// ════════════════════════════════════════
// ★タッチはマウスのイベントに翻訳して流す。キャンバスの操作は mouse.js の
//   mousedown/mousemove/mouseup に全ツール分の分岐が積み上がっているので、タッチ専用の
//   分岐を別に持つと、ツールを1つ足すたびに2か所を直すことになり必ず食い違う。
//   翻訳だけにしておけば、マウスでできることはそのまま指でもできる。
//
// キャンバスでの指の割り当て
//   ・1本でドラッグ   … 左ボタンのドラッグ（配置・移動・つかむ…今のツールのまま）
//   ・1本でタップ     … 左クリック。素早く2回で dblclick（多角形の確定など）
//   ・1本で長押し     … 右クリック（コンテキストメニュー。削除・複製などはここから）
//   ・2本             … ピンチで拡大縮小＋2本そろえて動かすと視点の移動（マウスのホイール＋右ドラッグ）
//
// ★指を置いた瞬間には mousedown を出さない。置いた位置から少し動くか、離すか、
//   長押しが成立するまで「保留」にする。2本目の指は1本目から数十 ms 遅れて着くので、
//   すぐ mousedown を出すと、ピンチのつもりが1本目で四角を描き始めてしまう。
//   動き出してから出す mousedown は、置いた位置（動く前）で出すので、ドラッグの始点はずれない。
// ★いったんドラッグが始まったら、後から指が増えても無視する（そのドラッグを続ける）。
//   途中でピンチへ切り替えるには mouseup を出すしかなく、それは「描きかけの図形を
//   その大きさで確定する」ことになって、意図しない物体が置かれる。

const TOUCH_MOVE_TOL = 8;       // [px] これ以上動いたらドラッグ開始（指先は止めていても数 px 揺れる）
const TOUCH_LONGPRESS_MS = 500; // 長押し＝右クリックまでの時間（OS の長押しとほぼ同じ）
const TOUCH_DBL_MS = 350;       // 2回のタップを dblclick とみなす間隔
const TOUCH_DBL_TOL = 24;       // [px] 2回のタップの位置のずれの許容

let _tc = {
  mode: 'idle',       // idle | pending（保留）| drag（左ドラッグ中）| pinch | done（長押し済み・指が離れるのを待つ）
  id: null,           // 1本目の指の identifier
  sx: 0, sy: 0,       // 置いた位置（client 座標）
  lx: 0, ly: 0,       // 最後の位置
  timer: null,
  pinch: null,        // { cx, cy, d }：前回の2本の中点（キャンバス座標）と間隔
  lastTap: null,      // { t, x, y }：直前のタップ（dblclick 判定用）
};

// マウスのイベントを作って投げる。button：0=左・2=右。buttons は押下中のボタンの集合
function _touchMouse(type, target, x, y, button, buttons, detail) {
  const ev = new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window, detail: detail || 0,
    clientX: x, clientY: y, screenX: x, screenY: y,
    button: button || 0, buttons: buttons || 0,
  });
  target.dispatchEvent(ev);
}
function _touchById(list, id) {
  for (const t of list) if (t.identifier === id) return t;
  return null;
}
function _touchClearTimer() { if (_tc.timer) { clearTimeout(_tc.timer); _tc.timer = null; } }

// 保留していた左ボタンを、置いた位置で押す
function _touchBeginDrag() {
  _touchClearTimer();
  _tc.mode = 'drag';
  _touchMouse('mousemove', canvas, _tc.sx, _tc.sy, 0, 0);   // ★先にカーソルを置く（スナップ表示・ホバー判定が直前位置を見る）
  _touchMouse('mousedown', canvas, _tc.sx, _tc.sy, 0, 1, 1);
}

function _touchPinchState(touches) {
  const a = touches[0], b = touches[1];
  const r = canvas.getBoundingClientRect();
  return {
    cx: (a.clientX + b.clientX) / 2 - r.left,
    cy: (a.clientY + b.clientY) / 2 - r.top,
    d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
  };
}
// ★ホイールのズーム（mouse.js の wheel）と同じやり方：指の中点の下にある世界の点を、
//   拡大縮小と平行移動のあとも新しい中点の下に来るように cam をずらす。
//   screenToWorld 経由なので、カメラが物体に接続されて回っていても（cam.angle≠0）正しく動く。
function _touchPinchMove(touches) {
  const p = _touchPinchState(touches), q = _tc.pinch;
  if (!q) { _tc.pinch = p; return; }
  const before = screenToWorld(q.cx, q.cy);
  cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * p.d / q.d));
  const after = screenToWorld(p.cx, p.cy);
  cam.x -= after.x - before.x;
  cam.y -= after.y - before.y;
  followAbsorbCam();
  _tc.pinch = p;
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();   // ★ページのスクロール・拡大と、ブラウザが後から出す模造のマウスイベントを止める
  document.body.classList.add('touch-input');
  hideToolTip(); hideHelpPopup();
  if (_tc.mode === 'idle' && e.touches.length === 1) {
    const t = e.changedTouches[0];
    _tc.mode = 'pending'; _tc.id = t.identifier;
    _tc.sx = _tc.lx = t.clientX; _tc.sy = _tc.ly = t.clientY;
    _touchClearTimer();
    _tc.timer = setTimeout(() => {               // 長押し＝右クリック
      _tc.timer = null;
      if (_tc.mode !== 'pending') return;
      _tc.mode = 'done';
      if (navigator.vibrate) navigator.vibrate(15);
      _touchMouse('mousedown', canvas, _tc.sx, _tc.sy, 2, 2);
      _touchMouse('mouseup',   canvas, _tc.sx, _tc.sy, 2, 0);
    }, TOUCH_LONGPRESS_MS);
    return;
  }
  if (e.touches.length >= 2 && (_tc.mode === 'pending' || _tc.mode === 'pinch' || _tc.mode === 'idle')) {
    _touchClearTimer();
    _tc.mode = 'pinch';
    _tc.pinch = _touchPinchState(e.touches);
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (_tc.mode === 'pinch') {
    if (e.touches.length >= 2) _touchPinchMove(e.touches);
    return;
  }
  const t = _touchById(e.touches, _tc.id);
  if (!t) return;
  _tc.lx = t.clientX; _tc.ly = t.clientY;
  if (_tc.mode === 'pending') {
    if (Math.hypot(t.clientX - _tc.sx, t.clientY - _tc.sy) < TOUCH_MOVE_TOL) return;
    _touchBeginDrag();
  }
  if (_tc.mode === 'drag') _touchMouse('mousemove', canvas, t.clientX, t.clientY, 0, 1);
}, { passive: false });

function _touchEnd(e, cancelled) {
  e.preventDefault();
  if (_tc.mode === 'pinch') {
    // ★1本だけ残っても、そこからドラッグは始めない（ピンチの指を離す順番は揃わないので、
    //   残った指で物体を動かしてしまう）。全部離れたら次の操作を受け付ける。
    if (e.touches.length === 0) { _tc.mode = 'idle'; _tc.pinch = null; }
    else if (e.touches.length >= 2) _tc.pinch = _touchPinchState(e.touches);
    else _tc.pinch = null;
    return;
  }
  const t = _touchById(e.changedTouches, _tc.id);
  if (!t) return;                                 // 無視している2本目以降の指
  _touchClearTimer();
  const x = t.clientX, y = t.clientY;
  if (_tc.mode === 'pending' && !cancelled) {      // タップ＝クリック
    const now = performance.now(), lt = _tc.lastTap;
    const dbl = lt && now - lt.t < TOUCH_DBL_MS && Math.hypot(x - lt.x, y - lt.y) < TOUCH_DBL_TOL;
    _touchMouse('mousemove', canvas, x, y, 0, 0);
    _touchMouse('mousedown', canvas, x, y, 0, 1, dbl ? 2 : 1);
    _touchMouse('mouseup',   canvas, x, y, 0, 0, dbl ? 2 : 1);
    _touchMouse('click',     canvas, x, y, 0, 0, dbl ? 2 : 1);
    if (dbl) { _touchMouse('dblclick', canvas, x, y, 0, 0, 2); _tc.lastTap = null; }
    else _tc.lastTap = { t: now, x, y };
  } else if (_tc.mode === 'drag') {
    _touchMouse('mouseup', canvas, x, y, 0, 0, 1);
    _tc.lastTap = null;
  }
  _tc.mode = e.touches.length ? 'done' : 'idle';  // 他の指が残っていたら、全部離れるまで待つ
  _tc.id = null;
}
canvas.addEventListener('touchend',    e => _touchEnd(e, false), { passive: false });
canvas.addEventListener('touchcancel', e => _touchEnd(e, true),  { passive: false });
// 'done' のまま他の指が離れたときに idle へ戻す
window.addEventListener('touchend', e => { if (_tc.mode === 'done' && e.touches.length === 0) _tc.mode = 'idle'; });

// ── キャンバス以外：マウスでドラッグして動かす部品 ──
// ★グラフの窓の見出し・色のピッカーなどは mousedown→（window の）mousemove→mouseup で
//   動かしている。タッチではブラウザが指の移動を「スクロール」として扱い、mousemove が
//   一度も来ないので、窓がまったく動かない。ここに挙げた部品だけは同じく翻訳する。
//   ★全部の部品を翻訳しないのは、パネルの縦スクロール・スライダー・選択欄といった
//   ブラウザ標準のタッチ操作を壊さないため。ドラッグ部品を増やしたらここに足すこと。
const TOUCH_DRAG_SEL = '.vg-header, #circuit-pop-head, #emf-pop-head, #measure-pop-head, ' +
                       '.sp-head, .db-head, #cp-sv, #cp-hue, #gif-overlay';
let _tdrag = null;   // { id, target, sx, sy, moved }
document.addEventListener('touchstart', e => {
  document.body.classList.add('touch-input');
  if (_tdrag || e.touches.length !== 1) return;
  const t = e.changedTouches[0];
  const target = t.target instanceof Element ? t.target : null;
  if (!target || target === canvas) return;
  // 見出しの中のボタン（× など）はふつうのタップで押させる
  if (target.closest('button, input, select, textarea, a, .popup-close, .vg-close')) return;
  if (!target.closest(TOUCH_DRAG_SEL)) return;
  e.preventDefault();
  _tdrag = { id: t.identifier, target, sx: t.clientX, sy: t.clientY, moved: false };
  _touchMouse('mousedown', target, t.clientX, t.clientY, 0, 1, 1);
}, { passive: false });
document.addEventListener('touchmove', e => {
  if (!_tdrag) return;
  const t = _touchById(e.changedTouches, _tdrag.id);
  if (!t) return;
  e.preventDefault();
  if (Math.hypot(t.clientX - _tdrag.sx, t.clientY - _tdrag.sy) >= TOUCH_MOVE_TOL) _tdrag.moved = true;
  _touchMouse('mousemove', _tdrag.target, t.clientX, t.clientY, 0, 1);
}, { passive: false });
function _tdragEnd(e) {
  if (!_tdrag) return;
  const t = _touchById(e.changedTouches, _tdrag.id);
  if (!t) return;
  e.preventDefault();
  _touchMouse('mouseup', _tdrag.target, t.clientX, t.clientY, 0, 0, 1);
  if (!_tdrag.moved) _touchMouse('click', _tdrag.target, t.clientX, t.clientY, 0, 0, 1);
  _tdrag = null;
}
document.addEventListener('touchend',    _tdragEnd, { passive: false });
document.addEventListener('touchcancel', _tdragEnd, { passive: false });

// マウスを動かしたら「タッチで使っている」印を外す（タッチ付きノートPCで両方使う人向け）。
// ★模造のマウスイベント（タップの後にブラウザが出す mousemove）で外れないよう、
//   直前のタッチから少し間を置く。
let _lastTouchAt = 0;
document.addEventListener('touchstart', () => { _lastTouchAt = performance.now(); }, { capture: true, passive: true });
document.addEventListener('mousemove', e => {
  if (!e.isTrusted || performance.now() - _lastTouchAt < 800) return;
  document.body.classList.remove('touch-input');
}, { passive: true });

// ── 狭い画面の右パネル（引き出し） ──
// ★スマホの幅では右パネル（230px）を横に並べるとキャンバスが 100px ほどしか残らない。
//   CSS（max-width: 760px）がパネルを右から重ねる引き出しに変え、開け閉めはこのボタンで行う。
//   幅が広いときはボタンごと隠れていて、これらの関数は何もしない。
function toggleRightPanel(open) {
  const on = open == null ? !document.body.classList.contains('rp-open') : !!open;
  document.body.classList.toggle('rp-open', on);
}
