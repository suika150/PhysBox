let particleSpawnPerEvent = 4;      // 1イベント（クリック／ドラッグ1回）で置く粒子数
let particleMaxCount      = 1500;   // 配置上限（液体・気体の合計。旧: ハードコードの 1500）
// ★これから置く粒子に付ける「印」の色。null なら型の色（水は水色・気体は薄い水色）のまま。
//   色は物理に一切効かない。効かせてはいけない：赤い水と青い水は同じ水で、質量も比熱も
//   密度も同じである（違う液体を作る機能ではなく、同じ液体に印を付ける機能）。
//   使いどころは「どの水がどこへ行ったか」を目で追うこと。対流の循環も、混ざって
//   元に戻らないことも、印が無ければ画面には出ない（温度の色は結果しか見せない）。
//   ☆温度で着色（全体設定の「温度で色をつける」）が ON でも、印を付けた粒子は印の色で
//     描かれる（render/preview.js の★）。＝ 印の有無が粒子ごとの選択になるので、
//     「温度で見る水」と「行き先を追う水」を1つのシーンに同居させられる。
let particleColor = null;
// 水：二重密度緩和で「非圧縮＋表面張力」 / 気体：斥力のみで「拡散＋浮力」
const PARTICLE_TYPES = {
  fluid: {
    radius: 5, color: '#29b6f6',
    gravityScale: 1.0,
    restDensity: 4.0,
    stiffness: 13200,      // 旧2200 × 6（重力が gravityGain 撤廃で6倍になった分の静水圧）
    nearStiffness: 33000,  // 旧5500 × 6
    cohesion: true,
    viscosity: 0.05,
    dampRate: 0.06,        // [1/s]（旧 0.999/frame → -ln(0.999)×60）
    jitter: 0,
    density: 1000,         // [kg/m³] 水
    restArea: 126,         // [px²] 静止時に1粒子が占める面積（下の注を参照）
    heatCap: 4182,         // 比熱 c [J/(kg·K)]
    conduct: 0.6,          // 熱伝導率 k [W/(m·K)]
    expansion: 2.07e-4,    // 体膨張率 β [1/K]（20℃の水の実測値）※対流は見えない。①の注を参照
    vizAlpha: 1,           // 温度で着色するときの不透明度
  },
  // ★gas は SPH ではなく気体分子運動論のモデル（js/physics/molecule.js）で動く。
  //   ここに並ぶ SPH のパラメータ（restDensity・stiffness・viscosity・dampRate…）は
  //   一つも持たない。持たせても意味が無いのではなく、持たせると壊れるからである：
  //   減衰は分子を止め、速度クランプはマクスウェル分布の裾を切り、位置ベースの密度緩和は
  //   弾性衝突を上書きする。step.js が型で振り分けるので SPH.update には渡らない。
  gas: {
    radius: 0.5,           // [px] 壁との衝突半径。★理想気体＝分子の大きさは無視する。
                           //   0 にすると押し出し後の点が面上に乗って次のtickで内側判定に
                           //   落ちるので、幾何の余裕として最小限だけ持たせてある。
                           //   これで箱の内寸と気体の体積が 0.4% まで一致する
    drawRadius: 3,         // [px] 描画上の大きさ（見えないと教材にならない）。
                           //   ★衝突半径と別なのはここだけ。上の「大きさを無視する」を
                           //     絵にするための、意図的な食い違いである
    color: 'rgba(120,200,255,0.9)',
    kinetic: true,         // 分子運動論のソルバで動く印（step.js と Particle が見る）
    heatCap: 0,            // ★使わない。熱容量は分子の数から決まる（下の refreshParticleThermal）
    conduct: 0.026,        // [W/(m·K)] 空気。加熱領域の按分にだけ効く
    density: 1.2,          // [kg/m³] 空気（表示・按分用）
    restArea: 450,         // [px²] 1分子が占める面積の目安。★加熱領域が熱を体積で按分する
                           //   ときにだけ使う。力学には一切効かない
    vizAlpha: 0.9,
  },
};
// ── 1粒子が代表する質量と熱容量 ────────────────────────────────────
//   質量 = 密度 × 静止時に1粒子が占める面積 × 奥行き。
//   restArea は静止させて実測した値（水槽の水面下の面積 ÷ 粒子数。幅・粒子数を
//   変えた4条件で 125〜128 px² に収まった＝間隔 11.2px、水なら 1粒子 0.63kg）。
//   SPH のパラメータ（h・restDensity・stiffness）を変えたら測り直すこと。
//   ※ SPH.coupleMass（連成の反作用に使う便宜上の質量 3kg）とはまだ別物。
//     揃えると水が物体を押す力が約1/5になり、前に調整した挙動が変わるので、
//     ここでは熱の側だけを物理量にしてある。統一は連成の再調整とセットで。
//   ★分子（kinetic）だけは別勘定。質量は「代表する分子の数 × 分子1個の質量」で決まり、
//     熱容量も同じく分子の数から出る（C = N k f/2）。奥行きにも restArea にも依らない。
function refreshParticleThermal() {
  const k = PX2M * PX2M * world.depth;
  for (const name in PARTICLE_TYPES) {
    const t = PARTICLE_TYPES[name];
    if (t.kinetic) {
      t._massKg = MOL_PER_DOT * MOL_MASS;
      t._heatC  = MOL_PER_DOT * MOL_KB * MOL_DOF / 2;   // [J/K]
      continue;
    }
    t._massKg = (t.density || 0) * (t.restArea || 0) * k;
    t._heatC  = (t.heatCap  || 0) * t._massKg;        // [J/K]
  }
}
// ─── SPH Fluid/Gas Particle ──────────
class Particle {
  constructor(x, y, type='fluid') {
    this.id = ++uidCounter;
    this.type = type;
    const t = PARTICLE_TYPES[type] || PARTICLE_TYPES.fluid;
    this.prm = t;                  // 型パラメータ参照
    this.x = x; this.y = y;
    this.px = x; this.py = y;      // 前ステップ位置
    this.vx = 0; this.vy = 0;
    this.radius = t.radius;
    this.color = t.color;
    this.gravityScale = t.gravityScale;
    this.T = ROOM_K;               // [K] 温度（既定20℃）
    // ★軌跡。粒子1個ずつに付けられる（物体と同じ「軌跡ツール」でクリックする）。
    //   既定は切ってあり、点の配列は付けたときに初めて作る＝数千個の粒子を置いても
    //   増えるのは1個あたり真偽値1つとヌル参照1つだけ。
    //   これが要るのは、色（印）が「いまどこにいるか」しか見せないためである。
    //   対流の循環のように「同じ水がどの道すじを通ったか」は線でしか出せない。
    this.tracerEnabled = false;
    this.tracePoints = null;
    // ★分子は生まれた瞬間から飛んでいる。速度ゼロで置くと、温度は運動エネルギーの
    //   平均なので「0K の気体を置いた」ことになってしまう。
    if (t.kinetic) molSeedVelocity(this, this.T);
  }
  get heatC() { return this.prm._heatC || 0; }   // [J/K] 熱容量（型ごとに毎tick更新）
}
// ── 粒子の軌跡：点を1つ足して、古い点を捨てる ────────────────────────
//   ★物体（Body.recordTracePoint）と違い、記録点のオフセットも姿勢も無い。粒子は
//     点そのもので、向きを持たないため。回る物体から見た道すじへの読み替え
//     （camera.js）も掛けない：粒子を回転系で追う題材がまだ無く、要るときに足せばよい。
// ★点は毎tickではなく 15Hz で打つ。物体の軌跡（毎tick）と違い、粒子の軌跡は
//   「40秒ぶん残して循環を1周見せる」使い方をするので、毎tickだと1粒子 2,400点＝
//   4粒で 9,600 本の線分を毎フレーム引くことになる。実測：対流のデモで 60fps → 33fps。
//   15Hz なら 1/4 の 600 点で、60fps に戻る。対流の流れは 20px/s 程度なので点の
//   間隔は 1.3px にしかならず、線の形は変わらない。
const PARTICLE_TRACE_HZ  = 15;
const PARTICLE_TRACE_MAX = 1200;   // 1粒子あたりの点の上限（15Hz で 80 秒ぶん）
function recordParticleTraces(dt) {
  const minGap = 1 / PARTICLE_TRACE_HZ - 1e-9;
  for (const p of particles) {
    if (!p.tracerEnabled) continue;
    if (!p.tracePoints) p.tracePoints = [];
    const last = p.tracePoints[p.tracePoints.length - 1];
    if (last && world.simTime - last.t < minGap) continue;
    p.tracePoints.push({ x: p.x, y: p.y, t: world.simTime });
    const cutoff = world.simTime - (p.tracerDuration || tracerDuration);
    let cut = 0;
    while (cut < p.tracePoints.length && p.tracePoints[cut].t < cutoff) cut++;
    if (p.tracePoints.length > PARTICLE_TRACE_MAX)
      cut = Math.max(cut, p.tracePoints.length - PARTICLE_TRACE_MAX);
    if (cut > 0) p.tracePoints.splice(0, cut);
  }
}
// 軌跡を付ける／外す（軌跡ツールと、デモから直接呼ぶ）
function setParticleTracer(p, on, color, duration) {
  p.tracerEnabled = !!on;
  p.tracePoints = on ? [] : null;
  if (on) {
    p.tracerColor = color || tracerColor;
    p.tracerDuration = duration !== undefined ? duration : tracerDuration;
  }
}
// ── 粒子の保存／復元 ──────────────────────────────────────────────
//   数が多いので、復元に必要な最小限（種類・位置・速度）だけを持つ。
//   半径・重力係数・型パラメータの参照(prm)は type から引き直せるので保存しない。
//   小数は2桁に丸める（粒子は数千個になり得るのでファイルサイズに効く）。
//   温度は全部が同じ値のときは書き出さない（20℃のまま使うシーンでファイルを太らせない）。
//   ★色は型の既定と違うときだけ書く。印を付けた粒子（p.color）は「どの水がどこへ行くか」
//     を追うためのもので、色そのものが読みどころなので、保存しないと絵が別物になる。
//     既定色のままの粒子には書かない＝色を使わないシーンのファイルは1バイトも太らない。
function serializeParticles() {
  const r2 = v => Math.round((v || 0) * 100) / 100;
  const uniform = particles.every(p => p.T === (particles[0] ? particles[0].T : ROOM_K));
  const T0 = particles.length ? particles[0].T : ROOM_K;
  return particles.map(p => {
    const o = { t: p.type, x: r2(p.x), y: r2(p.y), vx: r2(p.vx), vy: r2(p.vy) };
    if (!uniform || T0 !== ROOM_K) o.T = Math.round(p.T * 100) / 100;
    if (p.color !== p.prm.color) o.c = p.color;
    // ★軌跡は「付いているかどうか」だけ保存する。溜めた点は保存しない（物体の
    //   tracePoints と同じ扱い＝見せ方だけの一時状態で、読み込み直後は空でよい）。
    if (p.tracerEnabled) { o.tr = 1; o.tc = p.tracerColor; o.td = p.tracerDuration; }
    return o;
  });
}
function deserializeParticles(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (const d of arr) {
    if (!d) continue;
    const p = new Particle(d.x || 0, d.y || 0, d.t || d.type || 'fluid');
    p.vx = d.vx || 0; p.vy = d.vy || 0;
    p.px = p.x; p.py = p.y;
    if (d.T !== undefined) p.T = d.T;      // 無ければ既定の20℃（熱を知らない古いシーン）
    if (d.c) p.color = d.c;                // 無ければ型の色（印を使っていないシーン）
    if (d.tr) setParticleTracer(p, true, d.tc, d.td);
    out.push(p);
  }
  return out;
}
// 粘性パスの半ステンシル：自セル(0,0) と、右上・右・右下・下の4セル。
// 残り4方向は相手側の粒子から見たときにこの4方向になるので、走査は重複も漏れもない。
const SPH_HALF_DX = [0, 1, 1, 1, 0];
const SPH_HALF_DY = [0, -1, 0, 1, 1];
// 浮力を積む面片の状態（SPH._buoyancy の①②。SPH.buoyCrack の★も参照）
const SEG_AIR   = 0;   // 空気に面している（水面より上／開いているのに水がいない）
const SEG_WET   = 1;   // 水に触れている＝静水圧が掛かる
const SEG_CRACK = 2;   // 乾いているが、粒子が入れないほど狭い隙間で固体に接している
const SPH = {
  h: 26,
  maxSpeed: 2000,           // [px/s]（旧500 は 1/6 重力前提。自由落下1秒で ~980 px/s に達する）
  relaxIters: 2,
  // ★走査の向きを交互に反転するための旗（②と④が見る）。理由は②の★に書いた。
  _flip: false,
  // ── 液体の熱膨張の誇張倍率（1＝実物どおりの β。なぜ 1 では足りないかは①の☆）──
  //   ★左80℃・右20℃の壁で挟んだ水槽（600粒子・300tick 時間平均・乱数固定・出荷時の
  //     relaxIters:2）で、上下の温度差と左右の鉛直速度を測った値：
  //         gain   上下温度差   左vy / 右vy    うち熱由来
  //            0     0.29K      -0.13 / +1.39     —（対照）
  //           16     1.95K      -2.82 / +3.67    85%
  //           40     4.36K      -5.38 / +6.26    93%
  //           60     5.09K      -7.36 / +7.58    94%
  //     40 で「膨張を切ると循環が止まる」（4.36K → 0.29K）がはっきり読める。
  //   ★上限はブシネスク近似そのものが決める：β·ΔT·gain ≪ 1 でなければ成り立たず、
  //     ΔT=60K なら gain=80 で係数が 0 ＝ 無重力、それ以上で重力が反転する
  //     （実測：gain=1000 は |vy| が 115px/s へ暴走して破綻した）。一方 Ra を保つ
  //     完全な相似には gain=thermalRate=50000 が要る。＝ 許される最大の誇張でも
  //     相似には約1000倍届かない。これは「一貫性の回復」ではなく誇張である。
  //   ★それでも入れるのは、誇張するのが「対流」ではなく β という材料定数1つだけで、
  //     上昇・下降・循環・成層はそこから勝手に出てくるからである（現象は設計しない）。
  //   ★この定数は UI に出さない。波長の LAMBDA_SIM_K（units.js）と同じ扱いで、
  //     比は保つが絶対値は架空。画面に「40倍」とは書かない代わりに、
  //     **熱膨張の「量」を主題にするデモは作らないこと**：水位の上昇は実物の20倍出る
  //     （80℃で水柱の12%。実物の水は 20→80℃ で2%）。
  //   ★他の水回りへの影響：20℃ちょうどでは係数が厳密に 1 なので、水を温めないデモは
  //     1ビットも変わらない。浮力デモの水は落下物の衝突熱で 2.069e-7K だけずれるが、
  //     重力係数の変化は 2e-9 相対で、系統的な差は出ない（沈み具合の理論値からの誤差は
  //     4条件の平均で 4.1 → 4.3 ポイント、ばらつき 1.7 ポイントの中）。
  expandGain: 40,
  // ★押し出しの反作用は「水が物体を叩く」ぶんだけに落とした（旧 0.15 / 減衰 1.0）。
  //   静止した水が物体を支える力＝浮力は _buoyancy が正面から出すようになったので、
  //   ここまで強いと二重計上になる。とくに減衰項は「粒子が近づくときだけ」効く片側の
  //   抵抗なので、静止した水の中で細かく震える粒子から一方向の力を拾い続け、
  //   実測で 71N の球を 41N も持ち上げていた（＝水より重い物体まで浮いていた）。
  //   この値と減衰0で、水槽に浮かべた球の沈み具合は 12/39/59/78%（理論 20/40/60/80%）。
  //   ちなみに 0（押し出しの反作用なし）だと 10/45/68/87% で沈みすぎる。
  //   ☆2026-09-27 に水面の見積もりを直したあと（_buoyancy の☆）は、1個ずつの沈み具合は
  //     0.02 と 0 で小数第1位まで同じ（21.5/42.1/62.4/79.0%）。浮力デモの密度400 も
  //     34.9 / 36.1% でばらつきの中（どちらも重力の積分を直す前の値）。上の数字は旧来の
  //     水面での値で、いまは浮きを担っていない。
  coupleGain: 0.02,
  coupleMass: 3,            // [kg 相当]
  coupleMaxImpulse: 30,     // [kg·px/s]（旧0.5 × 60）
  // ── 粒子→物体の連成をならす（コップに水を入れると器があらぶるのを止める）──────
  //   押し出し量そのものを、tick の最後に力積として直接叩き込んでいた。その速度は
  //   接触ソルバを通らないまま次tickの積分で位置に化けるので、床に置いたコップが
  //   毎tick わずかに浮いては落ちる。実測では「1tickも動かなかったtickの割合」が
  //   24%（＝4tickに3回は微動している）。しかも押し出し量に比例する力だけで減衰が
  //   ないので、一度ずれると揺れが止まらない。
  //   そこで (1) 法線相対速度による減衰を足し、(2) 物体ごとに合計してから
  //   時定数 coupleTau でなまし、(3) 物体自身の重さを基準に総量を頭打ちにする。
  //   なました力は step.js がサブステップの中で「力」として掛ける。接触ソルバが
  //   同じサブステップで受け止めるので、床に載った器は押し返されて動かない。
  //   ★(1) の減衰だけは 0 にした。器の静止は (2)(3) と gain を下げたことで足りていて
  //     （静止率 1.00・ずれ 1.3px は減衰 0.1 のときと変わらない）、残すと浮きが狂う。
  //     「近づく向きのときだけ」効く片側の抵抗なので、静止した水の中で震える粒子から
  //     上向きの力だけを拾い続ける。密度800の球（重さ71N）で押し出しが 27N も出て、
  //     浮力と合わせて 52% しか沈まなかった（理論 80%）。0 にすると 78% まで戻る。
  coupleDamp: 0,            // 法線相対速度に対する減衰の強さ（0で減衰なし。上の注を参照）
  coupleTau: 0.10,          // [s] 連成力のなまし時定数。0以下でなましOFF
  // 連成力の上限（物体自身の重さの何倍まで）。1＝「水は物体の自重を支えるところまで。
  // それ以上の加速はさせない」。水中の軽い物体が水にはたかれて暴れるのを止める
  // （8 だと平均 85px/s で揺すられ続け、1 なら 33px/s。コップの静止性はどちらでも同じ）。
  coupleMaxG: 1,
  coupleWakeG: 0.05,        // これ以下の連成力では物体を起こさない（重さ比）
  // ── 浮力（_buoyancy 参照）──────────────────────────────────
  //   ★上限（coupleMaxG）は掛けない。浮力は ρVg で頭打ちになっている量なので、
  //     自重の1倍で切ると「水より軽いのに浮き上がれない」状態そのものになる。
  //     揺れを抑えるのは上限ではなく、下の粘性抵抗となまし（coupleTau）の役目。
  buoyZeta: 1.0,            // 浮力ばねの臨界減衰に対する比（1で振動せずに落ち着く）
  buoyAngZeta: 1.0,         // 同・回転ぶんの倍率（浮いた物体の首振りを止める）
  //   ★なましは連成（0.10s）より短くする。浮力は「押し出しの回数」ではなく水面の高さから
  //     決まる幾何量なので、もともと滑らかで長くなます必要がない。むしろ軽い物体では
  //     固有周期（スポンジで 0.09秒）に近い遅れが煽りになる。
  buoyTau: 0.04,            // [s] 浮力のなまし時定数
  buoySegPx: 6,             // [px] 表面を刻む長さ（細かいほど正確・重い）
  buoyProbe: 4,             // [px] 「濡れているか」を見る点を、面からどれだけ外に取るか
  buoyLevelPool: true,      // 水面をひとつながりの水の静水面で決める（false は旧来＝対照）
  buoyLevelPad: 1,          // 水面を見る列を物体の幅からどれだけ外へ広げるか（列数）
  buoyWet: 9,               // [px] この距離に水粒子がいれば濡れているとみなす（粒子間隔 11px）
  // ── 接している面にも水は入り込む（狭い隙間ごしに濡れを伝える）──────────────
  //   ★底に着いた物体は、下面の粒子が押し出されて面が「乾く」。すると残るのは上面の
  //     水圧だけ＝**下へ吸い付く**ので、密度をいくら下げても浮き上がらない。
  //     実測（乱数固定・900tick 落ち着かせ）：密度2000 で底に沈めたブロックを 400 に
  //     変えても、下面の濡れは 0%・沈み具合 100% のまま **1px も動かなかった**。
  //     直したあとは 154px 浮き上がって沈み具合 60.8% で落ち着く＝はじめから密度400 で
  //     落としたとき（62.2%）と同じところ＝「あとから密度を変えても同じ」になる。
  //     水の粒子は間隔 11.2px なので、それより狭い隙間には原理的に1個も入れない。
  //     つまりこれは水の**解像度の穴**で、物理ではない（現実の水は必ず入り込む）。
  //   ★そこで「圧力は水につながっている面に掛かる」を面のつながりで決める。輪をひと回り
  //     しながら、濡れた面片から**固体に接している**（隙間が粒子間隔より狭い）面片へ
  //     濡れを伝える。空気に面した乾いた面片は伝えない＝そこで止まる。
  //   ★止め方がこの規則の要である。「接している面はぜんぶ濡らす」（buoyCrackChain:false）に
  //     すると、水を入れたコップの**外底**（地面との接触面）まで濡れて、コップが自分の
  //     水で浮き上がる。実測（地面に置いた密度600の動くコップ・水630個・乱数固定）：
  //         つながりで決める（現在）  最大上昇 0.0px  静止率 0.998   ← 機能OFFと同じ
  //         接触面をぜんぶ濡らす      最大上昇 13.4px 静止率 0.000   ← 浮いて震え続ける
  //     つながりで決めれば外底へは濡れが届かない（輪をたどると、空気に面した外壁で
  //     切れる）。水面より上の面片も同じ理屈で壁になる＝コップの内壁は水面で切れるので、
  //     内側の水の濡れが縁を越えて外側へ回り込むこともない。
  //   ★浮いている物体には効かない（下面がもともと濡れているため）。実測で確かめてある：
  //     1個ずつ7条件（密度200〜1500）の沈み具合は 37.4/62.2/86.6/100/100/100/100% で
  //     機能OFFと小数第1位まで同じ。浮力デモ3つ同時だけ 73.6 → 71.6%（底に着いた石が
  //     床を押す力が変わったぶん、水の乱れ方が変わる。理論 40% からの隔たりは
  //     どちらも同じ大きさで、原因は水面の見積もり＝_buoyancy の ☆★★ のほう）。
  //     （この段の数字は水面を直す前の値。水面の話は _buoyancy の☆に移した）
  //   ★水中で2段に重ねた石（下の上面・上の下面がどちらも乾く）も直る。実測：密度400を
  //     2つ重ねると、機能OFF では下の石だけ底に貼りついて動かず（+0px／上は +118px）、
  //     ONでは2つとも浮き上がる（+138px／+105px）。
  //   ★計算時間は同条件のばらつきの中で読めない（浮力デモ・水630個で 8.4〜9.6ms/tick を
  //     ON/OFF が同じように跨ぐ）。乾いた面片1枚につき3点×物体数の内外判定が増えるだけで、
  //     乾いていて水面より下の面片はもともと少ない。
  buoyCrack: 12,            // [px] この距離に固体があれば「水が入れない狭い隙間」とみなす
                            //   （粒子間隔 11.2px。0 で機能OFF＝対照用）
  buoyCrackChain: true,     // 濡れた面からつながった隙間だけ濡らす（false は対照。上の★）
  // [px] 熱の「触れている」判定の余裕（粒子の半径に足す）。_collideBodies の★を参照
  thermalTouchPad: 4,
  // ── はさまれた粒子を横へ逃がす歩幅（粒子の半径に対する比。_squeezeOut 参照）──
  //   ★1tick あたり半径の 0.3 倍＝1.7px（100px/s）。一気に出さないのは、位置差分が
  //     そのまま速度になるため：73px のブロックの真ん中にいる粒子を1tickで出すと
  //     36px/tick ＝ 2200px/s になり、水面まで弾き飛ぶ。
  squeezeStep: 0.3,

  // ── 壁を「鏡像の粒子」として緩和に参加させる ──────────────────────
  //   ★密度緩和（④）には壁が存在しない。だから水柱の重みを受け止めるものが底に無く、
  //     いちばん下の層は毎tick 床の中へ押し込まれ、そのあとの押し出し（⑤）で
  //     戻される。これが「壁ぎわの水があらぶる」の正体だった。
  //     実測（コップの水630個・落ち着かせてから600tickの平均）：底の粒子は
  //     1tickに **法線方向へ 1.30px・接線方向へ 0.26px** 動く＝横滑りではなく
  //     上下に出入りしている。重力を切ると壁ぎわの震えは 98.5→29.1px/s と
  //     中のほう（29.9）まで落ちる＝水柱の重みが原因だと分かる。
  //   ☆先に「壁で欠けた密度 rho を解析的に足す」を試したが効かなかった（98.5→101.2px/s）。
  //     この水は rho≈1.85 に対し restDensity=4.0 で、derr はどこでも凝集側の下限 −0.5 に
  //     張りついている＝密度拘束そのものが効いていないので、rho に足しても飲み込まれる。
  //     壁ぎわと中の密度も 1.86 対 1.83 でほぼ同じだった（＝欠けてすらいなかった）。
  //     ☆緩和を「分割せず収束させる」も逆効果（反復2/4/8 で 105.6／110.3／124.4px/s）。
  //   そこで壁の向こう側に**鏡像の粒子**を置く。距離 d の粒子に対して 2d の位置に
  //   相手がいることにすれば、近接圧力（斥力）がそのまま壁の押し返しになる。
  //   ・鏡像は動かないので、実体が変位を**全部**受け取る（対等な2粒子なら半分ずつ）。
  //   ・面と法線は tick に一度だけ探し、反復の中では d を法線への射影で引き直す
  //     （粒子は反復中に 1px 程度動く。射影なら平らな面に対して厳密）。
  //   ★これと「押し出しを速度に数えない」（⑤の★）は**セットで効く**。実測
  //     （コップの水630個・1200tick落ち着かせて600tickの平均、何も動かさない）：
  //         直す前              壁ぎわ 98.5px/s  中 30.9px/s  静止率 0.000/0.003
  //         押し出し→速度だけ止める  壁ぎわ 96.1     中 11.6     静止率 0.000/0.004
  //         ＋壁の鏡像（現在）      壁ぎわ **18.7**  中 **8.5**  静止率 0.016/0.011
  //     押し出しを速度から外すだけでは壁ぎわは下がらない（毎tick押し込まれる原因が
  //     残るため）。鏡像だけでも、押し出しぶんが速度に化けるので効きが半分になる。
  //   ★副作用：水が静かになったぶん、**水はひとりでに掻き混ざらなくなった**
  //     （水の平均速さ 40.6 → 5.7px/s）。熱を水全体へ配るのに時間がかかるので、
  //     熱量保存のデモは thermalRate を上げてある（あちらの★）。熱量の合計は
  //     どちらでも 100.0% のまま＝保存は壊れていない。
  //   ★浮力は理論値へ寄った：沈み具合 26/78/100% → 29/94/100%（理論 40/100/100）。
  //     とくに「水と同じ密度」が 78→94% と中性浮力に近づいた。震える水が物体を
  //     下から叩く力を過大に出していたぶんが消えたためである。
  wallMirror: true,          // 切って対照を取るための旗（既定ON）
  // ── 隅では鏡像を「2面ぶん」立てる ────────────────────────────────
  //   ★いちばん近い面ひとつだけを鏡像にすると、壁と床が交わる**隅だけ**が直らない。
  //     実測（コップの水630個・乱数固定・900tick 落ち着かせて 400tick の時間平均。
  //     何も動かさない静止した水。単位 px/s）：
  //                        隅     壁ぎわ  床ぎわ  中
  //         鏡像なし      114.1    87.3    65.4   6.8
  //         1面だけ        57.6     4.1    14.7   5.4   ← 平らなところは直りきっている
  //         2面（現在）  **14.6**   3.3    11.3   4.1
  //     壁ぎわ・床ぎわは1面で 1/20 まで落ちているのに、隅だけが桁で残っていた。
  //     真因は「どちらの面がいちばん近いか」が tick ごとに入れ替わること。隅の粒子は
  //     **7〜15% の tick で鏡像の向きが 90 度飛んでいた**（壁ぎわ・床ぎわは 0%）。
  //     床の鏡像に押されて壁へ寄る → 次tickは壁のほうが近いので鏡像が壁へ移り、
  //     床の支えが消える → 落ちる、の往復になる。2面を同時に立てれば往復しない。
  //   ★同じ向きの面は近いほうだけを残す（1枚の平らな壁を辺2本で二度数えると、
  //     その向きの押し返しが倍になる）。向きの食い違いは mirrorSepCos で見る。
  //   ★物体の中に入り込んだ粒子には鏡像を立てない。中では「面から粒子へ」の向きが
  //     内向きになり、鏡像がかえって奥へ押し込む。中の粒子は押し出し（⑤）の担当。
  //     ☆実測では効かなかった（浮力の沈み具合は7条件とも同じ値）。中に入る粒子が
  //       そもそも少ないため。それでも残すのは、鏡像法が面の外側でしか定義できない
  //       からで、面を2つ拾うようになった以上「中の粒子に向きの違う鏡像が2つ付く」
  //       状態を作らないため（1面のときは高々1つだったので表に出なかった）。
  //   ★他への影響（どちらも乱数固定・時間平均で対照と並べて確認した）：
  //     ・浮力：沈み具合の理論値からの誤差は 12.4 → 12.3 ポイントで変わらず
  //       （デモの木 400 は 68.7 → 64.0%。理論 40% から遠いのは水面の見積もりの
  //         別件で、_buoyancy の ☆★★ を参照）。
  //     ・対流デモ：中央のプルームはむしろ強まった（列ごとの vy の中央が
  //       −16.7 → −21.0px/s）。上下の平均温度は 32.2/26.7 → 31.5/25.9℃ で
  //       温度差 5.5 → 5.6K ＝ 本文に書いた数字（32.8/26.9）はそのまま通る。
  //     ・1tick の計算時間は 7.1 → 7.0〜8.3ms（水630個。ばらつきの中で差は読めない）。
  mirrorFaces: 2,            // 立てる面の数。1 に落とすと以前の挙動（対照用）
  mirrorSepCos: 0.7,         // 別の面とみなす法線の食い違い（0.7 ≒ 45度）
  mirrorSkipInside: true,    // 物体の中の粒子に鏡像を立てない（対照を取るための旗）
  // 候補の置き場（毎tick 粒子ごとに使い回す＝確保ゼロ）
  _wcand: [{ x:0, y:0, d:0, ux:0, uy:0 }, { x:0, y:0, d:0, ux:0, uy:0 }],
  _wcn: 0,
  // 浮力の面片の置き場（毎tick 物体ごとに使い回す。中点・外向き法線・長さ・深さ・状態・輪）
  _segMx: [], _segMy: [], _segNx: [], _segNy: [], _segDs: [], _segDp: [],
  _segSt: [], _segLoop: [],
  // 面の候補を1つ差し出す。同じ向きなら近いほうを残し、違う向きなら別枠で持つ
  _offerSurface(p, qx, qy, d) {
    const nx = p.x - qx, ny = p.y - qy;
    const l = len(nx, ny);
    if (l < 1e-6) return;                        // 面の上は押し出し（⑤）に任せる
    const ux = nx/l, uy = ny/l;
    const c = this._wcand;
    for (let i = 0; i < this._wcn; i++) {
      if (c[i].ux*ux + c[i].uy*uy > this.mirrorSepCos) {
        if (d < c[i].d) { c[i].x = qx; c[i].y = qy; c[i].d = d; c[i].ux = ux; c[i].uy = uy; }
        return;
      }
    }
    const cap = Math.min(this.mirrorFaces, c.length);
    if (this._wcn < cap) {
      const s = c[this._wcn++]; s.x = qx; s.y = qy; s.d = d; s.ux = ux; s.uy = uy;
      return;
    }
    let w = 0;                                   // 枠が埋まっていたら遠いほうを追い出す
    for (let i = 1; i < this._wcn; i++) if (c[i].d > c[w].d) w = i;
    if (d < c[w].d) { c[w].x = qx; c[w].y = qy; c[w].d = d; c[w].ux = ux; c[w].uy = uy; }
  },
  // 点の近く（h 以内）にある表面を、向きの違うものだけ _wcand に集める
  _collectSurfaces(p) {
    const h = this.h, h2 = h*h;
    this._wcn = 0;
    if (world.terrain && ground.layers !== 0) {
      const d = signedDistToGround(p.x, p.y);
      if (d < h) {
        const nx = Math.sin(ground.angle), ny = -Math.cos(ground.angle);
        this._offerSurface(p, p.x - nx*d, p.y - ny*d, d > 0 ? d : 0);
      }
    }
    for (const b of objects) {
      if (_ghostBody(b)) continue;
      const a = b._aabb;
      if (p.x < a.minX - h || p.x > a.maxX + h ||
          p.y < a.minY - h || p.y > a.maxY + h) continue;
      if (this.mirrorSkipInside && b.containsPoint(p.x, p.y)) continue;  // 中は押し出しの担当
      if (b.type === 'circle') {
        const dx = p.x - b.x, dy = p.y - b.y, dl = len(dx, dy) || 1e-9;
        const d = Math.abs(dl - b.radius);
        if (d < h) this._offerSurface(p, b.x + dx/dl*b.radius, b.y + dy/dl*b.radius, d);
        continue;
      }
      const outline = b._localOutline();
      if (!outline || outline.length < 3) continue;
      const c1 = Math.cos(-b.angle), s1 = Math.sin(-b.angle);
      const c2 = Math.cos(b.angle), s2 = Math.sin(b.angle);
      const ux = p.x - b.x, uy = p.y - b.y;
      const lx = c1*ux - s1*uy, ly = s1*ux + c1*uy;
      const scan = loop => {
        const nn = loop.length;
        for (let i = 0; i < nn; i++) {
          const s = loop[i], e = loop[(i+1) % nn];
          const ex = e.x-s.x, ey = e.y-s.y;
          const eL2 = ex*ex + ey*ey || 1e-6;
          let t = ((lx-s.x)*ex + (ly-s.y)*ey) / eL2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = s.x + ex*t, cy = s.y + ey*t;
          const d2 = (lx-cx)*(lx-cx) + (ly-cy)*(ly-cy);
          if (d2 >= h2) continue;
          this._offerSurface(p, b.x + cx*c2 - cy*s2, b.y + cx*s2 + cy*c2, Math.sqrt(d2));
        }
      };
      scan(outline);
      if (b.type === 'polygon' && b.holes) for (const hl of b.holes) if (hl.length >= 3) scan(hl);
    }
  },
  _measureWalls(pts) {
    const c = this._wcand;
    for (const p of pts) {
      this._collectSurfaces(p);
      p._wn = this._wcn;
      if (this._wcn > 0) { p._wqx = c[0].x; p._wqy = c[0].y; p._wnx = c[0].ux; p._wny = c[0].uy; }
      if (this._wcn > 1) { p._wqx2 = c[1].x; p._wqy2 = c[1].y; p._wnx2 = c[1].ux; p._wny2 = c[1].uy; }
    }
  },

  // ── 近傍探索用の空間ハッシュ ────────────────────────────────────
  //   1ティックに3回作り直すので、Map と各セルの配列を毎回確保するのをやめ、
  //   計数ソートで使い回しの TypedArray へ詰める（確保ゼロ＝GC負荷なし）。
  //   セルは開番地法のハッシュ表で「厳密なセル座標」を持たせる。ハッシュ値だけで
  //   束ねると衝突した別セルの粒子が紛れ込み、3×3走査で同じ粒子を二度処理して
  //   力が二重にかかる（Map 版は完全なキーだったのでこの問題がなかった）。
  //   セル内は pts の順、セルの走査順も dx,dy の入れ子のままなので、
  //   近傍の並びは Map 版と一致する＝計算結果は変わらない。
  _g: {
    pts: null, gen: 0, mask: 0,
    cell:  new Int32Array(0),   // 粒子 → セルのスロット番号
    order: new Int32Array(0),   // セル順に並べ替えた粒子番号
    slots: new Int32Array(0),   // このフレームで使われたスロットの一覧
    used: 0,
    start: new Int32Array(0),   // スロット → order 内の開始位置
    count: new Int32Array(0),   // スロット → そのセルの粒子数
    keyX:  new Int32Array(0), keyY: new Int32Array(0),
    stamp: new Int32Array(0),   // スロットの使用世代（表のクリアを省くため）
  },
  _ensureGrid(n) {
    const g = this._g;
    if (g.cell.length < n) {
      const cap = Math.max(256, n * 2);
      g.cell = new Int32Array(cap); g.order = new Int32Array(cap); g.slots = new Int32Array(cap);
    }
    let size = 64;
    while (size < n * 2) size <<= 1;          // 表は最大でも半分までしか埋まらない＝探索は必ず終わる
    if (g.mask !== size - 1) {
      g.mask = size - 1;
      g.start = new Int32Array(size); g.count = new Int32Array(size);
      g.keyX  = new Int32Array(size); g.keyY  = new Int32Array(size);
      g.stamp = new Int32Array(size);
      g.gen = 0;                              // 新しい stamp は全部0なので世代は1から
    }
    return g;
  },
  _buildGrid(pts) {
    const n = pts.length, h = this.h, g = this._ensureGrid(n);
    const gen = ++g.gen, mask = g.mask;
    const cell = g.cell, order = g.order, slots = g.slots;
    const start = g.start, count = g.count, keyX = g.keyX, keyY = g.keyY, stamp = g.stamp;
    g.pts = pts;
    let used = 0;
    // ① 各粒子のセルを引き（無ければ作り）、セルごとの個数を数える
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const cx = Math.floor(p.x/h), cy = Math.floor(p.y/h);
      let s = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & mask;
      for (;;) {
        if (stamp[s] !== gen) { stamp[s] = gen; keyX[s] = cx; keyY[s] = cy; count[s] = 0; slots[used++] = s; break; }
        if (keyX[s] === cx && keyY[s] === cy) break;
        s = (s + 1) & mask;
      }
      cell[i] = s; count[s]++;
    }
    // ② 前置和で各セルの開始位置を決め、pts の順のままセル別に詰める
    let acc = 0;
    for (let k = 0; k < used; k++) { const s = slots[k]; start[s] = acc; acc += count[s]; count[s] = 0; }
    for (let i = 0; i < n; i++) { const s = cell[i]; order[start[s] + count[s]++] = i; }
    g.used = used;
    return g;
  },
  // セル座標 → スロット番号（未使用セルは -1）
  _slot(g, cx, cy) {
    const mask = g.mask, gen = g.gen, stamp = g.stamp, keyX = g.keyX, keyY = g.keyY;
    let s = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & mask;
    for (;;) {
      if (stamp[s] !== gen) return -1;
      if (keyX[s] === cx && keyY[s] === cy) return s;
      s = (s + 1) & mask;
    }
  },
  _neighbors(g, p, out) {
    out.length = 0;
    const cx = Math.floor(p.x/this.h), cy = Math.floor(p.y/this.h);
    const pts = g.pts, order = g.order, start = g.start, count = g.count;
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) {
      const s = this._slot(g, cx+dx, cy+dy);
      if (s < 0) continue;
      const b = start[s], e = b + count[s];
      for (let k = b; k < e; k++) out.push(pts[order[k]]);
    }
    return out;
  },
  update(pts, dt) {
    if (!pts.length) return;
    dt = Math.min(dt, 0.033);
    const h = this.h, dt2 = dt*dt;
    const nb = [];
    const thermal = !!world.thermalOn;
    if (thermal) refreshParticleThermal();       // 型ごとの質量・熱容量（奥行きに依存する）
    // ① 外力（★gravityGain 撤廃：真の重力加速度をそのまま使う）
    for (const p of pts) {
      const t = p.prm;
      // ★熱膨張（ブシネスク近似）：温まった液体は軽くなる。密度そのものは動かさず
      //   （SPH の静止密度は個数密度なので、いじると密度拘束自体が揺れる）、重力の
      //   ぶんだけ g(1 − β(T−T₀)) にする。対流の教科書どおりの入れ方。
      //   20℃ ちょうどでは係数が厳密に 1 ＝ 従来と1ビットも変わらない。
      //
      //   ☆実物の β のままでは自然対流は見えない。ただし「起きていない」のではなく
      //     「弱すぎて見えない」である。左80℃・右20℃の壁で挟んだ水槽（600粒子・
      //     300tick 時間平均・乱数固定）で、熱膨張を切った対照と比べると：
      //         gain= 0（対照）  上下温度差 0.29K   左vy -0.13 / 右vy +1.39
      //         gain= 1（実物）  上下温度差 1.0K 前後（下の expandGain の表を参照）
      //     温かい水が上、冷たい水が下に確かに分かれ、左で上がって右で下がっている。
      //     見えないのは水自身のゆらぎが常時 28px/s あり、信号がその 1/20 だからである。
      //     ※以前ここには「β·ΔT·g は ΔT=50K でも 0.01 m/s²」とあったが、0.01035 は
      //       β·ΔT（無次元）で、加速度は g を掛けた 0.101 m/s² ＝ 10px/s² が正しい。
      //   ★弱い原因は β ではなく world.thermalRate（既定 50000）である。対流と伝導の
      //     勝負はレイリー数 Ra ∝ 1/α そのもので、熱伝導を5万倍速くすると対流の効きが
      //     5万分の1になる。実物のこの水槽（3.4m×2.3m・60K差）は激しく対流する。
      //     ＝ このエンジンは熱を5万倍の時計で、力学を実時間の時計で回している。
      //       対流はその両方にまたがる唯一の現象なので、必ずどちらかと食い違う。
      //     熱の側を遅くする逃げ道は塞がっている：thermalRate を下げると熱源（恒温壁）も
      //     同じ熱コンダクタンスを通るので熱が入らなくなり（rate=1 では8秒で温度差0.00K）、
      //     それを迂回する加熱領域は上限 5000W で、この水 378kg では10秒で 0.03K にしかならない。
      //   ★静止密度を下げる形での膨張も試したが、こちらは筋が悪い。水の実際の膨張は
      //     0〜100℃で4%しかないのに、見えるまで誇張すると restDensity が 0 に近づいて
      //     水が崩壊する（倍率30で31%減、倍率100でほぼ0）。
      const gs = (thermal && t.expansion)
               ? t.gravityScale * (1 - t.expansion * this.expandGain * (p.T - ROOM_K))
               : t.gravityScale;
      p.vx += gravPxX() * gs * dt;
      p.vy += gravPxY() * gs * dt;
      if (t.jitter) {                                   // ★フレームレート非依存化
        // ★熱運動：2次元の等分配則で v_rms = √(2kT/m) ∝ √T なので、振れ幅を √(T/T₀)
        //   倍する。温めた気体ほど激しく飛び回り、そのぶん広がる（＝圧力が上がる）。
        //   これも 20℃ で厳密に 1 倍。液体は jitter が 0 なので影響しない
        //   （SPH の1粒子は分子ではなく 0.63kg の水の塊なので、分子の熱運動を
        //    粒子の震えとして出すのは筋が違う。水の温度応答は上の熱膨張が担う）。
        const jt = t.jitter * Math.sqrt(60 * dt)
                 * (thermal ? Math.sqrt(Math.max(0, p.T) / ROOM_K) : 1);
        p.vx += (Math.random()-0.5)*jt; p.vy += (Math.random()-0.5)*jt;
      }
      const f = Math.exp(-t.dampRate * dt);             // ★指数減衰
      p.vx *= f; p.vy *= f;
    }
    // ② 粘性：近傍ペアの相対速度を平滑化（対称に適用＝運動量保存）
    //    ★半ステンシル：この処理はペア (i,j) につき一度だけ効かせればよい。
    //      3×3の9セルを全部集めてから半分を id で捨てていたのをやめ、
    //      自セル（番号が大きい相手だけ）＋右まわり4セルの計5セルだけを見る。
    //      HALF_D* の4方向はその逆向きが他方の粒子から見た向きになるので、
    //      隣り合う8セルの組み合わせがちょうど一度ずつ覆われる。
    //    ★②も④も、更新した結果をその場で次の粒子が読む（ガウス・ザイデル）。
    //      配列の先に居る粒子ほど「先に動ける」ので、走査の向きがそのまま系統的な
    //      流れになる。実測：熱を切った一様20℃の密閉水槽（600粒子・300tick 時間平均）で
    //      左vy=-4.11 右vy=+5.91 上vx=+7.56 下vx=-7.87 ＝ 4象限の符号が閉じた一個の渦が
    //      定常的に回っていた（理想は全部 0）。粒子配列をランダムに並べ替えると半減し、
    //      relaxIters を 8 に上げるとほぼ消えた（0.71/0.79/0.83/-0.17）ことから、
    //      原因は近傍探索でも時間刻みでもなく走査順そのものだと切り分けた。
    //    ★そこで向きを交互に反転する（対称ガウス・ザイデル）。前半で「先に動けた」側が
    //      後半では最後に回るので、一次の偏りが打ち消し合う。計算量は増えない
    //      （relaxIters を上げる手も効くが、実測 1tick 6.54ms → 22.79ms で 3.5 倍かかる）。
    //    ★②は tick に1回しか回らないので tick ごとに反転する（_flip）。④は反復ごとに
    //      反転するので、relaxIters が偶数なら1tick の中で閉じる。
    const h2 = h * h;                              // ★半径外の粒子で sqrt を省くため
    const n = pts.length;
    this._flip = !this._flip;
    const vFwd = this._flip;
    let grid = this._buildGrid(pts);
    for (let ii = 0; ii < n; ii++) {
      const i = vFwd ? ii : n - 1 - ii;
      const pi = pts[i];
      const cx = Math.floor(pi.x/h), cy = Math.floor(pi.y/h);
      for (let c = 0; c < 5; c++) {
        const s = this._slot(grid, cx + SPH_HALF_DX[c], cy + SPH_HALF_DY[c]);
        if (s < 0) continue;
        const b = grid.start[s], e = b + grid.count[s];
        for (let k = b; k < e; k++) {
          const j = grid.order[k];
          if (c === 0 && j <= i) continue;          // 自セルは番号が大きい相手のみ
          const pj = pts[j];
          const dx = pj.x-pi.x, dy = pj.y-pi.y;
          const r2 = dx*dx + dy*dy;
          if (r2 >= h2) continue;                   // ★先に二乗で判定
          const r = Math.sqrt(r2);
          const a = 1 - r/h;
          const kv = (pi.prm.viscosity + pj.prm.viscosity) * 0.5 * a * 0.5;
          const dvx = (pj.vx-pi.vx)*kv, dvy = (pj.vy-pi.vy)*kv;
          pi.vx += dvx; pi.vy += dvy;
          pj.vx -= dvx; pj.vy -= dvy;
          // ══ 粘性の散逸を熱にしてはいけない（試して撤回した。繰り返さないこと）══
          //   この平滑化は運動量を保つが運動エネルギーは必ず減り、等質量なら
          //       ΔE = −m·kv·(1−kv)·|相対速度|²
          //   になる。摩擦も非弾性衝突も抗力も addDissipatedHeat で熱にしているのだから、
          //   ここも熱にすれば「羽根車で水を温めるジュールの実験」が作れる——と考えて
          //   実装したが、**控えを取ったら結論が逆転した**：
          //     ・何も落とさない静止した水だけで、60秒に 34,925J が発生した
          //       （264粒子・166kg で水温 +0.05℃／分。relaxIters を 8 にしても 33,792J）
          //     ・同じ水へ 20kg のおもりを 2.9m 落とすと熱は 38,439J。位置エネルギー
          //       565J に対して 68倍で、おもり由来はわずか 1.5%
          //   つまりこの相対速度の大半は物理的なせん断ではなく、**非圧縮を保つための
          //   数値振動**である（⑤で速度を位置差分から作り直すので、密度緩和の往復が
          //   そのまま「相対速度」に化ける）。これを熱にすると、静置した水が
          //   ひとりでに温まり続ける系になる。
          //   ★だから SPH の水は「かき混ぜても温まらない」ままにしてある。仕事を熱に
          //     変えて見せる題材は、散逸が実体のある剛体の摩擦（addFrictionHeat）で
          //     組むこと（ジュールの実験のデモがそうしている）。
          // ★熱伝導はこの走査に相乗りさせる。ここは既にペアを一度だけ訪れ、
          //   距離 r と重み a を計算し終えている。専用のループを別に立てて
          //   近傍探索をやり直すと桁違いに高くつく（相乗りなら実測 +0.2%）。
          if (thermal) {
            const ti = pi.prm, tj = pj.prm;
            const Ci = ti._heatC, Cj = tj._heatC;
            if (Ci > 0 && Cj > 0) {
              const ri = pi.radius * PX2M, rj = pj.radius * PX2M;
              const area = (ri + rj) * world.depth * a;   // 近いペアほど広く接するとみなす
              // ★温度はここでは動かさず、網へ登録するだけ（thermal.js 熱の網の★）。
              //   網は tick の頭の温度で解くので、この走査の向き（_flip）にも依らなくなる。
              heatNetLink(HN_PART, pi, HN_PART, pj, thermalConductance(ti.conduct, ri, tj.conduct, rj, area));
            }
          }
        }
      }
    }
    // ③ 速度で予測位置へ移動（速度は最後に位置差分から再計算＝位置ベース法）
    const vmax2 = this.maxSpeed * this.maxSpeed;
    for (const p of pts) {
      const sp2 = p.vx*p.vx + p.vy*p.vy;
      if (sp2 > vmax2) { const k = this.maxSpeed / Math.sqrt(sp2); p.vx *= k; p.vy *= k; }
      p.px = p.x; p.py = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    // ④ 二重密度緩和（Clavet 2005）：圧力＋近接圧力で位置を直接補正
    if (this.wallMirror) this._measureWalls(pts);   // ★壁の鏡像（_measureWalls の★）
    for (let it = 0; it < this.relaxIters; it++) {
      grid = this._buildGrid(pts);
      const rFwd = (it % 2 === 0) === this._flip;   // ★向きを反復ごとに反転（②の★）
      for (let ii = 0; ii < n; ii++) {
        const pi = pts[rFwd ? ii : n - 1 - ii];
        const t = pi.prm;
        let rho = 0, rhoN = 0;
        this._neighbors(grid, pi, nb);
        for (const pj of nb) {
          if (pj === pi) continue;
          const dx = pj.x-pi.x, dy = pj.y-pi.y;
          const r2 = dx*dx + dy*dy;
          if (r2 >= h2) continue;                  // ★
          const a = 1 - Math.sqrt(r2)/h;
          rho += a*a; rhoN += a*a*a;
        }
        // ★壁の鏡像を数える（距離 d の粒子に対して 2d の位置にいる相手）。
        //   隅では面が2つある＝鏡像も2個（_measureWalls の★）。
        let wr = 0, wr2 = 0;
        if (pi._wn > 0) {
          const d = (pi.x - pi._wqx)*pi._wnx + (pi.y - pi._wqy)*pi._wny;   // 面への射影
          if (d > 0 && 2*d < h) { wr = 1 - 2*d/h; rho += wr*wr; rhoN += wr*wr*wr; }
        }
        if (pi._wn > 1) {
          const d = (pi.x - pi._wqx2)*pi._wnx2 + (pi.y - pi._wqy2)*pi._wny2;
          if (d > 0 && 2*d < h) { wr2 = 1 - 2*d/h; rho += wr2*wr2; rhoN += wr2*wr2*wr2; }
        }
        // ★温度で「その粒子が望む混み具合」と「押し返す強さ」が変わる。
        //   液体：温まると膨らむ＝隣が少なくてよい（restDensity を下げる）。
        //   気体：P = nRT/V ＝ 同じ混み具合でも温度に比例して強く押し返す。
        //   ★液体の熱膨張はここ（静止密度）ではなく重力側でやる（①のブシネスク近似）。
        //     静止密度をいじると密度拘束そのものを揺らすことになり、水の実際の膨張が
        //     0〜100℃で4%しかない一方、見えるほど誇張すると restDensity が 0 に近づいて
        //     水が崩壊する（実測：倍率30で静止密度が31%減、倍率100でほぼ0）。
        const stiff = (thermal && t.gasLaw) ? t.stiffness * Math.max(0, pi.T) / ROOM_K
                                            : t.stiffness;
        let derr = rho - t.restDensity;
        if (t.cohesion) { if (derr < -0.5) derr = -0.5; }  // 凝集（表面張力）は弱めに制限
        else if (derr < 0) derr = 0;                        // 気体は斥力のみ
        const P  = stiff * derr / this.relaxIters;
        const PN = t.nearStiffness * rhoN / this.relaxIters;
        for (const pj of nb) {
          if (pj === pi) continue;
          const dx = pj.x-pi.x, dy = pj.y-pi.y;
          const r2 = dx*dx + dy*dy;
          if (r2 >= h2 || r2 < 1e-12) continue;    // ★ r<1e-6 ⇔ r²<1e-12
          const r = Math.sqrt(r2);
          const a = 1 - r/h;
          let D = dt2 * (P*a + PN*a*a);
          if (D >  4) D =  4;          // 爆発防止クランプ
          if (D < -2) D = -2;
          const ux = dx/r, uy = dy/r;
          pi.x -= D*ux*0.5; pi.y -= D*uy*0.5;
          pj.x += D*ux*0.5; pj.y += D*uy*0.5;
        }
        // ★鏡像ぶんの変位。鏡像は動かないので実体が**全部**受け取る（対等な2粒子の 0.5 ではない）。
        //   鏡像は壁の向こう＝法線の逆側にいるので、押し返しは +法線の向きになる。
        if (wr > 0) {
          let D = dt2 * (P*wr + PN*wr*wr);
          if (D >  4) D =  4;
          if (D < -2) D = -2;
          pi.x += D*pi._wnx; pi.y += D*pi._wny;
        }
        if (wr2 > 0) {
          let D = dt2 * (P*wr2 + PN*wr2*wr2);
          if (D >  4) D =  4;
          if (D < -2) D = -2;
          pi.x += D*pi._wnx2; pi.y += D*pi._wny2;
        }
      }
    }
    // ⑤ 障害物へ位置押し出し → 位置差分から速度確定（非弾性＝水は跳ねず広がる）
    //   ★押し出したぶんは速度に数えない（contactVel=false）。位置ベース法では
    //     「動いた距離 ÷ dt」がそのまま速度になるので、壁から押し戻された距離が
    //     毎tick 外向きの速度に化ける。それが次のtickで粒子を外へ運び、また壁へ
    //     戻され……と 2tick 周期の自励振動になる。
    //     ☆真因はここだった。壁ぎわの粒子が1tickに動く 1.69px のうち **1.18px（70%）は
    //       押し出しそのもの**（実測・コップの水630個）。重力を切ると壁ぎわの震えは
    //       98.5→29.1px/s と中のほう（29.9）まで落ちる＝水柱の重みで毎tick押し込まれ、
    //       押し戻される往復が本体だと分かる。
    //     ☆密度の測り間違いではない。壁ぎわの密度は 1.86、中は 1.83 でほぼ同じだった
    //       （境界の欠けを解析的に足す実装も試したが 98.5→101.2px/s で効かなかった）。
    //       そもそもこの水は rho≈1.85 に対し restDensity=4.0 なので、derr は
    //       どこでも凝集側の下限 −0.5 に張りついている＝密度拘束は効いていない。
    //     ☆緩和を「分割せず収束させる」（P を /relaxIters しない）も試したが逆効果
    //       （反復2/4/8 で 105.6／110.3／124.4px/s）。分割は安定化に効いている。
    //   押し出しを速度から外すかわり、**壁へ食い込む向きの速度だけは消す**。
    //   水は跳ねないので、これが非弾性の壁の正しい扱いになる（消さないと、
    //   落ちてきた水が壁の中へ入り続けて止まらない）。
    const invDt = 1/dt;
    for (const p of pts) {
      const gx0 = p.x, gy0 = p.y;
      this._collideGround(p);
      this._collideBodies(p, invDt, dt, thermal);
      const cdx = p.x - gx0, cdy = p.y - gy0;          // このtickに押し出された合計
      let vx = (p.x - p.px - cdx) * invDt;             // 押し出しを除いた速度
      let vy = (p.y - p.py - cdy) * invDt;
      const cl = len(cdx, cdy);
      if (cl > 1e-9) {
        const nx = cdx/cl, ny = cdy/cl;                // 押し出した向き＝面の外向き
        const vn = vx*nx + vy*ny;
        if (vn < 0) { vx -= vn*nx; vy -= vn*ny; }      // 食い込む向きだけ消す
      }
      p.vx = vx; p.vy = vy;
    }
    this._buoyancy(pts);        // ★浮力（静水圧のぶん）。押し出しの反作用では出ない
    this._finishCoupling(dt);   // ★積んだ反作用をなまして物体へ渡す
  },
  // ── 浮力（アルキメデス）────────────────────────────────────────
  //   ★押し出しの反作用（上の連成）は「水が物体を叩く力」で、静止した水が出す圧力＝
  //     浮力はそこに現れない。押し出し量は粒子が物体へ食い込んだ距離なので、水が
  //     静止していれば 0 に落ちるためである。実測：水中に沈めた木のブロック
  //     （重さ 47N・理論浮力 78.5N）に効いていたのは 11N だけで、水より軽い
  //     スポンジ（密度100）ですら底へ沈んだままだった。連成の利得や上限をどう変えても
  //     この量は変わらない（食い込みは水圧ではなく水の“動き”で決まるため）。
  //   そこで浮力だけは素直にアルキメデスで出す：物体のうち水面より下にある面積を
  //   数え、F = ρ_水 × 体積 × g を重力と逆向きに掛ける。
  //   ・水面は「その物体の左右にいる粒子の、いちばん高いところ」で決める（列ごとの
  //     高さの表を1回作って共有する）。波立っていても、こぼれていても追従する。
  //   ・沈んだ面積は物体の内側を格子でサンプルして数える。円でも多角形でも穴あきでも
  //     同じ式で済み、重心も一緒に出るので、傾いた物体は起き上がる（復元トルク）。
  //   ・粘性抵抗も同じ体積比で掛ける。これが無いと浮いた物体はいつまでも上下に揺れる。
  //   ・「濡れている面」は面のつながりで決める。粒子が近くにいる面だけを濡れとすると、
  //     底や他の物体に接した面が乾いて浮力が消える（SPH.buoyCrack の★）。
  // その点の近くに水粒子がいるか（＝そこは濡れているか）。格子をそのまま引く。
  _fluidNear(x, y) {
    const g = this._g, h = this.h, r2 = this.buoyWet * this.buoyWet;
    if (!g.pts) return false;
    const cx = Math.floor(x/h), cy = Math.floor(y/h);
    const pts = g.pts, order = g.order, start = g.start, count = g.count;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const s = this._slot(g, cx+dx, cy+dy);
      if (s < 0) continue;
      const b0 = start[s], e = b0 + count[s];
      for (let k = b0; k < e; k++) {
        const p = pts[order[k]];
        if (p.type !== 'fluid') continue;
        const ex = p.x - x, ey = p.y - y;
        if (ex*ex + ey*ey <= r2) return true;
      }
    }
    return false;
  },
  // その面片の外向きに、粒子が入れないほど狭い隙間で固体が迫っているか。
  //   ★面から buoyCrack までを3点で見る。これより薄い固体は点の間を抜けうるが、
  //     薄い固体の向こう側の水はほぼ同じ場所にいる＝どちらに転んでも圧力は変わらない。
  _solidNear(mx, my, nxo, nyo, self) {
    const d0 = this.buoyProbe, d1 = this.buoyCrack;
    const terrain = world.terrain && ground.layers !== 0;
    for (let k = 0; k < 3; k++) {
      const d = d0 + (d1 - d0) * k / 2;
      const x = mx + nxo*d, y = my + nyo*d;
      if (terrain && signedDistToGround(x, y) < 0) return true;
      for (const o of objects) {
        if (o === self || _ghostBody(o)) continue;
        const a = o._aabb;
        if (x < a.minX || x > a.maxX || y < a.minY || y > a.maxY) continue;
        if (o.containsPoint(x, y)) return true;
      }
    }
    return false;
  },
  // 物体の輪郭を短い面片に刻んで渡す（中点・外向き法線・長さ・輪の番号）。
  //   円は円周を等分、多角形は外周と穴のそれぞれの辺を刻む。
  //   外向きの判定は「少し外へ出た点が物体の中でないか」で行う（回り方に依らない）。
  //   ★面片は**輪をひと回りする順**で渡す。濡れを隣どうしで伝える（_buoyancy の②）
  //     ときに、この並びがそのまま「面のつながり」になる。並べ替えないこと。
  _forEachSurfaceSeg(b, fn) {
    const step = this.buoySegPx;
    if (b.type === 'circle') {
      const R = b.radius;
      const n = Math.max(8, Math.min(96, Math.round(2*Math.PI*R / step)));
      const ds = 2*Math.PI*R / n;
      for (let i = 0; i < n; i++) {
        const th = (i + 0.5) / n * 2*Math.PI;
        const nx = Math.cos(th), ny = Math.sin(th);
        fn(b.x + nx*R, b.y + ny*R, nx, ny, ds, 0);
      }
      return;
    }
    const loops = [b._worldVerts(), ...b._worldHoles()];
    for (let li = 0; li < loops.length; li++) {
      const loop = loops[li];
      const m = loop.length;
      if (m < 3) continue;
      let sign = 0;                                    // この輪の「外向き」の符号
      for (let i = 0; i < m; i++) {
        const p0 = loop[i], p1 = loop[(i+1)%m];
        const ex = p1.x - p0.x, ey = p1.y - p0.y;
        const L = Math.hypot(ex, ey);
        if (L < 1e-9) continue;
        let nx = ey/L, ny = -ex/L;
        if (sign === 0) {                              // 最初の有効な辺で向きを決めて使い回す
          const mx = (p0.x+p1.x)/2, my = (p0.y+p1.y)/2;
          sign = b.containsPoint(mx + nx*0.5, my + ny*0.5) ? -1 : 1;
        }
        nx *= sign; ny *= sign;
        const k = Math.max(1, Math.min(64, Math.round(L / step)));
        const ds = L / k;
        for (let j = 0; j < k; j++) {
          const t = (j + 0.5) / k;
          fn(p0.x + ex*t, p0.y + ey*t, nx, ny, ds, li);
        }
      }
    }
  },
  _buoyancy(pts) {
    const gx = gravPxX(), gy = gravPxY();
    const gl = len(gx, gy);
    if (gl < 1e-6) return;                       // 無重力では浮力も定義されない
    const ux = -gx/gl, uy = -gy/gl;              // 上向き（重力の逆）
    const rx = -uy,    ry =  ux;                 // 水面に沿う向き
    // ── 列ごとの水面の高さ ──
    let smin = Infinity, smax = -Infinity, any = false;
    for (const p of pts) {
      if (p.type !== 'fluid') continue;
      const s = p.x*rx + p.y*ry;
      if (s < smin) smin = s;
      if (s > smax) smax = s;
      any = true;
    }
    if (!any) return;
    const pool = this.buoyLevelPool;
    const sp = Math.sqrt(PARTICLE_TYPES.fluid.restArea);    // 粒子間隔 11.2px
    const cw = pool ? sp : this.h;
    const nCol = Math.min(2048, Math.max(1, Math.ceil((smax - smin)/cw) + 1));
    const top = this._surfTop && this._surfTop.length === nCol
              ? this._surfTop : (this._surfTop = new Float64Array(nCol));
    top.fill(-Infinity);
    for (const p of pts) {
      if (p.type !== 'fluid') continue;
      const i = Math.min(nCol-1, Math.max(0, ((p.x*rx + p.y*ry) - smin)/cw | 0));
      const hgt = p.x*ux + p.y*uy;
      if (hgt > top[i]) top[i] = hgt;
    }
    // ── 静水面：ひとつながりの水の、上が空いている列だけで平均する ──
    let runOf = null, runSum = null, runN = null;
    if (pool) {
      runOf  = this._surfRun  && this._surfRun.length  === nCol ? this._surfRun  : (this._surfRun  = new Int32Array(nCol));
      runSum = this._surfRunS && this._surfRunS.length === nCol ? this._surfRunS : (this._surfRunS = new Float64Array(nCol));
      runN   = this._surfRunN && this._surfRunN.length === nCol ? this._surfRunN : (this._surfRunN = new Int32Array(nCol));
      let r = -1, prevWet = false;
      for (let i = 0; i < nCol; i++) {
        if (top[i] === -Infinity) { runOf[i] = -1; prevWet = false; continue; }
        if (!prevWet) { r++; runSum[r] = 0; runN[r] = 0; }
        prevWet = true;
        runOf[i] = r;
        // 最上の粒子の、粒子1個ぶん上が固体なら水面ではない（浮いた物体の下・蓋の下の水）
        const s = smin + (i + 0.5)*cw, hq = top[i] + sp;
        const qx = s*rx + hq*ux, qy = s*ry + hq*uy;
        let covered = false;
        for (const o of objects) {
          if (_ghostBody(o)) continue;
          const a = o._aabb;
          if (qx < a.minX || qx > a.maxX || qy < a.minY || qy > a.maxY) continue;
          if (o.containsPoint(qx, qy)) { covered = true; break; }
        }
        if (covered) continue;
        runSum[r] += top[i] + sp/2;              // 粒子の中心＋半間隔＝水の上面
        runN[r]++;
      }
    }
    this._buildGrid(pts);          // 押し出しで粒子が動いたあとの配置で「濡れ」を見る
    const rho = PARTICLE_TYPES.fluid.density;
    for (const b of objects) {
      if (b.isStatic || b.held || b.invMass === 0) continue;
      const a = b._aabb;
      // 物体が占める列の範囲（はみ出しぶんも見る＝縁で水面を見失わない）
      let cLo = Infinity, cHi = -Infinity;
      for (const [qx, qy] of [[a.minX,a.minY],[a.maxX,a.minY],[a.minX,a.maxY],[a.maxX,a.maxY]]) {
        const s = qx*rx + qy*ry;
        if (s < cLo) cLo = s;
        if (s > cHi) cHi = s;
      }
      const pad = cw * this.buoyLevelPad;
      const i0 = Math.max(0, ((cLo - pad - smin)/cw | 0));
      const i1 = Math.min(nCol-1, ((cHi + pad - smin)/cw | 0));
      // 水面は「物体がつかっている**ひとつながりの水**の、上が空いている列」の平均で決める
      //   （列の作り方は冒頭の「静水面」。buoyLevelPool:false が旧来＝対照）。
      //   ★列の幅は粒子間隔（11.2px）で、値は最上の粒子の中心＋半間隔＝水の上面。
      //     列を広く取ると最上点は極値統計で高く出る（26px 幅で +7.8px）。旧来は 26px 幅＋
      //     中心で、この2つのずれがたまたま近かった。tools/measure-buoyancy.js の物差しと同じ。
      //   ★「上が空いている」＝最上の粒子の1粒子ぶん上が固体でない列。浮いた物体の下の列は
      //     「物体の底のすぐ下の水」を拾うので水面ではない（旧来の誤差①＝水面を低く見積もる）。
      //   ★物体のまわりだけでなくかたまり全体で平均する。物体のすぐ脇は押しのけた水が
      //     盛り上がっている（旧来の誤差②＝高く見積もる）が、静水面は1つなので全体で薄める。
      //   ☆旧来は①②と、下の深さの測り方（buoyProbe の点で測っていた）の誤差が打ち消し合って
      //     いた。3つとも直した実測（乱数固定・900tick 落ち着かせ・400tick 平均）：
      //         　　　　　　　　　　　1個ずつ（密度200〜1500）　　　　　　浮力デモ（400/1000/2000）
      //         旧来                  37.4 62.2 86.6 100 100 100 100 %    71.1 / 100 / 100 %
      //         深さだけ直す          48.7 75.7 100  100 100 100 100 %    82.2 / 100 / 100 %
      //         水面だけ直す          11.2 30.9 50.2 70.6 89.3 100 100 %   35.4 / 95.1 / 100 %
      //         両方（現在）          21.5 42.1 62.4 79.0 99.5 100 100 %   34.9 / 100 / 100 %
      //         ＋重力を半分ずつ（※）     22.2 41.3 61.2 81.5 97.9 100 100 %   39.9 / 97.8 / 100 %
      //         （理論）              20   40   60   80   100  100 100 %   40 / 100 / 100 %
      //     1個ずつは平均誤差 12.3 → 1.1 → 1.2 ポイント。エンジンの水面は物差しと 1px 以内で一致する。
      //     ※同じ日に重力を位置の前後へ半分ずつにした（body.js の integrate の★）。それまでの
      //       「両方」の行では、3つ並べたデモだけ密度400 が 5 ポイント浮いていた（34.9%）。
      //       エンジンの水面が物差しより 2px 高いのを見て、ブロックの間の盛り上がり（②）の
      //       せいだと読んでいたが、重力を直すと 39.9% になった＝少なくとも大半は積分の漏れで、
      //       水面の見積もりのせいではなかった。脇の列を除く案（34.4 / 36.9 / 41.0%）は、
      //       物差しと同じ列を読ませるだけなので入れていない。
      //   ☆限界：かたまりは1つの水面を持つので、浮いたコップの中と外の水面が違うときは
      //     混ざる（旧来も同じ）。上の空いた列が無いとき（蓋の下の水）は旧来の見積もりに戻る。
      let lvSum = 0, lvN = 0;
      if (pool) {
        let last = -1;                           // 物体がまたぐ水のかたまり（2つ以上もありうる）
        for (let i = i0; i <= i1; i++) {
          const r = runOf[i];
          if (r < 0 || r === last) continue;
          last = r; lvSum += runSum[r]; lvN += runN[r];
        }
      }
      if (!lvN) {                                // 上の空いた列が無い（蓋の下など）→ 旧来の見積もり
        for (let i = i0; i <= i1; i++) if (top[i] > -Infinity) { lvSum += top[i]; lvN++; }
      }
      if (!lvN) continue;                        // まわりに水が無い
      const level = lvSum / lvN;
      // ── 表面にかかる静水圧を足し合わせる ──
      //   ★「沈んでいる体積 × ρg」で出してはいけない。それだと水を入れたコップの壁まで
      //     浮力を受けてしまい、コップが自分の水で浮き上がる（実測：地面に置いたコップが
      //     300px 舞い上がった）。圧力は「濡れている面」にしか掛からないので、
      //     面ごとに積むのが正しい：コップの内側の底は水に押し下げられ、外側の底は
      //     乾いているので何も受けない。沈めた物体では全周に掛かって差し引きが ρVg
      //     （アルキメデス）になる。
      //   ★「濡れている面」は粒子が近くにいるかだけでは決まらない。底に着いた物体の下面は
      //     粒子が入れないので乾いて見えるが、水はそこにある。面のつながりで補う
      //     （②と SPH.buoyCrack の★。この補いの止め方が上のコップの話と同じ理屈になる）。
      const gSI = gl * PX2M;                     // [m/s²]
      const mxA = this._segMx, myA = this._segMy, nxA = this._segNx, nyA = this._segNy,
            dsA = this._segDs, dpA = this._segDp, stA = this._segSt, lpA = this._segLoop;
      mxA.length = myA.length = nxA.length = nyA.length = 0;
      dsA.length = dpA.length = stA.length = lpA.length = 0;
      // ── ① 面片を集め、1枚ずつ「水に触れているか」を見る ──
      this._forEachSurfaceSeg(b, (mx, my, nxo, nyo, ds, loop) => {
        const qx = mx + nxo * this.buoyProbe, qy = my + nyo * this.buoyProbe;
        // ★深さの基準は「その面の真上の列」ではなく、物体まわりで見つけた水面 level。
        //   物体が浮いていると自分の足元の列は物体で塞がれていて、いちばん高い粒子が
        //   物体の底になる＝深さ0＝浮力なし、になってしまう（実測：密度800の球が
        //   4割しか沈まないはずが、浮力を 19N しか受けず沈んでいた）。
        // ★深さは面そのもの (mx,my) で測る。濡れを見る点 (qx,qy) は面から buoyProbe だけ
        //   外にあるので、そこで測ると下面は 4px 深く・上面は 4px 浅くなり、40px の板で
        //   ちょうど 10 ポイント浮きすぎた（水面を直したあと密度1000が 89% で浮いていた）。
        const depth = level - (mx*ux + my*uy);   // 水面からの深さ [px]
        const st = depth <= 0                      ? SEG_AIR   // 水面より上＝空気
                 : this._fluidNear(qx, qy)         ? SEG_WET
                 : this.buoyCrack > 0 && this._solidNear(mx, my, nxo, nyo, b) ? SEG_CRACK
                 : SEG_AIR;                        // 乾いていて、まわりも開いている
        mxA.push(mx); myA.push(my); nxA.push(nxo); nyA.push(nyo);
        dsA.push(ds); dpA.push(depth); stA.push(st); lpA.push(loop);
      });
      // ── ② 濡れを「狭い隙間」ごしに隣へ伝える（SPH.buoyCrack の★）──
      const nSeg = stA.length;
      if (this.buoyCrack > 0) for (let s0 = 0; s0 < nSeg; ) {
        let e0 = s0 + 1;
        while (e0 < nSeg && lpA[e0] === lpA[s0]) e0++;
        const n = e0 - s0;
        if (this.buoyCrackChain) {
          for (let dir = 0; dir < 2; dir++) {    // 輪なので往復1周ずつ見れば行き渡る
            let carry = false;
            for (let k = 0; k < 2*n; k++) {
              const i = s0 + ((dir === 0 ? k : 2*n - 1 - k) % n);
              if (stA[i] === SEG_WET) carry = true;
              else if (stA[i] !== SEG_CRACK) carry = false;    // 空気で切れる
              else if (carry) stA[i] = SEG_WET;                // 隙間ごしに伝わった
            }
          }
        } else {                                 // 対照：接している面をぜんぶ濡らす
          for (let i = s0; i < e0; i++) if (stA[i] === SEG_CRACK) stA[i] = SEG_WET;
        }
        s0 = e0;
      }
      // ── ③ 濡れている面片に静水圧を積む ──
      let fx = 0, fy = 0, tz = 0, wet = 0;
      for (let i = 0; i < nSeg; i++) {
        if (stA[i] !== SEG_WET) continue;
        const P  = rho * gSI * (dpA[i] * PX2M);                       // [Pa]
        const dF = P * (dsA[i] * PX2M * world.depth) * M2PX;          // [kg·px/s²]
        fx -= nxA[i] * dF; fy -= nyA[i] * dF;                         // 圧力は面を内向きに押す
        tz -= (mxA[i] - b.x) * (nyA[i] * dF) - (myA[i] - b.y) * (nxA[i] * dF);
        wet += dsA[i];
      }
      if (!wet) continue;
      const c = b._cpl || (b._cpl = { jx:0, jy:0, tz:0, fx:0, fy:0, tz_:0 });
      c.bx = (c.bx || 0) + fx;
      c.by = (c.by || 0) + fy;
      c.btz = (c.btz || 0) + tz;
      // ── 粘性抵抗の係数 ──
      //   ★体積に比例させるのでは足りない。浮力は復元力 k = ρ g A_水線 のばねで、
      //     軽い物体ほど固有振動が速い（密度100・40cm角のスポンジで周期 0.09秒）。
      //     そこで「臨界減衰の何割か」で決める。質量や大きさによらず同じ収まり方になる。
      //   ★係数だけを渡し、掛けるのは applySphCoupling（＝そのサブステップの速度に対して）。
      //     なました力の中に減衰を混ぜ込むと、遅れた速度で減衰することになり、固有周期が
      //     なましの時定数と同じくらい速い軽い物体では、止めるどころか煽ってしまう
      //     （実測：スポンジが水面から数百px 跳ね上がり続けた）。
      const spanR = Math.abs((a.maxX-a.minX)*rx) + Math.abs((a.maxY-a.minY)*ry);   // 水線の幅 [px]
      const kSpr = rho * (spanR * PX2M * world.depth) * PX2M * gl;   // [kg/s²]
      const cLin = this.buoyZeta * 2 * Math.sqrt(Math.max(0, kSpr) / b.invMass);
      const rg2 = b.invInertia > 0 ? b.invMass / b.invInertia : 0;   // 回転半径² [px²]
      c.bc  = (c.bc  || 0) + cLin;
      c.bcr = (c.bcr || 0) + cLin * rg2 * this.buoyAngZeta;
    }
  },
  // ── 衝突は位置押し出しのみ（速度反射はしない。速度は⑤で位置差分から決まる）──
  _collideGround(p) {
    if (!world.terrain || ground.layers === 0) return;   // ★粒子は全レイヤー扱い。地面が0なら素通り
    const nx = Math.sin(ground.angle), ny = -Math.cos(ground.angle);
    const d = signedDistToGround(p.x, p.y) - p.radius;
    if (d < 0) { p.x -= nx*d; p.y -= ny*d; }
  },
  // ── 材料の内側か（外周の内側、かつどの穴の内側でもない）──
  _inMaterial(lp, outline, holes) {
    if (!pointInPolygon(lp, outline)) return false;
    for (const h of holes) if (pointInPolygon(lp, h)) return false;
    return true;
  },
  // ── 材料内の点を最寄りの表面へ押し出す（従来の押し出しロジック）──
  _pushOutLocal(lp, outline, holes, radius) {
    let best = Infinity, bx = lp.x, by = lp.y;
    for (const loop of [outline, ...holes]) {
      const nn = loop.length;
      if (nn < 2) continue;
      for (let i = 0; i < nn; i++) {
        const a = loop[i], c = loop[(i+1)%nn];
        const ex = c.x-a.x, ey = c.y-a.y;
        const eL2 = ex*ex + ey*ey || 1e-6;    // ★len2 → eL2
        let t = ((lp.x-a.x)*ex + (lp.y-a.y)*ey) / eL2;   // ★
        t = t<0?0:t>1?1:t;
        const qx = a.x+ex*t, qy = a.y+ey*t;
        const d2 = (lp.x-qx)*(lp.x-qx) + (lp.y-qy)*(lp.y-qy);
        if (d2 < best) { best = d2; bx = qx; by = qy; }
      }
    }
    let dirx = bx-lp.x, diry = by-lp.y;
    const dl = len(dirx, diry) || 1e-6;
    dirx /= dl; diry /= dl;
    return { x: bx + dirx*radius, y: by + diry*radius };
  },

  // ── 掃引の始点が既に材料の中だったとき、どちらへ出すか（ローカル座標を返す）──
  //   ★「始点も中」＝この粒子は物体に**追い越された**ということ。最寄りの面へ出しては
  //     いけない：厚みの半分より深く入った粒子にとって近いのは向こう側の面なので、
  //     そのまま壁の裏へ射出される＝薄い仕切りが漏れる（上の★と同じ話）。
  //     正しい向きは**物体が進んでいる先**である。追い越しが起きたということは
  //     物体の前面がこの粒子を通り過ぎたということなので、前へ返すのが元いた側へ返す
  //     ことになる。後ろへ出すと、物体を透かして向こう側へ渡してしまう。
  //     実測（動く仕切りをはさんだ2部屋・分子1100個・厚み12px・30秒。反対側へ渡った数）：
  //         仕切りの重さ    0.5kg   5kg   400kg   10000kg
  //         最寄りの面へ(旧) 401個  53個   63個     14個
  //         進む先へ  (新)  485個  11個    1個      0個
  //     厚み30pxなら 100/400/1000kg いずれも60秒で 0 個。
  //     ☆0.5kg だけ悪化するのは、分子1個ぶんの重さが 0.032kg で、その 16 倍しかない板が
  //       1回叩かれるたびに大きく飛ぶため（進む先が毎サブステップ暴れる）。この領域では
  //       どちらの規則でも漏れる＝規則の優劣ではなく、板が軽すぎることのほうが問題。
  //   ★止まっている物体（速度がほぼ 0）だけは従来どおり最寄りの面へ出す。進む先が
  //     決まらないうえ、止まった物体に追い越されることは無い＝この経路は
  //     「置いた瞬間に重なっていた」ような場合しか通らない。容器に水を入れるだけの
  //     シーンはここを通らない。
  //   ☆水側への影響は小さいが 0 ではない（動く鉄が水を追い越すときにここを通るため）。
  //     熱量保存デモ：容器の外へ出た水は 0 のまま、壁の中へ一瞬入る粒子が最大 2 個
  //     （1800tick の平均 0.34 個。最後には 0 個で、居座らない）。
  //     浮力デモ：当時の実測で 25/82/100% → 26/78/100%、コップの外へ出た水は 0 のまま
  //     （その後、壁の鏡像を入れて 29/94/100% になった。demos-mechanics.js の★）。
  _pushOutFor(p, b, l1, outline, holes) {
    const bs = len(b.vx, b.vy);
    if (bs > 1e-6) {
      const ux = b.vx/bs, uy = b.vy/bs;
      const d = this._escapeDist(p, b, ux, uy);
      if (isFinite(d)) {                       // ワールドで出した先をローカルへ戻す
        const c1 = Math.cos(-b.angle), s1 = Math.sin(-b.angle);
        const wx = p.x + ux*d - b.x, wy = p.y + uy*d - b.y;
        return { x: c1*wx - s1*wy, y: s1*wx + c1*wy };
      }
    }
    return this._pushOutLocal(l1, outline, holes, p.radius);
  },

  // ── 点から物体の表面までの距離（内側なら 0）──────────────────────
  //   ★熱の「触れているか」判定に使う。かつては押し出しが起きたかどうかで代用して
  //     いたが、壁の鏡像（_measureWalls の★）を入れて粒子が壁へ食い込まなくなった
  //     とたん、押し出しが発火しなくなって熱が一切流れなくなった
  //     （実測：熱量保存デモの鉄が30秒で 31.5℃→65.4℃ のまま／対流デモは
  //       上下の温度差が 4.8℃→0.0℃ で循環が完全に止まった）。
  //     接触は幾何で決めるのが正しい。ソルバの副作用に相乗りさせない。
  _surfDist(p, b) {
    if (b.type === 'circle') return Math.abs(len(p.x - b.x, p.y - b.y) - b.radius);
    const outline = b._localOutline();
    if (!outline || outline.length < 3) return Infinity;
    const c1 = Math.cos(-b.angle), s1 = Math.sin(-b.angle);
    const ux = p.x - b.x, uy = p.y - b.y;
    const lx = c1*ux - s1*uy, ly = s1*ux + c1*uy;
    let best2 = Infinity;
    const scan = loop => {
      const nn = loop.length;
      for (let i = 0; i < nn; i++) {
        const s = loop[i], e = loop[(i+1) % nn];
        const ex = e.x-s.x, ey = e.y-s.y;
        const eL2 = ex*ex + ey*ey || 1e-6;
        let t = ((lx-s.x)*ex + (ly-s.y)*ey) / eL2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = lx - (s.x + ex*t), qy = ly - (s.y + ey*t);
        const d2 = qx*qx + qy*qy;
        if (d2 < best2) best2 = d2;
      }
    };
    scan(outline);
    if (b.type === 'polygon' && b.holes) for (const hl of b.holes) if (hl.length >= 3) scan(hl);
    return Math.sqrt(best2);
  },
  _firstCrossing(l0, l1, outline, holes) {
    const dx = l1.x - l0.x, dy = l1.y - l0.y;
    let bestT = Infinity, hit = null;
    const scan = loop => {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const a = loop[i], c = loop[(i+1)%n];
        const ex = c.x - a.x, ey = c.y - a.y;
        const den = dx*ey - dy*ex;
        if (Math.abs(den) < 1e-12) continue;                 // 平行
        const t = ((a.x - l0.x)*ey - (a.y - l0.y)*ex) / den; // 線分側の媒介変数
        const s = ((a.x - l0.x)*dy - (a.y - l0.y)*dx) / den; // 辺側の媒介変数
        if (t < 0 || t > 1 || s < 0 || s > 1 || t >= bestT) continue;
        bestT = t;
        let nx = ey, ny = -ex;
        const nl = len(nx, ny) || 1; nx /= nl; ny /= nl;
        if (nx*dx + ny*dy > 0) { nx = -nx; ny = -ny; }       // 進みに逆らう向き＝材料の外
        hit = { x: l0.x + dx*t, y: l0.y + dy*t, nx, ny };
      }
    };
    scan(outline);
    for (const h of holes) scan(h);
    return hit;
  },
  // ── 円：相対運動の線分と半径 (R+r) の円との交差で侵入点を求める ──
  // ★押し出した先の「面の法線」を控える（_hitNormX/Y）。押し出しの変位そのものは
  //   法線ではない：掃引で戻したときは「今いた所から入口まで」を向くので、面に対して
  //   斜めになる。分子運動論（molecule.js の _bounceBody）はこれを弾性衝突の法線として
  //   使うので、ずれるとなめらかな円にもトルクが立つ。実測：無重力の箱に置いた
  //   5kg の円（摩擦0）が分子に叩かれて av=7.97 rad/s まで回り、回転に 5.4J を溜めた
  //   （並進は 1.4J）。気体はそのぶん冷え、30秒で全エネルギーの 2.3% が失われていた。
  //   回転を止める（fixedRotation）と 1.2% まで減ったのが、これが主因である証拠。
  //   SPH（水）の側は変位そのもの（cdx,cdy）を連成に使うので、そちらの挙動は変わらない。
  _collideBodyCircle(p, b) {
    const minD = b.radius + p.radius, minD2 = minD*minD;
    const cx = p.x - b.x, cy = p.y - b.y;
    const d2 = cx*cx + cy*cy;
    if (d2 < minD2) {                                        // 通常の重なり（従来どおり）
      const d = Math.sqrt(d2);
      const nx = d>1e-4 ? cx/d : 0, ny = d>1e-4 ? cy/d : -1;
      p.x = b.x + nx*minD; p.y = b.y + ny*minD;
      this._hitNormX = nx; this._hitNormY = ny;
      return;
    }
    const pX = b._prevX !== undefined ? b._prevX : b.x;
    const pY = b._prevY !== undefined ? b._prevY : b.y;
    const ox = p.px - pX, oy = p.py - pY;                     // tick開始時の相対位置
    if (ox*ox + oy*oy < minD2) return;                        // 元から内側＝掃引の対象外
    const dx = cx-ox, dy = cy-oy;
    const A = dx*dx + dy*dy;
    if (A < 1e-12) return;
    const B = ox*dx + oy*dy, C = ox*ox + oy*oy - minD2;
    const disc = B*B - A*C;
    if (disc <= 0) return;                                    // すれ違っただけ
    const t = (-B - Math.sqrt(disc)) / A;
    if (t < 0 || t > 1) return;
    const ex = ox + dx*t, ey = oy + dy*t;                     // 侵入点（相対座標）
    const el = len(ex, ey) || 1e-6;
    p.x = b.x + ex/el*minD;                                   // 現在姿勢の表面へ戻す
    p.y = b.y + ey/el*minD;
    this._hitNormX = ex/el; this._hitNormY = ey/el;           // ★侵入点での半径方向＝面の法線
  },

  _collideBodyPoly(p, b) {
    const outline = b._localOutline();
    if (!outline || outline.length < 3) return;
    const holes = (b.type === 'polygon' && b.holes) ? b.holes.filter(h => h.length >= 3) : [];
    const c1 = Math.cos(-b.angle), s1 = Math.sin(-b.angle);
    const ux = p.x-b.x, uy = p.y-b.y;
    const l1 = { x: c1*ux - s1*uy, y: s1*ux + c1*uy };
    // 直前の位置を「直前の姿勢」のローカル座標へ（掃引の始点）
    const pa = b._prevA !== undefined ? b._prevA : b.angle;
    const pX = b._prevX !== undefined ? b._prevX : b.x;
    const pY = b._prevY !== undefined ? b._prevY : b.y;
    const c0 = Math.cos(-pa), s0 = Math.sin(-pa);
    const vx = p.px-pX, vy = p.py-pY;
    const l0 = { x: c0*vx - s0*vy, y: s0*vx + c0*vy };
    const wasIn = this._inMaterial(l0, outline, holes);
    let np, _pbHitN = null;      // ★入口の面の法線（ローカル）。下の★で使う
    if (this._inMaterial(l1, outline, holes)) {
      // ★材料の中にいる。「入ってきた面」へ押し戻す。
      //   最寄りの面へ出す（_pushOutLocal）と、薄い壁では逆側へ抜けてしまう：
      //   中心が壁厚の半分より深く入った時点で近いのは向こう側の面なので、
      //   コップの内壁に押しつけられた水が外へ射出される＝水が漏れる。
      //   （壁厚12px・粒子直径10px で、置いた水の3割が外へ出ていた。
      //     壁を24px より厚くすると漏れが0になるのがその証拠。）
      //   掃引の始点が材料の外にあるなら、そこから最初に横切った面が入口。
      const h = wasIn ? null : this._firstCrossing(l0, l1, outline, holes);
      _pbHitN = h;
      np = h ? { x: h.x + h.nx*p.radius, y: h.y + h.ny*p.radius }
             : this._pushOutFor(p, b, l1, outline, holes);
    } else {
      if (wasIn) return;                                      // 元から材料内＝掃引の対象外
      const h = this._firstCrossing(l0, l1, outline, holes);
      if (!h) return;
      _pbHitN = h;
      np = { x: h.x + h.nx*p.radius, y: h.y + h.ny*p.radius };
    }
    // ★面の法線（ローカル）。入口が分かっているならその面の法線、最寄りへ出したときは
    //   出した向き。どちらもワールドへ回してから控える（上の _collideBodyCircle の★）。
    let lnx, lny;
    if (_pbHitN) { lnx = _pbHitN.nx; lny = _pbHitN.ny; }
    else {
      const gx = np.x - l1.x, gy = np.y - l1.y, gl = len(gx, gy) || 1e-9;
      lnx = gx/gl; lny = gy/gl;
    }
    const c2 = Math.cos(b.angle), s2 = Math.sin(b.angle);
    this._hitNormX = lnx*c2 - lny*s2;
    this._hitNormY = lnx*s2 + lny*c2;
    p.x = b.x + np.x*c2 - np.y*s2;
    p.y = b.y + np.x*s2 + np.y*c2;
  },
  _collideBodies(p, invDt, dt, thermal) {
    // ★動く物体を先に、静止した物体をあとに解く（phase 0 → 1）。順序が効くのは
    //   「1粒子が2つの物体に同時に触れている」ときで、最後に押し出した物体の結果だけが
    //   残るため。静止した物体（容器・壁）は動かせない＝ほんとうの拘束なので勝たせる。
    //   objects の並び順のままだと、重い物体が水を容器の壁の中へ押し込んで終わり、
    //   次のtickでは「始まりから材料の中」＝入口が分からない扱いになって最寄りの面
    //   （＝壁の外側）へ射出される＝水が容器の外へ漏れる。
    //   逃げ場が無いとき（水が重い物体と床にはさまれたとき）は、壁を突き抜ける代わりに
    //   動く物体と重なって終わる。そのままにすると重なったきり残る（＝水が鉄の中に
    //   閉じ込められて見える）ので、最後に _squeezeOut が横へ逃がす。
    //   実測（乱数固定・時間平均）：容器の外へ出た粒子は、熱量保存デモ（180粒子・900tick）
    //   で 21.0 → 0.0、浮力デモ（630粒子・落ち着かせて 400tick）で 11.0 → 0.0。
    //   浮力の較正は当時ほぼ動かなかった（沈み具合 25/88/100% → 24/85/100%）。
    //   いまの値は壁の鏡像を入れたあとの 29/94/100% ＝ demos-mechanics.js の★を参照。
    const hit = this._touched; hit.length = 0;   // このtickで押し出した物体（使い回し）
    let winX = 0, winY = 0;                      // 最後に効いた押し出しの法線
    for (let phase = 0; phase < 2; phase++)
    for (const b of objects) {
      if ((b.isStatic ? 1 : 0) !== phase) continue;
      if (_ghostBody(b)) continue;   // ★粒子は全レイヤー扱い。ゴーストだけ透過する
      const a = b._aabb;
      // ★掃引ぶんの余裕をとる。物体の並進＋回転による表面の移動量を見込まないと、
      //   「壁が粒子を追い越した」ケースをここで捨ててしまう。
      const hw = (a.maxX-a.minX)*0.5, hh = (a.maxY-a.minY)*0.5;
      const bmv = b._prevX !== undefined
        ? len(b.x-b._prevX, b.y-b._prevY) + Math.abs(b.angle-b._prevA) * len(hw, hh)
        : 0;
      // ★熱の余裕もここに入れる。下の熱伝導は面から radius+thermalTouchPad（9px）まで
      //   届く判定なのに、この枠を radius（5px）で切ると、その外側の粒子は面の距離を
      //   測る前に捨てられる＝熱の届く範囲が黙って radius に縮む。
      //   実測（熱量保存デモ・乱数固定）：着底した鉄のいちばん近い粒子は面から 5.12px で、
      //   枠 5px のわずか外。熱が**完全に**止まり、80℃の鉄と20℃の水が 40.22℃／27.92℃
      //   のまま 60 秒動かなかった（設計は 30℃。鉄の1tickの温度変化は 2e-13℃＝ゼロ）。
      //   入れると 20 秒で 29.96℃／29.96℃ ＝ 設計値（29.96℃）に行き着く。
      //   押し出しはこの枠を広げても変わらない
      //   （_collideBodyPoly は材料の中か掃引で横切ったときだけ動かす＝幾何が決める）。
      const m = p.radius + bmv + (thermal ? this.thermalTouchPad : 0);
      const sMinX = Math.min(p.px, p.x), sMaxX = Math.max(p.px, p.x);
      const sMinY = Math.min(p.py, p.y), sMaxY = Math.max(p.py, p.y);
      if (sMaxX < a.minX-m || sMinX > a.maxX+m ||
          sMaxY < a.minY-m || sMinY > a.maxY+m) continue;
      const bx0 = p.x, by0 = p.y;   // ★押し出し前の粒子位置
      if (b.type === 'circle') this._collideBodyCircle(p, b);
      else                    this._collideBodyPoly(p, b);
      const cdx = p.x - bx0, cdy = p.y - by0;
      const touched = (cdx !== 0 || cdy !== 0);   // 押し出した＝接触している
      if (touched) { hit.push(b); winX = this._hitNormX; winY = this._hitNormY; }
      // ★熱伝導（粒子 ↔ 物体）。静的な物体とも熱はやりとりするので、
      //   下の連成（動く物体だけ）とは別に扱う。
      //   ★「触れている」は幾何で決める（_surfDist）。押し出しが起きたかどうかで
      //     代用していたが、壁の鏡像を入れて粒子が壁へ食い込まなくなったとたん、
      //     押し出しが発火せず熱が一切流れなくなった（_surfDist の★に実測）。
      //     しきい値は粒子の半径＋4px。粒子の間隔が 11.2px なので、
      //     「壁に接している層」だけが入り、2層目は入らない幅である。
      if (thermal && bodyHasHeat(b) &&
          (touched || this._surfDist(p, b) <= p.radius + this.thermalTouchPad)) {
        const Cp = p.prm._heatC;
        if (Cp > 0) {
          const bt = bodyThermal(b);
          const rp = p.radius * PX2M;
          const area = 2 * rp * world.depth;                   // 粒子1個ぶんの接触面
          // ★網へ登録するだけ（粒子どうしの伝導と同じ。thermal.js 熱の網の★）
          heatNetLink(HN_PART, p, HN_BODY, b, thermalConductance(p.prm.conduct, rp, b.conduct, bt.L, area));
        }
      }
      // ★二方向連成：粒子を押し出した分だけ物体へ反作用（水が物体を支える）
      //   力積はここでは掛けず、物体ごとに合計だけ積む。実際に効かせるのは
      //   なましたあと（_finishCoupling → step.js のサブステップ）。
      if (!b.isStatic) {
        if (touched) {
          let jx = -cdx * this.coupleMass * invDt * this.coupleGain;
          let jy = -cdy * this.coupleMass * invDt * this.coupleGain;
          // ★減衰：押し出し方向の相対速度に逆らう力積を足す。位置ぶんだけだと
          //   「ばね定数だけあって減衰ゼロ」＝一度ずれたら振動が止まらない。
          if (this.coupleDamp > 0) {
            const nl = len(cdx, cdy);
            if (nl > 1e-9) {
              const nx = cdx/nl, ny = cdy/nl;             // 粒子を押し出した向き
              // 接触点における物体表面の速度（並進＋回転）
              const sx = b.vx - b.av * (by0 - b.y);
              const sy = b.vy + b.av * (bx0 - b.x);
              // 粒子の（押し出し前の）速度との法線相対速度。負＝食い込む向き
              const vn = ((bx0 - p.px)*invDt - sx)*nx + ((by0 - p.py)*invDt - sy)*ny;
              if (vn < 0) {
                const jd = vn * this.coupleMass * this.coupleDamp;   // vn<0 なので jd<0
                jx += jd * nx; jy += jd * ny;
              }
            }
          }
          const jl = len(jx, jy);
          if (jl > this.coupleMaxImpulse) { jx = jx/jl*this.coupleMaxImpulse; jy = jy/jl*this.coupleMaxImpulse; }
          const c = b._cpl || (b._cpl = { jx:0, jy:0, tz:0, fx:0, fy:0, tz_:0 });
          c.jx += jx; c.jy += jy;
          c.tz += (bx0 - b.x)*jy - (by0 - b.y)*jx;
        }
      }
    }
    if (hit.length > 1) this._squeezeOut(p, hit, winX, winY);
  },
  _touched: [],
  // ── はさまれた粒子を、面に沿って横へ逃がす ────────────────────────
  //   ★2つの物体が正面から向かい合っているところ（重い物体の底と容器の床のあいだ）
  //     では、押し出す向きが真逆になり、どちらへも出られない。上の phase の決まりで
  //     静止した物体が勝つので、粒子は動く物体の中に入ったまま居座る。
  //     実測：熱量保存デモで 6 粒子（＝ブロックの幅ちょうど1列）が 30 秒間ずっと
  //     鉄の中に残り、色つきの物体の中に水玉が透けて見えていた。
  //   実物の水はこのとき横へ噴き出す。ここでも同じにする：勝った押し出しの法線に
  //   垂直な向き（＝乗っている面に沿う向き）で、近いほうの出口へ少しずつ動かす。
  //   ★「面に沿って」が要。最寄りの面へまっすぐ出すと、それは相手の面を突き抜ける
  //     向きそのもの（鉄の底面）なので、次のtickで押し戻されて堂々めぐりになる。
  //   ★これは力ではなく幾何の後始末なので、連成（上）には積まない。積むと
  //     「はさまった水が物体を横へ蹴る」ことになり、水の中の物体が勝手に走り出す。
  //   ☆地面（_collideGround）とのはさまれは対象外。地面は符号つき距離で押し出す＝
  //     入口の曖昧さが無く、次のtickで必ず外へ戻るので居座らない。
  _squeezeOut(p, list, nx, ny) {
    if (nx === 0 && ny === 0) return;
    const tx = -ny, ty = nx;                       // 勝った押し出しに垂直＝面に沿う向き
    const cap = p.radius * this.squeezeStep;
    for (const b of list) {
      const dPos = this._escapeDist(p, b,  tx,  ty);
      const dNeg = this._escapeDist(p, b, -tx, -ty);
      if (!isFinite(dPos) && !isFinite(dNeg)) continue;   // 中にいない（＝はさまれていない）
      const s = dPos <= dNeg ? 1 : -1;
      const step = Math.min(dPos <= dNeg ? dPos : dNeg, cap);
      p.x += tx*s*step; p.y += ty*s*step;
    }
  },
  // ── 物体 b の中にいる粒子が、向き (tx,ty) へ何px 動けば外へ出るか。外なら Infinity ──
  _escapeDist(p, b, tx, ty) {
    if (b.type === 'circle') {
      const minD = b.radius + p.radius;
      const dx = p.x - b.x, dy = p.y - b.y;
      const c = dx*dx + dy*dy - minD*minD;
      if (c >= 0) return Infinity;                       // すでに外
      const q = dx*tx + dy*ty;
      return -q + Math.sqrt(q*q - c);
    }
    const outline = b._localOutline();
    if (!outline || outline.length < 3) return Infinity;
    const holes = (b.type === 'polygon' && b.holes) ? b.holes.filter(h => h.length >= 3) : [];
    const c1 = Math.cos(-b.angle), s1 = Math.sin(-b.angle);
    const ux = p.x - b.x, uy = p.y - b.y;
    const l0 = { x: c1*ux - s1*uy, y: s1*ux + c1*uy };
    if (!this._inMaterial(l0, outline, holes)) return Infinity;
    const a = b._aabb;
    const far = len(a.maxX - a.minX, a.maxY - a.minY);   // 必ず外へ抜ける長さ
    const ltx = c1*tx - s1*ty, lty = s1*tx + c1*ty;
    const h = this._firstCrossing(l0, { x: l0.x + ltx*far, y: l0.y + lty*far }, outline, holes);
    return h ? len(h.x - l0.x, h.y - l0.y) + p.radius : Infinity;
  },
  // ── このtickで積んだ連成力積を、なました「力」に変換して物体へ持たせる ──────
  //   ・力に直す（/dt）→ 時定数 coupleTau の1次遅れでなます
  //   ・物体自身の重さの coupleMaxG 倍で頭打ち（粒子1個ずつの上限では、接触数が
  //     揺らぐたびに合計が跳ねるのを止められない）
  //   ・なました力が十分小さければ物体を起こさない＝水を張ったまま眠れる
  _finishCoupling(dt) {
    if (!(dt > 0)) return;
    const invDt = 1/dt;
    const a = this.coupleTau > 0 ? Math.min(1, dt / this.coupleTau) : 1;   // 1次遅れの係数
    for (const b of objects) {
      const c = b._cpl;
      if (!c) continue;
      const fx = c.jx * invDt, fy = c.jy * invDt, tz = c.tz * invDt;
      c.fx  += (fx - c.fx) * a;
      c.fy  += (fy - c.fy) * a;
      c.tz_ += (tz - c.tz_) * a;
      c.jx = 0; c.jy = 0; c.tz = 0;                    // 次tickぶんの積算をリセット
      // ★浮力は「力」としてそのまま積んであるので /dt は要らない。なましだけ掛ける
      //   （水面の高さは粒子1個の飛び跳ねでも px 単位で動くため）。減衰は係数のまま渡す。
      const ab = this.buoyTau > 0 ? Math.min(1, dt / this.buoyTau) : 1;
      c.bfx  = (c.bfx  || 0) + ((c.bx  || 0) - (c.bfx  || 0)) * ab;
      c.bfy  = (c.bfy  || 0) + ((c.by  || 0) - (c.bfy  || 0)) * ab;
      c.btz_ = (c.btz_ || 0) + ((c.btz || 0) - (c.btz_ || 0)) * ab;
      c.bcf  = (c.bcf  || 0) + ((c.bc  || 0) - (c.bcf  || 0)) * ab;
      c.bcrf = (c.bcrf || 0) + ((c.bcr || 0) - (c.bcrf || 0)) * ab;
      c.bx = 0; c.by = 0; c.btz = 0; c.bc = 0; c.bcr = 0;
      if (b.isStatic) { c.fx = c.fy = c.tz_ = 0; c.bfx = c.bfy = c.btz_ = 0; c.bcf = c.bcrf = 0; continue; }
      // 総量の頭打ち（力とトルクを同じ比率で落とす＝向きは変えない）
      const wN = b.mass * len(gravPxX(), gravPxY());   // 物体自身の重さ [kg·px/s²]
      const cap = wN * this.coupleMaxG;
      if (cap > 0) {
        const fl = len(c.fx, c.fy);
        if (fl > cap) { const k = cap/fl; c.fx *= k; c.fy *= k; c.tz_ *= k; }
      }
      // 起こす判定には浮力も入れる（水位が変われば、浮いて眠っている物体も動き出す）
      if (len(c.fx + c.bfx, c.fy + c.bfy) > wN * this.coupleWakeG) { b.sleeping = false; b.sleepTimer = 0; }
    }
  },
};
// ── なました連成力を物体へ掛ける（step.js がサブステップごとに呼ぶ）───────────
//   ここで「力」として掛けるのが要点。tick の最後に力積で叩き込むと、その速度は
//   接触ソルバを通らないまま次tickの積分で位置に化けてしまう（床に載っているのに
//   1px 浮き上がる）。サブステップの中で掛ければ、同じサブステップの接触ソルブが
//   受け止めてくれるので、器は重力と同じように静かに支えられる。
function applySphCoupling(dt) {
  for (const b of objects) {
    const c = b._cpl;
    if (!c || b.isStatic || b.held || b.invMass === 0) continue;
    // 押し出しの反作用 ＋ 浮力 ＋ 水の粘性抵抗（★抵抗だけは「今の速度」に掛ける。
    // なました力に混ぜると遅れた速度で減衰することになり、軽い物体では煽りになる）
    const fx = c.fx + (c.bfx || 0) - (c.bcf || 0) * b.vx;
    const fy = c.fy + (c.bfy || 0) - (c.bcf || 0) * b.vy;
    const tz = c.tz_ + (c.btz_ || 0) - (c.bcrf || 0) * b.av;
    if (!fx && !fy && !tz) continue;
    if (b.sleeping) continue;
    b.vx += fx * b.invMass * dt;
    b.vy += fy * b.invMass * dt;
    b.av += tz * b.invInertia * dt;
    b.recordForce('fluid', fx * dt, fy * dt, b.x, b.y, 'sph');
  }
} 

