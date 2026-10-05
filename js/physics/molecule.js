// ════════════════════════════════════════
//  気体分子運動論（弾性衝突する分子の集まり）
// ════════════════════════════════════════
//  SPH の水（js/physics/particles.js）とは別のソルバで動く。同じ particles 配列に居るので
//  保存・選択・一括選択・温度グラフはそのまま効き、step.js が型で振り分ける。
//
//  ★なぜ SPH に相乗りできないか
//    SPH は位置ベースで、速度は位置差分から作り直す（particles.js の⑤）。「弾性衝突」という
//    概念が入る場所が構造的に無い。加えて、水を安定させるための dampRate(1.83/s)・
//    maxSpeed(2000px/s)・連成利得 0.02・coupleMaxG=1 は、分子運動論ではそのどれもが致命的
//    （減速していく分子／裾を切られたマクスウェル分布／壁に 2% しか届かない力積）。
//    実測では、旧 gas 粒子は 11.6kg の蓋に潰されて体積が静止密度の 4% になり、
//    速さ 161px/s のうち 159px/s が「上向きの一定ドリフト」で、熱運動は 25px/s しか無かった。
//
//  ── このモデルが正しくすること ────────────────────────────────
//  ・分子は等速直線運動し、壁と完全弾性衝突する。減衰も速度制限も無い
//  ・壁が受けた力積をそのまま物体へ返す（頭打ちを掛けない＝気体は蓋を持ち上げられる）
//  ・温度は状態変数ではなく ⟨½mv²⟩ から決まる（「温度とは分子の運動エネルギーの平均」）
//  ・動く壁との衝突では壁の速度が入る＝圧縮すると分子が速くなる（断熱圧縮で温まる）
//
//  ── 次元について（★教材で必ず断ること）────────────────────────
//  画面の中は2次元なので、壁が受ける圧力は  P = N m ⟨vx²⟩ / V。
//  等分配則 ⟨vx²⟩ = ⟨v²⟩/2 を入れると  P = N m ⟨v²⟩ / (2V) で、教科書の3次元
//  P = N m ⟨v²⟩/(3V) とは係数だけが違う（1/2 ↔ 1/3）。「壁が受ける力積を数える」という
//  導出そのものは完全に同じで、変わるのは ⟨vx²⟩ を ⟨v²⟩ に直すときの次元の数だけ。
//  ★world.depth（既定 0.05m＝5px）は GasChamber が体積に使っている実在の奥行きだが、
//    分子の直径より薄いので、奥行き方向の運動までは持たせていない。3次元にして 1/3 を
//    出したいなら z 座標ごと持たせる必要がある（この厚みでは物理的に苦しい）。
//
//  ── 速さのスケール（★UI に出さない。波長の LAMBDA_SIM_K と同じ扱い）──────────
//  実物の窒素は 20℃ で v_rms = 417 m/s = 41,700 px/s。1 tick(1/60秒) で 695px 動く＝
//  画面を横断してしまい、軌跡が見えない。そこで画面の中でだけ 1/MOL_SPEED_K に遅くする。
//  温度・圧力・状態方程式はすべて「実物の速さ」に戻してから計算するので、表示される数値は
//  本物であり比も絶対値も狂わない。遅いのは見かけの速さだけ。
const MOL_KB      = 1.380649e-23;    // [J/K]   ボルツマン定数
const MOL_NA      = 6.02214076e23;   // [1/mol] アボガドロ定数
const MOL_MASS    = 4.65e-26;        // [kg]    分子1個の質量（窒素 N₂・分子量 28）
const MOL_DOF     = 2;               //         画面の中の自由度（2次元）
const MOL_SPEED_K = 37;              //         速さの表示倍率。実物 = 画面 × これ
// ★画面の点1つが代表する分子の数。この値だけは「教材として見えるか」で決めてある。
//   240×300px の箱に 160 個置くと約 900Pa（0.009気圧）になり、同じ幅の木の蓋
//   （240×24px ≒ 17kg・重さ 169N）が受ける力 108N と同じ桁に収まる＝蓋が浮いて
//   釣り合うところが見える。1気圧まで上げてはいけない：この世界に外気は無いので
//   外から押し返すものが無く、蓋は必ず吹き飛ぶ（gas.js の「大気圧は可動境界にしか
//   効かない」の注を参照）。要するにこれは希薄な気体である。
const MOL_PER_DOT = 5e20;
// 力積に使う「点1つの実効質量」[kg]。J_sim[kg·px/s] = 2·m·|vn_sim| に畳んである。
//   ★MOL_SPEED_K が2乗で入るのが要点で、1乗にすると力が 1/37 になる（実測：壁が受ける
//     圧力が 899Pa のはずのところ 11.9Pa しか出なかった）。理由は、遅くしたことで
//     「1発の運動量」と「1秒あたりの発数」の両方が減っているから：
//       ・1発の運動量  Δp = 2·w·m·|vn_real| = 2·w·m·|vn_sim|·PX2M·K   … K が1つ
//       ・衝突の頻度   実物は箱を K 倍速く往復する＝画面の K 倍の回数ぶつかる … K がもう1つ
//     力は「運動量 × 頻度」なので K²。最後に [kg·m/s]→[kg·px/s] の ×M2PX が入り、
//     PX2M·M2PX = 1 で消えて、残るのが下の式。
const MOL_DOT_MASS = MOL_PER_DOT * MOL_MASS * MOL_SPEED_K * MOL_SPEED_K;

