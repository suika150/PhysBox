// ════════════════════════════════════════
//  点電荷のつくる場の可視化（電気力線・等電位線）
//   ・電気力線：各電荷から本数を |q| に比例させて出し、E の向きへ追跡する。
//     「線の密度＝場の強さ」という教材の核心が成り立つように、本数は必ず電荷に比例させる。
//   ・等電位線：V = Σ k qᵢ/rᵢ をグリッドで評価し、マーチングスクエアで等高線を引く。
//   どちらも表示専用。力の計算（applyCoulomb / applyEMForces）には一切触らない。
//
//   ★準静的近似について：電荷が動いても、その瞬間のクーロン場をそのまま描く。
//     遅延ポテンシャルや放射は扱わない——高校物理の枠組みそのもので、これで正しい。
//     毎フレーム引き直しても、評価回数はグリッド点×電荷数（既定で十数万回）に過ぎず、
//     波動場（150万セル更新/フレーム）より1桁小さい。
//
//   ★数値は実効値：k は world.coulombK（実効値4000。実際の 8.99e9 ではない）なので、
//     等電位線の値は本物のボルトではない。線の形は正しく、数値は相対的な目安。
// ════════════════════════════════════════
// [m] r→0 の発散止め。★力側の COULOMB_SOFTEN2（64 px² ＝ 8px ＝ 0.08m）と**同じ値**にする。
//   ここがずれると、描いた E に q を掛けた値と実際に働くクーロン力が食い違う
//   （0.06m だったときは r=0.1m で 20% ずれていた）。
//   ★もとの理由は「電場ベクトルと力ベクトルを重ねて F = qE を読ませるから」だったが、
//     電場ベクトルの表示は廃止した。それでも**揃える約束は残る**：電気力線は「その点で
//     ⊕ が受ける力の向き」の地図なので、ずれると**線の向きと、実際に置いた試験電荷が
//     動く向きが食い違う**（電荷のすぐそばほど効く）。片方を変えたら両方変える。
const CHARGE_SOFTEN_M = 0.08;
const FIELDLINE_PER_C = 8;           // 1 C あたりの電気力線の本数
const FIELDLINE_MAX    = 48;         // 1つの電荷から出す本数の上限
const FIELDLINE_STEPS  = 600;        // 1本の追跡ステップ数上限
const EQUIPOT_PX       = 10;         // 等電位線グリッドの間隔 [画面px]
const EQUIPOT_LEVELS   = 7;          // 片側（正・負それぞれ）のレベル数
function chargedBodies() {
  const out = [];
  for (const b of objects) if (b.charge) out.push(b);
  return out;
}
// 電気力線・等電位線を描くときの「場の源」に含める電荷（既定は全員）。
// ★物体ごとに切れるのは「線を引くか」ではなく「**場の源に含めるか**」。
//   電気力線は正から負へ渡る1本を両者が共有しているので、「引く／引かない」を物体ごとに
//   独立させると同じ線を2回描くことになり、線の密度＝場の強さ、という関係が壊れる
//   （_fieldLineSeeds の★を参照）。源の集合に対して同じ規則を当てれば矛盾は出ず、
//   負電荷だけを源にしても「無限遠から入ってくる線」として内向きの放射状が正しく出る。
// ★これは**表示だけ**の選択。力の計算（circuit.js の applyCoulomb）はいつも全電荷で行う。
//   源を1個に絞った絵は、そのぶんの場 E に相手の電荷 q を掛けたものが実際に働く力に
//   一致する（クーロン力は対ごとの和なので）＝教科書の「試験電荷」の図と食い違わない。
function fieldSourceBodies() {
  const out = [];
  for (const b of objects) if (b.charge && b.fieldSource !== false) out.push(b);
  return out;
}
// 源から外されている電荷の数（絞っていることを画面に出すため）
function fieldSourceExcludedCount() {
  let n = 0;
  for (const b of objects) if (b.charge && b.fieldSource === false) n++;
  return n;
}
function coulombKEff() { return world.coulombK * world.emForceScale; }
// 物体の代表半径（電気力線の出発点・終端判定に使う）
function _chargeRadius(b) {
  if (b.type === 'circle') return b.radius;
  const a = b._aabb;
  if (!a) return 12;
  return Math.max(6, Math.max(a.maxX - a.minX, a.maxY - a.minY) / 2);
}
// 点電荷が (x,y) につくる電場 [V/m 相当]。exclude はその電荷自身を除くため
function chargeEAt(x, y, list, exclude) {
  let ex = 0, ey = 0;
  const k = coulombKEff(), s2 = CHARGE_SOFTEN_M * CHARGE_SOFTEN_M;
  for (const b of list) {
    if (b === exclude) continue;
    const dx = (x - b.x) * PX2M, dy = (y - b.y) * PX2M;      // [m]
    const r2 = dx*dx + dy*dy + s2;
    const inv = 1 / Math.sqrt(r2);
    const e = k * b.charge / r2;                              // 正電荷なら外向き
    ex += e * dx * inv; ey += e * dy * inv;
  }
  return { ex, ey };
}
// 表示に使う「その点の電場の合計」＝置いた領域の場 ＋ 点電荷の場。
//   これを1か所に集約しないと、電気力線が領域電場と矛盾した絵になる。
function totalEAt(x, y, list) {
  const f = emFieldAt(x, y);
  const c = chargeEAt(x, y, list || fieldSourceBodies(), null);
  return { ex: f.ex + c.ex, ey: f.ey + c.ey };
}
// 点電荷による電位 [V 相当]。領域の一様場は含めない——箱の中だけ一様な場は
// 境界で保存力にならないので、電位が大域的に定義できない（意図的な制限）。
function chargeVAt(x, y, list) {
  let v = 0;
  const k = coulombKEff(), s2 = CHARGE_SOFTEN_M * CHARGE_SOFTEN_M;
  for (const b of list) {
    const dx = (x - b.x) * PX2M, dy = (y - b.y) * PX2M;
    v += k * b.charge / Math.sqrt(dx*dx + dy*dy + s2);
  }
  return v;
}
// ─── 電気力線 ───────────────────────────────
// ★どこから何本出すか（ここが電気力線の正しさの核心）
//   電気力線は正電荷から出て負電荷に入る「1本の線」を両者が共有している。
//   だから両端から引いてはいけない——つながる線が二重に描かれ、負電荷の周りの
//   線密度が「自前の本数＋正から到達した本数」になって、
//   「線の密度＝場の強さ」という関係が壊れる。
//   正しい規則：
//     ・正電荷から |q| に比例した本数を順方向（+E）へ引く。負電荷に入るか画面外へ出る
//     ・負電荷からは引かない。ただし「その負電荷に入るべき本数（8|q| 本）」に順方向の線が
//       届かなかったぶん＝「無限遠から入ってくる線」だけを逆方向へ引く
//       （負電荷しか無い場合もこれで説明できる）
//   例：+1C と −1C → 正から8本だけ。それが全部負に入る（負側の密度も 8本/C で整合）
//       +1C と −2C → 正から8本＋無限遠から8本＝負には16本入る（= 2C × 8本/C）
//
// ★不足分の本数は**総量の引き算ではなく、実際に届いた本数を数えて**決める（_gapAngles と
//   2パス構成）。もとは deficit = Qn − Qp を電荷の大きさで割り振っていたが、それだと
//   「どこへ入るか」まではそろっているのに「**どの角度から入るか**」が決まらない。
//   逆方向の線を負電荷のまわりに等角度でばらまくと、順方向から届いた線とぶつかって、
//   ほとんど重なる2本と大きな空きが交互にできる。線の間隔がそのまま場の強さを表すはずの
//   図で、これは絵が嘘をついていることになる。
//   ★正しい理由：点電荷のすぐ近くでは自分の場が支配して等方的なので、負電荷に入る線は
//     近傍で**等角度に並ぶ**のが正しい。だから順方向の線が実際に入ってきた角度を控え、
//     残りの本数はその隙間へ均等に配る（大きい隙間から順に割る）。
//   ★実測（+1.44C と −2.55C。負電荷のまわりの 20本について、隣り合う線の角度の間隔）：
//       旧（逆方向を全周へ等角度）：2.5°〜40.0°（最小と最大が 16倍）
//       新（隙間へ配る）          ：11.3°〜21.8°（等分なら 18°）
//     本数の内訳も変わる：順方向 12本のうち 11本が負電荷に到達し、残りの 9本を隙間へ配って
//     合わせて 20本 ＝ 2.55C × 8本/C。旧は総量の引き算で 9本と決めていたので本数は
//     同じだが、置く角度を決める手がかりが無かった。
//   ★数え方にしたのでもう一つ直る：画面の外へ逃げた順方向の線も「届かなかった」と数える。
//     +1C と −1C では 8本のうち 3本が枠の外へ出ており、旧はその 3本ぶん負電荷のまわりが
//     すかすか（5本）だった。新は無限遠から入る 3本で埋めて 8本になる。
function _gapAngles(taken, n, base) {
  if (n <= 0) return [];
  const TAU = Math.PI * 2;
  if (!taken.length) {                       // 誰も入ってきていない（負電荷だけの世界）
    const out = [];
    for (let i = 0; i < n; i++) out.push((base || 0) + (i / n) * TAU);   // ★起点は _seedBaseAngle の★
    return out;
  }
  const a = taken.slice().sort((p, q) => p - q);
  const gaps = [];
  for (let i = 0; i < a.length; i++) {
    const e = (i + 1 < a.length) ? a[i+1] : a[0] + TAU;
    gaps.push({ s: a[i], w: e - a[i], m: 0 });
  }
  // いちばん広く空いている隙間から1本ずつ割り当てる（隙間は m 本入れると w/(m+1) に割れる）
  for (let t = 0; t < n; t++) {
    let best = 0;
    for (let i = 1; i < gaps.length; i++)
      if (gaps[i].w / (gaps[i].m + 1) > gaps[best].w / (gaps[best].m + 1)) best = i;
    gaps[best].m++;
  }
  const out = [];
  for (const g of gaps) for (let i = 1; i <= g.m; i++) out.push(g.s + g.w * i / (g.m + 1));
  return out;
}
// 線を出す角度の起点。★**ほかの電荷と領域がその電荷の位置につくる場の向き**にそろえる。
//   以前はどの電荷も角度 0（右）から等分していたので、左右対称に置いた同符号の2球でも線の組が
//   鏡像にならなかった：左の球は右（相手の側）へ1本出して中性点で終わるのに、右の球には左へ
//   向かう線が無く、2球のあいだの線が「途中で切れている」ように見えた（帯電した小球のつりあい。
//   ユーザーの指摘）。外の場の向きを起点にすると、対称な配置では線の組も対称になる
//   （外の場の向きの軸について等分が左右対称になるため）。外の場が無い（電荷が1つだけ）ときは
//   従来どおり 0。
function _seedBaseAngle(src, list) {
  const f = emFieldAt(src.x, src.y), c = chargeEAt(src.x, src.y, list, src);
  const ex = f.ex + c.ex, ey = f.ey + c.ey;
  return (Math.hypot(ex, ey) > 1e-9) ? Math.atan2(ey, ex) : 0;
}
// その電荷に入る（出る）線の本数。★|q| に比例させるのが「線の密度＝場の強さ」の土台
function _fieldLineCount(b) {
  return Math.min(FIELDLINE_MAX, Math.round(Math.abs(b.charge) * FIELDLINE_PER_C));
}
function drawFieldLines() {
  if (!world.showFieldLines) return;
  const list = fieldSourceBodies();
  if (!list.length) return;
  const stepW = 6 / cam.zoom;                       // 追跡の刻み（画面上で一定に見えるように）
  // ★見えている範囲は visibleWorldBounds で取る。画面の2隅を screenToWorld に通して
  //   箱にしていたが、カメラを回すとその2点は箱の対角にならず、範囲が本来より狭くなって
  //   見えているところで力線が途切れる（4隅の外接箱を取れば、どの角度でも必ず覆える）。
  const vb = visibleWorldBounds();
  const mx = canvas.width * 0.25 / cam.zoom, my = canvas.height * 0.25 / cam.zoom;
  const minX = vb.x0 - mx, maxX = vb.x1 + mx, minY = vb.y0 - my, maxY = vb.y1 + my;
  const inside = (x, y) => x > minX && x < maxX && y > minY && y < maxY;
  ctx.save();
  ctx.lineWidth = 1.1;
  ctx.lineJoin = 'round';
  // 線の色は1色。順方向に引いた線も逆方向に引いた線も同じ「電気力線」であり、
  // 色で区別すると別物のように見えてしまう。向きは矢羽で示す。
  ctx.strokeStyle = 'rgba(255,213,79,0.75)';
  // ── ① 順方向：正電荷から 8|q| 本。どこへ入ったかを控える ──
  const arrived = new Map();                   // 負電荷 → 入ってきた角度の配列
  for (const b of list) if (b.charge < 0) arrived.set(b, []);
  for (const src of list) {
    if (!(src.charge > 0)) continue;
    const n = _fieldLineCount(src), a0 = _seedBaseAngle(src, list);
    for (let i = 0; i < n; i++) {
      const hit = _traceFieldLine(src, 1, a0 + (i / n) * Math.PI * 2, list, inside, stepW);
      if (hit && arrived.has(hit.body)) arrived.get(hit.body).push(hit.angle);
    }
  }
  // ── ② 逆方向：足りないぶんだけ、順方向が空けた隙間から無限遠へ向けて引く ──
  for (const [b, taken] of arrived) {
    for (const a of _gapAngles(taken, _fieldLineCount(b) - taken.length, _seedBaseAngle(b, list) + Math.PI))
      _traceFieldLine(b, -1, a, list, inside, stepW);
  }
  ctx.restore();
}
// 中性点（E = 0 の点）の位置を詰める。(x,y) から向き (dx,dy) へ span 進むあいだに
//   E の向きが裏返っていることが分かっている＝進む向きへの射影が + から − へ変わるので、
//   その根を二分で挟む。★|E| の最小を探すのではなく**符号の根**を探す：最小値探しは
//   区間が根を挟んでいないと端に張り付くが、二分は挟まっていることが前提から保証される。
//   ★20 回で区間は 100 万分の1（半歩 4.8px なら 5e-6 px）。1本につき1回しか通らないので、
//     場の評価が 20 回増えるだけ（1本の追跡はもともと数百回）。
function _refineNull(x, y, dx, dy, span, sign, list) {
  let lo = 0, hi = span;                   // h(lo) > 0、h(hi) < 0
  const h = t => {
    const e = totalEAt(x + dx*t, y + dy*t, list);
    return sign * (e.ex*dx + e.ey*dy);
  };
  for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (h(m) > 0) lo = m; else hi = m; }
  const t = (lo + hi) / 2;
  return { x: x + dx * t, y: y + dy * t };
}
// 力線を1本、src のまわりの角度 a0 から追跡して描く。sign=+1 で E の向き、−1 で逆向き。
// 戻り値は「どの電荷に入って終わったか」と、その電荷から見た入射角（入らなければ null）。
function _traceFieldLine(src, sign, a0, list, inside, stepW) {
  const r0 = _chargeRadius(src) + 3;
  let x = src.x + Math.cos(a0) * r0, y = src.y + Math.sin(a0) * r0;
  ctx.beginPath();
  let p = worldToScreen(x, y);
  ctx.moveTo(p.x, p.y);
  let arrowAt = 24, hit = null, nullAt = null;
  let regKey = _eRegionKey(x, y);          // ★いま居る「電場の領域」の並び（境界を跨いだかの判定用）
  for (let s = 0; s < FIELDLINE_STEPS; s++) {
    // 中点法（RK2）。曲率の大きいところでも折れ線に見えないようにする
    const e1 = totalEAt(x, y, list);
    let m1 = Math.hypot(e1.ex, e1.ey);
    if (!(m1 > 1e-9)) break;
    const dx = sign * e1.ex/m1, dy = sign * e1.ey/m1;       // いま居る点で進む向き
    const hx = x + dx * stepW * 0.5, hy = y + dy * stepW * 0.5;
    const e2 = totalEAt(hx, hy, list);
    let m2 = Math.hypot(e2.ex, e2.ey);
    if (!(m2 > 1e-9)) break;
    const ux = sign * e2.ex/m2, uy = sign * e2.ey/m2;
    // ★中性点（E = 0 の点）に着いたら、そこで線を終える。
    //   同符号の2電荷のあいだにできる点で、力線は**そこで正しく終わる**（続く先が無い）。
    //   検出は「**半歩先で E が裏返っているか**」。場が連続なところで半歩のあいだに向きが
    //   裏返るのは、その間に E = 0 の点があるときだけ。しかも裏返っていること自体が
    //   「根が [0, 半歩] に挟まっている」ことなので、_refineNull の二分がそのまま使える。
    //   ★1歩ぶん進んだ前後で比べる形にしてはいけない。中点法の1歩は半歩先の向きで進むので、
    //     中性点をまたぐ歩では元来た方へ戻ることがあり、そのとき最後の1歩は中性点を挟まない。
    //     挟まない区間を詰めても端に張り付く。実測（1歩で比べていたとき）：
    //       +3C と +3C     → 丸が 1.742m と 1.658m の2つ（中性点は 1.700m。両側 1.4歩）
    //       +3C と +0.36C  → 丸が 2.516m（中性点は 2.529m。手前側に外した）
    //     半歩で比べるいまは、順に 1.700m と 1.700m（重なって1つに見える）・2.529m。
    //   ★領域の境界でも E は裏返るが、あれは不連続なので中性点ではない（下の regKey の★）。
    //     半歩先が別の領域なら中性点とは見ない。
    //   ★入れる前は上限の 600 歩を使い切るまで中性点をまたいで往復し、同じ短い線分を
    //     何百回も描き直していた。実測（+3C と +0.36C。歩数は 1本あたりの lineTo 数で、
    //     24 歩ごとの矢羽が 2 ずつ乗る）：軸上の1本が 650 → 161、全 27 本の合計 3808 → 3182。
    //   ★行き止まりには小さな丸を置く。何も置かないと線が宙で切れているようにしか
    //     見えず、実際「途中で消滅する」と読まれた。
    if (dx * ux + dy * uy < 0 && _eRegionKey(hx, hy) === regKey) {
      const q = _refineNull(x, y, dx, dy, stepW * 0.5, sign, list);
      p = worldToScreen(q.x, q.y);
      ctx.lineTo(p.x, p.y);
      nullAt = p;
      break;
    }
    x += ux * stepW; y += uy * stepW;
    if (!inside(x, y)) break;
    p = worldToScreen(x, y);
    ctx.lineTo(p.x, p.y);
    // ★「電場の領域」の境界をまたいだら、そこで向きが反転していないか見る。
    //   領域は箱の中だけ場を持つので、境界で E が不連続に飛ぶ。内と外で向きが逆に
    //   なる場所では、線が出た直後に押し戻されて境界に貼り付き、細かい往復を
    //   描いてしまう（見た目がギザギザのノイズになる）。
    //   不連続な場は「境界に面電荷がある」ことと同じで、力線はそこで生まれ／終わるのが
    //   正しい扱いなので、反転していたら線を打ち切る。
    //   ★場の評価が増えるのは境界をまたいだステップだけ（1本あたり数回）。
    const key2 = _eRegionKey(x, y);
    if (key2 !== regKey) {
      regKey = key2;
      const e3 = totalEAt(x, y, list);
      const m3 = Math.hypot(e3.ex, e3.ey);
      if (!(m3 > 1e-9)) break;
      if ((sign * e3.ex / m3) * ux + (sign * e3.ey / m3) * uy < 0) break;
    }
    if (--arrowAt <= 0) {                        // 向きが分かるように矢羽を置く
      arrowAt = 24;
      // ★矢羽は必ず「電場の向き」を指す。逆方向に追跡している線（無限遠から
      //   負電荷へ入る線）は進行方向が −E なので、sign を掛けて戻す
      _fieldArrow(p, sign * ux, sign * uy);
    }
    // 別の電荷に入ったら終端（負電荷へ吸い込まれる絵になる）
    for (const b of list) {
      if (b === src) continue;
      const rb = _chargeRadius(b);
      if ((x-b.x)*(x-b.x) + (y-b.y)*(y-b.y) < rb*rb) {
        hit = { body: b, angle: Math.atan2(y - b.y, x - b.x) };
        break;
      }
    }
    if (hit) break;
  }
  ctx.stroke();
  if (nullAt) {                       // 中性点の目印（線と同じ色の小さな丸）
    ctx.beginPath();
    ctx.arc(nullAt.x, nullAt.y, 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  return hit;
}
// その点を含んでいる「電場の領域」の並び。★力線を追跡している途中で境界を跨いだかを
//   見分けるために使う。磁場の領域は電場に効かないので数えない。
function _eRegionKey(x, y) {
  let k = '';
  for (const f of emFields) if (f.kind === 'E' && f.contains(x, y)) k += f.id + ',';
  return k;
}
function _fieldArrow(p, ux, uy) {
  const c = Math.cos(2.6), s = Math.sin(2.6), L = 5;
  ctx.moveTo(p.x + (ux*c - uy*s) * L, p.y + (ux*s + uy*c) * L);
  ctx.lineTo(p.x, p.y);
  ctx.moveTo(p.x + (ux*c + uy*s) * L, p.y + (-ux*s + uy*c) * L);
  ctx.lineTo(p.x, p.y);
  ctx.moveTo(p.x, p.y);
}
// ─── 等電位線（マーチングスクエア）───────────────────
let _eqGrid = null, _eqW = 0, _eqH = 0;
function drawEquipotential() {
  if (!world.showEquipotential) return;
  // ★力線と同じ集合で描く。片方だけ絞ると、直交するという関係が絵の上で成り立たなくなる
  const list = fieldSourceBodies();
  if (!list.length) return;
  const nx = Math.ceil(canvas.width / EQUIPOT_PX) + 1;
  const ny = Math.ceil(canvas.height / EQUIPOT_PX) + 1;
  if (!_eqGrid || _eqW !== nx || _eqH !== ny) { _eqGrid = new Float64Array(nx * ny); _eqW = nx; _eqH = ny; }
  const V = _eqGrid;
  // 電荷のすぐ近く（V が発散する領域）はレベル決めの基準から外す
  const skip2 = [];
  for (const b of list) { const rb = _chargeRadius(b) * 1.6; skip2.push({ x: b.x, y: b.y, r2: rb * rb }); }
  // ① 電位をグリッドで評価しつつ、② レベルの基準となる最大値も同じパスで取る。
  //    等間隔のレベルだと電荷の近くだけ真っ黒になり遠方には1本も出ない（V が桁で変わる）
  //    ので、基準値から等比（1/2ずつ）でレベルを作る。
  let vmax = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const w = screenToWorld(i * EQUIPOT_PX, j * EQUIPOT_PX);
      const v = chargeVAt(w.x, w.y, list);
      V[j*nx + i] = v;
      let near = false;
      for (const s of skip2) if ((w.x-s.x)*(w.x-s.x) + (w.y-s.y)*(w.y-s.y) < s.r2) { near = true; break; }
      if (!near) { const a = v < 0 ? -v : v; if (a > vmax) vmax = a; }
    }
  }
  if (!(vmax > 0)) return;
  const levels = [];
  for (let n = 0; n < EQUIPOT_LEVELS; n++) {
    const v = vmax / Math.pow(2, n);
    levels.push(v); levels.push(-v);
  }
  // ③ マーチングスクエアで等高線を引く
  ctx.save();
  ctx.lineWidth = 1;
  for (const L of levels) {
    ctx.strokeStyle = L > 0 ? 'rgba(255,138,128,0.45)' : 'rgba(129,212,250,0.45)';
    ctx.beginPath();
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k0 = j*nx + i;
        const v0 = V[k0], v1 = V[k0+1], v2 = V[k0+nx+1], v3 = V[k0+nx];
        let lo = v0, hi = v0;
        if (v1 < lo) lo = v1; else if (v1 > hi) hi = v1;
        if (v2 < lo) lo = v2; else if (v2 > hi) hi = v2;
        if (v3 < lo) lo = v3; else if (v3 > hi) hi = v3;
        if (L < lo || L > hi) continue;                 // このセルは関係なし（大半がここで抜ける）
        const x0 = i * EQUIPOT_PX, y0 = j * EQUIPOT_PX, S = EQUIPOT_PX;
        const pts = [];
        if ((v0 < L) !== (v1 < L)) pts.push({ x: x0 + S*(L-v0)/(v1-v0), y: y0 });
        if ((v1 < L) !== (v2 < L)) pts.push({ x: x0 + S, y: y0 + S*(L-v1)/(v2-v1) });
        if ((v3 < L) !== (v2 < L)) pts.push({ x: x0 + S*(L-v3)/(v2-v3), y: y0 + S });
        if ((v0 < L) !== (v3 < L)) pts.push({ x: x0, y: y0 + S*(L-v0)/(v3-v0) });
        if (pts.length === 2) { ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); }
        else if (pts.length === 4) {                    // 鞍点は両方引く（表示なので厳密な分岐は不要）
          ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y);
          ctx.moveTo(pts[2].x, pts[2].y); ctx.lineTo(pts[3].x, pts[3].y);
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}
