// ════════════════════════════════════════
//  熱（熱容量・熱伝導・熱量保存）
// ════════════════════════════════════════
//  温度は内部では絶対温度 K で持ち、UI 境界で ℃ に直す（力を内部 kg·px/s² で持ち、
//  UI で N に直すのと同じ流儀。units.js の冒頭を参照）。あとで気体の状態方程式
//  PV = nRT を入れるときに絶対温度が要るので、内部を K にしておく。
//
//  ── 熱量保存をどう成り立たせるか ────────────────────────────────
//  すべてのやりとりを「2者間の取引」として **一度だけ** 計算し、片方から引いた
//  熱量をそのまま他方へ足す（熱の網 solveHeatNet が取引ごとに ±で配る）。
//  「A が失う熱」と「B が得る熱」を別々の式で計算した瞬間に保存は壊れるので、
//  この形を崩さないこと。SPH の粘性パスが運動量に対して同じことをしている。
//
//  ── なぜ頭打ち（縮め率）が要るか ──────────────────────────────────
//  陽解法の熱伝導は U·dt が熱容量を超えると平衡温度を通り越し、振動して発散する。
//  比熱や熱伝導率は UI から自由に変えられるので、これは「起こりうる」ではなく
//  「必ず起こる」。硬い物体の取引を縮めれば（熱の網の★）、dt や材質によらず無条件に
//  安定で単調（＝温度が行き過ぎない・負にならない）になる。
//  実測：U を 10⁵ にすると、頭打ち無しでは粒子600個が全部 NaN、
//        頭打ち有りでは総熱量誤差 −5.9e-15 で温度も 275.8〜370.8K に収まった。
//        網にしてから（2026-09-28）：水600粒を 90℃ と 0℃ の壁ではさみ、倍率を
//        5×10⁴／5×10⁶／5×10⁸ にしても NaN 0、熱量の相対誤差 1.4e-15〜3.7e-15。
//
//  ══ 熱で扱う範囲（ここが線。広げる前に必ず読むこと）════════════════
//
//      熱は伝わる・仕事をする。ただし物質は変わらない。
//
//  扱う：熱伝導／熱容量／摩擦・非弾性衝突・抗力の発熱／恒温物体／
//        気体室の PV=nRT と第一法則（断熱・等温・熱効率）／
//        温度による気体粒子の熱運動（jitter ∝ √T）と水の熱膨張（ブシネスク近似）。
//  扱わない：融点・沸点・相転移（固体⇄液体⇄気体）・潜熱・過冷却・化学変化。
//        物体は温度が変わるだけで、別の物質にはならない。氷は溶けないし水は沸かない。
//
//  ── なぜ相転移を入れないか（「比熱が違う」の奥にあるもの）──────────
//  融解を入れると、粒子ごとに材質（質量・比熱・静止密度・剛性・凝集）を持たせる
//  ことになる。ところが SPH の密度緩和は
//      pi.x -= D*ux*0.5;  pj.x += D*ux*0.5;        （particles.js の④）
//  と補正を 50/50 で分けており、この 0.5 は「全粒子が同質量」の前提そのもの。
//  さらに密度 rho は Σ(1-r/h)² ＝ **個数**密度で、restDensity: 4.0 は「近傍が4個」
//  という意味なので、質量の違う粒子を混ぜた瞬間にこの量の意味が壊れる。浮力も
//  PARTICLE_TYPES.fluid.density を単一の液体として読んでいる。
//  つまり相転移は「機能追加」ではなく SPH の核の作り直しになる。
//  逆向き（凝固）はさらに重い：粒子群 → 輪郭 → 凸分解 → Body の生成が要り、
//  ジョイント・選択・undo・シーン保存の全部に波及する。
//  過冷却は準安定状態と核生成のモデルが要るうえ、それらしく見せるための細工は
//  「熱量が機械精度で保存する」という、この実装がいちばん大事にしている性質と
//  相性が悪い。よって入れない。

