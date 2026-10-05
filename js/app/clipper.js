// 図形和（ブーリアン演算）。左ツールバー・編集メニュー・右クリックの3か所から呼ぶ。
//   ★mode は 'union' | 'diff' | 'intersect' のキー。以前は表示文字列そのもの
//     （'結合 (A∪B)'）を受け取っていたが、呼び出し口が増えるとラベルを直した瞬間に
//     動かなくなるので、表示と切り離した。ラベルは BOOLEAN_OPS が持つ。
const BOOLEAN_OPS = [
  ['union',     '結合 (A∪B)',  '選んだ図形をすべて1つに合わせます'],
  ['diff',      '型抜き (A−B)', '最初に選んだ図形から、あとに選んだ図形を抜きます（選ぶ順番で結果が変わります）'],
  ['intersect', '交差 (A∩B)',  '選んだ図形が全部重なっている部分だけを残します'],
];
// Clipper の結果（輪の集まり）を「外周＋穴」の組へほどく。図形和と歯車コートで共用。
//   各リングの入れ子の深さを偶奇で判定：偶数=塗り(外周)、奇数=穴（符号規約に依存しない）
function clipperOuterShapes(solution) {
  const rings = solution
    .filter(p => p && p.length >= 3)
    .map(p => ({ pts: p.map(q => ({ x: q.X/100, y: q.Y/100 })) }));
  const ringArea = pts => {
    let a = 0;
    for (let i=0;i<pts.length;i++){ const p=pts[i], q=pts[(i+1)%pts.length]; a += p.x*q.y - q.x*p.y; }
    return Math.abs(a)/2;
  };
  for (const r of rings) {
    r.depth = 0;
    for (const o of rings) { if (o !== r && pointInPolygon(r.pts[0], o.pts)) r.depth++; }
    r.area = ringArea(r.pts);
  }
  const outers = rings.filter(r => r.depth % 2 === 0);
  const holes  = rings.filter(r => r.depth % 2 === 1);
  for (const h of holes) {                              // 各穴を、含む最小外周へ割当
    let parent = null, best = Infinity;
    for (const o of outers)
      if (pointInPolygon(h.pts[0], o.pts) && o.area < best) { parent = o; best = o.area; }
    if (parent) (parent.holeList = parent.holeList || []).push(h.pts);
  }
  for (const o of outers) o.holeList = o.holeList || [];
  return outers;
}
// 外周＋穴の図形の正味面積と重心
function shapeAreaCentroid(pts, holeList) {
  const loopAreaCentroid = (loop) => {
    let A=0, cx=0, cy=0;
    for (let i=0;i<loop.length;i++){
      const p=loop[i], q=loop[(i+1)%loop.length];
      const cr = p.x*q.y - q.x*p.y;
      A += cr; cx += (p.x+q.x)*cr; cy += (p.y+q.y)*cr;
    }
    A *= 0.5;
    if (Math.abs(A) < 1e-9) { let mx=0,my=0; for(const p of loop){mx+=p.x;my+=p.y;} return {area:0, cx:mx/loop.length, cy:my/loop.length}; }
    return { area:A, cx: cx/(6*A), cy: cy/(6*A) };
  };
  const oc = loopAreaCentroid(pts);
  let totalA = Math.abs(oc.area);
  let sx = oc.cx * totalA, sy = oc.cy * totalA;
  for (const hp of holeList || []) {
    const hc = loopAreaCentroid(hp);
    const ha = Math.abs(hc.area);
    totalA -= ha; sx -= hc.cx * ha; sy -= hc.cy * ha;
  }
  return { area: totalA, cx: totalA > 1e-6 ? sx/totalA : oc.cx, cy: totalA > 1e-6 ? sy/totalA : oc.cy };
}
function applyClipper(mode) {
  if (typeof ClipperLib === 'undefined') {
    appAlert('図形和', '図形演算のライブラリ（<b>lib/clipper.js</b>）を読み込めませんでした。');
    return;
  }
  if (selectedIds.size < 2) {
    appAlert('図形和', '図形を<b>2つ以上</b>選んでから実行してください。');
    return;
  }
  const sels = Array.from(selectedIds).map(id => objects.find(o => o.id === id)).filter(Boolean);
  const A = sels[0], B = sels[1];
  // circle は _worldVerts() がないので多角形近似する
  // world座標のループ群を Clipper パス群へ（穴も含める）
  function getPaths(b) {
    const S = 100;
    const toClip = loop => loop.map(p => ({ X: Math.round(p.x*S), Y: Math.round(p.y*S) }));
    const loops = [];
    if (b.type === 'circle') {
      const pts = [];
      for (let i=0;i<48;i++){ const a=(i/48)*Math.PI*2; pts.push({x:b.x+Math.cos(a)*b.radius, y:b.y+Math.sin(a)*b.radius}); }
      loops.push(pts);
    } else {
      loops.push(b._worldVerts());
      for (const h of b._worldHoles()) loops.push(h);   // ★穴も入力に含める
    }
    const paths = loops.map(toClip);
    const sArea = p => { let a=0; for(let i=0;i<p.length;i++){const u=p[i],v=p[(i+1)%p.length]; a+=u.X*v.Y-v.X*u.Y;} return a; };
    if (paths.length) {
      if (sArea(paths[0]) < 0) paths[0].reverse();                              // 外周を +
      for (let i=1;i<paths.length;i++) if (sArea(paths[i]) > 0) paths[i].reverse(); // 穴を −
    }
    return paths;
  }
  const pathsList = sels.map(getPaths);
  const solution = new ClipperLib.Paths();
  const PT = ClipperLib.PolyType, CT = ClipperLib.ClipType, PF = ClipperLib.PolyFillType;
  let ok = true;
  if (mode === 'intersect') {
    // 交差は「subjectの和 ∩ clipの和」になってしまうため、1つずつ畳み込む
    let acc = pathsList[0];
    for (let i = 1; i < pathsList.length && acc.length; i++) {
      const cpr = new ClipperLib.Clipper();
      const out = new ClipperLib.Paths();
      cpr.AddPaths(acc, PT.ptSubject, true);
      cpr.AddPaths(pathsList[i], PT.ptClip, true);
      ok = cpr.Execute(CT.ctIntersection, out, PF.pftNonZero, PF.pftNonZero);
      acc = (ok && out.length) ? out : [];
    }
    for (const p of acc) solution.push(p);
  } else {
    const cpr = new ClipperLib.Clipper();
    if (mode === 'union') {
      for (const ps of pathsList) cpr.AddPaths(ps, PT.ptSubject, true);   // 全部を subject
      ok = cpr.Execute(CT.ctUnion, solution, PF.pftNonZero, PF.pftNonZero);
    } else {                                                              // 型抜き A−B−C…
      cpr.AddPaths(pathsList[0], PT.ptSubject, true);
      for (let i = 1; i < pathsList.length; i++) cpr.AddPaths(pathsList[i], PT.ptClip, true);
      ok = cpr.Execute(CT.ctDifference, solution, PF.pftNonZero, PF.pftNonZero);
    }
  }
  // ★自己接触した輪郭をほどく。辺どうしがぴったり接する図形（箱を4枚の板で囲うなど）を
  //   結合すると、Clipper は「外周と内周を内部の継ぎ目でつないだ1本の輪郭」を返す。
  //   実測（板4枚で 800×520px の枠を結合）：返ってきたのは10頂点の1本で、うち
  //   (-400,240) が2回現れる＝橋つきの自己接触ポリゴン。面積も内外判定も正しいのに、
  //   triangulate が三角形を0個しか返せず、decomposeConvex が単一凸扱いへ落ちて
  //   （js/physics/convex.js:149）、SAT が接触を1つも作らなくなる。
  //   実測の症状：枠の中で球を跳ねさせると、板4枚では中に留まる（内寸の 96% まで）のに、
  //   結合した枠は素通りして x=2000px まで飛び、速さは 208.8 のまま＝一度も当たらない。
  //   SimplifyPolygons を通すと 4頂点の外周と 5頂点の穴の2本にほどける。
  //   ★PolyTree で受け直す手は効かない（同じ1本の輪郭が IsHole:false で入るだけ）。
  const simplified = ClipperLib.Clipper.SimplifyPolygons(solution, PF.pftNonZero);
  solution.length = 0;
  for (const p of simplified) solution.push(p);
  if (!ok || solution.length === 0) {
    appAlert('図形和', '演算の結果が<b>空</b>になりました。'
           + '<div class="am-note">図形が重なっていない可能性があります。'
           + '「型抜き」「交差」は重なった部分がないと結果が残りません。</div>');
    return;
  }
  pushUndo();   // ★この1行を追加（以降で物体を生成・削除する）
  // 削除対象IDを先に退避してから新Bodyを追加
  const toDelete = new Set(selectedIds);
  const outers = clipperOuterShapes(solution);
  const srcDensity = (A.density != null)
    ? A.density
    : A.mass / Math.max(A.areaM2() * world.depth, 1e-9);
  // ★残る物体の性質は「最初に選んだ図形 A」から引き継ぐ（型抜き A−B の A と同じ基準）。
  //   以前は新規描画の既定値 drawProps から作っていたので、合成した瞬間に色・静止摩擦・
  //   衝突レイヤー・重力ON/OFFが「次に描く図形の設定」へ化けていた（見た目には
  //   最後に描いた図形の色になったように見える）。
  //   ここに並べるのは示強的な性質だけ。量（質量・電荷）は面積で決まるので別扱いにする。
  const INHERIT_KEYS = [
    'fillColor', 'strokeColor', 'strokeWidth', 'alpha', 'label',      // 見た目
    'restitution', 'friction', 'frictionStatic', 'drag',              // 接触・抵抗
    'isStatic', 'fixedRotation', 'hasGravity', 'layers',              // 力学の扱い
    'ior', 'abbe', 'dispersion', 'reflectance', 'fresnel', 'reflective',  // 光学
    'waveMode', 'waveIor',                                            // 波動
    'conductor',                                                      // 電磁（導体か）
    'showForces', 'showVelocity',                                     // ベクトル表示
  ];
  const inherited = {};
  for (const k of INHERIT_KEYS) inherited[k] = A[k];
  const made = [];   // 生成した物体と、その正味面積（電荷の配分に使う）
  // ★入力に含まれる「円」をワールド座標で集めておく（円弧の復元に使う）。
  //   円そのものだけでなく、すでに円弧を持つ図形も対象＝演算を重ねても円弧が残る。
  const srcCircles = [];
  for (const b of sels) for (const c of bodySourceCircles(b)) {
    const cs = Math.cos(b.angle), sn = Math.sin(b.angle);
    srcCircles.push({ cx: b.x + c.cx*cs - c.cy*sn, cy: b.y + c.cx*sn + c.cy*cs, r: c.r });
  }
  const srcFaces = [];
  for (const b of sels) for (const lf of gearLocalFaces(b)) srcFaces.push(gearFaceToWorld(lf, b.x, b.y, b.angle));
  for (const o of outers) {
    const pts = o.pts;
    const holeList = o.holeList || [];
    const { cx, cy, area: totalA } = shapeAreaCentroid(pts, holeList);
    const verts = pts.map(p => ({ x: p.x-cx, y: p.y-cy }));
    const holeLoops = holeList.map(hp => hp.map(p => ({ x: p.x-cx, y: p.y-cy })));
    // ★「元は円だった」区間を円弧として復元する。Clipper は多角形しか返さないので、
    //   入力に使った円（と、入力がすでに持っていた円弧）を手掛かりに拾い直す。
    //   これがないと円は48角形のまま残り、その上を滑る物体が角のたびに
    //   法線方向の速度を吸われてエネルギーを失う。
    //   新しい物体は angle=0 なので、ローカル座標＝ワールド座標−重心 でそのまま移せる
    const localCircles = srcCircles.map(s => ({ cx: s.cx - cx, cy: s.cy - cy, r: s.r }));
    const arcs = detectArcs(verts, holeLoops, localCircles);
    // ★歯の面の控え（js/physics/gear.js）も写す。新しい物体は angle=0 なので
    //   ワールドの面から (cx,cy) を引けばローカルになる。歯が型抜きで削れても控えは残るが、
    //   使い道は吸着だけで、削れた所に吸い付いても歯が無いのでかみ合わないだけ。
    const toothFaces = srcFaces.map(wf => gearFaceToLocal(wf, cx, cy, 0));
    const nb = new Body({ type:'polygon', x:cx, y:cy, verts, holes:holeLoops, arcs, ...inherited,
                          toothFaces });
    nb.density = srcDensity;
    nb.setStatic(A.isStatic);
    nb.setMass(nb.massFromDensity());
    objects.push(nb);
    made.push({ nb, area: Math.max(totalA, 0) });
  }
  // ★電荷だけは A から丸ごと写せない。示量的な量なので、それでは合成のたびに
  //   電荷が増えたり（A の分が各片に複製される）、消えたり（B の分が捨てられる）する。
  //   物理的に正しいのは保存なので、合成前の電荷の合計を、残った各片へ面積比で分ける。
  const qTotal = sels.reduce((s, b) => s + (b.charge || 0), 0);
  if (qTotal && made.length) {
    const aSum = made.reduce((s, m) => s + m.area, 0);
    for (const m of made)
      m.nb.charge = (aSum > 1e-9) ? qTotal * m.area / aSum : qTotal / made.length;
  }
  for (const id of toDelete) {
    const i = objects.findIndex(o => o.id === id);
    if (i >= 0) objects.splice(i, 1);
    joints = joints.filter(j => (!j.bodyA || j.bodyA.id !== id) && (!j.bodyB || j.bodyB.id !== id));
  }
  selectedIds.clear(); selectedElemIds.clear(); selectedJointEnds.clear();
  updatePropsPanel(null);
}
// ════════════════════════════════════════════════════════════════════
//  PHYSBOX 電磁気モジュール（電荷・電場・磁場・回路・電磁誘導）
//  ・空間の場と粒子：既存の力学世界に F=qE / ローレンツ(Boris) / クーロン を足す
//  ・回路：位相的（接続グラフ）な別世界。修正ノード解析(MNA)で毎tick解く＝厳密SI
//  ・継ぎ目：導体棒だけが両世界をまたぐ（EMF=BLv → I → F=BIL のレンツ連成）
//  数値核（MNA・C/L companion・Boris・棒連成）はNodeで解析解と照合済み。
// ════════════════════════════════════════════════════════════════════

