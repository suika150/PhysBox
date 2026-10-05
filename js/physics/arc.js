// ═══ 円弧を形状として保持する ═══════════════════════════════════════════
//  図形和ツール（ブーリアン）は円を48角形に近似してから演算するので、結果の形は
//  多角形しか残らない。その面の上を物体が滑ると、面の継ぎ目ごとに進行方向を
//  7.5°折り曲げることになり、折り曲げに使われる法線方向の速度が接触ソルバに
//  吸収される。しかも接近速度が RESTITUTION_VEL_TH(1m/s) 未満だと反発係数が0に
//  上書きされるため、角を1つ通るたびに運動エネルギーの sin²7.5°≒1.7% が消える。
//  摩擦0でも振り子の振幅が減っていくのはこれが原因。
//
//  そこで「元は円だった区間」を円弧として覚えておき、その区間だけ真円として
//  衝突を解く。多角形は当たり判定の骨組み・面積・慣性・描画のために従来どおり
//  持ち続け、接触の法線と貫入量だけを真円で置き換える。
//
//  b.arcs = [{ loop, i0, i1, cx, cy, r, a0, sweep, ccw, full, concave, bulge }]
//    loop     : -1 = 外周 / 0.. = holes[k]
//    i0,i1    : そのループの頂点番号（i0 から i1 へ進む区間が円弧。描画用）
//    cx,cy,r  : 円の中心と半径（ローカル座標）
//    a0,sweep : a0 から ccw 方向へ sweep [rad] ぶんが円弧
//    concave  : true = 材料は円の外側（穴の内壁＝お椀）／false = 円の内側（出っ張り）
//    bulge    : 多角形の辺に対して真円がふくらむ最大量 [px]（AABB を広げるのに使う）
const ARC_ON_TOL   = 0.08;   // [px] 頂点が円周上にあるとみなす許容差（Clipper の丸めは 0.01px）
const ARC_MIN_VERT = 3;      // 円弧と認める最小の連続頂点数（＝2辺以上）
const ARC_MAX_SAG  = 0.02;   // 円弧の1辺として許す、辺の中点の円からの離れ ×r（下の detectArcs の★）
const _TWO_PI = Math.PI * 2;
function _norm2pi(a) { a %= _TWO_PI; return a < 0 ? a + _TWO_PI : a; }

// 点（ローカル座標）が円弧の角度範囲に入っているか
function arcCovers(arc, lx, ly) {
  if (arc.full) return true;
  const th = Math.atan2(ly - arc.cy, lx - arc.cx);
  return _norm2pi((th - arc.a0) * (arc.ccw ? 1 : -1)) <= arc.sweep;
}
function arcWorldCenter(b, arc) {
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  return { x: b.x + arc.cx * c - arc.cy * s, y: b.y + arc.cx * s + arc.cy * c };
}

