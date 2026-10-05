// ════════════════════════════════════════
//  上部メニューの閉じ方（シーン・編集・表示・シミュレーションで共用）
// ════════════════════════════════════════
//  ★カーソルが離れたら閉じる。ただし猶予を置く。
//    下位メニューやシミュレーションの設定ウィンドウへ移る途中で必ずメニューの外を
//    通るし、メニューの中のスライダーを掴んだまま少しはみ出すこともあるため。
//    掴んでいる間（pointerdown〜pointerup）は閉じない。
//  ★外側を押して閉じるとき、その押下をキャンバスへ渡さない。
//    以前は図形ツールを選んだままメニューを閉じようとすると、閉じるためのクリックが
//    そのままキャンバスに届いて物体が1つできてしまっていた。閉じる処理が document の
//    バブル側にあり、キャンバスの mousedown（js/input/mouse.js）のほうが先に走るため。
//    ここでは capture 側で受けて、キャンバス上なら止める。
//    ・止めるのはキャンバスの上だけ。右パネルの入力欄などを直接押したときは
//      そのまま通す（メニューを閉じるためだけに2回押させない）。
const MENU_LEAVE_MS = 450;
function attachMenuAutoClose(menu, anchorEl) {
  let timer = null, held = false;
  // メニュー本体・下位メニュー（DOMの子）・開いたメニューボタン・設定ウィンドウ類は「中」
  const inside = t => !!t && (menu.contains(t) ||
                              (anchorEl && anchorEl.contains(t)) ||
                              _simPopIgnores(t));
  const close = () => {
    clearTimeout(timer); timer = null;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('pointerup',   onUp,   true);
    menu.remove();
    closeSimPopover();
  };
  const onMove = ev => {
    if (inside(ev.target)) { clearTimeout(timer); timer = null; return; }
    if (held || timer) return;
    timer = setTimeout(() => { if (!held) close(); }, MENU_LEAVE_MS);
  };
  const onDown = ev => {
    if (inside(ev.target)) { held = true; return; }        // 中を掴んだ＝スライダー操作中
    if (canvas.contains(ev.target)) { ev.preventDefault(); ev.stopPropagation(); }
    close();
  };
  const onUp = () => { held = false; };
  setTimeout(() => {
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('pointerup',   onUp,   true);
  }, 0);
  // ★同じメニューボタンをもう一度押して閉じる経路（各 toggle〜Menu の頭）からも
  //   必ずこの close を通す。element.remove() だけで済ませると document に
  //   仕掛けた listener が残り、外れたメニューのままキャンバスのクリックを
  //   食い止め続けてしまう。
  menu._close = close;
  return close;
}
// 開いているメニューを、後片付けごと閉じる
function closeOpenMenu(el) { if (el._close) el._close(); else el.remove(); }
// ★「ファイル」ではなく「シーン」。中身6つのうち5つがシーンの操作で、この道具に
//   ファイルという単位は無い（開いているのは常に1つのシーンで、書類も企画も持たない）。
//   .json はシーンを持ち運ぶ入れ物でしかないので、利用者が数える単位はシーンのほう。
function toggleSceneMenu(e) {
  const old = document.getElementById('scene-menu');
  if (old) { closeOpenMenu(old); return; }
  const r = e.currentTarget.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'scene-menu';
  menu.style.cssText =
    'position:fixed; background:var(--panel); border:1px solid var(--border); border-radius:6px;' +
    'padding:4px 0; z-index:9999; box-shadow:var(--shadow); min-width:250px;' +   // ★200→250
    'left:' + r.left + 'px; top:' + (r.bottom + 2) + 'px;';
  const addItem = (label, onClick, hasSub) => {
    const it = document.createElement('div');
    it.className = 'ctx-item';
    if (hasSub) {
      it.style.cssText = 'display:flex; align-items:center; justify-content:space-between; position:relative;';
      it.innerHTML = '<span>' + label + '</span><span style="color:var(--text2);margin-left:12px">▶</span>';
    } else {
      it.textContent = label;
    }
    if (onClick) it.onclick = onClick;
    menu.appendChild(it);
    return it;
  };
  const sep = () => { const s = document.createElement('div'); s.className = 'ctx-sep'; menu.appendChild(s); };
  // 取り付けが済むまでの仮。最後に attachMenuAutoClose の戻り値へ差し替える
  let closeMenu = () => menu.remove();
  addItem('新規作成(クリア)',        () => { closeMenu(); newScene(); });
  // ★ステップリセットはシーンを消さない（プログラムの数え直しだけ）。上バーから
  //   ここへ移したのは、押す頻度が低いのに ▶実行 の並びで場所を取っていたため。
  addItem('ステップ数をリセット',    () => { closeMenu(); resetStepCount(); })
    .title = 'ステップ数を0に戻します。シーンはそのままで、プログラムの「○ステップごと」「○m動くごと」の基準だけが引き直されます';
  sep();
  addItem('シーンを保存　(Ctrl+S)', () => { closeMenu(); saveScene(); });   // ★キーは前からあるが未表示だった
  addItem('シーンを読み込み', () => { closeMenu(); loadScene(); });
  sep();
  addItem('スクリーンショットを保存', () => { closeMenu(); screenshot(); });
  addItem('GIFアニメを保存',        () => { closeMenu(); startGifMode(); });
  sep();
  // ★デモは分野×単元で85件あるので、ホバーのサブメニューではなく一覧窓を開く
  //   （js/ui/demo-browser.js。clearScene や全体設定の作り直しも向こう持ち）
  addItem('デモシーンを読み込み…', () => { closeMenu(); openDemoBrowser(); });
  document.body.appendChild(menu);
  menu.addEventListener('click', ev => ev.stopPropagation());
  closeMenu = attachMenuAutoClose(menu, e.currentTarget);
}
// ★メニューの「すべて選択」と Ctrl+A は必ずここを通す。
//   以前は keyboard.js が同じ処理を自前で書いていて、中身がずれていた：
//   キー側だけが背景固定のレーザー・波源も拾い、逆にキー側は clearAllSelections() を
//   呼ばないのでジョイントや回路素子の選択が残り、そのまま Delete するとそちらが消えた。
function selectAll() {
  clearAllSelections();
  for (const b of objects) selectedIds.add(b.id);
  for (const el of boxSelectableElements()) selectedElemIds.add(el.id);   // ★背景固定のレーザー・波源も
  refreshPropsForSelection();   // ★複数でも代表（一番上の物体）の値を出す＝まとめて設定できる
  refreshSelCount();
}
function deselectAll() {
  clearAllSelections();
  lastSelRect = null;           // ★枠も捨てる（選択を解いた後に「◯◯のみ選択」が残らないように）
  updatePropsPanel(null);
  document.getElementById('st-sel').textContent = 'なし';
}
function hasSelection() {
  return selectedIds.size > 0 || selectedJointId != null || selectedElement != null
      || selectedCircuit != null    // ★回路素子だけを選んでいるときも「削除」を有効にする
      || selectedElemIds.size > 0   // ★範囲選択で拾ったレーザー・波源だけのときも同じ
      || selectedJointEnds.size > 0  // ★範囲選択で拾ったばね・ロープ・棒の端だけのときも同じ
      || selectedAnnotation != null; // ★注釈（テキスト・お絵描き）だけのときも同じ
}
// メニュー内のスライダー行。表示メニューとグリッド間隔メニューで共用する
function menuSliderRow(d) {
  const row = document.createElement('div');
  row.style.cssText = 'padding:5px 14px 7px; cursor:default;';
  if (d.title) row.title = d.title;
  const head = document.createElement('div');
  head.style.cssText = 'display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text2); margin-bottom:3px; white-space:nowrap;';
  const nameEl = document.createElement('span'); nameEl.textContent = d.label;
  const valEl = document.createElement('span'); valEl.style.color = 'var(--accent)';
  const fmt = v => d.fmt ? d.fmt(v) : String(v);
  valEl.textContent = fmt(d.get());
  head.appendChild(nameEl); head.appendChild(valEl);
  const sld = document.createElement('input');
  sld.type = 'range'; sld.min = d.min; sld.max = d.max; sld.step = d.step;
  sld.value = d.get();
  sld.style.cssText = 'width:100%; accent-color:var(--accent); display:block; margin:0;';
  sld.addEventListener('input', () => { const v = parseFloat(sld.value); d.set(v); valEl.textContent = fmt(v); });
  row.appendChild(head); row.appendChild(sld);
  return row;
}
// ★トップバー「グリッドスナップ ▾」の ▾ から開く間隔メニュー。
//   間隔はスナップと一緒に使うものなので、表示メニューの2階層下ではなくここからも触れるようにした。
//   表示メニューの同じ項目とは setGridSize を共有しているので、どちらから変えても同じ。
function toggleGridSizeMenu(e) {
  const old = document.getElementById('gridsize-menu');
  if (old) { closeOpenMenu(old); return; }
  const r = e.currentTarget.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'gridsize-menu';
  const W = 210;
  menu.style.cssText =
    'position:fixed; background:var(--panel); border:1px solid var(--border); border-radius:6px;' +
    'padding:4px 0; z-index:9999; box-shadow:var(--shadow); width:' + W + 'px;' +
    'left:' + Math.max(4, Math.min(r.right - W, window.innerWidth - W - 4)) + 'px;' +
    'top:' + (r.bottom + 2) + 'px;';
  menu.appendChild(menuSliderRow({
    label: 'グリッド線の間隔', min: 0.1, max: 5, step: 0.1,
    get: () => world.gridSize * PX2M, set: v => setGridSize(v), fmt: v => v.toFixed(1) + ' m' }));
  document.body.appendChild(menu);
  menu.addEventListener('click', ev => ev.stopPropagation());
  attachMenuAutoClose(menu, e.currentTarget);
}
// ── ストロボ表示の設定（間隔と対象）。グリッド間隔メニューと同じ作り ──────────
//   ★間隔はスライダーではなく「よく使う値の選択肢」にする。等間隔性を読むのが目的なので、
//     0.1 と 0.12 のような中途半端な値を作れても使い道がなく、選び直しにくいだけになる。
const STROBE_INTERVALS = [0.02, 0.05, 0.1, 0.2, 0.5, 1.0];
function toggleStrobeMenu(e) {
  const anchor = e.currentTarget;
  const old = document.getElementById('strobe-menu');
  if (old) { closeOpenMenu(old); return; }
  const r = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'strobe-menu';
  const W = 220;
  menu.style.cssText =
    'position:fixed; background:var(--panel); border:1px solid var(--border); border-radius:6px;' +
    'padding:4px 0; z-index:9999; box-shadow:var(--shadow); width:' + W + 'px;' +
    'left:' + Math.max(4, Math.min(r.right - W, window.innerWidth - W - 4)) + 'px;' +
    'top:' + (r.bottom + 2) + 'px;';
  const head = t => { const l = document.createElement('div'); l.className = 'ctx-label'; l.textContent = t; return l; };
  // ★押しても閉じない。間隔を変えながら見比べるので、いちいち開き直すのは邪魔になる
  //   （✔だけ書き換える。右クリックメニューの「動きの制限」と同じ流儀）。
  const rows = [];
  const refresh = () => {
    for (const [el, on] of rows) el.querySelector('.ctx-check').textContent = on() ? '✔' : '';
  };
  const row = (label, on, fn, title) => {
    const it = document.createElement('div');
    it.className = 'ctx-item';
    it.style.cssText = 'display:flex; align-items:center;';
    if (title) it.title = title;
    it.innerHTML = `<span class="ctx-check"></span><span>${label}</span>`;
    it.addEventListener('click', ev => { ev.stopPropagation(); fn(); refresh(); });
    rows.push([it, on]);
    menu.appendChild(it);
  };
  menu.appendChild(head('露光の間隔（シミュレーション時間）'));
  for (const v of STROBE_INTERVALS)
    row(v + ' 秒', () => Math.abs(strobeInterval - v) < 1e-9, () => setStrobeInterval(v),
        'この時間ごとに1枚写します。★速度の倍率を変えても間隔の意味は変わりません');
  const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep);
  menu.appendChild(head('対象'));
  row('選択中の物体だけ', () => strobeTarget === 'selected', () => setStrobeTarget('selected'),
      '選んでいる物体にだけ残像を出します。追いたい物体が1〜2個のときはこちら');
  row('動いている物体すべて', () => strobeTarget === 'all', () => setStrobeTarget('all'),
      '静的でない物体すべてに残像を出します。2つの落下を並べて比べるときはこちら。\n'
    + '★水・気体分子（粒子）は対象外です（数が多く、1粒ずつの残像に意味が無いため）');
  const sep2 = document.createElement('div'); sep2.className = 'ctx-sep'; menu.appendChild(sep2);
  menu.appendChild(head('露光の位置に線を引く'));
  row('横線（縦の進みを読む）', () => strobeHLine, () => toggleStrobeLine('h'),
      '残像1枚ごとに、その高さで横一文字に線を引きます。線の間隔＝その時間に落ちた距離。\n'
    + '自由落下なら 1:3:5:7 と開き、等速で上下していれば等間隔になります');
  row('縦線（横の進みを読む）', () => strobeVLine, () => toggleStrobeLine('v'),
      '残像1枚ごとに、その位置で縦に線を引きます。線の間隔＝その時間に進んだ距離。\n'
    + '等間隔なら等速、詰まっていくなら減速、開いていくなら加速です');
  refresh();
  document.body.appendChild(menu);
  menu.addEventListener('click', ev => ev.stopPropagation());
  attachMenuAutoClose(menu, anchor);
}
function buildDropdown(id, anchorEl, defs) {
  const old = document.getElementById(id);
  // 同じメニューをもう一度押した＝閉じる。開いていた設定ウィンドウも一緒に畳む
  if (old) { closeOpenMenu(old); return null; }
  closeSimPopover();   // 別のメニューへ移るときも取り残さない
  const r = anchorEl.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = id;
  menu.style.cssText =
    'position:fixed; background:var(--panel); border:1px solid var(--border); border-radius:6px;' +
    'padding:4px 0; z-index:9999; box-shadow:var(--shadow); min-width:220px;' +
    'left:' + r.left + 'px; top:' + (r.bottom + 2) + 'px;';
  // ★ここに overflow を付けてはいけない。下位メニュー（.ctx-submenu）は絶対配置で
  //   親の右へはみ出すので、overflow を切った瞬間に切り取られて出なくなる。
  // 取り付けが済むまでの仮。最後に attachMenuAutoClose の戻り値へ差し替える
  // （どちらも「メニューを畳み、開いていた設定ウィンドウも一緒に畳む」）
  let closeMenu = () => { menu.remove(); closeSimPopover(); };
  for (const d of defs) {
    if (d.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; menu.appendChild(s); continue; }
    if (d.label && !d.act) { const l = document.createElement('div'); l.className = 'ctx-label'; l.textContent = d.label; menu.appendChild(l); continue; }
    // ★設定ウィンドウを開く項目（js/ui/sim-popover.js）。カーソルを合わせると開き、押しても開く。
    //   下位メニュー（:hover で出す）にはしない。中に数値欄やスライダーを置くと、
    //   それを狙ってカーソルが経路を外れた瞬間に閉じてしまうため。
    if (d.pop) {
      const it = document.createElement('div');
      it.className = 'ctx-item';
      it.style.cssText = 'display:flex; align-items:center; gap:12px;';
      if (d.title) it.title = d.title;
      const left = document.createElement('span'); left.textContent = d.text;
      const arrow = document.createElement('span');
      arrow.style.cssText = 'color:var(--text2); margin-left:auto;'; arrow.textContent = '▶';
      it.appendChild(left); it.appendChild(arrow);
      it.addEventListener('mouseenter', () => simPopHover(d.pop, it));
      it.addEventListener('mouseleave', simPopHoverCancel);
      it.onclick = ev => { ev.stopPropagation(); toggleSimPopover(d.pop, it); };
      menu.appendChild(it);
      continue;
    }
    // ★下位メニュー付きの項目（カーソルを合わせると右に開く。開閉はCSSの :hover に任せる）
    //   使えないときは項目ごと消さず、灰色にして開かないようにする（並びが動かないほうが探しやすい）。
    if (d.sub) {
      const disabled = typeof d.enabled === 'function' ? !d.enabled() : false;
      const it = document.createElement('div');
      it.className = 'ctx-item' + (disabled ? '' : ' ctx-submenu-parent');
      it.style.cssText = 'display:flex; align-items:center; gap:12px;';
      if (disabled) { it.style.opacity = 0.4; it.style.cursor = 'default'; }
      if (d.title) it.title = d.title;
      // 開いている設定ウィンドウは畳む（同じ場所へ下位メニューが出て重なるため）
      it.addEventListener('mouseenter', closeSimPopover);
      const left = document.createElement('span'); left.textContent = d.text;
      const arrow = document.createElement('span');   // ▶は使えないときも出す（開かないだけ）
      arrow.style.cssText = 'color:var(--text2); margin-left:auto;'; arrow.textContent = '▶';
      it.appendChild(left); it.appendChild(arrow);
      if (!disabled) {
        const sub = document.createElement('div');
        sub.className = 'ctx-submenu';
        for (const s of d.sub) {
          if (s.sep) { const sp = document.createElement('div'); sp.className = 'ctx-sep'; sub.appendChild(sp); continue; }
          const sdis = typeof s.enabled === 'function' ? !s.enabled() : false;
          const si = document.createElement('div');
          si.className = 'ctx-item';
          si.textContent = s.text;
          if (s.title) si.title = s.title;
          if (sdis) { si.style.opacity = 0.4; si.style.cursor = 'default'; }
          else si.onclick = () => { closeMenu(); s.act(); };
          sub.appendChild(si);
        }
        it.appendChild(sub);
      }
      menu.appendChild(it);
      continue;
    }
    const it = document.createElement('div');
    it.className = 'ctx-item';
    it.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px;';
    const disabled = typeof d.enabled === 'function' ? !d.enabled() : false;
    if (disabled) { it.style.opacity = 0.4; it.style.cursor = 'default'; }
    if (d.title) it.title = d.title;   // ★灰色のときも出す（押せない理由を読ませるため）
    const left = document.createElement('span'); left.textContent = d.text;
    it.appendChild(left);
    if (d.key) { const k = document.createElement('span'); k.style.cssText = 'color:var(--text2); font-size:10px;'; k.textContent = d.key; it.appendChild(k); }
    if (!disabled) it.onclick = () => { closeMenu(); d.act(); };
    menu.appendChild(it);
  }
  document.body.appendChild(menu);
  menu.addEventListener('click', ev => ev.stopPropagation());
  closeMenu = attachMenuAutoClose(menu, anchorEl);
  return menu;
}
// ★直前の範囲選択の枠に入っている種別を並べる（「物体のみ選択」「ヒンジのみ選択」…）。
//   1種別しか無くても出す。範囲選択が直接選ぶのは物体・レーザー・波源（と、それらが
//   無いときの回路）だけなので、ジョイントや場は「1種別しか入っていない」場合でも
//   ここからでないと選べない。
//   件数はメニューを開いた時点で数え直すので、選択後に物体を動かしても表示がずれない。
function bulkFilterMenuDefs() {
  const gs = bulkGroupsInRect(lastSelRect);
  const defs = [{ sep:true }, { label:'範囲選択の中から種別で選び直す' }];
  // ★枠が無いときも見出しごと消さず、理由の分かる項目を灰色で置く
  if (!gs.length) {
    defs.push({ text:'（まず範囲選択で枠を作ってください）', enabled: () => false,
                title:'編集ツールで何もない所からドラッグして枠を作ると、その中に入った種別がここに並びます' });
    return defs;
  }
  for (const g of gs)
    defs.push({ text:`${g.label}のみ選択（${g.n}）`, act: () => selectOnlyKind(g.kind, g.sub) });
  return defs;
}
// ★位置揃え・均等配置。「位置揃え」1項目にまとめ、カーソルを合わせると中身が右に開く。
//   揃えるには2個以上、均等配置には3個以上が要る。足りないときも項目は消さず灰色にして、
//   親項目の見出しに「あと何が要るか」を書く（メニューの並びが選択状態で動かないほうが探しやすい）。
//   対象は物体・レーザー・波源で、件数を親項目に出して「何個に効くのか」を明示する。
function alignMenuDefs() {
  const n = alignTargets().length;
  const canAlign = n >= 2, canDist = n >= 3;
  const distTitle = canDist ? '両端はそのままに、中心の間隔が等しくなるよう内側を動かします'
                            : '均等に並べるには3個以上の選択が要ります（いま' + n + '個）';
  const sub = [
    { text:'上辺で揃える',     act: () => alignSelection('top'),
      title:'いちばん上にある物体の上辺に、ほかの上辺をそろえます' },
    { text:'下辺で揃える',     act: () => alignSelection('bottom') },
    { text:'左辺で揃える',     act: () => alignSelection('left') },
    { text:'右辺で揃える',     act: () => alignSelection('right') },
    { sep:true },
    { text:'上下中央で揃える', act: () => alignSelection('vcenter'),
      title:'重心の高さをそろえます。大きさの違う物体を同じ高さから落とすときはこちら' },
    { text:'左右中央で揃える', act: () => alignSelection('hcenter') },
    { sep:true },
    { text:'横に均等に並べる', act: () => distributeSelection('x'),
      enabled: () => canDist, title: distTitle },
    { text:'縦に均等に並べる', act: () => distributeSelection('y'),
      enabled: () => canDist, title: distTitle },
  ];
  return [{ sep:true },
          { text: canAlign ? `位置揃え（${n}個）` : '位置揃え（2個以上を選択）',
            enabled: () => canAlign, sub,
            title: canAlign ? '選択した物体・レーザー・波源の位置をそろえます'
                            : '位置をそろえるには2個以上の選択が要ります（いま' + n + '個）' }];
}
// ★「図形回転・反転」。回転の支点・反転の軸は、選択が1つならその重心、
//   複数なら選択範囲の中心（選択枠の○ハンドルと同じ規約）。
//   背景に固定したレーザー・波源も一緒に動く。波源は点源で向きを持たないので、
//   位置だけを移す（回しても映しても、波の出かたは変わらない）。
function transformMenuDefs() {
  const n = () => selectedBodies().length + _freeSelectedElems().length;
  const on = () => !transformSelectionEmpty();
  const sub = [
    { text:'左右反転', act: () => mirrorSelection('h'),
      title:'縦の軸で映します。形そのものが鏡像になり、複数選んでいれば並びも左右が入れ替わります' },
    { text:'上下反転', act: () => mirrorSelection('v'),
      title:'横の軸で映します' },
    { sep:true },
    { text:'時計回りに90°',   act: () => rotateSelectionBy(Math.PI / 2) },
    { text:'反時計回りに90°', act: () => rotateSelectionBy(-Math.PI / 2) },
    { text:'180°',            act: () => rotateSelectionBy(Math.PI),
      title:'時計回り・反時計回りのどちらに回しても同じ結果になります' },
  ];
  return [{ text: on() ? `図形回転・反転（${n()}個）` : '図形回転・反転（未選択）',
            enabled: on, sub,
            title: on() ? '選択したものを、選択範囲の中心を基準に回す・映す'
                        : '物体・レーザー・波源を選んでからお使いください' }];
}
// ★「図形和」。左ツールバーの図形和ボタン・右クリックと同じ BOOLEAN_OPS を並べる
function booleanMenuDefs() {
  const on = () => selectedIds.size >= 2;
  const sub = BOOLEAN_OPS.map(([key, label, title]) => ({ text: label, title, act: () => applyClipper(key) }));
  return [{ text: on() ? `図形和（${selectedIds.size}個）` : '図形和（2個以上を選択）',
            enabled: on, sub,
            title: on() ? '選んだ図形どうしを合わせる・抜く・重なりだけ残す'
                        : '図形を2個以上選んでからお使いください（いま' + selectedIds.size + '個）' }];
}
function toggleEditMenu(e) {
  buildDropdown('edit-menu', e.currentTarget, [
    { text:'やり直し（元に戻す）', key:'Ctrl+Z', act: stepBack,    enabled: () => undoStack.length > 0 },
    { text:'進む（やり直しを取消）', key:'Ctrl+Y', act: stepForward, enabled: () => redoStack.length > 0 },
    { sep:true },
    { text:'コピー',   key:'Ctrl+C', act: ctxCopy,      enabled: () => selectedIds.size > 0 },
    { text:'貼り付け', key:'Ctrl+V', act: ctxPaste,     enabled: () => !!clipboard },
    // ★設定だけを配る道具。写すのは質量ではなく密度（js/app/select-helpers.js）
    { text: propCopyLabel(),  key:'Ctrl+Shift+C', act: copyBodyProps,
      enabled: () => selectedIds.size === 1,
      title:'選んだ物体の材質・光学・見た目の設定を控えます（形や位置は含みません）。'
          + 'コピー元が決まらないので、選択は1個のときだけ使えます' },
    { text: propPasteLabel(), key:'Ctrl+Shift+V', act: pasteBodyProps,
      enabled: () => propPasteTargets().length > 0,
      title: propPasteTitle() },
    // ★レーザー・波源も複製できる（物体と混ざって選ばれていれば両方）
    { text:'複製',                  act: ctxDuplicate,
      enabled: () => selectedIds.size > 0 || selectedLasers().length > 0
                                          || selectedWaveSources().length > 0 },
    { text:'削除',     key:'Del',    act: ctxDelete,    enabled: hasSelection },
    { sep:true },
    ...transformMenuDefs(),
    ...booleanMenuDefs(),
    { sep:true },
    { text:'すべて選択', key:'Ctrl+A', act: selectAll,
      enabled: () => objects.length > 0 || boxSelectableElements().length > 0 },
    { text:'選択を解除', key:'Esc',    act: deselectAll, enabled: hasSelection },
    ...alignMenuDefs(),
    ...bulkFilterMenuDefs(),
  ]);
}
function selForcesOn() {
  if (selectedIds.size === 0) return false;
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b && !b.showForces) return false; }
  return true;
}
function selStaticOn() {
  if (selectedIds.size === 0) return false;
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b && !b.isStatic) return false; }
  return true;
}
// ★「衝突なし」(layers=0) の一括判定は廃止した。右クリックの項目を、レイヤーを
//   直接触れる「衝突レイヤー」の窓（ctxLayerSub）に置き換えたため、呼ぶ側がなくなった。
//   全部外す＝衝突なし なので、できることは減っていない。
function selVelocityOn() {
  if (selectedIds.size === 0) return false;
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b && !b.showVelocity) return false; }
  return true;
}
function selFixRotOn() {
  if (selectedIds.size === 0) return false;
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b && !b.fixedRotation) return false; }
  return true;
}
function selGuideOn() {
  if (selectedIds.size === 0) return false;
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b && !b.guideEnabled) return false; }
  return true;
}
// 選択中の物体が全部そのレイヤーに乗っているか（右クリックのレイヤー窓のチェック状態）
function selLayerOn(n) {
  if (selectedIds.size === 0) return false;
  const bit = 1 << (n - 1);
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b && !(b.layers & bit)) return false; }
  return true;
}
// ★選択にまとめて効く表示スイッチは、書いたあと必ず右パネルを作り直す。
//   「1個のときだけ」で絞っていた頃は、2個以上選んでメニューから力ベクトルをONにすると
//   右パネルの「力を表示」が外れたまま残り、同じ設定が2つの表示で食い違っていた
//   （右パネルは複数選択でも代表の値を出して全員へ書き込む作りなので、絞る理由が無い）。
function setSelForces(on) {
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b) b.showForces = on; }
  refreshPropsForSelection();
}
function setSelVelocity(on) {
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b) b.showVelocity = on; }
  refreshPropsForSelection();
}
// 重心の印。★力・速度ベクトルとは扱いが違う。あちらは物体ごとのフラグ（b.showForces）
//   だが、重心は物体ではなく系が持つ量なので、ONにした瞬間の選択を系として抱え込む
//   （state.js の comIds の★。エネルギーのグラフが「1窓＝1系」なのと同じ）。
//   ＝ 選択を外しても印は残る。だから OFF にする側は選択が空でも押せなければならない。
function toggleCOM() {
  if (comIds.length) { comIds = []; return; }
  comIds = objects.filter(o => selectedIds.has(o.id)).map(o => o.id);
}
// 電気力線・等電位線の「源」に含めるか（選択した物体すべてが源なら✔）
function selFieldSourceOn() {
  if (selectedIds.size === 0) return false;
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b && b.fieldSource === false) return false; }
  return true;
}
function setSelFieldSource(on) {
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b) b.fieldSource = on; }
  refreshPropsForSelection();   // ★上の setSelForces の★（複数選択でもずらさない）
}
// ════════════════════════════════════════
//  表示メニュー
// ════════════════════════════════════════
//  6つの見出し（グリッド線／グラフ／原点へ戻す／衝突レイヤー／力ベクトル／速度ベクトル）
//  だけを並べ、細かい設定はカーソルを合わせると右に開く下位メニューへ入れる。
//  ・見出し自体もクリックでON/OFFできる（下位メニューは「その表示の設定」）
//  ・ONのものには✔を出す
//  ★項目をクリックしても作り直さず、✔だけ書き換える（refreshers）。
//    以前のように毎回 innerHTML を捨てると、下位メニューの中の項目を押した瞬間に
//    メニューごと組み直されて下位メニューが閉じ、続けて設定できなかった。
function viewMenuDefs() {
  return [
    { label:'グリッド線', on:() => world.showGrid, act:toggleGridDisplay, sub:[
      { label:'原点と座標軸を表示', on:() => world.showAxes,
        title:'x=0 と y=0 の線を引きます。位置を「原点から何 m」で読むときの基準になります。',
        act:() => { world.showAxes = !world.showAxes; } },
      { label:'目盛り（距離の数字）を表示', on:() => world.showGridLabels,
        title:'座標軸に沿って「何 m か」の数字を書きます。軸が画面の外へ出たら画面端に貼り付くので、\n'
            + 'どこまでスクロールしても読めます。数字の間隔はズームに合わせて 1→2→5→10 と自動で選びます。',
        act:() => { world.showGridLabels = !world.showGridLabels; } },
      { sep:true },
      { label:'グリッド線にスナップ', on:() => snapEnabled, act:() => toggleGrid(),
        title:'置く位置・動かす位置がグリッド線の交点に吸い付きます。\n'
            + '四角・三角は頂点ではなく重心が格子点に乗るので、初期位置を x = 1.0 m のような値に揃えられます。\n'
            + 'ONの間は、グリッド線を非表示にしていても格子が薄く出ます。' },
      { label:'物体にスナップ', on:() => objSnapEnabled, act:() => toggleObjSnap(),
        title:'置く点が物体の頂点・辺の中点・中心（重心）に吸い付きます（■＝頂点／▲＝辺の中点／●＝中心）。\n'
            + 'ヒンジ・溶接・モーター・ばね・ロープ・連結棒・動力・レーザー・波源・軌跡・光学素子で効きます。\n'
            + 'グリッドスナップとは独立です。両方ONなら特徴点が優先されます。' },
      { slider:true, label:'グリッド線の間隔 [m]', min:0.1, max:5, step:0.1,
        title:'グリッド線の間隔。スナップの刻みも同じ値になります。太線は5本ごとです。',
        get:() => world.gridSize * PX2M, set:v => setGridSize(v), fmt:v => v.toFixed(1) },
    ]},
    // ★グリッド線の下位メニューには入れず、独立した項目にする。中に入れると
    //   「グリッド線を表示」のON/OFFに従属しているように見えてしまうため。
    { label:'重力に垂直な線（見かけの水平）', on:() => world.showGravityLine,
      title:'重力X・Yを合成した向きに垂直で、原点を通る破線を引きます。\n'
          + '重力を傾けたときの「見かけの水平」がどこかが分かります。\n'
          + '原点から重力の向きへ短い矢印も出るので、どちら側が下かも読めます。\n'
          + '重力X・Yが両方0（無重力）のときは向きが決まらないので描きません。',
      act:() => { world.showGravityLine = !world.showGravityLine; syncWorldPanel(); } },
    // ★グラフのウィンドウは開いたあと対象を追い続ける（選択を変えても切り替わらない）ので、
    //   ✔は「いま選んでいるものぶんが開いているか」を示す
    // ★ここには開けるグラフを**全種類**並べ、いまの選択で開けないものは灰色にする。
    //   押せるかどうかは各グラフの *Ready()（右パネルのボタン・右クリックと同じ判定）に任せ、
    //   ここで条件を書き直さない。needSel（何か選んでいれば押せる）だけでは、静的物体だけを
    //   選んだときや窓が上限のときに「押せるのに何も起きない」項目になっていた。
    //   ★温度だけは選択に依らない（その★）。速さの分布は範囲に置く計器（左ツールバーの
    //     「速さ分布」＝spdmeter.js）に移したので、ここには並べない。
    { label:'グラフを表示',
      on:() => velGraphs.length > 0 || circGraphs.length > 0 || eneGraphs.length > 0
            || tempGraphs.length > 0 || momGraphs.length > 0
            || pvGraphs.length > 0 || waveGraphs.length > 0,
      sub:[
      { label:'変位・速度・加速度（選択した物体）', needSel:true,
        title:'選択中の物体ごとにグラフのウィンドウを開きます。\n'
            + 'ウィンドウはその物体の記録を持ち続けるので、別の物体を選んでも中身は切り替わりません。\n'
            + '複数選べばその数だけ並べて見比べられます。',
        enabled:() => velGraphReady(),
        on:() => { const s = objects.filter(o => selectedIds.has(o.id));
                   return !!s.length && s.every(o => velGraphOf(o.id)); },
        act:() => toggleVelGraph() },
      // ★エネルギーだけは「1ウィンドウ＝1つの系」。選んだ物体をひとまとめに合計する
      //   （位置エネルギーは相互作用する相手がいて決まる量で、物体1個には配れないため）
      { label:'エネルギー（選択した物体の系）',
        title:'選択した物体をひとまとめの「系」として、エネルギーの時間変化を1枚のグラフに描きます。\n'
            + '運動エネルギー（並進・回転）と位置エネルギー（重力・ばね・万有引力・静電気力）、\n'
            + 'その和である力学的エネルギー、そして E(0) との差＝「失われた分」を重ねます。\n'
            + 'ばねや万有引力でつながった相手も一緒に選ぶと、その項が計上できるようになります。',
        enabled:() => eneGraphReady(),
        on:() => !!eneGraphOfSelection(),
        act:() => toggleEnergyGraph() },
      { label:'運動量（選択した物体の系）',
        title:'選択した物体をひとまとめの「系」として、運動量の時間変化を1枚に描きます。\n'
            + '外から力が働いていなければ、合計は水平な直線になります（運動量保存）。\n'
            + '物体を選んでいないときは押せません。',
        enabled:() => momGraphReady(),
        on:() => !!momGraphOfSelection(),
        act:() => toggleMomGraph() },
      { label:'波の受信（選択した物体の位置の y-t と振動数）',
        title:'選択中の物体の位置で水面波の変位を読み、y-t のグラフと、そこから測った振動数を描きます。\n'
            + '物体ごとに1つずつ窓が開きます。\n'
            + '波源が1つも無いとき、物体を選んでいないときは押せません。',
        enabled:() => waveGraphReady(),
        on:() => { const s = objects.filter(o => selectedIds.has(o.id));
                   return !!s.length && s.every(o => waveGraphOf(o.id)); },
        act:() => toggleWaveGraph() },
      // ★観測点はばねのパネルの「グラフの位置」の値（右クリックなら指した場所）。
      //   メニューには場所を指す手段が無いので、パネルと同じ点に開く。
      { label:'ばねの1点の y-t（選択したばね）',
        title:'選択中のばねの上の1点が、時間とともにどう動くかを描きます。\n'
            + '観測点は、ばねのパネルで指定した位置（既定は中央）です。右クリックなら指した場所に開けます。\n'
            + 'ばねを選んでいないときは押せません。',
        enabled:() => { const S = _selSlinky(); return !!S && slinkyGraphReady(S, _slkGraphSOf(S)); },
        on:() => { const S = _selSlinky(); return !!S && !!waveGraphOfSlinky(S, _slkGraphSOf(S)); },
        act:() => toggleSlinkyWaveGraphFromPanel() },
      { sep:true },
      // ★気体の3つの図は同じ1枚の窓で、軸だけが違う（toggleGasGraph）。✔の付いた軸を
      //   もう一度選ぶと閉じる。右クリックの ctxGasGraphSub と同じ並び
      ...[['pv', 'P–V 図（選択した気体）', '気体の状態が (V, P) 平面をどう動いたかを描きます。閉じた経路が囲む面積が、そのサイクルで気体がした仕事にあたります。'],
          ['pt', 'P–T 図（選択した気体）', '定積変化なら原点を通る直線になります。'],
          ['vt', 'V–T 図（選択した気体）', '定圧変化なら原点を通る直線になります（シャルルの法則）。'],
         ].map(([mode, label, tip]) => ({ label,
        title: tip + '\n3つの図は同じ1枚の窓で、選び直すと軸だけが差し替わります。\n気体を選んでいないときは押せません。',
        enabled:() => pvGraphReady(selectedGasChamber()),
        on:() => { const ch = selectedGasChamber(), g = ch && pvGraphOf(ch.id); return !!g && g.mode === mode; },
        act:() => toggleGasGraph(mode) })),
      // ★温度だけは「選択が無くても開ける」。液体・気体の系列は選択ではなく、その場にいる
      //   粒子・気体室から作られるため（tgBuildSeries）。物体を選ばずに押せば、気体・液体
      //   だけの窓が開く＝分子の入った容器を選ぶ手立てが要らない。だから needSel は付けない。
      { label:'温度（選択した物体・液体・気体）',
        title:'選択した物体の温度を1枚に重ねます。液体・気体があれば、その温度も一緒に描きます。\n'
            + '物体を選ばずに押すと、液体・気体だけの窓が開きます。\n'
            + '★気体の入った容器（ピストン容器）は器ごとに1本ずつ描きます。同じ熱を入れた\n'
            + '　定積の器と定圧の器を並べて、温度の上がりかたの違いを見比べられます。\n'
            + '★気体分子（粒子）の系列のほうは、シミュレーション上にいる分子ぜんぶの平均です\n'
            + '　（分子は容器に属さないので、容器ごとには分かれません）。\n'
            + '熱のやりとりがOFFのとき、対象が何も無いとき、窓が上限に達しているときは押せません。',
        enabled:() => tempGraphReady(),
        on:() => !!tempGraphOfSelection(),
        act:() => toggleTempGraph() },
      { sep:true },
      { label:'電流・電圧・電気量（選択した回路素子）',
        title:'選択中の回路素子をグラフに追加します（回路素子を選んでいるときだけ使えます）。\n'
            + '同じ回路の素子は1つのウィンドウにまとめて重ねて描かれます。',
        enabled:() => !!selectedCircuit,
        on:() => !!(selectedCircuit && circGraphOf(selectedCircuit.id)),
        act:() => toggleCircGraphPin() },
    ]},
    // ★回路の表はグラフの窓と同じ「見せ方」の操作なのでグラフの隣に置く。ただしグラフではない
    //   （素子の横に貼る札）ので下位メニューには入れない。選んだ素子の表を出し入れし、
    //   何も選んでいなければ出ている表をすべて畳む（circuit-table.js の toggleCircTablesView）
    { label:'回路の表を表示',
      title:'選択中の回路素子（電源・抵抗・豆電球・コンデンサー・コイル・ダイオード）の横に、\n'
          + '電圧・電流・抵抗・電気量のうちその素子に要る値の表を出します。もう一度で消えます。\n'
          + '素子を選んでいないときは、出ている表をすべて消します。\n'
          + '表は編集ツールかつかむツールでドラッグして動かせます。',
      enabled:() => circTablesViewUsable(),
      on:() => circTablesViewOn(),
      act:() => toggleCircTablesView() },
    // ★「選んだ物体を追う」（中心の決め方・ズームアウト・追う速さ）は上バーのカメラの窓へ移した。
    //   どちらも「画面がどこを見るか」なので入口を1つにする（js/ui/sim-popover.js の camera）。
    //   ここに残すのは1回押すだけの「原点へ戻す」。右ドラッグ・ホイールと同じ「見る場所の操作」で、
    //   状態を持たない。★カメラが働いている間は押せない（押しても次のフレームでカメラが上書きする）。
    { label:'画面を原点(0,0)へ戻す', act:() => goToOrigin(), enabled:() => !cameraActive(),
      title:'画面の中心を原点へ戻します。拡大率はそのままです。\n'
          + '上のカメラの「選んだ物体を追う」が入っていれば切ります。\n'
          + 'カメラを物体に接続して働かせている間は、画面はカメラのものなので使えません。' },
    { label:'衝突レイヤーを表示', on:() => world.showLayerBadges,
      act:() => { world.showLayerBadges = !world.showLayerBadges; } },
    // ★これは「表示」だけの項目。拘束は物体側の「運動方向固定」が持っていて、ここを
    //   OFF にしても物体はレールの上しか動けないまま（線と矢印が消えるだけ）。
    //   説明文にそう書く：見えないものが効いている状態を、見る人に黙って作らないため。
    { label:'運動方向固定の軸を表示', on:() => world.showGuideRails,
      title:'「運動方向固定」にした物体の、動ける向きの直線（黄色い破線と両向きの矢印）を描きます。\n'
          + 'OFF にしても拘束は効いたままです。消えるのは線だけで、物体は同じ直線上しか動けません。\n'
          + '同じレールに多数の物体が乗る題材（生成口から流れ続ける列など）では、1本の線が\n'
          + '物体の数だけ重ね描きされて題材が読めなくなるので、そこで消します。',
      act:() => { world.showGuideRails = !world.showGuideRails; } },
    // ★これも「表示」だけの項目（world.waterSmooth の★）。説明文に「物理は変わらない」と書く
    { label:'水をなめらかに描く', on:() => world.waterSmooth,
      title:'水の粒を1つずつの点ではなく、ひとつながりの水として塗ります。\n'
          + '見た目だけの切り替えで、水の動き・浮力・熱などの計算は何も変わりません。\n'
          + '水の粒1つは水の分子ではなく、約11cm角の水のかたまりです。静かにしておくと\n'
          + '粒が格子のように並びますが、これは計算のための刻み方が表に出たもので、水の性質ではありません。\n'
          + '粒の動き（対流など）を見たいときは OFF にしてください。印を付けた粒は ON でも点で出ます。',
      act:() => { world.waterSmooth = !world.waterSmooth; } },
    { label:'力ベクトルを表示', on:selForcesOn, act:() => setSelForces(!selForcesOn()), needSel:true, sub:[
      // ★上限は 100。10 では静電気力に足りない（実測：+2C と −1C を 2.1m 離すと 0.9N で、
      //   10 px/N でも矢印は 9px しかなく半径13pxの球に隠れる）。力学の重力は 10N 規模なので
      //   既定の 1 px/N のままでよく、上限を広げても既定の見え方は変わらない。
      // ★つまみは常用対数（0.001〜20000）。下限・上限の根拠は js/ui/panel-world.js の★
      { slider:true, label:'力ベクトルの大きさ [px/N]',
        min:FVIZ_LOG_MIN, max:FVIZ_LOG_MAX, step:0.02,
        title:'矢印の長さ。1 N を何 px で描くかです。矢印が画面からはみ出す・短すぎるときに調整します。\n'
            + '静電気力のように小さい力（0.1〜1 N）を見るときは大きくしてください。\n'
            + '万有引力の題材は力が mN の桁なので、数千まで上げられます（つまみは対数目盛り）。\n'
            + '逆に、連星のように力が数万 N になる題材では下げてください。'
            + '矢印には 260 px の上限があるので、下げないと全部が同じ長さに見えます。',
        get:forceScaleLog, set:forceScaleSetLog, fmt:forceScaleLabel },
      { label:'力の凡例を表示', on:() => world.showForceLegend,
        title:'画面の隅に、矢印の色と力の種類（重力・垂直抗力・摩擦・張力…）の対応表を出します。',
        act:() => { world.showForceLegend = !world.showForceLegend; } },
    ]},
    { label:'速度ベクトルを表示', on:selVelocityOn, act:() => setSelVelocity(!selVelocityOn()), needSel:true, sub:[
      { slider:true, label:'速度ベクトルの大きさ [px/(m/s)]', min:1, max:40, step:1,
        title:'矢印の長さ。1 m/s を何 px で描くかです。',
        get:() => world.velVizScale, set:v => worldVelScale(v), fmt:v => v.toFixed(0) },
    ]},
    // ★重心はここ（力・速度ベクトルの並び）に置く。読み取りのための印という点では同じ列だが、
    //   下位メニューは持たない：大きさも色も選ばせるものが無い（点を指すだけなので）。
    { label:'選択系の重心を表示', on:() => comIds.length > 0,
      enabled:() => comIds.length > 0 || selectedIds.size > 0,   // ★OFF は選択が空でも押せる
      title:'選んだ物体をひとまとめの「系」として、その質量重心 Σmr/Σm に印を出します。\n'
          + '重心は物体ではなく系が持つ量なので、押した時点の選択を系として覚えます。\n'
          + '選択を外しても、別の物体を選び直しても、印はその系のまま残ります（もう一度押すと消えます）。\n'
          + '外から働く力の合力が0なら重心は等速直線運動をします。止まって見えれば運動量の合計が0です。\n'
          + '連星なら2つの星の共通の中心が、2球の衝突なら衝突の前後で変わらない一点がそのまま見えます。\n'
          + '「背景に固定」した物体は動かせない＝実質無限大の質量なので、系に数えません。',
      act:toggleCOM },
    // ★「波動場を表示」は廃止した。波源を置くこと自体が「波動場を出す」操作なので、
    //   別にON/OFFを持つ意味がない（波源が無ければ field.js は何も描かない）。
    // 場の表示。★力ベクトル・速度ベクトルが「選んだ物体のもの」なのに対し、こちらは
    //   場そのものの絵なので、選択に関わらず世界全体で1つのON/OFF（needSel を付けない）。
    //   全体設定タブの同じチェックボックスとは syncEMWorldUI() で同期する。
    { label:'場の表示', on:() => world.showFieldLines || world.showEquipotential, sub:[
      { label:'電気力線を表示', on:() => world.showFieldLines,
        title:'点電荷の電気力線を描きます。本数は電荷の大きさに比例するので、線が混んでいるところほど\n'
            + '電場が強い、という関係がそのまま読めます。正電荷から出て負電荷に入り、その1本を両者が共有します。\n'
            + '※置いた「電場の領域」は一様な場として向きに反映されます。',
        act:() => { world.showFieldLines = !world.showFieldLines; syncEMWorldUI(); } },
      { label:'等電位線を表示', on:() => world.showEquipotential,
        title:'点電荷による電位の等高線を描きます。レベルは等比（1/2ずつ）なので、電荷の近くでも遠くでも\n'
            + '線が見えます。電気力線と直交することが確認できます。\n'
            + '※置いた「電場の領域」は含みません（箱の中だけ一様な場は電位が大域的に定義できないため）。',
        act:() => { world.showEquipotential = !world.showEquipotential; syncEMWorldUI(); } },
    ]},
  ];
}
// 「グリッド線を表示」。右パネルのチェックボックスとも同期させる
function toggleGridDisplay() {
  world.showGrid = !world.showGrid;
  const cb = document.getElementById('w-grid');
  if (cb) cb.checked = world.showGrid;
}
function toggleViewMenu(e) {
  const old = document.getElementById('view-menu');
  if (old) { closeOpenMenu(old); return; }
  const r = e.currentTarget.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'view-menu';
  menu.style.cssText =
    'position:fixed; background:var(--panel); border:1px solid var(--border); border-radius:6px;' +
    'padding:4px 0; z-index:9999; box-shadow:var(--shadow); min-width:210px;' +
    'left:' + r.left + 'px; top:' + (r.bottom + 2) + 'px;';
  const refreshers = [];
  const refreshAll = () => { for (const f of refreshers) f(); };
  // 1行つくる。d.sub があれば下位メニューを内側にぶら下げる（CSS の :hover で開く）
  const buildRow = d => {
    if (d.sep)    { const s = document.createElement('div'); s.className = 'ctx-sep'; return s; }
    if (d.slider) return menuSliderRow(d);
    const it = document.createElement('div');
    it.className = 'ctx-item' + (d.sub ? ' ctx-submenu-parent' : '');
    it.style.cssText = 'display:flex; align-items:center; gap:6px;';
    if (d.title) it.title = d.title;
    const chk = document.createElement('span');
    chk.style.cssText = 'width:14px; display:inline-block; color:var(--accent); flex:none;';
    const lbl = document.createElement('span'); lbl.textContent = d.label;
    it.appendChild(chk); it.appendChild(lbl);
    let ar = null;
    if (d.sub) {                       // 右端の▶（下位メニューがあることを示す）
      ar = document.createElement('span');
      ar.style.cssText = 'color:var(--text2); margin-left:auto; padding-left:10px;';
      ar.textContent = '▶';
      it.appendChild(ar);
      const box = document.createElement('div');
      box.className = 'ctx-submenu';
      for (const s of d.sub) box.appendChild(buildRow(s));
      // ★下位メニューの中のクリックは、ここで止めて親行まで上げない。
      //   上げると「物体にスナップ」を押しただけで親の『グリッド線』まで消えてしまう
      //   （区切り線・余白・スライダーの上をクリックしたときも同じ）。
      box.addEventListener('click', ev => ev.stopPropagation());
      // ★スライダーを掴んだまま下位メニューの外へ出ると、:hover が外れて display:none に
      //   なりドラッグが切れる。掴んでいる間だけ開いたままに固定する。
      box.addEventListener('pointerdown', ev => {
        if (ev.target.tagName !== 'INPUT') return;
        it.classList.add('sub-pinned');
        const up = () => { it.classList.remove('sub-pinned'); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointerup', up);
      });
      it.appendChild(box);
    }
    // 表示状態（✔・淡色）を今の値へ合わせ直す。クリックのたびに全行ぶん呼ぶ
    // ★淡色は行そのもの（it）ではなく、見出しの部品だけに掛ける。it に掛けると
    //   中にぶら下げた下位メニューまで一緒に薄くなる：見出しの ON/OFF は「選んだ物体」に
    //   効く（needSel）が、その下の設定は世界ぜんぶに効く別ものなので、選択が空でも
    //   使える。実際「力ベクトルを表示」は選択が無いと灰色になり、中の
    //   「力ベクトルの大きさ [px/N]」「力の凡例を表示」まで薄く出て触れないように見えていた
    //   （連星のデモのように何も選ばずに開く画面では、矢印の倍率を変える入口が
    //   右パネル側も隠れるため、ここだけが唯一の入口になる）。
    const refresh = () => {
      const usable = (!d.needSel || selectedIds.size > 0) && (!d.enabled || d.enabled());
      const dim = (d.act && !usable) ? 0.4 : '';
      chk.textContent = (usable && d.on && d.on()) ? '✔' : '';
      chk.style.opacity = dim; lbl.style.opacity = dim;
      if (ar) ar.style.opacity = dim;
      it.style.cursor = (d.act && !usable) ? 'default' : '';
    };
    refresh(); refreshers.push(refresh);
    if (d.act) it.onclick = ev => {
      ev.stopPropagation();            // 親（下位メニューを持つ行）まで伝わらせない
      const usable = (!d.needSel || selectedIds.size > 0) && (!d.enabled || d.enabled());
      if (!usable) return;
      d.act();
      refreshAll();
    };
    return it;
  };
  for (const d of viewMenuDefs()) menu.appendChild(buildRow(d));
  document.body.appendChild(menu);
  menu.addEventListener('click', ev => ev.stopPropagation());
  attachMenuAutoClose(menu, e.currentTarget);
}
function resetToInitial() {
  if (!savedState) {
    appAlert('初期状態に戻す', 'まだ実行していません。'
           + '<div class="am-note">▶実行を押した時点の状態を覚えるので、'
           + '一度実行してからお使いください。</div>');
    return;
  }
  simReset();
}
function stopAllMotion() {
  pushUndo();
  // ★生成口は除く。止める相手は「動いているもの」であって、生成口の速度は運動ではなく
  //   出てくる物体に渡す値。ここで消すと、止めたあと再開しても物が出てこなくなる。
  for (const b of objects) { if (b.isStatic || b.isSpawner) continue; b.vx = 0; b.vy = 0; b.av = 0; b.sleeping = false; b.sleepTimer = 0; }
  for (const j of joints) if (j.type === 'rope') resetRopeChain(j);
}
function zeroAllFriction() {
  pushUndo();
  for (const b of objects) { b.friction = 0; b.frictionStatic = 0; }
  ground.friction = 0; ground.frictionStatic = 0;
  for (const j of joints) if (j.type === 'rope') j.friction = 0;   // ★ロープ摩擦も含める
  wakeAll();
  if (selectedIds.size > 0) refreshPropsForSelection();   // ★複数選択でも欄の値を合わせ直す
  else if (selectedJointId != null) { const j = joints.find(x => x.id === selectedJointId); if (j) updateJointPanel(j); }
  const gf = document.getElementById('ground-form');
  if (gf && gf.style.display !== 'none') updateGroundPanel();
}
function clearAllTraces() {
  for (const b of objects) b.tracePoints = [];
}
// 液体（水分子）・気体（気体分子）を種類ごとに消す。
// 物体やジョイントは残るので、粒子を置きすぎて重くなったときに実験を作り直さずに済む。
// ★pushUndo は積まない。粒子はスナップショットに入っていない（history.js のコメント参照）ので、
//   ここで積むと Ctrl+Z が「粒子は消えたまま物体だけ巻き戻る」という妙な戻り方になる。
//   液体・気体ツールの「粒子をすべて消去」も同じく履歴を積まない。
function clearParticlesOfType(type) {
  particles = particles.filter(p => p.type !== type);
}
function hasParticlesOfType(type) { return particles.some(p => p.type === type); }
// 重力プリセット（地球・月・火星・無重力）。表示は syncWorldPanel() が world から作る
function setGravityPreset(gx, gy) {
  pushUndo();
  world.gravX = gx; world.gravY = gy;
  wakeAll();
  syncWorldPanel();
}
// メニューのプリセットもトップバーのスライダーも setSpeed 1本に集約する
// （以前は別々で、メニューから変えてもスライダーのつまみが動かなかった）
function setSpeedPreset(v) { setSpeed(v); }
// 再生速度の下位メニュー。今の倍率に✔を出す（項目は開くたびに作り直される）
const SPEED_PRESETS = [
  [0.25, '×0.25'], [0.5, '×0.5'], [1, '×1（標準）'], [1.5, '×1.5'], [2, '×2'],
];
function speedMenuDefs() {
  return SPEED_PRESETS.map(([v, label]) => ({
    text: (Math.abs(speedMult - v) < 1e-9 ? '✔ ' : '　') + label,
    act: () => setSpeedPreset(v),
  }));
}
function toggleSimMenu(e) {
  buildDropdown('sim-menu', e.currentTarget, [
    { text: running ? '⏸ 停止' : '▶ 実行', key:'Z', act: toggleRun },
    { text: '⏭ 1ステップ進める（1/60秒）', act: simStep },
    // ★2026-09-28、ユーザーの指示でここに置いた（上のバーには幅の余裕が無い）。
    //   「戻る」ボタンは編集の取り消し（history.js の pushUndo の★）で、実行してから押すと
    //   その前にした編集まで消える。置いた物・変えた設定を残して最初の位置へ戻す手はこれだけ。
    //   戻す前に今の姿を積むので、戻しすぎても「戻る」で実行後の姿へ帰れる。
    { text: '実行前に戻す', enabled: () => !!savedState,
      title: '最後に ▶実行 を押したときの配置に戻します。置いた物・変えた設定はそのまま残ります。\n'
           + '（上の戻るボタンは編集の取り消しです）',
      act: () => { if (!savedState) return; pushUndo(); resetToInitial(); } },
    { text: 'デモ読み込み時に戻す', enabled: () => !!_lastDemo,
      title: 'いま開いているデモを、読み込んだ直後の状態から開き直します。置いた物・変えた設定も消えます',
      act: reloadLastDemo },
    { text: '再生速度', sub: speedMenuDefs(),
      title:'シミュレーションの進む速さ。トップバーのスライダーと同じ値です' },
    { sep:true },
    // ★以下は全体設定タブと同じ設定。カーソルを合わせると設定ウィンドウが開く
    //   （右パネルはそのまま残るので、どちらから触ってもよい）
    //   並びは全体設定タブと同じにしてある（どちらを見ても同じ順で同じ設定が出る）
    { text:'重力',   pop:'gravity', title:'重力X・Y、重力プリセット、万有引力（定数・ぼかし）' },
    { text:'空気',   pop:'air',     title:'空気密度（空気抵抗の強さ）' },
    { text:'熱',     pop:'heat',    title:'熱のやりとり・まわりの温度・伝わる速さ・系の熱量・温度で色をつける' },
    { text:'大気圧', pop:'atm',     title:'大気圧とプリセット' },
    { text:'波動場', pop:'wave',    title:'波速・吸収・描き方・計算量の上限' },
    { text:'電磁気', pop:'em',      title:'クーロン力、電気力線・等電位線の表示' },
    { text:'地面・壁・背景', pop:'ground',
      title:'地面の傾き・高さ・色、壁で囲う設定、背景を真上から見た面として使うときの摩擦' },
    { text:'シミュレーション設定', pop:'sim',
      title:'反復回数・サブステップ・遠方を凍結・スリープ（計算の精度と重さ）' },
    { sep:true },
    { label:'その他' },
    { text:'全物体を静止', act: stopAllMotion, enabled: () => objects.length > 0 },
    { text:'すべての摩擦を0にする', act: zeroAllFriction, enabled: () => objects.length > 0 },
    { text:'すべての軌跡を消去', act: clearAllTraces, enabled: () => objects.some(b => b.tracePoints.length > 0) },
    { text:'水分子をすべて消去',   act: () => clearParticlesOfType('fluid'),
      enabled: () => hasParticlesOfType('fluid') },
    { text:'気体分子をすべて消去', act: () => clearParticlesOfType('gas'),
      enabled: () => hasParticlesOfType('gas') },
  ]);
}
// ════════════════════════════════════════
//  光学素子（レンズ・鏡）
// ════════════════════════════════════════

// ── 上バーのボタンはキーボードの的にならない ─────────────────────
//  ★マウスで押したボタンにはブラウザがフォーカスを残し、そのあとの Enter は
//    「そのボタンをもう一度押す」になる。この系では Enter はプログラムの既定のキーで、
//    拾う相手が居ないとき（窓を ✕ で消した＝プログラムごと消えた、など）に、
//    押していないはずのメニューが開いた（実測：〈表示〉を押して閉じたあと Enter で
//    view-menu が開いた）。上バーはマウスで押すための部品なので、mousedown の
//    既定（フォーカスの移動）だけを止める。click はそのまま届く。
document.getElementById('topbar').addEventListener('mousedown', e => {
  if (e.target.closest('button')) e.preventDefault();
});
