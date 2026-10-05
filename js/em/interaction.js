// 置けなかった理由をその場で知らせる。実体は共通の flashHint（js/input/keyboard.js）
function flashCircuitHint(msg) { flashHint(msg); }
// ★クリック点を回路の上へ吸着させる（乗っていなければ null）。
//   グリッドスナップ後の点で試し、外れていれば生のカーソル位置でも試す
//   （グリッドに引かれて導線から外れるのを防ぐ）。
function circuitPlacePoint(wp, snapped) {
  return circuitSnapToNetwork(snapped.x, snapped.y) || circuitSnapToNetwork(wp.x, wp.y);
}
function placeCircuitFirstClick(wp) {
  const p = snapPlace(wp);
  // ★導線以外の素子は回路の上にしか置けない。1打目で弾いて早く気づけるようにする。
  //   置ける場合は端点を回路へぴったり吸着させる（近くをクリックしただけで
  //   導線から浮いた位置に置かれてしまうのを防ぐ）
  if (currentTool !== 'wire') {
    const s = circuitPlacePoint(wp, p);
    if (!s) {
      flashCircuitHint('この素子は回路の上にしか置けません。まず導線でつないでください');
      return;
    }
    circuitStart = { x:s.x, y:s.y };
    return;
  }
  circuitStart = { x:p.x, y:p.y };
}
// 新素子の端点が既存導線の途中に載ったら、その導線を分割して同一ノードにする（回路への割り込み接続）
function spliceWiresAt(x, y) {
  const thr = NODE_MERGE_PX;
  const base = circuitElements.length;   // 分割で増えた導線は再走査しない
  for (let i = 0; i < base; i++) {
    const w = circuitElements[i];
    if (w.type !== 'wire') continue;                                       // 割ってよいのは導線だけ
    if (len(x - w.ax, y - w.ay) <= thr || len(x - w.bx, y - w.by) <= thr) continue;  // 端点付近はノード縮約に任せる
    const cp = _segClosestPoint(x, y, w.ax, w.ay, w.bx, w.by);
    if (cp.t <= 0.001 || cp.t >= 0.999) continue;                         // 端の外は対象外
    if (len(x - cp.x, y - cp.y) > thr) continue;                          // 導線から離れている
    const w2 = new CircuitElement('wire', cp.x, cp.y, w.bx, w.by);        // 後半を新しい導線に
    w.bx = cp.x; w.by = cp.y;                                             // 前半は接合点まで
    circuitElements.push(w2);
  }
}
// ★素子の本体は固定長にし、余った両側は「本物の導線」として別要素で置く。
//   以前は a〜b の全長が1本の抵抗枝で、両端のリード線は絵として描いているだけだった。
//   そのため（1）導線に見える部分に別の素子を繋げない（circuitSnapToNetwork は wire しか
//   拾わない）（2）繋げたとしても抵抗の枝の途中にノードを作ることになり電気的に無意味、
//   （3）長く引くほど記号が相対的に小さくなって読みにくい、という3つの問題があった。
//   リード線を実体のある wire にすれば、スナップ・ソルバ・電流表示・保存はどれも
//   既存のしくみがそのまま効く（0Ωなのでノード縮約で消える）。
const CIRCUIT_BODY_LEN = 44;   // [px] 素子本体の長さ。drawCircuitElement の記号 34px ＋ 端子の余白
const CIRCUIT_LEAD_MIN = 10;   // [px] これ未満のリード線しか出ないときは分割しない
function placeCircuitParts(tool, A, B) {
  if (tool === 'wire') {
    const w = new CircuitElement('wire', A.x, A.y, B.x, B.y);
    circuitElements.push(w);
    return { body: w, all: [w] };
  }
  // ★すべり抵抗は a〜b の全長が抵抗線（長さを読む道具なので、44px の本体に縮めない）
  if (tool === 'slidewire') {
    const e = new CircuitElement(tool, A.x, A.y, B.x, B.y);
    circuitElements.push(e);
    return { body: e, all: [e] };
  }
  // ★直流電源は「1クリック目＝負極、2クリック目＝正極」。内部は a 側が正極（長線を描き、
  //   ソルバも V_a − V_b = E とスタンプする）なので、置くときだけ端点を入れ替える。
  //   こうすれば描画・ソルバ・電流の符号は従来のまま使える。
  const flip = (tool === 'dcsource');
  const mk = (t, p, q) => flip ? new CircuitElement(t, q.x, q.y, p.x, p.y)
                               : new CircuitElement(t, p.x, p.y, q.x, q.y);
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
  if (L < CIRCUIT_BODY_LEN + 2 * CIRCUIT_LEAD_MIN) {       // 短いので分割しない
    const e = mk(tool, A, B);
    circuitElements.push(e);
    return { body: e, all: [e] };
  }
  const ux = dx / L, uy = dy / L, h = CIRCUIT_BODY_LEN / 2;
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const p1 = { x: mx - ux*h, y: my - uy*h }, p2 = { x: mx + ux*h, y: my + uy*h };
  const lead1 = new CircuitElement('wire', A.x, A.y, p1.x, p1.y);
  const body  = mk(tool, p1, p2);
  const lead2 = new CircuitElement('wire', p2.x, p2.y, B.x, B.y);
  circuitElements.push(lead1, body, lead2);
  return { body, all: [lead1, body, lead2] };
}
function placeCircuitSecondClick(wp, shiftHeld) {
  let p = snapPlace(wp);
  if (shiftHeld && circuitStart) p = angleSnappedPoint(circuitStart, p);
  // ★導線：クリック先が既存の回路の上（導線の途中／既存の端点）なら、そこへ最後の1本を
  //   引いて確定する。「回路につないだら1本の配線は終わり」という自然な操作にするため。
  //   吸着させた点を使うので、繋いだつもりで繋がっていないという事故が起きない。
  let closing = false;
  if (currentTool === 'wire') {
    const s = circuitSnapToNetwork(p.x, p.y);
    if (s) { p = s; closing = true; }
  } else {
    // ★導線以外は終点も回路の上でなければ置かない（始点は保持して置き直させる）。
    //   置ける場合はここでも吸着させ、両端をぴったり回路の上に乗せる。
    //   長さの判定より先に吸着させる（吸着後の位置で退化を判断するため）
    const s = circuitPlacePoint(wp, p);
    if (!s) {
      flashCircuitHint('終点も回路の上に置いてください（導線の上か、既存の端点）');
      return;
    }
    p = s;
  }
  if (len(p.x-circuitStart.x, p.y-circuitStart.y) < 15) {
    // 近すぎる（＝ダブルクリックの2打目／終端が今の頭に重なった／両端が同じ場所）
    if (currentTool === 'wire' && circuitChainPlaced) selectCircuitElement(circuitElements[circuitElements.length-1]);
    else if (currentTool !== 'wire') flashCircuitHint('両端が近すぎます。離れた2点をクリックしてください');
    if (currentTool === 'wire') { circuitStart = null; circuitChainPlaced = false; }
    return;
  }
  if (!(currentTool === 'wire' && circuitChainPlaced)) pushUndo();   // ★チェーンは最初の1本だけ履歴を積む
  const A = { x: circuitStart.x, y: circuitStart.y }, B = { x: p.x, y: p.y };
  const parts = placeCircuitParts(currentTool, A, B);
  const e = parts.body;
  spliceWiresAt(A.x, A.y);     // 端点が既存導線の途中なら分割して接続
  spliceWiresAt(B.x, B.y);
  if (currentTool !== 'wire') {
    removeShortingWires(parts.all, A, B);   // ★素子を短絡させる導線を消す
    // ★短絡導線を消したあとに繋ぎ直す。既存の導線に挿し込んだ場合、割れた導線と素子の
    //   リード線が A・B で出会って一直線に並ぶので、1本にまとめて余分な端子を消す。
    //   梯子状に別の導線へ渡した場合は A・B が分岐点（端点3つ）なのでまとまらない。
    mergeCollinearWiresAt(A.x, A.y);
    mergeCollinearWiresAt(B.x, B.y);
  }
  if (currentTool === 'wire' && !closing) {   // ★導線は多角形ツールのように連続配置
    circuitStart = { x:p.x, y:p.y };
    circuitChainPlaced = true;
  } else {                                   // 回路につないだ／単体素子＝ここで確定
    circuitStart = null; circuitChainPlaced = false;
    selectCircuitElement(e);
  }
}
// 編集ツール：クリック位置に最も近い回路素子の端点（頂点）を拾う
function circuitVertexAt(wx, wy) {
  const thr = 9 / cam.zoom, thr2 = thr*thr;
  let best = null, bestD = thr2;
  for (const e of circuitElements) {
    let d = (wx-e.ax)*(wx-e.ax) + (wy-e.ay)*(wy-e.ay);
    if (d <= bestD) { bestD = d; best = { e, end:'a', x:e.ax, y:e.ay }; }
    d = (wx-e.bx)*(wx-e.bx) + (wy-e.by)*(wy-e.by);
    if (d <= bestD) { bestD = d; best = { e, end:'b', x:e.bx, y:e.by }; }
  }
  return best;
}
// 端点を掴んだら移動開始（掴めなければ false）。既定では同位置に重なる他素子の端点も
// 一緒に動かして接続を保つ。Alt を押している間はこの端点だけを動かす（分岐を切り離せる）。
function beginCircuitVertexDragIfHit(wp, alt) {
  const hit = circuitVertexAt(wp.x, wp.y);
  if (!hit) return false;
  const items = [];
  if (alt) {
    items.push({ e: hit.e, end: hit.end });
  } else {
    const thr2 = NODE_MERGE_PX * NODE_MERGE_PX;
    for (const e of circuitElements) {
      if ((e.ax-hit.x)*(e.ax-hit.x) + (e.ay-hit.y)*(e.ay-hit.y) <= thr2) items.push({ e, end:'a' });
      if ((e.bx-hit.x)*(e.bx-hit.x) + (e.by-hit.y)*(e.by-hit.y) <= thr2) items.push({ e, end:'b' });
    }
  }
  circuitVertexDrag = { items, armed: true, moved: false };
  selectCircuitElement(hit.e);
  return true;
}
// 掴んだ端点（と重なった端点）を現在のマウス位置へ動かす
function dragCircuitVertexTo(wp) {
  const d = circuitVertexDrag;
  const p = snapPlace(wp);
  if (!d.moved) {
    const it0 = d.items[0];
    const ox = it0.end==='a' ? it0.e.ax : it0.e.bx;
    const oy = it0.end==='a' ? it0.e.ay : it0.e.by;
    if (Math.abs(p.x-ox) < 1e-9 && Math.abs(p.y-oy) < 1e-9) return;
    if (d.armed) { pushUndo(); d.armed = false; }   // 実際に動いた時だけ履歴を積む
    d.moved = true;
  }
  for (const it of d.items) {
    if (it.end === 'a') { it.e.ax = p.x; it.e.ay = p.y; }
    else                { it.e.bx = p.x; it.e.by = p.y; }
  }
}
// ── 素子の中央を掴んで平行移動 ───────────────────────────
//   端点ドラッグは「その節点を動かす」操作（隣の素子も連れていく）なので、素子そのものを
//   動かす手段がこれまで無かった。ばね・ロープ・連結棒が「中央＝全体を平行移動」になっているのと
//   同じ流儀に揃える。向きと長さは変わらないので、44px固定の本体も崩れない。
//   ★接続は状態ではなく幾何で決まる（端点が NODE_MERGE_PX 以内なら同じノードへ縮約）。
//     だから「切る」処理は要らない。少しずらすだけなら繋がったまま、大きく動かせば外れる。
//     離したときは配置と同じように回路へ吸着させ、導線の途中に乗ったら分割して繋ぎ直す。
let circuitWholeDrag = null;
function beginCircuitWholeDrag(e, wp) {
  const p = snapPlace(wp);
  circuitWholeDrag = { e, start: p, armed: true, moved: false,
    offA: { x: e.ax - p.x, y: e.ay - p.y },
    offB: { x: e.bx - p.x, y: e.by - p.y } };
}
function dragCircuitWholeTo(wp) {
  const d = circuitWholeDrag, e = d.e;
  if (!circuitElements.includes(e)) { circuitWholeDrag = null; return; }
  const p = snapPlace(wp);
  if (!d.moved) {
    const dz = ELEMENT_DRAG_DEADZONE_PX / cam.zoom;   // 選ぶだけのクリックで動かさない
    if (Math.abs(p.x - d.start.x) < dz && Math.abs(p.y - d.start.y) < dz) return;
    if (d.armed) { pushUndo(); d.armed = false; }     // 実際に動いた時だけ履歴を積む
    d.moved = true;
  }
  e.ax = p.x + d.offA.x; e.ay = p.y + d.offA.y;
  e.bx = p.x + d.offB.x; e.by = p.y + d.offB.y;
}
function finishCircuitWholeDrag() {
  const d = circuitWholeDrag;
  circuitWholeDrag = null;
  if (!d || !d.moved) return;                          // クリックしただけなら何もしない
  const e = d.e;
  if (!circuitElements.includes(e)) return;
  // ★吸着は素子全体をずらして行う。端ごとに別々に吸わせると向きと長さが崩れるので、
  //   より近いほうの端の吸着量だけを全体に適用する。
  const sa = circuitSnapToNetwork(e.ax, e.ay, e);
  const sb = circuitSnapToNetwork(e.bx, e.by, e);
  const da = sa ? len(sa.x - e.ax, sa.y - e.ay) : Infinity;
  const db = sb ? len(sb.x - e.bx, sb.y - e.by) : Infinity;
  let ox = 0, oy = 0;
  if (sa && da <= db)  { ox = sa.x - e.ax; oy = sa.y - e.ay; }
  else if (sb)         { ox = sb.x - e.bx; oy = sb.y - e.by; }
  if (ox || oy) { e.ax += ox; e.ay += oy; e.bx += ox; e.by += oy; }
  spliceWiresAt(e.ax, e.ay);        // 導線の途中に乗ったら分割してノードを作る
  spliceWiresAt(e.bx, e.by);
  markCircuitDiscontinuity();       // 繋がりが変わった＝不連続。次の1ステップは後退オイラーで踏む
  updateCircuitPanel(e);
}
// ── つかむツール：つながっている回路まるごとを手で運ぶ ──────────────
//   ★下の circuitGroupDrag（編集ツール）と分ける。あちらは「編集」でグリッドと回路網へ
//     吸着し履歴も積むが、こちらは「実験」なのでどちらもしない。吸着させると位置が
//     階段状に飛び、そこから作る速度も飛び飛びになって起電力がガタつく
//     （弦を手で振るときに編集ツールを使うなという注意と同じ理由。help-text.js の「端A」）。
//   ★対象は「つながっているもの全体」＝連結成分（circuitComponentMap）。全員に同じ変位を
//     与えるので繋がりは壊れない。外へ繋がる枝は連結成分の定義上そもそも無いので、
//     circuitGroupDrag と違って離した後の吸着も要らない。
//   ★導体棒は含めない。棒は物体（Body）で、レールの上を滑ること自体が実験なので、
//     レールと一緒に運ぶと相対速度が 0 になって棒の起電力が消える。棒とレールの接点は
//     毎ステップ取り直される（buildConductorRods）ので、レールが棒の下を滑る。
let circuitHold = null;
function beginCircuitHold(wp) {
  const hit = circuitAtPoint(wp.x, wp.y);
  if (!hit) return false;
  const comp = circuitComponentMap();
  const rep = comp.get(hit.id);
  const list = rep === undefined ? [hit]
             : circuitElements.filter(e => comp.get(e.id) === rep);
  circuitHold = {
    list, ids: new Set(list.map(e => e.id)),
    x: wp.x, y: wp.y,                 // 掴んでいる点（速度はここの移動量から作る）
    vx: 0, vy: 0, _lx: undefined, _ly: undefined,
    offs: list.map(e => ({ ax:e.ax-wp.x, ay:e.ay-wp.y, bx:e.bx-wp.x, by:e.by-wp.y })),
  };
  selectCircuitElement(hit);          // 物体を掴んだときと同じく、掴んだものを選択する
  return true;
}
function dragCircuitHoldTo(wp) {
  const h = circuitHold;
  if (!h) return;
  h.x = wp.x; h.y = wp.y;             // ★吸着させない（掴んだ点をそのまま追う）
  for (let i = 0; i < h.list.length; i++) {
    const e = h.list[i], f = h.offs[i];
    e.ax = wp.x + f.ax; e.ay = wp.y + f.ay;
    e.bx = wp.x + f.bx; e.by = wp.y + f.by;
  }
}
// ★離したらその場で止まる。回路は質量を持たないので、慣性で滑り続ける根拠が無い
//   （速度0＝起電力0）。手で動かしている間だけ電流が流れる、という約束にする。
function finishCircuitHold() {
  if (!circuitHold) return;
  circuitHold = null;
  clearCircuitMotionEmf();
}

