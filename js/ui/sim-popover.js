// ════════════════════════════════════════
//  シミュレーションメニューの設定ウィンドウ
// ════════════════════════════════════════
//  右パネル「ワールド」タブと同じ設定を、上部メニューからも触れるようにしたもの。
//
//  ★右パネルの入力欄を動かしたり、メニューへ引っ越させたりはしない。
//    ここで作る欄は world / ground を直接書き換え、書いたあとに syncWorldPanel() で
//    右パネルを world から作り直す。これで
//      ・id を重複させない（同じ id が2つあると getElementById が片方しか返さず、
//        「メニューで変えたのに右パネルが古いまま」が必ず起きる）
//      ・右パネルはいつでもそのまま見えている
//    の両方が成り立つ。値を書き込む関数は右パネルとまったく同じものを通すので、
//    物理の側から見ればどちらから変えても区別がつかない。
//
//  ★開いたら、外側を押すか Esc を押すまで閉じない。
//    CSS の :hover で開く下位メニュー（.ctx-submenu）は、数値欄やスライダーを
//    狙ってカーソルが経路を外れた瞬間に閉じてしまい、設定ウィンドウには使えない。
// ════════════════════════════════════════
let _simPop = null;          // 開いているウィンドウ（同時に1つだけ）
let _simPopKey = null;       // どのメニュー項目のものか
let _simPopAnchor = null;    // そのメニュー項目の要素
let _simPopRows = [];        // 中の各行を world から書き戻す関数
let _simPopTimer = null;     // カーソルを合わせてから開くまでの猶予
let _spUid = 0;
const SIM_POP_DELAY = 180;   // [ms] メニューを上下になぞっただけでは開かないための猶予

// ウィンドウの外側を押したときに「外」と見なさない相手。
// カラーピッカー・用語の吹き出し・スライダーの拡大バーはウィンドウの外に出るので、
// これらを押しただけでウィンドウが閉じてしまわないようにする。
function _simPopIgnores(t) {
  for (const id of ['sim-popover', 'color-popup', 'help-popup', 'slider-zoom']) {
    const el = document.getElementById(id);
    if (el && el.contains(t)) return true;
  }
  return false;
}
function closeSimPopover() {
  clearTimeout(_simPopTimer); _simPopTimer = null;
  if (colorPopup && colorPopup._key === 'ground') closeColorPicker();   // 地面色のピッカーも一緒に畳む
  if (_simPopAnchor) _simPopAnchor.classList.remove('sp-open');
  if (_simPop) _simPop.remove();
  _simPop = null; _simPopKey = null; _simPopAnchor = null; _simPopRows = [];
}
// カーソルを合わせて開く。すでに同じものが開いていれば何もしない
// （別の項目へ移ったときは、猶予のあとに中身が入れ替わる）
function simPopHover(key, anchor) {
  clearTimeout(_simPopTimer);
  if (_simPopKey === key) return;
  _simPopTimer = setTimeout(() => openSimPopover(key, anchor), SIM_POP_DELAY);
}
function simPopHoverCancel() { clearTimeout(_simPopTimer); _simPopTimer = null; }
// クリックで開く／閉じる（猶予を待たずに開きたいとき、同じ項目を押して畳みたいとき）
function toggleSimPopover(key, anchor) {
  simPopHoverCancel();
  if (_simPopKey === key) { closeSimPopover(); return; }
  openSimPopover(key, anchor);
}
function openSimPopover(key, anchor) {
  const spec = SIM_POPOVERS[key];
  if (!spec) return;
  closeSimPopover();
  const pop = document.createElement('div');
  pop.id = 'sim-popover';
  const head = document.createElement('div');
  head.className = 'sp-head';
  const ttl = document.createElement('span'); ttl.className = 'sp-title'; ttl.textContent = spec.title;
  const cls = document.createElement('span'); cls.className = 'sp-close'; cls.textContent = '×';
  cls.title = '閉じる (Esc)';
  cls.onclick = closeSimPopover;
  head.appendChild(ttl); head.appendChild(cls);
  pop.appendChild(head);
  _simPopRows = [];
  spec.build(pop);
  document.body.appendChild(pop);
  _simPop = pop; _simPopKey = key; _simPopAnchor = anchor;
  if (anchor) anchor.classList.add('sp-open');
  _simPopPlace(pop, anchor);
  spRefresh();
  _simPopAttachHelp(pop);
  // 中の操作はメニューの「外側を押したら閉じる」判定へ上げない
  pop.addEventListener('mousedown', ev => ev.stopPropagation());
  pop.addEventListener('click',     ev => ev.stopPropagation());
}
// メニューの右隣に出す。右端で入りきらなければ左隣へ、下端では上へ寄せる
function _simPopPlace(pop, anchor) {
  const pad = 6, gap = 4;
  const a = anchor ? anchor.getBoundingClientRect() : { top: 60, left: 0, right: 0 };
  const box = anchor && anchor.parentElement ? anchor.parentElement.getBoundingClientRect() : a;
  const W = pop.offsetWidth, H = pop.offsetHeight;
  let left = box.right + gap;
  if (left + W > window.innerWidth - pad) left = box.left - W - gap;
  left = Math.max(pad, Math.min(left, window.innerWidth - W - pad));
  let top = a.top - 6;
  top = Math.max(pad, Math.min(top, window.innerHeight - H - pad));
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';
}
// 右パネルと同じ用語の吹き出しを、このウィンドウの見出しにも付ける
// （initPropHelp は #tab-props / #tab-world だけを見て起動時に1回走るので、届かない）
function _simPopAttachHelp(pop) {
  hideLabelUnits(pop);   // 単位は右パネルと同じく隠して、カーソルを合わせたときに出す
  for (const el of pop.querySelectorAll('.prop-label, .checkbox-row label')) {
    const h = _helpFor(el.textContent);
    if (!h) continue;
    el.classList.add('has-help');
    el.addEventListener('mouseenter', () => showHelpPopup(el, _helpWithUnit(h, el)));
    el.addEventListener('mouseleave', hideHelpPopup);
  }
}
// Esc で閉じる。ウィンドウが開いている間の Esc はここで食い止める
// （そのまま通すと keyboard.js の「選択を解除」まで一緒に走ってしまう）
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !_simPop) return;
  closeSimPopover();
  e.stopPropagation();
}, true);
window.addEventListener('resize', () => { if (_simPop) closeSimPopover(); });

