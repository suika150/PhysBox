document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  // ── ショートカットは3つだけ（2026-09。文字キーのツール切替はすべて外した）──────────
  //   Z ＝ 実行／停止、Space（押している間）＝ つかむ、Esc ＝ 編集ツールへ戻る（下）。
  //   ★実行／停止は 2026-09-27 に「.」から Z へ移した（ユーザーの指定）。
  //     Ctrl+Z（元に戻す）とは修飾キーの有無で分ける。
  //   ★文字キーをツールに使わないのは、キーをリモコン・プログラムに明け渡すため。
  //     以前は C/R/T/P/W… の15文字が予約で、よろよろ走りのデモの W・P を窓から割り当てられなかった。
  //   ★Z は入力欄の中では拾わない（文字の欄で打てなくなる）。値を変えたら欄の外を
  //     押してから Z。スライダー（range）は文字を打たないので、そこからは効かせる。
  const tIn = e.target;
  const typing = tag === 'SELECT' || tag === 'TEXTAREA' || tIn.isContentEditable ||
                 (tag === 'INPUT' && tIn.type !== 'range');
  if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat && !typing) {
    e.preventDefault();
    toggleRun();
    return;
  }
  // ★Space は押している間だけ「つかむ」（描画ソフトの Space＝手のひら と同じ形）。
  //   放すと元のツールへ戻る（keyup 側）。ボタンにフォーカスがあると Space がボタンを
  //   押してしまうので、ボタン・チェックボックス以外の場所では既定の動作を止める。
  //   ★置いている途中（isPlacingNow）は切り替えない。setTool が作りかけを捨てるため。
  if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing &&
      !(tag === 'INPUT' && (tIn.type === 'checkbox' || tIn.type === 'radio'))) {
    e.preventDefault();
    if (tag === 'BUTTON') tIn.blur();
    if (!e.repeat) spaceGrabDown();
    return;
  }
  if (tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || e.target.isContentEditable) return;
  // ── プログラムの「キーを押した瞬間」／リモコンの「押している間だけ」───────
  //   ★1文字のツール切替より先に見る。後ろに置くと、たとえば C を割り当てても
  //     円ツールに食われて永久に届かない（Ctrl+C が円ツールに化けていたのと同じ形）。
  //   ★拾ったら return する。同じキーがツール切替も兼ねると、押すたびに道具が
  //     変わって図が壊れる。とはいえ、割り当てるときに RESERVED_KEYS で弾いているので
  //     （keyBindConflict）、ここでツールのキーを奪う状況にはもうならない。
  //   ★リモコンには押しっぱなしの自動リピートも来るが、状態を立てるだけなので同じ。
  //     放す側は下の keyup と、ウィンドウを離れたときの blur で必ず落とす。
  // ★どちらも修飾キーを押していないときだけ。ここを見ないと、Z を割り当てたリモコンが
  //   Ctrl+Z（元に戻す）でも動いてしまい、しかも下の Ctrl 分岐へ落ちないので
  //   元に戻すが永久に効かなくなる（Ctrl+C／Ctrl+S も同じ形）。
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!e.repeat && fireProgramsByKey(e.code)) { e.preventDefault(); return; }
    if (remoteKeyDown(e.code, e.repeat)) { e.preventDefault(); return; }
  }
  const k=e.key.toLowerCase();
  // ★修飾キー付きは1文字ショートカットより先に処理する。
  //   後ろに置くと、この if/else 連鎖の先頭にある1文字のツール切替に食われてしまう：
  //   Ctrl+C は k==='c' で円ツール、Ctrl+V は k==='v' で編集ツールに化けて、
  //   コピー／貼り付けが永久に届かなかった（Ctrl+R→四角、Ctrl+B→連結棒なども同様）。
  //   以前は 's' にだけ !e.ctrlKey を付けて凌いでいたが、全部の文字で起きるので一括で分ける。
  if (e.ctrlKey || e.metaKey) {
    // ★拾ったものだけ preventDefault する。そうしないとブラウザ既定の動作が重なって
    //   Ctrl+S でページ保存ダイアログ、Ctrl+A でページ全体が選択されてしまう。
    //   拾わない組み合わせ（Ctrl+R の再読み込みなど）は既定のまま通す。
    if (k==='a') selectAll();          // ★メニューの「すべて選択」と同一の処理（menubar.js）
    // ★Shift 付きはプロパティのコピー／貼り付け（設定だけを配る。js/app/select-helpers.js）。
    //   物体そのもののコピーより先に見る（後ろだと k==='c' で必ず先に食われる）。
    else if (k==='c') { e.shiftKey ? copyBodyProps() : ctxCopy(); }
    else if (k==='v') { e.shiftKey ? pasteBodyProps() : ctxPaste(); }
    else if (k==='z') { e.shiftKey ? stepForward() : stepBack(); }   // Ctrl+Shift+Z=進む
    else if (k==='y') stepForward();                                 // Ctrl+Y=進む
    else if (k==='s') saveScene();
    else return;                       // 知らない組み合わせはブラウザへ任せる
    e.preventDefault();
    return;                            // ★ツール切替へは落とさない
  }
  if (e.altKey) return;                // Alt 付きもツール切替の対象外
  if (k==='delete'||k==='backspace') ctxDelete();
  else if (k==='escape') {
    // ★Esc は「いちばん内側で開いているものを1つ閉じる」だけにする。
    //   色ピッカー（color-picker.js）と GIF録画モード（gif-recorder.js）も
    //   それぞれ Esc を拾っているが、どれも propagation を止めないので、
    //   ピッカーを閉じるつもりの Esc がここまで届いて選択まで解除していた。
    if (colorPickerOpen) return;
    if (typeof gifRec !== 'undefined' && gifRec.active) return;
    // ★選択の解除はメニューの「選択を解除」と同じ deselectAll() に任せる（menubar.js）。
    //   以前はここで自前に並べていたため、①回路素子の選択（selectedCircuit）だけ
    //   解除し忘れ、その状態で Delete すると回路素子のほうが消えた ②ステータスバーの
    //   「◯個」が選択を解いても残ったまま、という2つのずれが出ていた。
    // ★書きかけの文字があるなら、それを捨てるだけで止める（Esc は「いちばん内側で
    //   開いているものを1つ閉じる」なので、選択解除やツール切替までは進めない）。
    if (annotEditing) { finishAnnotEdit(true); return; }
    if (annotStroke) { annotStroke = null; return; }   // ★描きかけ（多角の頂点など）を捨てるだけ
    deselectAll();
    cancelAnnotInteractions();   // ★注釈の平行移動・回転も破棄
    elementDrag=null;       // ★
    elementRotate=null;     // ★
    boxDrag=null;           // ★
    emFieldResize=null;     // ★領域のサイズ変更も破棄
    circuitWholeDrag=null;  // ★回路素子の平行移動も破棄
    circuitGroupDrag=null;  // ★まとめて選んだ回路素子の平行移動も破棄
    circuitVertexDrag=null; circuitStart=null; circuitChainPlaced=false;   // ★回路の配置途中・端点ドラッグを破棄
    polyDrawing=false; drawPts=[]; drawStart=null; jointStart=null;
    setTool('pointer');
  }
  else if (k==='[') cam.zoom=Math.max(cam.minZoom,cam.zoom*0.9);
  else if (k===']') cam.zoom=Math.min(cam.maxZoom,cam.zoom*1.1);
});
// ── 割り当て済みのキー ────────────────────────────────────────────────
//  ★上のショートカット表と対にして、必ず**すぐ隣に**置くこと（片方だけ足すと、
//    その新しいキーはリモコン・プログラムから奪えてしまう）。値は e.code。
//  ★これが無いと、割り当てが黙って2通りに壊れる（どちらも画面には何も出ない）：
//      ・Space を割り当てる → 押しても効かない（上の「実行／停止」が先に食う。実測）
//      ・C を割り当てる    → リモコンが勝ち、円ツールのショートカットが死ぬ（実測）
const RESERVED_KEYS = {
  KeyZ:'実行／停止', Space:'つかむ', Escape:'編集ツール・選択の解除', Delete:'削除', Backspace:'削除',
  BracketLeft:'表示を縮小', BracketRight:'表示を拡大',
};
// そのキーを割り当ててよいか。ダメなら理由の文字列、よければ null。
//   own … いま設定しようとしている本人（自分自身とは重複としない）
//   ★プログラムの窓とリモコンの窓の両方から呼ぶ。判定を2つ持つと必ず片方だけ直す。
//   ★禁止するのは**予約キーだけ**。リモコンどうし・プログラムとの重複は禁止しない。
//     1つのキーで複数を同時に動かすのは道具として要る：左右の波源から山を同時に出す
//     ような機構は、押す回数が2回になった時点で成り立たない（ずれた分だけ出会う場所が
//     動く）。エンジンは前からそう動いていて（remoteKeyDown は一致するリモコンを
//     **全部**発火する）、止めていたのはこの入口だけだった。
//     知らずに二重に割り当てる事故のほうは、keyBindShared を窓に出して伝える。
function keyBindConflict(code, own) {
  if (RESERVED_KEYS[code]) return '「' + RESERVED_KEYS[code] + '」に使われています';
  return null;
}
// そのキーを一緒に使っている相手の名前（無ければ null）。★禁止ではなく知らせるだけ
function keyBindShared(code, own) {
  const out = [];
  for (const p of programs) if (p !== own && p.trigger === 'key' && p.key === code)
    out.push('プログラム ' + p.id);
  for (const r of remotes)  if (r !== own && r.usesKey() && r.key === code)
    out.push('リモコン ' + r.id);
  return out.length ? out.join('・') : null;
}
// 描画中の Shift / Alt 状態を常時追従（マウス静止時もプレビューへ反映）
//   ★物体を運んでいる最中なら、押した／放した瞬間にその場で置き直す（Ctrl=グリッド・Alt=物体
//     スナップの入れ切り。マウスを動かすまで反映されないと、効いたかどうか分からない）。
//     作成中のプレビューは毎フレーム描き直すので、状態を更新するだけで追従する。
function syncMoveSnapKeys(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  const changed = modShift !== e.shiftKey || modAlt !== e.altKey || modCtrl !== ctrl;
  modShift = e.shiftKey; modAlt = e.altKey; modCtrl = ctrl;
  // ★Alt をスナップに使っている間は既定動作を止める（ブラウザによってはメニューバーへフォーカスが移る）
  if (e.key === 'Alt' && snapModsApply()) e.preventDefault();
  if (changed && pointerGroupMoving() && mouseWorld) movePointerGroupTo(mouseWorld);
  if (changed) refreshSnapButtons();
}
window.addEventListener('keydown', e => { syncMoveSnapKeys(e); });
window.addEventListener('keyup',   e => { syncMoveSnapKeys(e); remoteKeyUp(e.code);
                                          if (e.code === 'Space') spaceGrabUp(); });
