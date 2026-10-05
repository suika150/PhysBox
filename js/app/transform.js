function selectedBodies() {
  const out = [];
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b) out.push(b); }
  return out;
}
function selectionAABB() {
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (const b of selectedBodies()) {
    const a = b._aabb;
    if (a.minX < mnX) mnX = a.minX;  if (a.minY < mnY) mnY = a.minY;
    if (a.maxX > mxX) mxX = a.maxX;  if (a.maxY > mxY) mxY = a.maxY;
  }
  return mnX === Infinity ? null : { minX:mnX, minY:mnY, maxX:mxX, maxY:mxY };
}
// 選択しているものすべての世界AABB。物体だけを見る selectionAABB と違い、範囲選択で
// 拾えるものを漏れなく含める（背景固定のレーザー・波源／ジョイントとスリンキーの端／
// 種別ごとの一括選択）。
// ★点線の枠は「いま何を選んでいるか」を表す印なので、選択に入っているのに枠の外へ
//   はみ出すものがあってはいけない。物体だけを囲んでいた頃は、一緒に選んだレーザーが
//   枠の外に取り残されて、選ばれているのかどうかが操作するまで分からなかった。
function selectionExtent() {
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  const pt = p => {
    if (!p) return;
    if (p.x < mnX) mnX = p.x;  if (p.y < mnY) mnY = p.y;
    if (p.x > mxX) mxX = p.x;  if (p.y > mxY) mxY = p.y;
  };
  for (const b of selectedBodies()) {
    const a = b._aabb;
    pt({ x: a.minX, y: a.minY }); pt({ x: a.maxX, y: a.maxY });
  }
  for (const el of selectedElemList()) pt(el.getOrigin());
  for (const { j, end } of selectedJointEndList())
    pt(end === 'A' ? j.getWorldAnchorA() : j.getWorldAnchorB());
  for (const { S, end } of selectedSlinkyEndList()) pt(slinkyEndNode(S, end));
  if (bulkKind && BULK_KINDS[bulkKind]) {
    for (const o of BULK_KINDS[bulkKind].all()) {
      if (!bulkIds.has(o.id)) continue;
      for (const p of bulkObjPoints(bulkKind, o)) pt(p);
    }
  }
  return mnX === Infinity ? null : { minX:mnX, minY:mnY, maxX:mxX, maxY:mxY };
}
// 変換の基準点。単一選択ならその重心（動かない）、複数なら選択範囲の中心。
// ★背景固定のレーザー・波源も数に入れる（transformCenter がその計算そのもの）。
//   回転ハンドルはこれらも回すので、基準点が物体だけの中心だと枠の中心とずれる。
function selectionPivot() {
  return transformCenter() || { x: 0, y: 0 };
}
// 極端な縮小・拡大を止める（1pxを割ると形状が退化し、SATが破綻する）
function _scaleAllowed(ratio) {
  for (const b of selectedBodies()) {
    const a = b._aabb;
    const d = Math.min(a.maxX-a.minX, a.maxY-a.minY) * ratio;
    if (!(d > 3) || d > 40000) return false;
  }
  return true;
}
// ジョイントの「背景側（自由端）」アンカーは world 座標なので、物体と同じ変換で運ぶ。
// （物体を平行移動したときに anchorBx += bdx としているのと同じ考え方）
// ★地面に取り付けた端は対象外。アンカーが地面のローカル座標なので world 座標として
//   書き換えると地面から外れた場所へ飛ぶうえ、そもそも「地面に打った杭」は物体を
//   回しても拡大しても地面の上に残るのが正しい。
function _mapFreeJointAnchors(b, map) {
  for (const j of joints) {
    if (j.bodyA === b && !j.bodyB && !j.groundB) { const p = map(j.anchorBx, j.anchorBy); j.anchorBx = p.x; j.anchorBy = p.y; }
    if (j.bodyB === b && !j.bodyA && !j.groundA) { const p = map(j.anchorAx, j.anchorAy); j.anchorAx = p.x; j.anchorAy = p.y; }
  }
}
// 物体の局所形状を s 倍する（等比のみ）。位置は変えない。
//   ローカル座標で保持している付属物を全部追従させないと、動力やヒンジが物体から外れる。
function scaleBodyShape(b, s) {
  if (b.opticKind) {                 // 光学素子：円弧モデルを保つため開口と焦点距離を倍して作り直す
    b.opticH *= s; b.focal *= s;     //   （opticGeometry は H・f について1次同次なので形状は正確に相似）
    rebuildOpticGeometry(b);         //   verts / opticArcs / convexParts / AABB を再生成
  } else if (b.type === 'circle') {
    b.radius *= s;
  } else if (b.type === 'box') {
    b.w *= s; b.h *= s;
    const hw = b.w/2, hh = b.h/2;    // ★convexParts はコンストラクタで焼き込まれるので必ず作り直す
    b.convexParts = [[{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}]];
  } else if (b.type === 'polygon') {
    b.verts = b.verts.map(v => ({ x: v.x*s, y: v.y*s }));
    if (b.holes) b.holes = b.holes.map(h => h.map(v => ({ x: v.x*s, y: v.y*s })));
    // ★円弧も相似に拡大（等比拡大しか許していないので、円は円のまま）。
    //   角度範囲は不変で、中心・半径・ふくらみだけが s 倍になる。
    if (b.arcs) b.arcs = b.arcs.map(a => ({ ...a, cx: a.cx*s, cy: a.cy*s, r: a.r*s, bulge: a.bulge*s }));
    const cp = buildConvexParts(b.verts, b.holes);
    b.convexParts = cp.parts; b.partEdgeInternal = cp.internal;
    b.partEdgeArc = buildPartArcFlags(cp.parts, b.arcs);
    // ★歯車は相似に拡大しても歯車のまま（歯数は同じ・モジュールが s 倍）。gear.js
    if (b.gear) b.gear = { z: b.gear.z, m: b.gear.m * s };
    if (b.toothFaces) b.toothFaces = b.toothFaces.map(f => gearFaceScaled(f, s));
  }
  for (const th of b.thrusters) { th.localX *= s; th.localY *= s; }
  b.tracerAnchorX   *= s; b.tracerAnchorY   *= s;
  for (const L of lasers) if (L.body === b) { L.localX *= s; L.localY *= s; }
  for (const j of joints) {
    if (j.bodyA === b) { j.anchorAx *= s; j.anchorAy *= s; }
    if (j.bodyB === b) { j.anchorBx *= s; j.anchorBy *= s; }
    if (j.type === 'rope' && (j.bodyA === b || j.bodyB === b)) resetRopeChain(j);
  }
  if (b.density != null) b.setMass(b.massFromDensity());
  else                   b.setMass(b.mass * s * s);
  b._invalidateShape(); b._updateAABB();
  b.sleeping = false; b.sleepTimer = 0;
}
function scaleBodyAbout(b, s, pivot) {
  b.x = pivot.x + (b.x - pivot.x) * s;
  b.y = pivot.y + (b.y - pivot.y) * s;
  _mapFreeJointAnchors(b, (px, py) => ({ x: pivot.x + (px-pivot.x)*s, y: pivot.y + (py-pivot.y)*s }));
  scaleBodyShape(b, s);
  reanchorGuide(b);
}
function rotateBodyAbout(b, da, pivot, withGuide) {
  if (!da) return;
  const c = Math.cos(da), sn = Math.sin(da);
  const dx = b.x - pivot.x, dy = b.y - pivot.y;
  b.x = pivot.x + dx*c - dy*sn;
  b.y = pivot.y + dx*sn + dy*c;
  b.angle += da;
  _mapFreeJointAnchors(b, (px, py) => {
    const ex = px - pivot.x, ey = py - pivot.y;
    return { x: pivot.x + ex*c - ey*sn, y: pivot.y + ex*sn + ey*c };
  });
  for (const j of joints)
    if (j.type === 'rope' && (j.bodyA === b || j.bodyB === b)) resetRopeChain(j);
  if (b.guideEnabled) { if (withGuide) b.guideAngle += da; reanchorGuide(b); }
  b._updateAABB();
  b.sleeping = false; b.sleepTimer = 0;
}
function scaleSelection(s, pivot) {
  const sel = selectedBodies();
  const set = new Set(sel);
  for (const b of sel) scaleBodyAbout(b, s, pivot);
  for (const j of joints) {
    const aMoved = j.bodyA ? set.has(j.bodyA) : (j.bodyB && set.has(j.bodyB));
    const bMoved = j.bodyB ? set.has(j.bodyB) : (j.bodyA && set.has(j.bodyA));
    if (!aMoved || !bMoved) continue;
    j.restLength *= s; j.maxLength *= s;
    if (j.type === 'rope') { j.radius *= s; resetRopeChain(j); }
  }
  // ★背景固定のレーザー・波源も基準点からの距離を伸縮させる。点線の枠がこれらも囲んで
  //   いる以上、ハンドルで取り残されると「枠の中身が一体で動く」約束が破れる。
  //   大きさは持たない（点）ので変わるのは位置だけ。向きも変わらない。
  for (const e of _freeSelectedElems()) {
    e.localX = pivot.x + (e.localX - pivot.x) * s;
    e.localY = pivot.y + (e.localY - pivot.y) * s;
  }
  if (!running) resolveGroundEmbedding();
}
function rotateSelection(da, pivot) {
  for (const b of selectedBodies()) rotateBodyAbout(b, da, pivot, true);
  // ★背景固定のレーザー・波源も一緒に回す（scaleSelection の★と同じ理由）。
  //   ここに入れたので、呼び出し側でもう一度回さないこと（rotateSelectionBy から
  //   同じ処理を取り除いてある。両方にあると2倍回る）。
  const cs = Math.cos(da), sn = Math.sin(da);
  for (const e of _freeSelectedElems()) {
    const dx = e.localX - pivot.x, dy = e.localY - pivot.y;
    e.localX = pivot.x + dx*cs - dy*sn;
    e.localY = pivot.y + dx*sn + dy*cs;
    if (e instanceof Laser) e.angle += da;       // 波源は点源なので向きを持たない
  }
  if (!running) resolveGroundEmbedding();
}
// ════════════════════════════════════════
//  図形回転・反転（編集メニュー／右クリック）
// ════════════════════════════════════════
//  ★内部の angle は画面のy軸が下向きなので「正＝時計回り」。
//    メニューの「時計回りに90°」は da = +π/2 になる（表示用の _dispDeg は符号を反転する）。
//
//  ★鏡映（反転）について。
//    Body は「ローカル頂点 ＋ angle による回転」だけで形を持っていて、鏡映のフラグが無い。
//    つまり角度をいじるだけでは鏡映にならない（以前の実装は angle の符号を変えるだけで、
//    角度0°の直角三角形に左右反転をかけても何も起きなかった）。正しくは
//        鏡映 M ⇒ 角度 θ → −θ、かつローカル頂点に M を掛ける
//    となる（反射は向きを反転するので R(θ) が R(−θ) に共役変換される）。
//
//    左右反転（縦の軸で映す M_x）と上下反転（横の軸で映す M_y）は M_x = R(π)·M_y の関係に
//    あるので、頂点の鏡映は y→−y の1種類だけ用意し、余った180°は角度の式へ入れてある：
//        上下反転：θ → −θ      左右反転：θ → π−θ   （どちらも頂点は y→−y）
//    こうすると頂点をいじる経路が1本で済み、円弧の対応表を2通り検証せずに済む。

