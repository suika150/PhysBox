// ════════════════════════════════════════
//  気体室（集中定数の理想気体 + ピストン）
// ════════════════════════════════════════
//  SPH の gas 粒子とは別物。あちらは見た目の煙で、状態方程式を満たさない
//  （実測：等温のはずの P·V が体積を変えると190倍も動き、静止密度を下回ると
//   圧力が完全に0になる）。P-V図・熱機関のように「P・V・T が1組ずつ定まって
//   いること」が要る話は、こちらの集中定数モデルで扱う。
//
//  ── 幾何 ────────────────────────────────────────────────
//  閉じた端（cx,cy）から軸方向（angle）へ伸びるシリンダー。断面の長さ width [px]、
//  奥行きは world.depth なので断面積 A = width·PX2M × depth [m²]。
//  可動端はピストン（剛体）で、閉じた端からの距離 h が気体の高さになる。
//      V = A × h,   P = nRT/V
//
//  ── ピストンに掛ける力 ──────────────────────────────────
//      F = (P − 大気圧) × A     （軸の正の向き＝気体が押し出す向き）
//  ★内側と外側を別々の力として足してはいけない。1気圧・A=0.05m² なら
//    どちらも 5000N 台で、差は数十Nしかない。別々に足すと桁落ちする。
//  ★大気圧は「すべての物体に働く力」ではない。閉じた物体に一様な圧力が
//    かかっても合力は0（全方向から等しく押される）。効くのは圧力差のある
//    可動境界＝ピストン面だけなので、ここでしか出てこない。
//
//  ── 熱 ────────────────────────────────────────────────
//  第一法則 dU = dQ − P dV、U = n·Cv·T をそのまま積む。
//  これだけで、壁と熱をやりとりしなければ断熱変化（PV^γ 一定）になり、
//  熱容量の大きい壁とよく熱を通せば等温変化になる。専用の分岐は要らない。
const R_GAS = 8.314462618;          // [J/(mol·K)]
const GAS_MIN_H_PX = 4;             // 気体の高さの下限 [px]。0 にすると P が発散する
const gasChambers = [];

