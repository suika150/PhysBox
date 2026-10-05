// ── グラフの「表示状況」の保存 ─────────────────────────────────
//   ★記録した中身（標本）は保存しない。読み込んだ直後は物体の速度も時刻も
//     保存時点の値に戻るので、途中経過のグラフだけ残しても続きは取れない。
//     保存するのは「どの対象の窓が開いていたか」「窓ごとの表示の選択」「窓の位置」だけで、
//     読み込んだシーンからもう一度 t=0 で測り直す。
//   ★対象は id で持つ（物体・気体室・回路素子）。読み込み時に居ないものは黙って飛ばす
//     （その物体を消してから保存したシーンでも、残りのグラフは開ける）。
const GRAPH_OPT_KEYS = {
  vel:  ['showPos','showVel','showAcc','showX','showY','showMag','autoStart',
         'posOriginX','posOriginY','posOriginMag'],
  ene:  ['mode','breakdown','showKt','showKr','showUg','showUs','showUgg','showUe','showMech'],
  mom:  ['comp','showParts','showRef'],
  temp: [],
  pv:   ['mode','showIso','showOrigin'],
  spd:  ['showTheory'],
  circ: ['showV','showI','showPhasor','stacked','perRowScale','iv','ivSwap'],
  wave: ['showU','showL','showF','sweep'],
};
function _graphOpts(kind, g) {
  const o = {};
  for (const k of GRAPH_OPT_KEYS[kind]) o[k] = g[k];
  return o;
}
// 窓の位置（ドラッグすると right/bottom 基準から left/top 基準へ移るので、両方そのまま控える）
function _graphRect(g) {
  const s = g.panel && g.panel.style;
  if (!s) return null;
  return { left:s.left, top:s.top, right:s.right, bottom:s.bottom, width:s.width, height:s.height };
}
function _applyGraphRect(g, r) {
  if (!r || !g || !g.panel) return;
  for (const k of ['left','top','right','bottom','width','height'])
    if (r[k]) g.panel.style[k] = r[k];
}
function serializeGraphs() {
  const out = [];
  for (const g of velGraphs)
    out.push({ kind:'vel', bodyId:g.bodyId, opts:_graphOpts('vel', g), rect:_graphRect(g) });
  for (const g of eneGraphs)
    out.push({ kind:'ene', bodyIds:g.bodyIds.slice(), opts:_graphOpts('ene', g), rect:_graphRect(g) });
  for (const g of momGraphs)
    out.push({ kind:'mom', bodyIds:g.bodyIds.slice(), opts:_graphOpts('mom', g), rect:_graphRect(g) });
  for (const g of tempGraphs)
    out.push({ kind:'temp', bodyIds:g.series.filter(s => s.kind === 'body').map(s => s.bodyId),
               opts:_graphOpts('temp', g), rect:_graphRect(g) });
  for (const g of pvGraphs)
    out.push({ kind:'pv', chamberId:g.chamberId, opts:_graphOpts('pv', g), rect:_graphRect(g) });
  for (const g of circGraphs)
    out.push({ kind:'circ', pins:g.pins.slice(), opts:_graphOpts('circ', g), rect:_graphRect(g) });
  for (const g of waveGraphs)
    out.push({ kind:'wave', bodyId:g.bodyId, slinkyId:g.slinkyId, s:g.s,
               probe:g.probe, px:g.px, py:g.py, hostId:g.hostId, lx:g.lx, ly:g.ly,
               probeName:g.probeName, probeColor:g.probeColor, uGroup:g.uGroup, uFloor:g.uFloor,
               opts:_graphOpts('wave', g), rect:_graphRect(g) });
  return out;
}
// 新しく開く窓を右下からどれだけずらすか[px]。
//   ★種類をまたいで数える。種類ごとに数えていたころは、速度とエネルギーを続けて開くと
//     どちらも右下 10px に置かれて下の窓が完全に隠れた（グラフありきのデモで実際に起きる）。
//     5枚で一周させるのは、それ以上ずらすと窓が画面の左上へ流れていくため。
function graphCascadeOffset() {
  const n = velGraphs.length + eneGraphs.length + momGraphs.length
          + tempGraphs.length + pvGraphs.length + circGraphs.length + waveGraphs.length;
  return ((n - 1) % 5) * 26;
}
function closeAllGraphWindows() {
  for (const g of velGraphs.slice())  velGraphClose(g);
  for (const g of eneGraphs.slice())  eneGraphClose(g);
  for (const g of momGraphs.slice())  momGraphClose(g);
  for (const g of tempGraphs.slice()) tempGraphClose(g);
  for (const g of pvGraphs.slice())   pvGraphClose(g);
  for (const g of circGraphs.slice()) circGraphClose(g);
  for (const g of waveGraphs.slice()) waveGraphClose(g);
}
function restoreGraphs(list) {
  closeAllGraphWindows();                       // 前のシーンの窓は残さない
  const alive = ids => (ids || []).filter(id => objects.some(o => o.id === id));
  for (const d of list || []) {
    let g = null;
    if (d.kind === 'vel') {
      const b = objects.find(o => o.id === d.bodyId);
      if (b) g = velGraphNew(b, d.opts);
    } else if (d.kind === 'wave') {
      // ★観測点は物体かばねの上の点か受信器の印。ばね側は id と割合で持つ（wavegraph.js の★）
      //   ★受信器の印は付け先が見つからなくても、控えた位置に留まる印として開く
      if (d.probe) {
        const h = d.hostId != null ? objects.find(o => o.id === d.hostId) : null;
        g = waveGraphNewProbe(d.px, d.py, null, Object.assign({}, d.opts,
              { probeName: d.probeName || null, probeColor: d.probeColor || null, uGroup: d.uGroup || null, uFloor: d.uFloor || 0 }));
        if (h) { g.hostId = h.id; g.lx = d.lx; g.ly = d.ly; }
      } else if (d.slinkyId != null) {
        const S = slinkies.find(x => x.id === d.slinkyId);
        if (S) g = waveGraphNewOnSlinky(S, d.s, d.opts);
      } else {
        const b = objects.find(o => o.id === d.bodyId);
        if (b) g = waveGraphNew(b, d.opts);
      }
    } else if (d.kind === 'ene') {
      const ids = alive(d.bodyIds);
      if (ids.length) g = eneGraphNew(ids, d.opts);
    } else if (d.kind === 'mom') {
      const ids = alive(d.bodyIds);
      if (ids.length) g = momGraphNew(ids, d.opts);
    } else if (d.kind === 'temp') {
      // ★液体・気体の系列は tgBuildSeries が今のシーンから作り直す（保存しない）
      g = tempGraphNew(alive(d.bodyIds), d.opts);
    } else if (d.kind === 'pv') {
      const ch = gasChambers.find(c => c.id === d.chamberId);
      if (ch) g = pvGraphNew(ch, d.opts);
    } else if (d.kind === 'circ') {
      g = circGraphOpen(d.pins, d.opts);
    }
    _applyGraphRect(g, d.rect);
  }
  refreshVelGraphButton(); refreshEneGraphButton(); refreshMomGraphButton();
  refreshTempGraphButton(); refreshPvGraphButton(); refreshCircGraphButton();
}

