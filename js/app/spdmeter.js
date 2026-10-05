// ════════════════════════════════════════
//  速さの分布計（矩形の範囲の中にいるものを速さで仕分ける）
// ════════════════════════════════════════
//  矩形を1つドラッグして置くと、その中にいる「指定した種類」のものを速さで仕分けた
//  棒グラフ（個数 – 速さ）と、個数・平均の速さを窓に出す。種類は窓で選ぶ
//  （気体分子・水の粒子・物体）。
//  ★以前は「場にいる気体分子ぜんぶ」を仕分ける専用の窓（spdgraph.js）だった。気体分子
//    にしか使えず、仕切りの左右で温度を比べることもできなかったので、置く計器に改めた。
//    題材専用の部品ではない（通過カウンタと同じ立場）。
//  ★見る側の道具で、物理には一切参加しない（通過カウンタ・注釈と同じ）。spdMeters は
//    objects/joints/particles のどれにも入らず、どのモジュールからも見えない。数えるのは
//    tick の終わり（位置が確定したあと）で、何も書き換えない。
//  ★1つの窓で数えるのは1種類だけ。分子の速さは実物の速さ（molRealSpeed。画面の中は
//    MOL_SPEED_K＝37 倍遅くしてある）で、水と物体は画面の速さそのものなので、同じ横軸に
//    混ぜると目盛りが37倍ずれる。
//  ★重さ：範囲の判定は全粒子を1回なめるだけ。分子 1200／3000／6000 個で 1回 0.07／0.17／
//    0.36ms、同じ条件の simTick 1回（6.4／15.9／32.8ms）の約 1%。毎 tick 数えてよい。
//  ★「中にいる」は中心（物体は重心、粒子は点）が矩形の内側にあること。

const SPDM_MAX    = 6;           // 同時に置ける数（窓で画面が埋まるので上限を置く）
const SPDM_COLOR  = '#f06292';   // 枠・窓のつなぎ線（桃色。カウンタの水色・理論の曲線の黄と重ならない）
// [s] ならしの時定数（指数移動平均）。
//   ★1200個・24本の棒だと1本あたり50個で、そのままだと 1/√50 = 14% のちらつきが出て
//     山の形が読みにくい。0.3秒（18 tick）は分布が変わる速さ（数秒）より十分速いので、
//     「同じ速さから始めて山ができていく」過程はそのまま見える（旧 spdgraph.js の値）。
const SPDM_TAU    = 0.3;
const SPDM_GRAPH_W = 268, SPDM_GRAPH_H = 150;   // [px] 窓の中のグラフ
// 何を数えるか。★保存形式なので値の名前は変えない
//   bins：棒の数。★物体は数が少ない（多くて数十）ので、24本では棒がまばらになり山が読めない
const SPDM_WHAT = [
  ['gas',    '気体分子',             24],
  ['water',  '水の粒子',             24],
  ['bodies', '物体（固定していない）', 12],
];

let spdMeters = [];
let spdMeterSeq = 0;
let selectedSpdMeter = null;

class SpdMeter {
  constructor(o) {
    o = o || {};
    this.id = o.id !== undefined ? o.id : ++spdMeterSeq;
    if (o.id !== undefined && o.id > spdMeterSeq) spdMeterSeq = o.id;
    // 矩形 [px]（世界座標）。★常に x0<x1・y0<y1 に揃えて持つ
    this.x0 = Math.min(o.x0 || 0, o.x1 !== undefined ? o.x1 : 100);
    this.x1 = Math.max(o.x0 || 0, o.x1 !== undefined ? o.x1 : 100);
    this.y0 = Math.min(o.y0 || 0, o.y1 !== undefined ? o.y1 : 100);
    this.y1 = Math.max(o.y0 || 0, o.y1 !== undefined ? o.y1 : 100);
    this.what = SPDM_WHAT.some(w => w[0] === o.what) ? o.what : 'gas';
    this.showTheory = o.showTheory !== undefined ? !!o.showTheory : true;
    // ★窓の位置は画面の割合で持つ（プログラム・リモコン・カウンタの窓と同じ理由）
    this.fx = o.fx !== undefined ? o.fx : 0.66;
    this.fy = o.fy !== undefined ? o.fy : 0.40;
    this.collapsed = !!o.collapsed;
    this.panel = null;
    this.hover = null;
    this.reset();
  }
  // ならしを初めから。★保存しない（シーンは「実行前の姿」）
  reset() {
    this.bins = null;         // ならしたあとの個数（棒ごと）
    this.n = 0;               // いま中にいる個数（ならさない）
    this.vMean = 0;           // [m/s] 平均の速さ（ならす）
    this.v2 = 0;              // [m²/s²] 速さの2乗の平均（ならす。気体分子の温度はここから）
    this.vPeak = 0;           // [m/s] いま中にいる中でいちばん速いもの（ならさない）
    // ★横軸の上限。気体分子は温度から決める（3.2 × v_rms）。棒の中身から決めると、山が
    //   育つあいだ軸が伸び縮みして形の変化が読めない。温度の無い水・物体は、見えた最大の
    //   速さから決めて**広がるだけで縮まない**（0 に戻すまで）。カウンタの縦軸と同じ理由。
    this.vmax = 0;
    this._lastT = world.simTime;
    this._dirty = true;
  }
  bins_() { return SPDM_WHAT.find(w => w[0] === this.what)[2]; }
}

