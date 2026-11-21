// ═══ 割れる物体 ══════════════════════════════════════════════════════════
//
// 「割れる」をオンにした物体は、接触から受けた力がしきい値（breakForce [N]）を超えた
// tick の終わりに、いくつかの破片へ置き換わる。
//
// ★判定に使う量は「1 tick（1/60秒）に接触から受けた力積 ÷ 1/60秒」＝ tick 平均の力。
//   力積そのもの（Δp）でも、サブステップの力でもない。理由（2026-10-30 の実測）：
//     卵 0.5kg を 1m から落とす（4.41 m/s）。サブステップ 4 / 8：
//       床に直接                          137.3 / 137.3 N
//       軽い板 0.02kg＋ばね k=50 N/m       20.7 /  20.2 N
//       同じ板＋ばね k=200                  39.7 /  37.7 N
//       板 2kg＋ばね k=50                  111.8 / 111.4 N（重い板はクッションにならない）
//     受けた力積（Δp）はどの条件でも 2.2 N·s で同じ。
//   ・力積で判定すると「クッションで Δt を延ばせば力が小さい」が出ない（Δp は同じだから）。
//   ・サブステップの力（J/subDt）で判定すると、サブステップ数を変えるだけで割れる・
//     割れないが入れ替わる。tick 平均ならサブステップ 4 と 8 で 2% 以内。
//   ☆剛体どうしの衝突は必ず 1 tick で終わるので、床に直接ぶつけたときの値は
//     mv × 60 + mg そのもの＝ tick の長さで決まる架空の値。実物の衝撃力ではない。
//     クッション側（ばねが時間をかけて止める）の値は、ばねの力そのものなので実物に近い。
//
// ★「接触から受けた力」の大きさは (Σ|J_i| + |ΣJ_i|) / 2 ÷ 1/60秒（contactLoadN）。
//   ・片側だけから押される（床に落ちる）なら Σ|J| = |ΣJ| ＝ その力そのもの。
//   ・両側から同じ力 F で挟まれると ΣJ = 0 だが、物体は F で圧されている。合力
//     |ΣJ| だけだと 0 になって万力で潰しても割れない。Σ|J| だけだと 2F になる。
//     平均を取ると F。上に重り W を載せて床に置いた物体も (W+mg + W + mg)/2 = W+mg。
//   ・速度グラフの「受けた力」の段は合力（ベクトル ΣJ）を描く（こちらは F = ma の F）。
//
// ★置き換えは tick の最後（simTick の末尾）でだけ行う。サブステップの途中で objects を
//   書き換えると、同じ1回の接触の前半と後半で前提が食い違う（program.js 冒頭の★と同じ）。
//
// ★割れ方は物理の結果ではない。剛体は内部の応力を持たないので、どこから割れるかは
//   計算できない。衝撃点のまわりに種をまいてボロノイ分割で切る＝見た目の演出である。
//   物理として正しいのは「割れるかどうか（受けた力）」と「割れたあとの破片の運動」：
//   ・各破片は元の物体の剛体運動をそのまま引き継ぐ（重心で v + ω×r、角速度 ω）。
//   ・質量は面積で配分し、合計は元の質量に一致させる。運動量も一致させる（下の★）。
//   ・破片は割れない（breakable を外す）。連鎖して粉になるのを防ぐ。
// ★種は物体の id から決まる乱数でまく。リセットして同じ実験をやり直すと、毎回同じ
//   割れ方になる（授業で「さっきと同じ条件でもう一度」ができるように）。

const FRACTURE_PIECES_MIN = 3;       // 破片の数の下限（しきい値ちょうどで割れたとき）
const FRACTURE_PIECES_MAX = 8;       // 上限（強く当たるほど増える。小さい破片はすり抜けやすい）
const FRACTURE_MIN_PIECE  = 0.03;    // 元の面積に対する破片の最小の割合。これより小さい破片は捨てて質量を配り直す