// ════════════════════════════════════════
//  ウィンドウの中の行
// ════════════════════════════════════════
// 値を書いたあとに必ず通す。右パネルを world から作り直し、
// ウィンドウ自身の表示（連動して変わる欄・灰色にする欄）も更新する
function _spApply() { syncWorldPanel(); spRefresh(); }
function spRefresh() { for (const f of _simPopRows) f(); }
function _spDec(step) { const s = String(step).split('.'); return s[1] ? s[1].length : 0; }
// ★開いているウィンドウを、world / ground から作り直し続ける（全体設定タブとの常時リンク）。
//   右パネルの入力欄は worldUpdate を呼ぶだけで syncWorldPanel を通さないので、
//   「右パネルで変えた → ウィンドウが古いまま」を防ぐにはこちらから取りに行くしかない。
//   系の熱量のように物理が動かす読み取り欄も、これで同じ仕組みに乗る。
//   毎フレームではなく約10回/秒。波動場の欄は格子の見積もりを作り直すので、60回/秒は無駄が大きい。
let _simPopTickAt = 0;
function simPopTick(now) {
  if (!_simPop) return;
  const t = now || 0;
  if (t - _simPopTickAt < 100) return;
  _simPopTickAt = t;
  spRefresh();
}

// 数値欄＋スライダーの1行。右パネルの .prop-row と同じ形なので見た目もそろう
function spNum(pop, d) {
  const row = document.createElement('div'); row.className = 'prop-row';
  const lab = document.createElement('span'); lab.className = 'prop-label'; lab.textContent = d.label;
  const box = document.createElement('input');
  box.type = 'number'; box.className = 'prop-input compact';
  box.step = d.step; box.min = d.min; box.max = d.max;
  const sld = document.createElement('input');
  sld.type = 'range'; sld.className = 'prop-slider';
  sld.min = d.min; sld.max = d.max; sld.step = d.step;
  // 表示の桁は既定では刻み幅から決める。d.dec を渡せば別にできる
  //（大気圧のように「刻みは1 kPa でよいが、既定値 101.325 はそのまま見せたい」場合）
  const dec = d.dec != null ? d.dec : _spDec(d.step);
  // ★欄の幅は範囲と桁から決める。固定の 52px（.compact）では4桁しか入らず、
  //   50000（熱の伝わる速さ）・101.325（大気圧）・2000（遠方を凍結）など6欄で数字が切れていた。
  //   幅は整数部の桁（符号込み）＋小数部の桁。足りている欄は 52px のまま。
  const intLen = v => String(Math.trunc(Math.abs(v))).length + (v < 0 ? 1 : 0);
  const nch = Math.max(intLen(d.min), intLen(d.max)) + (dec > 0 ? dec + 1 : 0);
  //   ＋32px は 左右の余白12・枠2・Chrome がカーソルを乗せると出す増減ボタン15 と少しの遊び。
  box.style.flexBasis = `max(52px, calc(${nch}ch + 32px))`;
  if (d.title) { lab.title = d.title; box.title = d.title; }
  // 数値欄は範囲外の値も受け付ける（スライダーは実用域だけを刻む）
  box.addEventListener('change', () => { d.set(parseFloat(box.value) || 0); _spApply(); });
  sld.addEventListener('input',  () => { d.set(parseFloat(sld.value));      _spApply(); });
  row.appendChild(lab); row.appendChild(box); row.appendChild(sld);
  pop.appendChild(row);
  _simPopRows.push(() => {
    const v = +d.get();
    if (document.activeElement !== box) box.value = +v.toFixed(dec);
    sld.value = Math.max(d.min, Math.min(d.max, v));
    const off = !!(d.dim && d.dim());
    box.disabled = sld.disabled = off;
    row.style.opacity = off ? 0.45 : '';
  });
  return row;
}
// 読み取り専用の1行（系の熱量のように、物理が動かす値を見せるだけの欄）。
//   スライダーが要らないので、右パネルとまったく同じ幅いっぱいの欄にする
function spRead(pop, d) {
  const row = document.createElement('div'); row.className = 'prop-row';
  const lab = document.createElement('span'); lab.className = 'prop-label'; lab.textContent = d.label;
  const box = document.createElement('input');
  box.type = 'number'; box.className = 'prop-input'; box.readOnly = true;
  if (d.title) { lab.title = d.title; box.title = d.title; }
  row.appendChild(lab); row.appendChild(box);
  pop.appendChild(row);
  _simPopRows.push(() => { box.value = d.get(); });
  return row;
}
// d.dim() が true の間は押せなくする（spBtn と同じ。理由は title に書くこと）
function spCheck(pop, d) {
  const row = document.createElement('div'); row.className = 'checkbox-row';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'sp-cb-' + (++_spUid);
  const lab = document.createElement('label'); lab.htmlFor = cb.id; lab.textContent = d.label;
  if (d.title) lab.title = d.title;
  cb.addEventListener('change', () => { d.set(cb.checked); _spApply(); });
  row.appendChild(cb); row.appendChild(lab);
  pop.appendChild(row);
  _simPopRows.push(() => {
    cb.checked = !!d.get();
    if (d.dim) { const off = !!d.dim(); cb.disabled = off; row.style.opacity = off ? 0.45 : ''; }
  });
  return row;
}
// d.wide … 選択肢の文言が長い行。見出しを上へ逃がしてプルダウンを窓幅いっぱいにする
function spSelect(pop, d) {
  const row = document.createElement('div'); row.className = 'prop-row' + (d.wide ? ' sp-wide' : '');
  const lab = document.createElement('span'); lab.className = 'prop-label'; lab.textContent = d.label;
  const sel = document.createElement('select'); sel.className = 'prop-select';
  for (const [v, txt] of d.options) {
    const o = document.createElement('option'); o.value = v; o.textContent = txt; sel.appendChild(o);
  }
  if (d.title) { lab.title = d.title; sel.title = d.title; }
  sel.addEventListener('change', () => { d.set(sel.value); _spApply(); });
  row.appendChild(lab); row.appendChild(sel);
  pop.appendChild(row);
  _simPopRows.push(() => { sel.value = d.get(); });
  return row;
}
function spSwatch(pop, label, id, get, key) {
  const row = document.createElement('div'); row.className = 'prop-row';
  const lab = document.createElement('span'); lab.className = 'prop-label'; lab.textContent = label;
  const sw = document.createElement('div'); sw.className = 'color-swatch'; sw.id = id;
  sw.onclick = () => openColorPicker(sw, key);
  row.appendChild(lab); row.appendChild(sw);
  pop.appendChild(row);
  _simPopRows.push(() => { sw.style.background = get(); });
  return row;
}
function spGrid(pop, items) {
  const g = document.createElement('div'); g.className = 'material-grid';
  g.style.marginBottom = '6px';
  for (const [text, fn, title] of items) {
    const b = document.createElement('button'); b.className = 'mat-btn'; b.textContent = text;
    if (title) b.title = title;
    b.onclick = () => { fn(); _spApply(); };
    g.appendChild(b);
  }
  pop.appendChild(g);
  return g;
}
// text / title は関数でも渡せる（対象の名前を出す等、状態で変わる文言に使う）。
//   dim() が true を返す間はボタンを押せなくする。理由は title に出すこと
//   （押せないだけだと「壊れている」に見える。触って意味のあるものだけ出す、の流儀）。
function spBtn(pop, text, fn, title, dim) {
  const b = document.createElement('button'); b.className = 'btn-small';
  b.style.cssText = 'width:100%; margin-top:4px';
  const val = v => (typeof v === 'function' ? v() : v);
  b.textContent = val(text);
  if (title) b.title = val(title);
  b.onclick = () => { if (b.disabled) return; fn(); _spApply(); };
  pop.appendChild(b);
  if (typeof text === 'function' || typeof title === 'function' || dim)
    _simPopRows.push(() => {
      b.textContent = val(text);
      if (title) b.title = val(title);
      if (dim) b.disabled = !!dim();
    });
  return b;
}
function spSub(pop, text) {
  const d = document.createElement('div'); d.className = 'sp-sub'; d.textContent = text;
  pop.appendChild(d);
  return d;
}
function spNote(pop, html) {
  const d = document.createElement('div'); d.className = 'sp-note';
  // ★関数を渡すと、窓を開けている間ずっと作り直す（＝いまの状態を映す注記に使える）。
  //   文字列のままなら従来どおり一度きり。
  if (typeof html === 'function') _simPopRows.push(() => { d.innerHTML = html(); });
  else d.innerHTML = html;
  pop.appendChild(d);
  return d;
}

