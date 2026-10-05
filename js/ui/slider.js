function _clampNum(v, lo, hi){ v = parseFloat(v); if (isNaN(v)) v = lo; return Math.max(lo, Math.min(hi, v)); }
function _clampInt(v, lo, hi){ v = Math.round(parseFloat(v)); if (isNaN(v)) v = lo; return Math.max(lo, Math.min(hi, v)); }
function sigFigTicks(lo, hi, minStep){
  lo = Math.max(lo, 1e-9);
  if (hi <= lo) return [ +(+hi).toFixed(6) ];
  minStep = minStep || 0;
  const out = [];
  const dLo = Math.floor(Math.log10(lo) + 1e-9);
  const dHi = Math.floor(Math.log10(hi) + 1e-9);
  for (let d = dLo; d <= dHi; d++){
    const base = Math.pow(10, d);                         // この桁の下端
    const step = Math.max(Math.pow(10, d - 1), minStep);  // 有効数字2桁 or 下限
    const dec  = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const cnt  = Math.round(base * 9 / step);             // base 〜 base*10 の手前まで
    for (let k = 0; k < cnt; k++){
      const v = +(base + k * step).toFixed(Math.min(12, dec));
      if (v < lo - 1e-12 || v > hi + 1e-12) continue;
      if (out.length && Math.abs(out[out.length-1] - v) < 1e-12) continue;
      out.push(v);
    }
  }
  if (!out.length) out.push(+lo.toFixed(6));
  if (out[out.length-1] < hi - 1e-9) out.push(+(+hi).toFixed(6));   // 端点を必ず含める
  return out;
}
function _sigFigTicksFor(lo, hi, opts){
  opts = opts || {};
  const t = sigFigTicks(lo, hi, opts.minStep);
  return opts.zero ? [ 0, ...t ] : t;
}
function _nearestTickIndex(ticks, v){
  v = parseFloat(v); if (isNaN(v)) v = ticks[0];
  let best = 0, bd = Infinity, last = 0;
  for (let i = 0; i < ticks.length; i++){
    const d = Math.abs(ticks[i] - v);
    if (d < bd){ bd = d; best = last = i; }
    else if (ticks[i] === ticks[best] && last === i - 1) last = i;   // 同じ値の段が続く（0 への吸着）
  }
  // ★同じ値の段が並んでいたら、その真ん中に置く。吸着の段（heatPowerTicks）の端に
  //   置くと、0 なのにつまみが中央から少しずれて見える。
  return Math.round((best + last) / 2);
}
const _boundSliders = [];   // syncSliders で再同期する対象
function _makeSlider(input){
  const slider = document.createElement('input');
  slider.type = 'range'; slider.className = 'prop-slider';
  input.classList.add('compact');                  // 数値ボックスを狭める
  input.insertAdjacentElement('afterend', slider); // 同じ行の数値ボックスの右へ
  return slider;
}
function _decOf(step){ const s = String(step).split('.'); return s[1] ? s[1].length : 0; }
function _sliderValueOf(rec){
  if (rec.ticks) return rec.ticks[_clampInt(rec.slider.value, 0, rec.ticks.length-1)];
  const v = parseFloat(rec.slider.value);
  return rec.dec ? +v.toFixed(rec.dec) : v;   // 9.800000000000001 を数値欄に出さない
}
function _syncOne(rec){
  if (rec.ticks) rec.slider.value = _nearestTickIndex(rec.ticks, _clampNum(rec.input.value, rec.lo, rec.hi));
  else           rec.slider.value = _clampNum(rec.input.value, rec.lo, rec.hi);
  _fitBox(rec);
}
// ── 数値ボックスの幅 ──
//   ★固定の 52px（.compact）では4桁しか入らず、万有引力定数 6000・重力Y −9.80665・
//     面に垂直な重力 9.80665 などが切れていた。シミュレーションメニューの窓（sim-popover.js の spNum）
//     と同じく、範囲と刻みの桁から幅を決める。
//   ★それより長い値（刻みより細かい既定値 9.80665、範囲外の手入力）は、同期のたびにその値まで広げる。
//     スライダーを動かしている間は刻みの桁に丸めた範囲内の値しか入らないので、幅は揺れない。
//   ＋32px は 左右の余白12・枠2・Chrome がカーソルを乗せると出す増減ボタン15 と少しの遊び。
function _boxChars(rec){
  if (rec.nch == null){
    if (rec.ticks) rec.nch = Math.max(...rec.ticks.map(t => String(t).length));
    else {
      const intLen = v => String(Math.trunc(Math.abs(v))).length + (v < 0 ? 1 : 0);
      rec.nch = Math.max(intLen(rec.lo), intLen(rec.hi)) + (rec.dec > 0 ? rec.dec + 1 : 0);
    }
  }
  return Math.max(rec.nch, String(rec.input.value).length);
}
function _fitBox(rec){
  rec.input.style.flexBasis = `max(52px, calc(${_boxChars(rec)}ch + 32px))`;
}
function _bindSliderEvents(rec, onSlide, onArm){
  const { input, slider } = rec;
  _fitBox(rec);
  let armed = false;   // ドラッグ開始時に一度だけ undo を積む合図
  rec.apply = () => {                       // 拡大バーからも値を確定できるよう公開する
    if (armed || _wheelArm){ if (onArm) onArm(); armed = false; }
    const v = _sliderValueOf(rec);
    input.value = v;          // 数値ボックスは常に有効数字2桁の値へ丸まる
    onSlide(v);
    if (szRec === rec) szPaint();
  };
  rec.arm = () => { if (onArm) onArm(); };
  slider.addEventListener('pointerdown', () => { armed = true; _sliderDragging = true; });
  slider.addEventListener('keydown',     e => { if (_keyBurstArm(slider, e)) armed = true; });   // 連打は1回の編集（state.js）
  slider.addEventListener('input', rec.apply);
  input.addEventListener('input', () => _syncOne(rec));   // 数値ボックス→スライダー
  // ── ホバーで拡大バーを出す ──
  slider.addEventListener('pointerenter', () => {
    if (szDrag) return;
    szKeep();
    clearTimeout(szTimer);
    szTimer = setTimeout(() => szShow(rec), SZ_DELAY);
  });
  slider.addEventListener('pointerleave', () => {
    clearTimeout(szTimer); szTimer = null;
    szLater();
  });
}
// ── 0 への吸着（detent）──
//   ★正負をまたぐ量のうち、0 が「無い・止まっている・逆向きとの境目」を意味するもの
//     （重力・速度・電荷・起電力・位相）だけに付ける。角度と℃は付けない（0 が特別な点ではない）。
//   ★作りは heat-field.js の heatPowerTicks・remote.js の remotePropTicks と同じ：
//     線形の段を作り、|v| < 可動域の 1% の段を全部 0 にする（つまみの上で ±1% の幅）。
//     段を間引かずに 0 で埋めるので、矢印キーで1段ずつ送っても 0 で詰まらず抜けられる。
//     消えた小さな値（重力 0.1〜0.3 など）は数値欄で打てる。
//   ★刻みの粗い量（位相 5° 刻み＝73段）は 0 の段が1つだけ残るが、それでも可動域の 1.4% あり、
//     もともと狙える幅になっている。
const ZERO_DETENT_FRAC = 0.01;
function zeroDetentTicks(lo, hi, step){
  const dec = _decOf(step), d = (hi - lo) * ZERO_DETENT_FRAC, out = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++){
    const v = +(lo + i * step).toFixed(dec);
    out.push(Math.abs(v) < d ? 0 : v);
  }
  return out;
}
// ── 線形スライダー（狭域・係数・整数・位置など）──
//   detent を真にすると 0 に吸着する目盛りスライダーになる（上の zeroDetentTicks）
function bindSlider(id, lo, hi, step, onSlide, onArm, detent){
  if (detent && lo < 0 && hi > 0) return bindTickSlider(id, zeroDetentTicks(lo, hi, step), onSlide, onArm);
  const input = document.getElementById(id);
  if (!input) return;
  const slider = _makeSlider(input);
  slider.min = lo; slider.max = hi; slider.step = step;
  slider.value = _clampNum(input.value, lo, hi);
  const rec = { input, slider, lo, hi, ticks: null, dec: _decOf(step) };
  _bindSliderEvents(rec, onSlide, onArm);
  _boundSliders.push(rec);
}
// ── 有効数字2桁スライダー（桁をまたぐ量）──
function bindSigFigSlider(id, lo, hi, opts, onSlide, onArm){
  const input = document.getElementById(id);
  if (!input) return;
  const slider = _makeSlider(input);
  const ticks = _sigFigTicksFor(lo, hi, opts);
  slider.min = 0; slider.max = ticks.length - 1; slider.step = 1;
  const rec = { input, slider, lo: ticks[0], hi: ticks[ticks.length-1], ticks };
  slider.value = _nearestTickIndex(ticks, _clampNum(input.value, rec.lo, rec.hi));
  _bindSliderEvents(rec, onSlide, onArm);
  _boundSliders.push(rec);
}
// ── 目盛りを直接与えるスライダー（意味のない区間を飛ばしたいとき）──
function bindTickSlider(id, ticks, onSlide, onArm, fmt){
  const input = document.getElementById(id);
  if (!input) return;
  const slider = _makeSlider(input);
  slider.min = 0; slider.max = ticks.length - 1; slider.step = 1;
  const rec = { input, slider, lo: ticks[0], hi: ticks[ticks.length-1], ticks, fmt };
  slider.value = _nearestTickIndex(ticks, _clampNum(input.value, rec.lo, rec.hi));
  _bindSliderEvents(rec, onSlide, onArm);
  _boundSliders.push(rec);
}
// 別オブジェクト選択時やシーン切替時にスライダー位置を数値ボックスへ再同期
function syncSliders(){ for (const s of _boundSliders) _syncOne(s); }
function syncSliderById(id){
  const rec = _boundSliders.find(x => x.input.id === id);
  if (rec) _syncOne(rec);
}
// スライダーの可動範囲を後から変える（焦点距離は素子種で符号が決まるため。焦点は線形のまま）
//   step を渡すと刻みも差し替える（電場[V/m]と磁場[T]のように桁の違う量を1つの欄で扱うとき）
function setSliderRange(id, lo, hi, step){
  const s = _boundSliders.find(x => x.input.id === id);
  if (!s || s.ticks) return;   // 有効数字スライダーは動的レンジ変更を使わない
  s.lo = lo; s.hi = hi; s.nch = null;   // 数値ボックスの幅も作り直す
  s.slider.min = lo; s.slider.max = hi;
  if (step !== undefined) { s.slider.step = step; s.dec = _decOf(step); }
}
// 目盛りを後から差し替える（焦点距離は素子種で下限も符号も変わるため）
function setSliderTicks(id, ticks){
  const s = _boundSliders.find(x => x.input.id === id);
  if (!s || !s.ticks || !ticks.length) return;
  s.ticks = ticks;
  s.lo = ticks[0]; s.hi = ticks[ticks.length - 1]; s.nch = null;
  s.slider.min = 0; s.slider.max = ticks.length - 1; s.slider.step = 1;
  _syncOne(s);
}
const FOCAL_MAX_M = 50;   // 焦点距離スライダーの上限 [m]（これより大きい値は数値欄で入力できる）
// 焦点距離の目盛り。負側（凹レンズ）は正側を作ってから符号を付けて反転する
function focalTicks(lo, hi){
  if (hi <= 0) return sigFigTicks(-hi, -lo).map(v => -v).reverse();
  return sigFigTicks(lo, hi);
}
// 数値ボックスとスライダーをまとめて無効化する（「回転しない」時の角速度欄など）
function setSliderDisabled(id, on, msg){
  const s = _boundSliders.find(x => x.input.id === id);
  if (!s) return;
  s.input.disabled  = on;  s.slider.disabled = on;
  s.input.style.opacity  = on ? 0.45 : '';
  s.slider.style.opacity = on ? 0.45 : '';
  // 無効な間だけ理由を出し、戻すときは元の説明を復元する。
  // ★空文字で戻すと、HTML に書いた title（欄そのものの説明）が一度無効化しただけで消えてしまう。
  if (s.title0 === undefined) s.title0 = s.input.title;
  s.input.title = on ? (msg || '「回転しない」がONのため変更できません') : s.title0;
}
// 既存の <input type=range>（ポップアップのツール既定値スライダー）を有効数字2桁方式へ変換
function attachSigFig(slider, lo, hi, opts, onValue){
  const ticks = _sigFigTicksFor(lo, hi, opts);
  slider.min = 0; slider.max = ticks.length - 1; slider.step = 1;
  slider.setSig = v => { slider.value = _nearestTickIndex(ticks, v); };
  slider.addEventListener('input', () => onValue(ticks[_clampInt(slider.value, 0, ticks.length-1)]));
  return ticks;
}
// ════════════════════════════════════════
//  値の入力欄はクリックした時点で中身を全選択する
//   この app の数値欄は「今の値を読んで、別の値に打ち替える」使い方がほとんどで、
//   途中にカーソルを置いて1文字だけ直すことはまずない。クリックのたびに
//   Ctrl+A や3回クリックを強いると、授業中の値の入れ替えがそのぶん遅くなる。
//   ・document への委譲にしてあるので、あとから動的に作られる欄（電磁場の設定、
//     色のHEX欄など）も自動で対象になる。個々の欄に手を入れる必要はない。
//   ・mousedown → focus → 「ブラウザがクリック位置へカーソルを置く」→ mouseup の順なので、
//     focus 時の select() だけでは選択が解ける。離した時にもう一度かけ直す。
//   ・ドラッグで一部だけ選び直したときは、その選択を尊重する（全選択で潰さない）。
//     ただし type=number の欄は selectionStart を読むと例外を投げるブラウザがあるので触らない。
// ════════════════════════════════════════
function _isValueField(el){
  return !!el && el.tagName === 'INPUT' && !el.disabled &&
         (el.type === 'number' || el.type === 'text');
}
function initValueSelectAll(){
  let armed = null;              // フォーカスを取った直後の1クリックだけ全選択に回す
  document.addEventListener('focusin', e => {
    armed = _isValueField(e.target) ? e.target : null;
    if (armed) armed.select();   // Tab で入ったときもここで全選択になる
  });
  document.addEventListener('mouseup', e => {
    const el = armed; armed = null;
    if (!el || e.target !== el) return;
    let dragged = false;
    try { dragged = el.selectionStart !== el.selectionEnd; } catch (_) {}
    if (!dragged) el.select();
  });
  // すでにフォーカスがある欄の中を再クリックしたときは、カーソル移動（部分修正）を通す
  document.addEventListener('focusout', () => armed = null);
}
// ════════════════════════════════════════
//  スライダーのホバー拡大バー
//   ドラッグは「相対移動」。絶対位置方式だと、バーが現れた瞬間に
//   カーソル下の値へ飛んでしまい事故になるため、押した点からの
//   移動量だけで値を動かす。どこを押しても値は変わらない。
// ════════════════════════════════════════
const SZ_W_MAX = 300, SZ_DELAY = 150, SZ_THUMB = 14;
const SZ_GAP = 8, SZ_LEFT_MIN = 60;   // ★右パネル左端との隙間／左ツールバー(52px)に被らせない下限
let szRec = null, szEl = null, szDrag = null, szTimer = null, szHideT = null;
function szKeep(){ clearTimeout(szHideT); szHideT = null; }
function szLater(){                                   // 行↔バー間の移動で消えないよう猶予を置く
  clearTimeout(szHideT);
  szHideT = setTimeout(() => { if (!szDrag) szHide(); }, 250);
}
function szHide(){
  clearTimeout(szTimer); szTimer = null;
  clearTimeout(szHideT); szHideT = null;
  if (szEl) szEl.style.display = 'none';
  szRec = null;
}
function szEndDrag(e){
  if (!szDrag) return;
  const tr = szEl.querySelector('.sz-track');
  try { if (e && e.pointerId !== undefined) tr.releasePointerCapture(e.pointerId); } catch (_) {}
  tr.removeEventListener('pointermove', szMove);
  tr.removeEventListener('pointerup', szUp);
  tr.removeEventListener('pointercancel', szUp);
  tr.removeEventListener('lostpointercapture', szUp);
  window.removeEventListener('pointerup', szUp);
  szDrag = null;
  _sliderDragging = false;
}
function _szBuild(){
  if (szEl) return szEl;
  const d = document.createElement('div');
  d.id = 'slider-zoom';
  d.innerHTML = '<div class="sz-head"><span class="sz-name"></span><span class="sz-val"></span></div>' +
                '<div class="sz-track"><div class="sz-fill"></div><div class="sz-thumb"></div></div>';
  document.body.appendChild(d);
  d.addEventListener('pointerenter', szKeep);
  d.addEventListener('pointerleave', szLater);
  d.querySelector('.sz-track').addEventListener('pointerdown', szDown);
  d.addEventListener('wheel', e => {
    if (!szRec) return;
    e.preventDefault();
    szStep(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { szEndDrag(); szHide(); } });
  window.addEventListener('blur', () => { szEndDrag(); szHide(); });
  window.addEventListener('pointermove', e => {
    if (!szRec || szDrag) return;
    if (e.target === szRec.slider || d.contains(e.target)) return;
    szLater();
  }, true);
  szEl = d;
  return d;
}
function szShow(rec){
  szTimer = null;
  if (szDrag) return;
  if (rec.slider.disabled || !rec.slider.isConnected || !rec.slider.offsetParent) { szHide(); return; }
  if (typeof gifRec !== 'undefined' && gifRec.active) { szHide(); return; }
  const el = _szBuild();
  szRec = rec;
  szKeep();
  const panel = document.getElementById('rightpanel');
  const pl = panel ? panel.getBoundingClientRect().left : window.innerWidth - 300;
  const r  = rec.slider.getBoundingClientRect();
  const avail = pl - SZ_GAP - SZ_LEFT_MIN;                      // ツールバー右端〜右パネル左端の空き
  const w  = Math.max(160, Math.min(SZ_W_MAX, avail));          // 入りきらなければ縮める
  el.style.width = w + 'px';
  el.style.display = 'block';
  const nm = rec.input.closest('.prop-row');
  const lb = nm ? nm.querySelector('.prop-label') : null;
  el.querySelector('.sz-name').textContent = lb ? lb.textContent : '';
  const h = el.offsetHeight;
  const top = r.top + r.height / 2 - h / 2;                     // ★行と同じ高さに横並び
  el.style.left = Math.max(SZ_LEFT_MIN, pl - SZ_GAP - w) + 'px';   // ★右パネルの左外側へ退避（重ならない）
  el.style.top  = Math.max(6, Math.min(top, window.innerHeight - h - 6)) + 'px';
  szPaint();
}
function szPaint(){
  if (!szRec || !szEl) return;
  const s = szRec.slider;
  const lo = parseFloat(s.min), hi = parseFloat(s.max);
  const f = hi > lo ? (parseFloat(s.value) - lo) / (hi - lo) : 0;
  const tr = szEl.querySelector('.sz-track');
  const x = SZ_THUMB/2 + f * (tr.clientWidth - SZ_THUMB);
  szEl.querySelector('.sz-thumb').style.left = x + 'px';
  szEl.querySelector('.sz-fill').style.width = x + 'px';
  const _v = szRec.input.value;                      // ★意味のある値なら言葉で出す（例：0＝不透明）
  szEl.querySelector('.sz-val').textContent = szRec.fmt ? szRec.fmt(_v) : _v;
}
function szStep(dir){
  const s = szRec.slider;
  const st = parseFloat(s.step) || 1;
  const lo = parseFloat(s.min), hi = parseFloat(s.max);
  const cur = parseFloat(s.value) || 0;
  const v = Math.min(hi, Math.max(lo, cur + dir * st));
  if (v === cur) return;
  s.value = v;
  _wheelArm = _wheelBurstArm();
  szRec.apply();
  _wheelArm = false;
}
function szDown(e){
  if (!szRec || e.button !== 0) return;
  e.preventDefault();
  const tr = szEl.querySelector('.sz-track');
  const s  = szRec.slider;
  const lo = parseFloat(s.min), hi = parseFloat(s.max);
  tr.setPointerCapture(e.pointerId);
  szDrag = { x0: e.clientX, v0: parseFloat(s.value) || 0,
             gain: (hi - lo) / Math.max(1, tr.clientWidth - SZ_THUMB) };
  _sliderDragging = true;
  szRec.arm();
  tr.addEventListener('pointermove', szMove);
  tr.addEventListener('pointerup', szUp);
  tr.addEventListener('pointercancel', szUp);
  tr.addEventListener('lostpointercapture', szUp); 
  window.addEventListener('pointerup', szUp); 
}
function szMove(e){
  if (!szDrag || !szRec) return;
  const s = szRec.slider;
  const lo = parseFloat(s.min), hi = parseFloat(s.max), st = parseFloat(s.step) || 1;
  let v = szDrag.v0 + (e.clientX - szDrag.x0) * szDrag.gain;
  v = Math.min(hi, Math.max(lo, Math.round((v - lo) / st) * st + lo));
  if (v === parseFloat(s.value)) return;
  s.value = v;
  szRec.apply();
}
function szUp(e){
  if (!szDrag) return;                          // ★pointerup と lostpointercapture の二重発火を無視
  szEndDrag(e);
  if (!szEl.matches(':hover')) szLater();       // 離した先がバーの外なら畳む
}
// ── 右パネルとリモコンで共有する目盛り ────────────────────────────
//   ★可動域は「教材として触って意味のある幅」で決めてある（根拠は下の initSliders の
//     各行のコメント）。リモコンのスライダーが別表を持つと、同じ量に2通りの可動域が
//     できて必ず食い違うので、ここ1つから両方が読む。
//   ★UI の単位（label の [] の中）と内部の値が違う量には toUI/fromUI を持たせる。
//     持たない量は素通し。書き込みは必ず applyBodyProp を通す（panel-world.js の★）。
//   ★step は右パネルの線形つまみの刻み。有効数字方式（sig）の量は右パネル側だけが
//     その方式を使い、リモコンは同じ可動域を 200 等分した線形にする（窓が 150px しか
//     なく、桁をまたぐ目盛りを刻んでも読めないため）。可動域＝意味のある幅は共有される。
const PROP_SLIDERS = {
  mass:           { label:'質量 [kg]',        lo:0.1, hi:200, sig:true },
  density:        { label:'密度 [kg/m³]',     lo:10,  hi:20000, sig:true },   // 発泡20〜金19300を包含
  vx:             { label:'速度X [m/s]',      lo:-30, hi:30,  step:0.1, detent:true },   // ★0 に吸着（zeroDetentTicks）
  vy:             { label:'速度Y [m/s]',      lo:-30, hi:30,  step:0.1, detent:true },
  av:             { label:'角速度 [rad/s]',   lo:-30, hi:30,  step:0.1 },
  restitution:    { label:'反発係数',          lo:0,   hi:1,   step:0.05 },
  friction:       { label:'動摩擦係数 μk',     lo:0,   hi:2,   step:0.05 },
  frictionStatic: { label:'静止摩擦係数 μs',   lo:0,   hi:2,   step:0.05 },
  drag:           { label:'抗力係数 Cd',       lo:0,   hi:2.5, step:0.05 },
  emissivity:     { label:'放射率 ε',          lo:0,   hi:1,   step:0.05 },
  // ★欄は℃、b.temp は K。変換はここに1組だけ置く（onchange もつまみもこれを通る）
  temp:           { label:'温度 [℃]',         lo:-100, hi:500, step:1,
                    toUI: K2C, fromUI: C2K },
  charge:         { label:'電荷 [C]',          lo:-10, hi:10,  step:0.1, detent:true },
  abbe:           { label:'アッベ数 V',        lo:1,   hi:100, step:1 },
  // ★動力 [N] はこの表に入れない。動力は物体のプロパティではなく、1つの物体に
  //   何本でも付く「要素」なので、つまみは remoteKnobs の 'thruster' が持つ。
  // ★向きだけは内部と符号が逆（内部の角は y が下向き正）。見せる角は反時計回りが正で、
  //   変換は _dispDeg 1つに寄せる（右パネルの p-angle と同じ決まり）。書き込みは
  //   applyBodyProp が「°で受ける」ので fromUI は要らない。
};
// ★「角度」はこの表に入れない＝リモコンのつまみからは選べない。書き込み口（applyBodyProp）
//   は角度も受けられるようにしてあるが、板を回して上の物を動かす使い方が成り立たない
//   （箱が板の回転についてこない。demos-mechanics.js の demoTipping の★に実測がある）。
//   鏡の向きのように「何も載せていない物」を回すぶんには正しく効くので、要るデモが
//   出てきたら 1行足すだけでよい：angle: { label:'角度 [°]', lo:-180, hi:180, step:1,
//   toUI: r => _dispDeg(r) }（_dispDeg は名前で呼ぶこと。関数そのものを入れると、
//   まだ読み込まれていない js/app/transform.js を参照して表ごと定義に失敗する）。
// 屈折率：0（不透明）の次は 1.05。0<n≤1 は挙動が 0 と同じ（laser.js の n>1 判定）なので飛ばす。
//   ★リモコンからも同じ段を使うので、initSliders の外に置く。
const IOR_TICKS = [0];
for (let k = 105; k <= 250; k += 5) IOR_TICKS.push(+(k / 100).toFixed(2));
function initSliders(){
  const armProp = () => { if (selectedIds.size > 0) pushUndo(); };
  const S = (id, prop, lo, hi, opts) => bindSigFigSlider(id, lo, hi, opts, v => updateProp(prop, v, true), armProp);
  const P = (id, prop, lo, hi, step, detent) => bindSlider(id, lo, hi, step, v => updateProp(prop, v, true), armProp, detent);
  // ★上の表から可動域を引く（数字をここに書かない＝リモコンと必ず同じになる）
  const T  = (id, prop) => { const t = PROP_SLIDERS[prop];
                             return t.sig ? S(id, prop, t.lo, t.hi, {}) : P(id, prop, t.lo, t.hi, t.step, t.detent); };
  T('p-mass','mass');                               // [kg] 有効数字2桁（281段）。範囲外は数値欄で入力
  // [kg/m³] 有効数字2桁（281段）。★複数選択へまとめて効かせる updateDensity を通すので T() は使わない
  bindSigFigSlider('p-density', PROP_SLIDERS.density.lo, PROP_SLIDERS.density.hi, {},
                   v => updateDensity(v, true), armProp);
  T('p-restitution','restitution');                 // 係数：線形
  T('p-friction','friction');                       // 動摩擦係数：線形
  T('p-friction-s','frictionStatic');               // ★静止摩擦係数：線形
  T('p-drag','drag');                               // 抗力係数 Cd：線形
  // ── 熱 ──
  //   温度は線形（実用域は氷点下〜数百℃の1〜2桁で、有効数字方式にする理由がない）。
  //   数値欄は絶対零度まで打てるが、つまみは教材で使う −100〜500℃ に絞る。
  //   ★欄の単位は℃、b.temp は K なので、つまみからも C2K を通すこと（onchange と同じ）。
  bindSlider('p-temp', PROP_SLIDERS.temp.lo, PROP_SLIDERS.temp.hi, PROP_SLIDERS.temp.step,
               v => updateProp('temp', C2K(v), true), armProp);
  // 比熱と熱伝導率は桁をまたぐので有効数字方式。0＝完全な断熱材なので必ず 0 を含める
  //   （比熱：スポンジ1500・水4182、熱伝導率：スポンジ0.04・水0.6・鉄50・ダイヤ1000）。
  S('p-heatcap','heatCap', 10, 10000, {zero:true});
  S('p-conduct','conduct', 0.01, 1000, {zero:true});
  // 放射率は 0〜1 の比なので線形。0（放射しない）が既定で、1 が完全な黒体
  T('p-emissivity','emissivity');
  // 屈折率の段は上の IOR_TICKS（リモコンと共有するので initSliders の外に置いてある）
  bindTickSlider('p-ior', IOR_TICKS, v => updateProp('ior', v, true), armProp,
                 v => (parseFloat(v) > 1 ? v : '不透明'));   // 1段目は数値より意味を出す
  T('p-abbe','abbe');                               // アッベ数：線形。右へ行くほど分散が小さい（V_d=0 は作れない）
  bindSlider('p-charge', PROP_SLIDERS.charge.lo, PROP_SLIDERS.charge.hi, PROP_SLIDERS.charge.step,
               v => updateCharge(v, true), armProp, PROP_SLIDERS.charge.detent);   // 電荷 q[C]：線形（正負対称）・0 に吸着
  // 力ベクトルの長さ[px/N]（全体設定）。★上部メニュー側のつまみと同じ 0.001〜20000 を覆う。
  //   0.1〜100 の線形にしていた頃は、万有引力の題材（数千 px/N）でつまみが右端に張り付いて
  //   数値欄と食い違って見えた。桁をまたぐ量なので有効数字2桁の目盛りにする。
  //   ★下限は 0.001（panel-world.js の FVIZ_LOG_MIN の★）。
  bindSigFigSlider('p-fviz', FVIZ_SCALE_MIN, 20000, {}, v => worldForceScale(v));
  bindSlider('p-vviz', 1, 50, 1,     v => worldVelScale(v));     // 速度ベクトルの長さ[px/(m/s)]（全体設定）
  P('p-sw','strokeWidth', 0, 20, 1);                // 枠幅[px]：整数
  bindSlider('p-angle', -180, 180, 1,    v => updateAngle(v, true),      armProp);   // 物体の向き[°]：線形
  bindSlider('p-speed', 0, 30, 0.1,      v => updateSpeed(v, true),      armProp);   // 速さ[m/s]：向きを保つ
  bindSlider('p-vdir', -180, 180, 1,     v => updateVelDir(v, true),     armProp);   // 運動の向き[°]：速さを保つ
  bindSlider('p-guideangle', -180, 180, 1, v => updateGuideAngle(v, true), armProp); // ガイドの向き[°]：線形
  T('p-vx','vx');                                   // [m/s]：線形（実用域は1.5桁。有効数字方式にする理由がない）
  T('p-vy','vy');                                   // [m/s]：線形
  T('p-av','av');                                   // [rad/s]：線形
  bindTickSlider('p-focal', focalTicks(0.1, FOCAL_MAX_M), v => updateOpticFocal(v, true), armProp);
  // 焦点距離[m]：有効数字2桁。下限と符号は素子を選んだ時に updatePropsPanel が差し替える
  bindSlider('p-refl', 0, 100, 1, v => updateReflectance(v, true), armProp);  // 反射率[%]：線形
  // ── 回折格子のスリット ──
  //   ★どれも線形。実用域が1桁に収まっていて（N は 1〜20 本、d と a は λ=0.13 m の
  //     数分の1〜10倍）、有効数字方式にすると刻みが粗くなるだけで得がない。
  bindSlider('p-slitn', 1, SLIT_N_MAX, 1, v => updateSlit('slitN', v, true), armProp);   // 本数：整数
  // スリット間隔 d[m]：下端は「1次が存在しない領域」も見せられるよう λ より下から始める
  bindSlider('p-slitd', 0.02, 1.5, 0.01, v => updateSlit('slitD', v, true), armProp);
  // スリット幅 a[m]：上端は a ≤ d なので、選んだ格子に合わせて可動域を差し替える
  bindSlider('p-slita', SLIT_A_MIN_M, 1.5, 0.005, v => updateSlit('slitA', v, true), armProp);
  // 開口の分割数 M：0＝自動。1段目は数値より意味を出す（屈折率の「不透明」と同じ流儀）
  bindTickSlider('p-slitm', [0,1,2,3,4,6,8,12,16], v => updateSlit('slitM', v, true), armProp,
                 v => (parseFloat(v) > 0 ? v + ' 個の波源' : '自動'));
  // ── 歯車（歯車ツールで置いた円形歯車だけ）──
  //   ★どちらも線形。歯数は整数で GEAR_MIN_Z〜GEAR_MAX_Z、歯の大きさは歯車ツール設定の窓
  //     （tool-menus.js の sh-gm）と同じ 2〜30 cm・1 cm 刻み。
  //   ★変えるたびに updateGearParam が相手へ吸い付き直し、食い込むなら取り消す（つまみも戻る）。
  //   ★そのため undo は掴んだ時点では積まず、状態だけ控えて「最初に変更が残った時」に積む。
  //     掴んですぐ積むと、全部取り消されたドラッグでも空の1段が残る。
  //   ★食い込みの案内も同じ drag に「出した」印を付け、ドラッグ1回につき1度だけにする。
  //     矢印キーの連打・ホイールは arm が連打の頭にしか来ない（state.js の _keyBurstArm /
  //     _wheelBurstArm）ので、連打全体が1つの drag になる。
  let gearDrag = { snap: null, hinted: false };
  const armGear = () => { gearDrag = { snap: snapshotState(), hinted: false }; };
  const slideGear = key => v => {
    if (updateGearParam(key, v, gearDrag) && gearDrag.snap) { pushUndo(gearDrag.snap); gearDrag.snap = null; }
  };
  bindSlider('p-gear-z', GEAR_MIN_Z, GEAR_MAX_Z, 1, slideGear('z'), armGear);
  bindSlider('p-gear-m', 2, 30, 1, slideGear('m'), armGear);
  // ── スリンキー ──
  //   ばね定数だけ有効数字方式。実用域が 0.5〜2000 N/m と4桁あり、線形では低い側が刻めない。
  //   ほかは実用域が1〜2桁に収まっているので線形でよい。
  const armSlk = () => { if (selectedElement && selectedElement.kind === 'slinky') pushUndo(); };
  const SL = (id, prop, lo, hi, step) =>
    bindSlider(id, lo, hi, step, v => updateSlinkyProp(prop, v, true), armSlk);
  // ★左端の 0 は外した。ばね定数 0 ＝ ダンパーという「物理の世界に無い基本部品」を
  //   つまみ1つで出せてしまうため。制動器は通気にしたピストン容器で組む（slinky.js の★）。
  bindSigFigSlider('slk-ea', 0.5, 2000, {}, v => updateSlinkyProp('springK', v, true), armSlk);
  // 減衰係数 c [N·s/m]：ばね定数と同じ理由で有効数字方式（波消しの 0.4 級から
  //   固まるほど重い数百まで使う）。0＝減衰なしを左端に含める。
  bindSigFigSlider('slk-dampc', 0.01, 500, { zero: true },
                   v => updateSlinkyProp('dampC', v, true), armSlk);
  SL('slk-mu',     'linDensity',  0.01, 3,   0.01);   // 線密度[kg/m]：線形（ロープの j-linden と同じ）
  SL('slk-rest',   'restM',       0.05, 20,  0.05);   // 自然長[m]：線形（形状に紐づく絶対量）
  SL('slk-damp',   'damp',        0,    20,  0.1);    // 内部減衰[1/s]：線形
  SL('slk-nd',     'nodeDensity', 2,    100, 1);      // 節点密度[個/m]：整数
  SL('slk-bend',   'bendRatio',   0,    5,   0.05);   // 曲げにくさβ：線形（無次元）
  SL('slk-radius', 'radius',      1,    30,  1);      // 太さ[px]：整数
  // レールの向き[°]：物体の p-guideangle と同じ −180〜180 の線形
  bindSlider('slk-guideangle', -180, 180, 1, v => updateSlinkyGuideAngle(v, true), armSlk);
  // ── 粒子（液体・気体分子）──
  //   温度は物体（p-temp）と同じ −100〜500℃ の線形。欄は℃、p.T は K なので C2K は
  //   updateParticleTemp の中で通る（数値欄の onchange と同じ関数）。
  //   ★気体は選択によらず全分子に効く（updateParticleTemp の注）。つまみを動かすと
  //     分子の速さがその場で √(T'/T) 倍される＝温度を上げるほど飛び回りが速くなる。
  const armPcl = () => { if (selectedParticles().length) pushUndo(); };
  bindSlider('pcl-temp', -100, 500, 1, v => updateParticleTemp(v, true), armPcl);
  const armJoint = () => { if (selectedJointId != null) pushUndo(); };
  const SJ = (id, prop, lo, hi, opts) => bindSigFigSlider(id, lo, hi, opts, v => updateJointProp(prop, v, true), armJoint);
  const PJ = (id, prop, lo, hi, step) => bindSlider(id, lo, hi, step, v => updateJointProp(prop, v, true), armJoint);
  SJ('j-stiffness','stiffness', 1, 5000, {zero:true});   // ばね定数[N/m] 有効数字2桁（312段）
  PJ('j-damping','damping', 0, 200, 0.5);                // 減衰 c[N·s/m]：線形（操作の主役はζ側）
  bindSlider('j-zeta', 0, 2, 0.01, v => updateJointZeta(v, true), armJoint);   // 減衰比ζ：線形
  PJ('j-restlen','restLength', 0.05, 10, 0.05);          // 自然長[m]：線形（形状に紐づく絶対量）
  PJ('j-radius','radius', 0.005, 0.20, 0.005);           // ロープ半径[m]：線形（狭域）
  PJ('j-linden','linDensity', 0.01, 3, 0.01);            // 線密度[kg/m]：線形
  bindSlider('j-alo', -180, 180, 5, v => updateJointLimitDeg('lo', v, true), armJoint);   // 可動域[°]：線形
  bindSlider('j-ahi', -180, 180, 5, v => updateJointLimitDeg('hi', v, true), armJoint);
  PJ('j-friction','friction', 0, 2, 0.05);               // ★ロープ表面の摩擦：線形
  PJ('j-mspeed','motorSpeed', -50, 50, 0.5);             // 回転速度[rad/s]：線形
  SJ('j-mtorque','motorTorque', 1, 5000, {zero:true});   // 最大トルク[N·m] 有効数字2桁（312段）
  const W  = (id, fn, lo, hi, step, detent) => bindSlider(id, lo, hi, step, fn, null, detent);
  W('w-gx', v => worldUpdate('gravX', v), -20, 20, 0.1, true);        // [m/s²]：線形・0 に吸着（無重力）
  W('w-gy', v => worldUpdate('gravY', yUI(v)), -20, 20, 0.1, true);   // [m/s²]：線形・上向き正・0 に吸着
  W('w-gravstr', v => worldUpdate('gravStrength', v), 0, 50000, 500); // 万有引力の強さ：線形（物理量ではなく調整つまみ）
  // ソフトニング長 ε：UI は m、内部は px。0.01〜0.50 m（1〜50px）を線形で
  W('w-gravsoften', v => worldUpdate('gravSoften', v * M2PX), 0.01, 0.5, 0.01);
  W('w-airdensity', v => worldUpdate('airDensity', v), 0, 10, 0.1);   // [kg/m³]：線形
  // ── 熱 ──
  //   伝わる速さは 1〜10⁶ の6桁を動かすので有効数字方式。0＝熱が動かない。
  bindSigFigSlider('w-thermalrate', 1, 1000000, {zero:true}, v => worldUpdate('thermalRate', v));
  // ★まわりの温度：欄は℃、world.ambientTemp は K（p-temp と同じ流儀）
  bindSlider('w-ambienttemp', -100, 500, 1, v => updateAmbientTemp(v));
  W('w-thermalvizmin', v => worldUpdate('thermalVizMin', v), -100, 500, 5);   // 色の下端[℃]：線形
  W('w-thermalvizmax', v => worldUpdate('thermalVizMax', v), -100, 500, 5);   // 色の上端[℃]：線形
  W('w-iters', v => worldUpdate('iterations', v), 1, 20, 1);          // 整数
  W('w-substeps', v => worldUpdate('substeps', v), 1, 10, 1);         // 整数
  W('w-bgfriction-s', v => updateBgFriction('bgFrictionStatic', v), 0, 2, 0.05);   // 面の静止摩擦係数：線形
  W('w-bgfriction',   v => updateBgFriction('bgFriction', v),       0, 2, 0.05);   // 面の動摩擦係数：線形
  W('w-bggravperp',   v => worldUpdate('bgGravPerp', v),            0, 20, 0.1);   // 面に垂直な重力 g⊥[m/s²]：線形
  W('w-freezedist', v => setFreezeDistance(v), 0, 2000, 10);          // 遠方の凍結距離[m]（0=無効）：線形
  W('w-ground-y', v => setGroundY(v), -12, 2, 0.1);                   // [m]：線形（位置・上向き正）
  // 地面の反発・摩擦。プロパティ（地面を選択中）と全体設定タブの両方に同じ欄がある。
  //   ★id は分けること。同じ id を2つ置くと getElementById が片方しか返さず、
  //     「片方で変えたのにもう片方が古いまま」が必ず起きる。
  bindSlider('g-restitution',        0, 1, 0.05, v => updateGroundProp('restitution',    v));
  bindSlider('g-friction',           0, 2, 0.05, v => updateGroundProp('friction',       v));
  bindSlider('g-friction-s',         0, 2, 0.05, v => updateGroundProp('frictionStatic', v));
  W('w-ground-rest',       v => updateGroundProp('restitution',    v), 0, 1, 0.05);
  W('w-ground-friction-s', v => updateGroundProp('frictionStatic', v), 0, 2, 0.05);
  W('w-ground-friction',   v => updateGroundProp('friction',       v), 0, 2, 0.05);
  const armThruster = () => { if (selectedElement && selectedElement.kind === 'thruster') pushUndo(); };
  bindSigFigSlider('thruster-force', 1, 5000, {zero:true}, v => updateThrusterForce(v, true), armThruster);  // [N] 有効数字2桁（312段）
  const armLaser = () => { if (selectedElement && selectedElement.kind === 'laser') pushUndo(); };
  bindSlider('laser-wl', 380, 780, 1, v => updateLaserWavelength(v, true), armLaser);   // [nm]：線形（固定域）
  bindSlider('laser-angle', -180, 180, 1, v => updateLaserAngle(v, true), armLaser);    // [°]：向き
  // ビーム幅[m]：線形。0（太さのない1本）から、物体をまたぐ 5 m まで。それ以上は数値欄で入力
  bindSlider('laser-width', 0, 5, 0.05, v => updateLaserWidth(v, true), armLaser);
  // 本数[本]：整数。上限はトレースの上限そのもの（これ以上は増やしても切り捨てられる）
  bindSlider('laser-count', 1, LASER_MAX_RAYS, 1, v => updateLaserRayNum(v, true), armLaser);
  const armTracer = () => { if (selectedElement && selectedElement.kind === 'tracer') pushUndo(); };
  bindSlider('tracer-duration', 0.5, 60, 0.5, v => updateTracerDuration(v, true), armTracer);   // [s]：線形
  const armWave = () => { if (selectedElement && selectedElement.kind === 'wave') pushUndo(); };
  bindSlider('ws-freq',   0.05, 5, 0.05, v => updateWaveSourceProp('freq', v, true), armWave);    // [Hz]：線形
  bindSlider('ws-lambda', 0.02, 6,  0.02, v => updateWaveSourceLambda(v, true),       armWave);   // [m]：線形
  bindSlider('ws-amp',   0, 3,   0.05, v => updateWaveSourceProp('amp', v, true), armWave);
  bindSlider('ws-phase', -180, 180, 5, v => updateWaveSourcePhase(v),             armWave, true);   // 0 に吸着（同位相）
  // ── 回路素子 ──（桁をまたぐ量は有効数字2桁、それ以外は線形）
  const armCircuit = () => { if (selectedCircuit) pushUndo(); };
  const CP = (id, prop, lo, hi, step, detent) => bindSlider(id, lo, hi, step, v => updateCircuitProp(prop, v, true), armCircuit, detent);
  const CS = (id, prop, lo, hi, opts) => bindSigFigSlider(id, lo, hi, opts, v => updateCircuitProp(prop, v, true), armCircuit);
  const KR = CIRCUIT_KNOB_RANGE;             // ★可動域はリモコンの窓と共有（circuit.js）
  CS('c-R', 'R', KR.R.lo, KR.R.hi, {});     // 抵抗[Ω]：0.1〜100k
  CP('c-V', 'V', KR.V.lo, KR.V.hi, KR.V.step, KR.V.detent);   // 起電力[V]：負で向きが逆・0 に吸着
  CP('c-freq', 'freq', 0.1, 20, 0.1);       // 交流の振動数[Hz]
  CP('c-phase', 'phaseDeg', -180, 180, 5);  // 交流の初期位相[°]：波源の位相欄と同じ範囲
  CP('c-r', 'r', 0, 10, 0.1);              // 内部抵抗[Ω]
  CS('c-C', 'C', KR.C.lo, KR.C.hi, {});     // 容量[F]：1µF〜0.1F
  CS('c-L', 'L', KR.L.lo, KR.L.hi, {});     // 自己インダクタンス[H]
  CP('c-ar', 'r', 0, 10, 0.1);              // 電流計の内部抵抗[Ω]：既定0＝理想
  CS('c-Rv', 'R', 1, 1e7, {});              // 電圧計の内部抵抗[Ω]：1Ω〜10MΩ（既定＝上限＝実質∞）
  // クーロン定数：実用域（0〜5）だけを線形で刻む。これより大きい値は数値欄で入力する
  bindSlider('w-coulombk', 0, 5, 0.1, v => emWorldUpdate('coulombK', v));
  bindSlider('w-wallw',    1, 400, 1,      v => worldUpdate('wallW', v));      // 壁の幅[m]
  bindSlider('w-wallh',    1, 400, 1,      v => worldUpdate('wallH', v));      // 壁の高さ[m]
  bindSlider('w-wallrest', 0, 1, 0.05,     v => worldUpdate('wallRest', v));   // 壁の反発係数
  bindSlider('w-wavespeed',   0.1, 8, 0.1,             v => setWaveSpeed(v));                 // [m/s]
  bindSlider('w-waveabsorb',  WAVE_ABS_MIN, 0.2, 0.01, v => setWaveAbsorb(v));                // [1/m]
  bindSlider('w-wavethr',     1, 60, 1,                v => setWaveCrestWidth(v));            // [%]
  bindSlider('w-wavegain',    0.5, 40, 0.5,            v => worldUpdate('waveViewGain', v));
  bindSlider('wf-wavespeed',  0.1, 8, 0.1,             v => setWaveSpeed(v));                 // プロパティ側（共通）
  bindSlider('wf-waveabsorb', WAVE_ABS_MIN, 0.2, 0.01, v => setWaveAbsorb(v));
  bindSlider('wf-wavethr',    1, 60, 1,                v => setWaveCrestWidth(v));
  bindSlider('wf-wavegain',   0.5, 40, 0.5,            v => worldUpdate('waveViewGain', v));
  bindSlider('p-waveior',     0.5, 3, 0.05,            v => updateProp('waveIor', v, true),   // 波屈折率 n
             () => { if (selectedIds.size > 0) pushUndo(); });
  // ── 電場・磁場の領域 ──
  //   強さは E[V/m] と B[T] で桁が違うので、範囲と刻みは updateEMFieldPanel が差し替える
  const armEMField = () => { if (selectedElement && selectedElement.kind === 'emfield') pushUndo(); };
  bindSlider('emf-p-strength', 0, EMFIELD_STRENGTH_RANGE.E.hi, EMFIELD_STRENGTH_RANGE.E.step,
             v => updateEMFieldProp('strength', v, true), armEMField);
  bindSlider('emf-p-angle', -180, 180, 1, v => updateEMFieldAngle(v, true), armEMField);   // 電場の向き[°]
  bindSlider('emf-p-freq', 0, EMFIELD_FREQ_MAX, EMFIELD_FREQ_STEP,
             v => updateEMFieldProp('freq', v, true), armEMField);                       // 電場の振動数[Hz]
  // ── 加熱・冷却の領域 ──（出力[W]。符号つき：正＝加熱・負＝冷却。0 に吸着する目盛り）
  bindTickSlider('hf-p-power', heatPowerTicks(10),
             v => updateHeatFieldProp('power', v, true),
             () => { if (selectedElement && selectedElement.kind === 'heatfield') pushUndo(); });
  // ── 流れの場 ──（流速[m/s]と向き[°]は線形。密度は空気1.2〜水1000と桁をまたぐので有効数字方式）
  const armFlow = () => { if (selectedElement && selectedElement.kind === 'flowfield') pushUndo(); };
  bindSlider('ff-p-speed', 0, FLOWFIELD_SPEED_MAX, 0.5, v => updateFlowFieldProp('speed', v, true), armFlow);
  bindSlider('ff-p-angle', -180, 180, 1, v => updateFlowFieldAngle(v, true), armFlow);
  bindSigFigSlider('ff-p-density', 0.1, 2000, { zero: true },
                   v => updateFlowFieldProp('density', v, true), armFlow);
  // ── 気体の状態 ──
  //   ★つまみを付けるのは「打ち替えられる欄」だけ。P・V・n・C_V・C_P・γ は他の量から
  //     導出される読み取り専用の値なので付けない（動かせないつまみは出さない）。
  //     γ は自由度 f のつまみを動かせば追従する（γ = 1 + 2/f）。
  const armGas = () => { if (selectedGasChamber()) pushUndo(); };
  //   温度[℃]：物体の p-temp と同じ範囲・同じ刻みに揃える（同じ量なので操作感を変えない）。
  //   ★欄の単位は℃、ch.T は K なので、つまみからも C2K を通すこと（onchange と同じ）。
  bindSlider('p-gas-tnow', -100, 500, 1, v => uiGasProp('T', C2K(v)), armGas);
  //   自由度 f：整数。3=単原子(γ≈1.67)／5=二原子(γ=1.4)／6=多原子。HTML の min/max と揃える
  bindSlider('p-gas-dof', 3, 7, 1, v => uiGasProp('dof', v), armGas);
  // ── 注釈（テキスト・お絵描き）──
  //   どちらも線形。大きさの実用域は 0.05〜2 m の1.5桁で、有効数字方式にする理由がない。
  const armAnnot = () => { if (selectedAnnotation) pushUndo(); };
  bindSlider('annot-size',  0.05, 2, 0.05, v => updateAnnotProp('size',  v, true), armAnnot);  // 文字の大きさ[m]
  bindSlider('annot-angle', -180, 180, 1,  v => updateAnnotProp('angle', v, true), armAnnot);  // 向き[°]
  bindSlider('annot-width', 0.005, 0.3, 0.005, v => updateAnnotProp('width', v, true), armAnnot);  // 線の太さ[m]
  const _rb = document.getElementById('rpanel-content');   // スクロールで座標がずれるので畳む
  if (_rb) _rb.addEventListener('scroll', () => { if (!szDrag) szHide(); });
}
// 全体設定タブの波動場まわりを現在の値へ同期する
