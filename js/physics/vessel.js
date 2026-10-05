// ════════════════════════════════════════
//  ピストン容器（シリンダー＋拘束されたピストン＋気体室をひとまとまりの物として持つ）
// ════════════════════════════════════════
//  ★なぜ「容器」という1つの物にするか
//    気体室（gas.js）のモデルは、もともと「傾かないピストン」を前提にしている。
//    圧力はピストンの中心へ軸方向にしか加えておらず（applyGasChambers の ④）、
//    トルクが無い＝圧力は傾きを戻せない。傾けるのは重力と衝突だけなので、
//    傾いたピストンは「よりリアル」なのではなく、モデルの適用範囲の外にある。
//
//    実測（ピストン120×16・5kg／気体室 h=100px・1気圧／600ステップ）：
//      ・壁を置かずに端へ10kgを落とす … ピストンが 720° 回転し、横へ 124px ずれて
//        （許容 62px）密閉が破れ、気体の高さが負になった
//      ・壁を自分で置けば耐える … が、それでも残る 2.08° の傾きだけで気体の体積が
//        2.17% ずれる（heightPx が _pistonHalf をピストンの現在の向きから計算するため。
//        5° なら 5.2%）。P-V図と熱効率を読むための模型としては見過ごせない。
//
//    そこで器・ピストン・気体を一体で持ち、ピストンを軸上の1自由度に拘束する。
//    これは新しい理想化を足すのではなく、既にあった前提を実装に反映させることにあたる。
//    副産物として、GasChamber の sealed()／broken は原理的に起きなくなる。
//
//  ★部品には既存のものをそのまま使う（新しい当たり判定や描画を作らない）
//      器      … 静的な Body（U字の多角形）。当たり判定があるので、中へおもりを
//                落として積める。移動・回転・削除・保存はふつうの物体として動く。
//      ピストン… 動的な Body。質量を持つので P = 大気圧 + mg/A の定圧変化が出せるし、
//                おもりを載せれば押し下がる。熱容量もあるので減衰熱の行き先になる。
//      気体    … 既存の GasChamber。P-V図・第一法則の帳簿・恒温槽がそのまま使える。
const VESSEL_WALL_PX = 10;      // 器の壁の厚み [px]
const VESSEL_MIN_BORE = 16;     // 内径の下限 [px]
const VESSEL_MIN_LEN  = 40;     // 内側の全長の下限 [px]
const VESSEL_MIN_WALL = 5;      // 壁の厚みの下限 [px]。★既定の半分。これより薄いと分子・水の粒の抜けを確かめていない
// ── 口の返し（止め輪）────────────────────────────────────────
//   ★なぜ足したか：蓋は前から口の面でぴたりと止まっていたが、**止まる理由が画面に無かった**。
//     定圧のつもりで温め続けると、蓋が口に着いた瞬間から黙って定積に化け、圧力だけが
//     上がり続ける。原因の見えない結果になるので、そこに本当に引っかかるものを描く。
//   ★止めるのは返しの「接触」ではなく、今までどおり solveVesselConstraint ③の拘束。
//     返しは見た目であって、当たり判定に仕事をさせない。理由は2つ：
//       ・このエンジンは離散判定で CCD が無く、位置補正の slop も 0.5px。蓋の幅は bore-2 で
//         返しとの重なりは片側 lip-1 px しか作れないから、速い蓋は返しをすり抜ける。
//       ・蓋と器が常時接触すると接触ソルバと1自由度拘束が綱引きになる（前掲★の、
//         わざと 1px すき間を空けてある理由そのもの）。口で止まっている状態は常時接触。
//     拘束で止めたまま返しを描けば、蓋は返しの内側の面に触れて止まる＝見えたとおりに止まる。
const VESSEL_LIP_THICK = 4;     // 返しの厚み（軸方向）[px]。可動域はこのぶん短くなる
// 蓋を止める位置は、返しの内側の面より 1px だけ手前にする。器の横壁で蓋の幅を bore-2 に
// してあるのと同じ理由で、**触れさせない**（触れると毎tick 接触ソルバが働いて拘束と綱引きになる）。
const VESSEL_LIP_GAP = 1;
// 返しの出っ張り [px]。内径に比例させるのは、内径の下限 16px でも口が塞がらないようにするため
//   （bore=120 なら 5px＝片側 4px 重なる、bore=16 なら 2px＝片側 1px 重なる）。
function _vesselLipDepth(bore) { return Math.max(2, Math.min(5, bore * 0.06)); }
const pistonVessels = [];