// ── Space を押している間だけ「つかむ」──────────────────────────────
//   ★戻る先は押したときのツール。押している間に別のツールを選んだら、そちらを優先して
//     戻さない（currentTool がもう pan でない）。
//   ★物をつかんだまま Space を放したら、マウスを放すまで待ってから戻す。途中で戻すと
//     setTool がつかみを捨てて、持っていた物が手から落ちる。
let _spaceGrab = null;   // { prev, waitMouse }
function spaceGrabDown() {
  if (_spaceGrab || currentTool === 'pan' || isPlacingNow()) return;
  _spaceGrab = { prev: currentTool, waitMouse: false };
  setTool('pan');
}
function spaceGrabUp() {
  if (!_spaceGrab) return;
  if (isMouseDown) { _spaceGrab.waitMouse = true; return; }
  const prev = _spaceGrab.prev;
  _spaceGrab = null;
  if (currentTool === 'pan') setTool(prev);
}
// ★運び終えたらスナップボタンの光り方をボタン本来の状態へ戻す。canvas の mouseup が
//   運ぶ状態を片付けた後に見たいので、次の番に回す。
window.addEventListener('mouseup', () => setTimeout(refreshSnapButtons, 0));
window.addEventListener('mouseup', () => {
  if (_spaceGrab && _spaceGrab.waitMouse) { _spaceGrab.waitMouse = false; spaceGrabUp(); }
});
// ★別のウィンドウへ移った瞬間に、押していたリモコンを全部放す。keyup はこちらへ
//   届かなくなるので、これが無いと押しっぱなしのまま走り続ける。
window.addEventListener('blur', () => { releaseAllRemotes(); if (_spaceGrab) { _spaceGrab.waitMouse = false; spaceGrabUp(); } });
window.addEventListener('blur',    () => { modShift = false; modAlt = false; modCtrl = false; refreshSnapButtons(); });
// ── ツール設定ウィンドウとドラッグ配置の共存 ──
//   canvas の mousemove/mouseup は canvas 要素に張られているため、カーソルが
//   ポップアップに乗るとイベントが奪われ、サイズ更新も確定クリックも止まる。
//   ドラッグ中だけ pointer-events:none で下の canvas へ貫通させ、重なっている
//   間は半透明にして下のプレビューを見せる。
// ★左ツールバーのツール設定ウィンドウの一覧。ここが唯一の定義で、
//   ①この下のイベント貫通の制御と、②js/ui/tool-menus.js の closeToolPopups（同時に
//   開くのは1つだけにする）の両方が参照する。窓を増やしたらここに1行足すこと。
const TOOL_POPUP_IDS = ['grab-popup','velocity-popup','fixjoint-popup','hinge-popup',
  'slinky-popup','rope-popup','axle-popup','thruster-popup','laser-popup','tracer-popup','wave-popup',
  'particle-popup','shape-popup','circuit-popup','optics-popup','emfield-popup',
  'heatfield-popup','flowfield-popup','boolean-popup','annot-popup','draw-popup','gearcoat-popup','measure-popup'];