function spawnParticles(at, type) {
  for (let i = 0; i < particleSpawnPerEvent && particles.length < particleMaxCount; i++) {
    const p = new Particle(at.x + (Math.random()-.5)*20, at.y + (Math.random()-.5)*20, type);
    if (particleColor) p.color = particleColor;   // ★印の色（null なら型の色のまま）
    particles.push(p);
  }
}

// ════════════════════════════════════════
//  波動場（FDTD）
// ════════════════════════════════════════
const WAVE_S_MAX   = 0.7071067811865476;  // c·dt/dx の上限（2次元の安定条件 1/√2）
const WAVE_PAD     = 40;                  // 吸収層の厚み [cells]
const WAVE_SIGMA   = 0.20;                // 吸収層の最大減衰
const WAVE_RAMP    = 3;                   // 吸収層の立ち上がりの次数
const WAVE_CPL     = 16;                  // dx = λ / この値
const WAVE_MIN_CPL = 12;                  // これを下回ると波面が四角くゆがむ
const WAVE_QUANT   = 64;                  // 領域サイズの量子化（作り直しの頻度を下げる）
const WAVE_ABS_MIN = 0.02;                // 吸収の下限（0 を許すと領域が無限に広がる）
// 無反射の壁（waveMode='absorb'）。中身は「深さにつれて損失が強くなる媒質」で、
//   領域の縁の吸収層（WAVE_SIGMA）と同じ作り。立ち上がり長は λ 相当のセル数
//   （dx = λ/WAVE_CPL なので、波長が変わっても壁の効き方は変わらない）。
//   ★この2つは厚さ 2λ の壁で反射と透過の和が最小になる組（waveStampAbsorbers の実測表）。
const WAVE_WSIG    = 0.45;                // 無反射の壁の最大損失（1ステップあたり）
const WAVE_WRAMP   = 2;                   // 立ち上がりの次数
const WAVE_NS_CELL = 8.15;                // [ns] 1セル更新の実測時間（負荷の目安表示用）
const WAVE_HOT     = 2;                   // 「変位そのもの」表示で、濃さが振り切れた先を
                                          //   白へ寄せきるまでの超過ぶん（drawWaveField の★）

