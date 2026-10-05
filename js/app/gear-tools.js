// ═══ 歯車の操作：円形歯車の歯数・モジュール／歯車コート ═════════════════════
//  形そのもの（歯形の式・吸着）は js/physics/gear.js。ここは道具の側。
//
//  歯車コート：物体の面をクリックすると、その面に歯を刻む（図形和と同じく形を書き換える
//  一回きりの操作。やり直しは「戻る」）。
//    直線の面 → ラック歯／円弧の面（円・図形和で残った円弧）→ その円の扇形歯車の歯／
//    へこんだ円弧（穴の内壁）→ 内歯車の歯。
//  ★それ以外の面（フリーハンドの曲線など）には付けない。インボリュート歯が相手を選ばずに
//    一定の比でかみ合うのは、基準線が直線か円のときだけ。一般の曲線に同じ歯を並べても
//    決まった相手としかかみ合わない非円形歯車にすらならず、比が揺れて引っかかる。
//  ★図形和と違い、物体は作り直さずに形だけ差し替える（reshapeBodyInPlace）。
//    図形和は元の物体を消すのでジョイントも消えるが、歯を刻みたい物体はたいてい
//    すでに軸で留めてある。

// ─── 形の差し替え（同じ物体のまま）──────────────────────────────────
//   verts / holes / arcs は今のローカル座標で渡す。重心が原点からずれるので付け直し、
//   ローカル座標で持っている付属物（ジョイント・ばねの端・動力・レーザー・波源・軌跡の点）を
//   同じだけずらす。物体の見た目の位置は動かない。
function reshapeBodyInPlace(b, verts, holes, arcs, newFace) {
  const { cx: dx, cy: dy } = shapeAreaCentroid(verts, holes);
  const dens = b.density != null ? b.density : b.mass / Math.max(b.areaM2() * world.depth, 1e-9);
  // 面の控え：円形歯車の全周の面も明示の控えへ移す（形が z と m で決まらなくなるので b.gear は外す）
  const faces = gearLocalFaces(b);
  if (newFace) faces.push(newFace);
  const sh = f => f.kind === 'rack' ? { ...f, ox: f.ox - dx, oy: f.oy - dy } : { ...f, cx: f.cx - dx, cy: f.cy - dy };
  b.type  = 'polygon';
  b.verts = verts.map(v => ({ x: v.x - dx, y: v.y - dy }));
  b.holes = (holes || []).map(h => h.map(v => ({ x: v.x - dx, y: v.y - dy })));
  b.arcs  = (arcs && arcs.length) ? arcs.map(a => ({ ...a, cx: a.cx - dx, cy: a.cy - dy })) : null;
  b.gear  = null;
  b.toothFaces = faces.length ? faces.map(sh) : null;
  // ★反射防止コートは周長に対する割合で面を指しているので、輪郭が変わると別の面を指す。外す。
  b.arCoats = null;
  const cp = buildConvexParts(b.verts, b.holes);
  b.convexParts = cp.parts; b.partEdgeInternal = cp.internal;
  b.partEdgeArc = buildPartArcFlags(cp.parts, b.arcs);
  // 位置：新しい原点（ローカルの (dx,dy)）がワールドのどこか
  const cs = Math.cos(b.angle), sn = Math.sin(b.angle);
  b.x += dx * cs - dy * sn; b.y += dx * sn + dy * cs;
  for (const j of joints) {
    if (j.bodyA === b) { j.anchorAx -= dx; j.anchorAy -= dy; }
    if (j.bodyB === b) { j.anchorBx -= dx; j.anchorBy -= dy; }
  }
  for (const S of slinkies) {
    if (S.bodyA === b) { S.anchorAx -= dx; S.anchorAy -= dy; }
    if (S.bodyB === b) { S.anchorBx -= dx; S.anchorBy -= dy; }
  }
  for (const th of b.thrusters) { th.localX -= dx; th.localY -= dy; }
  for (const L of lasers)      if (L.body === b) { L.localX -= dx; L.localY -= dy; }
  for (const S of waveSources) if (S.body === b) { S.localX -= dx; S.localY -= dy; }
  b.tracerAnchorX -= dx; b.tracerAnchorY -= dy;
  b.density = dens;
  b.setMass(b.massFromDensity());
  b._invalidateShape(); b._updateAABB();
  if (b.guideEnabled) reanchorGuide(b);
  b.sleeping = false; b.sleepTimer = 0;
}