// シーンの名前。保存したときに付けた名前を控えておき、次の保存の既定値にする
let sceneName = '';
function setSceneName(name) {
  sceneName = (name || '').trim();
  document.title = sceneName ? ('PhysBox — ' + sceneName) : 'PhysBox';
}
// ファイル名に使えない文字を落とす（保存する名前そのものは書き換えない）
function _sceneFileName(name) {
  const s = (name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return (s || 'scene') + '.json';
}
async function saveScene() {
  const name = await appPrompt('シーンを保存', 'このシーンの名前を付けてください。'
    + '<div class="am-note">ファイル名になり、次に開いたときも表示されます。</div>',
    sceneName || '無題のシーン');
  if (name === null) return;                    // キャンセル
  setSceneName(name);
  const data = JSON.stringify({
    unitVersion: UNIT_VERSION, ppm: PPM,
    name: sceneName,
    graphs: serializeGraphs(),   // ★開いているグラフの窓（中身は保存しない）
    objects,
    joints: joints.map(serializeJoint),
    lasers: lasers.map(serializeLaser),
    waves: waveSources.map(serializeWaveSource),
    slinkies: slinkies.map(serializeSlinky),
    emFields: emFields.map(serializeEMField),   // ★電場・磁場の領域
    heatFields: heatFields.map(serializeHeatField),   // ★加熱・冷却の領域
    flowFields: flowFields.map(serializeFlowField),   // ★流れの場（風・水流）
    annotations: annotations.map(serializeAnnotation),   // ★注釈（テキスト・お絵描き）
    circuit: serializeCircuit(),
    particles: serializeParticles(),     // ★液体・気体も保存する
    gasChambers: serializeGasChambers(), // ★気体室（集中定数の理想気体）
    pistonVessels: serializePistonVessels(),   // ★ピストン容器（器・ピストン・気体の一体）
    programs: programs.map(serializeProgram),  // ★プログラム（窓の位置は画面の割合で持つ）
    remotes: remotes.map(serializeRemote),     // ★リモコン（同上。押している最中かは持たない）
    counters: counters.map(serializeCounter),  // ★通過カウンタ（同上。数えた数は持たない）
    spdMeters: spdMeters.map(serializeSpdMeter),   // ★速さの分布計（同上）
    circTables: serializeCircTables(),         // ★回路の表（素子の横の札。置き場所も持つ）

    // ★カメラ（物体への接続）はシーンの一部。ここに入れておかないと、デモや配ったシーンが
    //   「この物体の目で見る」という状態を持って開けない（cam.x/y/zoom は視点の途中経過なので
    //   保存しない。接続さえ残っていれば追従が毎フレーム決め直す）。
    camera: sceneCamera ? { bodyId: sceneCamera.bodyId, upAngle: sceneCamera.upAngle,
                            on: sceneCamera.on } : null,
    emWorld: { coulombOn:world.coulombOn, coulombK:world.coulombK },
    world, ground
  });
  const blob = new Blob([data], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = _sceneFileName(sceneName); a.click();
}
// ★読み込むのは、同じ版の saveScene() が書いたファイルだけ（この系はまだ外に出ていないので、
//   古い形式のファイルは存在しない）。だから欠けたキーを1つずつ埋め直す処理は持たない：
//   world も ground も丸ごと書き出してあり、Object.assign がそのまま全キーを戻す。
//   ＝ world に設定を足しても、保存・読み込み側に手を入れる必要はない。
//   壊れたファイル・別のアプリの JSON は catch が受けて「読み込みに失敗しました」を出す。
function loadScene() {
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
  inp.onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        // ★clearScene を通らずに中身を入れ替えるので、控えの後始末はここで同じことをする（history.js の★）
        savedState = null; _lastDemo = null;
        objects=data.objects.map(d=>new Body(d));
        joints=deserializeJoints(data.joints, objects);
        lasers=deserializeLasers(data.lasers, objects);
        waveSources=deserializeWaveSources(data.waves, objects);
        slinkies=deserializeSlinkies(data.slinkies, objects);
        emFields=deserializeEMFields(data.emFields);
        heatFields=deserializeHeatFields(data.heatFields);
        flowFields=deserializeFlowFields(data.flowFields);
        syncFlowCarry();      // ★速度の合成の下駄を組み直す（保存してある速度は地面から見た速度）
        finishAnnotEdit(true);
        annotations=deserializeAnnotations(data.annotations);
        selectedAnnotation=null; cancelAnnotInteractions();
        deserializeCircuit(data.circuit);
        Object.assign(world, data.emWorld);
        waveField.geoKey=''; resetWaveField();
        Object.assign(world, data.world);
        Object.assign(ground, data.ground);
        // 全体設定タブの欄はまとめて world / ground から作り直す
        // （以前はここで個別に書いていたので、空気密度・反復回数などが古いまま残った）
        syncWorldPanel();
        particles = deserializeParticles(data.particles);
        deserializeGasChambers(data.gasChambers);
        deserializePistonVessels(data.pistonVessels);
        deserializePrograms(data.programs);                 // ★プログラム（窓も作り直す）
        deserializeRemotes(data.remotes);                   // ★リモコン（同上）
        deserializeCounters(data.counters);                 // ★通過カウンタ（同上）
        deserializeSpdMeters(data.spdMeters);               // ★速さの分布計（同上）
        deserializeCircTables(data.circTables);             // ★回路の表（同上）
        pvGraphs.slice().forEach(pvGraphClose);             // 消えた気体室のグラフを畳む
        refreshGridButton();   // シーンごとにグリッド間隔が違うのでボタンの表示も合わせる
        // ★カメラは物体が揃ったあとで戻す（接続先を id で引くため）
        detachCamera();
        // ★選んだ物体を追うのも切る。カメラと別のスイッチなので detachCamera では切れない
        //   （followIds の id は前のシーンのもので、使い回された id が無関係な物体を指す）
        followEnabled = false; followIds = [];
        resetStrobe();        // ★ストロボも切る（clearScene と同じ。保存形式には入っていない）
        if (data.camera) {
          const cb = objects.find(o => o.id === data.camera.bodyId);
          if (cb) {
            // ★upAngle はそのまま戻す（接続した瞬間の姿勢から決まる値なので、
            //   attachCamera で計算し直すと保存時と違う向きになる）
            attachCamera(cb, data.camera.upAngle === null ? 'world' : 'body');
            sceneCamera.upAngle = data.camera.upAngle;
            if (data.camera.on === false) setCameraOn(false);
          }
        }
        setSceneName(data.name || '');    // 名前を空で保存したシーンは無題に戻す
        // ★グラフの復元は最後。対象（物体・気体室・回路素子）が揃ってからでないと、
        //   居ないものとして飛ばされてしまう
        restoreGraphs(data.graphs);
      }catch(e){
        appAlert('シーンを読み込み', 'シーンの読み込みに失敗しました。'
               + '<div class="am-note">PhysBox で保存した .json ファイルか確認してください。<br>'
               + escHtml(e.message) + '</div>');
      }
    };
    r.readAsText(f);
  };
  inp.click();
}
let _objDragId = null;   // ★並べ替え中の物体ID
// 描画順（objects 配列の順）を入れ替える。配列の後ろほど手前に描かれ、
// 当たり判定も後ろから走査するので、そのまま「重なりの前後」になる。
function moveObjectOrder(srcId, dstIndex) {
  const from = objects.findIndex(o => o.id === srcId);
  if (from < 0) return;
  let to = Math.max(0, Math.min(objects.length, dstIndex));
  if (to > from) to--;                       // 自分を抜いた分だけ詰まる
  if (to === from) return;
  pushUndo();                                // 並べ替えも Ctrl+Z で戻せる
  objects.splice(to, 0, objects.splice(from, 1)[0]);
  updateSceneList();
}
let _emfDragId = null;   // ★並べ替え中の場のID
// 電場・磁場の並び順。重なった領域はどちらの場も同じだけ効く（重ね合わせ）ので、
// 順番が持つ意味は「重なった場所でどちらを選ぶか」だけ。先頭＝一覧の上＝優先。
function moveEMFieldOrder(srcId, dstIndex) {
  const from = emFields.findIndex(f => f.id === srcId);
  if (from < 0) return;
  let to = Math.max(0, Math.min(emFields.length, dstIndex));
  if (to > from) to--;                       // 自分を抜いた分だけ詰まる
  if (to === from) return;
  pushUndo();
  emFields.splice(to, 0, emFields.splice(from, 1)[0]);
  updateSceneList();
}
// 加熱・冷却の並び順。熱はどの領域からも入る（重なれば足し合わさる）ので、順番が持つ
// 意味は電場・磁場と同じく「重なった場所でどちらを選ぶか」だけ。
function moveHeatFieldOrder(srcId, dstIndex) {
  const from = heatFields.findIndex(f => f.id === srcId);
  if (from < 0) return;
  let to = Math.max(0, Math.min(heatFields.length, dstIndex));
  if (to > from) to--;                       // 自分を抜いた分だけ詰まる
  if (to === from) return;
  pushUndo();
  heatFields.splice(to, 0, heatFields.splice(from, 1)[0]);
  updateSceneList();
}
// 流れの場の並び順。重なれば力は足し合わさるので、順番が持つ意味は
// 「重なった場所でどちらを選ぶか」だけ（電場・磁場・加熱冷却と同じ）。
function moveFlowFieldOrder(srcId, dstIndex) {
  const from = flowFields.findIndex(f => f.id === srcId);
  if (from < 0) return;
  let to = Math.max(0, Math.min(flowFields.length, dstIndex));
  if (to > from) to--;                       // 自分を抜いた分だけ詰まる
  if (to === from) return;
  pushUndo();
  flowFields.splice(to, 0, flowFields.splice(from, 1)[0]);
  updateSceneList();
}
// 注釈の重なり順。配列の後ろほど手前に描かれ、当たり判定も後ろから走査するので、
// そのまま「重なりの前後」になる（物体の並べ替えと同じ規則）。
function moveAnnotationOrder(srcId, dstIndex) {
  const from = annotations.findIndex(a => a.id === srcId);
  if (from < 0) return;
  let to = Math.max(0, Math.min(annotations.length, dstIndex));
  if (to > from) to--;                       // 自分を抜いた分だけ詰まる
  if (to === from) return;
  pushUndo();
  annotations.splice(to, 0, annotations.splice(from, 1)[0]);
  updateSceneList();
}
// ── 一覧の自動更新 ───────────────────────────────
//   要素の追加・削除は多数の箇所で起きるため、生成側を1つずつ直すと必ず漏れる。
//   描画ループから安いシグネチャを比較し、変化したときだけ作り直す。
let _sceneSig = null;
function sceneListSignature() {
  let s = `${objects.length}|${joints.length}|${lasers.length}|${waveSources.length}` +
          `|${slinkies.length}|${circuitElements.length}|${particles.length}` +
          `|${selectedJointId}|${selectedElement ? selectedElement.kind : ''}`;
  for (const b of objects) s += `;${b.id}${selectedIds.has(b.id)?"*":""}${b.isStatic?"S":""}${b.constVel?"V":""}` +
                                `${b.thrusters.length?'T'+b.thrusters.length:''}${b.tracerEnabled?'R':''}${b.label||''}`;
  for (const j of joints) s += `,${j.id}${j.type}`;
  // 場は並べ替えられるので、順番そのものと選択状態をシグネチャに入れる
  for (const f of emFields) s += `|${f.id}${f.kind}` +
    (selectedElement && selectedElement.kind === 'emfield' && selectedElement.field === f ? '*' : '');
  for (const f of heatFields) s += `!${f.id}${f.kind}${f.power}` +
    (selectedElement && selectedElement.kind === 'heatfield' && selectedElement.field === f ? '*' : '');
  for (const f of flowFields) s += `~${f.id}${f.speed}${f.angle.toFixed(3)}${f.density}` +
    (selectedElement && selectedElement.kind === 'flowfield' && selectedElement.field === f ? '*' : '');
  // 注釈も並べ替えられるので、順番・選択・見出しに出す中身をシグネチャへ入れる
  for (const a of annotations) s += `/${a.id}${a.type}${a.front?'F':''}` +
    (a.type === 'text' ? a.text.slice(0, 12) : '') + (selectedAnnotation === a ? '*' : '');
  return s;
}
function refreshSceneList() {
  const tab = document.getElementById('tab-scene');
  if (!tab || tab.style.display === 'none') return;   // 開いていなければ何もしない
  if (_objDragId != null || _emfDragId != null) return;   // 並べ替え中は作り直さない
  const sig = sceneListSignature();
  if (sig === _sceneSig) return;
  updateSceneList();
}
function updateSceneList() {
  const el=document.getElementById('obj-list');
  el.innerHTML='';
  const mark = (d, pos) => d.style.boxShadow =
    pos === 'before' ? 'inset 0 2px 0 0 var(--accent)' :
    pos === 'after'  ? 'inset 0 -2px 0 0 var(--accent)' : '';
  if (!el._dndInit) {                        // ★一覧は毎回作り直すので、容器側は1回だけ
    el._dndInit = true;
    el.addEventListener('dragover', ev => { if (_objDragId != null) ev.preventDefault(); });
    el.addEventListener('drop', ev => {      // 末尾の余白へドロップ＝最前面へ
      if (_objDragId == null) return;
      ev.preventDefault();
      moveObjectOrder(_objDragId, objects.length);
      _objDragId = null;
    });
  }
  const addHead = (t, n, note) => {                // 0件の分類は見出しごと出さない
    if (!n) return;
    const h = document.createElement('div');
    h.style.cssText = 'margin:7px 0 3px;font-size:10px;color:var(--text2);border-bottom:1px solid var(--border);padding-bottom:2px';
    h.textContent = `${t} (${n})`;
    el.appendChild(h);
    if (note && n > 1) {
      const s = document.createElement('div');
      s.style.cssText = 'font-size:10px;color:var(--text2);line-height:1.4;margin:0 0 4px';
      s.textContent = note;
      el.appendChild(s);
    }
  };
  // order を渡すと並べ替えできる行になる（いまは電場・磁場だけ）。
  //   order = { id, index, move(srcId, dstIndex) }
  const addRow = (icon, label, isSel, focus, pick, order) => {   // 物体以外の共通行
    const d = document.createElement('div');
    d.style.cssText = 'padding:3px 4px;border-radius:3px;margin-bottom:2px;border:1px solid transparent;' +
                      'cursor:' + (order ? 'grab' : 'pointer');
    d.style.background  = isSel ? 'rgba(79,195,247,.15)' : '';
    d.style.borderColor = isSel ? 'var(--accent)' : 'transparent';
    d.innerHTML = (order ? `<span style="color:var(--text2)">⠿</span> ` : '') +
                  `<span style="color:var(--text2)">${icon}</span> <span style="color:var(--text)">${label}</span>`;
    // withoutPropsTabJump：一覧から選ぶときはプロパティタブへ飛ばない（飛ぶと一覧が消える）
    d.onclick = () => withoutPropsTabJump(() => {
      pick(); if (focus) { cam.x = focus.x; cam.y = focus.y; } updateSceneList();
    });
    if (order) {
      d.draggable = true;
      d.addEventListener('dragstart', ev => {
        _emfDragId = order.id;
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', String(order.id));   // 空だと Firefox はドラッグを始めない
        d.style.opacity = 0.4;
      });
      d.addEventListener('dragend', () => { _emfDragId = null; updateSceneList(); });
      d.addEventListener('dragover', ev => {
        if (_emfDragId == null || _emfDragId === order.id) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        const r = d.getBoundingClientRect();
        mark(d, (ev.clientY - r.top) > r.height/2 ? 'after' : 'before');
      });
      d.addEventListener('dragleave', () => mark(d, null));
      d.addEventListener('drop', ev => {
        ev.preventDefault();
        ev.stopPropagation();                // 容器側の「最前面へ」を走らせない
        mark(d, null);
        if (_emfDragId == null) return;
        const r = d.getBoundingClientRect();
        const after = (ev.clientY - r.top) > r.height/2;
        order.move(_emfDragId, order.index + (after ? 1 : 0));
        _emfDragId = null;
      });
    }
    el.appendChild(d);
  };
  const nameOf = b => b ? (b.label || 'Object ' + b.id) : '空間';
  addHead('物体', objects.length);
  for(const b of objects){
    const div=document.createElement('div');
    div.style.cssText='padding:3px 4px;border-radius:3px;cursor:grab;margin-bottom:2px;border:1px solid transparent';
    div.style.background=selectedIds.has(b.id)?'rgba(79,195,247,.15)':'';
    div.style.borderColor=selectedIds.has(b.id)?'var(--accent)':'transparent';
    const shape={circle:'○',box:'□',polygon:'⬡'}[b.type]||'?';
    div.innerHTML=`<span style="color:var(--text2)">⠿</span> <span style="color:var(--text2)">${shape}</span> <span style="color:var(--text)">${b.label||'Object '+b.id}</span> <span style="color:var(--text2);font-size:10px">${b.isStatic?"[固]":b.constVel?"[等速]":""}</span>`;
    div.draggable = true;
    div.addEventListener('dragstart', ev => {
      _objDragId = b.id;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(b.id));   // 空だと Firefox はドラッグを開始しない
      div.style.opacity = 0.4;
    });
    div.addEventListener('dragend', () => { _objDragId = null; updateSceneList(); });
    div.addEventListener('dragover', ev => {
      if (_objDragId == null || _objDragId === b.id) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      const r = div.getBoundingClientRect();
      mark(div, (ev.clientY - r.top) > r.height/2 ? 'after' : 'before');
    });
    div.addEventListener('dragleave', () => mark(div, null));
    div.addEventListener('drop', ev => {
      ev.preventDefault();
      ev.stopPropagation();                  // ★容器側の「最前面へ」が二重に走らないように
      mark(div, null);
      if (_objDragId == null) return;
      const r = div.getBoundingClientRect();
      const after = (ev.clientY - r.top) > r.height/2;
      moveObjectOrder(_objDragId, objects.findIndex(o => o.id === b.id) + (after ? 1 : 0));
      _objDragId = null;
    });
    div.onclick=()=>withoutPropsTabJump(()=>{
      clearAllSelections();
      selectedIds.add(b.id);
      updatePropsPanel(b);
      document.getElementById('st-sel').textContent = '1個';
      cam.x = b.x; cam.y = b.y;
      updateSceneList();
    });
    div.oncontextmenu=(ev)=>withoutPropsTabJump(()=>{   // ★右クリックでキャンバスと同じメニュー
      ev.preventDefault();
      ev.stopPropagation();
      if (!selectedIds.has(b.id)) {      // 未選択の項目を右クリックしたらそれを選択
        clearAllSelections();
        selectedIds.add(b.id);
        updatePropsPanel(b);
        updateSceneList();
      }
      document.getElementById('st-sel').textContent = selectedIds.size > 1 ? `${selectedIds.size}個` : '1個';
      showCtxMenu(ev.clientX, ev.clientY);
    });
    el.appendChild(div);
  }
  // ★1つの物体に何本も付くので、行は動力ごと。同じ物体に2本以上あるときだけ
  //   通し番号を出す（1本しかない物体の行に「①」と付くと、何の番号か分からない）。
  const thrusters = allThrusters();
  addHead('動力', thrusters.length);
  for (const th of thrusters) {
    const b = th.body;
    const e = { kind:'thruster', body:b, thr:th };
    const n = b.thrusters.length > 1 ? ` ${b.thrusters.indexOf(th) + 1}` : '';
    addRow('➤', `動力${n} — ${nameOf(b)}`,
      !!selectedElement && selectedElement.kind === 'thruster' && selectedElement.thr === th,
      elementWorldPos(e), () => selectNewElement(e));
  }
  const tracers = objects.filter(b => b.tracerEnabled);
  addHead('軌跡', tracers.length);
  for (const b of tracers) {
    const e = { kind:'tracer', body:b };
    addRow('⋯', `軌跡 — ${nameOf(b)}`,
      !!selectedElement && selectedElement.kind === 'tracer' && selectedElement.body === b,
      elementWorldPos(e), () => selectNewElement(e));
  }
  addHead('ジョイント', joints.length);
  for (const j of joints) {
    addRow('⚯', `${JOINT_TYPE_LABELS[j.type] || j.type} — ${nameOf(j.bodyA)} ／ ${nameOf(j.bodyB)}`,
      selectedJointId === j.id, j.getWorldAnchorA(), () => selectNewJoint(j));
  }
  addHead('レーザー', lasers.length);
  for (const L of lasers) {
    const e = { kind:'laser', laser:L };
    const label = L.whiteLight ? 'レーザー 白色光（全色）'
                               : `レーザー ${wavelengthName(L.wavelength)} ${L.wavelength.toFixed(1)} nm`;
    addRow('↗', label,
      (!!selectedElement && selectedElement.kind === 'laser' && selectedElement.laser === L)
        || selectedElemIds.has(L.id),
      L.getOrigin(), () => selectNewElement(e));
  }
  addHead('波源', waveSources.length);
  for (const S of waveSources) {
    const e = { kind:'wave', source:S };
    addRow('◎', `波源 ${S.freq.toFixed(1)} Hz${S.enabled ? '' : '（停止）'}`,
      (!!selectedElement && selectedElement.kind === 'wave' && selectedElement.source === S)
        || selectedElemIds.has(S.id),
      S.getOrigin(), () => selectNewElement(e));
  }
  // ★ばね／ダンパーの行。弦を廃して「波を運ぶ実体」がばねに一本化されたので、
  //   一覧から探して選べる必要がここへ移ってきた（弦にはあった行が消えたままになる）。
  addHead('ばね', slinkies.length);
  for (const S of slinkies) {
    const e = { kind:'slinky', slinky:S };
    const label = S.idealSpring ? `ばね ${S.springK().toFixed(0)} N/m（理想）`
                                : `ばね ${S.springK().toFixed(0)} N/m（実体）`;
    addRow('〰', label,
      !!selectedElement && selectedElement.kind === 'slinky' && selectedElement.slinky === S,
      { x:S.nodes[0].x, y:S.nodes[0].y }, () => selectNewElement(e));
  }
  addHead('電場・磁場', emFields.length,
          'ドラッグで並べ替え。重なった場所では上にあるものが選ばれます（場の強さはどちらも重ね合わせで効きます）');
  emFields.forEach((f, fi) => {
    const e = { kind:'emfield', field:f };
    const label = f.kind === 'E' ? `電場 ${f.strength} V/m` : `磁場 ${f.strength} T`;
    addRow(f.kind === 'E' ? '⇈' : '⊙', label,
      !!selectedElement && selectedElement.kind === 'emfield' && selectedElement.field === f,
      { x:f.x, y:f.y }, () => selectNewElement(e),
      { id:f.id, index:fi, move:moveEMFieldOrder });
  });
  addHead('加熱・冷却', heatFields.length,
          'ドラッグで並べ替え。重なった場所では上にあるものが選ばれます（熱はどちらの領域からも入ります）');
  heatFields.forEach((f, fi) => {
    const e = { kind:'heatfield', field:f };
    addRow(f.kind === 'cool' ? '❄' : '♨', `${f.kindName()} ${f.label()}`,
      !!selectedElement && selectedElement.kind === 'heatfield' && selectedElement.field === f,
      { x:f.x, y:f.y }, () => selectNewElement(e),
      { id:f.id, index:fi, move:moveHeatFieldOrder });
  });
  addHead('流れの場', flowFields.length,
          'ドラッグで並べ替え。重なった場所では上にあるものが選ばれます（力はどちらの領域からも受けます）');
  flowFields.forEach((f, fi) => {
    const e = { kind:'flowfield', field:f };
    addRow('🌀', `流れ ${f.label()}（${f.mediumName()}）`,
      !!selectedElement && selectedElement.kind === 'flowfield' && selectedElement.field === f,
      { x:f.x, y:f.y }, () => selectNewElement(e),
      { id:f.id, index:fi, move:moveFlowFieldOrder });
  });
  // ★注釈。物理には参加しないが、一覧には出す。背景に敷いたものは物体の下に隠れて
  //   見つけられなくなることがあり、一覧が無いと「見えないのに消せない」ものが残る。
  //   並べ替えできる行にしてあるので、重なりの前後もここで直せる。
  addHead('注釈', annotations.length,
          'ドラッグで並べ替え（下にあるものほど手前）。物理には影響しません');
  annotations.forEach((a, ai) => {
    const label = a.type === 'text'
      ? '文字「' + (a.text.length > 12 ? a.text.slice(0, 12) + '…' : a.text).replace(/\n/g, ' ') + '」'
      : a.type === 'ellipse' ? '丸'
      : a.closed ? '図形（' + a.pts.length + '角）' : '線';
    addRow(a.type === 'text' ? 'Ａ' : a.type === 'ellipse' ? '◯' : '✎',
      label + (a.front ? '（手前）' : ''),
      selectedAnnotation === a,
      annotCenterWorld(a),
      () => focusAnnotation(a),          // それを掴めるツール／モードへ切り替えてから選ぶ
      { id:a.id, index:ai, move:moveAnnotationOrder });
  });
  addHead('回路', circuitElements.length);
  for (const c of circuitElements) {
    addRow('⎓', CIRCUIT_LABELS[c.type] || c.type, selectedCircuit === c,
      { x:(c.ax + c.bx)/2, y:(c.ay + c.by)/2 }, () => selectCircuitElement(c));
  }
  if (particles.length) {                          // 粒子は数が多いので要約だけ
    addHead('粒子', particles.length);
    const nf = particles.filter(p => p.type === 'fluid').length;
    const d = document.createElement('div');
    d.style.cssText = 'padding:3px 4px;color:var(--text2)';
    d.textContent = `液体 ${nf} ／ 気体 ${particles.length - nf}`;
    el.appendChild(d);
  }
  _sceneSig = sceneListSignature();
}
