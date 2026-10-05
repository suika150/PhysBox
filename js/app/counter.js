// ════════════════════════════════════════
//  通過カウンタ（線を横切った数を数える）
// ════════════════════════════════════════
//  線分を1本引くと、それを横切った物体・粒子の数を数える。矢印の向きに通れば +1、
//  逆向きなら −1（正味の数）。窓には正味の累計と「毎秒の個数」とそのグラフを出す。
//  ★電流の定義（1秒あたりに断面を通る電気量）そのものの計器。電子モデルの輪に置けば
//    電流計になり、気体分子の穴に置けば漏れ出す速さ、水の管に置けば流量になる。
//    題材専用の部品ではない。
//  ★見る側の道具で、物理には一切参加しない（注釈・グラフの窓と同じ立場）。counters は
//    objects/joints/particles のどれにも入らず、衝突・光・場・回路のどこからも見えない。
//    数えるのは tick の終わり（位置が確定したあと）で、何も書き換えない。
//  ★向きを数える。交流では電子が行ったり来たりするので、向きを見ないと往復で2回数え、
//    電流が0の瞬間にも数が増え続ける。

const COUNTER_MAX       = 12;       // 同時に置ける数（窓で画面が埋まるので上限を置く）
const COUNTER_COLOR     = '#4dd0e1';   // 線・窓のつなぎ線（水色。プログラムの黄・リモコンと重ならない）
// [s] 毎秒の個数を数える幅（直近この秒数に通った正味の数 ÷ この秒数）。
//   ★短いほど遅れず、長いほど揺れが均される。遅れは幅の半分（2秒＝周期40秒で9°）。
//     コイルのリアクタンスモデル（毎秒 4〜9個・周期40秒）で、正弦波からのずれの標準偏差を
//     幅ごとに測った（コイルなし／あり）：1秒 1.54／2.12・2秒 1.29／1.95・3秒 1.13／1.80・
//     6秒 0.78／1.34。振幅は幅によらず同じ（8.7／3.6）。コイルありのずれは幅を伸ばしても
//     ほとんど減らない＝数えの粗さではなく電子の本当の揺れで、幅を伸ばすと遅れだけが増える。
//     打ち切り定数なのでパネルには出さない。
const COUNTER_RATE_WIN  = 2;
const COUNTER_SAMPLE_DT = 0.1;      // [s] グラフの標本の間隔（シミュレーション時間）
const COUNTER_SPAN_DEF  = 60;       // [s] グラフの表示幅の既定
const COUNTER_GRAPH_W   = 184, COUNTER_GRAPH_H = 72;   // [px] 窓の中のグラフ
// 何を数えるか。★保存形式なので値の名前は変えない
const COUNTER_WHAT = [
  ['all',       'すべて'],
  ['bodies',    '物体だけ'],
  ['charged',   '帯電した物体'],
  ['particles', '粒子（水・分子）'],
];

let counters = [];
let counterSeq = 0;
let selectedCounter = null;