// ─── 面を見つける ─────────────────────────────────────────────────
//   返り値：{ kind:'rack', p0, p1, nx, ny } ／ { kind:'arc', cx, cy, r, lo, hi, full, internal }
//           ／ { err: '理由' }。すべてローカル座標。
const GEARCOAT_STRAIGHT_TOL = 0.5 * Math.PI / 180;   // 直線の面とみなす折れ角
function _gcLoops(b) {
  if (b.type === 'circle') return null;
  return [b._localOutline(), ...(b.holes || [])];
}
function _gcInMaterial(b, x, y) {
  if (b.type === 'circle') return Math.hypot(x, y) < b.radius;
  if (!pointInPolygon({ x, y }, b._localOutline())) return false;
  for (const h of b.holes || []) if (pointInPolygon({ x, y }, h)) return false;
  return true;
}
function gearCoatFaceAt(b, wx, wy) {
  if (b.opticKind) return { err: '光学素子には歯を付けられません' };
  if (b.type === 'circle') return { kind: 'arc', cx: 0, cy: 0, r: b.radius, lo: 0, hi: 2 * Math.PI, full: true, internal: false };
  const p = _toLocal(b, wx, wy);
  const loops = _gcLoops(b);
  let best = null, bd = Infinity;
  loops.forEach((L, li) => {
    for (let i = 0; i < L.length; i++) {
      const a = L[i], c = L[(i + 1) % L.length];
      const ex = c.x - a.x, ey = c.y - a.y, l2 = ex * ex + ey * ey || 1e-12;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2));
      const d = Math.hypot(a.x + ex * t - p.x, a.y + ey * t - p.y);
      if (d < bd) { bd = d; best = { li, i }; }
    }
  });
  if (!best) return { err: '面が見つかりません' };
  const L = loops[best.li], n = L.length, i = best.i;
  // 円弧の面か（図形和が円から作った区間。b.arcs の loop は外周 −1・穴 0..）
  for (const a of b.arcs || []) {
    if (a.loop !== best.li - 1) continue;
    let inArc = a.full;
    if (!inArc) for (let k = a.i0; k !== a.i1; k = (k + 1) % n) if (k === i) { inArc = true; break; }
    if (!inArc) continue;
    const lo = a.ccw ? a.a0 : a.a0 - a.sweep;
    return { kind: 'arc', cx: a.cx, cy: a.cy, r: a.r, lo, hi: lo + (a.full ? 2 * Math.PI : a.sweep),
             full: !!a.full, internal: !!a.concave };
  }
  // 直線の面：同じ向きに続く辺をつないで1本にする
  const dir = k => { const a = L[(k + n) % n], c = L[(k + 1 + n) % n]; return Math.atan2(c.y - a.y, c.x - a.x); };
  const same = (k0, k1) => { let d = dir(k1) - dir(k0); d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) <= GEARCOAT_STRAIGHT_TOL; };
  let s = i, e = i, guard = 0;
  while (same(i, s - 1) && guard++ < n) s--;
  while (same(i, e + 1) && guard++ < n) e++;
  const p0 = L[(s + n) % n], p1 = L[(e + 1 + n) % n];
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  // 外向きの法線：材料の無い側
  let nx = (p1.y - p0.y) / len, ny = -(p1.x - p0.x) / len;
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  if (_gcInMaterial(b, mx + nx * 0.5, my + ny * 0.5)) { nx = -nx; ny = -ny; }
  return { kind: 'rack', p0, p1, nx, ny, len };
}

