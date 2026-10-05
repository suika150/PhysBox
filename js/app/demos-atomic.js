// ════════════════════════════════════════
//  デモシーン ▸ 原子
// ════════════════════════════════════════
//  ★共通の見せ方と実装関数の約束は js/app/demo-kit.js にある（先に読むこと）。
//    どのデモがどの単元に並ぶかは目録 js/app/demos.js の側で決まる。
//  ★原子の未実装の単元（光電効果・ボーア模型・半減期・核分裂など）は、2026-09-28 にユーザーの
//    判断で目録から消した。どれも量子の効果が主役で、古典の力学の模型では正直に出せない
//    （核力と核分裂のデモを作って試し、実物と逆のふるまいに但し書きが並んだので撤去した）。
//    古典で見せられるのは、この2本のような「電荷と力で決まる実験」まで。
//  ★ただし光電効果だけは、同日ユーザーの依頼で「光の代わりに物質の粒を当てる井戸の模型」
//    として戻した（demoPhotoelectric）。量子の効果を出すのではなく、しきい値と K ＝ E − W を
//    古典の衝突で見せ、強さを上げると破れる所（古典の限界）も隠さずに見せる。
//  ★つまみの窓の並べ方は電磁気の dcPlaceRow（js/app/demos-em.js）を借りる。

// ── ミリカンの油滴実験（静止法）─────────────────────────────────
//  水平な極板のあいだに上向きの電場 E。極板のあいだに、質量と電気量のちがう油滴（正に帯電）を
//  4つ入れてある。電場を強くしていくと、qE ＝ mg になったところでその油滴が浮いて止まる。
//  止まったときの E と油滴の質量から q ＝ mg/E を出すと、どれもある値 e の整数倍になる
//  （電気量はとびとび＝電気素量）。
//  ★静止法にしたのは、この系の空気抵抗が速さの2乗に比例する形（body.js の drag）で、
//    教科書の測り方（落ちる速さと上る速さの比。抵抗は速さに比例＝ストークスの法則）が
//    そのままでは成り立たないため。静止法の qE ＝ mg は抵抗の法則によらない。
//    空気抵抗は「一定の速さで落ちる／上る」ために入れてある（無いと加速し続けて、つりあいの
//    近くでもゆっくり動くようにならない）。
//  ★電気量は 1〜4 倍を1つずつ手で与えた（模型の電気素量 e ＝ 1.0×10⁻³ C）。実物のように
//    油滴が勝手に何個かの電子を失う仕組みは無いので、「とびとび」を発見させる題材ではなく、
//    計算して確かめる題材。質量は、止まる E がつまみの刻み（0.5V/m）にちょうど乗るように選び、
//    3桁に丸めて札に書く（札の値で計算しても q は e の整数倍から 0.3% 以内）。
//      A：n ＝ 1・止まる E ＝ 10V/m   → m ＝ 1.02g
//      B：n ＝ 2・E ＝ 7.5V/m         → m ＝ 1.53g
//      C：n ＝ 3・E ＝ 4V/m           → m ＝ 1.22g
//      D：n ＝ 4・E ＝ 12.5V/m        → m ＝ 5.10g
//    （m ＝ n·e·E/g。g ＝ 9.80665）
//  ★油滴の大きさは質量の 1/3 乗に比例させる（同じ油なので体積が質量に比例）。
//  ★油滴どうしのクーロン力は切る（止まる E がほかの油滴の位置で変わらないように）。
//  ☆（解消済み）以前は、つりあった油滴も速度 0 のまま位置だけ下へずれていった。重力だけが
//    積分の前に丸ごと効いていて、1サブステップに ½·g·h² ずつずれたため（刻み 8 で 5秒 4.9px、
//    16 で 2.5px）。2026-09-27 に重力も位置の前後へ半分ずつにした（body.js の integrate の★）。
//    実測（油滴 A・E=10V/m・5秒）：刻み 8 で −0.26px、16 で −0.07px（残りは質量を3桁に
//    丸めたぶんのつりあいのずれで、新旧で同じ vy）。刻み 16 はそのまま残してある。
//  ★実測（サブステップ 16。油滴を真ん中に置き直し、E を合わせて1秒待ってから 300 tick の |vy| の平均）：
//      E ＝ 4 / 7.5 / 10 / 12.5 V/m で C / B / A / D が 0.0001m/s 以下（止まる）。
//      そのとき残りの油滴は 0.03〜0.19m/s で上るか落ちる（極板に着いたものを含む平均）。
//      E ＝ 0 で落ちる速さ（終端速度）は A 0.73・B 0.84・C 0.78・D 1.26 m/s。
const MIL_E0 = 1e-3;                 // [C]  模型の電気素量
const MIL_DROPS = [                  // 札・電気量の倍数・止まる E [V/m]
  ['A', 1, 10], ['B', 2, 7.5], ['C', 3, 4], ['D', 4, 12.5],
];
const MIL_W = 380, MIL_GAP = 380;    // [px] 極板の幅・間隔
const MIL_R1 = 6;                    // [px] 1g の油滴の半径
const MIL_CD = 5;                    // 抗力係数。★1g で終端速度 0.6m/s 前後（極板のあいだを数秒で横切る）
const MIL_EMAX = 15;                 // [V/m] つまみの上限
function demoMillikan() {
  resetDemoWorld();
  updateGroundTerrain(false);
  world.coulombOn = false;
  world.substeps = 16;            // ★上の★（つりあった油滴の位置のずれを半分に）

  setDemoCam(900, 1.0);           // ★座標軸を画面の外へ（速度選択器と同じ）
  cam.y -= 400;
  const s = demoFitScale();
  const toWX = sx => cam.x + (sx - canvas.width  / 2) / cam.zoom;
  const toWY = sy => cam.y + (sy - canvas.height / 2) / cam.zoom;
  const X0 = toWX(560 * s), X1 = X0 + MIL_W, XC = (X0 + X1) / 2;
  const YT = toWY(130 * s), YB = YT + MIL_GAP, YC = (YT + YB) / 2;
  // ── 電場（上向き）と極板（上＝−、下＝＋）──
  const fE = new EMField({ kind:'E', strength:0, angle:-Math.PI / 2,
    x:XC, y:YC, w:MIL_W, h:MIL_GAP });
  emFields.push(fE);
  const plate = (y, label, fill) => objects.push(new Body({ type:'box', x:XC, y, w:MIL_W + 20, h:12,
    isStatic:true, friction:0.5, frictionStatic:0.5, restitution:0, label,
    fillColor:fill, strokeColor:'#b0bec5', strokeWidth:1.5 }));
  plate(YT - 6, '上の極板（−）', '#5c6bc0');
  plate(YB + 6, '下の極板（＋）', '#e57373');
  // ── 油滴 ──
  const ts = demoTextScale(cam.zoom);
  const LS = DEMO_NOTE_SIZE * ts * 0.9;
  const g = world.gravY !== undefined ? Math.abs(world.gravY) : 9.80665;
  MIL_DROPS.forEach(([name, n, Ebal], k) => {
    const m = n * MIL_E0 * Ebal / g;                        // [kg]
    const r = MIL_R1 * Math.cbrt(m * 1000);
    const x = X0 + MIL_W * (k + 1) / (MIL_DROPS.length + 1);
    objects.push(new Body({ type:'circle', x, y:YC, radius:r,
      mass:m, charge:n * MIL_E0, drag:MIL_CD, fixedRotation:true,
      friction:0.5, frictionStatic:0.5, restitution:0,
      fillColor:'#ffca28', strokeColor:'#fff8e1', strokeWidth:1.2, label:'油滴 ' + name }));
    demoLabel(x - 34 * ts, YB + 22 * ts, name + '：' + (m * 1000).toFixed(2) + ' g', '#fff8e1', LS, true);
  });
  // ★極板の符号は左の端の外（下の極板の下は油滴の札が並ぶ）
  demoLabel(X0 - 40 * ts, YT - 18 * ts, '−', '#9fa8da', DEMO_TITLE_SIZE * ts, true);
  demoLabel(X0 - 40 * ts, YB - 6 * ts, '＋', '#ef9a9a', DEMO_TITLE_SIZE * ts, true);

  const p = demoTextTopLeft();
  const NOTE =
      '水平な極板のあいだに上向きの電場 E をかける。\n'
    + '中には、質量と電気量のちがう4つの油滴\n'
    + '（正に帯電）がある。空気の抵抗があるので、\n'
    + '油滴は一定の速さで落ちたり上ったりする。\n'
    + '\n'
    + '【手順】▶実行 を押す\n'
    + '・つまみで E を少しずつ強くする\n'
    + '・静電気力 qE が重力 mg とつりあうと、\n'
    + '　その油滴は浮いたまま止まる\n'
    + '・止まったときの E と札の質量から\n'
    + '　q ＝ mg／E を計算する（g ＝ 9.8m/s²）\n'
    + '・4つの q は、どれもある値の整数倍になる\n'
    + '　→ 電気量の最小単位（電気素量 e）\n'
    + '※ この模型の e は 1.0×10⁻³ C（実物は 1.6×10⁻¹⁹ C）';
  const noteY = p.y + 54 * ts;
  demoNote(p.x, noteY, NOTE, DEMO_NOTE_SIZE * ts);
  demoTitle(p.x, p.y, 'ミリカンの油滴実験', DEMO_TITLE_SIZE * ts);

  // ── つまみ：電場の強さ。本文の下 ──
  const toSY = wy => (wy - cam.y) * cam.zoom + canvas.height / 2;
  const noteBot = toSY(demoNoteBelow(noteY, NOTE, 0, DEMO_NOTE_SIZE * ts));
  const re = addRemote('prop', fE, 'emfield');
  if (re) { re.prop = 'strength'; re.lo = 0; re.hi = MIL_EMAX; dcPlaceRow([re], 56, noteBot + 6); }
}