class GasChamber {
  constructor(opts = {}) {
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.cx = opts.cx || 0;              // 閉じた端の中心 [px]
    this.cy = opts.cy || 0;
    this.angle = opts.angle || 0;        // 軸の向き [rad]（閉端→ピストン）
    this.width = opts.width || 100;      // 断面の長さ [px]
    this.pistonId = opts.pistonId != null ? opts.pistonId : null;
    this.wallId   = opts.wallId   != null ? opts.wallId   : null;  // 熱をやりとりする壁（null=断熱）
    // ★管でつないだ相手の気体室（null＝つないでいない）。solveGasLinks の★
    this.linkId   = opts.linkId   != null ? opts.linkId   : null;
    // ★管の途中のコック。閉じると2つは別々の気体に戻る（物質量はそのとき持っていた分で
    //   固定される）。
    //   開け閉めできることで「真空側へ開く＝断熱自由膨張」も作れる（solveGasLinks の
    //   混合の★。恒温槽の有無によらず同じ式で通る）。
    this.linkOpen = opts.linkOpen !== undefined ? !!opts.linkOpen : true;
    this.T = opts.T !== undefined ? opts.T : ROOM_K;               // [K]
    this.dof = opts.dof !== undefined ? opts.dof : 5;              // 自由度（2原子分子=5, 単原子=3）
    // 物質量。指定が無ければ「作った瞬間の幾何と初期圧力」から決める（そのほうが直感的）
    this.n = opts.n !== undefined ? opts.n : null;
    this._P0 = opts.P0 !== undefined ? opts.P0 : 101325;            // n を決めるための初期圧力 [Pa]
    this.damp = opts.damp !== undefined ? opts.damp : 400;         // ピストンの減衰 [N·s/m]
    // ★通気：シリンダーに穴を開けて外気とつなぐ。中は常に大気圧＝ピストンへの正味の力が 0。
    //   気体ばねが消えて摩擦だけが残るので、これが「手で作れるダッシュポット」になる。
    this.vent = !!opts.vent;
    this.label = opts.label || '';
    // ── 変化のさせ方（教科書の4つ）────────────────────────────────
    //   pistonLocked … ピストンを固定＝定積変化。自由なら荷重が一定なので定圧変化。
    //   thermostat  … [K] を入れるとその温度に保つ＝等温変化。null なら断熱側。
    this.pistonLocked = !!opts.pistonLocked;
    this.thermostat = opts.thermostat != null ? opts.thermostat : null;
    // 実行中の値（表示・グラフ用）
    this.h = 0; this.V = 0; this.P = 0;
    // ── 第一法則の帳簿（すべて [J]）──────────────────────────────
    //   高校物理の符号に合わせる： ΔU = Q − W（W は「気体がした仕事」）
    //   熱効率のために、吸収した熱と放出した熱を分けて持つ（η = W正味 / Q吸収）。
    this.W = 0;              // 気体がした仕事の累計
    this.Q = 0;              // 気体が受け取った正味の熱
    this.Qin = 0;            // そのうち吸収したぶん
    this.Qout = 0;           // 放出したぶん
    this._T0 = null;         // 帳簿を始めたときの温度（ΔU の基準）
    this._Vprev = null;
  }
  // 内部エネルギー U = n·Cv·T [J]
  internalU() { return this.heatCapJK() * this.T; }
  // 帳簿を始めてからの ΔU
  deltaU() { return this._T0 == null ? 0 : this.heatCapJK() * (this.T - this._T0); }
  // 熱効率 η = 正味の仕事 / 吸収した熱（1サイクル回してから読む）
  efficiency() { return this.Qin > 1e-12 ? this.W / this.Qin : 0; }
  // 帳簿をリセット（サイクルの開始点をここにする）
  resetLedger() { this.W = 0; this.Q = 0; this.Qin = 0; this.Qout = 0; this._T0 = this.T; }
  // 熱を受け取る（正＝吸収）。帳簿にも振り分ける
  addHeat(dQ) {
    if (!dQ) return;
    const C = this.heatCapJK();
    if (!(C > 0)) return;
    this.T += dQ / C;
    if (this.T < 1e-3) this.T = 1e-3;
    this.Q += dQ;
    if (dQ > 0) this.Qin += dQ; else this.Qout -= dQ;
  }
  piston() { return objects.find(o => o.id === this.pistonId) || null; }
  wall()   { return this.wallId == null ? null : (objects.find(o => o.id === this.wallId) || null); }
  axis()   { return { x: Math.cos(this.angle), y: Math.sin(this.angle) }; }
  areaM2() { return (this.width * PX2M) * world.depth; }
  heatCapJK() { return (this.n || 0) * (this.dof / 2) * R_GAS; }   // n·Cv [J/K]
  gamma() { return 1 + 2 / this.dof; }
  // 閉じた端からピストン内側の面までの距離 [px]
  heightPx() {
    const p = this.piston();
    if (!p) return 0;
    const a = this.axis();
    const d = (p.x - this.cx) * a.x + (p.y - this.cy) * a.y;   // 中心までの距離
    return d - this._pistonHalf(p, a);
  }
  // ピストンの「軸方向の厚みの半分」。面が閉端を向いている側までの距離。
  _pistonHalf(p, a) {
    if (p.type === 'circle') return p.radius;
    let best = 0;
    for (const v of p._worldVerts()) {
      const d = -((v.x - p.x) * a.x + (v.y - p.y) * a.y);       // 閉端向きへの張り出し
      if (d > best) best = d;
    }
    return best;
  }
  // ── 密閉が保たれているか ────────────────────────────────────────
  //   ピストンが閉じた端より向こうへ行ったり、シリンダーの横幅から外れたりしたら、
  //   もう「閉じた気体」ではない。そのまま計算を続けると、
  //   ・閉端より下 … 高さが負→下限に張り付き、体積比が跳んで気体の状態が壊れる
  //     （実測：圧力が 0 kPa に落ちて気体が消滅した）
  //   ・横へ外れる … シリンダーの外にいるのに 102.9 kPa を出し続ける＝漏れない気体
  //   ことになるので、破れていると判定して力も状態更新も止める。
  sealed() {
    const p = this.piston();
    if (!p) return false;
    if (this.heightPx() < GAS_MIN_H_PX) return false;
    const a = this.axis(), n = { x: -a.y, y: a.x };
    const lat = (p.x - this.cx) * n.x + (p.y - this.cy) * n.y;   // 軸からの横ずれ
    return Math.abs(lat) <= this.width * 0.5 + 2;
  }
  // 気体が占める矩形の4隅（描画と当たり判定に使う）
  corners() {
    const a = this.axis(), n = { x: -a.y, y: a.x };
    const hw = this.width / 2;
    const hPx = Math.max(this.heightPx(), 0);
    const bx = this.cx, by = this.cy;
    const tx = this.cx + a.x * hPx, ty = this.cy + a.y * hPx;
    return [
      { x: bx - n.x*hw, y: by - n.y*hw }, { x: bx + n.x*hw, y: by + n.y*hw },
      { x: tx + n.x*hw, y: ty + n.y*hw }, { x: tx - n.x*hw, y: ty - n.y*hw },
    ];
  }
}
// ── クリック位置にある気体 ──────────────────────────────────────
//   気体は「見えている水色の領域」そのものを掴めるようにする（render/gas.js が
//   corners() の多角形を塗っているので、判定も同じ頂点で行う＝見た目と一致する）。
//   ★この領域は当たり判定の奪い合いが起きない。器のU字の内側は器の多角形の外なので
//     bodyNearestToPoint は何も返さず、閉端とピストンの間には sealed() が保証する
//     とおり他の物体が入り込めない。だから物体より先に判定してよい。
//   後ろから見るのは objects と同じ流儀（後から作ったものが手前）。
function gasChamberAtPoint(wx, wy) {
  for (let i = gasChambers.length - 1; i >= 0; i--) {
    const ch = gasChambers[i];
    if (!ch.piston()) continue;
    if (pointInPolygon({ x: wx, y: wy }, ch.corners())) return ch;
  }
  return null;
}
// ── 画面に出す名前 ──────────────────────────────────────────────
//   器に付けた名札をそのまま使う（つなぐ相手を選ぶときに「気体 7」では見分けられない）。
//   名札が無いときだけ通し番号に落とす。右クリックと右パネルで同じ名前を出すために
//   1か所に置く（別々に組むと、名札を付けた器がメニューでだけ番号のままになる）。
function gasChamberLabel(ch) {
  const v = (typeof pistonVesselOfChamber === 'function') ? pistonVesselOfChamber(ch.id) : null;
  const cyl = v && v.cylinder();
  return (cyl && cyl.label) ? cyl.label : ('気体 ' + ch.id);
}
// ── 手で体積を変えたときの作り直し ──────────────────────────────
//   停止中にピストンをスライドさせる（＝初期の体積を手で決める）操作のあとに呼ぶ。
//   T は据え置くので、実質「等温で体積を変えた」ことになる。
//   ★帳簿には載せない。W・Q は「シミュレーションが起こしたこと」の記録で、手で初期
//     条件を作る操作を混ぜると熱効率が読めなくなる（uiGasProcess が帳簿をリセット
//     しないのと同じ筋）。_Vprev を捨てるので、再生を再開しても手で動かしたぶんの
//     断熱仕事は計算されない。これを捨てないと、スライドさせた体積比がそのまま
//     ありもしない圧縮・膨張として次の1サブステップに計上される。
//   ★停止中は applyGasChambers が回らないので、P・V をここで書いておかないと
//     パネルの表示が動かした後も古いままになる。
function gasManualVolumeChange(ch) {
  if (!ch || !(ch.n > 0)) return;
  const A = ch.areaM2();
  if (!(A > 0)) return;
  ch.h = Math.max(ch.heightPx(), GAS_MIN_H_PX) * PX2M;
  ch.V = A * ch.h;
  ch.P = ch.n * R_GAS * ch.T / ch.V;
  ch._Vprev = null;      // 手で変えたぶんの仕事は計上しない
  ch._pvBreak = true;    // P-V図は線を繋がず、次の点へ飛ばす
}
// ── 初期の物質量を、いまの幾何と初期圧力から決める ──────────────────
function gasInitMoles(ch) {
  const A = ch.areaM2();
  const h = Math.max(ch.heightPx(), GAS_MIN_H_PX) * PX2M;
  ch.n = (ch._P0 * A * h) / (R_GAS * ch.T);
  ch.V = A * h; ch.P = ch._P0; ch._Vprev = ch.V;
}
// ★「任意の物体をピストンにして気体室を作る」入口は廃止した。
//   ピストンが拘束されていないと、端に重りを落としただけで 720° 回って容器から
//   飛び出し（実測）、傾いたぶんだけ気体の体積も静かにずれた。気体室は必ず
//   ピストン容器（js/physics/vessel.js）が作る＝ピストンは常に軸上の1自由度に拘束される。
function deleteGasChamber(ch) {
  const i = gasChambers.indexOf(ch);
  if (i >= 0) gasChambers.splice(i, 1);
}
// ── ピストンが消えた気体室を畳む ──────────────────────────────────
//   残しておくと、選ぶ物体が無いのでパネルから消せない気体室がシーンに居座る。
//   velgraph が対象の物体を失ったウィンドウを畳むのと同じ考え方（描画側から呼ぶ）。
//   Undo ではスナップショットごと戻るので、ここで消しても取り消せる。
function pruneGasChambers() {
  for (const c of gasChambers.slice()) if (!c.piston()) deleteGasChamber(c);
}
// ── 教科書の4つの状態変化をワンクリックで作る ──────────────────────
//   定積 … ピストンを固定する（V 一定）
//   定圧 … ピストンを自由にする。荷重（ピストンの重さ＋大気）が一定なので
//           P = 大気圧 + mg/A が自動的に一定になる＝特別な仕掛けは要らない
//   等温 … 恒温槽に浸ける（いまの温度を保つ）
//   断熱 … 恒温槽を外し、壁との熱のやりとりも切る
//   ★「定積か定圧か」と「等温か断熱か」は独立した設定なので、別々に掛けられる
//     （例：定積のまま等温にする＝ただ熱を捨てるだけ、なども作れる）。
//   ★定積は「蓋を器に固定する」であって「蓋を静的にする」ではない。
//     器が動く物体になったので、蓋を静的にすると世界に打った杭になり、容器が
//     そこからぶら下がって宙に浮く。定積で閉じたいのは蓋と器の相対運動＝軸方向の
//     1自由度だけなので、フラグを立てて solveVesselConstraint（vessel.js ③）に
//     閉じてもらう。容器はそのまま落ちるし、傾けられるし、押せば動く。
function setGasPistonLocked(ch, locked) {
  const p = ch.piston();
  if (!p) return;
  ch.pistonLocked = locked;
  const v = (typeof pistonVesselOfChamber === 'function') ? pistonVesselOfChamber(ch.id) : null;
  // 押した時点の位置を新しい固定位置にする。
  //   ★ここで測って決める。null にして solveVesselConstraint に拾わせると、拾うのは
  //     次のサブステップの integrate の**後**になり、その1サブステップぶん蓋が動いた
  //     位置で固定されてしまう。固定中は気体が蓋を押さないので、外力が掛かっていると
  //     その1回で大きく動く（実測：蓋 0.2kg・外力 1500N で 13px ＝ 体積 218.3→205.3L。
  //     P-V 図に固定した瞬間の縦の飛びが出た）。
  if (v) {
    if (locked) {
      const a = v.axis(), ce = v.closedEnd();
      v._lockD = (p.x - ce.x) * a.x + (p.y - ce.y) * a.y;
    } else v._lockD = null;
  }
  if (locked && p) { p.vx = 0; p.vy = 0; }
}
// ── 管のコックを開け閉めする ────────────────────────────────
//   ★管は1本なので、両側の気体室に同じ状態を書く（片側だけ開いている管は無い）。
function setGasCock(ch, open) {
  if (!ch) return;
  ch.linkOpen = !!open;
  const o = ch.linkId != null ? gasChambers.find(c => c.id === ch.linkId) : null;
  if (o) o.linkOpen = !!open;
}
function setGasThermal(ch, mode) {
  if (mode === 'isothermal') ch.thermostat = ch.T;      // いまの温度で保つ
  else if (mode === 'adiabatic') { ch.thermostat = null; ch.wallId = null; }
}
// ── 減衰が散逸させた仕事を熱にする ──────────────────────────────────
//   この減衰はピストンとシリンダーの摩擦なので、熱が入るのは **固体の側**。
//   ★気体に直接入れてはいけない。入れると断熱変化そのものが壊れる
//     （実測：気体へ入れていたとき PV^γ が 3.85% ずれ、断熱の関係が見えなくなった）。
//     気体が温まるのは、壁を通じた熱伝導（linkGasHeat）という正しい経路だけにする。
//   受け取れる相手（ピストン→シリンダー壁）がどちらも断熱なら熱にしない。
//   これは接触摩擦の addFrictionHeat が「両方とも断熱なら熱にしない」のと同じ扱い。
function gasAddHeat(ch, piston, E) {
  if (!(E > 0)) return;
  const ves = (typeof pistonVesselOfChamber === 'function') ? pistonVesselOfChamber(ch.id) : null;
  // ★摩擦の相手はシリンダーなので、器も受け皿に入れる。真空・通気のシリンダーでは
  //   気体が熱を持てない（n=0 ＝ 熱容量 0）ので、器が最後の行き先になる。
  for (const b of [piston, ch.wall(), ves ? ves.cylinder() : null]) {
    if (!b || !bodyHasHeat(b)) continue;
    const C = b.heatCap * b.mass;
    if (C > 0) { b.temp += E / C; frictionHeatTotal += E; return; }
  }
  // ★どれも熱を持てないときは気体そのものへ入れる（n=0 なら addHeat が何もしない）。
  //   ここまで来て捨てると、摩擦熱を熱として積んでいる他の箇所と勘定が食い違う。
  ch.addHeat(E);
}
// ── 毎サブステップの更新 ────────────────────────────────────────
//   ① 幾何から V を出す
//   ② 体積変化ぶんの仕事で内部エネルギーを更新（＝断熱変化がここで出る）
//   ③ P = nRT/V
//   ④ ピストンへ (P − 大気圧)·A を掛け、減衰を陰的に入れる
// ── 管でつないだ2つの気体室（1つの気体が2つの空間を行き来する）────────────
//   ★スターリング機関のように「高温側と低温側を気体が行き来する」形を表すために要る。
//     つないだ2室は**圧力が共通**で、物質量だけが体積と温度に応じて分かれる：
//         P = (n₁+n₂)R / (V₁/T₁ + V₂/T₂)、  n_i = P·V_i /(R·T_i)
//     これは教科書のスターリング解析（Schmidt の理想化）そのもの。
//   ★**温度を決める一般則は「流れ込んだ気体は、その場の気体と混ざる」**。出ていく側は
//     変わらない（残った気体の温度は、仲間が出て行ったことでは変わらない。体積が減る
//     ぶんの冷却は ② が別に見ている）。恒温槽に浸かった室では槽が温度を決めるので
//     混ざった結果は残らず、運ばれてきた熱は ②' がそのまま Q に載せる。
//     **この1つの規則で、両方が恒温槽（スターリング）も、両方が断熱（自由膨張）も、
//     片方だけ恒温槽も、場合分けなしに同じ式で通る。**
//     以前は「両方が恒温槽のときだけ分配する」と条件を付けていたが、それだと
//     真空側へ開く断熱自由膨張が作れず、しかも**つないだ後に恒温槽を外すと管が黙って
//     死ぬ**（実測：断熱に戻して蓋を押し込むと P が 721.0 kPa と 101.3 kPa に割れた）。
//   ★**混合は内部エネルギーを恒等的に保存する**。受け取る側の新しい温度を
//     T' = (n·T + Δn·T_from)/(n+Δn) と書くと、出す側の n が同じ Δn だけ減るので
//     Σ n·Cv·T は式の上で打ち消し合う（Cv が同じ2原子分子どうしなら厳密）。
//     だから自由膨張では温度が変わらない＝ジュールの実験がそのまま出る。
//   ★物質量の総和は動かさない（気体は逃げも湧きもしない）。
//   ★体積は**その場で測り直す**。ch.V はこのあと applyGasChambers の中で蓋の位置から
//     書き直されるので、そのまま使うと1サブステップ古い体積で分けることになり、
//     圧力がぴったり揃わない（実測：92.0 と 88.3 kPa ＝ 4% ずれた）。
function _linkVol(c) {
  const A = c.areaM2();
  if (!(A > 0)) return 0;
  return A * Math.max(c.heightPx(), GAS_MIN_H_PX) * PX2M;
}
function solveGasLinks() {
  if (gasChambers.length < 2) return;
  const done = new Set();
  for (const a of gasChambers) {
    if (a.linkId == null || done.has(a.id)) continue;
    const b = gasChambers.find(c => c.id === a.linkId);
    if (!b || done.has(b.id)) continue;
    if (!a.linkOpen || !b.linkOpen) continue;                     // コックが閉じている
    done.add(a.id); done.add(b.id);
    if (a.n == null) gasInitMoles(a);
    if (b.n == null) gasInitMoles(b);
    const nTot = (a.n || 0) + (b.n || 0);
    const Va = _linkVol(a), Vb = _linkVol(b);      // ★いまの蓋の位置で測り直す（上の★）
    if (!(nTot > 0) || !(Va > 0) || !(Vb > 0)) continue;
    // ★**空の空間は温度を持たない**。入ってくる気体の温度を先に名乗らせる。
    //   そうしないと、真空側へ開いた最初の1サブステップだけ「空の部屋に残っていた
    //   古い温度」で分けることになり、体積比が同じでも物質量がずれる。
    if (!(a.n > 1e-12) && a.thermostat == null) a.T = b.T;
    if (!(b.n > 1e-12) && b.thermostat == null) b.T = a.T;
    if (!(a.T > 0) || !(b.T > 0)) continue;
    const P = nTot * R_GAS / (Va / a.T + Vb / b.T);
    const na = P * Va / (R_GAS * a.T), nb = P * Vb / (R_GAS * b.T);
    // ★混ざるのは受け取る側だけ（上の★）。元の温度で両方を評価してから書き込む。
    const Ta0 = a.T, Tb0 = b.T;
    _gasLinkMix(a, na, Tb0);
    _gasLinkMix(b, nb, Ta0);
    a.n = na; b.n = nb;
  }
}
// 流れ込んだ気体と混ざったあとの温度（上の★）。恒温槽の室では槽が決めるので何もしない。
function _gasLinkMix(c, nNew, Tfrom) {
  if (c.thermostat != null) return;
  const n0 = c.n || 0;
  const dn = nNew - n0;
  if (!(dn > 0) || !(nNew > 0)) return;      // 出ていくだけの側は変わらない
  c.T = (n0 * c.T + dn * Tfrom) / nNew;
}
function applyGasChambers(dt) {
  solveGasLinks();          // ★つないだ室は、力を出す前に物質量を分け直す（上の★）
  if (!gasChambers.length || !(dt > 0)) return;
  for (const ch of gasChambers) {
    const p = ch.piston();
    if (!p) continue;
    if (ch.n == null) gasInitMoles(ch);
    const A = ch.areaM2();
    // ★「気体が無い室」を丸ごと飛ばしてはいけない。ピストンとシリンダーの摩擦は
    //   気体の性質ではなく機械の性質なので、中が真空でも通気でも働く。
    //   ここで n>0 を要求していたせいで、気体を抜いたシリンダーは減衰も一緒に
    //   消えていた（実測：真空・c=120 のピストンに 200px/s を与えても 30tick 後まで
    //   200.00px/s のまま。理論なら時定数 m/c = 0.042 秒で 0.01px/s まで落ちる）。
    //   状態方程式のほうは n=0 なら P=0 になるので、下の②③はそのまま通してよい。
    if (!(A > 0)) continue;
    // ★密閉が破れていたら、力も状態更新も止める。
    //   閉じ直したときは _Vprev を捨てる（＝抜けている間に変わった体積ぶんの仕事は
    //   計算しない）。持ち越すと、ピストンを外へ動かして戻しただけで体積比が跳び、
    //   ありもしない断熱圧縮で温度が大きく飛ぶ。
    const wasBroken = !!ch.broken;
    ch.broken = !ch.sealed();
    if (ch.broken) { ch._Vprev = null; continue; }
    if (wasBroken) ch._Vprev = null;
    const hPx = Math.max(ch.heightPx(), GAS_MIN_H_PX);
    ch.h = hPx * PX2M;
    ch.V = A * ch.h;
    // ② 体積変化による温度変化。断熱変化の厳密解をそのまま使う。
    //    dU = −P dV に U = n·Cv·T と P = nRT/V を入れて解くと
    //        T_new = T_old × (V_old / V_new)^(γ−1)
    //    ★ここを「dW = P dV を直前の圧力で評価する」1次のオイラー法にしていたら、
    //      圧縮では上がっていく圧力を過小に、膨張では下がっていく圧力を過大に見積もり、
    //      どちらも同じ向きに効いて **1周ごとに温度が下がり続けた**
    //      （実測：1周で −1.61K、4周で −6.44K と直線的に累積。体積も1周 −0.55%）。
    //      P-V 図の線が閉じず、熱機関のサイクルで偽の仕事が出てしまう。
    //      厳密解なら可逆断熱変化で PV^γ が機械精度で保たれ、往復すれば必ず元へ戻る。
    if (!ch.vent && ch._Vprev != null && ch._Vprev > 0) {
      const C = ch.heatCapJK();
      if (C > 0 && ch.V > 0) {
        let ratio = ch._Vprev / ch.V;
        if (ratio < 1e-6) ratio = 1e-6;                 // 極端な跳びで壊れないように
        else if (ratio > 1e6) ratio = 1e6;
        const Tn = ch.T * Math.pow(ratio, ch.gamma() - 1);
        ch.W += C * (ch.T - Tn);       // 気体がした仕事 dW = −dU
        ch.T = Tn > 1e-3 ? Tn : 1e-3;  // 絶対零度より下へは行かせない
      }
    }
    ch._Vprev = ch.V;
    if (ch._T0 == null) ch._T0 = ch.T;      // 帳簿の基準（ΔU をここから測る）
    // ②' 恒温槽（等温変化）。目標温度へ戻すのに要った熱を、そのまま Q に計上する。
    //     これが等温変化の Q そのもの。ΔU = 0 なので理屈どおり Q = W になり、
    //     帳簿がそのまま検算になる。外部の熱源なので系の熱量は保存しない
    //     （＝「熱浴に浸けた」という理想化。実在の壁で等温にしたいなら
    //       熱容量の大きい壁を wallId に指定するほうを使う）。
    if (ch.thermostat != null) {
      const C = ch.heatCapJK();
      if (C > 0) ch.addHeat(C * (ch.thermostat - ch.T));
    }
    // ③ 状態方程式
    ch.P = ch.n * R_GAS * ch.T / ch.V;
    // ③' 通気（シリンダーに穴を開けて外気に開放した状態）。中は always 大気圧なので
    //     ピストンへの正味の力は 0 になり、残るのはピストンとシリンダーの摩擦だけ
    //     ＝ばねを持たない制動器（ダッシュポット）になる。
    //   ★「気体を抜く（真空）」ではこれは作れない。真空にすると中は 0Pa でも外から
    //     大気が押すので、正味 −大気圧×A の力で潰れる（内径2m・奥行0.05m の器なら
    //     A=0.1m² ＝ 10.1kN。5kg のピストンは一瞬で底まで落ちる）。潰れないのは
    //     外気そのものが無い世界（world.atmPressure=0）だけで、それは場面の側を
    //     曲げることになる。通気なら大気があるまま力が 0 になる。
    //   ★温度は外の空気と入れ替わるので、断熱変化（②）も仕事の帳簿も回さない。
    if (ch.vent) ch.P = world.atmPressure;
    // ④ ピストンへの力。内外の差だけを1つの数として計算する（桁落ち回避）
    const a = ch.axis();
    const ves = (typeof pistonVesselOfChamber === 'function') ? pistonVesselOfChamber(ch.id) : null;
    const cyl = ves ? ves.cylinder() : null;
    // 反作用の受け手（＝閉端を押し返される器）。静的なら受け取っても何も起きない。
    const kick = (jx, jy, px, py) => {
      if (!cyl || cyl.isStatic || cyl.held || !(cyl.invMass > 0)) return;
      cyl.applyImpulse(jx, jy, px, py);
      cyl.sleeping = false; cyl.sleepTimer = 0;
    };
    const F  = (ch.P - world.atmPressure) * A;         // [N] 軸の正の向き
    const fx = F * a.x * M2PX, fy = F * a.y * M2PX;    // 内部の力は kg·px/s²
    // ⑤ ★反作用は蓋が動けるかどうかに関係なく掛ける。気体は蓋を押し出すのと同じ力で
    //   閉端を押し返している。これが無いと、容器は外から何もされていないのに正味の力を
    //   受ける＝推進機になる（器が静的だった頃は地面が黙って受け止めていたので、
    //   表に出ていなかった）。作用点は閉端の中心なので、傾いた容器では偶力も正しく出る。
    //   ★定積（pistonLocked）でも同じ。定積は「蓋を器に固定した」状態であって、
    //     気体が押すのをやめたわけではない。押した力は拘束を通してそのまま器へ抜ける。
    const ceW = ves ? ves.closedEnd() : null;
    if (ceW) kick(-fx * dt, -fy * dt, ceW.x, ceW.y);
    if (!p.isStatic && !p.held && p.invMass > 0) {
      // ★減衰を「先」に、力より前に掛ける。こうすると釣り合い点では速度が0で
      //   減衰が何もしないので、P = 大気圧 + mg/A がぴったり成り立つ。
      //   逆順（力→減衰）だと、減衰が重力の加速分まで毎サブステップ食って、
      //   釣り合いの圧力が c·g·dt ぶん高いところで止まってしまう。
      //   形は陰的（v ← v/(1+c·dt/m)）なので、係数をいくら大きくしても発散しない
      //   （実測：陽的だと c=3000 で底に張り付いたが、この形なら c=200000 でも無事）。
      if (ch.damp > 0) {
        const k = 1 / (1 + ch.damp * p.invMass * dt);
        const av = p.vx * a.x + p.vy * a.y;           // 軸方向の成分だけを減衰させる
        const dv = av * (k - 1);
        p.vx += dv * a.x; p.vy += dv * a.y;
        // ★減衰が奪った運動エネルギーは熱にする。捨てると行方不明になり、
        //   摩擦熱を熱として積んでいる他の箇所と勘定が食い違う。
        //   この減衰は物理的にはピストンとシリンダーの摩擦なので、熱容量を持つなら
        //   ピストンへ、持たなければ気体そのものへ入れる。
        const dE = 0.5 * (av*av - av*av*k*k) / (p.invMass * PPM * PPM);   // [J]
        if (dE > 0) gasAddHeat(ch, p, dE);
        // ★摩擦の相手はシリンダーなので、減衰が蓋から奪った運動量は器へ渡す。
        //   渡さないと、蓋が動くたびに容器全体の運動量が減る＝見えないブレーキになる。
        kick(-dv * a.x / p.invMass, -dv * a.y / p.invMass, p.x, p.y);
      }
      p.vx += fx * p.invMass * dt;
      p.vy += fy * p.invMass * dt;
      p.sleeping = false; p.sleepTimer = 0;
      // 力ベクトル表示へ（重力・垂直抗力と同じ土俵に乗る「正味の力」）
      p.recordForce('pressure', fx * dt, fy * dt, p.x, p.y, 'gas' + ch.id);
    }
  }
}
// ── 壁との熱のやりとり（tick に一度）────────────────────────────
//   気体の熱容量 n·Cv と壁の熱容量のあいだの伝導として扱う。
//   壁を指定しなければ断熱＝PV^γ が保たれる。
//   ★温度はここでは動かさず、網へ登録するだけ（thermal.js 熱の網の★）。
//     気体の受け取った熱は solveHeatNet が ch.addHeat で帳簿に載せる。
function linkGasHeat() {
  if (!world.thermalOn) return;
  for (const ch of gasChambers) {
    const w = ch.wall();
    if (!w || !bodyHasHeat(w)) continue;
    if (!(ch.heatCapJK() > 0)) continue;
    const wt = bodyThermal(w);
    // 接触面はシリンダーの内側の面（断面 + 側面）とみなす
    const area = (ch.width * PX2M + 2 * ch.h) * world.depth;
    // 気体側の「厚み」は高さの半分（中心から壁まで）
    const U = thermalConductance(ch.wallConduct || 0.026, Math.max(ch.h * 0.5, 1e-3),
                                 w.conduct, wt.L, area);
    heatNetLink(HN_GAS, ch, HN_BODY, w, U);
  }
}
// ── 保存／復元 ──────────────────────────────────────────────
function serializeGasChambers() {
  return gasChambers.map(c => ({
    id: c.id, cx: c.cx, cy: c.cy, angle: c.angle, width: c.width,
    pistonId: c.pistonId, wallId: c.wallId, linkId: c.linkId, linkOpen: c.linkOpen,
    T: c.T, dof: c.dof, n: c.n,
    damp: c.damp, vent: c.vent, label: c.label,
    pistonLocked: c.pistonLocked, thermostat: c.thermostat,
    W: c.W, Q: c.Q, Qin: c.Qin, Qout: c.Qout, T0: c._T0,
  }));
}
function deserializeGasChambers(arr) {
  gasChambers.length = 0;
  if (!Array.isArray(arr)) return;
  for (const d of arr) {
    if (!d) continue;
    const c = new GasChamber(d);
    if (d.n != null) { c.n = d.n; c._Vprev = null; }
    // 帳簿も引き継ぐ（サイクルの途中で保存しても続きから読める）
    c.W = d.W || 0; c.Q = d.Q || 0; c.Qin = d.Qin || 0; c.Qout = d.Qout || 0;
    c._T0 = d.T0 != null ? d.T0 : null;
    gasChambers.push(c);
  }
}
