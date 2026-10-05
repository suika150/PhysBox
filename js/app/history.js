function snapshotState() {
  return { objects: objects.map(b=>JSON.parse(JSON.stringify(b))), joints: joints.map(serializeJoint), lasers: lasers.map(serializeLaser), waves: waveSources.map(serializeWaveSource), slinkies: slinkies.map(serializeSlinky), emFields: emFields.map(serializeEMField), circuit: serializeCircuit(),
           heatFields: heatFields.map(serializeHeatField),   // ★加熱・冷却の領域
           flowFields: flowFields.map(serializeFlowField),   // ★流れの場
           annotations: annotations.map(serializeAnnotation),
           particles: serializeParticles(),          // ★粒子（下の注を参照）
           gasChambers: serializeGasChambers(),      // ★気体室（n・T も含む）
           // ★ピストン容器。これを控えないと「容器を消す→戻る」で器・蓋・気体は
           //   帰ってくるのに、それらを束ねる容器だけが帰ってこない＝蓋が軸に拘束
           //   されないまま残り、二度と直せない。内径・全長もここにしか無い
           //   （器の頂点からは復元できるが、v.bore と食い違ったままになる）。
           pistonVessels: serializePistonVessels(),
           programs: programs.map(serializeProgram),   // ★プログラム（窓の位置も含む）
           remotes: remotes.map(serializeRemote),      // ★リモコン（押している最中かは含めない）
           counters: counters.map(serializeCounter),   // ★通過カウンタ（数えた数は含めない）
           spdMeters: spdMeters.map(serializeSpdMeter),   // ★速さの分布計（同上）
           circTables: circTables.map(serializeCircTable) };   // ★回路の表（置き場所も含む）
}
function loadSnapshot(snap) {
  clearPoseLogs();   // ★物体を作り直す＝姿勢の記録は別の物体のものになる（camera.js の★）
  objects=snap.objects.map(d=>new Body(d));   // 速度・角速度もスナップショット時点の値で復元
  joints=deserializeJoints(snap.joints, objects);
  lasers=deserializeLasers(snap.lasers, objects);
  waveSources=deserializeWaveSources(snap.waves, objects);
  slinkies=deserializeSlinkies(snap.slinkies, objects);
  emFields=deserializeEMFields(snap.emFields);
  heatFields=deserializeHeatFields(snap.heatFields);   // ★加熱・冷却の領域（無ければ空）
  flowFields=deserializeFlowFields(snap.flowFields);   // ★流れの場（無ければ空）
  syncFlowCarry();      // ★速度の合成の下駄を組み直す（積まないと戻すたびに川の船が速くなる）
  annotations=deserializeAnnotations(snap.annotations);   // ★注釈（テキスト・お絵描き）
  deserializePrograms(snap.programs);         // ★プログラム（無ければ空。窓も作り直す）
  deserializeRemotes(snap.remotes);           // ★リモコン（同上）
  deserializeCounters(snap.counters);         // ★通過カウンタ（同上）
  deserializeSpdMeters(snap.spdMeters);       // ★速さの分布計（同上）
  deserializeCircTables(snap.circTables);     // ★回路の表（同上）
  deserializeGasChambers(snap.gasChambers);   // ★気体室。無ければ空になる
  deserializePistonVessels(snap.pistonVessels);   // ★ピストン容器（無ければ空）
  pvGraphs.slice().forEach(g => { if (!pvGraphChamber(g)) pvGraphClose(g); });
  deserializeCircuit(snap.circuit);
  waveField.geoKey=''; resetWaveField(); refreshWaveInfo();
  // ★粒子（液体・気体）も履歴に含める。
  //   もともとは対象外だった（「戻る」で置いた水が消えるのを避けるため）が、粒子を
  //   選んで削除・平行移動できるようにした以上、戻せない破壊操作があるほうが危ない。
  //   1500粒子×30段でも serializeParticles は type/x/y/vx/vy(/T) を2桁に丸めた
  //   小さな配列なので、容量は許容範囲。
  //   代償として「水を置く → 戻る」で水が消えるようになった（利用者の合意済み）。
  particles = deserializeParticles(snap.particles);
  selectedIds.clear(); selectedElemIds.clear(); selectedJointEnds.clear();
  selectedJointId=null; selectedElement=null;
  // ★注釈も作り直されるので、掴んでいた参照は捨てる。編集中の textarea も畳む
  //   （残すと、もう配列に居ない注釈を書き換え続けることになる）。
  finishAnnotEdit(true);
  selectedAnnotation=null; cancelAnnotInteractions();
  // ★作り直しでオブジェクトの同一性もIDも変わるので、種別一括選択と枠は捨てる
  clearBulkSelection(); lastSelRect=null;
  playUndoArmed=true;              // 状態が変わった＝次の「実行」で履歴を積み直す
  resetVelGraph();
  resetEnergyGraph();
}
function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(snapshotState());      // ★現在の状態を「進む」側へ退避
  if (redoStack.length > 30) redoStack.shift();
  loadSnapshot(undoStack.pop());
  updateUndoRedoButtons();
}
function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(snapshotState());      // ★現在の状態を「やり直し」側へ退避
  if (undoStack.length > 30) undoStack.shift();
  loadSnapshot(redoStack.pop());
  updateUndoRedoButtons();
}
// 編集の直前に呼ぶ（積むのは「変更前」の状態）。
//   ★playUndoArmed はここで下ろす。この旗の意味は「いまの配置へ戻る手が履歴に無い」で、
//     編集が復元点を積んだ以上、その手はもうある（戻る1回で編集前へ戻れる）。
//     ここで立てていたせいで「編集 → ▶実行」の順に同じ状態が2回積まれていた：
//     編集が積んだ「変更前」と simPlay が積む「実行前」のあいだに何も起きていないためで、
//     1回目の「戻る」は実行を止めるだけ・見た目は何も変わらず、2回目でようやく編集が
//     取り消される、という挙動になっていた。
//     実測（速度ツールで初速を与えてから ▶ を押す）：戻る1回目は溶接が外れたまま・初速も
//     入ったままで、2回目でやっと溶接が戻った。実行中に投げた場合は1回で戻り、
//     同じ操作なのに順序で結果が変わっていた。
//   ★旗を立てるのは「いまの配置に復元点が無い」2か所だけ：clearScene（デモ・新規作成・
//     シーン読込＝これから別のシーンが来る）と loadSnapshot（戻る／進む／リセットで
//     別の配置に入れ替わった）。
//   ★「実行前の配置」へ戻したいだけなら リセット がその役目（savedState は simPlay が
//     必ず控える）。戻る＝編集の取り消し、リセット＝実行前へ、と役目を分ける。
//   ★シーンを組み立てている最中（buildingScene）は積まない。デモの実装は addProgram /
//     addRemote のような「人がツールで置く」入口をそのまま使うので、そこが履歴を積むと
//     組み立て途中の姿が復元点になる。実測（撃心のデモ）：addProgram が objects 9個・
//     注釈0個・プログラム0個の状態を積み、同時に playUndoArmed を下ろすので ▶実行 も
//     積まなくなる ＝ 実行後に「戻る」を押すと、説明文もプログラムの窓も消えた画面へ
//     戻っていた。組み立て前の状態は clearScene が積んでいるので、ここで積む必要はない。
let buildingScene = false;
// snap を渡すと、その時点の状態を積む（変えてみて取り消すかもしれない操作が、
//   変える前に撮っておいた分を、変更が残ると決まってから積むのに使う）
function pushUndo(snap) {
  if (buildingScene) return;
  undoStack.push(snap || snapshotState());
  if (undoStack.length > 30) undoStack.shift();
  redoStack.length = 0;      // ★新しい編集が入った時点で、進む履歴は無効になる
  playUndoArmed = false;     // 上の★
  updateUndoRedoButtons();
}
// 履歴の有無に応じてボタンの活性/非活性を切り替える
function updateUndoRedoButtons() {
  const u = document.getElementById('btn-reset');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}