// ── 種別一括選択した回路素子を、まとめて平行移動する ──────────────
//   1本だけの平行移動（上）と同じ流儀。全員に同じ変位を与えるので、選択の中の
//   繋がりは保たれる。切れるとしたら「選択の中と外を繋いでいた所」だけで、これは
//   実際に導線を引き抜いたのと同じことなので、そのまま外れるのが正しい。
//   範囲選択が両端とも枠内の素子しか拾わないのも、この境界での断線を減らすため。
let circuitGroupDrag = null;
function bulkCircuitList() {
  return bulkKind === 'circuit' ? circuitElements.filter(o => bulkIds.has(o.id)) : [];
}
// 掴んだ点が一括選択の一員なら、まとめての平行移動を開始する
function beginCircuitGroupDragIfHit(wp) {
  if (bulkKind !== 'circuit' || bulkIds.size < 2) return false;
  const hit = circuitAtPoint(wp.x, wp.y);
  if (!hit || !bulkIds.has(hit.id)) return false;
  const p = snapPlace(wp);
  const list = bulkCircuitList();
  circuitGroupDrag = { list, start: p, armed: true, moved: false,
    offs: list.map(o => ({ ax: o.ax - p.x, ay: o.ay - p.y, bx: o.bx - p.x, by: o.by - p.y })) };
  return true;
}
function dragCircuitGroupTo(wp) {
  const d = circuitGroupDrag;
  const p = snapPlace(wp);
  if (!d.moved) {
    const dz = ELEMENT_DRAG_DEADZONE_PX / cam.zoom;   // 選ぶだけのクリックで動かさない
    if (Math.abs(p.x - d.start.x) < dz && Math.abs(p.y - d.start.y) < dz) return;
    if (d.armed) { pushUndo(); d.armed = false; }     // 実際に動いた時だけ履歴を積む
    d.moved = true;
  }
  for (let i = 0; i < d.list.length; i++) {
    const o = d.list[i], f = d.offs[i];
    o.ax = p.x + f.ax; o.ay = p.y + f.ay;
    o.bx = p.x + f.bx; o.by = p.y + f.by;
  }
}
function finishCircuitGroupDrag() {
  const d = circuitGroupDrag;
  circuitGroupDrag = null;
  if (!d || !d.moved) return;                          // クリックしただけなら何もしない
  const live = d.list.filter(o => circuitElements.includes(o));
  if (!live.length) return;
  // ★吸着はまとまり全体をずらして行う。素子ごとに別々に吸わせると相対位置が崩れるので、
  //   選択の外へ最も近く吸い付ける端を1つだけ選び、その変位を全員に適用する。
  const moving = new Set(live);
  let ox = 0, oy = 0, bd = Infinity;
  for (const o of live) {
    for (const [x, y] of [[o.ax, o.ay], [o.bx, o.by]]) {
      const s = circuitSnapToNetwork(x, y, moving);
      if (!s) continue;
      const dist = len(s.x - x, s.y - y);
      if (dist < bd) { bd = dist; ox = s.x - x; oy = s.y - y; }
    }
  }
  if (ox || oy) for (const o of live) { o.ax += ox; o.ay += oy; o.bx += ox; o.by += oy; }
  // 導線の途中に乗った端点はノードを作る。分割で増えた導線は動かした側ではないので、
  // 位置を確定させてからまとめて走らせる。
  for (const o of live) { spliceWiresAt(o.ax, o.ay); spliceWiresAt(o.bx, o.by); }
  markCircuitDiscontinuity();
  if (selectedCircuit) updateCircuitPanel(selectedCircuit);
}
function circuitAtPoint(wx, wy) {
  const thr = 8 / cam.zoom;
  for (let i=circuitElements.length-1;i>=0;i--){
    const e=circuitElements[i];
    const cp=_segClosestPoint(wx,wy, e.ax,e.ay, e.bx,e.by);
    if (len(wx-cp.x, wy-cp.y) <= thr) return e;
  }
  return null;
}
function selectCircuitElement(e) {
  clearAllSelections();
  selectedCircuit = e;
  document.getElementById('st-sel').textContent = CIRCUIT_LABELS[e.type] || '回路';
  updateCircuitPanel(e);
}
// Ctrl（Cmd）+クリックで回路素子を一括選択に足す／外す（編集ツール。mouse.js の mousedown から）
//   ★物体・レーザーの Ctrl+クリックと揃える。以前は回路素子だけ範囲選択と「同じ種類を
//     すべて選択」でしか複数選べず、離れた素子を2つだけ選ぶ手が無かった。
//   ★物体とは混ぜない。回路の一括選択（bulkKind）は物体の選択（selectedIds）と別の仕組みで、
//     種別が混ざった選択の案内（selectionKindGroups）も回路を数えない。物体などを選んでいる
//     ところへ Ctrl+クリックしたら、回路素子だけの選択に切り替える。
//   ★代表（右パネルに出る素子）は、残っていれば今の代表のまま。値を変えると同じ型の仲間へ
//     流れる（bulkPeers）ので、足すたびに代表が入れ替わってパネルが跳ばないように。
//   ★物体が上に重なっていれば物体を優先する（ふつうのクリックと同じ順）。
function ctrlToggleCircuitIfHit(wp) {
  if (bodyNearestToPoint(wp.x, wp.y, PICK_TOL_PX)) return false;
  const hit = circuitAtPoint(wp.x, wp.y);
  if (!hit) return false;
  let list = bulkKind === 'circuit' ? bulkCircuitList() : (selectedCircuit ? [selectedCircuit] : []);
  if (list.indexOf(hit) >= 0) list = list.filter(o => o !== hit); else list.push(hit);
  const rep = list.indexOf(selectedCircuit) >= 0 ? selectedCircuit : list[0];
  if (!list.length) { clearAllSelections(); updatePropsPanel(null); refreshSelCount(); return true; }
  if (list.length === 1) { selectCircuitElement(list[0]); return true; }
  BULK_KINDS.circuit.select([rep].concat(list.filter(o => o !== rep)));
  refreshSelCount();
  return true;
}
function deleteSelectedCircuit() {
  if (!selectedCircuit) return;
  pushUndo();
  const i = circuitElements.indexOf(selectedCircuit);
  if (i>=0) circuitElements.splice(i,1);
  selectedCircuit = null;
  document.getElementById('st-sel').textContent='なし';
  updatePropsPanel(null);
}
function toggleSelectedSwitch() {
  if (!selectedCircuit || selectedCircuit.type!=='switch') return;
  pushUndo();
  const e = selectedCircuit;
  e.closed = !e.closed;
  applyToBulk('circuit', e, o => { o.closed = e.closed; });   // ★まとめて選んだスイッチも一緒に開閉
  markCircuitDiscontinuity();
  updateCircuitPanel(e);
}

