function rpTab(name, el) {
  el = el || document.querySelector(`.rpanel-tab button[data-tab="${name}"]`);
  document.querySelectorAll('.rpanel-tab button').forEach(b=>b.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('#rpanel-content > div').forEach(d=>d.style.display='none');
  document.getElementById('tab-'+name).style.display='';
  if (name==='scene') updateSceneList();
  if (name==='world') syncWaveUI();   // プロパティ側で変えた波動場設定を反映
  if (name==='world') syncEMWorldUI();
}
// ★何かを選んだら、ワールド／オブジェタブを開いていてもプロパティタブへ戻す。
//   選んだのに右パネルが変わらないと「選択できていない」ように見えるため。
//   選択解除では戻さない（全体設定タブで作業中に空白をクリックしただけで引きはがされる）。
let _propsTabLock = 0;
function focusPropsTab() {
  if (_propsTabLock) return;
  const t = document.getElementById('tab-props');
  if (!t || t.style.display !== 'none') return;   // すでにプロパティなら触らない
  rpTab('props');
}
// オブジェ一覧の行から選ぶときはタブを移動しない（移動すると一覧そのものが消えて、
// 次の行をクリックできなくなる）。
function withoutPropsTabJump(fn) {
  _propsTabLock++;
  try { return fn(); } finally { _propsTabLock--; }
}
// ─── 要素（レーザー/動力/軌跡/ジョイント）の選択 ───
function clearAllSelections() {
  selectedIds.clear();
  selectedElemIds.clear();
  selectedJointEnds.clear();
  selectedSlinkyEnds.clear();
  selectedJointId = null;
  selectedElement = null;
  // ★回路素子もここで外す。以前は残っていたため、回路素子を選んだあとに物体を選んで
  //   「削除」すると、ctxDelete が先頭で selectedCircuit を見て回路素子のほうを消していた。
  selectedCircuit = null;
  // ★注釈も外す。注釈は selectedElement とは別系統だが「選択されているもの」は1つに
  //   保ちたい（Delete の行き先が2つあると、どちらが消えるか予測できなくなる）。
  selectedAnnotation = null;
  clearBulkSelection();   // ★種別一括選択も外す（代表が入れ替わるので仲間だけ残しても意味がない）
}
// ─── 範囲選択に含めた要素（レーザー・波源）─────────────
//   平行移動に加えて、値のまとめて設定もできる。代表（selectedElement）へ加えた変更を
//   applyToBulk が仲間へ配る（js/app/bulk-select.js の _elemBoxPeers）。
//   IDで持つのは物体と同じ流儀。Undo/やり直しで作り直されても ID は保存・復元
//   されるので選択が生き残る。
//   物体に取り付いたものは取り付け先と一緒に動くので、範囲選択の対象にしない
//   （選ぶと物体の移動ぶんと二重に動いてしまう）。
function boxSelectableElements() {
  const out = [];
  for (const L of lasers)      if (!L.body) out.push(L);
  for (const S of waveSources) if (!S.body) out.push(S);
  return out;
}
function pruneElemSelection() {                 // 消えた／物体に付いた要素のIDを捨てる
  if (!selectedElemIds.size) return;
  const live = new Set(boxSelectableElements().map(o => o.id));
  for (const id of selectedElemIds) if (!live.has(id)) selectedElemIds.delete(id);
}
function selectedElemList() {
  return boxSelectableElements().filter(o => selectedElemIds.has(o.id));
}
// 選択中の波源／レーザーをまとめて返す。単独選択（クリック）と範囲選択の両方を1つのリストにする。
//   この2つは別の入れ物（selectedElement / selectedElemIds）に入るので、複製・削除のように
//   「選ばれているものすべて」を対象にする操作は、ここで束ねてから回す。
function _selectedElemsOfKind(kind, pick, Klass) {
  const out = [];
  if (selectedElement && selectedElement.kind === kind && pick(selectedElement))
    out.push(pick(selectedElement));
  for (const o of selectedElemList())
    if (o instanceof Klass && !out.includes(o)) out.push(o);
  return out;
}
function selectedWaveSources() { return _selectedElemsOfKind('wave',  el => el.source, WaveSource); }
function selectedLasers()      { return _selectedElemsOfKind('laser', el => el.laser,  Laser); }
// 拾った要素が範囲選択の一員か（＝クリック・右クリックで選択を壊してはいけない相手か）
function boxSelectionHasElement(el) {
  const o = el && (el.kind === 'laser' ? el.laser : el.kind === 'wave' ? el.source : null);
  return !!(o && selectedElemIds.has(o.id));
}
// ═══ 範囲選択で選んだ「ばね／ロープ／棒の端」 ═══════════════════════════════
//  端は物体でも要素でもない（ジョイントのアンカー＝ただの座標）ので専用の入れ物を使う。
//  ★物体に付いた端は原則ここへ入れない。取り付け先と一緒に動くので、選ぶと二重に動く
//    （レーザー・波源を !L.body で絞っているのと同じ理由）。唯一の例外が「線の真ん中だけを
//    囲んだ」場合で、そのときは線を掴んで動かす操作と同じく全体を運ぶ＝両端を入れる。
const jointEndKey = (j, end) => j.id + ':' + end;
function isJointEndSelected(j, end) { return selectedJointEnds.has(jointEndKey(j, end)); }
function selectedJointEndList() {
  const out = [];
  for (const j of joints) {
    if (isJointEndSelected(j, 'A')) out.push({ j, end: 'A' });
    if (isJointEndSelected(j, 'B')) out.push({ j, end: 'B' });
  }
  return out;
}
function pruneJointEndSelection() {                 // 消えたジョイントの端を捨てる
  if (!selectedJointEnds.size) return;
  const live = new Set();
  for (const j of joints) { live.add(jointEndKey(j, 'A')); live.add(jointEndKey(j, 'B')); }
  for (const k of selectedJointEnds) if (!live.has(k)) selectedJointEnds.delete(k);
}
// 線分と矩形が交わるか（端点が中にある／矩形の辺と交差する）。
//   「線の真ん中だけを囲んだ」の判定に使う。端点だけを見ると、枠をまたぐ長い棒や
//   大きくたるんだ縄が拾えない。
function _segRectHit(p0, p1, r) {
  const inR = p => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (inR(p0) || inR(p1)) return true;
  if (Math.max(p0.x, p1.x) < r.x || Math.min(p0.x, p1.x) > r.x + r.w) return false;
  if (Math.max(p0.y, p1.y) < r.y || Math.min(p0.y, p1.y) > r.y + r.h) return false;
  const cr = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const hit = (cx, cy, dx, dy) => {
    const d1 = cr(p0.x, p0.y, p1.x, p1.y, cx, cy), d2 = cr(p0.x, p0.y, p1.x, p1.y, dx, dy);
    const d3 = cr(cx, cy, dx, dy, p0.x, p0.y),     d4 = cr(cx, cy, dx, dy, p1.x, p1.y);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  return hit(x0, y0, x1, y0) || hit(x1, y0, x1, y1) || hit(x1, y1, x0, y1) || hit(x0, y1, x0, y0);
}
// 枠の中に入ったジョイントの端を選ぶ。範囲選択の確定（mouseup）から呼ぶ。
function addJointEndsInRect(r) {
  for (const j of joints) {
    if (JOINT_LENGTH_TYPES.indexOf(j.type) < 0) continue;      // 長さを持つものだけ
    // 端が「枠に入った物体」に付いているなら、その物体と一緒に動くので触らない（二重移動）
    if ((j.bodyA && selectedIds.has(j.bodyA.id)) || (j.bodyB && selectedIds.has(j.bodyB.id))) continue;
    const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
    const inR = p => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    let selA = !j.bodyA && inR(wa), selB = !j.bodyB && inR(wb);
    if (!selA && !selB) {
      // どちらの端も枠に無い＝真ん中だけを囲んだ。線を掴んで動かす操作と同じく全体を運ぶ。
      const pts = (j.type === 'rope' && j.nodes) ? [wa, ...j.nodes, wb] : [wa, wb];
      let mid = false;
      for (let k = 0; k < pts.length - 1 && !mid; k++) if (_segRectHit(pts[k], pts[k + 1], r)) mid = true;
      if (mid) { selA = true; selB = true; }
    }
    if (selA) selectedJointEnds.add(jointEndKey(j, 'A'));
    if (selB) selectedJointEnds.add(jointEndKey(j, 'B'));
  }
}
// 選んだ端を、一団の平行移動に合わせて運ぶ。dx/dy はドラッグ開始からの総移動量。
//   両端とも選ばれていれば全体の平行移動＝ロープの節点も一緒に運ぶ（たるみが保たれる）。
//   片端だけなら、その端だけが動く＝長さが変わる（refitJointLengthsForMovedBodies が合わせる）。
function movePointerJointEnds(list, dx, dy) {
  const byJoint = new Map();
  for (const a of list) {
    if (!byJoint.has(a.j)) byJoint.set(a.j, []);
    byJoint.get(a.j).push(a);
  }
  for (const [j, ends] of byJoint) {
    const whole = ends.length === 2;
    const wa0 = (j.type === 'rope' && whole) ? j.getWorldAnchorA() : null;
    for (const a of ends) {
      const nx = a.x0 + dx, ny = a.y0 + dy;
      let nb = bodiesAtPoint(nx, ny)[0] || null;
      const other = (a.end === 'A') ? j.bodyB : j.bodyA;
      if (nb && other && nb === other) nb = bodiesAtPoint(nx, ny)[1] || null;   // 同一物体の両端を避ける
      setJointEnd(j, a.end, nb, nx, ny, !nb && pointOnGround(nx, ny));
    }
    if (j.type !== 'rope') continue;
    if (wa0) {   // 全体の平行移動：節点も同じだけ運ぶ（px/py も。でないと差が速度に化ける）
      const w = j.getWorldAnchorA();
      const ddx = w.x - wa0.x, ddy = w.y - wa0.y;
      for (const n of (j.nodes || [])) { n.x += ddx; n.y += ddy; n.px += ddx; n.py += ddy; }
    }
    j._wrapPts = null; j._calmT = 0; j._anchorCalmT = 0; j._pwa = j._pwb = null;
  }
}
// 選んだ端へのまとめて操作。右クリックメニューから呼ぶ。
//   端は「設定値」を持たないので、まとめて設定（bulkPeers 経由で値を配る仕組み）には乗らない。
//   代わりに、端に対してできる操作をここで全員へ適用する。
//     tip    … 先端おもりを付ける（自由なロープ端のみ）
//     untip  … 先端おもりを外して、元どおり背景に固定した端へ戻す
//     bg     … 取り付け先を外して、その場の背景へ固定（＝空間に打った杭）
//     ground … 地面へ固定。setJointEnd が地面の表面へ吸着させる
function bulkJointEndOpCount(op) {
  let n = 0;
  for (const { j, end } of selectedJointEndList()) {
    if (op === 'tip')        { if (j.type === 'rope' && ropeEndIsFree(j, end)) n++; }
    else if (op === 'untip') { if (ropeEndTip(j, end)) n++; }
    else if (op === 'bg')     { if (j.bodyA || j.bodyB || j.groundA || j.groundB) n++; }
    else if (op === 'ground') { n++; }
  }
  return n;
}
function bulkJointEndOp(op) {
  const list = selectedJointEndList();
  if (!list.length || !bulkJointEndOpCount(op)) return;
  pushUndo();
  for (const { j, end } of list) {
    if (op === 'tip') {
      if (j.type !== 'rope' || !ropeEndIsFree(j, end)) continue;
      addRopeTip(j, end);
      // おもりに付いた端は「取り付け先と一緒に動く」側になるので、範囲選択から外す
      // （物体に付いた端を拾わないのと同じ扱い。以後はおもりを選んで動かす）。
      selectedJointEnds.delete(jointEndKey(j, end));
    } else if (op === 'untip') {
      removeRopeTip(j, end);
    } else {
      const w = (end === 'A') ? j.getWorldAnchorA() : j.getWorldAnchorB();
      setJointEnd(j, end, null, w.x, w.y, op === 'ground');
      if (j.type === 'rope') { j._calmT = 0; j._anchorCalmT = 0; j._pwa = j._pwb = null; }
      _wake(j.bodyA); _wake(j.bodyB);
    }
  }
  refreshSelCount();
  const jr = joints.find(x => x.id === selectedJointId);
  if (jr) updateJointPanel(jr);
}
// ═══ 範囲選択で選んだ「スリンキーの端」 ═══════════════════════════════════
//  ジョイントの端とまったく同じ流儀：端は個別に選べ、真ん中だけを囲んだときは
//  両端を入れる（＝索まるごとの平行移動になる）。物体に取り付いた端は入れない
//  （取り付け先と一緒に動くので、選ぶと二重に動く）。
const slinkyEndKey = (S, end) => 'S' + S.id + ':' + end;
function isSlinkyEndSelected(S, end) { return selectedSlinkyEnds.has(slinkyEndKey(S, end)); }
function slinkyEndNode(S, end) { return S.nodes[end === 'B' ? S.nodes.length - 1 : 0]; }
function selectedSlinkyEndList() {
  const out = [];
  for (const S of slinkies) {
    if (isSlinkyEndSelected(S, 'A')) out.push({ S, end: 'A' });
    if (isSlinkyEndSelected(S, 'B')) out.push({ S, end: 'B' });
  }
  return out;
}
function pruneSlinkyEndSelection() {              // 消えた索の端を捨てる
  if (!selectedSlinkyEnds.size) return;
  const live = new Set();
  for (const S of slinkies) { live.add(slinkyEndKey(S, 'A')); live.add(slinkyEndKey(S, 'B')); }
  for (const k of selectedSlinkyEnds) if (!live.has(k)) selectedSlinkyEnds.delete(k);
}
function slinkyEndFree(S, end) { return (end === 'A' ? S.endA : S.endB) !== 'body'; }
function addSlinkyEndsInRect(r) {
  const inR = p => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  for (const S of slinkies) {
    // 端が「枠に入った物体」に付いているなら、その物体と一緒に動くので触らない（二重移動）
    if ((S.bodyA && selectedIds.has(S.bodyA.id)) || (S.bodyB && selectedIds.has(S.bodyB.id))) continue;
    const nd = S.nodes, lastI = nd.length - 1;
    let selA = slinkyEndFree(S, 'A') && inR(nd[0]);
    let selB = slinkyEndFree(S, 'B') && inR(nd[lastI]);
    if (!selA && !selB) {
      // どちらの端も枠に無い＝真ん中だけを囲んだ。索を掴んで動かす操作と同じく全体を運ぶ。
      let mid = false;
      for (let k = 0; k < lastI && !mid; k++) if (_segRectHit(nd[k], nd[k+1], r)) mid = true;
      if (mid) { selA = slinkyEndFree(S, 'A'); selB = slinkyEndFree(S, 'B'); }
    }
    if (selA) selectedSlinkyEnds.add(slinkyEndKey(S, 'A'));
    if (selB) selectedSlinkyEnds.add(slinkyEndKey(S, 'B'));
  }
}
// 選んだ端を、一団の平行移動に合わせて運ぶ。dx/dy はドラッグ開始からの総移動量。
//   両端とも選ばれていれば索まるごと運ぶ（節点も一緒＝たるみが保たれる）。
//   片端だけならその端だけが動く＝索が引き伸ばされる。
function movePointerSlinkyEnds(list, dx, dy) {
  const byS = new Map();
  for (const a of list) {
    if (!byS.has(a.S)) byS.set(a.S, []);
    byS.get(a.S).push(a);
  }
  for (const [S, ends] of byS) {
    const nd = S.nodes;
    if (ends.length === 2) {                       // 全体の平行移動
      const ref = ends.find(e => e.end === 'A') || ends[0];
      const cur = slinkyEndNode(S, ref.end);
      const ddx = (ref.x0 + dx) - cur.x, ddy = (ref.y0 + dy) - cur.y;
      for (const n of nd) { n.x += ddx; n.y += ddy; n.vx = 0; n.vy = 0; }
      S.pinAx += ddx; S.pinAy += ddy; S.pinBx += ddx; S.pinBy += ddy;
      continue;
    }
    // 片端だけ＝行き先を動かし、索の形は追随に任せる（dragElementTo の★と同じ理由）
    for (const a of ends) slinkyMoveEndTo(S, a.end, a.x0 + dx, a.y0 + dy);
  }
}
function selectionCount() {
  return selectedIds.size + selectedElemIds.size + selectedJointEnds.size + selectedSlinkyEnds.size;
}
// 選択数の表示（物体＋レーザー・波源の合計）
//   種別一括選択中は、そちらの件数を優先して出す。ジョイントや回路は selectedIds にも
//   selectedElemIds にも入らないので、合計だけを見ると「なし」になってしまう。
function refreshSelCount() {
  const bulk = bulkStatusText();
  if (bulk) { document.getElementById('st-sel').textContent = bulk; return; }
  const n = selectionCount();
  // ★回路素子1つは selectionCount に数えられない（一括選択は2個から）。範囲選択で1つだけ
  //   囲んだとき、選べているのに「なし」と出ていた
  if (!n && selectedCircuit) { document.getElementById('st-sel').textContent = CIRCUIT_LABELS[selectedCircuit.type] || '回路'; return; }
  document.getElementById('st-sel').textContent = n > 0 ? `${n}個` : 'なし';
}
// ★複数選択でも右パネルを出す。表示するのは代表＝オブジェタブの一番上にある物体で、
//   値を変えると updateProp などが selectedIds 全員へ流す（＝まとめて設定）。
function selectedBodyRep() { return objects.find(o => selectedIds.has(o.id)) || null; }
// 選択に合わせて右パネルを出し直す。複数選んでいるときは代表の値を出す＝まとめて設定の入口。
//   ★物体が1つも入っていなくてレーザー・波源だけを範囲選択したときも、代表を立てて
//     そのプロパティを出す。以前はここで updatePropsPanel(null) になり「オブジェクトを
//     選択してください」が出るだけで、波長や振動数をまとめて変える入口が無かった。
//     代表へ加えた変更は applyToBulk が範囲選択のぶんへ配る（js/app/bulk-select.js）。
function refreshPropsForSelection() {
  // ★種別が混ざっているときは、どれか1種別の値の欄を出さない。出しても入るのは選択の
  //   一部だけなのに「選択中の全部に入る」と読めてしまう（実際そう書いてあった）。
  const groups = selectionKindGroups();
  if (groups.length >= 2) { updateMixedPanel(groups); return; }
  // ★気体は objects に居ないので selectedElement で持つ。ここで拾わないと、
  //   掴んだあと「オブジェクトを選択してください」に戻ってしまう。
  if (selectedElement && selectedElement.kind === 'gas' && selectedElement.chamber.piston()) {
    updateGasPanel(selectedElement.chamber);
    return;
  }
  const b = selectedBodyRep();
  if (b) { updatePropsPanel(b); return; }
  const els = selectedElemList();
  const L = els.find(o => o instanceof Laser);
  if (L) { selectedElement = { kind:'laser', laser:L }; updateLaserPanel(L); return; }
  const S = els.find(o => o instanceof WaveSource);
  if (S) { selectedElement = { kind:'wave', source:S }; updateWavePanel(S); return; }
  // 端だけを選んでいるときは持ち主のパネルを出す（BULK_KINDS の select() と同じ扱い）
  const je = selectedJointEndList()[0];
  if (je) { selectedJointId = je.j.id;
            selectedElement = { kind:'joint', joint: je.j, end: je.end };
            updateJointPanel(je.j); return; }
  const se = selectedSlinkyEndList()[0];
  if (se) { selectedElement = { kind:'slinky', slinky: se.S, end: se.end };
            updateSlinkyPanel(se.S); return; }
  updatePropsPanel(null);
}
// ─── 種別が混ざった選択 ───────────────────────────────────
//   範囲選択→種別を選ぶ経路は clearAllSelections を通るので必ず単一種別になる。
//   混ざるのは Ctrl+クリックで種別をまたいだときだけで、これは意図した機能
//   （物体とレーザーをまとめて運べる。mouse.js の beginPointerGroupMove を参照）。
//   混ざっていても移動と削除は全員に効くので、そこだけは案内に必ず出す。
function selectionKindGroups() {
  const els = selectedElemList();
  const out = [];
  const add = (kind, label, n) => { if (n > 0) out.push({ kind, label, n }); };
  add('body',      '物体',           selectedIds.size);
  add('laser',     'レーザー',        els.filter(o => o instanceof Laser).length);
  add('wave',      '波源',           els.filter(o => o instanceof WaveSource).length);
  add('jointend',  'ジョイントの端',  selectedJointEnds.size);
  add('slinkyend', 'ばねの端',        selectedSlinkyEnds.size);
  return out;
}
// 混ざった選択を1種別だけに絞る（ほかの種別は選択から外す）。値を編集する入口。
function narrowSelectionTo(kind) {
  const els = selectedElemList();
  if (kind !== 'body')      selectedIds.clear();
  if (kind !== 'jointend')  selectedJointEnds.clear();
  if (kind !== 'slinkyend') selectedSlinkyEnds.clear();
  if (kind === 'laser' || kind === 'wave') {
    const Klass = (kind === 'laser') ? Laser : WaveSource;
    for (const o of els) if (!(o instanceof Klass)) selectedElemIds.delete(o.id);
  } else selectedElemIds.clear();
  selectedElement = null;
  selectedJointId = null;
  refreshSelCount();
  refreshPropsForSelection();
}
// クリック位置に最も近い要素マーカーを拾う（物体より優先＝物体の上でも選べる）
function pickElement(wx, wy) {
  const thr = 9 / cam.zoom, thr2 = thr * thr;
  let best = null, bestD = thr2;
  const consider = (px, py, make) => {
    const d = (wx-px)*(wx-px) + (wy-py)*(wy-py);
    if (d <= bestD) { bestD = d; best = make(); }
  };
  for (const L of lasers) { const o = L.getOrigin(); consider(o.x, o.y, () => ({ kind:'laser', laser:L })); }
  for (const S of waveSources) { const o = S.getOrigin(); consider(o.x, o.y, () => ({ kind:'wave', source:S })); }
  // スリンキーは端だけでなく、索のどこを掴んでも選べるようにする（実体のある物なので）
  for (const S of slinkies) {
    const nd = S.nodes, lastI = nd.length - 1;
    consider(nd[0].x, nd[0].y,         () => ({ kind:'slinky', slinky:S, end:'A' }));
    consider(nd[lastI].x, nd[lastI].y, () => ({ kind:'slinky', slinky:S, end:'B' }));
    for (let i = 1; i < lastI; i++) consider(nd[i].x, nd[i].y, () => ({ kind:'slinky', slinky:S }));
  }
  for (const b of objects) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    // ★動力は1つずつ選ぶ（何個でも付くので、物体だけでは指し先が決まらない）
    for (const th of b.thrusters) {
      const p = th.worldPos();
      consider(p.x, p.y, () => ({ kind:'thruster', body:b, thr:th }));
    }
    if (b.tracerEnabled) {
      const tx = b.x + b.tracerAnchorX*c - b.tracerAnchorY*s;
      const ty = b.y + b.tracerAnchorX*s + b.tracerAnchorY*c;
      consider(tx, ty, () => ({ kind:'tracer', body:b }));
    }
    // 反射防止コートは両端をつまめる（ジョイントの端と同じ扱い）
    if (b.arCoats) for (let i = 0; i < b.arCoats.length; i++) {
      for (const end of ['A', 'B']) {
        const p = arCoatEndPos(b, i, end);
        consider(p.x, p.y, () => ({ kind:'arcoat', body:b, index:i, end }));
      }
    }
  }
  for (const j of joints) {
    const a = j.getWorldAnchorA(), b2 = j.getWorldAnchorB();
    consider(a.x,  a.y,  () => ({ kind:'joint', joint:j, end:'A' }));
    consider(b2.x, b2.y, () => ({ kind:'joint', joint:j, end:'B' }));
  }
  return best;
}
// ════════════════════════════════════════
//  要素（ジョイント端／動力／軌跡／レーザー）の平行移動
//   ドラッグ中は「接続先を変えずアンカーだけを動かす」。ドロップ時に接続先を再判定する。
// ════════════════════════════════════════
const PLACE_TOL_PX = 2;                        // [画面px]
function _distToOutline(b, x, y) {
  let best = Infinity;
  const loops = [b._worldVerts(), ...b._worldHoles()];
  for (const loop of loops) {
    const n = loop.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const p = loop[i], q = loop[(i+1)%n];
      const ex = q.x - p.x, ey = q.y - p.y;
      const L2 = ex*ex + ey*ey || 1e-9;
      let t = ((x - p.x)*ex + (y - p.y)*ey) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = len(x - (p.x + ex*t), y - (p.y + ey*t));
      if (d < best) best = d;
    }
  }
  return best;
}
function bodyNearPoint(b, x, y, tol) {
  if (b.containsPoint(x, y)) return true;
  if (!(tol > 0)) return false;
  if (b.type === 'circle') return len(x - b.x, y - b.y) <= b.radius + tol;
  const a = b._aabb;
  if (x < a.minX-tol || x > a.maxX+tol || y < a.minY-tol || y > a.maxY+tol) return false;
  return _distToOutline(b, x, y) <= tol;
}
// 実際にアンカーを置く点（スナップ後）で判定する。生のマウス位置での判定も
// 併用して、従来拾えていたケースは必ず拾う（判定は緩くなるだけ）。
function bodiesForPlacement(wp, placed, tolWorld) {
  const tol = tolWorld !== undefined ? tolWorld : PLACE_TOL_PX / cam.zoom;
  const hits = [];
  for (let i = objects.length - 1; i >= 0; i--) {
    const b = objects[i];
    if (bodyNearPoint(b, placed.x, placed.y, tol) || b.containsPoint(wp.x, wp.y)) hits.push(b);
  }
  return hits;
}
// ── 画鋲を打つ（ヒンジ・軸・溶接）────────────────────────────────
//   ★ヒンジ・軸・溶接は画鋲：重なったものを1点で留める。留め先の決め方は2つ。
//       'pair'  … 重なった上の2つを綴じる（割りピン）。重なりが1つなら背景に留める
//       'board' … 重なっているものを**すべて**、それぞれ背景に留める（画鋲を板まで刺す）
//     'board' は同じ点に何枚も重ねて、どれも背景の軸で回したいときのため（遊星歯車の中心に
//     太陽・腕・外の輪の裏板が重なる）。'pair' では上の2つどうしが綴じられてしまう。
//   ★'board' でも固定した物体には打たない（もともと背景と一体なので留める意味が無い）。
//   ★手のツール（mouse.js）とデモはどちらもここを通す。デモが「手ではできない留め方」を
//     しないことを、関数の形で保証するため（デモは手で作れる部品だけで組む約束）。
//   ★A/B の順：重なりが1つ（または 'board'）なら A＝物体・B＝背景。'pair' なら上が A。
//     モーターは相対角速度（B − A）を motorSpeed に合わせ、回路のモーターも B − A の向きに
//     回すので、順で回る向きが逆になる。o.spin に物体を渡すと、その物体が B になるよう
//     両端を入れ替える（＝その物体が相手に対して ＋の向きに回る）。どれとどれを留めるかは
//     変わらない。手で置いた人が、回る向きを見て符号や配線を入れ直すのと同じこと。
//   ★o.tol（ワールド px）は拾う範囲。手は画面 2px（倍率で変わる）。デモは倍率に左右されない
//     よう小さな固定値を渡す（＝拡大してからクリックしたのと同じ）。
//   戻り値：作ったジョイントの配列（打てる物体が無ければ空）
function pinJointsAt(type, wp, placed, mode, o) {
  o = o || {};
  const hits = bodiesForPlacement(wp, placed || wp, o.tol);
  const pairs = mode === 'board' ? hits.filter(b => !b.isStatic).map(b => [b, null])
              : hits.length ? [[hits[0], hits[1] || null]] : [];
  const p = placed || wp;
  return pairs.map(([bA, bB]) => {
    if (bA && [].concat(o.spin || []).includes(bA)) [bA, bB] = [bB, bA];   // spin は物体1つか配列
    const axA = getLocalAnchor(bA, p.x, p.y), axB = getLocalAnchor(bB, p.x, p.y);
    const j = new Joint(Object.assign({}, o.opts || {}, {
      type, bodyA: bA, bodyB: bB, anchorAx: axA.x, anchorAy: axA.y, anchorBx: axB.x, anchorBy: axB.y,
      restLength: 0, maxLength: 0,
      motorSpeed: o.motorSpeed || 0,
      motorTorque: o.motorTorque !== undefined ? o.motorTorque : 288,
      motorBrake: !!o.motorBrake,
      releasable: !!o.releasable,
    }));
    joints.push(j);
    return j;
  });
}
// ── 置いたあとで留め先を切り替える（右パネル・右クリックから）──────────────
const PIN_TYPES = ['hinge', 'axle', 'fixjoint'];
// 画鋲の点（両端は同じ点にある）
function pinPointOf(j) { return j.getWorldAnchorA(); }
// 同じ点の、同じ種類の画鋲（自分を含む）
function pinsAtSamePoint(j) {
  const p = pinPointOf(j);
  return joints.filter(k => k.type === j.type && Math.hypot(k.getWorldAnchorA().x - p.x, k.getWorldAnchorA().y - p.y) < 0.5);
}
// いまの留め方。'pair' 2つをつないでいる／'board' 重なりが2つ以上あるのに背景に留めている／
//   'single' 重なりが1つだけ（どちらの留め方でも同じになる）
function pinModeOf(j) {
  if (j.bodyA && j.bodyB) return 'pair';
  const p = pinPointOf(j);
  return bodiesForPlacement(p, p, 0.5).filter(b => !b.isStatic).length >= 2 ? 'board' : 'single';
}
// ★切り替えは「その点の画鋲全体」に効く：同じ点にある同じ種類の画鋲をいったん全部外し、
//   その点でもう一方の留め先のままツールを使い直す（中身は手のツールと同じ pinJointsAt）。
//   1本だけを置き換えると、→'pair' で他の背景留めが残り、外したはずの物体が留まったまま・
//   残したはずの物体が外れる、が起きた（実際そうなった）。
//   ★設定と番号（id）は引き継ぐ。リモコン・プログラムは id でジョイントを指しているので。
//     ・→'board'：物体ごとに、その物体を留めていた元の画鋲から写す（無ければ選んでいた画鋲から）。
//       遊星歯車の中心のように1本ずつ設定が違っても失われない
//     ・→'pair' ：選んでいた画鋲から写す。他の画鋲は消える（それを指すリモコンは相手を失う）
//   ★元が「背景が A 側」（デモが spin で回す物体を B に置いたもの）なら、新しいものも物体を B に
//     置く＝モーターの回る向きを変えない。
function setPinModeOf(j, mode) {
  if (!j || !PIN_TYPES.includes(j.type)) return false;
  const cur = pinModeOf(j);
  if (cur === mode || cur === 'single') return false;
  const p = pinPointOf(j);
  const old = pinsAtSamePoint(j);
  pushUndo();
  joints = joints.filter(k => !old.includes(k));
  const copy = (src, dst) => {
    for (const k of ['motorSpeed', 'motorTorque', 'motorBrake', 'motorCh', 'releasable', 'color',
                     'angleLimit', 'angleLo', 'angleHi', 'detached']) dst[k] = src[k];
    dst.id = src.id;
  };
  const bodyOf = k => k.bodyA || k.bodyB;
  const made = pinJointsAt(j.type, p, p, mode, {
    tol: 0.5, spin: (!j.bodyA && j.bodyB) ? bodiesForPlacement(p, p, 0.5) : null });
  if (mode === 'board') {
    const used = new Set();
    for (const n of made) {
      const X = bodyOf(n);
      const src = old.find(k => !used.has(k) && (!k.bodyA || !k.bodyB) && bodyOf(k) === X)
               || old.find(k => !used.has(k) && (k.bodyA === X || k.bodyB === X))
               || (!used.has(j) ? j : null);
      if (src) { used.add(src); copy(src, n); }
      else { copy(j, n); n.id = ++uidCounter; n.motorCh = 0; }   // ★id と駆動 ch は重ねない
    }
  } else if (made.length) copy(j, made[0]);
  const sel = made.find(n => n.id === j.id) || made[0];
  if (!sel) { joints.push(...old); flashHint('ここには留められる物体がありません'); return false; }
  selectedJointId = sel.id;
  selectedElement = { kind:'joint', joint: sel, end:'A' };
  updateJointPanel(sel);
  flashHint(mode === 'board'
    ? made.length + ' 本を背景に留めました（右クリックの「この場所の要素」で1本ずつ選べます）'
    : '重なった2つ（' + jointEndsLabel(sel) + '）をつなぎました' + (old.length > 1 ? '（この点のほかの ' + (old.length - 1) + ' 本は外しました）' : ''));
  return true;
}
// ★クリック点の「そば」の物体を1つ拾う（つかむ／選ぶ用）。
//   動いている物体を狙うと、見えた場所をクリックするまでに物体が進んでしまい、
//   厳密な内外判定では取りこぼす。輪郭から少し外れていても拾えるようにする。
//   優先順位は「厳密に内側（手前が先）→ 外れていれば輪郭がいちばん近いもの」。
//   近さだけで決めると、手前の物体の少し外側が、カーソル直下の奥の物体に勝ってしまう。
const GRAB_TOL_PX = 20;   // つかむツール：空振りしても何も起きないので緩くてよい
const PICK_TOL_PX = 10;   // 編集ツール：範囲選択と競合するので控えめ
// ★点の上にある物体を1つ返す。手前が先。ただし生成口だけは、上に重なった物体より先に返す。
//   生成口は物理に参加しない「装置」で、そこから出た物体は objects の後ろ＝手前に積もる。
//   描画順どおりに手前を優先すると、1個でも出た瞬間から生成口を選べなくなり、プログラムを
//   直すには出たものを全部どかすしかない。出てきた実物のほうは、走り去る・つかんでどかす・
//   別の場所で指す・右クリックの候補一覧から選ぶ、と手が残っているので装置のほうを優先する。
//   （生成口どうしが重なった場合は、これまでどおり手前が勝つ）
function frontmostBodyAtPoint(wx, wy) {
  let hit = null;
  for (let i = objects.length - 1; i >= 0; i--) {
    const b = objects[i];
    if (!b.containsPoint(wx, wy)) continue;
    if (b.isSpawner) return b;
    if (!hit) hit = b;
  }
  return hit;
}
function bodyNearestToPoint(wx, wy, tolPx) {
  const inside = frontmostBodyAtPoint(wx, wy);             // ① 厳密に内側
  if (inside) return inside;
  const tol = (tolPx || 0) / cam.zoom;
  if (!(tol > 0)) return null;
  let best = null, bd = tol;                               // ② 輪郭がいちばん近いもの
  for (let i = objects.length - 1; i >= 0; i--) {
    const b = objects[i], a = b._aabb;
    if (wx < a.minX-tol || wx > a.maxX+tol || wy < a.minY-tol || wy > a.maxY+tol) continue;
    const d = b.type === 'circle' ? len(wx - b.x, wy - b.y) - b.radius
                                  : _distToOutline(b, wx, wy);
    if (d < bd) { bd = d; best = b; }                      // < なので同距離なら手前が勝つ
  }
  return best;
}
// ★長さを持たないジョイント（溶接・ヒンジ・モーター）で繋がった物体を、1つの組み立て物として
//   まとめて拾う。片方だけ動かしても「ずれた状態」に意味がなく、離して再生した瞬間に
//   ソルバが引き戻すか弾け飛ぶだけなので、編集ツールでは一緒に運ぶ。
//   長さを持つジョイント（バネ・ロープ・連結棒 ＝ JOINT_LENGTH_TYPES）は対象外。伸ばした
//   状態には意味があり、離したときに refitJointLengthsForMovedBodies が長さを取り直す。
//   繋ぎ替えたいときは、ジョイントの端点マーカーを掴んで外す（専用の操作が既にある）。
function rigidlyLinkedBodies(seedIds) {
  const out = new Set(), stack = [];
  for (const id of seedIds) {
    const b = objects.find(o => o.id === id);
    if (b && !out.has(b)) { out.add(b); stack.push(b); }
  }
  while (stack.length) {
    const b = stack.pop();
    for (const j of joints) {
      if (JOINT_LENGTH_TYPES.indexOf(j.type) >= 0) continue;
      const other = j.bodyA === b ? j.bodyB : (j.bodyB === b ? j.bodyA : undefined);
      if (!other || out.has(other)) continue;      // 相手が背景ならアンカー側で運ぶ
      out.add(other); stack.push(other);
    }
  }
  return out;
}
// 上の一団に付いている「背景側のアンカー」。杭は動かさないのが既定だが（バネ・ロープは
// 伸びるのが自然）、長さを持たないジョイントには伸びた状態が無いので一緒に運ぶ。
function backgroundAnchorsOf(bodySet) {
  const out = [];
  for (const j of joints) {
    if (JOINT_LENGTH_TYPES.indexOf(j.type) >= 0) continue;
    if (!j.bodyA && j.bodyB && bodySet.has(j.bodyB)) out.push({ j, end:'A', x0:j.anchorAx, y0:j.anchorAy });
    if (!j.bodyB && j.bodyA && bodySet.has(j.bodyA)) out.push({ j, end:'B', x0:j.anchorBx, y0:j.anchorBy });
  }
  return out;
}
// tolWorld を渡すと判定の甘さを world 単位で指定できる（既定は画面上の PLACE_TOL_PX）
function bodiesAtPoint(wx, wy, tolWorld) {
  const tol = tolWorld !== undefined ? tolWorld : PLACE_TOL_PX / cam.zoom;
  const hits = [];
  for (let i = objects.length - 1; i >= 0; i--)
    if (bodyNearPoint(objects[i], wx, wy, tol)) hits.push(objects[i]);
  return hits;   // 上に描かれている物体が先頭（配置ツールと同じ規則）
}
function _wake(b) { if (b) { b.sleeping = false; b.sleepTimer = 0; } }
function elementWorldPos(el) {
  if (el.kind === 'joint')
    return el.end === 'A' ? el.joint.getWorldAnchorA() : el.joint.getWorldAnchorB();
  if (el.kind === 'laser') return el.laser.getOrigin();
  if (el.kind === 'wave')  return el.source.getOrigin();
  if (el.kind === 'emfield' || el.kind === 'heatfield' || el.kind === 'flowfield')
    return { x: el.field.x, y: el.field.y };         // 領域の中心（電場・磁場／加熱・冷却）
  if (el.kind === 'gas') {                          // 気体は容器ごと動くので器を代表点にする
    const v = pistonVesselOfChamber(el.chamber.id), c = v && v.cylinder();
    return c ? { x: c.x, y: c.y } : { x: el.chamber.cx, y: el.chamber.cy };
  }
  if (el.kind === 'particle') return { x: el.particle.x, y: el.particle.y };
  if (el.kind === 'arcoat')  return arCoatEndPos(el.body, el.index, el.end);
  if (el.kind === 'slinky') {                     // 端を掴んでいなければ索の中央を代表点にする
    const nd = el.slinky.nodes;
    const i = el.end === 'B' ? nd.length - 1 : el.end === 'A' ? 0 : (nd.length >> 1);
    return { x: nd[i].x, y: nd[i].y };
  }
  if (el.kind === 'thruster') return el.thr.worldPos();
  const b = el.body, c = Math.cos(b.angle), s = Math.sin(b.angle);
  const ax = b.tracerAnchorX, ay = b.tracerAnchorY;
  return { x: b.x + ax*c - ay*s, y: b.y + ax*s + ay*c };
}
// ── 向きを持つ要素（レーザー／動力）だけがハンドルを持つ ──
//   ★動力は推力 0 でも向きを持つ（0 から上げるつまみが多い使い方なので、
//     置いたあと向きを直せないと組み直しになる）。
function elementHasDir(el) {
  if (!el) return false;
  if (el.kind === 'laser') return true;
  if (el.kind === 'thruster') return !!el.thr;
  return false;
}
// 要素のワールド角（ローカル角 + 載っている物体の角度）
function elementWorldAngle(el) {
  if (el.kind === 'laser')    return el.laser.angle + (el.laser.body ? el.laser.body.angle : 0);
  if (el.kind === 'thruster') return el.thr.worldDir();
  return 0;
}
// ワールド角を与え、ローカル角へ変換して保存する（物体が回っても相対向きが保たれる）
function setElementWorldAngle(el, a) {
  if (el.kind === 'laser') {
    const L = el.laser;
    L.angle = a - (L.body ? L.body.angle : 0);
  } else if (el.kind === 'thruster') {
    el.thr.dir = a - el.body.angle;
    _wake(el.body);
  }
}
// ハンドルのワールド位置（画面上の距離を一定に保つ）
function elementDirHandlePos(el) {
  const o = elementWorldPos(el);
  const a = elementWorldAngle(el);
  const r = DIR_HANDLE_PX / cam.zoom;
  return { x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r };
}
// ハンドルを掴んだら向き変更を開始（掴めなければ false ＝ 従来どおり平行移動/選択へ）
function beginDirRotateIfHit(wp) {
  const el = selectedElement;
  if (!elementHasDir(el)) return false;
  const h = elementDirHandlePos(el);
  const thr = 10 / cam.zoom;
  const dx = wp.x - h.x, dy = wp.y - h.y;
  if (dx*dx + dy*dy > thr*thr) return false;
  elementRotate = { el, armed: true, moved: false };
  return true;
}
function rotateElementTo(wp) {
  const r = elementRotate;
  const o = elementWorldPos(r.el);
  const dx = wp.x - o.x, dy = wp.y - o.y;
  if (Math.hypot(dx, dy) < 1e-6) return;
  let a = Math.atan2(dy, dx);
  if (modShift) a = snapPlacementAngle(a);   // Shift=角度スナップ（0/30/45/60/90°系）
  if (!r.moved) {
    if (Math.abs(a - elementWorldAngle(r.el)) < 1e-9) return;   // 実際に変わった時だけ履歴を積む
    if (r.armed) { pushUndo(); r.armed = false; }
    r.moved = true;
  }
  setElementWorldAngle(r.el, a);
  if (r.el.kind === 'laser') {
    // ★まとめて選んでいるレーザーも同じ向きへそろえる（右パネルの「向き」欄と同じ扱い）。
    //   配るのは世界角。取り付け先の姿勢がばらばらでも、画面上の向きがきちんとそろう。
    applyToBulk('laser', r.el.laser, o => setLaserWorldAngle(o, a));
    // ★向きハンドルで回したぶんを右パネルの「向き」欄にも返す（数値欄とハンドルで値がずれないように）
    const box = document.getElementById('laser-angle');
    if (box && document.activeElement !== box) {
      box.value = _dispDeg(laserWorldAngle(r.el.laser)).toFixed(1);
      syncSliderById('laser-angle');
    }
  }
}
function setElementWorldPos(el, wx, wy) {
  // ★気体を掴んだら容器ごと運ぶ。気体だけを器から抜いて動かすことはできないし、
  //   片方だけ動かすと容器が分解する。停止中でも成立するよう
  //   movePistonVesselTo が器と蓋の両方を直接動かす。
  if (el.kind === 'gas') {
    const v = pistonVesselOfChamber(el.chamber.id);
    if (v) movePistonVesselTo(v, wx, wy);
    return;
  }
  if (el.kind === 'joint') {
    const j = el.joint;
    // 地面に付いていた端は、掴んで動かしている間はいったん「ワールド座標を持つ点」に
    // 戻す。ドロップ先が地面かどうかは finishElementDrag が改めて決める。
    if (j.type === 'hinge' || j.type === 'axle' || j.type === 'fixjoint') {
      setJointEnd(j, 'A', j.bodyA, wx, wy, false);   // ピンは1点なので両端を同じワールド点へ
      setJointEnd(j, 'B', j.bodyB, wx, wy, false);
    } else {
      // ★ばね／ロープ／棒の端は、ドラッグ中も毎回「いま端が乗っている物体」へ付け替える。
      //   以前は取り付け先を変えず、離したときにだけ再判定していた。そのため端を物体から
      //   引き剥がしても離すまで繋がったままで、ロープや棒がその物体を引きずり続けた
      //   （ロープの先端おもりを外す操作でいちばん目立つ。おもりは軽いので飛んでいく）。
      //   線全体を掴んで動かす操作（reattachJointEnds）はもともと毎回付け替えており、
      //   これでドラッグ中の見た目と、離した後（finishElementDrag）の判定がそろう。
      const end  = (el.end === 'A') ? 'A' : 'B';
      const prev = (end === 'A') ? j.bodyA : j.bodyB;
      const other = (end === 'A') ? j.bodyB : j.bodyA;
      const hits = bodiesAtPoint(wx, wy);
      let nb = hits[0] || null;
      if (nb && other && nb === other) nb = hits[1] || null;   // 同一物体の両端になるのを避ける
      setJointEnd(j, end, nb, wx, wy, false);
      _wake(prev); _wake(nb);      // 外した相手も、すぐ落ち始められるように起こす
    }
    // ★節点は捨てない。ここは「端（アンカー）を動かした」だけで、縄そのものの量は
    //   変わっていない。捨てると次に ensureRopeNodes が wa→wb の直線で作り直すため、
    //   端をつまんで1px動かしただけでたるみが消える（＝端と端の最短距離になる）。
    //   長さの辻褄は離したときに finishElementDrag が合わせる。
    //   凍結の判定だけは、動かした以上ここで解いておく。
    if (j.type === 'rope') { j._wrapPts = null; j._calmT = 0; j._anchorCalmT = 0; j._pwa = j._pwb = null; }
    _wake(j.bodyA); _wake(j.bodyB);
  } else if (el.kind === 'laser') {
    const L = el.laser;
    if (L.body) { const a = getLocalAnchor(L.body, wx, wy); L.localX = a.x; L.localY = a.y; }
    else { L.localX = wx; L.localY = wy; }
  } else if (el.kind === 'wave') {
    const S = el.source;
    if (S.body) { const a = getLocalAnchor(S.body, wx, wy); S.localX = a.x; S.localY = a.y; }
    else { S.localX = wx; S.localY = wy; }
  } else if (el.kind === 'emfield') {        // ★場の領域は中心を動かす（大きさは右パネル）
    el.field.x = wx; el.field.y = wy;
    updateEMFieldPanel(el.field);
  } else if (el.kind === 'heatfield') {      // ★加熱・冷却の領域も同じ
    el.field.x = wx; el.field.y = wy;
    updateHeatFieldPanel(el.field);
  } else if (el.kind === 'flowfield') {      // ★流れの場も同じ
    el.field.x = wx; el.field.y = wy;
    updateFlowFieldPanel(el.field);
  } else if (el.kind === 'slinky') {
    // 端を掴んでいれば端だけ、胴を掴んでいれば索まるごと運ぶ（実体のある物なので後者も要る）
    const S = el.slinky, nd = S.nodes;
    if (el.end === 'A' || el.end === 'B') {
      // ★動かすのは端の行き先だけで、節点には触らない。索の形は再生中ならソルバが、
      //   停止中なら settleSlinkies が追随させる（＝再生中と停止中で手応えが変わらない）。
      //   ここで端の節点を直に置いていたころは、停止中はその1本のリンクだけが伸びた。
      const tip = slinkyEndTip(S, el.end);
      if (tip) {
        // ★先端おもりが付いた端は、おもりが端そのもの。おもりごと運ぶ（付け替えの判定は
        //   放したときだけ。おもり自身が必ず最前面の当たり先になるので、ドラッグ中に
        //   毎回判定すると自分自身に付け替え続けることになる）。
        tip.x = wx; tip.y = wy; tip.vx = 0; tip.vy = 0; tip.av = 0;
        tip.sleeping = false; tip.sleepTimer = 0; tip._updateAABB();
      } else {
        // ★ジョイントの端と同じ流儀：ドラッグ中も毎回「いま端が乗っている物体」へ付け替える
        //   （上の el.kind === 'joint' の★を参照）。付け替えを放したときだけにすると、
        //   物体に取り付いた端は引き剥がしてもカーソルに付いてこない（行き先が取り付け点の
        //   ままなので追随が引き戻す）＝1回目のドラッグでは動かず、そこで杭に変わるので
        //   2回目でようやく外れて動く、という手触りになる。
        const other = (el.end === 'A') ? S.bodyB : S.bodyA;
        const prev  = (el.end === 'A') ? S.bodyA : S.bodyB;
        const hits  = bodiesAtPoint(wx, wy);
        let nb = hits[0] || null;
        if (nb && other && nb === other) nb = hits[1] || null;   // 同一物体の両端になるのを避ける
        setSlinkyEnd(S, el.end, nb, wx, wy);
        _wake(prev); _wake(nb);          // 外した相手も、すぐ落ち始められるように起こす
      }
      if (elementDrag && elementDrag.el === el && elementDrag.dist0 != null)
        refitSlinkyRest(S, elementDrag.dist0, elementDrag.rest0);
    } else {
      const mid = nd[nd.length >> 1];
      const ox = wx - mid.x, oy = wy - mid.y;
      for (const n of nd) { n.x += ox; n.y += oy; n.vx = 0; n.vy = 0; }
      S.pinAx += ox; S.pinAy += oy; S.pinBx += ox; S.pinBy += oy;
      reanchorSlinkyGuide(S);      // ★レールも運んだ先へ張り直す（物体のドラッグと同じ）
    }
    refreshSlinkyInfo(S);
  } else if (el.kind === 'thruster') {
    const a = getLocalAnchor(el.body, wx, wy);
    el.thr.localX = a.x; el.thr.localY = a.y;
  } else if (el.kind === 'tracer') {
    const a = getLocalAnchor(el.body, wx, wy);
    el.body.tracerAnchorX = a.x; el.body.tracerAnchorY = a.y;
    el.body.tracePoints = [];
  } else if (el.kind === 'arcoat') {
    // ★掴んだ端だけが輪郭の上を滑る。もう一方は動かない（js/optics/arcoat.js）
    arCoatDragEnd(el.body, el.index, el.end, wx, wy);
  }
}
function clearElementSelection() {
  selectedElement = null;
  document.getElementById('st-sel').textContent = 'なし';
  updatePropsPanel(null);
}
function removeJointObj(j) {
  removeJointAt(joints.indexOf(j));   // ロープの先端おもりも一緒に消す（起こす処理も中でやる）
  selectedJointId = null;
  clearElementSelection();
}
// ── ばね/ロープ/棒：線を掴んで全体を平行移動 ──────────────
//   ジョイントは固有の位置を持たず、端点は物体のローカル座標。両端に同じ
//   ワールド変位を与えるので、長さと形は変わらない（物体側は取り付け位置が滑る）。
const JOINT_WHOLE_TYPES = ['spring', 'rope', 'rod'];
// 掴んだ点から各端までのずれを覚えて、毎回「カーソル＋ずれ」に置き直す。
// 差分の積算だと、掴んでいる間に接続先の物体が動いたときにずれが溜まる。
function beginJointWholeDrag(j, wp) {
  const p = snapPlace(wp);
  const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
  jointWholeDrag = { joint: j, start: p, armed: true, moved: false,
                     offA: { x: wa.x - p.x, y: wa.y - p.y },
                     offB: { x: wb.x - p.x, y: wb.y - p.y } };
}
// 両端を、その位置にある物体へ付け直す（無ければ背景固定）。ドラッグ中も毎回呼ぶので、
// 物体から離れた時点で接続が切れ、見た目と挙動が食い違わない。
function reattachJointEnds(j, ax, ay, bx, by) {
  const prevA = j.bodyA, prevB = j.bodyB;
  const wa0 = (j.type === 'rope') ? j.getWorldAnchorA() : null;   // 動かす前の端（節点を一緒に運ぶ）
  let nbA = bodiesAtPoint(ax, ay)[0] || null;
  let nbB = bodiesAtPoint(bx, by)[0] || null;
  if (nbA && nbB && nbA === nbB) nbB = bodiesAtPoint(bx, by)[1] || null;   // 同一物体の両端を避ける
  // 物体に乗らなかった端は、地面の上なら地面へ・そうでなければ背景へ固定
  setJointEnd(j, 'A', nbA, ax, ay, !nbA && pointOnGround(ax, ay));
  setJointEnd(j, 'B', nbB, bx, by, !nbB && pointOnGround(bx, by));
  if (j.type === 'rope') {
    // ★節点は捨てずに、端と同じだけ平行移動させる。
    //   以前は j.nodes = null にしていたので、次の ensureRopeNodes が wa→wb の直線で
    //   作り直し、線を掴んで動かすたびにたるみが消えていた（端をつまんで動かす操作の
    //   ほうは、同じ理由で前から節点を残してある。setElementWorldPos の★を参照）。
    //   平行移動なので形はそのまま運べばよく、長さも端点間距離も変わらない。
    //   px/py も一緒に動かすこと。位置だけ動かすと、その差が丸ごと速度になって縄が飛ぶ。
    //   運ぶ量は A 端の移動量で測る。両端は同じだけ動くので、これで足りる。
    const dx = ax - wa0.x, dy = ay - wa0.y;
    if (j.nodes) for (const n of j.nodes) { n.x += dx; n.y += dy; n.px += dx; n.py += dy; }
    j._wrapPts = null; j._calmT = 0; j._anchorCalmT = 0; j._pwa = j._pwb = null;
  }
  _wake(prevA); _wake(prevB); _wake(nbA); _wake(nbB);   // 外した相手も落ち始められるよう起こす
}
function dragJointWholeTo(wp) {
  const d = jointWholeDrag, j = d.joint;
  const p = snapPlace(wp);
  if (!d.moved) {
    if (Math.abs(p.x - d.start.x) < 1e-9 && Math.abs(p.y - d.start.y) < 1e-9) return;
    if (d.armed) { pushUndo(); d.armed = false; }   // 実際に動いた時だけ履歴を積む
    d.moved = true;
  }
  reattachJointEnds(j, p.x + d.offA.x, p.y + d.offA.y, p.x + d.offB.x, p.y + d.offB.y);
}
function finishJointWholeDrag() {
  const d = jointWholeDrag;
  jointWholeDrag = null;
  if (!d || !d.moved) return;        // クリックしただけなら何もしない
  // 接続先はドラッグ中に確定済み。端点間の距離は平行移動で不変なので長さも取り直さない。
  // ★形も保つ（keepRopeShape=true）。ドラッグ中に節点を一緒に運んであるので、ここで
  //   捨てると離した瞬間にたるみが消える＝運んでいる間だけ形が残る、というちぐはぐになる。
  _finishJointAttach(d.joint, true);
  updateJointPanel(d.joint);
}
function beginElementDrag(el, wp) {
  if (el.kind === 'ground') return;
  const p = elementWorldPos(el);
  elementDrag = { el, dx: p.x - wp.x, dy: p.y - wp.y, origX: p.x, origY: p.y, armed: true, moved: false, last: null };
  if (el.kind === 'joint' && el.joint.type === 'rope') {
    // 縄の刻み（節点間隔）はドラッグ中ずっとこの値を使う。retargetRopeLength の★を参照。
    elementDrag.unit0 = el.joint._restLen;
    // 長さは「掴んだときの長さ ＋ 出した量 − 食べた量」で持つ。両方を別々に積むので、
    // 出したあとに端を戻しても縄は戻らず（巻き取りは別の操作）、食べたあとに端を戻せば
    // 食べた分だけは返る（＝手が滑ってもやり直せる）。
    elementDrag.len0 = el.joint.maxLength;
    elementDrag.eaten = 0;
    elementDrag.paid  = 0;
  }
  // ★ばねの端を直につまんだときも、物体を動かしたときと同じ規則で自然長を動かす
  //   （端点間距離の変化分だけ。伸びは保つ）。伸ばした初期条件は「つかむ」で作る。
  if ((el.kind === 'slinky' && (el.end === 'A' || el.end === 'B')) ||
      (el.kind === 'joint' && el.joint.type === 'spring')) {
    let a, b;
    if (el.kind === 'slinky') { a = slinkyEndPos(el.slinky, 'A'); b = slinkyEndPos(el.slinky, 'B'); }
    else                      { a = el.joint.getWorldAnchorA();    b = el.joint.getWorldAnchorB(); }
    elementDrag.dist0 = Math.hypot(b.x - a.x, b.y - a.y);
    elementDrag.rest0 = el.kind === 'slinky' ? el.slinky.restM : el.joint.restLength;
  }
}
// ═══ ロープの端ドラッグ：縄の出し入れ ═══════════════════════════════════
//  端を縄に沿って戻すと、端が縄を食べていく（＝その分だけ縄が短くなる）。
//  端を縄の向きへ引き出すと、その分だけ縄が出てくる。端を横へ振っただけなら何も起きない。
//
//  ★以前は「掴む前の長さ ＋ 他端との直線距離の変化」で決めていた。これは端がどう動いた
//    かを見ておらず、他端との距離しか見ていない。たるんだ縄では、端を少し横へ振っただけで
//    距離が大きく変わるので縄が勝手に増減し、逆に縄をなぞって戻しても距離が変わらなければ
//    何も起きなかった。「なぞって食べる」は距離では表せないので、縄の折れ線そのものに
//    対して測るように変えた。
//
//  なぞりの判定は甘くしてある。マウスで縄の曲線を正確になぞるのは無理なので、折れ線への
//  最近接点で測り、横へ TRACE_TOL までずれていても「なぞった」とみなす。
//  探す範囲は「動いた距離＋許容差」までに限る。これが無いと、U字にたるんだ縄で端の近くを
//  たまたま縄の別の部分が通っているとき、そこへ飛びついて一気に食べてしまう。
// [画面px] 縄からこれだけ横にずれても「なぞった」とみなす。ここを超えると、なぞりでは
//   ないと判断して縄が減らなくなる（＝短くできない）。マウスで曲線を追うのは思ったより
//   難しいので、大きめに取ってある。縄が太い（＝刻みが粗い）ときはその 2 本分まで広げる。
const ROPE_TRACE_TOL_PX = 56;
// 掴んでいる端から内側へたどる折れ線。節点だけで作り、末尾が他端。
//   pts[k] の材料座標（端から縄に沿って測った距離）は (k+1)×restLen。
//   ★掴んでいる端そのものは入れない。カーソルは縄から横へずれているのが普通で、それを
//     先頭に入れると最初の1本だけが斜めになり、なぞった量が実際より小さく出る。
function _ropeEndPolyline(j, end) {
  const pts = [], n = j.nodes || [];
  if (end === 'A') { for (let i = 0; i < n.length; i++) pts.push(n[i]); pts.push(j.getWorldAnchorB()); }
  else             { for (let i = n.length - 1; i >= 0; i--) pts.push(n[i]); pts.push(j.getWorldAnchorA()); }
  return pts;
}
// p を折れ線へ射影して、材料座標 m と横ずれ dist を返す。kMax 本目までしか見ない。
function _ropeMaterialCoord(pts, p, restLen, kMax) {
  let best = Infinity, bestS = 0;
  for (let k = 0; k < kMax; k++) {
    const a = pts[k], b = pts[k + 1];
    const ex = b.x - a.x, ey = b.y - a.y, L2 = ex * ex + ey * ey;
    let t = L2 > 1e-12 ? ((p.x - a.x) * ex + (p.y - a.y) * ey) / L2 : 0;
    // ★端に近い1本だけは外側（t<0、材料座標 0 まで）へ延長して測る。ここを 0 で止めると、
    //   カーソルがいちばん近い節点より外にいる間ずっと座標が動かない＝その分のなぞりが
    //   丸ごと捨てられる。節点は食べるたびに1つずつ減るので、この死に区間が節点間隔ごとに
    //   繰り返し現れ、実測でなぞった量の 4 割が失われていた。
    const tMin = (k === 0) ? -1 : 0;
    t = t < tMin ? tMin : t > 1 ? 1 : t;
    const dd = (p.x - a.x - ex * t) ** 2 + (p.y - a.y - ey * t) ** 2;
    if (dd < best) { best = dd; bestS = k + 1 + t; }
  }
  return { m: bestS * restLen, dist: Math.sqrt(best) };
}
// 端が from から to へ動いたぶん、縄を出し入れする。
//   測るのは「縄のどこまで戻ったか」＝材料座標。折れ線 pts[k] の材料座標は
//   maxLength − k×restLen（節点は縄を等分している）なので、カーソルを折れ線へ
//   射影して、そのセグメント上の位置 t から新しい長さがそのまま出る。
//   ★横ずれは射影で落ちるので、なぞりの判定はこれだけで甘くなる。縄から 20px ずれて
//     いても、縄に沿ってどれだけ戻ったかは同じ値になる（許容差 tol は「そもそも
//     なぞっていない」を弾くためだけのもの）。
//   ★Shift 中は出し入れしない＝端の位置だけを動かす。実物のロープに近い操作で、
//     「たるんだ縄を張る」「張った縄をたるませる」がそのまま作れる。
function _refitDraggedRopeLength(d, from, to) {
  const j = d.el.joint;
  if (j.type !== 'rope' || modShift) return;
  const nodes = j.nodes;
  if (!nodes || !nodes.length) return;
  const end = (d.el.end === 'A') ? 'A' : 'B';
  const restLen = j._restLen > 0.5 ? j._restLen : 16;
  const pts = _ropeEndPolyline(j, end);
  const tol  = Math.max(ROPE_TRACE_TOL_PX / cam.zoom, restLen * 2);
  const step = Math.hypot(to.x - from.x, to.y - from.y);
  // 探すのは端の近くだけ。全体を探すと、U字にたるんだ縄で端のそばを縄の別の部分が
  // 通っているとき、そこへ飛びついて一気に食べてしまう。
  const kMax = Math.min(pts.length - 1, Math.ceil((step + tol) / restLen) + 2);
  if (kMax < 1) return;
  // ① 食べる：カーソルが縄に沿ってどれだけ内側へ進んだか。同じ折れ線に対して from と to
  //   の両方を射影し、その差を取る。★差にするのが肝心で、横ずれは両方に同じだけ乗るので
  //   きれいに打ち消える＝縄から離れてなぞっても、なぞった量は正しく出る。
  const mTo = _ropeMaterialCoord(pts, to, restLen, kMax);
  const mFr = _ropeMaterialCoord(pts, from, restLen, kMax);
  if (mTo.dist <= tol && mFr.dist <= tol)
    d.eaten = Math.max(0, d.eaten + (mTo.m - mFr.m));
  let L = d.len0 + d.paid - d.eaten;
  // ② 出す：届かないぶんだけ。たるんでいる間は、端をどう動かしても縄は出ない
  //   （たるみが減るだけ）。実物のロープと同じで、出すには張り切ってから引く。
  //   ★ここを「端の動きのうち縄の向きの成分」で測ってはいけない。たるんだ縄の端を
  //     横へ振ると縄が端の後ろへ引きずられ、次の瞬間には「縄の向き」が動かした向き
  //     そのものになる。すると振っているだけで全量が引き出しと判定され、振るたびに
  //     縄が伸びる（実測で 40px 振ると 27px 伸びた）。
  const other = (end === 'A') ? j.getWorldAnchorB() : j.getWorldAnchorA();
  const need = Math.hypot(to.x - other.x, to.y - other.y);
  if (L < need) { d.paid += need - L; L = need; }
  L = Math.max(L, JOINT_MIN_LEN);
  if (Math.abs(L - j.maxLength) < 1e-9) return;
  j.maxLength = L;
  // 動かした端で縄を出し入れする（ウインチ）。節点の刻みは変わらないので、
  // 止まっている側の形はまったく動かない＝滑車の反対側のたるみが増えたりしない。
  retargetRopeLength(j, end, d.unit0);
}
// ★ジョイントの端をドラッグしている間、その端が重なっている物体を返す
//   （＝離せば繋がる相手。{ joint, bodies } か null）。
//   ロープの端はただの点で当たり判定を持たないので、端を物体へ重ねてそのまま繋げる。
//   一方、連結棒は線分そのものが当たり判定を持つため、同じことをすると相手の物体を
//   押しのけてしまい（＝カーソルから逃げる）、ロープでできる操作が棒ではできなかった。
//   そこで、繋ぐ相手になる物体だけをドラッグ中の当たり判定から外す。繋いだあとは
//   solveRopeBodyCollisions の「接続先どうしは除外」で同じく素通りするので、
//   ドラッグ中とドロップ後で挙動が変わらない。
//   判定は棒の当たり半径ぶん甘くする。ここを厳密（＝ドロップ判定と同じ 2画面px）に
//   すると、端が輪郭に届くまでの残り数pxで棒が相手を小突いてしまう。
function draggedJointEndTargets() {
  const d = elementDrag;
  if (!d || !d.el || d.el.kind !== 'joint') return null;
  const w = elementWorldPos(d.el);
  return { joint: d.el.joint, end: d.el.end,
           bodies: bodiesAtPoint(w.x, w.y, ROD_RADIUS + 1) };
}
// 掴んだ要素を「動かした」とみなすまでの遊び [画面px]。
//   選ぶためにクリックしただけで 1px 動いてしまうことは普通にあり、それを移動と
//   見なすと要素の位置が書き換わる。とくにロープは、端点を離した時点で
//   maxLength＝そのときの端点間距離に張り直されるため、おもりの中心（＝端点の
//   ある場所）をクリックして選ぶたびに、ずれた分と slop の分だけ縄が伸びていく。
//   ワールドではなく画面上の距離で見る（ズームで感触が変わらないように）。
const ELEMENT_DRAG_DEADZONE_PX = 4;
// 縄長固定（Shift）中は、端を「縄の届く範囲」より外へは出せない。
//   ★これが無いと Shift を押しても縄は伸びる。長さ（maxLength）を止めても、端そのものは
//     カーソルのとおりに動くためで、節点だけが予算クランプに引っかかって取り残され、
//     アンカーから最初の節点までが1本の長い直線として描かれる＝縄が伸びたように見える。
//     端を止めれば、そこで縄が張って動かなくなる＝「張り切った」が目に見える。
//   届く範囲は他端からの直線距離で測る。滑車に掛けた縄では実際の余りより甘くなるが、
//   甘い側に外れるだけなので、張り切った縄が突然止まる不自然さは出ない。
function _clampRopeEndReach(el, p) {
  const j = el.joint;
  const o = (el.end === 'A') ? j.getWorldAnchorB() : j.getWorldAnchorA();
  const dx = p.x - o.x, dy = p.y - o.y;
  const d = Math.hypot(dx, dy);
  if (!(d > j.maxLength) || d < 1e-9) return p;
  const s = j.maxLength / d;
  return { x: o.x + dx * s, y: o.y + dy * s };
}
function dragElementTo(wp) {
  const d = elementDrag;
  let p = { x: wp.x + d.dx, y: wp.y + d.dy };
  p = snapPlace(p);
  if (modShift && d.el.kind === 'joint' && d.el.joint.type === 'rope')
    p = _clampRopeEndReach(d.el, p);
  if (!d.moved) {
    const dz = ELEMENT_DRAG_DEADZONE_PX / cam.zoom;
    if ((p.x - d.origX) ** 2 + (p.y - d.origY) ** 2 < dz * dz) return;
    if (d.armed) { pushUndo(); d.armed = false; }   // 実際に動いた時だけ履歴を積む
    d.moved = true;
  }
  const from = d.last || { x: d.origX, y: d.origY };
  setElementWorldPos(d.el, p.x, p.y);      // 取り付け先の判定はここで1回だけ
  _advanceDraggedRope(d, from, p);
  d.last = p;
}
// 停止中に端を運ぶ刻み [px]。接触マージン以下に保つ（体ドラッグの STEP と同じ考え）。
const ROPE_END_STEP_PX = 4;
// ドラッグ中のロープを、端の移動に合わせて進める。
//   ・長さは毎回そろえる（_refitDraggedRopeLength）。再生中はこれだけでよく、
//     形はソルバのサブステップが追いかける。
//   ・一時停止中はチェーンを進める人が誰もいない（体ドラッグの mouse.js:244 に当たる
//     処理が端ドラッグには無かった）。端を刻んで運びながら、ここで進める。
//     刻むのは、一気に飛ばすと縄が物体をすり抜けたり、たるみが一段で潰れるため。
//     時間を進めるのは最後の1回だけ。分割は収束のためで時間経過ではないので、
//     毎回進めるとカーソルを速く動かすほど余計に時間が経ってしまう。
function _advanceDraggedRope(d, from, to) {
  const el = d.el;
  if (el.kind !== 'joint' || el.joint.type !== 'rope') return;
  const j = el.joint, end = (el.end === 'A') ? 'A' : 'B';
  const body = (end === 'A') ? j.bodyA : j.bodyB;
  // 刻むのは再生中も同じ。縄の出し入れは「なぞり」を折れ線に当てて測るので、
  // 一気に飛ばすと曲がった縄をショートカットしてしまう（＝食べ方が変わる）。
  const steps = Math.min(240,
    Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / ROPE_END_STEP_PX)));
  let prev = from;
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    const cur = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    _refitDraggedRopeLength(d, prev, cur);   // 長さ：端がどう動いたかで決める（先に測る）
    setJointEnd(j, end, body, cur.x, cur.y, false);
    settleRopeChainShape(j, 2);              // 縄の形を端へ追随させる（rope.js の★を参照）
    if (!running) updateRopeChains(k === steps ? pausedRopeDt() : 0, false);
    prev = cur;
  }
}
function finishElementDrag() {
  const d = elementDrag;
  elementDrag = null;
  if (!d || !d.moved || !d.last) return;            // クリックしただけなら接続先を変えない
  const wx = d.last.x, wy = d.last.y, el = d.el;
  const hits = bodiesAtPoint(wx, wy);
  let top = hits[0] || null;   // ★ばねの先端おもりを外したときだけ、下の物体へ差し替える
  if (el.kind === 'joint') {
    const j = el.joint;
    if (j.type === 'hinge' || j.type === 'axle' || j.type === 'fixjoint') {
      if (!top) { removeJointObj(j); return; }      // 物体の外 → 削除
      const bA = hits[0], bB = hits.length > 1 ? hits[1] : null;
      setJointEnd(j, 'A', bA, wx, wy, false);
      setJointEnd(j, 'B', bB, wx, wy, false);
      j.refAngle = (bB ? bB.angle : 0) - (bA ? bA.angle : 0);   // 溶接の基準角を取り直す
      j.motorImpulse = 0;
      _wake(bA); _wake(bB);
    } else {                                        // spring / rope / rod
      const other = el.end === 'A' ? j.bodyB : j.bodyA;
      let nb = top;
      if (nb && other && nb === other) nb = hits[1] || null;    // 同一物体の両端になるのを避ける
      // 物体の上 → その物体／地面の上 → 地面（表面へ吸着）／どちらでもない → 背景固定
      setJointEnd(j, el.end, nb, wx, wy, !nb && pointOnGround(wx, wy));
      const wa2 = j.getWorldAnchorA(), wb2 = j.getWorldAnchorB();
      const newLen = Math.hypot(wb2.x - wa2.x, wb2.y - wa2.y);
      if (j.type === 'rod') j.restLength = newLen;   // 棒はたるまない＝長さ＝端点間距離
      else if (j.type === 'spring' && d.dist0 != null)   // ★伸びを保って自然長を動かす（物体を動かしたときと同じ規則）
        j.restLength = Math.max(d.rest0 + (newLen - d.dist0), JOINT_MIN_LEN);
      else if (j.type === 'rope') {
        // ★縄の長さはドラッグ中に _refitDraggedRopeLength が決め切っている（端がどう
        //   動いたかで出し入れする）。ここで距離から計算し直すと、それを上書きして
        //   しまうので触らない。節点の刻みだけ最後にそろえる。
        retargetRopeLength(j, el.end, d.unit0);
      }
      _wake(j.bodyA); _wake(j.bodyB);
    }
    updateJointPanel(j);
    return;
  }
  if (el.kind === 'laser') {                        // レーザーは削除せず背景固定（ワールド角を保持）
    const L = el.laser;
    const worldAngle = L.angle + (L.body ? L.body.angle : 0);
    if (top) { const a = getLocalAnchor(top, wx, wy); L.body = top; L.localX = a.x; L.localY = a.y; L.angle = worldAngle - top.angle; }
    else     { L.body = null; L.localX = wx; L.localY = wy; L.angle = worldAngle; }
    return;
  }
  if (el.kind === 'slinky') {        // ★端を物体に重ねたら取り付け、外したらその場に固定
    const S = el.slinky, end = el.end;
    if (end === 'A' || end === 'B') {
      // ★先端おもりの付いた端。おもりは端と一緒に運ばれてくるので、判定からは外す
      //   （そうしないと、おもり自身が必ず最前面の当たり先になって物体へ渡せない）。
      //   下に別の物体があればそちらへ付け替え、無ければ付いたままにする。
      const tip = slinkyEndTip(S, end);
      if (tip) {
        const under = hits.find(b => b !== tip) || null;
        if (!under) { updateSlinkyPanel(S); return; }
        removeSlinkyTip(S, end);
        top = under;
      } else {
        const other = (end === 'A') ? S.bodyB : S.bodyA;
        if (top && other && top === other) top = hits[1] || null;   // 同一物体の両端は作らない
      }
      // ★ドラッグ中（setElementWorldPos）と同じ判定・同じ置き方をここでもう一度通す。
      //   置き方を別に書くと、放した瞬間だけ端が別の場所へ跳ぶ。
      setSlinkyEnd(S, end, top, wx, wy);
      if (d.dist0 != null) refitSlinkyRest(S, d.dist0, d.rest0);   // 付け替えで端が跳んでも合わせ直す
    }
    updateSlinkyPanel(S);
    return;
  }
  if (el.kind === 'wave') {
    const S = el.source;
    if (top) { const a = getLocalAnchor(top, wx, wy); S.body = top; S.localX = a.x; S.localY = a.y; }
    else     { S.body = null; S.localX = wx; S.localY = wy; }
    return;
  }
  if (el.kind === 'emfield' || el.kind === 'heatfield' || el.kind === 'flowfield') return;   // ★領域は物体に取り付かない（世界に置くだけ）
  if (el.kind === 'thruster') {
    const b = el.body, th = el.thr;
    const worldDir = th.worldDir();
    removeThruster(b, th);
    _wake(b);
    if (!top) { clearElementSelection(); return; }  // 物体の外 → 削除
    // ★動力そのものを移す（作り直さない）。id が変わらないので、つないであった
    //   リモコンは乗り換え先でもそのまま効き続ける。
    const a = getLocalAnchor(top, wx, wy);
    th.body = top;
    th.localX = a.x; th.localY = a.y;
    th.dir = worldDir - top.angle;                  // 推力のワールド向きを保つ
    top.thrusters.push(th);
    _wake(top);
    el.body = top;
    updateThrusterPanel(th);
    return;
  }
  if (el.kind === 'tracer') {
    const b = el.body;
    const col = b.tracerColor;
    b.tracerEnabled = false; b.tracePoints = []; b.tracerAnchorX = 0; b.tracerAnchorY = 0;
    if (!top) { clearElementSelection(); return; }  // 物体の外 → 削除
    const a = getLocalAnchor(top, wx, wy);
    top.tracerEnabled = true;
    top.tracerAnchorX = a.x; top.tracerAnchorY = a.y;
    top.tracerColor = col; top.tracePoints = [];
    el.body = top;
    updateTracerPanel(top);
  }
}

// ════════════════════════════════════════
//  選択の変換（回転・等比拡大縮小）
//   非等比は実装しない。剛体は「位置＋角度＋形状」しか持てないため、回転した物体を
//   世界軸方向に非等比で拡大すると、正しい結果を得るのにせん断が必要になり表現できない。
// ════════════════════════════════════════