// ════════════════════════════════════════
//  各ウィンドウの中身
//   数値の範囲・説明は右パネル（physBox.html の #tab-world）と合わせてある。
//   スライダーは実用域だけを刻み、それより外の値は数値欄へ直接入力する。
// ════════════════════════════════════════
const SIM_POPOVERS = {
  gravity: {
    title: '重力',
    build(p) {
      spNum(p, { label:'重力X [m/s²]', min:-20, max:20, step:0.1,
                 title:'画面の右向きが正。0以外にすると横向きの重力になります',
                 get:() => world.gravX, set:v => worldUpdate('gravX', v) });
      spNum(p, { label:'重力Y [m/s²]', min:-20, max:20, step:0.1,
                 title:'画面の上向きが正（地球は −9.8）',
                 get:() => yUI(world.gravY), set:v => worldUpdate('gravY', -v) });
      spCheck(p, { label:'重力に垂直な線（見かけの水平）',
                   title:'重力X・Yを合成した向きに垂直で、原点を通る破線を引きます。'
                       + '原点から重力の向きへ短い矢印も出るので、どちら側が下かも読めます。'
                       + '重力が0のときは向きが決まらないので描きません',
                   get:() => world.showGravityLine,
                   set:on => { world.showGravityLine = on; } });
      spBtn(p, '地面をこの向きに合わせる', () => alignGroundToGravity(),
            '地面の傾きを、上の破線と同じ向き＝重力に垂直にそろえます');
      spSub(p, '重力プリセット');
      spGrid(p, [
        ['地球 −9.8', () => setGravityPreset(0, G_EARTH)],
        ['月 −1.6',   () => setGravityPreset(0, 1.62)],
        ['火星 −3.7', () => setGravityPreset(0, 3.72)],
        ['無重力 0',  () => setGravityPreset(0, 0), '重力X・Yをどちらも0にします。真上から見下ろした水平面として使うときはこれ'],
      ]);
      spSub(p, '万有引力');
      spCheck(p, { label:'万有引力（物体間に引力）',
                   title:'物体どうしが F = G m₁m₂/r² で引き合うようになります',
                   get:() => world.gravitation,
                   set:on => { world.gravitation = on; wakeAll(); } });
      spNum(p, { label:'万有引力定数', min:0, max:30000, step:500,
                 title:'F = G m₁m₂/r² の G。ただし実効値です。実際の G = 6.67×10⁻¹¹ は日常スケールでは'
                     + '弱すぎて何も起きないため、画面で見える大きさに調整するつまみとして扱っています',
                 dim:() => !world.gravitation,
                 get:() => world.gravStrength, set:v => worldUpdate('gravStrength', v) });
      // ★欄は m、world.gravSoften は px（右パネルの w-gravsoften と同じ換算・同じ刻み）
      spNum(p, { label:'引力のぼかし [m]', min:0.01, max:0.5, step:0.01,
                 title:'F = G m₁m₂/(r²+ε²) の ε。r→0 で引力が無限大にならないようにするための長さです。'
                     + '軌道の半径がこれに近いと引力が目に見えて弱まるので、縮尺模型では'
                     + 'いちばん内側の軌道の半径の 1/10 以下まで下げてください',
                 dim:() => !world.gravitation,
                 get:() => world.gravSoften * PX2M, set:v => worldUpdate('gravSoften', v * M2PX) });
    },
  },
  air: {
    title: '空気',
    build(p) {
      spNum(p, { label:'空気密度 [kg/m³]', min:0, max:10, step:0.1,
                 title:'空気＝1.2／真空＝0',
                 get:() => world.airDensity, set:v => worldUpdate('airDensity', v) });
      spNote(p, '空気抵抗は <b>空気密度 × 抗力係数 C<sub>d</sub></b> で決まります。'
              + '物体側の C<sub>d</sub> が 0（既定）のままだと、ここを上げても効きません。<br>'
              + 'プロパティタブの「抗力係数 C<sub>d</sub>」を、球なら 0.47、平板なら 1.2 にしてください。');
    },
  },
  heat: {
    title: '熱',
    build(p) {
      spCheck(p, { label:'熱のやりとりを計算する',
                   title:'表示ではなく物理のスイッチです。既定ON。接触した物体・水・気体のあいだで熱が移り、'
                       + '系全体の熱量が保存します。物体も水も既定は20℃なので、温度を変えるまでは何も起きません。\n'
                       + '★扱う範囲：熱は伝わり、仕事もしますが、物質は変わりません'
                       + '（融点・沸点・相転移・潜熱は扱いません）',
                   get:() => world.thermalOn, set:on => setThermalOn(on) });
      // ★欄は℃、world.ambientTemp は K（右パネルの w-ambienttemp と同じ updateAmbientTemp を通す）
      spNum(p, { label:'まわりの温度 [℃]', min:-100, max:500, step:1, dim:() => !world.thermalOn,
                 title:'熱放射の相手になる「周囲」の温度です。放射率が0でない物体だけが、'
                     + 'この温度の環境と熱をやりとりします。放射率が0の物体しかないシーンでは使われません',
                 get:() => K2C(world.ambientTemp), set:v => updateAmbientTemp(v) });
      spNum(p, { label:'熱の伝わる速さ [×]', min:0, max:100000, step:1000, dim:() => !world.thermalOn,
                 title:'熱伝導だけを早送りする倍率です。1が実物どおり。'
                     + '実物の熱伝導は教材で眺めるには遅すぎるため、既定で50000倍にしてあります。\n'
                     + '★材質どうしの比（金属はスポンジの約1000倍伝えやすい）は変わりません。'
                     + '熱量保存にも影響せず、動く速さだけが変わります。ゆっくり見たいなら下げてください',
                 get:() => world.thermalRate, set:v => worldUpdate('thermalRate', v) });
      spRead(p, { label:'系の熱量 [kJ]',
                  title:'Σ(比熱 × 質量 × 温度)。熱が移っても、この合計は変わりません（保存の確認用）。'
                      + '摩擦熱が出ている間は、その分だけ増えます',
                  get:() => Math.round(totalHeat() / 1000) });
      spRead(p, { label:'散逸で出た熱 [J]',
                  title:'散逸した仕事の累計です（摩擦・非弾性衝突・空気抵抗・背景摩擦）。'
                      + '力学的エネルギーが減ったぶんがそのままここに現れるので、'
                      + '第一法則（力学E + 熱E = 一定）の確認に使えます',
                  get:() => Math.round(frictionHeatTotal) });
      spRead(p, { label:'熱源が与えた熱 [J]',
                  title:'系の外から出入りした熱の累計です（マイナスなら吸収）。'
                      + '「恒温にする」を入れた物体と、加熱／冷却の領域が積みます（冷却は負）。'
                      + 'Δ(系の熱量) = 散逸で出た熱 + 熱源が与えた熱 になります',
                  get:() => Math.round(reservoirHeatTotal) });
      spSub(p, '温度の表示');
      spCheck(p, { label:'温度で色をつける',
                   title:'物体と粒子を温度に応じた色（青＝冷たい／赤＝熱い）で塗ります。'
                       + '表示だけで物理は変わりません。画面左下に色の目盛りが出ます',
                   get:() => world.thermalViz, set:on => worldUpdate('thermalViz', on) });
      spNum(p, { label:'色の下端 [℃]', min:-273, max:1000, step:10, dim:() => !world.thermalViz,
                 title:'この温度以下はすべて同じ青になります',
                 get:() => world.thermalVizMin, set:v => worldUpdate('thermalVizMin', v) });
      spNum(p, { label:'色の上端 [℃]', min:-273, max:1000, step:10, dim:() => !world.thermalViz,
                 title:'この温度以上はすべて同じ赤になります',
                 get:() => world.thermalVizMax, set:v => worldUpdate('thermalVizMax', v) });
      spNote(p, '物体ごとの温度・比熱・熱伝導率は、'
              + '<b>プロパティタブの「熱力学的性質」</b>で設定します。');
    },
  },
  atm: {
    title: '大気圧',
    build(p) {
      // ★刻みは1 kPa だが、表示は3桁（既定の 101.325 kPa をそのまま見せる）
      spNum(p, { label:'大気圧 [kPa]', min:0, max:400, step:1, dec:3,
                 title:'気体室のピストン面にだけ効きます。\n'
                     + '★閉じた物体に一様な圧力がかかっても合力は0（全方向から等しく押される）ので、'
                     + '剛体一般には掛けていません。効くのは圧力差のある可動境界だけです。\n'
                     + '0にすると真空：気体室は釣り合いが P = mg/A だけになり、大きく膨張します',
                 get:() => world.atmPressure / 1000,
                 set:v => worldUpdate('atmPressure', Math.max(0, v) * 1000) });
      spGrid(p, [
        ['真空',      () => uiSetAtm(0),      '真空。気体室は膨張しきります'],
        ['火星',      () => uiSetAtm(600),    '火星の地表（約600Pa）'],
        ['地上 1atm', () => uiSetAtm(101325), '地上1気圧'],
        ['水深10m',   () => uiSetAtm(202650), '水深10m 相当（2気圧）'],
      ]);
      spNote(p, '気体は左ツールバーの<b>「⊔ 気体容器」</b>でピストン容器を置くとできます。'
              + '<br>ピストン面の圧力の矢印は、容器のプロパティの<b>「力を表示」</b>で'
              + '正味の力の矢印と一緒に出ます。');
    },
  },
  wave: {
    title: '波動場',
    build(p) {
      spNum(p, { label:'波速 v [m/s]', min:0.1, max:8, step:0.1,
                 title:'媒質中を波が進む速さ。この値は一定で、λ = v/f が導出されます。空気密度とは連動しません',
                 get:() => world.waveSpeed, set:v => setWaveSpeed(v) });
      spNum(p, { label:'媒質の吸収 [1/m]', min:WAVE_ABS_MIN, max:0.2, step:0.01,
                 title:'振幅が exp(−αr) で減る割合。計算する範囲はこの値から自動的に決まります。'
                     + '小さくすると波が遠くまで届きますが重くなります',
                 get:() => world.waveAbsorb, set:v => setWaveAbsorb(v) });
      spSelect(p, { label:'表示',
                    options:[['both','山と谷'], ['crest','山だけ'], ['trough','谷だけ'],
                             ['field','圧力場（赤＝山／青＝谷）']],
                    get:() => world.waveViewMode, set:v => setWaveViewMode(v) });
      spNum(p, { label:'山・谷の太さ [%]', min:1, max:60, step:1,
                 title:'山（谷）の頂点から何%ぶんを線として描くか。小さいほど細い線になります',
                 get:() => Math.round(world.waveCrestWidth * 100), set:v => setWaveCrestWidth(v) });
      spNum(p, { label:'表示の強さ', min:0.5, max:40, step:0.5,
                 get:() => world.waveViewGain, set:v => worldUpdate('waveViewGain', v) });
      spSelect(p, { label:'計算の上限',
                    options:[['0.3','軽い'], ['0.8','標準'], ['1.5','精細'], ['3.0','最高']],
                    get:() => world.waveBudget.toFixed(1), set:v => setWaveBudget(v) });
      const info = document.createElement('div');
      info.className = 'wave-info'; info.id = 'sp-wave-info';
      p.appendChild(info);
      _simPopRows.push(() => refreshWaveInfo());
    },
  },
  em: {
    title: '電磁気',
    build(p) {
      spNote(p, '電場・磁場の領域は、左のツールバーの<b>電場／磁場</b>でドラッグして置きます'
              + '（矩形の内側だけに場ができます）。向きと強さは、置いたあと選択して変えられます。');
      spCheck(p, { label:'電荷同士にクーロン力を働かせる',
                   title:'表示ではなく物理のスイッチです。既定ON。電荷を持つ物体同士に F = kq₁q₂/r² が'
                       + '実際に働き、同符号は反発し異符号は引き合って動きます。'
                       + 'OFFなら電荷は互いに何の力も及ぼしません（電場・磁場の領域からは力を受けます）。'
                       + 'OFFにすると便利なのは、一様電場中の放物運動を+qと−qで同時に見せるときのように、'
                       + '動く試験電荷どうしの反発で軌道が乱れては困る場面です',
                   get:() => world.coulombOn, set:on => emWorldUpdate('coulombOn', on) });
      spNum(p, { label:'クーロン定数', min:0, max:5, step:0.1,
                 title:'F = k q₁q₂/r² の k。ただし実効値です（万有引力定数と同じ思想）。'
                     + '既定の2なら、1 C 同士が 1 m 離れて 2 N です。'
                     + '電気力線・等電位線の形はこの値では変わりません',
                 dim:() => !world.coulombOn,
                 get:() => world.coulombK, set:v => emWorldUpdate('coulombK', v) });
      spSub(p, '場の表示');
      spCheck(p, { label:'電気力線を表示',
                   title:'点電荷の電気力線を描きます。本数は電荷の大きさに比例するので、'
                       + '線が混んでいるところほど電場が強い、という関係がそのまま読めます',
                   get:() => world.showFieldLines, set:on => worldUpdate('showFieldLines', on) });
      spCheck(p, { label:'等電位線を表示',
                   title:'点電荷による電位の等高線を描きます。電気力線と直交することが確認できます。'
                       + '※置いた「電場の領域」は含みません',
                   get:() => world.showEquipotential, set:on => worldUpdate('showEquipotential', on) });
      spNote(p, '個々の物体にはたらく<b>クーロン力・ローレンツ力の矢印</b>は、'
              + '物体のプロパティの「力を表示」でONにしてください。');
    },
  },
  sim: {
    title: 'シミュレーション設定',
    build(p) {
      spNum(p, { label:'反復回数', min:1, max:20, step:1,
                 title:'1ステップあたりに接触・拘束を解き直す回数。多いほど正確ですが重くなります',
                 get:() => world.iterations, set:v => worldUpdate('iterations', v) });
      spNum(p, { label:'サブステップ', min:1, max:10, step:1,
                 title:'1フレームを何回に分けて積分するか。速い運動や硬いばねが荒れるときに増やします',
                 get:() => world.substeps, set:v => worldUpdate('substeps', v) });
      spNum(p, { label:'遠方を凍結 [m]', min:0, max:2000, step:10,
                 title:'画面からこの距離より遠くへ出た物体は、計算を止めて速度を保ったまま待機します（0で無効）。'
                     + '軌跡・ジョイント・レーザー・波源が付いた物体、つかみ中の物体は凍結しません。'
                     + '万有引力モードでは無効です',
                 get:() => world.freezeDistance, set:v => setFreezeDistance(v) });
      spCheck(p, { label:'スリープ有効',
                   title:'ほとんど動かなくなった物体の計算を止めます。OFFにすると常に計算し続けます',
                   get:() => world.sleeping, set:on => worldUpdate('sleeping', on) });
    },
  },
  ground: {
    title: '地面・壁・背景',
    build(p) {
      spCheck(p, { label:'地面表示', get:() => world.terrain, set:on => updateGroundTerrain(on) });
      spNum(p, { label:'傾き [°]', min:-45, max:45, step:0.5,
                 title:'反時計回りが正。摩擦係数と合わせると、滑り出す角度 tanθ = μs がそのまま出ます',
                 get:() => yUI(ground.angle) * 180 / Math.PI, set:v => setGroundAngle(v) });
      spNum(p, { label:'地面Y [m]', min:-20, max:20, step:0.1,
                 title:'地面の高さ。上向きが正',
                 get:() => yUI(ground.y * PX2M), set:v => setGroundY(v) });
      // 地面の反発・摩擦。プロパティ（地面を選択中）・全体設定タブと同じ updateGroundProp を通す
      spNum(p, { label:'地面の反発係数', min:0, max:1, step:0.05,
                 title:'0＝ぶつかって止まる／1＝完全弾性で跳ね返る。'
                     + '物体側の反発係数との積が使われるので、'
                     + 'よく弾ませたいときは物体側も上げてください',
                 get:() => ground.restitution, set:v => updateGroundProp('restitution', v) });
      spNum(p, { label:'地面の静止摩擦', min:0, max:2, step:0.05,
                 title:'まだ滑っていない物体が滑り出すまでの限界を決めます。'
                     + '傾き θ の地面では tanθ = μs で滑り出すので、上の「傾き」と組にすると'
                     + '滑り出す角度をそのまま実験できます',
                 get:() => ground.frictionStatic, set:v => updateGroundProp('frictionStatic', v) });
      spNum(p, { label:'地面の動摩擦', min:0, max:2, step:0.05,
                 title:'滑っている間にはたらく摩擦。F = μk N で、速さによらず一定です。'
                     + 'μs より大きくはできません（大きい値を入れると μs も一緒に上がります）',
                 get:() => ground.friction, set:v => updateGroundProp('friction', v) });
      spSwatch(p, '地面色', 'sp-ground-swatch', () => ground.fillColor, 'ground');
      spBtn(p, '傾きをリセット', () => setGroundAngle(0));
      spSub(p, '壁');
      spCheck(p, { label:'壁で囲う（物体が画面外へ逃げない）',
                   title:'物体・液体・気体・ロープを矩形の内側に閉じ込めます。'
                       + '位置を直接押し戻す方式なので、どんなに速いものでも貫通できません。光は止めません',
                   get:() => world.wallsOn, set:on => worldUpdate('wallsOn', on) });
      spNum(p, { label:'壁の幅 [m]', min:1, max:400, step:1, dim:() => !world.wallsOn,
                 title:'壁の左右の間隔。原点を中心に左右へ半分ずつ広がります',
                 get:() => world.wallW, set:v => worldUpdate('wallW', v) });
      spNum(p, { label:'壁の高さ [m]', min:1, max:400, step:1, dim:() => !world.wallsOn,
                 title:'床（地面の高さ）から天井までの高さ。横より広く取っておくと、'
                     + '投げ上げの実験で天井が邪魔になりません',
                 get:() => world.wallH, set:v => worldUpdate('wallH', v) });
      spNum(p, { label:'壁の反発係数', min:0, max:1, step:0.05, dim:() => !world.wallsOn,
                 title:'0＝ぶつかって止まる／1＝完全弾性で跳ね返る',
                 get:() => world.wallRest, set:v => worldUpdate('wallRest', v) });
      // ★背景を「真上から見下ろした水平面」として使うときの設定。地面・壁と同じく
      //   "物体が触れている面" の話なのでここに置く（背景色は見た目だけなので別扱い）。
      spSub(p, '背景（真上から見下ろした面）');
      spNum(p, { label:'面静止摩擦係数 μs', min:0, max:2, step:0.05,
                 title:'背景をテーブル面とみなしたときの、面と物体のあいだの静止摩擦係数。'
                     + '加えた力が μs·mg⊥ を超えると物体が動き出します。0＝摩擦なし',
                 get:() => world.bgFrictionStatic, set:v => updateBgFriction('bgFrictionStatic', v) });
      spNum(p, { label:'面動摩擦係数 μk', min:0, max:2, step:0.05,
                 title:'滑っているあいだの摩擦係数。減速度は a = μk·g⊥ で、質量によりません。0＝摩擦なし',
                 get:() => world.bgFriction, set:v => updateBgFriction('bgFriction', v) });
      spNum(p, { label:'面に垂直な重力 [m/s²]', min:0, max:20, step:0.1,
                 title:'画面に垂直な向き（テーブル面に押し付ける向き）の重力 g⊥。'
                     + '垂直抗力 N = m·g⊥ を決めます。地球9.8／月1.6',
                 get:() => world.bgGravPerp, set:v => updateBgFriction('bgGravPerp', v) });
      spNote(p, '摩擦係数を0より大きくすると、背景が「真上から見下ろした水平面」として働きます。'
               + '重力X・Yを0にして使ってください。横から見た場面のまま入れると、空中の物体まで減速します。');
    },
  },
  // ── カメラ（上バーのカメラ）────────────────────────────────────
  //   ★左のツールバーには置かない。あちらは「キャンバスに置くもの」の場所で、
  //     カメラは物体に接続するものなので筋が違う（js/app/camera.js の★）。
  //   ★向きの言い方は画面に出しているとおりに揃える。「固定する／しない」だと
  //     何が固定されるのか読み取れない、という指摘を受けて言い換えたもの。
  //   ★「選んだ物体を追う」もこの窓に置く（以前は表示メニューの「視点を追従」）。
  //     どちらも「画面がどこを見るか」で、入口が2つあると言葉がずれて見えた。
  //     2つは排他（camera.js の★）。表示メニューには「原点へ戻す」だけが残っている。
  camera: {
    title: 'カメラ',
    build(p) {
      spSub(p, '1つの物体に接続');
      // ★選択肢の文言が長いので見出しを上の行へ逃がす（横並びだと窓の幅で切れる）
      spSelect(p, { label:'向きの決め方', wide:true,
                    title:'y軸正＝画面の上はいつも世界の上。物体の向きに合わせる＝物体と一緒に'
                        + '画面ごと回ります（回転する観測者の視点）。方眼も座標軸も一緒に傾きます',
                    options: [['world', 'カメラは常に y 軸正を向く'],
                              ['body',  '物体の向きによってカメラの向きも変わる']],
                    get:() => cameraUpMode, set:v => setCameraUpMode(v) });
      // ★「接続」は選択中の物体が要るので、選択が無ければ押せない（何に効くのか読めない
      //   ボタンを押せる状態で置かない）。
      spBtn(p, '選択中の物体にカメラを接続', () => attachCameraToSelection(),
            () => _cameraSelBody() ? 'カメラは1台だけで、接続は常に上書きです'
                                   : '接続する物体を選んでから押してください',
            () => !_cameraSelBody());
      // ★「外す」は対になる操作に見えるが、選択を条件にしない。カメラは1台だけなので
      //   「どのカメラを外すのか」に曖昧さが無く、選択を要求しても何も定まらない。
      //   一方で条件にすると、選択を外したまま別のツールへ移った人が、回った画面を
      //   戻すのに「対象を選び直す」一手を強いられる＝戻せなくなる経路だけが増える。
      //   対象は名前で示せば足りるので、ボタンの文字に出す（カメラを外す（円板））。
      spBtn(p, () => { const b = cameraBody();
                       return b ? ('カメラを外す（' + (b.label || ('物体#' + b.id)) + '）') : 'カメラを外す'; },
            () => detachCamera(),
            () => cameraBody() ? 'カメラを外すと、画面の位置も向きも自由に動かせる状態へ戻ります'
                               : 'カメラは接続されていません',
            () => !cameraBody());
      // ★接続を残したまま効果だけ止めたいとき用。外すと接続先を選び直すことになるので、
      //   「いったん地面から見たい」だけならこちらのほうが手数が少ない。
      spCheck(p, { label:'カメラを働かせる',
                   title:'切ると、接続はそのままでカメラの効果だけ止まります（画面の位置も向きも自由に動かせます）。'
                       + 'あとで同じ物体へ戻すつもりなら、外すよりこちらのほうが手数が少なくて済みます。\n'
                       + '入れると「選んだ物体を追う」は切れます',
                   get:() => cameraActive(),
                   dim:() => !cameraBody(),
                   set:on => setCameraOn(on) });
      spNote(p, () => {
        const b = cameraBody();
        const where = b ? ('<b>' + escHtml(b.label || ('物体#' + b.id)) + '</b> に接続中')
                        : '接続先は<b>なし</b>（物体を選んでから上のボタン）';
        return where + '<br><b style="color:var(--accent)">物理は何も変わりません。</b>'
             + '変わるのは見る側だけです。まっすぐ進んでいる物が曲がって見えるようになるので、'
             + 'どの系で見ているかは画面の下の札に出しています。<br>'
             + '★向きを合わせている間、軌跡とストロボは<b>その物体から見た道すじ</b>で描かれます。'
             + '貯めた点は捨てないので、外せばその場で地面から見た道すじに戻ります。';
      });
      // ── 選んだ物体を追う（何台でも。向きは回さない）──
      spSub(p, '選んだ物体を追う（複数可）');
      // ★ON にした瞬間の選択を対象にする（toggleFollow）。選択も前の対象も無いときは
      //   何を追うのか決まらないので押せなくする。
      spCheck(p, { label:'選んだ物体を追う',
                   title:'選んだ物体が画面から出ないよう、画面のほうがついていきます（向きは回しません）。\n'
                       + '入れると、上のカメラは止まります（接続は残ります）',
                   get:() => followEnabled,
                   dim:() => !followEnabled && selectedIds.size === 0 && followTargets().length === 0,
                   set:on => { if (on !== followEnabled) toggleFollow(); } });
      spCheck(p, { label:'全体が収まるまでズームアウト',
                   title:'追っている物体が全員画面に入るまで縮小します。\n'
                       + 'ズームインは決してしません。倍率が上下すると同じ速度の物体が速くも遅くも見えてしまい、\n'
                       + '速度を比べるという目的自体が壊れるためです',
                   get:() => followFit, set:on => { followFit = on; } });
      spCheck(p, { label:'中心は選択範囲（OFF＝質量重心）',
                   title:'ON＝選択した物体を囲む範囲の中心。全員を画面に入れるための表示都合のモードです。\n'
                       + 'OFF＝質量重心 Σmr/Σm。外力の合力が0なら重心は等速直線運動をするので、画面がそのまま重心系になります。\n'
                       + '2球の衝突を重心系で見ると前後で両球が常に逆向きに動き、運動量保存が絵として見えます\n'
                       + '（実験室系では片方が止まるようにしか見えません）。重心が加速して見えたら外力が効いている証拠です。\n'
                       + '「背景に固定」した物体は実質無限大の質量なので重心計算から外しています',
                   get:() => followMode === 'aabb',
                   set:on => { followMode = on ? 'aabb' : 'com'; refreshToolHint(); } });
      spNum(p, { label:'追う速さ [1/s]', min:2, max:60, step:1,
                 title:'画面が物体へ寄る速さ。60＝即時（ずれゼロ）。小さくすると滑らかに遅れて付いていきます。\n'
                     + '追っている間も右ドラッグ・ホイールで画面をずらせて、ずらした分は保たれます。\n'
                     + '★カメラ（上）は常に即時です',
                 get:() => followRate, set:v => { followRate = Math.max(2, Math.min(60, v)); } });
    },
  },
};
