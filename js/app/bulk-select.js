// ════════════════════════════════════════
//  種別ごとの一括選択・一括編集
//   範囲選択の枠の中には、ふつう複数の種別（物体・レーザー・ジョイント…）が混ざる。
//   ところが選択状態は種別ごとに別々の変数で持っている（selectedIds ／ selectedElement ／
//   selectedJointId ／ selectedCircuit）ので、混ざったまま1つの選択として扱うことはできない。
//   そこで「枠の中から1種別だけを取り出して選ぶ」という形にする。
//
//   選んだあとの動きは二段構え：
//     ・代表（＝オブジェタブの一番上にあるもの）を、従来どおりの単一選択として右パネルに出す
//     ・代表への変更を、同じ種別で選ばれている仲間へそのまま流す（＝まとめて設定）
//   こうすると、描画・パネル・右クリックの分岐（単一選択を前提に書かれている）に
//   手を入れずに済む。物体だけは selectedIds がもともと複数を持てるので、そちらを使う。
// ════════════════════════════════════════
const _inSelRect = (r, x, y) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
// 軌跡のマーカー位置（物体に取り付いているので、物体の角度で回る）
const _markerPos = (kind, b) => elementWorldPos({ kind, body: b });
// 一括選択に入っている1つが占める世界座標の点。点線の枠で囲むために使う。
// ★drawBulkSelectionMarks が印を描くのと同じ形をそのまま点にしたもの。片方だけ種別を
//   足すと「印は付いているのに点線の枠からはみ出す」ことになるので、必ず両方を見る。
function bulkObjPoints(kind, o) {
  switch (kind) {
    case 'emfield': case 'heatfield': case 'flowfield':   // どれも軸に沿った矩形
      return [{ x: o.x - o.w/2, y: o.y - o.h/2 }, { x: o.x + o.w/2, y: o.y + o.h/2 }];
    case 'circuit':                             // 線分（両端）
      return [{ x: o.ax, y: o.ay }, { x: o.bx, y: o.by }];
    case 'joint':    return [o.getWorldAnchorA(), o.getWorldAnchorB()];
    case 'slinky':   return o.nodes;            // 索は直線ではないので節点ぜんぶ
    case 'gas':      return o.corners();
    case 'laser': case 'wave':      return [o.getOrigin()];
    case 'thruster': return [o.worldPos()];
    case 'tracer':   return [_markerPos(kind, o)];
    case 'particle': return [{ x: o.x, y: o.y }];
    case 'body':     return [{ x: o._aabb.minX, y: o._aabb.minY },
                             { x: o._aabb.maxX, y: o._aabb.maxY }];
    default:         return [];                 // 端（jointend/slinkyend）は専用の入れ物で数える
  }
}
// 種別ごとの取り扱い。並び順と見出しはオブジェタブ（updateSceneList）と揃える。
//   all()    … その種別のもの全部。配列の先頭がオブジェタブの一番上＝代表になる
//   inRect() … 範囲選択の枠に入っているか
//   subOf()  … さらに細かい型。ジョイントなら ヒンジ／溶接／ばね…、場なら 電場／磁場、
//              回路なら 抵抗／電池… と分かれる。ここまで分けるのは、型が違うと同じ入力欄が
//              別の意味を持つからで、「ヒンジのみ選択」「電場のみ選択」と細かく選べる。
//              一括編集の対象も同じ型のものだけに限られる（ばねの値がロープへ飛ばない）。
//   subLabel() … その型の表示名
//   select() … その一覧を選択状態にする（代表＝list[0]）
//   remove() … 削除（まとめて消すときに使う）
const BULK_KINDS = {
  body: {
    label: '物体',
    all: () => objects,
    inRect: (b, r) => _inSelRect(r, b.x, b.y),
    // ★形ごとに別の型にする（円・四角・多角形）。光学素子と導体棒は作る道具も設定の意味も
    //   違うので、形ではなく素子の種類で分ける。物体は _setBulk を通らない（selectedIds で
    //   配る）ので、ここは「◯◯のみ選択」「同じ種類を選択」の単位を決めるだけ。
    subOf: b => b.opticKind || (b.conductor ? 'conductor' : b.type),
    subLabel: b => b.opticKind ? (OPTIC_KIND_NAMES[b.opticKind] || '光学素子')
                 : b.conductor ? '導体棒'
                 : ({ circle:'円', box:'四角', polygon:'多角形' }[b.type] || '物体'),
    select: list => {
      clearAllSelections();
      for (const b of list) selectedIds.add(b.id);
      updatePropsPanel(list[0]);       // 代表の値を出す。変更は updateProp が selectedIds 全員へ流す
    },
    remove: b => {
      const i = objects.indexOf(b);
      if (i >= 0) objects.splice(i, 1);
      joints = joints.filter(j => j.bodyA !== b && j.bodyB !== b);
      lasers = lasers.filter(L => L.body !== b);
    },
  },
  // ★動力は物体ではなく**動力そのもの**を数える（1つの物体に何個でも付くので、
  //   物体を単位にすると2本目以降が選べない）。
  thruster: {
    label: '動力',
    all: () => allThrusters(),
    inRect: (th, r) => { const p = th.worldPos(); return _inSelRect(r, p.x, p.y); },
    select: list => {
      clearAllSelections();
      _setBulk('thruster', list);
      selectedElement = { kind: 'thruster', body: list[0].body, thr: list[0] };
      updateThrusterPanel(list[0]);
    },
    remove: th => { if (th.body) { removeThruster(th.body, th); _wake(th.body); } },
  },
  tracer: {
    label: '軌跡',
    all: () => objects.filter(b => b.tracerEnabled),
    inRect: (b, r) => { const p = _markerPos('tracer', b); return _inSelRect(r, p.x, p.y); },
    select: list => {
      clearAllSelections();
      _setBulk('tracer', list);
      selectedElement = { kind: 'tracer', body: list[0] };
      updateTracerPanel(list[0]);
    },
    remove: b => { b.tracerEnabled = false; b.tracePoints = []; },
  },
  joint: {
    label: 'ジョイント',
    all: () => joints,
    // 両端とも枠内のときだけ選ぶ。片端が外にあるものまで拾うと、まとめて動かしたときに
    // 枠の外の物体を引きずる（ばね・ロープは伸びるのが自然なので、そこは触らない）
    inRect: (j, r) => {
      const a = j.getWorldAnchorA(), b = j.getWorldAnchorB();
      return _inSelRect(r, a.x, a.y) && _inSelRect(r, b.x, b.y);
    },
    subOf: j => j.type,
    subLabel: j => JOINT_TYPE_LABELS[j.type] || j.type,
    select: list => {
      clearAllSelections();
      _setBulk('joint', list);
      selectedJointId = list[0].id;
      updateJointPanel(list[0]);
    },
    // ★removeJointAt を通す。ロープの先端おもりも一緒に消える（起こす処理も中でやる）
    remove: j => removeJoint(j),
  },
  // ばね・ロープ・棒の「端」。ジョイント本体（上の joint）とは別種別にする。
  //   ジョイントは両端とも枠内のときだけ拾うので、片端だけを囲んだ場合は上では選べない。
  //   端は端で選べたほうがよい：片端だけ動かす（＝伸ばす）操作と、両端を動かす（＝平行移動）
  //   操作は意味が違い、選び分けたいのが普通のため。
  //   ★物体に付いた端は対象外。取り付け先と一緒に動くので、選ぶと二重に動く
  //     （範囲選択で拾わないのと同じ理由。selection.js の addJointEndsInRect の★を参照）。
  jointend: {
    label: '端',
    all: () => {
      const out = [];
      for (const j of joints) {
        if (JOINT_LENGTH_TYPES.indexOf(j.type) < 0) continue;
        if (!j.bodyA) out.push({ id: j.id * 2,     j, end: 'A' });
        if (!j.bodyB) out.push({ id: j.id * 2 + 1, j, end: 'B' });
      }
      return out;
    },
    inRect: (o, r) => {
      const w = (o.end === 'A') ? o.j.getWorldAnchorA() : o.j.getWorldAnchorB();
      return _inSelRect(r, w.x, w.y);
    },
    subOf: o => o.j.type,
    subLabel: o => (JOINT_TYPE_LABELS[o.j.type] || o.j.type) + 'の端',
    select: list => {
      clearAllSelections();
      for (const o of list) selectedJointEnds.add(jointEndKey(o.j, o.end));
      // 端そのものに設定値は無いので、右パネルは持ち主のジョイントを出す。
      // ★_setBulk は呼ばない。値を配る仕組み（bulkPeers）は「同じ入力欄を持つもの同士」が
      //   前提で、端はそれに当たらない。まとめて操作はメニュー側（bulkJointEndOp）が
      //   selectedJointEnds を直接見て行う。
      const rep = list[0];
      selectedJointId = rep.j.id;
      selectedElement = { kind: 'joint', joint: rep.j, end: rep.end };
      updateJointPanel(rep.j);
    },
    remove: () => {},          // 端だけを消すことはできない（消すならジョイントごと＝上の joint）
  },
  laser: {
    label: 'レーザー',
    all: () => lasers,
    inRect: (L, r) => { const o = L.getOrigin(); return _inSelRect(r, o.x, o.y); },
    select: list => {
      clearAllSelections();
      _setBulk('laser', list);
      // 平行移動できるのは背景固定のものだけ（物体に付いたものは取り付け先と一緒に動くので、
      // ここに入れると二重に動いてしまう）。値の一括設定は取り付け済みのものにも効く。
      selectedElemIds = new Set(list.filter(L => !L.body).map(L => L.id));
      selectedElement = { kind: 'laser', laser: list[0] };
      updateLaserPanel(list[0]);
    },
    remove: L => { const i = lasers.indexOf(L); if (i >= 0) lasers.splice(i, 1); },
  },
  wave: {
    label: '波源',
    all: () => waveSources,
    inRect: (S, r) => { const o = S.getOrigin(); return _inSelRect(r, o.x, o.y); },
    select: list => {
      clearAllSelections();
      _setBulk('wave', list);
      selectedElemIds = new Set(list.filter(S => !S.body).map(S => S.id));
      selectedElement = { kind: 'wave', source: list[0] };
      updateWavePanel(list[0]);
    },
    remove: S => { const i = waveSources.indexOf(S); if (i >= 0) waveSources.splice(i, 1); },
  },
  // ばね本体。両端とも枠内のときだけ選ぶ（ジョイントと同じ規則）。
  //   片端が外にあるものまで拾うと、まとめて動かしたときに枠の外を引きずる。
  slinky: {
    label: 'ばね',
    all: () => slinkies,
    inRect: (S, r) => {
      const nd = S.nodes;
      return _inSelRect(r, nd[0].x, nd[0].y) && _inSelRect(r, nd[nd.length-1].x, nd[nd.length-1].y);
    },
    select: list => {
      clearAllSelections();
      _setBulk('slinky', list);
      selectedElement = { kind: 'slinky', slinky: list[0] };
      updateSlinkyPanel(list[0]);
    },
    remove: S => removeSlinky(S),   // 先端おもりも一緒に消す
  },
  // スリンキーの「端」。本体とは別種別にするのはジョイントの端と同じ理由で、
  //   片端だけ動かす（＝引き伸ばす）操作と、両端を動かす（＝平行移動）操作は意味が違う。
  //   ★物体に取り付いた端は対象外。取り付け先と一緒に動くので、選ぶと二重に動く。
  slinkyend: {
    label: 'ばねの端',
    all: () => {
      const out = [];
      for (const S of slinkies) {
        if (slinkyEndFree(S, 'A')) out.push({ id: 'S' + S.id + 'A', S, end: 'A' });
        if (slinkyEndFree(S, 'B')) out.push({ id: 'S' + S.id + 'B', S, end: 'B' });
      }
      return out;
    },
    inRect: (o, r) => { const n = slinkyEndNode(o.S, o.end); return _inSelRect(r, n.x, n.y); },
    select: list => {
      clearAllSelections();
      for (const o of list) selectedSlinkyEnds.add(slinkyEndKey(o.S, o.end));
      // 端そのものに設定値は無いので、右パネルは持ち主の索を出す（端は _setBulk に乗せない）
      const rep = list[0];
      selectedElement = { kind: 'slinky', slinky: rep.S, end: rep.end };
      updateSlinkyPanel(rep.S);
    },
    remove: () => {},          // 端だけを消すことはできない（消すなら索ごと＝上の slinky）
  },
  // ── 閉じ込めた気体 ───────────────────────────────────────────────
  //   ★これが無いと、圧縮しきって領域が数pxまで薄くなった気体を選ぶ手段が無くなる
  //     （クリックで狙えるのは太いときだけ）。いちばん気体を触りたい状態のときに
  //     いちばん選びにくい、という穴を塞ぐのがこの経路。
  //   ★remove は容器ごと。気体だけを抜いた「空の器」という状態をモデルが持って
  //     いない（真空にすると大気圧が蓋を閉端まで潰すだけになる）。
  gas: {
    label: '気体',
    all: () => gasChambers,
    // 代表点は気体の領域の中心。閉端（cx,cy）だと器の底に張り付いていて、
    // 枠で気体を囲んだつもりでも入らないことがある
    inRect: (ch, r) => {
      const a = ch.axis(), h = Math.max(ch.heightPx(), 0) / 2;
      return _inSelRect(r, ch.cx + a.x*h, ch.cy + a.y*h);
    },
    select: list => {
      clearAllSelections();
      _setBulk('gas', list);
      selectedElement = { kind: 'gas', chamber: list[0] };
      updateGasPanel(list[0]);
    },
    remove: ch => { const v = pistonVesselOfChamber(ch.id); if (v) deletePistonVessel(v); },
  },
  emfield: {
    label: '電場・磁場',
    all: () => emFields,
    inRect: (f, r) => _inSelRect(r, f.x, f.y),
    subOf: f => f.kind,                         // 電場[V/m]と磁場[T]は別物
    subLabel: f => f.kind === 'E' ? '電場' : '磁場',
    select: list => {
      clearAllSelections();
      _setBulk('emfield', list);
      selectedElement = { kind: 'emfield', field: list[0] };
      updateEMFieldPanel(list[0]);
    },
    remove: f => { const i = emFields.indexOf(f); if (i >= 0) emFields.splice(i, 1); },
  },
  heatfield: {
    label: '加熱・冷却',
    all: () => heatFields,
    inRect: (f, r) => _inSelRect(r, f.x, f.y),
    subOf: f => f.kind,                         // 加熱と冷却は別物（出力をまとめて配るときに混ぜない）
    subLabel: f => f.kindName(),
    select: list => {
      clearAllSelections();
      _setBulk('heatfield', list);
      selectedElement = { kind: 'heatfield', field: list[0] };
      updateHeatFieldPanel(list[0]);
    },
    remove: f => { const i = heatFields.indexOf(f); if (i >= 0) heatFields.splice(i, 1); },
  },
  flowfield: {
    label: '流れの場',
    all: () => flowFields,
    inRect: (f, r) => _inSelRect(r, f.x, f.y),
    select: list => {
      clearAllSelections();
      _setBulk('flowfield', list);
      selectedElement = { kind: 'flowfield', field: list[0] };
      updateFlowFieldPanel(list[0]);
    },
    remove: f => { const i = flowFields.indexOf(f); if (i >= 0) flowFields.splice(i, 1); },
  },
  circuit: {
    label: '回路',
    // 両端とも枠内のものだけ。枠をまたぐ導線まで選ぶと、動かしたときに回路が切れる
    all: () => circuitElements,
    inRect: (e, r) => _inSelRect(r, e.ax, e.ay) && _inSelRect(r, e.bx, e.by),
    subOf: e => e.type,
    subLabel: e => CIRCUIT_LABELS[e.type] || e.type,
    select: list => {
      clearAllSelections();
      _setBulk('circuit', list);
      selectedCircuit = list[0];
      updateCircuitPanel(list[0]);
    },
    remove: e => { const i = circuitElements.indexOf(e); if (i >= 0) circuitElements.splice(i, 1); },
  },
  // ── 粒子（液体・気体）──────────────────────────────────────────
  //   ★ほかの種別と違って「代表1つを右パネルに出す」に意味がない。粒子は個体に用が
  //     あるのではなく、群れとして扱いたいものだから。代表は仕組み（bulkRep・削除の
  //     門番）を満たすためだけに置き、パネルは選択ぜんぶの個数と平均温度を出す。
  //   ★subOf に type を返すだけで「液体のみ選択」「気体のみ選択」が手に入る
  //     （ヒンジのみ・電場のみと同じ仕組み）。
  particle: {
    label: '粒子',
    all: () => particles,
    inRect: (p, r) => _inSelRect(r, p.x, p.y),
    subOf: p => p.type,
    subLabel: p => p.type === 'gas' ? '気体' : '液体',
    select: list => {
      clearAllSelections();
      _setBulk('particle', list);
      selectedElement = { kind: 'particle', particle: list[0] };
      updateParticlePanel();
    },
    remove: p => { const i = particles.indexOf(p); if (i >= 0) particles.splice(i, 1); },
  },
};
// いま選ばれている粒子（順序は particles の並びのまま）
function selectedParticles() {
  if (bulkKind !== 'particle') return [];
  return particles.filter(p => bulkIds.has(p.id));
}
const BULK_ORDER = ['body','thruster','tracer','joint','jointend','laser','wave',
                    'slinky','slinkyend','gas','emfield','heatfield','flowfield','circuit','particle'];
