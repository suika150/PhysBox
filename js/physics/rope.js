// 棒（rod）と物体の接触。棒は線分の当たり判定を持つ「硬い1本の棒」として解く。
//   ★ぶつかる相手（coll）が held＝編集ツールで運搬中なら、そもそも当たらない
//     （ROPE_HELD_NOTE）。ここに残る held の扱いは、棒自身の端が付いている物体
//     （A・B）が運搬中の場合だけ。カーソルが位置を直接与えているので静的物体と同じく
//     「動かせない側」とし、押しのけられるのは棒のほうにする。両端とも動かせないなら
//     denom が 0 になり、その間だけ物体は棒をすり抜けて置ける。
function resolveRopeContact(j, coll, wa, wb, ct) {
  const A = j.bodyA, B = j.bodyB;
  const s = ct.s, nx = ct.nx, ny = ct.ny, cx = ct.cx, cy = ct.cy;
  const imColl = _pinned(coll) ? 0 : coll.invMass;
  const iiColl = _pinned(coll) ? 0 : coll.invInertia;
  const rcx = cx-coll.x, rcy = cy-coll.y, crossC = rcx*ny - rcy*nx;
  const kColl = imColl + crossC*crossC*iiColl;
  const kA = _anchorInvMassAlong(A, wa.x, wa.y, nx, ny) * (1-s)*(1-s);
  const kB = _anchorInvMassAlong(B, wb.x, wb.y, nx, ny) * s*s;
  const denom = kColl + kA + kB;
  if (denom <= 1e-12) return;
  // 位置補正（線形のみ・安定重視）
  const imA = (A && !_pinned(A)) ? A.invMass : 0;
  const imB = (B && !_pinned(B)) ? B.invMass : 0;
  const linDenom = imColl + imA*(1-s)*(1-s) + imB*s*s;
  if (linDenom > 1e-12) {
    const jp = Math.max(ct.depth - 0.5, 0) / linDenom * 0.5;
    if (imColl) { coll.x -= jp*nx*imColl; coll.y -= jp*ny*imColl; coll._updateAABB(); }
    if (imA)    { A.x += jp*nx*imA*(1-s); A.y += jp*ny*imA*(1-s); A._updateAABB(); }
    if (imB)    { B.x += jp*nx*imB*s;     B.y += jp*ny*imB*s;     B._updateAABB(); }
  }
  // 速度補正（非弾性）
  //   ★掴んでいる物体の速度は「手で動かしている速さ」そのものなので、ここでは 0 にせず
  //     そのまま使う（動かせない側だが、動いてはいる）。棒を手で払える挙動になる。
  const va = _anchorVel(A, wa.x, wa.y), vb = _anchorVel(B, wb.x, wb.y);
  const ropeVx = va.x*(1-s) + vb.x*s, ropeVy = va.y*(1-s) + vb.y*s;
  const cvx = coll.isStatic ? 0 : coll.vx - coll.av*rcy;
  const cvy = coll.isStatic ? 0 : coll.vy + coll.av*rcx;
  const relVn = (ropeVx - cvx)*nx + (ropeVy - cvy)*ny;
  if (relVn < 0) {
    const jimp = -relVn / denom;
    coll.applyImpulse(-jimp*nx, -jimp*ny, cx, cy);        // held/静的は applyImpulse 側で弾かれる
    if (A) A.applyImpulse(jimp*nx*(1-s), jimp*ny*(1-s), wa.x, wa.y);
    if (B) B.applyImpulse(jimp*nx*s, jimp*ny*s, wb.x, wb.y);
  }
}
// ═══ ROPE_HELD_NOTE：編集ツールで運んでいる物体は、ロープ・棒と当たらない ═══
//   held は編集ツールでの運搬中だけ立つ（つかむツールは _grabbed で別物）。運搬中の物体は
//   カーソルが位置を直接与えていて物理で動かせないので、当たり判定を残すと押しのけられる
//   のは必ずロープ・棒の側になる。物体をロープの端まで運んで繋ごうとすると、縄が逃げて
//   狙った場所へ置けない（ジョイントの端を物体へ運ぶ逆向きの操作では、前から
//   draggedJointEndTargets で相手を除外してある。その対称形）。
//   長さの拘束のほうは jointLengthSuspended が held で既に丸ごと解いてあるので、
//   当たり判定だけが残っていたのは単に揃っていなかっただけ。離せば元どおり効く。
const ROD_RADIUS = 4;   // 棒の線分の当たり半径（world単位）。太く感じたら小さく
function solveRopeBodyCollisions() {
  const thickness = ROD_RADIUS;
  // ★端をドラッグ中の棒は、その端が重なっている物体（＝これから繋ぐ相手）と当たらない。
  //   詳しくは selection.js の draggedJointEndTargets()。ドラッグしていなければ null。
  const drag = draggedJointEndTargets();
  for (const j of joints) {
    if (j.type !== 'rod') continue;   // ロープはチェーン(updateRopeChains)で衝突
    const jLay = j.layers;            // ★棒のレイヤー（ジョイント自身が持つ）
    if (jLay === 0) continue;         // ★ゴースト＝何にも当たらない
    const placing = (drag && drag.joint === j) ? drag.bodies : null;
    const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
    const minX = Math.min(wa.x, wb.x) - thickness, maxX = Math.max(wa.x, wb.x) + thickness;
    const minY = Math.min(wa.y, wb.y) - thickness, maxY = Math.max(wa.y, wb.y) + thickness;
    for (const coll of objects) {
      if (coll === j.bodyA || coll === j.bodyB) continue;   // 接続先どうしは除外
      if (coll.held) continue;                              // ★編集ツールで運搬中：ROPE_HELD_NOTE 参照
      if (placing && placing.indexOf(coll) >= 0) continue;  // ★これから繋ぐ相手も除外
      if ((jLay & coll.layers) === 0) continue;             // ★レイヤーを共有しなければ素通り
      const a = coll._aabb;
      if (a.maxX < minX || a.minX > maxX || a.maxY < minY || a.minY > maxY) continue;
      const ct = segmentBodyContact(wa, wb, coll, thickness);
      if (ct) resolveRopeContact(j, coll, wa, wb, ct);
    }
  }
}
// ═══ ロープをチェーン（多ノード）としてシミュレートし、本物のたわみ・沿いを出す ═══
function restoreRopeNodes(j, saved) {
  const seg = saved.length + 1;                 // 中間節点数 + 1 = 分割数（保存時と一致）
  const total = j.maxLength || 1;
  j._segCount = seg;
  j._restLen = total / seg;
  const m = Math.max(1e-4, j.linDensity * j._restLen * PX2M);
  j._nodeInvMass = 1 / m;
  j.nodes = saved.map(s => ({
    x: s.x, y: s.y, px: s.x, py: s.y,
    vx: s.vx || 0, vy: s.vy || 0,
    invMass: j._nodeInvMass, _touchT: 0, _cnx: 0, _cny: 0, _onRigid: false, _embed: false,
  }));
  j._cts = [];
  j._loaded = false;
}