// ── α粒子の散乱（ラザフォード）───────────────────────────────
//  止めた正の電荷（原子核）に向けて、α粒子（正）を狙いの高さ b を変えて 11 本打ち込む。
//  核から遠くを通るものはほとんど曲がらず、近くを通るものほど大きく曲がり、正面のものは
//  はね返る。原子の正の電荷が小さな核に集まっていれば、ごく一部が大きく曲げられる。
//  ★部品：止めた円（核）・生成口 11 個・円環＋仕切りの図形和（検出器）・プログラム 12 枚
//    （生成口に Enter・遅らせる、検出器に〈当たったら相手のレイヤーを変える〉）・リモコン 2 台だけ。
//  ★α粒子どうしもクーロン力で反発する（切れない。world.coulombOn は全電荷に効く）。
//    同時に打つと隣どうしが押し合って扇のように開くので、1回の Enter で生成口ごとに
//    〈遅らせる〉を EA_DT ずつずらして順に打つ（打ち出しの間隔 EA_DT·v ＝ 250px）。
//    打つ順は |b| の大きいほうから、正面（b ＝ 0）を最後にする。はね返った粒子が
//    後から来る粒子とすれ違わないように。
//  ★値：α粒子 q ＝ +0.02C・m ＝ 0.08kg、核 Q ＝ +10C、速さ 5m/s、k ＝ 2（demo-kit の既定）。
//    正面衝突で最も近づく距離（無限遠から 5m/s で来たとき）
//      d ＝ 2kqQ/(mv²) ＝ 0.4m（40px）
//    曲がる角は tan(θ/2) ＝ d/(2b)：b ＝ 0.4／0.8／1.2／1.6／2.0m で 53／28／19／14／11°。
//    ★電荷の比 q:Q ＝ 1:500 は、検出器に止まったα粒子が隣を押し出さないように決めた
//      （実物は α 2 : 金 79。水増し）。止まった粒子は電荷を持ったまま残り、升目の間隔 s で
//      並ぶ。隣の力と核の力の比は (q/Q)·(R/s)² ≈ 136·q/Q（R ＝ 4.2m・s ＝ 0.36m）。
//        q:Q ＝ 1:2.5 … 飛んでいる途中で隣の粒子の力が核の力の 1/4。曲がる角が 2〜3 割大きく、
//                      出ていく速さも 5 → 6.1m/s に増えた（後ろの粒子に押される）
//        q:Q ＝ 1:20  … 飛ぶ途中の影響は 0.3° 以内になったが、検出器の上で押し出された
//                      （b ＝ 80 は 37.5° の仕切りの先に着いたあと、隣の3個に 1.4N で押されて
//                      ＝核の押し付け 0.28N の5倍 ＝ 93° まで流れた）。1:40 でも同じ
//        q:Q ＝ 1:500 … 11本の着いた位置が、1本だけ打ったときと 0.3° 以内で一致
//      軌道は kqQ/m だけで決まるので、q と m を同じ比で下げれば曲がり方は変わらない。
//  ★d を 40px にしたのは、力の発散止め（COULOMB_SOFTEN2 ＝ 8px。clipper.js）の影響を小さくするため。
//    正面でも r² が 1600 に対して 64（4%）。d を小さくするほど近くを通る粒子の曲がりが理論より減る。
//  ★実測（サブステップ 8。1本だけ・検出器なし）。θ は十分遠くでの速度の向き：
//      b ＝  40： 49.6°（理論 53.1°）  b ＝  80： 26.0°（28.1°）  b ＝ 120： 17.2°（18.9°）
//      b ＝ 200：  9.9°（11.4°）      b ＝   0：180°（最接近 35px：打ち出しの位置の位置エネルギーの
//      ぶん全エネルギーが 1.0 → 1.12J に増え、d ＝ kqQ/1.12J ＝ 0.36m）
//    ★理論より 3〜10% 小さいのは、核から 3.3m の所で打ち出していて、近づく途中の曲がりの一部が
//      無いため（式は無限遠から来る前提）。対照：1本だけを 30m 先から打つと、どの b でも理論と
//      1° 以内（b ＝ 40 で 52.8°）。画面の幅で打ち出しの距離が決まるので、このまま残す。
//      本文には角度を書いていない。
//  ★検出器で読む位置の角度（核から見た着地点。b だけ横にずれて出るので、上の θ とは別の量）：
//      Enter 1回の 11本 … b ＝ ±40：55°・±80：46°・±120：33°・±160：35°・±200：38°・0：180°
//      速さ 10m/s … ±40：19°・±80：13°（近くを通っても曲がりにくい）
//      核の電荷 0 … ±40：6°・±80：12°・±120：23°（まっすぐなら 5.5／11.1／16.8°）。
//      当たったあと進む向きへ次の仕切りまで滑るので、升目 5° ぶん先へずれる（仕様）。
//  ★重さ：検出器は凸の破片 192 個になり、simTick が 0.6 → 4.0ms（描画 6.5ms と合わせて
//    1フレーム 10.5ms。60fps に収まる）。仕切りを減らせば軽くなるが升目が粗くなる。
//  ★重力 0（真上から見た図）。核は止めた物体（invMass ＝ 0。金の核はα粒子よりずっと重い）。
const EA_Q = 0.02, EA_M = 0.08;       // [C]・[kg] α粒子
const EA_QN = 10;                    // [C]  原子核
const EA_V = 5;                      // [m/s]
const EA_DB = 40;                    // [px] 狙いの高さの間隔
const EA_NB = 5;                     // 片側の本数（全部で 2·EA_NB＋1）
const EA_X0 = 330;                   // [px] 生成口 → 核（横の距離）
const EA_DT = 0.5;                   // [s]  打ち出しの間隔
const EA_R = 5, EA_RN = 10;          // [px] α粒子・核の半径
const EA_DET_R = 420, EA_DET_W = 10; // [px] 検出器（円環）の内側の半径・厚み
const EA_FIN_N = 72, EA_FIN_L = 14;  // 検出器の仕切りの数（5° ごと）・長さ [px]
const EA_VMAX = 15, EA_QMAX = 10;    // つまみの上限（下限はどれも 0）
function demoAlphaScattering() {
  resetDemoWorld();
  setDemoGravity(0);
  updateGroundTerrain(false);
  world.coulombOn = true;
  world.substeps  = 8;

  setDemoCam(900, 0.55);          // ★曲がったあとの軌道が画面の右に収まるように引く
  cam.y -= 400;
  const s = demoFitScale();
  const toWX = sx => cam.x + (sx - canvas.width  / 2) / cam.zoom;
  const toWY = sy => cam.y + (sy - canvas.height / 2) / cam.zoom;
  const XG = toWX(570 * s);                  // 生成口の列
  const XN = XG + EA_X0, YN = toWY(300 * s); // 原子核
  // ★核は衝突レイヤー 2（α粒子は既定の 1）＝物としては当たらず、クーロン力だけで効く
  //   （クーロン力はレイヤーを見ない）。当たると、電荷 0 にしても正面の1本が円に当たって
  //   はね返った（178°）。「電荷を 0 にすればまっすぐ」が崩れる。
  const nuc = new Body({ type:'circle', x:XN, y:YN, radius:EA_RN, isStatic:true,
    layers:0b0010,
    charge:EA_QN, fillColor:'#ef5350', strokeColor:'#ffcdd2', strokeWidth:1.5, label:'原子核' });
  objects.push(nuc);
  // 生成口：|b| の大きいほうから順に（上の★）
  const bs = [0];
  for (let i = 1; i <= EA_NB; i++) bs.unshift(i * EA_DB, -i * EA_DB);
  const guns = bs.map(b => {
    const g = new Body({ type:'circle', x:XG, y:YN + b, radius:EA_R,
      mass:EA_M, charge:EA_Q, fixedRotation:true,
      friction:1, frictionStatic:1, restitution:0, isSpawner:true,   // ★検出器に当たったら止まる
      tracerEnabled:true, tracerColor:'#ffd54f', tracerDuration:600,
      fillColor:'#ffb74d', strokeColor:'#ffffff', strokeWidth:1.2, label:'α粒子' });
    g.vx = EA_V * M2PX;
    objects.push(g);
    return g;
  });

  // ── 検出器：核を中心にした円環の壁。α粒子は当たった所に止まる（摩擦 1・反発 0）──
  //   ★型抜き（大きい円 − 小さい円）で作る＝左ツールバーの図形和と同じ手順。
  //   ★生成口の列ごと中に入れる（いちばん遠い生成口は核から 3.9m）。はね返った粒子も
  //     後ろの壁で拾える。生成口は物と当たらないので、戻る粒子の邪魔にならない。
  const disk = r => new Body({ type:'circle', x:XN, y:YN, radius:r, isStatic:true,
    friction:1, frictionStatic:1, restitution:0, label:'検出器',
    fillColor:'#2e7d32', strokeColor:'#a5d6a7', strokeWidth:1.2 });
  //   ★内側に仕切りを 5° ごとに立てて升目にする。円環だけだと、当たった粒子が壁に沿って
  //     滑り続けた（反発 0 で消えるのは壁に向かう速さだけ。壁に押し付けるのは核の力 0.6N
  //     しかなく、摩擦 1 でも止まるまで 18 秒）。仕切りに当たると沿う向きの速さも消える。
  //     升目ごとに何個入ったかが数えられる（検出器の区画の役）。
  const ring = demoBoolean('diff', [disk(EA_DET_R + EA_DET_W), disk(EA_DET_R)]);
  const fins = [];
  for (let i = 0; i < EA_FIN_N; i++) {
    const a = (i + 0.5) * 2 * Math.PI / EA_FIN_N, rc = EA_DET_R - EA_FIN_L / 2 + 2;
    fins.push(new Body({ type:'box', x:XN + rc * Math.cos(a), y:YN + rc * Math.sin(a),
      w:EA_FIN_L + 4, h:3, angle:a, isStatic:true }));
  }
  const det = demoUnion(ring, ...fins);
  det.layers = 0b0011;

  // ── 画面 ──
  const ts = demoTextScale(cam.zoom);
  const LS = DEMO_NOTE_SIZE * ts * 0.85;
  demoLabel(XN + 20, YN - 22, '原子核（＋）', '#ef9a9a', LS, true);
  demoLabel(XG - 20, YN + EA_NB * EA_DB + 30 * ts, 'α粒子（＋）', '#ffcc80', LS, true);
  demoLabel(XN + EA_DET_R * 0.72, YN + EA_DET_R * 0.72 + 20 * ts, '検出器', '#a5d6a7', LS, true);
  const p = demoTextTopLeft();
  const NOTE =
      '正の電気をもつα粒子を、原子核に向けて\n'
    + '打ち込む。核の正の電気とα粒子は反発しあう。\n'
    + '\n'
    + '【手順】▶実行 を押す\n'
    + '・Enter キーで、11 本を上下の外側から順に打つ\n'
    + '・核から遠くを通るものは、ほとんど曲がらない\n'
    + '・核の近くを通るものほど大きく曲がり、\n'
    + '　正面のものは はね返される\n'
    + '・〈α粒子の速さ〉を上げると曲がりにくくなる\n'
    + '・〈核の電荷〉を 0 にすると、どれもほぼまっすぐ進む\n'
    + '・まわりの緑の輪は検出器。α粒子は当たった升目に残る\n'
    + '\n'
    + '大きく曲がるのは、正の電気が小さな核に\n'
    + '集まっていて、そのすぐそばを通れるから。\n'
    + '正の電気が原子全体に薄く広がっていたら、\n'
    + 'はね返るほど強い力を受けることはない。';
  const noteY = p.y + 54 * ts;
  demoNote(p.x, noteY, NOTE, DEMO_NOTE_SIZE * ts);
  demoTitle(p.x, p.y, 'α粒子の散乱', DEMO_TITLE_SIZE * ts);

  // ── 操作：α粒子の速さ（生成口 11 個をまとめて）・核の電荷。その下に Enter の窓 ──
  const toSY = wy => (wy - cam.y) * cam.zoom + canvas.height / 2;
  const noteBot = toSY(demoNoteBelow(noteY, NOTE, 0, DEMO_NOTE_SIZE * ts));
  const rv = addRemote('prop', guns[0], 'body', guns.map(g => g.id));
  if (rv) { rv.prop = 'speed'; rv.lo = 0; rv.hi = EA_VMAX; }
  const rq = addRemote('prop', nuc, 'body');
  if (rq) { rq.prop = 'charge'; rq.lo = 0; rq.hi = EA_QMAX; }
  const row = [rv, rq].filter(Boolean);
  const h = Math.max(0, ...row.map(r => r.panel.offsetHeight || 180));
  const top = Math.min(noteBot + 6, canvas.height - h - 60);
  dcPlaceRow(row, 56, top);
  guns.forEach((g, i) => {
    const pg = addProgram(g);
    if (!pg) return;
    Object.assign(pg, { trigger:'key', key:'Enter', action:'create', limit:30, delay:i * EA_DT });
    pg.reset(); syncProgramState(pg);
    pg.collapsed = true;
    // ★窓は 11 枚。1枚目だけ見える所に置き、残りは同じ位置に重ねる（どれも同じ中身）
    pg.fx = 56 / canvas.width; pg.fy = (top + h + 8) / canvas.height;
    syncProgramPanel(pg); placeProgramPanel(pg);
  });
  // ★検出器に当たったα粒子を衝突レイヤー 2 へ移す（検出器は 1＋2 なので当たり続ける）。
  //   止まった粒子に、後から来た粒子が物としてぶつかって弾かれないように。b ＝ 80〜200 の
  //   4本は位置の角度で 34〜38° の同じ升目に着くので、移さないと 2本目から弾かれた
  //   （b ＝ −120 は 1本だけなら −34°、11本では −97° に着いた）。
  //   核もレイヤー 2 だが、止まった粒子は核に届かないので関係ない。
  const pd = addProgram(det);
  if (pd) {
    Object.assign(pd, { trigger:'hit', hitWhat:'body', target:'other',
                        action:'layers', layers:0b0010 });
    pd.reset(); syncProgramState(pd);
    pd.collapsed = true;
    pd.fx = 56 / canvas.width; pd.fy = (top + h + 48) / canvas.height;
    syncProgramPanel(pd); placeProgramPanel(pd);
  }
}