// 変換の対象になる、背景に固定したレーザー・波源。
// 物体に載っているものは物体と一緒に動く（localX/Y が物体基準）ので、ここには入れない。
function _freeSelectedElems() {
  const out = [];
  for (const L of selectedLasers())      if (!L.body) out.push(L);
  for (const S of selectedWaveSources()) if (!S.body) out.push(S);
  return out;
}
// 回転の支点・鏡映の軸が通る点。物体と背景固定の要素をすべて囲む枠の中心。
// 物体1つだけのときはその重心＝回しても動かない点を使う（選択枠の○ハンドルと同じ）。
function transformCenter() {
  const bodies = selectedBodies(), els = _freeSelectedElems();
  if (bodies.length === 1 && !els.length) return { x: bodies[0].x, y: bodies[0].y };
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  const add = (x0, y0, x1, y1) => {
    if (x0 < mnX) mnX = x0;  if (y0 < mnY) mnY = y0;
    if (x1 > mxX) mxX = x1;  if (y1 > mxY) mxY = y1;
  };
  for (const b of bodies) { const a = b._aabb; add(a.minX, a.minY, a.maxX, a.maxY); }
  for (const e of els)    { const o = e.getOrigin(); add(o.x, o.y, o.x, o.y); }
  return mnX === Infinity ? null : { x: (mnX+mxX)/2, y: (mnY+mxY)/2 };
}
function transformSelectionEmpty() { return !selectedBodies().length && !_freeSelectedElems().length; }
// 物体のローカル形状を y→−y で鏡映する。位置と角度は呼び出し側が扱う。
//   ★円・矩形・光学素子はこの鏡映で形が変わらない（どれもローカルx軸について対称）ので
//     頂点には触れない。光学素子は焦点距離を変えると opticGeometry から作り直されるため、
//     ここで頂点をいじっても次の再生成で戻ってしまう＝触らないのが正しい。
function _mirrorBodyShapeY(b) {
  if (b.type === 'polygon' && !b.opticKind) {
    // 鏡映すると巻き順（符号付き面積）が裏返るので、並びを逆にして元の向きへ戻す
    const my = loop => loop.map(v => ({ x: v.x, y: -v.y })).reverse();
    b.verts = my(b.verts);
    if (b.holes) b.holes = b.holes.map(my);
    // 円弧：中心は y→−y、始点角は θ→−θ、回る向きは逆になる（開き角はそのまま）
    if (b.arcs) b.arcs = b.arcs.map(a => ({ ...a, cy: -a.cy, a0: -a.a0, ccw: !a.ccw }));
    // 歯の面の控えも映す（円形歯車の形は x 軸について対称なので b.gear はそのまま）
    if (b.toothFaces) b.toothFaces = b.toothFaces.map(gearFaceMirroredY);
    const cp = buildConvexParts(b.verts, b.holes);
    b.convexParts      = cp.parts;
    b.partEdgeInternal = cp.internal;
    b.partEdgeArc      = buildPartArcFlags(cp.parts, b.arcs);
    b.setMass(b.mass);                 // 慣性モーメントを新しい頂点で取り直す（面積は不変）
  }
  // ローカル座標で持っている付属物も一緒に映す（scaleBodyShape と同じ顔ぶれ）
  b.tracerAnchorY   = -b.tracerAnchorY;
  for (const th of b.thrusters) { th.localY = -th.localY; th.dir = -th.dir; }   // 相対角なので符号だけ
  for (const L of lasers)      if (L.body === b) { L.localY = -L.localY; L.angle = -L.angle; }
  for (const S of waveSources) if (S.body === b) S.localY = -S.localY;   // 点源なので向きは無い
  for (const j of joints) {
    if (j.bodyA === b) j.anchorAy = -j.anchorAy;
    if (j.bodyB === b) j.anchorBy = -j.anchorBy;
  }
  b._invalidateShape();
}
// 変換のあと片付け。地面へのめり込みを直し、右パネルの角度・速度欄を書き戻す
function _afterTransform() {
  if (!running) resolveGroundEmbedding();
  if (selectedIds.size === 1) {
    const b = objects.find(o => selectedIds.has(o.id));
    if (b) updatePropsPanel(b);
  }
}
// 選択したものを、支点まわりに da だけ回す
function rotateSelectionBy(da) {
  const c = transformCenter();
  if (!c) return;
  pushUndo();
  // 物体（載っているレーザー・波源も付いてくる）と、背景固定のレーザー・波源。
  // ★背景固定ぶんは rotateSelection の中でまとめて回している（ここで重ねて回さない）
  rotateSelection(da, c);
  _afterTransform();
}
// 鏡映。axis='h' ＝ 左右反転（縦の軸で映す）／'v' ＝ 上下反転（横の軸で映す）
function mirrorSelection(axis) {
  const c = transformCenter();
  if (!c) return;
  const h = (axis === 'h');
  pushUndo();
  for (const b of selectedBodies()) {
    if (h) b.x = 2*c.x - b.x; else b.y = 2*c.y - b.y;
    b.angle = h ? Math.PI - b.angle : -b.angle;
    // 速度も鏡像にする。そうしないと動かしている最中に反転したとき、形だけが
    // 裏返って運動がそのまま続き、鏡像になっていない絵になる。
    if (h) b.vx = -b.vx; else b.vy = -b.vy;
    b.av = -b.av;                                 // 角速度は反射で向きが逆になる
    // 運動方向ガイド（レール）はワールド角。向き (cosθ,sinθ) を映した角へ
    if (b.guideEnabled) { b.guideAngle = h ? Math.PI - b.guideAngle : -b.guideAngle; reanchorGuide(b); }
    // 背景側（自由端）のジョイントのアンカーはワールド座標なので同じ軸で映す
    _mapFreeJointAnchors(b, (px, py) => h ? { x: 2*c.x - px, y: py } : { x: px, y: 2*c.y - py });
    _mirrorBodyShapeY(b);
    for (const j of joints)
      if (j.type === 'rope' && (j.bodyA === b || j.bodyB === b)) resetRopeChain(j);
    b._updateAABB();
    b.sleeping = false; b.sleepTimer = 0;
  }
  for (const e of _freeSelectedElems()) {          // 背景固定＝localX/Y はワールド座標
    if (h) e.localX = 2*c.x - e.localX; else e.localY = 2*c.y - e.localY;
    if (e instanceof Laser) e.angle = h ? Math.PI - e.angle : -e.angle;
  }
  _afterTransform();
}
function _dispDeg(a) {
  let d = -a * 180 / Math.PI;
  return ((d + 180) % 360 + 360) % 360 - 180;
}
function updateAngle(v, skipUndo) {
  if (currentTool !== 'pointer' || selectedIds.size === 0) return;
  if (!skipUndo) pushUndo();
  // ★回す決まり（器なら蓋の乗り換え／符号は反時計回りが正）は applyBodyProp に1つだけ
  //   置いてある。ここは「選んでいる物すべてに配る」係で、リモコンのつまみも同じ口を通る。
  for (const b of selectedBodies()) applyBodyProp(b, 'angle', v);
  if (!running) resolveGroundEmbedding();
}
// ═══ 速度の極座標編集（速さ・運動の向き）═══════════════════
//   速さと向きは速度ベクトルの極座標表示。速度X・速度Yと同じものを別の座標で
//   見ているだけなので、片方を変えたらもう片方も追従させる。
//   ★速さ0のときは向きが数学的に定義できない。そこで最後に表示していた向きを
//     覚えておき、速さを与えたときにその向きへ復元する（向きを決めてから速さを
//     与える、という操作ができるようにするため）。
let _velDirDeg = 0;                       // [°] 直近に表示・指定した運動の向き
// ★速さ・運動の向きを操作している最中かどうか。速さ0のときは速度ベクトルの長さも0で
//   何も描けないため、この間だけ「向きだけを示す矢印」を出す（_drawVelDirGhost）。
//   入力欄のフォーカスと、直近の操作からの経過時間で判定する。スライダーのドラッグ・
//   数値入力・矢印キーのどれでも同じように効かせたいので、時刻方式にしている。
let _velEditT = 0;
const VEL_EDIT_HOLD_MS = 700;
function _velEditPing() { _velEditT = performance.now(); }
function velDirEditing() {
  const ae = document.activeElement;
  if (ae && (ae.id === 'p-speed' || ae.id === 'p-vdir')) return true;
  return performance.now() - _velEditT < VEL_EDIT_HOLD_MS;
}
function velDirDegOf(b) {                 // 表示用（上向き正）。静止中は覚えている値
  const vx = b.vx, vy = yUI(b.vy);
  if (Math.hypot(vx, vy) < 1e-9) return _velDirDeg;
  return Math.atan2(vy, vx) * 180 / Math.PI;
}
function updateSpeed(v, skipUndo) {
  if (selectedIds.size === 0) return;
  _velEditPing();
  if (!skipUndo) pushUndo();
  const sp = Math.max(0, parseFloat(v) || 0) * M2PX;       // [px/s]
  const a = _velDirDeg * Math.PI / 180;
  for (const b of selectedBodies()) {
    const cur = Math.hypot(b.vx, b.vy);
    let ux, uy;
    if (cur > 1e-9) { ux = b.vx / cur; uy = b.vy / cur; }  // 向きは保つ
    else { ux = Math.cos(a); uy = yUI(Math.sin(a)); }      // 静止中は覚えている向きへ
    b.vx = ux * sp; b.vy = uy * sp;
    projectGuideVelocity(b, false);                        // ガイド付きはレール方向成分だけ残る
    b.sleeping = false; b.sleepTimer = 0;
  }
  if (skipUndo) refreshVelocityFields(true);               // ドラッグ中は数値欄だけ追従
}
function updateVelDir(v, skipUndo) {
  if (selectedIds.size === 0) return;
  _velEditPing();
  if (!skipUndo) pushUndo();
  _velDirDeg = parseFloat(v) || 0;
  const a = _velDirDeg * Math.PI / 180;
  const ux = Math.cos(a), uy = yUI(Math.sin(a));
  for (const b of selectedBodies()) {
    const sp = Math.hypot(b.vx, b.vy);                     // 速さは保つ
    b.vx = ux * sp; b.vy = uy * sp;
    projectGuideVelocity(b, false);
    b.sleeping = false; b.sleepTimer = 0;
  }
  if (skipUndo) refreshVelocityFields(true);
}
// 速さ・向き・速度X・速度Y の4欄を、実際の速度から書き直す。
//   skipSelf=true のときはスライダー操作中なので、掴んでいる欄も含めて数値だけ更新する。
function refreshVelocityFields() {
  if (selectedIds.size !== 1) return;
  const b = objects.find(o => selectedIds.has(o.id));
  if (!b) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('p-speed', (Math.hypot(b.vx, b.vy) * PX2M).toFixed(2));
  set('p-vx', (b.vx * PX2M).toFixed(2));
  set('p-vy', yUI(b.vy * PX2M).toFixed(2));
  if (Math.hypot(b.vx, b.vy) > 1e-9) _velDirDeg = velDirDegOf(b);
  set('p-vdir', _velDirDeg.toFixed(1));
}
// 「サイズ倍率」欄は廃止した。倍率は状態ではなく操作であり、適用のたびに基準が
// 動くので値の意味が分かりにくい。拡大縮小は選択枠の■ハンドルで行う。
// 点線の枠を出す条件。種類を問わず、何か選んでいれば出す（枠＝選択の範囲を示す印）。
function selectionFrameVisible() {
  return currentTool === 'pointer' && !selRect && !elementDrag && !elementRotate
      && !!selectionExtent();
}
// 変形ハンドル（角＝拡大縮小／上＝回転）を出す条件。
// ★枠と条件を分ける。ハンドルが実際に動かせるのは物体と背景固定のレーザー・波源だけで、
//   粒子や回路だけを選んでいるときに出しても何も起きない（効かない操作は出さない）。
function gizmoVisible() {
  if (!selectionFrameVisible()) return false;
  if (transformSelectionEmpty()) return false;
  // ★ピストン容器の部品には出さない。器の外形は内径と全長から毎回作り直されるので
  //   ハンドルで変えても次の更新で消えるし、蓋だけを縮めると内径と合わなくなって
  //   「漏れているのに漏れない気体」になる（sealed() は横ずれしか見ていない）。
  //   寸法はプロパティの「容器」欄で数値として変える（そちらは気体室にも反映される）。
  for (const id of selectedIds) if (pistonVesselOfBody(id)) return false;
  return true;
}
function gizmoPoints() {
  const a = selectionExtent(); if (!a) return null;   // ★選択したものすべてを囲む
  const p0 = worldToScreen(a.minX, a.minY), p1 = worldToScreen(a.maxX, a.maxY);
  const x0 = Math.min(p0.x,p1.x) - GIZMO_PAD, x1 = Math.max(p0.x,p1.x) + GIZMO_PAD;
  const y0 = Math.min(p0.y,p1.y) - GIZMO_PAD, y1 = Math.max(p0.y,p1.y) + GIZMO_PAD;
  return { x0, y0, x1, y1,
    corners: [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}],
    rot: { x:(x0+x1)/2, y:y0 - GIZMO_ROT } };
}
function beginBoxHandleIfHit(wp) {
  if (!gizmoVisible()) return false;
  const g = gizmoPoints(); if (!g) return false;
  const sp = worldToScreen(wp.x, wp.y);
  const near = p => (sp.x-p.x)*(sp.x-p.x) + (sp.y-p.y)*(sp.y-p.y) <= GIZMO_HIT*GIZMO_HIT;
  if (near(g.rot)) {
    const pv = selectionPivot();
    const a0 = Math.atan2(wp.y-pv.y, wp.x-pv.x);
    boxDrag = { mode:'rotate', pivot: pv, prevAng: a0, base: a0, armed: true };
    return true;
  }
  for (let i = 0; i < 4; i++) {
    if (!near(g.corners[i])) continue;
    const opp = g.corners[(i+2)%4];
    const pv = screenToWorld(opp.x, opp.y);
    const c  = screenToWorld(g.corners[i].x, g.corners[i].y);
    boxDrag = { mode:'scale', pivot: pv, refX: c.x-pv.x, refY: c.y-pv.y, applied: 1, armed: true };
    return true;
  }
  return false;
}
function updateBoxDrag(wp) {
  const d = boxDrag;
  if (d.mode === 'rotate') {
    let ang = Math.atan2(wp.y - d.pivot.y, wp.x - d.pivot.x);
    if (modShift) ang = snapPlacementAngle(ang);
    const da = ang - d.prevAng;
    if (Math.abs(da) < 1e-9) return;
    if (d.armed) { pushUndo(); d.armed = false; }
    d.prevAng = ang;
    rotateSelection(da, d.pivot);
  } else {
    const r2 = d.refX*d.refX + d.refY*d.refY;
    if (r2 < 1e-9) return;
    let s = ((wp.x-d.pivot.x)*d.refX + (wp.y-d.pivot.y)*d.refY) / r2;
    s = Math.max(0.05, Math.min(20, s));
    const ratio = s / d.applied;
    if (!(ratio > 0) || Math.abs(ratio-1) < 1e-6 || !_scaleAllowed(ratio)) return;
    if (d.armed) { pushUndo(); d.armed = false; }
    d.applied = s;
    scaleSelection(ratio, d.pivot);
  }
}
// ════════════════════════════════════════
//  位置揃え・均等配置
//   ★対象は「選択中の物体」＋「範囲選択に入れた背景固定のレーザー・波源」。
//     物体に載った要素は取り付け先と一緒に動くので対象にしない（二重に動いてしまう）。
//   ★レーザー・波源は点なので、上下左右の辺はすべてその点そのものになる。
//     「波源を一直線に等間隔で並べる」＝回折格子・ヤングの実験の配置がこれで一発で作れる。
//   ★基準は「いちばん端の物体の辺」。平均でも選択枠でもなく実在する物体に合わせるので、
//     どれに揃うのかが操作前に画面を見て分かる（中央揃えだけは基準になる辺が無いので
//     選択範囲全体の中心を使う）。
//   ★中心で揃える2つを足してある。物理の量（位置・速度・重力）はすべて重心に対して
//     定義されるので、大きさの違う物体を「同じ高さから落とす」には上辺ではなく
//     中心をそろえる必要がある。辺で揃えると、半径の違う球は重心の高さが変わってしまう。
// ════════════════════════════════════════
function alignTargets() {
  const out = [];
  for (const b of selectedBodies()) out.push({ body: b });
  for (const el of selectedElemList()) out.push({ elem: el });   // 背景固定のレーザー・波源
  return out;
}
function _alignBox(t) {
  if (t.body) { const a = t.body._aabb; return { minX:a.minX, minY:a.minY, maxX:a.maxX, maxY:a.maxY }; }
  const o = t.elem.getOrigin();
  return { minX:o.x, minY:o.y, maxX:o.x, maxY:o.y };            // 点なので4辺が同じ位置
}
// 実際に動かす。物体は固定（溶接・ヒンジ・軸）で繋がった相手も連れていく——ドラッグと
// 同じ規約。連れていかないと、揃えた瞬間に拘束が破れて再生と同時に組み立てが崩れる。
// 自分も選ばれている相手は自分のぶんの移動量を持っているので、ここでは動かさない。
function _alignMove(t, dx, dy, moved) {
  if (!dx && !dy) return;
  if (t.elem) { t.elem.localX += dx; t.elem.localY += dy; return; }   // 背景固定＝localX/Y はワールド座標
  for (const b of rigidlyLinkedBodies(new Set([t.body.id]))) {
    if (b !== t.body && selectedIds.has(b.id)) continue;
    if (moved.has(b)) continue;
    b.x += dx; b.y += dy;
    b._updateAABB();
    reanchorGuide(b);
    b.sleeping = false; b.sleepTimer = 0;
    moved.add(b);
  }
}
// 揃えたあとの後始末。バネ・ロープの長さはドラッグで動かしたときと同じ規則で取り直す
function _alignFinish(moved) {
  const prev = pointerInitialOffsets;
  pointerInitialOffsets = {};
  for (const b of moved) pointerInitialOffsets[b.id] = { x: b.x, y: b.y };
  refitJointLengthsForMovedBodies();          // 片端だけ動いたバネ・ロープの自然長を合わせる
  pointerInitialOffsets = prev;
  if (!running) resolveGroundEmbedding();
}
// mode: top / bottom / left / right / vcenter（上下中央）/ hcenter（左右中央）
function alignSelection(mode) {
  const ts = alignTargets();
  if (ts.length < 2) return;
  pushUndo();
  recordJointDragLengths();
  const boxes = ts.map(_alignBox);
  let line;
  if (mode === 'top')          line = Math.min(...boxes.map(b => b.minY));
  else if (mode === 'bottom')  line = Math.max(...boxes.map(b => b.maxY));
  else if (mode === 'left')    line = Math.min(...boxes.map(b => b.minX));
  else if (mode === 'right')   line = Math.max(...boxes.map(b => b.maxX));
  else if (mode === 'vcenter') line = (Math.min(...boxes.map(b => b.minY)) + Math.max(...boxes.map(b => b.maxY))) / 2;
  else                         line = (Math.min(...boxes.map(b => b.minX)) + Math.max(...boxes.map(b => b.maxX))) / 2;
  const moved = new Set();
  ts.forEach((t, i) => {
    const b = boxes[i];
    if (mode === 'top')          _alignMove(t, 0, line - b.minY, moved);
    else if (mode === 'bottom')  _alignMove(t, 0, line - b.maxY, moved);
    else if (mode === 'left')    _alignMove(t, line - b.minX, 0, moved);
    else if (mode === 'right')   _alignMove(t, line - b.maxX, 0, moved);
    else if (mode === 'vcenter') _alignMove(t, 0, line - (b.minY + b.maxY)/2, moved);
    else                         _alignMove(t, line - (b.minX + b.maxX)/2, 0, moved);
  });
  _alignFinish(moved);
}
// axis: 'x'（横に均等）/ 'y'（縦に均等）
//   両端の2つは動かさず、その間の中心が等間隔になるように内側だけを移動する。
//   ★間隔をそろえるのは「中心」であって「隙間」ではない。大きさの違うものが混じっても
//     位置（＝物理で使う座標）が等差数列になるので、v-t 図や干渉の計算と話が合う。
function distributeSelection(axis) {
  const ts = alignTargets();
  if (ts.length < 3) return;
  pushUndo();
  recordJointDragLengths();
  const c = t => { const b = _alignBox(t); return axis === 'x' ? (b.minX+b.maxX)/2 : (b.minY+b.maxY)/2; };
  const sorted = ts.map(t => ({ t, c: c(t) })).sort((p, q) => p.c - q.c);
  const step = (sorted[sorted.length-1].c - sorted[0].c) / (sorted.length - 1);
  const moved = new Set();
  for (let i = 1; i < sorted.length - 1; i++) {
    const d = sorted[0].c + i*step - sorted[i].c;
    _alignMove(sorted[i].t, axis === 'x' ? d : 0, axis === 'x' ? 0 : d, moved);
  }
  _alignFinish(moved);
}
// 範囲選択したレーザー・波源だけを選んでいるときの枠。
//   物体の選択枠（drawTransformGizmo）と同じ薄い破線にして、「まとめて選んである」ことが
//   ひと目で分かるようにする。回転・拡大の取っ手は付けない：点で表される要素には
//   大きさも向きの中心もなく、掴めても意味のある操作にならないため。
//   ※物体が1つでも選ばれていれば、そちらの枠（gizmo）が要素も含めて出るのでここでは描かない。
// 範囲選択で拾った背景固定のレーザー・波源に印（青い輪）を付ける。
// ★物体と一緒に選んだときも必ず出す。以前はここで点線の枠を描いていて、しかも
//   「レーザー・波源だけを選んでいるとき」（selectedIds.size === 0）に限っていたため、
//   物体と混ざった瞬間に何の印も出なくなっていた。選ばれているのに選ばれていないように
//   見え、まとめて動かして初めて気付く状態だった。枠は選択ぜんぶを囲む
//   drawTransformGizmo に一本化したので、こちらは印だけを受け持つ。
// ★ジョイントとスリンキーの端の印は、それぞれ drawJoint / drawSlinkies が描いている。
function drawSelectedElemMarks() {
  if (currentTool !== 'pointer') return;
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(79,195,247,0.25)';
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 2;
  for (const el of selectedElemList()) {
    const o = el.getOrigin(), s = worldToScreen(o.x, o.y);
    ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
function drawTransformGizmo() {
  if (!selectionFrameVisible()) return;
  const g = gizmoPoints(); if (!g) return;
  ctx.save();
  ctx.setLineDash([4,3]);
  ctx.strokeStyle = 'rgba(79,195,247,0.45)'; ctx.lineWidth = 1;
  ctx.strokeRect(g.x0, g.y0, g.x1-g.x0, g.y1-g.y0);
  ctx.setLineDash([]);
  // ★枠はここまで。ハンドルは効く選択のときだけ足す（gizmoVisible の★を参照）
  if (!gizmoVisible()) { ctx.restore(); return; }
  const rotOn = !!(boxDrag && boxDrag.mode === 'rotate');
  const scOn  = !!(boxDrag && boxDrag.mode === 'scale');
  ctx.strokeStyle = 'rgba(79,195,247,0.6)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo((g.x0+g.x1)/2, g.y0); ctx.lineTo(g.rot.x, g.rot.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(g.rot.x, g.rot.y, 6, 0, Math.PI*2);
  ctx.fillStyle = rotOn ? '#ffd54f' : '#4fc3f7'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  for (const c of g.corners) {
    ctx.beginPath(); ctx.rect(c.x-4, c.y-4, 8, 8);
    ctx.fillStyle = scOn ? '#ffd54f' : '#4fc3f7'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (boxDrag) {
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#ffd54f';
    ctx.fillText(boxDrag.mode === 'rotate'
      ? (-(boxDrag.prevAng - boxDrag.base) * 180/Math.PI).toFixed(1) + '°'
      : '×' + boxDrag.applied.toFixed(2), g.x1 + 8, g.y0 - 6);
  }
  ctx.restore();
}

// 選択中の物体をドロップしたとき、重なった「自由な（背景固定の）ジョイント端」へ接続する
// ＝ジョイント端を物体へ運ぶ finishElementDrag() の逆操作
function attachMovedBodyToJointEnds() {
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (b) _attachBodyToJointEnds(b, null);
  }
}
// 物体1個ぶん。types を渡すとその種類のジョイントだけを対象にする（null＝全部）。
function _attachBodyToJointEnds(b, types) {
  for (const j of joints) {
    if (types && !types.includes(j.type)) continue;
    // A端が自由（背景固定）で、その位置がこの物体の内側に入ったら接続
    if (!j.bodyA && j.bodyB !== b) {
      const wa = j.getWorldAnchorA();          // 背景／地面のアンカーの現在位置
      if (b.containsPoint(wa.x, wa.y)) {
        setJointEnd(j, 'A', b, wa.x, wa.y, false);   // 物体へ移す（地面の取り付けは解除）
        _finishJointAttach(j);
      }
    }
    // B端が自由で、その位置がこの物体の内側に入ったら接続
    if (!j.bodyB && j.bodyA !== b) {
      const wb = j.getWorldAnchorB();
      if (b.containsPoint(wb.x, wb.y)) {
        setJointEnd(j, 'B', b, wb.x, wb.y, false);
        _finishJointAttach(j);
      }
    }
  }
}
// ★描いたばかりの物体が、ばね・ロープ・連結棒・ばね（索）の「自由な端」に重なっていたら接続する。
//   端を物体へドラッグする／物体を端へ運ぶ、のどちらでも繋がるようにしてあったので、
//   「端の上に物体を描く」でも同じ結果になるのが素直（描いてから運び直す手間が要らない）。
//   ★対象はこの3種類だけ。ヒンジ・溶接・モーターの「背景に固定した端」は、そこへ打った杭を
//     動く物体へ付け替えることになり、意図せず土台から外れる事故のほうが大きい。
const NEW_BODY_ATTACH_TYPES = ['spring', 'rope', 'rod'];
function attachNewBodyToEnds(b) {
  if (!b) return;
  _attachBodyToJointEnds(b, NEW_BODY_ATTACH_TYPES);
  for (const S of slinkies) {                       // 索（ばねツール）の端も同じ扱い
    for (const w of ['A', 'B']) {
      const own   = (w === 'A') ? S.bodyA : S.bodyB;
      const other = (w === 'A') ? S.bodyB : S.bodyA;
      if (own || other === b) continue;             // 取り付け済み／両端を同じ物体にはしない
      const n = S.nodes[w === 'A' ? 0 : S.nodes.length - 1];
      if (!b.containsPoint(n.x, n.y)) continue;
      const a = getLocalAnchor(b, n.x, n.y);
      if (w === 'A') { S.bodyA = b; S.anchorAx = a.x; S.anchorAy = a.y; S.endA = 'body'; }
      else           { S.bodyB = b; S.anchorBx = a.x; S.anchorBy = a.y; S.endB = 'body'; }
    }
  }
}
// 物体を動かして離したとき、その物体がばねの端に重なっていたら取り付ける。
//   ★ロープと同じ流儀（端を物体へ落とす／物体を端へ落とす、どちらでも繋がる）。
//   取り付いた端は物体と一緒に運ばれ、振れば波を出し、ばねは物体へ張力を返す。
function attachMovedBodyToSlinkyEnds() {
  if (!slinkies.length) return;
  const moved = [];
  for (const id of selectedIds) { const b = objects.find(o => o.id === id); if (b) moved.push(b); }
  if (!moved.length) return;
  let touched = null;
  for (const S of slinkies) {
    for (const which of ['A', 'B']) {
      const own   = which === 'A' ? S.bodyA : S.bodyB;
      const other = which === 'A' ? S.bodyB : S.bodyA;
      if (own) continue;                                  // すでに取り付いている端は触らない
      const n = S.nodes[which === 'A' ? 0 : S.nodes.length - 1];
      for (const b of moved) {
        if (b === other || !b.containsPoint(n.x, n.y)) continue;   // 両端を同じ物体には付けない
        const a = getLocalAnchor(b, n.x, n.y);
        if (which === 'A') { S.bodyA = b; S.anchorAx = a.x; S.anchorAy = a.y; S.endA = 'body'; }
        else               { S.bodyB = b; S.anchorBx = a.x; S.anchorBy = a.y; S.endB = 'body'; }
        touched = S;
        break;
      }
    }
  }
  if (touched && selectedElement && selectedElement.kind === 'slinky' && selectedElement.slinky === touched)
    updateSlinkyPanel(touched);
}
// ── 編集ツールで物体を動かしたときの、ジョイントの長さの規則 ────────────────
//   規則はただ1つ：「長さは、端点間距離が変わったのと同じだけ変わる」。
//   ウインチで巻き取る／繰り出すのと同じで、物体を遠ざけた分だけ縄が出て、
//   近づけた分だけ巻き取られる。差分で動かすので「たるみ」も「伸び」も保存される。
//     ・ばね … 自然長が動く。相対的な伸び（＝復元力）は保たれるので、
//               ばねを伸ばした初期条件を作ってから装置ごと動かしても壊れない。
//               自然長どおりのばねは自然長どおりのまま＝離しても力が出ない
//     ・ロープ … 上限が動く。たるみ量が保たれるので、たるんだロープを近づけても
//                 たるみが増え続けず、縄そのものが短くなる（伸ばすのと対称）
//     ・棒 … たるみが常に0なので、差分で動かす＝新しい距離そのものになる
//   端点間距離が変わらない場合（両端とも一緒に動いた等）は何もしない。
//   ドラッグ中は jointLengthSuspended() で拘束自体を解いてあるので、ここで
//   長さを合わせると拘束を満たした状態で離せる（＝再生時に引き戻されない）。
const JOINT_MIN_LEN = 4;   // [px] これ以下には縮めない（ロープの節点分割・棒の剛解が破綻するため）
// ドラッグ開始時の端点間距離を控える。長さの変化量はここからの差分で出す。
function recordJointDragLengths() {
  for (const j of joints) {
    if (JOINT_LENGTH_TYPES.indexOf(j.type) < 0) { j._dragDist0 = null; continue; }
    const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
    j._dragDist0 = Math.hypot(wb.x - wa.x, wb.y - wa.y);
    // ★開始時の長さも控える。長さは「開始時＋差分」で決めるので、ドラッグの途中で
    //   何度呼んでも結果が同じ（冪等）になる。以前の「今の長さに差分を足す」書き方は
    //   1ドラッグにつき1回しか呼べず、毎イベント呼ぶと呼んだ回数だけ伸びてしまう。
    j._dragLen0 = (j.type === 'rope') ? j.maxLength : j.restLength;
    // ★縄の刻み（節点間隔）も控える。ここもドラッグ中に何度も呼ばれるので、
    //   retargetRopeLength に固定の刻みを渡さないと節点が増えず間隔だけ伸びる
    //   （理由は rope.js の retargetRopeLength の★）。
    j._dragUnit0 = (j.type === 'rope') ? j._restLen : null;
  }
  // ★左ツールの「ばね」（Slinky）も同じ規則に入れる。以前はジョイントのばねだけが
  //   自然長を合わせ、こちらは伸び縮みしていた（配線の漏れ）。伸ばした初期条件は
  //   「つかむ」で作る（停止中でも引けて、自然長はそのまま残る）。
  for (const S of slinkies) {
    const a = slinkyEndPos(S, 'A'), b = slinkyEndPos(S, 'B');
    S._dragDist0 = Math.hypot(b.x - a.x, b.y - a.y);
    S._dragRest0 = S.restM;
  }
}
// ばねの端の位置（物体に付いていれば取り付け点、固定端は杭、自由端は端の節点）。
//   ★物体の端は節点ではなく取り付け点で測る。停止中は節点の追随が遅れるので、
//     節点で測ると動かした量が差分に入りきらない。
function slinkyEndPos(S, end) {
  const mode = end === 'A' ? S.endA : S.endB;
  if (mode === 'body') { const p = S._anchorWorld(end); if (p) return p; }
  if (mode === 'pin') return end === 'A' ? { x: S.pinAx, y: S.pinAy } : { x: S.pinBx, y: S.pinBy };
  return slinkyEndNode(S, end);
}
function refitJointLengthsForMovedBodies() {
  for (const j of joints) {
    if (JOINT_LENGTH_TYPES.indexOf(j.type) < 0 || j._dragDist0 == null) continue;
    // ★「動いた」の判定は選択中ではなく実際に動かした一団で見る。固定などで連れられた
    //   物体も動いているので、そちらに繋がったバネ・ロープも長さを取り直す必要がある。
    const moved = pointerInitialOffsets || {};
    // ★範囲選択で直接つまんだ端も「動いた」に数える。物体に付いていない端はここでしか
    //   動かないので、入れないと片端だけ動かしても長さが合わない（＝縄が張り詰める）。
    const be = (pointerMoveStart && pointerMoveStart.jointEnds) || [];
    const movedA = !!(j.bodyA && moved[j.bodyA.id]) || be.some(a => a.j === j && a.end === 'A');
    const movedB = !!(j.bodyB && moved[j.bodyB.id]) || be.some(a => a.j === j && a.end === 'B');
    if (movedA === movedB) continue;        // 両端とも動いた／どちらも動いていない＝距離は不変
    const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
    const dist = Math.hypot(wb.x - wa.x, wb.y - wa.y);
    const delta = dist - j._dragDist0;
    if (Math.abs(delta) < 1e-6) continue;
    // ★長さは「ドラッグ開始時の長さ＋端点間距離の変化」。今の長さに足していく形に
    //   すると、ドラッグ中に何度も呼べない（呼んだ回数だけ伸びる）。
    const base = j._dragLen0 != null ? j._dragLen0
                                     : (j.type === 'rope' ? j.maxLength : j.restLength);
    const L = Math.max(base + delta, JOINT_MIN_LEN);
    if (j.type === 'rope') {
      // たるみ量を保ったまま増減する。
      // ★ここで「現在の距離を下回らせない」clamp を入れてはいけない。ロープは上限の
      //   拘束なので、張った状態では必ず slop(1.5px) ぶん伸びた距離で釣り合っている。
      //   その距離を長さとして焼き込むと、おもりを1pxつまんで離すたびに 1px+1.5px
      //   長くなり、選択のたびにロープが伸び続ける。距離が上限を少し超えているのは
      //   正常な状態で、次のtickでソルバが引き戻す。
      if (Math.abs(L - j.maxLength) < 1e-6) continue;
      j.maxLength = L;
      // ★節点は捨てない。動かした端で縄を出し入れして、今の形（たるみ）を残す
      retargetRopeLength(j, movedA ? 'A' : 'B', j._dragUnit0);
      _finishJointAttach(j, true);
    } else {
      if (Math.abs(L - j.restLength) < 1e-6) continue;
      j.restLength = L;
      _finishJointAttach(j);
    }
  }
  // ── ばね（Slinky）：自然長を同じ規則で動かす ──
  const moved = pointerInitialOffsets || {};
  const se = (pointerMoveStart && pointerMoveStart.slinkyEnds) || [];
  for (const S of slinkies) {
    if (S._dragDist0 == null) continue;
    const movedA = !!(S.endA === 'body' && S.bodyA && moved[S.bodyA.id]) || se.some(a => a.S === S && a.end === 'A');
    const movedB = !!(S.endB === 'body' && S.bodyB && moved[S.bodyB.id]) || se.some(a => a.S === S && a.end === 'B');
    if (movedA === movedB) continue;
    if (refitSlinkyRest(S, S._dragDist0, S._dragRest0) &&
        selectedElement && selectedElement.kind === 'slinky' && selectedElement.slinky === S) updateSlinkyPanel(S);
  }
}
// ばねの自然長を「開始時の自然長＋端点間距離の変化」に合わせる（冪等）。変えたら true。
//   物体を動かしたとき（上）と、ばねの端を直につまんで動かしたとき（selection.js）の共用。
function refitSlinkyRest(S, dist0, rest0) {
  const a = slinkyEndPos(S, 'A'), b = slinkyEndPos(S, 'B');
  const delta = (Math.hypot(b.x - a.x, b.y - a.y) - dist0) * PX2M;   // [m]
  // ★ばね定数 k [N/m] を保つ（パネルで自然長を変えたときと同じく EA＝k×自然長 で持ち直す）。
  //   本物のばねは切れば硬くなるが、置き直しただけで設定した値が変わると困る。
  //   線密度は保つので、ばね全体の質量は長さに比例して変わる（これもパネルと同じ）。
  const L = Math.max(rest0 + delta, JOINT_MIN_LEN * PX2M);
  if (Math.abs(L - S.restM) < 1e-9) return false;
  const k = S.springK();
  S.restM = L;
  _setSlinkyK(S, k);
  S.rebuild();
  return true;
}
// 接続後の後始末（溶接の基準角の取り直し・ロープチェーンの再構築・スリープ解除）
//   keepRopeShape … 長さだけを変えた場合に true。呼び出し側が retargetRopeLength /
//     resampleRopeNodes で形を保ったまま作り直し済みなので、ここで捨ててはいけない。
//     捨てると次のtickで ensureRopeNodes が直線で作り直し、たるみが消える。
//     繋ぎ替え（端を別の物体へ付け替えた）ときは形を保つ意味がないので false のまま。
function _finishJointAttach(j, keepRopeShape) {
  // ★ヒンジ・モーターも取り直す（可動域の 0 は取り付けたときの姿勢。joint.js の angleLimit の★）
  if (j.type === 'fixjoint' || j.type === 'hinge' || j.type === 'axle')
    j.refAngle = (j.bodyB ? j.bodyB.angle : 0) - (j.bodyA ? j.bodyA.angle : 0);
  if (j.type === 'axle' || j.type === 'fixjoint') j.motorImpulse = 0;
  if (j.type === 'rope' && !keepRopeShape) { j.nodes = null; j._wrapPts = null; j._calmT = 0; j._anchorCalmT = 0; j._pwa = j._pwb = null; }
  _wake(j.bodyA); _wake(j.bodyB);
}
// 選択中の要素マーカーを強調表示（対象が消えていたら選択解除）
function drawSelectedElement() {
  if (!selectedElement) return;
  if (selectedElement.kind === 'ground') { drawGroundSelection(); return; }  // 地面はハイライトのみ（状態は変更しない）
  if (selectedElement.kind === 'laser' && !lasers.includes(selectedElement.laser)) { selectedElement = null; return; }
  if (selectedElement.kind === 'wave' && !waveSources.includes(selectedElement.source)) { selectedElement = null; return; }
  // ★スリンキーは選択枠を drawSlinkies が描くのでマーカーは出さない（索は点ではないため）
  if (selectedElement.kind === 'slinky') {
    if (!slinkies.includes(selectedElement.slinky)) selectedElement = null;
    return;
  }
  if (selectedElement.kind === 'joint' && !joints.includes(selectedElement.joint)) { selectedElement = null; return; }   // ★
  if (selectedElement.kind === 'emfield') {   // ★領域は枠を drawEMFields が描くのでマーカーは出さない
    if (!emFields.includes(selectedElement.field)) selectedElement = null;
    return;
  }
  if (selectedElement.kind === 'heatfield') {  // ★同上（枠は drawHeatFields が描く）
    if (!heatFields.includes(selectedElement.field)) selectedElement = null;
    return;
  }
  if (selectedElement.kind === 'flowfield') {  // ★同上（枠は drawFlowFields が描く）
    if (!flowFields.includes(selectedElement.field)) selectedElement = null;
    return;
  }
  // ★気体も領域なのでマーカーは出さない。枠を drawGasChambers が明るくするうえ、
  //   丸印の位置（器の中心）は気体そのものを指していないので、かえって誤読を招く。
  if (selectedElement.kind === 'gas') {
    if (!gasChambers.includes(selectedElement.chamber)) selectedElement = null;
    return;
  }
  // ★粒子は群れなので代表1つに丸印を出しても意味がない。印は drawParticleSelection が
  //   選択ぜんぶに描く（ここで抜けないと、代表を el.body として読もうとして落ちる）。
  if (selectedElement.kind === 'particle') {
    if (!particles.includes(selectedElement.particle)) selectedElement = null;
    return;
  }
  if ((selectedElement.kind === 'thruster' || selectedElement.kind === 'tracer' || selectedElement.kind === 'arcoat')
      && !objects.includes(selectedElement.body)) { selectedElement = null; return; }
  // ★動力は1本ずつ外せる。外された1本を掴んだままだと力点の位置が出せない
  //   （コートと同じ形の事故。物体はまだ居るので上の門番では落とせない）。
  if (selectedElement.kind === 'thruster'
      && !selectedElement.body.thrusters.includes(selectedElement.thr))
    { selectedElement = null; return; }
  // ★コートは外されると添字が繰り上がる。消えた添字を掴んだままだと端の位置が出せない。
  if (selectedElement.kind === 'arcoat'
      && !(selectedElement.body.arCoats && selectedElement.body.arCoats[selectedElement.index]))
    { selectedElement = null; return; }
  const w = elementWorldPos(selectedElement);   // ★全種類を共通化（ジョイント端も含む）
  const sp = worldToScreen(w.x, w.y);
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(sp.x, sp.y, 9, 0, Math.PI*2);
  ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  drawDirHandle(selectedElement, sp);   // ★向きハンドル（レーザー／動力のみ）
}
// 向きハンドル：原点から現在の向きへ矢印を伸ばし、先端に○を描く
function drawDirHandle(el, sp) {
  if (!elementHasDir(el)) return;
  const hp = elementDirHandlePos(el);
  const sh = worldToScreen(hp.x, hp.y);
  const active = !!(elementRotate && elementRotate.el === el);
  ctx.save();
  ctx.setLineDash([]);
  drawArrow(ctx, sp.x, sp.y, sh.x, sh.y, 'rgba(0,0,0,0.55)', 4);
  drawArrow(ctx, sp.x, sp.y, sh.x, sh.y, active ? '#ffd54f' : '#4fc3f7', 1.5);
  ctx.beginPath(); ctx.arc(sh.x, sh.y, 6, 0, Math.PI*2);
  ctx.fillStyle = active ? '#ffd54f' : '#4fc3f7';
  ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  if (active) {                                   // 表示は右向き0°・上向き正（速度ツールと同じ規約）
    let deg = -elementWorldAngle(el) * 180 / Math.PI;
    deg = ((deg + 180) % 360 + 360) % 360 - 180;
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(deg.toFixed(1) + '°', sh.x + 10, sh.y - 8);
  }
  ctx.restore();
}
// ─── 要素プロパティパネル ───
