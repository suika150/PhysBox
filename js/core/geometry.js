function ellipseVerts(rx, ry, n = ELLIPSE_SEGMENTS) {
  const v = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; v.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry }); }
  return v;
}
// ─── 配置ツール用スナップ ───
//Shift: 角度を 30°系・45°系の複合刻み（0,30,45,60,90…）へ
function snapPlacementAngle(a) {
  const c30 = Math.round(a / (Math.PI/6)) * (Math.PI/6);
  const c45 = Math.round(a / (Math.PI/4)) * (Math.PI/4);
  return Math.abs(a - c30) <= Math.abs(a - c45) ? c30 : c45;
}
// 速度ツール：掴み点startから現在curへドラッグ→逆向きに発射する速度を計算
// いま「狙う」方式か＝Alt を押しているか（設定は持たない。押している間だけの一時モード）。
//   ★Alt にしてあるのは、速度ツールで Ctrl はすでに「選択の追加／解除」だから。
//     Ctrl+クリックはドラッグを始めずに選択だけを変える仕様なので、ここへ重ねられない。
//     Shift も角度スナップで埋まっている。
//   引数なしのとき（プレビュー）は、キーを押しっぱなしの状態を追う modAlt を見る。
function velocityAimNow(alt) {
  return alt === undefined ? modAlt : !!alt;
}
// aim: false＝引っぱる（引いた向きの逆へ飛ぶ）／true＝狙う（カーソルの向きへ飛ぶ）
//   速さはどちらも「掴んだ点からカーソルまでの距離」で決まる。変わるのは向きだけなので、
//   同じ距離なら同じ速さになり、方式を切り替えても目盛りの感覚が変わらない。
function computeLaunchVelocity(start, cur, shift, aim) {
  const s = aim ? -1 : 1;
  const fx = (start.x - cur.x) * s, fy = (start.y - cur.y) * s;   // 引っぱる＝逆ベクトルが発射方向
  const dist = Math.hypot(fx, fy);
  if (dist < 1e-6) return { vx: 0, vy: 0, speed: 0, dispDeg: 0 };
  let ang = Math.atan2(fy, fx);                        // world角（y下向き）
  if (shift) ang = snapPlacementAngle(ang);
  const speed = dist * VEL_SCALE;                       // [m/s]（表示用）
  const vx = Math.cos(ang) * speed * M2PX;              // [px/s]（内部）
  const vy = Math.sin(ang) * speed * M2PX;
  let deg = -ang * 180 / Math.PI;                      // 表示：右向き0°・上向き正
  deg = ((deg + 180) % 360 + 360) % 360 - 180;         // -180〜180に正規化
  return { vx, vy, speed, dispDeg: deg };
}
function angleSnappedPoint(from, to) {   // from→to の距離を保ったまま角度だけスナップ
  const dx = to.x - from.x, dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return { x: to.x, y: to.y };
  const a = snapPlacementAngle(Math.atan2(dy, dx));
  return { x: from.x + Math.cos(a)*d, y: from.y + Math.sin(a)*d };
}
// ドラッグ始点・終点から図形記述子を生成（プレビューと確定で共用）
function buildDragShape(tool, start, cur, shift) {
  if (tool === 'circle') {
    let rx = Math.max(5, Math.abs(cur.x - start.x)), ry = Math.max(5, Math.abs(cur.y - start.y));
    if (shift) { const r = Math.max(rx, ry); rx = ry = r; }
    const cx = start.x, cy = start.y;                    // 始点=中心=重心（始点が既にスナップ済み）
    return shift
      ? { type: 'circle', x: cx, y: cy, radius: rx }     // Shift=正円は従来の効率的な circle 型
      : { type: 'polygon', x: cx, y: cy, verts: ellipseVerts(rx, ry) };  // 楕円は多角形近似
  }
  if (tool === 'box') {
    let w = Math.max(10, Math.abs(cur.x - start.x)), h = Math.max(10, Math.abs(cur.y - start.y));
    if (shift) { const s = Math.max(w, h); w = s; h = s; }
    const sx = Math.sign(cur.x - start.x) || 1, sy = Math.sign(cur.y - start.y) || 1;
    const cx = start.x + sx * w / 2, cy = start.y + sy * h / 2;   // 4隅は格子線上に乗る
    return { type: 'box', x: cx, y: cy, w, h };
  }
  if (tool === 'triangle') {
    let w = Math.max(10, Math.abs(cur.x - start.x)), h = Math.max(10, Math.abs(cur.y - start.y));
    if (shift) { const s = Math.max(w, h); w = s; h = s; }   // 正方形を対角2分＝直角二等辺
    const sx = Math.sign(cur.x - start.x) || 1, sy = Math.sign(cur.y - start.y) || 1;
    const p0 = { x: start.x, y: start.y };                   // 直角の頂点（始点）
    const p1 = { x: start.x + sx * w, y: start.y };          // x方向の脚
    const p2 = { x: start.x, y: start.y + sy * h };          // y方向の脚
    const cenX = (p0.x + p1.x + p2.x) / 3, cenY = (p0.y + p1.y + p2.y) / 3;
    const verts = [p0, p1, p2].map(p => ({ x: p.x - cenX, y: p.y - cenY }));  // 重心基準で格納
    return { type: 'polygon', x: cenX, y: cenY, verts };     // 3頂点が格子線上に乗る
  }
  if (tool === 'gear') {
    // 始点＝中心、ドラッグの長さ＝基準円の半径。歯数はモジュールで割って丸める。
    // 同じモジュールの歯車に重ねて描いたら、かみ合う中心と角度へ吸着する（gear.js）
    const m = gearModule;
    const r = Math.hypot(cur.x - start.x, cur.y - start.y);
    const z = Math.max(GEAR_MIN_Z, Math.min(GEAR_MAX_Z, Math.round(2 * r / m)));
    const mesh = gearMeshPose(start.x, start.y, z, m, null);
    return { type: 'polygon', x: mesh ? mesh.x : start.x, y: mesh ? mesh.y : start.y,
             angle: mesh ? mesh.angle : 0, verts: gearOutline(z, m), gear: { z, m }, meshWith: mesh ? mesh.with : null };
  }
  return null;
}
// ─── Current Draw Properties ─────────
let drawProps = {
  fillColor: '#4fc3f7', strokeColor: '#ffffff',
  strokeWidth: 1.5, alpha: 1,
  density: 600,                                     // ★ mass → density [kg/m³]
  restitution: 0.4, friction: 0.5, frictionStatic: 0.6, drag: 0,   // drag = 抗力係数 Cd
  heatCap: 1000,                                    // ★比熱 c [J/(kg·K)]（0＝熱を持たない）
  conduct: 1.0,                                     // ★熱伝導率 k [W/(m·K)]（0＝完全な断熱材）
  abbe: ABBE_DEFAULT, dispersion: false,            // ★アッベ数 V_d と分散のON/OFF（既定は分散なし）
  isStatic: false,
  layers: LAYER_DEFAULT,                            // ★次に描く物体の衝突レイヤー
};
// ─── Palette ─────────────────────────
const PALETTE = [
  '#ef5350','#ec407a','#ab47bc','#7e57c2','#42a5f5','#29b6f6','#26c6da',
  '#26a69a','#66bb6a','#d4e157','#ffca28','#ffa726','#ff7043','#8d6e63',
  '#bdbdbd','#78909c','#ffffff','#000000',
];
// heatCap = 比熱 c [J/(kg·K)]、conduct = 熱伝導率 k [W/(m·K)]。どちらも実測値に近い値を入れてある。
// 金属とダイヤはよく熱を通し、スポンジと木材はほとんど通さない＝触れば体感どおりに振る舞う。
const MATERIALS = {
  'ゴム':    { density: 1100, restitution: 0.9,  friction: 0.8,  frictionStatic: 1.0,  fillColor: '#cc2200', heatCap: 1500, conduct: 0.16 },
  '木材':    { density: 600,  restitution: 0.2,  friction: 0.6,  frictionStatic: 0.7,  fillColor: '#a0522d', heatCap: 1700, conduct: 0.15 },
  '金属':    { density: 7800, restitution: 0.1,  friction: 0.4,  frictionStatic: 0.55, fillColor: '#90a4ae', heatCap: 450,  conduct: 50 },
  'スポンジ':{ density: 100,  restitution: 0.5,  friction: 0.9,  frictionStatic: 1.0,  fillColor: '#ffe082', heatCap: 1500, conduct: 0.04 },
  '氷':      { density: 917,  restitution: 0.1,  friction: 0.02, frictionStatic: 0.05, fillColor: '#b3e5fc', heatCap: 2100, conduct: 2.2 },
  '水':      { density: 1000, restitution: 0.0,  friction: 0.05, fillColor: 'rgba(120,200,255,0.35)', ior: 1.333, abbe: 55.7, dispersion: true, heatCap: 4182, conduct: 0.6 },  // 水滴＝虹（n=1.333・V=55.7）
  '石':      { density: 2700, restitution: 0.05, friction: 0.7,  frictionStatic: 0.85, fillColor: '#9e9e9e', heatCap: 840,  conduct: 2.0 },
  'ガラス':  { density: 2500, restitution: 0.05, friction: 0.2, fillColor: 'rgba(178,235,242,0.5)', ior: 1.52, abbe: 64, dispersion: true, heatCap: 750, conduct: 1.0 },  // クラウン（低分散）
  'フリント':{ density: 3600, restitution: 0.05, friction: 0.2, fillColor: 'rgba(200,222,245,0.5)', ior: 1.62, abbe: 36, dispersion: true, heatCap: 500, conduct: 0.8 },  // 高分散＝虹がよく開く
  'ダイヤ':  { density: 3500, restitution: 0.10, friction: 0.1, fillColor: 'rgba(225,245,255,0.55)', ior: 2.42, abbe: 55, dispersion: true, heatCap: 510, conduct: 1000 },  // 熱伝導は実在の物質で最高
  '超弾性':  { density: 300,  restitution: 1.0,  friction: 0.1,  fillColor: '#f06292', heatCap: 1500, conduct: 0.16 },  // e>1 は非物理なので 1.0 に
};