// 型を持たない種別は subOf/subLabel を省いてよい（null＝1種類しかない）
function _subOf(g, o)    { return g.subOf ? g.subOf(o) : null; }
function _subLabel(g, o) { return g.subLabel ? g.subLabel(o) : g.label; }
function _setBulk(kind, list) {
  bulkKind = kind;
  bulkSub  = _subOf(BULK_KINDS[kind], list[0]);
  bulkIds  = new Set(list.map(o => o.id));
}
function clearBulkSelection() { bulkKind = null; bulkSub = null; bulkIds.clear(); }
// いま右パネルに出ている「代表」。種別ごとに置き場所が違うので、ここで吸収する
function bulkRep(kind) {
  if (kind === 'body')    return objects.find(o => selectedIds.has(o.id)) || null;
  if (kind === 'joint')   return joints.find(j => j.id === selectedJointId) || null;
  if (kind === 'circuit') return selectedCircuit || null;
  if (!selectedElement || selectedElement.kind !== kind) return null;
  if (kind === 'particle') {
    // ★代表は「まだ生きている粒子」でなければならない。削除のあと配列から消えた
    //   粒子を指したままだと、次の削除が門番（bulkIds.has(rep.id)）で弾かれる。
    const rep = selectedElement.particle;
    return (rep && particles.includes(rep)) ? rep : (selectedParticles()[0] || null);
  }
  return kind === 'laser'   ? selectedElement.laser
       : kind === 'wave'    ? selectedElement.source
       : kind === 'slinky'  ? selectedElement.slinky
       : kind === 'emfield' ? selectedElement.field
       : kind === 'heatfield' ? selectedElement.field
       : kind === 'flowfield' ? selectedElement.field
       : kind === 'gas'     ? selectedElement.chamber
       : kind === 'thruster' ? selectedElement.thr
       : selectedElement.body;        // tracer
}
// 一括編集の対象（代表を除く仲間）。
//   代表がいま選ばれているものと食い違っていたら空を返す。選び直したあとに古い選択へ
//   値が飛ぶのを防ぐ安全弁で、選択を消し忘れた経路があっても事故にならない。
// ★範囲選択（selectedElemIds）で選んだレーザー・波源も「仲間」として扱う。
//   物体は selectedIds に複数入るので updateProp がそのまま全員へ配れるが、
//   レーザー・波源は「代表1つ（selectedElement）＋ID集合」という持ち方なので、
//   ここで拾わないと範囲選択したぶんに値が行き渡らない（＝平行移動しかできなかった）。
function _elemBoxPeers(kind, rep) {
  if ((kind !== 'laser' && kind !== 'wave') || !rep || !selectedElemIds.has(rep.id)) return [];
  return BULK_KINDS[kind].all().filter(o => o !== rep && selectedElemIds.has(o.id));
}
function bulkPeers(kind, rep) {
  const g = BULK_KINDS[kind];
  if (!g || !rep) return [];
  // 型は選んだ時点のもの（bulkSub）で見る。選んだ後に型を変えたものは、同じ入力欄でも
  // 意味が違うので外す（ばねの値がロープへ飛ばない）。代表の型が変わったときも同じ。
  if (bulkKind === kind && bulkIds.size >= 2 && bulkIds.has(rep.id) && _subOf(g, rep) === bulkSub)
    return g.all().filter(o => o !== rep && bulkIds.has(o.id) && _subOf(g, o) === bulkSub);
  return _elemBoxPeers(kind, rep);
}
// 代表に加えた変更を仲間へ流す。fn には「代表に対して行ったのと同じ代入」を書く。
// 値は代表から取る（クランプや導出を済ませた後の実効値が、そのまま全員に入る）。
function applyToBulk(kind, rep, fn) {
  for (const o of bulkPeers(kind, rep)) fn(o);
}
// この個体が種別一括選択に入っているか（描画のハイライト用）
function isBulkSelected(kind, o) {
  return bulkKind === kind && !!o && bulkIds.has(o.id);
}
// 一括選択に入っているものへ選択中の印を付ける。
//   ジョイントの太線・回路の強調・レーザー／波源の枠印は、それぞれの描画側が
//   もともと持っているので、ここで扱うのは印を持たないもの
//   （場の領域・弦・動力・軌跡と、物体に取り付いていて枠印の対象外になるレーザー・波源）。
function drawBulkSelectionMarks() {
  if (!bulkKind || bulkIds.size < 2) return;
  const ring = (wx, wy) => {
    const s = worldToScreen(wx, wy);
    ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, Math.PI*2); ctx.stroke();
  };
  ctx.save();
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  for (const o of BULK_KINDS[bulkKind].all()) {
    if (!bulkIds.has(o.id)) continue;
    if (bulkKind === 'emfield' || bulkKind === 'heatfield' || bulkKind === 'flowfield') {   // どれも軸に沿った矩形
      const a = worldToScreen(o.x - o.w/2, o.y - o.h/2), b = worldToScreen(o.x + o.w/2, o.y + o.h/2);
      ctx.strokeRect(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.abs(b.x-a.x), Math.abs(b.y-a.y));
    } else if (bulkKind === 'slinky') {
      ctx.beginPath();                       // 索の形に沿ってなぞる（直線ではないので折れ線で）
      for (let i = 0; i < o.nodes.length; i++) {
        const p = worldToScreen(o.nodes[i].x, o.nodes[i].y);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.stroke();
    } else if (bulkKind === 'gas') {
      ctx.beginPath();                       // 気体の領域そのものをなぞる（薄くても線は見える）
      o.corners().forEach((c, i) => {
        const p = worldToScreen(c.x, c.y);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      });
      ctx.closePath(); ctx.stroke();
    } else if (bulkKind === 'thruster') {
      const p = o.worldPos();
      ring(p.x, p.y);
    } else if (bulkKind === 'tracer') {
      const p = _markerPos(bulkKind, o);
      ring(p.x, p.y);
    } else if (bulkKind === 'laser' || bulkKind === 'wave') {
      if (!o.body) continue;                 // 背景固定のものは selectedElemIds の枠印が付いている
      const p = o.getOrigin();
      ring(p.x, p.y);
    }
  }
  ctx.restore();
}
// 右クリックした先が、いま一括選択に入っているものか。
//   入っているなら選択を壊してはいけない（範囲選択→枠の中で右クリック、という手順で
//   選択が単体に落ちてしまうと、そこから「まとめて削除」も値の一括設定もできなくなる）。
function bulkContains(kind, obj) {
  return !!obj && bulkKind === kind && bulkIds.size > 1 && bulkIds.has(obj.id);
}
function bulkContainsElement(el) {
  if (!el) return false;
  const o = el.kind === 'laser'   ? el.laser
          : el.kind === 'wave'    ? el.source
          : el.kind === 'slinky'  ? el.slinky
          : el.kind === 'joint'   ? el.joint
          : el.kind === 'emfield' ? el.field
          : el.kind === 'heatfield' ? el.field
          : el.kind === 'flowfield' ? el.field
          : el.kind === 'gas'     ? el.chamber
          : el.kind === 'thruster' ? el.thr
          : el.body;                          // tracer
  return bulkContains(el.kind, o);
}
// いま何個を選んでいて、そのうち何個に値が入るか。
//   回路を枠で囲むと 抵抗・導線・電池 が混ざって選ばれる。全部を動かす／消すのは正しいが、
//   抵抗値を配ってよいのは同じ型のものだけなので、2つの数を分けて持つ。
//     n     … 選ばれている数（移動・削除の対象）
//     nEdit … 値が入る数（代表と同じ型のものだけ）
function bulkSelectionInfo() {
  // ★種別が混ざっているときは「まとめて編集中」を出さない。値が入るのは1種別だけなので
  //   「選択中の全部に同じ値が入ります」が嘘になる（実測：物体2＋レーザー1でステータスは
  //   3個なのに、質量を打つと物体2個にしか入らなかった）。案内は prop-mixed が受け持つ。
  if (selectionKindGroups().length >= 2) return null;
  if (selectedIds.size > 1)
    return { kind:'body', label: BULK_KINDS.body.label, n: selectedIds.size, nEdit: selectedIds.size };
  if (!bulkKind) return null;
  const g = BULK_KINDS[bulkKind], rep = bulkRep(bulkKind);
  const n = g.all().filter(o => bulkIds.has(o.id)).length;
  if (n < 2) return null;
  const nEdit = bulkPeers(bulkKind, rep).length + (rep ? 1 : 0);
  return { kind: bulkKind, n, nEdit,
           // 型が揃っているなら型名（「ヒンジ」）、混ざっているなら種別名（「回路」）
           label: (n === nEdit && rep) ? _subLabel(g, rep) : g.label,
           editLabel: rep ? _subLabel(g, rep) : g.label };
}
// ステータス欄の表示。物体は従来どおり refreshSelCount の合計表示に任せる
// （物体とレーザーを一緒に範囲選択したときに、物体の数だけを出してしまわないように）
function bulkStatusText() {
  if (!bulkKind) return null;
  const info = bulkSelectionInfo();
  return info && info.kind !== 'body' ? `${info.label} ${info.n}個` : null;
}
// 右パネル上部の注記。まとめて編集中であることと、表示している値が誰のものかを明示する。
// _hideAllPropForms から呼ぶので、どの種別のパネルを開いても同じように出る。
function refreshBulkNote() {
  const el = document.getElementById('prop-bulk-note');
  if (!el) return;
  const info = bulkSelectionInfo();
  if (!info) { el.style.display = 'none'; return; }
  el.style.display = '';
  // ★粒子には「代表」が無い。パネルは選択ぜんぶの平均を出しているので、そう書く
  //   （「オブジェタブの一番上のもの」という説明は、一覧に出ない粒子には当てはまらない）。
  if (info.kind === 'particle') {
    el.innerHTML = `<b>${info.label} ${info.n}個</b>をまとめて編集中<br>` +
      '<span style="color:var(--text2)">温度は選択ぜんぶの平均です。' +
      '打ち替えると、選択中の全部がその温度になります</span>';
    return;
  }
  el.innerHTML = info.n === info.nEdit
    ? `<b>${info.label} ${info.n}個</b>をまとめて編集中<br>` +
      '<span style="color:var(--text2)">表示中の値はオブジェタブの一番上のものです。' +
      'ここを変えると選択中の全部に同じ値が入ります</span>'
    // 型が混ざっているとき（回路を枠で囲んだ場合など）。移動・削除は全部、値は同じ型だけ
    : `<b>${info.label} ${info.n}個</b>を選択中（移動・削除はこの${info.n}個）<br>` +
      `<span style="color:var(--text2)">値を変えると、同じ型の<b>${info.editLabel} ${info.nEdit}個</b>` +
      'に入ります。表示中の値はオブジェタブの一番上のものです</span>';
}
// ── 範囲選択の枠に何が入っているか ─────────────────────────
//   枠は lastSelRect に残してあるので、メニューを開いた時点で数え直す。
//   数え直すことで、選択後に物体を動かしても表示と実際がずれない。
//   型を持つ種別（ジョイント・場・回路）は型ごとに分ける。「ヒンジのみ」「電場のみ」
//   「抵抗のみ」と細かく選べたほうが実際の使い方に合うし、一括編集の対象と一致する。
function bulkGroupsInRect(r) {
  const out = [];
  if (!r) return out;
  for (const kind of BULK_ORDER) {
    const g = BULK_KINDS[kind];
    const seen = new Map();                 // sub → { label, n }。Map なので登場順が保たれる
    for (const o of g.all()) {
      if (!g.inRect(o, r)) continue;
      const sub = _subOf(g, o);
      if (!seen.has(sub)) seen.set(sub, { label: _subLabel(g, o), n: 0 });
      seen.get(sub).n++;
    }
    for (const [sub, v] of seen) out.push({ kind, sub, label: v.label, n: v.n });
  }
  return out;
}
// 直前の範囲選択の枠から、1種別（型まで指定）だけを取り出して選び直す
function selectOnlyKind(kind, sub) {
  const g = BULK_KINDS[kind], r = lastSelRect;
  if (!g || !r) return;
  if (sub === undefined) sub = null;
  const list = g.all().filter(o => g.inRect(o, r) && _subOf(g, o) === sub);
  if (!list.length) return;
  g.select(list);                 // select() は clearAllSelections から選択を作り直す
  lastSelRect = r;                // 枠は残す（続けて別の種別へ選び直せるように）
  _afterBulkSelect(kind, list);
}
// 選び直したあとの表示（ステータス欄・右パネルの注記・オブジェタブ）
function _afterBulkSelect(kind, list) {
  const label = _subLabel(BULK_KINDS[kind], list[0]);
  document.getElementById('st-sel').textContent =
    kind === 'body'    ? `${list.length}個`
    : list.length > 1  ? `${label} ${list.length}個`
                       : label;
  refreshBulkNote();
  const sceneTab = document.getElementById('tab-scene');
  if (sceneTab && sceneTab.style.display !== 'none') updateSceneList();
}
// ════════════════════════════════════════
//  同じ種類・同じ設定のものをシーン全体から選ぶ（右クリックの一番上）
//   「同じ種類」＝種別と型（subOf）が一致するもの。範囲選択の「◯◯のみ選択」と同じ単位なので、
//     選んだあとの一括編集（bulkPeers）がそのまま効く。
//   「同じ設定」＝さらに設定値がすべて一致するもの。
//   ★比べる値は保存形式（toJSON／serialize*）から取り、そこから「状態」だけを落とす。
//     設定を1つ足せば保存側には必ず足されるので、ここは手を入れなくても追随する。
//     逆に「比べる値」を列挙する形にすると、足し忘れた設定が黙って無視される。
//   ★落とすのは：位置・向き・速度・温度などの状態、取り付け先と取り付け位置、id と
//     ラベル（一意の名前）、力／速度の矢印・軌跡のような「見せ方の付け外し」。
//     状態は必ず違うので、入れると自分しか当たらない。色は設定として比べる。
//   ★許容誤差は入れない。複製・コピーで作ったものは値がぴったり一致する。
//     形は物体のローカル座標（頂点・半径・幅高さ）で比べるので、回したものも同じと見なす。
// ════════════════════════════════════════
const _pick = (o, keys) => { const r = {}; for (const k of keys) r[k] = o[k]; return r; };
const BULK_SETTINGS = {
  body: {
    src: b => b,                       // toJSON を通る（キャッシュ類はそこで落ちる）
    drop: b => ['x','y','angle','vx','vy','av','sleeping','sleepTimer','held','label',
                'tracePoints','strobePoints','guidePx','guidePy',
                'showForces','showVelocity','tracerEnabled','tracerAnchorX','tracerAnchorY',
                'tracerColor','tracerDuration',
                // ★温度は状態。ただし温度固定（熱源）なら、固定した温度は設定そのもの
                ...(b.tempFixed ? [] : ['temp'])],
  },
  thruster:  { src: th => th, drop: () => ['localX','localY'] },
  tracer:    { src: b => _pick(b, ['tracerColor','tracerDuration']), drop: () => [] },
  joint:     { src: serializeJoint,
               drop: () => ['bodyAId','bodyBId','groundA','groundB',
                            'anchorAx','anchorAy','anchorBx','anchorBy','refAngle','nodes'] },
  laser:     { src: serializeLaser,      drop: () => ['bodyId','localX','localY','angle'] },
  wave:      { src: serializeWaveSource, drop: () => ['bodyId','localX','localY'] },
  slinky:    { src: serializeSlinky,
               drop: () => ['guidePx','guidePy','endA','endB','bodyA','bodyB',
                            'anchorAx','anchorAy','anchorBx','anchorBy',
                            'pinAx','pinAy','pinBx','pinBy','nodes'] },
  // ★気体は保存形式に帳簿（W・Q）や器・蓋の id が混ざるので、設定だけを拾う
  gas:       { src: c => _pick(c, ['width','dof','n','damp','vent','pistonLocked','thermostat']),
               drop: () => [] },
  emfield:   { src: serializeEMField,   drop: () => ['x','y'] },
  heatfield: { src: serializeHeatField, drop: () => ['x','y'] },
  flowfield: { src: serializeFlowField, drop: () => ['x','y'] },
  // 回路は serializeCircuit と同じ取り方（自前のキー全部）。電流・電圧・豆電球の温度は状態
  circuit:   { src: e => { const o = {}; for (const k in e) o[k] = e[k]; return o; },
               drop: () => ['ax','ay','bx','by','I','Iprev','Vprev','Vread','T','burnt'] },
  particle:  { src: p => ({ type: p.type, color: p.color }), drop: () => [] },
  // 端（jointend／slinkyend）は設定値を持たないので「同じ設定」は出さない
};
// 設定の指紋。id と _ で始まるキャッシュは入れ子の中でも落とす（動力の id など）
function bulkSettingsKey(kind, o) {
  const s = BULK_SETTINGS[kind];
  const top = JSON.parse(JSON.stringify(s.src(o)));
  for (const k of s.drop(o)) delete top[k];
  const strip = v => {
    if (Array.isArray(v)) return v.map(strip);
    if (!v || typeof v !== 'object') return v;
    const r = {};
    for (const k of Object.keys(v).sort()) if (k !== 'id' && k[0] !== '_') r[k] = strip(v[k]);
    return r;
  };
  return JSON.stringify(strip(top));
}
// t = { kind, o }。先頭は o 自身（＝右パネルに出る代表）
function sameKindList(t, exact) {
  const g = BULK_KINDS[t.kind], sub = _subOf(g, t.o);
  let list = g.all().filter(o => o !== t.o && _subOf(g, o) === sub);
  if (exact) {
    const key = bulkSettingsKey(t.kind, t.o);
    list = list.filter(o => bulkSettingsKey(t.kind, o) === key);
  }
  return [t.o, ...list];
}
function selectSameKind(t, exact) {
  if (!t || !BULK_KINDS[t.kind]) return;
  const list = sameKindList(t, exact);
  BULK_KINDS[t.kind].select(list);
  _afterBulkSelect(t.kind, list);
}
// まとめて削除。物体は従来どおり ctxDelete が受け持つので、ここは物体以外だけ
function deleteBulkSelection() {
  const kind = bulkKind;
  if (!kind) return false;
  const g = BULK_KINDS[kind];
  const rep = bulkRep(kind);
  const list = g.all().filter(o => bulkIds.has(o.id));
  if (list.length < 2 || !rep || !bulkIds.has(rep.id)) return false;
  pushUndo();
  for (const o of list) g.remove(o);
  if (kind === 'wave') {
    if (!waveActiveSources().length) resetWaveField();
    refreshWaveInfo();
  }
  if (kind === 'circuit') markCircuitDiscontinuity();
  clearAllSelections();
  lastSelRect = null;
  document.getElementById('st-sel').textContent = 'なし';
  updatePropsPanel(null);
  return true;
}