// ─── 歯の並べ方（プレビューと刻むので共用）─────────────────────────────
//   centers … 歯（内歯車は歯みぞ）の中心。ラックは基準線上の点、円弧は角度。
function gearCoatPlan(face, m) {
  if (face.err) return face;
  const p = Math.PI * m, t = Math.tan(GEAR_PRESSURE_ANGLE);
  if (face.kind === 'rack') {
    const hwRoot = (Math.PI / 2 - GEAR_BACKLASH) * m / 2 + GEAR_DEDENDUM * m * t;   // 歯元の半幅
    const n = Math.floor((face.len - 2 * hwRoot) / p + 1e-9) + 1;
    // ★曲線を細かい辺で描いた面（フリーハンドなど）は、ここで「まっすぐな部分が短い」として断られる
    if (n < 1) { const cm = v => (v * PX2M * 100).toFixed(1);
      return { err: `まっすぐな部分が短すぎます（${cm(face.len)} cm。歯1枚に ${cm(2 * hwRoot)} cm 要る）。円弧でない曲線には歯を付けられません` }; }
    const start = (face.len - (n - 1) * p) / 2;
    return { n, start, p };
  }
  const R = face.r, z = 2 * R / m;
  if (z < GEAR_MIN_Z) return { err: `円が小さすぎます（この歯の大きさでは1周 ${z.toFixed(1)} 枚。${GEAR_MIN_Z} 枚以上必要）` };
  const pA = p / R;
  const thick = face.internal ? Math.PI / 2 + GEAR_BACKLASH : Math.PI / 2 - GEAR_BACKLASH;
  const rIn  = face.internal ? R - GEAR_ADDENDUM * m : R - GEAR_DEDENDUM * m;
  const rOut = face.internal ? R + GEAR_DEDENDUM * m : R + GEAR_ADDENDUM * m;
  const th0 = _gearFlank(R, m, z, thick, rIn, rOut)[0].th;        // いちばん太い所の半角
  let n, start;
  if (face.full) { n = Math.floor(2 * Math.PI / pA + 1e-9); start = face.lo; }
  else {
    n = Math.floor((face.hi - face.lo - 2 * th0) / pA + 1e-9) + 1;
    if (n < 1) return { err: '円弧が短すぎます（歯が1枚も入りません）' };
    start = face.lo + (face.hi - face.lo - (n - 1) * pA) / 2;
  }
  // 全周で 1周の歯数が整数でないと、継ぎ目の歯みぞが1つだけ広くなる
  const seam = face.full ? 2 * Math.PI / pA - n : 0;
  return { n, start, pA, z, thick, rIn, rOut, seam };
}

