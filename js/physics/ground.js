const ground = {
  y: 0,               // ★地面＝原点。グリッド線は world 0 起点の k*step なので、
                      //   y=0 は間隔をどう変えても細線・太線の両方に必ず乗る
  angle: 0,
  restitution: 1.0,   // ★合成は積（combineRestitution）なので既定を1.0に（0.0のままだと全部跳ねなくなる。§4参照）
  friction: 0.5,      // ★追加（地面のグリップ。滑りすぎるなら上げる）
  frictionStatic: 0.6,
  layers: LAYER_ALL,  // ★地面は既定で全レイヤーに存在する（外すとそのレイヤーの物体は落ち続ける）
  waveMode: 'fixed',  // ★波動場での扱い（既定は剛体壁＝固定端反射）
  fillColor: '#4a5568',
  strokeColor: '#718096',
};
function groundYAt(wx) {
  return ground.y + Math.tan(ground.angle) * wx;
}
function setGroundAngle(deg) {
  ground.angle = yUI(deg) * Math.PI / 180;   // 表示は反時計回り正（角度欄と同じ）
  document.getElementById('w-ground-angle-val').textContent = deg + '°';
  wakeAll();                 // ★傾き変更で眠っている物体も起こす（起こさないと地面判定が走らずめり込む）
  resolveGroundEmbedding();  // ★めり込んだ物体を即座に地面上へ押し出す
  settleGroundAttachedJoints();
}
// 地面を動かしたあとの後始末。地面に取り付けたジョイントの端は地面と一緒に動くので、
// 繋がっている物体もその新しい位置へ引き直す必要がある。再生中は次のティックが解いて
// くれるが、一時停止中は誰も解かないので、傾けた瞬間に棒やロープだけが伸び縮みした絵で
// 取り残される。地面に取り付けた端が1つも無い場面では何もしない（従来どおりの挙動）。
function settleGroundAttachedJoints() {
  let any = false;
  for (const j of joints) {
    if (!j.groundA && !j.groundB) continue;
    any = true;
    if (j.type === 'rope') { j._calmT = 0; j._anchorCalmT = 0; j._pwa = j._pwb = null; }
  }
  if (any && !running) applyPausedConstraints(false);
}
// 地面の傾きを「重力に垂直」＝見かけの水平に合わせる。
//   地面の法線は resolveGroundEmbedding と同じ (sin a, −cos a)。これを重力の逆向き
//   (−ux, −uy) に一致させると sin a = −ux, cos a = uy なので a = atan2(−ux, uy)。
//   重力が既定（真下）なら a = 0 ＝ 水平のままになる。
//   ★傾きスライダーの範囲（±45°）は超えうる（|重力X| > |重力Y| のとき）。
//     物理的に正しい角度を優先し、丸めない。スライダーは端で止まるが、
//     すぐ上の数値表示は実際の角度を出す。
function alignGroundToGravity() {
  const g = Math.hypot(world.gravX, world.gravY);
  if (g < 1e-9) return;                       // 無重力では「見かけの水平」が定義できない
  pushUndo();
  const a = Math.atan2(-world.gravX / g, world.gravY / g);
  setGroundAngle(yUI(a) * 180 / Math.PI);     // 表示規約（反時計回り正）へ直して渡す
  syncWorldPanel();
}
function setGroundY(v) {
  ground.y = toPx(yUI(parseFloat(v) || 0));
  wakeAll();
  resolveGroundEmbedding();
  settleGroundAttachedJoints();
}
function resolveGroundEmbedding() {
  if (!world.terrain || ground.layers === 0) return;
  const nx = Math.sin(ground.angle), ny = -Math.cos(ground.angle);
  for (const b of objects) {
    if (b.isStatic) continue;
    if ((b.layers & ground.layers) === 0) continue;   // ★地面とレイヤーを共有しない物体は素通り
    let minDist = Infinity;
    if (b.type === 'circle') {
      minDist = signedDistToGround(b.x, b.y) - b.radius;
    } else {
      for (const v of b._worldVerts()) {
        const d = signedDistToGround(v.x, v.y);
        if (d < minDist) minDist = d;
      }
    }
    if (minDist < 0) {
      b.x += nx * (-minDist);
      b.y += ny * (-minDist);
      b._updateAABB();
      const vn = b.vx * nx + b.vy * ny;      // 地面へ向かう速度成分を除去（押し出し後の再貫入を防ぐ）
      if (vn < 0) { b.vx -= vn * nx; b.vy -= vn * ny; }
      b.sleeping = false; b.sleepTimer = 0;
    }
  }
}
function signedDistToGround(px, py) {
  return Math.sin(ground.angle) * px + Math.cos(ground.angle) * (ground.y - py);
}
// ════════════════════════════════════════
//  地面のローカル座標（ジョイントの端を地面に取り付けるための座標系）
//   地面は「点(0, ground.y) を通り、傾き ground.angle の直線」。回転の中心が x=0 に
//   あることは groundYAt() の定義（ground.y + tan(angle)·x）がそのまま示している。
//   ローカル座標は (地面に沿った距離 t, 地面からの高さ n)：
//     t 方向 = ( cos a, sin a)
//     n 方向 = ( sin a,-cos a) ＝ signedDistToGround が測る向き（正が地面の上）
//   ★ジョイントの端を地面に取り付けると、アンカーをこの座標で持つ。地面を傾けても
//     上下させても取り付け点が地面と一緒に動く＝杭を地面に打ったのと同じ挙動になる。
//     背景（ワールド座標）に打つ従来の杭は「空間に固定した点」で、地面とは無関係。
// ════════════════════════════════════════
function groundLocalFromWorld(wx, wy) {
  const c = Math.cos(ground.angle), s = Math.sin(ground.angle);
  const dx = wx, dy = wy - ground.y;
  return { x: dx * c + dy * s, y: dx * s - dy * c };
}
function groundWorldFromLocal(lx, ly) {
  const c = Math.cos(ground.angle), s = Math.sin(ground.angle);
  return { x: lx * c + ly * s, y: ground.y + lx * s - ly * c };
}
// (wx,wy) を地面の表面へ落とした点（法線方向に符号付き距離だけ戻す）
function groundSurfacePoint(wx, wy) {
  const d = signedDistToGround(wx, wy);
  return { x: wx - Math.sin(ground.angle) * d, y: wy + Math.cos(ground.angle) * d };
}
// その点でジョイントの端を地面に取り付けてよいか。
//   表面のすぐそば「か、その下」。地面より下には何も無いので、うっかり地中へ落とした端も
//   地面に取り付けたものとして扱い、下の setJointEnd が表面へ吸着させる。
//   ★これをしないと、地中に埋まったアンカーへ向かってロープが地面からまっすぐ下に
//     伸びる（＝地面に置いたはずの端が地中にある）状態になる。
const GROUND_ATTACH_TOL_PX = 4;   // [画面px] 表面より上でも、この範囲なら取り付け
function pointOnGround(wx, wy) {
  return !!world.terrain && signedDistToGround(wx, wy) <= GROUND_ATTACH_TOL_PX / cam.zoom;
}
function detectGroundCollision(b) {   // ★戻り値を配列に変更
  if ((b.layers & ground.layers) === 0) return null;   // ★レイヤーを共有しなければ地面を貫通する
  const sinA = Math.sin(ground.angle), cosA = Math.cos(ground.angle);
  const nx = sinA, ny = -cosA;
  if (b.type === 'circle') {
    const minDist = signedDistToGround(b.x, b.y) - b.radius;
    if (minDist >= 0) return null;
    return [{ b, nx, ny, contactX: b.x - nx*b.radius, contactY: b.y - ny*b.radius,
              sep: minDist, key: 0, region: 0, cid: 'g' + b.id + '|0' }];
  }
  const clusters = groundContactClusters(b);
  if (!clusters) return null;
  return clusters.map((c, i) => ({ b, nx, ny, contactX: c.x, contactY: c.y, sep: c.d,
                                   key: i, region: c.region, cid: 'g' + b.id + '|' + i }));
}
// 多角形の「地面に接している（＝これから接する）ところ」を集めて、地面に沿って離れて
// いるかたまりごとに1つの接触点にまとめて返す。
//   戻り値には、その接触点の位置・地面までの符号付き距離（負＝めり込み）に加えて
//   region＝「物体のどの面が触れているか」の番号が入る。輪郭の上でつながっている
//   頂点は同じ面なので同じ region になり、凹型を伏せて置いたときの左右の脚のように
//   切り欠きで分断されていれば別の region になる。
//   ★接触点は面1つにつき2つ（面の両端）できる。ソルバはその2点を別々に解く必要が
//     あるが、垂直抗力の矢印は面ごとに1本にまとめたい（＝物体どうしの接触で
//     パーツ対ごとに1本にしているのと同じ粒度）。そのための区別が region。
function groundContactClusters(b, requireTouching = true) {
  const verts = b._worldVerts();
  const n = verts.length;
  if (!n) return null;
  let minDist = Infinity;
  for (const v of verts) { const d = signedDistToGround(v.x, v.y); if (d < minDist) minDist = d; }
  if (requireTouching && minDist >= 0) return null;
  // band ＝ 最下点からこの距離までの頂点も「接地点の候補」に入れる許容幅。
  //   ★候補に入れるだけで、接している扱いにはしない。頂点ごとの地面までの距離 d を
  //     そのまま接触点へ持たせ、d > 0（まだ浮いている）点はソルバが投機的接触として
  //     扱う。こうしないと、band ぶん浮いた角が空中で物体を支えてしまい、
  //     長方形は atan(band/幅) ≒ 1° 傾いたまま静止する。
  const band = 2.0, tx = Math.cos(ground.angle), ty = Math.sin(ground.angle);   // 接線方向
  const pts = [], onGround = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const v = verts[i], d = signedDistToGround(v.x, v.y);
    if (d <= minDist + band) { pts.push({ x: v.x, y: v.y, d, i, t: v.x*tx + v.y*ty }); onGround[i] = true; }
  }
  if (!pts.length) return null;
  // 輪郭の上で隣り合う候補どうしを同じ面（region）にまとめる。輪郭は閉じているので
  // 最後と最初がどちらも候補なら、それも1つの面。
  const reg = new Array(n).fill(-1);
  let r = -1;
  for (let i = 0; i < n; i++) {
    if (!onGround[i]) continue;
    if (i === 0 || !onGround[i-1]) r++;
    reg[i] = r;
  }
  if (r > 0 && onGround[0] && onGround[n-1] && reg[n-1] !== reg[0]) {
    const last = reg[n-1];
    for (let i = 0; i < n; i++) if (reg[i] === last) reg[i] = reg[0];
  }
  pts.sort((a, b2) => a.t - b2.t);
  const gapTh = 12;                                  // これ以上離れたら別の接地点
  const out = [];
  let cluster = [pts[0]];
  // ★かたまりの距離 d は平均ではなく最も深い点の値、位置はそこから 0.5px 以内の頂点の平均
  //   （correctGroundPosition の当てる点と同じ決め方）。2026-09-28。
  //   平均だと、めり込んだ角と浮いた曲面の頂点が1つのかたまりに入ったとき「まだ浮いている」
  //   ことになり、ソルバが沈むのを許してしまう。実例：よろよろ走りの胴（四角＋頭の図形和）を
  //   寝かせると、肩の角 −0.52px と頭の円周 +0.4〜1.4px が平均されて +0.68px。頭の側が毎回
  //   沈み、押し戻し（向きも直す）が回して戻す——を繰り返して、倒れた体が 0.13 m/s で
  //   床を転がり続けた（角速度 1.0 rad/s のまま角度は一定）。直したあとは静止率 300/300。
  //   平らな面に頂点が並んだだけのかたまりは全部が同じ深さなので、これまでと同じになる。
  const flush = () => {
    let dmin = Infinity;
    for (const p of cluster) if (p.d < dmin) dmin = p.d;
    let sx = 0, sy = 0, m = 0;
    for (const p of cluster) if (p.d <= dmin + 0.5) { sx += p.x; sy += p.y; m++; }
    out.push({ x: sx/m, y: sy/m, d: dmin, t: (sx/m)*tx + (sy/m)*ty, region: reg[cluster[0].i] });
  };
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - cluster[cluster.length-1].t > gapTh) { flush(); cluster = [pts[i]]; }
    else cluster.push(pts[i]);
  }
  flush();
  return out;
}
// 接触点を「触れている面」ごとにまとめ直す。垂直抗力の矢印は面につき1本にしたいので、
// 面の両端にできる2つの接触点を、その中点（＝面の中央）1つに畳む。
function groundSupportRegions(b, requireTouching = true) {
  const cl = groundContactClusters(b, requireTouching);
  if (!cl) return null;
  const map = new Map();
  for (const c of cl) {
    const g = map.get(c.region);
    if (g) { g.x += c.x; g.y += c.y; g.t += c.t; g.n++; }
    else map.set(c.region, { region: c.region, x: c.x, y: c.y, t: c.t, n: 1 });
  }
  const out = [...map.values()];
  for (const g of out) { g.x /= g.n; g.y /= g.n; g.t /= g.n; }
  out.sort((a, b2) => a.t - b2.t);
  return out;
}
// 支点それぞれが受け持つ荷重 W の分け前を返す（釣り合いの問題そのもの）。
//   Σ N_i = W（力の釣り合い）と Σ N_i·t_i = W·t_c（重心まわりのモーメントの釣り合い）を
//   満たす分布を求める。支点が2つならこれで一意に決まり、答えはてこの関係
//   N₁:N₂ =（重心から見た反対側の支点までの距離の比）になる。
//   3つ以上は剛体では不定なので、接地圧が地面に沿って直線的に変わる（弾性床）
//   ことにして最小二乗の意味で一意にする。負になった支点は「浮いている」ので
//   外してやり直す（地面は引っ張れない）。
//   t_i, t_c は地面に沿った座標。
function shareLoadOnSupports(ts, tc, W) {
  let idx = ts.map((_, i) => i);
  for (let guard = 0; guard < ts.length; guard++) {
    const n = idx.length;
    if (n === 0) return null;
    const share = new Array(ts.length).fill(0);
    if (n === 1) { share[idx[0]] = W; return share; }
    let tbar = 0;
    for (const i of idx) tbar += ts[i];
    tbar /= n;
    let s2 = 0;
    for (const i of idx) s2 += (ts[i] - tbar) * (ts[i] - tbar);
    let neg = -1;
    for (const i of idx) {
      const f = s2 > 1e-9 ? 1/n + (tc - tbar) * (ts[i] - tbar) / s2 : 1/n;
      share[i] = W * f;
      if (share[i] < 0 && (neg < 0 || share[i] < share[neg])) neg = i;
    }
    if (neg < 0) return share;
    idx = idx.filter(i => i !== neg);        // 浮いた支点を外してやり直す
  }
  return null;
}
// ─── 地面の速度ソルブ ─────────────────────────────────────────
//   物体どうしの接触（collision.js）とまったく同じ3段階。地面は動かないので
//   相手側の逆質量が 0 になっただけ。解説は geometry.js「接触ソルバの共通部」。
function _groundVelOn(gc, dx, dy) {
  const b = gc.b;
  return (b.vx - b.av * gc._ry) * dx + (b.vy + b.av * gc._rx) * dy;
}
function _groundApplyN(gc, dJ) {
  if (!dJ) return;
  const { b, nx, ny, contactX, contactY } = gc;
  b.applyImpulse(dJ * nx, dJ * ny, contactX, contactY);
  // ★キーは接地点ごとに分ける。凹型を伏せて置いたときのように地面と2か所で
  //   接する物体は、支点ごとに垂直抗力が立つ（それぞれの大きさはてこの関係で
  //   決まり、和が重さになる）。共通キー 'ground' にまとめると力積が合算され、
  //   作用点も重み平均で脚の中間＝物体が触れていない場所に1本だけ出てしまう。
  //   ★key ではなく region で分ける。平らな面で寝ている物体は接触点が面の両端に
  //     2つできるが、それは1つの面なので矢印は面の中央に1本（同じキーに足し込むと
  //     recordForce の重み平均がちょうど面の中央を指す）。
  if (gc._rec) b.recordForce('normal', dJ * nx, dJ * ny, contactX, contactY, 'ground' + gc.region);
}
function _groundApplyT(gc, dJ) {
  if (!dJ) return;
  const { b, contactX, contactY } = gc;
  const tx = gc._tdx, ty = gc._tdy;
  b.applyImpulse(dJ * tx, dJ * ty, contactX, contactY);
  if (gc._rec) b.recordForce('friction', dJ * tx, dJ * ty, contactX, contactY, 'ground' + gc.region);
}
function prepareGroundContact(gc, dt) {
  const { b, nx, ny, contactX, contactY } = gc;
  gc._skip = true;
  if (b.sleeping || b.isStatic || b.held || b.invMass === 0) return;
  const rx = contactX - b.x, ry = contactY - b.y;
  const kn = b.invMass + (rx*ny - ry*nx) * (rx*ny - ry*nx) * b.invInertia;
  if (!(kn > 0)) return;
  const tdx = -ny, tdy = nx;                        // 接線（2次元では法線から一意）
  gc._rx = rx; gc._ry = ry; gc._kn = kn;
  gc._tdx = tdx; gc._tdy = tdy;
  gc._kt = b.invMass + (rx*tdy - ry*tdx) * (rx*tdy - ry*tdx) * b.invInertia;
  const vn0 = (b.vx - b.av * ry) * nx + (b.vy + b.av * rx) * ny;
  gc._vn0  = vn0;
  gc._vnPre = contactPreVel(null, b, 0, 0, rx, ry, nx, ny, dt);   // ★熱（impactHeatOf の★）
  gc._vt0  = (b.vx - b.av * ry) * tdx + (b.vy + b.av * rx) * tdy;   // ★摩擦熱用のすべり速度
  gc._dt = dt; gc._drift = 0;                       // ★接線ずれの補正用（collision.js の★）
  // ★位置を実際に進めた速度の接線成分（重力の半分だけ手前。collision.js の _vtPos の★）
  gc._vtPos = gc._vt0 - ((b._gHx || 0) * tdx + (b._gHy || 0) * tdy);
  gc._bias = specBias(gc.sep, dt);                  // まだ浮いている角は支えない
  // ★sep ≤ 0＝実際に地面に達している角だけが跳ね返る
  // ★下限は反発係数に応じて薄める（物体どうしと同じ扱い。units.js の★に理由と実測）
  const eBG = combineRestitution(b.restitution, ground.restitution);
  gc._e = (gc.sep <= 0 && vn0 < -restitutionVelTh(eBG)) ? eBG : 0.0;
  gc._rec = b.showForces;
  // ★非弾性衝突の熱の門番（物体どうしと同じ。量はソルバのあとで出す。thermal.js の★）
  gc._hit = vn0 < -restitutionVelTh(gc._e > 0 ? gc._e : 0);
  gc._skip = false;
  gc._jv = 0;                                       // ★反発のあとの確認パス用（collision.js の★）
  // ★ウォームスタートはここでは打たない（collision.js の applyContactWarm の★）
  gc._jn = 0; gc._jt = 0; gc._jnMax = 0;
}
// ウォームスタート。★離れつつある接触には打たない（geometry.js の warmStartAllowed の★）
function applyGroundWarm(gc, dt) {
  if (gc._skip) return;
  const w = warmStartAllowed(gc._vn0, dt) ? warmOf(gc.cid) : null;
  gc._jn = w ? w.jn : 0;
  gc._jt = w ? w.jt : 0;
  gc._jnMax = gc._jn;
  _groundApplyN(gc, gc._jn);
  _groundApplyT(gc, gc._jt);
}
function solveGroundNormal(gc) {
  if (gc._skip) return;
  let dJn = -(_groundVelOn(gc, gc.nx, gc.ny) - gc._bias) / gc._kn;
  const jn = Math.max(gc._jn + dJn, 0);             // 地面は引っ張らない
  dJn = jn - gc._jn; gc._jn = jn;
  if (jn > gc._jnMax) gc._jnMax = jn;
  _groundApplyN(gc, dJn);
}
function solveGroundFriction(gc) {
  if (gc._skip || !(gc._kt > 0)) return;
  let dJt = -_groundVelOn(gc, gc._tdx, gc._tdy) / gc._kt;
  const want = gc._jt + dJt;
  // ★μ はサブステップ開始時のすべり速度で決める（geometry.js の frictionCoef の★）
  const lim = frictionCoef(gc.b, ground, gc._vt0) * gc._jn;
  const jt = Math.max(-lim, Math.min(lim, want));
  dJt = jt - gc._jt; gc._jt = jt;
  _groundApplyT(gc, dJt);
}
// ★早期リターンを置かないこと。理由は applyContactRestitution のコメントを参照。
function applyGroundRestitution(gc) {
  if (gc._skip || gc._e <= 0 || gc._jnMax <= 0) return;
  const target = -gc._e * gc._vn0;
  let dJn = -(_groundVelOn(gc, gc.nx, gc.ny) - target) / gc._kn;
  const jn = Math.max(gc._jn + dJn, 0);
  dJn = jn - gc._jn; gc._jn = jn;
  _groundApplyN(gc, dJn);
}
// ★反発のあとの確認（物体どうしと同じ。積算を分ける理由は collision.js の
//   verifyContactNormal の★）
function verifyGroundNormal(gc) {
  if (gc._skip) return;
  let dJ = -(_groundVelOn(gc, gc.nx, gc.ny) - gc._bias) / gc._kn;
  const jv = Math.max(gc._jv + dJ, 0);
  dJ = jv - gc._jv; gc._jv = jv;
  _groundApplyN(gc, dJ);
}
function finishGroundContact(gc) {
  if (gc._skip) return;
  storeWarm(gc.cid, gc._jnWarm !== undefined ? gc._jnWarm : gc._jn, gc._jt);   // ★反発ぶんは残さない
  // ★地面は温度を持たないので、摩擦熱は物体側が全部受け取る
  const vt1 = _groundVelOn(gc, gc._tdx, gc._tdy);
  addFrictionHeat(gc.b, null, gc._jt, gc._vt0, vt1);
  gc._drift = contactDrift(gc._vt0, gc._vtPos, vt1, gc._dt);   // ★collision.js の★
  // ★非弾性衝突ぶんも地面は受け取らない（物体側が全部）。力積は _jn + _jv（collision.js の★）
  addDissipatedHeat(gc.b, null,
    impactHeatOf(gc._jn + gc._jv, gc._vn0, _groundVelOn(gc, gc.nx, gc.ny), gc._hit, gc._vnPre));
}
function correctGroundPosition(gc) {
  const { b, nx, ny } = gc;
  if (b.sleeping) return;
  let minDist = Infinity;
  if (b.type === 'circle') {
    minDist = signedDistToGround(b.x, b.y) - b.radius;
  } else {
    for (const v of b._worldVerts()) {
      const d = signedDistToGround(v.x, v.y);
      if (d < minDist) minDist = d;
    }
  }
  if (minDist < 0) {
    const slop = 0.5, percent = 0.8;
    const corr = Math.max(-minDist - slop, 0) * percent;
    // ★いちばん深い点に当てる擬似力積として解き、向きも直す（collision.js の
    //   correctContactPosition の★と同じ理由。2026-09-27）。軸で留めた物体は並進を軸が
    //   元へ戻すので、並進だけの押し戻しでは地面から抜けなかった。
    //   実測（背景の軸に留めた 6kg の腕の先を地面へ押しつける・10秒）：
    //       重さだけ   旧 2.54px めり込む → 新 0.49px（許容の 0.5px の内）
    //       動力 20N   旧 61.5px めり込んで抜けた → 新 0.49px
    //       軸なしの箱を 800N で押す（対照）… 旧も新も 0.5px
    //   ★当てる点は、いちばん深い点から 0.5px 以内の頂点の平均。平らに載った箱なら底の辺の
    //     中点になり、腕の長さ r×n が 0 ＝ これまでとまったく同じ並進だけの押し戻しになる。
    //     円も接点が中心の真下なので同じ（回転の項が 0）。
    if (b.type !== 'circle' && b.invInertia > 0) {
      let px = 0, py = 0, k = 0;
      for (const v of b._worldVerts()) if (signedDistToGround(v.x, v.y) <= minDist + 0.5) { px += v.x; py += v.y; k++; }
      px /= k; py /= k;
      const im = b.invMass, ii = b.invInertia, rn = (px - b.x) * ny - (py - b.y) * nx;
      const lam = corr / (im + ii * rn * rn);
      b.x += nx * lam * im; b.y += ny * lam * im; b.angle += ii * rn * lam; b._updateAABB();
      return;
    }
    b.x += nx * corr; b.y += ny * corr; b._updateAABB();
  }
}

