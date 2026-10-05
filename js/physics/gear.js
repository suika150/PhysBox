// ═══ 歯車の形 ══════════════════════════════════════════════════════════
//  ★歯車は「形」だけ。動力は歯どうしがぶつかる接触だけで伝わる（専用の拘束は無い）。
//    歯車ツールが作るのは、インボリュート歯形を輪郭に持つただの多角形の物体で、
//    軸は軸ツール・ヒンジで別に留める。かみ合いの比も力の伝わり方も、接触ソルバが
//    歯面の法線（圧力角の向き）に沿って押し合った結果として出てくる。
//    実測（歯数20と10・モジュール10px、Aを軸のモーター 1rad/s・50N·m、Bはヒンジ）：
//      回転比 −2.0006（理論 −2）。Bの軸にブレーキ L をかけると、Aが止まる境目は
//      L=24→減速・L=26→停止（理論 25＝50/2。摩擦0なので歯面の損失なし）。
//      摩擦0.5だと L≈22 で止まる（歯面のすべりの損失）。だから歯車ツールの既定は摩擦0。
//  ★速く回すと歯を飛ばす（すり抜け）。1サブステップに歯先が進む距離がモジュールの
//    およそ1.2倍を超えると、接触が見つかる前に相手の歯を通り越す。
//    実測（歯数20:10・刻み4）：m=10px は 11.5px/サブステップで0枚・13.8px で2枚飛ぶ。
//    m=5px は 4.6px で0枚・6.9px で3枚。刻み8にすると m=10px の 13.8px も0枚。
//    軸は外れず、飛んだ先でまたかみ合う。
//
//  歯の付き方は2通りあり、どちらも「面」として同じ形の控えを持つ（吸着だけが使う）：
//    b.gear = { z, m } … 歯車ツールで置いた円形歯車。形は z と m だけで決まるので、
//                         右パネルで変えると輪郭を作り直す（js/app/gear-tools.js）。
//    b.toothFaces = [...] … 歯車コートで面に刻んだ歯（ラック／扇形歯車／内歯車）。
//                         形は verts に焼き込み済みで、これは吸着のための控えにすぎない。
//      { kind:'rack', ox, oy, nx, ny, u0, u1, m }
//          (ox,oy)=基準線上の歯の中心の1つ、n=材料の外向きの法線、
//          歯の中心は o + k·πm·e（e=(−ny,nx)）、u0..u1 は e 方向の範囲
//      { kind:'arc', cx, cy, r, a0, lo, hi, full, internal, m }
//          基準円（中心・半径）、a0=材料の歯の中心の角度の1つ、lo..hi=歯のある角度の範囲、
//          internal=内歯車（材料が円の外側）
//    どちらもローカル座標。物体の変形（拡大縮小・鏡映・図形和）では一緒に写す。

const GEAR_PRESSURE_ANGLE = 20 * Math.PI / 180;   // 圧力角（JIS の標準）
const GEAR_ADDENDUM  = 1.0;    // 歯先の高さ ×m
const GEAR_DEDENDUM  = 1.25;   // 歯元の深さ ×m（相手の歯先とのすき間 0.25m を含む）
// ★バックラッシ（歯の厚みを基準円の上で削る量 ×m）。歯の厚みの約3%。
//   0 だと両側の歯面が同時に触れうるので少しだけ逃がしてある。値は実測で詰めていない。
const GEAR_BACKLASH  = 0.05;
const GEAR_FLANK_PTS = 5;      // 歯面1枚を何本の線分で近似するか
const GEAR_MIN_Z = 6;
const GEAR_MAX_Z = 200;
const _gearInv = a => Math.tan(a) - a;

// 歯1枚の歯面：半径 ρ ごとの半角 θ(ρ)。z は実数でよい（扇形歯車は基準円の周が
//   ピッチの整数倍になるとは限らない）。thick は基準円の上の歯の厚み [×m]。
function _gearFlank(R, m, z, thick, rFrom, rTo) {
  const rb = R * Math.cos(GEAR_PRESSURE_ANGLE);
  const half0 = thick / z + _gearInv(GEAR_PRESSURE_ANGLE);   // 基準円での半角 thick·m/2 ÷ R ＋ inv(α)
  const r0 = Math.max(rb, rFrom);
  const out = [];
  for (let i = 0; i <= GEAR_FLANK_PTS; i++) {
    const rho = r0 + (rTo - r0) * i / GEAR_FLANK_PTS;
    const ap = Math.acos(Math.min(1, rb / rho));
    out.push({ rho, th: half0 - _gearInv(ap) });
  }
  return out;
}
const _gearP = (cx, cy, rho, th) => ({ x: cx + rho * Math.cos(th), y: cy + rho * Math.sin(th) });