// ─── 刻む ─────────────────────────────────────────────────────────
const _GC_S = 100;   // Clipper の整数座標の倍率（図形和と同じ）
// ★歯と歯みぞの帯を、基準線の反対側へ 0.25m だけ重ねる。元の面が円を48角形で描いた辺だと
//   基準円より最大 0.2px 内側にあり、帯を基準円ちょうどで切ると、辺の中ほどに来た歯が
//   本体から浮いて別の輪になっていた（実測：半径100pxの円・m=10px で20枚中1枚が離れ、
//   細かい破片が20個残った）。重ねた部分は歯（材料）か元の材料なので形は変わらない。
const GC_OVERLAP = 0.25;
function _gcPath(loop, positive) {
  const P = loop.map(q => ({ X: Math.round(q.x * _GC_S), Y: Math.round(q.y * _GC_S) }));
  let a = 0; for (let i = 0; i < P.length; i++) { const u = P[i], v = P[(i + 1) % P.length]; a += u.X * v.Y - v.X * u.Y; }
  if ((a > 0) !== positive) P.reverse();
  return P;
}
function _gcOp(ct, subj, clip) {
  const c = new ClipperLib.Clipper(), out = new ClipperLib.Paths();
  c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const PF = ClipperLib.PolyFillType.pftNonZero;
  c.Execute(ct, out, PF, PF);
  return out;
}
// 環（の扇形）。full なら外周＋穴の2本。step は円を折れ線にする角の刻み
//   ★刻みは角ピッチの 1/4（弦のたるみは r=170px で 0.04px）。1°刻みだと歯先・歯底が
//     細かい辺で埋まり、内歯車（36枚・r=180px）の穴の輪郭が 693 頂点・凸パーツ 465 個に
//     なって、遊星歯車の組で 1tick 6ms かかった。
function _gcAnnulus(cx, cy, r0, r1, a0, a1, full, step) {
  const N = Math.max(8, Math.ceil(Math.abs(a1 - a0) / step));
  const arc = (r, from, to, n) => { const o = []; for (let k = 0; k <= n; k++) { const a = from + (to - from) * k / n; o.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return o; };
  if (full) {
    const n = Math.max(8, Math.ceil(2 * Math.PI / step));
    const o = arc(r1, 0, 2 * Math.PI, n).slice(0, -1), i = arc(r0, 0, 2 * Math.PI, n).slice(0, -1);
    return [_gcPath(o, true), _gcPath(i, false)];
  }
  return [_gcPath([...arc(r1, a0, a1, N), ...arc(r0, a1, a0, N)], true)];
}
function gearCoatCarve(b, face, m) {
  const plan = gearCoatPlan(face, m);
  if (plan.err) return plan;
  const CT = ClipperLib.ClipType;
  // 元の形（ローカル）。円は48角形にして、円弧として拾い直す（図形和と同じ）
  let outer, holes = [];
  if (b.type === 'circle') {
    outer = [];
    for (let i = 0; i < 48; i++) { const a = i / 48 * 2 * Math.PI; outer.push({ x: b.radius * Math.cos(a), y: b.radius * Math.sin(a) }); }
  } else { outer = b._localOutline(); holes = b.holes || []; }
  const bodyPaths = [_gcPath(outer, true), ...holes.map(h => _gcPath(h, false))];
  let grooves, adds, rec;
  if (face.kind === 'rack') {
    const { p0, nx, ny } = face;
    const ex = (face.p1.x - p0.x) / face.len, ey = (face.p1.y - p0.y) / face.len;
    const at = u => ({ x: p0.x + ex * u, y: p0.y + ey * u });
    const T = [];
    for (let k = 0; k < plan.n; k++) {
      const c = at(plan.start + k * plan.p);
      T.push(_gcPath(gearRackToothPoly(c.x, c.y, nx, ny, m, -(GEAR_DEDENDUM + 0.2) * m, GEAR_ADDENDUM * m), true));
    }
    const u0 = Math.max(0, plan.start - plan.p / 2), u1 = Math.min(face.len, plan.start + (plan.n - 1) * plan.p + plan.p / 2);
    const band = (y0, y1) => { const a = at(u0), c = at(u1);
      return [_gcPath([{ x: a.x + nx * y0, y: a.y + ny * y0 }, { x: c.x + nx * y0, y: c.y + ny * y0 },
                       { x: c.x + nx * y1, y: c.y + ny * y1 }, { x: a.x + nx * y1, y: a.y + ny * y1 }], true)]; };
    grooves = _gcOp(CT.ctDifference, band(-GEAR_DEDENDUM * m, GC_OVERLAP * m), T);
    adds    = _gcOp(CT.ctIntersection, T, band(-GC_OVERLAP * m, GEAR_ADDENDUM * m + 0.05));
    // 控え：e は (−ny,nx) に揃える（gear.js の約束）。歯の中心の1つを o にする
    const o = at(plan.start), sgn = (ex * -ny + ey * nx) >= 0 ? 1 : -1;
    const ua = (plan.start - plan.p / 2 - plan.start) * sgn, ub = ((plan.n - 1) * plan.p + plan.p / 2) * sgn;
    rec = { kind: 'rack', ox: o.x, oy: o.y, nx, ny, u0: Math.min(ua, ub), u1: Math.max(ua, ub), m };
  } else {
    const { cx, cy, r: R } = face;
    const polys = [];
    for (let k = 0; k < plan.n; k++) {
      // 外歯は歯（材料）、内歯は歯みぞ（空き）。内側の端は少し深めに作って帯と重ねる
      const c = plan.start + k * plan.pA;
      polys.push(_gcPath(gearArcToothPoly(cx, cy, R, m, c, plan.thick, plan.rIn - 0.2 * m, plan.rOut), true));
    }
    const ov = GC_OVERLAP * m;
    const a0 = plan.start - plan.pA / 2, a1 = plan.start + (plan.n - 1) * plan.pA + plan.pA / 2;
    const full = face.full;
    if (!face.internal) {
      grooves = _gcOp(CT.ctDifference, _gcAnnulus(cx, cy, plan.rIn, R + ov, a0, a1, full, plan.pA / 4), polys);
      adds    = _gcOp(CT.ctIntersection, polys, _gcAnnulus(cx, cy, R - ov, plan.rOut + 0.05, a0, a1, full, plan.pA / 4));
      rec = { kind: 'arc', cx, cy, r: R, a0: plan.start, lo: a0, hi: a1, full, internal: false, m };
    } else {
      grooves = _gcOp(CT.ctIntersection, polys, _gcAnnulus(cx, cy, R - ov, plan.rOut, a0, a1, full, plan.pA / 4));
      adds    = _gcOp(CT.ctDifference, _gcAnnulus(cx, cy, plan.rIn, R + ov, a0, a1, full, plan.pA / 4), polys);
      rec = { kind: 'arc', cx, cy, r: R, a0: plan.start + plan.pA / 2, lo: a0, hi: a1, full, internal: true, m };
    }
  }
  let sol = _gcOp(CT.ctDifference, bodyPaths, grooves);
  sol = _gcOp(CT.ctUnion, sol, adds);
  sol = ClipperLib.Clipper.SimplifyPolygons(sol, ClipperLib.PolyFillType.pftNonZero);
  // ★面積が全体の 1/1000 に満たない輪は捨てる（重ね合わせの丸めで残る破片）
  const areaOf = P => Math.abs(ClipperLib.Clipper.Area(P));
  const big = sol.reduce((a, P) => Math.max(a, areaOf(P)), 0);
  sol = sol.filter(P => areaOf(P) > big * 1e-3);
  const outers = clipperOuterShapes(sol);
  if (outers.length !== 1)
    return { err: '歯みぞを彫ると物体が切れてしまいます（面の奥の厚みが歯の深さより薄い）' };
  const verts = outers[0].pts, hl = outers[0].holeList;
  const arcs = detectArcs(verts, hl, bodySourceCircles(b));
  return { verts, holes: hl, arcs, rec, plan };
}
function gearCoatApply(b, wx, wy) {
  if (typeof ClipperLib === 'undefined') return '図形演算のライブラリ（lib/clipper.js）を読み込めませんでした';
  const face = gearCoatFaceAt(b, wx, wy);
  const r = face.err ? face : gearCoatCarve(b, face, gearModule);
  if (r.err) return r.err;
  pushUndo();
  reshapeBodyInPlace(b, r.verts, r.holes, r.arcs, r.rec);
  if (selectedIds.has(b.id)) updatePropsPanel(b);
  const what = face.kind === 'rack' ? 'ラック' : face.internal ? '内歯車' : face.full ? '歯車' : '扇形歯車';
  let msg = `${what}の歯を ${r.plan.n} 枚刻みました`;
  if (r.plan.seam > 1e-3) msg += `（1周 ${r.plan.z.toFixed(2)} 枚で整数でないため、継ぎ目の歯みぞが1つ広くなっています）`;
  return msg;
}

// ─── 歯車コート：面の強調（カーソルの下の面と、何枚入るか）───────────────
function drawGearCoatHover() {
  if (currentTool !== 'gearcoat' || !mouseWorld) return;
  const b = bodyNearestToPoint(mouseWorld.x, mouseWorld.y, PICK_TOL_PX);
  if (!b) return;
  const face = gearCoatFaceAt(b, mouseWorld.x, mouseWorld.y);
  const plan = face.err ? face : gearCoatPlan(face, gearModule);
  const ok = !plan.err;
  const W = (x, y) => { const q = _toWorld(b, x, y); return worldToScreen(q.x, q.y); };
  ctx.save();
  ctx.strokeStyle = ok ? '#66bb6a' : '#ef5350'; ctx.lineWidth = 4; ctx.setLineDash([]);
  ctx.beginPath();
  if (!face.err && face.kind === 'rack') {
    const a = W(face.p0.x, face.p0.y), c = W(face.p1.x, face.p1.y);
    ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y);
  } else if (!face.err) {
    const N = 64;
    for (let k = 0; k <= N; k++) {
      const a = face.lo + (face.hi - face.lo) * k / N;
      const s = W(face.cx + face.r * Math.cos(a), face.cy + face.r * Math.sin(a));
      if (k) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
    }
  }
  ctx.stroke();
  const sp = worldToScreen(mouseWorld.x, mouseWorld.y);
  ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = ok ? '#66bb6a' : '#ef5350';
  const what = face.kind === 'rack' ? 'ラック' : face.internal ? '内歯車' : face.full ? '歯車' : '扇形歯車';
  ctx.fillText(ok ? `${what} ${plan.n} 枚` : plan.err, sp.x + 12, sp.y - 8);
  ctx.restore();
}