// ── シリアライズ（保存・Undo用）──────────────────────
function serializeCircuit() {
  return circuitElements.map(e => {
    const o = {}; for (const k in e) if (k[0]!=='_') o[k]=e[k]; return o;
  });
}
function deserializeCircuit(arr) {
  circuitElements = (arr||[]).map(d => {
    const e = new CircuitElement(d.type, d.ax, d.ay, d.bx, d.by);
    Object.assign(e, d);
    return e;
  });
  selectedCircuit = null;
  // ★掴んでいた回路は作り直しで別物になっている。参照を残すと、もう配列に居ない素子を
  //   動かし続けたり、その運動起電力が消えないまま残ったりする（流れの場の _flowU と同じ話）
  circuitHold = null;
  _circuitEmfSig = '';
  // ★シーン読み込み・Undo は状態が飛ぶので不連続扱い。ただし物理的な過渡ではないので
  //   過渡のトリガ捕捉は起こさない（false）
  markCircuitDiscontinuity(false);
}

// ── 回路素子プロパティパネル（右パネルに動的生成）───────────
// ★静的HTML（#circuit-form）の行を出し入れして値を入れる方式。
//   以前は選択のたびに innerHTML で作り直していたが、それだとスライダーを付けられない
//   （bindSlider は id で1回だけ登録する仕組みなので、DOMを作り直すと登録が重複して壊れる）。
function updateCircuitPanel(e) {
  _hideAllPropForms();
  setStyleSections(false);
  const host = document.getElementById('circuit-form');
  if (!host || !e) return;
  host.style.display = '';
  const t = e.type;
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  const set  = (id, v)  => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  document.getElementById('c-title').textContent = CIRCUIT_LABELS[t] + 'を選択中';
  const isSrc = (t === 'dcsource' || t === 'acsource');
  show('c-R-row', t === 'resistor' || t === 'slidewire');
  if (t === 'resistor' || t === 'slidewire') set('c-R', e.R);
  show('c-pos-row', t === 'slidewire');        if (t === 'slidewire') set('c-pos', +(slideWirePos(e) * slideWireLen(e)).toFixed(1));
  show('c-cOff-row', t === 'slidewire');       if (t === 'slidewire') set('c-cOff', e.cOff || 0);
  show('c-V-row', isSrc);                      if (isSrc)             set('c-V', e.V);
  show('c-freq-row', t === 'acsource');        if (t === 'acsource')  set('c-freq', e.freq);
  show('c-phase-row', t === 'acsource');       if (t === 'acsource')  set('c-phase', +((e.phase || 0) * 180 / Math.PI).toFixed(1));
  show('c-r-row', isSrc);                     if (isSrc)             set('c-r', e.r || 0);
  show('c-ar-row', t === 'ammeter');           if (t === 'ammeter')   set('c-ar', e.r || 0);
  show('c-Rv-row', t === 'voltmeter');         if (t === 'voltmeter') set('c-Rv', e.R || 1e7);
  show('c-C-row', t === 'capacitor');          if (t === 'capacitor') set('c-C', e.C);
  show('c-L-row', t === 'inductor');           if (t === 'inductor')  set('c-L', e.L);
  show('c-Vf-row', t === 'diode');             if (t === 'diode')     set('c-Vf', e.Vf);
  show('c-Vr-row', t === 'bulb');              if (t === 'bulb')      set('c-Vr', e.Vr);
  show('c-Pr-row', t === 'bulb');              if (t === 'bulb')      set('c-Pr', e.Pr);
  show('c-tau-row', t === 'bulb');             if (t === 'bulb')      set('c-tau', e.tau);
  show('c-burnt-row', t === 'bulb');
  if (t === 'bulb') document.getElementById('c-burnt').checked = !!e.burnt;
  const isContact = (t === 'pushswitch' || t === 'relayswitch');
  show('c-nc-row', isContact);
  if (isContact) document.getElementById('c-nc').checked = !!e.nc;
  show('c-br-row', t === 'pushswitch');        if (t === 'pushswitch') set('c-br', e.br);
  show('c-ch-row', t === 'relay' || t === 'relayswitch' || t === 'motor');
  if (t === 'relay' || t === 'relayswitch' || t === 'motor') set('c-ch', e.ch);
  show('c-coilR-row', t === 'relay' || t === 'electromagnet' || t === 'motor');
  if (t === 'relay' || t === 'electromagnet' || t === 'motor') set('c-coilR', e.R);
  show('c-Ipull-row', t === 'relay');          if (t === 'relay')     set('c-Ipull', e.Ipull);
  show('c-turns-row', t === 'electromagnet');  if (t === 'electromagnet') set('c-turns', e.turns);
  show('c-coila-row', t === 'electromagnet');  if (t === 'electromagnet') set('c-coila', e.a);
  show('c-mur-row', t === 'electromagnet');    if (t === 'electromagnet') set('c-mur', e.mur);
  show('c-fr-row', t === 'electromagnet');     if (t === 'electromagnet') set('c-fr', e.fr);
  show('c-mk-row', t === 'motor');             if (t === 'motor')     set('c-mk', e.k);
  show('c-closed-row', t === 'switch');
  if (t === 'switch') document.getElementById('c-closed').checked = !!e.closed;
  // ★向きの反転。向きが物理的に意味を持つ素子だけに出す。
  //   何が入れ替わるかは素子ごとに違うので、ボタンの説明も型ごとに変える
  show('c-flip-btn', CIRCUIT_DIRECTIONAL.has(t));
  if (CIRCUIT_DIRECTIONAL.has(t)) {
    document.getElementById('c-flip-btn').title = {
      dcsource:      '＋極と−極を入れ替えます。電流の向きが逆になります',
      acsource:      '向きを逆にします。位相が π ずれるので、直列につないだもう一方の電源との和が差になります',
      diode:         '順方向の向きを逆にします。いままで流れていた向きには流れなくなります',
      ammeter:       '＋端子と−端子を入れ替えます。読みの符号が逆になります',
      voltmeter:     '＋端子と−端子を入れ替えます。読みの符号が逆になります',
      motor:         '端子を入れ替えます。トルクの向き＝軸の回る向きが逆になります',
      electromagnet: '巻線に流れる向きを逆にします。磁場の向き（N極とS極）が反転します',
    }[t] || '';
  }
  document.getElementById('c-V-label').textContent = (t === 'acsource') ? '振幅 V [V]' : '電圧 V [V]';
  const hasI = isSrc || ['ammeter','resistor','diode','bulb','relay','electromagnet','motor'].includes(t);
  show('c-I-row', hasI);
  show('c-Vread-row', ['voltmeter','resistor','diode','bulb','relay','electromagnet','motor'].includes(t));
  const note = document.getElementById('c-note');
  note.style.display = (isSrc || ['slidewire','ammeter','voltmeter','diode','bulb','pushswitch','electromagnet','relay','relayswitch','motor'].includes(t)) ? '' : 'none';
  if (t === 'slidewire') note.innerHTML = '一様な抵抗線なので、抵抗は長さに比例して接点で分かれます（端 a〜接点が R×AP÷全長）。接点の端子（丸）は抵抗線の中点の横に固定で、そこから接点までは抵抗 0 のリード線です。<b>接点を動かしても端子につないだ導線は切れません</b>。電位差計・分圧回路に使います。';
  else if (t === 'pushswitch') note.innerHTML = '物体が<b>点線の円</b>にかかっている間だけ動きます（押されると円が緑になります）。落ちてきたおもりでスイッチを踏ませるなど、<b>力学の出来事を回路の入力にする</b>ための素子です。「背景に固定」した物体では押せません。';
  else if (t === 'electromagnet') note.innerHTML = 'コイル中心の磁束密度 B = μ<sub>r</sub>μ<sub>0</sub>NI/(2a) を、点線の円の内側に一様に置きます（矩形の磁場ツールと同じ理想化）。導体棒・荷電粒子は既存の磁場とまったく同じように反応します。鉄心の磁気飽和 2T で頭打ちになり、自己インダクタンスも同じ模型から導いているので、電流の立ち上がりに時間がかかります。';
  else if (t === 'relay') note.innerHTML = '動作電流 I<sub>pull</sub> を超えると、同じ番号の<b>リレー接点</b>がまとめて動きます。復帰するのは動作電流の半分まで下がってからです（実物と同じヒステリシス。これが無いと閾値付近で振動します）。';
  else if (t === 'relayswitch') note.innerHTML = '同じ番号のリレーコイルに連動する接点です。「ふだん閉じている」にすると通電で<b>開く</b>ので、NOT が作れます。接点の先を別のコイルにつなげば記憶（自己保持）回路になります。';
  else if (t === 'motor') note.innerHTML = 'τ = kI（電流→トルク）と E = kω（逆起電力）を同じ k で結んでいるので、電力 EI と機械仕事 τω が一致します（エネルギーが湧きません）。<b>外から軸を回せば発電機</b>になります。ジョイント側の「モーター」を選び、同じ番号を設定してください。';
  else if (isSrc || t === 'ammeter' || t === 'voltmeter' || t === 'diode' || t === 'bulb') { /* 下で設定 */ }
  if (t === 'diode') note.innerHTML = 'I = I<sub>s</sub>(e<sup>V/nV<sub>T</sub></sup> − 1) で解いています。順方向でも V<sub>f</sub> 付近まで電圧をかけないと電流はほとんど流れず、逆方向では極めて小さい漏れ電流だけになります。V<sub>f</sub> を 2V 前後にすれば赤色LEDとして扱えます。';
  else if (t === 'bulb') note.innerHTML = 'フィラメントの温度で抵抗が変わる<b>非直線抵抗</b>です。冷えているときの抵抗は定格点灯時の約1/12しかないので、点灯直後に突入電流が流れます。定格の約2倍の電圧をかけるとタングステンの融点に達して切れます。';
  else if (isSrc) note.innerHTML = '内部抵抗の既定は 0.5Ω（実際の電源に近い設定）。端子電圧は V = E − rI、短絡電流は I = E/r になります。<b>0 にすると理想電源</b>になり I = V/R がぴったり出ますが、コイルを直結すると投入時の直流分が永久に残ります。';
  else if (t === 'ammeter')   note.innerHTML = '直列につなぎます。r = 0 が理想。r を上げると回路の全抵抗が増え、電流そのものが減ります。';
  else if (t === 'voltmeter') note.innerHTML = '並列につなぎます。R が大きいほど理想（既定 10 MΩ）。測る抵抗と同程度まで下げると分圧が狂い、真の値より小さく読めます。';
  refreshCircGraphButton();     // ★グラフに追加済みかどうかでボタンの表記を変える
  refreshCircTableButton();
  // ★蓄えのリセットは、電荷・磁束を持つ素子がつながっているときだけ出す（右クリックと同じ門番）
  show('c-reset-btn', circuitStorageTargets(e).length > 0);
  refreshCircuitReadout();
  syncSliders();
}
// 読み取り値（電流・電圧）だけを更新する。再生中も追従させたいので毎フレーム呼ぶ
function refreshCircuitReadout() {
  const e = selectedCircuit;
  if (!e || document.getElementById('circuit-form').style.display === 'none') return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('c-I', (e.I || 0).toFixed(3));
  set('c-Vread', (e.Vread || 0).toFixed(3));
}
function updateCircuitProp(prop, val, skipUndo) {
  if (!selectedCircuit) return;
  if (!skipUndo) pushUndo();      // ★スライダーのドラッグ中は掴んだ時点で1回だけ積む
  markCircuitDiscontinuity();     // ★値が飛ぶ＝不連続。次の1ステップは後退オイラーで踏む
  const e = selectedCircuit;
  if (prop==='closed') e.closed = !!val;
  else if (prop==='nc') e.nc = !!val;
  else if (prop==='burnt') {                       // ★切れた豆電球を直す＝温度も冷やして戻す
    e.burnt = !!val;
    e.T = T_AMB;
  }
  // ★すべり抵抗の接点は長さ AP [cm] で受け取り、割合 pos にして持つ（素子を伸ばしても接点は同じ割合の所に残る）
  else if (prop==='apLen') { prop = 'pos'; e.pos = Math.max(0, Math.min(1, (parseFloat(val) || 0) / Math.max(1e-9, slideWireLen(e)))); }
  // ★位相は度で受け取り rad で持つ（波源の位相欄と同じ）
  else if (prop==='phaseDeg') { prop = 'phase'; e.phase = (parseFloat(val) || 0) * Math.PI / 180; }
  else e[prop] = parseFloat(val) || 0;
  // ★まとめて選んだ同じ種類の素子にも同じ値を配る（抵抗値・起電力・開閉など）
  applyToBulk('circuit', e, o => {
    o[prop] = e[prop];
    if (prop==='burnt') o.T = T_AMB;
  });
}
// 選択中の素子の向きを反転する（プロパティの「向きを反転」ボタン）。
//   端点を入れ替えるだけなので素子の置かれている位置・長さは変わらない。
//   両端に付いているリード線（別要素の導線）もそのままでよい。
function flipSelectedCircuit() {
  const e = selectedCircuit;
  if (!e || !CIRCUIT_DIRECTIONAL.has(e.type)) return;
  pushUndo();
  markCircuitDiscontinuity();     // ★極性が飛ぶ＝不連続。次の1ステップは後退オイラーで踏む
  flipCircuitElement(e);
  // まとめて選んでいるときは仲間も反転する。「値を配る」のではなく各自を反転させるので、
  // 向きがばらばらに置かれていても、それぞれの向きが逆になる（＝全体の向きが逆になる）。
  applyToBulk('circuit', e, o => flipCircuitElement(o));
  updateCircuitPanel(e);
}