// ★このうち「設定ウィンドウ」ではなく、選ぶだけのメニューであるもの。
//   ツールを切り替えないので配置と重なることがなく、貫通させる理由がない。
//   逆に貫通させると中身（.ctx-item は div で、下の POPUP_INTERACTIVE_SEL の
//   どれにも当たらない）が pointer-events:none のままになり、項目は見えているのに
//   クリックできなくなる＝「図形和のメニューは出るのに選べない」。
//   ★除外は armToolPopup の中でやること。この関数は render のループ以外に
//     下の mousemove からも直接呼ばれるので、呼び出し口ごとに書くと必ず取りこぼす。
const TOOL_MENU_ONLY_IDS = ['boolean-popup'];
const isMenuOnlyPopup = el => TOOL_MENU_ONLY_IDS.indexOf(el.id) >= 0;
function forEachToolPopup(fn) {
  for (const id of TOOL_POPUP_IDS) { const el = document.getElementById(id); if (el) fn(el); }
}
// ツール設定ウィンドウは「本体は常にイベント貫通・コントロールだけ操作可能」に統一する。
//   これで①ドラッグ配置②2クリック配置の合間③単クリック配置の、いずれでウィンドウ上に
//   カーソルが来ても、下のキャンバスがプレビュー更新・確定クリックを受け取れる。一方で
//   スライダー・ボタン・×・ドラッグ用ヘッダーは pointer-events:auto に戻すので従来どおり効く。
//   ・[id$="-close"] / .popup-close … 各ウィンドウの × ボタン
//   ・#circuit-pop-head … 回路ウィンドウのドラッグ用ヘッダー
const POPUP_INTERACTIVE_SEL =
  'input, button, select, textarea, label, a, .color-swatch, .popup-close, [id$="-close"], #circuit-pop-head';
