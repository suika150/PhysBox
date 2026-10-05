// keepTab=true のときだけタブを動かさない。呼び出し元はどれも「選んだものを右パネルに
// 出す」直前なので、ここでプロパティタブへ戻せば全種類（物体・回路・場・ジョイント…）に
// 一度に効く。選択解除（updatePropsPanel(null)）だけが keepTab を立てる。
function _hideAllPropForms(keepTab) {
  for (const id of ['prop-none','prop-mixed','prop-form','gas-form','joint-form','laser-form','thruster-form','tracer-form','arcoat-form','ground-form','wave-form','slinky-form','circuit-form','emfield-form','heatfield-form','flowfield-form','annot-form','particle-form']) {
    const _el = document.getElementById(id); if (_el) _el.style.display = 'none';
  }
  if (!keepTab) focusPropsTab();
  setStyleSections(false);   // ★外観・素材プリセットは既定で非表示。物体選択時のみ updatePropsPanel が戻す
  refreshBulkNote();         // ★「まとめて編集中」の注記。ここに置けば全種類のパネルに一度に効く
}
function setStyleSections(on) {
  const d = on ? '' : 'none';
  document.getElementById('appearance-section').style.display = d;
  document.getElementById('material-section').style.display   = d;
}
function updateLaserPanel(L) {
  _hideAllPropForms();
  document.getElementById('laser-form').style.display = '';
  document.getElementById('laser-angle').value = _dispDeg(laserWorldAngle(L)).toFixed(1);
  document.getElementById('laser-wl').value = L.wavelength.toFixed(1);
  document.getElementById('laser-color-swatch').style.background = L.color;
  document.getElementById('laser-white').checked = !!L.whiteLight;
  // ★白色光では単一波長の指定は効かない（プリセット全色を同時に出すため）
  document.getElementById('laser-wl-note').textContent =
    L.whiteLight ? '白色光（プリセット全色）' : wavelengthName(L.wavelength);
  setSliderDisabled('laser-wl', !!L.whiteLight, '白色光ではプリセット全色を同時に出すため、波長の指定はできません');
  document.getElementById('laser-preset-grid').style.opacity = L.whiteLight ? 0.4 : 1;
  document.getElementById('laser-interact-host').checked = !!L.interactHost;
  document.getElementById('laser-width').value      = (L.width * PX2M).toFixed(2);
  document.getElementById('laser-beam-mode').value  = L.beamMode;
  document.getElementById('laser-count').value      = L.rayNum;
  document.getElementById('laser-coherent').checked = !!L.coherent;
  // 本数は 'array' でしか指定できない（'solid' は幅を埋めるのに要る本数が自動で決まる）
  document.getElementById('laser-count-row').style.display = L.beamMode === 'array' ? '' : 'none';
  refreshLaserRayNote(L);
  syncSliders();
}
// 束の本数と間隔の注記。★幅・本数を動かすたびに呼ばれるので、パネル全体は作り直さない
//   （スライダーのドラッグ中に値を書き戻すと、つまみが自分の動きと喧嘩する）。
function refreshLaserRayNote(L) {
  const n = L.rayCount();
  const el = document.getElementById('laser-ray-note');
  if (!(L.width > 0))            el.textContent = '幅 0：太さのない1本';
  else if (n <= 1)               el.textContent = '1 本（幅の中心を1本だけ通ります）';
  else if (L.beamMode === 'solid')
    el.textContent = `${n} 本で幅を埋めています（連続開口なので隙間はありません）`;
  else
    el.textContent = `${n} 本 ／ 間隔 d = 幅 ÷ (本数−1) = ${(L.raySpacing()*PX2M*100).toFixed(1)} cm`;
  // 幅0のときは本数を選べない（1本しか出ないので、動かしても何も起きない欄になる）
  setSliderDisabled('laser-count', !(L.width > 0), '幅が 0 のときは太さのない1本だけです');
  document.getElementById('laser-if-note').innerHTML = laserInterferenceNote(L);
}
// パネルの下に出す注記。★波長を拡大している事実は隠さない。
//   実波長のままでは 6.3e-5 px で、このシミュレータのスケールでは絶対に見えない。
//   倍率は単一の定数なので現象どうしの関係はすべて正しいままだが、絶対値は架空なので、
//   「いま画面上の λ が何 cm 相当か」を読める形にしておく。
function laserInterferenceNote(L) {
  if (!L.coherent) return '';
  const wls = L.spectrum();
  const lp  = simLambdaPx(wls[0]);
  const scr = lp * cam.zoom;
  let s = `λ = ${wls[0].toFixed(1)} nm（表示上 ${(lp*PX2M*100).toFixed(1)} cm に拡大）`;
  if (scr < IF_FADE_HI)
    s += `<br><span style="color:#ffb74d">縞が画面上で細かすぎます（${scr.toFixed(1)} px）。`
       + `拡大すると出ます</span>`;
  return s;
}
function updateWavePanel(s) {
  _hideAllPropForms();
  document.getElementById('wave-form').style.display = '';
  document.getElementById('ws-freq').value   = s.freq.toFixed(2);
  document.getElementById('ws-lambda').value = s.wavelength().toFixed(3);
  document.getElementById('ws-amp').value    = s.amp;
  document.getElementById('ws-phase').value  = Math.round(s.phase * 180 / Math.PI);
  document.getElementById('ws-enabled').checked = s.enabled;
  const cpl = s.cellsPerLambda(), w = document.getElementById('ws-warn');
  if (cpl < WAVE_MIN_CPL) {
    w.style.display = ''; w.style.color = '#ffa726';
    w.innerHTML = `1波長あたり <b>${cpl.toFixed(1)}</b> セルしかありません。波面が円ではなく四角くゆがみます。`;
  } else { w.style.display = 'none'; }
  fillWaveFieldControls('wf-');   // 波動場（共通）欄を現在値で埋める
  refreshWaveInfo();
  syncSliders();
}
// ═══ ばね ═══════════════════════════════════════════════════
function updateSlinkyPanel(S) {
  _hideAllPropForms();
  document.getElementById('slinky-form').style.display = '';
  document.getElementById('slk-ea').value     = +S.springK().toFixed(2);   // ★欄はばね定数 k [N/m]
  document.getElementById('slk-mu').value     = S.linDensity;
  document.getElementById('slk-rest').value   = S.restM.toFixed(2);
  document.getElementById('slk-damp').value   = S.damp;
  document.getElementById('slk-nd').value     = S.nodeDensity;
  document.getElementById('slk-bend').value   = S.bendRatio;
  document.getElementById('slk-radius').value = S.radius;
  document.getElementById('slk-dampc').value  = S.dampC;
  document.getElementById('slk-ideal').checked = !!S.idealSpring;
  document.getElementById('slk-guide').checked = !!S.guideEnabled;
  document.getElementById('slk-guideangle').value = _dispDeg(S.guideAngle).toFixed(1);
  // ★理想ばねでは質量が無いので、質量に関わる設定はすべて意味を失う。
  //   理想レンズで屈折率・分散・フレネルを隠したのとまったく同じ扱いにする。
  //   ただし太さだけは隠さない：理想ばねでも見た目（コイルの振れ幅）は太さで決まるので、
  //   隠すと「細いばねを太くしたいのに欄が無い」という行き止まりになる。
  // ★レール（運動方向固定）も同じ扱いで隠す。理想ばねには節点が無い＝媒質が無いので、
  //   「媒質が動ける向き」という設定が意味を持たない（波そのものが伝わらない）。
  const id = !!S.idealSpring;
  for (const [row, hideWhenIdeal] of [['slk-mu-row',1],['slk-damp-row',1],['slk-nd-row',1],
                                      ['slk-bend-row',1],['slk-guide-cb',1],['slk-dampc-row',0]])
    document.getElementById(row).style.display = (hideWhenIdeal ? id : !id) ? 'none' : '';
  document.getElementById('slk-guide-row').style.display = (!id && S.guideEnabled) ? '' : 'none';
  document.getElementById('slk-rest-row').style.display = '';
  document.getElementById('slk-del-btn').textContent = 'このばねを削除';
  // ★端の扱いはドロップダウンで選ばせない（ロープと同じ流儀）。
  //   既定は背景に固定で、端を物体へ落とすか、物体を端へ落とせば取り付く。
  //   いまどうなっているかだけを文で出す。
  const endName = (mode, b) => mode === 'body' && b ? '物体に取り付け中' : '背景に固定';
  document.getElementById('slk-ends').innerHTML =
    `端A：<b>${endName(S.endA, S.bodyA)}</b>　端B：<b>${endName(S.endB, S.bodyB)}</b><br>`
    + '編集ツールで端を掴んで物体へ落とすと取り付き、物体の外へ出すと背景に固定されます'
    + '（物体を端の上へ落としても取り付きます）';
  document.getElementById('slk-coil').checked   = S.showCoil;
  document.getElementById('slk-strain').checked = S.showStrain;
  document.getElementById('slk-beads').checked  = !!S.showBeads;
  document.getElementById('slk-color-swatch').style.background = S.color;
  refreshSlinkyGraphButton(S);
  refreshSlinkyTipRow(S);
  refreshSlinkyInfo(S);
  syncSliders();
}
// 先端おもりのボタン（ロープの j-row-tip と同じ役割）。
//   物体に取り付いている端には出さない（そこは既に動く相手が付いている）。
//   おもりが付いている端では、同じボタンが「外す」に変わる。
function refreshSlinkyTipRow(S) {
  let any = false;
  for (const w of ['A', 'B']) {
    const btn = document.getElementById('slk-tip-' + w.toLowerCase());
    const tip = slinkyEndTip(S, w);
    const show = !!tip || slinkyEndFree(S, w);
    btn.style.display = show ? '' : 'none';
    if (show) { btn.textContent = tip ? `端${w}のおもりを外す` : `端${w}におもりを付ける`; any = true; }
  }
  document.getElementById('slk-row-tip').style.display = any ? '' : 'none';
}
// プロパティの「端◯におもりを付ける／外す」。右クリックの同じ項目もここを通す。
function toggleSlinkyTipFromPanel(end) {
  const S = _selSlinky(); if (!S) return;
  pushUndo();
  if (slinkyEndTip(S, end)) removeSlinkyTip(S, end); else addSlinkyTip(S, end);
  updateSlinkyPanel(S);          // ボタンの文言と端の状態表示を入れ替える
}
// ★ここは「設定」ではなく「実測」。張力も波の速さも、伸びた結果として出てくる量なので
//   入力欄ではなく読み取り欄として出す（弦では張力が入力だったのと逆になる）。
function refreshSlinkyInfo(S) {
  const el = document.getElementById('slk-info');
  if (!el || !S) return;
  const m = S.measure();
  // ★上の欄で指定するのはばね定数 k。内部で持っているのは長さによらない材料定数 EA なので、
  //   その換算をここに出しておく（波の速さも接触の剛性も EA で決まる）。
  const head = `伸び剛性 EA = k × 自然長 = <b>${S.stiffEA.toFixed(1)} N</b><br>`
             + `実測：張力 <b>${m.T.toFixed(2)} N</b>　伸び <b>${(m.strain*100).toFixed(1)} %</b>　`
             + `長さ ${m.lengthM.toFixed(2)} m（自然長 ${S.restM.toFixed(2)} m）<br>`;
  if (S.idealSpring) {
    // ★減衰比 ζ は「導出して見せるだけ」。設定の実体は c で、こちらはつないだ相手が
    //   変わるたびに動く読み取り値（換算質量はソルバと同じ slinkyReducedMass を使う）。
    const mRed = slinkyReducedMass(S);
    const k = S.springK();
    const zeta = (mRed && k > 0) ? S.dampC / (2 * Math.sqrt(k * mRed)) : null;
    const zTxt = zeta == null ? ''
      : `<br>減衰比 ζ = c / 2√(k·m) = <b>${zeta.toFixed(3)}</b>`
        + `（つないだ相手の換算質量 ${mRed.toFixed(2)} kg。1 で臨界減衰）`;
    el.innerHTML = head + zTxt
      + '<br><span style="color:var(--text2)">理想ばね（質量ゼロ）として解いています。'
      + '単振動の周期は T = 2π√(m/k) と厳密に一致し、硬いばねも軽い計算で安定です。'
      + '質量が無いので<b>波は伝わりません</b>。</span>';
    return;
  }
  // ★実体のばねにばね定数 0 は入れられる（禁止はしない）が、その鎖は質点をつなぐ力を
  //   何も持たない＝ばらばらに落ちるだけになる。禁止する代わりに、何が起きているかを書く。
  if (S.springK() <= 0) {
    el.innerHTML = '<span style="color:#ffa726">ばね定数が 0 です。</span>'
      + '<span style="color:var(--text2)">実体のばねは質点をつなぐ力を失い、'
      + 'ばらばらに落ちていきます。0 より大きくしてください。</span>';
    return;
  }
  const ratio = m.vT > 1e-6 ? (m.vL / m.vT) : 0;
  const sub = Math.ceil((1 / SIM_HZ / Math.max(1, world.substeps)) / (S.dtMax * SLINKY_CFL));
  const msp = S.linDensity * S.restM;                    // ばね自身の質量 [kg]
  // 端に付いている物体の質量。これとの比が「理想ばねで代用できるか」の判断材料になる
  const load = (S.bodyA && S.endA === 'body' ? 1/Math.max(1e-9, S.bodyA.invMass) : 0)
             + (S.bodyB && S.endB === 'body' ? 1/Math.max(1e-9, S.bodyB.invMass) : 0);
  el.innerHTML = head
    + `波の速さ：横 <b>${m.vT.toFixed(2)} m/s</b>　縦 <b>${m.vL.toFixed(2)} m/s</b>　`
    + `縦/横 = <b>${ratio.toFixed(2)}</b><br>`
    + (ratio > 4
        ? `<span style="color:var(--text2)">縦波が横波の ${ratio.toFixed(0)} 倍速く、ほぼ一瞬で伝わります（＝弦らしい状態）。`
          + `疎密波を見せたいなら「ばね定数 k」を下げてください。</span>`
        : `<span style="color:var(--text2)">縦波と横波の速さが近く、押した波と振った波を並べて見せられます（＝スリンキーらしい状態）。</span>`)
    // ★波消しに要る減衰係数＝弦の特性インピーダンス Z = √(Tμ) = μ·v横。これに合わせた
    //   制動器（通気にしたピストン容器）を端に付けると、入射波が反射せずに消える。
    //   実測（部品で組んだ場合：先端おもり＋長い連結棒で軸を支え、直角に制動器）：
    //     何もしない端 … 振れ幅の一様さ 0.59／c = √(Tμ) … 0.71／c を 1.5倍にすると 0.82
    //     （1.0 が完全な進行波。気体室の減衰は陰的で理論より弱く効くので 1.5 倍が合う）
    //     ただし先端おもりを 0.02kg → 0.2kg にすると 57% 戻る（重い端は波を跳ね返す）。
    //   ★これは横波の値。疎密波（縦波）は、軸を連結棒で支えているかぎり必ず全反射する
    //     （棒が縦波の自由度を殺すため。実測 96%）。縦波も消すなら、棒のかわりに
    //     動力で張力を支え（インピーダンスを持たない支え方）、軸方向にも c=√(EAμ) の
    //     制動器を足す（実測：残る運動エネルギー 541mJ → 149mJ）。
    //   ★値を出すだけで、こちらから付けはしない。制動器は器・蓋・気体・ヒンジという
    //     人が使うものと同じ部品で組める（デモ「横波と縦波」「上皿天秤」がその見本）ので、
    //     組むのは人の側。
    + `<br>波消しに合う制動器 c = √(Tμ) = <b>${(m.T > 0 ? S.linDensity / (1 + m.strain) * m.vT : 0).toFixed(2)} N·s/m</b>`
    + `<br>ばね自身の質量 <b>${msp.toFixed(3)} kg</b>`
    + (load > 0
        ? `　つないだ物体の <b>${(msp/load*100).toFixed(1)} %</b>`
          + (msp/load < 0.02 ? '（十分軽いので、理想ばね化してもほぼ同じ動きになります）' : '')
        : '')
    + `<br><span style="color:var(--text2)">計算：質点 ${S.nodes.length} 個 ／ 内部サブステップ ${sub} 回</span>`;
}
// 理想ばね化。形も設定欄も変わるのでパネルごと作り直す
function updateSlinkyIdeal(on) {
  const S = _selSlinky(); if (!S) return;
  pushUndo();
  S.idealSpring = !!on;
  // 質量ゼロの自由端は定義できない（慣性が無いので自然長へ瞬時に戻る）。その場に固定へ。
  if (S.idealSpring) {
    const last = S.nodes.length - 1;
    if (S.endA === 'free') { S.endA = 'pin'; S.pinAx = S.nodes[0].x;   S.pinAy = S.nodes[0].y; }
    if (S.endB === 'free') { S.endB = 'pin'; S.pinBx = S.nodes[last].x; S.pinBy = S.nodes[last].y; }
  }
  applyToBulk('slinky', S, o => { o.idealSpring = S.idealSpring; });
  updateSlinkyPanel(S);
}
function _selSlinky() {
  return (selectedElement && selectedElement.kind === 'slinky') ? selectedElement.slinky : null;
}
// ★ばね定数 k は保存量ではなく「EA ÷ 自然長」の導出値。欄では k を直接いじらせて、
//   内部の伸び剛性 EA を k × 自然長 として書き換える（EA は長さによらない材料定数なので、
//   波の速さや接触の剛性はこちらで持っているほうが素直）。
//   自然長を変えたときは k のほうを保つ（＝「同じ硬さのまま長さだけ変える」）。EA は追従する。
// ★下限は 0（＝ダンパー）。0 を弾くと、つまみを左端まで回してもダンパーにならない。
function _setSlinkyK(o, k) { o.stiffEA = Math.max(0, k * o.restM); }
function updateSlinkyProp(key, v, skipUndo) {
  const S = _selSlinky(); if (!S) return;
  const x = parseFloat(v);
  if (!isFinite(x)) return;
  if (!skipUndo) pushUndo();
  const keepK = (key === 'restM') ? S.springK() : null;
  // ★ばね定数の下限は 0 ではなく 0.5。0 は「ばね定数0のばね＝ダンパー」という、
  //   物理の世界に無い部品になってしまう（js/waves/slinky.js の springK の★）。
  if (key === 'springK') _setSlinkyK(S, Math.max(0.5, x));
  else S[key] = (key === 'damp' || key === 'bendRatio' || key === 'dampC') ? Math.max(0, x)
              : Math.max(key === 'nodeDensity' ? 2 : 0.001, x);
  if (keepK != null) _setSlinkyK(S, keepK);
  // 自然長・節点密度は鎖そのものを張り直す。ほかは材料定数の計算だけでよい
  if (key === 'restM' || key === 'nodeDensity') S.rebuild(); else S._sync();
  // ★範囲選択でまとめて選んでいる仲間へも同じ値を配る（クランプ後の実効値を使う）。
  //   ばね定数は自然長が違えば EA も違うので、値ではなく k をそろえる。
  applyToBulk('slinky', S, o => {
    if (key === 'springK')    _setSlinkyK(o, S.springK());
    else if (key === 'restM') { const k = o.springK(); o.restM = S.restM; _setSlinkyK(o, k); }
    else o[key] = S[key];
    if (key === 'restM' || key === 'nodeDensity') o.rebuild(); else o._sync();
  });
  // ★ドラッグ中はパネル全体を作り直さない（スライダーのつまみが跳ねる）。実測欄だけ直す。
  if (skipUndo) refreshSlinkyInfo(S);
  else          updateSlinkyPanel(S);
}
function updateSlinkyView(key, on) {
  const S = _selSlinky(); if (!S) return;
  S[key] = !!on;
}
function updateSlinkyColor(v) {
  const S = _selSlinky(); if (!S) return;
  S.color = v;
  applyToBulk('slinky', S, o => { o.color = v; });
  document.getElementById('slk-color-swatch').style.background = v;
}
// ── y-t グラフの観測点（右パネル）。右クリックの「この点の y-t グラフ」と同じ窓を開く ──
//   ★観測点は割合 s で持つ（wavegraph.js の★）。欄は端Aからの距離 [m] で見せて、ここで s へ直す。
//   ばねを選び直すと中央（s=0.5）に戻る。右クリックで開いた点は、その窓を閉じるまで印が残る。
let slkGraphS = 0.5, _slkGraphFor = null;
function _slkGraphSOf(S) {
  if (_slkGraphFor !== S) { _slkGraphFor = S; slkGraphS = 0.5; }
  return slkGraphS;
}
function updateSlinkyGraphPos(v) {
  const S = _selSlinky(); if (!S) return;
  const L = wgSlinkyArcM(S, 1);
  _slkGraphFor = S;
  slkGraphS = L > 0 ? Math.max(0, Math.min(1, (parseFloat(v) || 0) / L)) : 0.5;
  refreshSlinkyGraphButton(S);
}
function toggleSlinkyWaveGraphFromPanel() {
  const S = _selSlinky(); if (!S) return;
  const s = _slkGraphSOf(S);
  const open = waveGraphOfSlinky(S, s);
  if (open) waveGraphClose(open);
  else if (waveGraphs.length < WG_MAX_WINDOWS) waveGraphNewOnSlinky(S, s);
  refreshWaveGraphButton();
}
function refreshSlinkyGraphButton(S) {
  const b = document.getElementById('slk-graph-btn');
  if (!b || !S) return;
  const s = _slkGraphSOf(S);
  const inp = document.getElementById('slk-gpos');
  if (document.activeElement !== inp) inp.value = wgSlinkyArcM(S, s).toFixed(2);
  const open = !!waveGraphOfSlinky(S, s);
  const full = !slinkyGraphReady(S, s);
  b.textContent = open ? 'この点の y-t グラフを閉じる' : 'この点の y-t グラフ';
  b.classList.toggle('active', open);
  b.disabled = full;
  if (full) b.title = 'グラフは同時に' + WG_MAX_WINDOWS + '個までです。どれかを閉じてください';
}
// ── 運動方向固定（レール）。物体側の updateGuideEnabled / updateGuideAngle と同じ流儀 ──
//   ★入れた瞬間の向きは「いまのばねの軸」。物体は固有の軸を持たないので 0° 固定だが、
//     ばねには向きがあるので、既定を軸に合わせるとチェックを入れても形が変わらない。
function updateSlinkyGuide(on) {
  const S = _selSlinky(); if (!S) return;
  pushUndo();
  S.guideEnabled = !!on;
  if (S.guideEnabled) { S.guideAngle = slinkyAxisAngle(S); reanchorSlinkyGuide(S); S._projectGuide(); }
  applyToBulk('slinky', S, o => {
    o.guideEnabled = S.guideEnabled;
    if (o.guideEnabled) { o.guideAngle = slinkyAxisAngle(o); reanchorSlinkyGuide(o); o._projectGuide(); }
  });
  updateSlinkyPanel(S);
}
function updateSlinkyGuideAngle(v, skipUndo) {
  const S = _selSlinky(); if (!S || !S.guideEnabled) return;
  const x = parseFloat(v);
  if (!isFinite(x)) return;
  if (!skipUndo) pushUndo();
  S.guideAngle = -x * Math.PI / 180;            // UI は y を反転して見せている（_dispDeg の裏返し）
  reanchorSlinkyGuide(S); S._projectGuide();
  applyToBulk('slinky', S, o => {
    if (!o.guideEnabled) return;
    o.guideAngle = S.guideAngle; reanchorSlinkyGuide(o); o._projectGuide();
  });
  if (!skipUndo) updateSlinkyPanel(S);
}
function resetSelectedSlinky() {
  const S = _selSlinky(); if (!S) return;
  pushUndo(); S.reset();
}
// ── 電場・磁場の領域 ─────────────────────────────
function _selEMField() {
  return (selectedElement && selectedElement.kind === 'emfield') ? selectedElement.field : null;
}
function updateEMFieldPanel(f) {
  _hideAllPropForms();
  document.getElementById('emfield-form').style.display = '';
  const isE = f.kind === 'E';
  document.getElementById('emf-title').textContent = (isE ? '電場' : '磁場') + 'の領域を選択中';
  document.getElementById('emf-strength-label').textContent = isE ? '強さ E [V/m]' : '強さ B [T]';
  const sIn = document.getElementById('emf-p-strength');
  const rg = EMFIELD_STRENGTH_RANGE[f.kind];
  sIn.step = rg.step;
  sIn.value = f.strength;
  setSliderRange('emf-p-strength', 0, rg.hi, rg.step);   // E[V/m]とB[T]で桁が違う
  // 向き：電場は任意角（数値＋スライダー＋プリセット）、磁場は紙面の表裏の2択
  document.getElementById('emf-p-dir-row').style.display        = isE ? 'none' : '';
  document.getElementById('emf-p-angle-row').style.display      = isE ? '' : 'none';
  document.getElementById('emf-angle-preset-grid').style.display = isE ? '' : 'none';
  document.getElementById('emf-p-freq-row').style.display       = isE ? '' : 'none';
  document.getElementById('emf-p-freq').value = f.freq;
  if (isE) {
    document.getElementById('emf-p-angle').value = _dispDeg(f.angle).toFixed(1);
  } else {
    const sel = document.getElementById('emf-p-dir');
    sel.innerHTML = '';
    for (const o of [{ v:'out', label:'⊙ 表向き（紙面から出る）' },
                     { v:'in',  label:'⊗ 裏向き（紙面へ入る）' }]) {
      const op = document.createElement('option');
      op.value = o.v; op.textContent = o.label;
      sel.appendChild(op);
    }
    sel.value = f.out ? 'out' : 'in';
  }
  document.getElementById('emf-p-x').value = (f.x * PX2M).toFixed(2);
  document.getElementById('emf-p-y').value = yUI(f.y * PX2M).toFixed(2);
  document.getElementById('emf-p-w').value = (f.w * PX2M).toFixed(2);
  document.getElementById('emf-p-h').value = (f.h * PX2M).toFixed(2);
  refreshEMFieldInfo(f);
  syncSliders();
}
// キャンバスでサイズを変えている間、幅・高さ・中心の欄だけを追従させる
// （パネル全体を組み直すと、向きのselectやプリセットまで毎フレーム作り直すことになる）
function refreshEMFieldGeomFields(f) {
  const set = (id, v) => { const el = document.getElementById(id);
                           if (el && document.activeElement !== el) el.value = v; };
  set('emf-p-x', (f.x * PX2M).toFixed(2));
  set('emf-p-y', yUI(f.y * PX2M).toFixed(2));
  set('emf-p-w', (f.w * PX2M).toFixed(2));
  set('emf-p-h', (f.h * PX2M).toFixed(2));
}
// 電場の向きプリセット。角度は数値欄とスライダーで自由に決められるので、これは近道
function initEMFieldAnglePresets() {
  const el = document.getElementById('emf-angle-preset-grid');
  if (!el) return;
  for (const p of EMFIELD_ANGLE_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'mat-btn';
    btn.textContent = p.label;
    btn.onclick = () => {
      updateEMFieldAngle(p.deg);
      document.getElementById('emf-p-angle').value = p.deg;
      syncSliderById('emf-p-angle');
    };
    el.appendChild(btn);
  }
}
function refreshEMFieldInfo(f) {
  const el = document.getElementById('emf-info');
  if (!el || !f) return;
  let s = `向き：<b>${f.dirName()}</b><br>`;
  if (f.kind === 'E') {
    s += '荷電粒子に <b>F = qE</b> がはたらきます（領域の内側だけ）。<br>'
       + '電荷 q [C] は物体のプロパティで設定します。';
    if (f.freq > 0) s += `<br>交流：<b>E = ${f.strength}·sin(2π·${f.freq}·t)</b>（周期 ${(1/f.freq).toFixed(2)} 秒）。`
                       + '半周期ごとに向きが反転します。';
  } else {
    s += '荷電粒子に <b>F = qv×B</b>（ローレンツ力）。速さは変わらず向きだけ曲がるので、'
       + '領域を突き抜けると円弧を描いて出ていきます。<br>'
       + '導体棒が横切ると <b>誘導起電力 = BLv</b> が生じます（棒が領域に入っている分だけ）。';
  }
  s += '<br><span style="color:var(--text2)">重なった領域は足し合わされます。'
     + '電場と磁場を重ねると速度選別器になります。<br>'
     + '選び直すときは<b>枠をクリック</b>（内側はダブルクリック）。'
     + '右クリックとオブジェ一覧からも選べます</span>';
  el.innerHTML = s;
}
// ── 加熱・冷却の領域 ─────────────────────────────
function _selHeatField() {
  return (selectedElement && selectedElement.kind === 'heatfield') ? selectedElement.field : null;
}
function updateHeatFieldPanel(f) {
  _hideAllPropForms();
  document.getElementById('heatfield-form').style.display = '';
  document.getElementById('hf-p-power').value = f.power;
  document.getElementById('hf-p-x').value = (f.x * PX2M).toFixed(2);
  document.getElementById('hf-p-y').value = yUI(f.y * PX2M).toFixed(2);
  document.getElementById('hf-p-w').value = (f.w * PX2M).toFixed(2);
  document.getElementById('hf-p-h').value = (f.h * PX2M).toFixed(2);
  refreshHeatFieldInfo(f);
  syncSliders();
}
// キャンバスで大きさを変えている間、寸法の欄だけを追従させる（EMField と同じ理由）
function refreshHeatFieldGeomFields(f) {
  const set = (id, v) => { const el = document.getElementById(id);
                           if (el && document.activeElement !== el) el.value = v; };
  set('hf-p-x', (f.x * PX2M).toFixed(2));
  set('hf-p-y', yUI(f.y * PX2M).toFixed(2));
  set('hf-p-w', (f.w * PX2M).toFixed(2));
  set('hf-p-h', (f.h * PX2M).toFixed(2));
}
// ★見出しもここで直す。つまみで 0 をまたぐと加熱⇔冷却が入れ替わるので、
//   スライダー中（パネルを作り直さない経路）でも見出しが追従しないと嘘になる。
function refreshHeatFieldInfo(f) {
  const el = document.getElementById('hf-info');
  if (!el || !f) return;
  const t = document.getElementById('hf-title');
  if (t) t.textContent = f.kindName() + 'の領域を選択中';
  const a = Math.abs(f.power);
  let s = f.power > 0 ? `枠の内側にあるものへ、1秒あたり <b>${a} J</b> を与え続けます。<br>`
        : f.power < 0 ? `枠の内側にあるものから、1秒あたり <b>${a} J</b> を奪い続けます。<br>`
        :               '出力が <b>0</b> なので、いまは何もしていません。<br>';
  s += 'これは<b>領域全体</b>の値です。中にあるもの（物体・液体／気体の粒子・気体容器の気体）へ、'
     + '<b>浸かっている体積の比</b>で配られます。<br>'
     + '<b>断熱</b>のもの（比熱か熱伝導率が0）には入りません。受け取れるものが1つも無ければ、'
     + '熱そのものを作りません。<br>';
  if (!world.thermalOn)
    s += '<span style="color:var(--warn,#ffb74d)">いまは全体設定の「熱のやりとりを計算する」がOFFなので効きません。</span><br>';
  s += '<span style="color:var(--text2)">系へ入った熱は「全体設定 → 熱量」の供給ぶんに積まれるので、'
     + 'Δ(熱量) = 散逸 + 供給 の帳簿で検算できます。<br>'
     + '選び直すときは<b>枠をクリック</b>（内側はダブルクリック）。'
     + '右クリックとオブジェ一覧からも選べます</span>';
  el.innerHTML = s;
}
function updateHeatFieldProp(prop, v, skipUndo) {
  const f = _selHeatField(); if (!f) return;
  if (!skipUndo) pushUndo();          // ★スライダー中はドラッグ開始時に1回だけ積む
  const n = parseFloat(v) || 0;
  // ★出力は符号つき（正＝加熱・負＝冷却。HeatField の★）。種類の欄は無い
  if (prop === 'power')      f.power = n;
  else if (prop === 'x')     f.x = toPx(n);
  else if (prop === 'y')     f.y = yUI(toPx(n));      // 表示は上向き正
  else if (prop === 'w')     f.w = Math.max(4, toPx(n));
  else if (prop === 'h')     f.h = Math.max(4, toPx(n));
  // 中心座標だけは配らない（全部が同じ位置に重なる）。EMField の★と同じ理由
  if (prop !== 'x' && prop !== 'y') applyToBulk('heatfield', f, o => { o[prop] = f[prop]; });
  if (skipUndo) refreshHeatFieldInfo(f); else updateHeatFieldPanel(f);
  wakeAll();
}
// ═══ 流れの場（風・水流）═══════════════════════════════════════
function _selFlowField() {
  return (selectedElement && selectedElement.kind === 'flowfield') ? selectedElement.field : null;
}
function updateFlowFieldPanel(f) {
  _hideAllPropForms();
  document.getElementById('flowfield-form').style.display = '';
  document.getElementById('ff-p-mode').value = f.mode;
  document.getElementById('ff-p-speed').value = f.speed;
  document.getElementById('ff-p-angle').value = Math.round(yUI(f.angle) * 180 / Math.PI);
  document.getElementById('ff-p-density').value = f.density;
  // ★媒質の密度は抗力の式にしか出てこない。速度の合成では触っても何も変わらないので隠す
  const showRho = f.mode === 'drag' ? '' : 'none';
  document.getElementById('ff-row-medium').style.display = showRho;
  document.getElementById('ff-row-density').style.display = showRho;
  const sel = document.getElementById('ff-p-medium');
  if (sel && document.activeElement !== sel) {
    // ★プリセットに無い密度を打ったときのために「その他」を持たせる。選択肢を実在の
    //   2つに絞ったうえで、任意の値も殺さない（密度の欄が本体で、こちらは近道）
    const opts = FLOW_MEDIUM.map(m => `<option value="${m.density}">${m.label}（${m.density}）</option>`);
    const hit = FLOW_MEDIUM.some(m => Math.abs(m.density - f.density) < 1e-9);
    if (!hit) opts.push(`<option value="${f.density}">その他（${f.density}）</option>`);
    sel.innerHTML = opts.join('');
    sel.value = String(f.density);
  }
  refreshFlowFieldGeomFields(f);
  refreshFlowFieldInfo(f);
  syncSliders();
}
function refreshFlowFieldGeomFields(f) {
  const set = (id, v) => { const el = document.getElementById(id);
                           if (el && document.activeElement !== el) el.value = v; };
  set('ff-p-x', (f.x * PX2M).toFixed(2));
  set('ff-p-y', yUI(f.y * PX2M).toFixed(2));
  set('ff-p-w', (f.w * PX2M).toFixed(2));
  set('ff-p-h', (f.h * PX2M).toFixed(2));
}
function refreshFlowFieldInfo(f) {
  const el = document.getElementById('ff-info');
  if (!el || !f) return;
  let s = '';
  if (f.isAdvect()) {
    s += `枠の内側を <b>${f.speed.toFixed(1)} m/s</b> で媒質ごと運びます。`
       + '物体が持つ速度は<b>媒質に対する速度</b>になり、地面から見た速度が'
       + ' <b>v + u</b>（速度の合成）になります。抗力係数にも質量にも依りません。<br>'
       + '<span style="color:var(--text2)">川を渡る船・動く歩道・風の中の飛行機の題材です。'
       + '枠に入る瞬間に u を得て、出る瞬間に手放します（＝運動エネルギーがそこで跳びます。'
       + '媒質に乗り移る過程を省略しているためです）。<br></span>';
    // ★横から見た配置では摩擦が効く。「入れたのに止まる」の理由が読めるようにする
    s += '<span style="color:var(--text2)">地面に接している物体は、運ばれたあと地面の摩擦で'
       + '減速します（川底に擦っている船）。川渡りの問題は<b>真上から見た配置</b>'
       + '（重力を 0）で組んでください。<br></span>';
  } else {
    s += `枠の内側を <b>${f.speed.toFixed(1)} m/s</b> で${f.mediumName()}が流れます。`
       + '中の物体は相対速度に応じた抗力 <b>F = ½ρC<sub>d</sub>A|u−v|(u−v)</b> を受け、'
       + 'この流速に漸近します（<b>終端速度＝流速</b>）。<br>';
    // ★置いても何も起きないとき、その理由を画面から読めるようにする。Cd の既定は 0 なので
    //   これが無いと「壊れている」ように見える（加熱の領域が断熱材を注記で断るのと同じ）。
    const inert = flowFieldInertCount(f);
    if (inert > 0)
      s += '<span style="color:var(--warn,#ffb74d)">枠の中の <b>' + inert + ' 個</b>は抗力係数 '
         + 'C<sub>d</sub> が 0 なので流れを受けません。その物体を選び、プロパティの「抗力」を'
         + '上げてください（例：0.5）。</span><br>';
    // ★力なので重さと摩擦に負ける。空気だと地面の上の物体はまず動かないので、目安を出す
    const heavy = flowFieldStuckCount(f);
    if (heavy > 0)
      s += '<span style="color:var(--warn,#ffb74d)">枠の中の <b>' + heavy + ' 個</b>は、'
         + 'この流れの力より<b>地面との静止摩擦のほうが大きい</b>ので動きません'
         + '（80×80cm の箱で、空気 8m/s の力 1.2N に対し摩擦は 113N）。'
         + '媒質を水にする・軽く小さい物体にする・摩擦を下げる・空中に置く、'
         + 'のいずれかで動きます。「速度の合成」に切り替える手もあります。</span><br>';
    s += '<span style="color:var(--text2)">送風機・川にあたる、系の外から仕事を入れる入口です。'
       + '流れが与えた仕事のうち散逸したぶんは熱になり、「全体設定 → 熱量」の帳簿に積まれます。<br></span>';
  }
  s += '<span style="color:var(--text2)">選び直すときは<b>枠をクリック</b>（内側はダブルクリック）。'
     + '右クリックとオブジェ一覧からも選べます</span>';
  el.innerHTML = s;
}
function updateFlowFieldProp(prop, v, skipUndo) {
  const f = _selFlowField(); if (!f) return;
  if (!skipUndo) pushUndo();          // ★スライダー中はドラッグ開始時に1回だけ積む
  const n = parseFloat(v) || 0;
  if (prop === 'speed')        f.speed = Math.max(0, n);
  else if (prop === 'density') f.density = Math.max(0, n);
  else if (prop === 'x')       f.x = toPx(n);
  else if (prop === 'y')       f.y = yUI(toPx(n));      // 表示は上向き正
  else if (prop === 'w')       f.w = Math.max(4, toPx(n));
  else if (prop === 'h')       f.h = Math.max(4, toPx(n));
  // 中心座標だけは配らない（全部が同じ位置に重なる）。EMField の★と同じ理由
  if (prop !== 'x' && prop !== 'y') applyToBulk('flowfield', f, o => { o[prop] = f[prop]; });
  if (skipUndo) refreshFlowFieldInfo(f); else updateFlowFieldPanel(f);
  wakeAll();
}
// 向き[°]。欄は上向きを正で見せるので、内部角（y下向き正）との間で yUI を通す
function updateFlowFieldAngle(v, skipUndo) {
  const f = _selFlowField(); if (!f) return;
  if (!skipUndo) pushUndo();
  f.angle = yUI((parseFloat(v) || 0) * Math.PI / 180);
  applyToBulk('flowfield', f, o => { o.angle = f.angle; });
  if (skipUndo) refreshFlowFieldInfo(f); else updateFlowFieldPanel(f);
  wakeAll();
}
function updateFlowFieldMedium(v) {
  updateFlowFieldProp('density', v);
}
// 効かせ方（速度の合成 ⇄ 流体の抗力）
// ★切り替えたらその場で applyFlowAdvection() を通す。合成をやめた瞬間に、物体が履いている
//   速度の下駄を外して自分の速度へ戻さないと、抗力モードなのに媒質の速度が残り続ける
//   （止めたまま切り替えたときは、次の tick まで直らないことになる）。
function updateFlowFieldMode(v) {
  const f = _selFlowField(); if (!f) return;
  pushUndo();
  f.mode = v === 'drag' ? 'drag' : 'advect';
  applyToBulk('flowfield', f, o => { o.mode = f.mode; });
  applyFlowAdvection();
  updateFlowFieldPanel(f);
  wakeAll();
}
function updateEMFieldProp(prop, v, skipUndo) {
  const f = _selEMField(); if (!f) return;
  if (!skipUndo) pushUndo();          // ★スライダー中はドラッグ開始時に1回だけ積む
  const n = parseFloat(v) || 0;
  if (prop === 'strength')   f.strength = Math.max(0, n);
  // ★0 へ戻したら位相も 0 へ。次に振動数を与えたとき、E=0 から立ち上がる（交流電源を入れた姿）
  else if (prop === 'freq')  { f.freq = Math.max(0, n); if (f.freq === 0) f.acPhase = 0; }
  else if (prop === 'x')     f.x = toPx(n);
  else if (prop === 'y')     f.y = yUI(toPx(n));      // 表示は上向き正
  else if (prop === 'w')     f.w = Math.max(4, toPx(n));
  else if (prop === 'h')     f.h = Math.max(4, toPx(n));
  // ★まとめて選んだ領域にも配る。ただし中心座標だけは配らない（全部が同じ位置に重なって
  //   しまい、まとめて選んだ意味がなくなる）。強さと大きさは共通の設定として配ってよい。
  if (prop !== 'x' && prop !== 'y') applyToBulk('emfield', f, o => { o[prop] = f[prop]; });
  // ドラッグ中に組み直すと、入力欄の値をスライダーの下から書き換えてしまう
  if (skipUndo) refreshEMFieldInfo(f); else updateEMFieldPanel(f);
  wakeAll();
}
// 磁場の向き（紙面の表裏）。電場の向きは updateEMFieldAngle が角度で扱う
function updateEMFieldDir(v) {
  const f = _selEMField(); if (!f) return;
  pushUndo();
  f.out = (v === 'out');
  applyToBulk('emfield', f, o => { o.out = f.out; });
  refreshEMFieldInfo(f);
  wakeAll();
}
// 電場の向き[°]。表示は右0°・反時計回りが正、内部は y 下向き正の角度なので符号が反転する
function updateEMFieldAngle(v, skipUndo) {
  const f = _selEMField(); if (!f || f.kind !== 'E') return;
  if (!skipUndo) pushUndo();
  f.angle = -(parseFloat(v) || 0) * Math.PI / 180;
  applyToBulk('emfield', f, o => { o.angle = f.angle; });
  refreshEMFieldInfo(f);
  wakeAll();
}
function updateWaveSourceProp(prop, v, skipUndo) {
  if (!selectedElement || selectedElement.kind !== 'wave') return;
  if (!skipUndo) pushUndo();
  const s = selectedElement.source;
  if (prop === 'freq') { s.freq = Math.max(0.05, Math.min(5, parseFloat(v) || 1)); waveFreq = s.freq; }
  else if (prop === 'amp') { s.amp = Math.max(0, Math.min(5, parseFloat(v) || 0)); waveAmp = s.amp; }
  applyToBulk('wave', s, o => { o[prop] = s[prop]; });   // ★まとめて選んだ波源にも同じ f / A を配る
  document.getElementById('ws-lambda').value = s.wavelength().toFixed(3);
  refreshWaveInfo();
  if (!skipUndo) updateWavePanel(s);
}
// λ を動かすと f が書き換わる。保存されるのは f のみ（λ は常に v/f の導出値）
function updateWaveSourceLambda(v, skipUndo) {
  if (!selectedElement || selectedElement.kind !== 'wave') return;
  updateWaveSourceProp('freq', world.waveSpeed / Math.max(0.01, parseFloat(v) || 1), skipUndo);
}
function updateWaveSourcePhase(v) {
  if (!selectedElement || selectedElement.kind !== 'wave') return;
  pushUndo();
  const s = selectedElement.source;
  s.phase = (parseFloat(v) || 0) * Math.PI / 180;
  applyToBulk('wave', s, o => { o.phase = s.phase; });
}
function updateWaveSourceEnabled(on) {
  if (!selectedElement || selectedElement.kind !== 'wave') return;
  pushUndo();
  const s = selectedElement.source;
  s.enabled = !!on;
  applyToBulk('wave', s, o => { o.enabled = s.enabled; });
  refreshWaveInfo();
}
function updateWaveMode(v) {
  if (selectedIds.size > 0) pushUndo();
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b) b.waveMode = v; }
  waveField.geoKey = '';
  document.getElementById('p-waveior-row').style.display = (v === 'medium') ? '' : 'none';
  const first = objects.find(o => selectedIds.has(o.id));
  if (first && v === 'medium') { document.getElementById('p-waveior').value = first.waveIor; syncSliderById('p-waveior'); }
}
function updateGroundWaveMode(v) { pushUndo(); ground.waveMode = v; waveField.geoKey = ''; }
function updateThrusterPanel(th) {
  _hideAllPropForms();
  document.getElementById('thruster-form').style.display = '';
  // ★1つの物体に何本も付くので、2本以上あるときは「何本目か」を出す。
  //   1本しかない物体で「1/1」と出ても読む意味が無いので、そのときは出さない。
  const b = th.body, n = b ? b.thrusters.length : 1;
  document.getElementById('thruster-title').textContent =
    n > 1 ? `動力（エンジン）${b.thrusters.indexOf(th) + 1} ／ ${n} 本目を選択中`
          : '動力（エンジン）を選択中';
  document.getElementById('thruster-force').value = th.force || 0;
  syncSliders();   // ★スライダー位置を数値ボックスへ再同期
}
function updateTracerPanel(b) {
  _hideAllPropForms();
  document.getElementById('tracer-form').style.display = '';
  const col = b.tracerColor || '#ff7043';
  document.getElementById('tracer-color-swatch').style.background = col;
  document.getElementById('tracer-duration').value = (b.tracerDuration !== undefined ? b.tracerDuration : 5);
  syncSliders();   // スライダー位置を数値ボックスへ同期
}
// 反射防止コート。★数値で指定する欄は置かない——範囲は端をドラッグして決めるもので、
//   「輪郭の何割か」を数字で打つ操作に意味がないため（触って意味のあるものだけ出す）。
function updateArCoatPanel(el) {
  _hideAllPropForms();
  document.getElementById('arcoat-form').style.display = '';
  const c = el && el.body.arCoats && el.body.arCoats[el.index];
  document.getElementById('arcoat-frac').textContent =
    c ? (c.len * 100).toFixed(0) + ' %（輪郭の全周に対して）' : '-';
}
function updateGroundPanel() {
  _hideAllPropForms();
  document.getElementById('ground-form').style.display = '';
  syncGroundCoefUI();
  document.getElementById('g-wavemode').value = ground.waveMode || 'fixed';
  document.getElementById('g-terrain').checked = world.terrain;
  for (let i = 1; i <= LAYER_COUNT; i++)                                   // ★
    document.getElementById('g-layer'+i).checked = !!(ground.layers & (1 << (i-1)));
  syncSliders();
}
// 地面の反発・摩擦の欄は3か所にある。
//   ①地面を選択中のプロパティ（g-*）②全体設定タブ（w-ground-*）
//   ③シミュレーションメニューの「地面・壁・背景」ウィンドウ（spRefresh が担当）
// どこから変えても全部が同じ値を出すよう、書き込みは updateGroundProp に、
// 表示の書き戻しはこの関数に一本化する。
//   ★特に μs ≧ μk のクランプが効いたときは、触っていない側の欄も動かす必要がある
//     （μk を μs より大きく入れると μs も一緒に上がる）。
const GROUND_COEF_IDS = [
  ['g-restitution',       'restitution'],    ['w-ground-rest',       'restitution'],
  ['g-friction',          'friction'],       ['w-ground-friction',   'friction'],
  ['g-friction-s',        'frictionStatic'], ['w-ground-friction-s', 'frictionStatic'],
];
function syncGroundCoefUI() {
  for (const [id, prop] of GROUND_COEF_IDS) {
    const el = document.getElementById(id);
    if (!el || document.activeElement === el) continue;   // 入力中の欄は奪わない
    el.value = ground[prop];
    syncSliderById(id);
  }
}
function updateGroundProp(prop, val) {
  ground[prop] = parseFloat(val) || 0;
  if (ground.frictionStatic < ground.friction) ground.frictionStatic = ground.friction;   // μs ≧ μk
  wakeAll();   // 新しい係数を即座に反映（眠っている物体も起こす）
  syncGroundCoefUI();
  spRefresh();   // 設定ウィンドウが開いていれば、その行も合わせる
}
function updateGroundTerrain(on) {
  world.terrain = !!on;
  const w = document.getElementById('w-terrain'); if (w) w.checked = world.terrain;   // 全体設定タブと同期
  wakeAll();
  resolveGroundEmbedding();
  if (!world.terrain) {          // 非表示にすると地面は選べなくなるので、選択を今すぐ解除して表示を整える
    selectedElement = null;
    document.getElementById('st-sel').textContent = 'なし';
    updatePropsPanel(null);
  }
}
// 回折格子のスリット設定。N は本数そのもの、d と a は [m] で受けて内部の px へ直す。
//   ★変えたら板を作り直す：スリット列が板からはみ出すときは板のほうを伸ばす（rebuildGrating）。
function updateSlit(key, v, skipUndo) {
  const raw = parseFloat(v);
  if (!isFinite(raw)) return;
  // N と M は本数そのもの、d と a は [m] で受けて内部の px へ直す
  const val = key === 'slitN' ? Math.max(1, Math.min(SLIT_N_MAX, Math.round(raw)))
            : key === 'slitM' ? Math.max(0, Math.min(DIF_MAX_SUB_SLITS, Math.round(raw)))
            : toPx(Math.max(0.001, raw));
  let pushed = false, last = null;
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b || b.opticKind !== 'grating') continue;
    if (!pushed && !skipUndo) { pushUndo(); pushed = true; }
    b[key] = val;
    rebuildGrating(b);            // a ≤ d への丸めと、板の長さの確保もここで行う
    last = b;
  }
  if (!last) return;
  // 新規に置く格子の既定値も追従させる（同じ設定の格子を続けて置けるように）。
  //   ★スリット数だけは「単スリット」を既定にしない。1本を試したあと、次に置いた格子まで
  //     単スリットになるのは事故に近い（回折格子ツールで置いたのに格子でないものが出る）。
  if (key === 'slitN' && last.slitN >= 2) gratingSlitN = last.slitN;
  if (key === 'slitD') gratingSlitD = last.slitD;
  if (key === 'slitA') gratingSlitA = last.slitA;
  // ★ドラッグ中はパネル全体を作り直さない（スライダーのつまみが跳ねるため）。
  //   欄と注記だけを、丸めた後の実効値へ書き換える。
  if (skipUndo) _syncGratingRows(last, true);
  else          updatePropsPanel(last);
}
// 理想レンズ・理想鏡にするか。形（＝薄板の記号）も焦点距離の下限も変わるので作り直す。
function updateOpticIdeal(on) {
  if (selectedIds.size > 0) pushUndo();
  let last = null;
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b || !opticHasFocal(b.opticKind)) continue;
    b.opticIdeal = !!on;
    // 理想化を外すと球面の下限（R≥H）が戻るので、そこまで届かない f は押し上げる。
    //   放っておくと focalToSagitta 側で黙ってクランプされ、欄の値と実物がずれる。
    b.focal = Math.max(minOpticFocal(b.opticKind, b.opticH, b.ior, b.opticIdeal), b.focal);
    rebuildOpticGeometry(b);
    last = b;
  }
  if (last) updatePropsPanel(last);
}
function updateOpticFocal(v, skipUndo) {
  let pushed = false, last = null;
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b || !opticHasFocal(b.opticKind)) continue;
    if (!pushed && !skipUndo) { pushUndo(); pushed = true; }
    const minF = minOpticFocal(b.opticKind, b.opticH, b.ior, b.opticIdeal);   // ★屈折率・理想化に応じた下限
    b.focal = Math.max(minF, Math.abs(toPx(parseFloat(v) || 0)));          // ★ m → px（符号は素子種で決まる）
    rebuildOpticGeometry(b);
    last = b;
  }
  if (!last) return;
  const disp = ((last.opticKind === 'concaveLens' ? -last.focal : last.focal) * PX2M).toFixed(3);
  if (skipUndo) document.getElementById('p-focal').value = disp;   // ドラッグ中は数値欄のみ（つまみが跳ぶのを防ぐ）
  else updatePropsPanel(last);                                     // クランプ後の実効値を表示へ反映
}
// 光学素子の長さ（開口 2H）[m]。拡大縮小と違って焦点距離は据え置き、球面で作れない
//   短さ（R < H）になるときだけ下限まで押し上げる（updateOpticIdeal と同じ扱い）。
//   質量は拡大縮小と同じく、密度を持っていれば形から出し直す。
function updateOpticLength(v) {
  const L = toPx(parseFloat(v) || 0);
  if (!(L > 0)) return;
  let last = null;
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b || !b.opticKind) continue;
    if (!last) pushUndo();
    // 下限は置くときのドラッグと同じ 15px（mouse.js）。格子はスリット列が収まる長さ（createOptic と同じ）
    b.opticH = Math.max(15, L / 2);
    if (b.opticKind === 'grating') b.opticH = Math.max(b.opticH, gratingMinH(b.slitN, b.slitD));
    if (opticHasFocal(b.opticKind))
      b.focal = Math.max(minOpticFocal(b.opticKind, b.opticH, b.ior, b.opticIdeal), b.focal);
    rebuildOpticGeometry(b);
    if (b.density != null) b.setMass(b.massFromDensity());
    _wake(b);
    last = b;
  }
  if (last) updatePropsPanel(last);
}
function updateScreenProfile(on) {
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (b && b.opticKind === 'screen') b.showProfile = !!on;
  }
}
// 反射率 [%]（0..100 入力 → 内部は 0..1）。すべての物体に効く。
//   フレネル自動計算がONの透明物体では入射角から決まるので、この値は使われない。
function updateReflectance(v, skipUndo) {
  if (!skipUndo && selectedIds.size > 0) pushUndo();
  const r = Math.max(0, Math.min(100, parseFloat(v) || 0)) / 100;
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (b) b.reflectance = r;
  }
  const first = objects.find(o => selectedIds.has(o.id));
  if (first && skipUndo)
    document.getElementById('p-refl').value = Math.round(first.reflectance * 100);
}
// フレネルの式で反射率を自動計算するか（透明な物体でのみ意味を持つ）
function updateFresnel(on) {
  if (selectedIds.size > 0) pushUndo();
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (b) b.fresnel = !!on;
  }
  const first = objects.find(o => selectedIds.has(o.id));
  if (first) updatePropsPanel(first);
}
// 分散（波長ごとに屈折率が変わる）を再現するか。透明な物体でのみ意味を持つ。
// ★OFFはアッベ数0ではなくこのフラグで表す：V_d→0 は無分散ではなく分散無限大なので、
//   V_d は 1〜100 の実在する値のまま保ち、効かせるかどうかだけを切り替える。
function updateDispersion(on) {
  if (selectedIds.size > 0) pushUndo();
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (b) b.dispersion = !!on;
  }
  const first = objects.find(o => selectedIds.has(o.id));
  if (first) updatePropsPanel(first);
}
function rebuildOpticGeometry(b) {
  const g = opticGeometry(b.opticKind, b.opticH, b.focal, b.ior, b.opticIdeal);   // ★屈折率・理想化を渡す
  if (!g) return;
  const verts = g.verts;
  b.verts = verts;
  b.opticArcs = g.arcs;                     // ★焦点距離・屈折率が変われば曲率＝円も変わる
  b.setMass(b.mass);
  const cp = buildConvexParts(verts, null);   // ★内部エッジフラグも作り直す
  b.convexParts      = cp.parts;
  b.partEdgeInternal = cp.internal;
  b.partEdgeArc      = buildPartArcFlags(cp.parts, b.arcs);   // ★（光学素子は通常 arcs を持たないが取り残さない）
  b._invalidateShape();
  b._updateAABB();
  b.sleeping = false; b.sleepTimer = 0;
}
function drawGroundSelection() {
  if (!world.terrain) { selectedElement = null; return; }
  const margin = canvas.width / cam.zoom + 200;
  const xL = cam.x - margin, xR = cam.x + margin;
  const sL = worldToScreen(xL, groundYAt(xL));
  const sR = worldToScreen(xR, groundYAt(xR));
  ctx.save();
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 5]);
  ctx.beginPath(); ctx.moveTo(sL.x, sL.y); ctx.lineTo(sR.x, sR.y); ctx.stroke();
  ctx.restore();
}
// ── レーザーの向き ────────────────────────────────
//   ★入出力は「画面上で見えている向き」（世界角）に統一する。
//     Laser.angle は物体に取り付けたときだけ「取り付け先に対する相対角」なので、
//     まとめて選んだ相手にそのまま相対角を配ると、取り付け先の姿勢のぶんだけ
//     向きがばらける。ここで世界角へ直してから配れば、見た目どおり全部そろう。
function laserWorldAngle(L)      { return L.angle + (L.body ? L.body.angle : 0); }
function setLaserWorldAngle(L, a) { L.angle = a - (L.body ? L.body.angle : 0); }
function updateLaserAngle(v, skipUndo) {
  if (!selectedElement || selectedElement.kind !== 'laser') return;
  if (!skipUndo) pushUndo();
  const a = -(parseFloat(v) || 0) * Math.PI / 180;   // 表示は反時計回り正（角度欄の共通規約）
  const L = selectedElement.laser;
  setLaserWorldAngle(L, a);
  applyToBulk('laser', L, o => setLaserWorldAngle(o, a));
}
function updateLaserWavelength(v, skipUndo) {
  if (!selectedElement || selectedElement.kind !== 'laser') return;
  if (!skipUndo) pushUndo();
  const L = selectedElement.laser;
  L.wavelength = Math.max(380, Math.min(780, parseFloat(v) || 632.8));
  // ★まとめて選んでいるレーザーにも同じ波長を配る。白色光のものは波長を持たないので色は変えない
  applyToBulk('laser', L, o => {
    o.wavelength = L.wavelength;
    if (!o.whiteLight) o.color = wavelengthToHex(o.wavelength);
  });
  if (L.whiteLight) return;                     // 白色光では波長を持たない（表示も変えない）
  L.color = wavelengthToHex(L.wavelength);      // ★色は常に波長から導出
  laserWavelength = L.wavelength;               // 次に置くレーザーの既定にも反映
  document.getElementById('laser-color-swatch').style.background = L.color;
  document.getElementById('laser-wl-note').textContent = wavelengthName(L.wavelength);
}
// 白色光の切り替え（1本のレーザーがプリセット全色を出すモード）
function updateLaserWhite(on) {
  if (!selectedElement || selectedElement.kind !== 'laser') return;
  pushUndo();
  const L = selectedElement.laser;
  L.whiteLight = !!on;
  L.color = L.whiteLight ? '#ffffff' : wavelengthToHex(L.wavelength);
  applyToBulk('laser', L, o => {
    o.whiteLight = L.whiteLight;
    o.color = o.whiteLight ? '#ffffff' : wavelengthToHex(o.wavelength);
  });
  laserWhiteLight = L.whiteLight;   // 次に置くレーザーの既定にも反映（波長と同じ流儀）
  updateLaserPanel(L);
}
function updateLaserInteractHost(on) {
  if (!selectedElement || selectedElement.kind !== 'laser') return;
  pushUndo();
  selectedElement.laser.interactHost = !!on;
  applyToBulk('laser', selectedElement.laser, o => { o.interactHost = !!on; });
  laserInteractHost = !!on;   // 次に置くレーザーの既定にも反映（波長と同じ流儀）
}
// ── ビームの幅と干渉 ───────────────────────────────
function updateLaserWidth(v, skipUndo) {
  if (!selectedElement || selectedElement.kind !== 'laser') return;
  if (!skipUndo) pushUndo();
  const L = selectedElement.laser;
  L.width = Math.max(0, Math.min(20, parseFloat(v) || 0)) * M2PX;   // [m] → [px]
  applyToBulk('laser', L, o => { o.width = L.width; });
  laserWidth = L.width;
  refreshLaserRayNote(L);   // ★本数は変わらない。変わるのは間隔だけ
}
function updateLaserBeamMode(v) {
  if (!selectedElement || selectedElement.kind !== 'laser') return;
  pushUndo();
  const L = selectedElement.laser;
  L.beamMode = v === 'solid' ? 'solid' : 'array';
  applyToBulk('laser', L, o => { o.beamMode = L.beamMode; });
  laserBeamMode = L.beamMode;
  updateLaserPanel(L);
}
function updateLaserRayNum(v, skipUndo) {
  if (!selectedElement || selectedElement.kind !== 'laser') return;
  if (!skipUndo) pushUndo();
  const L = selectedElement.laser;
  L.rayNum = Math.max(1, Math.min(LASER_MAX_RAYS, Math.round(parseFloat(v) || 2)));
  applyToBulk('laser', L, o => { o.rayNum = L.rayNum; });
  laserRayNum = L.rayNum;
  refreshLaserRayNote(L);
}
function updateLaserCoherent(on) {
  if (!selectedElement || selectedElement.kind !== 'laser') return;
  pushUndo();
  const L = selectedElement.laser;
  L.coherent = !!on;
  applyToBulk('laser', L, o => { o.coherent = L.coherent; });
  laserCoherent = L.coherent;
  updateLaserPanel(L);
}
function initLaserPresets() {
  const el = document.getElementById('laser-preset-grid');
  for (const p of LASER_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'mat-btn';
    btn.textContent = p.label;
    btn.title = p.wl + ' nm';
    btn.style.borderLeft = '4px solid ' + wavelengthToHex(p.wl);
    btn.onclick = () => {
      updateLaserWavelength(p.wl);
      document.getElementById('laser-wl').value = p.wl.toFixed(1);
      syncSliders();
    };
    el.appendChild(btn);
  }
}
function updateThrusterForce(v, skipUndo) {
  if (!selectedElement || selectedElement.kind !== 'thruster') return;
  if (!skipUndo) pushUndo();
  const th = selectedElement.thr;
  th.force = Math.max(0, parseFloat(v) || 0);
  applyToBulk('thruster', th, o => { o.force = th.force; if (o.body) _wake(o.body); });
  _wake(selectedElement.body);             // 推力を変えたら眠っている物体を起こす
}
function updateTracerColor(v) {
  if (!selectedElement || selectedElement.kind !== 'tracer') return;
  const b = selectedElement.body;
  b.tracerColor = v;
  applyToBulk('tracer', b, o => { o.tracerColor = v; });
  document.getElementById('tracer-color-swatch').style.background = v;
}
// 軌跡の保持秒数を更新（時間基準で古い点を破棄する上限秒数）
function updateTracerDuration(v, skipUndo) {
  if (!selectedElement || selectedElement.kind !== 'tracer') return;
  if (!skipUndo) pushUndo();
  const d = Math.max(0.5, Math.min(60, parseFloat(v) || 5));
  const b = selectedElement.body;
  // 短くした場合は、はみ出した古い点を即座に刈り取る（次のtickを待たずに反映）
  const cutoff = world.simTime - d;
  const setDur = o => {
    o.tracerDuration = d;
    let _cut = 0;
    while (_cut < o.tracePoints.length &&
           o.tracePoints[_cut].t !== undefined && o.tracePoints[_cut].t < cutoff) _cut++;
    if (_cut > 0) o.tracePoints.splice(0, _cut);   // 先頭ずらしを1回にまとめる
  };
  setDur(b);
  applyToBulk('tracer', b, setDur);
  if (skipUndo) document.getElementById('tracer-duration').value = d;
}
// ─── 波源・レーザーの複製 ──────────────────────────────
//   設定（波源なら周波数・振幅・位相・ON/OFF、レーザーなら波長・向き・白色光・取り付け先との
//   相互作用）と、物体に載せてあるかどうかをそのまま引き継ぐ。位置だけ物体の貼り付けと同じ
//   +30px ずらして、元の上に重ならないようにする。
//   ★波源の位相もコピーする。2つ目の波源は「同位相の点波源」＝ヤングの実験や干渉の実演で
//     いちばん使う配置なので、既定でそろっている必要がある（ずらしたいときは右パネルで変える）。
//   ★レーザーの角度もコピーする。平行光線を何本も並べる（レンズ・鏡の作図）のが主な用途で、
//     向きがばらけると並べ直す手間のほうが大きい。
//   ★物体に載ったものは localX/Y が物体ローカル座標なので、そのまま同じ物体に載る。
const ELEM_DUP_OFFSET = 30;   // [px] 複製をずらす量（物体の貼り付けと同じ）
function cloneWaveSources(list) {
  const made = [];
  for (const S of list || []) {
    const c = new WaveSource({
      body: S.body, localX: S.localX + ELEM_DUP_OFFSET, localY: S.localY + ELEM_DUP_OFFSET,
      freq: S.freq, amp: S.amp, phase: S.phase, enabled: S.enabled,
    });
    waveSources.push(c);
    made.push(c);
  }
  if (made.length) refreshWaveInfo();   // 波源の数・波長などの案内を出し直す
  return made;
}
function cloneLasers(list) {
  const made = [];
  for (const L of list || []) {
    const c = new Laser({
      body: L.body, localX: L.localX + ELEM_DUP_OFFSET, localY: L.localY + ELEM_DUP_OFFSET,
      angle: L.angle, wavelength: L.wavelength, whiteLight: L.whiteLight,
      interactHost: L.interactHost,
      // ★複製は「独立したもう1台のレーザー」なので、複製元とは干渉しない（干渉するのは
      //   同じレーザーの枝どうしだけ）。1台を分けた2本が要るならハーフミラーで分岐させる。
      width: L.width, beamMode: L.beamMode, rayNum: L.rayNum, coherent: L.coherent,
    });
    lasers.push(c);
    made.push(c);
  }
  return made;
}
// 選択中の要素（クリック選択・範囲選択の両方／レーザーと波源が混ざっていてもよい）を複製し、
// 複製したほうを選択状態にする。複製するものが無ければ false（呼び出し元は物体の複製へ回す）
function duplicateSelectedElements() {
  const beams = selectedLasers(), waves = selectedWaveSources();
  if (!beams.length && !waves.length) return false;
  pushUndo();
  const made = [...cloneLasers(beams), ...cloneWaveSources(waves)];
  clearAllSelections();
  if (made.length === 1) {
    const c = made[0];
    selectNewElement(c instanceof Laser ? { kind:'laser', laser:c } : { kind:'wave', source:c });
  } else {
    for (const c of made) if (!c.body) selectedElemIds.add(c.id);   // 物体に載ったものは枠選択の対象外
    refreshSelCount();
  }
  return true;
}
// 範囲選択に入っているレーザー・波源を消す（Undo は呼び出し元で積む）
function removeBoxSelectedElements(list) {
  for (const el of list || []) {
    if (el instanceof WaveSource) {
      const i = waveSources.indexOf(el); if (i >= 0) waveSources.splice(i, 1);
    } else {
      const i = lasers.indexOf(el); if (i >= 0) lasers.splice(i, 1);
    }
  }
  if (!waveActiveSources().length) resetWaveField();
  refreshWaveInfo();
}
function deleteSelectedElement() {
  if (!selectedElement) return;
  if (selectedElement.kind === 'ground') return;   // 地面は削除不可
  if (selectedElement.kind === 'joint') {          // ★端を掴んだジョイントはジョイントごと削除
    selectedJointId = selectedElement.joint.id;
    selectedElement = null;
    deleteSelectedJoint();
    return;
  }
  pushUndo();
  if (selectedElement.kind === 'laser') {
    const i = lasers.indexOf(selectedElement.laser); if (i >= 0) lasers.splice(i, 1);
  } else if (selectedElement.kind === 'thruster') {
    removeThruster(selectedElement.body, selectedElement.thr);   // ★その1本だけを外す
  } else if (selectedElement.kind === 'tracer') {
    selectedElement.body.tracerEnabled = false; selectedElement.body.tracePoints = [];
  } else if (selectedElement.kind === 'arcoat') {
    arCoatRemove(selectedElement.body, selectedElement.index);
  } else if (selectedElement.kind === 'wave') {
    const i = waveSources.indexOf(selectedElement.source); if (i >= 0) waveSources.splice(i, 1);
    if (!waveActiveSources().length) resetWaveField();
    refreshWaveInfo();
  } else if (selectedElement.kind === 'slinky') {
    removeSlinky(selectedElement.slinky);   // 先端おもりも一緒に消す
  } else if (selectedElement.kind === 'emfield') {
    const i = emFields.indexOf(selectedElement.field); if (i >= 0) emFields.splice(i, 1);
  } else if (selectedElement.kind === 'heatfield') {
    const i = heatFields.indexOf(selectedElement.field); if (i >= 0) heatFields.splice(i, 1);
  } else if (selectedElement.kind === 'flowfield') {
    const i = flowFields.indexOf(selectedElement.field); if (i >= 0) flowFields.splice(i, 1);
  } else if (selectedElement.kind === 'gas') {
    // ★器・蓋ごと消す。気体だけを抜いた「空の器」という状態をモデルが持っていない
    //   （真空にすると大気圧が蓋を閉端まで潰すだけになる）。
    const v = pistonVesselOfChamber(selectedElement.chamber.id);
    if (v) deletePistonVessel(v);
  }
  selectedElement = null;
  document.getElementById('st-sel').textContent = 'なし';
  updatePropsPanel(null);
}
