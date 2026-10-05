// ═══ スリンキー：質点がばねでつながった実体のある索 ═══════════════════════
//
// ★これは「波動方程式を解く表示装置」ではなく「物体」である（かつて別にあった弦ツールとの違い）。
//   弦を廃してばねへ一本化したのは、弦だけが他のどの物とも相互作用しない部品だったため。
//   ・節点が質量を持ち、重力で垂れ、他の物体とぶつかり、巻き付く
//   ・軸方向にも伸び縮みするので、振れば横波、押し引きすれば縦波（疎密波）が出る
//   ・張力は入力する数値ではなく、伸びた結果として出てくる（実測して表示する）
//
// ★積分は速度Verlet（シンプレクティック）。位置投影ではない。
//   位置投影型の拘束（ropeLinkConstraint）は反復のたびにエネルギーを落とすので、
//   定在波が数秒で消える。実ばね＋速度Verletなら 100 周期回してもエネルギー変化は
//   -0.0000%、腹と節がそのまま残ることを検証済み。
//
// ★縦波速度は √(EA/μ) ではない。伸びた鎖では節点間隔が自然長ではなく伸びた長さに
//   なるので v縦 = √(k·a/μ_s)（a＝伸びた間隔）。ここを間違えるとサブステップ数の
//   見積もりが甘くなって不安定側に倒れる。
//
// 単位について：節点の座標は px（物体・接触と揃えるため）、材料定数は SI。
//   ばね力から加速度を出すとき px→m と m→px の換算がちょうど打ち消し合うので、
//   a[px/s²] = k[N/m] × 伸び[px] / m[kg] と書ける（_accel 参照）。

const SLINKY_MAX_SUBSTEPS = 400;   // 1ワールドサブステップで回す上限（極端な設定でも固まらないように）
const SLINKY_CFL          = 0.5;   // 安定限界に対する安全率。1.0 でも発散はしないが接触で張力が変動する
const SLINKY_SLOP      = 0.4;   // [px] 許容するめり込み。詰め切ると接触点で細かく振動する
const SLINKY_BAUMGARTE = 0.25;  // 1サブステップあたりの位置補正の割合
const SLINKY_SEG_MIN      = 4;
const SLINKY_SEG_MAX      = 200;