// ─── ブーリアン結果から円弧を拾い直す ────────────────────────────────
//   ClipperLib は多角形しか返さないので、「入力に使った円」を手掛かりに、
//   その円周上に乗っている連続した頂点列を円弧として復元する。
//   circles / 各ループはすべて同じ（ローカル）座標系で渡すこと。
function detectArcs(outer, holes, circles) {
  if (!circles || !circles.length || !outer || outer.length < 3) return [];
  const loops = [{ idx: -1, pts: outer }];
  (holes || []).forEach((h, k) => { if (h && h.length >= 3) loops.push({ idx: k, pts: h }); });
  const inMaterial = (x, y) => {
    if (!pointInPolygon({ x, y }, outer)) return false;
    for (const h of (holes || [])) if (h && h.length >= 3 && pointInPolygon({ x, y }, h)) return false;
    return true;
  };
  const arcs = [];
  for (const L of loops) {
    const pts = L.pts, n = pts.length;
    const own = new Array(n);
    for (let i = 0; i < n; i++) {
      own[i] = -1;
      for (let c = 0; c < circles.length; c++) {
        const C = circles[c];
        if (Math.abs(Math.hypot(pts[i].x - C.cx, pts[i].y - C.cy) - C.r) <= ARC_ON_TOL) { own[i] = c; break; }
      }
    }
    // ★両端が同じ円に乗っていても、辺そのものが円から離れていれば円弧ではない。
    //   半円（円 − 箱）の平らな辺は両端が円周上にあるので、頂点だけで見ると全周が1つの円に
    //   乗って見え、「全周の円弧・へこみ（concave）」と誤判定されていた（ふくらみの判定点が
    //   空の半分に落ちるため）。そうなると曲面に当たった物体がお椀の内側として解かれる。
    //   辺の中点が円から ARC_MAX_SAG·r より内側へ離れていたら、そこで円弧を切る
    //   （48角形の辺のふくらみは 0.0021·r なので十分に余裕がある）。
    const brk = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i - 1 + n) % n, c = own[i];
      brk[i] = false;
      if (c < 0 || own[j] !== c) continue;
      const C = circles[c];
      const d = Math.hypot((pts[i].x + pts[j].x) / 2 - C.cx, (pts[i].y + pts[j].y) / 2 - C.cy);
      if (C.r - d > ARC_MAX_SAG * C.r) brk[i] = true;
    }
    const cont = i => own[i] === own[(i - 1 + n) % n] && !brk[i];   // i が i−1 からの続きか
    // 連続して同じ円に乗っている区間を切り出す
    let start = -1;
    for (let i = 0; i < n; i++) if (!cont(i)) { start = i; break; }
    if (start < 0) {                                   // 全周が同じ円＝まるごと1本の円弧
      if (own[0] >= 0) {
        const a = _makeArc(L.idx, 0, n - 1, pts, circles[own[0]], true, inMaterial);
        if (a) arcs.push(a);
      }
      continue;
    }
    let i = 0;
    while (i < n) {
      const s = (start + i) % n, c = own[s];
      let k = 1;
      while (k < n && cont((start + i + k) % n)) k++;
      if (c >= 0 && k >= ARC_MIN_VERT) {
        const a = _makeArc(L.idx, s, (s + k - 1) % n, pts, circles[c], false, inMaterial);
        if (a) arcs.push(a);
      }
      i += k;
    }
  }
  return arcs;
}
function _makeArc(loopIdx, i0, i1, pts, circle, full, inMaterial) {
  const n = pts.length;
  const idx = [];
  for (let i = i0; ; i = (i + 1) % n) { idx.push(i); if (i === i1) break; if (idx.length > n) return null; }
  if (idx.length < 2) return null;
  const ang = idx.map(i => Math.atan2(pts[i].y - circle.cy, pts[i].x - circle.cx));
  // 進む向き（角度が増えるか減るか）と、通算の角度幅
  let sweep = 0, dir = 0;
  for (let k = 1; k < ang.length; k++) {
    let d = ang[k] - ang[k - 1];
    while (d >  Math.PI) d -= _TWO_PI;
    while (d < -Math.PI) d += _TWO_PI;
    if (dir === 0 && d !== 0) dir = d > 0 ? 1 : -1;
    sweep += Math.abs(d);
  }
  if (dir === 0) return null;
  if (full) sweep = _TWO_PI;
  else if (sweep >= _TWO_PI) sweep = _TWO_PI - 1e-6;
  // 材料が円の内・外どちらにあるか：円弧の中ほどから少しだけ内側へ入った点で判定する
  const mid = ang[0] + dir * sweep * 0.5;
  const probe = Math.min(circle.r * 0.25, Math.max(circle.r * 0.03, 0.5));
  const px = circle.cx + Math.cos(mid) * (circle.r - probe);
  const py = circle.cy + Math.sin(mid) * (circle.r - probe);
  const concave = !inMaterial(px, py);       // 内側が空 ＝ 穴の内壁（お椀）
  // 真円が多角形の辺からふくらむ最大量（AABB を広げる分）
  let bulge = 0;
  for (let k = 1; k < idx.length; k++) {
    const a = pts[idx[k - 1]], b = pts[idx[k]];
    const d = Math.hypot((a.x + b.x) / 2 - circle.cx, (a.y + b.y) / 2 - circle.cy);
    if (circle.r - d > bulge) bulge = circle.r - d;
  }
  return { loop: loopIdx, i0, i1, cx: circle.cx, cy: circle.cy, r: circle.r,
           a0: ang[0], sweep, ccw: dir > 0, full: !!full, concave, bulge: Math.max(bulge, 0) };
}
// 物体が持つ円（円弧の元）をローカル座標で列挙する。ブーリアンの入力集めに使う。
function bodySourceCircles(b) {
  if (b.type === 'circle') return [{ cx: 0, cy: 0, r: b.radius }];
  if (b.arcs && b.arcs.length) return b.arcs.map(a => ({ cx: a.cx, cy: a.cy, r: a.r }));
  return [];
}
// ─── 凸パーツのどの辺が円弧の上に乗っているか ───────────────────────
//   partEdgeInternal（分解で生まれた内部辺）と同じ形の並びで持つ。
//   0 = 円弧ではない / k+1 = arcs[k] の上にある
function buildPartArcFlags(parts, arcs) {
  if (!arcs || !arcs.length || !parts || !parts.length) return null;
  let found = false;
  const out = parts.map(p => {
    const n = p.length, f = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      for (let k = 0; k < arcs.length; k++) {
        const A = arcs[k];
        if (Math.abs(Math.hypot(a.x - A.cx, a.y - A.cy) - A.r) > ARC_ON_TOL) continue;
        if (Math.abs(Math.hypot(b.x - A.cx, b.y - A.cy) - A.r) > ARC_ON_TOL) continue;
        if (!arcCovers(A, (a.x + b.x) / 2, (a.y + b.y) / 2)) continue;
        f[i] = k + 1; found = true; break;
      }
    }
    return f;
  });
  return found ? out : null;
}
// ─── 接触の生成 ─────────────────────────────────────────────────────
//   host = 円弧を持つ側、other = 相手。法線は「other → 材料」の向き（既存の規約と同じ）。
//   contact には arcK / arcLx,arcLy / arcRad を入れておき、位置補正のときに
//   真円で測り直せるようにする。
function _arcContact(other, host, arc, k, C, ux, uy, depth, lx, ly, rad, orbit) {
  return {
    A: other, B: host,
    nx: arc.concave ?  ux : -ux,
    ny: arc.concave ?  uy : -uy,
    depth, sep: -depth, cx: C.x + ux * arc.r, cy: C.y + uy * arc.r,
    partA: -1, partB: 'a' + k,
    arcK: k, arcLx: lx, arcLy: ly, arcRad: rad,
    // ★接触している点が実際に回る半径（壁の半径ではない）。球なら中心が回る半径
    //   r∓球半径。離散化で生じる見かけの接近速度 v²dt/orbit の見積りに使う。
    arcR: orbit,

  };
}
// only = 対象にする円弧の番号（Set）。多角形どうしの判定で「実際に材料と重なっている」
//   と分かった円弧だけを渡すこと。渡さないと、へこみ側の円弧は「円の外にある物体は
//   すべてめり込み」と見なしてしまい、板の反対側に載っているだけの物体まで穴へ
//   押し込んでしまう（材料は円の外の“殻”にしかないため）。
function collectArcContacts(out, other, host, only) {
  const arcs = host.arcs;
  if (!arcs || !arcs.length) return false;
  let any = false;
  for (let k = 0; k < arcs.length; k++) {
    if (only && !only.has(k)) continue;
    const arc = arcs[k];
    const C = arcWorldCenter(host, arc);
    if (other.type === 'circle') {
      const dx = other.x - C.x, dy = other.y - C.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      const lp = getLocalAnchor(host, other.x, other.y);
      if (!arcCovers(arc, lp.x, lp.y)) continue;
      const depth = arc.concave ? (d + other.radius) - arc.r : (arc.r + other.radius) - d;
      if (!(depth > 0)) continue;
      out.push(_arcContact(other, host, arc, k, C, dx / d, dy / d, depth, 0, 0, other.radius, d));
      any = true;
    } else {
      const parts = other._worldParts();
      for (const part of parts) {
        if (arc.concave) {
          // 材料は円の外＝相手は円の内側にいなければならない。凸パーツが円からはみ出す
          // のは必ず頂点なので、深い順に最大2点を接触にする（凸ならこれで厳密）。
          let b1 = null, b2 = null;
          for (const v of part) {
            const dx = v.x - C.x, dy = v.y - C.y;
            const d = Math.hypot(dx, dy);
            const depth = d - arc.r;
            if (!(depth > 0) || d < 1e-9) continue;
            const lp = getLocalAnchor(host, v.x, v.y);
            if (!arcCovers(arc, lp.x, lp.y)) continue;
            const cand = { v, ux: dx / d, uy: dy / d, depth, d };
            if (!b1 || depth > b1.depth) { b2 = b1; b1 = cand; }
            else if (!b2 || depth > b2.depth) b2 = cand;
          }
          for (const c of [b1, b2]) {
            if (!c) continue;
            const lo = getLocalAnchor(other, c.v.x, c.v.y);
            out.push(_arcContact(other, host, arc, k, C, c.ux, c.uy, c.depth, lo.x, lo.y, 0, c.d));
            any = true;
          }
        } else {
          // 材料は円の内＝ふつうの円と凸多角形の衝突。最近接点で解く。
          const q = _closestPointOnConvex(part, C.x, C.y);
          if (!(q.dist < arc.r) || q.dist < 1e-9) continue;
          const ux = (q.x - C.x) / q.dist, uy = (q.y - C.y) / q.dist;
          const lc = getLocalAnchor(host, C.x + ux * arc.r, C.y + uy * arc.r);   // 接触点（円周上）
          if (!arcCovers(arc, lc.x, lc.y)) continue;
          const lo = getLocalAnchor(other, q.x, q.y);
          out.push(_arcContact(other, host, arc, k, C, ux, uy, arc.r - q.dist, lo.x, lo.y, 0, q.dist));
          any = true;
        }
      }
    }
  }
  return any;
}
// この接触点は何番の円弧が受け持つ面の上か（無ければ -1）
//   へこみ側（お椀の内壁）… 材料は半径 r の外なので、r+tol より内側の接触点は内壁のもの
//   出っ張り側（円のふち）… 材料は半径 r の内なので、r-tol より外側の接触点はふちのもの
//   めり込みが深いほど半径方向へずれるが、上の向きにずれるので判定は破綻しない。
const ARC_OWN_TOL = 2;   // [px]
function arcIndexOwning(host, c) {
  const arcs = host.arcs;
  if (!arcs || !arcs.length) return -1;
  if (c.A !== host && c.B !== host) return -1;
  for (let k = 0; k < arcs.length; k++) {
    const arc = arcs[k];
    const C = arcWorldCenter(host, arc);
    const d = Math.hypot(c.cx - C.x, c.cy - C.y);
    if (arc.concave ? (d > arc.r + ARC_OWN_TOL) : (d < arc.r - ARC_OWN_TOL)) continue;
    // ★反対側にも限りを付ける。1つの物体に円弧と別の面が同居していると（型抜きした壁と
    //   島を仕切りでつないだ通路など）、円弧の向いている先にある**遠い面**の接触まで
    //   「r より外＝ふち」と読んで拾ってしまう。拾われた接触は collectArcContacts が
    //   真円では作り直せず、接触ごと消える＝その面は素通りになる。
    //   実測：電気量保存モデル（いまの平行板コンデンサーモデル）で電子 28 個のうち 15 個が 300tick で壁を抜けた（島の角
    //   r=45 が、中心から 139px 先の外側の壁の接触を拾っていた）。本物のふちの接触は
    //   r から「折れ線のふくらみ＋めり込み」の幅にしか来ない。
    const slack = (arc.bulge || 0) + Math.max(0, c.depth || 0) + ARC_OWN_TOL;
    if (arc.concave ? (d < arc.r - slack) : (d > arc.r + slack)) continue;
    const lp = getLocalAnchor(host, c.cx, c.cy);
    if (arcCovers(arc, lp.x, lp.y)) return k;
  }
  return -1;
}
function _closestPointOnConvex(verts, px, py) {
  let bx = verts[0].x, by = verts[0].y, bd = Infinity;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y;
    const L2 = ex * ex + ey * ey || 1e-9;
    let t = ((px - a.x) * ex + (py - a.y) * ey) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + ex * t, qy = a.y + ey * t;
    const d = Math.hypot(px - qx, py - qy);
    if (d < bd) { bd = d; bx = qx; by = qy; }
  }
  return { x: bx, y: by, dist: bd };
}
// 位置補正のたびに、真円の幾何で法線と貫入量を測り直す（面の継ぎ目を持ち込まない）
function arcContactGeom(c) {
  const host = c.B, arc = host.arcs && host.arcs[c.arcK];
  if (!arc) return null;
  const C = arcWorldCenter(host, arc);
  const p = c.A.type === 'circle' ? { x: c.A.x, y: c.A.y } : getWorldAnchor(c.A, c.arcLx, c.arcLy);
  const dx = p.x - C.x, dy = p.y - C.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return null;
  const ux = dx / d, uy = dy / d;
  const depth = arc.concave ? (d + c.arcRad) - arc.r : (arc.r + c.arcRad) - d;
  return { nx: arc.concave ? ux : -ux, ny: arc.concave ? uy : -uy, depth };
}