class Counter {
  constructor(o) {
    o = o || {};
    this.id = o.id !== undefined ? o.id : ++counterSeq;
    if (o.id !== undefined && o.id > counterSeq) counterSeq = o.id;
    // 線分の両端 [px]（世界座標）。矢印は a から b へ引いたときの右手側（_counterNormal）
    this.ax = o.ax || 0; this.ay = o.ay || 0;
    this.bx = o.bx !== undefined ? o.bx : 100; this.by = o.by || 0;
    this.what = COUNTER_WHAT.some(w => w[0] === o.what) ? o.what : 'all';
    this.span = o.span > 0 ? o.span : COUNTER_SPAN_DEF;
    // 向きを問わず数える（通るたびに +1）か。毎秒と累計（数・累計平均）で別々に選ぶ。
    //   ★交流では正味の数が打ち消し合うので、流れの「大きさ」を1つの数で読むにはこちらを使う。
    //     ただし線の上で揺れているだけの粒も往復のたびに数える。コイルのリアクタンスモデル
    //     （周期40秒）で両向きの合計は 6.0／3.4 個/s（コイルなし／あり）、正味の振幅から出した
    //     電流の大きさの平均（2/π × 振幅）は 5.5／2.9 個/s ＝ 1〜2割多く出る。
    this.absRate  = !!o.absRate;
    this.absTotal = !!o.absTotal;
    // ★窓の位置は画面の割合で持つ（プログラム・リモコンの窓と同じ理由）
    this.fx = o.fx !== undefined ? o.fx : 0.72;
    this.fy = o.fy !== undefined ? o.fy : 0.45;
    this.collapsed = !!o.collapsed;
    this.panel = null;
    this.reset();
  }
  // 数えごとを初めから。★保存しない（シーンは「実行前の姿」。リモコンの押している最中と同じ）
  reset() {
    this.net = 0; this.fwd = 0; this.back = 0;
    this._ev = [];                 // 直近 COUNTER_RATE_WIN 秒の {t, s}（s は ±1）
    this.samples = [];             // グラフの標本 {t, r}
    this.rate = 0;
    this._t0 = world.simTime;      // 数え始めた時刻
    this._lastT = world.simTime;
    this._nextSample = world.simTime;
    // ★縦軸は広がるだけで縮まない（0 に戻すまで）。自動で縮めると、コイルを外して
    //   山が高くなったのか目盛りが変わったのかが見分けられない＝比べる道具にならない。
    this._scale = 1;
    this._dirty = true;
  }
  counts(b) {
    if (this.what === 'particles') return false;
    if (this.what === 'charged') return !!b.charge;
    return true;
  }
}

// 矢印の向き（a→b を画面で見て時計回りに90°＝引いた向きの右手側＝内部座標の (−dy, dx)）の単位ベクトル
function _counterNormal(c) {
  const dx = c.bx - c.ax, dy = c.by - c.ay, L = Math.hypot(dx, dy) || 1;
  return { x: -dy / L, y: dx / L };
}

// ── 数える ───────────────────────────────────────────────
//  ★粒子の tick 頭の位置はここで控える（物体は step.js が _prevX/_prevY を控えている）。
//    粒子の px/py は SPH が途中で書き換えるので「前の位置」には使えない。
function counterBeginTick() {
  if (!counters.length) return;
  for (const p of particles) { p._cpx = p.x; p._cpy = p.y; }
}
// 1つの移動 (x0,y0)→(x1,y1) が線分を横切ったか。横切ったら ±1、なければ 0
//   ★線の上にちょうど乗った点は「負の側」に数える（>0 だけを正）。境目を両側で数えると、
//     線の上で止まった物体が 1回で +1 と −1 を行き来する。
function _counterCross(c, x0, y0, x1, y1) {
  const dx = c.bx - c.ax, dy = c.by - c.ay;
  const s0 = dx * (y0 - c.ay) - dy * (x0 - c.ax);
  const s1 = dx * (y1 - c.ay) - dy * (x1 - c.ax);
  const p0 = s0 > 0, p1 = s1 > 0;
  if (p0 === p1) return 0;
  const k = s0 / (s0 - s1);                                   // 横切った点（移動の割合）
  const X = x0 + (x1 - x0) * k, Y = y0 + (y1 - y0) * k;
  const u = ((X - c.ax) * dx + (Y - c.ay) * dy) / (dx * dx + dy * dy);
  if (u < 0 || u > 1) return 0;                               // 線分の外を通った
  return p1 ? 1 : -1;
}
// tick の終わり（simTime を進めたあと）に呼ぶ
function updateCounters() {
  if (!counters.length) return;
  const t = world.simTime;
  for (const c of counters) {
    // ★時計が巻き戻った（ステップ数を0に戻した・デモの先回し）ら数え直す
    if (t < c._lastT) c.reset();
    c._lastT = t;
    let d = 0;
    if (c.what !== 'particles') {
      for (const b of objects) {
        if (b.isSpawner || b._prevX === undefined || !c.counts(b)) continue;
        const s = _counterCross(c, b._prevX, b._prevY, b.x, b.y);
        if (s) { d += s; c._ev.push({ t, s }); if (s > 0) c.fwd++; else c.back++; }
      }
    }
    if (c.what === 'all' || c.what === 'particles') {
      for (const p of particles) {
        if (p._cpx === undefined) continue;
        const s = _counterCross(c, p._cpx, p._cpy, p.x, p.y);
        if (s) { d += s; c._ev.push({ t, s }); if (s > 0) c.fwd++; else c.back++; }
      }
    }
    c.net += d;
    // 直近の幅だけ残して毎秒の個数を出す。★数え始めて間もないうちは、経った時間で割る
    //   （幅で割ると最初の2秒が低く出て、立ち上がりが遅れて見える）
    while (c._ev.length && c._ev[0].t <= t - COUNTER_RATE_WIN) c._ev.shift();
    let sum = 0;
    for (const e of c._ev) sum += c.absRate ? 1 : e.s;
    const win = Math.min(COUNTER_RATE_WIN, Math.max(t - c._t0, SIM_DT));
    c.rate = sum / win;
    if (t >= c._nextSample) {
      c.samples.push({ t, r: c.rate });
      c._nextSample = t + COUNTER_SAMPLE_DT;
      c._scale = Math.max(c._scale, Math.abs(c.rate));
      // ★表示幅より古い標本は捨てる（掃引）。グラフの窓は標本を捨てない約束だが、これは
      //   計器の針の履歴で、置いたまま何分も走らせる使い方が普通。捨てないと時間軸が
      //   伸び続けて山が潰れ、交流の山の高さを比べるという目的が果たせない（受信計と同じ）。
      while (c.samples.length && c.samples[0].t < t - c.span) c.samples.shift();
    }
    c._dirty = true;
  }
}