// 歯車の輪郭（ローカル座標・中心が原点・歯の1枚目が +x を向く）
function gearOutline(z, m) {
  const r = m * z / 2, rb = r * Math.cos(GEAR_PRESSURE_ANGLE);
  const ra = r + GEAR_ADDENDUM * m, rf = Math.max(r - GEAR_DEDENDUM * m, m);
  const flank = _gearFlank(r, m, z, Math.PI / 2 - GEAR_BACKLASH, rf, ra);
  const pitch = 2 * Math.PI / z, V = [];
  for (let k = 0; k < z; k++) {
    const c = k * pitch;
    // 歯底が基礎円より内側にあるときは、基礎円から下は半径方向にまっすぐ下ろす
    if (rf < rb) V.push(_gearP(0, 0, rf, c - flank[0].th));
    for (const f of flank) V.push(_gearP(0, 0, f.rho, c - f.th));
    for (let i = flank.length - 1; i >= 0; i--) V.push(_gearP(0, 0, flank[i].rho, c + flank[i].th));
    if (rf < rb) V.push(_gearP(0, 0, rf, c + flank[0].th));
  }
  return V;
}
function gearTipRadius(z, m) { return m * z / 2 + GEAR_ADDENDUM * m; }

// 円弧の面に並べる歯1枚の多角形（中心 c の向き・半径 rIn〜rOut）。
//   外歯車なら「材料の歯」、内歯車なら「歯みぞ（空き）」をこの形で作る
//   （内歯車の歯みぞは、同じ基準円の外歯車の歯と同じ形）。
function gearArcToothPoly(cx, cy, R, m, c, thick, rIn, rOut) {
  const z = 2 * R / m;
  const f = _gearFlank(R, m, z, thick, rIn, rOut);
  const V = [];
  V.push(_gearP(cx, cy, rIn, c - f[0].th));
  for (const q of f) V.push(_gearP(cx, cy, q.rho, c - q.th));
  for (let i = f.length - 1; i >= 0; i--) V.push(_gearP(cx, cy, f[i].rho, c + f[i].th));
  V.push(_gearP(cx, cy, rIn, c + f[0].th));
  return V;
}
// ラックの歯1枚（基準線上の中心 (px,py)・材料の外向き法線 n）。y は n 方向の高さ。
//   ラックの歯面は圧力角だけ傾いた直線（インボリュートの半径無限大の極限）。
function gearRackToothPoly(px, py, nx, ny, m, yIn, yOut) {
  const ex = -ny, ey = nx, t = Math.tan(GEAR_PRESSURE_ANGLE);
  const hw = y => (Math.PI / 2 - GEAR_BACKLASH) * m / 2 - y * t;
  const P = (u, y) => ({ x: px + ex * u + nx * y, y: py + ey * u + ny * y });
  return [P(-hw(yIn), yIn), P(-hw(yOut), yOut), P(hw(yOut), yOut), P(hw(yIn), yIn)];
}

// ─── 面の控え ─────────────────────────────────────────────────────────
// b.gear が今の形と食い違っていないか（念のため。拡大縮小では m も一緒に掛けている）
function gearInfoOf(b) {
  const g = b && b.type === 'polygon' && b.gear;
  if (!g || !(g.z >= GEAR_MIN_Z) || !(g.m > 0)) return null;
  let rmax = 0;
  for (const v of b.verts) { const d = Math.hypot(v.x, v.y); if (d > rmax) rmax = d; }
  return Math.abs(rmax - gearTipRadius(g.z, g.m)) < 0.01 * g.m ? g : null;
}
// 物体が持つ歯の面（ローカル）。円形歯車は全周1本の外歯の面として扱う。
function gearLocalFaces(b) {
  const out = [];
  const g = gearInfoOf(b);
  if (g) out.push({ kind: 'arc', cx: 0, cy: 0, r: g.m * g.z / 2, a0: 0, lo: 0, hi: 2 * Math.PI,
                    full: true, internal: false, m: g.m });
  if (b.toothFaces) for (const f of b.toothFaces) out.push(f);
  return out;
}
// ローカルの面を、物体の姿勢（x, y, angle）でワールドへ写す
function gearFaceToWorld(f, x, y, angle) {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  if (f.kind === 'rack')
    return { ...f, ox: x + f.ox * cs - f.oy * sn, oy: y + f.ox * sn + f.oy * cs,
             nx: f.nx * cs - f.ny * sn, ny: f.nx * sn + f.ny * cs };
  return { ...f, cx: x + f.cx * cs - f.cy * sn, cy: y + f.cx * sn + f.cy * cs,
           a0: f.a0 + angle, lo: f.lo + angle, hi: f.hi + angle };
}
// ワールドの面を、姿勢（x, y, angle）の物体のローカルへ戻す
function gearFaceToLocal(f, x, y, angle) {
  const cs = Math.cos(-angle), sn = Math.sin(-angle);
  const L = (px, py) => ({ x: (px - x) * cs - (py - y) * sn, y: (px - x) * sn + (py - y) * cs });
  if (f.kind === 'rack') {
    const o = L(f.ox, f.oy);
    return { ...f, ox: o.x, oy: o.y, nx: f.nx * cs - f.ny * sn, ny: f.nx * sn + f.ny * cs };
  }
  const c = L(f.cx, f.cy);
  return { ...f, cx: c.x, cy: c.y, a0: f.a0 - angle, lo: f.lo - angle, hi: f.hi - angle };
}
// 拡大縮小（原点まわりに s 倍）と、y→−y の鏡映
function gearFaceScaled(f, s) {
  if (f.kind === 'rack') return { ...f, ox: f.ox * s, oy: f.oy * s, u0: f.u0 * s, u1: f.u1 * s, m: f.m * s };
  return { ...f, cx: f.cx * s, cy: f.cy * s, r: f.r * s, m: f.m * s };
}
function gearFaceMirroredY(f) {
  // ★e=(−ny,nx) は鏡映で向きが逆になるので、範囲も符号を反転して入れ替える
  if (f.kind === 'rack') return { ...f, oy: -f.oy, ny: -f.ny, u0: -f.u1, u1: -f.u0 };
  return { ...f, cy: -f.cy, a0: -f.a0, lo: -f.hi, hi: -f.lo };
}
const _frac = x => x - Math.floor(x);
function _angIn(a, lo, hi) { return _frac((a - lo) / (2 * Math.PI)) * 2 * Math.PI <= hi - lo; }