// 種類ごとの「中にいるもの」と実物の速さ [m/s]
function _spdMeterSpeeds(m) {
  const out = [];
  const inside = (x, y) => x >= m.x0 && x <= m.x1 && y >= m.y0 && y <= m.y1;
  if (m.what === 'bodies') {
    for (const b of objects) {
      if (b.isStatic || b.isSpawner || !inside(b.x, b.y)) continue;
      out.push(Math.hypot(b.vx, b.vy) * PX2M);
    }
    return out;
  }
  const gas = m.what === 'gas';
  for (const p of particles) {
    if (!!(p.prm && p.prm.kinetic) !== gas || !inside(p.x, p.y)) continue;
    const v = Math.hypot(p.vx, p.vy);
    out.push(gas ? molRealSpeed(v) : v * PX2M);
  }
  return out;
}
// 気体分子の温度 [K]：速さの2乗の平均から（molecule.js の kineticT と同じ式）
//   ★範囲の中の温度は**ゆらぐ**。数える分子が少ないと、速い分子が何個か出入りするだけで
//     2乗の平均が動くため（2次元では v² が指数分布で、1回の読みの相対ゆらぎは 1/√N）。
//     実測（『分子の速さの分布』の箱・20℃・10秒の時間平均）：箱の左半分・右半分（各約600個）は
//     19.6／20.3℃・標準偏差 5.4℃（最小 4.6℃〜最大 34.8℃）、箱全体は 20.0℃・標準偏差 0。
//     嘘ではなく、小さな集団の温度とはそういうもの。ならしの時定数で隠さない。
function spdMeterT(m) { return MOL_MASS * m.v2 / (MOL_DOF * MOL_KB); }

// 1回ぶん数えて、ならしに混ぜる。snap=true ならならさずにそのまま置く
//   （置いた直後・動かしたあと・種類を変えたあと・時計が巻き戻ったあと）
function _spdMeterSample(m, snap) {
  const vs = _spdMeterSpeeds(m);
  const a = snap || !m.bins ? 1 : Math.min(1, SIM_DT / SPDM_TAU);
  let s1 = 0, s2 = 0, pk = 0;
  for (const v of vs) { s1 += v; s2 += v * v; if (v > pk) pk = v; }
  m.n = vs.length; m.vPeak = pk;
  if (vs.length) {
    m.vMean += (s1 / vs.length - m.vMean) * a;
    m.v2    += (s2 / vs.length - m.v2) * a;
  } else if (a === 1) { m.vMean = 0; m.v2 = 0; }
  if (m.what === 'gas') {
    const vrms = Math.sqrt(m.v2);
    if (vrms > 0) m.vmax = 3.2 * vrms;
  } else if (pk > 0) {
    m.vmax = Math.max(m.vmax, _spdMeterNice(pk * 1.1));
  }
  const N = m.bins_();
  if (!m.bins || m.bins.length !== N) { m.bins = new Array(N).fill(0); }
  const cur = new Array(N).fill(0);
  if (m.vmax > 0) {
    const w = m.vmax / N;
    for (const v of vs) cur[Math.min(N - 1, Math.floor(v / w))]++;
  }
  for (let i = 0; i < N; i++) m.bins[i] += (cur[i] - m.bins[i]) * a;
  m._dirty = true;
}
// 1, 2, 5 × 10^n に切り上げる（水・物体の横軸の上限）
function _spdMeterNice(v) {
  const p10 = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-3))));
  return [1, 1.5, 2, 3, 5, 7.5, 10].map(k => k * p10).find(x => x >= v);
}
// tick の終わり（simTime を進めたあと）に呼ぶ
function updateSpdMeters() {
  if (!spdMeters.length) return;
  const t = world.simTime;
  for (const m of spdMeters) {
    // ★時計が巻き戻った（ステップ数を0に戻した・デモの先回し）らならしを捨てる
    const snap = t < m._lastT;
    if (snap) { m.reset(); }
    m._lastT = t;
    _spdMeterSample(m, snap);
  }
}
function resetSpdMeters() { for (const m of spdMeters) { m.reset(); _spdMeterSample(m, true); } }