const ROPE_SEG_MIN = 4, ROPE_SEG_MAX = 64;
// 総長に対する標準の分割数（約16pxに1節点）
function ropeSegCountFor(total) {
  return Math.max(ROPE_SEG_MIN, Math.min(ROPE_SEG_MAX, Math.round(total / 16)));
}
// _segCount と maxLength から、節点間隔と節点質量を決め直す
//   ★節点質量 m = 線密度 λ [kg/m] × 節点間隔 [m]。
function _ropeRespace(j) {
  j._restLen = (j.maxLength || 1) / j._segCount;
  const m = Math.max(1e-4, j.linDensity * j._restLen * PX2M);
  j._nodeInvMass = 1 / m;
  if (j.nodes) for (const n of j.nodes) n.invMass = j._nodeInvMass;
}
// 長さを変えたあとの後始末。形（節点の位置）は残し、凍結の判定と接触キャッシュだけ捨てる
function _ropeAfterLengthChange(j) {
  j._cts = [];
  j._wrapPts = null;
  j._loaded = false;
  j._calmT = 0; j._anchorCalmT = 0; j._pwa = j._pwb = null; j._nodeDelta = 1e9;
}
function ensureRopeNodes(j) {
  if (j.nodes && j.nodes.length) return;
  const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
  const total = j.maxLength || Math.hypot(wb.x-wa.x, wb.y-wa.y) || 1;
  const seg = ropeSegCountFor(total);
  j._segCount = seg;
  j._restLen = total / seg;
  const m = Math.max(1e-4, j.linDensity * j._restLen * PX2M);
  j._nodeInvMass = 1 / m;
  j.nodes = [];
  for (let k = 1; k < seg; k++) {           // 中間ノードのみ保持（両端は本体アンカー）
    const t = k / seg;
    const n = {
      x: wa.x+(wb.x-wa.x)*t, y: wa.y+(wb.y-wa.y)*t, px:0, py:0, vx:0, vy:0,
      invMass: j._nodeInvMass,
      _touchT: 0, _cnx: 0, _cny: 0,
      _onRigid: false,                       // 地面・静的物体に載っているか（この向きへは動けない）
      _embed: false,                         // 物体の中に入り込んでいるか（支点にしない印）
    };
    n.px = n.x; n.py = n.y;
    j.nodes.push(n);
  }
  j._cts = [];        // 接触キャッシュ（サブステップに1回だけ作り直す）
  j._loaded = false;  // 動的物体が載っているか（載っていたら凍結しない）
}
// ═══ 長さを変えても形（たるみ）を残す ═══════════════════════════════════
//  リンクは等式拘束（ropeLinkConstraint）なので「折れ線の弧長 ≒ maxLength」が常に
//  成り立つ。つまり形をそのままに長さだけ変えることはできず、増減分をどこかで
//  吸収させるしかない。吸収のさせ方を2つ用意する。
//  ★以前はどちらも使わず j.nodes = null にしていた。次のtickで ensureRopeNodes が
//    wa→wb の「直線」で作り直すため、長さを変えるたびにたるみが消えていた。