class PistonVessel {
  constructor(opts = {}) {
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.cylinderId = opts.cylinderId != null ? opts.cylinderId : null;
    this.pistonId   = opts.pistonId   != null ? opts.pistonId   : null;
    this.chamberId  = opts.chamberId  != null ? opts.chamberId  : null;
    this.bore     = opts.bore     || 120;   // 内径 [px]（＝気体室の断面の長さ）
    this.innerLen = opts.innerLen || 200;   // 内側の全長 [px]（ピストンが動ける範囲）
    this.wall     = opts.wall !== undefined ? opts.wall : VESSEL_WALL_PX;
    this.label    = opts.label || '';
  }
  cylinder() { return objects.find(o => o.id === this.cylinderId) || null; }
  piston()   { return objects.find(o => o.id === this.pistonId)   || null; }
  chamber()  { return gasChambers.find(c => c.id === this.chamberId) || null; }
  // 軸＝閉じた端からピストンへ向かう向き。器の向きから決まる。
  //   器の角度0のとき (0,-1)＝画面の上向きで、気体は下・ピストンは上になる
  //   （ふつうに置いたシリンダーで、おもりを載せると圧縮される向き）。
  axisAngle() { const c = this.cylinder(); return (c ? c.angle : 0) - Math.PI / 2; }
  axis() { const a = this.axisAngle(); return { x: Math.cos(a), y: Math.sin(a) }; }
  // 閉じた端の内側の面の中心（ワールド）。器のローカル +y 側が閉端。
  closedEnd() {
    const c = this.cylinder();
    if (!c) return { x: 0, y: 0 };
    const cos = Math.cos(c.angle), sin = Math.sin(c.angle), ly = this.innerLen / 2;
    return { x: c.x - ly * sin, y: c.y + ly * cos };
  }
  // ピストンの軸方向の厚みの半分 [px]。拘束してあるので向きによらず一定
  pistonHalf() { const p = this.piston(); return p ? (p.h || 0) / 2 : 0; }
  // ピストン中心が動ける、閉端からの距離の範囲 [px]
  //   上限は「蓋の外面が返しの内側の面の 1px 手前まで来る」ところ。返しのぶん短いので、
  //   蓋は返しに食い込まずに止まる（食い込んで見えると、描いた意味が無くなる）。
  travelRange() {
    const half = this.pistonHalf();
    const top = this.innerLen - VESSEL_LIP_THICK - VESSEL_LIP_GAP - half;
    return { min: GAS_MIN_H_PX + half, max: Math.max(GAS_MIN_H_PX + half, top) };
  }
}
// 器のU字の外形（ローカル座標）。内側は x∈[-bore/2, bore/2]、y∈[-innerLen/2, +innerLen/2] で、
// +y 側が閉じた端、−y 側が開口。原点は内側の中心に置く（頂点はそのまま使われるので、
// ここを基準にしておくと closedEnd() などの式が素直になる）。
// 開口の両側には返しが内向きに出る（出っ張り lip・厚み VESSEL_LIP_THICK）。
function _vesselOutline(bore, innerLen, wall) {
  const hw = bore / 2, hl = innerLen / 2, t = wall;
  const lip = _vesselLipDepth(bore), lt = VESSEL_LIP_THICK;
  return [
    { x: -hw - t,   y: -hl },      { x: -hw + lip, y: -hl },       // 口の面（左の返しの先まで）
    { x: -hw + lip, y: -hl + lt }, { x: -hw,       y: -hl + lt },  // 左の返しの内側
    { x: -hw,       y:  hl },      { x:  hw,       y:  hl },       // 左の内壁 → 閉端 → 右の内壁
    { x:  hw,       y: -hl + lt }, { x:  hw - lip, y: -hl + lt },  // 右の返しの内側
    { x:  hw - lip, y: -hl },      { x:  hw + t,   y: -hl },       // 口の面（右）
    { x:  hw + t,   y: hl + t },   { x: -hw - t,   y: hl + t },    // 外側
  ];
}
// ── 容器を作る ──────────────────────────────────────────────
//   x,y     … 内側の中心（器の基準点）
//   angle   … 器の向き（0＝開口が上）
//   bore    … 内径 [px] ／ innerLen … 内側の全長 [px]
//   fill    … 気体が占める割合（0〜1）。ピストンの初期位置がここで決まる
function createPistonVessel(opts = {}) {
  const bore     = Math.max(VESSEL_MIN_BORE, opts.bore || 120);
  const innerLen = Math.max(VESSEL_MIN_LEN,  opts.innerLen || 200);
  const wall     = opts.wall !== undefined ? opts.wall : VESSEL_WALL_PX;
  const angle    = opts.angle || 0;
  const x = opts.x || 0, y = opts.y || 0;
  const v = new PistonVessel({ bore, innerLen, wall, label: opts.label });
  // ── 器（動的・当たり判定あり）──
  //   ★静的ではない。器は気体の付属品だが、それ自体はただの物体なので、落ちるし、
  //     押せば転がるし、端に重りを載せれば倒れる。動かないほうがよい場面のために
  //     「背景に固定」のチェックはふつうに出してある（他の物体と同じ扱い）。
  //     動く器を成立させるために2つ足りていなかったものを入れてある：
  //       ・気体が蓋を押す力の**反作用**を閉端へ返す（applyGasChambers ⑤）。
  //         これが無いと容器が自分で自分を押す＝推進機になる。
  //       ・蓋の拘束を、器と蓋の**2物体間**で解く（solveVesselConstraint）。
  //         片側だけ動かすと運動量が湧く。
  const cyl = new Body({
    type: 'polygon', x, y, angle, verts: _vesselOutline(bore, innerLen, wall),
    density: opts.cylinderDensity !== undefined ? opts.cylinderDensity : 600,
    fillColor: opts.cylinderColor || '#78909c', strokeColor: '#cfd8dc', strokeWidth: 1,
  });
  objects.push(cyl);
  v.cylinderId = cyl.id;
  // ── ピストン（動的・軸上の1自由度に拘束）──
  //   すき間を少しだけ空ける。器の壁とピストンが常に接触していると、
  //   接触ソルバが毎tick 仕事をして、拘束と綱引きになる。
  const pThick = Math.max(6, opts.pistonThick || 16);
  const a = { x: Math.cos(angle - Math.PI/2), y: Math.sin(angle - Math.PI/2) };
  const half = pThick / 2;
  const fill = Math.min(0.9, Math.max(0.1, opts.fill !== undefined ? opts.fill : 0.5));
  const d = Math.min(innerLen - VESSEL_LIP_THICK - VESSEL_LIP_GAP - half,
                     Math.max(GAS_MIN_H_PX + half, innerLen * fill + half));
  const ce = { x: x - (innerLen/2) * Math.sin(angle), y: y + (innerLen/2) * Math.cos(angle) };
  //   ★レール（guideEnabled）は使わない。あれは「世界に固定した直線」なので、器が
  //     動くようになった今は器と一緒に動く軸を表せないし、applyImpulse が横向きの
  //     力積を黙って捨てるため、器へ渡すべき反作用まで消えてしまう。
  //     拘束は solveVesselConstraint が器と蓋の2物体間で解く。
  const piston = new Body({
    type: 'box', x: ce.x + a.x * d, y: ce.y + a.y * d, angle,
    w: bore - 2, h: pThick, mass: opts.pistonMass || 5,
    fillColor: opts.pistonColor || '#ffb74d', strokeColor: '#ffe0b2', strokeWidth: 1,
  });
  objects.push(piston);
  v.pistonId = piston.id;
  // ── 気体（既存の GasChamber をそのまま使う）──
  const ch = new GasChamber({
    angle: angle - Math.PI/2, width: bore, pistonId: piston.id,
    T: opts.T !== undefined ? opts.T : ROOM_K,
    P0: opts.P0 !== undefined ? opts.P0 : world.atmPressure,
    dof: opts.dof, damp: opts.damp,
  });
  ch.cx = ce.x; ch.cy = ce.y;
  gasInitMoles(ch);
  gasChambers.push(ch);
  v.chamberId = ch.id;
  pistonVessels.push(v);
  syncPistonVessel(v);
  return v;
}
// ── 器を動かしたら、気体室とピストンのレールも合わせ直す ────────────────
//   容器を1つの物として扱う約束はここで守る。器を掴んで動かす・回すと、
//   閉じた端も軸もレールも一緒に動く（ばらばらに置いた部品ではない）。
function syncPistonVessel(v) {
  const cyl = v.cylinder(), ch = v.chamber();
  if (!cyl) return;
  const ce = v.closedEnd();
  if (ch) { ch.cx = ce.x; ch.cy = ce.y; ch.angle = v.axisAngle(); ch.width = v.bore; }
}
// ── 蓋を器の軸に拘束する（毎サブステップ）──────────────────────────────
//   蓋と器の相対運動は「軸方向の並進」だけ＝直動（プリズマティック）拘束。
//   ★器が動くようになったので、片側だけ直す書き方はできない。以前は蓋の位置と
//     速度を軸へ投影するだけだったが、それは「器が無限に重い」ことを前提にした
//     近似で、器が動くと運動量が湧く（蓋を横から押すと器が付いてこないのに
//     蓋だけ元に戻される＝力がどこからともなく現れる）。
//     そこで、接触ソルバと同じく**質量で重みを付けた力積**として両方に配る。
//     これで、蓋にかかった横向きの力や偶力はそのまま器へ伝わる
//     ＝重りを蓋の端に載せれば容器ごと倒れる。
//   解く順は 回転 → 横ずれ → 軸方向の行き止まり。あとの拘束ほど幾何が効くので、
//   軸（＝器の向き）が決まってから位置を直す。
function solveVesselConstraint(v) {
  const c = v.cylinder(), p = v.piston();
  if (!c || !p) return;
  // 掴んでいる物体（held）は位置をカーソルが決めているので、動かす側から外す。
  // applyImpulse が held を弾くのと同じ扱い。
  const mov = b => !b.isStatic && !b.held && b.invMass > 0;
  const imP = mov(p) ? p.invMass : 0, imC = mov(c) ? c.invMass : 0;
  const iiP = mov(p) && !p.fixedRotation ? p.invInertia : 0;
  const iiC = mov(c) && !c.fixedRotation ? c.invInertia : 0;

  // ① 回転：蓋と器の相対回転は0（蓋は筒の中で回らない）
  const iiSum = iiP + iiC;
  if (iiSum > 0) {
    const dw = p.av - c.av;
    if (dw) { const L = dw / iiSum; p.av -= L * iiP; c.av += L * iiC; }
    const dth = p.angle - c.angle;
    if (dth) { p.angle -= dth * (iiP / iiSum); c.angle += dth * (iiC / iiSum); }
  } else { p.angle = c.angle; p.av = c.av; }

  // ② 横ずれ：蓋の中心は軸の上（回転を直したあとの軸で測る）
  const a = v.axis(), n = { x: -a.y, y: a.x }, ce = v.closedEnd();
  const rx = p.x - c.x, ry = p.y - c.y;          // 器の重心 → 蓋の中心
  const rn = rx * n.y - ry * n.x;                 // 腕 × n
  const kN = imP + imC + iiC * rn * rn;
  if (kN > 0) {
    // 速度：接触点（＝蓋の中心）での相対速度の n 成分を消す
    const ucx = c.vx - c.av * ry, ucy = c.vy + c.av * rx;
    const vn = (p.vx - ucx) * n.x + (p.vy - ucy) * n.y;
    if (vn) {
      const j = -vn / kN, jx = j * n.x, jy = j * n.y;
      p.vx += jx * imP; p.vy += jy * imP;
      c.vx -= jx * imC; c.vy -= jy * imC;
      c.av -= (rx * jy - ry * jx) * iiC;
    }
    // 位置：ずれを同じ重みで分け合う（並進だけ。器の向きは①が決めた値を動かさない）
    //   ★ここを「回転も込みの擬似力積」にしてはいけない（kN で割って器の向きも直す形）。
    //     一見そちらが筋だが、実測では器の回転が 11 倍に増えた（1200 tick で 0.47→7.4 rad/s）。
    const lat = (p.x - ce.x) * n.x + (p.y - ce.y) * n.y;
    if (lat) {
      const s = -lat / (imP + imC || 1);
      p.x += s * n.x * imP; p.y += s * n.y * imP;
      c.x -= s * n.x * imC; c.y -= s * n.y * imC;
    }
  } else if (imP === 0 && imC === 0) { /* 両方止まっている：何もしない */ }

  // ③ 軸方向：閉端を突き抜けない／開口から出ない。定積のときは今の位置に釘付け。
  //    ★定積を「蓋を静的にする」で作るのはやめた。器が動くようになると、静的な蓋は
  //      世界に打った杭になり、容器がそこからぶら下がってしまう。定積は
  //      「蓋を器に固定する」＝この自由度を閉じることなので、ここで閉じる。
  const ch = v.chamber();
  const ce2 = v.closedEnd();
  let d = (p.x - ce2.x) * a.x + (p.y - ce2.y) * a.y;
  let target = null;
  if (ch && ch.pistonLocked) {
    if (v._lockD == null) v._lockD = d;
    target = v._lockD;
  } else {
    v._lockD = null;
    const r = v.travelRange();
    if (d < r.min) target = r.min;
    else if (d > r.max) target = r.max;
  }
  if (target != null) {
    // ★腕はここで取り直す。上の rx,ry は②が位置を直す前の値なので、そのまま使うと
    //   蓋には今いる点に、器には古い点に、逆向きの力積を打つ＝作用と反作用が別の点に
    //   掛かることになり、角運動量が湧く（実測：この段だけで 1200 tick に 2.75e6。
    //   取り直すと 3.2e-9 ＝機械精度まで落ちた）。
    const rx3 = p.x - c.x, ry3 = p.y - c.y;
    const ra = rx3 * a.y - ry3 * a.x;
    const kA = imP + imC + iiC * ra * ra;
    if (kA > 0) {
      const uax = c.vx - c.av * ry3, uay = c.vy + c.av * rx3;
      const va = (p.vx - uax) * a.x + (p.vy - uay) * a.y;
      // 端に当たったぶん（＝めり込む向きの速度）だけ消す。定積なら常に消す。
      const stop = (v._lockD != null) || (target === (v.travelRange()).min ? va < 0 : va > 0);
      if (va && stop) {
        const j = -va / kA, jx = j * a.x, jy = j * a.y;
        p.vx += jx * imP; p.vy += jy * imP;
        c.vx -= jx * imC; c.vy -= jy * imC;
        c.av -= (rx3 * jy - ry3 * jx) * iiC;
      }
      // 位置：残っためり込みを直す。★limitVesselPistons が先読みで止めているので、
      //   ふつうはここが空振りする（実測：加熱して止めに押し付け続けても、この段の
      //   角運動量の出入りは 3.4e-27）。先読みが無かった頃は毎サブステップ 8px を
      //   引き戻していて、それが器を回していた。緩和率で薄めるのは不可
      //   （0.5 にすると漏れは消えるが蓋が上限を 10px 越えて止まる）。
      const err = d - target;
      if (err) {
        const s = -err / (imP + imC || 1);
        p.x += s * a.x * imP; p.y += s * a.y * imP;
        c.x -= s * a.x * imC; c.y -= s * a.y * imC;
      }
    }
  }
  // 両方とも動かせないとき（器が静的で蓋を掴んでいる等）は、蓋を直に置き直す
  if (imP === 0 && imC === 0) {
    const lat = (p.x - ce2.x) * n.x + (p.y - ce2.y) * n.y;
    if (lat) { p.x -= lat * n.x; p.y -= lat * n.y; }
  } else if (imC === 0) {
    // 器が静的なら軸は動かないので、蓋を軸へ完全に乗せてよい（誤差を残さない）
    const lat = (p.x - ce2.x) * n.x + (p.y - ce2.y) * n.y;
    if (lat) { p.x -= lat * n.x; p.y -= lat * n.y; }
    const r = v.travelRange();
    d = (p.x - ce2.x) * a.x + (p.y - ce2.y) * a.y;
    const dc = Math.min(r.max, Math.max(r.min, v._lockD != null ? v._lockD : d));
    p.x = ce2.x + a.x * dc; p.y = ce2.y + a.y * dc;
  }
  p._updateAABB(); c._updateAABB();
}
// ── 行き止まりを先読みして、蓋をめり込ませない（integrate の「前」に呼ぶ）────────
//   ★なぜ要るか。止めに当たったまま気体が押し続けると、1サブステップの積分で蓋が
//     行き止まりを大きく飛び越える（実測：内径1.2m・奥行0.05m・500kPa・5kg の蓋で
//     1サブステップ 8.3px ＝ F/m·dt²）。それを solveVesselConstraint ③ の位置補正が
//     毎回引き戻していたが、**位置を直す操作は角運動量を変える**（速度を持つ質量を
//     動かすので L = Σ m r×v が変わる）。毎サブステップ同じ向きに大きく引き戻すため
//     誤差が一方向に積もり、無重力で浮かせた容器が独りでに回り出していた。
//     実測（無重力・地面なし・加熱して蓋を止めに押し付けたまま 1200 tick）：
//       ・この先読みなし … 器が 5.53 rad（317°）回り、角速度 0.043 rad/s まで育つ
//       ・あり           … 下の★のとおり。位置補正が仕事を失うので注ぎ込みが消える
//     ★段ごとに角運動量の出入りを測って犯人を詰めた。速度の段（①②）は機械精度で
//       保存しており、漏れていたのは位置の段だけだった。③の力積が漏れていたぶんは
//       「腕を取り直す」で別に直してある（下の★）。
//   考え方は speculative contact と同じで、「このサブステップで進める距離」を先に見て、
//   行き止まりを越える分だけ相対速度を削る。突き抜けなければ③の位置補正は空振りになる。
function limitVesselPistons(dt) {
  if (!(dt > 0)) return;
  for (const v of pistonVessels) {
    const c = v.cylinder(), p = v.piston();
    if (!c || !p) continue;
    const mov = b => !b.isStatic && !b.held && b.invMass > 0;
    const imP = mov(p) ? p.invMass : 0, imC = mov(c) ? c.invMass : 0;
    const iiC = mov(c) && !c.fixedRotation ? c.invInertia : 0;
    const a = v.axis(), ce = v.closedEnd();
    const d = (p.x - ce.x) * a.x + (p.y - ce.y) * a.y;
    const ch = v.chamber();
    let lo, hi;
    if (ch && ch.pistonLocked) { const t = v._lockD != null ? v._lockD : d; lo = t; hi = t; }
    else { const r = v.travelRange(); lo = r.min; hi = r.max; }
    const rx = p.x - c.x, ry = p.y - c.y;
    const ra = rx * a.y - ry * a.x;
    const kA = imP + imC + iiC * ra * ra;
    if (!(kA > 0)) continue;
    // 軸方向の相対速度（蓋の中心での、器に対する速さ）
    const uax = c.vx - c.av * ry, uay = c.vy + c.av * rx;
    const va = (p.vx - uax) * a.x + (p.vy - uay) * a.y;
    const vHi = (hi - d) / dt, vLo = (lo - d) / dt;   // 行き止まりにちょうど届く速さ
    let want = null;
    if (va > vHi) want = vHi; else if (va < vLo) want = vLo;
    if (want == null) continue;
    const j = (want - va) / kA, jx = j * a.x, jy = j * a.y;
    p.vx += jx * imP; p.vy += jy * imP;
    c.vx -= jx * imC; c.vy -= jy * imC;
    c.av -= (rx * jy - ry * jx) * iiC;
  }
}
function enforcePistonVessels() {
  for (const v of pistonVessels) {
    if (!v.cylinder() || !v.piston()) continue;
    solveVesselConstraint(v);
    syncPistonVessel(v);      // 気体室の閉端・軸を、直したあとの器から取り直す
  }
}
// ── 容器ごと平行移動する ────────────────────────────────────
//   器・ピストンは別々の Body なので、片方だけ動かすと容器が分解する。
//   ★停止中でも使えるように、ここで両方を直接動かす（enforcePistonVessels は
//     simStep の中でしか走らないので、停止中はレールが誰も追いかけない）。
function movePistonVesselTo(v, wx, wy) {
  const cyl = v.cylinder(), p = v.piston();
  if (!cyl) return;
  const dx = wx - cyl.x, dy = wy - cyl.y;
  if (dx === 0 && dy === 0) return;
  cyl.x = wx; cyl.y = wy; cyl._updateAABB();
  if (p) { p.x += dx; p.y += dy; p._updateAABB(); }
  syncPistonVessel(v);
}
// ── 容器の向きを変える ──────────────────────────────────────
//   ピストンは軸上の同じ位置（閉端からの距離）を保ったまま回る。
function rotatePistonVessel(v, angle) {
  const cyl = v.cylinder(), p = v.piston();
  if (!cyl) return;
  let d = null;
  if (p) { const a = v.axis(), ce = v.closedEnd();
           d = (p.x - ce.x) * a.x + (p.y - ce.y) * a.y; }
  cyl.angle = angle; cyl._invalidateShape(); cyl._updateAABB();
  syncPistonVessel(v);
  if (p && d != null) {
    const a = v.axis(), ce = v.closedEnd();
    p.x = ce.x + a.x * d; p.y = ce.y + a.y * d;
    p.angle = angle; p._updateAABB();
  }
}
// ── 器の寸法を変える ──────────────────────────────────────
//   器の形とピストンの幅は内径から作り直す。気体の物質量 n は据え置き
//   （断面積が変われば P が変わる＝気体を入れ替えたわけではない、という扱い）。
//   ★ピストンの質量はここに無い。蓋は普通の物体なので、質量は物体のパネルの
//     「質量 [kg]」＝ updateProp('mass') が受け持つ。
function vesselGeomUpdate(v, key, val) {
  const cyl = v.cylinder(), p = v.piston(), ch = v.chamber();
  const num = parseFloat(val);
  if (!isFinite(num)) return;
  if (key === 'bore')      v.bore     = Math.max(VESSEL_MIN_BORE, toPx(num));
  else if (key === 'len')  v.innerLen = Math.max(VESSEL_MIN_LEN,  toPx(num));
  // ★壁の厚みは外形だけを変える（内側の寸法・気体室・蓋の可動域は変わらない）
  else if (key === 'wall') v.wall     = Math.max(VESSEL_MIN_WALL, toPx(num));
  else return;
  if (cyl) {
    cyl.verts = _vesselOutline(v.bore, v.innerLen, v.wall);
    const cp = buildConvexParts(cyl.verts, []);
    cyl.convexParts = cp.parts; cyl.partEdgeInternal = cp.internal;
    cyl._invalidateShape(); cyl._updateAABB();
  }
  if (p && key === 'bore') { p.w = Math.max(4, v.bore - 2); p._invalidateShape(); p._updateAABB(); }
  if (ch) ch.width = v.bore;
  syncPistonVessel(v);
  // ピストンが新しい可動域の外へ出ていたら引き戻す（内径・全長を縮めたとき）
  if (p) {
    const a = v.axis(), ce = v.closedEnd(), r = v.travelRange();
    let d = (p.x - ce.x) * a.x + (p.y - ce.y) * a.y;
    d = Math.min(r.max, Math.max(r.min, d));
    p.x = ce.x + a.x * d; p.y = ce.y + a.y * d; p._updateAABB();
  }
}
// ── 手で動かしたときの後始末 ────────────────────────────────
//   ★器・ピストンは「普通の物体」として編集ツールで掴めるが、掴んだあとの意味は
//     部品ごとに違う。器を動かせば容器ごと運ぶ（＝置き場所を変える）、蓋を動かせば
//     軸上を滑る（＝気体の体積を手で決める）。前者は蓋も一緒に運ぶ必要があるので、
//     溶接で繋がった物体を一団として運ぶのと同じ形で、器の連れとして蓋を足す。
function vesselCompanions(bodies) {
  const have = new Set(bodies), out = [];
  for (const b of have) {
    const v = pistonVesselOfBody(b.id);
    if (!v || v.cylinderId !== b.id) continue;    // 蓋を掴んだときは連れを付けない
    const p = v.piston();
    if (p && !have.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}
// 手で動かした（＝編集ツールで運んだ）あとに、容器の拘束を掛け直す。
//   停止中は enforcePistonVessels が走らない（simStep の中だけ）ので、ここで同じことをする。
//   蓋だけを動かしたときは体積が変わるので、気体の状態も作り直す。
function applyVesselManualMove(movedIds) {
  for (const v of pistonVessels) {
    const cyl = v.cylinder(), p = v.piston();
    if (!cyl || !p) continue;
    const movedCyl = movedIds.has(cyl.id), movedPiston = movedIds.has(p.id);
    if (!movedCyl && !movedPiston) continue;
    syncPistonVessel(v);
    p.angle = cyl.angle; p.av = 0; p.vx = 0; p.vy = 0;
    const a = v.axis(), ce = v.closedEnd(), n = { x: -a.y, y: a.x };
    const lat = (p.x - ce.x) * n.x + (p.y - ce.y) * n.y;      // 軸からの横ずれは捨てる
    if (lat !== 0) { p.x -= lat * n.x; p.y -= lat * n.y; }
    const r = v.travelRange();
    let d = (p.x - ce.x) * a.x + (p.y - ce.y) * a.y;
    d = Math.min(r.max, Math.max(r.min, d));
    p.x = ce.x + a.x * d; p.y = ce.y + a.y * d;
    p._updateAABB();
    // 器ごと運んだだけなら閉端との距離は変わらない＝体積も変わらない
    // ★「手で作った体積変化は帳簿に載せない」のは**停止中だけ**。再生中にこれを通すと、
    //   帳簿が片側しか付かなくなる：カーソルが縮めたぶんは _Vprev を捨てるので計上されず、
    //   その直後のティックで気体が閉端を押し返して器が逃げるぶん（＝膨張）だけが計上される。
    //   押し込むほど冷える一方のラチェットになる。
    //   実測（横倒しの容器・器は地面を滑れる／蓋を軸へ60px押し込む）：
    //     通す   … P は 101kPa のまま、T が 293→231K、W が +3200J（縮めたのに正）、
    //              断熱のはずの PV^γ が 1973→1417 と 28% 減る
    //     通さない… PV^γ は 1973 のまま、T は 293K のまま、W≈0（器が逃げるので体積が
    //              そもそも変わらない、という正直な答えになる）
    //   再生中は蓋が held でも applyGasChambers の②が幾何から体積変化を拾うので、
    //   ここで手を出す必要がない。手で押した仕事もそこで正しく計上される。
    if (movedPiston && !movedCyl && !running) gasManualVolumeChange(v.chamber());
  }
}
// ── 停止中に掴んだ蓋を、気体の抵抗で止める ──────────────────────────
//   ★停止中は重力も積分も止まっているので、自由な物体を動かすのに力は要らない。
//     つまり「掴む力の上限」が引っかかるのは、抵抗するものがあるときだけで、気体は
//     その一つ。ロープが停止中も「伸びない拘束」として効き、満たしきれない分を
//     カーソルとのずれ＝手応えとして残すのと同じ扱いにする。
//   再生中は MouseJoint.solve が力積を maxForce でクランプするのでこの式は要らない。
//   停止中の経路（moveTarget → solvePosition）は位置だけを解いていて力を見ないため、
//   気体だけがここに現れていなかった＝力に関係なく押し込めていた。
//
//   T を据え置けば P = nRT/(A·h) なので、到達できる高さは閉じた式で出る：
//     圧縮 （P − 大気圧)·A ≤ Fmax  →  h ≥ nRT / (A·大気圧 + Fmax)
//     引き （大気圧 − P)·A ≤ Fmax  →  h ≤ nRT / (A·大気圧 − Fmax)
//                                      （右辺が 0 以下なら、引く側に制限は無い）
//   押すほど固くなり、上限のところで止まる＝気体ばねの手応えがそのまま出る。
function pistonGrabTravelRange(v, maxForceN) {
  const r = v.travelRange();
  const ch = v.chamber();
  if (!ch || !(ch.n > 0) || !(maxForceN > 0)) return r;
  const A = ch.areaM2();
  if (!(A > 0)) return r;
  const nRT = ch.n * R_GAS * ch.T;
  const half = v.pistonHalf();
  const hToD = hM => hM / PX2M + half;                    // 気体の高さ[m] → 閉端からの距離[px]
  let min = r.min, max = r.max;
  const dPush = hToD(nRT / (A * world.atmPressure + maxForceN));
  if (dPush > min) min = dPush;
  const denom = A * world.atmPressure - maxForceN;
  if (denom > 0) { const dPull = hToD(nRT / denom); if (dPull < max) max = dPull; }
  return { min, max: Math.max(min, max) };
}
// 停止中に掴んでいる蓋を、上の範囲へ閉じ込める。掴んでいる蓋にだけ効かせる
// （編集ツールでの移動は力ではなく配置の操作なので、可動域だけで止める）。
function resistPausedGasGrab() {
  for (const mj of mouseJoints) {
    const b = mj.body;
    if (!b) continue;
    const v = pistonVesselOfBody(b.id);
    if (!v || v.pistonId !== b.id) continue;
    const a = v.axis(), ce = v.closedEnd();
    const g = pistonGrabTravelRange(v, mj.maxForce);
    let d = (b.x - ce.x) * a.x + (b.y - ce.y) * a.y;
    if (d >= g.min && d <= g.max) continue;
    d = d < g.min ? g.min : g.max;
    b.x = ce.x + a.x * d; b.y = ce.y + a.y * d;
    b.vx = 0; b.vy = 0;
    b._updateAABB();
  }
}
// 掴んで動かしたぶんの体積を状態へ反映する（停止中は applyGasChambers が回らないので、
// ここを通さないと押し込んでもパネルの P・V が動かない）。反復の外で一度だけ呼ぶ。
function refreshGrabbedVesselGas() {
  for (const v of pistonVessels) {
    const p = v.piston();
    if (p && p._grabbed) gasManualVolumeChange(v.chamber());
  }
}
// ── 参照と後始末 ────────────────────────────────────────────
function pistonVesselOfBody(id) {
  return pistonVessels.find(v => v.cylinderId === id || v.pistonId === id) || null;
}
// この物体は容器の部品か。'cylinder' ／ 'piston' ／ null を返す
function vesselRoleOf(b) {
  if (!b) return null;
  const v = pistonVesselOfBody(b.id);
  if (!v) return null;
  return v.cylinderId === b.id ? 'cylinder' : 'piston';
}
function pistonVesselOfChamber(id) {
  return pistonVessels.find(v => v.chamberId === id) || null;
}
// 容器ごと消す（器・ピストン・気体は一体なので、ばらばらには消さない）
function deletePistonVessel(v) {
  const i = pistonVessels.indexOf(v);
  if (i >= 0) pistonVessels.splice(i, 1);
  const ch = v.chamber();
  if (ch) {
    const g = (typeof pvGraphOf === 'function') ? pvGraphOf(ch.id) : null;
    if (g && typeof pvGraphClose === 'function') pvGraphClose(g);
    deleteGasChamber(ch);
  }
  for (const id of [v.cylinderId, v.pistonId]) {
    const b = objects.find(o => o.id === id);
    if (!b) continue;
    const k = objects.indexOf(b);
    if (k >= 0) objects.splice(k, 1);
    joints = joints.filter(j => j.bodyA !== b && j.bodyB !== b);
    lasers = lasers.filter(L => L.body !== b);
  }
}
// 部品を個別に消されたら容器も畳む（気体室の pruneGasChambers と同じ考え方）
function prunePistonVessels() {
  for (const v of pistonVessels.slice()) {
    if (!v.cylinder() || !v.piston()) deletePistonVessel(v);
  }
}
function serializePistonVessels() {
  return pistonVessels.map(v => ({
    id: v.id, cylinderId: v.cylinderId, pistonId: v.pistonId, chamberId: v.chamberId,
    bore: v.bore, innerLen: v.innerLen, wall: v.wall, label: v.label,
  }));
}
function deserializePistonVessels(arr) {
  pistonVessels.length = 0;
  if (!Array.isArray(arr)) return;
  for (const d of arr) if (d) pistonVessels.push(new PistonVessel(d));
  for (const v of pistonVessels) syncPistonVessel(v);
}
