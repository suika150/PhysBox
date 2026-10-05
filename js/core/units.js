// ════════════════════════════════════════
//  PHYSBOX — Full Physics Sandbox Engine
//  Based on Algodoo feature set
// ════════════════════════════════════════
const canvas = document.getElementById('main-canvas');
// ════════════════════════════════════════
//  単位系（SI）
//   長さのみ内部は px で保持し、PPM で m と換算する（幾何コードを不変に保つため）。
//   時間[s]・質量[kg]・角度[rad] は内部もSI。
//   内部の「力」は kg·px/s² = N × PPM。UI境界で /PPM して N にする。
//   内部の「トルク」は kg·px²/s² = N·m × PPM²。
// ════════════════════════════════════════
const PPM   = 100;              // pixels per meter（1 px = 1 cm）
const M2PX  = PPM;
const PX2M  = 1 / PPM;
const G_EARTH = 9.80665;        // [m/s²]
const toM  = px => px * PX2M;
const toPx = m  => m  * M2PX;
// 質量欄の表示桁 [kg]。
//   ふつうの教材レンジ（0.1〜200 kg）は小数第2位まで。スライダーの刻みが有効数字2桁
//   なので第3位は常に 0 になり、桁だけ増えて読みにくい。
//   ただし 0.1 kg 未満まで一律に第2位で丸めると、5 g の物体が 0.01 kg（2倍）、
//   1 g の物体が 0.00 kg（ゼロ！）になってしまう。軽い物体は有効数字2桁を保てる
//   ところまで桁を伸ばす（欄の下限は 0.001 kg なので 0.0010 まで出る）。
function fmtMassKg(m){
  if (!(m > 0)) return '0';
  if (m >= 0.1) return m.toFixed(2);
  return m.toFixed(Math.min(6, 1 - Math.floor(Math.log10(m))));
}
const yUI = v => -v;
const gravPxX = () => world.gravX * M2PX;   // 重力加速度 [px/s²]
const gravPxY = () => world.gravY * M2PX;
// 反発を無視する接近速度の上限 1 m/s（Box2D b2_velocityThreshold 準拠）。
//   ★これは「積んだ箱が永久にカタカタ震えないため」の門番で、低速では反発係数が数値の
//     ノイズに埋もれる、という理屈で置かれている。**ただしその理屈は e<1 の話**である：
//     e=1 と宣言した対は「止まらない」ことそのものが指定なので、門番に掛けてはいけない。
//   ★そこで実際に使う下限は restitutionVelTh(e) ＝ この値 ×(1−e) にする。
//     e=0 なら今までどおり、e=1 なら下限 0（必ず跳ねる）、間は連続。分岐ではなく1本の式
//     なので、「この場合だけ」の特別扱いが入らない。
//   ★かつてここを定数のまま全対に掛けていたときは、**e=1 の物体どうしが衝突するだけで
//     力学的エネルギーが消えていた**。接近速度が 1m/s 未満の接触は e=0 に落ちる＝完全
//     非弾性になり、非弾性崩壊を起こす。実測（無重力の箱の中で反発1・摩擦0の円、
//     初速 150px/s、30秒後に残る運動エネルギー）：
//         〇1個（壁とだけ当たる） 0.97   ← 壁は無関係だった
//         〇2個 0.61 ／ 〇4個 0.00 ／ 〇16個 0.00
//     この1行だけを外すと 4個も16個も 30秒で 1.000（ソルバ自体は e=1 で厳密で、
//     数値的な漏れはゼロだった）。sep≤0 の条件は無関係で、外しても結果は変わらない。
const RESTITUTION_VEL_TH = 1.0 * M2PX;
const restitutionVelTh = e => RESTITUTION_VEL_TH * (1 - e);
// ════════════════════════════════════════
//  ロープ（PBD チェーン）の既定値と調整値
//   iters=8：接触検出を反復の外へ出したので、20 → 8 で同じ安定度が出る（数値検証済み）
//   margin：投機的接触の余裕。反復中に節点が入り込んでも取りこぼさないための厚み [px]
// ════════════════════════════════════════
const ROPE_CFG = {
  radius: 3,          // [px] ロープ半径 = 接触判定の厚み（3 cm）
  linDensity: 0.2,    // [kg/m] 線密度。節点質量 m = λ × 節点間隔
  iters: 8,           // 位置投影の反復数（旧 20）
  velIters: 4,        // 速度パスの反復数
  gravScale: 1.0,     // 節点の重力係数（旧 0.25。質量を持たせたので満重力へ）
  slop: 0.3,          // [px] 許容めり込み
  beta: 0.8,          // 位置補正率
  margin: 2.0,        // [px] 投機的接触マージン
  friction: 0.6,      // ロープ表面の摩擦係数（物体側との積で合成）
  maxPull: 30,        // [px] つかみ中に1反復で引き戻す伸びの上限（暴走防止）
  damp: 2.41,         // [1/s] 運動中の節点減衰。波動の実演では 0.3 程度まで下げる
  dampSettle: 25.3,   // [1/s] 静止寸前の微振動を殺す強い減衰
};
// ════════════════════════════════════════
//  波長と分散
//   色は3成分・波長は1成分なので「色→波長」は原理的に不可能。
//   よってレーザーは波長を第一の属性とし、表示色はそこから導出する。
// ════════════════════════════════════════
const LASER_PRESETS = [
  { label: '紫 405',  wl: 405.0 },   // 青紫半導体レーザー
  { label: '青 450',  wl: 450.0 },
  { label: '緑 532',  wl: 532.0 },   // Nd:YAG 第2高調波
  { label: '黄 589',  wl: 589.3 },   // ナトリウムD線
  { label: '赤 633',  wl: 632.8 },   // He-Ne
  { label: '深赤 680', wl: 680.0 },
];
let laserWavelength = 632.8;   // [nm] 新規レーザーの既定波長（He-Ne）
let laserInteractHost = false; // 新規レーザーが取り付け先の物体とも干渉するか（既定OFF＝従来動作）
let laserWhiteLight = false;   // ★白色光モード：1回の配置で LASER_PRESETS の全波長を重ねて置く
// ─── ビームの幅と干渉（新規レーザーの既定値）───
//   既定は width=0（従来どおり太さのない1本）・coherent=false（従来どおり強度加算）。
//   何も触らなければ、これまでと1ピクセルも変わらない絵が出る。
let laserWidth      = 0;       // [px] ビーム幅。0 なら1本だけ出す
let laserBeamMode   = 'array'; // 'array'=細いレーザーを並べる / 'solid'=太い一本（連続開口）
let laserRayNum     = 2;       // [本] array のときの本数。既定2＝ヤングの二重スリットの形
let laserCoherent   = false;   // 位相を持たせて干渉させるか
// ─── 回折格子の既定値（新規に置く格子の設定）───────────────
//   λ_sim(633nm) = 12.7 px なので、1次の回折が存在する条件 d ≥ λ から d は 13 px 以上要る。
//   既定 d = 40 px では sinθ₁ = 12.7/40 = 0.32 → θ₁ = 18.5°、3次(71°)まで出る。
//   実スケールに直すと 2 µm ＝ 500本/mm で、実在する回折格子そのものの値になる。
// ★既定を2本（ヤングの二重スリット）にしてある理由。
//   はっきりした次数（フラウンホーファー回折）が立つのはスクリーンまでの距離が
//   L ≫ (Nd)²/λ のときで、この距離は本数の2乗で効く。N=2・d=40px なら 5 m 先で足り、
//   光源から受光面までが等倍のまま画面に収まる。N=5 だと 63 m 必要で、置いただけでは
//   近接場（フレネル回折）の複雑な模様しか出ず「壊れている」ように見える。
//   本数はプロパティ欄で増やせて、必要な距離もその場に表示される。
const SLIT_N_MAX = 20;   // [本] スリット数の上限（波面の数だけ重くなるため）
const SLIT_A_MIN_M = 0.005;   // [m] スリット幅の下限（スライダーの下端）
let gratingSlitN = 2;    // [本] スリット数。2＝ヤングの二重スリット
let gratingSlitD = 40;   // [px] スリット間隔 d（格子定数）
let gratingSlitA = 12;   // [px] スリット幅 a。d より狭いことが前提
// ════════════════════════════════════════
//  干渉：波長をシミュレータのスケールへ拡大する
//   実波長 633nm は 6.3e-7 m ＝ 6.3e-5 px で、画面上ではまったく表現できない。
//   そこで一律の倍率 K で拡大する。単一の定数なので、波長どうしの比・縞間隔の比・
//   「λが長いほど縞が広い」といった関係はすべて厳密に保たれる（絶対値だけが架空になる）。
//
//   K の決め方：干渉には「幾何倍率のある系」と「ない系」がある。
//     交差する2ビーム  縞間隔 = λ/(2sin(θ/2))   小角度で λ の数十倍  → λ 自体は小さくてよい
//     ヤング           縞間隔 = λL/d            λ の10倍以上         →   〃
//     薄膜             1次あたりの膜厚 λ/(2n)   倍率なし             → λ 自体が見える必要がある
//     定在波           λ/2                      倍率なし             →   〃
//   薄膜・くさび・ニュートンリング・定在波まで扱うので、倍率のない側に合わせる必要がある。
//   K = 2e5 で 633nm → 12.7 px ＝ 12.7 cm。このとき
//     定在波 6.3px ／ 薄膜1次の膜厚(n=1.5) 4.2px ／ くさび(α=0.05rad) 127px ／
//     ニュートン(R=10m) r = 113,159,195,225px ／ 2ビーム交差10° 73px
//   と、どれも描ける寸法に収まる。
//   ★UIには出さない：ここを動かすと全現象の寸法が同時に変わり、比較の基準が失われる。
//     代わりに、拡大後の波長をパネルに表示して「拡大している」事実自体は隠さない。
const LAMBDA_SIM_K = 2e5;
// [nm] → シミュレータ上の波長 [px]。 λ[nm] × 1e-9[m/nm] × PPM[px/m] × K
const simLambdaPx = wl => wl * 1e-7 * LAMBDA_SIM_K;
const simWaveK    = wl => 2 * Math.PI / simLambdaPx(wl);   // 波数 [rad/px]
// ★画面上の長さ [px] → 実スケールへの換算 [m]。
//   波長を K 倍しているので、λ と比べて意味を持つ長さ（スリット間隔・スリット幅・膜厚）は
//   すべて同じ K 倍で拡大されている。÷K で戻すと「実物ならこの寸法」が出る。
//   d = 0.4 m（画面上）なら 2 µm ＝ 500本/mm で、実在する回折格子の値になる。
const simToRealM = px => px * PX2M / LAMBDA_SIM_K;
// 実スケール換算を「µm」と「本/mm」で読める文字列にする（格子定数の表示用）
function fmtGratingPitch(px) {
  const m = simToRealM(px);
  if (!(m > 0)) return '—';
  const um = m * 1e6, perMm = 1e-3 / m;
  return `${um < 10 ? um.toFixed(2) : um.toFixed(1)} µm ＝ ${Math.round(perMm)} 本/mm`;
}
// Bruton の近似：可視スペクトルを表示用RGBへ
function wavelengthToHex(wl) {
  let r = 0, g = 0, b = 0;
  if      (wl >= 380 && wl < 440) { r = -(wl-440)/60; g = 0; b = 1; }
  else if (wl < 490)              { r = 0; g = (wl-440)/50; b = 1; }
  else if (wl < 510)              { r = 0; g = 1; b = -(wl-510)/20; }
  else if (wl < 580)              { r = (wl-510)/70; g = 1; b = 0; }
  else if (wl < 645)              { r = 1; g = -(wl-645)/65; b = 0; }
  else if (wl <= 780)             { r = 1; g = 0; b = 0; }
  let f = 1;                                        // 視感度の端での減衰
  if      (wl >= 380 && wl < 420) f = 0.3 + 0.7*(wl-380)/40;
  else if (wl > 700 && wl <= 780) f = 0.3 + 0.7*(780-wl)/80;
  else if (wl < 380 || wl > 780)  f = 0;
  const q = v => Math.round(255 * Math.pow(Math.max(v,0)*f, 0.8)).toString(16).padStart(2,'0');
  return '#' + q(r) + q(g) + q(b);
}
function wavelengthName(wl) {
  if (wl < 430) return '紫';
  if (wl < 490) return '青';
  if (wl < 510) return '藍緑';
  if (wl < 560) return '緑';
  if (wl < 590) return '黄';
  if (wl < 630) return '橙';
  return '赤';
}
// ─── 分散：コーシーの式 n(λ) = A + B/λ²（λ [µm]）───
//   n_d（d線での屈折率）とアッベ数 V_d から A・B が一意に決まる。
//   V_d = (n_d − 1)/(n_F − n_C)、n_F − n_C = B·(1/λ_F² − 1/λ_C²)
//   BK7・水では実測と4桁一致することを数値検証済み。
//   ★分散のON/OFFは b.dispersion で切り替える。V_d を 0 にはできない：この式のとおり
//     分散の強さ B は 1/V_d に比例するので、V_d→0 は「分散なし」ではなく分散無限大であり、
//     無分散はあくまで V_d→∞ の極限。V_d は常に実在する値（1〜100）を保つ。
const LAM_D = 0.5876, LAM_F = 0.4861, LAM_C = 0.6563;          // [µm] d線・F線・C線
const CAUCHY_DINV = 1/(LAM_F*LAM_F) - 1/(LAM_C*LAM_C);         // ≈ 1.9104 [µm⁻²]
const ABBE_DEFAULT = 64;                                       // クラウンガラス（分散OFFの物体が持つ既定値）
function iorAt(b, wl) {
  const nd = b.ior;
  if (!(nd > 1) || !b.dispersion || !(b.abbe > 0)) return nd;  // 分散OFF＝全波長で n_d
  const B = (nd - 1) / (b.abbe * CAUCHY_DINV);
  const A = nd - B / (LAM_D * LAM_D);
  const lam = (wl || 587.6) / 1000;                            // nm → µm
  return A + B / (lam * lam);
}
// ════════════════════════════════════════
//  衝突レイヤー
//   物体は下位4ビットのマスクを持ち、共有ビットが1つでもあれば衝突する。
//   layers === 0 は「ゴースト」＝物体・レーザー・粒子・ロープのすべてを透過する
//   （旧 isSensor と旧 noCollide をこの1つに統合した）。
//   注意：マスク方式なので推移的ではない。A={1}, B={1,2}, C={2} のとき
//         A↔B と B↔C は衝突するが A↔C は衝突しない。B は「両方の世界に存在する壁」になる。
// ════════════════════════════════════════
const LAYER_COUNT   = 4;
const LAYER_ALL     = 0b1111;
const LAYER_DEFAULT = 0b0001;                                        // 新規物体はレイヤー1のみ
const LAYER_COLORS  = ['#42a5f5', '#66bb6a', '#ffa726', '#ab47bc'];  // バッジの色（UIのチップと一致）
function defaultJointLayers(bodyA, bodyB) {
  if (!bodyA && !bodyB) return LAYER_ALL;
  return ((bodyA ? bodyA.layers : 0) | (bodyB ? bodyB.layers : 0)) & LAYER_ALL;
}
// シーンJSONの単位系バージョン。★保存に書くだけで、読み込みでは見ない
//   （同じ版が書いたファイルだけを読む前提。scene-io.js の loadScene の★を参照）
const UNIT_VERSION = 2;
const ctx = canvas.getContext('2d');
// ブラウザのデフォルトの右クリックメニューを完全に無効化する
document.addEventListener('contextmenu', e => {
  e.preventDefault();
});
// ─── World State ───────────────────────