// ── 置く・消す ─────────────────────────────────────────────
function addCounter(ax, ay, bx, by) {
  if (counters.length >= COUNTER_MAX) {
    appAlert('通過カウンタ', `カウンタは ${COUNTER_MAX} 個までです。`);
    return null;
  }
  pushUndo();
  const c = new Counter({ ax, ay, bx, by, fy: 0.3 + (counters.length % 4) * 0.12 });
  counters.push(c);
  buildCounterPanel(c);
  selectCounter(c);
  return c;
}
function removeCounter(c) {
  const i = counters.indexOf(c);
  if (i >= 0) { pushUndo(); counters.splice(i, 1); }
  if (c.panel) c.panel.remove();
  if (selectedCounter === c) selectedCounter = null;
}
function clearCounters() {
  for (const c of counters) if (c.panel) c.panel.remove();
  counters = []; selectedCounter = null;
}
function resetCounters() { for (const c of counters) c.reset(); }

// ── 編集ツールで動かす ─────────────────────────────────────
//   端の●を掴めばその端だけ（Shift で角度スナップ）、線を掴めば線ごと平行移動。
//   ★線は画面の最前面（HUD と同じ層）に描いてあるので、当たり判定も物体より先に見る。
//     見えているいちばん手前のものを掴む、の約束どおり。
//   ★放したら数え直す。動かす前と後では別の断面なので、足し合わせた数には意味が無い。
const COUNTER_PICK_PX = 8;       // [画面px] 端・線の当たり幅
let counterDrag = null;          // { c, mode:'a'|'b'|'line', x0, y0, ax, ay, bx, by }
function counterAtPoint(wp) {
  const tol = COUNTER_PICK_PX / cam.zoom;
  // 端を先に（線の上にある端点を、線ごとの移動に取られない）。手前に描いたもの＝後ろから
  for (let i = counters.length - 1; i >= 0; i--) {
    const c = counters[i];
    if (Math.hypot(wp.x - c.ax, wp.y - c.ay) <= tol) return { c, mode: 'a' };
    if (Math.hypot(wp.x - c.bx, wp.y - c.by) <= tol) return { c, mode: 'b' };
  }
  for (let i = counters.length - 1; i >= 0; i--) {
    const c = counters[i];
    const dx = c.bx - c.ax, dy = c.by - c.ay, L2 = dx*dx + dy*dy || 1;
    const u = Math.max(0, Math.min(1, ((wp.x - c.ax)*dx + (wp.y - c.ay)*dy) / L2));
    if (Math.hypot(wp.x - (c.ax + u*dx), wp.y - (c.ay + u*dy)) <= tol) return { c, mode: 'line' };
  }
  return null;
}
function beginCounterDragIfHit(wp) {
  const h = counterAtPoint(wp);
  if (!h) return false;
  const c = h.c;
  // ★履歴は実際に動かした最初の1回で積む（押しただけ＝窓を選んだだけで積むと、戻るが空振りする）
  counterDrag = { c, mode: h.mode, x0: wp.x, y0: wp.y, ax: c.ax, ay: c.ay, bx: c.bx, by: c.by, pushed: false };
  selectCounter(c);
  return true;
}
function dragCounterTo(wp, shift) {
  const d = counterDrag; if (!d) return;
  const c = d.c;
  if (!d.pushed) { pushUndo(); d.pushed = true; }
  if (d.mode === 'line') {
    // ★掴んだ点がグリッドへ乗るように動かす（ほかの平行移動と同じ）
    const s = snapPt({ x: d.ax + (wp.x - d.x0), y: d.ay + (wp.y - d.y0) });
    const dx = s.x - d.ax, dy = s.y - d.ay;
    c.ax = d.ax + dx; c.ay = d.ay + dy; c.bx = d.bx + dx; c.by = d.by + dy;
    return;
  }
  const other = d.mode === 'a' ? { x: c.bx, y: c.by } : { x: c.ax, y: c.ay };
  let p = snapPt(wp);
  if (shift) p = angleSnappedPoint(other, p);
  if (Math.hypot(p.x - other.x, p.y - other.y) < 8) return;   // ★端を重ねて線を消さない
  if (d.mode === 'a') { c.ax = p.x; c.ay = p.y; } else { c.bx = p.x; c.by = p.y; }
}
function endCounterDrag() {
  const d = counterDrag; counterDrag = null;
  if (!d) return;
  const c = d.c;
  if (c.ax !== d.ax || c.ay !== d.ay || c.bx !== d.bx || c.by !== d.by) { c.reset(); syncCounterPanel(c); }
}