const T0_K = 273.15;                       // 0℃ [K]
const K2C = K => K - T0_K;                 // 内部（K）→ UI（℃）
const C2K = C => C + T0_K;                 // UI（℃）→ 内部（K）
const ROOM_K = C2K(20);                    // 既定の温度＝20℃

// ══ 熱の網：tick のやりとりを全部集めて、同時に解く ══════════════════════
//   伝導（物体・粒子・気体室の壁）も放射も、ここへ「A と B の間のコンダクタンス U [W/K]」
//   として登録するだけにして、温度は solveHeatNet が tick に一度だけ書き換える。
//   ★2026-09-28：以前は2者ずつ順に heatExchange を呼び、**更新したての温度**で次の取引を
//     計算していた（ガウス・ザイデル）。閉じた系が一様な温度へ落ち着くだけなら行き着く先は
//     同じだが、熱源から受けて別の相手へ捨てる「流れ続ける」定常状態では、先に受けた熱で
//     温まった温度で捨てる量を計算するので捨てすぎ、**倍率に比例して低めに落ち着いていた**。
//     実測（理論値からのずれ。thermalRate 50000／10000／1500）：
//       放射：500℃ の黒体から 2.5m の器（理論 137.73℃）   −6.40K／−1.27K／−0.19K
//       伝導：100℃ と 0℃ の恒温板ではさんだ箱（理論 50℃） −1.45K／−0.28K／−0.04K
//     放射の周囲との交換だけを頭の温度に替えたら 137.728℃ に揃った＝原因はこの1点。
//     放射だけ直しても、伝導→放射のように仕組みをまたいで同じずれが出るので、網ごと直した。
//   ★同時に解くと、2者の頭打ち（平衡温度まで）だけでは足りない。相手が何人も居ると、
//     それぞれから「平衡まで」受け取って行き過ぎる。そこで2段で縮める：
//       ① 取引ごと：p_e = min(1, 1/(dt·U·(1/C_a + 1/C_b)))
//          ＝ 2者だけなら1 tick でちょうど平衡温度に揃う（以前の heatExchange の頭打ちと同じ）
//       ② 物体ごと：σ_i = min(1, 1/(dt·Σ p_e·U / C_i))
//          ＝ 1 tick の受け取りの合計が「相手たちの頭の温度の重み付き平均」を越えない
//     取引には p_e·min(σ_a, σ_b) を掛ける。どの物体の新しい温度も、自分と相手たちの頭の温度の
//     凸結合になるので、温度はその範囲から出ない（行き過ぎない・負にならない・発散しない）。
//     縮め率は正の数を掛けるだけなので、**行き着く先（取引の和が0になる温度）は変わらない**。
//     ☆①を「半分まで」（物体ごと 1/(2k)）で済ませた版は、熱容量 1 J/K の受け板が毎 tick
//       摩擦熱を受けたまま床に半分しか渡せず、0.08℃ 温かく残った（「位置 → 運動 → ばね」）。
//       ①を入れて以前どおり床と揃うようになった。
//   ★恒温物体と周囲は熱容量が無限（1/C = 0）として扱う。温度が動かないので相手を縮めない。
//   ★取引は両端へ ± 同じ量を配るので、熱量保存はこれまでどおり厳密。
//   ★加熱冷却領域（applyHeatFields）は取引ではなく「系の外から入る量」なので網に入れず、
//     網を解いたあとで足す。先に足すと、足した直後の温度で取引を見積もることになり、
//     同じ理由で定常状態がずれる。
const HN_BODY = 0, HN_PART = 1, HN_GAS = 2, HN_AMB = 3;
const _hn = {
  stamp: 1,                 // ★物体に「今の tick の網で何番か」を控える印。tick ごとに進める
  kind: [], ref: [], n: 0,
  ea: new Int32Array(1024), eb: new Int32Array(1024), eU: new Float64Array(1024), m: 0,
  amb: { _hnS: 0, _hnI: 0 },          // 周囲（world.ambientTemp）の節点
};
function heatNetNode(kind, ref) {
  if (ref._hnS === _hn.stamp) return ref._hnI;
  ref._hnS = _hn.stamp;
  ref._hnI = _hn.n;
  _hn.kind[_hn.n] = kind; _hn.ref[_hn.n] = ref;
  return _hn.n++;
}
// A と B の間に U [W/K]（倍率 thermalRate を掛けたあとの値）の取引を1本足す。
//   同じ組を何度足してもよい（U が足し算になるだけ）。
function heatNetLink(kindA, refA, kindB, refB, U) {
  if (!(U > 0)) return;
  if (_hn.m >= _hn.ea.length) {
    const grow = (A, T) => { const B = new T(A.length * 2); B.set(A); return B; };
    _hn.ea = grow(_hn.ea, Int32Array); _hn.eb = grow(_hn.eb, Int32Array); _hn.eU = grow(_hn.eU, Float64Array);
  }
  const i = _hn.m++;
  _hn.ea[i] = heatNetNode(kindA, refA);
  _hn.eb[i] = heatNetNode(kindB, refB);
  _hn.eU[i] = U;
}
function _hnTemp(k, r) {
  return k === HN_BODY ? r.temp : k === HN_PART ? r.T : k === HN_GAS ? r.T : world.ambientTemp;
}
function _hnInvC(k, r) {
  let C = 0;
  if (k === HN_BODY) { if (r.tempFixed) return 0; C = r.heatCap * r.mass; }
  else if (k === HN_PART) C = r.prm._heatC;
  else if (k === HN_GAS) C = r.heatCapJK();
  else return 0;                                    // 周囲
  return C > 0 ? 1 / C : 0;
}
const _hnT = [], _hnIC = [], _hnS = [], _hnQ = [];
let _hnPU = new Float64Array(1024);
function solveHeatNet(dt) {
  const n = _hn.n, m = _hn.m;
  if (m > 0 && dt > 0) {
    const T = _hnT, iC = _hnIC, s = _hnS, Q = _hnQ;
    for (let i = 0; i < n; i++) {
      T[i] = _hnTemp(_hn.kind[i], _hn.ref[i]);
      iC[i] = _hnInvC(_hn.kind[i], _hn.ref[i]);
      s[i] = 0; Q[i] = 0;
    }
    // ① 取引ごとの頭打ち p_e（2者だけで平衡温度まで）を U に掛けておき、物体ごとに合計する
    const pU = _hnPU.length >= m ? _hnPU : (_hnPU = new Float64Array(_hn.eU.length));
    for (let e = 0; e < m; e++) {
      const a = _hn.ea[e], b = _hn.eb[e], U = _hn.eU[e];
      const k = dt * U * (iC[a] + iC[b]);
      const u = k > 1 ? U / k : U;
      pU[e] = u; s[a] += u; s[b] += u;
    }
    // ② 物体ごとの縮め率 σ_i（s に上書き）
    for (let i = 0; i < n; i++) {
      const k = dt * s[i] * iC[i];
      s[i] = k > 1 ? 1 / k : 1;
    }
    // ③ 頭の温度で取引を見積もる（a → b を正）
    for (let e = 0; e < m; e++) {
      const a = _hn.ea[e], b = _hn.eb[e];
      if (a === b) continue;
      const dQ = (s[a] < s[b] ? s[a] : s[b]) * pU[e] * (T[a] - T[b]) * dt;
      Q[a] -= dQ; Q[b] += dQ;
    }
    // ④ 配る
    for (let i = 0; i < n; i++) {
      const q = Q[i];
      if (!q) continue;
      const k = _hn.kind[i], r = _hn.ref[i];
      if (k === HN_BODY) applyBodyHeat(r, q);       // ★恒温物体なら別勘定（applyBodyHeat）
      else if (k === HN_PART) { if (iC[i] > 0) r.T += q * iC[i]; }
      else if (k === HN_GAS) r.addHeat(q);          // ★第一法則の帳簿（Q・Qin・Qout）に乗る
      else reservoirHeatTotal -= q;                 // 周囲が受け取った＝系から出た
    }
  }
  _hn.n = 0; _hn.m = 0;
  _hn.ref.length = 0;                               // ★消した物体を網が握り続けない
  _hn.stamp++;
}
// ── 接触の熱コンダクタンス U [W/K] ────────────────────────────────
//   熱抵抗の直列： 1/U = L_a/(k_a·A) + L_b/(k_b·A)
//   k [W/(m·K)] は熱伝導率、L [m] は熱が通る代表的な厚み、A [m²] は接触面積。
//   「接触したとき小さい方の値が効く」という直感はこの式の極限で、片方が断熱材
//   （k が桁違いに小さい）ならその項が抵抗を支配して自動的にそちらで決まる。
//   min() で代用すると、両者が同程度のときに2倍過大評価になる。
//   最後に world.thermalRate（熱の伝わる速さの倍率）を掛ける。実物の熱伝導は教材で
//   眺めるには遅すぎるため（熱拡散の時間は τ ≈ L²ρc/k。60cm の鉄塊なら約7時間で、
//   実測でも 20 秒回して温度差 200℃ がまったく縮まなかった）。倍率は全部の材質に
//   同じだけ掛かるので、材質どうしの比（金属はスポンジの1000倍伝えやすい）は変わらず、
//   熱量保存にも影響しない（動く熱量の速さだけが変わる）。
function thermalConductance(kA, LA, kB, LB, area) {
  if (!(kA > 0) || !(kB > 0) || !(area > 0)) return 0;
  const R = LA / (kA * area) + LB / (kB * area);
  if (!(R > 0)) return 0;
  return (world.thermalRate > 0 ? world.thermalRate : 0) / R;
}
// ── 剛体の熱的な諸元 ────────────────────────────────────────────
//   C [J/K] 熱容量、L [m] 代表厚み（中心から表面までの距離のつもり）、
//   s [m] 代表寸法（接触面の長さの上限として使う）
function bodyThermal(b) {
  const s = Math.sqrt(Math.max(b.areaM2(), 1e-12));
  return { C: b.heatCap * b.mass, L: s * 0.5, s };
}
// 物体が熱を持てるか（熱伝導率か比熱が0なら熱のやりとりから外す＝完全な断熱材）
function bodyHasHeat(b) { return b.heatCap > 0 && b.conduct > 0 && b.mass > 0; }