// 画面の速さ [px/s] → 実際の分子の速さ [m/s]
function molRealSpeed(vpx) { return vpx * PX2M * MOL_SPEED_K; }
// 実際の速さ [m/s] → 画面の速さ [px/s]
function molSimSpeed(vms) { return vms * M2PX / MOL_SPEED_K; }
// 温度 [K] のときの1方向の速さの標準偏差 σ = √(kT/m)（画面の単位 [px/s]）
function molSigma(T) { return molSimSpeed(Math.sqrt(MOL_KB * Math.max(0, T) / MOL_MASS)); }
// 正規乱数（Box-Muller）。マクスウェル分布＝各成分が独立な正規分布、そのもの
function molGauss() {
  let u = 0;
  while (u <= 1e-12) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
// 分子1個にその温度らしい速度を与える（Particle の生成時に呼ぶ）
function molSeedVelocity(p, T) {
  const s = molSigma(T === undefined ? p.T : T);
  p.vx = molGauss() * s;
  p.vy = molGauss() * s;
}

// ── ★このモデルはエネルギーを保存する（動く物体・回る物体が相手でも）──────────
//   1衝突ずつ計上して確かめてある（板への衝突 281,043回・壁への衝突 66,848回・
//   くさび 340回、いずれも ΔE = 0.000%）。箱に分子を入れて板を1枚浮かべた最小の系では、
//   分子の数（300／600／1200／2400）・出だしの偏り・板の回転の自由・壁との接触の有無を
//   どう組んでも、tick1 の温度正規化を除いた E/E0 は 1.0000 で動かない。
//   ☆唯一の例外は「板が溝とぴったり同じ高さで挟まっていて、反発係数が 1」のとき。
//     これは分子側ではなく接触ソルバの問題で、経緯と実測は js/physics/step.js の
//     反発パスの☆に置いてある。すきまが 0.5px でもあれば起きない
//     （実測：0.0px で 1.3132、0.1px で 1.0434、0.5px 以上で 1.0000）。
const MolecularGas = {
  substeps: 4,        // ★v_rms は 20℃ で 1,127px/s＝1tick に 19px。分子の半径（0.5px）より
                      //   ずっと大きいので、薄い壁をすり抜けないよう刻む。4 で 4.7px/サブステップ
  // ── 分子どうしの衝突半径 [px] ────────────────────────────────────
  //   ★これは「あってもなくてもよい飾り」ではない。無いと気体は永久に等方にならない。
  //     実測：静的な箱に置いた 160 分子は、運動エネルギーは 900tick 完全に保存する一方、
  //     ⟨vx²⟩/⟨vy²⟩ が 0.86 → 1.36 まで漂ったところで凍りついた（軸に平行な壁の反射は
  //     vx と vy を独立に保つので、混ぜる機構がどこにも無い）。この状態では床が受ける
  //     圧力と横壁が受ける圧力が 36% も食い違い、nRT/V とも合わない。
  //   ★大きさの決め方：大きいほど速く等方になるが、排除体積のぶん理想気体からずれる。
  //     1.5px なら占有率 1.6%（理想気体からのずれ ≒ 3%）で、平均自由行程 53px＝
  //     240px の箱を1回横切るあいだに 4.5 回ぶつかる。混ざるには十分すぎる。
  //     描画の 3px より小さいのは意図的（molecule.js 冒頭の「大きさは無視する」と同じ話）。
  collR: 1.5,
  tau: 0.15,          // [s] 物体へ返す力のなまし時定数。★衝突は離散的な力積の列（蓋には
                      //   毎tick 5発ほどしか当たらない）なので、生のまま叩き込むと蓋が
                      //   ばたつく。0.15s ＝ 9tick ぶん均すと揺らぎが 1/3 になる
  _stat: { n: 0, T: ROOM_K, vrms: 0 },

  // ── 集団の温度 [K]（★これが定義そのもの：⟨½mv²⟩ = (f/2)kT）──────────
  kineticT(mols) {
    if (!mols.length) return 0;
    let s2 = 0;
    for (const p of mols) {
      const v = molRealSpeed(Math.sqrt(p.vx * p.vx + p.vy * p.vy));
      s2 += v * v;
    }
    return MOL_MASS * (s2 / mols.length) / (MOL_DOF * MOL_KB);
  },

  update(mols, dt) {
    if (!mols.length || !(dt > 0)) return;
    // ── ① 外から入った熱を速さに直す ───────────────────────────────
    //   加熱・冷却の領域（heat-field.js）は p.T を書き換える。分子にとって温度は速さ
    //   そのものなので、書き換えられたぶんだけ全員を √(T'/T) 倍する＝熱が運動エネルギーに
    //   化ける。前の tick の最後に p.T ← 運動温度 を書き戻してあるので、差が出ていたら
    //   それは外から誰かが入れた熱だけである。
    let Tk = this.kineticT(mols);
    let Tset = 0;
    for (const p of mols) Tset += p.T;
    Tset /= mols.length;
    if (Tk > 1e-9) {
      if (Math.abs(Tset - Tk) > 1e-9 && Tset > 0) {
        const k = Math.sqrt(Tset / Tk);
        for (const p of mols) { p.vx *= k; p.vy *= k; }
        Tk = Tset;
      }
    } else if (Tset > 0) {
      for (const p of mols) molSeedVelocity(p, Tset);   // 速度ゼロで読み込まれた古いシーン
      Tk = this.kineticT(mols);
    }
    // ── ② 飛ばす → ぶつける ──────────────────────────────────────
    //   ★重力は掛けない。実物の分子の尺度高さ kT/mg は 20℃ の窒素で 8.9km あり、
    //     3m の箱では上下の密度差が 0.03% にしかならない。分子運動論で重力を無視するのは
    //     近似ではなく、この桁の差そのものである。
    const sub = dt / this.substeps;
    for (let s = 0; s < this.substeps; s++) {
      for (const p of mols) {
        p.px = p.x; p.py = p.y;
        p.x += p.vx * sub;
        p.y += p.vy * sub;
        this._hitNx = 0; this._hitNy = 0; this._wedged = false;
        this._collideGround(p);
        for (const b of objects) {
          if (b.layers === 0) continue;          // ★ゴーストだけ透過（SPH と同じ扱い）
          const a = b._aabb;
          const sMinX = Math.min(p.px, p.x), sMaxX = Math.max(p.px, p.x);
          const sMinY = Math.min(p.py, p.y), sMaxY = Math.max(p.py, p.y);
          const m = p.radius + len(b.x - (b._prevX !== undefined ? b._prevX : b.x),
                                   b.y - (b._prevY !== undefined ? b._prevY : b.y));
          if (sMaxX < a.minX - m || sMinX > a.maxX + m ||
              sMaxY < a.minY - m || sMinY > a.maxY + m) continue;
          this._bounceBody(p, b);
          this._rescueInside(p, b);
        }
      }
      this._pairCollide(mols);
    }
    // ── ③ 温度を書き戻す（温度グラフ・温度による着色がこれを読む）────────────
    this._stat.n = mols.length;
    this._stat.T = Tk = this.kineticT(mols);
    this._stat.vrms = Math.sqrt(MOL_DOF * MOL_KB * Tk / MOL_MASS);   // [m/s] 実際の分子の速さ
    for (const p of mols) p.T = Tk;
    // ── ④ 積んだ力積を、なました力にして物体へ渡す ─────────────────
    this._finish(dt);
  },

  // ── 物体の中に取り残された分子を救い出す ──────────────────────────
  //   ★SPH の押し出しは「掃引の始点が既に材料の中なら対象外」として何もしない
  //     （particles.js:689）。水では、物体が水を追い越すのは一瞬なので問題にならない。
  //     ところが動く蓋に追い越された分子は蓋の中に取り残され、内部を漂って反対側へ抜ける。
  //   押し出しのあとまだ内部にいる分子だけを最寄りの面へ出し、外向きに跳ね返す。
  //   ☆ここは隙間のある蓋のための保険で、追い越しそのものは particles.js の
  //     _collideBodyPoly が受け持つ（「掃引の始点が既に材料の中」＝追い越された、
  //     の分岐で物体の進む先へ返す）。実測でも、隙間 0 の仕切りでこの救出は
  //     1回も発火しなかった一方、_collideBodyPoly は 1800tick に 188 回
  //     仕切りをまたがせていた（＝漏れの出どころはあちら）。
  //   ★効き目は漏れだけではない（実測・自由に動く蓋600分子・片側0.5pxの隙間）：
  //       救出あり  漏れ 26/600・蓋の揺れ ±11px
  //       救出なし  漏れ 34/600・蓋の揺れ ±37px
  //     隙間が 0 のときは一度も発火せず、結果は1桁まで完全に同じだった。
  //     入れてある理由は漏れではなく、ピストンの揺れが 1/3 になることのほう。
  //   ★この救出ぶんは壁の力積に積まない。追い越されて生じた見かけの侵入であって、
  //     分子が壁を叩いた運動量ではないため（積むと圧力が上振れする）。
  _rescueInside(p, b) {
    if (b.type === 'circle') {
      const dx = p.x - b.x, dy = p.y - b.y;
      const d = len(dx, dy), minD = b.radius + p.radius;
      if (d >= minD) return;
      const nx = d > 1e-9 ? dx/d : 0, ny = d > 1e-9 ? dy/d : 1;
      p.x = b.x + nx*minD; p.y = b.y + ny*minD;
      const vn = p.vx*nx + p.vy*ny;
      if (vn < 0) { p.vx -= 2*vn*nx; p.vy -= 2*vn*ny; }
      return;
    }
    const outline = b._localOutline();
    if (!outline || outline.length < 3) return;
    const holes = (b.type === 'polygon' && b.holes) ? b.holes.filter(h => h.length >= 3) : [];
    const c1 = Math.cos(-b.angle), s1 = Math.sin(-b.angle);
    const ux = p.x - b.x, uy = p.y - b.y;
    const lp = { x: c1*ux - s1*uy, y: s1*ux + c1*uy };
    if (!SPH._inMaterial(lp, outline, holes)) return;
    const np = SPH._pushOutLocal(lp, outline, holes, p.radius);
    const c2 = Math.cos(b.angle), s2 = Math.sin(b.angle);
    const nxw = b.x + np.x*c2 - np.y*s2, nyw = b.y + np.x*s2 + np.y*c2;
    const dx = nxw - p.x, dy = nyw - p.y;
    const l = len(dx, dy);
    p.x = nxw; p.y = nyw;
    if (l < 1e-9) return;
    const nx = dx/l, ny = dy/l;
    const vn = (p.vx - b.vx)*nx + (p.vy - b.vy)*ny;
    if (vn < 0) { p.vx -= 2*vn*nx; p.vy -= 2*vn*ny; }
  },

  // ── 分子どうしの完全弾性衝突 ────────────────────────────────────
  //   同じ質量の弾性衝突は「法線方向の速度成分を交換する」だけ。運動量も
  //   運動エネルギーも式の上で厳密に保存する（近似も減衰も入らない）。
  //   ★近傍探索は SPH と同じ計数ソートの表だが、独立に持つ。SPH._buildGrid は
  //     セルの一辺が SPH.h（26px）に固定で、こちらが要るのは 3px。借りると
  //     水のホットパスに手を入れることになるので、短い表をこちらで抱える。
  _g: { cell:new Int32Array(0), order:new Int32Array(0), slots:new Int32Array(0),
        start:new Int32Array(0), count:new Int32Array(0),
        keyX:new Int32Array(0), keyY:new Int32Array(0), stamp:new Int32Array(0),
        mask:0, gen:0, used:0 },
  _pairCollide(mols) {
    const n = mols.length, h = this.collR * 2;      // セルの一辺＝衝突直径
    if (n < 2) return;
    const g = this._g;
    if (g.cell.length < n) {
      const cap = Math.max(256, n * 2);
      g.cell = new Int32Array(cap); g.order = new Int32Array(cap); g.slots = new Int32Array(cap);
    }
    let size = 64;
    while (size < n * 2) size <<= 1;                // 表は半分までしか埋まらない＝探索は必ず終わる
    if (g.mask !== size - 1) {
      g.mask = size - 1;
      g.start = new Int32Array(size); g.count = new Int32Array(size);
      g.keyX  = new Int32Array(size); g.keyY  = new Int32Array(size);
      g.stamp = new Int32Array(size); g.gen = 0;
    }
    const gen = ++g.gen, mask = g.mask;
    let used = 0;
    for (let i = 0; i < n; i++) {
      const p = mols[i];
      const cx = Math.floor(p.x/h), cy = Math.floor(p.y/h);
      let s = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & mask;
      for (;;) {
        if (g.stamp[s] !== gen) { g.stamp[s] = gen; g.keyX[s] = cx; g.keyY[s] = cy; g.count[s] = 0; g.slots[used++] = s; break; }
        if (g.keyX[s] === cx && g.keyY[s] === cy) break;
        s = (s + 1) & mask;
      }
      g.cell[i] = s; g.count[s]++;
    }
    let acc = 0;
    for (let k = 0; k < used; k++) { const s = g.slots[k]; g.start[s] = acc; acc += g.count[s]; g.count[s] = 0; }
    for (let i = 0; i < n; i++) { const s = g.cell[i]; g.order[g.start[s] + g.count[s]++] = i; }
    // 半ステンシル（SPH の粘性と同じ理屈：ペアをちょうど一度ずつ訪れる）
    const d = this.collR * 2, d2 = d * d;
    const slot = (cx, cy) => {
      let s = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & mask;
      for (;;) {
        if (g.stamp[s] !== gen) return -1;
        if (g.keyX[s] === cx && g.keyY[s] === cy) return s;
        s = (s + 1) & mask;
      }
    };
    for (let i = 0; i < n; i++) {
      const pi = mols[i];
      const cx = Math.floor(pi.x/h), cy = Math.floor(pi.y/h);
      for (let c = 0; c < 5; c++) {
        const s = slot(cx + SPH_HALF_DX[c], cy + SPH_HALF_DY[c]);
        if (s < 0) continue;
        const b = g.start[s], e = b + g.count[s];
        for (let k = b; k < e; k++) {
          const j = g.order[k];
          if (c === 0 && j <= i) continue;
          const pj = mols[j];
          const dx = pj.x - pi.x, dy = pj.y - pi.y;
          const r2 = dx*dx + dy*dy;
          if (r2 >= d2 || r2 < 1e-12) continue;
          const r = Math.sqrt(r2), nx = dx/r, ny = dy/r;
          const vn = (pj.vx - pi.vx)*nx + (pj.vy - pi.vy)*ny;
          if (vn >= 0) continue;                    // 離れる向き＝もう衝突は済んでいる
          pi.vx += vn*nx; pi.vy += vn*ny;           // 法線成分を交換（等質量の弾性衝突）
          pj.vx -= vn*nx; pj.vy -= vn*ny;
        }
      }
    }
  },

  // ── 地面との弾性衝突（地面は動かないので速度を反射するだけ）──────────
  _collideGround(p) {
    if (!world.terrain || ground.layers === 0) return;
    const nx = Math.sin(ground.angle), ny = -Math.cos(ground.angle);
    const d = signedDistToGround(p.x, p.y) - p.radius;
    if (d >= 0) return;
    p.x -= nx * d; p.y -= ny * d;
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) { p.vx -= 2 * vn * nx; p.vy -= 2 * vn * ny; }
  },

  // ── 物体との完全弾性衝突。押し出しは SPH の判定を借り、速度と力積だけ自前で出す ──
  //   ★押し出した向きをそのまま面の法線として使う。SPH の _collideBody* は「入ってきた面」へ
  //     戻す掃引つきの実装なので、薄い壁でも裏へ抜けない（particles.js:678 の注を参照）。
  _bounceBody(p, b) {
    const bx0 = p.x, by0 = p.y;
    SPH._hitNormX = SPH._hitNormY = 0;
    if (b.type === 'circle') SPH._collideBodyCircle(p, b);
    else                    SPH._collideBodyPoly(p, b);
    const dx = p.x - bx0, dy = p.y - by0;
    if (dx === 0 && dy === 0) return;                 // 当たっていない
    // ★法線は「押し出した向き」ではなく、押し出した先の**面の法線**を使う
    //   （SPH._collideBody* が _hitNormX/Y に控える。particles.js の★に経緯）。
    //   掃引で戻した場合、変位は面に対して斜めなので、そのまま法線に使うと
    //   なめらかな円にもトルクが立ち、気体のエネルギーが粒の回転へ流れ続ける。
    const l = len(dx, dy) || 1e-9;
    let nx = SPH._hitNormX, ny = SPH._hitNormY;
    if (nx === 0 && ny === 0) { nx = dx / l; ny = dy / l; }   // 念のための保険
    // 壁の表面速度（並進＋回転）。★これを引くから、動く壁は分子を加速できる＝
    //   ピストンで押し縮めると気体が温まる（断熱圧縮）。止まった壁では何も変わらない。
    // ★掴んで動かしているピストンは held＋速度つきで来る（updateHeldVelocities）ので
    //   b.vx をそのまま使えばよい。静的な物体を座標だけ書き換えて動かした場合は
    //   仕事をしない＝断熱圧縮にならないが、それは UI に無い操作なので合わせていない。
    // ★接触点も「押し出したあと」で取る（面の上の点）。押し出す前の点は物体の内側に
    //   あるので、そこを腕の長さにするとトルクが実際とずれる。円ではこの2つを揃えると
    //   腕が法線と平行になり、トルクが厳密に 0 になる＝上の★の回転が消える。
    const rx = (p.x - nx * p.radius) - b.x;
    const ry = (p.y - ny * p.radius) - b.y;
    const sx = b.vx - b.av * ry;
    const sy = b.vy + b.av * rx;
    const vn = (p.vx - sx) * nx + (p.vy - sy) * ny;
    if (vn >= 0) return;                              // もう離れる向き
    // ── 2体の完全弾性衝突 ──────────────────────────────────────────
    //   ★「壁の系で法線成分を反転」＋「壁に 2mv の力積」では、壁を無限質量として
    //     跳ね返しておきながら有限の力積を渡すことになり、エネルギーが合わない。
    //     質量比は分子1個 0.032kg 対 蓋 41kg で 1:1300、1回あたり 0.15% の食い違いだが、
    //     毎秒何百回も当たるので効いてくる（実測：60秒で気体が 20→−6℃ まで冷えた）。
    //   ちゃんと2体で解く。静的な壁（invMass=0）ではこの式が上の反射に厳密に一致する。
    const movable = !b.isStatic && !b.held && b.invMass > 0 && !b.sleeping;
    const rn = movable && !b.fixedRotation ? (rx * ny - ry * nx) : 0;
    const kB = movable ? b.invMass + rn * rn * b.invInertia : 0;
    const invM = 1 / MOL_DOT_MASS;
    const j = -2 * vn / (invM + kB);                  // >0。法線方向の力積の大きさ
    p.vx += j * invM * nx; p.vy += j * invM * ny;
    const jx = -j * nx, jy = -j * ny;                 // 壁が受ける力積（気体が押す向き）
    // ── 反作用はその場で渡す（★SPH と正反対にしてある）───────────────────
    //   SPH は力積を溜めて「なました力」として次のサブステップで掛ける（器のばたつきを
    //   止めるため）。分子でそれをやると、遅れた力が速度と位相をずらして仕事をしてしまう。
    //   実測（自由ピストン・60秒）：なまし 0.15s で気体が 20→244℃ へ勝手に温まり、
    //   0.05s 以下では逆に 20→−70℃ まで冷えた。どちらも「壁は弾性衝突するだけ」という
    //   前提を壊している。衝突した瞬間に渡せば運動量も運動エネルギーも式のまま保存する。
    // ★下の「くさび」でも必ず渡す（＝この行より前に置く）。分子だけが2体衝突ぶんの
    //   力積を受け取って相手が受け取らない状態になると、運動量もエネルギーも保存しない。
    //   実測（箱の中に浮かべた 20×120px の板・600tick）：くさびはたった85回しか
    //   起きていないのに、そこだけで系の運動エネルギーの +13.3% を作っていた
    //   （板への衝突 281,043回・壁への衝突 66,848回はどちらも ΔE=0.000%）。
    //   板は勝手に回り出し（av=−3.3rad/s）、気体は 293→379K まで温まる。
    //   壁が静的なうちは反作用の行き先が無いので、この取りこぼしは表に出なかった。
    if (movable) {
      b.vx += jx * b.invMass;
      b.vy += jy * b.invMass;
      if (!b.fixedRotation) b.av += rn * (-j) * b.invInertia;
    }
    // ── くさびの検出 ────────────────────────────────────────────
    //   ★同じサブステップで向かい合う2面から押されたら、分子は隙間に挟まっている。
    //     挟まった分子は毎サブステップ両側から蹴られ続け、その力積が全部「壁が受けた
    //     力積」に積まれる。実測では、器と1px の隙間しかないピストンでこれが起き、
    //     圧力が 674Pa のはずのところ 4,769Pa（7倍）に化けていた。
    //     速度の反射も反作用もそのまま残して（そこは物理として正しい）、
    //     **圧力を読むための勘定からだけ**外す。
    if (this._hitNx * nx + this._hitNy * ny < 0) this._wedged = true;
    this._hitNx = nx; this._hitNy = ny;
    if (this._wedged) return;
    // 勘定。分子が得た運動量の逆を壁が受ける（vn<0 なので向きは −n＝気体が押す向き）
    // ★静的な壁でも積む。動かせないだけで力積は受けており、それが「壁が受ける圧力」＝
    //   このモデルで見せたい量そのものだからである（力として掛けるのは _finish で除く）。
    const c = b._mol || (b._mol = { jx:0, jy:0, tz:0, fx:0, fy:0, tz_:0,
                                    jf: [0,0,0,0], ff: [0,0,0,0] });
    c.jx += jx; c.jy += jy;
    c.tz += rx * jy - ry * jx;
    // ── 力積を「面ごと」に積む ────────────────────────────────────
    //   ★大きさをひとまとめに足してはいけない。1つの物体は複数の面で気体に接している
    //     （蓋なら下面が気体、上面は外）ので、合計を受圧面積で割ると別々の面の力積が
    //     混ざる。実測：釣り合っているはずの蓋（重さ405N）で P·A が 739N と出ていた。
    //   物体のローカル系へ法線を戻してから ±x / ±y の4つに振り分ける。回転しても
    //   「同じ面」を指し続ける＝傾いた容器でも面ごとの圧力が読める。
    const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
    const lnx =  ca * nx + sa * ny;                   // ローカル法線（-angle の回転）
    const lny = -sa * nx + ca * ny;
    const bin = Math.abs(lnx) > Math.abs(lny) ? (lnx > 0 ? 0 : 1) : (lny > 0 ? 2 : 3);
    c.jf[bin] += j;                                   // その面が受けた力積の大きさ
  },

  // 物体のローカル座標での差し渡し [px]（面の受圧面積を出すのに使う）
  _localExtent(b) {
    if (b.type === 'circle') return { w: b.radius * 2, h: b.radius * 2 };
    const o = b._localOutline();
    if (!o || !o.length) return { w: 0, h: 0 };
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const q of o) {
      if (q.x < mnx) mnx = q.x;
      if (q.x > mxx) mxx = q.x;
      if (q.y < mny) mny = q.y;
      if (q.y > mxy) mxy = q.y;
    }
    return { w: mxx - mnx, h: mxy - mny };
  },

  // ── 力積 → なました力（★上限は掛けない）──────────────────────────
  //   SPH の連成には coupleMaxG=1（自重の1倍まで）という頭打ちがあるが、こちらには置かない。
  //   気体の圧力は「蓋の重さ」とは何の関係も無い量で、そこで切ると圧縮に抗えなくなる＝
  //   このモデルを作った理由そのものが消える。
  _finish(dt) {
    const invDt = 1 / dt;
    const a = this.tau > 0 ? Math.min(1, dt / this.tau) : 1;
    for (const b of objects) {
      const c = b._mol;
      if (!c) continue;
      c.fx  += (c.jx * invDt - c.fx)  * a;
      c.fy  += (c.jy * invDt - c.fy)  * a;
      c.tz_ += (c.tz * invDt - c.tz_) * a;
      for (let i = 0; i < 4; i++) { c.ff[i] += (c.jf[i] * invDt - c.ff[i]) * a; c.jf[i] = 0; }
      c.jx = 0; c.jy = 0; c.tz = 0;
      const f = len(c.fx, c.fy);
      // ── 面ごとの圧力 [Pa]＝その面が受けた力 ÷ その面の面積 ──────────────
      //   ±x の面の面積はローカルの高さ×奥行き、±y の面は幅×奥行き。
      //   ★面積は物体の差し渡しをそのまま使う＝「その面は全部が気体に接している」前提。
      //     蓋・ピストンのように気体と同じ幅のものでは厳密（実測：重さ406.7N の蓋に対して
      //     下面の圧力×面積が 398.8N＝−2%）。一方、器の壁のように気体に面していない
      //     部分まで持つ物体では、そのぶん面積を多く見積もって圧力が低く出る
      //     （実測：内寸240pxの箱を幅300pxの床板で作ると 3,373Pa が 2,276Pa＝−32%）。
      //     ★当たった点から濡れ幅を推定する方法も試したが、こちらは筋が悪い。当たりは
      //       飛び飛びなので端まで届かず、幅を短く見積もって逆に +24% 過大になった。
      //       受圧面積は幾何の量であって、衝突の統計から起こすものではない。
      //     圧力を正確に読みたい壁は、気体に接する幅ちょうどに作ること。
      const ex = this._localExtent(b), D = world.depth;
      const areas = [ex.h * PX2M * D, ex.h * PX2M * D, ex.w * PX2M * D, ex.w * PX2M * D];
      let pmax = 0;
      b._molPf = b._molPf || [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        b._molPf[i] = areas[i] > 1e-12 ? (c.ff[i] / PPM) / areas[i] : 0;
        if (b._molPf[i] > pmax) pmax = b._molPf[i];
      }
      b._molP = pmax;
      b._molF = f / PPM;                                // 気体から受ける合力 [N]
      // ★静的な壁でも、なました力はゼロに潰さない。潰すと1次遅れの状態が毎tick壊れて
      //   瞬時値の 1/9 しか残らず、上の圧力表示が桁で狂う（実測：675Pa が 198Pa に見えた）。
      //   力として掛からないことは applyMolPressure 側が保証している。
      if (b.isStatic) continue;
      if (f > b.mass * len(gravPxX(), gravPxY()) * 0.05) {
        b.sleeping = false; b.sleepTimer = 0;         // 気体に押されたら起きる
      }
    }
  },
};