// ── 保存・復元 ───────────────────────────────────────────
//   ★数えた数は保存しない（Counter.reset の★）
function serializeCounter(c) {
  return { id: c.id, ax: c.ax, ay: c.ay, bx: c.bx, by: c.by, what: c.what, span: c.span,
           absRate: c.absRate, absTotal: c.absTotal,
           fx: c.fx, fy: c.fy, collapsed: c.collapsed };
}
function deserializeCounters(arr) {
  clearCounters();
  counters = (arr || []).map(d => new Counter(d));
  for (const c of counters) buildCounterPanel(c);
  return counters;
}

// ════════════════════════════════════════
//  窓（画面に貼り付く）
// ════════════════════════════════════════
//  枠・ドラッグはプログラムの窓（.velgraph-panel / .vg-*）の CSS と作りを借りる。
function buildCounterPanel(c) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'velgraph-panel counter-panel';
  panel.style.width = (COUNTER_GRAPH_W + 16) + 'px';
  panel.innerHTML =
    '<div class="vg-header">' +
      '<span class="vg-title" style="flex:0 0 auto;white-space:nowrap">カウンタ ' + c.id + '</span>' +
      '<span class="vg-status ct-sum" style="flex:1 1 auto;min-width:0;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis"></span>' +
      '<span class="vg-close ct-fold" title="畳む／開く">⌄</span>' +
      '<span class="vg-close">×</span>' +
    '</div>' +
    '<div class="ct-body" style="padding:6px 8px 8px">' +
      '<div style="display:flex;gap:6px;align-items:baseline">' +
        '<div style="flex:1"><div class="ct-net-lab" style="font-size:10px;color:var(--text2)"></div>' +
          '<div class="ct-net" style="font-size:16px;font-weight:600"></div></div>' +
        '<div style="flex:1"><div class="ct-rate-lab" style="font-size:10px;color:var(--text2)"></div>' +
          '<div class="ct-rate" style="font-size:16px;font-weight:600;color:' + COUNTER_COLOR + '"></div></div>' +
        '<div style="flex:1"><div class="ct-avg-lab" style="font-size:10px;color:var(--text2)"></div>' +
          '<div class="ct-avg" style="font-size:16px;font-weight:600"></div></div>' +
      '</div>' +
      '<div class="ct-mode" style="font-size:9px;color:var(--text2);text-align:right;white-space:nowrap"></div>' +
      '<div class="ct-dir" style="font-size:10px;color:var(--text2);margin:2px 0 4px"></div>' +
      '<canvas class="ct-graph" style="display:block;width:' + COUNTER_GRAPH_W + 'px;height:' +
        COUNTER_GRAPH_H + 'px;border:1px solid var(--border);border-radius:4px"></canvas>' +
      '<div class="prop-row" style="margin-top:6px"><span class="prop-label">数えるもの</span>' +
        '<select class="prop-input ct-what"></select></div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;font-size:10px;white-space:nowrap" ' +
        'title="通るたびに向きを問わず +1 と数えます。&#10;交流で流れの大きさを読むとき用（正味だと正と負が打ち消し合う）。&#10;線の上で揺れているだけの粒も往復のたびに数えます">' +
        '<span style="color:var(--text2)">向きを問わず数える</span>' +
        '<label style="cursor:pointer"><input type="checkbox" class="ct-absrate" style="margin:0 2px 0 0;vertical-align:middle">毎秒</label>' +
        '<label style="cursor:pointer"><input type="checkbox" class="ct-abstotal" style="margin:0 2px 0 0;vertical-align:middle">累計</label>' +
      '</div>' +
      '<div class="prop-row"><span class="prop-label">グラフの幅 [s]</span>' +
        '<input class="prop-input ct-span" type="number" step="10" min="5" ' +
        'title="グラフに出す時間の幅（シミュレーションの秒）。これより古い分は流れ去ります"></div>' +
      '<div style="display:flex;gap:6px;margin-top:6px">' +
        '<button class="btn-small ct-flip" style="flex:1" title="矢印の向きを反対にします（数も初めから）">向きを反転</button>' +
        '<button class="btn-small ct-zero" style="flex:1" title="数とグラフを初めからにします">0 に戻す</button>' +
      '</div>' +
    '</div>';
  host.appendChild(panel);
  c.panel = panel;
  const sel = q => panel.querySelector(q);
  const w = sel('.ct-what');
  for (const [v, label] of COUNTER_WHAT) {
    const op = document.createElement('option'); op.value = v; op.textContent = label; w.appendChild(op);
  }
  w.addEventListener('change', () => { pushUndo(); c.what = w.value; c.reset(); syncCounterPanel(c); });
  // ★切り替えても数え直さない（両向きの数は別々に持っているので、どちらの読みもその場で出せる）。
  //   グラフだけは縦軸の意味が変わる（正味は ±、向きを問わないと 0 から上）ので描き直す。
  sel('.ct-absrate').addEventListener('change', e => {
    pushUndo(); c.absRate = e.target.checked; c.samples = []; c._scale = 1;
    c._nextSample = world.simTime; syncCounterPanel(c);
  });
  sel('.ct-abstotal').addEventListener('change', e => {
    pushUndo(); c.absTotal = e.target.checked; syncCounterPanel(c);
  });
  sel('.ct-span').addEventListener('change', e => {
    pushUndo(); c.span = Math.max(5, parseFloat(e.target.value) || COUNTER_SPAN_DEF); syncCounterPanel(c);
  });
  sel('.ct-flip').addEventListener('click', () => {
    pushUndo();
    [c.ax, c.ay, c.bx, c.by] = [c.bx, c.by, c.ax, c.ay];
    c.reset(); syncCounterPanel(c);
  });
  sel('.ct-zero').addEventListener('click', () => { c.reset(); syncCounterPanel(c); });
  sel('.ct-fold').addEventListener('click', () => {
    c.collapsed = !c.collapsed; syncCounterPanel(c); placeCounterPanel(c);
  });
  panel.querySelector('.vg-close:last-child').addEventListener('click', () => removeCounter(c));
  panel.addEventListener('mousedown', () => selectCounter(c));
  counterPanelDraggable(c);
  syncCounterPanel(c);
  placeCounterPanel(c);
}
function placeCounterPanel(c) {
  const host = c.panel.offsetParent || document.body;
  const hr = host.getBoundingClientRect();
  const w = c.panel.offsetWidth || (COUNTER_GRAPH_W + 16), h = c.panel.offsetHeight || 80;
  c.panel.style.right = 'auto'; c.panel.style.bottom = 'auto';
  c.panel.style.left = Math.max(56, Math.min(hr.width  - w - 4, c.fx * hr.width))  + 'px';
  c.panel.style.top  = Math.max(4,  Math.min(hr.height - h - 4, c.fy * hr.height)) + 'px';
}
function counterPanelDraggable(c) {
  const header = c.panel.querySelector('.vg-header');
  let drag = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', e => {
    if (e.target.classList.contains('vg-close')) return;
    const r = c.panel.getBoundingClientRect();
    drag = true; ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const host = c.panel.offsetParent || document.body;
    const hr = host.getBoundingClientRect();
    c.fx = (e.clientX - hr.left - ox) / hr.width;
    c.fy = (e.clientY - hr.top  - oy) / hr.height;
    placeCounterPanel(c);
  });
  window.addEventListener('mouseup', () => drag = false);
}
function selectCounter(c) {
  selectedCounter = c;
  for (const q of counters) if (q.panel) q.panel.classList.toggle('active', q === c);
}
// 設定の欄を書き戻す（数は drawCounterReadouts が毎フレーム書く）
function syncCounterPanel(c) {
  const panel = c.panel; if (!panel) return;
  const sel = q => panel.querySelector(q);
  sel('.ct-body').style.display = c.collapsed ? 'none' : '';
  sel('.ct-fold').textContent = c.collapsed ? '⌃' : '⌄';
  if (document.activeElement !== sel('.ct-what')) sel('.ct-what').value = c.what;
  if (document.activeElement !== sel('.ct-span')) sel('.ct-span').value = c.span;
  sel('.ct-absrate').checked = c.absRate;
  sel('.ct-abstotal').checked = c.absTotal;
  // ★見出しは短いまま（窓が狭く3列が折り返す）。正味か両向きかはこの1行で言う
  sel('.ct-mode').textContent = `単位 個/s ・ 毎秒は${c.absRate ? '両向き' : '正味'} ・ 累計は${c.absTotal ? '両向き' : '正味'}`;
  const W = COUNTER_RATE_WIN;
  const lab = (q, text, title) => { const el = sel(q); el.textContent = text; el.title = title; };
  lab('.ct-net-lab', c.absTotal ? '通った数' : '正味の数',
      c.absTotal ? '向きを問わず通った数（矢印の向き＋逆向き）' : '矢印の向きに通った数 − 逆向きに通った数');
  lab('.ct-rate-lab', '毎秒',
      c.absRate ? `直近 ${W} 秒に向きを問わず通った数 ÷ ${W} 秒` : `直近 ${W} 秒に通った正味の数 ÷ ${W} 秒`);
  lab('.ct-avg-lab', '累計平均',
      c.absTotal ? '数え始めてから（0 に戻してから）向きを問わず通った数 ÷ 経った時間'
                 : '数え始めてから（0 に戻してから）の正味の数 ÷ 経った時間');
  c._dirty = true;
}
function _counterFmtRate(r) {
  const a = Math.abs(r);
  return (r < 0 ? '−' : '') + (a >= 10 ? a.toFixed(1) : a.toFixed(2));
}
// 累計の数：正味（矢印の向き − 逆向き）か、向きを問わない数（absTotal）
function counterTotal(c) { return c.absTotal ? c.fwd + c.back : c.net; }
// 累計平均 [個/s]：数え始めてから（0 に戻してから）の正味の数 ÷ 経った時間。
//   ★交流では正と負が打ち消し合って 0 に近づく（それが正しい読み）。直流の定常の電流、
//     穴から漏れ出す分子の平均の速さなどを読むためのもの。
function counterMeanRate(c) {
  const T = world.simTime - c._t0;
  return T > 0 ? counterTotal(c) / T : 0;
}
// 数・毎秒・グラフを窓へ。★render から毎フレーム呼ぶが、tick が進んだときだけ書く
function drawCounterReadouts() {
  for (const c of counters) {
    if (!c.panel || !c._dirty) continue;
    c._dirty = false;
    const sel = q => c.panel.querySelector(q);
    sel('.ct-sum').textContent = `${counterTotal(c)} 個 / ${_counterFmtRate(c.rate)} 個/s`;
    if (c.collapsed) continue;
    sel('.ct-net').textContent = String(counterTotal(c));
    sel('.ct-rate').textContent = _counterFmtRate(c.rate);
    sel('.ct-avg').textContent = _counterFmtRate(counterMeanRate(c));
    sel('.ct-dir').textContent = `矢印の向き ${c.fwd} ／ 逆向き ${c.back}`;
    _drawCounterGraph(c, sel('.ct-graph'));
  }
}
function _drawCounterGraph(c, cv) {
  const dpr = window.devicePixelRatio || 1;
  const W = COUNTER_GRAPH_W, H = COUNTER_GRAPH_H;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const grid = css.getPropertyValue('--border').trim() || 'rgba(128,128,128,0.4)';
  const txt  = css.getPropertyValue('--text2').trim() || '#999';
  // 縦軸：±目盛り（1, 2, 5 × 10^n に丸める）。0 の線は中央
  const raw = c._scale * 1.1;
  const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const top = [1, 1.5, 2, 3, 5, 7.5, 10].map(k => k * p10).find(v => v >= raw);
  // ★向きを問わない毎秒は負にならないので、0 を下端に置いて縦を全部使う
  const y0 = c.absRate ? H - 4 : H / 2;
  const y = r => y0 - (r / top) * (c.absRate ? H - 8 : H / 2 - 4);
  g.strokeStyle = grid; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, y0 + 0.5); g.lineTo(W, y0 + 0.5); g.stroke();
  g.fillStyle = txt; g.font = '9px sans-serif'; g.textBaseline = 'top';
  g.fillText((c.absRate ? '' : '+') + top, 2, 1);
  g.textBaseline = 'bottom'; g.fillText(c.absRate ? '0' : '−' + top, 2, H - 1);
  g.textAlign = 'right'; g.fillText(c.span + ' 秒', W - 2, H - 1); g.textAlign = 'left';
  if (c.samples.length < 2) return;
  // 横軸：右端が今。幅 span 秒
  const tNow = c.samples[c.samples.length - 1].t;
  const x = t => W - (tNow - t) / c.span * W;
  g.strokeStyle = COUNTER_COLOR; g.lineWidth = 1.5;
  g.beginPath();
  c.samples.forEach((s, i) => { const X = x(s.t), Y = y(s.r); i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
  g.stroke();
}

// ── 世界に引く線 ─────────────────────────────────────────
//   render() の最後（HUD と同じ画面座標）で引く。線・矢印・窓へのつなぎ線は同じ水色
function drawCounters() {
  if (!counters.length) return;
  ctx.save();
  for (const c of counters) {
    const a = worldToScreen(c.ax, c.ay), b = worldToScreen(c.bx, c.by);
    const sel = (c === selectedCounter);
    ctx.strokeStyle = COUNTER_COLOR; ctx.lineWidth = sel ? 3 : 2;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = COUNTER_COLOR; ctx.fill(); }
    // 矢印（数える向き）：線の中点から。★向きはカメラの回転を通す
    const n = _counterNormal(c);
    const u = worldToScreenDir(n.x, n.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    drawArrow(ctx, mx, my, mx + u.x * 22, my + u.y * 22, COUNTER_COLOR, 2);
    ctx.fillStyle = COUNTER_COLOR; ctx.font = '11px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('カウンタ ' + c.id, a.x + 4, a.y - 4);
    // 窓へのつなぎ線（プログラム・リモコンと同じ破線）
    if (c.panel) {
      const r = c.panel.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      const px = r.left - cr.left + r.width / 2, py = r.top - cr.top + (c.collapsed ? r.height : 0);
      ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.strokeStyle = hexToRgba(COUNTER_COLOR, 0.5);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(mx, my); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
  drawCounterReadouts();
}