// ── 接触から受けた力の積算（collision.js の finishContact・ground.js の finishGroundContact が呼ぶ）──
function clearContactLoad(b) {
  b._cfx = 0; b._cfy = 0; b._cfSum = 0; b._cfPeak = 0;
}
// jx, jy：物体 b が受けた力積 [kg·px/s]。(cx, cy)：接触点
function noteContactImpulse(b, jx, jy, cx, cy) {
  if (b._cfSum === undefined) clearContactLoad(b);
  const m = Math.hypot(jx, jy);
  b._cfx += jx; b._cfy += jy; b._cfSum += m;
  if (m > b._cfPeak) { b._cfPeak = m; b._cfPx = cx; b._cfPy = cy; }   // 衝撃点＝いちばん強く押された点
}
// この tick に接触から受けた力の大きさ [N]（冒頭の★）
function contactLoadN(b) {
  if (!b._cfSum) return 0;
  return (b._cfSum + Math.hypot(b._cfx, b._cfy)) * 0.5 / (PPM * SIM_DT);
}
// この tick に接触から受けた合力 [N]（UI の向き：y は上向き正）
function contactForceN(b) {
  if (!b._cfSum) return { fx: 0, fy: 0 };
  const k = 1 / (PPM * SIM_DT);
  return { fx: b._cfx * k, fy: yUI(b._cfy * k) };
}

// ── tick の最後で割る ─────────────────────────────────────────────
function canBreak(b) {
  if (!b.breakable || b.isStatic || b.constVel || b.isSpawner || b._remoteDrive) return false;
  if (typeof pistonVesselOfBody === 'function' && pistonVesselOfBody(b.id)) return false;   // ★器の部品は割らない（体積が壊れる）
  return true;
}
function applyFractures() {
  let any = false;
  for (const b of objects.slice()) {
    if (!b.breakable || !b._cfSum || !canBreak(b)) continue;
    const F = contactLoadN(b);
    if (F < b.breakForce) continue;
    if (breakBody(b, F)) any = true;
  }
  if (!any) return;
  // ★消えた物体を指していたジョイント・レーザー・選択を落とす（プログラムの「削除」と同じ道）
  dropDanglingRefs();
  // ★支えが割れたら、その上で眠っている物体を起こす（program.js の applyPendingPrograms の★）
  wakeAll();
}