// ── 分子気体を1tick 進める（step.js がサブステップ列の前で呼ぶ）──────────────
//   ★粒子の振り分けをここに置いてあるのは、SPH 側（step.js の後半）と呼ぶ位置が
//     違うため。分子は「速度 → 位置」の順を守るために前で回す必要がある。
const _molBuf = [];
function stepMolecularGas(dt) {
  _molBuf.length = 0;
  for (const p of particles) if (p.prm.kinetic) _molBuf.push(p);
  if (_molBuf.length > 0) { MolecularGas.update(_molBuf, dt); return; }
  for (const b of objects) if (b._mol) { b._mol = null; b._molP = 0; b._molF = 0; }
}

// ── なました圧力を物体へ掛ける（step.js がサブステップごとに呼ぶ）──────────
//   applySphCoupling と同じ理由で「力」として掛ける。tick の最後に力積で叩き込むと
//   接触ソルバを通らないまま位置に化けて、床に載った器が浮き上がる。
//   ★力そのものは _bounceBody が衝突の瞬間に渡している。ここに残っているのは
//     「力ベクトルの表示」だけ（矢印表示は tick 単位の量を欲しがるため）。
function applyMolPressure(dt) {
  for (const b of objects) {
    const c = b._mol;
    if (!c || b.isStatic || b.held || b.invMass === 0 || b.sleeping) continue;
    if (!c.fx && !c.fy) continue;
    b.recordForce('gas', c.fx * dt, c.fy * dt, b.x, b.y, 'molecule');
  }
}

// ── 気体分子の状態（パネル・検証用）────────────────────────────────
//   n は物質量 [mol]。V を渡せば圧力の理論値 P = N m ⟨vx²⟩ / V も返す。
function molGasStats(volumeM3) {
  const s = MolecularGas._stat;
  const out = {
    n: s.n,                                   // 画面上の点の数
    T: s.T,                                   // [K]
    vrms: s.vrms,                             // [m/s] 実際の分子の速さ
    mol: s.n * MOL_PER_DOT / MOL_NA,          // [mol]
  };
  if (volumeM3 > 0) out.P = out.mol * R_GAS * s.T / volumeM3;   // [Pa] PV = nRT
  return out;
}