// ─── 左の「歯車」ボタン：歯車と歯車コートを1つの窓で切り替える ─────────────────
//   ★ボタンは1つ。窓の上の切り替えで、描く道具（歯車）と刻む道具（歯車コート）を選ぶ。
//     最後に選んだほうを覚えておき、次にボタンを押したらそちらで開く。
let gearToolMode = 'gear';
function toggleGearMenu(e) {
  if (gearToolMode === 'gearcoat') toggleGearCoatMenu(e); else toggleShapeMenu(e, 'gear');
}
function gearModeSwitchHTML(active) {
  const b = (mode, label) => `<button class="gear-mode-btn${active === mode ? ' active' : ''}" data-mode="${mode}"
      style="flex:1;padding:4px 0;font-size:11px;cursor:pointer;border-radius:4px;
             border:1px solid ${active === mode ? 'var(--accent)' : 'var(--border)'};
             background:${active === mode ? 'rgba(79,195,247,.15)' : 'transparent'};
             color:${active === mode ? 'var(--accent)' : 'var(--text2)'}">${label}</button>`;
  return `<div style="display:flex;gap:6px;margin-bottom:10px">${b('gear', '歯車を描く')}${b('gearcoat', '歯車コート')}</div>`;
}
function wireGearModeSwitch(menu) {
  for (const btn of menu.querySelectorAll('.gear-mode-btn')) {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const mode = btn.dataset.mode;
      if (mode === currentTool) return;
      gearToolMode = mode;
      const top = parseFloat(menu.style.top) || 100;
      closeToolPopups();
      toggleGearMenu({ clientY: top });   // 同じ高さで開き直す
    });
  }
}
// ─── 歯車コートの設定窓（歯の大きさは歯車ツールと共通）─────────────────────
function toggleGearCoatMenu(e) {
  const same = !!document.getElementById('gearcoat-popup') && currentTool === 'gearcoat';
  closeToolPopups();
  if (same) return;
  setTool('gearcoat');
  const menu = document.createElement('div');
  menu.id = 'gearcoat-popup';
  const top = Math.min(e.clientY, window.innerHeight - 200);
  menu.style.cssText =
    'position:absolute; background:var(--panel); border:1px solid var(--accent); border-radius:6px;' +
    'padding:10px; z-index:1000; left:58px; top:' + top + 'px; width:210px; box-shadow:var(--shadow);';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent)">歯車ツール設定</span>
      <span id="gc-close" style="cursor:pointer;color:var(--text2);font-size:15px;line-height:1">×</span>
    </div>
    ${gearModeSwitchHTML('gearcoat')}
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
      <span style="font-size:10px;color:var(--text2)">歯の大きさ（モジュール）[cm]</span>
      <span id="gc-m-val" style="font-size:11px;font-weight:600;color:var(--accent)"></span>
    </div>
    <input type="range" id="gc-m" min="2" max="30" step="1" style="width:100%">
    <div style="font-size:9px;line-height:1.5;margin-top:6px;color:var(--text2)">
      歯車ツールと共通です。かみ合うのは同じ大きさの歯どうしだけ。<br>
      直線の面＝ラック、円弧の面＝扇形歯車、へこんだ円弧＝内歯車になります。
      それ以外の曲線には付けられません。
    </div>`;
  document.body.appendChild(menu);
  const sld = menu.querySelector('#gc-m'), val = menu.querySelector('#gc-m-val');
  const show = () => { val.textContent = Math.round(gearModule * PX2M * 100); };
  sld.value = Math.round(gearModule * PX2M * 100);
  sld.addEventListener('input', () => { gearModule = parseFloat(sld.value) / 100 * M2PX; show(); refreshToolHint(); });
  show();
  wireGearModeSwitch(menu);
  menu.querySelector('#gc-close').addEventListener('click', () => menu.remove());
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('click', ev => ev.stopPropagation());
}

// ─── 円形歯車の歯数・モジュール（右パネル）──────────────────────────────
//   ★形は z と m だけで決まるので、変えたら輪郭を作り直す。そのあと今の相手と
//     かみ合う位置へ吸着し直す。ジョイントで留まっている歯車は動かさない（軸が外れる）ので、
//     向きだけ合わせる。それでも他の物体に食い込むなら変更を取り消して理由を出す
//     （食い込んだまま始まると弾け飛ぶ）。
function setGearShape(b, z, m) {
  b.type = 'polygon';
  b.verts = gearOutline(z, m); b.holes = []; b.arcs = null;
  b.gear = { z, m };
  const cp = buildConvexParts(b.verts, b.holes);
  b.convexParts = cp.parts; b.partEdgeInternal = cp.internal; b.partEdgeArc = null;
  if (b.density == null) b.density = b.mass / Math.max(b.areaM2() * world.depth, 1e-9);
  b.setMass(b.massFromDensity());
  b._invalidateShape(); b._updateAABB();
  b.sleeping = false; b.sleepTimer = 0;
}
function _gearDeepestOverlap(b) {
  let worst = 0, who = null;
  for (const o of objects) {
    if (o === b) continue;
    const cs = detectCollision(b, o);
    if (cs) for (const c of cs) if (c.depth > worst) { worst = c.depth; who = o; }
  }
  return { worst, who };
}
// drag：右パネルのつまみから呼ぶときの、ドラッグ1回ぶんの状態（slider.js の armGear が作る）。
//   渡されたら undo は積まない（呼び出し側が、変更が実際に残ったときだけ積む）。
//   ★食い込みの案内もドラッグ1回につき1度だけ出す。つまみを動かすたびに取り消しが起きるので、
//     毎回出すと案内が連発し、2.2秒で消える予定も延び続ける。戻り値は変更が残ったか
function updateGearParam(key, v, drag) {
  let last = null;
  const snap = snapshotState();   // ★取り消すことがあるので、残ると決まってから積む
  let kept = false;
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    const g = b && gearInfoOf(b);
    if (!g) continue;
    let z = g.z, m = g.m;
    if (key === 'z') z = Math.max(GEAR_MIN_Z, Math.min(GEAR_MAX_Z, Math.round(parseFloat(v) || 0)));
    else { const mm = parseFloat(v); if (!(mm > 0)) continue; m = Math.max(2, Math.min(30, mm)) / 100 * M2PX; }
    if (z === g.z && Math.abs(m - g.m) < 1e-9) continue;
    const before = { x: b.x, y: b.y, angle: b.angle, z: g.z, m: g.m };
    const partner = (gearMeshPose(b.x, b.y, g.z, g.m, b) || {}).with;   // 今かみ合っている相手
    setGearShape(b, z, m);
    const linked = joints.some(j => j.bodyA === b || j.bodyB === b) || slinkies.some(S => S.bodyA === b || S.bodyB === b);
    const pose = partner ? gearMeshPose(b.x, b.y, z, m, b, partner) : gearMeshPose(b.x, b.y, z, m, b);
    if (pose) {
      if (!linked) { b.x = pose.x; b.y = pose.y; }
      if (Math.hypot(pose.x - b.x, pose.y - b.y) < 0.5) b.angle = pose.angle;
      b._invalidateShape(); b._updateAABB();
    }
    const ov = _gearDeepestOverlap(b);
    if (ov.worst > 0.5) {
      b.x = before.x; b.y = before.y; b.angle = before.angle;
      setGearShape(b, before.z, before.m);
      // ★食い込みの深さは出さない。凹形を分解した凸パーツどうしの SAT の値で、重なりの深さではない
      if (!drag || !drag.hinted) flashHint(`歯車を変えると${ov.who && ov.who.label ? '「' + ov.who.label + '」' : 'ほかの物体'}に食い込むので、変更を取り消しました` +
                (linked ? '（軸などで留まっている歯車は吸着で動かしません）' : ''));
      if (drag) drag.hinted = true;
    } else kept = true;
    last = b;
  }
  if (kept && !drag) pushUndo(snap);
  if (last) updatePropsPanel(last);
  return kept;
}
