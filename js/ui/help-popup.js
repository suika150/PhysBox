let helpPopup = null;
function _helpFor(text) {
  const t = (text || '').trim();
  let best = null, bl = -1;                     // 最長一致にして定義順への依存をなくす
  for (const k in PROP_HELP) if (t.startsWith(k) && k.length > bl) { best = PROP_HELP[k]; bl = k.length; }
  return best;
}
function showHelpPopup(anchor, h, below) {
  hideHelpPopup();
  hideToolTip();       // 用語の説明のほうが詳しいので、title の吹き出しとは重ねない
  const d = document.createElement('div');
  d.id = 'help-popup';
  d.innerHTML = `<div class="help-title">${h.t}</div><div class="help-body">${h.b}</div>`;
  document.body.appendChild(d);
  const r = anchor.getBoundingClientRect(), m = 6;
  let left, top;
  if (below) {                                     // 上部バーのボタン用：真下に出す
    left = Math.max(m, Math.min(r.left, window.innerWidth - d.offsetWidth - m));
    top  = r.bottom + 6;
  } else {
    left = r.left - d.offsetWidth - 10;            // 右パネル上のラベルなので既定は左側へ
    if (left < m) left = r.right + 10;
    top = Math.max(m, Math.min(r.top - 4, window.innerHeight - d.offsetHeight - m));
  }
  d.style.left = left + 'px';
  d.style.top  = top  + 'px';
  helpPopup = d;
}
function hideHelpPopup() { if (helpPopup) { helpPopup.remove(); helpPopup = null; } }
const TOPBAR_HELP = {
  'btn-grid': { t:'グリッドスナップ', b:
    'ONにすると、置いたり動かしたりする位置が<b>グリッド線の交点に吸い付きます</b>。' +
    '図形の描き始め・描き終わり、ジョイントの端点、動力・レーザー・軌跡の設置点、' +
    '編集ツールでの平行移動が対象です。<br><br>' +
    '吸い付く間隔は表示されているグリッド線の間隔と同じで、' +
    '<b>表示メニュー →「グリッド線の間隔 [m]」</b>で変えられます（既定0.5 m）。<br><br>' +
    'ONの間は、グリッド線を非表示にしていても格子が薄く表示されます。<br><br>' +
    '<b>Ctrl を押している間だけ</b>、ON/OFF が逆になります（図形を作っている間・物体を運んでいる間）。' +
    'そのあいだはこのボタンも光って知らせます。<br><br>' +
    '<b>四角・三角を描くときは、頂点ではなく重心が格子点に乗ります</b>' +
    '（描画中は重心の位置に黄色い十字が出ます）。' +
    '初期位置を x = 1.0 m のようにきりのよい値へ置きたいときは、重心のほうが扱いやすいためです。' },
    'btn-osnap': { t:'オブジェクトスナップ', b:
    'ONにすると、設置する点が物体の<b>頂点・辺の中点・中心（重心）</b>に吸い付きます。' +
    '吸着先は黄色いマーカーで示されます（■＝頂点／▲＝辺の中点／●＋十字＝中心）。<br><br>' +
    '効くのは<b>ヒンジ・溶接・モーター・ばね・ロープ・連結棒・動力・レーザー・波源・軌跡・光学素子・多角形の頂点</b>と、' +
    'すでに置いた要素をドラッグで動かすときです。<br><br>' +
    '「連結棒の端をちょうど円の中心に刺す」「ばねを辺の中点に張る」といった作業を、目視に頼らず正確に行えます。' +
    '回転させたい物体の重心にヒンジを打てば、偏心のない単純な回転になります。<br><br>' +
    'グリッドスナップとは<b>独立して</b>使えます。両方ONのときは、吸着範囲に特徴点があればそちらが優先され、' +
    '無ければグリッドの交点へ落ちます。<br><br>' +
    '物体を運ぶときは、運んでいる物体の頂点・辺の中点・中心が、ほかの物体の特徴点に吸い付きます。<br><br>' +
    '<b>Alt を押している間だけ</b>、ON/OFF が逆になります（そのあいだはこのボタンも光ります）。<br><br>' +
    'フリーハンド・液体／気体には効きません（吸い付くと描けなくなるためです）。' },
  // ★「追従」ボタンは 表示メニュー を経て、いまは上バーのカメラの窓の「選んだ物体を追う」。
  //   説明は sim-popover.js の camera 内、各行の title へ移してある
  //   （重心系と運動量保存の話は「中心は選択範囲（OFF＝質量重心）」に入っている）。
  //   なお「何も選択していない間は直前の対象を追い続ける」のは followIds の仕様のまま。
};
function initTopbarHelp() {
  for (const id in TOPBAR_HELP) {
    const el = document.getElementById(id);
    if (!el) continue;
    const h = TOPBAR_HELP[id];
    el.removeAttribute('title');   // 詳しい説明があるので、title の吹き出しと二重に出さない
    el.addEventListener('mouseenter', () => showHelpPopup(el, h, true));
    el.addEventListener('mouseleave', hideHelpPopup);
  }
}
function initPropHelp() {
  const els = document.querySelectorAll(
    '#tab-props .prop-label, #tab-props .checkbox-row label, ' +
    '#tab-world .prop-label, #tab-world .checkbox-row label');
  for (const el of els) {
    const h = _helpFor(el.textContent);
    if (!h) continue;
    el.classList.add('has-help');
    el.addEventListener('mouseenter', () => showHelpPopup(el, _helpWithUnit(h, el)));
    el.addEventListener('mouseleave', hideHelpPopup);
  }
  hideLabelUnits(document.getElementById('rightpanel'));
  // ★見出しは JS があとから書き換える（出力/吸熱、電圧/振幅、回路の窓を innerHTML で作り直す等）。
  //   書き換えのたびに単位が表に戻るので、呼び出し側を1つずつ直すのではなくここで拾い直す。
  new MutationObserver(() => hideLabelUnits(document.getElementById('rightpanel')))
    .observe(document.getElementById('rightpanel'), { childList: true, subtree: true, characterData: true });
}
// ── 見出しの単位は隠し、カーソルを合わせたときに出す ──────────────
//   ★右パネルの見出しは幅 80px で全角7文字まで。単位まで書くと2行に折れて読みにくい、
//     という指摘で、末尾の [単位] を .u へ移して CSS で隠すことにした。
//     文字列から消すのではなく隠すだけなので、textContent（用語の吹き出しの引き当て・
//     スライダーの拡大バーの名前）には単位が残る。
//   記号（μs・C_V など）も隠したいときは、HTML 側で最初から <span class="u"> に入れておく。
const LABEL_UNIT_RE = /\s*\[[^\]]*\]\s*$/;
function hideLabelUnit(el) {
  if (el.querySelector('.u')) return;
  const last = el.lastChild;
  if (!last || last.nodeType !== Node.TEXT_NODE) return;
  const m = last.nodeValue.match(LABEL_UNIT_RE);
  if (!m) return;
  last.nodeValue = last.nodeValue.slice(0, m.index);
  const u = document.createElement('span');
  u.className = 'u'; u.textContent = m[0];
  el.appendChild(u);
}
function hideLabelUnits(root) {
  if (root) for (const el of root.querySelectorAll('.prop-label')) hideLabelUnit(el);
}
// 用語の吹き出しの見出しに、隠した単位・記号が書かれていなければ足す（書き換わる見出しがあるので出す瞬間に見る）
function _helpWithUnit(h, el) {
  const u = el.querySelector('.u');
  if (!u) return h;
  const want = u.textContent.trim();
  const have = h.t.replace(/<[^>]+>/g, '');
  // 単位は吹き出しの見出しの書き方を正とする（[1/m] と [/m] のように表記が違うことがある）
  const ok = want.startsWith('[') ? have.includes('[') : have.includes(want);
  return ok ? h : { t: h.t + ' ' + want, b: h.b };
}
// 用語の吹き出しが無い見出しは、名前＋単位を title の吹き出し（data-tip）で出す。
//   ★文言が書き換わる見出しがあるので、合わせた瞬間に作る（委譲なので、あとから作られた行にも効く）。
//     initTitleTips の mouseover より先に登録されているので、出す前に中身が決まる。
document.addEventListener('mouseover', e => {
  const el = e.target.closest && e.target.closest('.prop-label');
  if (!el || el.classList.contains('has-help') || !el.querySelector('.u')) return;
  if (el.dataset.ownTip === undefined) el.dataset.ownTip = el.getAttribute('title') || el.dataset.tip || '';
  el.removeAttribute('title');
  const full = el.textContent.replace(/\s+/g, ' ').trim();
  el.dataset.tip = el.dataset.ownTip ? full + '\n' + el.dataset.ownTip : full;
});
// ── ツールバーの吹き出し ──────────────────────────
//   #toolbar は overflow でクリップするため、ボタン内に置いたままでは出せない。
//   文言はボタン内の .tool-tip から読み、表示は body 直下の1個を使い回す。
let toolTipPop = null;
// 吹き出しを出す。where='right' は左ツールバー用（ボタンの右横）、
// それ以外は「下、入らなければ上」へ置く。中身は文字だけ（title と同じ扱い）。
function showToolTip(anchor, text, where) {
  hideToolTip();
  const d = document.createElement('div');
  d.id = 'tool-tip-pop';
  d.textContent = text;
  document.body.appendChild(d);
  const r = anchor.getBoundingClientRect(), m = 6;
  const W = d.offsetWidth, H = d.offsetHeight;
  let left, top;
  if (where === 'right') {
    left = r.right + 8;
    top  = r.top + r.height/2 - H/2;
  } else {
    left = r.left;
    top  = r.bottom + 8;
    if (top + H > window.innerHeight - m) top = r.top - H - 8;   // 下に入らなければ上へ
  }
  d.style.left = Math.max(m, Math.min(left, window.innerWidth  - W - m)) + 'px';
  d.style.top  = Math.max(m, Math.min(top,  window.innerHeight - H - m)) + 'px';
  toolTipPop = d;
}
function hideToolTip() { if (toolTipPop) { toolTipPop.remove(); toolTipPop = null; } }
// ─── title 属性の吹き出し ──────────────────────────────
//   ブラウザ標準の title は OS が描く箱（黒枠・うすい黄色・黒文字）で、配色も書体も
//   出るまでの間もアプリと揃わない。そこで title を data-tip へ引き取り、
//   同じ #tool-tip-pop で出す。
//   ★イベント委譲なので、あとから作られる要素（メニュー・設定ウィンドウ・右クリック
//     メニュー・カラーピッカー）も何もしなくても対象になる。title は全体で200近くあり、
//     個別に手を入れる方式では追随できない。
const TIP_DELAY = 350;   // [ms] なぞっただけでは出さない
let _tipTimer = null, _tipEl = null;
function _tipTextOf(el) {
  // 同じ要素に title が付け直されることがある（スライダーの無効化など）ので毎回見る。
  // title='' は「説明を消した」合図なので、引き取り済みの文言も一緒に捨てる。
  if (el.hasAttribute('title')) {
    const t = el.getAttribute('title');
    el.removeAttribute('title');            // 標準の箱を出させない
    if (t) el.dataset.tip = t; else delete el.dataset.tip;
  }
  return el.dataset.tip || '';
}
function initTitleTips() {
  document.addEventListener('mouseover', e => {
    const el = e.target.closest && e.target.closest('[title], [data-tip]');
    if (!el || el === _tipEl) return;
    _cancelTitleTip();
    const text = _tipTextOf(el);
    if (!text) return;
    _tipEl = el;
    // ツールバーのボタンは右横、それ以外は下（画面の端では自動で逃がす）
    const where = el.closest('#toolbar') ? 'right' : 'below';
    _tipTimer = setTimeout(() => {
      // 用語の説明（#help-popup）が出ているときは重ねない。あちらのほうが詳しい
      if (!helpPopup && document.body.contains(el)) showToolTip(el, text, where);
    }, TIP_DELAY);
  });
  document.addEventListener('mouseout', e => {
    if (_tipEl && !_tipEl.contains(e.relatedTarget)) _cancelTitleTip();
  });
  // 操作が始まったら引っ込める（クリック・スクロール・キー入力・ウィンドウ外へ）
  for (const ev of ['mousedown', 'wheel', 'keydown'])
    document.addEventListener(ev, _cancelTitleTip, true);
  window.addEventListener('blur', _cancelTitleTip);
}
function _cancelTitleTip() {
  clearTimeout(_tipTimer); _tipTimer = null; _tipEl = null;
  hideToolTip();
}
function initToolTips() {
  for (const btn of document.querySelectorAll('#toolbar .tool-btn')) {
    const src = btn.querySelector('.tool-tip');
    const text = src ? src.textContent.trim() : '';
    if (!text) continue;
    btn.removeAttribute('title');   // ブラウザ標準の吹き出しと二重に出さない
    btn.addEventListener('mouseenter', () => showToolTip(btn, text, 'right'));
    btn.addEventListener('mouseleave', hideToolTip);
    btn.addEventListener('click',      hideToolTip);   // ツール設定ポップアップに被せない
  }
}
function initMaterialGrid() {
  const el=document.getElementById('material-grid');
  for(const [name,props] of Object.entries(MATERIALS)){
    const btn=document.createElement('button');
    btn.className='mat-btn';
    btn.textContent=name;
    btn.dataset.mat = name;                      // 強調表示を選択中の物体から引き直すための目印
    btn.title = `密度 ${props.density} kg/m³`;   // ★追加
    btn.onclick=()=>{
      const off = btn.classList.contains('active');       // ★選択中をもう一度 → 解除して既定値へ
      // ★drawProps へは伝播させない。新規物体の素材は図形ツールのポップアップで指定する
      // ★強調表示と色の見本はここで触らない。applyMaterialToSelection → updatePropsPanel が
      //   物体の値から導き直すので、押した見た目と実際の値がずれることがない
      applyMaterialToSelection(off ? MATERIAL_DEFAULT : props);
    };
    el.appendChild(btn);
  }
}
// 素材プリセットの強調表示を、いま選択している物体の値に合わせる。
// この素材グリッド内だけを触る（レーザー・向きのプリセットも .mat-btn なので巻き込まない）。
function syncMaterialGrid(b) {
  const el = document.getElementById('material-grid');
  if (!el) return;
  const name = bodyMaterialName(b);
  for (const btn of el.querySelectorAll('.mat-btn'))
    btn.classList.toggle('active', btn.dataset.mat === name);
}
// ════════════════════════════════════════
//  カスタムカラーピッカー（プリセット・履歴内蔵／クリック位置に表示）
// ════════════════════════════════════════
const RECENT_KEY = 'physbox.recentColors';
const RECENT_MAX = 18;