// ── 回路ツールのポップアップ（左ツールバー「回路」ボタン）─────
// 汎用：パネルをハンドルのドラッグで移動できるようにする
function makeDraggable(panel, handle) {
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('.popup-close')) return;   // ×ボタンはドラッグ対象外
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
    e.preventDefault();
    const mv = ev => {
      let x = ev.clientX - ox, y = ev.clientY - oy;
      x = Math.max(0, Math.min(x, window.innerWidth  - panel.offsetWidth));
      y = Math.max(0, Math.min(y, window.innerHeight - panel.offsetHeight));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  });
}
// 回路素子ウィンドウ内で、選択中ツールのボタンを強調する
function highlightCircuitTool() {
  const menu = document.getElementById('circuit-popup');
  if (!menu) return;
  menu.querySelectorAll('button[data-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === currentTool));
}
// 回路ツールのウィンドウ。素子を選んでも閉じず、ヘッダーで移動できる
function toggleCircuitMenu(e) {
  if (closeToolPopups('circuit-popup')) return;
  const menu = document.createElement('div');
  menu.id = 'circuit-popup';
  // ★位置は中身を組み立てて実寸を測ってから決める（下の appendChild の直後）。
  //   高さを固定値で見積もると、素子を足したときに下がはみ出す（豆電球以降が
  //   画面外に出ていた原因）。まず仮の位置で置いて、実測してから直す。
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:6px; z-index:1000; left:58px; top:8px; width:186px; box-shadow:var(--shadow);' +
    'display:flex; flex-direction:column; max-height:calc(100vh - 16px);';
  menu.innerHTML =
    '<div id="circuit-pop-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;cursor:move">' +
      '<span style="font-size:11px;font-weight:700;color:var(--accent)">回路素子</span>' +
      '<span class="popup-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>' +
    // ★素子が増えて画面に収まらないときは一覧側だけスクロールさせる（ヘッダーは残す）
    '</div><div id="circuit-pop-list" style="overflow-y:auto;flex:1 1 auto;min-height:0"></div>';
  const list = menu.querySelector('#circuit-pop-list');
  for (const t of CIRCUIT_TOOLS) {
    const b = document.createElement('button');
    b.className='btn-small'; b.dataset.tool=t;
    // ★カーソルを合わせたときの説明。記号だけでは何の素子か分からないため
    b.title = (CIRCUIT_TIPS[t] || '').replace(/<[^>]+>/g, '');
    b.style.cssText='display:flex;align-items:center;gap:6px;width:100%;margin-bottom:3px;text-align:left;padding:3px 6px';   // ★測定の窓と同じ寸法
    // ★名前の横に回路記号を描く。キャンバスに置かれる絵と同じ関数から作っているので、
    //   素子の見た目を変えてもメニューと食い違わない。
    b.appendChild(circuitSymbolCanvas(t));
    const nm = document.createElement('span');
    nm.textContent = CIRCUIT_LABELS[t];
    b.appendChild(nm);
    b.onclick = () => { setTool(t); highlightCircuitTool(); };   // ★閉じない
    list.appendChild(b);
  }
  // ★回路の表はここには置かない（素子ではない）。素子を選んで右パネル・右クリック・
  //   上メニュー〈表示〉から出す（circuit-table.js の冒頭）
  document.body.appendChild(menu);
  // ★実寸が分かってから位置を決める。クリック位置から出しつつ、下端がはみ出すなら
  //   画面内へ引き上げる。それでも入りきらない高さのときは一覧がスクロールする。
  const h = menu.offsetHeight;
  menu.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)) + 'px';
  makeDraggable(menu, menu.querySelector('#circuit-pop-head'));
  menu.querySelector('.popup-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev=>ev.stopPropagation());
  menu.addEventListener('click', ev=>ev.stopPropagation());
  highlightCircuitTool();
}