// ★かみ合わせの吸着。描こうとしている歯車（中心 cx,cy・歯数 z・モジュール m）が
//   同じモジュールの歯の面に歯の高さの範囲で重なっていたら、中心をかみ合う距離へ寄せ、
//   歯が相手の歯みぞに入る角度を返す。手で中心距離と位相を 0.5px の精度で
//   合わせるのは無理で、合っていないと歯どうしが食い込んだまま始まって弾け飛ぶ。
//   位相の式：相手の面の上で、自分と接する点の向きを φ（相手の中心→自分の中心）とし、
//   相手の歯がそこから何ピッチずれているかを fA（0＝相手の歯の中心がそこにある）とする。
//     外歯どうし：自分は φ+π の向きで fB = 1/2 − fA（転がっても fA+fB は不変：
//                 Aが Δ 回ると fA は Δ/pA 減り、Bは −Δ·zA/zB 回って fB が同じだけ増える）
//     内歯車の内側：自分は φ の向きで fB = fA + 1/2（同じ向きに回るので fA−fB が不変）
//     ラック：半径無限大の外歯車の極限。φ＝面の法線、fA は e 方向の位置 ÷ ピッチ。
//   only を渡すと、その物体の面だけを見て、ずれの大きさによらず置き直す
//   （右パネルで歯数を変えたとき、今の相手とかみ合う距離へ動かすのに使う）。
function gearMeshPose(cx, cy, z, m, exclude, only) {
  let best = null;
  const r = m * z / 2, pB = 2 * Math.PI / z;
  const consider = (err, x, y, angle, o) => {
    if (!only && err > 2 * m) return;           // 歯の高さ程度のずれまで吸い寄せる
    if (best && err >= best.err) return;
    best = { x, y, angle, err, with: o };
  };
  for (const o of objects) {
    if (o === exclude || (only && o !== only)) continue;
    for (const lf of gearLocalFaces(o)) {
      if (Math.abs(lf.m - m) > 1e-6) continue;
      const f = gearFaceToWorld(lf, o.x, o.y, o.angle);
      if (f.kind === 'rack') {
        const ex = -f.ny, ey = f.nx;
        const s = (cx - f.ox) * ex + (cy - f.oy) * ey;
        const h = (cx - f.ox) * f.nx + (cy - f.oy) * f.ny;
        if (s < f.u0 - Math.PI * m / 2 || s > f.u1 + Math.PI * m / 2) continue;
        const fA = _frac(s / (Math.PI * m));
        const phi = Math.atan2(f.ny, f.nx);
        consider(Math.abs(h - r), f.ox + ex * s + f.nx * r, f.oy + ey * s + f.ny * r,
                 phi + Math.PI - (0.5 - fA) * pB, o);
        continue;
      }
      const dx = cx - f.cx, dy = cy - f.cy, d = Math.hypot(dx, dy);
      const phi = d > 1e-9 ? Math.atan2(dy, dx) : 0;
      if (!f.full && !_angIn(phi, f.lo - Math.PI * m / f.r, f.hi + Math.PI * m / f.r)) continue;
      const pA = Math.PI * m / f.r;                     // 角ピッチ（= 2π / 基準円の歯数）
      if (f.internal) {
        const a = f.r - r;
        if (a < m) continue;                            // 内歯車より大きい歯車は入らない
        const fA = _frac((phi - f.a0) / pA);
        consider(Math.abs(d - a), f.cx + a * Math.cos(phi), f.cy + a * Math.sin(phi),
                 phi - (fA + 0.5) * pB, o);
      } else {
        const a = f.r + r;
        const fA = _frac((phi - f.a0) / pA);
        consider(Math.abs(d - a), f.cx + a * Math.cos(phi), f.cy + a * Math.sin(phi),
                 phi + Math.PI - (0.5 - fA) * pB, o);
      }
    }
  }
  return best;
}