// [m] 自然長の下限（1px）。★demoSpring（js/app/demo-kit.js）も同じ値で切り上げてから剛性を作る
const SLINKY_REST_MIN = 0.01;
class Slinky {
  constructor(opts) {
    opts = opts || {};
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    // 材料定数（ここが「設定」。張力は結果なので持たない）
    // ★下限は 0。「ばね定数 0 のばね」＝ダンパー（ダッシュポット）で、速度に比例する力だけを
    //   返す部品になる。質量・ばね・ダンパーは力学の最小部品3つなので、専用のツールを足さず
    //   同じ部品のつまみを端まで回して出す（ばね定数のつまみの左端が 0）。
    this.stiffEA    = opts.stiffEA    !== undefined ? Math.max(0, opts.stiffEA)       : 20;    // [N] 伸び剛性
    this.linDensity = opts.linDensity !== undefined ? Math.max(1e-4, opts.linDensity) : 0.2;   // [kg/m] 自然長あたり
    this.damp       = opts.damp       !== undefined ? Math.max(0, opts.damp)          : 2.0;   // [1/s]（相対運動に効く内部減衰）
    // ★曲げにくさ。軸のばね定数に対する比で持つ（無次元）。
    //   0 にすると曲げに一切逆らわない＝圧縮した瞬間に座屈して折り畳まれる。
    //   大きいほど「形を保つばね」に、小さいほど「ふにゃふにゃの紐」に近づく。
    this.bendRatio  = opts.bendRatio  !== undefined ? Math.max(0, opts.bendRatio)     : 1.0;
    // ★理想ばね化：質量を無視した、ただの力の法則として扱う（＝教科書のばね）。
    //   物理的には同じ物の m→0 の極限。質量ゼロを陽解法で積分することは原理的にできない
    //   （dt < √(m/k) → 0）ので、節点を積分するのをやめて両端の間を1本の拘束として解く。
    //   理想レンズが球面を解くのをやめて薄肉レンズの変換1回にするのと同じ関係。
    //   ★既定はこちら（教科書のばね）。ばねを置く目的のほとんどは単振動・つり合いで、
    //     そこでは T = 2π√(m/k) が厳密に出るこちらが期待どおりに動く。波を伝えたいとき
    //     （＝実体のスリンキーが要るとき）だけ、プロパティでチェックを外す。
    this.idealSpring = opts.idealSpring !== undefined ? !!opts.idealSpring : true;
    // 理想ばねの減衰（内部減衰は節点が無いので使えない）。★減衰比 ζ ではなく
    //   減衰係数 c [N·s/m] を実体にする。理由は2つ：
    //   ・ζ = c/(2√(km)) は相手の質量を含むので、ばね定数 0（＝ダンパー）では定義できない。
    //     つまみを 0 まで回した瞬間に意味を失う量を、設定の実体にはできない。
    //   ・ζ 固定は「重い物をつなぐと c が勝手に増える」＝実物のダッシュポットではない。
    //     c 固定なら、同じ部品を何につないでも同じ力を返す（ζ はパネルに導出表示する）。
    //   既定 3.5：ばねツールの既定 k=300 N/m に 1kg を吊るすと ζ=0.1 になる値＝これまでの
    //   既定（ζ=0.1 固定）と、いちばん多い「1kg 級のおもり」で同じ手応えになる。
    this.dampC      = opts.dampC      !== undefined ? Math.max(0, opts.dampC)         : 3.5;   // [N·s/m]
    // [px] 太さの半分（＝コイルの振れ幅。理想ばねでは当たり判定を持たないので見た目だけに効く）
    this.radius     = opts.radius     !== undefined ? Math.max(1, opts.radius)        : 16;
    this.restM      = opts.restM      !== undefined ? Math.max(SLINKY_REST_MIN, opts.restM) : 1.5;   // [m] 索全体の自然長
    this.nodeDensity= opts.nodeDensity!== undefined ? Math.max(2, opts.nodeDensity)   : 20;    // [個/m]（自然長あたり）
    this.color      = opts.color || '#ffd54f';   // ★ばねは黄色（ジョイントのばねと同じ色に揃えた）
    // ★運動方向固定（レール）。物体の guideEnabled とまったく同じ拘束を、ばね全体に効かせる。
    //   物体が「重心を通る1本のレールに通したビーズ」なら、こちらは「同じ1本のレールに
    //   節点を全部通したビーズの列」＝エアトラックに並べた台車の列そのもの。縦波（疎密波）の
    //   教科書のモデルがまさにこれで、媒質が横へ逃げられないことが前提になっている。
    //   ★これが無いと、縦波の装置は横波を勝手に生やす。押し引きで張力が周期的に変わる弦は
    //     横振動をパラメトリックに励起するため（メルデの実験と同じ機構）で、しかも横向きには
    //     減衰も波消しも無い（内部減衰は軸方向の相対運動にしか効かず、波消しは軸の上だけ、
    //     先端はレールに乗って動けない＝完全反射端）。入った横波は出ていく先が無く育ち続ける。
    //     実測（デモ「横波と縦波」の縦波側。節点の y のずれの最大）：
    //       レール無し … 500tick 2.9px ／ 2000tick 24.7px ／ 4000tick 61.7px（ばねの太さの6倍）
    //       レール有り … 4000tick まで厳密に 0（縦波の振れ幅・波長は変わらない）
    //     曲げにくさ β で抑えるのは駄目だった（0.02→65.8px・0.1→61.0px と効かず、
    //     0.5 まで上げると遅らせはするが横波側の装置が壊れる：y の RMS が 25→87px）。
    this.guideEnabled = !!opts.guideEnabled;
    this.guideAngle   = opts.guideAngle !== undefined ? opts.guideAngle : 0;
    this.guidePx = opts.guidePx; this.guidePy = opts.guidePy;   // レールが通る点 [px]
    // 端の扱い：'free'（自由端）／'pin'（その場に固定）／'body'（物体に取り付け）
    this.endA = opts.endA || 'pin';
    this.endB = opts.endB || 'pin';
    this.bodyA = opts.bodyA || null;  this.bodyB = opts.bodyB || null;
    this.anchorAx = opts.anchorAx || 0;  this.anchorAy = opts.anchorAy || 0;
    this.anchorBx = opts.anchorBx || 0;  this.anchorBy = opts.anchorBy || 0;
    // 表示
    this.showCoil   = opts.showCoil   !== undefined ? !!opts.showCoil   : true;
    this.showBeads  = opts.showBeads  !== undefined ? !!opts.showBeads  : false;
    this.showStrain = opts.showStrain !== undefined ? !!opts.showStrain : false;
    this.pinAx = opts.pinAx; this.pinAy = opts.pinAy;      // 'pin' のときの固定位置 [px]
    this.pinBx = opts.pinBx; this.pinBy = opts.pinBy;
    this._acc = 0;
    this._cts = [];                    // 接触キャッシュ（ワールドサブステップに1回作り直す）
    if (opts.nodes && opts.nodes.length >= 2) {
      this.nodes = opts.nodes.map(n => ({ x: n.x, y: n.y, vx: n.vx || 0, vy: n.vy || 0 }));
    } else {
      // ★座標の既定値に || を使わないこと。座標はちょうど 0 が正当な値なので、
      //   || だと bx: 0（＝ワールド原点に置いた端）が既定の 100px へ化けて、
      //   端Bだけ 1m 横から生えたばねになる。?? で「未指定のときだけ」既定へ落とす。
      this._build(opts.ax ?? 0, opts.ay ?? 0, opts.bx ?? 100, opts.by ?? 0);
    }
    this._sync();
    if (this.guideEnabled && !Number.isFinite(this.guidePx)) reanchorSlinkyGuide(this);
  }
  // ── レール（運動方向固定）へ射影する ───────────────────────
  //   節点を全部、同じ1本の直線の上へ戻し、直線に垂直な速度を捨てる。捨てたぶんがレールの
  //   拘束反力そのもの（物体側の projectGuideVelocity / applyGuideProjection と同じ扱い）。
  //   ★呼ぶ場所は内部サブステップの最後。ばね力・曲げ・重力・接触・端の掃き、どれが横へ
  //     押しても最後にここを通るので、1か所で全部を受けられる。
  //   ★停止中の追随（settleSlinkies）からは posOnly で呼ぶ。停止中の操作が決めるのは
  //     位置だけ、という向こうの約束を、レールが破らないようにする。
  _projectGuide(posOnly) {
    if (!this.guideEnabled) return;
    const dx = Math.cos(this.guideAngle), dy = Math.sin(this.guideAngle);
    const px = this.guidePx, py = this.guidePy;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    for (const n of this.nodes) {
      const t = (n.x - px)*dx + (n.y - py)*dy;
      n.x = px + t*dx;  n.y = py + t*dy;
      if (posOnly) continue;
      const vd = n.vx*dx + n.vy*dy;
      n.vx = vd*dx;     n.vy = vd*dy;
    }
  }
  // A→B の直線上に節点を並べる。索の自然長は restM、張った長さは A-B 間の距離。
  _build(ax, ay, bx, by) {
    const seg = this.targetSegs();
    this.nodes = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      this.nodes.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, vx: 0, vy: 0 });
    }
    if (this.pinAx === undefined) { this.pinAx = ax; this.pinAy = ay; }
    if (this.pinBx === undefined) { this.pinBx = bx; this.pinBy = by; }
  }
  targetSegs() {
    return Math.max(SLINKY_SEG_MIN, Math.min(SLINKY_SEG_MAX, Math.round(this.nodeDensity * this.restM)));
  }
  // 材料定数から、リンク1本ぶんの自然長・質量・ばね定数を出し直す
  _sync() {
    const seg = this.nodes.length - 1;
    this.restLen = toPx(this.restM) / seg;                    // [px] リンク1本の自然長
    const restLenM = this.restM / seg;                        // [m]
    this.m = this.linDensity * restLenM;                      // [kg] 節点質量
    this.k = this.stiffEA / restLenM;                         // [N/m] リンク1本のばね定数
    this.kb = this.bendRatio * this.k;                        // [N/m] 曲げの実効ばね定数
    // 安定限界。軸ばねは最短波長で ω=2√(k/m)、曲げは ω=4√(kb/m) なので
    //   ω²_max = 4k/m + 16kb/m → dt < 2/ω_max = 1/√((k+4kb)/m)
    //   ★k=0（ダンパー）では割り算が ∞ になる。復元力が無い＝刻みの制限も無いので、
    //     ワールドの刻みをそのまま使う値に落とす（∞ のままだと内部サブステップ数の
    //     計算 worldDt/∞ が 0 になり、Math.max(1,…) に救われてはいるが意図が読めない）。
    const w2 = (this.k + 4 * this.kb) / this.m;
    this.dtMax = w2 > 0 ? 1 / Math.sqrt(w2) : 1 / SIM_HZ;
  }
  // 節点密度・自然長を変えたら鎖そのものを張り直す（形は正規化座標で保つ）
  rebuild() {
    const want = this.targetSegs(), cur = this.nodes.length - 1;
    if (want !== cur) {
      const src = this.nodes, out = [];
      for (let i = 0; i <= want; i++) {
        const x = i * cur / want, j = Math.min(cur - 1, Math.floor(x)), f = x - j;
        out.push({ x: src[j].x + (src[j+1].x - src[j].x) * f,
                   y: src[j].y + (src[j+1].y - src[j].y) * f,
                   vx: src[j].vx + (src[j+1].vx - src[j].vx) * f,
                   vy: src[j].vy + (src[j+1].vy - src[j].vy) * f });
      }
      this.nodes = out;
    }
    this._sync();
  }
  lastIndex() { return this.nodes.length - 1; }
  // 端に取り付けた物体の、取り付け点のワールド座標
  _anchorWorld(which) {
    const b = which === 'A' ? this.bodyA : this.bodyB;
    if (!b) return null;
    const ax = which === 'A' ? this.anchorAx : this.anchorBx;
    const ay = which === 'A' ? this.anchorAy : this.anchorBy;
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    return { x: b.x + ax*c - ay*s, y: b.y + ax*s + ay*c };
  }
  // その端が動かせないか（固定＝invMass 0 として扱う）
  _held(which) {
    const mode = which === 'A' ? this.endA : this.endB;
    if (mode === 'pin') return true;
    if (mode === 'body') return !!(which === 'A' ? this.bodyA : this.bodyB);
    return false;
  }
  // ── ばね力・重力・減衰から加速度を作る ─────────────────────────
  //   戻り値は px/s²。物体に取り付けた端は、その物体の質量を背負って一緒に動く。
  _accel(ax, ay) {
    const N = this.nodes.length, nd = this.nodes, k = this.k, m = this.m, rl = this.restLen;
    const cd = this.damp;
    ax.fill(0); ay.fill(0);
    for (let i = 0; i < N - 1; i++) {
      const a = nd[i], b = nd[i+1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      // 索は縮んでも押し返さない…のではなく、ばねなので押し返す（スリンキーそのもの）。
      // 「たるんだ紐」にしたい場合は かたさEA を上げて自然長を伸ばせば同じことになる。
      const ux = dx / d, uy = dy / d;
      let acc = k * (d - rl) / m;            // [px/s²]（px↔m の換算が打ち消し合う）
      // ★減衰は「隣どうしの相対運動」に効かせる（＝ばねと並列のダッシュポット）。
      //   節点の絶対速度を削る形にすると、ゆっくりした定在波も高周波のばたつきも
      //   同じ率で削ってしまい、暴れを抑えようとすると定在波が数秒で消える。
      //   相対運動なら減衰率が波数の2乗に比例するので、最短波長のばたつきだけを
      //   狙って落とせる（節点40個なら基本モードとの比は約1:600）。
      //   剛体的な平行移動・回転にはまったく効かないのも正しい振る舞い。
      if (cd > 0) {
        const rv = (nd[i+1].vx - a.vx) * ux + (nd[i+1].vy - a.vy) * uy;
        acc += cd * rv;
      }
      ax[i]   += acc * ux;  ay[i]   += acc * uy;
      ax[i+1] -= acc * ux;  ay[i+1] -= acc * uy;
    }
    // ★曲げ剛性。これが無いと、質点＋軸ばねだけの鎖は圧縮された瞬間に最短波長で座屈し、
    //   ぐしゃぐしゃに折り畳まれる（＝ばねの形が保てない）。実物のばねもロープも曲げに
    //   抵抗するので、これは省略ではなく欠落だった。
    //   曲率ベクトル c_i = p_{i-1} − 2p_i + p_{i+1} のエネルギー (kb/2)|c|² から導く。
    //   力の総和がゼロなので運動量が保存し、エネルギーから導いているので速度Verlet の
    //   シンプレクティック性も壊れない（＝定在波はこれを入れても生き延びる）。
    const kb = this.kb;
    if (kb > 0) {
      for (let i = 1; i < N - 1; i++) {
        const cx = nd[i-1].x - 2*nd[i].x + nd[i+1].x;
        const cy = nd[i-1].y - 2*nd[i].y + nd[i+1].y;
        const bx = kb * cx / m, by = kb * cy / m;
        ax[i-1] -= bx;      ay[i-1] -= by;
        ax[i]   += 2 * bx;  ay[i]   += 2 * by;
        ax[i+1] -= bx;      ay[i+1] -= by;
      }
    }
    const last = N - 1;
    // ★物体に取り付けた端は「物体の質量を背負った節点」として、索と一緒に積分する。
    //   以前はここを運動学的に固定し（位置を毎サブステップ与え）、力だけ物体へ返していた。
    //   すると端の軌跡がワールドのサブステップ間隔（240Hz）の階段関数になり、索の最短波長
    //   モード（1000Hz 級）を叩き続ける。減衰0だと抜ける先が無く、10秒でエネルギーが
    //   数千倍に発散した。質量を背負わせれば規定運動が消え、連成そのものが正しくなる。
    //   ばね力だけを実効質量で割る（重力は物体側の積分がすでに入れている）。
    if (this._massA) { const r = m / this._massA; ax[0] *= r; ay[0] *= r; }
    if (this._massB) { const r = m / this._massB; ax[last] *= r; ay[last] *= r; }
    const gx = gravPxX(), gy = gravPxY();
    for (let i = 0; i < N; i++) {
      if ((i === 0 && this._massA) || (i === last && this._massB)) continue;   // 物体側で計上済み
      ax[i] += gx; ay[i] += gy;
    }
    // その場に固定した端は動かない（位置は goal 側が決める）
    if (this.endA === 'pin') { ax[0] = 0; ay[0] = 0; }
    if (this.endB === 'pin') { ax[last] = 0; ay[last] = 0; }
  }
  // ばね全体としてのばね定数 [N/m]。理想ばねモードではこれがそのまま「ばね定数 k」になる
  springK() { return this.stiffEA / this.restM; }
  // ★「ばね定数 0 ＝ ダンパー」はやめた。ダンパーという部品は物理の世界には無く、道具箱の
  //   中だけにある特別あつらえの部品だった。制動器が要るなら、通気にしたピストン容器
  //   （器・蓋・気体・ヒンジ）で組む＝上皿天秤と「横波と縦波」の波消しがその作り方。
  //   ばね定数のつまみも 0.5 N/m 止まりに戻してある（js/ui/slider.js）。
  // 理想ばねの両端。自由端は質量ゼロでは定義できない（慣性が無いので自然長へ瞬時に戻る）
  //   ので、その場に固定した端として扱う。
  _idealEnd(w) {
    const mode = w === 'A' ? this.endA : this.endB;
    if (mode === 'body') {
      const b = w === 'A' ? this.bodyA : this.bodyB;
      const p = this._anchorWorld(w);
      if (b && p) return { b, x: p.x, y: p.y };
    }
    return w === 'A' ? { b: null, x: this.pinAx, y: this.pinAy }
                     : { b: null, x: this.pinBx, y: this.pinBy };
  }
  // ── 実測量（表示用）─────────────────────────────────────
  measure() {
    const N = this.nodes.length, nd = this.nodes;
    let sumD = 0;
    for (let i = 0; i < N - 1; i++) sumD += Math.hypot(nd[i+1].x - nd[i].x, nd[i+1].y - nd[i].y);
    if (this.idealSpring) {                                  // 質量が無いので波は伝わらない
      const lengthM = sumD * PX2M;
      const strain = (lengthM - this.restM) / this.restM;
      return { strain, T: Math.max(0, this.springK() * (lengthM - this.restM)),
               muS: 0, vT: Infinity, vL: Infinity, lengthM };
    }
    const a = sumD / (N - 1);                                // 平均の節点間隔 [px]
    const strain = (a - this.restLen) / this.restLen;
    const T = Math.max(0, this.k * (a - this.restLen) * PX2M);   // [N] 実測張力
    const aM = a * PX2M;
    const muS = aM > 1e-9 ? this.m / aM : this.linDensity;   // 伸びた状態での線密度 [kg/m]
    return {
      strain, T, muS,
      vT: Math.sqrt(T / muS),                                // 横波 [m/s]
      vL: Math.sqrt(this.k * aM / muS),                      // 縦波 [m/s]（★a は伸びた間隔）
      lengthM: sumD * PX2M,
    };
  }
  totalEnergy() {
    const N = this.nodes.length, nd = this.nodes;
    let e = 0;
    for (let i = 0; i < N; i++) e += 0.5 * this.m * (nd[i].vx*nd[i].vx + nd[i].vy*nd[i].vy) * PX2M * PX2M;
    for (let i = 0; i < N - 1; i++) {
      const d = (Math.hypot(nd[i+1].x - nd[i].x, nd[i+1].y - nd[i].y) - this.restLen) * PX2M;
      e += 0.5 * this.k * d * d;
    }
    return e;
  }
  reset() {
    for (const n of this.nodes) { n.vx = 0; n.vy = 0; }
    this._acc = 0;
  }
}