// ── 光電効果（井戸の模型）─────────────────────────────────────
//  光の代わりに、電荷 0 の粒を左斜め上から金属の中の電子に当てる。電子は金属の穴（井戸）の底に
//  いて、穴の出口側（表面から d の層）には電子を引き戻す電場がある。穴を登りきるのに要る仕事が
//  仕事関数 W ＝ qE·d。粒の運動エネルギーが W に届けば電子は穴を脱出し、届かなければ引き戻される。
//  ★引き戻す電場は金属の中（表面の内側）に置き、金属の外には置かない（ユーザーの指摘：
//    「穴を脱出したら光電効果」のはずで、出てすぐの電場は要らない）。本物の仕事関数も表面の
//    ごく近く（原子数個ぶん）の引き戻しでできている。★電場そのものは消せない：引き戻す力が
//    無いと脱出にエネルギーが要らず、どんな遅い粒でも出る（しきい値が無くなる）。
//    ☆以前（09-28 の版）は同じ層を表面の外側に置いていた。移しても W は同じで、実測も同じ。
//  ★部品：生成口 2 個（粒・電子）・型抜きの金属・はね返す板・電場の領域 2 つ（障壁・阻止）・
//    プログラム 8 枚（粒：Enter で生成・当たったら消す・8m で消す、電子：補う・折り返したらすり抜け・
//    外へ出たらすり抜け・上下で消す）・リモコン 3 台・通過カウンタ 1 本。専用の部品は無い。
//  ★重力 0。上が表面。粒は金属を素通りする（衝突レイヤー 1 だけ。金属と板は 2、電子は 1＋2）。
//  ★教科書の図に合わせて左斜め上から当てる（ユーザーの希望）。粒と電子は中心を結ぶ向きにしか
//    押し合わないので、表から当てた電子は必ず金属の奥へ押し込まれる。そこで溝の奥に
//    はね返す板（反発 1。金属の中の原子の役）を斜めに置き、電子を表面に垂直に（真上へ）
//    向け直す。★垂直にするのが要点：障壁が減らすのは表面に垂直な速さだけなので、斜めのまま
//    出すと 45° ではしきい値が ½mv² ＝ 2W にずれる。板の法線は（出る向き − 入る向き）。
//  ★1 回の衝突でエネルギーが丸ごと移るように、粒と電子は同じ質量・反発 1・同じ軸の上
//    （電子は細い溝に 1 個だけ入れ、横に逃げない）。正面衝突で速度が入れかわる＝「光子を
//    丸ごと吸収する」にあたる。だから飛び出した電子の運動エネルギーは K ＝ ½mv² − W。
//  ★当てた粒は〈電子に当たったら消える〉＝光子が吸収されて消えるのにあたる。1 個の粒は
//    1 回しか当たらない。止まっていた電子に正面から当たったときは速度をすべて渡して止まって
//    いるので、消えるエネルギーは 0。
//    ★残すと、止まった粒のすぐ横に次の電子が現れて接し、次の粒が来たときに 3 つの同時
//      衝突になる。エンジンは速度の入れかわり（ニュートンのゆりかご）を解けず、前の 2 つを
//      一緒に押し出して電子が軌道から外れ、以後の粒が当たらなくなった
//      （実測：v ＝ 8m/s・30 発で 1 個しか出なかった）。
//    ★以前は〈速さ 0〜0.1m/s になったら消す〉だった。押し戻されて戻ってくる途中の電子と
//      粒が溝の中ですれ違うと、粒は 0.17m/s だけ残して消えずに金属の中を漂い、あとで電子に
//      斜めに当たって溝の口の角へ押しやった（手で打つようにしてから、失敗させたあとに
//      速さを上げても 1 個も出なくなった）。
//  ★登りきれなかった電子は、折り返した瞬間（速さ 0.0001〜0.5m/s に入った所）に何にも当たらない
//    レイヤーへ移し、そのまま金属へ落ちて下へ抜けたところで消す＝金属に吸い込まれる。
//    次の電子は元の場所（粒の通り道の上）にちょうど現れる。
//    ★以前は、押し戻された電子を板で左上へはね返し、斜めの溝の端（反発 0）で止めていた。
//      往復に 4m/s で約 1.9 秒かかり、その間に次の粒を打つと溝の中や板の上で出会って、
//      板と同時の衝突で電子がほとんど止まり、真上の溝をゆっくり（0.09m/s）下りて何秒も
//      戻らなかった。横に 1px ずれると溝の口の角に乗って止まった（ユーザーの報告
//      「4 回目で入口に引っかかって戻らない」）。
//    抵抗も減衰も入れていない（入れると、表面まで行くあいだに
//    エネルギーを削って K ＝ ½mv² − W がくずれる。抗力は距離あたりで効くので逃げられない。
//    実測：溝のない箱に抗力 Cd 0.3〜0.5 の水を入れると、K の最大が ½mv² − W の 14% まで落ちた）。
//  ★光を強くしても（打つ間隔を詰めても）遅い粒では出ない。粒の通り道（斜め）と電子が登る道
//    （真上）は板の上の 1 点でしか交わらず、障壁を登りかけた電子に次の粒が追いつけない。
//    エネルギーは粒 1 個ずつの塊でしか渡らない＝光子の描像そのもの。
//    ☆以前（2026-09-28 の初版）は粒を金属の裏から真上へ打っていて、粒の道と電子の道が同じ
//      直線だった。そのときは、登りかけて戻る電子に次の粒が当たり、登った分の位置エネルギーに
//      上乗せされて遅い粒でも出た（v ＝ 4m/s・間隔 0.25 秒で 120 発中 24 個）。これを
//      「古典の模型の限界」として見せていたが、斜めから当てる形にしたときに消えた。
//  ★実測（このデモそのまま・Enter を決まった間隔で押す。引き戻す電場を金属の中へ移したあとで測り直し、外に置いた版と一致。W ＝ 0.12J・d ＝ 0.6m・電子 0.01kg、
//    しきい値の速さ √(2W/m) ＝ 4.9m/s。数えたのはカウンタを通った電子。K は障壁の外での運動エネルギー）：
//      v ＝ 4・4.8m/s … 何発でも 0 個（1 秒ごと 30 発・0.13 秒ごと 60 発・0.07 秒ごと 150 発）
//      v ＝ 4.95／5.1m/s … 10 発で 10 個。K ＝ 0.0031／0.0103J（½mv² − W ＝ 0.0025／0.0100J）
//      v ＝ 6／8／12m/s … 全部出る。K はどれも 0.0613／0.2006／0.6004J（理論 0.060／0.200／0.600J）
//        4m/s で 5〜60 発失敗させたあとに上げても同じ（前の版はここで出なくなった。上の★）
//      阻止の電場 E₂（d₂ ＝ 1.0m）・v ＝ 8m/s：19V/m で 10 発 10 個・21V/m で 0 個
//        ＝ qE₂d₂ ＝ 0.20J の所で止まる（K の最大と一致）
//      電子が粒の通り道から横へずれた最大は 0.75px（阻止の電場で押し戻したときだけ 4px。すり抜けて落ちる途中）
//  ★電子は溝から出ていくと〈近くに自分の一族が 0 個〉で次が現れる（回路から補われる役）。
//    半径は溝と障壁の上までを覆う＝登りかけて戻ってくる電子がいる間は現れない。
//  ★障壁を登りきった電子は、何にも当たらない衝突レイヤー（4）へ移す＝外へ出た電子は
//    もう金属・粒・電子と当たらない。阻止の電場で押し戻された電子は金属をすり抜けて下へ
//    抜け、そこで消す（金属に吸い込まれた役）。
//    ★移さないと、押し戻された電子が障壁を下りながら W を取り戻して溝へ落ち、板で
//      はね返って、元の場所にいる次の電子に K ＋ W を渡した。それが出ていってまた押し戻され、
//      行き来が続いて新しい粒がほとんど効かなくなった（実測：E₂ ＝ 21・30 秒で出たのは 3 個、
//      K の最大が 0.212J ＝ ½mv² − W を 6% 超えた）。
//  ★阻止の電場：障壁の外に、同じ向き（電子を金属へ押し戻す向き）の電場をもう 1 つ置く。
//    つまみで強くしていき、カウンタが止まったところで qE₂·d₂ ＝ K の最大（阻止電圧の測り方）。
const PE_Q = 0.01, PE_M = 0.01;      // [C]・[kg] 電子（電気量は負で入れる）。粒も同じ質量
const PE_R = 8;                      // [px] 電子・粒の半径
// ★溝の幅は電子の直径＋1px。壁（反発 0・摩擦 0）が横ずれをそのつど消して、電子を粒の通り道の
//   上に戻す。★以前は＋4px で、板ではね返るたびに横の速さが 0.04m/s ずつ付き、往復を重ねると
//   通り道から 2px 外れて斜めに当たるようになり、溝の入口に引っかかって出なくなった
//   （実測：4m/s で 5 回失敗させてから 8m/s に上げると、20 秒で 1 個も出なかった）。
const PE_SLOT_W = PE_R * 2 + 4;      // [px] 溝の幅
const PE_METAL_W = 240, PE_METAL_H = 150;   // [px] 金属
const PE_FUNNEL = 10;                // [px] 溝の口の面取り
const PE_DEPTH = 100;                // [px] 表面 → はね返す点
const PE_ANG = Math.PI / 4;          // 粒の向き（鉛直から右へ。左斜め上から来る）
const PE_RUN = 32;                   // [px] 電子 → はね返す点
const PE_GUN_D = 330;                // [px] 粒の生成口 → 電子
const PE_BAR = 60;                   // [px] 表面の障壁の厚み d（0.6m）
const PE_E1 = 20;                    // [V/m] 障壁の電場（W ＝ qE·d ＝ 0.12J）
const PE_GAP = 50;                   // [px] 障壁と阻止の電場のあいだ
const PE_STOP = 100;                 // [px] 阻止の電場の厚み d₂
const PE_V0 = 4;                     // [m/s] 開いたときの粒の速さ（しきい値の下）
const PE_VMAX = 12, PE_EMAX = 50;    // つまみの上限（下限はどれも 0）
function demoPhotoelectric() {
  resetDemoWorld();
  setDemoGravity(0);
  updateGroundTerrain(false);
  world.coulombOn = false;           // ★電子と障壁の場の力だけを見る（電子は 1 個ずつ）
  world.sleeping  = false;           // ★止まった粒・電子が眠ると、次の衝突で起きるまでの 1 tick がずれる
  world.substeps  = 8;
  world.thermalOn = false;

  setDemoCam(900, 0.9);
  cam.y -= 400;
  const s = demoFitScale();
  const toWX = sx => cam.x + (sx - canvas.width  / 2) / cam.zoom;
  const toWY = sy => cam.y + (sy - canvas.height / 2) / cam.zoom;
  const XR = toWX(775 * s);                       // 電子が出ていく溝の軸（はね返す点の真上）
  const YS = toWY(430 * s);                       // 金属の表面
  const YR = YS + PE_DEPTH;                       // はね返す点（電子がここまで来ると板に触れる）
  const dx = Math.sin(PE_ANG), dy = Math.cos(PE_ANG);   // 粒の進む向き（右下）
  const PX = XR - PE_RUN * dx, PY = YR - PE_RUN * dy;   // 電子の場所
  const YB0 = YS + PE_BAR;                        // 引き戻す電場の内側の端（金属の中）
  const YB1 = YS;                                 // 外側の端＝金属の表面
  const YST1 = YB1 - PE_GAP, YST0 = YST1 - PE_STOP;   // 阻止の電場の下端・上端
  const XM = XR - 30;                             // 金属の中心（粒が入る側を広めに）

  // ── 金属：大きい四角 − 真上への溝 − 斜めの溝 − はね返す所の空き ──
  //   ★反発 0（合成は積なので、電子が金属に当たると止まる）。阻止の電場で押し戻された
  //     電子は金属へ戻って止まる＝吸い込まれる。反発 1 にすると溝の底ではね返って
  //     また出ていき、阻止の電場とのあいだを行き来し続けた。
  const metalPart = o => new Body(Object.assign({ isStatic:true,
    restitution:0, friction:0, frictionStatic:0, label:'金属',
    fillColor:'#78909c', strokeColor:'#cfd8dc', strokeWidth:1.5 }, o));
  const ax = PX - 1.5 * PE_R * dx, ay = PY - 1.5 * PE_R * dy;   // 斜めの溝の上の端（電子の少し先）
  const chL = Math.hypot(XR - ax, YR - ay);
  const metal = demoBoolean('diff', [
    metalPart({ type:'box', x:XM, y:YS + PE_METAL_H / 2, w:PE_METAL_W, h:PE_METAL_H }),
    metalPart({ type:'box', x:XR, y:(YS + YR) / 2 - 1, w:PE_SLOT_W, h:PE_DEPTH + 2 }),
    metalPart({ type:'box', x:(ax + XR) / 2, y:(ay + YR) / 2, w:chL, h:PE_SLOT_W,
                angle:Math.atan2(dy, dx) }),
    metalPart({ type:'circle', x:XR, y:YR, radius:PE_R + 6 }),
    // ★溝の口を漏斗に面取りする。角が立っていると、1px 横にずれて落ちてきた電子が角に乗り、
    //   障壁の場に押さえつけられて止まった（ユーザーの報告「入口にひっかかって戻らない」）
    metalPart({ type:'polygon', x:XR, y:YS, verts:[
      { x:-PE_SLOT_W / 2 - PE_FUNNEL, y:-1 }, { x:PE_SLOT_W / 2 + PE_FUNNEL, y:-1 },
      { x:PE_SLOT_W / 2, y:PE_FUNNEL }, { x:-PE_SLOT_W / 2, y:PE_FUNNEL } ] }),
  ]);
  metal.layers = 0b0010;             // ★粒（1）は素通り、電子（1＋2）は当たる
  metal.alpha = 0.45;                // ★中の電場（穴の出口）の矢印が透けて見えるように
  // ── はね返す板：法線 ∝（出る向き（真上）− 入る向き）──
  const nx0 = -dx, ny0 = -1 - dy, nL = Math.hypot(nx0, ny0);
  const nx = nx0 / nL, ny = ny0 / nL;               // 板の表の向き（電子の側）
  const PL_T = 12;
  const mx = XR - (PE_R + PL_T / 2) * nx, my = YR - (PE_R + PL_T / 2) * ny;
  const plate = new Body({ type:'box', x:mx, y:my, w:PE_R * 5, h:PL_T,
    angle:Math.atan2(nx, -ny), isStatic:true, layers:0b0010,
    restitution:1, friction:0, frictionStatic:0, label:'はね返す板',
    fillColor:'#b0bec5', strokeColor:'#eceff1', strokeWidth:1.2 });
  objects.push(plate);

  // ── 電場：どちらも上向き（金属から外向き）＝負の電子は金属の側（下）へ押し戻される ──
  //   ★引き戻す電場は金属の中、穴の出口側の d だけ。電子のいる所（深さ 77px）より浅くして、
  //     止まっている電子には力がかからないようにする（深くすると電子が板の側へ流れる）。
  //     幅は金属と同じ。電子は溝の壁で横へ逃げないので、場の横から抜けることは無い
  //     （表面の外に置いていたときは、幅 40px で横から抜けて登らずに出ていった）。
  const FW = PE_METAL_W + 40;
  const fBar = new EMField({ kind:'E', strength:PE_E1, angle:-Math.PI / 2,
    x:XM, y:(YB0 + YB1) / 2, w:PE_METAL_W, h:PE_BAR });
  const fStop = new EMField({ kind:'E', strength:0, angle:-Math.PI / 2,
    x:XM, y:(YST0 + YST1) / 2, w:FW, h:PE_STOP });
  emFields.push(fBar, fStop);

  // ── 電子の生成口（斜めの溝の中）──
  const eGun = new Body({ type:'circle', x:PX, y:PY, radius:PE_R,
    mass:PE_M, charge:-PE_Q, isSpawner:true, fixedRotation:true, layers:0b0011,
    restitution:1, friction:0, frictionStatic:0,
    tracerEnabled:true, tracerColor:'#4dd0e1', tracerDuration:3,
    fillColor:'#29b6f6', strokeColor:'#e1f5fe', strokeWidth:1.2, label:'電子' });
  objects.push(eGun);
  // ── 粒の生成口（左斜め上）──
  const pGun = new Body({ type:'circle', x:PX - PE_GUN_D * dx, y:PY - PE_GUN_D * dy, radius:PE_R,
    mass:PE_M, charge:0, isSpawner:true, fixedRotation:true, layers:0b0001,
    restitution:1, friction:0, frictionStatic:0,
    fillColor:'#ffd54f', strokeColor:'#fff8e1', strokeWidth:1.2, label:'粒' });
  pGun.vx = PE_V0 * dx * M2PX; pGun.vy = PE_V0 * dy * M2PX;
  objects.push(pGun);

  // ── 通過カウンタ：阻止の電場の外。★右から左へ引く＝上向きに通ると +1 ──
  const cnt = addCounter(XR + 90, YST0 - 30, XR - 90, YST0 - 30);
  if (cnt) { cnt.what = 'charged'; cnt.span = 60; }

  // ── 画面 ──
  const ts = demoTextScale(cam.zoom);
  const LS = DEMO_NOTE_SIZE * ts * 0.85;
  const xr = XM + FW / 2 + 8;
  demoLabel(XM + PE_METAL_W / 2 + 8, YS + 100, '金属', '#cfd8dc', LS, true);
  demoLabel(XM + PE_METAL_W / 2 + 8, YS + 18, '出口の電場（W）', '#ffe082', LS, true);
  demoLabel(xr, YST0 + 30, '阻止の電場', '#ffe082', LS, true);
  demoLabel(PX - 118, PY + 34, '電子（−）', '#81d4fa', LS, true);
  demoLabel(XR + 18, YR + 26, 'はね返す板', '#eceff1', LS, true);
  demoLabel(pGun.x - 40, pGun.y - 40, '粒（電荷 0）', '#ffe082', LS, true);
  const p = demoTextTopLeft();
  const NOTE =
      '光の代わりに、電荷 0 の粒を左上から金属の中の\n'
    + '電子に当てる（粒は金属を素通りする）。押し込まれた\n'
    + '電子は金属の中ではね返り、穴を登る。穴の出口には\n'
    + '電子を引き戻す電場があり、穴を脱出するのに要る\n'
    + '仕事が仕事関数 W。\n'
    + '\n'
    + '【手順】上の ▶実行 を押してから、Enter（または\n'
    + '　プログラム１の ▶実行）で粒を1発ずつ打つ\n'
    + '・½mv² が W に届かないと、電子は引き戻される\n'
    + '・リモコン１で粒の速さを上げ、W を超えると飛び出す。\n'
    + '　運動エネルギーは最大で ½mv² − W\n'
    + '・リモコン３で阻止の電場を強くし、カウンタが止まる\n'
    + '　所で、その最大が読める（qE₂d₂）\n'
    + '\n'
    + '【光を強くしても】遅い粒のまま Enter を速く連打して\n'
    + 'も電子は出ない。エネルギーは粒 1 個ずつでしか渡らない。\n'
    + '光も、エネルギーの粒（光子）の集まりと考えればよい';
  const noteY = p.y + 54 * ts;
  demoNote(p.x, noteY, NOTE, DEMO_NOTE_SIZE * ts);
  demoTitle(p.x, p.y, '光電効果（井戸の模型）', DEMO_TITLE_SIZE * ts);

  // ── つまみ：粒の速さ・障壁の強さ（W）・阻止の電場。本文の下 ──
  const toSY = wy => (wy - cam.y) * cam.zoom + canvas.height / 2;
  const noteBot = toSY(demoNoteBelow(noteY, NOTE, 0, DEMO_NOTE_SIZE * ts));
  const rv = addRemote('prop', pGun, 'body');
  if (rv) { rv.prop = 'speed'; rv.lo = 0; rv.hi = PE_VMAX; }
  const rw = addRemote('prop', fBar, 'emfield');
  if (rw) { rw.prop = 'strength'; rw.lo = 0; rw.hi = PE_EMAX; }
  const rs = addRemote('prop', fStop, 'emfield');
  if (rs) { rs.prop = 'strength'; rs.lo = 0; rs.hi = PE_EMAX; }
  const row = [rv, rw, rs].filter(Boolean);
  const h = Math.max(0, ...row.map(r => r.panel.offsetHeight || 180));
  const top = Math.min(noteBot + 6, canvas.height - h - 170);
  dcPlaceRow(row, 56, top);

  // ── プログラム ──
  const fy0 = (top + h + 8) / canvas.height, dyW = 40 / canvas.height;
  //   ★窓は 8 枚。2 列に並べる（1 列では画面の下からはみ出す）。col は 0／1
  const prog = (b, o, fy, col) => {
    const pg = addProgram(b);
    if (!pg) return null;
    if (col) fy -= 4 * dyW;
    Object.assign(pg, o, { collapsed:true, fx:(56 + (col ? 236 : 0)) / canvas.width, fy });
    pg.reset(); syncProgramState(pg); syncProgramPanel(pg); placeProgramPanel(pg);
    return pg;
  };
    // 粒：Enter（または窓の ▶実行）で1発（ユーザーの希望で手動にした）。★押しっぱなしでは続けて出ない
  //   （keyboard.js が e.repeat を捨てる）＝何発打つかは押した回数そのもの
  prog(pGun, { trigger:'key', key:'Enter', action:'create', scope:'copies',
               limit:PROG_SPAWN_MAX }, fy0);
  // 粒：電子に当たったら消える（吸収された。上の★）
  prog(pGun, { trigger:'hit', hitWhat:'body', action:'delete', target:'self' }, fy0 + dyW);
  // 粒：8m 進んだら消す（当たらずに抜けていったもの）
  prog(pGun, { trigger:'dist', dist:8, times:1, action:'delete', target:'self' }, fy0 + 2 * dyW);
  // 電子：溝のまわりに1個もいなくなったら、元の場所に次の1個（回路から補われる役）
  const nearR = Math.hypot(XR - PX, YB1 - PY) * PX2M + PE_R * PX2M;
  prog(eGun, { trigger:'near', nearR, nearMin:0, nearMax:0, nearWhat:'kin',
               action:'create', scope:'copies', limit:PROG_SPAWN_MAX }, fy0 + 3 * dyW);
  // 電子：登りきれずに止まった瞬間（折り返し）、何にも当たらないレイヤーへ＝金属に落ちて吸い込まれる。
  //   ★下限を 0 にしない。現れたばかりの電子は速さがちょうど 0 で、〈範囲に入った〉と読まれて
  //     生まれた瞬間にすり抜けになる。上限 0.5m/s は、障壁の場がいちばん強い 50V/m でも
  //     1 tick の速さの変化（qE/m·dt ＝ 0.83m/s）の半分より上で、折り返しを取り逃さない。
  prog(eGun, { trigger:'speed', spdMin:0.0001, spdMax:0.5, action:'layers', layers:0b0100 }, fy0 + 4 * dyW, 1);
  // 電子：障壁を登りきったら、何にも当たらないレイヤーへ（外へ出た電子は金属に戻らない。上の★）
  //   ★四角の幅は題材の幅だけ。広くすると枠の破線が本文を横切る（電子はまっすぐ上下にしか動かない）
  const ZT = YB1 - 2, ZB = ZT - 1400;
  prog(eGun, { trigger:'zone', zx:XR, zy:(ZT + ZB) / 2, zw:360, zh:ZT - ZB,
               action:'layers', layers:0b0100 }, fy0 + 5 * dyW, 1);
  // 電子：画面の上へ出たら消す／押し戻されて金属の下へ抜けたら消す
  prog(eGun, { trigger:'zone', zx:XR, zy:YST0 - 400, zw:360, zh:600,
               action:'delete', target:'self' }, fy0 + 7 * dyW, 1);
  prog(eGun, { trigger:'zone', zx:XR, zy:YS + PE_METAL_H + 320, zw:360, zh:600,
               action:'delete', target:'self' }, fy0 + 6 * dyW, 1);
  // ★カウンタの窓は畳む（題名の行に数が出る）。開くと題材の上に掛かる
  if (cnt) { cnt.collapsed = true; cnt.fx = 0.74; cnt.fy = 0.07; syncCounterPanel(cnt); placeCounterPanel(cnt); }
}