// id から決まる乱数（xorshift32）
function _fracRng(seed) {
  let s = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
// 物体の輪郭（外周＋穴）を Clipper のパスへ。円は 48 角形で近似する（図形和と同じ）
const FRACTURE_CLIP_S = 100;   // ★clipperOuterShapes が 1/100 で戻すので合わせる
function _fracBodyPaths(b) {
  const S = FRACTURE_CLIP_S;
  const loops = [];
  if (b.type === 'circle') {
    const pts = [];
    for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push({ x: b.x + Math.cos(a) * b.radius, y: b.y + Math.sin(a) * b.radius }); }
    loops.push(pts);
  } else {
    loops.push(b._worldVerts());
    for (const h of b._worldHoles()) loops.push(h);
  }
  const paths = loops.map(l => l.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) })));
  const sArea = p => { let a = 0; for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i + 1) % p.length]; a += u.X * v.Y - v.X * u.Y; } return a; };
  if (sArea(paths[0]) < 0) paths[0].reverse();                                   // 外周を +
  for (let i = 1; i < paths.length; i++) if (sArea(paths[i]) > 0) paths[i].reverse();   // 穴を −
  return paths;
}
// 凸多角形 poly を半平面 { p : (p − m)·d ≤ 0 } で切る（Sutherland–Hodgman）
function _fracClipHalf(poly, mx, my, dx, dy) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = (p.x - mx) * dx + (p.y - my) * dy, sq = (q.x - mx) * dx + (q.y - my) * dy;
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}
// 物体 b の割れ方を決める：破片の輪郭（ワールド座標）の並びを返す
function _fracPieces(b, F) {
  const rnd = _fracRng(b.id);
  const bb = b.type === 'circle'
    ? { minX: b.x - b.radius, maxX: b.x + b.radius, minY: b.y - b.radius, maxY: b.y + b.radius }
    : b._worldVerts().reduce((a, v) => ({ minX: Math.min(a.minX, v.x), maxX: Math.max(a.maxX, v.x),
                                          minY: Math.min(a.minY, v.y), maxY: Math.max(a.maxY, v.y) }),
                             { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const R = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY) / 2;
  // ★強く当たるほど細かく割れる（しきい値の 2 倍ごとに 2 片ずつ増やす）
  const n = Math.max(FRACTURE_PIECES_MIN,
                     Math.min(FRACTURE_PIECES_MAX, Math.round(FRACTURE_PIECES_MIN + 2 * Math.log2(F / b.breakForce))));
  // ★種は衝撃点の近くほど密にまく（距離を u^1.5 で寄せる）＝当たった所が細かく砕けて見える
  const ix = b._cfPx !== undefined ? b._cfPx : b.x, iy = b._cfPy !== undefined ? b._cfPy : b.y;
  const seeds = [];
  const minGap = R * 0.15;
  for (let tries = 0; seeds.length < n && tries < 400; tries++) {
    const r = R * 1.6 * Math.pow(rnd(), 1.5), a = rnd() * Math.PI * 2;
    const p = { x: ix + Math.cos(a) * r, y: iy + Math.sin(a) * r };
    if (!b.containsPoint(p.x, p.y)) continue;
    if (seeds.some(s => Math.hypot(s.x - p.x, s.y - p.y) < minGap)) continue;
    seeds.push(p);
  }
  if (seeds.length < 2) return null;
  const subject = _fracBodyPaths(b);
  const S = FRACTURE_CLIP_S, PT = ClipperLib.PolyType, CT = ClipperLib.ClipType, PF = ClipperLib.PolyFillType;
  const pad = R * 2;
  const pieces = [];
  for (let i = 0; i < seeds.length; i++) {
    // ボロノイの領域＝ほかのどの種よりこの種に近い点（垂直二等分線で切っていく）
    let cell = [{ x: bb.minX - pad, y: bb.minY - pad }, { x: bb.maxX + pad, y: bb.minY - pad },
                { x: bb.maxX + pad, y: bb.maxY + pad }, { x: bb.minX - pad, y: bb.maxY + pad }];
    for (let j = 0; j < seeds.length && cell.length >= 3; j++) {
      if (j === i) continue;
      const si = seeds[i], sj = seeds[j];
      cell = _fracClipHalf(cell, (si.x + sj.x) / 2, (si.y + sj.y) / 2, sj.x - si.x, sj.y - si.y);
    }
    if (cell.length < 3) continue;
    const clip = cell.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
    const cpr = new ClipperLib.Clipper();
    cpr.AddPaths(subject, PT.ptSubject, true);
    cpr.AddPath(clip, PT.ptClip, true);
    let sol = new ClipperLib.Paths();
    if (!cpr.Execute(CT.ctIntersection, sol, PF.pftNonZero, PF.pftNonZero) || !sol.length) continue;
    sol = ClipperLib.Clipper.SimplifyPolygons(sol, PF.pftNonZero);   // ★自己接触をほどく（applyClipper の★）
    // ★穴あき・凹んだ物体では、1つの領域が離れた2片に分かれることがある＝それぞれ別の破片
    for (const o of clipperOuterShapes(sol)) {
      const ac = shapeAreaCentroid(o.pts, o.holeList);
      if (ac.area > 0) pieces.push({ pts: o.pts, holeList: o.holeList, area: ac.area, cx: ac.cx, cy: ac.cy });
    }
  }
  const total = pieces.reduce((s, p) => s + p.area, 0);
  const kept = pieces.filter(p => p.area >= total * FRACTURE_MIN_PIECE);
  return kept.length >= 2 ? kept : null;
}
// 物体 b を破片に置き換える。割れなかったら false
function breakBody(b, F) {
  if (typeof ClipperLib === 'undefined') return false;
  const pieces = _fracPieces(b, F);
  if (!pieces) return false;
  const areaSum = pieces.reduce((s, p) => s + p.area, 0);
  const M = b.mass;
  const inherited = {};
  for (const k of SHAPE_INHERIT_KEYS) inherited[k] = b[k];
  // ★熱の性質も引き継ぐ（示強的。温度は割れても変わらない）
  for (const k of ['temp', 'heatCap', 'conduct', 'emissivity', 'tempFixed']) inherited[k] = b[k];
  const srcCircles = [];
  {
    const cs = Math.cos(b.angle), sn = Math.sin(b.angle);
    for (const c of bodySourceCircles(b))
      srcCircles.push({ cx: b.x + c.cx * cs - c.cy * sn, cy: b.y + c.cx * sn + c.cy * cs, r: c.r });
  }
  const made = [];
  for (const p of pieces) {
    const verts = p.pts.map(q => ({ x: q.x - p.cx, y: q.y - p.cy }));
    const holes = (p.holeList || []).map(h => h.map(q => ({ x: q.x - p.cx, y: q.y - p.cy })));
    // ★元が円なら円弧として復元する（48角形のままだと転がるたびに角で速度を吸われる。applyClipper の★）
    const arcs = detectArcs(verts, holes, srcCircles.map(s => ({ cx: s.cx - p.cx, cy: s.cy - p.cy, r: s.r })));
    const nb = new Body({ type: 'polygon', x: p.cx, y: p.cy, verts, holes, arcs, ...inherited });
    nb.breakable = false;                       // ★破片は割れない（冒頭の★）
    nb.density = b.density;
    nb.setStatic(false);
    nb.setMass(M * p.area / areaSum);           // ★質量は面積で配分（捨てた小片の分も配り直す＝合計は M）
    // 元の剛体運動を引き継ぐ：重心で v + ω×r
    const rx = p.cx - b.x, ry = p.cy - b.y;
    nb.vx = b.vx - b.av * ry;
    nb.vy = b.vy + b.av * rx;
    nb.av = b.fixedRotation ? 0 : b.av;
    nb.sleeping = false; nb.sleepTimer = 0;
    made.push({ nb, area: p.area });
  }
  // ★運動量を元の物体と一致させる。破片の重心の質量平均は、捨てた小片と 48 角形近似の
  //   ぶんだけ元の重心からずれるので、ω×r の総和がわずかに残る。その差を全片へ一様に返す。
  let px = 0, py = 0;
  for (const m of made) { px += m.nb.mass * m.nb.vx; py += m.nb.mass * m.nb.vy; }
  const dvx = (M * b.vx - px) / M, dvy = (M * b.vy - py) / M;
  for (const m of made) { m.nb.vx += dvx; m.nb.vy += dvy; }
  // ★電荷は示量的なので面積比で分ける（applyClipper の★と同じ）
  if (b.charge) for (const m of made) m.nb.charge = b.charge * m.area / areaSum;
  const i = objects.indexOf(b);
  if (i < 0) return false;
  objects.splice(i, 1, ...made.map(m => m.nb));   // ★描画順（レイヤ順）は元の物体の位置を引き継ぐ
  for (const m of made) m.nb._updateAABB();
  noteBodyBroken(b);
  return true;
}
// 割れた物体を見ていたグラフの窓へ知らせる（窓は畳まずに記録を止めて残す。velgraph.js の★）
function noteBodyBroken(b) {
  if (typeof velGraphs === 'undefined') return;
  for (const g of velGraphs) if (g.bodyId === b.id) {
    g.broken = true; g.brokenName = b.label || ('Object ' + b.id);
    g.frozen = true; g.stopReason = 'broken';
    updateVelGraphStatus(g);
  }
}