// ── 置く・消す ─────────────────────────────────────────────
function addSpdMeter(x0, y0, x1, y1, opts) {
  if (spdMeters.length >= SPDM_MAX) {
    appAlert('速さの分布計', `速さの分布計は ${SPDM_MAX} 個までです。`);
    return null;
  }
  pushUndo();
  const m = new SpdMeter(Object.assign({ x0, y0, x1, y1, fy: 0.25 + (spdMeters.length % 3) * 0.12 }, opts));
  spdMeters.push(m);
  _spdMeterSample(m, true);
  buildSpdMeterPanel(m);
  selectSpdMeter(m);
  return m;
}
function removeSpdMeter(m) {
  const i = spdMeters.indexOf(m);
  if (i >= 0) { pushUndo(); spdMeters.splice(i, 1); }
  if (m.panel) m.panel.remove();
  if (selectedSpdMeter === m) selectedSpdMeter = null;
}
function clearSpdMeters() {
  for (const m of spdMeters) if (m.panel) m.panel.remove();
  spdMeters = []; selectedSpdMeter = null;
}

// ── 編集ツールで動かす ─────────────────────────────────────
//   角の●を掴めばその角だけ（向かいの角は動かない）、枠の線を掴めば枠ごと平行移動。
//   ★内側は掴まない。気体の箱をまるごと囲って置くのが普通の使い方で、内側を掴むと
//     中の物体・粒子を選ぶ操作をすべて横取りしてしまう。
//   ★枠は画面の最前面（HUD と同じ層）に描いてあるので、当たり判定も物体より先に見る。
//   ★放したら中身を数え直す（動かす前と後では別の範囲なので、ならしを引き継がない）。
const SPDM_PICK_PX = 8;          // [画面px] 角・枠の当たり幅
const SPDM_MIN_PX  = 16;         // [px] 範囲の最小の幅・高さ（世界座標）
let spdMeterDrag = null;         // { m, mode:'move'|'c00'|'c10'|'c01'|'c11', x0,y0, r:{x0,y0,x1,y1}, pushed }
function spdMeterAtPoint(wp) {
  const tol = SPDM_PICK_PX / cam.zoom;
  for (let i = spdMeters.length - 1; i >= 0; i--) {
    const m = spdMeters[i];
    for (const [cx, cy, mode] of [[m.x0, m.y0, 'c00'], [m.x1, m.y0, 'c10'], [m.x0, m.y1, 'c01'], [m.x1, m.y1, 'c11']])
      if (Math.hypot(wp.x - cx, wp.y - cy) <= tol) return { m, mode };
  }
  for (let i = spdMeters.length - 1; i >= 0; i--) {
    const m = spdMeters[i];
    const inX = wp.x >= m.x0 - tol && wp.x <= m.x1 + tol, inY = wp.y >= m.y0 - tol && wp.y <= m.y1 + tol;
    const onV = inY && (Math.abs(wp.x - m.x0) <= tol || Math.abs(wp.x - m.x1) <= tol);
    const onH = inX && (Math.abs(wp.y - m.y0) <= tol || Math.abs(wp.y - m.y1) <= tol);
    if (onV || onH) return { m, mode: 'move' };
  }
  return null;
}
function beginSpdMeterDragIfHit(wp) {
  const h = spdMeterAtPoint(wp);
  if (!h) return false;
  const m = h.m;
  // ★履歴は実際に動かした最初の1回で積む（押しただけ＝窓を選んだだけで積むと、戻るが空振りする）
  spdMeterDrag = { m, mode: h.mode, x0: wp.x, y0: wp.y,
                   r: { x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1 }, pushed: false };
  selectSpdMeter(m);
  return true;
}
function dragSpdMeterTo(wp) {
  const d = spdMeterDrag; if (!d) return;
  const m = d.m, r = d.r;
  if (!d.pushed) { pushUndo(); d.pushed = true; }
  if (d.mode === 'move') {
    // ★掴んだ角（左上）がグリッドへ乗るように動かす（ほかの平行移動と同じ）
    const s = snapPt({ x: r.x0 + (wp.x - d.x0), y: r.y0 + (wp.y - d.y0) });
    const dx = s.x - r.x0, dy = s.y - r.y0;
    m.x0 = r.x0 + dx; m.x1 = r.x1 + dx; m.y0 = r.y0 + dy; m.y1 = r.y1 + dy;
    return;
  }
  // 角：向かいの角を止めたまま。★裏返し（向かいの角を越える）は許して、最後に並べ直す
  const p = snapPt(wp);
  const fx = d.mode[1] === '0' ? r.x1 : r.x0, fy = d.mode[2] === '0' ? r.y1 : r.y0;
  if (Math.abs(p.x - fx) < SPDM_MIN_PX || Math.abs(p.y - fy) < SPDM_MIN_PX) return;
  m.x0 = Math.min(p.x, fx); m.x1 = Math.max(p.x, fx);
  m.y0 = Math.min(p.y, fy); m.y1 = Math.max(p.y, fy);
}
function endSpdMeterDrag() {
  const d = spdMeterDrag; spdMeterDrag = null;
  if (!d) return;
  const m = d.m, r = d.r;
  if (m.x0 !== r.x0 || m.y0 !== r.y0 || m.x1 !== r.x1 || m.y1 !== r.y1) {
    m.reset(); _spdMeterSample(m, true); syncSpdMeterPanel(m);
  }
}

