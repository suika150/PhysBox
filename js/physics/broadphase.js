function broadPhasePairs(dt) {
  const cell = 120; 
  const d = dt || 0;
  const grid = new Map();
  for (const b of objects) {
    if (b.layers === 0 || b.frozen) continue;
    const a = b._aabb;
    const m = 4 + (len(b.vx, b.vy) + (b._grabbed ? 12 * M2PX : 0)) * d;
    const x0 = Math.floor((a.minX - m) / cell), x1 = Math.floor((a.maxX + m) / cell);
    const y0 = Math.floor((a.minY - m) / cell), y1 = Math.floor((a.maxY + m) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = (cx * 73856093) ^ (cy * 19349663);
        let arr = grid.get(k);
        if (!arr) grid.set(k, arr = []);
        arr.push(b);
      }
    }
  }
  const pairs = [], seen = new Set();
  for (const arr of grid.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const A = arr[i], B = arr[j];
        const pk = A.id < B.id ? A.id + '_' + B.id : B.id + '_' + A.id;
        if (seen.has(pk)) continue;
        seen.add(pk);
        pairs.push([A, B, pk]);   // ★生成済みのキーを渡す（detectCollision での再生成を防ぐ）
      }
    }
  }
  return pairs;
}
// ═══ ロープ/棒 ↔ 物体の衝突（単一線分コライダによる近似スナッグ）═══
function _closestPtSeg(px, py, ax, ay, bx, by) {
  const dx = bx-ax, dy = by-ay;
  const L2 = dx*dx + dy*dy || 1e-9;
  let t = ((px-ax)*dx + (py-ay)*dy) / L2;
  t = t<0?0:t>1?1:t;
  return { x: ax+dx*t, y: ay+dy*t, t };
}
function _segSegClosest(p1, p2, p3, p4) {
  const ux=p2.x-p1.x, uy=p2.y-p1.y;
  const vx=p4.x-p3.x, vy=p4.y-p3.y;
  const wx=p1.x-p3.x, wy=p1.y-p3.y;
  const a=ux*ux+uy*uy, b=ux*vx+uy*vy, c=vx*vx+vy*vy, d=ux*wx+uy*wy, e=vx*wx+vy*wy;
  const D=a*c-b*b; let sc, tc;
  if (D < 1e-4*a*c || D < 1e-9) {
    // 平行・準平行（±0.6°以内）：重なり区間の中点を接触点にする。
    // 従来の sc=0 固定では接触が全セグメントの始点側へ寄り、
    // 支点セグメントでは s≤0.02 の除外に必ず落ちて端の支えが消えていた。
    if (a > 1e-9) {
      const t3 = -d/a, t4 = (b-d)/a;               // p3,p4 を線分1へ射影
      const lo = Math.max(0, Math.min(t3, t4));
      const hi = Math.min(1, Math.max(t3, t4));
      sc = lo <= hi ? (lo+hi)/2 : Math.max(0, Math.min(1, (t3+t4)/2));
    } else sc = 0;
  } else {
    sc = (b*e-c*d)/D;
    sc = sc<0?0:sc>1?1:sc;
  }
  // sc を固定して線分2側を最小化し、はみ出したら線分2の端で sc を取り直す（再射影クランプ）。
  // 独立クランプは最近接点が線分外のとき距離を大きく過大評価し、接触を取りこぼしていた。
  tc = c > 1e-9 ? (e + b*sc)/c : 0;
  if (tc < 0)      { tc = 0; sc = a > 1e-9 ? -d/a      : 0; }
  else if (tc > 1) { tc = 1; sc = a > 1e-9 ? (b - d)/a : 0; }
  sc = sc<0?0:sc>1?1:sc; tc = tc<0?0:tc>1?1:tc;
  const ax=p1.x+ux*sc, ay=p1.y+uy*sc, bx=p3.x+vx*tc, by=p3.y+vy*tc;
  return { s:sc, t:tc, ax, ay, bx, by, dist: len(ax-bx, ay-by) };
}
function segmentBodyContact(P0, P1, b, thickness) {
  if (b.type === 'circle') {
    const cp = _closestPtSeg(b.x, b.y, P0.x, P0.y, P1.x, P1.y);
    const dx = b.x-cp.x, dy = b.y-cp.y, dist = len(dx, dy);
    const minD = b.radius + thickness;
    if (dist >= minD) return null;
    const nx = dist>1e-6 ? -dx/dist : 0, ny = dist>1e-6 ? -dy/dist : -1; // 円→線分（線分を押し出す向き）
    return { s: cp.t, cx: cp.x, cy: cp.y, nx, ny, depth: minD-dist };
  }
  const parts = b._worldParts();
  let best = null;
  for (const verts of parts) {
    const n = verts.length;
    for (let i=0;i<n;i++){
      const r = _segSegClosest(P0, P1, verts[i], verts[(i+1)%n]);
      if (r.dist < thickness && (!best || r.dist < best.dist))
        best = { dist:r.dist, s:r.s, segx:r.ax, segy:r.ay, polx:r.bx, poly:r.by };
    }
  }
  if (!best) return null;
  let nx = best.segx-best.polx, ny = best.segy-best.poly, nl = len(nx, ny);
  if (nl < 1e-6) { const cen=_centroid(parts[0]); nx=best.segx-cen.x; ny=best.segy-cen.y; nl=len(nx,ny)||1; }
  nx/=nl; ny/=nl;
  return { s: best.s, cx: best.polx, cy: best.poly, nx, ny, depth: thickness-best.dist };
}
function _anchorVel(body, wx, wy) {
  if (!body || body.isStatic) return { x:0, y:0 };
  const rx = wx-body.x, ry = wy-body.y;
  return { x: body.vx - body.av*ry, y: body.vy + body.av*rx };
}
function _anchorInvMassAlong(body, wx, wy, nx, ny) {
  if (!body || _pinned(body)) return 0;   // ★held（ドラッグ中）も静的と同じく押しのけられない
  const rx = wx-body.x, ry = wy-body.y, cross = rx*ny - ry*nx;
  return body.invMass + cross*cross*body.invInertia;
}