// ═══ 先端おもり（掴んで引くための取っ手）═══════════════════════
//   ロープとまったく同じ仕組み（rope.js の「ロープの先端おもり」を参照）。背景に固定した
//   端は動かせず、つかむツールは物体しか掴めないので、そこに小さな円を作って端を付け替える。
//   ばねでは「ばねの下端におもりを吊るす」がそのまま単振動の実験になるので、ロープ以上に
//   出番が多い。
//   ★おもりは「ばねの一部」の扱いで、ばねを消すと一緒に消える（removeSlinky）。
const SLINKY_TIP_MIN_R = 6;    // [px] これ未満は形状が退化して当たり判定が壊れる（1px = 1cm）
// コイルの太さより細くする（同じ幅だと、ばねの続きなのか吊るした物なのか見分けがつかない）
function slinkyTipRadius(S) { return Math.max(SLINKY_TIP_MIN_R, (S ? S.radius : 0) * 0.7); }
// 付けるおもりの質量 [kg]。★ロープの ropeTipMass は使わない。
//   ばねツールは「引いた長さ ÷ (1+張り具合)」を自然長にするので、置いた時点で 2倍に
//   伸びている＝端は 20N 級で引かれている。そこへロープと同じ 0.1kg（≒1N）を付けると、
//   蓄えた 10J の弾性エネルギーが軽いおもりへ一気に解放されて手が付けられない
//   （実測：節点の速さが 1154px/s、8秒たっても 500px/s のまま暴れ続ける）。
//   端の張力とつり合う質量を選べば、付けた瞬間はその場で静止して始まる＝教科書どおりの
//   「ばねにおもりを吊るしてつり合わせた」状態から実験を始められる（実測 23px/s → 14px/s）。
//   たるんだ・縮んだばねでは張力が 0 なので、ばね自身の質量を下限にして意味のある重さにする。
//   ★あとから変えるときは、おもり自体を選んでプロパティの質量を書き換える（普通の物体）。
function slinkyTipMass(S, end) {
  const nd = S.nodes, i = (end === 'A') ? 0 : nd.length - 1, j = (end === 'A') ? 1 : nd.length - 2;
  let T;                                                  // 端のリンクが今出している張力 [N]
  if (S.idealSpring || !nd[j]) T = S.measure().T;         // 理想ばねは節点を持たない（一様）
  else T = S.k * (Math.hypot(nd[j].x - nd[i].x, nd[j].y - nd[i].y) - S.restLen) * PX2M;
  const g = Math.hypot(gravPxX(), gravPxY()) * PX2M;      // [m/s²]（無重力なら 0）
  const balance = g > 1e-6 ? Math.max(0, T) / g : 0;
  return +Math.max(0.01, S.linDensity * S.restM, balance).toFixed(2);
}
// その端に付いている先端おもり（無ければ null）
function slinkyEndTip(S, end) {
  if (!S) return null;
  const b = (end === 'A') ? S.bodyA : S.bodyB;
  return (b && b.ropeTip) ? b : null;
}
function addSlinkyTip(S, end) {
  if (!S || !slinkyEndFree(S, end)) return null;      // 物体に取り付いている端は対象外
  const n = slinkyEndNode(S, end);
  const tip = new Body({
    type: 'circle', x: n.x, y: n.y, radius: slinkyTipRadius(S),
    mass: slinkyTipMass(S, end),
    fixedRotation: true, ropeTip: true,
    restitution: 0.2, friction: 0.5,
    fillColor: '#ffd54f', strokeColor: '#ffffff', strokeWidth: 1.5,
    layers: LAYER_DEFAULT,                            // 他の新規物体と同じくレイヤー1のみ
  });
  objects.push(tip);
  if (end === 'A') { S.bodyA = tip; S.endA = 'body'; S.anchorAx = 0; S.anchorAy = 0; }
  else             { S.bodyB = tip; S.endB = 'body'; S.anchorBx = 0; S.anchorBy = 0; }
  if (S._cp) delete S._cp[end];                       // 連成の履歴は付け替えた時点で無効
  return tip;
}
// 先端おもりを外して、その端を元どおり「その場に固定した端」へ戻す。
//   おもりがいた場所をそのまま杭にするので、外した瞬間に端が飛ばない。
function removeSlinkyTip(S, end) {
  const tip = slinkyEndTip(S, end);
  if (!tip) return false;
  const n = slinkyEndNode(S, end);
  if (end === 'A') { S.bodyA = null; S.endA = 'pin'; S.pinAx = n.x; S.pinAy = n.y; }
  else             { S.bodyB = null; S.endB = 'pin'; S.pinBx = n.x; S.pinBy = n.y; }
  if (S._cp) delete S._cp[end];
  dropTipBody(tip);
  return true;
}
// ばねを1本消す。掴むために付けた先端おもりも一緒に消す。
// ★ばねを消す経路（プロパティの削除ボタン・右クリック・種別一括）は必ずここを通す。
//   直接 slinkies.splice すると、おもりだけが宙に取り残される。
function removeSlinky(S) {
  const i = slinkies.indexOf(S);
  if (i >= 0) slinkies.splice(i, 1);
  for (const w of ['A', 'B']) { const t = slinkyEndTip(S, w); if (t) dropTipBody(t); }
}

