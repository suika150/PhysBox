function getCanvasPos(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX||e.touches?.[0]?.clientX||0) - r.left;
  const y = (e.clientY||e.touches?.[0]?.clientY||0) - r.top;
  return { x, y };
}
// 編集ツールでの物体ドラッグを後始末する。
//   held を落とすのは本来 mouseup の pointer 分岐だけだが、ドラッグ途中にツールを
//   切り替えると mouseup が別分岐に入り、後始末が誰にも実行されない。held が立った
//   ままの物体は body.js の integrate が早期 return するため、二度と動かなくなる。
function cancelPointerBodyDrag() {
  if (pointerInitialOffsets) {
    for (const id in pointerInitialOffsets) {
      const b = objects.find(o => o.id === Number(id));
      if (b) b.held = false;
    }
  }
  pointerMoveStart = null;
  pointerInitialOffsets = null;
  pointerElemOffsets = null;
  pointerPress = null;
  moveUndoArmed = false;
  refreshSnapButtons();
}
// ★編集ツールは「押しただけ＝選ぶだけ」「押したまま少し動かした＝持つ」で分ける。
//   以前は押した瞬間に held を立てていたので、実行中の物体はクリックしている間だけ止まり、
//   手ぶれがグリッドの1目盛りを越えると1マス飛んで速度も 0 になった。
//   見分けは押している時間ではなく動かした距離で行う（OS のドラッグと同じ作法。
//   時間で分けると、並べる・組み立てる操作が毎回待たされる）。画面px なのでズームに依らない。
const DRAG_START_PX = 4;   // [画面px]
// 押した点から DRAG_START_PX 動いたか。越えた瞬間に一度だけ、控えておいた持ち上げ処理を走らせる。
function pointerDragPassed(sp) {
  const pp = pointerPress;
  if (!pp) return true;                  // 押した点を控えていない経路（念のため従来どおり）
  if (pp.passed) return true;
  if (Math.hypot(sp.x - pp.sx, sp.y - pp.sy) < DRAG_START_PX) return false;
  pp.passed = true;
  if (pp.begin) { const f = pp.begin; pp.begin = null; f(); }
  return true;
}
// 物体をまとめて運ぶ準備は、閾値を越えるまで遅らせる（held を立てるのはそのとき）。
//   基準位置 anchorFn もそのときに読む：実行中は押してから動かし始めるまでに物体が進むので、
//   押した瞬間の位置を使うと動かし始めに物体がそこまで引き戻される。
function deferPointerGroupMove(snapped, anchorFn) {
  pointerPress.begin = () => {
    beginPointerGroupMove(snapped, anchorFn ? anchorFn() : null);
    recordJointDragLengths();
  };
}
// 選択中の物体＋要素（レーザー・波源）をまとめて平行移動する準備（開始位置を控える）
//   anchorPos ＝ グリッドに乗せる基準（掴んだ物体／要素の元の位置）。pointerMoveStart に
//   持たせておけば、これを null に戻している箇所すべてで一緒に消える。
function beginPointerGroupMove(snapped, anchorPos) {
  // ★溶接・ヒンジ・モーターで繋がった相手も一緒に運ぶ。杭（背景アンカー）も同じだけずらすので、
  //   jointAnchors に開始位置を控えておく。pointerMoveStart に持たせれば、これを null に
  //   戻している箇所すべてで一緒に消える。
  const group = rigidlyLinkedBodies(selectedIds);
  // ★器を掴んだら蓋も一緒に運ぶ（容器の置き場所を変える操作）。蓋だけを掴んだときは
  //   連れが付かないので、蓋は軸上を滑るだけになる＝気体の体積を手で決める操作になる。
  for (const b of vesselCompanions(group)) group.add(b);
  pointerMoveStart = { x: snapped.x, y: snapped.y,
                       // ★押した点そのもの（丸める前）。Ctrl/Alt でスナップを途中から入れ切り
                       //   するので、移動量は丸めていない点から測ってから丸める。
                       raw: pointerPress ? screenToWorld(pointerPress.sx, pointerPress.sy)
                                         : { x: snapped.x, y: snapped.y },
                       snapHit: null,     // 物体スナップで吸着した相手の特徴点（マーカー表示用）
                       anchor: anchorPos ? { x: anchorPos.x, y: anchorPos.y } : null,
                       jointAnchors: backgroundAnchorsOf(group),
                       // ★範囲選択で選んだジョイントの端。開始時のワールド位置を控えて、以後は
                       //   「開始位置＋総移動量」で置き直す（差分の積算だと、掴んでいる間に
                       //   取り付け先が動いたときにずれが溜まる。物体側と同じ流儀）。
                       jointEnds: selectedJointEndList().map(({ j, end }) => {
                         const w = (end === 'A') ? j.getWorldAnchorA() : j.getWorldAnchorB();
                         return { j, end, x0: w.x, y0: w.y };
                       }),
                       // ★スリンキーの端も同じ流儀で開始位置を控える
                       slinkyEnds: selectedSlinkyEndList().map(({ S, end }) => {
                         const n = slinkyEndNode(S, end);
                         return { S, end, x0: n.x, y0: n.y };
                       }) };
  pointerInitialOffsets = {};
  pointerElemOffsets = {};
  moveUndoArmed = true;
  for (const b of group) {
    pointerInitialOffsets[b.id] = { x: b.x, y: b.y };
    b.held = true;                      // 手動移動中は物理を止める（integrate が早期 return）
  }
  for (const o of selectedElemList())   // 背景固定なので localX/Y がワールド座標
    pointerElemOffsets[o.id] = { x: o.localX, y: o.localY };
}
// 一時停止中にロープのチェーンを進める時間 [s]。
//   mousemove は表示のリフレッシュレートぶん飛んでくる（120Hz なら毎秒120回）ので、
//   固定の 1/60 を渡すとロープだけが実時間の倍速で落ち、掴んで動かす間ずっとざわつく。
//   実経過時間を渡せば、モニタが何Hzでも再生中と同じ速さでたるみが落ち着く。
let pausedRopeClock = 0;              // [ms] 前回チェーンを進めた時刻（0=未計測）
function pausedRopeDt() {
  const now = performance.now();
  const prev = pausedRopeClock || now;
  pausedRopeClock = now;
  return Math.min(1/30, Math.max(0, (now - prev) / 1000));   // 間が空いたときは 1/30 で頭打ち
}
// ── 描きかけの図形を「始点に戻って閉じる」判定 ────────────────────────
//   多角形ツールは確定のダブルクリックでも作れるが、1発目の mousedown が点を足して
//   しまうため、最後の頂点が二重になった図形ができる（凸分解が途中で止まり、当たり
//   判定に穴が空く原因になっていた）。始点クリックで閉じられれば、確定の操作が
//   「点を足す」ではなく「閉じる」になるので、そもそもゴミ頂点が生まれない。
//   判定はワールドではなく画面上の距離で行う（ズームで感触が変わらないように）。
const CLOSE_PX = 12;              // [画面px] 始点に戻ったとみなす半径
const CLOSE_MIN_PTS = 3;          // これ未満では閉じない（2点で閉じると退化する）
function nearDrawStart(p, minPts = CLOSE_MIN_PTS) {
  if (drawPts.length < minPts) return false;
  const r = CLOSE_PX / cam.zoom;
  return (p.x - drawPts[0].x) ** 2 + (p.y - drawPts[0].y) ** 2 <= r * r;
}
// フリーハンドを「一周した」とみなしてよいか。
//   ドラッグで描くので、始点から出てすぐ戻る手ぶれと、本当に一周したのとを
//   区別する必要がある。描いた道のりが十分に長く、かつ始点から一度きちんと
//   離れていることを条件にする。
const FREEHAND_CLOSE_PX = 16;     // [画面px] 多角形より少し広め（ドラッグは狙いにくい）
function freehandCanClose(p) {
  const n = drawPts.length;
  if (n < 8) return false;
  const r = FREEHAND_CLOSE_PX / cam.zoom;
  const p0 = drawPts[0], cur = p || drawPts[n - 1];
  if ((cur.x - p0.x) ** 2 + (cur.y - p0.y) ** 2 > r * r) return false;
  let path = 0, away = 0;
  for (let i = 1; i < n; i++) {
    path += Math.hypot(drawPts[i].x - drawPts[i-1].x, drawPts[i].y - drawPts[i-1].y);
    const d = Math.hypot(drawPts[i].x - p0.x, drawPts[i].y - p0.y);
    if (d > away) away = d;
  }
  return path > r * 8 && away > r * 3;   // 十分な道のりと、始点から一度離れたこと
}
// いまカーソルのある位置で図形を閉じられるか（プレビューの強調表示に使う）
function canCloseDrawing(p) {
  if (currentTool === 'polygon')  return polyDrawing && nearDrawStart(p);
  if (currentTool === 'freehand') return freehandCanClose(p);
  return false;
}
function snapPt(p) {
  if (!gridSnapActiveNow()) return p;
  return gridPt(p);
}
function gridPt(p) {
  const gs = gridStep();
  return { x: Math.round(p.x/gs)*gs, y: Math.round(p.y/gs)*gs };
}
// ★押している間だけスナップを反転する：Ctrl＝グリッドスナップ／Alt＝物体スナップ。
//   ★キーの左右を上バーのボタンの並び（左＝グリッド、右＝物体）とそろえてある。
//   「押している間だけ有効」だが、常時オンにしてあるときは押している間だけ外れる
//   （速度ツールの Alt と同じ「押している間だけ逆」の作法。微調整で吸着を外したいときに使う）。
//   ★Shift はどのツールでも「形・角度の拘束」（正方形・角度スナップ）に使っているので空けておく。
//     移動と作成で同じキーが同じ意味になるよう、両方とも Ctrl/Alt にそろえてある。
//   効かせるのは作る・運ぶ操作だけ：
//     - 編集ツール：何かを掴んで動かしている間だけ（押した瞬間の Ctrl は追加選択、
//       Alt は回路の端点だけを掴む、という別の意味があるため）
//     - つかむ・速度ツール：対象外（速度ツールの Alt は「狙う」への反転）
//     - 注釈ツール：対象外（物体ではない）
function snapModsApply() {
  if (currentTool === 'pointer') return isMouseDown && !!pointerPress && pointerPress.passed;
  if (currentTool === 'pan' || currentTool === 'velocity') return false;
  return !isAnnotToolActive();
}
const pointerGroupMoving = () => currentTool === 'pointer' && isMouseDown && !!pointerMoveStart && !!pointerInitialOffsets;
// いま実際に効いているスナップ（修飾キーの反転込み）
const gridSnapActiveNow = () => snapModsApply() ? snapEnabled    !== modCtrl : snapEnabled;
const objSnapActiveNow  = () => snapModsApply() ? objSnapEnabled !== modAlt  : objSnapEnabled;
// ★上バーのスナップボタンは「いま効いているか」で光らせる。Ctrl/Alt で一時的に入れた
//   （外した）ことがボタンから見えないと、効いているのかどうか分からない。
//   押している間の見た目だけを変え、snapEnabled/objSnapEnabled そのものは書き換えない。
function refreshSnapButtons() {
  const bg = document.getElementById('btn-grid');  if (bg) bg.classList.toggle('on', gridSnapActiveNow());
  const bo = document.getElementById('btn-osnap'); if (bo) bo.classList.toggle('on', objSnapActiveNow());
}
// 物体の特徴点（中心・頂点・辺の中点）を f(x, y, kind) へ順に渡す
function forEachSnapFeature(b, f) {
  f(b.x, b.y, 'center');                         // 重心＝回転の支点。ここが最も要求の多い点
  if (b.type === 'circle') return;               // 円は輪郭に頂点を持たない
  for (const loop of [b._worldVerts(), ...b._worldHoles()]) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const v = loop[i], w = loop[(i+1)%n];
      f(v.x, v.y, 'vertex');
      f((v.x+w.x)/2, (v.y+w.y)/2, 'mid');
    }
  }
}
function objSnapFind(p) {
  if (!objSnapActiveNow()) return null;
  const r = OBJ_SNAP_PX / cam.zoom;
  let best = null, bd = r * r;
  const test = (x, y, kind, b) => {
    const d = len2(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = { x, y, kind, body: b }; }
  };
  for (const b of objects) {
    const a = b._aabb;
    if (p.x < a.minX-r || p.x > a.maxX+r || p.y < a.minY-r || p.y > a.maxY+r) continue;
    forEachSnapFeature(b, (x, y, kind) => test(x, y, kind, b));
  }
  return best;
}
// 運んでいる一団の特徴点を、止まっている物体の特徴点へ吸着させる補正量を探す。
//   (dx, dy) は開始位置からの仮の移動量。一番近い組を1つだけ採り、{cx, cy}＝足すべき補正。
//   ★運ぶ側は回転しないので、いまの姿勢の特徴点を「仮の位置 − いまの位置」だけずらせば足りる。
function objSnapForMove(dx, dy) {
  const offs = pointerInitialOffsets;
  const r = OBJ_SNAP_PX / cam.zoom;
  const mv = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id in offs) {
    const b = objects.find(o => o.id === Number(id));
    if (!b) continue;
    const ox = offs[id].x + dx - b.x, oy = offs[id].y + dy - b.y;
    forEachSnapFeature(b, (x, y, kind) => {
      x += ox; y += oy;
      mv.push({ x, y, kind });
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
  }
  if (!mv.length) return null;
  let best = null, bd = r * r;
  for (const b of objects) {
    if (b.id in offs) continue;                  // 一緒に運んでいるものには吸着しない
    const a = b._aabb;
    if (a.maxX < minX-r || a.minX > maxX+r || a.maxY < minY-r || a.minY > maxY+r) continue;
    forEachSnapFeature(b, (x, y, kind) => {
      for (const m of mv) {
        const d = len2(x - m.x, y - m.y);
        if (d < bd) { bd = d; best = { cx: x - m.x, cy: y - m.y, x, y, kind, body: b }; }
      }
    });
  }
  return best;
}
// 設置点用のスナップ。特徴点が優先で、無ければ従来どおり格子へ落とす
function snapPlace(p) {
  const s = objSnapFind(p);
  return s ? { x: s.x, y: s.y } : snapPt(p);
}
// 選択した物体（＋連れ・要素・ジョイント端）を、掴んだ点が wp に来るよう平行移動する。
//   ★mousemove の外（Shift/Alt を押した・放した瞬間）からも呼ぶので関数に切り出してある。
function movePointerGroupTo(wp) {
  const pm = pointerMoveStart;
  refreshSnapButtons();                          // ★動かし始めた時点で既に Alt/Ctrl を押していた場合
  let dx = wp.x - pm.raw.x;
  let dy = wp.y - pm.raw.y;
  // ★物体スナップが先。特徴点どうしが吸着半径に入ったらそれを採り、無ければグリッドへ落とす
  //   （配置の snapPlace と同じ優先順）。
  pm.snapHit = null;
  const hit = objSnapActiveNow() ? objSnapForMove(dx, dy) : null;
  if (hit) {
    dx += hit.cx; dy += hit.cy;
    pm.snapHit = hit;
  } else if (gridSnapActiveNow()) {
    // ★グリッドスナップ中は、掴んだものの位置そのものをグリッドへ乗せる。
    //   差分だけを丸めると、動く量はグリッド刻みでも物体はグリッドから外れたまま
    //   平行移動するだけになる（矩形は角がグリッドに乗るよう置かれるので、中心は
    //   半端な位置にあることが多く、いつまでもグリッドに揃わない）。
    //   ★ここへ来るのは DRAG_START_PX を越えてから＝選ぶだけのクリックで物体が
    //     グリッドへ飛ぶことはない。
    if (pm.anchor) {
      const a = pm.anchor;
      const t = gridPt({ x: a.x + dx, y: a.y + dy });
      dx = t.x - a.x; dy = t.y - a.y;
    } else {
      const gs = gridStep();                     // 基準が無い一団（ジョイントの線を掴んだ）は移動量を刻む
      dx = Math.round(dx/gs)*gs; dy = Math.round(dy/gs)*gs;
    }
  }
  if (moveUndoArmed && (dx !== 0 || dy !== 0)) { pushUndo(); moveUndoArmed = false; }
  // selectedIds ではなく pointerInitialOffsets を回す。固定などで連れられた物体は
  // 選択されていないが、この一団として一緒に動かす必要がある。
  // ★背景固定の端を物体と一緒に平行移動させることはしない。背景アンカーは
  //   「世界に打った杭」なので、物体を動かせば伸びるのが自然で、相手が
  //   物体のとき（伸びる）とも挙動が揃う。長さの辻褄は離したときに
  //   refitJointLengthsForMovedBodies() が合わせる。
  const movers = [];
  for (const id in pointerInitialOffsets) {
    const b = objects.find(o => o.id === Number(id));
    if (!b) continue;
    const initPos = pointerInitialOffsets[id];
    movers.push({ b, fx: b.x, fy: b.y, tx: initPos.x + dx, ty: initPos.y + dy });
    for (const j of joints)
      if (j.type === 'rope' && (j.bodyA === b || j.bodyB === b)) { j._calmT = 0; j._anchorCalmT = 0; }
  }
  // ★一時停止中、場面にロープがあるときは 4px 刻みで運び、そのつどロープの
  //   当たり判定をやり直す。updateRopeChains は1回の呼び出しにつき1回しか接触を
  //   検出しないので、カーソルの移動量ぶんを一気に運ぶと物体がロープを飛び越えて
  //   しまい、ひっかけられない（再生中は simTick が毎サブステップ呼ぶので起きない）。
  //   刻み幅は接触マージン（半径3+余裕2=5px）より小さく取る。
  //   ロープの時間（重力によるたるみ）が進むのは最後の1回だけ。dt=0 の回は
  //   位置の投影だけで、時間は進まない。
  const ropeAware = !running && joints.some(j => j.type === 'rope');
  let ropeSteps = 1;
  if (ropeAware) {
    let far = 0;
    for (const m of movers) far = Math.max(far, Math.hypot(m.tx - m.fx, m.ty - m.fy));
    ropeSteps = Math.min(240, Math.max(1, Math.ceil(far / 4)));       // 上限で暴走を防ぐ
  }
  for (let k = 1; k <= ropeSteps; k++) {
    const f = k / ropeSteps;
    for (const m of movers) {
      m.b.x = m.fx + (m.tx - m.fx) * f;
      m.b.y = m.fy + (m.ty - m.fy) * f;
      m.b._updateAABB();
    }
    // ★長さをドラッグに追随させてからチェーンを進める。長さが古いままだと、端点間
    //   距離が maxLength を超えた瞬間にリンク拘束（等式）がたるみを食いつぶして
    //   直線になってしまう。長さは「開始時＋差分」なので、ここで何度呼んでも
    //   二重に伸びない（refitJointLengthsForMovedBodies は冪等）。
    if (ropeAware) { refitJointLengthsForMovedBodies(); updateRopeChains(k === ropeSteps ? pausedRopeDt() : 0, false); }
  }
  // ★ばね（Slinky）の自然長もドラッグに追随させる。離したときだけ合わせると、運んでいる
  //   間だけ伸びて見え、離した瞬間に縮む（ロープと手応えが揃わない）。冪等なので何度呼んでもよい。
  if (!ropeAware && slinkies.length) refitJointLengthsForMovedBodies();
  // ★容器の部品は、運んだあとに拘束を掛け直す。停止中は enforcePistonVessels が
  //   走らないので、ここを通さないと蓋が軸から外れたまま置ける。
  //   蓋だけを運んだ場合はここで体積が変わる＝気体の状態も作り直される。
  applyVesselManualMove(new Set(movers.map(m => m.b.id)));
  for (const m of movers) {
    reanchorGuide(m.b);                    // ★軸もドラッグに追従させる（離した先で急に現れないように）
    m.b.clearForces(); m.b._forcesSmooth = null;
  }
  // ★背景に打った杭も一緒に運ぶ（溶接・ヒンジ・モーターのみ。バネ・ロープの杭は動かさない）
  for (const a of pointerMoveStart.jointAnchors || []) {
    if (a.end === 'A') { a.j.anchorAx = a.x0 + dx; a.j.anchorAy = a.y0 + dy; }
    else               { a.j.anchorBx = a.x0 + dx; a.j.anchorBy = a.y0 + dy; }
  }
  if (pointerElemOffsets) {          // ★範囲選択したレーザー・波源も同じだけ平行移動
    for (const o of boxSelectableElements()) {
      const init = pointerElemOffsets[o.id];
      if (!init) continue;
      o.localX = init.x + dx; o.localY = init.y + dy;
    }
  }
  // ★範囲選択したばね・ロープ・棒の端も同じだけ平行移動（selection.js の★を参照）
  if (pointerMoveStart.jointEnds && pointerMoveStart.jointEnds.length)
    movePointerJointEnds(pointerMoveStart.jointEnds, dx, dy);
  if (pointerMoveStart.slinkyEnds && pointerMoveStart.slinkyEnds.length)
    movePointerSlinkyEnds(pointerMoveStart.slinkyEnds, dx, dy);
}
canvas.addEventListener('mousemove', e => {
  modShift = e.shiftKey;
  modAlt   = e.altKey;      // ★速度ツール：ドラッグの向き（引っぱる↔狙う）の一時反転／それ以外：物体スナップの反転
  modCtrl  = e.ctrlKey || e.metaKey;   // ★グリッドスナップの反転
  const sp = getCanvasPos(e);
  const wp = screenToWorld(sp.x, sp.y);
  mouseScreen = sp; mouseWorld = wp;
  document.getElementById('st-pos').textContent = `${(wp.x*PX2M).toFixed(2)}, ${yUI(wp.y*PX2M).toFixed(2)} m`;
  if (currentTool==='pointer') {
    // 実際に選ばれるものと同じ判定にする（許容ぶんも光るので、どこまで拾えるか見える）
    const hov = bodyNearestToPoint(wp.x, wp.y, PICK_TOL_PX);
    hoveredId = hov ? hov.id : null;
  }
  // ★注釈ツール：カーソルで「いま押したら何が起きるか」を見せる（置く／掴む／書き直す）
  if (isAnnotToolActive()) refreshAnnotCursor(wp);
  if (!isMouseDown) return;
  if (e.buttons === 2) {
    const dx=(sp.x-lastMouseScreen.x)/cam.zoom;
    const dy=(sp.y-lastMouseScreen.y)/cam.zoom;
    cam.x-=dx; cam.y-=dy;
    followAbsorbCam();          // 追従中でも手動で少しずらして見られるようにする
    lastMouseScreen=sp;
    return;
  }
  if (currentTool === 'pan' && circuitHold) { dragCircuitHoldTo(wp); return; }
if (currentTool === 'pan' && activeMouseJoint) {
    // ★Shift を押している間は、掴んだ向きのまま運ぶ（押した瞬間の角度を覚える）。
    //   速度ツールの Alt と同じで、ドラッグの途中で押し引きできる。
    activeMouseJoint.syncAngleLock(modShift);
    if (running) {
      activeMouseJoint.targetX = wp.x;
      activeMouseJoint.targetY = wp.y;
    } else {
      const mj = activeMouseJoint;
      const sx = mj.targetX, sy = mj.targetY;
      const dist = Math.hypot(wp.x - sx, wp.y - sy);
      const STEP = 4;                                            // [px] 接触マージン以下に保つ
      const n = Math.min(240, Math.max(1, Math.ceil(dist / STEP)));   // 上限で暴走を防ぐ
      for (let i = 1; i <= n; i++) {
        // 目標を進めるときは本体も同じだけ運ぶ（moveTarget）。邪魔が無ければ回転しない。
        mj.moveTarget(sx + (wp.x - sx) * (i / n), sy + (wp.y - sy) * (i / n));
        // ★ロープのチェーンだけは最後の1回でしか進めない。
        //   このサブステップ分割は「拘束を収束させる」ためのもので時間経過ではないが、
        //   updateRopeChains は時間積分なので、毎回呼ぶとカーソルを速く動かすほど
        //   ロープが余計に時間を進めてしまい（400px 動かすと 1.67 秒ぶん）暴れる。
        //   チェーンは1イベントにつき1回・実経過時間ぶんだけ進めれば、再生中と同じ進み方になる。
        applyPausedConstraints(i === n);
      }
    }
  }

  // ★閾値を越えるまでは、編集ツールのドラッグ（移動・拡大縮小・回転・範囲選択）をすべて保留する
  if (currentTool === 'pointer' && pointerDragPassed(sp)) {
    if (counterDrag) {
      dragCounterTo(wp, e.shiftKey);              // ★通過カウンタの端／線ごと
    } else if (waveProbeDrag) {
      dragWaveProbeTo(wp);                        // ★波の受信器の印（離した所の物体に付け替える）
    } else if (spdMeterDrag) {
      dragSpdMeterTo(wp);                         // ★速さの分布計の角／枠ごと
    } else if (circuitGroupDrag) {
      dragCircuitGroupTo(wp);                     // ★まとめて選んだ回路素子の平行移動
    } else if (circuitVertexDrag) {
      dragCircuitVertexTo(wp);                    // ★回路素子の端点ドラッグ
    } else if (circuitWholeDrag) {
      dragCircuitWholeTo(wp);                     // ★回路素子の中央を掴んでの平行移動
    } else if (boxDrag) {
      updateBoxDrag(wp);                          // ★選択枠ハンドルのドラッグ
    } else if (emFieldResize) {
      updateEMFieldResize(wp);                    // ★電場・磁場の領域のサイズ変更
    } else if (elementRotate) {
      rotateElementTo(wp);                        // ★向きハンドルのドラッグ＝向きの再設定
    } else if (jointWholeDrag) {
      dragJointWholeTo(wp);                       // ★ばね/ロープ/棒の線を掴んでの平行移動
    } else if (particleDrag) {
      dragParticlesTo(wp);                        // ★選んだ粒子のまとめて平行移動
    } else if (elementDrag) {
      dragElementTo(wp);                          // ★要素（ジョイント端/動力/軌跡/レーザー）の平行移動
    } else if (pointerMoveStart && pointerInitialOffsets) {
      movePointerGroupTo(wp);                     // ★選択した物体などのまとめて平行移動
    } else if (dragStart) {
      const dw = wp.x - dragStart.x, dh = wp.y - dragStart.y;
      selRect = {x: dragStart.x + (dw < 0 ? dw : 0), y: dragStart.y + (dh < 0 ? dh : 0), w: Math.abs(dw), h: Math.abs(dh)};
    }
  }
  if (currentTool === 'velocity' && dragStart) {   // ★矩形選択のプレビュー（編集ツールと同じ規則）
    const dw = wp.x - dragStart.x, dh = wp.y - dragStart.y;
    selRect = { x: dragStart.x + (dw < 0 ? dw : 0), y: dragStart.y + (dh < 0 ? dh : 0),
                w: Math.abs(dw), h: Math.abs(dh) };
  }
  if (annotMouseMove(wp)) { lastMouseScreen = sp; return; }   // ★注釈の平行移動・回転
  if (currentTool==='freehand' && drawPts.length > 0) {
    const last=drawPts[drawPts.length-1];
    const snapped=snapPt(wp);
    const dd=(snapped.x-last.x)**2+(snapped.y-last.y)**2;
    if (dd>50) drawPts.push(snapped);
    // ★始点まで戻ってきたら、そこで閉じて確定する。
    //   通り過ぎてなぞり続けると輪郭が自分自身と交差し、三角形分割が破綻して
    //   「見た目はあるのに当たらない」形になるため、その手前で切り上げる。
    //   描き始めの手ぶれで即確定しないよう、点数と描いた道のりで条件を絞る。
    //   判定はカーソルの現在位置で行う。点は一定距離動くごとにしか打たれないので、
    //   最後に打たれた点で見ると始点へ戻ったのに気づくのが遅れる。
    if (freehandCanClose(snapped)) { finishFreehand(); isMouseDown = false; }
  }
  if ((currentTool==='fluid'||currentTool==='gas') && isMouseDown) {
    spawnParticles(snapPt(wp), currentTool);
  }
  lastMouseScreen = sp;
});
// ★電場・磁場の領域は内側をダブルクリックでも選べる。枠が画面外に出るほど大きい領域の
//   ための逃げ道（枠クリックは mousedown の emFieldEdgeAtPoint が担当）。
//   1打目のシングルクリックは素通りして選択解除／範囲選択の開始になるが、dblclick は
//   mouseup のあとに来るので、こちらの選択が最後に残る。
canvas.addEventListener('dblclick', e => {
  const sp0 = getCanvasPos(e);
  // ★注釈ツール中は、ダブルクリックで文字の編集に入る（配置と同じその場編集）
  if (annotDblClick(screenToWorld(sp0.x, sp0.y))) return;
  if (currentTool !== 'pointer') return;
  const sp = getCanvasPos(e);
  const wp = screenToWorld(sp.x, sp.y);
  const f = emFieldAtPoint(wp.x, wp.y);
  if (f) {
    clearAllSelections();
    selRect = null; dragStart = null;
    selectedElement = { kind: 'emfield', field: f };
    updateEMFieldPanel(f);
    document.getElementById('st-sel').textContent = f.kind === 'E' ? '電場' : '磁場';
    return;
  }
  const h = heatFieldAtPoint(wp.x, wp.y);      // ★加熱・冷却の領域も内側のダブルクリックで選べる
  if (h) {
    clearAllSelections();
    selRect = null; dragStart = null;
    selectedElement = { kind: 'heatfield', field: h };
    updateHeatFieldPanel(h);
    document.getElementById('st-sel').textContent = h.kindName();
    return;
  }
  const fl = flowFieldAtPoint(wp.x, wp.y);     // ★流れの場も同じ（内側のダブルクリックで選べる）
  if (!fl) return;
  clearAllSelections();
  selRect = null; dragStart = null;
  selectedElement = { kind: 'flowfield', field: fl };
  updateFlowFieldPanel(fl);
  document.getElementById('st-sel').textContent = '流れの場';
});

canvas.addEventListener('mousedown', e => {
  e.preventDefault();
  // ★preventDefault はフォーカスの移動も止める。Web アプリ（Apps Script）は iframe の中で動くので、
  //   キャンバスをクリックしても iframe にフォーカスが入らず、Space・Z・Esc・リモコンのキーが
  //   一切届かなかった（ボタンを一度押すまで）。自分で窓にフォーカスを取る。
  //   physBox.html を直接開いたときは元々フォーカスを持っているので何も変わらない。
  window.focus();
  if (colorPickerOpen) {               // ★ピッカー表示中：左クリックは設置せず、ピッカーを閉じるだけ
    closeColorPicker();
    if (e.button === 0) return;
  }
  isMouseDown = true;
  wakeAll();
  const sp = getCanvasPos(e);
  const wp = screenToWorld(sp.x, sp.y);
  lastMouseScreen = sp;
  const snapped = snapPt(wp);
  const ctrlHeld = e.ctrlKey || e.metaKey;   // 追加選択専用（配置のスナップには使わない）
  const shiftHeld = e.shiftKey;
  const placed = snapPlace(wp);              // 配置系ツール（ジョイント/動力/レーザー/光学/軌跡）用
  if (e.button === 2) {
    rightClickStart = sp; 
    return;
  }
  if (currentTool === 'pan') {
    // ★回路の表も動かせる（デモは編集ツールを要求しないので、つかむツールでも置き直せるように）
    if (beginCircTableDragIfHit(wp)) return;
    // ★少し外してもつかめる。空振りしても何も起きないツールなので、判定は緩くてよい
    const clicked = bodyNearestToPoint(wp.x, wp.y, GRAB_TOL_PX);
    if (clicked) {
      selectNewBody(clicked);   // ★つかんだ物体を選択状態にする（静的物体も選択のみ可）
      // ★生成口も掴めない（掴むのは物理的に引っぱること＝物理に参加しない物には効かない）。
      //   編集ツールでの移動はできるので、置き直しはそちらで行う。
      if (!clicked.isStatic && !clicked.isSpawner) {
        // つかんだ点をローカル座標で記録し、マウスジョイントを生成
        const cosA = Math.cos(-clicked.angle), sinA = Math.sin(-clicked.angle);
        const lx = cosA*(wp.x - clicked.x) - sinA*(wp.y - clicked.y);
        const ly = sinA*(wp.x - clicked.x) + cosA*(wp.y - clicked.y);
        activeMouseJoint = new MouseJoint(clicked, lx, ly, wp.x, wp.y);
        // ★掴んだ時点で Shift を押していれば、その瞬間の向きで固定する。
        //   最初の mousemove まで待つと、その間に少し回ってから固定されてしまう
        //   （実測：棒を掴み上げると 0.11° ずれた状態で止まっていた）。
        activeMouseJoint.syncAngleLock(modShift);
        mouseJoints.push(activeMouseJoint);
        clicked._grabbed = true;
        clicked.sleeping = false; clicked.sleepTimer = 0;   // 眠ったままだと接触の押し出しが効かず地面へ潜る
        pausedRopeClock = 0;          // ロープの時間の基準を掴んだ瞬間に取り直す
      }
      return;
    }
    // ★物体が居なかったときだけ回路を掴む。順番が逆だと、レールに架かった導体棒を
    //   掴もうとしてレールのほうを掴んでしまい、棒とレールの相対運動＝実験そのものが作れない
    beginCircuitHold(wp);
    return;
  }
  if (currentTool === 'velocity') {
    const hit = bodiesForPlacement(wp, placed)[0] || null;
    const _selCount = () => document.getElementById('st-sel').textContent =
      selectedIds.size > 0 ? `${selectedIds.size}個` : 'なし';
    if (hit) {
      if (ctrlHeld) {                       // ★Ctrl+クリック＝選択の追加／解除（発射はしない）
        selectedJointId = null; selectedElement = null;
        if (selectedIds.has(hit.id)) selectedIds.delete(hit.id);
        else selectedIds.add(hit.id);
        refreshPropsForSelection();   // ★複数でも代表（一番上の物体）の値を出す＝まとめて設定できる
        _selCount();
        return;
      }
      // ★選択済みの物体を掴んだときは選択を壊さない（まとめて発射できるようにするため）
      if (!selectedIds.has(hit.id)) selectNewBody(hit);
      if (!hit.isStatic) velStart = { body: hit, x: wp.x, y: wp.y };
    } else {                                // ★何もない所からドラッグ＝矩形選択（Ctrlで追加選択）
      if (!ctrlHeld) { selectedIds.clear(); updatePropsPanel(null); }
      selectedJointId = null; selectedElement = null; clearBulkSelection();
      dragStart = snapped;
      _selCount();
    }
    return;
  }
  if (CIRCUIT_TOOLS.indexOf(currentTool) >= 0) {
    if (!circuitStart) placeCircuitFirstClick(wp);
    else placeCircuitSecondClick(wp, shiftHeld);
    return;
  }
  // ★注釈（テキスト・お絵描き）。編集ツールの当たり判定の列より前に置いてあるが、
  //   annotMouseDown は注釈ツールのときしか true を返さないので pointer には影響しない。
  if (annotMouseDown(wp, e)) return;
  if (currentTool === 'pointer') {
    pointerPress = { sx: sp.x, sy: sp.y, passed: false, begin: null };
    if (beginCircTableDragIfHit(wp)) return;   // ★回路の表（画面の最前面の札）を掴んで動かす
    if (beginDirRotateIfHit(wp)) return;   // ★選択中の要素の向きハンドルを最優先で掴む
    if (beginBoxHandleIfHit(wp)) return;   // ★選択枠の回転／拡大縮小ハンドル（枠の外側なのでマーカーと競合しにくい）
    if (beginEMFieldResizeIfHit(wp)) return;   // ★選択中の電場・磁場の領域のサイズ変更ハンドル
    if (beginCounterDragIfHit(wp)) return;     // ★通過カウンタの線（最前面に描くので物体より先。counter.js の★）
    if (beginWaveProbeDragIfHit(wp)) return;   // ★波の受信器の印（同上。wavegraph.js の★）
    if (beginSpdMeterDragIfHit(wp)) return;    // ★速さの分布計の角・枠（同上。内側は掴まない＝spdmeter.js の★）
    // ★選んである粒子の群れを掴んだら、まとめて平行移動。物体の当たり判定より先に見る
    //   （水の中に沈んだ物体があっても、選んだ水を運ぶつもりの操作を横取りされない）。
    if (hitSelectedParticle(wp) && beginParticleDrag(wp)) return;
    // ★Ctrl+クリックで回路素子を選択に足す／外す。まとめての移動・端点ドラッグより先に見る
    //   （一括選択の一員を Ctrl+クリックで外そうとして、まとめて動かし始めないように）。
    if (ctrlHeld && ctrlToggleCircuitIfHit(wp)) return;
    // ★まとめて選んだ回路素子のどれかを掴んだら、全体を平行移動する。
    //   端点ドラッグより先に見る（まとまりを運ぶつもりで端を掴んで、1本だけ伸びるのを防ぐ）。
    if (beginCircuitGroupDragIfHit(wp)) return;
    if (beginCircuitVertexDragIfHit(wp, e.altKey)) return;   // ★回路素子の端点を掴んで動かす（Alt=この端点だけ）
    const el = pickElement(wp.x, wp.y);
    // ★範囲選択の対象になる要素（背景固定のレーザー・波源）を掴んだときの扱い
    const elBoxObj = el && (el.kind === 'laser' ? el.laser : el.kind === 'wave' ? el.source : null);
    if (elBoxObj && !elBoxObj.body) {
      if (ctrlHeld) {                                // Ctrl+クリック＝範囲選択への追加／解除
        selectedElement = null; selectedJointId = null; clearBulkSelection();
        if (selectedElemIds.has(elBoxObj.id)) selectedElemIds.delete(elBoxObj.id);
        else selectedElemIds.add(elBoxObj.id);
        refreshPropsForSelection();
        refreshSelCount();
        return;
      }
      if (selectedElemIds.has(elBoxObj.id) && selectionCount() > 1) {
        // 掴んだ要素（背景固定なので localX/Y がワールド座標）をグリッドの基準にする
        deferPointerGroupMove(snapped, () => ({ x: elBoxObj.localX, y: elBoxObj.localY }));   // 選択したグループの一員を掴んだ＝まとめて平行移動
        return;
      }
    }
    // ★範囲選択に入っているジョイントの端を掴んだら、一団としてまとめて平行移動する
    //   （レーザー・波源で elBoxObj がやっているのと同じ扱い）。単独で選ばれているだけなら
    //   従来どおりの端ドラッグでよい＝結果は同じで、そちらのほうが縄の出し入れが効く。
    if (el && el.kind === 'joint' && el.end && isJointEndSelected(el.joint, el.end)
        && selectionCount() > 1) {
      deferPointerGroupMove(snapped, () => { const w = elementWorldPos(el); return { x: w.x, y: w.y }; });
      return;
    }
    if (el) {
      clearAllSelections();
      selectedElement = el;                       // ★ジョイント端も選択要素として保持（平行移動用）
      if (el.kind === 'joint') {
        selectedJointId = el.joint.id;
        updateJointPanel(el.joint);
        document.getElementById('st-sel').textContent = 'ジョイント';
      }
      else if (el.kind === 'laser')    { updateLaserPanel(el.laser);   document.getElementById('st-sel').textContent = 'レーザー'; }
      else if (el.kind === 'thruster') { updateThrusterPanel(el.thr); document.getElementById('st-sel').textContent = '動力'; }
      else if (el.kind === 'tracer')   { updateTracerPanel(el.body);   document.getElementById('st-sel').textContent = '軌跡'; }
      else if (el.kind === 'wave')     { updateWavePanel(el.source);   document.getElementById('st-sel').textContent = '波源'; }
    else if (el.kind === 'slinky')   { updateSlinkyPanel(el.slinky); document.getElementById('st-sel').textContent = 'ばね'; }
      beginElementDrag(el, wp);                   // ★そのままドラッグで平行移動
      return;
    }
    // ★選択していた領域（電場・磁場・加熱・冷却）を、すぐ下で選択が外れる前に控える。
    //   「選択済みの領域は内側を掴んでも動かせる」判定で使う。控えを使う所までの間で
    //   選択を書き換える枝は、どれも必ず return するので取り違えは起きない。
    const prevRectRegion   = selectedRectRegion();
    const prevRectRegionEl = selectedElement;
    selectedElement = null;
    // ★気体そのものを選ぶ。器と蓋は普通の物体なので下の物体判定に落ちるが、気体は
    //   objects に居ないのでここで拾う。判定に使うのは描いてあるのと同じ多角形
    //   （gasChamberAtPoint の★を参照）なので、見えている水色の領域を押せば選べる。
    //   圧縮しきって領域が薄いときは、範囲選択→種別選択「気体」から選ぶ。
    const chHit = gasChamberAtPoint(wp.x, wp.y);
    if (chHit) {
      clearAllSelections();
      selectedElement = { kind: 'gas', chamber: chHit };
      updateGasPanel(chHit);
      document.getElementById('st-sel').textContent = '気体';
      beginElementDrag(selectedElement, wp);   // そのままドラッグで容器ごと平行移動
      return;
    }
    // ★少し外しても選べる。ただし範囲選択と競合するので、つかむツールより控えめ
    const clicked = bodyNearestToPoint(wp.x, wp.y, PICK_TOL_PX);
    if (clicked) {
      selectedJointId = null;   // ★物体選択時はジョイント選択を解除
      clearBulkSelection();     // ★物体以外の種別一括選択も外す
      if (!(e.ctrlKey || e.metaKey)) {
        if (!selectedIds.has(clicked.id)) { selectedIds.clear(); selectedElemIds.clear(); selectedJointEnds.clear(); }
      }
      selectedIds.add(clicked.id);
      // ★refreshPropsForSelection を通す。Ctrl+クリックでレーザー等に物体を足すと種別が
      //   混ざるので、そのときは物体の欄ではなく混在の案内を出す必要がある。
      refreshPropsForSelection();
      // ★選択中のレーザーも一緒に運ぶ／掴んだ物体をグリッドの基準に。
      //   長さの変化量を出すための開始時の端点間距離も、動かし始めた時点で控える。
      deferPointerGroupMove(snapped, () => ({ x: clicked.x, y: clicked.y }));
    } else {
      // ★物体が無ければジョイント（ばね/ロープ/棒など）の線を判定
      const jHit = jointAtPoint(wp.x, wp.y);
      // ★範囲選択で両端とも選ばれているジョイントの線を掴んだら、一団として運ぶ
      if (jHit && isJointEndSelected(jHit, 'A') && isJointEndSelected(jHit, 'B')
          && selectionCount() > 2) {
        deferPointerGroupMove(snapped, null);
        return;
      }
      if (jHit) {
        selectedIds.clear();
        clearBulkSelection();   // ★1本だけを選び直す（一括選択の仲間へ値が飛ばないように）
        selectedJointId = jHit.id;
        updateJointPanel(jHit);
        document.getElementById('st-sel').textContent = 'ジョイント';
        if (JOINT_WHOLE_TYPES.includes(jHit.type)) beginJointWholeDrag(jHit, wp);   // ★中央を掴んだら全体を平行移動
        return;
      }
      const cHit = circuitAtPoint(wp.x, wp.y);
      // ★端点はここへ来る前に beginCircuitVertexDragIfHit が拾っている。
      //   つまりここは「素子の中央」＝そのままドラッグで平行移動
      if (cHit) { selectCircuitElement(cHit); beginCircuitWholeDrag(cHit, wp); return; }
      // ★電場・磁場の領域は「面」なので、物体・ジョイント・回路のどれにも当たらなかった
      //   ときだけ拾う（そうしないと領域の上にある物体が選べなくなる）。地面より手前。
      //   さらに、拾うのは枠のそばだけ。内側は素通りさせて範囲選択・選択解除を通す
      //   （内側はダブルクリックで選べる。canvas の dblclick を参照）。
      // ★粒子。物体・ジョイント・弦・回路のどれにも当たらなかったときだけ拾う
      //   （水の中の物体やロープが、水に覆われて選べなくなるのを防ぐ）。地面より手前。
      const pHit = particleAt(wp.x, wp.y, PICK_TOL_PX / cam.zoom);
      if (pHit) {
        BULK_KINDS.particle.select([pHit]);       // clearAllSelections から選択を作り直す
        document.getElementById('st-sel').textContent =
          pHit.type === 'gas' ? '気体 1個' : '液体 1個';
        beginParticleDrag(wp);                    // そのままドラッグで平行移動
        return;
      }
      // ★すでに選択している領域（電場・磁場・加熱・冷却）は、枠だけでなく内側のどこを
      //   掴んでも動かせる。未選択の領域の内側は従来どおり素通りさせる：面が広いので
      //   そこで選べると、その広さ全域で範囲選択も選択解除もできなくなる
      //   （emFieldEdgeAtPoint の★）。選択済みなら「その領域を触る」意図がはっきり
      //   しているので、内側を渡してよい。物体・粒子はここより先に判定しているので、
      //   領域の中に入っている物や水は今までどおりそちらが取れる。
      // ★Ctrl（Cmd）を押している間は素通りさせる。画面いっぱいの領域を選んだあとでも
      //   その内側から範囲選択を始められる逃げ道が要る（Esc での選択解除が無いため）。
      //   下の落ち口でも Ctrl は「選択を消さずに範囲選択」なので、意味も揃う。
      if (prevRectRegion && !e.ctrlKey && !e.metaKey && prevRectRegion.contains(wp.x, wp.y)) {
        selectedElement = prevRectRegionEl;      // 上でいったん外した選択をそのまま戻す
        beginElementDrag(selectedElement, wp);   // 選び直さない＝右パネルも触らなくてよい
        return;
      }
      const fHit = emFieldEdgeAtPoint(wp.x, wp.y);
      if (fHit) {
        clearAllSelections();
        selectedElement = { kind: 'emfield', field: fHit };
        updateEMFieldPanel(fHit);
        document.getElementById('st-sel').textContent = fHit.kind === 'E' ? '電場' : '磁場';
        beginElementDrag(selectedElement, wp);   // そのままドラッグで平行移動
        return;
      }
      const flHit = flowFieldEdgeAtPoint(wp.x, wp.y);
      if (flHit) {
        clearAllSelections();
        selectedElement = { kind: 'flowfield', field: flHit };
        updateFlowFieldPanel(flHit);
        document.getElementById('st-sel').textContent = '流れの場';
        beginElementDrag(selectedElement, wp);   // そのままドラッグで平行移動
        return;
      }
      const hHit = heatFieldEdgeAtPoint(wp.x, wp.y);
      if (hHit) {
        clearAllSelections();
        selectedElement = { kind: 'heatfield', field: hHit };
        updateHeatFieldPanel(hHit);
        document.getElementById('st-sel').textContent = hHit.kindName();
        beginElementDrag(selectedElement, wp);   // そのままドラッグで平行移動
        return;
      }
      if (world.terrain && signedDistToGround(wp.x, wp.y) <= 4 / cam.zoom) {
        clearAllSelections();
        selectedElement = { kind: 'ground' };
        updateGroundPanel();
        document.getElementById('st-sel').textContent = '地面';
        return;
      }
      selectedJointId = null;
      // ★回路素子の選択は Ctrl なら残す（物体の選択と同じ「選択を消さずに範囲選択」。
      //   続く範囲選択で囲んだ素子が足される＝離したときの selRect の枝）。
      //   Ctrl なしなら selectedCircuit も外す。以前は右パネルだけ隠れて selectedCircuit が
      //   残り、素子は選択色のまま・Delete で見えない選択の素子が消えた（実測：抵抗を選んで
      //   何も無い所をクリック→Delete で素子が 10→9）。
      const keepCirc = (e.ctrlKey || e.metaKey) && (bulkKind === 'circuit' || (!bulkKind && selectedCircuit));
      if (!keepCirc) { clearBulkSelection(); selectedCircuit = null; }
      if (!(e.ctrlKey || e.metaKey)) { selectedIds.clear(); selectedElemIds.clear(); selectedJointEnds.clear(); lastSelRect = null; }
      dragStart = snapped;
      pointerMoveStart = null;
      if (!keepCirc) updatePropsPanel(null);
    }
    refreshSelCount();
    return;
  }
  if (currentTool==='circle' || currentTool==='gear') { drawStart=snapped; return; }
  if (currentTool==='box') { drawStart=snapped; return; }
  if (currentTool==='efield' || currentTool==='bfield') { drawStart=snapped; return; }   // ★ドラッグで領域
  if (currentTool==='counter') { drawStart=snapped; return; }   // ★ドラッグで線（通過カウンタ）
  if (currentTool==='spdmeter') { drawStart=snapped; return; }  // ★ドラッグで範囲（速さの分布計）
  if (currentTool==='waveprobe') { placeWaveProbe(wp, snapped); return; }   // ★クリックで置く（波の受信器）
  if (currentTool==='heater') { drawStart=snapped; return; }                             // ★加熱・冷却も同じ
  if (currentTool==='flowfield') { drawStart=snapped; return; }                          // ★流れの場も同じ
  if (currentTool==='vessel') { drawStart=snapped; return; }                             // ★ドラッグでピストン容器
  if (currentTool==='condrod') { drawStart=snapped; return; }                            // ★ドラッグで導体棒
  if (currentTool==='triangle') { drawStart=snapped; return; }
  if (currentTool==='optic') {
    if (pendingOptic) drawStart = placed;    // ドラッグ開始
    return;
  }
  if (currentTool==='polygon') {
    if (!polyDrawing) {
      polyDrawing=true; drawPts=[placed];
    } else if (nearDrawStart(placed)) {
      finishPolygon();          // ★始点に戻ってきた＝ここで閉じて確定（頂点は足さない）
    } else {
      drawPts.push(placed);
    }
    return;
  }

  if (currentTool==='freehand') {
    drawPts=[snapped];
    return;
  }
  if (currentTool==='fluid' || currentTool==='gas') {   // ★クリックだけでも置ける
    spawnParticles(snapped, currentTool);
    return;
  }
  // ─── プログラム：物体をクリックすると、その物体につないだ窓が1つ開く ───
  //   ★窓は画面に貼り付くので、置く場所は選ばせない（クリックした位置ではなく画面の定位置）。
  //     つないだ先は薄い線で示す（drawProgramLinks）。
  if (currentTool === 'program') {
    // ★回路素子は物体の上に描かれるので、物体より先に見る（remotePickAt と同じ順）。
    //   素子につなぐと「電流が○〜○Aになったら → 合図を出す」の窓になる（program.js の★）
    const ce = circuitAtPoint(wp.x, wp.y);
    if (ce) {
      const pe = addProgram(ce, true);
      if (pe) selectProgram(pe);
      return;
    }
    let hit = null;
    for (let i = objects.length - 1; i >= 0; i--)
      if (objects[i].containsPoint(wp.x, wp.y)) { hit = objects[i]; break; }
    if (!hit) {
      appAlert('プログラム', '<b>物体</b>か<b>回路素子</b>の上をクリックしてください。'
             + '<div class="am-note">プログラムは物体か回路素子に結びつけて使います。'
             + '複製したい物体、当たり判定を見張りたい物体、電流を見張りたい素子を選んでください。</div>');
      return;
    }
    const p = addProgram(hit);
    if (p) selectProgram(p);
    return;
  }
  // ─── リモコン：動力を持つ物体か、モーターをクリックすると窓が1つ開く ───
  //   ★窓は画面に貼り付くので置く場所は選ばせない（プログラムと同じ）。
  //   ★モーターを先に見る。軸は物体の上に重なっているので、物体を先に拾うと
  //     モーターにリモコンを付けられない。
  if (currentTool === 'remote') {
    // ★どこに何があるかの判定は remotePickAt（remote.js）に一本化してある。
    //   置くときと、窓の「＋」で足すときで順序が食い違わないように。
    const pick = remotePickAt(wp);
    // ── ② 窓の「＋」で待ち受け中：置くのではなく、その相手を足す／外す ──
    if (remoteAddFor && remotes.includes(remoteAddFor)) {
      if (!pick) { flashHint('足したい相手の上をクリックしてください'); return; }
      remoteToggleTarget(remoteAddFor, pick.target, pick.type);
      return;
    }
    // ── ① 置く。同じ種類のものを複数選んでいれば、1台がまとめて受け持つ ──
    if (pick) { addRemote(pick.kind, pick.target, pick.type,
                          remotePeerIds(pick.type, pick.target)); return; }
    appAlert('リモコン', '<b>物体・モーター・レーザー・波源・ばね・場の領域</b>の上を'
                   + 'クリックしてください。'
                   + '<div class="am-note">リモコンは、すでにある動力・モーターを'
                   + '「押している間だけ効かせる」道具と、その相手の設定をその場で変える'
                   + 'つまみです。新しい力は作りません。</div>');
    return;
  }
  // ─── 反射防止コート：面をクリックして付ける／同じ面をもう一度で外す ───
  //   ★狙うのは「面」なので、物体の内側だけでなく輪郭のそばも拾う（薄いレンズや板の
  //     上面は内側の判定だけだと数pxしか幅がなく、まず当たらない）。
  // ─── 歯車コート：面をクリックして歯を刻む（js/app/gear-tools.js）───
  if (currentTool === 'gearcoat') {
    const hit = bodyNearestToPoint(wp.x, wp.y, PICK_TOL_PX);
    flashHint(hit ? gearCoatApply(hit, wp.x, wp.y) : '物体の面の上をクリックしてください');
    return;
  }
  if (currentTool === 'arcoat') {
    const hit = bodyNearestToPoint(wp.x, wp.y, PICK_TOL_PX);
    if (!hit) {
      document.getElementById('hint-text').textContent =
        TOOL_HINTS.arcoat + '　【物体の面の上をクリックしてください】';
      return;
    }
    pushUndo();
    const u = arUOfPoint(hit, wp.x, wp.y);
    const already = (hit.arCoats || []).findIndex(c => _arIn(u, c.s, c.len));
    if (already >= 0) { arCoatRemove(hit, already); clearAllSelections(); }
    else selectNewElement({ kind:'arcoat', body:hit, index:arCoatAdd(hit, wp.x, wp.y), end:'B' });
    return;
  }
  // ─── 推力：1回目で力点、2回目で方向を指定 ───
  if (currentTool === 'thruster') {
    let hit = null;
    for (let i = objects.length - 1; i >= 0; i--) {
      if (objects[i].containsPoint(wp.x, wp.y)) { hit = objects[i]; break; }
    }
    if (!thrusterStart) {
      // 1回目：力点をローカル座標で記録（オブジェクト上でなければ無視）
      if (hit) {
        const a = getLocalAnchor(hit, placed.x, placed.y);
        thrusterStart = { body: hit, localX: a.x, localY: a.y };
      }
    } else {
      // 2回目：クリック地点への向きを推力方向として確定（機体固定）
      pushUndo();
      const b = thrusterStart.body;
      const aw = getWorldAnchor(b, thrusterStart.localX, thrusterStart.localY);
      let worldDir = Math.atan2(wp.y - aw.y, wp.x - aw.x);
      if (shiftHeld) worldDir = snapPlacementAngle(worldDir);
      // ★1つの物体に何個でも足せる（前は同じ4つの欄を上書きしていて、2個目を
      //   置くと1個目が黙って消えていた）。
      //   ★自動の推力は「自重の1.5倍＝浮く推力」。すでに付いている動力は数えない
      //     ——2個目を足したら合わせて3倍、が置いた人の意図（片側ずつ噴いて曲がる、
      //     支える動力＋加速用、どちらも各1本が自分の役目ぶんを出す形）。
      const th = new Thruster({
        localX: thrusterStart.localX, localY: thrusterStart.localY,
        dir: worldDir - b.angle,
        force: thrusterAutoForce ? Math.max(50, b.mass * world.gravY * 1.5) : thrusterForce,
      }, b);
      b.thrusters.push(th);
      selectNewElement({ kind: 'thruster', body: b, thr: th });   // ★配置後に選択
      thrusterStart = null;
    }
    return;
  }
  // ─── レーザー：1回目で発射点、2回目で向き ───
  if (currentTool === 'laser') {
    let hit = null;
    for (let i = objects.length - 1; i >= 0; i--) {
      if (objects[i].containsPoint(wp.x, wp.y)) { hit = objects[i]; break; }
    }
    if (!laserStart) {
      if (hit) {
        const a = getLocalAnchor(hit, placed.x, placed.y);
        laserStart = { body: hit, localX: a.x, localY: a.y };
      } else {
        laserStart = { body: null, localX: placed.x, localY: placed.y };
      }
    } else {
      const b = laserStart.body;
      const origin = b ? getWorldAnchor(b, laserStart.localX, laserStart.localY)
                       : { x: laserStart.localX, y: laserStart.localY };
      let worldAngle = Math.atan2(wp.y - origin.y, wp.x - origin.x);
      if (shiftHeld) worldAngle = snapPlacementAngle(worldAngle);
      pushUndo();
      const L = new Laser({
        body: b, localX: laserStart.localX, localY: laserStart.localY,
        angle: b ? worldAngle - b.angle : worldAngle,
        whiteLight: laserWhiteLight,          // ★白色光は1本のレーザーが全色を出す
      });
      lasers.push(L);
      selectNewElement({ kind: 'laser', laser: L });   // ★配置後に選択
      laserStart = null;
    }
    return;
  }
  // ─── 波源：1クリックで配置 ───
  if (currentTool === 'wave') {
    let hit = null;
    for (let i = objects.length - 1; i >= 0; i--) {
      if (objects[i].containsPoint(wp.x, wp.y)) { hit = objects[i]; break; }
    }
    pushUndo();
    const a = hit ? getLocalAnchor(hit, placed.x, placed.y) : { x: placed.x, y: placed.y };
    const S = new WaveSource({ body: hit, localX: a.x, localY: a.y });
    waveSources.push(S);
    selectNewElement({ kind: 'wave', source: S });
    refreshWaveInfo();
    return;
  }
  // ─── スリンキー：2クリックで両端を決める（弦と同じ操作）───
  //   ★引いた長さは「張った状態の長さ」。自然長はそこから張り具合で決める。
  //     張力は入力せず、伸びた結果として出てくる（実測してパネルに表示する）。
  if (currentTool === 'slinky') {
    if (!slinkyStart) {
      let hit = null;
      for (let i = objects.length - 1; i >= 0; i--) if (objects[i].containsPoint(wp.x, wp.y)) { hit = objects[i]; break; }
      slinkyStart = { x: placed.x, y: placed.y, body: hit };
      return;
    }
    let e = placed;
    if (shiftHeld) e = angleSnappedPoint(slinkyStart, e);
    if (len(e.x - slinkyStart.x, e.y - slinkyStart.y) < 20) { slinkyStart = null; return; }
    let hitB = null;
    for (let i = objects.length - 1; i >= 0; i--) if (objects[i].containsPoint(e.x, e.y)) { hitB = objects[i]; break; }
    pushUndo();
    const spanM = len(e.x - slinkyStart.x, e.y - slinkyStart.y) * PX2M;
    const restM0 = spanM / (1 + slinkyStretch);
    // ★既定はばね定数 k で持っているので、内部の伸び剛性 EA = k × 自然長 に直して渡す
    //   （こうすると、長く引いても短く引いても手応えが同じばねになる）
    const o = { ax: slinkyStart.x, ay: slinkyStart.y, bx: e.x, by: e.y,
                restM: restM0, stiffEA: slinkySpringK * restM0, linDensity: slinkyMu,
                idealSpring: slinkyIdeal };
    if (slinkyStart.body) {
      const a = getLocalAnchor(slinkyStart.body, slinkyStart.x, slinkyStart.y);
      o.bodyA = slinkyStart.body; o.anchorAx = a.x; o.anchorAy = a.y; o.endA = 'body';
    }
    if (hitB) {
      const a = getLocalAnchor(hitB, e.x, e.y);
      o.bodyB = hitB; o.anchorBx = a.x; o.anchorBy = a.y; o.endB = 'body';
    }
    const S = new Slinky(o);
    slinkies.push(S);
    selectNewElement({ kind: 'slinky', slinky: S });
    slinkyStart = null;
    return;
  }
  // ─── 1. ヒンジ・軸・固定（1クリックで重なりを判定するスマートツール） ───
  if (currentTool === 'hinge' || currentTool === 'axle' || currentTool === 'fixjoint') {
    // ★打ち方（留め先の決め方を含む）はデモと同じ関数に通す（selection.js の pinJointsAt の★）
    const hits = bodiesForPlacement(wp, placed);   // ★スナップ後の点で判定する
    if (hits.length > 0) {
      pushUndo();
      const made = pinJointsAt(currentTool, wp, placed, pinMode, {
        motorSpeed:  currentTool === 'axle' ? axleMotorSpeed  : 0,    // ★軸設定窓の値
        motorTorque: currentTool === 'axle' ? axleMotorTorque : 288,  // ★同上
        motorBrake:  currentTool === 'axle' ? axleMotorBrake  : false, // ★同上
        releasable:  currentTool === 'fixjoint' ? fixjointReleasable : false,   // ★溶接ツール設定窓の値
      });
      // ★'board' で固定物しか無かったときは何も打たない。黙っていると効かないツールに見える
      if (!made.length) flashHint('ここに重なっているのは固定した物体だけです（固定物はもともと背景に留まっています）');
      else {
        selectNewJoint(made[made.length - 1]);   // ★配置後に選択（複数なら最後の1本）
        if (made.length > 1) flashHint(made.length + ' 本を背景に留めました（右クリックの「この場所の要素」で1本ずつ選べます）');
      }
    }
    jointStart = null;
    return;
  }
  // ─── 2. ロープ・連結棒（2回のクリックで始点と終点を結ぶツール） ───
  //   ★ばねはここに居ない。ばねは Slinky（「ばねを張る」ツール）が1つだけ持つ。
  if (currentTool === 'rope' || currentTool === 'rod') {
    if (!jointStart) {
      // 1回目のクリック
      const hit = bodiesForPlacement(wp, placed)[0] || null;   // ★
      // ★物体に乗らなければ地面を見る。地面の上なら、その端は地面に取り付ける
      //   （傾けると一緒に動く杭。ワールドに打つ従来の杭は地面と無関係だった）
      const onG = !hit && pointOnGround(placed.x, placed.y);
      const p  = onG ? groundSurfacePoint(placed.x, placed.y) : placed;
      const ax = hit ? getLocalAnchor(hit, p.x, p.y)
                     : onG ? groundLocalFromWorld(p.x, p.y) : p;
      jointStart = { body: hit, onGround: onG, localX: ax.x, localY: ax.y };
    } else {
      // 2回目のクリック
      const bA = jointStart.body;
      const wA = jointEndWorld(bA, jointStart.onGround, jointStart.localX, jointStart.localY);
      let wB = placed;
      if (shiftHeld) wB = angleSnappedPoint(wA, wB);   // Shift=角度スナップ（距離は維持）
      const hitB = bodiesForPlacement(wp, wB)[0] || null;   // ★実際にアンカーを置く点で判定
      let bB = hitB;
      if (bA && hitB && bA.id === hitB.id) bB = null;
      const j = new Joint({
        type: currentTool, bodyA: bA, bodyB: bB,
        restLength: 1, maxLength: 1, motorSpeed: 0,
      });
      // 取り付け先（物体／地面／背景）はここで確定させる。地面に置いた端は表面へ吸着するので、
      // 長さはアンカーを置き終えた実際の端点間距離から決める。
      setJointEnd(j, 'A', bA, wA.x, wA.y, jointStart.onGround);
      setJointEnd(j, 'B', bB, wB.x, wB.y, !bB && pointOnGround(wB.x, wB.y));
      const a2 = j.getWorldAnchorA(), b2 = j.getWorldAnchorB();
      const rest = Math.max(Math.hypot(b2.x - a2.x, b2.y - a2.y), JOINT_MIN_LEN);
      j.restLength = rest; j.maxLength = rest;
      pushUndo();
      joints.push(j);
      // ★ロープツール設定で「先端おもりを付ける」がONなら、物体に乗らなかった端に
      //   掴むための小さなおもりを作る（背景に固定した端は動かせないため）。
      //   地面に取り付けた端には付けない。そこは「地面に打った杭」として意図的に
      //   留めた端で、動かせるおもりに置き換えては意味が逆になる。
      if (currentTool === 'rope' && ropeTipOnFree) {
        if (!bA && !j.groundA) addRopeTip(j, 'A');
        if (!bB && !j.groundB) addRopeTip(j, 'B');
      }
      selectNewJoint(j);
      jointStart = null;
    }
    return;
  }
});
canvas.addEventListener('mouseup', e => {
  e.preventDefault();
  isMouseDown = false;
  const sp = getCanvasPos(e);
  const wp = screenToWorld(sp.x, sp.y);
  const snapped = snapPt(wp);
  const placed = snapPlace(wp);
  if (e.button === 2) {
    const isClick = !rightClickStart ||
      ((sp.x - rightClickStart.x) ** 2 + (sp.y - rightClickStart.y) ** 2 < 25);
    if (isClick) {                                // ドラッグ（カメラパン）でないときだけ
      selectUnderCursorForCtx(wp);               // ★物体／ジョイント／要素を選択
      _ctxWorld = wp;                            // ★重なり列挙の基準点（「この場所の要素」サブメニュー用）
      showCtxMenu(e.clientX, e.clientY);
    }
    rightClickStart = null;
    return;
  }
  if (annotMouseUp()) return;        // ★注釈の平行移動・回転の終わり
  if (currentTool === 'pan') {
    if (activeMouseJoint) {
      activeMouseJoint.body._grabbed = false;   // 掴み終了
      const i = mouseJoints.indexOf(activeMouseJoint);
      if (i >= 0) mouseJoints.splice(i, 1);
      activeMouseJoint = null;
    }
    finishCircuitHold();               // ★回路を離す（速度0＝起電力も0に戻る）
    return;
  }
  if (currentTool === 'velocity') {
    if (selRect) {                                   // ★矩形選択の確定（重心が枠内の物体を選ぶ）
      for (const b of objects)
        if (b.x >= selRect.x && b.x <= selRect.x + selRect.w &&
            b.y >= selRect.y && b.y <= selRect.y + selRect.h) selectedIds.add(b.id);
      lastSelRect = { x: selRect.x, y: selRect.y, w: selRect.w, h: selRect.h };
      selRect = null; dragStart = null;
      refreshPropsForSelection();
      document.getElementById('st-sel').textContent =
        selectedIds.size > 0 ? `${selectedIds.size}個` : 'なし';
      return;
    }
    dragStart = null;                                // ★空クリック（ドラッグ無し）の後始末
    if (velStart) {
      const v = computeLaunchVelocity(velStart, wp, e.shiftKey, velocityAimNow(e.altKey));
      const targets = velocityTargets(velStart.body);
      if (targets.length) {
        pushUndo();                                  // ★解放と初速付与を同一のUndoステップにまとめる
        releaseFixjointsFor(new Set(targets));       // ★解放フラグ付きの固定だけを外す
        for (const b of targets) {                   // 同一の速度ベクトルを与える（並進のみ・角速度は0）
          b.vx = v.vx; b.vy = v.vy; b.av = 0;
          projectGuideVelocity(b, false);            // ★ガイド付きはレール方向の成分だけが残る
          b.sleeping = false; b.sleepTimer = 0;
        }
      }
      velStart = null;
    }
    return;
  }

  if (currentTool === 'pointer') {
    pointerPress = null;
    if (counterDrag) {
      endCounterDrag();                         // ★動かしたら数え直す（counter.js の★）
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (waveProbeDrag) {
      endWaveProbeDrag();                       // ★離した所の物体に付け替える（wavegraph.js の★）
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (spdMeterDrag) {
      endSpdMeterDrag();                        // ★動かしたら数え直す（spdmeter.js の★）
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (circuitGroupDrag) {
      finishCircuitGroupDrag();                 // 離した先で回路へ吸着・繋ぎ直す
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (circuitVertexDrag) {
      circuitVertexDrag = null;
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (circuitWholeDrag) {
      finishCircuitWholeDrag();                 // 離した先で回路へ繋ぎ直す
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (boxDrag) {
      boxDrag = null;
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      refreshPropsForSelection();
      return;
    }
    if (emFieldResize) {
      const f = emFieldResize.field;
      emFieldResize = null;
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      updateRectRegionPanel(f);              // 読み取り欄まで含めて整える（電場・磁場／加熱・冷却）
      return;
    }
    if (elementRotate) {
      elementRotate = null;
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (jointWholeDrag) {
      finishJointWholeDrag();
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (particleDrag) {
      endParticleDrag();
      updateParticlePanel();      // 動かしたあとの個数・平均温度は変わらないが、表示を確定させる
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (elementDrag) {
      finishElementDrag();
      dragStart = null; pointerMoveStart = null; pointerInitialOffsets = null; pointerElemOffsets = null;
      return;
    }
    if (selRect) {
      const inRect = (x, y) => x >= selRect.x && x <= selRect.x + selRect.w &&
                               y >= selRect.y && y <= selRect.y + selRect.h;
      for (const b of objects) if (inRect(b.x, b.y)) selectedIds.add(b.id);
      // ★レーザー・波源も範囲選択の対象にする（発射点／波源の位置が枠内なら選ぶ）
      for (const el of boxSelectableElements()) {
        const o = el.getOrigin();
        if (inRect(o.x, o.y)) selectedElemIds.add(el.id);
      }
      // ★ばね・ロープ・棒の端も範囲選択の対象にする（selection.js の addJointEndsInRect）
      addJointEndsInRect(selRect);
      addSlinkyEndsInRect(selRect);      // ★スリンキーの端も同じ扱い
      // ★枠を残しておく。「◯◯のみ選択」は、この枠の中を種別ごとに数え直して絞り込む
      //   （枠そのものを覚えるので、選択に入らない種別＝ジョイントなども後から拾える）
      const rect = { x: selRect.x, y: selRect.y, w: selRect.w, h: selRect.h };
      lastSelRect = rect;
      // ★物体もレーザー・波源も枠に入っていなければ、回路素子をまとめて選ぶ。
      //   回路図は普通それだけで一かたまりの区画に描くので、囲めば選べるのが自然
      //   （物体と混ざっている場合は従来どおり物体が優先。「回路のみ選択」で絞り込める）。
      //   両端とも枠内のものだけを拾うのは、枠をまたぐ導線を引きずって回路を切らないため。
      // ★Ctrl で残した回路素子（押したときの keepCirc）。囲んだ素子はそこへ足す。代表は据え置き
      const keptCirc = bulkKind === 'circuit' ? bulkCircuitList() : (selectedCircuit ? [selectedCircuit] : []);
      if (keptCirc.length && selectedCircuit) keptCirc.sort((a, b) => (b === selectedCircuit) - (a === selectedCircuit));
      if (!selectedIds.size && !selectedElemIds.size && !selectedJointEnds.size) {
        const cl = keptCirc.concat(circuitElements.filter(e => keptCirc.indexOf(e) < 0 && inRect(e.ax, e.ay) && inRect(e.bx, e.by)));
        if (cl.length) BULK_KINDS.circuit.select(cl);
        else {
          // ★回路も無ければ粒子。水や気体を囲む操作はよく使うので、そのまま選べるほうが
          //   自然（回路と同じ扱い）。物体が混ざっていれば従来どおり物体が優先で、
          //   右クリックの「液体のみ選択」「気体のみ選択」から絞り込める。
          const pl = particles.filter(q => inRect(q.x, q.y));
          if (pl.length) BULK_KINDS.particle.select(pl);
        }
        lastSelRect = rect;                      // select() が選択を作り直すので入れ直す
      } else if (keptCirc.length) {
        // ★物体などが入ったら回路素子は外す（物体優先の決まりどおり。回路の一括選択は
        //   物体の選択と混ぜられない：ctrlToggleCircuitIfHit の★）
        clearBulkSelection(); selectedCircuit = null;
      }
      if (!bulkKind) refreshPropsForSelection(); // ★複数選択でも代表の値を出す（まとめて設定の入口）
      refreshSelCount();
      selRect = null;
    }
    
    if (pointerMoveStart) {
      // ★長さの張り直しが先。あとから繋がった端は今回のドラッグで伸ばした訳ではないので、
      //   接続（attach）より前に済ませて、差分の対象に入らないようにする。
      if (!moveUndoArmed) {
        refitJointLengthsForMovedBodies();
        attachMovedBodyToJointEnds();
        attachMovedBodyToSlinkyEnds();   // ★ばねの端に重ねて置いたら取り付ける（ロープと同じ流儀）
      }
      // 連れられて動いた物体も含めて後始末する（速度が残ると離した瞬間に飛んでいく）
      for (const id in pointerInitialOffsets) {
        const b = objects.find(o => o.id === Number(id));
        if (!b) continue;
        reanchorGuide(b);
        // ★生成口の速度は「運動」ではなく「出てくる物体に渡す値」なので消さない。
        //   消すと、選んだだけ（＝長さ0のドラッグ）で歯の速さが0になり、出てきた物体が
        //   その場に留まって次が出なくなる＝生成が止まったように見える。
        // ★速度を消すのは実際に動かしたときだけ（moveUndoArmed が下りている＝1px でも運んだ）。
        //   クリックして選んだだけで消すと、速度ツールで初速を与えてから選んでグラフを開く、
        //   という順の操作で初速が消えていた（実測：6 m/s → 0。2026-09-28 チュートリアルの検証で発覚）。
        //   生成口の例外（上の★）と同じ症状を、一般則として直したもの。
        if (!b.isStatic && !b.isSpawner && !moveUndoArmed) {
          b.vx = 0;
          b.vy = 0;
          b.av = 0;
        }
        if (!b.isStatic) b.held = false;
      }
    }

    if (pointerInitialOffsets) {
      for (const id in pointerInitialOffsets) {
        const b = objects.find(o => o.id === Number(id));
        if (b) b.held = false;
      }
    }
    
    dragStart = null;
    pointerMoveStart = null;
    pointerInitialOffsets = null;
    pointerElemOffsets = null;
    return;
  }
  if ((currentTool === 'circle' || currentTool === 'box' || currentTool === 'triangle' || currentTool === 'gear') && drawStart) {
    const desc = buildDragShape(currentTool, drawStart, snapped, e.shiftKey);
    if (desc) {
      pushUndo();
      delete desc.meshWith;
      const b = new Body({ ...desc, ...drawProps });
      // ★歯車の歯面は既定で摩擦0（素材を選んだときだけ素材の値）。摩擦0.5だと歯面のすべりで
      //   伝わるトルクが1割ほど減り、止まる負荷が理論の 25 → 22 N·m に下がる（gear.js の★）
      if (desc.gear && !shapeMaterial) { b.friction = 0; b.frictionStatic = 0; }
      objects.push(b);
      applyNewBodyDefaults(b);
      attachNewBodyToEnds(b);   // ★ばね・ロープ・連結棒の自由な端に重ねて描いたら接続
      selectNewBody(b);
    }
    drawStart = null;
    return;
  }
  // ★導体棒：ドラッグした線分の位置に、導体フラグを付けた細長い物体を作る
  if (currentTool === 'condrod' && drawStart) {
    const endPt = e.shiftKey ? angleSnappedPoint(drawStart, snapped) : snapped;   // Shift=角度スナップ
    const d = condRodDesc(drawStart, endPt);
    if (d) {
      pushUndo();
      const m = MATERIALS['金属'];
      const b = new Body({ ...d, conductor: true, fillColor: m.fillColor, strokeColor: '#eceff1',
                           restitution: m.restitution, friction: m.friction,
                           frictionStatic: m.frictionStatic, strokeWidth: 1.5 });
      // ★質量は密度からではなく既定値を与える。見やすさのために太く描いているので、
      //   金属密度×描画上の体積だと1mの棒で数十kgになり、F=BIL では実質動かない。
      //   実物の1m金属棒に近い 0.5kg を既定にし、必要なら右パネルで変更してもらう。
      b.setMass(CONDROD_MASS);
      b.density = b.mass / Math.max(b.areaM2() * world.depth, 1e-9);
      objects.push(b);
      attachNewBodyToEnds(b);   // ★ばね・ロープ・連結棒の自由な端に重ねて描いたら接続
      selectNewBody(b);
    }
    drawStart = null;
    return;
  }
  // ★ピストン容器：ドラッグした矩形が「内側」になるように器を置く。
  //   矩形の幅＝内径、高さ＝内側の全長。開口はいつも上（重りを載せて圧縮する向き）。
  if (currentTool === 'vessel' && drawStart) {
    const w = Math.abs(snapped.x - drawStart.x), h = Math.abs(snapped.y - drawStart.y);
    if (w >= VESSEL_MIN_BORE && h >= VESSEL_MIN_LEN) {
      pushUndo();
      const v = createPistonVessel({
        x: (drawStart.x + snapped.x) / 2, y: (drawStart.y + snapped.y) / 2,
        bore: w, innerLen: h, angle: 0,
      });
      clearAllSelections();
      // ★置いた直後は気体を選ぶ。この道具で作りたいのは「閉じ込めた気体」で、
      //   器と蓋はその付属品だから（部品を触りたければクリックすれば普通に選べる）。
      selectedElement = { kind: 'gas', chamber: v.chamber() };
      updateGasPanel(v.chamber());
      document.getElementById('st-sel').textContent = '気体';
    }
    drawStart = null;
    return;
  }
  // ★通過カウンタ：ドラッグした線分を横切った数を数える（Shift で角度スナップ）
  if (currentTool === 'counter' && drawStart) {
    const end = e.shiftKey ? angleSnappedPoint(drawStart, snapped) : snapped;   // Shift=角度スナップ
    if (Math.hypot(end.x - drawStart.x, end.y - drawStart.y) >= 8) addCounter(drawStart.x, drawStart.y, end.x, end.y);
    drawStart = null;
    return;
  }
  // ★速さの分布計：ドラッグした矩形の中にいるものを速さで仕分ける
  if (currentTool === 'spdmeter' && drawStart) {
    if (Math.abs(snapped.x - drawStart.x) >= SPDM_MIN_PX && Math.abs(snapped.y - drawStart.y) >= SPDM_MIN_PX)
      addSpdMeter(drawStart.x, drawStart.y, snapped.x, snapped.y);
    drawStart = null;
    return;
  }
  // ★電場・磁場の領域：ドラッグした矩形の内側にだけ場を作る
  if ((currentTool === 'efield' || currentTool === 'bfield') && drawStart) {
    const w = Math.abs(snapped.x - drawStart.x), h = Math.abs(snapped.y - drawStart.y);
    if (w >= 8 && h >= 8) {
      pushUndo();
      const isE = currentTool === 'efield';
      const f = new EMField({
        kind: isE ? 'E' : 'B',
        x: (drawStart.x + snapped.x) / 2, y: (drawStart.y + snapped.y) / 2, w, h,
        strength: isE ? efieldStrength : bfieldStrength,
        angle: efieldAngle, out: bfieldOut,
      });
      emFields.push(f);
      selectNewElement({ kind: 'emfield', field: f });
    }
    drawStart = null;
    return;
  }
  // ★流れの場：ドラッグした矩形の内側を、一定の速度で流れる媒質で満たす
  //   （電場・磁場・加熱冷却とまったく同じ置き方）
  if (currentTool === 'flowfield' && drawStart) {
    const w = Math.abs(snapped.x - drawStart.x), h = Math.abs(snapped.y - drawStart.y);
    if (w >= 8 && h >= 8) {
      pushUndo();
      const f = new FlowField({
        x: (drawStart.x + snapped.x) / 2, y: (drawStart.y + snapped.y) / 2, w, h,
        speed: flowSpeed, angle: flowAngle, density: flowDensity, mode: flowMode,
      });
      flowFields.push(f);
      selectNewElement({ kind: 'flowfield', field: f });
    }
    drawStart = null;
    return;
  }
  // ★加熱・冷却の領域：ドラッグした矩形の内側にあるものへ熱を出し入れする
  if (currentTool === 'heater' && drawStart) {
    const w = Math.abs(snapped.x - drawStart.x), h = Math.abs(snapped.y - drawStart.y);
    if (w >= 8 && h >= 8) {
      pushUndo();
      const f = new HeatField({
        x: (drawStart.x + snapped.x) / 2, y: (drawStart.y + snapped.y) / 2, w, h,
        power: heaterPower,                  // 符号つき（正＝加熱・負＝冷却）。ツール設定ウィンドウで決める
      });
      heatFields.push(f);
      selectNewElement({ kind: 'heatfield', field: f });
    }
    drawStart = null;
    return;
  }
  if (currentTool === 'optic' && drawStart && pendingOptic) {
    const endPt = e.shiftKey ? angleSnappedPoint(drawStart, placed) : placed;  // Shift=角度スナップ
    const dx = endPt.x - drawStart.x, dy = endPt.y - drawStart.y;
    const dist = len(dx, dy);                 // ★len → dist（ついでにヘルパーを使う）
    if (dist >= 8) {
      const H = Math.max(15, dist/2);         // ★
      const cx = (drawStart.x + endPt.x)/2, cy = (drawStart.y + endPt.y)/2;
      const ang = Math.atan2(dy, dx) - Math.PI/2;    // アパーチャ(局所y)をドラッグ方向に合わせる
      pushUndo();
      const b = createOptic(pendingOptic.kind, cx, cy, H, ang);
      if (b) {
        if (opticAutoStatic) b.setStatic(true);   // ★光路に据え付ける（既定ON）
        objects.push(b);
        attachNewBodyToEnds(b);   // ★ばね・ロープ・連結棒の自由な端に重ねて描いたら接続
        selectNewBody(b);
      }
    }
    drawStart = null;
    return;
  }
  if (currentTool === 'freehand' && drawPts.length > 2) {
    finishFreehand();
    return;
  }
  if (currentTool === 'tracer') {
    let target = null;
    for (let i = objects.length - 1; i >= 0; i--) {
      if (objects[i].containsPoint(wp.x, wp.y)) { target = objects[i]; break; }
    }
    if (!target) {
      // ★物体が無ければ粒子を見る。水の1粒に軌跡を付けると「同じ水がどう回るか」が
      //   線で出る（対流のデモ）。物体を先に見るのは、水に沈めた物体をクリックした
      //   ときに手前の水粒を拾わないため。
      const pp = particleAt(wp.x, wp.y, PICK_TOL_PX / cam.zoom);
      if (pp) {
        pushUndo();
        setParticleTracer(pp, !pp.tracerEnabled, tracerColor, tracerDuration);
        return;
      }
      document.getElementById('hint-text').textContent = TOOL_HINTS.tracer + '　【物体か粒子の上をクリックしてください】';
      return;
    }
    if (target) {
      pushUndo();
      if (target.tracerEnabled) {
        target.tracerEnabled = false;   // 2回目でOFF
        target.tracePoints = [];
      } else {
        target.tracerEnabled = true;
        const a = getLocalAnchor(target, placed.x, placed.y);   // Ctrl=格子点をローカル固定
        target.tracerAnchorX = a.x;
        target.tracerAnchorY = a.y;
        target.tracerColor = tracerColor;         // ★ツール設定の色
        target.tracerDuration = tracerDuration;   // ★ツール設定の秒数
        target.tracePoints = [];
        selectNewElement({ kind: 'tracer', body: target });   // ★ON時に選択
      }
    }
    return;
  }
});
canvas.addEventListener('dblclick', e => {
  if (currentTool==='polygon') {
    finishPolygon();
  }
});
// advanceRope=false のときはロープのチェーンを進めない。
//   拘束の反復（下のループ）は何回まわしても収束するだけで時間は進まないが、
//   updateRopeChains はロープの時間積分なので、サブステップごとに呼ぶと
//   「カーソルを速く動かすほどロープの時間が速く進む」ことになり暴れる。
//   呼び出し側が1イベントにつき1回だけ true を渡す。
//   true のときは、掴み拘束とジョイントを念入りに交互がけして収束させる回でもある
//   （＝カーソルを止めた瞬間の形が、そのままつり合いの形になるようにする）。
function applyPausedConstraints(advanceRope = true) {
  const vels = objects.map(b => ({ vx: b.vx, vy: b.vy, av: b.av }));
  const contacts = collectContactsForPaused();
  const groundContacts = collectGroundContactsForPaused();
  // 眠っている物体は押し出し（correctGroundPosition / correctContactPosition）が
  // 素通りするので、掴んだ物体に押された相手はここで起こす（再生中の simTick と同じ）。
  if (world.sleeping) wakeOnContact(contacts);

  // 掴み拘束とジョイント/接触を交互に当てる。ジョイント側を内側で数回まわしてから
  // 掴み拘束へ戻すと、「ジョイントを満たした形」と「掴んだ点を合わせた形」の
  // いちばん近い組へ収束する＝つり合いの形（一直線）に落ち着く。
  const inner = advanceRope ? 2 : 1;
  for (let it = 0; it < world.iterations; it++) {
    for (const mj of mouseJoints) mj.solvePosition();
    for (let k = 0; k < inner; k++) {
      for (const j of joints) j.solve(0);
      for (const c of contacts) correctContactPosition(c);
      for (const gc of groundContacts) correctGroundPosition(gc);
    }
    // ★ピストン容器も停止中の拘束の一員。ここに無かったので、停止中に掴んだ蓋は
    //   軸から外れ・傾き・気体の抵抗を無視して押し込めていた。軸に閉じ込めてから、
    //   気体が押し返せる範囲（掴む力の上限まで）へ引き戻す。
    enforcePistonVessels();
    resistPausedGasGrab();
    enforceGrabbedAngles();   // ★停止中も Shift の向き固定を効かせる（実行中と同じ扱い）
  }

  // 最後はジョイント/接触だけ。ロープは伸びない拘束なので必ず満たし、
  // 満たしきれない分は掴んだ点とカーソルのずれ＝手応えとして残す。
  // 仕上げの回だけ多めにまわす。数珠つなぎ（背景→ロープ→物体→棒→物体…）は
  // 誤差が1つずつ隣へ伝わるので12回では伸びが数px残る。ここは1イベントに1回しか
  // 通らないので、増やしても重くならない。
  const tail = advanceRope ? 48 : 12;
  for (let it = 0; it < tail; it++) {
    for (const j of joints) j.solve(0);
    for (const c of contacts) correctContactPosition(c);
    for (const gc of groundContacts) correctGroundPosition(gc);
  }
  // ★dt=0 の呼び出しは「時間を進めない位置投影だけ」。
  //   updateRopeChains は1回の呼び出しにつき1回しかロープの接触を検出しないので、
  //   これを飛ばして物体だけ 4px 進めると当たり判定が古い位置のままになり、
  //   掴んだ物体がロープをすり抜ける（＝ひっかけられない）。dt=0 なら重力も減衰も
  //   効かないので、ロープの時間は advanceRope の回にだけ進む。
  updateRopeChains(advanceRope ? pausedRopeDt() : 0, false);
  // 仕上げの反復で接触が蓋を押していることがあるので、容器の拘束は最後にもう一度掛ける
  enforcePistonVessels();
  resistPausedGasGrab();
  refreshGrabbedVesselGas();      // ★押し込んだぶんの P・V を表示へ反映（反復の外で一度だけ）
  applyGuideProjection();
  enforceWalls();          // ★壁も再生中と同じく最後に閉じ込める（押し出された分をここで戻す）
  objects.forEach((b, i) => { b.vx = vels[i].vx; b.vy = vels[i].vy; b.av = vels[i].av; });
  for (const b of objects) { b.clearForces(); b._forcesSmooth = null; }
}
function collectContactsForPaused() {
  rebuildConnectedPairs();
  const out = [];
  for (const [a, b, pk] of broadPhasePairs()) { const cs = detectCollision(a, b, pk); if (cs) for (const c of cs) out.push(c); }
  return out;
}
// 一時停止中の地面接触。地面は無限の斜面なので、いま食い込んでいない物体も
// カーソルに引かれて食い込みうる。ここでは「地面と当たりうる物体」を挙げるだけにし、
// 食い込み量は correctGroundPosition が反復のたびにその場で測り直す
// （detectGroundCollision で集めると、掴む前に離れていた物体が対象から漏れる）。
function collectGroundContactsForPaused() {
  if (!world.terrain || ground.layers === 0) return [];
  const nx = Math.sin(ground.angle), ny = -Math.cos(ground.angle);
  const NEAR = 32;                                       // [px] この距離まで近づいた物体だけ見る
  const out = [];
  for (const b of objects) {
    if (b.isStatic || b.held || b.frozen) continue;      // held は編集ツールでカーソルに従わせている最中
    if ((b.layers & ground.layers) === 0) continue;      // ★レイヤーを共有しなければ地面を貫通する
    const a = b._aabb;                                   // 遠い物体を外す（頂点を毎反復なめると重い）
    const d = Math.min(signedDistToGround(a.minX, a.minY), signedDistToGround(a.maxX, a.minY),
                       signedDistToGround(a.minX, a.maxY), signedDistToGround(a.maxX, a.maxY));
    if (d > NEAR) continue;
    out.push({ b, nx, ny });
  }
  return out;
}
function finishPolygon() {
  if (drawPts.length < 3) { polyDrawing=false; drawPts=[]; return; }
  const cx=drawPts.reduce((s,p)=>s+p.x,0)/drawPts.length;
  const cy=drawPts.reduce((s,p)=>s+p.y,0)/drawPts.length;
  const verts=drawPts.map(p=>({x:p.x-cx,y:p.y-cy}));
  pushUndo();
  const b=new Body({type:'polygon', x:cx, y:cy, verts, ...drawProps});
  objects.push(b);
  applyNewBodyDefaults(b);
  attachNewBodyToEnds(b);   // ★ばね・ロープ・連結棒の自由な端に重ねて描いたら接続
  selectNewBody(b);
  polyDrawing=false; drawPts=[]; drawStart=null;
}
function finishFreehand() {
  if (drawPts.length < 3) { drawPts=[]; return; }
  const simplified=[];
  let last=drawPts[0];
  simplified.push(last);
  for (let i=1;i<drawPts.length;i++) {
    const dx=drawPts[i].x-last.x, dy=drawPts[i].y-last.y;
    if (dx*dx+dy*dy>100) { simplified.push(drawPts[i]); last=drawPts[i]; }
  }
  if (simplified.length<3){drawPts=[];return;}
  const cx=simplified.reduce((s,p)=>s+p.x,0)/simplified.length;
  const cy=simplified.reduce((s,p)=>s+p.y,0)/simplified.length;
  
  // 凹みを維持するために、simplifiedをそのまま頂点(verts)として使う
  const verts=simplified.map(p=>({x:p.x-cx,y:p.y-cy}));
  pushUndo();
  const b=new Body({type:'polygon', x:cx, y:cy, verts:verts, ...drawProps});
  objects.push(b);
  applyNewBodyDefaults(b);
  attachNewBodyToEnds(b);   // ★ばね・ロープ・連結棒の自由な端に重ねて描いたら接続
  selectNewBody(b);
  drawPts=[]; drawStart=null;
}
function pointInPolygon(p, verts) {
  let inside=false;
  for(let i=0,j=verts.length-1;i<verts.length;j=i++){
    const xi=verts[i].x,yi=verts[i].y,xj=verts[j].x,yj=verts[j].y;
    if(((yi>p.y)!==(yj>p.y))&&(p.x<(xj-xi)*(p.y-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const sp=getCanvasPos(e);
  const wpBefore=screenToWorld(sp.x,sp.y);
  const zoomFactor = e.deltaY<0?1.1:0.9;
  cam.zoom=Math.max(cam.minZoom,Math.min(cam.maxZoom,cam.zoom*zoomFactor));
  const wpAfter=screenToWorld(sp.x,sp.y);
  cam.x-=wpAfter.x-wpBefore.x;
  cam.y-=wpAfter.y-wpBefore.y;
  followAbsorbCam();            // カーソル基準ズームの補正を追従が打ち消さないように
},{passive:false});