// ── 保存・復元 ───────────────────────────────────────────
//   ★数えた中身は保存しない（SpdMeter.reset の★）
function serializeSpdMeter(m) {
  return { id: m.id, x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, what: m.what,
           showTheory: m.showTheory, fx: m.fx, fy: m.fy, collapsed: m.collapsed };
}
function deserializeSpdMeters(arr) {
  clearSpdMeters();
  spdMeters = (arr || []).map(d => new SpdMeter(d));
  for (const m of spdMeters) { _spdMeterSample(m, true); buildSpdMeterPanel(m); }
  return spdMeters;
}

// ════════════════════════════════════════
//  窓（画面に貼り付く）
// ════════════════════════════════════════
//  枠・ドラッグは通過カウンタの窓（.velgraph-panel / .vg-*）の CSS と作りを借りる。
function buildSpdMeterPanel(m) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'velgraph-panel spdmeter-panel';
  const col = (cls, title) =>
    '<div style="flex:1;min-width:0"><div class="' + cls + '-lab" style="font-size:10px;color:var(--text2)" title="' + title + '"></div>' +
    '<div class="' + cls + '" style="font-size:15px;font-weight:600;white-space:nowrap"></div></div>';
  panel.innerHTML =
    '<div class="vg-header">' +
      '<span class="vg-title" style="flex:0 0 auto;white-space:nowrap">速さの分布 ' + m.id + '</span>' +
      '<span class="vg-status sm-sum" style="flex:1 1 auto;min-width:0;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis"></span>' +
      '<span class="vg-close sm-fold" title="畳む／開く">⌄</span>' +
      '<span class="vg-close">×</span>' +
    '</div>' +
    '<div class="sm-body" style="padding:6px 8px 8px">' +
      '<div style="display:flex;gap:6px;align-items:baseline">' +
        col('sm-n', 'いま範囲の中にいる個数（中心が枠の内側にあるもの）') +
        col('sm-mean', '範囲の中の速さの平均（0.3秒でならした値）') +
        col('sm-third', '') +
      '</div>' +
      '<canvas class="sm-graph" style="display:block;width:' + SPDM_GRAPH_W + 'px;height:' +
        SPDM_GRAPH_H + 'px;border:1px solid var(--border);border-radius:4px;margin-top:4px"></canvas>' +
      '<div class="sm-note" style="font-size:10px;color:var(--text2);margin:3px 0;line-height:1.4"></div>' +
      '<div class="prop-row" style="margin-top:4px"><span class="prop-label">数えるもの</span>' +
        '<select class="prop-input sm-what"></select></div>' +
      '<label class="sm-th-row" style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer" ' +
        'title="範囲の中の分子の温度でのマクスウェル分布（2次元）を曲線で重ねます。&#10;画面の中は2次元なので f(v) ∝ v·exp(−mv²/2kT) です（3次元の教科書の式は v² 倍）">' +
        '<input type="checkbox" class="sm-th" style="margin:0">理論の曲線（マクスウェル分布）を重ねる</label>' +
    '</div>';
  host.appendChild(panel);
  m.panel = panel;
  const sel = q => panel.querySelector(q);
  const w = sel('.sm-what');
  for (const [v, label] of SPDM_WHAT) {
    const op = document.createElement('option'); op.value = v; op.textContent = label; w.appendChild(op);
  }
  w.addEventListener('change', () => {
    pushUndo(); m.what = w.value; m.reset(); _spdMeterSample(m, true); syncSpdMeterPanel(m);
  });
  sel('.sm-th').addEventListener('change', e => { pushUndo(); m.showTheory = e.target.checked; m._dirty = true; });
  sel('.sm-fold').addEventListener('click', () => {
    m.collapsed = !m.collapsed; syncSpdMeterPanel(m); placeSpdMeterPanel(m);
  });
  panel.querySelector('.vg-close:last-child').addEventListener('click', () => removeSpdMeter(m));
  panel.addEventListener('mousedown', () => selectSpdMeter(m));
  const cv = sel('.sm-graph');
  cv.addEventListener('mousemove', ev => {
    const r = cv.getBoundingClientRect();
    m.hover = { x: ev.clientX - r.left, y: ev.clientY - r.top }; m._dirty = true;
  });
  cv.addEventListener('mouseleave', () => { m.hover = null; m._dirty = true; });
  spdMeterPanelDraggable(m);
  syncSpdMeterPanel(m);
  placeSpdMeterPanel(m);
  // ★窓の大きさが変わったら置き直す。数の欄は最初の描画（drawSpdMeterReadouts）まで空で、
  //   作った瞬間に測ると 19px 低く出る。画面の下端に寄せた窓（『分子の速さの分布』の fy:1）は
  //   その分だけ下へはみ出し、グラフの下が切れていた（実測：窓 293→312px、下端 15px はみ出し）。
  //   種類の切り替え・畳む／開くで高さが変わるときも同じ。
  if (window.ResizeObserver) new ResizeObserver(() => { if (m.panel) placeSpdMeterPanel(m); }).observe(panel);
}
// ★ブラウザの窓の大きさが変わったときも、はみ出さないように置き直す（位置は割合で持っている）
window.addEventListener('resize', () => { for (const m of spdMeters) if (m.panel) placeSpdMeterPanel(m); });
function placeSpdMeterPanel(m) {
  const host = m.panel.offsetParent || document.body;
  const hr = host.getBoundingClientRect();
  const w = m.panel.offsetWidth || (SPDM_GRAPH_W + 16), h = m.panel.offsetHeight || 80;
  m.panel.style.right = 'auto'; m.panel.style.bottom = 'auto';
  m.panel.style.left = Math.max(56, Math.min(hr.width  - w - 4, m.fx * hr.width))  + 'px';
  m.panel.style.top  = Math.max(4,  Math.min(hr.height - h - 4, m.fy * hr.height)) + 'px';
}
function spdMeterPanelDraggable(m) {
  const header = m.panel.querySelector('.vg-header');
  let drag = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', e => {
    if (e.target.classList.contains('vg-close')) return;
    const r = m.panel.getBoundingClientRect();
    drag = true; ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const host = m.panel.offsetParent || document.body;
    const hr = host.getBoundingClientRect();
    m.fx = (e.clientX - hr.left - ox) / hr.width;
    m.fy = (e.clientY - hr.top  - oy) / hr.height;
    placeSpdMeterPanel(m);
  });
  window.addEventListener('mouseup', () => drag = false);
}
function selectSpdMeter(m) {
  selectedSpdMeter = m;
  for (const q of spdMeters) if (q.panel) q.panel.classList.toggle('active', q === m);
}
// 設定の欄を書き戻す（数は drawSpdMeterReadouts が毎フレーム書く）
function syncSpdMeterPanel(m) {
  const panel = m.panel; if (!panel) return;
  const sel = q => panel.querySelector(q);
  sel('.sm-body').style.display = m.collapsed ? 'none' : '';
  sel('.sm-fold').textContent = m.collapsed ? '⌃' : '⌄';
  if (document.activeElement !== sel('.sm-what')) sel('.sm-what').value = m.what;
  sel('.sm-th').checked = m.showTheory;
  const gas = m.what === 'gas';
  // ★理論の曲線は気体分子のときだけ出す。マクスウェル分布は「弾性衝突だけで熱平衡に
  //   達した分子の集団」の分布で、水（位置ベースの密度緩和・減衰あり）にも物体にも
  //   あてはまる理由が無い。出せないときは欄ごと隠して理由を書く（フェーザ図と同じ流儀）。
  sel('.sm-th-row').hidden = !gas;
  sel('.sm-n-lab').textContent = '個数';
  sel('.sm-mean-lab').textContent = '平均の速さ';
  const third = sel('.sm-third-lab');
  third.textContent = gas ? '温度' : '最も速いもの';
  third.title = gas ? '範囲の中の分子の速さの2乗の平均から出した温度（0.3秒でならした値）。\n温度は集団の量で、範囲を変えれば変わる'
                    : 'いま範囲の中にいる中で、いちばん速いものの速さ';
  sel('.sm-note').textContent = gas
    ? '分子の速さは実物の速さに直してあります（画面の中の動きは 1/37）。'
    : (m.what === 'water'
        ? '理論の曲線はありません（マクスウェル分布は熱平衡の気体分子の分布で、水の粒子にはあてはまりません）。'
        : '理論の曲線はありません（マクスウェル分布は熱平衡の気体分子の分布です）。重心が枠の内側にある物体を数えます。');
  m._dirty = true;
}
function _spdFmtV(v) { return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2); }
// 数・グラフを窓へ。★render から毎フレーム呼ぶが、中身が変わったときだけ書く
function drawSpdMeterReadouts() {
  for (const m of spdMeters) {
    if (!m.panel || !m._dirty) continue;
    m._dirty = false;
    const sel = q => m.panel.querySelector(q);
    const gas = m.what === 'gas';
    const third = gas ? (m.n ? (spdMeterT(m) - 273.15).toFixed(1) + ' ℃' : '—') : (m.n ? _spdFmtV(m.vPeak) + ' m/s' : '—');
    sel('.sm-sum').textContent = `${m.n} 個 / 平均 ${m.n ? _spdFmtV(m.vMean) : '—'} m/s`;
    if (m.collapsed) continue;
    sel('.sm-n').textContent = m.n + ' 個';
    sel('.sm-mean').textContent = m.n ? _spdFmtV(m.vMean) + ' m/s' : '—';
    sel('.sm-third').textContent = third;
    _drawSpdMeterGraph(m, sel('.sm-graph'));
  }
}
function _drawSpdMeterGraph(m, cv) {
  const dpr = window.devicePixelRatio || 1;
  const W = SPDM_GRAPH_W, H = SPDM_GRAPH_H;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const grid = css.getPropertyValue('--border').trim() || 'rgba(128,128,128,0.4)';
  const txt  = css.getPropertyValue('--text2').trim() || '#999';
  const padL = 30, padR = 8, padT = 8, padB = 18;
  const pw = W - padL - padR, ph = H - padT - padB;
  g.strokeStyle = grid; g.lineWidth = 1;
  g.strokeRect(padL + 0.5, padT + 0.5, pw, ph);
  g.font = '10px sans-serif'; g.fillStyle = txt;
  if (!m.n || !m.bins || !(m.vmax > 0)) {
    g.fillText('範囲の中に' + SPDM_WHAT.find(w => w[0] === m.what)[1] + 'がありません', padL + 8, padT + 18);
    return;
  }
  const N = m.bins.length, w = m.vmax / N;
  const gas = m.what === 'gas';
  // 理論（2次元のマクスウェル分布。棒と同じ「その幅に入る個数」に直す）
  const kT = gas ? MOL_KB * Math.max(1, spdMeterT(m)) : 0;
  const th = v => m.n * (MOL_MASS / kT) * v * Math.exp(-MOL_MASS * v * v / (2 * kT)) * w;
  const theory = gas && m.showTheory;
  // ★縦軸の上限は棒の最大と理論の山の高さの大きいほう（理論の山で揃えると、山が育つ
  //   あいだ縦軸が動かない。旧 spdgraph.js と同じ）
  let ymax = 0;
  for (const b of m.bins) ymax = Math.max(ymax, b);
  if (theory) ymax = Math.max(ymax, th(Math.sqrt(kT / MOL_MASS)));
  ymax = Math.max(1, ymax * 1.2);
  const X = v => padL + (v / m.vmax) * pw;
  const Y = c => padT + (1 - c / ymax) * ph;
  const bw = pw / N;
  g.fillStyle = hexToRgba(SPDM_COLOR, 0.55);
  for (let i = 0; i < N; i++) {
    const h = Y(0) - Y(m.bins[i]);
    if (h > 0) g.fillRect(padL + i * bw + 1, Y(m.bins[i]), Math.max(1, bw - 2), h);
  }
  if (theory) {
    g.strokeStyle = 'rgba(255,213,79,0.95)'; g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const v = m.vmax * i / 120;
      i ? g.lineTo(X(v), Y(th(v))) : g.moveTo(X(v), Y(th(v)));
    }
    g.stroke();
  }
  // 平均の速さに縦線
  g.strokeStyle = txt; g.setLineDash([3, 3]); g.lineWidth = 1;
  g.beginPath(); g.moveTo(X(m.vMean) + 0.5, padT); g.lineTo(X(m.vMean) + 0.5, padT + ph); g.stroke();
  g.setLineDash([]);
  // 目盛り
  g.fillStyle = txt; g.textBaseline = 'top';
  g.textAlign = 'left';  g.fillText('0', padL, padT + ph + 3);
  g.textAlign = 'right'; g.fillText(_spdFmtV(m.vmax) + ' m/s', padL + pw, padT + ph + 3);
  g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText(ymax >= 10 ? ymax.toFixed(0) : ymax.toFixed(1), padL - 3, padT + 4);
  g.fillText('0', padL - 3, padT + ph);
  g.save(); g.translate(9, padT + ph / 2); g.rotate(-Math.PI / 2);
  g.textAlign = 'center'; g.fillText('個数', 0, 0); g.restore();
  // カーソルの棒を読む
  if (m.hover) {
    const i = Math.floor((m.hover.x - padL) / bw);
    if (i >= 0 && i < N && m.hover.y >= padT && m.hover.y <= padT + ph) {
      g.strokeStyle = '#fff'; g.lineWidth = 1;
      g.strokeRect(padL + i * bw + 0.5, padT + 0.5, bw - 1, ph - 1);
      const s = `${_spdFmtV(i * w)}〜${_spdFmtV((i + 1) * w)} m/s：${m.bins[i].toFixed(1)} 個`;
      g.textAlign = 'right'; g.textBaseline = 'top'; g.fillStyle = '#fff';
      g.fillText(s, padL + pw - 4, padT + 4);
    }
  }
}

// ── 世界に描く枠 ─────────────────────────────────────────
//   render() の最後（HUD と同じ画面座標）で描く。枠・角・窓へのつなぎ線は同じ桃色
function drawSpdMeters() {
  if (!spdMeters.length) return;
  ctx.save();
  for (const m of spdMeters) {
    const c = [worldToScreen(m.x0, m.y0), worldToScreen(m.x1, m.y0),
               worldToScreen(m.x1, m.y1), worldToScreen(m.x0, m.y1)];
    const sel = (m === selectedSpdMeter);
    ctx.strokeStyle = SPDM_COLOR; ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); c.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = SPDM_COLOR;
    for (const p of c) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('速さの分布 ' + m.id, c[0].x + 4, c[0].y - 4);
    // 窓へのつなぎ線（カウンタと同じ破線）。枠の左上の角から
    if (m.panel) {
      const r = m.panel.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      const px = r.left - cr.left + r.width / 2, py = r.top - cr.top + (m.collapsed ? r.height : 0);
      ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.strokeStyle = hexToRgba(SPDM_COLOR, 0.5);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(c[0].x, c[0].y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
  drawSpdMeterReadouts();
}