function reanchorGuide(b) {
  if (b && b.guideEnabled) { b.guidePx = b.x; b.guidePy = b.y; }
}
function projectGuideVelocity(b, record) {
  if (!b.guideEnabled || b.isStatic || b.invMass === 0) return;
  const dx = Math.cos(b.guideAngle), dy = Math.sin(b.guideAngle);
  const vd = b.vx*dx + b.vy*dy;
  const rx = b.vx - vd*dx, ry = b.vy - vd*dy;
  if (rx === 0 && ry === 0) return;
  b.vx = vd*dx; b.vy = vd*dy;
  if (record) b.recordForce('constraint', -b.mass*rx, -b.mass*ry, b.x, b.y, 'guide');
}
function projectGuidePosition(b) {
  if (!b.guideEnabled || b.isStatic || b.invMass === 0) return;
  if (b.held) return;   // ★編集ツールで掴んでいる間は拘束しない（停止中・再生中とも自由に動かせる）
  const dx = Math.cos(b.guideAngle), dy = Math.sin(b.guideAngle);
  const t = (b.x - b.guidePx)*dx + (b.y - b.guidePy)*dy;
  const nx = b.guidePx + t*dx, ny = b.guidePy + t*dy;
  if (nx === b.x && ny === b.y) return;
  b.x = nx; b.y = ny; b._updateAABB();
}
function applyGuideProjection() {
  for (const b of objects) if (b.guideEnabled) projectGuidePosition(b);
}