// ── 剛体どうしの熱伝導 ──────────────────────────────────────────
//   接触しているペアを simTick が集めておき、tick の終わりに一度だけ網へ登録する。
//   サブステップごとに効かせると、同じ接触を substeps 回数えることになる。
const thermalContactPairs = new Map();      // "idA_idB" → [A, B]
function noteThermalContact(A, B) {
  if (!world.thermalOn) return;
  if (A === B) return;
  const k = A.id < B.id ? A.id + '_' + B.id : B.id + '_' + A.id;
  if (!thermalContactPairs.has(k)) thermalContactPairs.set(k, [A, B]);
}
function linkBodyBodyHeat() {
  if (!world.thermalOn) { thermalContactPairs.clear(); return; }
  for (const [A, B] of thermalContactPairs.values()) {
    if (!bodyHasHeat(A) || !bodyHasHeat(B)) continue;
    const ta = bodyThermal(A), tb = bodyThermal(B);
    // 接触面の長さは、小さい方の代表寸法を超えないものとする（面積 = 長さ × 奥行き）
    const area = Math.min(ta.s, tb.s) * world.depth;
    // ★温度はここでは動かさず、網へ登録するだけ（solveHeatNet がまとめて解く。熱の網の★）
    heatNetLink(HN_BODY, A, HN_BODY, B, thermalConductance(A.conduct, ta.L, B.conduct, tb.L, area));
  }
  thermalContactPairs.clear();
}
// ── 摩擦熱 ──────────────────────────────────────────────────────
//   1サブステップに摩擦が散逸させる仕事は（摩擦力）×（すべった距離）。
//   接触ソルバが持っているのは力積 jt = 力 × dt で、すべり距離は
//   平均すべり速度 × dt なので、掛け合わせると dt が消えて
//       Q = |jt| × (|すべり速度の初め| + |終わり|) / 2        （台形則）
//   になる。内部の力積は kg·px/s、速度は px/s なので、積は kg·px²/s²
//   ＝ J × PPM²。PPM² で割って J にする。
//   ★2物体には半分ずつ入れる。界面で出た熱がどちらへ流れるかは本当は
//     熱侵入率 √(kρc) の比で決まるが、教材としては「こすれた両方が同じだけ
//     温まる」ほうが素直で、片方が断熱物体ならもう片方が全部受け取る。
//   ★地面との摩擦は B に null を渡す。地面は温度を持たないので、熱は
//     物体側が全部受け取る（地面へ逃げるぶんは無いものとして扱う）。
let frictionHeatTotal = 0;      // [J] 散逸が生んだ熱の累計（摩擦・非弾性衝突・抗力ぜんぶ）
let reservoirHeatTotal = 0;     // [J] 恒温物体が系へ出した熱の累計（＋＝供給）
function resetFrictionHeat() { frictionHeatTotal = 0; reservoirHeatTotal = 0; }
// ── 物体へ熱を入れる共通の入口 ────────────────────────────────────
//   ★恒温物体（tempFixed）はここで温度を変えず、出入りした熱を別勘定にする。
//     「無限の熱容量を持つ熱源」の理想化なので、系の熱量はそのぶん増減する。
//     台帳は  Δ(系の熱量) = 散逸で出た熱 + 熱源が与えた熱  で閉じる。
function applyBodyHeat(b, dQ) {
  if (!b || !dQ) return;
  const C = b.heatCap * b.mass;
  if (!(C > 0)) return;
  if (b.tempFixed) { reservoirHeatTotal -= dQ; return; }   // 熱源が dQ を吸った＝系へは −dQ
  b.temp += dQ / C;
  if (b.temp < 0) b.temp = 0;
}
// ── 散逸した仕事を熱にする（摩擦・非弾性衝突・抗力の共通の出口）──────────
//   受け取れる相手（A→B の順）が居なければ熱にしない。完全な断熱物体どうしの
//   やりとりで熱を作ってしまわないための扱いで、以前からの方針と揃えている。
function addDissipatedHeat(A, B, E) {
  if (!world.thermalOn || !(E > 0)) return 0;
  const Ca = (A && bodyHasHeat(A)) ? A.heatCap * A.mass : 0;
  const Cb = (B && bodyHasHeat(B)) ? B.heatCap * B.mass : 0;
  if (Ca <= 0 && Cb <= 0) return 0;
  if (Ca > 0 && Cb > 0) { applyBodyHeat(A, E * 0.5); applyBodyHeat(B, E * 0.5); }
  else if (Ca > 0)      { applyBodyHeat(A, E); }
  else                  { applyBodyHeat(B, E); }
  frictionHeatTotal += E;
  return E;
}
function addFrictionHeat(A, B, jt, vt0, vt1) {
  if (!world.thermalOn || !jt) return 0;
  const slip = (Math.abs(vt0) + Math.abs(vt1)) * 0.5;      // [px/s] 平均すべり速度
  if (!(slip > 0)) return 0;
  return addDissipatedHeat(A, B, Math.abs(jt) * slip / (PPM * PPM));
}
// ── 非弾性衝突で失われる運動エネルギー ──────────────────────────────
//   **摩擦熱とまったく同じ形で書く**：打った力積 × 前後の相対速度の平均。
//       ΔE = −½ · jn · (vn0 + vn1)
//   jn はこのサブステップに法線方向へ打った力積の合計、vn0/vn1 はソルバの前後の
//   法線相対速度。上の addFrictionHeat が接線について書いているのと同じ式である。
//
//   ★なぜ「実際に打った力積」から出すのか。かつては接触点1つを孤立系とみなして
//         ΔE = ½ · (vn0²/kn) · (1 − e²)      （kn は接触点の逆実効質量）
//     と書いていた。単独の接触では両者は恒等的に一致する（jn = −vn0(1+e)/kn を
//     入れれば出る）が、**接触点が複数あると孤立系の仮定が崩れる**。力積は点どうしで
//     分け合うのに、各点が「自分ひとりで受け止めた」ぶんを計上するためで、向きは
//     場面によって過大にも過小にもなる。実測（落として 計上した熱 ÷ 失った力学的
//     エネルギー。理想は 100%）：
//                            旧（vn0²/kn）  この式
//         円1個（接触1点）        100.1%     100.1%   ← 単独では一致する
//         箱 40×40（平らな底＝2点）  82.7%     100.2%
//         板 120×20                74.9%     100.4%
//         円を2個積む               49.6%      98.9%
//         円を5個積む               36.9%      88.9%
//         穴あき多角形（凸分解で複数） 121.1%      99.4%
//         静止した容器へ粒54個       74.2%      98.3%
//         反発0.5 の円1個            98.5%      98.5%   ← e>0 でも一致する
//     ＝1点接触で組んである既存のデモは1ビットも動かず、多点接触だけが直る。
//   ★e=1 の対では ΔE は自動的に 0 になる（vn1 = −vn0 なので和が消える）。
//     (1−e²) のような「完全弾性だけ別扱い」の項を持たずに済むのはこのため。
//     ☆ただし**ソルバが戻しきれなかったぶんは熱として出る**。反発を配ったあとの
//       確認パス（verifyContactNormal）が非貫入を優先して反発の力積を削ることが
//       あり、そのとき運動エネルギーは本当に減っている。旧式はそれを 0 と報告して
//       いた＝減ったぶんの行き先が帳簿から消えていた（状態変化のデモで、容器の壁が
//       30秒で 20 → 20.4〜20.66℃ になるのがそれ。以前は 20℃ のまま動かなかった）。
//   ★静止している接触では使わないこと。重力が1サブステップぶん加える速度を
//     ソルバが毎回打ち消すので、そのぶんを熱にすると「床に置いた物体が永久に
//     発熱する」ことになる（離散化の産物であって物理ではない。この式でも
//     jn は自重を支えるぶんが残り、vn0 は重力ぶんだけ負なので、門番が無いと
//     ½·mg·(g·dt) ずつ湧き続ける。実測：1666kg の袋で 333 J/s）。
//   ★★2026-09-24：**門番（1 m/s）をやめ、「力を積分する前から近づいていた割合」で割り引く。**
//       熱 ＝ −½·jn·(vn0 + vn1) × clamp(vnPre / vn0, 0, 1)
//     vnPre はサブステップの頭（力を積分する前。step.js で控える）の法線相対速度。
//     置いてあるだけの接触が打ち消すのは「このサブステップの力が足した速度」だけなので
//     vnPre ≈ 0 で熱は 0。本物の衝突は積分の前から近づいているので割合 ≈ 1。完全弾性
//     （vn1 = −vn0）ではもとの式どおり 0。単独の接触では 1−e² の形に一致する
//     （½·m·vPre·vn0·(1−e²)。vPre = vn0 なら ½m·vn0²(1−e²)）。
//     ☆門番で何が落ちていたか：蝶番の板の袋（ジュールの実験）は畳まれながら板と粒が
//       ゆっくり当たるので、1 m/s 未満の散逸が多い。落として3秒で失った力学的 E 21.5kJ
//       に対し、門番で落ちたのが 1.66kJ。熱÷ΔE は 93.5% → 96.8%、持ち上げて落とし
//       直すと 86〜93% → 93〜100%（低く持ち上げたときは 71〜85% → 93〜95%）。
//     ☆一定の力を継ぎ目ごしに伝えているだけの接触も、これで熱にならない。ピストンの
//       つりあいは、気体がピストン（30kg）を押し上げ重力がおもり（680kg）を引き下げる
//       ので、積分のたびに 114 px/s で近づいては止められていた（vnPre は 0.00）。
//       旧の門番では 4,065 J の偽の熱になっていた（等温の気体への仕事と大気の仕事まで
//       入れた収支が、旧 +2.7kJ ＝ 湧いている → 新 −1.3kJ）。
//     ★それでも小さな門番は要る：vnPre が「重力が1サブステップで足す速さ」|g|·dt より
//       遅ければ 0 とみなす（contactPreVel。ウォームスタートの門番と同じしきい値）。
//       静止した物は解いたあとも 1〜3 px/s ほど震えていて、鉛の袋のように支える力積が
//       大きいと、それだけで 15 J/s の熱になった（そのとき力学的 E の変化は 0.2 J）。
//       落下中の熱のうち |g|·dt 未満の接触の分は 1.2%。
//     ☆**残っている偽の熱**：滑車・動滑車の「荷 1kg」は、地面から少し浮いた接触で
//       4サブステップ落ちて（0.17px）止められ、位置補正で押し戻される、を繰り返している。
//       1回に落ちるぶんの運動 E（約 0.017 J）がそのまま熱になり 0.47 J/s。エネルギーの
//       出どころは位置補正の押し戻しで、この式は正直に数えている（旧の門番が隠していた）。
//     ☆反発の門番（restitutionVelTh ＝ `_hit`）はそのまま。控えの速度が無い接触
//       （熱を入れた直後・途中で生まれた物体）だけ、旧の式と門番で数える。
//   ★☆**これでも「積んだ粒」は合わない。犯人はウォームスタート（下の warmOf）。**
//     この式そのものは正しい。恒等式 ΔKE = Σ j·(u₀+u₁)/2 のとおりで、実測でも
//     全接触の項が符号まで揃っている（袋＋粒の落下で**負の項は0件**、門番で落ちたのは
//     2.4kJ だけ、計上した熱＝全項の和）。＝この式は「ソルバが本当に消した運動
//     エネルギー」を過不足なく報告している。ところがその**消した量そのものが多い**：
//         mgh 37.4kJ ／ 失った力学的エネルギー 37.5kJ ／ ソルバが消した運動E 47.7kJ
//     つまり接触の中で運動エネルギーが 10kJ ほど**作られて**、それを消した熱が乗る。
//     ★作っているのはウォームスタート。前サブステップの力積を無条件に打ち直すので、
//       山が組み変わっている最中は古い力積が仕事をしてしまう。切って A/B（袋に鉛の粒・
//       4.5m 落下・計上した熱 ÷ mgh）：
//                    既定    ウォームスタート切
//           粒1段   100.3%      100.2%     ← 1段では元から出ない
//           粒2段   121.3%      103.9%
//           粒3段   133.6%      102.8%
//     ☆**それでもウォームスタートは切らない。** 積んだ物が安定するのも収束が
//       iterations=8 で足りているのもこれのおかげで、熱の精度と引き換えにできない。
//     ★調べて外れたもの（同じことを繰り返さないために残す）：
//       ・位置補正が作る位置エネルギー … 作るのは事実だが 3.2kJ で、超過 8.0kJ に足りない
//       ・負の項を 0 に丸めていること   … そもそも負の項が1件も出ない
//       ・投機的接触の bias           … specBias はめり込み側（sep≤0）では 0 を返す
//       ・曲率追従の速さの戻し        … 円どうしの接触では arcK が付かず動かない（A/B 差 0）
//   ★☆**2026-09-10 に直した。切るのではなく門番を付ける**
//     （geometry.js の `warmStartAllowed`。実測と、外れた見立ての一覧はそちらの★）。
//     **離れつつある接触には古い力積を打ち直さない**という一般則で、しきい値は
//     「重力が1サブステップで足す速さ」。組み変わっている山でだけ効き、積んだ物は
//     1ビットも変わらない。粒3段＋摩擦0.5＋反発0.4 の袋で 130.1% → **102.7%**。
//     ＝**粒は積んでよくなった**。ジュールの実験（袋）が粒1段なのは、この制限では
//     なく「置き直して落とすたび 100.9% で1ビットも動かない」ほうを採ったため。
//     ☆残っているぶん（102.7% の 2.7%、および摩擦を入れたときの着地後 6 J/s）は
//       別口で、接触が完全には静止しきらず微小にずり続けることによる。
// サブステップの番号（step.js が頭で進める）。物体に控えた「積分する前の速度」が
// このサブステップのものかを確かめる（途中で生まれた物体・熱を切っていた間の値を使わない）。
let _heatSubstepId = 0;
// 接触点の、力を積分する前の法線相対速度（B − A）。控えが無い物体があれば undefined。
//   A が null なら地面（動かない）。静止物体は今の速度（力で積分されないので同じ）。
function contactPreVel(A, B, rAx, rAy, rBx, rBy, nx, ny, dt) {
  const pre = (b, rx, ry) => {
    if (!b) return { x: 0, y: 0 };
    if (b._v0Id === _heatSubstepId) return { x: b._vx0 - b._av0 * ry, y: b._vy0 + b._av0 * rx };
    if (b.isStatic) return { x: b.vx - b.av * ry, y: b.vy + b.av * rx };
    return null;
  };
  const a = pre(A, rAx, rAy), c = pre(B, rBx, rBy);
  if (!a || !c) return undefined;
  const v = (c.x - a.x) * nx + (c.y - a.y) * ny;
  return v < -Math.hypot(world.gravX, world.gravY) * PPM * dt ? v : 0;
}
function impactHeatOf(jn, vn0, vn1, hit, vnPre) {
  if (vnPre === undefined) {                           // 控えが無い（熱を入れた直後・途中で生まれた物体）
    if (!hit || !(jn > 0)) return 0;
    const E1 = -0.5 * jn * (vn0 + vn1) / (PPM * PPM);
    return E1 > 0 ? E1 : 0;
  }
  if (!(jn > 0) || !(vn0 < 0)) return 0;
  const f = Math.min(Math.max(vnPre / vn0, 0), 1);
  const E = -0.5 * jn * (vn0 + vn1) / (PPM * PPM) * f;   // [J]
  return E > 0 ? E : 0;
}
// ── 温度 → 色（可視化）────────────────────────────────────────────
//   青（冷たい）→ 水色 → 灰白（中間）→ 橙 → 赤（熱い）。
//   範囲は world.thermalVizMin/Max [℃]。範囲外はその端の色で頭打ち。
const THERMAL_COLORS = [
  [ 40,  70, 190],   // 冷
  [ 60, 170, 230],
  [225, 225, 225],   // 中間
  [245, 160,  50],
  [210,  40,  30],   // 熱
];
function tempToColor(tempK, alpha) {
  const lo = world.thermalVizMin, hi = world.thermalVizMax;
  let u = (hi > lo) ? (K2C(tempK) - lo) / (hi - lo) : 0.5;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const n = THERMAL_COLORS.length - 1;
  const f = u * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
  const a = THERMAL_COLORS[i], b = THERMAL_COLORS[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return alpha !== undefined && alpha < 1
    ? `rgba(${r},${g},${bl},${alpha})` : `rgb(${r},${g},${bl})`;
}
// ── 系の総熱量 Σ C·T [J]（保存の確認用。UI にも出す）──────────────────
//   基準は 0K。差分だけ見たいので絶対値そのものに意味はないが、
//   「動かないこと」を見るには十分。
function totalHeat() {
  let q = 0;
  for (const b of objects) if (bodyHasHeat(b)) q += b.heatCap * b.mass * b.temp;
  if (particles.length) {
    refreshParticleThermal();     // まだ一度も回していなくても正しい値が出るように
    for (const p of particles) q += p.heatC * p.T;
  }
  // ★気体室の内部エネルギー n·Cv·T も同じ台帳に入れる。
  //   入れないと、壁と気体のあいだで熱が動いたときに合計が動いて見えてしまう
  //   （実際には保存しているのに「保存していない」と読めてしまう）。
  for (const c of gasChambers) q += c.heatCapJK() * c.T;
  return q;
}