function combineRestitution(a, b) { return a * b; }
function combineFriction(a, b)    { return a * b; }
// 静止摩擦と動摩擦の切り替え。
//   ★「その接触がすべっているか」で決める＝教科書の定義そのもの。すべっていなければ
//     上限は μs·N、すべっていれば μk·N。判定に使うのはサブステップ開始時のすべり速度で、
//     反復の途中の値は見ない（途中の値はソルバが打ち消しかけている最中の量なので、
//     見ると「止められたから静止摩擦、静止摩擦だから止められる」の堂々巡りになる）。
//   ★以前は「その接触点が要求する接線力積 ÷ その点の垂直力積」で選んでいた。接触点が
//     1つならこれで正しく μs·N が上限になるが、2つあると成り立たない：Gauss-Seidel の
//     1点目が物体全体の接線速度をひとりで打ち消そうとするので、その点だけ比が倍になって
//     μk へ落ちる。結果、実効の上限が (μs+μk)/2·N まで下がっていた。
//     実測（2kg の物体・μs=0.5・μk=0.3・substeps=16、落ち着かせてから 300tick）：
//       円（接触1点）… 9.7 N で静止・9.9 N ですべる（理論 μs·N = 9.81 N と一致）
//       箱（接触2点）… 8.5 N で静止・9.0 N ですべる（(μs+μk)/2·N = 7.84 の側）
//       斜面のブロック … すべり出す角度が 24〜25°（理論 arctan 0.5 = 26.57°）
//     μs = μk のときだけ両者は一致する。既存のデモはたまたま全部その値で組まれていた
//     ので表に出ていなかった（摩擦のデモを作って初めて分かった）。
//     すべり速度で決めれば、この偏りは接触点の数によらず消える。
//   ★しきい値 5 px/s ＝ 0.05 m/s。サブステップ1回のあいだに外力が生む速度
//     （動力 10 N・2 kg・刻み16 で 0.24 px/s）よりずっと大きく、本当にすべっている
//     物体の速さ（数百 px/s）よりずっと小さい。この間にあれば取り違えは起きない。
const FRICTION_SLIP_V = 5;      // [px/s] これ以下のすべり速度は「止まっている」とみなす
function frictionCoef(A, B, slipV) {
  return Math.abs(slipV) <= FRICTION_SLIP_V
       ? combineFriction(A.frictionStatic, B.frictionStatic)
       : combineFriction(A.friction, B.friction);
}
const clamp01 = v => Math.max(0, Math.min(1, (typeof v === 'number' ? v : parseFloat(v)) || 0));
// ════════════════════════════════════════
//  接触ソルバの共通部（物体どうしの衝突と地面で共有する）
//
//  ★旧方式の欠陥
//    「接触点ごとに、その時点の接近速度へ反発係数を掛けた力積を、毎反復ゼロから
//      打ち直す」方式だった。これは次の2つの理由で物理を壊す。
//    (a) 解く順序が答えを変える。平らに落ちた長方形は左右の角が別々の接触点になり、
//        先に解いた側の力積が物体を回すので、あとに解く側の接近速度が変わる。
//        長方形では w²/I > 1/m（＝高さ < √2×幅）なので接近速度は必ず「増え」、
//        あとの角の力積のほうが大きくなる。接触点は必ず接線座標の昇順＝左から
//        解かれるので、物体は必ず同じ向きに回り、その回転で下の角が同じ向きに
//        滑るため摩擦も必ず同じ向き＝必ず右へ跳ねていた。
//    (b) その「増えた」接近速度に反発係数を掛けるので、跳ね返るたびに
//        力学的エネルギーが増える。
//
//  ★新方式（Box2D と同じ3点セット）
//    (1) 力積を接触点ごとに積算する（合計 jn ≥ 0 を保ち、反復では差分だけ打つ）。
//        接触の実効質量行列は対称正定値なので、Gauss-Seidel は同時解へ収束する。
//        収束先は幾何が決める一意の解なので、解く順序に依らない。
//    (2) 反発はサブステップ開始時の接近速度 vn0 だけを種にし、非貫入を解き終えた
//        あとの専用パスでまとめて与える。途中の速度が混ざらないのでエネルギーが
//        増えない。
//    (3) まだ触れていない点（sep > 0）は「このサブステップで隙間を詰めきる速度」
//        -sep/dt までしか止めない＝投機的接触。接触点の検出は多少の隙間を許して
//        いる（地面は band=2px、物体どうしは clip の 1.5px）ので、これをしないと
//        2cm 浮いた頂点が空中で物体を支えてしまう。
// ════════════════════════════════════════
// 投機的接触のバイアス。返り値は「許してよい接近速度」（負）。
//   sep ≤ 0（すでに食い込んでいる）なら 0 ＝ これ以上の接近を一切許さない。
function specBias(sep, dt) { return sep > 0 && dt > 1e-9 ? -sep / dt : 0; }
// ウォームスタート：直前のサブステップで各接触点が出した力積を覚えておき、
//   次のサブステップの初期値として先に打っておく。反復は差分を積むだけなので、
//   前回の答えから始めれば同じ反復数でずっと深くまで収束する
//   （＝積み上げた箱が沈まない。1個1個に反復数を食われなくなる）。
let contactWarm     = new Map();   // このサブステップの結果を貯める側
let contactWarmPrev = new Map();   // 前サブステップの結果＝いま読む側
const warmOf   = id => contactWarmPrev.get(id);
const storeWarm = (id, jn, jt) => { if (id && (jn || jt)) contactWarm.set(id, { jn, jt }); };
// サブステップの最後に呼ぶ。貯めた側を「読む側」へ入れ替え、古い方を空にして再利用。
function rotateContactWarmStart() {
  const t = contactWarmPrev;
  contactWarmPrev = contactWarm;
  contactWarm = t;
  contactWarm.clear();
}
function clearContactWarmStart() { contactWarm.clear(); contactWarmPrev.clear(); }
// ★ウォームスタートの門番：**すでに離れつつある接触には、前の力積を打ち直さない。**
//   ウォームスタートは「載っているあいだ支え続ける力積」を探し直さずに済ませる技法で、
//   離れていく接触に対しては意味を持たない。ところが山が組み変わっている最中は
//   「もう離れている点」が毎サブステップ大量に現れ、そこへ古い力積を打つと**押し広げる
//   仕事をしてしまう**。ソルバはその余分をきちんと消すので力学的エネルギーは合う
//   （実測 ΔE/mgh = 100.5%）が、消したぶんは非弾性衝突の熱として計上される
//   ＝ **温度計だけが 30% 高く出る**。thermal.js の impactHeatOf の★が
//   「積んだ粒が合わない。犯人はウォームスタート」と書いているのはこれ。
//
//   ★しきい値は「重力が1サブステップで足す速さ」。これより遅い離れかたは、
//     積んだ物が自重で沈んでは押し返される往復の中の値で、離れているとは言えない。
//     0 にすると積み木がこの往復のたびに支えを失い、10秒で上の箱が 10px 流れて
//     3.2° 傾く。g·dt なら**積み木は1ビットも変わらない**。
//   ★実測（鉛の粒3段＋摩擦0.5＋反発0.4 の袋を 2.14m 落として 計上した熱 ÷ mgh。
//     理想 100%。対照は粒1段・摩擦0 の現行デモと、40px の箱を8個積んで10秒）：
//                        袋      対照(1段)   積み木の横ずれ／傾き
//         門番なし      130.1%    100.9%     0.75px ／ −0.18°
//         > 0           101.2%    100.7%     10.44px ／ 3.16°   ← 積み木が悪化
//         **> g·dt**    102.7%    100.7%     **0.75px ／ −0.18°**（門番なしと同じ）
//         > 10px/s      104.2%    100.7%     0.75px ／ −0.18°
//         > 100px/s     119.5%    100.8%     0.75px ／ −0.18°
//         ウォーム全切   99.5%    100.6%     793px ／ −90°（崩れる）
//   ★外れた見立て（同じことを繰り返さないために残す）：
//     ・反復不足ではない … iterations 8→40 で 130.1%→132.4%。増やしても直らない
//     ・_jnMax の種でもない … 0 から始めても 130.1% で1ビットも動かない
//     ・反発パスでもない … e=0 にすると 134.9% でむしろ悪い
//     ・法線の回転でもない … 5°で捨てる門番は 130.1% のまま＝法線は回っていない
//     ・熱の台帳の付け替えでもない … 打った力積からウォームぶんを引くと、対照(1段)が
//       100.9%→115.4% と**悪化**する。台帳は正しい。直すべきは打つ側。
function warmStartAllowed(vn0, dt) {
  return !(vn0 > Math.hypot(world.gravX, world.gravY) * PPM * dt);
}
// ★vx/vy を直接書き換える力（クーロン力・ローレンツ力・万有引力）が、その物体に
//   力を与えてよいかの判定。applyImpulse の条件＋frozen。
//   held（編集ツールでドラッグ中）や frozen の物体は integrate されないので、
//   速度を足し続けると「使われない速度」が溜まり、接触解決に混ざって暴発する
//   （＝掴んで動かすと相手が弾き飛ばされる）。
// ★生成口（isSpawner）は力を受けない。生成口の速度は運動ではなく「出てくる物体に渡す値」
//   で、integrate も通らない（body.js）。ここで弾かないと、万有引力・クーロン力・電場が
//   毎 tick その値を書き換え、出てくる物体の初速が勝手に変わっていく
//   （実測：万有引力の星の近くに置いた生成口の vy が 2秒で 0 → −414 px/s。2026-09-27 修正）。
//   直す前も、電荷を持つ生成口のある3デモ（質量分析器・速度選択器・電磁石でふり分ける）は
//   どれもクーロン力を切り、生成口を場の外に置いていたので、値は変わらない（実測：場は 0）。
const acceptsForce = b => !!b && !b.isStatic && !b.held && !b.frozen && b.invMass > 0 && !b.isSpawner;
// ★場（万有引力・クーロン力）の源になるか。生成口は「型」であって世界にある物体ではない
//   （誰とも当たらず、光も素通りする＝collision.js の _ghostBody）ので、引きも押しもしない。
//   質量や電気量は、出てくる物体に渡す値として持っているだけ。
const isFieldSource = b => !b.isSpawner;
const len  = (x, y) => Math.sqrt(x*x + y*y);
const len2 = (x, y) => x*x + y*y;
// ════════════════════════════════════════
//  PHYSICS ENGINE (custom impulse-based)
// ════════════════════════════════════════