// 動かない側（背景・静的物体）に打たれたヒンジ＝ヒンジを、剛に合わせ込む。
//   ヒンジ1本 … 平行移動で軸を合わせる。回転は自由なまま（振り子になる）。
//   ヒンジ2本以上 … 剛体は3自由度しかないので、離れた2点を留めた時点で
//     本来まったく動けない。位置と向きの両方を、全部のヒンジにいちばん合う剛体変換
//     （回転＋平行移動の最小二乗＝Procrustes）へ直接合わせ、速度も落とす。
//     ★以前は本数に関係なく「平行移動だけ」で合わせていたため、向きの誤差を
//       誰も直せず、2本目を合わせる移動が1本目を引き剥がしていた。棒がゆっくり
//       回り続け、1本目のヒンジが数十px 置き去りになる原因。
// ヒンジが別々の位置に2本以上打たれた物体は、剛体の自由度(3)より多く拘束されるので
// 本来まったく動けない。逆質量を0にして「動かせない物体」だと全ソルバに伝える。
//   これをしないと、当たり判定もジョイントも「軽い動く物体」として扱うため、
//   ・ぶつかってきた物体は棒をはね飛ばしたつもりで素通りする
//   ・ロープを吊るしても、補正のほとんどが直後に戻される棒側へ配られて支えられない
// 逆質量を0にすれば integrate も applyImpulse も自動的に素通りする。
function updatePinnedRigidBodies() {
  const groups = new Map();
  for (const j of joints) {
    if (j.type !== 'hinge' || j.detached) continue;
    const A = j.bodyA, B = j.bodyB;
    const aF = !A || A.isStatic, bF = !B || B.isStatic;
    if (aF === bF) continue;
    const dyn = aF ? B : A;
    if (!dyn || dyn.isStatic) continue;
    const g = groups.get(dyn) || (groups.set(dyn, []), groups.get(dyn));
    g.push({ lx: aF ? j.anchorBx : j.anchorAx, ly: aF ? j.anchorBy : j.anchorAy });
  }
  for (const b of objects) {
    const g = groups.get(b);
    let rigid = false;
    if (g && g.length > 1) {          // 同じ点に重ねて打っただけでは向きが決まらない
      for (let i = 1; i < g.length && !rigid; i++)
        if (Math.hypot(g[i].lx - g[0].lx, g[i].ly - g[0].ly) > 1e-6) rigid = true;
    }
    if (rigid) {
      b._pinRigid = true;
      b.invMass = 0; b.invInertia = 0;
      b.vx = 0; b.vy = 0; b.av = 0;
    } else if (b._pinRigid) {
      b._pinRigid = false;
      b.setMass(b.mass);              // 逆質量を戻す（isStatic / 回転固定も考慮される）
    }
  }
}
function enforceRigidHinges() {
  let pins = null;
  for (const j of joints) {
    if (j.type !== 'hinge' || j.detached) continue;
    const A = j.bodyA, B = j.bodyB;
    const aFixed = !A || A.isStatic;
    const bFixed = !B || B.isStatic;
    if (aFixed === bFixed) continue;
    const dyn = aFixed ? B : A;
    if (!dyn || dyn.isStatic) continue;
    if (!pins) {                           // 物体ごとにヒンジを1回だけ集める
      pins = new Map();
      for (const k of joints) {
        if (k.type !== 'hinge' || k.detached) continue;
        const ka = k.bodyA, kb = k.bodyB;
        const kaF = !ka || ka.isStatic, kbF = !kb || kb.isStatic;
        if (kaF === kbF) continue;
        const d = kaF ? kb : ka;
        if (!d || d.isStatic) continue;
        const list = pins.get(d) || (pins.set(d, []), pins.get(d));
        list.push({
          pivot: kaF ? k.getWorldAnchorA() : k.getWorldAnchorB(),   // 動かない側＝目標の位置
          lx: kaF ? k.anchorBx : k.anchorAx,                        // 物体側のローカル座標
          ly: kaF ? k.anchorBy : k.anchorAy,
        });
      }
    }
    const list = pins.get(dyn);
    if (!list || !list.length) continue;
    if (list.length === 1) {
      const pivot = list[0].pivot;
      const anc = getWorldAnchor(dyn, list[0].lx, list[0].ly);
      dyn.x += pivot.x - anc.x;
      dyn.y += pivot.y - anc.y;
      dyn._updateAABB();
      continue;
    }
    // ── 2本以上：全部のヒンジに最も合う剛体変換を求めて、そこへ置く ──
    let pcx = 0, pcy = 0, qcx = 0, qcy = 0;
    for (const p of list) { pcx += p.lx; pcy += p.ly; qcx += p.pivot.x; qcy += p.pivot.y; }
    const n = list.length;
    pcx /= n; pcy /= n; qcx /= n; qcy /= n;
    let sn = 0, cs = 0, spread = 0;
    for (const p of list) {
      const ux = p.lx - pcx, uy = p.ly - pcy;
      const vx = p.pivot.x - qcx, vy = p.pivot.y - qcy;
      cs += ux * vx + uy * vy;             // Σ u·v
      sn += ux * vy - uy * vx;             // Σ u×v
      spread += ux * ux + uy * uy;
    }
    if (spread > 1e-6 && (sn !== 0 || cs !== 0)) dyn.angle = Math.atan2(sn, cs);
    const c = Math.cos(dyn.angle), s = Math.sin(dyn.angle);
    dyn.x = qcx - (pcx * c - pcy * s);
    dyn.y = qcy - (pcx * s + pcy * c);
    dyn.vx = 0; dyn.vy = 0; dyn.av = 0;    // 動けないのだから速度も持たない
    dyn._updateAABB();
  }
}
function rebuildConnectedPairs() {
  connectedPairs.clear();
  for (const j of joints) {
    if (!j.bodyA || !j.bodyB || j.detached) continue;
    if (j.type !== 'hinge' && j.type !== 'axle' && j.type !== 'fixjoint') continue;
    const a = j.bodyA.id, b = j.bodyB.id;
    connectedPairs.add(a < b ? a + '_' + b : b + '_' + a);
  }
}
let frozenCount = 0;
function updateFrozenBodies() {
  frozenCount = 0;
  const d = world.freezeDistance;
  // 万有引力モードでは遠方の天体も互いに力を及ぼすので、凍結してはいけない
  if (!(d > 0) || world.gravitation) {
    for (const b of objects) b.frozen = false;
    return;
  }
  // 凍結すると壊れるもの＝ジョイントで繋がれた物体・レーザーや波源を載せた物体
  const keep = new Set();
  for (const j of joints) { if (j.bodyA) keep.add(j.bodyA); if (j.bodyB) keep.add(j.bodyB); }
  for (const L of lasers) if (L.body) keep.add(L.body);
  for (const s of waveSources) if (s.body) keep.add(s.body);
  const m = toPx(d);
  const hw = canvas.width / (2 * cam.zoom), hh = canvas.height / (2 * cam.zoom);
  const minX = cam.x - hw - m, maxX = cam.x + hw + m;
  const minY = cam.y - hh - m, maxY = cam.y + hh + m;
  for (const b of objects) {
    if (b.isStatic || b.held || b._grabbed || b.tracerEnabled || keep.has(b)) { b.frozen = false; continue; }
    const a = b._aabb;
    const out = a.maxX < minX || a.minX > maxX || a.maxY < minY || a.minY > maxY;
    b.frozen = out;
    if (out) frozenCount++;
  }
}
function setFreezeDistance(v) {
  world.freezeDistance = Math.max(0, Math.min(20000, parseFloat(v) || 0));
}
// ════════════════════════════════════════
//  壁（ワールド境界）
//   位置をクランプして速度を反射する方式。接触の生成・解決を通さないので、
//   どんなに速い物体でも貫通できない（薄い静的物体を壁にすると貫通する）。
//   床は地面の高さ（ground.y）。上へ wallH ぶん伸ばす。内部yは下向き正。
// ════════════════════════════════════════
function syncWallUI() {
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  const chk = document.getElementById('w-walls'); if (chk) chk.checked = !!world.wallsOn;
  set('w-wallw', world.wallW); set('w-wallh', world.wallH); set('w-wallrest', world.wallRest);
}
function wallBounds() {
  const hw = toPx(world.wallW) / 2, H = toPx(world.wallH);
  return { L: -hw, R: hw, B: ground.y, T: ground.y - H };
}
// 1つの点（半径 r）を境界の内側へ押し戻す。戻した軸の速度は反発係数で反転させる。
function _clampToWalls(o, r, e) {
  const w = wallBounds();
  let hit = false;
  if (o.x - r < w.L) { o.x = w.L + r; if (o.vx < 0) { o.vx = -o.vx * e; } hit = true; }
  else if (o.x + r > w.R) { o.x = w.R - r; if (o.vx > 0) { o.vx = -o.vx * e; } hit = true; }
  if (o.y - r < w.T) { o.y = w.T + r; if (o.vy < 0) { o.vy = -o.vy * e; } hit = true; }
  else if (o.y + r > w.B) { o.y = w.B - r; if (o.vy > 0) { o.vy = -o.vy * e; } hit = true; }
  return hit;
}
// 物体・液体・気体・ロープの節点まで、動くものはすべて閉じ込める
function enforceWalls() {
  if (!world.wallsOn) return;
  const w = wallBounds();
  if (w.R - w.L < 1 || w.B - w.T < 1) return;      // 潰れた箱は無効
  const e = clamp01(world.wallRest);
  for (const b of objects) {
    if (b.isStatic || b.held) continue;             // 掴んでいる間はカーソルに従わせる
    const a = b._aabb;
    let moved = false;
    // AABB の食い込み量だけ中心を動かす（回転は変えない＝角運動量に触らない）
    if (a.minX < w.L)      { b.x += w.L - a.minX; if (b.vx < 0) b.vx = -b.vx * e; moved = true; }
    else if (a.maxX > w.R) { b.x -= a.maxX - w.R; if (b.vx > 0) b.vx = -b.vx * e; moved = true; }
    if (a.minY < w.T)      { b.y += w.T - a.minY; if (b.vy < 0) b.vy = -b.vy * e; moved = true; }
    else if (a.maxY > w.B) { b.y -= a.maxY - w.B; if (b.vy > 0) b.vy = -b.vy * e; moved = true; }
    if (moved) {
      b._updateAABB(); b.sleeping = false; b.sleepTimer = 0;
      noteProgramEnvContact(b, PROG_WALL_ID);   // ★プログラムの「当たったら」の相手に壁も入れる
    }
  }
  for (const p of particles) _clampToWalls(p, p.radius, e);
  for (const j of joints) {                         // ロープの節点（すり抜けると目立つ）
    if (j.type !== 'rope' || !j.nodes) continue;
    for (const n of j.nodes) {
      n.x = Math.min(w.R, Math.max(w.L, n.x));
      n.y = Math.min(w.B, Math.max(w.T, n.y));
    }
  }
}
// 壁を描く（背景と物体の間。UIの端ではなく物理的な壁だと分かるように内側へ影を落とす）
function drawWalls() {
  if (!world.wallsOn) return;
  const w = wallBounds();
  const a = worldToScreen(w.L, w.T), b = worldToScreen(w.R, w.B);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 10;
  ctx.strokeRect(a.x + 6, a.y + 6, (b.x - a.x) - 12, (b.y - a.y) - 12);
  ctx.restore();
}
// 接線方向の位置ずれを戻す（静止摩擦の位置拘束）。理由は collision.js の
//   correctContactTangentialDrift の★にまとめてある。地面は動かないので物体だけ戻す。
//   ★物体1つにつき1回だけ呼ぶこと（角ごとに呼ぶと接触点の数だけ効いてしまう）。
function correctGroundTangentialDrift(gc) {
  if (gc._skip || !(gc._jn > 0)) return;
  const b = gc.b;
  if (b.sleeping || b.invMass === 0) return;
  let d = gc._drift;
  if (!(d === d) || d === 0) return;
  if (d >  CONTACT_DRIFT_MAX) d =  CONTACT_DRIFT_MAX;
  else if (d < -CONTACT_DRIFT_MAX) d = -CONTACT_DRIFT_MAX;
  b.x -= gc._tdx * d; b.y -= gc._tdy * d;
  b._updateAABB();
}