// 配置の最中は「本体もコントロールもすべて貫通」させ、ウィンドウ上のどこでクリック／
// リリースしてもキャンバスへ届くようにする。配置していない間だけコントロールを操作可能に戻す。
function isPlacingNow() {
  // 配置の「実行中」＝この間はウィンドウ全体（コントロール含む）を貫通させ、
  // ウィンドウ上のどこでクリック／ドラッグしても下のキャンバスへ届くようにする。
  return isMouseDown            // ドラッグ配置（円・四角・三角・光学）／フリーハンドの押下中
      || jointStart   != null   // ばね・ロープ・連結棒：1打目を置いて2打目待ち
      || thrusterStart != null  // 動力：力点を置いて向き待ち
      || laserStart   != null   // レーザー：発射点を置いて向き待ち
      || slinkyStart  != null   // スリンキー：端Aを置いて端B待ち
      || circuitStart != null   // 回路：始点を置いて終点待ち（導線チェーン中も含む）
      || (polyDrawing && drawPts.length > 0)    // 多角形：頂点を打っている最中
      || (annotStroke != null);                 // ★注釈：線を引いている／多角の頂点を打っている最中
}
function armToolPopup(el, placing) {
  if (isMenuOnlyPopup(el)) return;                                  // 選ぶだけのメニューは貫通させない
  el.style.pointerEvents = 'none';                                  // 本体は常に貫通
  el.querySelectorAll(POPUP_INTERACTIVE_SEL)
    .forEach(c => c.style.pointerEvents = placing ? 'none' : 'auto');
  //           ↑配置中はコントロールも貫通／非配置中だけ操作可能
}
function armAllToolPopups() { const p = isPlacingNow(); forEachToolPopup(el => armToolPopup(el, p)); }
function setPopupPassThrough() {}   // 旧トグルは本モデルでは無効（呼び出しは無害）
// カーソルが重なっているウィンドウだけ半透明に（貫通中は :hover が効かないので JS で判定）。
// 半透明化するのは配置の最中だけ。1クリック前は重なっても不透明のまま操作させる。
document.addEventListener('mousemove', e => {
  const placing = isPlacingNow();
  forEachToolPopup(el => {
    if (isMenuOnlyPopup(el)) return;                   // 貫通しない窓は薄くもしない
    armToolPopup(el, placing);
    if (!placing) { el.style.opacity = ''; return; }   // 配置中でなければ常に不透明
    const r = el.getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right &&
                 e.clientY >= r.top  && e.clientY <= r.bottom;
    el.style.opacity = over ? '0.45' : '';
  });
});
// リリースした瞬間にコントロールを操作可能へ戻す（次の mousemove を待たない）
window.addEventListener('mouseup', () => armAllToolPopups());
// ════════════════════════════════════════
//  UI FUNCTIONS
// ════════════════════════════════════════
const TOOL_HINTS = {
  pointer:'クリック/ドラッグで選択・平行移動（移動中 Ctrl=グリッド／Alt=物体にスナップ）。選択枠の■=等比拡大縮小／○=回転（Shift=角度スナップ）。●=移動',
  pan:'ドラッグでオブジェクトをつかんで投げる',
  velocity:'物体をクリック→ドラッグで逆向きに発射（Alt=カーソルの向きへ発射／Shift=角度スナップ）／Ctrl+クリック・空白からドラッグで複数選択',
  circle:'ドラッグで楕円（Shift=正円）',
  box:'ドラッグで四角形（Shift=正方形）',
  triangle:'ドラッグで直角三角形（Shift=直角二等辺）',
  polygon:'クリックで頂点を追加、ダブルクリックで完成',
  freehand:'ドラッグでフリーハンド形状を描く',
  gearcoat:'物体の面をクリックして歯を刻む（直線＝ラック・円弧＝扇形歯車・へこんだ円弧＝内歯車）。やり直しは「戻る」',
  gear:'中心からドラッグで歯車（長さ＝基準円の半径）。同じ歯の大きさの歯車に重ねて描くと、かみ合う位置に吸い付きます。軸は軸ツールかヒンジで留めてください',
  hinge:'オブジェクト間をクリックしてヒンジを作成（その点で自由に回ります）',
  fixjoint:'オブジェクトをクリックして溶接（位置も向きも固定してくっつけます）',
  spring:'2点をクリックしてバネを作成（Shift=角度スナップ）',
  rope:'2点をクリックしてロープを作成（Shift=角度スナップ）',
  rod:'2点をクリックして連結棒を作成（Shift=角度スナップ）',
  thruster:'力点をクリック → 向きをクリック（Shift=角度スナップ）。1つの物体に何本でも付けられます',
  remote:'物体・動力・モーター・ヒンジ・レーザー・波源・ばね・場の領域・回路素子（電源・抵抗・コンデンサー・コイル・スイッチ）をクリックするとリモコンが1つ開く。動力は噴射口のアイコンを指すと、その1本だけを操る窓が開きます。動力とモーターは、割り当てたキーか窓のボタンを押している間だけ効きます。ヒンジは押すたびに外す／その場で留め直すを切り替えます（吊り下げ法の掛け替え）。それ以外はつまみで設定をその場で変えられます。同じ種類のものを複数選んでからクリックすれば、1台がまとめて受け持ちます（あとから窓の「＋」でも足せます）',
  laser:'発射点をクリック → 向きをクリック（Shift=角度スナップ）',
  optic:'クリックで光学素子を設置',
  arcoat:'物体の面をクリックして反射防止コートを付ける（その面の反射が消えます）。範囲は編集ツールで端をドラッグ／同じ面をもう一度クリックで外す',
  fluid:'クリック/ドラッグで液体粒子を配置',
  gas:'クリック/ドラッグで気体粒子を配置',
  tracer:'選択オブジェクトの軌跡を表示',
  wave:'クリックで波源を配置。物体の上に置くと一緒に動きます',
  slinky: '2点をクリックしてばねを張る（Shift=角度スナップ）。端を物体に重ねるとそこへ取り付きます。振れば横波・押し引きすれば疎密波が伝わり、他の物体ともぶつかります',
  condrod:'ドラッグで導体棒を置く（Shift=角度スナップ）。回路の導線2本に橋渡しすると、動かした分だけ起電力 BLv が生じます',
  vessel:'ドラッグした矩形が気体の入る空間になるように、閉じ込めた気体を置く。水色の領域をクリックすると気体（P・V・T・状態変化・帳簿）が選べます。器と蓋は普通の物体なので、それぞれ選んで質量・素材・熱容量を変えられます（蓋は軸から傾かず、口の返しに引っかかって外れません）',
  heater:'ドラッグした矩形の内側にあるものを加熱／冷却し続ける（出力はツール設定ウィンドウのつまみで。正で加熱・負で冷却）。出力[W]は領域全体のもので、浸かっている体積の比で配られます（断熱のものには出入りしません）',
  counter:'ドラッグで線を引くと、横切った物体・粒子を数える（矢印の向きに通ると＋1、逆向きは−1）。Shift=角度スナップ。置いた線は編集ツールで端・線を掴んで動かせる',
  spdmeter:'ドラッグした矩形の中にいるもの（気体分子・水の粒子・物体のどれか。窓で選ぶ）を速さで仕分けて個数を数える。枠は編集ツールで角・線をドラッグして動かせます',
  waveprobe:'クリックした場所に波の受信器を置き、変位の y-t と振動数の窓を開く。物体の上ならその物体に付いて動き、ばねの上ならその点を測る。印は編集ツールで掴んで動かせる（離した所の物体に付け替わる）',
  efield:'ドラッグした矩形の内側に電場を作る。向きと強さはツール設定ウィンドウで指定',
  bfield:'ドラッグした矩形の内側に磁場を作る。向きと強さはツール設定ウィンドウで指定',
  wire:'クリックで導線を継ぎ足し、既存の回路の上をクリックすると、そこへつないで終了（ダブルクリックでも確定）',
  // 導線以外の素子は回路の上（導線の上か既存の端点）にしか置けない。導線の上に置くと、
  // その区間の導線は消えて素子に置き換わる（並列に残ると素子が短絡してしまうため）
  resistor:'導線の上の2点をクリックして抵抗を置く（その区間の導線は素子に置き換わります）',
  dcsource:'導線の上の2点をクリックして直流電源を置く（1点目＝＋極、2点目＝−極）',
  acsource:'導線の上の2点をクリックして交流電源を置く',
  switch:'導線の上の2点をクリックしてスイッチを置く',
  ammeter:'導線の上の2点をクリックして電流計を直列に置く',
  voltmeter:'既存の2ノードをクリックして電圧計を並列に置く',
  capacitor:'導線の上の2点をクリックしてコンデンサーを置く',
  inductor:'導線の上の2点をクリックしてコイルを置く',
  diode:'導線の上の2点をクリックしてダイオードを置く（1点目→2点目が順方向）',
  bulb:'導線の上の2点をクリックして豆電球を置く（電流が流れると温度に応じて光ります）',
  pushswitch:'導線の上の2点をクリックして押しボタンを置く（点線の円に物体が触れている間だけ動きます）',
  electromagnet:'導線の上の2点をクリックして電磁石を置く（電流に比例した磁場が点線の円の内側にできます）',
  relay:'導線の上の2点をクリックしてリレーコイルを置く（同じ番号のリレー接点を動かします）',
  relayswitch:'導線の上の2点をクリックしてリレー接点を置く（同じ番号のコイルに連動します）',
  motor:'導線の上の2点をクリックしてモーター端子を置く（同じ番号のモーター軸へ電流を送ります）',
  text:'クリックした点が文字の左うえ（Ctrl+Enter か外をクリックで確定・Enterは改行）。'
     + '既にある文字は1回目のクリックで選択（移動・拡大縮小・回転）、もう一度クリックで書き直し。'
     + '線や図形はお絵描きツールの「選択」で扱います。物理には影響しません',
  draw:'物理には影響しません',
};
// お絵描きのモードは画面から見えないと事故のもとなので、ヒント行に併記する
const ANNOT_DRAW_HINTS = {
  select:   '　【選択】描いた線・図形をクリックで選ぶ（移動・四隅で拡大縮小・回転・Delete で削除）',
  pen:      '　【自由ペン】なぞった通りに引く（押しただけなら点）',
  line:     '　【直線】Shift で角度スナップ',
  rect:     '　【四角】始点＝角。Shift で正方形（枠線のみ）',
  triangle: '　【三角】始点＝直角の頂点。Shift で直角二等辺（枠線のみ）',
  ellipse:  '　【丸】始点＝中心。Shift で正円（枠線のみ）',
  poly:     '　【多角】クリックで頂点を打ち、始点へ戻るかダブルクリックで閉じる（Escで取り消し）',
  eraser:   '　【消しゴム】なぞった線を1本まるごと消す（文字は消えません）',
};
// ★モードは画面から見えないと事故のもとなので、有効なモードをヒント行に併記する
function refreshToolHint() {
  let h = TOOL_HINTS[currentTool] || '';
  if (objSnapEnabled && OBJ_SNAP_TOOLS.indexOf(currentTool) >= 0) h += '　【オブジェクトスナップ】';
  // ★カメラを物体に付けているときは出さない。中心の決め方（質量重心／範囲中心）は
  //   追従先が1つに固定されている以上どちらでも同じ位置になり、画面下の札のほうが
  //   「どの物体に乗っているか」まで書いている。帯が長くなるとデモの題名に被る。
  if (followEnabled && !cameraActive())
    h += followMode === 'com' ? '　【物体を追う：質量重心】' : '　【物体を追う：範囲中心】';
  if (currentTool === 'velocity' && !velocityShowPrediction)  h += '　【予想軌跡OFF】';
  if (currentTool === 'fixjoint' && fixjointReleasable)       h += '　【速度ツールで解放】';
  // ★留め先は3つのツールで共有（tool-menus.js の pinModeRowHtml の★）。既定と違うときだけ出す
  if (pinMode === 'board' && ['hinge', 'axle', 'fixjoint'].includes(currentTool)) h += '　【重なったものを全部、背景に留める】';
  if (currentTool === 'draw') h += (ANNOT_DRAW_HINTS[annotDrawMode] || '');
  // ★加熱と冷却は1つのツールなので、どちらを置くのかが画面から見えないと事故になる
  //   （枠の色でも分かるが、それはドラッグを始めてからしか出ない）
  if (currentTool === 'heater')
    h += `　【${heaterPower > 0 ? '加熱 ＋' : heaterPower < 0 ? '冷却 −' : '停止 '}${Math.abs(heaterPower)} W】`;
  // ★ばねは「置く前の設定」で解き方まで変わるので、図形ツールと同じく現在値を出す
  if (currentTool === 'slinky')
    h += `　【k = ${slinkySpringK} N/m・${slinkyIdeal ? '理想ばね' : '実体のスリンキー'}】`;
  if (currentTool === 'gearcoat') h += `　【歯の大きさ（モジュール）${Math.round(gearModule * PX2M * 100)} cm】`;
  if (SHAPE_TOOLS.indexOf(currentTool) >= 0) {
    h += shapeMassSource === 'mass'
      ? `　【質量 ${shapeMass} kg（大きさによらず一定）】`
      : `　【${shapeMaterial || '素材なし'} 密度 ${shapeMaterial ? MATERIALS[shapeMaterial].density : drawProps.density} kg/m³ ×面積×奥行き】`;
    if (shapeAutoFix) h += '　【描いたら固定（速度ツールで解放）】';
    if (currentTool === 'gear') h += `　【歯の大きさ（モジュール）${Math.round(gearModule * PX2M * 100)} cm】`;
  }
  const el = document.getElementById('hint-text');
  if (el) el.textContent = h;
}
// ヒント行に一時的なメッセージを出して、少ししたらツールのヒントへ戻す。
// ★「押したのに画面が変わらない」操作の説明に使う（置けなかった理由、効かない設定）。
let _flashHintTimer = null;
function flashHint(msg) {
  const el = document.getElementById('hint-text');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(_flashHintTimer);
  _flashHintTimer = setTimeout(refreshToolHint, 2200);
}
// ★1つのボタンが2つのツールを受け持つとき、どのボタンを点けるか（歯車コートは歯車のボタンの中）
// ★測定の道具（カウンタ・速さの分布計・波の受信器）は「測定」のボタンの中（js/ui/tool-menus.js の MEASURE_TOOLS）
// ★液体・気体は「流体」のボタンの中（js/ui/tool-menus.js の toggleParticleMenu）
const TOOL_BUTTON_OF = { gearcoat: 'gear', counter: 'measure', spdmeter: 'measure', waveprobe: 'measure', fluid: 'particle', gas: 'particle' };
function setTool(t) {
  currentTool=t;
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('t-'+(TOOL_BUTTON_OF[t] || t));
  if (btn) btn.classList.add('active');
  // ★注釈ツールのカーソルは固定しない。カーソル下にあるもので変わる（annotHoverCursor が
  //   毎 mousemove で入れ替える）。ここでは「何もない所」＝配置の crosshair を初期値にする。
  const cursors={pointer:'default',pan:'grab'};
  canvas.parentElement.style.cursor=cursors[t]||'crosshair';
  // ★注釈グループから出るときは、書きかけの文字を確定して選択も外す。
  //   注釈を掴めるのは注釈ツールの間だけなので、選択が残っていると
  //   「見た目は選ばれているのに触れない」状態になる（Delete の行き先も曖昧になる）。
  finishAnnotEdit();
  cancelAnnotInteractions();
  syncAnnotSelectionToTool();   // 掴めなくなった注釈の選択は外す（枠だけ残さない）
  
  document.getElementById('hint-text').textContent = '';   // ★実体は refreshToolHint() が入れる
  elementDrag = null;   // ★ツール切替でドラッグ状態を破棄
  elementRotate = null; // ★向き変更中の状態も破棄
  boxDrag = null;       // ★変形中の状態も破棄
  emFieldResize = null; // ★領域のサイズ変更中の状態も破棄
  circuitVertexDrag = null;   // ★回路端点ドラッグの状態も破棄
  circuitWholeDrag = null;    // ★回路素子の平行移動も破棄
  circuitGroupDrag = null;    // ★まとめて選んだ回路素子の平行移動も破棄
  cancelPointerBodyDrag();    // ★物体ドラッグも破棄（held を残すと物体が凍結する）
  setSliderDisabled('p-angle', t !== 'pointer', '回転は編集ツールでのみ行えます');   // ★
  if (t!=='polygon'){polyDrawing=false; drawPts=[];}
  if (t!=='rope'&&t!=='hinge'&&t!=='axle'&&t!=='fixjoint') jointStart=null;
  if (t!=='thruster') thrusterStart=null;
  if (t!=='velocity') velStart=null;
  if (t!=='laser') laserStart=null;
  if (t!=='optic') pendingOptic=null;
  // ★ツールが変わったら、別のツールの設定ウィンドウは畳む（今のツールのものは残す）。
  //   以前はここに id を1つずつ並べていたので、窓を増やすたびに書き足しが要り、
  //   ロープ・光学・図形和が抜けていた（ツールを変えても窓が残って2つ並ぶ原因）。
  //   一覧はこのファイルの TOOL_POPUP_IDS に集約してある。
  closeToolPopups(toolPopupIdFor(t), true);
  if (CIRCUIT_TOOLS.indexOf(t) < 0) circuitStart = null;                 // ★配置途中を破棄
  if (t !== 'wire') circuitChainPlaced = false;                          // ★導線チェーンの状態を解除
  if (t === 'circuit' || CIRCUIT_TOOLS.indexOf(t) >= 0) highlightCircuitTool();   // ★回路ツール間の切替でボタン強調を更新
  highlightMeasureTool();       // ★測定の窓が開いていれば、選んだ道具の強調を合わせる
  if (t!=='slinky')  slinkyStart = null;
  refreshToolHint();
}
