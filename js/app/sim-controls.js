function simPlay() {
  if (running) return;
  savedState=snapshotState();
  if (playUndoArmed) {           // 実行前の状態を履歴へ。ただし前回実行以降に編集が無ければ積まない
    pushUndo();                  // （pushUndo が armed を立て直すので、この順で下ろす）
    playUndoArmed = false;
  }
  running=true;
  simAccum = 0;                 // 停止中に溜まった時間を持ち越さない
  document.getElementById('btn-play').style.display='none';
  document.getElementById('btn-pause').style.display='';
}
function simPause() {
  running=false;
  releaseAllRemotes();   // ★止めたらリモコンも放す（押しっぱなしで再開すると勝手に走り出す）
  document.getElementById('btn-play').style.display='';
  document.getElementById('btn-pause').style.display='none';
}
// 実行⇄停止の切り替え（Z キー・シミュレーションメニューの共通入口）
function toggleRun() { running ? simPause() : simPlay(); }
function simStep() {
  simTick();          // 常に 1/60 秒ぶん。何度押しても同じ刻みで進む
}
// ステップ数を0に戻す。★シーンは戻さない（そこが「新規作成」や Undo と違うところ）。
//   プログラムの「○ステップごと」「○m動くごと」は0ステップの位置を基準に数え直すので、
//   組み上げた装置をそのままに、周期だけを取り直したいときに使う。
function resetStepCount() {
  stepCount = 0; world.simTime = 0;
  for (const p of programs) { p.reset(); syncProgramState(p); syncProgramPanel(p); }
  resetCounters();    // ★通過カウンタも数え直す（数える時刻の基準が0へ戻るため）
  document.getElementById('st-step').textContent = 0;
}
function simReset() {
  running=false;
  document.getElementById('btn-play').style.display='';
  document.getElementById('btn-pause').style.display='none';
  world.simTime = 0;   // ★時刻もリセット（軌跡の時間基準を0へ戻す）
  simAccum = 0;
  if (savedState) loadSnapshot(savedState);
  else {
    for (const b of objects) { if (!b.isSpawner) { b.vx=0; b.vy=0; b.av=0; } b.tracePoints=[]; b.strobePoints=[]; }   // ★生成口の速度は運動ではないので消さない
    strobeNextT = 0;
    particles=[];
  }
  for (const j of joints) { j.nodes = null; j._wrapPts = null; j._calmT = 0; j._anchorCalmT = 0; j._pwa = j._pwb = null; j._nodeDelta = 1e9; }   // ロープのチェーンと凍結状態を初期化
  resetSlinkies();
  resetVelGraph();
  resetEnergyGraph();
  resetTempGraph();
  resetPvGraph();
  resetFrictionHeat();   // ★摩擦で生まれた熱の累計も0へ
}
// やり直し：実行中なら止めてから履歴を1つ遡る（Ctrl+Z と共通）
function stepBack() {
  if (running) simPause();
  undo();
}
// 進む：やり直しで戻した状態を1つ先へ進める（Ctrl+Y / Ctrl+Shift+Z）
function stepForward() {
  if (running) simPause();
  redo();
}
// 再生速度。トップバーのスライダーとシミュレーションメニューのプリセットが共用する。
// どちらから変えても、表示・つまみの位置の両方が追いつくようにここでまとめて面倒を見る。
function setSpeed(v) {
  speedMult = parseFloat(v) || 0;
  document.getElementById('speed-val').textContent =
    speedMult.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + '×';   // 1.00→1／1.50→1.5
  const sl = document.getElementById('speed-slider');
  if (sl) sl.value = speedMult;
}
function toggleGrid() {
  snapEnabled = !snapEnabled;
  const b = document.getElementById('btn-grid');
  if (b) b.classList.toggle('on', snapEnabled);
}
function toggleObjSnap() {
  objSnapEnabled = !objSnapEnabled;
  const b = document.getElementById('btn-osnap');
  if (b) b.classList.toggle('on', objSnapEnabled);
  refreshToolHint();
}
// ── ストロボ表示（多重露光）──────────────────────────────
// ★切替のたびに残像を消す。残したままだと前の設定で撮った像が混ざり、
//   「間隔を読む」というこの機能の目的そのものが成立しなくなる。
// ★ONにしても何も出ないことがある：対象の既定が「選択中の物体だけ」なので、
//   何も選ばずに押すと残像が1枚も出ない（実測：選択なしで3秒走らせて0枚、
//   対象を「すべて」にすると30枚）。ボタンが点くだけでは「効かないボタン」に見えるので、
//   出ない理由と直し方をヒント行に出す。
function _strobeHint() {
  if (!strobeEnabled) { flashHint('ストロボOFF'); return; }
  if (strobeTarget === 'selected' && selectedIds.size === 0)
    flashHint('ストロボON：いまの対象は「選択中の物体だけ」です。物体を選ぶか、▾ で「動いている物体すべて」に変えてください');
  else
    flashHint('ストロボON：実行中、' + (+strobeInterval.toFixed(2)) + ' 秒ごとに残像を残します');
}
function toggleStrobe() {
  strobeEnabled = !strobeEnabled;
  clearStrobe();                 // 入れたときは押した瞬間から、切ったときは消して終わり
  refreshStrobeButton();
  _strobeHint();
}
// ストロボの設定を起動直後へ戻す（新規作成・デモの読み込み・シーン読込から）。
//   ★ON/OFF・間隔・対象・補助線は物体ではなく画面側の状態なので、clearScene で物体を
//     消しても残る。戻さないと、前のシーンで入れたストロボが次のデモでも点いたまま
//     になる（チュートリアルは対象の既定「選択中の物体だけ」を前提に手順を書いている）。
function resetStrobe() {
  strobeEnabled = false; strobeInterval = 0.1; strobeTarget = 'selected'; strobeNextT = 0;
  strobeHLine = false; strobeVLine = false;
  refreshStrobeButton();
}
function setStrobeInterval(v) {
  strobeInterval = Math.max(0.01, parseFloat(v) || 0.1);
  clearStrobe();
  refreshStrobeButton();
  _strobeHint();
}
function setStrobeTarget(t) {
  strobeTarget = (t === 'all') ? 'all' : 'selected';
  clearStrobe();
  refreshStrobeButton();
  _strobeHint();
}
// ★補助線の入切では残像を消さない。露光の記録そのものは変わらないので、走らせたあとから
//   線だけ足して読める（間隔を変えたときのように撮り直す必要がない）。
function toggleStrobeLine(axis) {
  if (axis === 'h') strobeHLine = !strobeHLine; else strobeVLine = !strobeVLine;
  if (!strobeEnabled) { flashHint('ストロボOFF：ストロボを押すと線も出ます'); return; }
  const on = [strobeHLine ? '横線' : null, strobeVLine ? '縦線' : null].filter(Boolean);
  flashHint(on.length ? '露光の位置に' + on.join('と') + 'を引きます' : '露光の位置の線を消しました');
}
function refreshStrobeButton() {
  const b = document.getElementById('btn-strobe');
  if (b) b.classList.toggle('on', strobeEnabled);
  const s = document.getElementById('btn-strobe-int');
  if (s) s.textContent = (+strobeInterval.toFixed(2)) + 's';
}
// ★ON/OFF はトップバーのボタンの色と 表示メニューの✔の両方に出る。
//   表示メニューの中だけに置いていたころは「そんな機能があると気づかれない」ので、
//   切り替えだけトップバーへ戻した（中心の決め方・追従の速さは今も表示メニューの下位）。
function toggleFollow() {
  followEnabled = !followEnabled;
  if (followEnabled) {
    // ★カメラと「選んだ物体を追う」は同時に入らない。入れたほうが勝ち、もう片方は切れる
    //   （同じ窓に並んでいて、チェックが外れるのが見える）。カメラは止めるだけで接続は残す。
    if (cameraActive()) setCameraOn(false);
    followOffX = 0; followOffY = 0;                       // ずれはON時に清算する
    if (selectedIds.size > 0) followIds = [...selectedIds];
    // ★複数を選んで追従を始めたときは「全員が画面に収まる」のが期待される動きなので、
    //   範囲の中心＋ズームアウトへ自動で切り替える。1個だけならその物体を中央に置く
    //   （質量重心＝その物体の位置なので、モードは触らない）。
    //   どちらも下の2項目で手動上書きできる。
    if (followTargets().length >= 2) { followMode = 'aabb'; followFit = true; }
  }
  refreshCameraButton();
  refreshToolHint();
}
function goToOrigin() {
  if (cameraActive()) return;          // ★カメラが画面を持っている間は効かない（表示メニュー側でも押せない）
  if (followEnabled) toggleFollow();   // 追っている間は画面を毎フレーム上書きされるので解除する
  cam.x = 0; cam.y = 0;                // 拡大率(cam.zoom)は変えない
  followOffX = 0; followOffY = 0;      // 右ドラッグ・ホイールで溜まったずれを清算
}
// ★「選んだ物体を追う」の対象。カメラ（js/app/camera.js）はここを通らない（cameraFollowUpdate が
//   別に受け持つ）。カメラが働いている間は followUpdate がこちらを呼ばない。
function followTargets() {
  const out = [];
  for (const id of followIds) { const b = objects.find(o => o.id === id); if (b) out.push(b); }
  return out;
}
// 追従点。静的物体は実質無限大の質量なので重心計算から外す（入れるとカメラが壁に固定される）
function followPoint() {
  const t = followTargets();
  if (!t.length) return null;
  if (followMode === 'aabb' || t.length === 1) {
    let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    for (const b of t) {
      const a = b._aabb;
      if (a.minX < mnX) mnX = a.minX;  if (a.minY < mnY) mnY = a.minY;
      if (a.maxX > mxX) mxX = a.maxX;  if (a.maxY > mxY) mxY = a.maxY;
    }
    if (t.length === 1) return { x: t[0].x, y: t[0].y };   // 単体は重心（回転の中心）を素直に使う
    return { x: (mnX + mxX) / 2, y: (mnY + mxY) / 2 };
  }
  const c = centerOfMass(t);                               // ★計算は physics/energy.js に1つだけ
  if (c) return { x: c.x, y: c.y };
  let ax = 0, ay = 0;                                      // 全部静的なときだけ単純平均
  for (const b of t) { ax += b.x; ay += b.y; }
  return { x: ax / t.length, y: ay / t.length };
}
// ズームアウトのみ。ズームインを許すと同じ速度が速く見えたり遅く見えたりして比較が壊れる
function followFitZoom(p, k) {
  const t = followTargets();
  if (t.length < 2) return;
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (const b of t) {
    const a = b._aabb;
    if (a.minX < mnX) mnX = a.minX;  if (a.minY < mnY) mnY = a.minY;
    if (a.maxX > mxX) mxX = a.maxX;  if (a.maxY > mxY) mxY = a.maxY;
  }
  const dx = Math.max(mxX - p.x, p.x - mnX, 1);            // 追従点からの最大距離で測る
  const dy = Math.max(mxY - p.y, p.y - mnY, 1);            // （重心はAABB中心とは限らないため）
  const pad = 1.25;
  const need = Math.min(canvas.width / (2 * dx * pad), canvas.height / (2 * dy * pad));
  if (need >= cam.zoom) return;
  cam.zoom = Math.max(cam.minZoom, cam.zoom + (need - cam.zoom) * k);
}
function followUpdate(dtMs) {
  updateSceneCamera();          // ★向き（cam.angle）はカメラが止まっていても決め直す（止まっていれば 0 に戻す）
  // ★カメラが働いている間は画面はカメラのもの（排他なので通常ここへは来ない。camera.js の★）
  if (cameraFollowUpdate()) return;
  if (!followEnabled) return;
  if (selectedIds.size > 0) followIds = [...selectedIds];  // 空選択の間は直前の対象を追い続ける
  const p = followPoint();
  if (!p) return;
  const dt = Math.min(dtMs, 100) / 1000;
  const k = followRate >= 60 ? 1 : 1 - Math.exp(-followRate * dt);   // フレームレート非依存
  if (followFit) followFitZoom(p, k);
  cam.x += (p.x + followOffX - cam.x) * k;
  cam.y += (p.y + followOffY - cam.y) * k;
}
// 追従中の手動パン・ホイールズームを「対象からのずれ」として吸収する
function followAbsorbCam() {
  if (cameraActive()) {         // ★カメラのずれはカメラが持つ（選んだ物体を追うのずれとは別）
    const b = cameraBody();
    sceneCamera.offX = cam.x - b.x; sceneCamera.offY = cam.y - b.y;
    return;
  }
  if (!followEnabled) return;
  const p = followPoint();
  if (!p) return;
  followOffX = cam.x - p.x;
  followOffY = cam.y - p.y;
}
function toggleGuides() { world.showGrid=!world.showGrid; }
function screenshot() {
  const link=document.createElement('a');
  link.download='physbox_screenshot.png';
  link.href=canvas.toDataURL();
  link.click();
}