function clearScene() {
  pushUndo();
  // ★これから来るシーンは、いま積んだ内容とは別物（デモ・新規作成・シーン読込は必ずここを
  //   通る）＝ その新しい配置へ戻る手はまだ履歴に無い。だから旗を立て直す（pushUndo が
  //   下ろした直後に、ここで上げる）。デモを開いて ▶ を押し、動かしたあと「戻る」で
  //   初期配置に戻れるのはこの1行のおかげ。pushUndo 側の★を参照。
  playUndoArmed = true;
  // ★「実行前に戻す」の控え（savedState）と「デモ読み込み時に戻す」の相手も、ここで捨てる。
  //   これから来るのは別のシーンなので、前のシーンの控えへ戻れてしまうと別物が出てくる
  //   （以前は新規作成だけが savedState を消していて、デモを開いてから実行前に「リセット」すると
  //     前に開いていたシーンが復活する形だった）。デモを開いたときは runDemo が組み立てのあとで
  //   _lastDemo を入れ直す。
  savedState = null;
  _lastDemo = null;
  objects=[]; joints=[]; particles=[]; lasers=[]; waveSources=[]; slinkies=[]; emFields=[]; heatFields=[]; flowFields=[]; strobeNextT=0;
  gasChambers.length=0;
  closeAllGraphWindows();   // ★対象が全部消えるので、開いていたグラフの窓も畳む
  pistonVessels.length=0;                                          // ★ピストン容器（部品は objects 側で消えている）
  finishAnnotEdit(true); annotations=[]; selectedAnnotation=null; cancelAnnotInteractions();   // ★注釈
  resetWaveField(); selectedIds.clear(); selectedElemIds.clear(); selectedJointEnds.clear();
  selectedJointId=null; selectedElement=null; circuitElements=[]; selectedCircuit=null; circuitHold=null;
  clearBulkSelection(); lastSelRect=null;
  clearPrograms();          // ★プログラムの窓も畳む（つないでいた物体が全部消えるため）
  clearRemotes();           // ★リモコンの窓も畳む（同じ理由）
  clearCounters();          // ★通過カウンタも畳む（前のシーンの線が残ると別の物を数える）
  clearSpdMeters();         // ★速さの分布計も畳む（同じ理由）
  clearCircTables();        // ★回路の表も畳む（同じ理由）
  detachCamera();           // ★カメラも外す。前のシーンの物体に付いたまま残ると視点が飛ぶ
  resetStrobe();            // ★ストロボも切る。前のシーンで入れたまま次のデモでも点いていた
  followEnabled = false; followIds = [];   // ★選んだ物体を追うのも切る（カメラとは別のスイッチ。id の使い回しは下と同じ理由）
  comIds = [];              // ★重心の印も畳む。id は使い回されるので、残すと別のシーンの
                            //   無関係な物体の重心を指してしまう（姿勢の記録と同じ理由）
  clearPoseLogs();          // ★姿勢の記録も捨てる（id が使い回されると別の物体の姿勢を引く）
  ground.angle = 0;
  document.getElementById('w-ground-angle').value = 0;
  document.getElementById('w-ground-angle-val').textContent = '0°';
  stepCount=0;
  resetVelGraph();
  resetEnergyGraph();
  syncSliders();
}
