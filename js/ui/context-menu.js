function showCtxMenu(cx, cy) {
  _ctxCandidates = _ctxWorld ? collectSelectablesAt(_ctxWorld.x, _ctxWorld.y) : [];
  // ★範囲選択の枠の中で右クリックしたか。中なら「◯◯のみ選択」を出す（上部メニューと同じ入口）
  _ctxInSelRect = !!(_ctxWorld && lastSelRect &&
    _ctxWorld.x >= lastSelRect.x && _ctxWorld.x <= lastSelRect.x + lastSelRect.w &&
    _ctxWorld.y >= lastSelRect.y && _ctxWorld.y <= lastSelRect.y + lastSelRect.h);
  _ctxPickWorld = _ctxWorld;                 // ★項目の組み立てで位置が要るものへ渡す（上の★）
  _ctxWorld = null;                          // 使い切り。オブジェ一覧からの右クリックでは候補を出さない
  const m = document.getElementById('ctx-menu');
  m.innerHTML = buildCtxItems();
  m.style.display = 'block';                 // 実寸を測るため先に表示
  const rect = m.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, margin = 4;
  let x = cx, y = cy;
  if (x + rect.width  > vw - margin) x = Math.max(margin, cx - rect.width);   // 右端 → 左へ反転
  if (y + rect.height > vh - margin) y = Math.max(margin, cy - rect.height);  // 下端 → 上へ反転
  m.style.left = x + 'px';
  m.style.top  = y + 'px';
}
// ── 右クリックメニューの部品 ─────────────────────────────────────────
//   メニューは innerHTML で組み立てるので、部品も文字列を返す。
//   ★チェック印には id を振れるようにしてある。窓を開いたまま切り替える項目
//     （回転しない・運動方向固定・力／速度ベクトル）は、メニューを組み直さず
//     この span だけ書き換える（組み直すと、開いている下位の窓が閉じてしまう）。
const CTX_SEP = '<div class="ctx-sep"></div>';
const ctxItem = (label, fn, style, title) =>
  `<div class="ctx-item"${style ? ` style="${style}"` : ''}` +
        `${title ? ` title="${title}"` : ''} onclick="${fn}">${label}</div>`;
const ctxChk = (id, on) => `<span class="ctx-check"${id ? ` id="${id}"` : ''}>${on ? '✔' : ''}</span>`;
// 押せない項目。消さずに灰色で残す（並びが動かないほうが目的の項目を探しやすく、
// 見出しと title で「なぜ今は押せないか」も伝えられる）
const ctxItemOff = (label, title) =>
  `<div class="ctx-item" style="opacity:0.4;cursor:default"${title ? ` title="${title}"` : ''}` +
       ` onclick="event.stopPropagation()">${label}</div>`;