// ═══ 接触 ═══════════════════════════════════════════════════════
//   検出の幾何は既存ロープの ropeSegLocal をそのまま使う（物体ローカルで接触面を持つ）。
//   ★解決は流用しない。ロープの ropeLinkConstraint は位置投影で、反復のたびに
//     エネルギーを落とすので定在波が消える。ここでは押し出し＋法線速度の除去だけを行い、
//     ばねには一切触らない。
function _slinkyBroadphase(S) {
  const nd = S.nodes;
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (const n of nd) {
    if (n.x < mnX) mnX = n.x;  if (n.x > mxX) mxX = n.x;
    if (n.y < mnY) mnY = n.y;  if (n.y > mxY) mxY = n.y;
  }
  const pad = S.radius + S.restLen + 4;
  mnX -= pad; mnY -= pad; mxX += pad; mxY += pad;
  const out = [];
  for (const b of objects) {
    if (b === S.bodyA || b === S.bodyB) continue;     // 取り付けた相手とは当たらない
    if (b.layers === 0 || b.held) continue;
    const a = b._aabb;
    if (a.maxX < mnX || a.minX > mxX || a.maxY < mnY || a.minY > mxY) continue;
    out.push(b);
  }
  return out;
}
function _slinkyDetect(S, cands) {
  const cts = S._cts; cts.length = 0;
  const nd = S.nodes, R = S.radius;
  for (let i = 0; i < nd.length - 1; i++) {
    for (const b of cands) {
      const r = ropeSegLocal(b, nd[i], nd[i+1], R);
      if (r) cts.push({ b, i, s: r.s, circle: r.circle, lx: r.lx, ly: r.ly, ldx: r.ldx, ldy: r.ldy });
    }
  }
}
// ★接触は「索の2節点」対「物体」の2体拘束として解く。
//   索側だけ押し出して物体には小さな力を返す、という非対称な扱いにすると、
//   重い物体は索を無限に引き伸ばしながらすり抜ける（実効質量を無視しているため）。
//   索側の実効逆質量は、接触点を分担する重み wa, wb から (wa²+wb²)/m で出る。
// 物体を背負った端が、地面から保つべき距離［px］。
//   取り付け点から見て、その物体の表面のうち地面にいちばん近い点までの隔たり。
//   ★索がこの端の「持ち主」なので、地面に当たらないようにするのも索の仕事になる。
//     形は世界のサブステップの中でほとんど変わらないので、1サブステップに1回で足りる。
function _endGroundClearance(b, px, py) {
  let deep;                                   // 表面のうち、地面にいちばん近い点の符号付き距離
  const vs = b._worldVerts();
  if (vs && vs.length) {
    deep = Infinity;
    for (const v of vs) { const d = signedDistToGround(v.x, v.y); if (d < deep) deep = d; }
  } else {
    deep = signedDistToGround(b.x, b.y) - (b.radius || 0);   // 円（頂点を持たない）
  }
  const c = signedDistToGround(px, py) - deep;
  return Number.isFinite(c) ? Math.max(0, c) : 0;
}
// 地面は物体ではないので別に処理する（ロープと同じ扱い）。半空間なので押し出すだけでよい。
// ═══ 端に付けた物体の「眠り」═══════════════════════════════════
//   ★索は接触ソルブより後で端の物体の速度・位置を書き戻すので、そこで与えた速度は
//     摩擦・非貫入の判定を受けないまま次のサブステップの積分に渡る（摩擦も非貫入も
//     速度に対する拘束なので、順番が1つ違うだけで素通りする）。1サブステップぶんの
//     取りこぼしは a·dt と小さいが、毎サブステップ積み上がるので、
//     静止摩擦の上限 74N で止まっているはずの 10.8kg の箱を 19.5N のばねで引くと
//     毎秒 0.4px で滑り続ける（＝手を離しても勝手に横滑りする）。
//   ★理想ばねでこれが起きないのは、物体が眠って積分ごと止まるから。実体のばねだけが
//     書き戻しのたびに叩き起こしていたので、同じ土俵に乗せる：
//       ・眠っている物体は「動かせない端」として扱う（静的な物体と同じ goal 経路）
//       ・ばねが十分に強く引いたときだけ起こす
//     眠りは「接触と摩擦がこの物体を止めた」というワールド側の判定なので、それを
//     索が勝手に覆さない、というのがここでの筋。
//   起こす条件は「ばねが静止摩擦を破れるだけ引いているか」。眠っている物体は接触判定から
//   外れる（detectGroundCollision が飛ばす）ので、いま何に支えられているかはワールドに
//   聞けない。地面に載っているとみなして N ≒ mg で見積もる。外しても害は小さい
//   （起こしたあとの動きはワールドの摩擦がきちんと決める）。
function _slinkyEndWakes(S, w, b) {
  const nd = S.nodes, i = (w === 'A') ? 0 : nd.length - 1, j = (w === 'A') ? 1 : nd.length - 2;
  if (!nd[j]) return true;
  const d = Math.hypot(nd[j].x - nd[i].x, nd[j].y - nd[i].y);
  if (!(d > 1e-9)) return false;
  const F = Math.abs(S.k * (d - S.restLen) * PX2M);          // 端のリンクが出している力 [N]
  const g = Math.hypot(gravPxX(), gravPxY()) * PX2M;         // [m/s²]
  const muS = combineFriction(b.frictionStatic, ground.frictionStatic);
  return F > muS * g / b.invMass;                            // μs·m·g [N] を超えたら起こす
}
function _slinkyGround(S) {
  if (!world.terrain) return;
  const nd = S.nodes, R = S.radius, lastN = nd.length - 1;
  const gnx = Math.sin(ground.angle), gny = -Math.cos(ground.angle);
  for (let i = 0; i <= lastN; i++) {
    // 端の扱いは3通り。
    //   ・その場に固定した端／静的な物体に付けた端 … 索には動かせないので触らない
    //   ・物体を背負って索が積分している端 … ★その物体の形で止める（_gcl）。
    //     ここを素通りさせると、索は地面を無視して物体を地中へ引きずり込み、
    //     ワールド側の接触ソルバがそれを毎サブステップ数十pxも引き戻す。索から見ると
    //     端の瞬間移動なので、そのたびに ½kΔ² が湧いてばねが暴れる（実測 49px＝48J）。
    //   ・自由端 … 索の太さで止める（従来どおり）
    let r = R;
    if (i === 0 || i === lastN) {
      const gcl = (i === 0) ? S._gclA : S._gclB;
      if (gcl == null) { if (S._held(i === 0 ? 'A' : 'B')) continue; }
      else r = gcl;
    }
    const n = nd[i];
    const d = signedDistToGround(n.x, n.y) - r;
    if (d >= 0) continue;
    n.x -= gnx * d; n.y -= gny * d;
    const vn = n.vx * gnx + n.vy * gny;
    if (vn < 0) { n.vx -= gnx * vn; n.vy -= gny * vn; }   // めり込む向きの速度だけ消す
  }
}
function _slinkyResolve(S, dt, twoWay) {
  const nd = S.nodes, R = S.radius, m = S.m, lastN = nd.length - 1;
  for (const ct of S._cts) {
    const b = ct.b, a = nd[ct.i], c = nd[ct.i+1], s = ct.s;
    const px = a.x + (c.x - a.x) * s, py = a.y + (c.y - a.y) * s;   // 線分上の接触点
    let nx, ny, depth;
    if (ct.circle) {                                   // 円：中心から見た向き
      const dx = px - b.x, dy = py - b.y, d = Math.hypot(dx, dy) || 1;
      nx = dx / d; ny = dy / d; depth = (b.radius + R) - d;
    } else {                                           // 多角形：保存した局所面をワールドへ
      const co = Math.cos(b.angle), si = Math.sin(b.angle);
      const sx = b.x + ct.lx*co - ct.ly*si, sy = b.y + ct.lx*si + ct.ly*co;
      nx = ct.ldx*co - ct.ldy*si; ny = ct.ldx*si + ct.ldy*co;
      depth = R - ((px - sx)*nx + (py - sy)*ny);
    }
    if (!(depth > 0) || !Number.isFinite(depth)) continue;
    // 接触点を分担する重み。固定されている端の節点は動かせない＝寄与ゼロ
    const wa = (S._held('A') && ct.i === 0)      ? 0 : (1 - s);
    const wb = (S._held('B') && ct.i + 1 === lastN) ? 0 : s;
    const invRope = (wa*wa + wb*wb) / m;               // 索側の実効逆質量 [1/kg]
    const fixed = b.isStatic || b.held || b.invMass === 0;
    const rx = px - b.x, ry = py - b.y, rn = rx*ny - ry*nx;
    const invBody = fixed ? 0 : (b.invMass + rn*rn*b.invInertia);
    const inv = invRope + invBody;
    if (inv < 1e-12) continue;
    // ① 位置の押し出し（索と物体へ実効質量で配分する）
    //   ★内部サブステップごとに呼ばれるので、1回あたりは弱くする。強く押すと
    //     1フレームに何十回も満額の補正が入り、押し戻しがエネルギーになって物体が跳ねる。
    //     わずかなめり込み（SLOP）は残す。詰め切ろうとすると接触点で細かく振動する。
    const corr = Math.max(0, depth - SLINKY_SLOP) * SLINKY_BAUMGARTE / inv;
    if (corr <= 0) { /* めり込みは許容範囲。速度だけ処理する */ } else
    {
      a.x += nx * corr * wa / m; a.y += ny * corr * wa / m;
      c.x += nx * corr * wb / m; c.y += ny * corr * wb / m;
      if (!fixed && twoWay) {
        b.x -= nx * corr * b.invMass; b.y -= ny * corr * b.invMass;
        b._updateAABB();
      }
    }
    // ② 法線方向に近づいている相対速度を消す（跳ね返りは持たせない）
    const vx = a.vx + (c.vx - a.vx) * s, vy = a.vy + (c.vy - a.vy) * s;
    const bvx = fixed ? 0 : b.vx - b.av * ry;
    const bvy = fixed ? 0 : b.vy + b.av * rx;
    const vn = (vx - bvx) * nx + (vy - bvy) * ny;
    if (vn >= 0) continue;
    const j = -vn / inv;                               // 力積の大きさ [kg·px/s]
    a.vx += nx * j * wa / m; a.vy += ny * j * wa / m;
    c.vx += nx * j * wb / m; c.vy += ny * j * wb / m;
    if (!fixed && twoWay) {                            // ③ 反作用（作用・反作用）
      b.applyImpulse(-nx * j, -ny * j, px, py);
      if (dt > 0) b.recordForce('spring', -nx * j, -ny * j, px, py, 'slinky' + S.id);
    }
  }
}
// ═══ 理想ばね（質量を無視した力の法則）═══════════════════════════
//   節点を積分せず、両端の間を1本の拘束として解く。式はばねジョイントと同じもので、
//   理論値に 0.2% で一致することを確認済み。節点は描画のためだけに直線上へ並べる
//   （見た目はコイルのまま＝チェックボックスが純粋に物理だけを切り替えるスイッチになる）。
//   ★接触しない。質量も形も持たないので、当たる実体が無い（ばねジョイントと同じ）。
// 端 E が軸方向（nx,ny）に持つ逆質量 [1/kg]。ばねジョイントとまったく同じ組み立てで、
// 取り付け点が重心から外れているぶんの回転のしやすさ（腕²×逆慣性）まで含む。
function _idealEndInvMass(E, nx, ny) {
  if (!E.b || E.b.isStatic || E.b.held || E.b.invMass === 0) return 0;
  const cr = (E.x - E.b.x) * ny - (E.y - E.b.y) * nx;
  return E.b.invMass + cr * cr * E.b.invInertia;
}
// 両端をつないだ軸方向の換算質量 [kg]。動かせる端がひとつも無ければ null。
// ★減衰比 ζ = c/(2√(k·m_red)) の表示（js/ui/panel-element.js）がソルバと同じ質量を見るように、
//   この計算はここに1つだけ置く。パネル側で作り直すと、腕の扱いがずれて別の値が出る。
function slinkyReducedMass(S) {
  if (!S) return null;
  const A = S._idealEnd('A'), B = S._idealEnd('B');
  if (!Number.isFinite(A.x) || !Number.isFinite(B.x)) return null;
  const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
  if (d < 1e-6) return null;
  const kEff = _idealEndInvMass(A, dx/d, dy/d) + _idealEndInvMass(B, dx/d, dy/d);
  return kEff > 1e-12 ? 1 / kEff : null;
}
function _updateIdealSpring(S) {                       // 描画用の並べ直しだけ
  const nd = S.nodes, last = nd.length - 1;
  const A = S._idealEnd('A'), B = S._idealEnd('B');
  if (!Number.isFinite(A.x) || !Number.isFinite(B.x)) return;
  const dx = B.x - A.x, dy = B.y - A.y;
  for (let i = 0; i <= last; i++) {
    const t = i / last;
    nd[i].x = A.x + dx*t;  nd[i].y = A.y + dy*t;  nd[i].vx = 0;  nd[i].vy = 0;
  }
}
// ★理想ばねの力は、1サブステップに半分ずつ2回効かせる（速度ベルレ。step.js が
//   h = subDt/2 で2回呼ぶ）。重力・万有引力・電磁気と同じ理由で、2026-09-27 に直した。
//   以前は updateSlinkies の中（接触を解いたあと）で1サブステップぶんを丸ごと足していた
//   （半陰的オイラー）。ばねだけの系ならそれでもエネルギーは有界だが、その誤差 O(dt·v·F)
//   は速度の向きで符号が決まるので、反発で速度が反転するたびに誤差が「返ってこない」まま
//   積み上がる。実測（状態変化と潜熱のデモ・乱数固定。E/E0 は 100tick ごとの時間平均）：
//       旧  固体 100tick 1.04 → 500tick 4.7 → 800tick 2274（粒が箱から飛び出す）
//           粒どうしの接触1回で +1.07 J（固体の箱の全エネルギーは 9 J）
//           粒の衝突を切る（layers=0）と旧のままでも 1.009 で平ら ＝ 犯人は「ばね×反発」
//       新  30秒で 固体 0.994／液体 0.937／気体 1.000
//   ★2回の置き場所（step.js）：
//     post（後ろの半分）… integrate の直後、接触を解く前。接触が見る速度を「位置と同じ
//       時刻の速度」にそろえる。これが上の爆発を止める本体。
//     前の半分 … **次の integrate の前ではなく、このサブステップの終わり、軸・ヒンジの
//       ピンを解く前**に入れる（位置の補正のあと＝次の位置で測る。式の上では同じ）。
//       integrate の直前に置くと、軸で留めた物体（モーターのクランク）がばねの力積で
//       回ってから軸がそれを見ることになり、モーターは角速度しか縛らないので角度が戻らない。
//       実測（共振のデモ・モーター停止・減衰0・振幅 100px から20秒）：
//           integrate の直前   振幅 100 → 83.6px・止めたはずの円板が 73°回る
//                              （刻みを 8→32 にしても残る）
//           ピンを解く前       99.98px・0.000° ＝ 旧（丸ごと1回）と同じ
//       接触を解いたあとに速度を足すのは旧と同じなので、接触との関係は悪くならない。
//   post＝後ろの半分。位置の更新に使われていない速度なので、万有引力と同じく _gHx に
//   足す（接触の接線ずれの補正 _vtPos が差し引く。gravitation.js の★）。
//   stepDt は行き過ぎの頭打ちに使う1サブステップの長さ（半分の刻みでも位置は丸ごと進むので）。
function applyIdealSprings(h, stepDt, post) {
  for (const S of slinkies) if (S.idealSpring) _idealSpringKick(S, h, stepDt, post);
}
function _idealSpringKick(S, h, stepDt, post) {
  const A = S._idealEnd('A'), B = S._idealEnd('B');
  if (!Number.isFinite(A.x) || !Number.isFinite(B.x)) return;
  const dx = B.x - A.x, dy = B.y - A.y, dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return;
  const nx = dx / dist, ny = dy / dist;
  const kTot = S.springK();                            // [N/m]
  const stretch = dist - toPx(S.restM);                // [px]
  const kEff = _idealEndInvMass(A, nx, ny) + _idealEndInvMass(B, nx, ny);
  if (kEff <= 1e-12) return;                           // 両端とも動かない
  const vOf = E => E.b ? { x: E.b.vx - E.b.av*(E.y-E.b.y), y: E.b.vy + E.b.av*(E.x-E.b.x) }
                       : { x: 0, y: 0 };
  const va = vOf(A), vb = vOf(B);
  const Ldot = (vb.x - va.x) * nx + (vb.y - va.y) * ny;
  const cD = S.dampC;                                  // [N·s/m] そのまま（相手の質量を見ない）
  let Jk = kTot * stretch * h;
  let Jc = cD * Ldot * h;
  // 1ステップで行き過ぎないよう頭打ち（硬いばねでも発散しない。ばねジョイントと同じ）。
  //   ★上限は1サブステップぶんの値を刻みの比（h/stepDt）で割り振る。2回足すと元の上限になる。
  const maxJc = Math.abs(Ldot) / kEff;
  if (Math.abs(Jc) > maxJc) Jc = Math.sign(Jc) * maxJc;
  const maxJk = Math.abs(stretch) / (kEff * stepDt) * (h / stepDt);
  if (Math.abs(Jk) > maxJk) Jk = Math.sign(Jk) * maxJk;
  const J = Jk + Jc;
  if (!Number.isFinite(J)) return;
  _idealSpringApply(S, A, B, nx, ny, J, post);
}
function _idealSpringApply(S, A, B, nx, ny, J, post) {
  const kick = (b, jx, jy, px, py, key) => {
    const vx0 = b.vx, vy0 = b.vy;
    b.applyImpulse(jx, jy, px, py);
    b.recordForce('spring', jx, jy, px, py, key);
    if (post) { b._gHx = (b._gHx || 0) + (b.vx - vx0); b._gHy = (b._gHy || 0) + (b.vy - vy0); }
  };
  if (A.b) kick(A.b,  nx*J,  ny*J, A.x, A.y, 'slinky'+S.id+'A');
  if (B.b) kick(B.b, -nx*J, -ny*J, B.x, B.y, 'slinky'+S.id+'B');
}
// ═══ 毎ワールドサブステップの更新 ═══════════════════════════════
function updateSlinkies(worldDt) {
  if (!slinkies.length) return;
  const twoWay = worldDt > 0;
  for (const S of slinkies) {
    // ★理想ばねの力は step.js が applyIdealSprings で前後半分ずつ入れる。ここは並べ直すだけ
    if (S.idealSpring) { S._cp = null; _updateIdealSpring(S); continue; }
    const nd = S.nodes, N = nd.length, last = N - 1;
    // ── 拘束されている端の行き先を決める ──────────────────────
    //   ★ここで瞬間移動させてはいけない。端の位置はフレーム境界でしか分からないので、
    //     そのつど飛ばすと 1/60 秒ごとに速度が不連続になり、索は毎回そこから折れ目
    //     （キンク）を放射する。節点を増やすほど折れ目が鋭く解像されるだけで直らず、
    //     索全体がリンク単位でぎざぎざに鳴る。サブステップの中を直線で補間して、
    //     そのぶんの速度も持たせる。
    // ═══ 物体に取り付けた端：この自由度の「持ち主」を索側に一本化する ═══════
    //   ★以前は物体とこの節点を二重に積分していた。物体はメインソルバが、同じ点を索が
    //     積分し、毎サブステップ両者を突き合わせて索側を物体の位置へ引き戻していた。
    //     ずれは ½a·dt² と二次の微小量だが、常にばねを緩める向きなので実質的な減衰に
    //     なり、10秒で全系のエネルギーが半分になっていた（減衰0のはずなのに）。
    //   そこで持ち主を索に決め、物体側の積分は「差分だけ」取り込む：
    //     ・速度の変化 … 重力・接触・他のジョイントが物体に与えたぶん
    //     ・位置の補正 … 自分の速度で進んだぶんを差し引いた残り（接触の押し出しなど）
    //   自分の速度で進むぶんは索が持っているので二重に足さない。
    S._massA = S._massB = 0;
    S._gclA = S._gclB = null;      // 背負った物体が地面から保つべき距離（_slinkyGround が使う）
    const coup = [];
    if (!S._cp) S._cp = {};
    for (const w of ['A', 'B']) {
      if ((w === 'A' ? S.endA : S.endB) !== 'body') { delete S._cp[w]; continue; }
      const b = w === 'A' ? S.bodyA : S.bodyB;
      const p = S._anchorWorld(w);
      if (!b || !p || b.isStatic || b.held || b.invMass === 0) { delete S._cp[w]; continue; }
      // ★眠っている物体は動かせない端として扱う（_slinkyEndWakes の解説を参照）。
      //   ばねが強く引いていれば、ここで起こしてから連成に入る。
      if (b.sleeping) {
        if (!_slinkyEndWakes(S, w, b)) { delete S._cp[w]; continue; }
        b.sleeping = false; b.sleepTimer = 0;
      }
      const n = nd[w === 'A' ? 0 : last];
      const bvx = b.vx - b.av * (p.y - b.y), bvy = b.vy + b.av * (p.x - b.x);
      const prev = S._cp[w];
      const M = 1 / b.invMass;
      if (!prev || worldDt <= 0) {                       // 付いた直後：素直に合わせる
        n.x = p.x; n.y = p.y; n.vx = bvx; n.vy = bvy;
      } else {
        // ★外から来た速度変化は「物体＋節点」の質量で受け直す。
        //   物体側の積分は物体の質量 M だけを見て Δv = J/M を作るが、この点の本当の
        //   質量は節点のぶんを足した M+m（索の力を m/(M+m) に割っているのと同じ質量）。
        //   そのまま取り込むと、外から加えた力が (M+m)/M 倍に化ける。
        //   実測（動力 1N・節点 0.01kg）：おもり 0.02kg で 1.52倍、0.05kg で 1.22倍、
        //   0.2kg で 1.06倍、1kg で 1.02倍。先端おもりを軽くするほど効いた。
        //   ★重力だけは割り引かない。質量によらない加速度なので、M/(M+m) 倍すると
        //     吊るした伸びが mg/k より小さくなる。物体側が重力で足したぶんを先に
        //     取り分け、残り（動力・接触・ほかのジョイント・抗力…）だけを割り引く。
        const rExt = M / (S.m + M);
        const gOn  = b.hasGravity && !b.constVel && !b._remoteDrive && !b.frozen;
        const gdx  = gOn ? gravPxX() * worldDt : 0;
        const gdy  = gOn ? gravPxY() * worldDt : 0;
        n.vx += gdx + ((bvx - prev.vx) - gdx) * rExt;
        n.vy += gdy + ((bvy - prev.vy) - gdy) * rExt;
        // ★位置の補正は割り引かない。これは力ではなく押し出し（接触の貫通解消など）で、
        //   索が最後に物体の位置を上書きする以上、指示された場所へそのまま行かないと
        //   物体が壁にめり込んだままになる。
        // ★差し引くのは「積分後の速度 × dt」。物体側は前進オイラーで、速度を先に更新して
        //   から x += v_new·dt と進むので、ここで v_old を使うと差が a·dt² だけ残る。
        //   その残りは力でも押し出しでもないのに毎サブステップ位置へ足され、索を
        //   じわじわ引き伸ばす（実測：動力 1N・おもり 0.02kg で端が 16.7px 伸びた所で
        //   釣り合った＝見かけの張力が 1.17N に増えていた）。v_new なら、外から
        //   押された分だけがちょうど残る。
        //   ☆2026-09-27 から物体側は位置を「重力の半分だけ手前の速度」で進める（body.js の
        //     integrate の★）ので、厳密には v_new·dt と ½g·dt² だけ違う。測ると、ばね振り子の
        //     デモの縦・横・斜めのおもりの平均位置（600〜2400tick）は新旧で小数第3位まで同じ
        //     だったので、ここは変えていない。
        n.x  += p.x - (prev.px + bvx * worldDt);         // 自分の積分ぶんを除いた位置補正
        n.y  += p.y - (prev.py + bvy * worldDt);
      }
      if (w === 'A') S._massA = S.m + M; else S._massB = S.m + M;
      // 地面に当たる位置は、索の太さではなく背負った物体の形で決まる
      if (world.terrain && (b.layers & ground.layers)) {
        const gcl = _endGroundClearance(b, p.x, p.y);
        if (w === 'A') S._gclA = gcl; else S._gclB = gcl;
      }
      // ★腕（重心→取り付け点）は書き戻しでも要る。物体が回っていると角度が変わるので、
      //   ここで控えるのではなく書き戻す直前に取り直す（下の ★ を参照）。
      coup.push({ n, b, w });
    }
    const goal = [];
    for (const w of ['A', 'B']) {
      const mode = w === 'A' ? S.endA : S.endB;
      const n = nd[w === 'A' ? 0 : last];
      if (mode === 'body' && (w === 'A' ? S._massA : S._massB)) continue;   // 上で連成済み
      let tx, ty;
      if (mode === 'pin') { tx = S.pinAx; ty = S.pinAy; if (w === 'B') { tx = S.pinBx; ty = S.pinBy; } }
      else if (mode === 'body') { const p = S._anchorWorld(w); if (!p) continue; tx = p.x; ty = p.y; }
      else continue;
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      // ★拘束された端は「絶対に瞬間移動させない」。飛ばすたびに、伸びた距離 Δ に対して
      //   ½kΔ² のエネルギーが無から湧く。減衰ゼロだと積み上がり、10秒で数千倍に発散する
      //   （リンクが多いほど k が大きいので悪化する）。必ず内側のサブステップを掃かせる。
      //
      // ★掃く速さの基準は「何が行き先を決めているか」で変える。ここを間違えると、
      //   速すぎれば索を叩き、遅すぎれば端が遅れて最後のリンクだけ余分に伸びる。
      //   物体に取り付けた端 … 物体はワールドのサブステップごとに動くので、その1回ぶんで
      //     ちょうど追いつく速さ。(行き先−現在位置)/worldDt は取り付け点の実速度に等しい。
      //   マウスで動かすピン … 行き先はフレーム境界でしか更新されない。worldDt 基準にすると
      //     最初の1サブステップで全距離を跳び、substeps 倍（既定4倍）の速度が叩き込まれる。
      const base = (mode === 'body') ? worldDt : (1 / SIM_HZ);
      goal.push({ n, tx, ty, vx: (tx - n.x) / base, vy: (ty - n.y) / base });
    }
    // ── 接触の検出はワールドサブステップに1回（内部サブステップでは面を使い回す）──
    _slinkyDetect(S, _slinkyBroadphase(S));
    // ── 自前のサブステップで速度Verlet ──
    //   剛性から決まる CFL のほうが世界の刻みより細かいので、その差だけ内部で回す。
    const sdt = S.dtMax * SLINKY_CFL;
    let n = Math.max(1, Math.ceil(worldDt / sdt));
    if (n > SLINKY_MAX_SUBSTEPS) n = SLINKY_MAX_SUBSTEPS;
    const dt = worldDt / n;
    if (!(dt > 0)) continue;
    if (!S._ax || S._ax.length !== N) { S._ax = new Float64Array(N); S._ay = new Float64Array(N); }
    const ax = S._ax, ay = S._ay;
    S._accel(ax, ay);
    for (let s = 0; s < n; s++) {
      const h = dt * 0.5;
      for (let i = 0; i < N; i++) { nd[i].vx += ax[i]*h; nd[i].vy += ay[i]*h; }
      for (let i = 0; i < N; i++) { nd[i].x  += nd[i].vx*dt; nd[i].y += nd[i].vy*dt; }
      // 拘束された端は、フレーム時間で決めた速さで行き先へ進める（行き過ぎないよう頭打ち）
      for (const g of goal) {                              // 一定の速さで掃く（行き過ぎは頭打ち）
        const rx = g.tx - g.n.x, ry = g.ty - g.n.y;
        const sx = g.vx * dt, sy = g.vy * dt;
        g.n.x += (Math.abs(sx) > Math.abs(rx)) ? rx : sx;
        g.n.y += (Math.abs(sy) > Math.abs(ry)) ? ry : sy;
        g.n.vx = g.vx;  g.n.vy = g.vy;
      }
      S._accel(ax, ay);
      for (let i = 0; i < N; i++) { nd[i].vx += ax[i]*h; nd[i].vy += ay[i]*h; }
      for (const g of goal) { g.n.vx = g.vx; g.n.vy = g.vy; }
      _slinkyGround(S);
      _slinkyResolve(S, dt, twoWay);
      S._projectGuide();          // ★レールは最後（接触の押し出しもレールの上で受ける）
    }
    // ── 索が出した結果を物体へ書き戻す ──
    //   持ち主は索なので、物体の位置・速度をこちらへ合わせる（力積で近似しない）。
    //   物体が受けた外力は上で取り込み済みなので、これで二重積分が無くなる。
    if (twoWay) {
      for (const c of coup) {
        const n = c.n;
        if (!Number.isFinite(n.x) || !Number.isFinite(n.vx)) continue;
        const b = c.b;
        b.recordForce('spring', (n.vx - b.vx) / b.invMass, (n.vy - b.vy) / b.invMass,
                      n.x, n.y, 'slinkyEnd' + S.id + c.w);
        // ★節点が持っているのは「取り付け点」の位置と速度なので、物体の重心へ戻すときは
        //   腕 r（重心→取り付け点）のぶんを外す。読み取り側（上の bvx/bvy）が
        //     取り付け点の速度 = 重心の速度 + ω×r
        //   を使っているので、書き戻しはその逆演算でなければならない。
        //   ここを取り違えて b.vx = n.vx としていたため、回っている物体では毎ワールド
        //   サブステップごとに ω×r ぶんの速度が無から湧いていた（実測：腕 6.25px・
        //   ω 0.9rad/s の玉で、5秒後に索の運動エネルギーが 0 → 787 J）。
        //   ★腕は「今の角度」で取り直す。ワールドサブステップの間に物体は回っているので、
        //     ステップ開始時の値を使い回すと、その回転ぶんがまた誤差になる。
        const ax = c.w === 'A' ? S.anchorAx : S.anchorBx;
        const ay = c.w === 'A' ? S.anchorAy : S.anchorBy;
        const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
        const rx = ax*ca - ay*sa, ry = ax*sa + ay*ca;
        b.x = n.x - rx;  b.y = n.y - ry;
        b.vx = n.vx + b.av * ry;
        b.vy = n.vy - b.av * rx;
        // ★動いているあいだだけ眠りを止める。微小な速度でも起こし続けると、
        //   摩擦で止まっているはずの物体が永遠に眠れず滑り続ける（上の解説）。
        if ((n.vx*n.vx + n.vy*n.vy) > SLEEP_LIN_TH * SLEEP_LIN_TH) {
          b.sleeping = false; b.sleepTimer = 0;
        }
        b._updateAABB();
        S._cp[c.w] = { px: n.x, py: n.y, vx: n.vx, vy: n.vy };
      }
    }
    // 破綻したら初期化（NaN が入ると描画も当たり判定も道連れになる）
    for (const q of nd) if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) { S.reset(); break; }
  }
}
// ═══ 一時停止中の追随（dt=0 の位置投影）═════════════════════════
//   停止中は simTick が回らない＝索を追随させる人が誰もいない。つかむツールや編集ツールで
//   端の物体を運んでも索は取り残され、再生の1tick目でそのずれが一気に詰められる
//   （実測：実体ばねの付いた 1kg の箱を停止中に 300px 運んでから再生すると、端のリンクだけが
//   5px→141px に伸び、節点 377m/s・索のエネルギー 2384J。触らない基準は 0.4m/s・0J）。
//   ロープ `updateRopeChains(0,false)`・気体 `resistPausedGasGrab`・容器 `enforcePistonVessels`
//   と同じ「停止中の投影」の列に、索も並べる。
//
// ★配り方はアフィン（材料座標に比例）＝端のずれを全リンクへ均等な伸びとして配る。
//   端の節点だけを動かすと、そのリンク1本に伸びが全部乗る（上の 141px がそれ）。
// ★アフィンな平行移動は合成しても同じ結果になるので、ロープのチェーンと違って刻む必要がない。
//   だから経路ごとではなく、描画の直前にフレーム1回だけ呼べば足りる（render の ★を参照）。
// ★速度は触らない。停止中の操作が決めるのは位置だけ（掴んだ物体の速度は
//   updateHeldVelocities が実際の移動量から作る）。
function settleSlinkies() {
  for (const S of slinkies) {
    if (S.idealSpring) { _updateIdealSpring(S); continue; }   // 節点は描画用：並べ直すだけ
    const nd = S.nodes, last = nd.length - 1;
    const tA = _slinkyEndTarget(S, 'A'), tB = _slinkyEndTarget(S, 'B');
    const ax = tA ? tA.x - nd[0].x    : 0, ay = tA ? tA.y - nd[0].y    : 0;
    const bx = tB ? tB.x - nd[last].x : 0, by = tB ? tB.y - nd[last].y : 0;
    if (Math.abs(ax) + Math.abs(ay) + Math.abs(bx) + Math.abs(by) < 1e-9) continue;
    for (let i = 0; i <= last; i++) {
      const t = i / last;
      nd[i].x += ax * (1 - t) + bx * t;
      nd[i].y += ay * (1 - t) + by * t;
    }
    S._projectGuide(true);            // レールに乗っているばねは、停止中も軸の上から出ない
    // ★動かした端の連成の履歴は捨てる。updateSlinkies は「前回控えた取り付け点からの
    //   差分」で物体の動きを取り込むので、ここで動かしたぶんを残すと再生の1tick目で
    //   二重に足される。動かしていない端は残す（履歴を捨てると、その端の節点の速度が
    //   物体の速度で上書きされる＝震えていたばねを止めてしまう）。
    if (S._cp) {
      if (ax || ay) delete S._cp.A;
      if (bx || by) delete S._cp.B;
    }
  }
}
// レールが通る点を、いまのばねの位置へ張り直す（物体の reanchorGuide と同じ役目）。
//   ★通る点は端Aの節点にする。レールは直線なので線上のどの点でもよいが、端Aを基準にすると
//     「ばねを置いた向きにレールを敷く」が既定の向き（下の slinkyAxisAngle）とそろう。
function reanchorSlinkyGuide(S) {
  if (!S || !S.guideEnabled || !S.nodes || !S.nodes.length) return;
  S.guidePx = S.nodes[0].x;  S.guidePy = S.nodes[0].y;
}
// いまのばねの軸の向き [rad]（端A→端B）。レールを入れたときの既定の向きに使う。
//   ★物体には固有の軸が無いので既定は 0° だが、ばねには向きがある。いまの軸をそのまま
//     既定にすれば、レールを入れた瞬間にばねが動かない＝「入れたら形が変わった」が起きない。
function slinkyAxisAngle(S) {
  const nd = S.nodes, last = nd.length - 1;
  return Math.atan2(nd[last].y - nd[0].y, nd[last].x - nd[0].x);
}
// その端の行き先（杭／取り付け点）。自由端は行き先を持たないので null。
function _slinkyEndTarget(S, w) {
  const mode = w === 'A' ? S.endA : S.endB;
  let p = null;
  if (mode === 'pin')       p = (w === 'A') ? { x: S.pinAx, y: S.pinAy } : { x: S.pinBx, y: S.pinBy };
  else if (mode === 'body') p = S._anchorWorld(w);
  return (p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? p : null;
}
// 索の端の取り付け先を置き直す。索の端は2通りしかない（物体／背景の杭。地面には付かない）。
//   ★端を置き直す操作は必ずここを通す（ジョイントの setJointEnd と同じ役目）。物体に付いた端の
//     アンカーはローカル座標、杭はワールド座標なので、取り違えると端が別の場所へ飛ぶ。
function setSlinkyEnd(S, end, body, wx, wy) {
  const a = body ? getLocalAnchor(body, wx, wy) : null;
  if (end === 'A') {
    S.bodyA = body || null;  S.endA = body ? 'body' : 'pin';
    if (a) { S.anchorAx = a.x; S.anchorAy = a.y; } else { S.pinAx = wx; S.pinAy = wy; }
  } else {
    S.bodyB = body || null;  S.endB = body ? 'body' : 'pin';
    if (a) { S.anchorBx = a.x; S.anchorBy = a.y; } else { S.pinBx = wx; S.pinBy = wy; }
  }
  if (S._cp) delete S._cp[end];        // 付け替えた時点で連成の履歴は無効（addSlinkyTip と同じ）
}
// 端の「行き先」だけを動かす（節点には触らない）。
//   ★追随は再生中ならソルバの掃き（updateSlinkies の goal）が、停止中なら settleSlinkies が
//     引き受ける。ここで端の節点を直に置くと、停止中だけ端のリンク1本が伸びる形になり、
//     編集ツールの手応えが再生中と変わってしまう。
function slinkyMoveEndTo(S, end, tx, ty) {
  const mode = (end === 'A') ? S.endA : S.endB;
  if (mode === 'pin') {
    if (end === 'A') { S.pinAx = tx; S.pinAy = ty; }
    else             { S.pinBx = tx; S.pinBy = ty; }
  } else if (mode !== 'body') {          // 自由端は行き先を持たない＝節点が唯一の手がかり
    const n = S.nodes[end === 'B' ? S.nodes.length - 1 : 0];
    n.x = tx; n.y = ty; n.vx = 0; n.vy = 0;
  }
}
// ═══ 描画 ═══════════════════════════════════════════════════════
//   コイル（ばね）として描くのが要点。巻き数はリンクあたり固定なので、縮んだリンクでは
//   同じ巻きが短い距離に詰まる＝疎密波がそのまま目に見える。線で描くと縦波は見えない。
// ★巻きピッチは「自然長 何px ごとに1巻き」で決める。リンクあたりの巻き数で決めると
//   節点密度を上げたとたんコイルが潰れて線になり、下げると波が解像できなくなる
//   （＝見た目の細かさと計算の細かさが同じつまみになってしまう）。
//   自然長基準にしておけば、伸びたところは巻きが広がり縮んだところは詰まる＝疎密が見える。
const SLINKY_COIL_PITCH = 11;  // [px]（自然長での1巻きぶん）
const STRAIN_DENSE  = [255, 138, 60];    // 縮んでいる＝密
const STRAIN_SPARSE = [ 90, 180, 255];   // 伸びている＝疎
function _rgbOf(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [156, 204, 101];
}
// ダッシュポットの記号（筒＋ピストン）。★コイルで描かないこと：ばね定数 0 の部品は
//   自然長を持たないので、伸び縮みに応じて巻きが詰まるコイルは嘘になる。筒の長さを一定に
//   保ち、出入りするロッドだけが伸び縮みする＝実物のダンパーと同じ見え方にする。
function drawSlinkies() {
  for (const S of slinkies) {
    const nd = S.nodes, N = nd.length;
    if (N < 2) continue;
    const sel = selectedElement && selectedElement.kind === 'slinky' && selectedElement.slinky === S;
    const coilR = Math.max(2, S.radius) * cam.zoom;
    // ひずみ着色の基準は「今の平均ひずみ」。張力は創発量なので固定値を基準にできない
    const e0 = S.showStrain ? S.measure().strain : 0;
    const scale = Math.max(0.02, Math.abs(e0) * 0.5);
    const base = S.showStrain ? _rgbOf(S.color) : null;
    const turnsPerLink = S.restLen / SLINKY_COIL_PITCH;   // 節点密度によらず巻きの見た目を保つ
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let i = 0; i < N - 1; i++) {
      const p0 = worldToScreen(nd[i].x, nd[i].y), p1 = worldToScreen(nd[i+1].x, nd[i+1].y);
      const dx = p1.x - p0.x, dy = p1.y - p0.y, d = Math.hypot(dx, dy) || 1;
      if (S.showStrain) {
        const e = (Math.hypot(nd[i+1].x-nd[i].x, nd[i+1].y-nd[i].y) - S.restLen) / S.restLen;
        const rel = Math.max(-1, Math.min(1, (e - e0) / scale));
        // ★しきい値で色を切り替えないこと。ひずみ 1% の揺らぎでも色が飛んで、
        //   索全体が縞に見えてしまう（疎密の局在が読めなくなる）。連続に混ぜる。
        const t = Math.abs(rel), tgt = rel < 0 ? STRAIN_DENSE : STRAIN_SPARSE;
        ctx.strokeStyle = `rgb(${Math.round(base[0]+(tgt[0]-base[0])*t)},`
                        + `${Math.round(base[1]+(tgt[1]-base[1])*t)},`
                        + `${Math.round(base[2]+(tgt[2]-base[2])*t)})`;
      } else ctx.strokeStyle = S.color;
      ctx.lineWidth = sel ? 2.6 : 1.8;
      ctx.beginPath();
      // ★しきい値は「本当に潰れて向きが決まらない」ときだけにする。
      //   以前は d < 3 で直線に落としていたが、既定の節点間はちょうど 4.0px しかなく、
      //   自然長の75%まで縮めただけで全区間が直線に化けていた（＝縮めた瞬間にコイルが
      //   消える）。巻き数は restLen から決めていて圧縮しても変わらないので、
      //   短い区間でも素直に描けばコイルが密に詰まった正しい絵になる。
      if (!S.showCoil || d < 0.5) { ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); }
      else {
        const nx = -dy/d, ny = dx/d;
        const SEG = Math.max(4, Math.min(24, Math.ceil(turnsPerLink * 8)));
        for (let s = 0; s <= SEG; s++) {
          const t = s/SEG, ph = (i + t) * turnsPerLink * 2*Math.PI;
          const sn = Math.sin(ph);
          const X = p0.x + dx*t + nx*sn*coilR, Y = p0.y + dy*t + ny*sn*coilR;
          s ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
        }
      }
      ctx.stroke();
    }
    if (S.showBeads) {
      ctx.fillStyle = darkenColor(S.color, 0.72);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
      for (let i = 0; i < N; i++) {
        const p = worldToScreen(nd[i].x, nd[i].y);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      }
    }
    drawSlinkyEndMarks(S, nd, N, sel);
    ctx.restore();
  }
}
// 端の選択マーカー：ジョイント（ロープ・連結棒）の端とまったく同じ、●を囲む青い枠。
//   ★●より先に描くこと（ジョイントも同じ順番）。あとから描くと●が枠に塗り潰されて、
//     固定端なのか物体に取り付けた端なのかが読めなくなる（以前は青い■で潰していた）。
//   索そのものを選んでいるときは両端に出す＝「ここを掴めば端だけ動かせる」の合図。
//   範囲選択では拾った端にだけ出る＝片端だけ選んだのか両端なのか（伸びるのか
//   平行移動するのか）が操作前に分かる。
//   ★範囲選択が効いているあいだは、索を選んでいても拾った端にしか出さない。
//     両端に出すと、片端だけ選んだのか両端なのかが読めなくなる（代表の索は
//     selectedElement にも入るので、そのままだと必ず両端に出てしまう）。
function drawSlinkyEndMarks(S, nd, N, sel) {
  const picked = isSlinkyEndSelected(S, 'A') || isSlinkyEndSelected(S, 'B');
  for (const [w, i] of [['A', 0], ['B', N-1]]) {
    if (!(picked ? isSlinkyEndSelected(S, w) : sel)) continue;
    const p = worldToScreen(nd[i].x, nd[i].y);
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(79,195,247,0.25)'; ctx.fill();
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.stroke();
  }
  // 端の印：ロープと同じ●（drawAnchorDot）。色だけで固定／取り付けを見分ける。
  //   ★以前は固定端を×で描いていたが、×は「消す・外す」の記号に見えるうえ、
  //     同じ「動かない端」であるロープの端と見た目が揃わなかった。
  for (const w of ['A', 'B']) {
    const mode = w === 'A' ? S.endA : S.endB;
    const n = nd[w === 'A' ? 0 : N-1];
    const p = worldToScreen(n.x, n.y);
    if (mode === 'pin')       drawAnchorDot(p.x, p.y, '#ffd54f');
    else if (mode === 'body') drawAnchorDot(p.x, p.y, '#80cbc4');
  }
}
function serializeSlinky(S) {
  return { id: S.id, stiffEA: S.stiffEA, linDensity: S.linDensity, damp: S.damp,
           radius: S.radius, restM: S.restM, bendRatio: S.bendRatio,
           idealSpring: S.idealSpring, dampC: S.dampC, nodeDensity: S.nodeDensity, color: S.color,
           guideEnabled: S.guideEnabled, guideAngle: S.guideAngle,
           guidePx: S.guidePx, guidePy: S.guidePy,
           endA: S.endA, endB: S.endB,
           bodyA: S.bodyA ? S.bodyA.id : null, bodyB: S.bodyB ? S.bodyB.id : null,
           anchorAx: S.anchorAx, anchorAy: S.anchorAy, anchorBx: S.anchorBx, anchorBy: S.anchorBy,
           pinAx: S.pinAx, pinAy: S.pinAy, pinBx: S.pinBx, pinBy: S.pinBy,
           showCoil: S.showCoil, showBeads: S.showBeads, showStrain: S.showStrain,
           nodes: S.nodes.map(n => ({ x: +n.x.toFixed(2), y: +n.y.toFixed(2),
                                      vx: +n.vx.toFixed(2), vy: +n.vy.toFixed(2) })) };
}
function deserializeSlinkies(arr, bodyList) {
  if (!arr) return [];
  return arr.map(d => {
    const o = Object.assign({}, d);
    o.bodyA = d.bodyA != null ? bodyList.find(b => b.id === d.bodyA) || null : null;
    o.bodyB = d.bodyB != null ? bodyList.find(b => b.id === d.bodyB) || null : null;
    return new Slinky(o);
  });
}
function resetSlinkies() { for (const S of slinkies) S.reset(); }
