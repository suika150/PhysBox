function resizeCanvas() {
  const wrap=document.getElementById('canvas-wrap');
  canvas.width=wrap.clientWidth;
  canvas.height=wrap.clientHeight;
}
// 全体設定タブのグループを折りたたみ式にする。
//   既定で開くのは「重力」と「地面」だけ（起動直後にいちばん触る2つ）。
//   他は畳んでおき、見出しをクリックすると開く。状態はセッション内だけで保持する。
const WORLD_OPEN_SECTIONS = ['重力', '地面'];
function initWorldCollapse() {
  for (const sec of document.querySelectorAll('#tab-world .rpanel-section')) {
    const title = sec.querySelector('.rpanel-title');
    if (!title || title.parentElement !== sec || title !== sec.firstElementChild) continue;
    title.classList.add('sec-toggle');
    const label = title.textContent.trim();
    if (!WORLD_OPEN_SECTIONS.some(k => label.startsWith(k))) sec.classList.add('collapsed');
    title.addEventListener('click', () => sec.classList.toggle('collapsed'));
  }
}
// ─── 起動直後の値の控え ───────────────────────────────
//   「新規作成」で全部ここへ戻す。init() の頭で取るのが要点で、ここより前だと
//   js/app/clipper.js が Object.assign(world, {…}) で足す電磁気の設定（coulombOn
//   など）がまだ入っておらず、控えから漏れてしまう（boot.js が最後に init() を
//   呼ぶ時点なら、全スクリプトの読み込みが済んでいる）。
let INITIAL_WORLD = null, INITIAL_GROUND = null, INITIAL_DRAWPROPS = null;
function captureInitialState() {
  INITIAL_WORLD     = JSON.parse(JSON.stringify(world));
  INITIAL_GROUND    = JSON.parse(JSON.stringify(ground));
  INITIAL_DRAWPROPS = JSON.parse(JSON.stringify(drawProps));
}
// 全体設定・地面・次に描く図形の既定値・表示（始点と拡大率）を起動直後へ戻す
function resetWorldToInitial() {
  Object.assign(world,     INITIAL_WORLD);
  Object.assign(ground,    INITIAL_GROUND);
  Object.assign(drawProps, INITIAL_DRAWPROPS);
  resetWaveField();                 // 波速・吸収が戻ったので場の格子も作り直す
  // ★表示の始点と拡大率。init() と同じ式で出す（地面が画面の高さの9割の位置に来る）
  cam.x = 0; cam.zoom = 0.8;
  cam.y = ground.y - 0.4 * canvas.height / cam.zoom;
  followEnabled = false; followIds = []; followMode = 'com'; followFit = false; followRate = 60;
  comIds = [];                      // ★重心の印も畳む（指していた系の物体が全部消えるため）
  snapEnabled = false; objSnapEnabled = false;
  resetStrobe();
  refreshCameraButton();
  const bg = document.getElementById('btn-grid');  if (bg) bg.classList.toggle('on', snapEnabled);
  const bo = document.getElementById('btn-osnap'); if (bo) bo.classList.toggle('on', objSnapEnabled);
  setSpeed(1);
  setTool('pointer');
  refreshGridButton();
  syncWorldPanel();
  updatePropsPanel(null);   // 外観の見本もここで隠れる（見本は選択中の物体の色だけを映す）
}
function init() {
  captureInitialState();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  cam.x = 0;
  cam.zoom = 0.8;
  // ★地面を画面の高さの9割の位置へ。画面中心の world y は ground.y − 0.4·H/zoom。
  //   画面サイズから計算するので、ウィンドウの大きさが変わっても割合は同じになる。
  cam.y = ground.y - 0.4 * canvas.height / cam.zoom;
  initMaterialGrid();
  initLaserPresets();
  initGuidePresets();
  initEMFieldAnglePresets();
  refreshGridButton();
  refreshStrobeButton();      // ★ストロボのボタン表示（ON/OFF と間隔）を状態に合わせる
  refreshCameraButton();
  // グラフのウィンドウは「グラフを表示」で物体ごとに、回路グラフは「グラフに追加」で
  // 回路ごとに動的に作られる（どちらも初期化不要）
  initSliders();
  initValueSelectAll();   // ★値の入力欄はクリックで全選択（打ち替えが既定の使い方なので）
  initWorldCollapse();
  initPropHelp();
  initTopbarHelp();
  initToolTips();
  initTitleTips();   // ★title 属性をアプリの吹き出しへ引き取る（ブラウザ標準の箱を出さない）
  // 全体設定タブの欄はすべて syncWorldPanel() が world / ground から作る
  //（シミュレーションメニューの設定ウィンドウも同じ関数を通す）
  syncWorldPanel();
  // ★未選択の見え方（素材プリセット・外観を隠す）は updatePropsPanel が一手に決める。
  //   起動時にも必ず通しておかないと、HTML の既定表示のまま両セクションが出てしまう。
  updatePropsPanel(null);
  setTool('pointer');
  updateUndoRedoButtons();
  requestAnimationFrame(render);
}
async function newScene() {
  const ok = await appConfirm('新規作成（クリア）',
    'シーン上の<b>オブジェクト・ジョイント・液体／気体・レーザー・波源・弦・回路</b>を'
  + 'すべて削除し、<b>重力などの全体設定・地面・表示の始点と拡大率</b>を'
  + '起動直後の状態へ戻します。'
  + '<div class="am-note">削除したオブジェクトは Ctrl+Z（やり直し）で戻せますが、'
  + '全体設定と表示位置は戻りません。保存していないシーンは失われます。</div>',
    'すべて消して初期状態に戻す', true);
  if (!ok) return;
  if (running) simPause();
  clearScene();
  setSceneName('');          // ★名前も起動直後へ戻す（次の保存で前のシーンの名前を既定にしない）
  resetWorldToInitial();
  savedState = null;
  stepCount = 0;
  document.getElementById('st-step').textContent = 0;
}