// カーソルを合わせると右に開く窓。
//   sticky=true … 中身を操作してもメニューを閉じない（チェックボックス・数値欄・スライダー用）。
//   sticky=false… 中の項目を押すと、いつもどおり document のクリックでメニューごと閉じる。
//   chkHtml     … 見出しの左に出すチェック印（ctxChk）。
//   headClick   … 見出し自体を押したときの処理。表示メニューと同じで「見出し＝ON/OFF、
//                  窓＝その設定」という作りにするためのもの。メニューは閉じない。
//   subOff      … いまは窓を出さない（▶も消す）。★中身がその機能の設定でしかないとき、
//                  機能が OFF なら開いても触れる操作が無い。灰色で見せるのではなく
//                  出さない（右パネルの「未選択なら隠す」と同じ流儀）。
//                  ON/OFF はメニューを開いたまま切り替わるので、判定はクラスの
//                  付け外しで行い、窓そのものは組み直さない（開いている他の窓が閉じるため）。
function ctxSubmenu(label, inner, sticky, chkHtml, headClick, subOff) {
  return `<div class="ctx-item ctx-submenu-parent${subOff ? ' sub-off' : ''}" style="display:flex;align-items:center"` +
             (headClick ? ` onclick="event.stopPropagation();${headClick}"` : '') + `>` +
           (chkHtml || '') + `<span>${label}</span>` +
           `<span class="ctx-sub-arrow" style="color:var(--text2);margin-left:auto;padding-left:10px">▶</span>` +
           `<div class="ctx-submenu"${sticky ? ' onclick="event.stopPropagation()"' : ''}>${inner}</div>` +
         `</div>`;
}
// 窓の中のスライダー行（上部メニューの menuSliderRow と同じ見た目）。
//   掴んだままカーソルが窓の外へ出ると :hover が外れて閉じてしまうので、
//   押している間だけ sub-pinned で開いたままにする。
// fmtFn … つまみの値をそのまま出さず、この名前のグローバル関数に通して表示する
//   （対数目盛りのつまみ用。力ベクトルの倍率がこれ。js/ui/panel-world.js の★）
function ctxSliderRow(label, min, max, step, value, valId, setFn, digits, fmtFn) {
  const show = fmtFn ? window[fmtFn](value) : value.toFixed(digits);
  const upd  = fmtFn ? `${fmtFn}(this.value)` : `parseFloat(this.value).toFixed(${digits})`;
  return `<div style="padding:5px 14px 7px;cursor:default">` +
           `<div style="display:flex;justify-content:space-between;align-items:center;` +
                `font-size:11px;color:var(--text2);margin-bottom:3px;white-space:nowrap">` +
             `<span>${label}</span><span id="${valId}" style="color:var(--accent)">${show}</span>` +
           `</div>` +
           `<input type="range" min="${min}" max="${max}" step="${step}" value="${value}"` +
                 ` style="width:100%;accent-color:var(--accent);display:block;margin:0"` +
                 ` onpointerdown="ctxPinSub(this)"` +
                 ` oninput="${setFn}(this.value);` +
                          `document.getElementById('${valId}').textContent=${upd}">` +
         `</div>`;
}
function ctxPinSub(el) {
  const p = el.closest('.ctx-submenu-parent');
  if (!p) return;
  p.classList.add('sub-pinned');
  const up = () => { p.classList.remove('sub-pinned'); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointerup', up);
}
// 開いたままのメニューでチェック印だけを今の状態に合わせ直す
function ctxRefreshChecks() {
  const set = (id, on) => { const e = document.getElementById(id); if (e) e.textContent = on ? '✔' : ''; };
  set('ctx-chk-static', selStaticOn());
  if (selectedElement && selectedElement.kind === 'gas') {
    set('ctx-chk-gaslock', !!selectedElement.chamber.pistonLocked);
    set('ctx-chk-gasiso', selectedElement.chamber.thermostat != null);
    set('ctx-chk-gascock', !!selectedElement.chamber.linkOpen);
  }
  if (selectedElement && selectedElement.kind === 'wave')
    set('ctx-chk-wave-on', !!selectedElement.source.enabled);
  if (selectedJointId != null) {
    const j = joints.find(x => x.id === selectedJointId);
    if (j && j.type === 'axle') set('ctx-chk-mbrake', !!j.motorBrake);
  }
  set('ctx-chk-fixrot', selFixRotOn());
  set('ctx-chk-guide',  selGuideOn());
  set('ctx-chk-forces', selForcesOn());
  set('ctx-chk-vel',    selVelocityOn());
  set('ctx-chk-fieldsrc', selFieldSourceOn());
  set('ctx-chk-legend', world.showForceLegend);
  for (let i = 1; i <= LAYER_COUNT; i++) {
    const e = document.getElementById('ctx-layer' + i);
    if (e) e.checked = selLayerOn(i);
  }
  // ばね（選んでいないときは id が無いので set は何もしない）
  const S = (selectedElement && selectedElement.kind === 'slinky') ? selectedElement.slinky : null;
  if (S) {
    set('ctx-chk-slk-ideal',  S.idealSpring);
    set('ctx-chk-slk-coil',   S.showCoil);
    set('ctx-chk-slk-strain', S.showStrain);
  }
  // ★機能が OFF のあいだは下位の窓を出さない（ctxSubmenu の subOff）。開いたまま
  //   見出しを押して切り替わるので、ここでクラスだけ付け外しする。窓を組み直すと、
  //   同時に開いている別の下位メニューまで閉じてしまう。
  const setSub = (id, on) => {
    const e = document.getElementById(id);
    const p = e && e.closest('.ctx-submenu-parent');
    if (p) p.classList.toggle('sub-off', !on);
  };
  setSub('ctx-chk-guide',  selGuideOn());
  setSub('ctx-chk-forces', selForcesOn());
  setSub('ctx-chk-vel',    selVelocityOn());
  set('ctx-chk-coulomb', world.coulombOn);
  // ★右パネルから映した欄（ctxMirrorChk / ctxMirrorLayerSub）。✔ は右パネルの今の値から、
  //   出す／出さないは右パネルで見えているかから引き直す（切り替えで欄が出入りするため）
  const menu = document.getElementById('ctx-menu');
  if (!menu) return;
  for (const e of menu.querySelectorAll('[id^="ctx-m-"]')) {
    const src = document.getElementById(e.id.slice(6));
    if (!src) continue;
    if (e.tagName === 'INPUT') e.checked = src.checked;
    else e.textContent = src.checked ? '✔' : '';
    const row = e.closest('.ctx-item');
    if (row) row.style.display = ctxPanelShown(src) ? '' : 'none';
  }
}
// ロープの「先端おもり」。つかむツールは物体しか掴めないので、背景に固定した端は
// これを付けて初めて手で引ける。付いている端では外せる。
//   端の●を指して右クリックした（selectedElement.end がある）ならその端だけ、
//   ロープの線を指したなら両端ぶんを「端A／端B」と書き分けて出す。
function ropeTipItems(j) {
  if (!j || j.type !== 'rope') return '';
  const picked = (selectedElement && selectedElement.kind === 'joint' &&
                  selectedElement.joint === j) ? selectedElement.end : null;
  const ends = picked ? [picked] : ['A', 'B'];
  let out = '';
  for (const e of ends) {
    const where = picked ? 'この端' : `端${e}`;
    if (ropeEndIsFree(j, e))
      out += ctxItem(`${where}に先端おもりを付ける`, `addRopeTipFromPanel('${e}')`);
    else if (ropeEndTip(j, e))
      out += ctxItem(`${where}の先端おもりを外す`, `removeRopeTipFromPanel('${e}')`);
  }
  return out ? out + CTX_SEP : '';
}
// ばね（スリンキー）の先端おもり。ロープの ropeTipItems とまったく同じ流儀で、
//   端の●を指して右クリックしたならその端だけ、胴を指したなら両端ぶんを出す。
function slinkyTipItems(S) {
  if (!S) return '';
  const picked = (selectedElement && selectedElement.kind === 'slinky' &&
                  selectedElement.slinky === S) ? selectedElement.end : null;
  const ends = picked ? [picked] : ['A', 'B'];
  let out = '';
  for (const e of ends) {
    const where = picked ? 'この端' : `端${e}`;
    if (slinkyEndTip(S, e))
      out += ctxItem(`${where}の先端おもりを外す`, `toggleSlinkyTipFromPanel('${e}')`, null,
                     'おもりを外して、おもりがあった位置に固定した端へ戻します');
    else if (slinkyEndFree(S, e))
      out += ctxItem(`${where}に先端おもりを付ける`, `toggleSlinkyTipFromPanel('${e}')`, null,
                     '固定した端に、掴んで引くための小さなおもりを付けます。'
                   + 'ばねに吊るしたおもり（単振動）もこれで作れます。\n'
                   + '質量は今の張力とつり合う重さになるので、付けた瞬間はその場で静止しています');
  }
  return out ? out + CTX_SEP : '';
}
// ばねの「理想ばね化・コイルとして描く・疎密を色で示す」。右パネルの3つの
//   チェックボックスとまったく同じもの（同じ関数を通す）を、右クリックからも出す。
//   ★押してもメニューは閉じず、✔だけ書き換える（動きの制限や表示メニューと同じ流儀）。
//     ばねは見せ方を切り替えながら見比べる使い方をするので、いちいち閉じては困る。
function slinkyViewItems(S) {
  if (!S) return '';
  return ctxItem(ctxChk('ctx-chk-slk-ideal', !!S.idealSpring) + '理想ばね化する（質量を無視）',
                 'event.stopPropagation();ctxToggleSlinkyIdeal()', null,
                 '質量を無視した、ただの力の法則として扱います（＝教科書のばね）。'
               + '単振動の周期が T = 2π√(m/k) と厳密に一致します。\n'
               + '質量が無いので波は伝わりません。見た目はコイルのまま変わりません') +
         ctxItem(ctxChk('ctx-chk-slk-coil', !!S.showCoil) + 'コイルとして描く',
                 "event.stopPropagation();ctxToggleSlinkyView('showCoil')", null,
                 'ばねのコイルとして描きます。巻きピッチは自然長基準なので、'
               + '縮んだところは巻きが詰まり伸びたところは広がります＝疎密波がそのまま目に見えます') +
         ctxItem(ctxChk('ctx-chk-slk-strain', !!S.showStrain) + '疎密を色で示す',
                 "event.stopPropagation();ctxToggleSlinkyView('showStrain')", null,
                 '今の平均ひずみを基準に、縮んでいる区間を暖色・伸びている区間を寒色で塗ります。'
               + '疎密波の位置が読み取れます') +
         CTX_SEP;
}
// ばねの上の1点の y-t グラフ（波の受信計）。右クリックした場所がそのまま観測点になる。
//   ★「開く／閉じる」ではなく「この点に開く」。観測点は**指した場所**で決まるので、
//     物体の受信計のような ON/OFF の切り替えにはならない（同じ点が2つ無い）。
//     ただし同じ印をもう一度指したときだけは閉じる＝出したものを同じ手順で引っ込められる。
//   ★観測点は割合で持つので、ここで px から s へ直しておく（wavegraph.js の★）。
function slinkyGraphItems(S) {
  if (!S) return '';
  const s = _ctxPickWorld ? wgSlinkyNearestS(S, _ctxPickWorld.x, _ctxPickWorld.y) : 0.5;
  const open = waveGraphOfSlinky(S, s);
  const at = wgSlinkyArcM(S, s).toFixed(2) + ' m';
  if (!slinkyGraphReady(S, s))
    return ctxItemOff(`この点（左端から ${at}）の y-t グラフ`,
                      'グラフの窓が上限に達しています。どれかを閉じてください') + CTX_SEP;
  return ctxItem(open ? `この点（左端から ${at}）の y-t を閉じる`
                      : `この点（左端から ${at}）の y-t グラフ`,
                 `ctxToggleSlinkyWaveGraph(${s.toFixed(4)})`, null,
                 open ? 'この点の受信計の窓を閉じます'
                      : 'ばねのこの点が時間とともにどう動くかを、別の窓にグラフで出します。\n'
                      + '画面のばねそのものが x-y グラフ（ある瞬間の形）なので、'
                      + '2つを見くらべると λ と T の違いが読めます。\n'
                      + '観測点はばねの上に印が出て、媒質と一緒に動きます（物理には参加しません）') +
         CTX_SEP;
}
// 「この回路の蓄えをリセット」。コンデンサーの電荷・コイルの磁束を持つ素子が
// つながっているときだけ出す（右クリックメニューは短いほうが目的の項目を探しやすい）。
const CIRCUIT_STORAGE_NAMES = { capacitor:'コンデンサー', inductor:'コイル',
                                electromagnet:'電磁石', bulb:'豆電球' };
function ctxStorageResetItem() {
  if (!selectedCircuit) return '';
  const targets = circuitStorageTargets(selectedCircuit);
  if (!targets.length) return '';
  const n = {};
  for (const e of targets) n[e.type] = (n[e.type] || 0) + 1;
  const detail = Object.keys(n).map(t => `${CIRCUIT_STORAGE_NAMES[t] || t}${n[t]}`).join('・');
  return ctxItem('この回路の蓄えをリセット', 'resetSelectedCircuitStorage()', null,
    'コンデンサーの電荷 Q と、コイル・電磁石の磁束 Φ を 0 に戻します。'
  + '同じ実験をもう一度やるときに、回路を組み直さずに初期状態へ戻せます。\n'
  + `対象：${detail}（この素子とつながっている回路だけ。別の回路には触れません）\n`
  + '豆電球のフィラメント温度も室温に戻ります。切れた球は直りません。');
}
// 「図形回転・反転」。上部の編集メニューとまったく同じ並び。
function ctxTransformSub() {
  return ctxSubmenu('図形回転・反転',
    ctxItem('左右反転', "mirrorSelection('h')") +
    ctxItem('上下反転', "mirrorSelection('v')") + CTX_SEP +
    ctxItem('時計回りに90°',   'rotateSelectionBy(Math.PI/2)') +
    ctxItem('反時計回りに90°', 'rotateSelectionBy(-Math.PI/2)') +
    ctxItem('180°',            'rotateSelectionBy(Math.PI)'),
    false);
}
// 「衝突レイヤー」。右パネルのプロパティと同じ4つのチェックボックスを出す。
//   ★以前は「衝突なし」のON/OFFだけだった。それは layers=0 と layers=1 を
//     行き来するだけで、2〜4に置いた物体を1へ引きずり戻してしまう。
//     ここで直接レイヤーを触れれば、全部外す＝衝突なしも同じ操作で作れる。
function ctxLayerSub() {
  let rows = '';
  for (let i = 1; i <= LAYER_COUNT; i++)
    rows += `<div class="checkbox-row">` +
              `<input type="checkbox" id="ctx-layer${i}" ${selLayerOn(i) ? 'checked' : ''}` +
                    ` onchange="ctxSetLayer(${i},this.checked)">` +
              `<label for="ctx-layer${i}">` +
                `<span class="layer-chip" style="background:${LAYER_COLORS[i-1]}"></span>${i}</label>` +
            `</div>`;
  return ctxSubmenu('衝突レイヤー',
    `<div class="layer-grid" style="padding:4px 14px">${rows}</div>` +
    `<div style="font-size:10px;color:var(--text2);padding:2px 14px 4px;white-space:normal;max-width:190px">` +
    `同じ番号を持つものどうしがぶつかります。すべて外すと何ともぶつからなくなります（＝衝突なし）。</div>`,
    true);
}
// ── 右パネルの欄をそのまま右クリックへ映す ────────────────────────────
//   ★右クリックには「数値以外の操作はすべて」出す。1項目ずつ専用の関数を書くと、
//     右パネルとの食い違い（Undo・一括選択・欄の出し入れ・次に置く既定）が項目の数だけ
//     生まれるので、右パネルの欄そのものを押す（checked を反転して change を投げる／
//     value を変えて change を投げる／click する）。通る関数は右パネルと完全に同じになる。
//   ★出し分けの門番も右パネルに任せる：欄が右パネルで隠れているなら出さない
//     （熱OFFの「恒温にする」、透明でない物体の「分散」など。門番を2か所に書かない）。
//     右パネルは右クリックで選んだ時点で描き直されている（selectUnderCursorForCtx）。
function _ctxEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
// 欄が右パネル上で見えているか。タブ（#tab-props）が閉じているかどうかは問わない
function ctxPanelShown(el) {
  if (!el) return false;
  for (let e = el; e && e.id !== 'tab-props' && e !== document.body; e = e.parentElement)
    if (e.hidden || getComputedStyle(e).display === 'none') return false;
  return true;
}
function _ctxPanelLabel(el) {
  const lb = document.querySelector(`label[for="${el.id}"]`);
  if (lb) return { text: lb.textContent.trim(), title: lb.title || el.title || '' };
  const pl = el.parentElement && el.parentElement.querySelector('.prop-label');
  return { text: pl ? pl.textContent.trim() : el.id, title: el.title || '' };
}
// チェックボックス。押してもメニューは閉じず ✔ だけ書き換える（右パネルの感覚で続けて切り替える）
function ctxMirrorChk(id, label) {
  const el = document.getElementById(id);
  if (!ctxPanelShown(el)) return '';
  const L = _ctxPanelLabel(el);
  const text = label || L.text;
  if (el.disabled) return ctxItemOff(ctxChk(null, el.checked) + text, _ctxEsc(L.title));
  return ctxItem(ctxChk('ctx-m-' + id, el.checked) + text,
                 `event.stopPropagation();ctxMirrorToggle('${id}')`, null, _ctxEsc(L.title) || null);
}
function ctxMirrorToggle(id) {
  const el = document.getElementById(id);
  if (!el || el.disabled) return;
  el.checked = !el.checked;
  el.dispatchEvent(new Event('change'));
  ctxRefreshChecks();
}
// 選択肢。見出しに今の値を出し、右に開く窓から選ぶ（選ぶとメニューは閉じる）
function ctxMirrorSelect(id, label) {
  const el = document.getElementById(id);
  if (!ctxPanelShown(el) || !el.options.length) return '';
  const L = _ctxPanelLabel(el);
  const cur = el.selectedIndex >= 0 ? el.options[el.selectedIndex].textContent.trim() : '';
  let inner = '';
  for (let i = 0; i < el.options.length; i++) {
    const o = el.options[i];
    inner += o.disabled
      ? ctxItemOff(ctxChk(null, false) + o.textContent.trim(), _ctxEsc(o.title || ''))
      : ctxItem(ctxChk(null, i === el.selectedIndex) + o.textContent.trim(),
                `ctxMirrorPick('${id}',${i})`, null, _ctxEsc(o.title || '') || null);
  }
  return ctxSubmenu(`${label || L.text}：<span style="color:var(--text2)">${cur}</span>`, inner, false);
}
function ctxMirrorPick(id, i) {
  const el = document.getElementById(id);
  if (!el || !el.options[i] || el.selectedIndex === i) return;
  el.selectedIndex = i;
  el.dispatchEvent(new Event('change'));
}
// ボタン。文言は右パネルの今の表示をそのまま使う（「表を出す／表を閉じる」のように変わるため）
function ctxMirrorBtn(id, label) {
  const el = document.getElementById(id);
  if (!ctxPanelShown(el)) return '';
  const text = label || el.textContent.trim();
  if (el.disabled) return ctxItemOff(text, _ctxEsc(el.title || ''));
  return ctxItem(text, `ctxMirrorClick('${id}')`, null, _ctxEsc(el.title || '') || null);
}
function ctxMirrorClick(id) {
  const el = document.getElementById(id);
  if (el && !el.disabled) el.click();
}
// 衝突レイヤーの窓を右パネルのチェックボックス（prefix1..4）から作る（ジョイント・地面用。
// 物体は ctxLayerSub が持つ）。中身の書き換えは右パネルの欄を通す。
function ctxMirrorLayerSub(prefix) {
  const first = document.getElementById(prefix + '1');
  if (!ctxPanelShown(first)) return '';
  let rows = '';
  for (let i = 1; i <= LAYER_COUNT; i++) {
    const el = document.getElementById(prefix + i);
    if (!el) continue;
    rows += `<div class="checkbox-row">` +
              `<input type="checkbox" id="ctx-m-${prefix}${i}" ${el.checked ? 'checked' : ''}` +
                    ` onchange="ctxMirrorSet('${prefix}${i}',this.checked)">` +
              `<label for="ctx-m-${prefix}${i}">` +
                `<span class="layer-chip" style="background:${LAYER_COLORS[i-1]}"></span>${i}</label>` +
            `</div>`;
  }
  return ctxSubmenu('衝突レイヤー',
    `<div class="layer-grid" style="padding:4px 14px">${rows}</div>` +
    `<div style="font-size:10px;color:var(--text2);padding:2px 14px 4px;white-space:normal;max-width:190px">` +
    `同じ番号を持つものどうしがぶつかります。すべて外すと何ともぶつからなくなります（＝衝突なし）。</div>`,
    true);
}
function ctxMirrorSet(id, on) {
  const el = document.getElementById(id);
  if (!el || el.checked === on) return;
  el.checked = on;
  el.dispatchEvent(new Event('change'));
  ctxRefreshChecks();
}
// 電荷間クーロン力。★世界全体のスイッチだが、右パネルでは電荷を持つ物体の欄から切れるので
//   同じ条件（選んだ物体に電荷がある）で出す。表示ではなく物理のスイッチ。
function ctxCoulombItem() {
  let hasCharge = false;
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b && b.charge) { hasCharge = true; break; } }
  if (!hasCharge) return '';
  return ctxItem(ctxChk('ctx-chk-coulomb', world.coulombOn) + '電荷間クーロン力（全体）',
    'event.stopPropagation();toggleCoulombFromPanel();ctxRefreshChecks()', null,
    '電荷同士の相互作用のON/OFFです（この物体だけでなく全体に効きます）。'
  + '一様電場中の放物運動などを複数の試験電荷で同時に見せるとき、粒子どうしの反発で軌道が乱れるのを防げます');
}
// 中身があるときだけ区切り線を付けて返す（出し分けで空になった段に線だけ残さない）
function ctxOptSection(html) { return html ? html + CTX_SEP : ''; }
// 地面の傾きを0へ戻す（全体設定タブのボタンと同じ処理）。傾いていないときは出さない
function ctxGroundAngleReset() {
  setGroundAngle(0);
  const el = document.getElementById('w-ground-angle');
  if (el) el.value = 0;
  if (typeof syncSliderById === 'function') syncSliderById('w-ground-angle');
}
// 「運動方向固定」。見出しを押すとON/OFF、カーソルを合わせると向きの設定が右に開く。
//   中身は右パネルのプロパティと同じ（動ける向き＋よく使う角度のボタン）。
function ctxGuideSub() {
  const on = selGuideOn();
  const first = objects.find(o => selectedIds.has(o.id));
  const deg = first ? _dispDeg(first.guideAngle).toFixed(1) : '0.0';
  let presets = '';
  for (const d of GUIDE_PRESETS)
    presets += `<button class="mat-btn" onclick="ctxSetGuideAngle(${d})">${d}°</button>`;
  // ★OFF のときは窓ごと出さない（ctxSubmenu の subOff）。以前は灰色で見せていたが、
  //   触れない欄を見せても「なぜ効かないか」は伝わらないので、見出しの ON/OFF に一本化した。
  const body =
    `<div class="prop-row" style="padding:4px 14px">` +
      `<span class="prop-label">動ける向き [°]</span>` +
      `<input class="prop-input" id="ctx-guideangle" type="number" step="1" value="${deg}"` +
            ` title="この向きの直線上だけを動きます。右向き0°・反時計回りが正"` +
            ` onchange="ctxSetGuideAngle(this.value)">` +
    `</div>` +
    `<div class="material-grid" style="padding:0 14px 6px;margin:0">${presets}</div>` +
    `<div style="font-size:10px;color:var(--text2);padding:2px 14px 4px;white-space:normal;max-width:190px">` +
      `見出しを押すとON/OFFが切り替わります。斜面上の運動や、決まった向きだけに動かしたいときに使います。</div>`;
  return ctxSubmenu('運動方向固定', body, true, ctxChk('ctx-chk-guide', on), 'ctxToggleGuide()', !on);
}
// 「グラフを表示」。カーソルを合わせると量の名前が右に開く。
//   ★3つはウィンドウの単位が違う。変位・速度・加速度は物体1個ごと（選んだ数だけ並ぶ）、
//     エネルギーは選んだ物体をまとめて1つの系（1枚に合計される）、
//     温度は1枚に重ねたうえで、あとから系列を足せる。説明を添えておく。
function ctxGraphSub() {
  const sel = objects.filter(o => selectedIds.has(o.id));
  const velOpen = !!sel.length && sel.every(o => velGraphOf(o.id));
  const eneOpen = !!eneGraphOfSelection();
  const tmpOpen = !!tempGraphOfSelection();
  const tmpAdd  = tempGraphToAppend();
  // ★押せるかは各グラフの *Ready()（表示メニュー・右パネルと同じ判定）。押せないときは灰色で理由を出す
  const FULL = 'グラフの窓が上限に達しています。どれかを閉じてください';
  let items =
    (velGraphReady()
      ? ctxItem(ctxChk(null, velOpen) + '変位・速度・加速度', 'toggleVelGraph()', null,
            '選んだ物体ごとに1つずつウィンドウが開きます')
      : ctxItemOff(ctxChk(null, false) + '変位・速度・加速度', FULL)) +
    (!momGraphReady()
      ? ctxItemOff(ctxChk(null, false) + '運動量',
          objects.some(o => selectedIds.has(o.id) && !o.isStatic) ? FULL : '固定した物体は系に入らないので描けません') :
    ctxItem(ctxChk(null, !!momGraphOfSelection()) + '運動量', 'toggleMomGraph()', null,
            '選んだ物体をひとまとめの「系」として、運動量 p = Σmv の時間変化を成分ごとに描きます。'
          + '★運動量はベクトルなので px と py を分けて見ます（大きさの和は保存しません）。'
          + '水平に外力が無ければ px は一定、重力があれば py は時間に比例して増えます。'
          + '非弾性衝突ではエネルギーが落ちても運動量は落ちないので、エネルギーのグラフと'
          + '並べて見るのがおすすめです')) +
    (!eneGraphReady()
      ? ctxItemOff(ctxChk(null, false) + 'エネルギー',
          objects.some(o => selectedIds.has(o.id) && !energyDriven(o)) ? FULL : '固定した物体・等速の物体は系に入らないので描けません') :
    ctxItem(ctxChk(null, eneOpen) + 'エネルギー', 'toggleEnergyGraph()', null,
            '選んだ物体をひとまとめの「系」として、運動エネルギーと重力による位置エネルギーを1枚に積み上げます'));
  // ★波の受信計は水面波があるときだけ出す（波源が1つも無い画面では意味が無い）
  if (waveSources.length)
    items += !waveGraphReady() ? ctxItemOff(ctxChk(null, false) + '波の受信（y-t と振動数）', FULL) : ctxItem(ctxChk(null, !!sel.length && sel.every(o => waveGraphOf(o.id))) + '波の受信（y-t と振動数）',
            'toggleWaveGraph()', null,
            'その物体の位置で水面波の変位を読み、y-t のグラフと、そこから測った振動数を描きます。'
          + '振動数は上向きのゼロ交差の間隔（f = 1/T）＝「単位時間に何個の波面と出会ったか」そのものです。'
          + '★うなっている間も振動数は出ます（2つの平均で一定。変わるのは大きさだけ）。'
          + '弱め合う瞬間と、振動数が離れすぎているときだけ、数値を出さずに理由を書きます');
  if (world.thermalOn) {
    items +=
      ctxItem(ctxChk(null, tmpOpen) + '温度', 'toggleTempGraph()', null,
              '選んだ物体の温度を1枚に重ねます。液体・気体があれば平均温度も一緒に描きます'
            + '（熱いおもりを水に入れて、両方が同じ温度へ近づく様子をそのまま見られます）');
    if (tmpAdd)
      items += ctxItem('温度：開いているグラフに追加', 'ctxAddToTempGraph()', null,
              '新しい窓を開かず、いちばん新しい温度グラフへ系列として足します。足した時点から線が始まります');
  }
  return ctxSubmenu('グラフを表示', items, false);
}
// 粒子（液体・気体分子）を選んでいるときのグラフ項目。
//   ★下位メニューの形は、個数–速さ（マクスウェル分布）の窓があったころの名残。速さの分布は
//     範囲に置く計器（spdmeter.js）に移したので、いまは温度の1項目だけ。
//   ★温度は「選んだ分子」ではなく**世界じゅうの分子**が対象になる（tgBuildSeries）。分子運動論の
//     温度は集団そのもので、分子1個・一部分には配れないため。選択が効かないことは title で断っておく
//     （そう書かないと「選んだぶんの温度」に見える）。
function ctxParticleGraphItem() {
  if (!world.thermalOn) return '';
  const tip = 'いまシミュレーション上にいる液体・気体それぞれの平均温度を、時間のグラフに描きます。\n'
            + '★気体は、選んだ分子だけでなく世界じゅうの気体分子ぜんぶの温度です'
            + '（温度は集団の速度分布そのもので、分子一部には配れないため）。\n'
            + '物体も一緒に見たいときは、その物体を選んでグラフの「＋選択を追加」を押してください。';
  const temp = !tempGraphReady()
    ? ctxItemOff(ctxChk(null, false) + '温度のグラフ',
        tempGraphs.length >= TG_MAX_WINDOWS
          ? 'グラフは同時に' + TG_MAX_WINDOWS + '個までです。どれかを閉じてください'
          : tip)
    : ctxItem(ctxChk(null, !!tempGraphOfSelection()) + '温度のグラフ', 'toggleTempGraph()', null, tip);
  return ctxSubmenu('グラフを表示', temp, false);
}
// 気体（ピストン容器の中身）のグラフ。物体の ctxGraphSub とは作りが2つ違う：
//   ・状態量どうしの図は1種類（P-V 図）の窓だけで、選ぶのは「どの2つを軸に取るか」
//   ・★その3つは横軸が時間ではない。3つとも同じ1枚の窓で、選び直すと軸だけ差し替わる。
//     だから「もう1つ開く」ではなく、✔の付いた軸をもう一度選ぶと閉じる（toggleGasGraph）
//   ★時間を横軸に取りたいときのために、温度 – 時間（温度グラフ）もここから開けるようにする。
//     「同じ熱を入れているのに温度の上がりかたが違う」は時間軸でしか見えないので、
//     P–T・V–T だけでは足りない。窓は世界に1枚で、場にある気体室ぜんぶが系列になる
//     （tgBuildSeries）＝この器だけの窓ではないことを説明に書く。
function ctxGasGraphSub(ch) {
  const g = pvGraphOf(ch.id);
  const row = (mode, label, tip) => !pvGraphReady(ch)
    ? ctxItemOff(ctxChk(null, false) + label, 'P-V 図の窓が上限に達しています。どれかを閉じてください') :
    ctxItem(ctxChk(null, !!g && g.mode === mode) + label, `toggleGasGraph('${mode}')`, null, tip);
  const tTip = '温度の時間変化を描きます（横軸が時間のグラフ。上の3つとは別の窓です）。\n'
             + '★この器だけでなく、場にある気体の容器ぜんぶが器ごとに1本ずつ描かれます。\n'
             + '同じ加熱器に載せた定積の器と定圧の器を並べると、入れた熱が同じでも'
             + '温度の上がりかたが違うことがそのまま読めます。';
  const temp = !tempGraphReady()
    ? ctxItemOff(ctxChk(null, false) + '温度 – 時間のグラフ',
        world.thermalOn ? 'グラフの窓が上限に達しています。どれかを閉じてください'
                        : '熱のやりとりがOFFです（全体設定タブの「熱」で入れてください）')
    : ctxItem(ctxChk(null, !!tempGraphOfSelection()) + '温度 – 時間のグラフ',
        'toggleTempGraph()', null, tTip);
  return ctxSubmenu('グラフを表示',
      row('pv', 'P–V 図（圧力 – 体積）',
          '気体の状態が (V, P) 平面をどう動いたかを描きます。閉じた経路が囲む面積が、'
        + 'そのサイクルで気体がした仕事にあたります。等温線を重ねると、断熱変化では'
        + 'たどった線がそれより急に立つのが見えます')
    + row('pt', 'P–T 図（圧力 – 温度）',
          '定積変化なら原点を通る直線になります')
    + row('vt', 'V–T 図（体積 – 温度）',
          '定圧変化なら原点を通る直線になります（シャルルの法則）')
    + temp,
    false);
}
// 管でつなぐ相手を選ぶ。
//   ★一度きりの操作なので右クリック側に置く（右パネルは値、右クリックは操作）。
//     コックの開け閉めだけが右クリックにあって、肝心の「つなぐ」が右パネルにあった。
//   ★恒温槽の有無で相手を選り分けない。以前は「両方が恒温槽に浸かっていないと働かない」
//     という模型の都合をここで灰色にして伝えていたが、**門番はつなぐ瞬間しか見ないので、
//     つないだ後に恒温槽を外す経路が素通りしていた**（実測：管は描かれコックも出たまま、
//     圧力は 721.0 kPa と 101.3 kPa に割れる）。条件そのものを gas.js 側で無くしたので、
//     ここは選ばせるだけでよい。
//   ★**つなげるのは1対1**（linkId は相手を1つしか持てない）。つなぎ替えると前の管が
//     外れるので、いまどこへつながっているかを相手の名前に添える。黙って外すと、
//     3つ目をつないだ瞬間に2本目の管が理由なく消えたように見える。
function ctxGasLinkSub(ch) {
  const tip = '別の気体と管でつなぎます。つないだ2つは圧力が共通になり、気体が行き来します'
            + '（中身が1つの気体になります）。\n'
            + 'スターリング機関のように、高温側と低温側を1つの気体が往復する装置が作れます。\n'
            + '片方を真空にしておいて開けば、断熱自由膨張（ジュールの実験）になります。';
  const others = gasChambers.filter(o => o.id !== ch.id);
  if (!others.length) return ctxItemOff('管でつなぐ', 'つなぐ相手になる気体が、ほかにありません');
  let inner = '';
  for (const o of others) {
    const on = ch.linkId === o.id;
    // 相手がすでに別の相手とつながっているか（つなぐと、そちらの管は外れる）
    const busy = !on && o.linkId != null && o.linkId !== ch.id
               ? gasChambers.find(c => c.id === o.linkId) : null;
    const label = ctxChk(null, on) + gasChamberLabel(o)
                + (busy ? `<span style="color:var(--text2);font-size:11px">（いま `
                        + gasChamberLabel(busy) + ` と接続）</span>` : '');
    inner += ctxItem(label, `ctxGasLink(${on ? 'null' : o.id})`, null,
      on ? 'もう一度押すと管を外します'
         : (busy ? `つなぐと、${gasChamberLabel(o)} と ${gasChamberLabel(busy)} の管は外れます`
                 + '（管は1つの気体につき1本までです）。\n' + tip
                 : tip));
  }
  // つなぎ替えで自分の管が外れることも先に言う（相手側だけ書くと片手落ちになる）
  if (ch.linkId != null) {
    const cur = gasChambers.find(c => c.id === ch.linkId);
    if (cur) inner += CTX_SEP + ctxItemOff('※ 管は1本まで（いま ' + gasChamberLabel(cur) + ' と接続）',
      '別の相手を選ぶと、この管は外れて新しいほうにつなぎ替わります');
  }
  return ctxSubmenu('管でつなぐ', inner, false, ctxChk(null, ch.linkId != null));
}
// 「力ベクトルを表示」「速度ベクトルを表示」。上部の表示メニューと同じ中身。
//   ★どちらも窓の中身は「出ている矢印の大きさ」なので、表示が OFF のあいだは開かない
//     （見出しのチェックで ON にすると、その場で開けるようになる）。
function ctxForceSub() {
  const on = selForcesOn();
  return ctxSubmenu('力ベクトルを表示',
    ctxSliderRow('力ベクトルの大きさ [px/N]', FVIZ_LOG_MIN, FVIZ_LOG_MAX, 0.02,
                 forceScaleLog(), 'ctx-fviz-val', 'forceScaleSetLog', 2, 'forceScaleLabel') +
    ctxItem(ctxChk('ctx-chk-legend', world.showForceLegend) + '力の凡例を表示',
            "event.stopPropagation();world.showForceLegend=!world.showForceLegend;ctxRefreshChecks()"),
    true, ctxChk('ctx-chk-forces', on), 'ctxToggleForces()', !on);
}
function ctxVelocitySub() {
  const on = selVelocityOn();
  return ctxSubmenu('速度ベクトルを表示',
    ctxSliderRow('速度ベクトルの大きさ [px/(m/s)]', 1, 40, 1, world.velVizScale,
                 'ctx-vviz-val', 'worldVelScale', 0),
    true, ctxChk('ctx-chk-vel', on), 'ctxToggleVelocity()', !on);
}
// 「電気力線の源にする」。電荷を持つ物体を選んでいるときだけ出す
//   （電荷が0の物体では場を作らないので、出しても意味がない）。
function ctxFieldSourceItem() {
  let hasCharge = false;
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b && b.charge) { hasCharge = true; break; } }
  if (!hasCharge) return '';
  return ctxItem(ctxChk('ctx-chk-fieldsrc', selFieldSourceOn()) + '電気力線の源にする',
    'event.stopPropagation();ctxToggleFieldSource()', null,
    '外すと、この電荷は電気力線・等電位線の絵から除かれます（表示だけの操作で、'
  + 'クーロン力はこれまでどおり全電荷どうしで働きます）。\n'
  + '源を1個に絞ると「電荷がつくる場」と「そこに置いた電荷が受ける力」を分けて見せられます。');
}
// 現在の選択対象に応じて右クリックメニューの項目だけを組み立てる
// 「同じ種類／同じ設定」の基準にするもの＝いま選んでいる1個。
//   注釈・地面・端（設定を持たない）は対象外。
//   ★2個以上選んでいるときは出さない（範囲選択でも Shift＋クリックでも同じ）。
//     基準がどれか画面から分からないうえ、押すと今の選択が消えてシーン全体へ広がる。
//     複数を選んだあとの右クリックは「まとめて操作」か「枠の中で絞り込み」のためのもので、
//     広げたいときは1個を選び直してから右クリックすればよい。
function ctxSameKindTarget() {
  if (selectedAnnotation) return null;
  if (selectedIds.size > 1 || selectedElemIds.size > 1 || (bulkKind && bulkIds.size > 1)
      || selectedJointEnds.size > 1 || selectedSlinkyEnds.size > 1
      || selectionKindGroups().length >= 2) return null;
  if (selectedIds.size > 0) {
    const b = bulkRep('body');
    return b ? { kind: 'body', o: b } : null;
  }
  if (selectedJointId != null) {
    const j = bulkRep('joint');
    return j ? { kind: 'joint', o: j } : null;
  }
  if (selectedCircuit) return { kind: 'circuit', o: selectedCircuit };
  if (selectedElement && BULK_KINDS[selectedElement.kind]) {
    const o = bulkRep(selectedElement.kind);
    return o ? { kind: selectedElement.kind, o } : null;
  }
  return null;
}
function ctxSameKindItems() {
  const t = _ctxSameTarget = ctxSameKindTarget();
  if (!t) return '';
  const name = _subLabel(BULK_KINDS[t.kind], t.o);
  const nKind = sameKindList(t, false).length;
  const hasSettings = !!BULK_SETTINGS[t.kind];
  const nSame = hasSettings ? sameKindList(t, true).length : 0;
  return ctxItem(`同じ種類（${name}）をすべて選択（${nKind}）`, 'selectSameKind(_ctxSameTarget,false)', null,
                 '設定が違っていても、同じ種類のものをシーン全体から選びます') +
    (hasSettings
      ? ctxItem(`同じ設定の${name}をすべて選択（${nSame}）`, 'selectSameKind(_ctxSameTarget,true)', null,
                '形・大きさ・材質・色などの設定がすべて同じものを選びます。'
              + '位置・向き・速度・温度などの状態と、名前・力や速度の矢印・軌跡の表示は比べません')
      : '') + CTX_SEP;
}
function buildCtxItems() {
  const item = ctxItem, sep = CTX_SEP, chk = on => ctxChk(null, on), chkId = ctxChk;
  // ★まとめて選んでいるときは、消えるのが1つでないことを見出しと「削除」に出す
  const _bulk = bulkSelectionInfo();
  const nSuffix = _bulk ? `（${_bulk.n}個）` : '';
  const delLabel = '削除' + nSuffix;
  // ⓪ 同じ種類・同じ設定のものをシーン全体から選ぶ（いちばん上に置く）
  let pre = ctxSameKindItems();
  // ⓪-a 範囲選択の枠の中で右クリックした＝枠の中身を種別で絞り込める
  if (_ctxInSelRect) {
    const gs = bulkGroupsInRect(lastSelRect);
    if (gs.length) {
      let sub = '';
      for (const g of gs) {
        const arg = g.sub == null ? 'null' : `'${g.sub}'`;
        sub += `<div class="ctx-item" onclick="selectOnlyKind('${g.kind}',${arg})">${g.label}のみ選択（${g.n}）</div>`;
      }
      pre += `<div class="ctx-label">選択範囲（${gs.length}種別）</div>` +
             `<div class="ctx-item ctx-submenu-parent" style="display:flex;align-items:center">` +
               `<span>種別で選び直す…</span><span style="color:var(--text2);margin-left:auto">▶</span>` +
               `<div class="ctx-submenu">${sub}</div>` +
             `</div>` + sep;
    }
  }
  // ⓪-c ヒンジ・モーター・溶接ツールを持っているとき：次に置くものの留め先（設定窓の「留め先」と同じ pinMode）
  if (PIN_TYPES.includes(currentTool)) {
    const nm = JOINT_TYPE_LABELS[currentTool];
    pre += `<div class="ctx-label">次に置く${nm}の留め先</div>` +
      item(chk(pinMode === 'pair')  + '重なった2つをつなぐ', "setToolPinMode('pair')") +
      item(chk(pinMode === 'board') + '重なったものを全部、背景に留める', "setToolPinMode('board')") + sep;
  }
  // ⓪-b この場所に複数の選択候補が重なっているとき、切り替え用サブメニューを置く
  if (_ctxCandidates.length >= 2) {
    let sub = '';
    for (let i = 0; i < _ctxCandidates.length; i++)
      sub += `<div class="ctx-item" onclick="ctxSelectCandidate(${i})">${_ctxCandidates[i].label}</div>`;
    pre += `<div class="ctx-label">この場所の要素（${_ctxCandidates.length}）</div>` +
          `<div class="ctx-item ctx-submenu-parent" style="display:flex;align-items:center">` +
            `<span>選択…</span><span style="color:var(--text2);margin-left:auto">▶</span>` +
            `<div class="ctx-submenu">${sub}</div>` +
          `</div>` + sep;
  }
  // 図形和は図形が2つ以上ないと意味がないので、そのときだけ出す
  //（右クリックメニューは短いほうが目的の項目を探しやすい）
  const booleanSub = () => {
    if (selectedIds.size < 2) return '';
    let sub = '';
    for (const [key, label, title] of BOOLEAN_OPS)
      sub += `<div class="ctx-item" title="${title}" onclick="applyClipper('${key}')">${label}</div>`;
    return `<div class="ctx-item ctx-submenu-parent" style="display:flex;align-items:center">` +
             `<span>図形和（${selectedIds.size}個）</span>` +
             `<span style="color:var(--text2);margin-left:auto">▶</span>` +
             `<div class="ctx-submenu">${sub}</div>` +
           `</div>`;
  };
  // ⓪-c 注釈（テキスト・お絵描き）を選択中。ほかの選択とは同時に立たないので先に返す。
  //   注釈は物体のプロパティ（質量・材質…）を一切持たないため、専用の短いメニューになる。
  if (selectedAnnotation) {
    const a = selectedAnnotation;
    return pre + `<div class="ctx-label">注釈（物理には影響しません）</div>` +
      (a.type === 'text' ? item('文字を書き直す', 'ctxEditAnnotation()') : '') +
      item('コピー', 'ctxCopy()') +
      (annotClipboard ? item('貼り付け', 'ctxPaste()') : '') +
      item('複製', 'ctxDuplicate()') + sep +
      item(chkId('ctx-chk-annot-front', a.front) + '物体より手前に出す',
           'event.stopPropagation();ctxToggleAnnotFront()', null,
           '既定は背面（物体の下）。物体に隠れて読めないときだけ手前へ出します') +
      ctxMirrorChk('annot-nospin') +
      ctxMirrorChk('annot-bold') +
      ctxMirrorSelect('annot-font') + sep +
      item('削除', 'ctxDelete()', 'color:#ef5350');
  }
  // ① 物体を選択中：従来のフルメニュー
  if (selectedIds.size > 0) {
    return pre + `<div class="ctx-label">オブジェクト</div>` +
      item('コピー', 'ctxCopy()') +
      (clipboard ? item('貼り付け', 'ctxPaste()') : '') +
      // ★プロパティだけを配る（形・位置は含まない）。写すのは質量ではなく密度。
      //   コピー元が決まらないので、コピーは1個選択のときだけ押せる。
      (selectedIds.size === 1
        ? item(propCopyLabel(), 'copyBodyProps()', null,
               '選んだ物体の材質・光学・見た目の設定を控えます（形や位置は含みません）')
        : ctxItemOff(propCopyLabel(), 'コピー元が決まらないので、1個だけ選んでからお使いください')) +
      (propClipboard
        ? (propPasteTargets().length
            ? item(propPasteLabel(), 'pasteBodyProps()', null, propPasteTitle())
            : ctxItemOff(propPasteLabel(), propPasteTitle()))
        : '') +
      item('複製', 'ctxDuplicate()') + sep +
      ctxTransformSub() +
      booleanSub() + sep +
      // ★「動きの制限」の3つは、押してもメニューを閉じずに✔だけ書き換える。
      //   右パネルのチェックボックスと同じ感覚で続けて切り替えられる（表示メニューと同じ流儀）。
      item(chkId('ctx-chk-static', selStaticOn()) + '背景に固定',
           'event.stopPropagation();ctxSetStatic()') +
      ctxMirrorChk('p-constvel') +
      ctxMirrorChk('p-hasgravity') +
      item(chkId('ctx-chk-fixrot', selFixRotOn()) + '回転しない',
           'event.stopPropagation();ctxToggleFixRot()') +
      ctxGuideSub() +
      ctxLayerSub() + sep +
      // ★その物体の性質の切り替え（熱・容器・波・光学・電荷）。どれも右パネルで
      //   欄が出ているときだけ出る（熱OFF・透明でない・スクリーンでない…では出ない）
      ctxOptSection(
        ctxMirrorChk('p-tempfixed') +
        ctxMirrorChk('p-gas-vent') +
        ctxMirrorSelect('p-wavemode') +
        ctxMirrorChk('p-fresnel') +
        ctxMirrorChk('p-dispersion') +
        ctxMirrorChk('p-screenprof') +
        ctxMirrorChk('p-optic-ideal') +
        ctxCoulombItem()) +
      ctxGraphSub() +
      ctxForceSub() +
      ctxVelocitySub() +
      ctxFieldSourceItem() + sep +
      item(delLabel, 'ctxDelete()', 'color:#ef5350');
  }
  // ② ジョイントを選択中。まとめて選んでいるときは型名を出す（「ヒンジ（3個）」）
  //   ★ロープの「先端おもり」もここで出す。以前は下の④に書いてあったが、そこへは
  //     決して来ない：ジョイントの端を拾うと selectUnderCursorForCtx / キャンバスの
  //     左クリックのどちらも selectedElement と selectedJointId の両方を立てるので、
  //     必ずこの②で返ってしまう（＝ロープの端を右クリックしても削除しか出なかった）。
  if (selectedJointId != null) {
    // ★端をまとめて選んでいるときは、端に対する操作を出す（ジョイント本体の削除より先）。
    //   端は設定値を持たないので「まとめて設定」には乗らない。操作だけを並べる。
    if (selectedJointEnds.size > 1) {
      const n = selectedJointEnds.size;
      const op = (label, o, tip) => {
        const k = bulkJointEndOpCount(o);
        return k ? item(`${label}（${k}個）`, `bulkJointEndOp('${o}')`, null, tip) : '';
      };
      return pre + `<div class="ctx-label">選んだ端 ${n}個</div>` +
        op('先端おもりを付ける', 'tip',
           '背景に固定した端に、掴むためのおもりを付けます。付いていない自由な端だけが対象です') +
        op('先端おもりを外す', 'untip',
           'おもりを外して、おもりがあった位置に固定した端へ戻します') +
        op('背景に固定', 'bg',
           '取り付け先（物体・地面）から外して、いまの位置に杭を打ちます。何があっても動かなくなります') +
        op('地面に固定', 'ground',
           '地面へ打ち込みます。端は地面の表面へ吸着し、地面を傾ける・上下させると一緒に動きます') +
        sep + item(delLabel, 'ctxDelete()', 'color:#ef5350');
    }
    const _j = joints.find(x => x.id === selectedJointId);
    return pre + `<div class="ctx-label">${_bulk ? _bulk.label : 'ジョイント'}${nSuffix}</div>` +
      ropeTipItems(_j) +
      // ★モーターの「放したら止める」。リモコンを放した瞬間の振る舞い（惰性で回る／姿勢を
      //   保つ）が変わるので、荷を載せた台を少しずつ傾ける題材では走らせながら何度も往復する。
      //   押してもメニューは閉じず✔だけ書き換える（物体の「回転しない」と同じ流儀）。
      //   ★「速度ツールで解放する」と衝突レイヤーはここに出さない。前者は仕込みで一度決めたら
      //     動かさず、後者は物体のものと同じ窓を作り直すことになるため（どちらも右パネルに残す）。
      (_j && _j.type === 'axle'
        ? item(chkId('ctx-chk-mbrake', !!_j.motorBrake) + '放したら止める',
               'event.stopPropagation();ctxToggleMotorBrake()', null,
               '切＝軸が自由になり惰性で回ります（車輪はこちら）。'
             + '入＝リモコンを放した姿勢のまま止まります（荷を載せた台を少しずつ動かすときはこちら）')
        : '') +
      // ★留め先の切り替え（右パネルの「留め先」と同じ setPinModeOf）。
      //   重なりが1つの点はどちらでも背景に留まるので、灰色で出して理由を添える（消すと
      //   「ここでは選べない」のか「この機能が無い」のか分からない）。
      ((_j && PIN_TYPES.includes(_j.type))
        ? (pinModeOf(_j) === 'single'
            ? ctxItemOff(ctxChk(null, false) + '留め先：重なった2つをつなぐ', PIN_SINGLE_NOTE) +
              ctxItemOff(ctxChk(null, false) + '留め先：重なったものを全部、背景に留める', PIN_SINGLE_NOTE)
            : item(chkId(null, pinModeOf(_j) === 'pair') + '留め先：重なった2つをつなぐ',
                   `setPinModeOf(joints.find(x=>x.id===${_j.id}),'pair')`) +
              item(chkId(null, pinModeOf(_j) === 'board') + '留め先：重なったものを全部、背景に留める',
                   `setPinModeOf(joints.find(x=>x.id===${_j.id}),'board')`)) + sep
        : '') +
      // ★可動域・速度ツールで解放・衝突レイヤーも右パネルの欄から映す（型ごとの出し分けは右パネル任せ）
      ctxOptSection(
        ctxMirrorChk('j-alimit') +
        ctxMirrorChk('j-releasable') +
        ctxMirrorLayerSub('j-layer')) +
      item(delLabel, 'ctxDelete()', 'color:#ef5350');
  }
  // ③ 回路素子を選択中：削除（消えるのは、その1本＝クリックした点と点の間だけ）。
  //    スイッチは開閉、向きのある素子（電源・ダイオードなど）は反転もここから行える。
  //    どれも右パネルと同じ関数を呼ぶので、一括選択・Undo の扱いは入口によらず同じ。
  if (selectedCircuit) {
    const ct = selectedCircuit.type;
    return pre + `<div class="ctx-label">回路（${CIRCUIT_LABELS[ct] || '素子'}）${nSuffix}</div>` +
      (ct === 'switch'
        ? item(selectedCircuit.closed ? '開く（OFF）' : '閉じる（ON）', 'toggleSelectedSwitch()') + sep
        : '') +
      (CIRCUIT_DIRECTIONAL.has(ct) ? item('向きを反転', 'flipSelectedCircuit()') + sep : '') +
      ctxOptSection(ctxMirrorChk('c-burnt') + ctxMirrorChk('c-nc')) +
      // ★グラフへの出し入れ。右パネルの「グラフに追加」ボタンと同じ関数を通す
      item(circGraphOf(selectedCircuit.id) ? 'グラフから外す' : 'グラフに追加',
           'toggleCircGraphPin()',
           null, '電圧・電流の時間変化をグラフの窓に出します。同じ回路の窓が既にあれば、そこへ足されます') +
      ctxMirrorBtn('c-table-btn') +
      ctxStorageResetItem() + sep +
      item(delLabel, 'ctxDelete()', 'color:#ef5350');
  }
  // ④ 要素（レーザー/動力/軌跡）を選択中：削除のみ（地面は不可）
  //   ★範囲選択でレーザー・波源を掴んでいるときは ④-b に譲る。あちらは件数と内訳を
  //     出すので、代表1つぶんの見出しで上書きしてしまわないようにする
  //     （refreshPropsForSelection が「まとめて設定」の代表として selectedElement を立てる）。
  if (selectedElement && selectedElement.kind !== 'ground' && !selectedElemList().length) {
    // ★ジョイントはここへ来ない（②で返る）。names に joint を残してあるのは保険。
    const names = { laser:'レーザー', thruster:'動力', tracer:'軌跡', joint:'ジョイント',
                    wave:'波源', string:'弦', slinky:'ばね', emfield:'場の領域',
                    heatfield:'加熱・冷却の領域', flowfield:'流れの場',
                    particle:'粒子', gas:'気体' };
    const isGas = selectedElement.kind === 'gas';
    // 粒子（液体・気体分子）の温度グラフ。熱がOFFなら空文字＝項目ごと出ない
    const pclGraph = selectedElement.kind === 'particle' ? ctxParticleGraphItem() : '';
    // ★熱を通す壁（気体）
    const gasWall = isGas ? ctxMirrorSelect('p-gas-wall') : '';
    return pre + `<div class="ctx-label">${names[selectedElement.kind]||'要素'}${nSuffix}</div>` +
      // ★ばねの先端おもり（ロープの端と同じ操作を、同じ場所から出す）と、見せ方の3つ
      (selectedElement.kind === 'slinky'
        ? slinkyGraphItems(selectedElement.slinky) + slinkyTipItems(selectedElement.slinky)
          + slinkyViewItems(selectedElement.slinky)
          + ctxOptSection(ctxMirrorChk('slk-guide') + ctxMirrorChk('slk-beads')
                          + ctxMirrorBtn('slk-reset-btn'))
        : '') +
      // ★レーザーの出し方（白色光・取り付けた物体との相互作用・出力形式・干渉）
      (selectedElement.kind === 'laser'
        ? ctxOptSection(ctxMirrorChk('laser-white') + ctxMirrorChk('laser-interact-host')
                        + ctxMirrorSelect('laser-beam-mode') + ctxMirrorChk('laser-coherent'))
        : '') +
      // ★領域の種類・向き
      (selectedElement.kind === 'emfield' ? ctxOptSection(ctxMirrorSelect('emf-p-dir')) : '') +
      (selectedElement.kind === 'flowfield'
        ? ctxOptSection(ctxMirrorSelect('ff-p-mode') + ctxMirrorSelect('ff-p-medium')) : '') +
      // ★粒子の軌跡と色の戻し
      (selectedElement.kind === 'particle'
        ? ctxOptSection(ctxMirrorChk('pcl-tracer')
                        + item('色を既定に戻す', 'resetParticleColor()', null,
                               '選んだ粒子の色を、その種類の既定の色に戻します'))
        : '') +
      // ★波源の発振 ON/OFF。右パネルのチェックボックス（発振する）と同じものを出す。
      //   干渉の題材では「片方だけ止めて単独の波面と見比べる」「1発だけ出して反射を追う」を
      //   走らせながら何度も繰り返すので、そのたびに右パネルへ行き来させない
      //   （気体のコックと同じ扱い）。押してもメニューは閉じず✔だけ書き換える。
      (selectedElement.kind === 'wave'
        ? item(chkId('ctx-chk-wave-on', !!selectedElement.source.enabled) + '発振する',
               'event.stopPropagation();ctxToggleWaveEnabled()', null,
               '切ると波を出すのをやめます。すでに出ている波はそのまま進み、減衰して消えます') + sep : '') +
      // ★波源とレーザーは複製できる（同じ設定のものを並べる＝干渉や平行光線の実演で
      //   いちばん使う操作。位置だけずらして置き直す手間が要らない）
      (selectedElement.kind === 'wave' || selectedElement.kind === 'laser'
        ? item('複製', 'ctxDuplicate()') + sep : '') +
      // ★波源の窓にある波動場の表示・計算の上限（全体設定と同じ値）
      (selectedElement.kind === 'wave'
        ? ctxOptSection(ctxMirrorSelect('wf-waveview') + ctxMirrorSelect('wf-wavebudget')) : '') +
      // ★気体の状態変化のグラフ。右パネルの「P-V 図」ボタンと同じ窓を、軸を選んで開く
      (isGas ? ctxGasGraphSub(selectedElement.chamber) + sep : '') +
      // ★定積（ピストンを器に固定）。右パネルのラジオと同じ操作を、物体の「背景に固定」と
      //   同じ場所・同じ流儀（押してもメニューを閉じず✔だけ書き換える）でここにも出す。
      //   P-V 図をたどらせる題材では、加熱しながら何度も入り切りするのがこの操作だけで、
      //   そのたびに右パネルへ行き来するのは手数が多すぎる。
      (isGas ? item(chkId('ctx-chk-gaslock', !!selectedElement.chamber.pistonLocked)
                    + 'ピストンを固定（定積）',
                    'event.stopPropagation();ctxToggleGasLock()')
             // ★等温（恒温槽に浸ける）。定積と同じく、右パネルのラジオと同じ操作をここにも出す。
             //   ボイルの法則をたどらせる題材では、断熱と等温を何度も往復するのがこの操作。
             + item(chkId('ctx-chk-gasiso', selectedElement.chamber.thermostat != null)
                    + '恒温槽に浸ける（等温）',
                    'event.stopPropagation();ctxToggleGasIso()')
             // ★管でつなぐ。つないだあとのコックと並べて置く（順に「つなぐ→開け閉め」）
             + gasWall
             + ctxGasLinkSub(selectedElement.chamber)
             // ★管のコック。つないでいるときだけ出す（実行しながら開け閉めしたい操作）
             + (selectedElement.chamber.linkId != null
                ? item(chkId('ctx-chk-gascock', !!selectedElement.chamber.linkOpen)
                       + '管のコックを開く',
                       'event.stopPropagation();ctxToggleGasCock()') : '')
             // ★帳簿（Q・W・ΔU）の起点。状態変化の切り替えは右クリックだけで回せるのに、
             //   1サイクルの測り始めを決めるこれだけが右パネルにあった。切り替えでは
             //   0に戻らない作りなので（uiGasProcess の★）、起点を打つ操作は変化を
             //   選ぶ操作と同じ場所に無いと、周回のたびに右パネルへ戻ることになる。
             + item('帳簿をリセット', 'uiGasResetLedger()', null,
                    'Q・W・ΔU と P-V 図の線を、いまの状態を起点に取り直します'
                  + '（状態変化を切り替えても0には戻らないので、1サイクルを測る前にここで起点を決めます）')
             + sep : '') +
      // ★粒子（液体・気体分子）は温度のグラフ。熱がOFFなら項目ごと出ない（ctxGraphSub と同じ）
      (pclGraph ? pclGraph + sep : '') +
      // ★気体の削除は器・蓋ごと。deleteSelectedElement のとおり「気体だけ抜いた空の器」は
      //   モデルに無いので、消えるものが見た目と食い違わないよう title で断っておく
      item(delLabel, 'ctxDelete()', 'color:#ef5350',
           isGas ? '器と蓋ごと削除します（気体だけを抜いた「空の器」は扱えないため）' : null);
  }
  // ④-b 範囲選択でレーザー・波源を掴んでいる（クリック選択とは別の入れ物に入る）。
  //     物体の複数選択と同じく、まとめて複製・削除できる
  const _selElems = selectedElemList();
  if (_selElems.length) {
    const nL = _selElems.filter(o => o instanceof Laser).length;
    const nW = _selElems.length - nL;
    const kindLabel = nL && nW ? 'レーザー・波源' : (nL ? 'レーザー' : '波源');
    return pre + `<div class="ctx-label">${kindLabel}（${_selElems.length}個）</div>` +
      item('複製', 'ctxDuplicate()') + sep +
      item('削除（' + _selElems.length + '個）', 'ctxDelete()', 'color:#ef5350');
  }
  // ④-c 地面。値（反発・摩擦）以外の、波の扱い・衝突レイヤー・表示・傾きの戻しを出す
  if (selectedElement && selectedElement.kind === 'ground') {
    return pre + `<div class="ctx-label">地面</div>` +
      ctxMirrorSelect('g-wavemode') +
      ctxMirrorLayerSub('g-layer') +
      ctxMirrorChk('g-terrain') +
      (ground.angle !== 0
        ? item('傾きをリセット', 'ctxGroundAngleReset()', null, '地面の傾きを0°に戻します') : '') +
      (clipboard ? sep + item('貼り付け', 'ctxPaste()') : '');
  }
  // ⑤ 背景・地面など：貼り付けのみ（対象非依存）。それも無ければ操作対象なし
  if (clipboard) {
    return pre + item('貼り付け', 'ctxPaste()');
  }
  return pre + `<div class="ctx-item" style="color:var(--text2);cursor:default" onclick="event.stopPropagation()">操作対象が存在しません</div>`;
}
const PIN_SINGLE_NOTE = 'この点に重なっている物体は1つだけなので、どちらの留め先でも背景に留まります';
// ジョイントがつないでいる2つの名前（「太陽歯車—背景」）。物体は名札、無ければ形と番号。
function jointEndsLabel(j) {
  const nm = (b, g) => b ? (b.label || ({ circle:'円', box:'四角', polygon:'多角形' }[b.type] || '物体') + ' ' + b.id)
                         : (g ? '地面' : '背景');
  return nm(j.bodyA, j.groundA) + '—' + nm(j.bodyB, j.groundB);
}
// カーソル位置に重なっている「選択できるもの」を、要素マーカー→ジョイント→物体→回路→地面の順に列挙する。
// 各項目の apply() は、左クリック選択と同じ状態遷移（単一選択へ切り替え）を行う。
function collectSelectablesAt(wx, wy) {
  const list = [];
  const mth = 9 / cam.zoom, mth2 = mth * mth;   // マーカーの当たり半径（pickElement と同じ）
  const lth = 8 / cam.zoom;                     // 線の当たり半径（jointAtPoint 等と同じ）
  const near2 = (px, py) => (wx-px)*(wx-px) + (wy-py)*(wy-py) <= mth2;
  const segNear = (ax, ay, bx, by) => {
    const cp = _closestPtSeg(wx, wy, ax, ay, bx, by);
    return len(wx - cp.x, wy - cp.y) <= lth;
  };
  const setSel = t => document.getElementById('st-sel').textContent = t;
  // ① 要素マーカー（本来は物体より前面で拾われて、下の物体を隠してしまうもの）
  for (const L of lasers) { const o = L.getOrigin(); if (near2(o.x, o.y)) list.push({
    label:'レーザー', apply: () => { clearAllSelections(); selectedElement = { kind:'laser', laser:L }; updateLaserPanel(L); setSel('レーザー'); } }); }
  for (const S of waveSources) { const o = S.getOrigin(); if (near2(o.x, o.y)) list.push({
    label:'波源', apply: () => { clearAllSelections(); selectedElement = { kind:'wave', source:S }; updateWavePanel(S); setSel('波源'); } }); }
  for (const b of objects) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    // ★動力は1本ずつ候補に出す（同じ物体に何本も付くので、重なっていれば全部並ぶ）
    for (const th of b.thrusters) {
      const p = th.worldPos();
      const n = b.thrusters.length > 1 ? ` ${b.thrusters.indexOf(th) + 1}` : '';
      if (near2(p.x, p.y)) list.push({ label:'動力' + n, apply: () => { clearAllSelections(); selectedElement = { kind:'thruster', body:b, thr:th }; updateThrusterPanel(th); setSel('動力'); } });
    }
    if (b.tracerEnabled) {
      const tx = b.x + b.tracerAnchorX*c - b.tracerAnchorY*s;
      const ty = b.y + b.tracerAnchorX*s + b.tracerAnchorY*c;
      if (near2(tx, ty)) list.push({ label:'軌跡', apply: () => { clearAllSelections(); selectedElement = { kind:'tracer', body:b }; updateTracerPanel(b); setSel('軌跡'); } });
    }
    if (b.arCoats) for (let i = 0; i < b.arCoats.length; i++) {
      for (const end of ['A', 'B']) {
        const p = arCoatEndPos(b, i, end);
        if (!near2(p.x, p.y)) continue;
        const el = { kind:'arcoat', body:b, index:i, end };
        list.push({ label:'反射防止コートの端', apply: () => { clearAllSelections();
          selectedElement = el; updateArCoatPanel(el); setSel('反射防止コート'); } });
      }
    }
  }
  // ② ジョイント（端点マーカー or 線）。1本につき1項目
  const seenJ = new Set();
  for (const j of joints) {
    const a = j.getWorldAnchorA(), b2 = j.getWorldAnchorB();
    let hit = near2(a.x, a.y) || near2(b2.x, b2.y);
    if (!hit) {
      if (j.type === 'rope') { ensureRopeNodes(j); const pts = [a, ...j.nodes, b2];
        for (let k = 0; k < pts.length - 1 && !hit; k++) hit = segNear(pts[k].x, pts[k].y, pts[k+1].x, pts[k+1].y);
      } else hit = segNear(a.x, a.y, b2.x, b2.y);
    }
    if (hit && !seenJ.has(j.id)) {
      seenJ.add(j.id);
      // ★見出しにつないでいる2つの名前を出す。同じ点に重なった軸（遊星歯車の中心の
      //   太陽・腕・裏板など。「背景まで刺す」で1度に打てる）は、型の名前だけでは
      //   どれも「ジョイント（モーター）」になって選び分けられない。
      list.push({ label: 'ジョイント（' + (JOINT_TYPE_LABELS[j.type] || j.type) + '：' + jointEndsLabel(j) + '）',
        apply: () => { clearAllSelections(); selectedJointId = j.id; selectedElement = { kind:'joint', joint:j, end:'A' }; updateJointPanel(j); setSel('ジョイント'); } });
    }
  }
  // ②-b 気体（ピストン容器の中身）。selectUnderCursorForCtx と同じ順＝物体より先に並べる。
  //     ★器のU字の内側は器の多角形の外なので普段は奪い合わないが、蓋の縁と重なる位置では
  //       候補が2つになる。片方の経路にだけ出すと、いったん器を選んだあと気体へ戻れない。
  for (let i = gasChambers.length - 1; i >= 0; i--) {
    const ch = gasChambers[i];
    if (!ch.piston() || !pointInPolygon({ x: wx, y: wy }, ch.corners())) continue;
    list.push({ label: '気体' + (ch.label ? '（' + ch.label + '）' : ''),
      apply: () => { clearAllSelections(); selectedElement = { kind:'gas', chamber:ch };
                     updateGasPanel(ch); setSel('気体'); } });
  }
  // ③ 物体（前面→背面）。★生成口は上に積もった物体より先に並べる＝左右クリックと同じ順。
  //   ここは一覧なので順が変わるだけで、下の物体もそのまま選べる（重なったときの逃げ道）。
  const objHits = [];
  for (let i = objects.length - 1; i >= 0; i--)
    if (objects[i].containsPoint(wx, wy)) objHits.push(objects[i]);
  objHits.sort((p, q) => (q.isSpawner ? 1 : 0) - (p.isSpawner ? 1 : 0));   // 安定＝同格なら前面のまま
  for (const b of objHits) {
    const shape = { circle:'円', box:'四角', polygon:'多角形' }[b.type] || '?';
    list.push({ label: shape + '（' + (b.label || 'Object ' + b.id) + '）',
      apply: () => { clearAllSelections(); selectedIds.add(b.id); updatePropsPanel(b); setSel('1個'); } });
  }
  // ④ 回路素子
  const seenC = new Set();
  for (let i = circuitElements.length - 1; i >= 0; i--) {
    const e = circuitElements[i];
    if (seenC.has(e.id)) continue;
    if (segNear(e.ax, e.ay, e.bx, e.by)) { seenC.add(e.id);
      list.push({ label: '回路（' + (CIRCUIT_LABELS[e.type] || '素子') + '）', apply: () => selectCircuitElement(e) }); }
  }
  // ⑤ 電場・磁場の領域（面なので物体・ジョイント・回路より後ろ。地面より手前）
  //    並び順＝オブジェタブの一覧の順。上にあるものから並べる（emFieldAtPoint と同じ）
  for (const f of emFields) {
    if (!f.contains(wx, wy)) continue;
    list.push({ label: (f.kind === 'E' ? '電場' : '磁場') + 'の領域',
      apply: () => { clearAllSelections(); selectedElement = { kind:'emfield', field:f };
                     updateEMFieldPanel(f); setSel(f.kind === 'E' ? '電場' : '磁場'); } });
  }
  // ⑤-b 加熱・冷却の領域（電場・磁場と同じ扱い）
  for (const f of heatFields) {
    if (!f.contains(wx, wy)) continue;
    list.push({ label: f.kindName() + 'の領域',
      apply: () => { clearAllSelections(); selectedElement = { kind:'heatfield', field:f };
                     updateHeatFieldPanel(f); setSel(f.kindName()); } });
  }
  // ⑤-c 流れの場（同上）
  for (const f of flowFields) {
    if (!f.contains(wx, wy)) continue;
    list.push({ label: '流れの場',
      apply: () => { clearAllSelections(); selectedElement = { kind:'flowfield', field:f };
                     updateFlowFieldPanel(f); setSel('流れの場'); } });
  }
  // ⑥ 地面
  if (world.terrain && signedDistToGround(wx, wy) <= 4 / cam.zoom)
    list.push({ label:'地面', apply: () => { clearAllSelections(); selectedElement = { kind:'ground' }; updateGroundPanel(); setSel('地面'); } });
  return list;
}
function ctxSelectCandidate(i) {
  const c = _ctxCandidates[i];
  if (c) c.apply();   // メニューは document のクリックハンドラで自動的に閉じる
}
document.addEventListener('click', ()=>{ document.getElementById('ctx-menu').style.display='none'; });
function ctxCopy() {
  // ★注釈と物体は同時に選べないので、控えも一方だけを持つ（両方に中身が残ると、
  //   貼り付けたときにどちらが出るか予測できなくなる）。
  if (selectedAnnotation) { annotClipboard = serializeAnnotation(selectedAnnotation); clipboard = null; return; }
  if (selectedIds.size===0) return;
  annotClipboard = null;
  clipboard=[];
  for (const id of selectedIds) {
    const b=objects.find(o=>o.id===id);
    if (b) clipboard.push(JSON.parse(JSON.stringify(b)));
  }
}
function ctxPaste() {
  if (annotClipboard) { pasteAnnotation(); return; }
  if (!clipboard) return;
  pushUndo();   // ★
  selectedIds.clear(); selectedElemIds.clear(); selectedJointEnds.clear();
  for (const data of clipboard) {
    // ★動力の id も採り直す（物体の id と同じ理由）。残したままだと、貼り付けた
    //   ぶんが元と同じ番号の動力を持ち、リモコンがどちらを指しているのか決まらない。
    const thrs = (data.thrusters || []).map(t => ({ ...t, id: undefined }));
    const b=new Body({...data, id:undefined, thrusters:thrs, x:data.x+30, y:data.y+30});
    reanchorGuide(b);
    objects.push(b);
    selectedIds.add(b.id);
  }
}
// 複製。物体だけでなくレーザー・波源も対象にする（範囲選択で混ざっていればまとめて複製する）
function ctxDuplicate() {
  if (selectedAnnotation) { ctxCopy(); ctxPaste(); return; }   // ★注釈
  const beams = selectedLasers(), waves = selectedWaveSources();
  if (!beams.length && !waves.length) { ctxCopy(); ctxPaste(); return; }   // 従来どおり物体だけ
  if (!selectedIds.size) { duplicateSelectedElements(); return; }
  // 物体と要素が混ざっている：先に物体（ctxPaste が pushUndo と選択の付け替えをする）。
  // 要素のリストは ctxPaste が選択を消す前にここで控えてあるので、そのまま使える。
  ctxCopy(); ctxPaste();
  for (const c of [...cloneLasers(beams), ...cloneWaveSources(waves)])
    if (!c.body) selectedElemIds.add(c.id);
  refreshSelCount();
}
// ★反転・回転は transform.js の mirrorSelection / rotateSelectionBy をそのまま呼ぶ。
//   以前はここに ctxFlipH/V という薄い包みがあったが、上部の編集メニューと同じ
//   「図形回転・反転」を出すようにしたので、包みは要らなくなった（ctxTransformSub）。
// 選択中の物体を変更したあと、右パネルを同期する
// ★「1個のときだけ」ではなく refreshPropsForSelection を通す。右パネルは複数選択でも
//   代表（一番上の物体）の値を出して、そこから全員へ書き込む作りなので、1個に絞ると
//   2個以上選んだときだけ p-showforces のチェックが実際の値とずれる
//   （メニューで力ベクトルをONにしたのに、右パネルの「力を表示」は外れたまま）。
//   混在選択・気体・レーザーの出し分けも refreshPropsForSelection が一手に持っている。
function _syncSelectionPanel() {
  if (selectedIds.size === 0) return;
  refreshPropsForSelection();   // p-static / p-layer1..4 / p-showforces を再描画
}
// 気体の定積（ピストンを器に固定）。★世界に釘付けにするのではない（gas.js の★）
function ctxToggleGasLock() {
  const ch = selectedElement && selectedElement.kind === 'gas' ? selectedElement.chamber : null;
  if (!ch) return;
  pushUndo();
  setGasPistonLocked(ch, !ch.pistonLocked);
  if (typeof updateGasPanel === 'function') updateGasPanel(ch);
  ctxRefreshChecks();
}
// 気体の等温（恒温槽に浸ける）／断熱（外す）。★gas.js の setGasThermal をそのまま通す
function ctxToggleGasIso() {
  const ch = selectedElement && selectedElement.kind === 'gas' ? selectedElement.chamber : null;
  if (!ch) return;
  pushUndo();
  setGasThermal(ch, ch.thermostat != null ? 'adiabatic' : 'isothermal');
  if (typeof updateGasPanel === 'function') updateGasPanel(ch);
  ctxRefreshChecks();
}
// 波源の発振 ON/OFF。★右パネルのチェックボックスと同じ関数を通す（updateWaveSourceEnabled が
//   Undo と一括選択を見ているので、入口が右クリックに増えても扱いは変わらない）。
function ctxToggleWaveEnabled() {
  const s = selectedElement && selectedElement.kind === 'wave' ? selectedElement.source : null;
  if (!s) return;
  updateWaveSourceEnabled(!s.enabled);
  if (typeof updateWavePanel === 'function') updateWavePanel(s);
  ctxRefreshChecks();
}
// 軸モーターの「放したら止める」。★これも右パネルと同じ関数を通す
//   （updateJointMotorBrake が Undo・一括選択・次に置く軸の既定まで面倒を見ている）。
function ctxToggleMotorBrake() {
  const j = joints.find(x => x.id === selectedJointId);
  if (!j || j.type !== 'axle') return;
  updateJointMotorBrake(!j.motorBrake);
  if (typeof updateJointPanel === 'function') updateJointPanel(j);
  ctxRefreshChecks();
}
// 管でつなぐ／外す（右パネルにあった uiGasLink をそのまま通す。undo もあちら持ち）
function ctxGasLink(id) {
  const ch = selectedElement && selectedElement.kind === 'gas' ? selectedElement.chamber : null;
  if (!ch) return;
  uiGasLink(id == null ? '' : String(id));
  if (typeof updateGasPanel === 'function') updateGasPanel(ch);
}
// 管のコック（gas.js の setGasCock をそのまま通す）
function ctxToggleGasCock() {
  const ch = selectedElement && selectedElement.kind === 'gas' ? selectedElement.chamber : null;
  if (!ch || ch.linkId == null) return;
  pushUndo();
  setGasCock(ch, !ch.linkOpen);
  if (typeof updateGasPanel === 'function') updateGasPanel(ch);
  ctxRefreshChecks();
}
function ctxSetStatic() {
  if (selectedIds.size === 0) return;
  pushUndo();
  const target = !selStaticOn();   // 全部が静的なら解除、そうでなければ全部を静的に（上部メニューと同じ流儀）
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b) b.setStatic(target); }
  _syncSelectionPanel();
  ctxRefreshChecks();
}
// ★以下の4つはメニューを開いたまま切り替える（見出しを押しても閉じない）ので、
//   最後に ctxRefreshChecks() でチェック印を今の状態へ合わせ直す。
function ctxToggleForces() {
  if (selectedIds.size === 0) return;
  const target = !selForcesOn();
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b) b.showForces = target; }
  _syncSelectionPanel();
  ctxRefreshChecks();
}
function ctxToggleVelocity() {
  if (selectedIds.size === 0) return;
  const target = !selVelocityOn();
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b) b.showVelocity = target; }
  _syncSelectionPanel();
  ctxRefreshChecks();
}
function ctxToggleFieldSource() {
  if (selectedIds.size === 0) return;
  setSelFieldSource(!selFieldSourceOn());
  _syncSelectionPanel();
  ctxRefreshChecks();
}
// 回転しない：右パネルのチェックボックスと同じ updateProp を通す（Undo・角速度欄の
// 無効化・一括適用の扱いを入口によって変えないため）
function ctxToggleFixRot() {
  if (selectedIds.size === 0) return;
  updateProp('fixedRotation', !selFixRotOn());
  _syncSelectionPanel();
  ctxRefreshChecks();
}
function ctxToggleGuide() {
  if (selectedIds.size === 0) return;
  updateGuideEnabled(!selGuideOn());
  ctxRefreshChecks();
  const box = document.getElementById('ctx-guideangle');
  const first = objects.find(o => selectedIds.has(o.id));
  if (box && first) box.value = _dispDeg(first.guideAngle).toFixed(1);
}
function ctxSetGuideAngle(v) {
  if (selectedIds.size === 0) return;
  updateGuideAngle(v);
  const box = document.getElementById('ctx-guideangle');
  if (box) box.value = parseFloat(v).toFixed(1);
  _syncSelectionPanel();
}
// ばねの3つ。右パネルのチェックボックスとまったく同じ関数を通す（Undo・まとめて選んだ
//   仲間への適用・欄の出し入れを、入口によって変えないため）。最後に右パネルの
//   チェックボックスと、開いたままのメニューの✔を今の状態へ合わせ直す。
function _ctxSlinky() {
  return (selectedElement && selectedElement.kind === 'slinky') ? selectedElement.slinky : null;
}
function ctxToggleSlinkyWaveGraph(s) {
  const S = _ctxSlinky(); if (!S) return;
  const open = waveGraphOfSlinky(S, s);
  if (open) { waveGraphClose(open); return; }
  if (waveGraphs.length >= WG_MAX_WINDOWS) return;
  waveGraphNewOnSlinky(S, s);
  refreshWaveGraphButton();
}
function ctxToggleSlinkyIdeal() {
  const S = _ctxSlinky(); if (!S) return;
  updateSlinkyIdeal(!S.idealSpring);   // 中で updateSlinkyPanel まで済む（欄の出し入れがある）
  ctxRefreshChecks();
}
function ctxToggleSlinkyView(key) {
  const S = _ctxSlinky(); if (!S) return;
  updateSlinkyView(key, !S[key]);      // 見た目だけなので Undo は積まない（パネルと同じ）
  const box = document.getElementById(key === 'showCoil' ? 'slk-coil' : 'slk-strain');
  if (box) box.checked = !!S[key];
  ctxRefreshChecks();
}
// 選択中の素子がつながっている回路の「蓄え」を0に戻す
function resetSelectedCircuitStorage() {
  if (!selectedCircuit) return;
  if (resetCircuitStorage(selectedCircuit)) refreshCircuitReadout();
}
// 衝突レイヤー：右パネルと同じ updateLayer を通す（全部外せば「衝突なし」になる）
function ctxSetLayer(n, on) {
  if (selectedIds.size === 0) return;
  updateLayer(n, on);
  _syncSelectionPanel();
  ctxRefreshChecks();
}
function ctxDelete() {
  if (deleteSelectedAnnotation()) return;                     // ★注釈（テキスト・お絵描き）選択中
  // ★粒子は deleteBulkSelection より先に見る。あちらは「2個以上」が条件だが、
  //   粒子はクリックで1個だけ選ぶこともできるので、1個でも消せる自前の経路を通す。
  if (bulkKind === 'particle' && deleteSelectedParticles()) return;
  if (deleteBulkSelection()) return;                          // ★種別一括選択中はまとめて消す
  if (selectedCircuit) { deleteSelectedCircuit(); return; }   // ★回路素子選択中
  if (selectedElement) { deleteSelectedElement(); return; }   // ★要素（レーザー/動力/軌跡）選択中
  // ★範囲選択に入れたレーザー・波源。物体と混ざっていれば両方まとめて消す（物体の複数選択と同じ流儀）
  const boxElems = selectedElemList();
  if (selectedJointId != null || selectedIds.size > 0 || boxElems.length) pushUndo();   // ★
  if (boxElems.length) removeBoxSelectedElements(boxElems);
  if (selectedJointId != null) {   // ★ジョイント選択中はそれを削除
    const ji = joints.findIndex(j => j.id === selectedJointId);
    if (ji >= 0) removeJointAt(ji);   // ロープの先端おもりも一緒に消す
    selectedJointId = null;
    document.getElementById('st-sel').textContent = 'なし';
    updatePropsPanel(null);
    return;
  }
  for (const id of selectedIds) {
    const i=objects.findIndex(o=>o.id===id);
    if (i>=0) objects.splice(i,1);
    joints=joints.filter(j=>(!j.bodyA||j.bodyA.id!==id)&&(!j.bodyB||j.bodyB.id!==id));
    lasers=lasers.filter(L=>!L.body||L.body.id!==id);
    for (const S of slinkies) {        // ★取り付け先が消えたら、その場に固定して落とさない
      if (S.bodyA && S.bodyA.id === id) { S.bodyA = null;
        if (S.endA === 'body') { S.endA = 'pin'; S.pinAx = S.nodes[0].x; S.pinAy = S.nodes[0].y; } }
      if (S.bodyB && S.bodyB.id === id) { S.bodyB = null;
        if (S.endB === 'body') { const n = S.nodes[S.nodes.length-1];
          S.endB = 'pin'; S.pinBx = n.x; S.pinBy = n.y; } }
    }
  }
  selectedIds.clear(); selectedElemIds.clear(); selectedJointEnds.clear();
  document.getElementById('st-sel').textContent='なし';
  updatePropsPanel(null);
}
const undoStack=[];
const redoStack=[];         // ★やり直した状態の退避先（新たな編集が入ると破棄）
let playUndoArmed = true;   // 次の「実行」で履歴を積むか（編集が入ると立つ）