// ── 電場・磁場ツールの設定ウィンドウ（向きと強さ）──────────────
//   これから置く領域の既定値を決める。置いたあとは選択して右パネルで変えられる。
//   もう一度ツールボタンを押すと閉じる（他のツール窓と同じ流儀）。
function toggleEMFieldMenu(e, tool) {
  const same = !!document.getElementById('emfield-popup') && currentTool === tool;
  closeToolPopups();                 // 他のツールの窓は畳む（同時に開くのは1つだけ）
  if (same) return;                  // 同じツールを再クリック＝閉じる
  setTool(tool);                     // 電場⇄磁場の切替は窓を作り直す
  const isE = tool === 'efield';
  const rg = EMFIELD_STRENGTH_RANGE[isE ? 'E' : 'B'];
  const menu = document.createElement('div');
  menu.id = 'emfield-popup';
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:8px; width:186px; box-shadow:var(--shadow);' +
    'max-height:calc(100vh - 16px); overflow-y:auto;';
  menu.innerHTML = `
    <div id="emf-pop-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;cursor:move">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">${isE ? '電場' : '磁場'}の領域</span>
      <span class="popup-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    <div class="prop-row"><span class="prop-label">${isE ? '強さ E [V/m]' : '強さ B [T]'}</span>
      <input class="prop-input" id="emf-strength" type="number" step="${rg.step}" min="0"></div>
    <input type="range" id="emf-strength-slider" style="width:100%">
    <div class="rpanel-title" style="margin-top:6px">向き</div>
    ${isE ? `<div class="prop-row"><span class="prop-label">向き [°]</span>
               <input class="prop-input" id="emf-angle" type="number" step="1"
                      title="右向き0°・反時計回りが正"></div>
             <input type="range" id="emf-angle-slider" min="-180" max="180" step="1" style="width:100%">` : ''}
    <div class="material-grid" id="emf-dirs" style="margin-top:4px"></div>
    <div style="font-size:10px;color:var(--text2);margin-top:8px">
      ドラッグした矩形の内側だけに場ができます。<br>
      置いたあとは、<b>編集ツールで枠をクリック</b>すると選べます（内側は
      ダブルクリック）。内側のクリックを素通りさせて、領域の上でも範囲選択できるように
      しています。<br>
      重なった領域は足し合わされます（電場と磁場を重ねれば速度選別器）。<br>
      ${isE ? '荷電粒子に F = qE がはたらきます。' :
              '荷電粒子に F = qv×B（ローレンツ力）、磁場を横切る導体棒に誘導起電力がはたらきます。'}
    </div>
  `;
  document.body.appendChild(menu);
  const sIn = menu.querySelector('#emf-strength');
  const rng = menu.querySelector('#emf-strength-slider');
  const grid = menu.querySelector('#emf-dirs');
  rng.min = 0; rng.max = rg.hi; rng.step = rg.step;   // 範囲外は数値欄で入力できる
  const setStrength = v => {                    // スライダー・数値欄のどちらからでも同じ経路へ
    v = Math.max(0, v || 0);
    if (isE) efieldStrength = v; else bfieldStrength = v;
    sIn.value = v;
    rng.value = Math.min(parseFloat(rng.max), v);
  };
  // ★電場の向きは任意角。EMField.angle が角度そのものなので、斜めもそのまま F = qE に効く。
  //   表示は右0°・反時計回りが正（内部は y 下向き正なので符号が反転する）。
  const aIn  = menu.querySelector('#emf-angle');
  const aRng = menu.querySelector('#emf-angle-slider');
  const setAngle = deg => {
    deg = ((((parseFloat(deg) || 0) + 180) % 360 + 360) % 360) - 180;
    efieldAngle = -deg * Math.PI / 180;
    aIn.value = deg; aRng.value = deg;
    markDirPresets();
  };
  const markDirPresets = () => {
    if (!isE) return;
    const cur = _dispDeg(efieldAngle);
    grid.querySelectorAll('button').forEach(b =>
      b.classList.toggle('active', Math.abs(parseFloat(b.dataset.deg) - cur) < 0.5));
  };
  const buildDirs = () => {
    grid.innerHTML = '';
    const opts = isE
      ? EMFIELD_ANGLE_PRESETS.map(p => ({ label:p.label, deg:p.deg, on:false,
                                          pick: () => setAngle(p.deg) }))
      : [{ label:'⊙ 表向き', on: bfieldOut,  pick: () => { bfieldOut = true;  buildDirs(); } },
         { label:'⊗ 裏向き', on: !bfieldOut, pick: () => { bfieldOut = false; buildDirs(); } }];
    for (const o of opts) {
      const b = document.createElement('button');
      b.className = 'mat-btn' + (o.on ? ' active' : '');
      b.textContent = o.label;
      if (o.deg !== undefined) b.dataset.deg = o.deg;
      b.onclick = o.pick;
      grid.appendChild(b);
    }
    markDirPresets();
  };
  buildDirs();
  setStrength(isE ? efieldStrength : bfieldStrength);
  if (isE) setAngle(_dispDeg(efieldAngle));
  // 中身を作り終えてから実際の高さを測り、画面内へ収める（他のツール窓と同じ）
  const h = menu.offsetHeight;
  menu.style.top = Math.max(8, Math.min(e ? e.clientY : 8, window.innerHeight - h - 8)) + 'px';
  rng.addEventListener('input',  () => setStrength(parseFloat(rng.value)));
  sIn.addEventListener('change', () => setStrength(parseFloat(sIn.value)));
  if (isE) {
    aRng.addEventListener('input',  () => setAngle(aRng.value));
    aIn.addEventListener('change',  () => setAngle(aIn.value));
  }
  makeDraggable(menu, menu.querySelector('#emf-pop-head'));
  menu.querySelector('.popup-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}
// ── 全体設定タブ「電磁気」セクションの同期 ───────────────
function syncEMWorldUI() {
  const set=(id,v)=>{ const el=document.getElementById(id); if(el&&document.activeElement!==el) el.value=v; };
  const chk=(id,v)=>{ const el=document.getElementById(id); if(el) el.checked=v; };
  chk('w-coulomb', world.coulombOn);
  chk('w-fieldlines', world.showFieldLines);
  chk('w-equipot', world.showEquipotential);
  set('w-coulombk', world.coulombK);
}
function emWorldUpdate(prop, val) {
  if (prop==='coulombOn') world[prop] = !!val;
  else world[prop] = parseFloat(val)||0;
  wakeAll();
}

// ── 選択物体の電荷・導体設定 ──────────────────────────
function updateCharge(v, skipUndo) {
  if (!skipUndo && selectedIds.size>0) pushUndo();   // ★ドラッグ中は掴んだ時点で1回だけ積む
  const q = parseFloat(v)||0;
  // ★導体棒は除外（複数選択に混ざっていても電荷を与えない）
  for (const id of selectedIds){ const b=objects.find(o=>o.id===id);
    if(b && !b.conductor){ b.charge=q; b.sleeping=false; b.sleepTimer=0; } }
}
// 導体の指定は物体プロパティから外した（導体棒ツールが専用に作る）。
//   一般の物体を「導体」にできると、この app が扱わない静電遮蔽・誘導電荷を
//   期待させてしまう。導体棒だけに絞れば、できないことを主張しなくなる。