// ① ウインチ：動かした端で縄を出し入れする。
//    1リンクが受け持つ縄の量（節点間隔）は変えず、本数だけを増減する。止まっている側の
//    形はまったく動かないので、滑車に掛けたロープの片側を引いても反対側のたるみは
//    変わらない（全体へ均等に配ると、こちらを引いただけで向こう側も伸びてしまう）。
//    end は動かした端（'A' | 'B'）。
//    ★unitPx は「縄の刻み」を外から与える指定。省略すると今の節点間隔を使う。
//      ドラッグ中のように少しずつ何度も呼ぶ場合は必ず渡すこと。省略すると、この関数の
//      最後の _ropeRespace が _restLen = maxLength/_segCount と置き直すせいで、次回の
//      want = round(maxLength/_restLen) が必ず今の _segCount に一致してしまう。
//      つまり節点は1本も増えず、間隔だけが伸び続ける（縄が粗くなり、出し入れにならない）。
function retargetRopeLength(j, end, unitPx) {
  if (!j.nodes || !j.nodes.length) return;            // まだ形が無い＝ensureRopeNodes に任せる
  const unit = unitPx > 0.5 ? unitPx                  // 節点間隔＝縄の刻み。これは変えない
             : (j._restLen > 0.5 ? j._restLen : 16);
  const want = Math.round((j.maxLength || 1) / unit);
  const seg  = Math.max(ROPE_SEG_MIN, Math.min(ROPE_SEG_MAX, want));
  if (seg !== want) { resampleRopeNodes(j); return; } // 上限・下限に当たった＝等分割へ逃がす
  const nodes = j.nodes, diff = seg - j._segCount, atA = (end === 'A');
  if (diff > 0) {
    // 動かした端とその隣の節点の間に、新しい節点を等間隔で挿し込む＝そこから縄が出てくる
    const near = atA ? nodes[0] : nodes[nodes.length - 1];
    const anc  = atA ? j.getWorldAnchorA() : j.getWorldAnchorB();
    const add = [];
    for (let k = 1; k <= diff; k++) {                 // near(t=0) → anchor(t=1) の順に並ぶ
      const t = k / (diff + 1);
      const x = near.x + (anc.x - near.x) * t;
      const y = near.y + (anc.y - near.y) * t;
      add.push({ x, y, px: x, py: y, vx: near.vx, vy: near.vy,
                 invMass: j._nodeInvMass, _touchT: 0, _cnx: 0, _cny: 0,
                 _onRigid: false, _embed: false });
    }
    if (atA) nodes.unshift(...add.reverse());         // A側は端に近いものが配列の先頭
    else     nodes.push(...add);
  } else if (diff < 0) {
    // 動かした端から順に巻き取る
    const rm = Math.min(-diff, nodes.length - (ROPE_SEG_MIN - 1));
    if (rm > 0) { if (atA) nodes.splice(0, rm); else nodes.splice(nodes.length - rm, rm); }
  }
  j._segCount = nodes.length + 1;
  _ropeRespace(j);
  _ropeAfterLengthChange(j);
}
// ② 等分割し直し：今の折れ線を弧長で等分割して新しい節点数へ移す。
//    形は（折れ線の精度で）そのまま、刻みだけ新しい長さに合う。縄は全体へ均等に配られる。
//    「どちらの端を動かしたか」が決まらないとき（プロパティの「最大長」に数値を打ち込んだ
//    とき）と、①で節点数が上限・下限に当たったときのフォールバック。
function resampleRopeNodes(j) {
  if (!j.nodes || !j.nodes.length) return;
  const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
  const pts = [wa, ...j.nodes, wb];
  const acc = [0];                                    // 弧長の累積
  for (let i = 1; i < pts.length; i++)
    acc.push(acc[i-1] + len(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y));
  const S = acc[acc.length - 1];
  if (!(S > 1e-6)) { j.nodes = null; return; }        // 潰れている＝素直に作り直させる
  // 端（アンカー）は節点ではないので速度を持たない。内挿のため0として扱う
  const vxOf = i => (i === 0 || i === pts.length - 1) ? 0 : j.nodes[i-1].vx;
  const vyOf = i => (i === 0 || i === pts.length - 1) ? 0 : j.nodes[i-1].vy;
  const seg = ropeSegCountFor(j.maxLength || S);
  const out = [];
  let i = 1;                                          // s は単調に増えるので走査は片道でよい
  for (let k = 1; k < seg; k++) {
    const s = S * k / seg;
    while (i < pts.length - 1 && acc[i] < s) i++;
    const span = acc[i] - acc[i-1];
    const t = span > 1e-9 ? (s - acc[i-1]) / span : 0;
    const x = pts[i-1].x + (pts[i].x - pts[i-1].x) * t;
    const y = pts[i-1].y + (pts[i].y - pts[i-1].y) * t;
    out.push({ x, y, px: x, py: y,
               vx: vxOf(i-1) + (vxOf(i) - vxOf(i-1)) * t,
               vy: vyOf(i-1) + (vyOf(i) - vyOf(i-1)) * t,
               invMass: 1, _touchT: 0, _cnx: 0, _cny: 0, _onRigid: false, _embed: false });
  }
  j.nodes = out;
  j._segCount = seg;
  _ropeRespace(j);
  _ropeAfterLengthChange(j);
}
// ─── 線分 P0→P1 と物体 b の最近接。物体ローカル座標で表面点と外向き法線を返す ───
//   ローカルで返すのがポイント。反復ループ中は物体の姿勢からワールド平面を再構成するだけで済み、
//   最近接エッジ探索（多角形の全辺走査）を毎反復やらずに 1 サブステップ 1 回で済ませられる。
//   戻り値 null = マージン外（接触なし）
function ropeSegLocal(b, P0, P1, R) {
  const M = ROPE_CFG.margin;
  if (b.type === 'circle') {
    const ex = P1.x-P0.x, ey = P1.y-P0.y, L2 = ex*ex + ey*ey || 1e-9;
    let s = ((b.x-P0.x)*ex + (b.y-P0.y)*ey) / L2;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const qx = P0.x + ex*s, qy = P0.y + ey*s;
    const d = len(qx-b.x, qy-b.y);
    if (d - b.radius > R + M) return null;
    return { s, circle: true };              // 円は投影時に毎回再計算（3行で済むので安い）
  }
  const c = Math.cos(-b.angle), sn = Math.sin(-b.angle);
  const a0 = { x: c*(P0.x-b.x) - sn*(P0.y-b.y), y: sn*(P0.x-b.x) + c*(P0.y-b.y) };
  const a1 = { x: c*(P1.x-b.x) - sn*(P1.y-b.y), y: sn*(P1.x-b.x) + c*(P1.y-b.y) };
  const outline = b._localOutline();
  if (!outline || outline.length < 3) return null;
  const holes = (b.type === 'polygon' && b.holes) ? b.holes : [];
  let best = Infinity, bs = 0, bx = 0, by = 0, px = 0, py = 0, ex0 = 1, ey0 = 0;
  for (const loop of [outline, ...holes]) {
    const n = loop.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const p = loop[i], q = loop[(i+1)%n];
      const r = _segSegClosest(a0, a1, p, q);
      if (r.dist < best) {
        best = r.dist; bs = r.s;
        px = r.ax; py = r.ay;      // 線分側の最近接点
        bx = r.bx; by = r.by;      // 物体側の最近接点（＝表面点）
        ex0 = q.x - p.x; ey0 = q.y - p.y;
      }
    }
  }
  const d = best;
  // 「材料の中」＝外周の内側かつ、どの穴の内側でもない
  const inMaterial = (x, y) => {
    if (!pointInPolygon({ x, y }, outline)) return false;
    for (const h of holes) if (h.length >= 3 && pointInPolygon({ x, y }, h)) return false;
    return true;
  };
  const inMat = inMaterial(px, py);
  if (!inMat && d > R + M) return null;
  let ldx, ldy;
  if (d < 1e-3) {                            // 表面上に乗っている：エッジ法線で代用
    const el = len(ex0, ey0) || 1;
    ldx = -ey0/el; ldy = ex0/el;
    // ★凹形状では「重心から見て外向き」が成り立たない（横倒しコップの内壁など）ので、
    //   法線の先が材料の中かどうかで向きを決める。
    if (inMaterial(bx + ldx*0.5, by + ldy*0.5)) { ldx = -ldx; ldy = -ldy; }
  } else {
    const dl = d;
    ldx = inMat ? (bx-px)/dl : (px-bx)/dl;   // 局所の外向き（材料の外へ出る向き）
    ldy = inMat ? (by-py)/dl : (py-by)/dl;
  }
  if (!Number.isFinite(ldx) || !Number.isFinite(ldy) || (ldx === 0 && ldy === 0)) {
    const rl = len(bx, by) || 1;             // 最後の手段：重心(原点)→表面点
    ldx = bx / rl; ldy = by / rl;
    if (inMaterial(bx + ldx*0.5, by + ldy*0.5)) { ldx = -ldx; ldy = -ldy; }   // ★同上
  }
  return { s: bs, circle: false, lx: bx, ly: by, ldx, ldy };
}
// after
function ropeNodeInvMass(j, k, n, nx, ny, waW, wbW, restLen, nCount, vsRigid) {
  // 剛な支え（地面・静的物体）に載っている節点は、その支えへ押し込む向きには動けない。
  // ★向きを見ずに全方向を止めてはいけない。地面に触れた瞬間に「どの向きへも動かせない節点」に
  //   なるため、動的な物体の中に入り込んでもロープ側を押し出せず、押し出しの全額が相手の
  //   物体へ回る（板の下＝地面の上に貼りついたロープが、板を毎反復突き上げて飛ばしていた）。
  //   _cn は支えが押し返す向き。そこから離れる向き（内積>0）へは本来の質量で動ける。
  if (!vsRigid && n._onRigid && (nx * n._cnx + ny * n._cny) <= 0) return 0;
  const eps = 0.5;                           // [px] 「張り切った」とみなす許容差
  if (!j.bodyA || j.bodyA.isStatic) {        // 支点Aが剛（背景固定 or 静的物体）
    const dx = n.x - waW.x, dy = n.y - waW.y;
    const lA = restLen * (k + 1) - eps;      // 節点kが支点Aから離れられる上限
    // 二乗で比較（lA<0 のときは元の hypot>負 が常に真なのでそれを保つ）
    if ((lA < 0 || len2(dx, dy) > lA * lA) && (dx * nx + dy * ny) > 0) return 0;
  }
  if (!j.bodyB || j.bodyB.isStatic) {        // 支点Bが剛
    const dx = n.x - wbW.x, dy = n.y - wbW.y;
    const lB = restLen * (nCount - k) - eps; // 節点kが支点Bから離れられる上限
    if ((lB < 0 || len2(dx, dy) > lB * lB) && (dx * nx + dy * ny) > 0) return 0;
  }
  return n.invMass;                          // それ以外は本来の質量で押しのけられる
}
// 端リンク：本体アンカーからノードだけを動かす片側拘束（本体はJoint.solveが担当）
function ropeAnchorConstraint(node, body, wa, restLen) {
  const dx = node.x - wa.x, dy = node.y - wa.y;
  const dist = len(dx, dy);
  if (dist < 1e-9) return;
  const diff = (dist - restLen) / dist;
  node.x -= dx * diff; node.y -= dy * diff;
}
// 中間リンク：ノード間の距離を restLen に（対称）
function ropeLinkConstraint(a, b, restLen) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = len(dx, dy);
  if (dist < 1e-9) return;
  const diff = (dist - restLen) / dist * 0.5;
  a.x += dx * diff; a.y += dy * diff;
  b.x -= dx * diff; b.y -= dy * diff;
}
// 端を動かしている最中に、縄の形だけを追随させる（距離拘束だけ・接触も時間も進めない）。
//   ★編集ツールで端をドラッグしているときに使う。再生中はこの操作の途中でソルバが
//     回らないので、節点が1フレーム止まったままになる。すると端を横へ振っただけで
//     「端の隣のリンクだけが伸びた」形になり、縄の出し入れの判定が狂う（振るたびに
//     縄が出る）。updateRopeChains の位置投影のうち、距離拘束の部分だけを抜き出した。
//   ★節点の px/py はソルバが積分のたびに置き直すので、ここで動かした分が速度に化ける
//     ことはない（＝勝手に加速しない）。
function settleRopeChainShape(j, iters) {
  const nodes = j.nodes;
  if (!nodes || !nodes.length) return;
  const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB(), rl = j._restLen;
  if (!(rl > 0)) return;
  for (let it = 0; it < iters; it++) {
    ropeAnchorConstraint(nodes[0], j.bodyA, wa, rl);
    for (let k = 0; k < nodes.length - 1; k++) ropeLinkConstraint(nodes[k], nodes[k + 1], rl);
    ropeAnchorConstraint(nodes[nodes.length - 1], j.bodyB, wb, rl);
  }
}
// ロープの近傍に動いている物体がいるか（凍結解除の判定）
function _ropeDisturbed(j, waW, wbW) {
  let minX = Math.min(waW.x, wbW.x), maxX = Math.max(waW.x, wbW.x);
  let minY = Math.min(waW.y, wbW.y), maxY = Math.max(waW.y, wbW.y);
  for (const n of j.nodes) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
  }
  const pad = 6;
  const jLay = j.layers;         // ★
  for (const b of objects) {
    if (b === j.bodyA || b === j.bodyB) continue;
    if (b.isStatic || b.sleeping || (jLay & b.layers) === 0) continue;   // ★
    const a = b._aabb;
    if (a.maxX < minX - pad || a.minX > maxX + pad || a.maxY < minY - pad || a.minY > maxY + pad) continue;
    // ★運搬中の物体が近くにいる間は凍らせない。held の物体は integrate を飛ばすので
    //   速度が 0 のまま＝下の速度判定に引っかからず、縄が凍ったまま物体を運び込める。
    //   そこで離すと、凍った古い形のまま物体が中に取り残される（復帰は _reprobe 頼みで
    //   最大 0.5 秒かかる）。運搬中の物体とは当たらない（ROPE_HELD_NOTE）が、
    //   離した瞬間から当たるので、起きていてもらう必要がある。
    if (b.held) return true;
    if ((b.vx*b.vx + b.vy*b.vy) > 36 || Math.abs(b.av) > 1.2) return true;   // (6 px/s)², 1.2 rad/s
  }
  return false;
}
// 静止時：自由ノードを、両隣の支点（アンカー/接触ノード）を結ぶ直線上へ整列
function straightenRopeNodes(j, waW, wbW) {
  const nodes = j.nodes; if (!nodes || !nodes.length) return;
  const supports = [-1];
  for (let i = 0; i < nodes.length; i++) if (nodes[i]._touchT > 0) supports.push(i);
  supports.push(nodes.length);
  const posOf = idx => idx < 0 ? waW : idx >= nodes.length ? wbW : nodes[idx];
  for (let s = 0; s < supports.length - 1; s++) {
    const aI = supports[s], bI = supports[s+1], span = bI - aI;
    const A = posOf(aI), B = posOf(bI);
    const _need = span * j._restLen;
    if (len(B.x - A.x, B.y - A.y) < _need - 0.5) continue;
    for (let k = aI + 1; k < bI; k++) {
      const t = (k - aI) / span;
      nodes[k].x = A.x + (B.x - A.x) * t;
      nodes[k].y = A.y + (B.y - A.y) * t;
    }
  }
}
// 端をドラッグ中に「これから繋ぐ相手」をすり抜けるセグメント数（端から数えて）。
//   節点間隔はふつう16pxなので、端から30px強だけが相手を通り抜けられる。
//   端を物体の輪郭へ寄せるには足り、縄の胴が滑車を貫通するには足りない量。
const PLACE_PASS_SEGS = 2;
function updateRopeChains(dt, persistVel) {
  // ★端をドラッグ中のロープは、その端が重なっている物体（＝これから繋ぐ相手）と当たらない。
  //   棒（solveRopeBodyCollisions）が前からやっていたことを、ロープのチェーンにも入れる。
  //   ロープの端は点なので棒ほど派手に押しのけはしないが、縄そのものには太さ（j.radius）が
  //   あるため、端を物体の輪郭へ寄せていく最後の数pxで縄が相手を小突いてカーソルから
  //   逃がしてしまう。判定の甘さ（ROD_RADIUS+1）も棒と共通。
  //   ただし棒と違い、すり抜けるのは掴んでいる端の近くだけ（下の passThru）。
  const drag = draggedJointEndTargets();
  for (const j of joints) {
    if (j.type !== 'rope') continue;
    const placing = (drag && drag.joint === j) ? drag.bodies : null;
    const placingEnd = drag ? drag.end : null;
    ensureRopeNodes(j);
    {
      let bad = false;
      for (const n of j.nodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y) ||
            !Number.isFinite(n.vx) || !Number.isFinite(n.vy) || !Number.isFinite(n.invMass)) { bad = true; break; }
      }
      if (bad) { resetRopeChain(j); ensureRopeNodes(j); }
    }
    const nodes = j.nodes, restLen = j._restLen, R = j.radius, N = nodes.length;
    if (!N) continue;
    const jLay = j.layers;                   // ★ジョイント自身のレイヤー
    const waW = j.getWorldAnchorA(), wbW = j.getWorldAnchorB();
    const twoWay = persistVel;                       // 一時停止中は物体を押さない
    // ★張力の目安：端点間距離が最大長にどれだけ迫っているか。たるむほど 0 に近づく。
    //   たるんだロープ（張力ゼロ）は物体を支えないので、後段の頭打ちを緩める。
    const ropeTaut = Math.max(0, Math.min(1, (len(wbW.x - waW.x, wbW.y - waW.y) - (j.maxLength - 30)) / 30));
    // ═══ 凍結判定（従来どおり。ただし物体が載っている間は凍結しない）═══
    const aMv = j._pwa ? Math.hypot(waW.x - j._pwa.x, waW.y - j._pwa.y) : 1e9;
    const bMv = j._pwb ? Math.hypot(wbW.x - j._pwb.x, wbW.y - j._pwb.y) : 1e9;
    j._pwa = { x: waW.x, y: waW.y };
    j._pwb = { x: wbW.x, y: wbW.y };
    if (persistVel && aMv < 0.02 && bMv < 0.02 && (j._nodeDelta ?? 1e9) < 0.08) j._calmT = (j._calmT || 0) + 1;
    else j._calmT = 0;
    if (persistVel && aMv < 0.12 && bMv < 0.12) j._anchorCalmT = (j._anchorCalmT || 0) + 1;
    else j._anchorCalmT = 0;
    // ★ !j._loaded を追加：物体が載っているロープを凍結すると支えが消えて落ちてしまう
    // ★ !j._embedded を追加：物体の中に入り込んだ節点があるうちは凍結しない。
    //   凍結すると②（接触時間の減衰）も③（接触検出）も④（押し出し）も丸ごと飛ばすので、
    //   中に入った節点はそこに貼りついたまま二度と出られず、しかも _touchT が減らないので
    //   「物体の中の1点」がロープの支点として生き続ける（＝持ち上げようとすると引っかかる）。
    //   凍結中は _embedded が更新されないため、いったん立つと外へ出るまで凍結は起きない。
    // ★_reprobe：0.5秒に1回は凍結を解いて必ず解き直す。凍結中は接触検出そのものを飛ばすので、
    //   「凍った後に状況が変わった」場合（静的物体を編集ツールでロープの中へ動かした等。
    //   _ropeDisturbed は静的物体を見ないので気づけない）にロープが中に取り残される。
    //   30tickに1回だけ通常どおり解けば、取りこぼしても 0.5 秒で復帰し、
    //   省ける計算は 29/30 残る。
    const _grabbedEnd = (j.bodyA && j.bodyA._grabbed) || (j.bodyB && j.bodyB._grabbed);
    const _reprobe = (j._calmT % 30) === 0;
    if (persistVel && j._calmT > 15 && !_reprobe && !j._loaded && !j._embedded && !_grabbedEnd && !_ropeDisturbed(j, waW, wbW)) {
      straightenRopeNodes(j, waW, wbW);
      for (const nn of nodes) { nn.vx = 0; nn.vy = 0; }
      continue;
    }
    // ═══ ① ブロードフェーズ：サブステップに1回だけ ═══
    //   従来は 20反復 ×（節点数＋セグメント数）ごとに全物体を走査していた。
    //   ロープ1本・物体30個で 88,800 回/フレーム → 120 回/フレームになる。
    let mnX = Math.min(waW.x, wbW.x), mxX = Math.max(waW.x, wbW.x);
    let mnY = Math.min(waW.y, wbW.y), mxY = Math.max(waW.y, wbW.y);
    for (const n of nodes) {
      if (n.x < mnX) mnX = n.x;  if (n.x > mxX) mxX = n.x;
      if (n.y < mnY) mnY = n.y;  if (n.y > mxY) mxY = n.y;
    }
    const pad = R + restLen + 4;                     // 反復中に節点が動きうる上限（リンク1本分）
    mnX -= pad; mnY -= pad; mxX += pad; mxY += pad;
    const cands = [];
    if (jLay !== 0) for (const b of objects) {          // ★layers=0＝ゴースト：誰とも当たらない
      if (b === j.bodyA || b === j.bodyB) continue;     // ★ジョイントした物体とは接触しない
      if (b.held) continue;                             // ★編集ツールで運搬中：ROPE_HELD_NOTE 参照
      if ((jLay & b.layers) === 0) continue;
      const a = b._aabb;
      if (a.maxX < mnX || a.minX > mxX || a.maxY < mnY || a.minY > mxY) continue;
      cands.push(b);
    }
    // ═══ ② 節点の積分 ═══
    const gx = gravPxX() * ROPE_CFG.gravScale * dt;
    const gy = gravPxY() * ROPE_CFG.gravScale * dt;
    const settling = (j._anchorCalmT || 0) > 10 && (j._nodeDelta ?? 1e9) < 0.3;
    const damp = Math.exp(-(settling ? ROPE_CFG.dampSettle : ROPE_CFG.damp) * dt);
    for (const n of nodes) {
      n.vx = (n.vx + gx) * damp;
      n.vy = (n.vy + gy) * damp;
      n.px = n.x; n.py = n.y;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n._touchT = Math.max(0, n._touchT - 1);
      n._onRigid = false;
      n._embed = false;                              // 物体の中に入り込んでいるか（④で立てる）
    }
    // ═══ ③ 接触検出：ふだんはサブステップに1回 ═══
    //   ロープをカプセル列として扱い、接触面を「物体ローカル座標」で保存する。
    //   以降の反復はこの平面へ投影するだけなので、最近接エッジ探索を繰り返さずに済む。
    //   ★ただし④の反復中に節点が接触マージンを越えて動いたら、その場で検出し直す。
    //     たるみを吸収するときのリンク拘束は1反復で restLen 近く節点を運ぶので、
    //     検出を1回に決め打つと「検出時にはまだ触れていなかった面」へ節点が入り込み、
    //     そのまま物体の中へ潜る（地面が同じ症状にならないのは、地面だけ毎反復その場で
    //     押し出しているため）。
    const cts = j._cts;
    const poly = [waW, ...nodes, wbW];               // ★毎反復の配列生成もやめる（要素は参照）
    const RM = R + ROPE_CFG.margin;
    j._loaded = false;
    j._embedded = false;                             // ④で、中に入り込んだ節点が見つかったら立つ
    let detectCount = 0;
    const detectContacts = () => {
      detectCount++;
      cts.length = 0;
      for (const n of nodes) { n._dtx = n.x; n._dty = n.y; }    // 検出したときの位置
      for (let k = 0; k < poly.length - 1; k++) {
        const P0 = poly[k], P1 = poly[k+1];
        const i0 = k - 1, i1 = k;                    // nodes 上の添字（-1 と N は端＝アンカー）
        const sMinX = Math.min(P0.x, P1.x) - RM, sMaxX = Math.max(P0.x, P1.x) + RM;
        const sMinY = Math.min(P0.y, P1.y) - RM, sMaxY = Math.max(P0.y, P1.y) + RM;
        // ★これから繋ぐ相手をすり抜けるのは、掴んでいる端のすぐそばだけ。
        //   ここを「その物体とはロープ全体が当たらない」にすると、端をたまたま滑車の
        //   近くへ持っていっただけで縄が丸ごと滑車を貫通する（棒は線分1本なので全体で
        //   よかったが、ロープは節点の列なので端と胴を分けないといけない）。
        const passThru = placing &&
          (placingEnd === 'A' ? k < PLACE_PASS_SEGS : k > (poly.length - 2) - PLACE_PASS_SEGS);
        for (const b of cands) {
          if (passThru && placing.indexOf(b) >= 0) continue;
          const a = b._aabb;
          if (a.maxX < sMinX || a.minX > sMaxX || a.maxY < sMinY || a.minY > sMaxY) continue;
          const s = ropeSegLocal(b, P0, P1, R);
          if (!s) continue;
          cts.push({ b, i0, i1, s: s.s, lx: s.lx, ly: s.ly, ldx: s.ldx, ldy: s.ldy, circle: s.circle });
          if (i0 >= 0) { nodes[i0]._touchT = 8; if (b.isStatic) nodes[i0]._onRigid = true; }
          if (i1 < N)  { nodes[i1]._touchT = 8; if (b.isStatic) nodes[i1]._onRigid = true; }
          if (!b.isStatic) { j._loaded = true; b.sleeping = false; b.sleepTimer = 0; }
        }
      }
    };
    // 検出時からいちばん大きく動いた節点の移動量²
    const maxNodeShift2 = () => {
      let m = 0;
      for (const n of nodes) { const d = len2(n.x - n._dtx, n.y - n._dty); if (d > m) m = d; }
      return m;
    };
    const MAX_DETECT = 4;                            // 1呼び出しあたりの検出回数の上限（重さの歯止め）
    detectContacts();
    // ═══ ④ 位置投影（リンク拘束 ＋ 接触。接触は物体も動かす＝二方向連成）═══
    const vcts = [];
    for (let it = 0; it < ROPE_CFG.iters; it++) {
      const last = (it === ROPE_CFG.iters - 1);
      // -- 距離拘束（従来と同じ）--
      ropeAnchorConstraint(nodes[0], j.bodyA, waW, restLen);
      for (let k = 0; k < N - 1; k++) ropeLinkConstraint(nodes[k], nodes[k+1], restLen);
      ropeAnchorConstraint(nodes[N-1], j.bodyB, wbW, restLen);
      // -- 予算クランプ（従来と同じ。伸びの上限）--
      for (let k = 0; k < N; k++) {
        const n = nodes[k];
        // 二乗で判定し、実際に超過した節点だけ sqrt を取る（大半は超過しない）
        let dx = n.x - waW.x, dy = n.y - waW.y, d2 = dx*dx + dy*dy, bud = restLen * (k + 1);
        if (d2 > bud*bud && d2 > 1e-18) { const s = bud / Math.sqrt(d2); n.x = waW.x + dx*s; n.y = waW.y + dy*s; }
        dx = n.x - wbW.x; dy = n.y - wbW.y; d2 = dx*dx + dy*dy; bud = restLen * (N - k);
        if (d2 > bud*bud && d2 > 1e-18) { const s = bud / Math.sqrt(d2); n.x = wbW.x + dx*s; n.y = wbW.y + dy*s; }
      }
      // -- 地面（剛：節点のみ押し出す）--
      //   ★端を地面に取り付けたロープでも、地面との当たり判定は残す。
      //     物体側の「繋いだ相手とは当たらない」規則（cands で bodyA/bodyB を外す）を
      //     地面へ広げないのは、地面に付けた端が必ず地面の「表面」だから（setJointEnd が
      //     ローカルの高さを 0 に吸着させる）。物体は内部にアンカーを取れるので、当たると
      //     アンカーへ届く前に押し戻されて拘束と喧嘩するが、地面の表面に打った杭では
      //     その衝突が起きない。外すと、たるませた縄が地面の下へ沈んでしまう。
      if (world.terrain && (jLay & ground.layers)) {
        const gnx = Math.sin(ground.angle), gny = -Math.cos(ground.angle);
        for (const n of nodes) {
          const d = signedDistToGround(n.x, n.y) - R;
          if (d < 0) {
            n.x -= gnx * d; n.y -= gny * d;
            n._touchT = 8; n._cnx = gnx; n._cny = gny; n._onRigid = true;
          }
        }
      }
      // -- 節点が大きく動いていたら接触を検出し直す（上の③の★を参照）--
      if (detectCount < MAX_DETECT && maxNodeShift2() > RM * RM) detectContacts();
      // -- 物体との接触：キャッシュした平面へ投影するだけ --
      for (const ct of cts) {
        const b = ct.b;
        const P0 = ct.i0 < 0  ? waW : nodes[ct.i0];
        const P1 = ct.i1 >= N ? wbW : nodes[ct.i1];
        const s = ct.s;
        if (ct.i0 < 0  && s <= 0.02) continue;
        if (ct.i1 >= N && s >= 0.98) continue;
        const Qx = P0.x + (P1.x - P0.x) * s;         // セグメント上の接触点
        const Qy = P0.y + (P1.y - P0.y) * s;
        let nx, ny, cx, cy, depth;
        if (ct.circle) {                             // 円は毎回再計算（3行なので安い）
          const dx = Qx - b.x, dy = Qy - b.y, dd = len(dx, dy) || 1e-6;
          nx = dx / dd; ny = dy / dd;
          depth = (b.radius + R) - dd;
          cx = b.x + nx * b.radius;
          cy = b.y + ny * b.radius;
        } else {
          const c=Math.cos(b.angle),sn=Math.sin(b.angle);
          cx=b.x+ct.lx*c-ct.ly*sn; cy=b.y+ct.lx*sn+ct.ly*c;
          // 法線はセグメント垂線ではなく、ropeSegLocalの真の分離方向(ldx/ldy)をワールドへ回して使う
          nx=ct.ldx*c-ct.ldy*sn; ny=ct.ldx*sn+ct.ldy*c;
          const nl=len(nx,ny)||1; nx/=nl; ny/=nl;
          // ★ここで「重心から外向き」に揃え直してはいけない。凹形状（横倒しコップの
          //   内側の側面など）では材料の外向きが重心の側を向くので、揃え直すと法線が
          //   反転してロープを壁の中へ押し込み、そのまま貫通する。ldx/ldy は
          //   ropeSegLocal が内外判定つきで決めた正しい分離方向なので、回すだけでよい。
          depth=R-((Qx-cx)*nx+(Qy-cy)*ny);
        }
        if (depth <= 0) continue;
        // ★節点の中心が表面より内側＝物体の中に入り込んでいる印。
        //   （表面に載っているだけの節点は中心が R だけ外にあるので depth≒slop で、ここには入らない）
        //   この印は「凍結しない」「ロープの支点に使わない」の2か所で効く。中に入った節点を
        //   支点にすると、ロープが物体の中の1点に引っかかったまま張力を伝えてしまう。
        //   しきい値は「中心線が 1px 内側」。表面に載っている節点は中心線が R-slop≒2.7px
        //   外側にあるので 3.7px ぶんの余裕があり、載っているだけの節点が誤って印を
        //   もらって支点から外れる（＝張力が抜けて沈む）ことはない。
        const embedded = depth > R + 1;
        if (embedded) {
          j._embedded = true;
          if (ct.i0 >= 0) P0._embed = true;
          if (ct.i1 < N)  P1._embed = true;
        }
        const maxPen = R + ROPE_CFG.margin + restLen;   // 妥当なめり込みの上限（≒21px）
        if (depth > maxPen) depth = maxPen;

        // ★held も静的と同じく「動かせない側」。
        //   一時停止中（!twoWay）は、そもそもどの物体も接触では動かさないので、
        //   すべて「動かせない側」＝押し出しの全額をロープが負う。ここで質量比に
        //   応じて分けると、物体側の取り分が捨てられてロープが押し出され切らず、
        //   軽い物体ほどロープがめり込んだまま＝すり抜けたように見える。
        const vsRigid = _pinned(b) || !twoWay;
        const capInv = (vsRigid || ropeTaut <= 0) ? Infinity : b.invMass / ropeTaut;
        let w0 = ct.i0 < 0  ? 0 : Math.min(ropeNodeInvMass(j, ct.i0, P0, nx, ny, waW, wbW, restLen, N, vsRigid), capInv) * (1 - s);
        let w1 = ct.i1 >= N ? 0 : Math.min(ropeNodeInvMass(j, ct.i1, P1, nx, ny, waW, wbW, restLen, N, vsRigid), capInv) * s;
        // ★中に入り込んだ状態からの復帰は「ロープだけ」で行い、相手の物体は押さない（wb=0）。
        //   めり込みは最大 maxPen（≒21px）まで大きくなるので、質量比で分けて相手も押すと、
        //   その位置補正が 8反復×4サブステップぶん積み上がったうえ、PBD では位置の変化が
        //   そのまま速度に化けるため、軽い物体を打ち上げてしまう（板の中に入ったロープが
        //   板を毎秒80px で空へ飛ばしていた）。復帰はロープが全額を負うほうが速くもある。
        //   節点も動けない（地面などに押さえつけられている）ときは den=0 で下の行から抜け、
        //   下敷きのまま静かに保たれる＝ロープが板の下敷きになった状態として妥当。
        // ★張力の拘束（joint.js の rope 分岐）がこの物体を「支点」として既に引いているなら、
        //   節点の接触からは物体を押さない（位置も速度も）。縄が物体へ及ぼす力は張力ひとつで、
        //   それは拘束が ∂L/∂p の形で全額渡している。ここでも押すと同じ力を2回渡すことになる。
        //   実測（2026-09-30。滑車・動滑車デモ、引く力 4.2 N・300tick 平均）：節点の接触が
        //   動滑車を 0.283 N 押し上げ（縄の質量 ×0.001／×3 で 0.095／0.433 N＝節点の質量に比例）、
        //   理論では床から離れない荷が 87 mm 浮いて止まっていた。本物の縄の重さなら逆向き
        //   （持ち上げにくくなる）なので、物理ではなく二重計上。
        //   ★節点のほうは今までどおり物体の外へ押し出す（wb=0＝相手を動かせない側として扱う）。
        //   ★たるんでいる縄（拘束が力を出していない）では _wrapBodies が null なので、
        //     縄が物体に載る・ぶつかるときの押し合いは今までどおり接触が受け持つ。
        const viaTension = !!(j._wrapBodies && j._wrapBodies.has(b));
        const wb = (vsRigid || embedded || viaTension) ? 0 : b.invMass;
        let den = w0 * (1 - s) + w1 * s + wb;
        // ★「誰も動けない」ときに接触を捨ててはいけない。ropeNodeInvMass は
        //   「剛な支点から張り切った節点は、支点から遠ざかる向きへは動けない」として 0 を返すが、
        //   相手が静的（wb=0）だと den まで 0 になり、接触が丸ごと無かったことにされる。
        //   ピンと張った振り子のロープを静的なひっかかりへ当てる配置では、これが接触の
        //   4分の3で起きて、ロープがひっかかりを貫通して反対側へ抜けていた（実測）。
        //   ここは最後の砦として、節点そのものの質量で押し出す。伸びは同じ反復ループの
        //   予算クランプ（restLen×本数）が次の反復で取り戻すので、ロープが伸びたままにはならない。
        if (den <= 1e-12) {
          w0 = ct.i0 < 0  ? 0 : P0.invMass * (1 - s);
          w1 = ct.i1 >= N ? 0 : P1.invMass * s;
          den = w0 * (1 - s) + w1 * s;
          if (den <= 1e-12) continue;   // 両端ともアンカー＝本当に動かせない
        }
        // 射影係数が1を超えると貫入解消を通り越して押し出し、次の反復で逆側から
        // 押し戻される往復が正の仕事を注入する（過剰緩和）。端では節点が剛で補正が
        // 全額物体に載るためポンプが最強になり、「端を支点に縦まで持ち上がる」が起きる。
        // 剛性を上げたいときは beta ではなく iters を増やすこと。
        const corr = Math.max(depth - ROPE_CFG.slop, 0) / den * Math.min(ROPE_CFG.beta, 1);
        
        P0.x += nx * corr * w0;  P0.y += ny * corr * w0;
        P1.x += nx * corr * w1;  P1.y += ny * corr * w1;
        // ★_cb＝この節点が触れている物体。張力を「縄が曲がっているところ」で相手へ渡すのに要る
        //   （js/physics/joint.js の rope 分岐）。法線 _cn と同じ場所で同じ寿命なので、
        //   _touchT が生きている間だけ有効。
        if (ct.i0 >= 0) { P0._cnx = nx; P0._cny = ny; P0._cb = b; }
        if (ct.i1 < N)  { P1._cnx = nx; P1._cny = ny; P1._cb = b; }
        if (twoWay && !vsRigid && !viaTension) {
          // ★1反復で物体を動かす量に上限を置く。ロープが物体の中に入り込むと depth は
          //   maxPen（≒21px）まで大きくなり、節点側が動けない状況では corr の全額が
          //   物体の位置に載る。それが 8反復×4サブステップぶん積み上がって物体を吹き飛ばす。
          //   ふつうに載っているだけの接触は depth≒slop なので、ここは 0.1px も動かない。
          const MAX_BODY_STEP = 1;                  // [px]
          const bs = Math.min(corr * wb, MAX_BODY_STEP);
          b.x -= nx * bs;
          b.y -= ny * bs;
          b._updateAABB();
        }
        // 復帰中（embedded）は速度パスにも渡さない。押し出した勢いを物体へ返さないため。
        if (last && twoWay && !vsRigid && !embedded && !viaTension) vcts.push({ b, nx, ny, cx, cy, w0, w1, s, P0, P1 });
      }
    }
    const inv = dt > 1e-9 ? 1 / dt : 0;
    if (persistVel) {
      const NODE_VMAX = 1200, NODE_VMAX2 = 1200 * 1200;   // [px/s]
      for (const n of nodes) {
        // ★物体の中から押し出された節点は、その移動量を速度にしない。
        //   PBD は「位置の変化 ÷ dt」を速度とみなすので、めり込みからの復帰（最大21px）を
        //   そのまま速度にすると 1px でも 240px/s、上限の 1200px/s まで一気に乗る。
        //   それが次の速度パスで力積として物体に入り、板が跳ね飛ぶ。復帰は位置だけで行う。
        if (n._embed) { n.vx = 0; n.vy = 0; continue; }
        n.vx = (n.x - n.px) * inv;
        n.vy = (n.y - n.py) * inv;
        const sp2 = n.vx*n.vx + n.vy*n.vy;
        if (sp2 > NODE_VMAX2) { const k = NODE_VMAX / Math.sqrt(sp2); n.vx *= k; n.vy *= k; }
        if (n._touchT > 0) {
          // 面へ食い込む成分は接触が消す（これは摩擦ではないので係数に依らない）
          const vn = n.vx * n._cnx + n.vy * n._cny;
          if (vn < 0) { n.vx -= vn * n._cnx; n.vy -= vn * n._cny; }
          // ★接触面に沿った成分を落とすのは「摩擦」なので、クーロンの法則で上限を決める：
          //     |Δv接線| ≤ μ・|Δv法線|
          //   面が節点から奪った法線方向の速度 |vn| が、この刻みで働いた垂直抗力に相当する。
          //   静止して載っているだけの節点でも、毎刻み重力が |vn| = g·dt を作るので、
          //   接線の減速は μ·g·dt ＝ 教科書どおりの動摩擦になる。
          //   ★以前はここが「触れている節点は毎パス速度 0.96 倍・18px/s 未満は 0」という
          //     摩擦係数と無関係の一律の減衰だった。ロープが落ち着く役はこれが担っていたが、
          //     摩擦 0 の滑車の上を滑る縄にもブレーキとして効いてしまい、動滑車の上昇が
          //     理論の 1/4（0.42 対 1.56 m/s²）、縄の送り量が 1.69 対 2.00 になっていた。
          //     μ に比例させれば、摩擦のある面（既定 μ=0.3）での落ち着きは保ったまま、
          //     μ=0 の面では縄が自由に滑る。
          const cf = settling ? 0.85 : 0.96;
          n.vx *= cf; n.vy *= cf;
          if (n.vx * n.vx + n.vy * n.vy < 324) { n.vx = 0; n.vy = 0; }
        }
      }
    } else {
      for (const n of nodes) { n.vx = 0; n.vy = 0; }
    }

    for (let it = 0; it < ROPE_CFG.velIters && vcts.length; it++) {
      for (const c of vcts) {
        const b = c.b, nx = c.nx, ny = c.ny, s = c.s;
        const rx = c.cx - b.x, ry = c.cy - b.y;
        const bvx = b.vx - b.av * ry, bvy = b.vy + b.av * rx;
        // 端セグメントの P0/P1 はアンカー（{x,y}のみ）で vx を持たない。
        // undefined を掛けると NaN が rvn>=0 判定をすり抜け、節点汚染→毎tickチェーン
        // リセット、かつ端の接触力積だけが applyImpulse のガードで捨てられて回転していた。
        // アンカーは位置パスで w0=0（無限質量）として扱っているので、速度も 0 扱いで整合する。
        const p0vx = c.P0.vx ?? 0, p0vy = c.P0.vy ?? 0;
        const p1vx = c.P1.vx ?? 0, p1vy = c.P1.vy ?? 0;
        const ropeVx = p0vx * (1 - s) + p1vx * s;
        const ropeVy = p0vy * (1 - s) + p1vy * s;
        const rvx = ropeVx - bvx, rvy = ropeVy - bvy;
        const rvn = rvx * nx + rvy * ny;
        if (rvn >= 0) continue;
        const crB = rx * ny - ry * nx;
        const kb = b.invMass + crB * crB * b.invInertia;
        const den = c.w0 * (1 - s) + c.w1 * s + kb;
        if (den <= 1e-12) continue;
        const jn = -rvn / den;
        if (c.P0.vx !== undefined) { c.P0.vx += jn * nx * c.w0; c.P0.vy += jn * ny * c.w0; }
        if (c.P1.vx !== undefined) { c.P1.vx += jn * nx * c.w1; c.P1.vy += jn * ny * c.w1; }
        b.applyImpulse(-jn * nx, -jn * ny, c.cx, c.cy);
        if (b.showForces) b.recordForce('normal', -jn * nx, -jn * ny, c.cx, c.cy, 'rope' + j.id);
        b._contactThisTick = true;
        const tx = rvx - rvn * nx, ty = rvy - rvn * ny;
        const tl = len(tx, ty);
        if (tl > 0.06) {
          const tdx = tx / tl, tdy = ty / tl;
          const crT = rx * tdy - ry * tdx;
          const kt = b.invMass + crT * crT * b.invInertia + c.w0 * (1 - s) + c.w1 * s;
          let jt = -tl / kt;
          const mu = combineFriction(j.friction, b.friction);
          if (jt < -jn * mu) jt = -jn * mu;
          if (jt >  jn * mu) jt =  jn * mu;
          b.applyImpulse(-jt * tdx, -jt * tdy, c.cx, c.cy);
          if (b.showForces) b.recordForce('friction', -jt * tdx, -jt * tdy, c.cx, c.cy, 'rope' + j.id);
        }
      }
    }

    let md2 = 0;
    for (const n of nodes) { const d2 = len2(n.x - n.px, n.y - n.py); if (d2 > md2) md2 = d2; }
    j._nodeDelta = Math.sqrt(md2);
  }
}
const SANE_POS = 1e6;
const SANE_VEL = 1e5;
function bodyIsSane(b) {
  return Number.isFinite(b.x)  && Number.isFinite(b.y)  && Number.isFinite(b.angle) &&
         Number.isFinite(b.vx) && Number.isFinite(b.vy) && Number.isFinite(b.av) &&
         Math.abs(b.x) < SANE_POS && Math.abs(b.y) < SANE_POS;
}
function resetRopeChain(j) {
  j.nodes = null; j._wrapPts = null;
  j._calmT = 0; j._anchorCalmT = 0; j._pwa = j._pwb = null; j._nodeDelta = 1e9;
}
// ════════════════════════════════════════
//  ロープの先端おもり（掴んで引くための取っ手）
// ════════════════════════════════════════
//  ロープの端は「物体に付いている」か「背景に固定」かの2択で、背景に固定した端は動かせない。
//  つかむツールは物体しか掴めないので、端を手で引くにはそこに物体が要る
//  （滑車にかけたロープの端を引く、という使い方がいちばん多い）。
//  そこで、小さな円をその場に作って端をそこへ付け替える。
//
//  ★ロープの端を「どこにも繋がっていない自由端」にする方式は採らなかった。
//    ロープの端は節点ではなくアンカー（境界条件）なので、自由端にするには
//    チェーンソルバ・凍結の最適化・保存形式に手を入れる必要がある。
//    おもりを付ける方式なら、端が物体に付いている＝ソルバがもともと想定している形のまま、
//    つかむ・力の矢印・グラフ・レイヤーがそのまま使える。
//  ★回転しない（fixedRotation）。取っ手が勝手に回ると掴んだ手応えが分かりにくいため。
//  ★このおもりは「ロープの一部」の扱いで、ロープを消すと一緒に消える（removeJointAt）。
let ropeTipOnFree = false;   // ロープツール：背景に落とした端におもりを付けるか
let ropeTipMass   = 0.1;     // [kg] 付けるおもりの質量
const ROPE_TIP_MIN_R = 4;    // [px] これ未満は形状が退化して当たり判定が壊れる（1px = 1cm）
function ropeTipRadius(j) { return Math.max(ROPE_TIP_MIN_R, (j ? j.radius : 3) * 2.5); }
// その端が「背景に固定」か（＝おもりを付けられるか）。
//   地面に取り付けた端は対象外。そこは意図して打った杭なので、動かせるおもりに
//   置き換えると意味が逆になる。
function ropeEndIsFree(j, end) {
  if (!j || j.type !== 'rope') return false;
  return end === 'A' ? (!j.bodyA && !j.groundA) : (!j.bodyB && !j.groundB);
}
function addRopeTip(j, end) {
  if (!ropeEndIsFree(j, end)) return null;
  const w = (end === 'A') ? j.getWorldAnchorA() : j.getWorldAnchorB();
  const tip = new Body({
    type: 'circle', x: w.x, y: w.y, radius: ropeTipRadius(j),
    mass: Math.max(0.001, ropeTipMass),
    fixedRotation: true, ropeTip: true,
    restitution: 0.2, friction: 0.5,
    fillColor: '#ffd54f', strokeColor: '#ffffff', strokeWidth: 1.5,
    // ★他の新規物体と同じくレイヤー1のみ。ロープの layers を継承してはいけない：
    //   両端とも背景に置いたロープは defaultJointLayers が LAYER_ALL を返すので、
    //   おもりが1〜4すべてONで生まれ、レイヤーで分けた別の実験にまでぶつかる。
    layers: LAYER_DEFAULT,
  });
  objects.push(tip);
  // ★おもりへ付け替える＝地面への取り付けは解除（おもりは動くので両立しない）
  if (end === 'A') { j.bodyA = tip; j.groundA = false; j.anchorAx = 0; j.anchorAy = 0; }
  else             { j.bodyB = tip; j.groundB = false; j.anchorBx = 0; j.anchorBy = 0; }
  resetRopeChain(j);
  return tip;
}
// 先端おもりの物体そのものを世界から取り除く。★ロープとばね（スリンキー）で共通。
//   おもりは「索の一部」なので、外すときは索側の付け替えを済ませてからここを通す。
function dropTipBody(tip) {
  const k = objects.indexOf(tip);
  if (k >= 0) objects.splice(k, 1);
  selectedIds.delete(tip.id);
  lasers = lasers.filter(L => L.body !== tip);
  joints = joints.filter(o => o.bodyA !== tip && o.bodyB !== tip);
}
// その端に付いている先端おもり（無ければ null）。
function ropeEndTip(j, end) {
  if (!j || j.type !== 'rope') return null;
  const b = (end === 'A') ? j.bodyA : j.bodyB;
  return (b && b.ropeTip) ? b : null;
}
// 先端おもりを外して、その端を元どおり「背景に固定した端」へ戻す。
//   ★アンカーは bodyA/B が null のときワールド座標として読まれる（getWorldAnchorA）。
//     おもりがいた場所をそのまま入れるので、外した瞬間に端が飛ばない。
function removeRopeTip(j, end) {
  const tip = ropeEndTip(j, end);
  if (!tip) return false;
  const w = (end === 'A') ? j.getWorldAnchorA() : j.getWorldAnchorB();
  if (end === 'A') { j.bodyA = null; j.anchorAx = w.x; j.anchorAy = w.y; }
  else             { j.bodyB = null; j.anchorBx = w.x; j.anchorBy = w.y; }
  dropTipBody(tip);
  resetRopeChain(j);
  return true;
}
// ジョイントを1本消す。ロープなら、掴むために付けた先端おもりも一緒に消す。
// ★ジョイントを消す経路（プロパティの削除ボタン・右クリック・種別一括）は必ずここを通す。
//   直接 joints.splice すると、おもりだけが宙に取り残される。
function removeJointAt(i) {
  const j = joints[i];
  if (!j) return;
  joints.splice(i, 1);
  if (j.bodyA) { j.bodyA.sleeping = false; j.bodyA.sleepTimer = 0; }   // 支えを失う物体を起こす
  if (j.bodyB) { j.bodyB.sleeping = false; j.bodyB.sleepTimer = 0; }
  for (const b of [j.bodyA, j.bodyB]) {
    if (b && b.ropeTip) dropTipBody(b);
  }
}
function removeJoint(j) { const i = joints.indexOf(j); if (i >= 0) removeJointAt(i); }
