const CIRCUIT_DEFAULTS = {
  wire:      {},
  resistor:  { R: 10 },         // [Ω]
  // すべり抵抗（抵抗線＋すべる接点）：両端 a・b の間が一様な抵抗線で、全体の抵抗が R。
  //   接点 P は a から pos（0〜1）の位置にあり、a–P が R·pos、P–b が R·(1 − pos) に分かれる。
  //   接点の端子 c は抵抗線の中点から法線方向へ cOff [px] 離れた所に固定し、c と P のあいだは
  //   0Ω のたわむ導線（実物のすべり抵抗器の接点の棒・電位差計の接点のリード線）。
  //   ★c を P の上に置かない理由：pos を回すたびに端子が動くと、c につないだ導線が置き去りに
  //     なって切れる。端子を固定し、動くのはリード線の先だけにする。
  //   ★cOff の符号で抵抗線のどちら側に端子を出すか決める（正＝a を左・b を右に置いたとき下）。
  slidewire: { R: 10, pos: 0.5, cOff: 40 },
  // r は内部抵抗 [Ω]。既定 0.5Ω＝実際の電源に近い設定。
  //   ★0（理想電源）を既定にしない理由：理想電源に理想コイルを直結すると、投入時に
  //     生じた直流分を減衰させる抵抗がどこにも無く、永久に残る（変圧器の突入電流と
  //     同じ現象）。コイルを含む回路が軒並みその状態になってしまう。
  //   0 にすれば理想電源として使える（I = V/R がぴったり出る）。0 でも計算は破綻
  //   しない：ソルバが下限 SRC_R_MIN を当てるので、短絡させても「無限大」ではなく
  //   非常に大きな有限電流が出る（＝ショートしていると分かる）。
  dcsource:  { V: 10, r: 0.5 },   // [V], 内部抵抗[Ω]
  acsource:  { V: 5, freq: 1, phase: 0, r: 0.5 },   // 振幅[V], [Hz], [rad], 内部抵抗[Ω]
  switch:    { closed: true },
  // 計器の内部抵抗。既定は理想（電流計 0Ω・電圧計は実質∞）なので、既存のシーンの値は変わらない。
  //   有限にすると「電流計の内部抵抗のぶん回路の電流が減る」「電圧計の内部抵抗が有限だと
  //   分圧が狂う」という定番の題材がそのまま作れる。
  //   ★電圧計を文字どおり∞（枝ごと外す）にはしない。電圧計だけでぶら下がった部分回路が
  //     浮いて、対地 Gmin が決めた無意味な電位を「測定値」として表示してしまうため。
  //     VOLTMETER_R_IDEAL は 10Ω の回路に対して6桁上で、2桁表示では理想と区別できない。
  ammeter:   { r: 0 },          // 内部抵抗 [Ω]
  voltmeter: { R: 1e7 },        // 内部抵抗 [Ω]
  capacitor: { C: 1e-3 },       // [F]（教室で見える時定数にするため大きめ既定）
  inductor:  { L: 1 },          // [H]
  // ダイオード：順方向電圧 Vf [V]（定格電流 DIODE_IF のときの電圧降下）だけを指定する。
  //   内部では Shockley の式 I = Is(exp(V/nVt) − 1) で解くので、
  //   「立ち上がり電圧」も「逆方向にほとんど流れない」も式から出る（閾値の場合分けではない）。
  //   Vf = 0.7 でシリコン、2.0 前後にすれば赤色LEDとして扱える。
  diode:     { Vf: 0.7 },
  // 豆電球：定格電圧 Vr [V]・定格電力 Pr [W]。フィラメント温度 T を状態として持ち、
  //   R(T) = R₀(1 + α(T − T₀)) で抵抗が変わる＝非直線抵抗。tau は熱の時定数 [s]。
  //   tau ＝ 0 は「熱の遅れなし」：温度はいつもその電圧でのつり合いの値（bulbTeq）で、
  //   電流と電圧は特性曲線の上にしか来ない（突入電流も無い）。
  bulb:      { Vr: 2.5, Pr: 0.75, tau: 0.12, burnt: false },
  // ── ここから「力学とつながる」素子 ───────────────────────
  // 押しボタン：物体が触れている間だけ状態が変わる（力学 → 電気）
  pushswitch:    { nc: false, br: 16, closed: false },
  // 電磁石：コイルの電流がつくる磁場を半径 fr の円内に置く（電気 → 力学）。
  //   B = μrμ₀NI/(2a)（円形コイル中心の値）。導体棒・荷電粒子は既存の磁場と同じ扱いになる
  electromagnet: { turns: 200, a: 0.05, mur: 1000, fr: 120, R: 5 },
  // リレー：コイルと接点。同じチャンネル番号どうしが連動する（回路が回路を制御）
  relay:         { ch: 1, R: 50, Ipull: 0.02 },
  relayswitch:   { ch: 1, nc: false, closed: false },
  // モーター端子：同じチャンネルの「モーター」軸へ電流を流す。
  //   τ = kI（電流→トルク）と E = kω（逆起電力）を同じ k で結ぶので、発電機にもなる
  motor:         { ch: 1, R: 2, k: 0.05 },
};
const CIRCUIT_LABELS = {
  wire:'導線', resistor:'抵抗', slidewire:'すべり抵抗', dcsource:'直流電源', acsource:'交流電源',
  switch:'スイッチ', ammeter:'電流計', voltmeter:'電圧計', capacitor:'コンデンサー', inductor:'コイル',
  diode:'ダイオード', bulb:'豆電球',
  pushswitch:'押しボタン', electromagnet:'電磁石', relay:'リレーコイル', relayswitch:'リレー接点', motor:'モーター端子',
};
// ── 電磁石 ───────────────────────────────────────────
const MU0 = 4e-7 * Math.PI;        // [T·m/A] 真空の透磁率
const B_SATURATION = 2.0;          // [T] 鉄心の磁気飽和。これ以上は増えない（実際の鉄と同じ）
const _emagA = e => Math.max(0.005, e.a || 0.05);          // コイル半径 [m]
const _emagMur = e => Math.max(1, e.mur || 1000);          // 比透磁率（1＝空心）
// 円形コイル中心の磁束密度。飽和で頭打ちにするので、電流を上げ続けても際限なく強くはならない
function emagBz(e) {
  const B = _emagMur(e) * MU0 * (e.turns || 200) * (e.I || 0) / (2 * _emagA(e));
  return Math.max(-B_SATURATION, Math.min(B_SATURATION, B));
}
// 自己インダクタンス。上の B の式と同じ模型から導く（Φ = B·πa²·N、L = Φ/I）ので、
//   磁場の強さと電流の立ち上がりが別々の仮定にならない
const emagL = e => _emagMur(e) * MU0 * Math.pow(e.turns || 200, 2) * Math.PI * _emagA(e) / 2;
// 電磁石がつくる磁場（既存の磁場領域と重ね合わせる）。円の内側で一様とみなすのは
//   矩形の磁場ツールと同じ理想化で、コイルの内側を切り取って見せるという意味
function electromagnetBzAt(x, y) {
  let bz = 0;
  for (const e of circuitElements) {
    if (e.type !== 'electromagnet') continue;
    const mx = (e.ax + e.bx) / 2, my = (e.ay + e.by) / 2;
    const R = Math.max(10, e.fr || 120);
    if ((x - mx) * (x - mx) + (y - my) * (y - my) > R * R) continue;
    bz += emagBz(e);
  }
  return bz;
}
// ── リレー ───────────────────────────────────────────
//   動作電流で入り、その半分まで下がって初めて戻る（ヒステリシス）。実物のリレーも
//   復帰電流は動作電流より低く、これが無いと閾値付近でカタカタと振動する
function updateRelayContacts() {
  const on = new Map();
  for (const e of circuitElements) {
    if (e.type !== 'relay') continue;
    const I = Math.abs(e.I || 0), Ip = Math.max(1e-6, e.Ipull || 0.02);
    if (!e._on && I >= Ip) e._on = true;
    else if (e._on && I < Ip * 0.5) e._on = false;
    if (e._on) on.set(e.ch | 0, true);
  }
  for (const e of circuitElements) {
    if (e.type !== 'relayswitch') continue;
    const energized = !!on.get(e.ch | 0);
    const next = e.nc ? !energized : energized;    // nc＝ふだん閉じている接点（NOT が作れる）
    if (next !== e.closed) markCircuitDiscontinuity();   // 接点が動いた＝不連続
    e.closed = next;
  }
}
// ── 押しボタン（力学 → 電気）─────────────────────────────
//   ボタンの円に物体がかかっていれば押されている。中心1点だけで判定すると、
//   物体の角がかすっただけでは反応せず「触れているのに入らない」ことになる
function updatePushSwitches() {
  const btns = circuitElements.filter(e => e.type === 'pushswitch');
  if (!btns.length) return;
  for (const e of btns) {
    const mx = (e.ax + e.bx) / 2, my = (e.ay + e.by) / 2;
    const r = Math.max(4, e.br || 16);
    let pressed = false;
    for (const b of objects) {
      if (b.isStatic) continue;
      const a = b._aabb;
      if (!a || a.maxX < mx - r || a.minX > mx + r || a.maxY < my - r || a.minY > my + r) continue;
      if (b.containsPoint(mx, my)) { pressed = true; break; }
      for (let k = 0; k < 8; k++) {                 // 円周8点でかすりも拾う
        const th = k * Math.PI / 4;
        if (b.containsPoint(mx + r * Math.cos(th), my + r * Math.sin(th))) { pressed = true; break; }
      }
      if (pressed) break;
    }
    e._pressed = pressed;
    const next = e.nc ? !pressed : pressed;         // nc＝押すと切れるボタン
    if (next !== e.closed) markCircuitDiscontinuity();
    e.closed = next;
  }
}
// ── モーター（電気 ↔ 力学）───────────────────────────────
//   同じチャンネル番号を持つモーター軸（axle ジョイント）と結ぶ。
//   τ = kI と E = kω を同じ k で結んであるので、電力 EI と機械仕事 τω が厳密に一致する
//   （＝勝手にエネルギーが湧かない）。外から回せば発電機になる。
function motorJoint(ch) {
  for (const j of joints) if (j.type === 'axle' && (j.motorCh | 0) === (ch | 0)) return j;
  return null;
}
function motorOmega(e) {
  const j = motorJoint(e.ch);
  if (!j) return 0;
  return (j.bodyB ? j.bodyB.av : 0) - (j.bodyA ? j.bodyA.av : 0);   // [rad/s]
}
function applyMotorTorques(dt) {
  for (const e of circuitElements) {
    if (e.type !== 'motor') continue;
    const j = motorJoint(e.ch);
    if (!j) continue;
    const bA = j.bodyA, bB = j.bodyB;
    const invIa = bA && !bA.isStatic ? bA.invInertia : 0;
    const invIb = bB && !bB.isStatic ? bB.invInertia : 0;
    if (invIa + invIb <= 0) continue;
    // τ [N·m] → 内部トルク [kg·px²/s²] は ×PPM²。角力積 J は相対角速度を増やす向き
    const J = (e.k || 0.05) * (e.I || 0) * dt * M2PX * M2PX;
    if (!Number.isFinite(J) || J === 0) continue;
    // ★起こすのは「眠るまでの時間このトルクを受け続けたら、眠りのしきい値の角速度に届く」
    //   ときだけ。そのときは眠りのタイマーも戻す（導体棒の applyRodForces と同じ）。
    //   起こすだけだと、止まっていた間に溜まったタイマーのせいで tick の終わりの
    //   updateSleeping がすぐ眠らせ直し、速度を 0 に戻し続ける（実測：眠っていた台車は
    //   電流 2.35A＝止まったときのトルクを受けながら 2.5 秒動かなかった。1サブステップで
    //   1.8rad/s 入る強さ）。
    //   ★逆に、電流が 0 でさえなければ起こす、にすると止まった装置が永久に眠れない。
    //     接触のわずかな揺れ → 起電力 → 電流 → トルク、が輪になって揺れが消えず、
    //     発電ブレーキの輪に 1e-7〜5e-6A が流れ続けた（電流の点が止まったまま残った）。
    const kick = Math.abs(J) * Math.max(invIa, invIb);   // このサブステップで入る角速度 [rad/s]
    const wake = kick * (SLEEP_TIME_TH / dt) >= SLEEP_ANG_TH;
    if (bA && !bA.isStatic) { bA.av -= J * invIa; if (wake) { bA.sleeping = false; bA.sleepTimer = 0; } }
    if (bB && !bB.isStatic) { bB.av += J * invIb; if (wake) { bB.sleeping = false; bB.sleepTimer = 0; } }
    const w = j.getWorldAnchorA();
    if (bA && !bA.isStatic && bA.showForces) bA.recordTorque('driveTorque', -J, w.x, w.y, 'motor'+e.id);
    if (bB && !bB.isStatic && bB.showForces) bB.recordTorque('driveTorque',  J, w.x, w.y, 'motor'+e.id);
  }
}
// ── ダイオード（Shockley）─────────────────────────────
const V_TH      = 0.025852;   // [V] kT/q（300K）
const DIODE_N   = 1.7;        // 理想係数（一般的なシリコンダイオードの実測域）
const DIODE_IF  = 0.02;       // [A] 順方向電圧 Vf を定義する基準電流（20mA）
const _diodeNVt = () => DIODE_N * V_TH;
// Vf と基準電流から飽和電流 Is を逆算する。ユーザーには Vf だけを見せるための変換
const _diodeIs = e => DIODE_IF / (Math.exp(Math.max(0.05, e.Vf || 0.7) / _diodeNVt()) - 1);
const _diodeI  = (e, v) => _diodeIs(e) * (Math.exp(Math.min(v / _diodeNVt(), 80)) - 1);
// SPICE の pnjlim。指数関数は1回の反復で簡単に桁溢れするので、順方向の電圧増分を
//   対数的に抑えて Newton 法を収束させる（この制限が無いと発散して解が出ない）
function _pnjlim(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    } else vnew = vt * Math.log(Math.max(vnew, vt) / vt);
  }
  return vnew;
}
// ── 豆電球（非直線抵抗）───────────────────────────────
//   フィラメントは温度で抵抗が変わる。冷えているときは定格の約1/12しかないので、
//   点灯直後に突入電流が流れ、温まるにつれて電流が落ちる。I-V グラフが曲がるのは
//   この温度変化のせいで、抵抗値を「非直線な関数」として与えているわけではない。
const T_AMB          = 293;      // [K] 室温
const BULB_T_RATED   = 2800;     // [K] 定格点灯時のフィラメント温度
const BULB_COND_FRAC = 0.2;      // 定格点灯時に伝導で逃げる熱の割合（下の bulbLoss の★）
const BULB_T_MELT    = 3695;     // [K] タングステンの融点＝ここを超えたら切れる
const TUNGSTEN_ALPHA = 4.5e-3;   // [1/K] タングステンの抵抗温度係数
function bulbParams(e) {
  const Vr = Math.max(0.1, e.Vr || 2.5), Pr = Math.max(1e-3, e.Pr || 0.75);
  const Rhot  = Vr * Vr / Pr;                                      // 定格点灯時の抵抗
  const Rcold = Rhot / (1 + TUNGSTEN_ALPHA * (BULB_T_RATED - T_AMB));
  // 定格でつり合うように放射定数を決める（P = k(T⁴ − T₀⁴) がステファン・ボルツマン）
  //   ★定格の電力 Pr のうち BULB_COND_FRAC は伝導（導線・支え・ガス）で逃げる（下の★）
  const krad  = (1 - BULB_COND_FRAC) * Pr / (Math.pow(BULB_T_RATED, 4) - Math.pow(T_AMB, 4));
  const hcond = BULB_COND_FRAC * Pr / (BULB_T_RATED - T_AMB);
  // 熱容量は「定格付近での時定数 τ = C/(4kT³)」から逆算する
  const Cth = Math.max(1e-6, e.tau || 0.12) * (4 * krad * Math.pow(BULB_T_RATED, 3) + hcond);
  return { Rhot, Rcold, krad, hcond, Cth };
}
// ★熱の遅れなし（tau ≤ 0）。既定の 0.12秒は定格点灯のときの時定数で、冷め方が放射 ∝ T⁴ だけ
//   なので冷えているほど T³ で遅くなった（室温付近では 100秒近い）。そのため電圧を上げる速さで
//   電流−電圧グラフの形が変わり、特性曲線が読めなかった（実測：E を 0→5V を 10秒で上げると
//   V＝0.25V で I＝0.183A、十分待つと 0.077A）。伝導の項（bulbLoss）を足して室温の時定数は
//   1.8秒まで縮んだが、手で回す速さではまだ追いつかない。つり合いの温度を直接解けば速さによらない。
//   ★小さな正の tau で近づけるのではだめ：温度の更新は前進オイラーなので、サブステップより
//     短い時定数では振動する。つり合いは回路の Newton 反復の中で解く（solveCircuit）。
const bulbStatic = e => !(e.tau > 0);
// 電圧 V でのつり合いの温度：V²/R(T) ＝ 逃げる熱（bulbLoss）。左辺は T で減り右辺は増えるので根は1つ（二分法）
function bulbTeq(e, V) {
  const p = bulbParams(e), P0 = V * V;
  let lo = T_AMB, hi = 2 * BULB_T_MELT;
  const f = T => P0 / (p.Rcold * (1 + TUNGSTEN_ALPHA * (T - T_AMB))) - bulbLoss(p, T);
  if (f(hi) > 0) return hi;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// つり合いの電流（特性曲線そのもの）
function bulbIstatic(e, V) {
  return V / Math.max(1e-9, bulbParams(e).Rcold * (1 + TUNGSTEN_ALPHA * (bulbTeq(e, V) - T_AMB)));
}
// フィラメントから逃げる熱 [W]：放射 k(T⁴ − T₀⁴) ＋ 伝導 h(T − T₀)
//   ★伝導（導線・支えへの熱伝導、封入ガスへの伝熱）を足した。以前は放射だけで、放射は低温で
//     ほとんど効かないため、冷えたフィラメントの応答が T³ で遅くなっていた。室温付近の時定数
//     （熱容量 ÷ 逃げる熱の温度微分）は τ ＝ 0.12 のとき 105秒 → 1.8秒（BULB_COND_FRAC ＝ 0.2）。
//     低温では伝導が主役、高温では放射が主役、が実物の姿。
//   ★BULB_COND_FRAC ＝ 0.2 は見当で、実物の値で確かめていない（小さな低電圧の電球ほど
//     フィラメントが短く、端から逃げる割合が大きい）。定格点（Vr・Pr・2800K）はこの値によらない。
//     変えると低い電圧の電流が変わる（V ＝ 0.25V の静特性：0 → 0.078A、0.1 → 0.100A、
//     0.2 → 0.121A、0.3 → 0.139A）。切れる電圧：5.02・4.88・4.73・4.58V（どれも定格の約2倍）。
//   ★それでも手で回す速さ（数秒〜数十秒）では、低い電圧で温度が追いつかない（τ ＝ 0.12、
//     E を 0→5V を 20秒で上げて V ≧ 0.5V の電流が静特性から最大 24%）。速さによらない曲線が
//     要るときは τ ＝ 0（熱の遅れなし）を使う（bulbStatic）。
function bulbLoss(p, T) {
  return p.krad * (Math.pow(T, 4) - Math.pow(T_AMB, 4)) + p.hcond * (T - T_AMB);
}
function bulbR(e) {
  if (e.burnt) return 1e12;                                        // 切れた＝断線
  const T = e.T || T_AMB;
  return bulbParams(e).Rcold * (1 + TUNGSTEN_ALPHA * (T - T_AMB));
}
// 明るさ 0..1。黒体放射のうち可視域（550nm）の成分をウィーン近似 T⁴·exp(−hc/λkT) で
//   見積もり、定格点灯時を 1 とする。温度が下がると急激に暗くなるのはこの指数のため。
const _bulbLumRaw = T => Math.pow(T, 4) * Math.exp(-26170 / T);
const BULB_LUM_RATED = _bulbLumRaw(BULB_T_RATED);
function bulbGlow(e) {
  if (e.burnt) return 0;
  const T = e.T || T_AMB;
  if (T <= T_AMB + 1) return 0;
  return Math.max(0, Math.min(1.4, _bulbLumRaw(T) / BULB_LUM_RATED));
}
const CIRCUIT_TOOLS = Object.keys(CIRCUIT_DEFAULTS);
// つまみの可動域。★右パネル（js/ui/slider.js）とリモコンの窓（js/app/remote.js）が
//   同じ値を引く。書き写すと片方だけ直すことになる。
const CIRCUIT_KNOB_RANGE = {
  R: { lo: 0.1,  hi: 100000, step: 0.1 },   // 抵抗 [Ω]
  V: { lo: -50,  hi: 50,     step: 0.5, detent: true },   // 起電力 [V]：負で向きが逆・0 に吸着（slider.js の zeroDetentTicks）
  C: { lo: 1e-6, hi: 0.1 },                 // 容量 [F]
  L: { lo: 0.01, hi: 100,    step: 0.01 },  // 自己インダクタンス [H]
};
// ツールウィンドウでカーソルを合わせたときの1行説明（記号だけでは分からないため）
const CIRCUIT_TIPS = {
  wire:        '抵抗ゼロの導線。つないだ両端は同じ電位になります。クリックで継ぎ足していきます',
  resistor:    'オームの法則 V = RI にしたがう抵抗。直列なら和、並列なら逆数の和',
  slidewire:   '一様な抵抗線の上を接点がすべる抵抗。両端と接点の3端子で、抵抗が接点の位置で長さの比に分かれます。電位差計・分圧回路に',
  dcsource:    '一定の起電力を出す電池。1点目が＋極。内部抵抗 r で端子電圧 V = E − rI が出ます',
  acsource:    'V(t) = V·sin(2πft) の交流電源。振幅と振動数を指定します',
  switch:      '手で開閉するスイッチ。プロパティの「閉じる」で切り替えます',
  ammeter:     '電流を測ります。回路に<b>直列</b>につなぎます。既定は理想（0Ω）',
  voltmeter:   '電圧を測ります。測りたい部分に<b>並列</b>につなぎます。既定は実質∞（10MΩ）',
  capacitor:   '電荷をためます。I = C·dV/dt。抵抗と組むと時定数 τ = RC で充放電します',
  inductor:    '電流の変化を妨げます。V = L·dI/dt。抵抗と組むと時定数 τ = L/R',
  diode:       '順方向にだけ電流を流します。順電圧 V<sub>f</sub> を 2V 前後にすると赤色LEDとして使えます',
  bulb:        'フィラメントの温度で抵抗が変わる<b>非直線抵抗</b>。電流が流れると温度に応じて光ります',
  pushswitch:  '物体が触れている間だけ開閉します。<b>力学の出来事を回路の入力にする</b>ための素子',
  electromagnet:'電流に比例した磁場をまわりに作ります。<b>回路で力学を動かす</b>ための素子',
  relay:       'コイル。動作電流を超えると、同じ番号のリレー接点をまとめて動かします',
  relayswitch: '同じ番号のリレーコイルに連動する接点。「ふだん閉じている」にすると NOT が作れます',
  motor:       '同じ番号のモーター軸へ電流を送ります。回すと逆起電力を返すので発電機にもなります',
};
let circuitElements = [];
let circuitStart = null;              // 2クリック配置の1点目 {x,y}
let circuitChainPlaced = false;       // ★導線チェーンを1本以上置いたか（履歴を1回だけ積むため）
let circuitVertexDrag = null;         // ★編集ツールで掴んだ回路素子の端点 {items:[{e,end}], armed, moved}（③で使用）
let selectedCircuit = null;           // 選択中の回路素子
const NODE_MERGE_PX = 10;             // これ以内の端点は同一ノードへ縮約 [px]
let uidCircuit = 0;
// ── 積分法：台形則（既定）と、不連続の直後だけ使う後退オイラー ──────────
//   コンデンサーとコイルは台形則（双一次変換）で解く。後退オイラーは1次で、
//   回路に無いはずの抵抗を作ってしまう（抵抗ゼロの LC 振動が減衰する＝数値散逸）。
//   台形則は LC のエネルギーを厳密に保存し、位相誤差も O(Δt²) に落ちる。
//   ★台形則の弱点は「1ステップごとに符号が反転する成分が永久に減衰しない」こと。
//     スイッチの開閉のような不連続の瞬間にこの成分が入ると、以後ずっとギザギザが
//     残る（トラペゾイダル・リンギング）。対策は定番どおり、不連続の直後の1ステップ
//     だけ後退オイラーで踏むこと。後退オイラーはこの振動モードを完全に潰す（L安定）。
//     1ステップだけなので精度への影響は無視できる。
let circuitDisc = true;               // 次の1ステップを後退オイラーで踏むか（初回は true）
let _circSigPrev = null;
// ★不連続を「過渡のトリガ」として使うかどうか。スイッチの開閉・値の変更は使うが、
//   シーン読み込みと Undo は状態が飛んだだけで物理的な過渡ではないので使わない。
let _circTrigPend = false;
let _circTrigSuppress = false;
function markCircuitDiscontinuity(trigger = true) {
  circuitDisc = true;
  if (trigger) _circTrigPend = true; else _circTrigSuppress = true;
}
// ── 蓄えた状態のリセット ──────────────────────────────────────────
//  コンデンサーの電荷（Q = C·Vprev）、コイル・電磁石の磁束（Φ = L·Iprev）、豆電球の
//  フィラメント温度は、前のステップから持ち越される「回路の記憶」。同じ実験をもう一度
//  やるには、回路を組み替えずにこれを0へ戻せると早い。
//  ★対象はその素子と電気的につながっている回路だけ。1画面に複数の回路を並べて
//    見比べる使い方があるので、関係のない回路まで巻き込まない。
//  ★切れた豆電球（burnt）は直さない。壊れたものが操作ひとつで直ると、
//    「切れる」という現象そのものが軽くなる。作り直しは削除して置き直す。
const CIRCUIT_STORAGE_TYPES = new Set(['capacitor', 'inductor', 'electromagnet', 'bulb']);
function circuitStorageTargets(elem) {
  if (!elem) return [];
  const comp = circuitComponentMap();
  const key = comp.get(elem.id);
  if (key === undefined) return [];
  return circuitElements.filter(e => comp.get(e.id) === key && CIRCUIT_STORAGE_TYPES.has(e.type));
}
function resetCircuitStorage(elem) {
  const targets = circuitStorageTargets(elem);
  if (!targets.length) return 0;
  pushUndo();   // Vprev/Iprev/T はスナップショットに入っている（serializeCircuit は _ 以外を全部拾う）
  for (const e of targets) {
    e.Vprev = 0; e.Iprev = 0;              // コンデンサーの電荷・コイルの磁束
    e.I = 0; e.Vread = 0;                  // 表示用の読み値も揃える
    if (e.type === 'bulb') e.T = T_AMB;    // フィラメント温度は室温へ（burnt はそのまま）
  }
  // ★過渡のトリガとして印を付ける（trigger=true）。放電しきったコンデンサーに電圧が
  //   かかった状態＝まさに新しい充電の始まりなので、グラフの捕捉もここから始めたい。
  markCircuitDiscontinuity(true);
  return targets.length;
}
// 回路の形と開閉状態の指紋。素子の追加・削除・移動・スイッチの開閉を拾う。
//   値の変更（R・C・L・V など）は updateCircuitProp から明示的に印を付ける。
function _circuitSignature() {
  let s = circuitElements.length * 7919;
  for (const e of circuitElements) {
    s = (s * 31 + e.id + (e.closed ? 13 : 0) + (e.burnt ? 17 : 0)) % 2147483647;
    s = (s + Math.round(e.ax) + Math.round(e.ay)*3 + Math.round(e.bx)*5 + Math.round(e.by)*7) % 2147483647;
  }
  return s;
}

class CircuitElement {
  constructor(type, ax, ay, bx, by) {
    this.id = ++uidCircuit;
    this.type = type;
    this.ax = ax; this.ay = ay;
    this.bx = bx; this.by = by;
    Object.assign(this, JSON.parse(JSON.stringify(CIRCUIT_DEFAULTS[type] || {})));
    this.Vprev = 0;   // コンデンサー端子電圧の前ステップ値
    this.Iprev = 0;   // コイル電流の前ステップ値
    this.T = T_AMB;   // 豆電球のフィラメント温度 [K]
    this._Vd = 0;     // ダイオードの動作点（Newton 法の初期値として持ち越す）
    this.I = 0;       // 解いた電流（電流計・電源の表示用）
    this.Vread = 0;   // 端子間電圧（電圧計の表示用）
  }
}

// ── すべり抵抗の幾何 ────────────────────────────────
//   接点の端子 c と、抵抗線の上の接点 P。どちらも a・b から毎回導く（保存するのは pos と cOff
//   だけ）ので、素子を動かす・回す・拡大するどの操作でも、端子は素子について回る。
function slideWirePos(e) { return Math.max(0, Math.min(1, +e.pos || 0)); }
// 抵抗線の長さ [cm]（＝px）。接点の位置は UI では端 a からの長さ AP [cm] で見せる
//   （電位差計で読むのは長さ。目盛りも長さの 1/10 ごと）
function slideWireLen(e) { return Math.hypot(e.bx - e.ax, e.by - e.ay); }
function slideWireP(e) {
  const t = slideWirePos(e);
  return { x: e.ax + (e.bx - e.ax) * t, y: e.ay + (e.by - e.ay) * t };
}
function slideWireC(e) {
  const dx = e.bx - e.ax, dy = e.by - e.ay, L = Math.hypot(dx, dy) || 1;
  const o = +e.cOff || 0;
  return { x: (e.ax + e.bx) / 2 - dy / L * o, y: (e.ay + e.by) / 2 + dx / L * o };
}
// 素子の端子の一覧。ふつうは a・b の2つ、すべり抵抗だけ接点の端子 c が加わる。
//   ノード・吸着・端点の数え上げはこれを通す（c を忘れると接点に導線がつながらない）
function circuitTerminals(e) {
  const out = [{ x: e.ax, y: e.ay, end: 'a' }, { x: e.bx, y: e.by, end: 'b' }];
  if (e.type === 'slidewire') { const c = slideWireC(e); out.push({ x: c.x, y: c.y, end: 'c' }); }
  return out;
}
// ★すべり抵抗の端子 c は a・b から導く点なので、素子を動かすと c だけ先に動き、そこへ
//   つないだ導線の端が置き去りになる（a・b は端点ドラッグが重なった端をいっしょに運ぶが、
//   c はどの操作からも見えない）。前回の c に残っている端点を、新しい c へ連れていく。
//   いっしょに動いた端（まとめて平行移動）は前回の c にはもう居ないので、二重には動かない。
//   ソルバの前と描画の前に呼ぶ（停止中の編集でも追従させるため）。
function followSlideWireTerminals() {
  const m2 = NODE_MERGE_PX * NODE_MERGE_PX;
  for (const e of circuitElements) {
    if (e.type !== 'slidewire') continue;
    const c = slideWireC(e), p = e._cPrev;
    e._cPrev = c;
    if (!p || (Math.abs(p.x - c.x) < 1e-9 && Math.abs(p.y - c.y) < 1e-9)) continue;
    for (const w of circuitElements) {
      if (w === e) continue;
      if ((w.ax-p.x)*(w.ax-p.x) + (w.ay-p.y)*(w.ay-p.y) <= m2) { w.ax = c.x; w.ay = c.y; }
      if ((w.bx-p.x)*(w.bx-p.x) + (w.by-p.y)*(w.by-p.y) <= m2) { w.bx = c.x; w.by = c.y; }
    }
  }
}

// ── 素子の向き（極性）────────────────────────────────
//   端点 a→b がそのまま素子の向きになっている。ソルバは V_a − V_b の形でスタンプし、
//   描画も a→b に沿って記号を描くので、両端の座標を入れ替えるだけで
//   「回路図の記号」「解いた電流の符号」の両方が同時に反転する。
//   ここに挙げたのは向きが物理的に意味を持つ素子だけ。抵抗・コンデンサー・コイル・
//   豆電球・スイッチは向きを変えても何も変わらないので対象外にする（リレーコイルも
//   動作判定が |I| なので、向きでは動作が変わらない）。
const CIRCUIT_DIRECTIONAL = new Set([
  'dcsource',      // ＋と−が入れ替わる
  'acsource',      // 位相が π ずれる（直列の2電源の向きを変えると和が差になる）
  'diode',         // 順方向が逆になる
  'ammeter',       // 針の振れる向き＝電流の符号が変わる
  'voltmeter',     // 測定値の符号が変わる
  'motor',         // トルクの向き（＝軸の回転方向）が変わる
  'electromagnet', // コイルに流れる向きが変わり、磁場の向きが反転する
]);
// 両端を入れ替える。a→b を基準に定義している状態量は、いっしょに符号を変えなければ
// 反転した瞬間だけ辻褄が合わなくなる（コイルの電流が逆向きのまま引き継がれる等）。
function flipCircuitElement(e) {
  const ax = e.ax, ay = e.ay;
  e.ax = e.bx; e.ay = e.by;
  e.bx = ax;   e.by = ay;
  e.Vprev = -(e.Vprev || 0);   // コンデンサー端子電圧の前ステップ値
  e.Iprev = -(e.Iprev || 0);   // コイル・電磁石の電流の前ステップ値
  e._Vd   = -(e._Vd   || 0);   // ダイオードの動作点（Newton 法の初期値）
  e.I     = -(e.I     || 0);   // 表示中の電流。次に解くまでパネルの符号を正しく保つ
  e.Vread = -(e.Vread || 0);   // 同じく端子間電圧
}

// ── ノード縮約（union-find）─────────────────────────
//   端点座標が近ければ同一ノード。導線・閉スイッチ・電流計(0V源扱い)は…
//   → 導線と閉スイッチは 0Ω なので両端も同一ノードへ union する。
//   → 電流計は電流を測るため 0V 電源ブランチとして残す（union しない）。
function _ufFind(p, i){ while(p[i]!==i){ p[i]=p[p[i]]; i=p[i]; } return i; }
function _ufUnion(p, a, b){ p[_ufFind(p,a)] = _ufFind(p,b); }

// すべての端点を集め、ノード番号を割り当てる。rods は導体棒の接点ペア。
function buildCircuitNodes(rods) {
  const pts = [];   // {x,y, elem, end}   end: 'a'|'b'
  const at = new Map();   // elem -> {a:index, b:index}
  const push = (x,y,elem,end) => {
    const i = pts.length; pts.push({ x, y, elem, end });
    const rec = at.get(elem) || at.set(elem, {}).get(elem); rec[end] = i;
  };
  for (const e of circuitElements) for (const q of circuitTerminals(e)) push(q.x,q.y,e,q.end);
  for (const r of rods)            { push(r.ax,r.ay,r,'a'); push(r.bx,r.by,r,'b'); }
  const n = pts.length;
  const parent = pts.map((_,i)=>i);
  // (1) 位置マージ
  const m2 = NODE_MERGE_PX * NODE_MERGE_PX;
  for (let i=0;i<n;i++) for (let j=i+1;j<n;j++){
    const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
    if (dx*dx+dy*dy <= m2) _ufUnion(parent,i,j);
  }
  // (1.5) ★導体棒の接点は、触れている導線と同じノードにする。
  //   接点はレール導線の「途中」にあることが多く、端点どうしの位置マージでは
  //   絶対に繋がらない（＝棒が電気的に孤立して電流が流れず、F=BIL も出ない）。
  //   導線は0Ωで両端が縮約されるので、どちらの端点に繋いでも同じノードになる。
  for (const r of rods) {
    const ri = at.get(r); if (!ri) continue;
    const wa = r.wireA && at.get(r.wireA), wb = r.wireB && at.get(r.wireB);
    if (wa && ri.a !== undefined) _ufUnion(parent, ri.a, wa.a);
    if (wb && ri.b !== undefined) _ufUnion(parent, ri.b, wb.a);
  }
  // (2) 0Ω素子（導線・閉スイッチ）の両端を union
  for (let i=0;i<n;i++){
    const p=pts[i];
    if (p.end!=='a') continue;
    const j = pts.findIndex((q,k)=>k>i && q.elem===p.elem && q.end==='b');
    if (j<0) continue;
    const e=p.elem;
    // ★運動起電力の立っている導線は縮約しない。両端が同じノードだと起電力を置く場所が
    //   無くなる（0Ω＝1点に潰れる）ので、そのときだけ電圧型ブランチへ格上げする。
    if (isZeroOhmElem(e) && !hasMotionEmf(e)) _ufUnion(parent,i,j);
  }
  // ノード番号を連番へ
  const rootToNode = new Map();
  const nodeOf = new Map();   // pts index -> node id
  let next=0;
  for (let i=0;i<n;i++){
    const r=_ufFind(parent,i);
    if (!rootToNode.has(r)) rootToNode.set(r, next++);
    nodeOf.set(i, rootToNode.get(r));
  }
  // 素子ごとに (nodeA,nodeB) を引けるよう対応表を作る
  const elemNodes = new Map();
  for (let i=0;i<n;i++){
    const p=pts[i];
    const rec = elemNodes.get(p.elem) || elemNodes.set(p.elem, {}).get(p.elem);
    rec[p.end] = nodeOf.get(i);
  }
  return { nodeCount: next, elemNodes };
}

// ── MNA ソルバ（group-2：電圧型ブランチに電流未知数）──────────
function _solveLinear(A, z) {
  const n = z.length;
  for (let c=0;c<n;c++){
    let piv=c;
    for (let r=c+1;r<n;r++) if (Math.abs(A[r][c])>Math.abs(A[piv][c])) piv=r;
    if (Math.abs(A[piv][c])<1e-14) continue;
    [A[c],A[piv]]=[A[piv],A[c]]; [z[c],z[piv]]=[z[piv],z[c]];
    const inv=1/A[c][c];
    for (let r=0;r<n;r++){ if(r===c)continue; const f=A[r][c]*inv; if(!f)continue;
      for (let k=c;k<n;k++) A[r][k]-=f*A[c][k]; z[r]-=f*z[c]; }
  }
  const x=new Array(n).fill(0);
  for (let i=0;i<n;i++) if (Math.abs(A[i][i])>1e-14) x[i]=z[i]/A[i][i];
  return x;
}

// 回路を1ステップ解く。rods=[{ax,ay,bx,by, emf, R, body, axisX,axisY, L_m}] 導体棒。
//   ★now は「このサブステップの時刻」[s]。world.simTime は1ティックに1回しか進まないので、
//     substeps>1 のときそれを使うと交流電源の起電力がサブステップ間で凍りつく（後述）。
// 不連続のステップを何分割して踏むか。後退オイラーはL安定なので、細かく刻むほど
//   速い成分が完全に減衰し、区間終端の電流・電圧が正確になる。台形則へ渡す
//   「1つ前の値」がここで正確になっていないと、受け渡しのずれが振動の種になる。
//   イベントの瞬間だけなので、この分割の計算コストは無視できる。
const CIRCUIT_EVENT_SUBSTEPS = 8;
// ★過渡のトリガ捕捉中の細分。サブステップ(240Hz)をさらに8分割＝1920Hz で解いて記録する。
//   既定の RC は τ=(R+r)C≈10.5ms なので τ あたり20点になり、指数曲線が曲線として出る
//   （1ティック 16.7ms の通常記録では τ より粗く、点が1つも取れない）。
//   刻みを細かくするのは見た目だけの話ではない。台形則のコンデンサーの増幅率は
//   (1−dt/2τ)/(1+dt/2τ) で、dt≫τ だと −1 に近づいて減衰しない振動を出す。
//   捕捉が要る場面＝τ が dt に対して小さい場面なので、精度の対策も兼ねる。
const CIRCUIT_FINE_SUBSTEPS = 8;
function solveCircuit(dt, rods, now) {
  followSlideWireTerminals();
  const sig = _circuitSignature();
  if (_circSigPrev === null || sig !== _circSigPrev) { circuitDisc = true; _circTrigPend = true; }
  _circSigPrev = sig;
  if (_circTrigSuppress) { _circTrigPend = false; _circTrigSuppress = false; }
  const tBeg = (now === undefined ? world.simTime : now) - dt;
  if (circuitDisc) {
    circuitDisc = false;
    if (_circTrigPend) { _circTrigPend = false; circGraphCaptureBegin(); }
    const h = dt / CIRCUIT_EVENT_SUBSTEPS;
    for (let s = 0; s < CIRCUIT_EVENT_SUBSTEPS; s++) {
      _solveCircuitStep(h, rods, tBeg + (s + 1) * h, true);
      circGraphFineSample(h);
    }
    _circSigPrev = _circuitSignature();     // 踏んでいる間に接点が動いた場合に取り直す
    return;
  }
  _circTrigPend = false;
  // 捕捉中は同じ細分で踏み続ける（トリガ直後の1ステップだけでは 5τ をまかなえない）
  if (circGraphCaptureActive()) {
    const h = dt / CIRCUIT_FINE_SUBSTEPS;
    for (let s = 0; s < CIRCUIT_FINE_SUBSTEPS; s++) {
      _solveCircuitStep(h, rods, tBeg + (s + 1) * h, false);
      circGraphFineSample(h);
    }
    return;
  }
  _solveCircuitStep(dt, rods, now, false);
}
// ★解かずに戻るときは読み値を 0 にしてから戻る。放っておくと最後に解いた電流が
//   そのまま残り、電流計も豆電球もグラフも「もう流れていない電流」を表示し続ける。
//   起きるのは行列が空になるとき＝回路全体が1ノードに潰れたとき。抵抗だけの閉ループが
//   まさにこれで（導線が0Ωで縮約され、四隅が1点になる）、運動起電力が消えた瞬間に
//   毎回この道を通る。逆に言うと、この機能を入れるまでは滅多に踏まない道だった。
function _zeroCircuitReadings(all) {
  for (const e of all) { e.I = 0; e.Vread = 0; }
}
// 接地（ノード0）へどの素子を通ってもつながらない島を探し、島ごとに代表ノードを1つ返す。
//   「つながる」は行列に a–b の結合を入れる素子。電圧型ブランチ（電源・コイルなど）と
//   コンダクタンスが Gmin 以上の素子（抵抗・コンデンサーの 2C/Δt・電圧計など）。
//   ★Gmin 未満の結合（切れた豆電球の 1e-12 S）は切れているとみなし、その先を島にする。
//     行列の他の成分（1/SRC_R_MIN ＝ 1e3 S）と 15 桁離れた値だけで島を支えると消去が崩れる。
//     同じ理由で C が極端に小さい（2C/Δt < Gmin ＝ 約 1e-12 F 以下）コンデンサーの向こうも
//     島として扱うが、そこは従来どおり Gmin の漏れが出る（実用の範囲より 9 桁小さい）。
//   ダイオードは Gd に Gmin を含むので常につながる。開いたスイッチ・縮約済みの導線は何も入れない。
function _floatingIslandRoots(all, elemNodes, nodeCount, dt, beStep, Gmin) {
  const p = Array.from({ length: nodeCount }, (_, i) => i);
  for (const e of all) {
    const nd = elemNodes.get(e); if (!nd || nd.a === nd.b) continue;
    const t = e.type || 'rod';
    let g = Infinity;                                      // 電圧型ブランチ・ダイオード
    if      (t === 'switch' || t === 'pushswitch' || t === 'relayswitch') continue;
    else if (t === 'wire')      { if (e._k < 0) continue; }
    else if (t === 'resistor')  g = 1 / Math.max(1e-9, e.R);
    else if (t === 'bulb')      g = 1 / Math.max(1e-9, bulbR(e));
    else if (t === 'voltmeter') g = 1 / _voltmeterR(e);
    else if (t === 'relay')     g = 1 / Math.max(1e-3, e.R || 50);
    else if (t === 'capacitor') g = (beStep ? 1 : 2) * e.C / dt;
    else if (t === 'slidewire') {                          // 抵抗線の2区間（a–P と P–b）
      if (1 / Math.max(1e-9, e.R) >= Gmin) { _ufUnion(p, nd.a, nd.c); _ufUnion(p, nd.c, nd.b); }
      continue;
    }
    if (g >= Gmin) _ufUnion(p, nd.a, nd.b);
  }
  const g0 = _ufFind(p, 0), roots = new Map();
  for (let nd = 1; nd < nodeCount; nd++) {
    const r = _ufFind(p, nd);
    if (r !== g0 && !roots.has(r)) roots.set(r, nd);
  }
  return roots.values();
}
// 交流電源の位相 θ(t)。★振動数を変えても位相を跳ばさない（発電機の回転は速さが変わっても
//   向きは飛ばない）。以前は 2πf·t を全体の時刻で出していたので、t = 100 秒で f を 0.01Hz
//   動かすだけで位相が 6.3rad 飛び、つまみを回すたびに電圧が段になって跳ねた（その段が
//   コイル・コンデンサーに過渡を起こし、フェーザ図が「まだ過渡状態」で出なくなる）。
//   変わった瞬間の位相を種 _th0 として控え、そこから新しい振動数で積み上げる。
//   一度も変えなければ 2πf·t のまま（既存のシーンの波形は変わらない）。
//   時刻が戻ったとき（新規作成・読み込み）も 2πf·t へ戻す。
function acSourceTheta(e, t) {
  const f = e.freq || 0;
  if (e._fAt === undefined || !(t >= e._t0)) {
    e._fAt = f; e._t0 = 0; e._th0 = 0;
  } else if (e._fAt !== f) {
    e._th0 += 2 * Math.PI * e._fAt * (t - e._t0);
    e._t0 = t; e._fAt = f;
  }
  return e._th0 + 2 * Math.PI * f * (t - e._t0);
}
function _solveCircuitStep(dt, rods, now, beStep) {
  const all = [...circuitElements, ...rods];
  if (all.length === 0) return;
  const { nodeCount, elemNodes } = buildCircuitNodes(rods);
  if (nodeCount === 0) { _zeroCircuitReadings(all); return; }
  const N = nodeCount - 1;                 // ノード0を接地に。行列サイズはN
  // 電圧型ブランチ（電源・交流・電流計(0V源)・導体棒・コイル）に電流未知数を割り当て
  const vBranch = [];
  // ★運動起電力の立った導線もここへ入れる（0Ωの縮約を外した枝＝起電力源そのもの）。
  //   両端が同じノードのまま（短すぎて位置マージで潰れた導線）のときは電圧式が
  //   0=0 の空行になるので、格上げしない。
  for (const e of all) {
    const t = e.type || 'rod';
    const nd = elemNodes.get(e);
    if (t==='dcsource'||t==='acsource'||t==='ammeter'||t==='inductor'||t==='rod'
        ||t==='electromagnet'||t==='motor'
        ||(t==='wire' && hasMotionEmf(e) && nd && nd.a !== nd.b)) {
      e._k = N + vBranch.length; vBranch.push(e);
    } else e._k = -1;
  }
  const sz = N + vBranch.length;
  if (sz <= 0) { _zeroCircuitReadings(all); return; }   // ★1ノードに潰れた＝流れようがない
  const gi = nd => nd - 1;                  // ノード0(接地)は行列外
  // ★非線形素子（ダイオード）があれば Newton-Raphson で反復する。
  //   各反復で「その動作点における接線＝コンダクタンス Gd と等価電流源 Ieq」に置き換えて
  //   線形回路として解き、電圧が動かなくなったら収束（SPICE と同じ作り）。
  //   豆電球は非線形だが、抵抗を決めるのは温度という状態量で、1ステップの中では
  //   定数として扱えるので反復には入れない（時定数 τ ≫ dt なのでこれで十分）。
  //   ★ただし熱の遅れなし（tau ≤ 0）の豆電球は、特性曲線 I(V) をダイオードと同じく接線で
  //     置き換えて反復に入れる（bulbStatic の★）。
  const nlDiodes = all.filter(e => (e.type || 'rod') === 'diode');
  const nlBulbs = all.filter(e => e.type === 'bulb' && !e.burnt && bulbStatic(e));
  for (const e of nlBulbs) if (!Number.isFinite(e._Vb)) e._Vb = e.Vread || 0;
  const maxIter = (nlDiodes.length || nlBulbs.length) ? 100 : 1;
  const nVt = _diodeNVt();
  const vcrit = nVt * Math.log(nVt / (Math.SQRT2 * Math.max(1e-30, _diodeIs({ Vf: 0.7 }))));
  let x = null;
  for (let iter = 1; iter <= maxIter; iter++) {
  const A = Array.from({length:sz},()=>new Array(sz).fill(0));
  const z = new Array(sz).fill(0);
  const gStamp=(a,b,g)=>{ const ia=gi(a),ib=gi(b);
    if(ia>=0)A[ia][ia]+=g; if(ib>=0)A[ib][ib]+=g;
    if(ia>=0&&ib>=0){A[ia][ib]-=g;A[ib][ia]-=g;} };
  const iStamp=(a,b,I)=>{ const ia=gi(a),ib=gi(b);   // 電流I が a→b
    if(ia>=0)z[ia]-=I; if(ib>=0)z[ib]+=I; };
  const vStamp=(a,b,k,E)=>{ const ia=gi(a),ib=gi(b);
    if(ia>=0){A[ia][k]+=1;A[k][ia]+=1;}
    if(ib>=0){A[ib][k]-=1;A[k][ib]-=1;} z[k]+=E; };
  // 浮遊部分回路の特異性を防ぐ微小コンダクタンス Gmin を、接地から切れた島にだけ1本ずつ入れる
  //   ★全ノードに対接地で入れる（SPICE定石）と、それ自体が漏れの道になる。
  //     ノード0は素子の並び順で決まるので電源の＋極になることがあり、平行板コンデンサーの
  //     デモ（S1・S2 とも開）では ＋極 → Gmin → コンデンサー → −極 と 20nA が流れ続けて
  //     スイッチを入れていないのに 1e-5 V/s で充電されていた（時定数 C/2Gmin ＝ 10⁶ 秒）。
  //     島ごとに1本なら島から外へ抜ける道にならず、流れは厳密に0になる。
  const Gmin = 1e-9;
  for (const nd of _floatingIslandRoots(all, elemNodes, nodeCount, dt, beStep, Gmin)) gStamp(nd, 0, Gmin);
  const t = (now === undefined ? world.simTime : now);
  for (const e of all) {
    const nodes = elemNodes.get(e);
    if (!nodes) continue;
    const a = nodes.a, b = nodes.b;
    const type = e.type || 'rod';
    if (type==='resistor')      gStamp(a,b, 1/Math.max(1e-9,e.R));
    // ★すべり抵抗：接点 P（＝端子 c と同じノード）で抵抗線を2本の抵抗に割る。
    //   端に寄せた側は 0Ω になるが、抵抗と同じ下限 1e-9Ω を当てるので行列は壊れない
    else if (type==='slidewire') { const tp = slideWirePos(e), R = Math.max(0, e.R || 0);
      gStamp(a, nodes.c, 1/Math.max(1e-9, R*tp));
      gStamp(nodes.c, b, 1/Math.max(1e-9, R*(1-tp))); }
    // 導線：ふだんは 0Ω＝ノード縮約済みで何もしない。運動起電力が立っているときだけ
    // 縮約を外してあるので、棒と同じく起電力源としてスタンプする（内部抵抗は下限だけ）
    else if (type==='wire')     { if (e._k >= 0) { vStamp(a,b,e._k, e._emf);
                                                   A[e._k][e._k] -= SRC_R_MIN; } }
    else if (type==='switch' || type==='pushswitch' || type==='relayswitch') {} // 開＝非接続／閉は縮約済み
    else if (type==='relay')    gStamp(a,b, 1/Math.max(1e-3, e.R || 50));       // コイル＝抵抗
    // ★電磁石：コイルなので L と巻線抵抗 R の直列。積分法はコイルと同じ
    else if (type==='electromagnet') {
      const ia=gi(a), ib=gi(b), k=e._k, L=emagL(e);
      if(ia>=0){A[ia][k]+=1;A[k][ia]+=1;}
      if(ib>=0){A[ib][k]-=1;A[k][ib]-=1;}
      const gL = beStep ? L/dt : 2*L/dt;
      A[k][k] -= (gL + Math.max(1e-3, e.R || 5));
      z[k] += -gL * e.Iprev - (beStep ? 0 : e.Vprev);   // Vprev＝コイル部分だけの端子電圧
    }
    // ★モーター：電機子抵抗 R と逆起電力 E = kω の直列。ω は軸のいまの角速度
    else if (type==='motor')    { vStamp(a,b,e._k, (e.k || 0.05) * motorOmega(e));
      A[e._k][e._k] -= Math.max(1e-3, e.R || 2); }
    else if (type==='voltmeter')gStamp(a,b, 1/_voltmeterR(e));       // 高抵抗＝ほぼ電流を流さない
    // ★起電力を持つブランチは内部抵抗を直列に入れる。ブランチ式は
    //   V_a − V_b − r·I_k = E なので、対角に −r を足すだけでよい（コイルと同じ形）。
    //   これで「E/(R+r)」という端子電圧の式がそのまま出て、短絡時も I = E/r で有限になる。
    else if (type==='dcsource') { vStamp(a,b,e._k, e.V);
      A[e._k][e._k] -= Math.max(SRC_R_MIN, e.r || 0); }
    else if (type==='acsource') { vStamp(a,b,e._k, e.V*Math.sin(acSourceTheta(e, t) + (e.phase||0)));
      A[e._k][e._k] -= Math.max(SRC_R_MIN, e.r || 0); }
    // 電流計＝0V源。内部抵抗は電源と同じく対角に −r を足すだけ（既定0＝理想電流計）
    else if (type==='ammeter')  { vStamp(a,b,e._k, 0);
      A[e._k][e._k] -= Math.max(0, e.r || 0); }
    else if (type==='rod')      { vStamp(a,b,e._k, e.emf);           // 導体棒＝EMF源
      A[e._k][e._k] -= Math.max(SRC_R_MIN, e.R || 0); }              // ★棒の抵抗（今まで未使用だった）
    // ★ダイオード：動作点まわりの接線（Gd）と等価電流源（Ieq）に置き換える。
    //   I = Is(exp(V/nVt) − 1) を V = e._Vd のまわりで1次展開したもの
    else if (type==='diode') {
      const Is = _diodeIs(e), vd = e._Vd;
      const ex = Math.exp(Math.min(vd / nVt, 80));
      const Id = Is * (ex - 1);
      const Gd = Is * ex / nVt + Gmin;                 // Gmin で逆方向でも行列が特異にならない
      gStamp(a, b, Gd);
      iStamp(a, b, Id - Gd * vd);
    }
    // ★豆電球：いまのフィラメント温度から決まる抵抗。温度は解いた後に更新する
    else if (type==='bulb' && !e.burnt && bulbStatic(e)) {
      // 熱の遅れなし：I(V) を V ＝ e._Vb のまわりで1次展開（傾きは数値微分。I(V) は奇関数で単調増加）
      const vb = e._Vb, h = 1e-4 + 1e-4 * Math.abs(vb);
      const Ib = bulbIstatic(e, vb);
      const Gd = Math.max(1e-9, (bulbIstatic(e, vb + h) - bulbIstatic(e, vb - h)) / (2 * h));
      gStamp(a, b, Gd);
      iStamp(a, b, Ib - Gd * vb);
    }
    else if (type==='bulb')     gStamp(a,b, 1/Math.max(1e-9, bulbR(e)));
    // ★コンデンサー：台形則 i_n = (2C/Δt)(v_n − v_{n−1}) − i_{n−1}
    //   （不連続の直後だけ後退オイラー i_n = (C/Δt)(v_n − v_{n−1})）
    else if (type==='capacitor'){
      const g = beStep ? e.C/dt : 2*e.C/dt;
      gStamp(a,b,g);
      iStamp(a,b, -g*e.Vprev - (beStep ? 0 : e.Iprev));
    }
    // ★コイル：台形則 v_n = (2L/Δt)(i_n − i_{n−1}) − v_{n−1}
    else if (type==='inductor') {
      const ia=gi(a),ib=gi(b),k=e._k;
      if(ia>=0){A[ia][k]+=1;A[k][ia]+=1;}
      if(ib>=0){A[ib][k]-=1;A[k][ib]-=1;}
      const gL = beStep ? e.L/dt : 2*e.L/dt;
      A[k][k] -= gL;
      z[k] += -gL*e.Iprev - (beStep ? 0 : e.Vprev);
    }
  }
  x = _solveLinear(A, z);
  if (!nlDiodes.length && !nlBulbs.length) break;
  // 収束判定：各ダイオード・熱の遅れなしの豆電球の端子電圧が動かなくなるまで繰り返す
  let converged = true;
  for (const e of nlBulbs) {
    const nd = elemNodes.get(e); if (!nd) continue;
    const raw = (nd.a===0?0:x[gi(nd.a)]) - (nd.b===0?0:x[gi(nd.b)]);
    if (Math.abs(raw - e._Vb) > 1e-7) converged = false;
    e._Vb = raw;
  }
  for (const e of nlDiodes) {
    const nd = elemNodes.get(e); if (!nd) continue;
    const raw = (nd.a===0?0:x[gi(nd.a)]) - (nd.b===0?0:x[gi(nd.b)]);
    const lim = _pnjlim(raw, e._Vd, nVt, vcrit);
    if (Math.abs(lim - e._Vd) > 1e-6) converged = false;
    e._Vd = lim;
  }
  if (converged) break;
  }
  if (!x) return;
  const V = nd => (nd===0 ? 0 : x[gi(nd)]);
  // 状態更新・読み取り値
  for (const e of all) {
    const nodes = elemNodes.get(e); if(!nodes) continue;
    const type = e.type || 'rod';
    e.Vread = V(nodes.a) - V(nodes.b);
    // ★台形則は「1つ前の電流」も状態として要る（後退オイラーは電圧だけで済む）
    if (type==='capacitor') {
      const g = beStep ? e.C/dt : 2*e.C/dt;
      e.I = g * (e.Vread - e.Vprev) - (beStep ? 0 : e.Iprev);
      e.Vprev = e.Vread; e.Iprev = e.I;
    }
    else if (type==='inductor') {
      e.Iprev = x[e._k]; e.I = e.Iprev; e.Vprev = e.Vread;
    }
    else if (type==='electromagnet') {
      e.Iprev = x[e._k]; e.I = e.Iprev;
      e.Vprev = e.Vread - Math.max(1e-3, e.R || 5) * e.I;   // 抵抗ぶんを引いたコイル部分の電圧
    }
    else if (type==='relay')     e.I = e.Vread / Math.max(1e-3, e.R || 50);
    else if (e._k>=0) e.I = x[e._k];   // 電源・電流計・棒の電流
    else if (type==='resistor')  e.I = e.Vread / Math.max(1e-9,e.R);
    // すべり抵抗：I は a→P の区間、I2 は P→b の区間、Ic は端子 c から接点へ流れ込む電流
    else if (type==='slidewire') {
      const tp = slideWirePos(e), R = Math.max(0, e.R || 0), Vc = V(nodes.c);
      e.I  = (V(nodes.a) - Vc) / Math.max(1e-9, R*tp);
      e.I2 = (Vc - V(nodes.b)) / Math.max(1e-9, R*(1-tp));
      e.Ic = e.I2 - e.I;
    }
    else if (type==='voltmeter') e.I = e.Vread / _voltmeterR(e);   // ★黄点のKCL伝播を合わせる
    else if (type==='diode')     e.I = _diodeI(e, e.Vread);
    else if (type==='bulb' && !e.burnt && bulbStatic(e)) {
      e.T = bulbTeq(e, e.Vread);                   // 温度はつり合いの値（明るさの表示もこれで決まる）
      e.I = e.Vread / Math.max(1e-9, bulbR(e));
      e._Vb = e.Vread;
      if (e.T > BULB_T_MELT) { e.burnt = true; e.T = T_AMB; e.I = 0; markCircuitDiscontinuity(); }
    }
    else if (type==='bulb') {
      const R = Math.max(1e-9, bulbR(e));
      e.I = e.Vread / R;
      // 熱のつり合い：C dT/dt = P（ジュール熱）− k(T⁴ − T₀⁴)（放射）− h(T − T₀)（伝導）
      const p = bulbParams(e);
      const T = e.T || T_AMB;
      const P = e.Vread * e.I;
      let dT = dt * (P - bulbLoss(p, T)) / p.Cth;
      dT = Math.max(-400, Math.min(400, dT));      // 点灯直後の突入電流で飛びすぎないように
      e.T = Math.max(T_AMB, T + dT);
      // ★融点を超えたら切れる。定格の約2倍の電圧で到達する（T ∝ V^0.4 なので）
      if (e.T > BULB_T_MELT && !e.burnt) { e.burnt = true; e.T = T_AMB; e.I = 0; markCircuitDiscontinuity(); }
    }
  }
}

// ── 空間の電磁力：F=qE ＋ ローレンツ(Boris) ＋ 電荷間クーロン ───────
//   integrate と分離し、simTick 内で integrate の前と後に dt/2 ずつ velocity を更新する（step.js の★）。
//   磁場は Boris 回転（|v|保存）。前進オイラーだと螺旋発散する（検証済み）。
function applyEMForces(dt) {
  // ★電磁石も場をつくる（emFieldAt が electromagnetBzAt を重ね合わせる）。以前は領域の場が
  //   1つも無いと丸ごと飛ばしていたので、電磁石だけのシーンでは荷電物体が曲がらなかった
  if (emFields.length || circuitElements.some(e => e.type === 'electromagnet')) {
    for (const b of objects) {
      if (!b.charge || !acceptsForce(b)) continue;   // ★ドラッグ中・凍結中には力を入れない
      // ★場は「置いた領域の内側だけ」。重心の位置でサンプリングする（重ね合わせ込み）
      const F = emFieldAt(b.x, b.y);
      const Ex = F.ex, Ey = F.ey, Bz = F.bz;
      if (!Ex && !Ey && !Bz) continue;
      const q = b.charge, m = b.mass;
      // ① 電場：半分の力積（Boris の前半）
      const halfAx = (q*Ex/m) * M2PX, halfAy = (q*Ey/m) * M2PX;   // [px/s²]
      b.vx += halfAx * (dt*0.5) * world.emForceScale;
      b.vy += halfAy * (dt*0.5) * world.emForceScale;
      // ② 磁場：Boris 回転（|v|を厳密保存）
      //   ★Bz は bzRightHanded で右手系のz成分へ直してから入れる。この式は「Bz＝右手系のz成分」
      //     を前提にしており、⊙を正とした表示用の値をそのまま入れると力が逆を向く（field.js 参照）
      if (Bz) {
        const bz = bzRightHanded(Bz);
        // ★力の矢印用に F = qv×B を控える。Boris は速度を「回す」解法なので力を陽に持たないが、
        //   矢印は教科書どおり「速度に垂直な向心力」であってほしいので、ここで別に立てる。
        //   回す前の速度で評価すること（回した後だと矢印が半歩ぶん傾いて、円の中心を指さない）。
        //   v は px/s なので PX2M で m/s にしてから N を作り、内部の力の単位へ戻して力積にする
        //   （電場ぶんの recordForce と同じ流儀）。
        if (b.showForces) {
          const fxN =  q * (b.vy*PX2M) * bz;                  // [N]
          const fyN = -q * (b.vx*PX2M) * bz;                  // [N]
          b.recordForce('magnetic', fxN*M2PX*dt, fyN*M2PX*dt, b.x, b.y);
        }
        const tt = q*bz*dt/(2*m), s = 2*tt/(1+tt*tt);
        const vpx = b.vx + b.vy*tt, vpy = b.vy - b.vx*tt;
        b.vx = b.vx + vpy*s;
        b.vy = b.vy - vpx*s;
      }
      // ③ 電場：残り半分
      b.vx += halfAx * (dt*0.5) * world.emForceScale;
      b.vy += halfAy * (dt*0.5) * world.emForceScale;
      if (q && (Ex||Ey)) b.recordForce('electric', q*Ex*M2PX*dt, q*Ey*M2PX*dt);
      if (b.sleeping) { b.sleeping=false; b.sleepTimer=0; }
    }
  }
  if (world.coulombOn) applyCoulomb(dt);
}
function applyCoulomb(dt) {
  const k = world.coulombK * world.emForceScale;
  const n = objects.length;
  for (let i=0;i<n;i++){
    const a=objects[i]; if(!a.charge || !isFieldSource(a)) continue;
    for (let j=i+1;j<n;j++){
      const b=objects[j]; if(!b.charge || !isFieldSource(b)) continue;
      if (a.isStatic && b.isStatic) continue;
      const dx=b.x-a.x, dy=b.y-a.y;
      const r2px = dx*dx+dy*dy + COULOMB_SOFTEN2;
      const r_m2 = r2px * PX2M * PX2M;                 // [m²]
      const invr = 1/Math.sqrt(r2px);
      const F = k * a.charge * b.charge / r_m2;        // [N]（同符号＝正＝斥力）
      const fx = F*dx*invr * M2PX, fy = F*dy*invr * M2PX;   // 内部力（bを押す向き a→b）
      // 力を受け取れるのは動かせる物体だけ。掴まれている物体は「場をつくる側」には
      // 参加するが、自分は力を受け取らない（動けないのに速度が溜まるのを防ぐ）
      if (acceptsForce(b)){ b.vx += (fx/b.mass)*dt; b.vy += (fy/b.mass)*dt; b.recordForce('electric', fx*dt, fy*dt); b.sleeping=false; b.sleepTimer=0; }
      if (acceptsForce(a)){ a.vx -= (fx/a.mass)*dt; a.vy -= (fy/a.mass)*dt; a.recordForce('electric', -fx*dt, -fy*dt); a.sleeping=false; a.sleepTimer=0; }
    }
  }
}

// ── 導体棒（力学↔回路の唯一の継ぎ目）────────────────────
//   conductor=true の物体が2本の導線（レール）に接している間だけ回路枝になる。
//   EMF = B·L·v⊥（棒に垂直＝レール方向の速度成分）。棒の抵抗は em RodResistance。
//   解いた電流 I から F = B·I·L をレール方向へ返す（レンツで運動を妨げる向きに自動でなる）。
const ROD_RESISTANCE = 0.5;   // [Ω] 棒の内部抵抗（0だと理想。既定は有限で安定）
// ★起電力を持つブランチ（電源・導体棒）の内部抵抗の下限 [Ω]。
//   0Ω の理想起電力が短絡されると方程式が解けなくなる（電流が無限大なので当然）。
//   現実の電池には内部抵抗があり、短絡電流は I = E/r の有限値になるので、
//   下限を当てて「非常に大きな有限電流」を出す。0 を返して黙るより、
//   ショートしていることが数字で分かるほうが良い。
const SRC_R_MIN = 1e-3;
// 電圧計の内部抵抗の下限 [Ω]。0 や負を入れられると回路を短絡してしまうので弾く。
//   既定の 1e7 は「実質∞」。数値欄で下げれば、内部抵抗が有限な電圧計の実験ができる。
const VOLTMETER_R_MIN = 1;
const _voltmeterR = e => Math.max(VOLTMETER_R_MIN, e.R || 1e7);
// ★導体棒は「導体フラグの付いた細長い物体」として作る。独立したオブジェクト型に
//   しないのは、この実験は棒が動くこと（レールを滑る・傾斜で落ちる・手で押す）が
//   本質で、その運動は棒が剛体だから得られているため。専用型にすると重力・衝突・
//   つかむ・ばね・ガイドをすべて作り直すことになり、しかも機能を失う。
//   なお conductor フラグを一般の物体プロパティから外したのは、任意形状を「導体」と
//   宣言できると静電遮蔽を期待させてしまうため（この app は誘導電荷を扱わない）。
const CONDROD_THICK = 10;     // [px] 導体棒の太さ（0.1 m）
const CONDROD_MASS  = 0.5;    // [kg] 導体棒の既定質量（実物の1m金属棒くらい）
function condRodDesc(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (L < 12) return null;
  return { type:'box', x:(a.x+b.x)/2, y:(a.y+b.y)/2, w:L, h:CONDROD_THICK, angle:Math.atan2(dy, dx) };
}
// ★その点が既存の回路の上にあるか（端点に重なる／導線の途中に載る）。
//   導線以外の素子（抵抗・電源・スイッチ等）は、両端がこれを満たす位置にしか置けない。
//   宙に浮いた素子は回路として意味を持たず、置けてしまうと「繋いだつもりなのに
//   電流が流れない」という分かりにくい失敗を招くため。
//   その点を回路の上へ吸着させた座標を返す（乗っていなければ null）。
//   端点を優先し、無ければ導線の途中の最近点。ぴったり合わせることで、
//   ノード縮約や導線分割に頼らず確実に同じノードになる。
//   except を渡すとその素子自身は無視する（移動中の素子が自分の端点に吸着しないように）。
// except は素子1つ、または「まとめて動かしている素子の集合」（Set）。
// 集合で渡せるのは、複数をまとめて動かすときに、動いている者どうしで吸着させないため
// （選択の中で吸い合うと相対位置が崩れて、まとまりとして運んだ意味がなくなる）。
function circuitSnapToNetwork(x, y, except) {
  const skip = except instanceof Set ? (e => except.has(e)) : (e => e === except);
  const thr = NODE_MERGE_PX;
  let best = null, bd = thr;
  for (const e of circuitElements) {                       // ① 既存の端点（素子の端子も含む）
    if (skip(e)) continue;
    for (const q of circuitTerminals(e))                   // ★すべり抵抗の接点の端子 c も
      if (len(x - q.x, y - q.y) <= bd) { bd = len(x - q.x, y - q.y); best = { x:q.x, y:q.y }; }
  }
  if (best) return best;
  for (const e of circuitElements) {                        // ② 導線の途中（分割して繋がる）
    if (skip(e) || e.type !== 'wire') continue;
    const cp = _segClosestPoint(x, y, e.ax, e.ay, e.bx, e.by);
    if (cp.t > 0.001 && cp.t < 0.999 && len(x - cp.x, y - cp.y) <= thr) return { x:cp.x, y:cp.y };
  }
  return null;
}
// ★素子と並列に残ってしまう導線を消す。
//   抵抗を導線の上に置くと、spliceWiresAt が両端で導線を切るので「素子と同じ2点を
//   結ぶ導線」が1本残る。これは素子を短絡させるので、電気的にも素子が効かなくなる
//   （見た目の問題ではない）。素子と同じ2点を結ぶ導線だけを消せば、両側の導線は残る。
//   parts はこの配置で作った要素（本体＋リード線）。A・B はクリックした2点で、
//   リード線に分割したときは本体の端点と一致しないので別に受け取る。
function removeShortingWires(parts, A, B) {
  const thr = NODE_MERGE_PX;
  const at = (x1,y1,x2,y2) => len(x1-x2, y1-y2) <= thr;
  const keep = new Set(Array.isArray(parts) ? parts : [parts]);
  for (let i = circuitElements.length - 1; i >= 0; i--) {
    const w = circuitElements[i];
    if (keep.has(w) || w.type !== 'wire') continue;
    const sameAB = at(w.ax,w.ay,A.x,A.y) && at(w.bx,w.by,B.x,B.y);
    const sameBA = at(w.ax,w.ay,B.x,B.y) && at(w.bx,w.by,A.x,A.y);
    if (sameAB || sameBA) {
      if (selectedCircuit === w) selectedCircuit = null;
      circuitElements.splice(i, 1);
    }
  }
}
// ★一直線に並んだ導線どうしを1本にまとめる。
//   既存の導線の途中に素子を挿すと、spliceWiresAt が導線を割った点へ素子のリード線が
//   来るので「導線・導線・素子・導線・導線」になる。中間の点は端子の丸が描かれるだけで
//   電気的には何の意味もない（0Ωで縮約される同一ノード）ので、繋いで
//   「導線・素子・導線」に戻す。
//   まとめるのは次を全部満たすときだけ：
//     ・その点に来ている端点がちょうど2つ（3つ以上＝分岐点なので繋ぐと接続が壊れる）
//     ・どちらも導線（素子を巻き込まない）
//     ・一直線に並んでいる（意図して折り曲げた角は残す）
const WIRE_MERGE_SIN = 0.02;   // 一直線とみなす角度のずれ（sin ≒ 1.1°）
function mergeCollinearWiresAt(x, y) {
  const thr = NODE_MERGE_PX;
  const hits = [];
  for (const e of circuitElements) {
    for (const q of circuitTerminals(e))
      if (len(x - q.x, y - q.y) <= thr) hits.push({ e, end:q.end });
  }
  if (hits.length !== 2) return;                        // 分岐点／行き止まり
  const [h1, h2] = hits;
  if (h1.e === h2.e) return;                            // 同じ導線の両端（＝輪）
  if (h1.e.type !== 'wire' || h2.e.type !== 'wire') return;
  // それぞれの反対側の端点。「far1 → 交点 → far2」が一直線かを見る
  const far1 = h1.end === 'a' ? { x:h1.e.bx, y:h1.e.by } : { x:h1.e.ax, y:h1.e.ay };
  const far2 = h2.end === 'a' ? { x:h2.e.bx, y:h2.e.by } : { x:h2.e.ax, y:h2.e.ay };
  const d1x = x - far1.x, d1y = y - far1.y, L1 = len(d1x, d1y);
  const d2x = far2.x - x, d2y = far2.y - y, L2 = len(d2x, d2y);
  if (L1 < 1e-6 || L2 < 1e-6) return;
  const cross = (d1x*d2y - d1y*d2x) / (L1*L2);
  const dot   = (d1x*d2x + d1y*d2y) / (L1*L2);
  if (dot <= 0 || Math.abs(cross) > WIRE_MERGE_SIN) return;   // 折れている／折り返している
  // h1 の交点側の端だけを far2 まで伸ばす（h1 の a→b の向きをそのまま保つ）
  if (h1.end === 'a') { h1.e.ax = far2.x; h1.e.ay = far2.y; }
  else                { h1.e.bx = far2.x; h1.e.by = far2.y; }
  if (selectedCircuit === h2.e) selectedCircuit = h1.e;
  circuitElements.splice(circuitElements.indexOf(h2.e), 1);   // もう片方を捨てる
}
function _segClosestPoint(px,py, ax,ay,bx,by){
  const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy||1e-9;
  let t=((px-ax)*dx+(py-ay)*dy)/L2; t=t<0?0:t>1?1:t;
  return { x:ax+dx*t, y:ay+dy*t, t };
}
// 2線分の最近点対（Ericson の標準アルゴリズム）
// ★名前を _wireSegSegClosest にしてある。素の _segSegClosest は broadphase.js が
//   物理用（戻り値に s / dist を含む）として定義しており、circuit.js はそれより後ろで
//   読み込まれるので、同名にすると上書きしてしまう。上書きされると戻り値に dist が無く、
//   ロープ／棒の対多角形の当たり判定が `r.dist < …` を常に false と評価して全て消える
//   （＝ロープが箱をすり抜け、そのまま中へ沈む）。用途が違う関数なので名前で分ける。
function _wireSegSegClosest(p1, p2, p3, p4) {
  const d1x=p2.x-p1.x, d1y=p2.y-p1.y, d2x=p4.x-p3.x, d2y=p4.y-p3.y;
  const rx=p1.x-p3.x, ry=p1.y-p3.y;
  const a=d1x*d1x+d1y*d1y, e=d2x*d2x+d2y*d2y;
  const f=d2x*rx+d2y*ry, c=d1x*rx+d1y*ry, b=d1x*d2x+d1y*d2y;
  const cl = v => v<0?0:v>1?1:v;
  const den=a*e-b*b;
  let s = den>1e-9 ? cl((b*f-c*e)/den) : 0;
  let t = (b*s+f)/(e||1e-9);
  if (t<0)      { t=0; s=cl(-c/(a||1e-9)); }
  else if (t>1) { t=1; s=cl((b-c)/(a||1e-9)); }
  return { ax:p1.x+d1x*s, ay:p1.y+d1y*s, bx:p3.x+d2x*t, by:p3.y+d2y*t };
}
// 導体棒の軸（長い方の中心線）。導体棒ツールが作る細長い box を想定する
function _rodAxisSeg(b) {
  if (b.type !== 'box' || !(b.w > 0)) return null;
  const c=Math.cos(b.angle), s=Math.sin(b.angle), hw=b.w/2;
  return { p:{x:b.x-c*hw, y:b.y-s*hw}, q:{x:b.x+c*hw, y:b.y+s*hw}, half:(b.h||10)/2 };
}
// 物体 b が触れている導線（wire）を、接触点つきで返す。
//   ★接点は「棒の軸と導線の最近点対」で求める。物体の中心から導線への最近点で
//     判定すると、_segClosestPoint が端点でクランプするため、棒の上に無い点
//     （抵抗を置いて分割された導線の端点＝抵抗の端子）へ接点が飛んでしまう。
// ★レールとみなすのは「棒と交差している導線」だけ。棒と平行に近い向きで走っている導線
//   （レールの向こう端をつないでいる水平線など）を接点にすると、棒の端が実際の交点では
//   なくそちらへ飛ぶ。平行な導線に対しては _segSegClosest が棒の端点で打ち切るので、
//   接点が「棒の真上の別の線」になってしまうため。
const ROD_RAIL_MIN_SIN = 0.2;   // 棒と導線のなす角がこれ未満（≒11.5°）なら接点にしない
function _wiresTouching(b) {
  const out = [];
  const seg = _rodAxisSeg(b);
  const reach = (b.type==='circle' ? b.radius : Math.max(b.w||0,b.h||0,60)/2) + NODE_MERGE_PX;
  const rl  = seg ? len(seg.q.x-seg.p.x, seg.q.y-seg.p.y) : 0;
  const rux = rl > 1e-6 ? (seg.q.x-seg.p.x)/rl : 0;
  const ruy = rl > 1e-6 ? (seg.q.y-seg.p.y)/rl : 0;
  for (const w of circuitElements) {
    if (w.type !== 'wire') continue;
    if (seg && rl > 1e-6) {
      const wl = len(w.bx-w.ax, w.by-w.ay);
      if (wl < 1e-6) continue;
      if (Math.abs(rux*(w.by-w.ay)/wl - ruy*(w.bx-w.ax)/wl) < ROD_RAIL_MIN_SIN) continue;   // 平行＝レールではない
      const cc = _wireSegSegClosest(seg.p, seg.q, {x:w.ax,y:w.ay}, {x:w.bx,y:w.by});
      const gap = len(cc.ax-cc.bx, cc.ay-cc.by);
      if (gap <= seg.half + NODE_MERGE_PX)
        out.push({ wire:w, x:cc.bx, y:cc.by,          // 接点は導線側の点（レール上）
                   gap, t:(cc.ax-seg.p.x)*rux + (cc.ay-seg.p.y)*ruy });   // t＝棒の軸に沿った位置[px]
    } else {
      const cp = _segClosestPoint(b.x,b.y, w.ax,w.ay, w.bx,w.by);
      if (b.containsPoint(cp.x,cp.y) || len(cp.x-b.x,cp.y-b.y) <= reach)
        out.push({ wire:w, x:cp.x, y:cp.y, gap:0, t:null });   // 軸を持たない導体は従来どおり
    }
  }
  return out;
}
// ── 回路そのものの運動起電力（手で動かす回路）──────────────────────────
//   ★導体棒とまったく同じ式 emf = B·L·v⊥ を、回路の枝そのものに載せる。棒は物体なので
//     速度を持つが、回路素子は幾何しか持たないので、つかむツールが作る群速度を使う
//     （circuitHold.vx/vy。updateHeldVelocities が実際に動いた量からなましてつくる）。
//     符号の規約も棒と同じ：emf は V_a − V_b の意味で、bzRightHanded は通さない
//     （通すと極性が逆になる。理由は js/em/field.js の★）。
//   ★閉じたループが「一様な磁場の中を」平行移動しても、正味の起電力は 0 になる。
//     Φ が変わらない＝各辺の v×B が一周で打ち消し合うため。電流が流れるのは
//     磁場の領域の境界をまたいでいる間だけで、これは仕様ではなくファラデー・レンツ
//     そのもの。この app の磁場が世界全体の一様場を持たず有限の矩形領域だから成立する。
//   ★載せるのは導線（wire）だけにする。集中定数回路の約束では素子は「点」であって、
//     ループの幾何（＝囲む面積）を持つのは導線だけだから。素子にも載せ始めると、
//     コンデンサーの極板やダイオードの接合のように「連続した導体でない」ところまで
//     ∫(v×B)·dl を積むことになり、置き場所の理屈が立たない。
//     ＝ 磁場の境界は導線の上を横切らせること（素子をまたがせるとその分が抜ける）。
const EMF_MOTION_MIN = 1e-9;   // [V] これ未満は 0 とみなす（0Ωの縮約を無用に壊さないため）
function isZeroOhmElem(e) {
  return e.type === 'wire'
      || ((e.type === 'switch' || e.type === 'pushswitch' || e.type === 'relayswitch') && e.closed);
}
function hasMotionEmf(e) { return Math.abs(e._emf || 0) >= EMF_MOTION_MIN; }
let _circuitEmfSig = '';
function updateCircuitMotionEmf() {
  const h = typeof circuitHold !== 'undefined' ? circuitHold : null;
  const vx = h ? h.vx : 0, vy = h ? h.vy : 0;
  const moving = !!h && (vx*vx + vy*vy) > 0;
  let sig = '';
  for (const e of circuitElements) {
    let emf = 0;
    if (moving && e.type === 'wire' && h.ids.has(e.id)) {
      const dx = e.bx - e.ax, dy = e.by - e.ay;
      const Lpx = Math.hypot(dx, dy);
      if (Lpx > 1e-6) {
        const perpX = -dy / Lpx, perpY = dx / Lpx;            // a→b を90°回した向き
        const vperp = (vx*perpX + vy*perpY) * PX2M;           // [m/s]
        // ★磁場は枝に沿って多点サンプリングした平均（emBzAlong）。導体棒と同じ理由で、
        //   領域に入りかけの枝でも「入っている長さのぶんだけ」起電力が滑らかに立つ。
        emf = emBzAlong(e.ax, e.ay, e.bx, e.by) * (Lpx * PX2M) * vperp;   // [V]
      }
    }
    e._emf = Math.abs(emf) >= EMF_MOTION_MIN ? emf : 0;
    if (e._emf) sig += e.id + ',';
  }
  // ★0Ω の枝に起電力が立つ／消える瞬間はノードの数が変わる＝回路の不連続。
  //   後退オイラーで1歩踏まないと、コンデンサー・コイルの前ステップ値と辻褄が合わない。
  if (sig !== _circuitEmfSig) { _circuitEmfSig = sig; markCircuitDiscontinuity(); }
}
// つかむのをやめたとき（＝速度0）に呼ぶ。縮約を元へ戻すので不連続として扱う
function clearCircuitMotionEmf() {
  for (const e of circuitElements) e._emf = 0;
  if (_circuitEmfSig) { _circuitEmfSig = ''; markCircuitDiscontinuity(); }
}

// 全導体棒を作り、EMF を書き込んで返す（solveCircuit へ渡す）
function buildConductorRods() {
  const rods = [];
  for (const b of objects) {
    if (!b.conductor || b.isStatic) continue;
    let hits = _wiresTouching(b);
    if (hits.length < 2) continue;
    // ★棒の軸に沿って同じ位置に来ている接点は1つにまとめ、隙間の小さいほうを残す。
    //   抵抗を挿したレールは複数の導線に分かれているので、棒がその継ぎ目に乗ると
    //   同じ点で2本に当たり、「別々の導線に触れている組」として拾われてしまう。
    if (hits.length > 1 && hits[0].t !== null) {
      const sorted = hits.slice().sort((p,q) => p.t - q.t);
      hits = [];
      for (const h of sorted) {
        const last = hits[hits.length-1];
        if (last && Math.abs(h.t - last.t) <= NODE_MERGE_PX) {
          if (h.gap < last.gap) hits[hits.length-1] = h;
        } else hits.push(h);
      }
      if (hits.length < 2) continue;
    }
    // 最も離れた2接点を棒の両端にする（レール間を橋渡し）。
    // ★ただし「別々の導線」に触れている組だけを対象にする。同じ導線上の2点を選ぶと、
    //   レールを橋渡ししているのではなく1本の導線を短絡しているだけになる。
    // ★「離れている」は棒の軸に沿った距離 t で測る。平面上の距離で測ると、棒の少し外に
    //   ある導線との組のほうが遠くなり、そちらが接点に選ばれて端が飛ぶ。
    let bi=-1,bj=-1,bd=-1;
    for (let i=0;i<hits.length;i++) for(let j=i+1;j<hits.length;j++){
      if (hits[i].wire === hits[j].wire) continue;
      const d = hits[i].t !== null ? Math.abs(hits[i].t - hits[j].t)
                                   : len(hits[i].x-hits[j].x, hits[i].y-hits[j].y);
      if (d>bd){bd=d;bi=i;bj=j;}
    }
    if (bi < 0) continue;                                // 2本のレールに架かっていない
    const p0=hits[bi], p1=hits[bj];
    let axX=p1.x-p0.x, axY=p1.y-p0.y;
    const Lpx=Math.hypot(axX,axY)||1e-6;
    axX/=Lpx; axY/=Lpx;                                  // 棒の軸方向（単位）
    const L_m = Lpx * PX2M;
    // レール方向＝棒に垂直。その向きの速度成分が EMF を生む
    const perpX=-axY, perpY=axX;
    const vperp = (b.vx*perpX + b.vy*perpY) * PX2M;      // [m/s]
    // ★磁場は棒に沿って多点サンプリングした平均を使う。領域に入りかけの棒でも
    //   「入っている長さのぶんだけ」起電力が立つ（中点1点だと縁で不連続に飛ぶ）
    const Bavg = emBzAlong(p0.x, p0.y, p1.x, p1.y);
    // ★ここは bzRightHanded を通さないこと（通すと極性が逆になる）。perp の90°回転が
    //   y下向き座標系で手つきを反転させるため、表示用の Bz のままで符号が合う。
    //   emf は V_a − V_b の意味（vStamp の規約）＝ −∫(v×B)·dl。詳細は js/em/field.js
    const emf = Bavg * L_m * vperp;                      // [V]
    rods.push({ ax:p0.x, ay:p0.y, bx:p1.x, by:p1.y, type:'rod',
      wireA:p0.wire, wireB:p1.wire,      // ★接している導線（ノード結合に使う）
      emf, Bavg, R:ROD_RESISTANCE, body:b, perpX, perpY, L_m, _k:-1, I:0, Vread:0 });
  }
  return rods;
}
// 棒に働く磁気力 F=BIL をレール方向へ返す
function applyRodForces(rods, dt) {
  for (const r of rods) {
    const b = r.body;
    if (!b || b.isStatic) continue;
    // F = I L×B。perp(=レール方向)成分は +Bz·I·L（Nodeで端点間の連成を解いてレンツ＝減速になる符号を確認済み）。
    const F = (r.Bavg || 0) * r.I * r.L_m;               // [N]（棒に沿った磁場の平均）
    const fx = F * r.perpX * M2PX, fy = F * r.perpY * M2PX;   // 内部力（レール方向）
    b.applyForce(fx, fy, b.x, b.y, dt);                  // applyForce が dt を掛けて力積化する
    b.recordForce('magnetic', fx*dt, fy*dt, b.x, b.y);
    b.sleeping=false; b.sleepTimer=0;
  }
}

// simTick から呼ぶ統合エントリ（integrate の前と後に dt/2 ずつ velocity 更新。その後に回路→棒力）
function emStepPre(dt)  { applyEMForces(dt); }
function emStepPost(dt, now) {
  if (!world.circuitOn) return;
  updatePushSwitches();      // ★力学 → 電気（物体がボタンを踏む）
  updateRelayContacts();     // ★電気 → 電気（前ステップのコイル電流で接点が動く）
  updateCircuitMotionEmf();  // ★力学 → 電気（手で動かしている回路そのものの運動起電力）
  const rods = buildConductorRods();
  solveCircuit(dt, rods, now);
  applyMotorTorques(dt);     // ★電気 → 力学（電流がトルクになる）
  applyRodForces(rods, dt);
  world._rods = rods;   // 描画用
}
// ★描画用に導体棒の接点だけを取り直す（力も回路も解かない）。
//   world._rods は emStepPost が作るので、シミュレーションを止めているあいだ
//   （やり直し・手でドラッグ・一時停止）は古い位置のまま残ってしまう。棒は物体なので
//   止まっていても動かせる＝黄色い線だけが置き去りになる。
//   電流は直前に解いた値を引き継ぐ（止めた瞬間の読みをそのまま表示するため）。
// ★表示用：導体フラグの付いた物体すべての起電力を求める。
//   回路の枝になるのは「2本の別々のレールに架かっている」ときだけだが、磁場を横切る
//   導体には回路の有無に関係なく電荷の偏りが生じる。「起電力は出ているが、回路が
//   閉じていないので電流は流れない」という区別は高校物理の要なので、架かっていない棒も
//   対象にして E だけを見せる（_free 印を付け、描画側で控えめに描く）。
//   架かっている棒は world._rods の値をそのまま使う（接点間の長さと、解いた電流）。
function conductorRodsForDisplay() {
  const out = [];
  const wired = new Map();
  for (const r of (world._rods || [])) if (r.body) wired.set(r.body, r);
  for (const b of objects) {
    if (!b.conductor) continue;
    const r = wired.get(b);
    if (r) { out.push(r); continue; }
    const seg = _rodAxisSeg(b);
    if (!seg) continue;
    const lp = len(seg.q.x - seg.p.x, seg.q.y - seg.p.y);
    if (!(lp > 1e-6)) continue;
    const ax = (seg.q.x - seg.p.x) / lp, ay = (seg.q.y - seg.p.y) / lp;
    const perpX = -ay, perpY = ax;                       // レール方向＝棒に垂直
    const L_m = lp * PX2M;
    const vperp = (b.vx * perpX + b.vy * perpY) * PX2M;  // [m/s]
    const Bavg = emBzAlong(seg.p.x, seg.p.y, seg.q.x, seg.q.y);
    out.push({ ax:seg.p.x, ay:seg.p.y, bx:seg.q.x, by:seg.q.y,
               emf: Bavg * L_m * vperp, Bavg, L_m, I: 0,
               perpX, perpY, body: b, _free: true });
  }
  return out;
}
function emRefreshRodsForDraw() {
  if (!world.circuitOn) { world._rods = null; return; }
  const prev = world._rods || [];
  const rods = buildConductorRods();
  for (const r of rods) {
    const old = prev.find(o => o.body === r.body);
    if (old) r.I = old.I;
  }
  world._rods = rods;
}

// ── 描画 ─────────────────────────────────────────────