// ── 実効定数（重力の gravStrength と同じ思想。教室の画面で見える大きさに調整する）──
//   回路(V/A/Ω/F/H)は厳密SIだが、空間の場・電荷は実SI定数だと何も見えないため実効値を使う。
Object.assign(world, {
  // ★世界全体の一様場は持たない。電場・磁場は「置いた矩形の内側だけ」に作る
  //   EMField オブジェクト（js/em/field.js）で表す。有限の領域でないと、
  //   磁場領域への荷電粒子の入射・速度選別器・導体棒の誘導起電力が作れない。
  // 電荷間クーロン力（領域ではなく空間全体の相互作用なので全体設定）。
  // ★既定ON。万有引力（gravitation）が既定OFFなのと非対称に見えるが、理由がある：
  //   万有引力は質量に働き、質量はすべての物体が必ず持つのでONにすると全シーンが変わる。
  //   クーロン力は電荷に働き、drawProps に charge は無い＝新しく描いた物体も既定のデモも
  //   すべて q=0 なので、ONにしても何も起こらない。挙動が変わるのは「利用者が意図して
  //   電荷を入れた物体」だけで、そのとき力を働かせたくない場面はまず無い。
  //   逆にOFF既定だと「+1Cと−1Cを置いたのに動かない」＝実在する力が既定で消えている。
  //   ★スイッチ自体は残す。動く試験電荷どうしの相互作用を無視したい場面（一様電場中の
  //     放物運動を+q/−qで同時に見せる、速度選別器にビームを複数流す）があり、これは
  //     粒子が動くことが本質なので固定ツールでは代替できない。既定 E=5V/m・q=1C なら
  //     63px 離れただけで粒子間の力が場からの力と拮抗する（F_C/F_E = kq/(E r²)）。
  coulombOn: true,
  // 実効クーロン定数（8.99e9 ではなく調整つまみ）。
  //   実用域は 0〜5 くらい。既定2で、1C 同士が 1m 離れて 2 N。よく使う大きさの物体
  //   （半径0.3mの円で約8kg）なら 0.25 m/s² 程度のゆるやかな加速になる。
  //   スライダーはこの実用域だけを刻み、それより大きい値は数値欄で直接入力する。
  coulombK: 2,
  emForceScale: 1.0,   // qE・クーロン力の見かけ倍率（微調整用）
  showEMField: true,       // 場のベクトル/記号を描くか
  showFieldLines: false,    // ★点電荷の電気力線（既定OFF）
  showEquipotential: false, // ★等電位線（既定OFF）
  circuitOn: true,     // 回路ソルバを回すか
});
const COULOMB_SOFTEN2 = 64;   // ε²[px²]（r→0 の発散防止。重力の world.gravSoften と同思想）
// ★遮蔽（湯川型 e^(−r/λ)）は入れない。2026-09-22 に一度実装して撤去した。理由：
//   遮蔽は**新しい力ではなく、まわりの電荷がつくるふつうのクーロン力の和**そのもので、
//   本来なら電荷を並べれば自然に出るもの。この app でそれが出ないのは、陽イオンに電荷を
//   持たせていない・電子が18個しかない、というこちらの都合による。係数で代用すると
//   「和で出るはずのものを別の法則として足す」ことになるので、入れない。
//   （オームの法則モデルで電子の行列を離したかったのが動機。実測は demos-em.js の★に残す）

// ── 回路素子 ─────────────────────────────────────────
//   2端子。端点はワールド座標(ax,ay)-(bx,by)。ノードは配置後に座標マージで決まる。
//   R:抵抗 / V:直流電源 / AC:交流電源 / wire:導線(0Ω) / switch / ammeter:電流計 /
//   voltmeter:電圧計 / C:コンデンサー / L:コイル
