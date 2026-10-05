// ════════════════════════════════════════
//  流れの場（FlowField）— 川・動く歩道・風・水流
//   置いた矩形の内側を、一定の速度 u で流れる媒質で満たす。効かせ方が2つある。
//
//  ── ① 速度の合成（mode:'advect'、既定）──────────────────────────
//    媒質ごと物体を運ぶ。物体が持つ速度は「媒質に対する相対速度」になり、
//    地面から見た速度がその和 v + u になる。高校物理の速度の合成（川を渡る船・
//    動く歩道・風の中の飛行機）そのもので、抗力係数にも質量にも依らない。
//    ★力ではないので、下の②で避けた「非保存な力の場」の問題は起きない。
//      エネルギーが跳ぶのは領域を出入りする一瞬だけで、これは「川に乗り移る過程を
//      省略した」という説明が付く（スラスターが系の外から仕事を入れるのと同じ立場）。
//
//  ── ② 流体の抗力（mode:'drag'）──────────────────────────────────
//    相対速度に応じた抗力を与え、u に漸近させる（終端速度が u）。終端速度・空気抵抗・
//    水流に押される物体を扱うための力学のモード。
//    ★「毎秒一定の速度を足す」型にしなかった理由
//      速度を毎秒 k だけ足す場は、次元でいえば [m/s²] ＝ 加速度場であって速度場ではない。
//      そのうえ、
//        ・物体が際限なく加速する（SANE_VEL の頭打ちまで行って壊れて見える）
//        ・有限の矩形に切った一様な力の場は**非保存**なので、領域を横切って外を回る閉路で
//          正味の仕事が正になる＝エネルギーグラフが理由なく増え、永久機関が作れてしまう
//      抗力の形にすると終端速度が u で頭打ちになり、エネルギーの出所も
//      「送風機・川」という系の外の入口として説明できる（加熱・冷却の領域と同じ立場）。
//    ★①と違い、力なので効き目は物体の重さと摩擦に負ける。実測：80×80px の箱（19.2kg）を
//      地面に置くと、風 8m/s の力 1.2N に対し静止摩擦の上限が 113N あり、スライダー上限の
//      30m/s（17.3N）でも動かない。水流 8m/s なら 1024N で 6.3m/s まで加速する。
//      「置いたのに動かない」の大半はこれなので、パネルに目安を出してある。
//
//  ── 力の式（既存の空気抵抗と同じ形）────────────────────────────
//    F = ½ ρ Cd A |u−v| (u−v)
//      ρ  … この領域の媒質密度 [kg/m³]（既定 1.2 ＝ 空気。水なら 1000）
//      Cd … 物体の抗力係数（プロパティの「抗力」）
//      A  … 相対速度に垂直な断面（body.dragWidthM × 奥行き）
//    body.js の抗力が v を使っているところを (u−v) にしただけ。
//    ★Cd = 0 の物体は流れを受けない。これは既定値（SHAPE_DEFAULT_LOOK の drag:0）なので、
//      置いただけでは何も起きない。物理としては正しい（媒質と結合していない物体）ので
//      勝手に底上げはせず、パネルの注記で「抗力を上げてください」と伝える。
//
//  ── 部分的に入っているとき ──────────────────────────────────────
//    枠と物体の重なりの面積で力を按分する（加熱・冷却の領域と同じ流儀）。幾何の計算は
//    heatFieldBodyAreaM2() が軸に沿った矩形なら何にでも使えるので、そのまま借りる。
//
//  ── エネルギーの帳簿 ────────────────────────────────────────────
//    F·u = F·v + F·(u−v)   ＝「送風機が出した仕事 = 物体の運動エネルギー + 散逸」
//    F·(u−v) = ½ρCdA|u−v|³ ≥ 0 なので散逸は必ず非負。これを熱にしたうえで、出所ごとに
//    reservoirHeatTotal（送風機が系へ入れたぶん）と frictionHeatTotal（物体の運動
//    エネルギーが熱に変わったぶん）へ振り分ける。片方に寄せると、向かい風で減速させた
//    ときに「摩擦なのに供給」あるいは「供給なのに摩擦」と逆の説明になる。
const FLOWFIELD_COLOR    = '#7986cb';   // 他の領域（電場#ffca28／磁場#81c784／加熱#ff7043／冷却#26c6da）と重ならない色
const FLOWFIELD_SPEED_MAX = 30;         // 流速スライダーの上限 [m/s]
const FLOWFIELD_MIN_PX    = 8;          // 潰れてハンドルを掴めなくならないための最小サイズ
const FLOWFIELD_EDGE_PX   = 6;          // 枠の当たり幅 [画面px]（EMFIELD_EDGE_PX と同じ流儀）
// 媒質のプリセット [kg/m³]。実在の値をそのまま使う（誇張しない）
const FLOW_MEDIUM = [
  { label: '空気', density: 1.2 },
  { label: '水',   density: 1000 },
];

class FlowField {
  constructor(opts) {
    opts = opts || {};
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.x = opts.x || 0;  this.y = opts.y || 0;          // 領域の中心 [px]
    this.w = Math.max(4, opts.w || 200);
    this.h = Math.max(4, opts.h || 200);
    this.speed = opts.speed !== undefined ? Math.abs(opts.speed) : 5;   // [m/s] 流速の大きさ
    // 向き [rad]。内部座標は y 下向き正なので、既定の 0 は「右向き」
    this.angle = opts.angle !== undefined ? opts.angle : 0;
    this.density = opts.density !== undefined ? Math.max(0, opts.density) : 1.2;   // [kg/m³]
    // 'advect'＝速度の合成（既定）／'drag'＝流体の抗力。★保存形式なので綴りを変えない
    this.mode = opts.mode === 'drag' ? 'drag' : 'advect';
  }
  isAdvect() { return this.mode !== 'drag'; }
  contains(x, y) {
    return Math.abs(x - this.x) <= this.w/2 && Math.abs(y - this.y) <= this.h/2;
  }
  // 流速ベクトル [px/s]（内部の速度と同じ単位）
  velPx() {
    const s = this.speed * M2PX;
    return { x: Math.cos(this.angle) * s, y: Math.sin(this.angle) * s };
  }
  mediumName() {
    const m = FLOW_MEDIUM.find(o => Math.abs(o.density - this.density) < 1e-9);
    return m ? m.label : this.density + ' kg/m³';
  }
  modeName() { return this.isAdvect() ? '速度の合成' : '抗力・' + this.mediumName(); }
  label() { return this.speed.toFixed(1) + ' m/s'; }
}

// 与えた向きに垂直な断面の幅 [m]。
// ★body.dragWidthM は法線を**物体自身の速度**から作るので、ここでは使えない。
//   流れに押される物体は静止していることが多く、速度が 0 だと法線が作れずに
//   最小値（1px）へ潰れる＝断面が実際の 1/60 になり、力がまったく効かなくなる
//   （実測：この版にする前は 8 m/s の風で 30000tick 回しても 0.275 m/s 止まりだった）。
//   向きを引数で受け取る版をこちらに持ち、相対速度の向きを渡す。
function _flowWidthM(b, dirX, dirY) {
  if (b.type === 'circle') return b.radius * 2 * PX2M;
  const nx = -dirY, ny = dirX;                  // 進行方向に垂直な単位ベクトル
  let mn = Infinity, mx = -Infinity;
  for (const v of b._worldVerts()) {
    const d = v.x*nx + v.y*ny;
    if (d < mn) mn = d;
    if (d > mx) mx = d;
  }
  return Math.max(mx - mn, 1) * PX2M;
}

// ═══ ① 速度の合成 ═══════════════════════════════════════════════
//   物体を運んでいる媒質の速度 [px/s]。載っていなければ null。
//   ★中心が入っているかどうかの二択にする（抗力のように重なり面積で按分しない）。
//     「媒質に乗っているか否か」の二択が速度の合成の前提で、按分すると教科書の図に
//     出てこない中途半端な合成速度が生まれる。
//   ★重なっているときは配列の先頭（＝手前に描かれるもの）が勝つ。足し合わせない
//     ＝媒質は1つ、という約束（描画と選択の「先頭ほど手前」に揃える）。
function flowCarrierVel(b) {
  for (const f of flowFields) {
    if (!f.isAdvect() || !(f.speed > 0)) continue;
    if (f.contains(b.x, b.y)) return f.velPx();
  }
  return null;
}
// 物体がいま媒質から受け取っている速度の下駄を、あるべき値に合わせる。
//   入った瞬間に v += u、出た瞬間に v −= u。物体が持つ v は常に「地面から見た速度」なので、
//   衝突・拘束・ベクトル表示・エネルギーグラフはこれまでどおりで整合する。
//   ★下駄そのものは b._flowU に控える。これが無いと「いま何を足したか」が分からず、
//     流速を動かしたときや領域から出たときに差し引けない（毎ステップ足すと加速度場になる）。
function applyFlowAdvection() {
  for (const b of objects) {
    if (b.isStatic || b.frozen) continue;
    const tgt = flowCarrierVel(b);
    const cx = b._flowU ? b._flowU.x : 0, cy = b._flowU ? b._flowU.y : 0;
    const tx = tgt ? tgt.x : 0,           ty = tgt ? tgt.y : 0;
    if (tx === cx && ty === cy) continue;
    b.vx += tx - cx; b.vy += ty - cy;
    b._flowU = tgt ? { x: tx, y: ty } : null;
    if (b.sleeping) { b.sleeping = false; b.sleepTimer = 0; }
  }
}
// シーンの読み込み・undo の直後に呼ぶ。保存してある速度は地面から見た速度なので、
// 領域の中にいる物体は「もう下駄を履いている」ことにして帳尻を合わせる。
// ★これを忘れると、読み込んだ直後の1ステップで u をもう一度足してしまい、
//   undo するたびに川の中の船が速くなる。
function syncFlowCarry() {
  for (const b of objects) {
    const u = flowCarrierVel(b);
    b._flowU = u ? { x: u.x, y: u.y } : null;
  }
}

// ═══ ② 物理：サブステップごとに抗力を効かせる ═══════════════════════
//   ★サブステップで呼ぶ（tick に一度ではない）。力なので、位置を進める前に
//     速度へ入れておかないと1サブステップ遅れる（applyGasChambers の★と同じ理由）。
function applyFlowFields(dt) {
  if (!flowFields.length || !(dt > 0)) return;
  applyFlowAdvection();                       // ①速度の合成（力ではないので dt に依らない）
  const D = world.depth;
  for (const f of flowFields) {
    if (f.isAdvect()) continue;               // ①のモードはここでは扱わない
    if (!(f.density > 0) || !(f.speed > 0)) continue;
    const u = f.velPx();
    for (const b of objects) {
      if (b.isStatic || b.frozen) continue;
      if (!(b.drag > 0)) continue;              // ★Cd=0 は媒質と結合していない＝力を受けない
      // 相対速度 [px/s]。これが 0 なら（＝流れに乗り切っている）力は 0
      const rx = u.x - b.vx, ry = u.y - b.vy;
      const r2 = rx*rx + ry*ry;
      if (r2 < 1e-6) continue;
      // 浸かっている割合。★幾何の計算は加熱・冷却の領域と共有（軸に沿った矩形なら共通）
      const areaAll = b.areaM2();
      if (!(areaAll > 0)) continue;
      const frac = heatFieldBodyAreaM2(f, b) / areaAll;
      if (!(frac > 1e-6)) continue;
      const r  = Math.sqrt(r2);
      const rm = r * PX2M;                       // [m/s]
      const A  = _flowWidthM(b, rx/r, ry/r) * D; // 相対速度に垂直な断面 [m²]
      const Fn = 0.5 * f.density * b.drag * A * rm * rm * frac;   // [N]
      const aPx = (Fn / b.mass) * M2PX;          // [px/s²]
      const dvx = (rx/r) * aPx * dt, dvy = (ry/r) * aPx * dt;
      const vx0 = b.vx, vy0 = b.vy;
      b.vx += dvx; b.vy += dvy;
      b.recordForce('flow', b.mass*dvx, b.mass*dvy);
      // ★熱と違い、流れは実際に力を与えるので眠っている物体を起こす（起こさないと
      //   風上に置いた箱がいつまでも動かない）。書き方は他の起こし方と揃える。
      if (b.sleeping) { b.sleeping = false; b.sleepTimer = 0; }
      // ── 帳簿 ──
      //   送風機が出した仕事 W = F·u·dt = m·Δv·u ／ 運動エネルギーの変化 ΔK ／ 散逸 E = W − ΔK
      const inv = 1 / (PPM*PPM);
      const W  = b.mass * (dvx*u.x + dvy*u.y) * inv;
      const dK = 0.5 * b.mass * ((b.vx*b.vx + b.vy*b.vy) - (vx0*vx0 + vy0*vy0)) * inv;
      const E  = W - dK;                         // ＝ F·(u−v)·dt ≥ 0
      if (E > 0 && world.thermalOn && bodyHasHeat(b)) {
        applyBodyHeat(b, E);
        // 出所で割る。送風機が出したぶんは供給、足りないぶんは物体の運動エネルギー由来
        const res = Math.max(0, Math.min(E, W));
        reservoirHeatTotal += res;
        frictionHeatTotal  += E - res;
      }
    }
  }
}

// ═══ 当たり判定（EMField・加熱冷却の領域と同じ流儀）═══════════════
//   面が広いので、左クリックで拾うのは枠のそばだけ。内側はダブルクリックで拾う。
function flowFieldAtPoint(x, y) {
  for (const f of flowFields) if (f.contains(x, y)) return f;
  return null;
}
function flowFieldEdgeAtPoint(x, y) {
  const tol = FLOWFIELD_EDGE_PX / cam.zoom;
  for (const f of flowFields) {
    const dx = Math.abs(x - f.x) - f.w/2, dy = Math.abs(y - f.y) - f.h/2;
    const d = (dx > 0 || dy > 0) ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
                                 : -Math.max(dx, dy);
    if (d <= tol) return f;
  }
  return null;
}
function selectedFlowField() {
  return (selectedElement && selectedElement.kind === 'flowfield') ? selectedElement.field : null;
}
// 流れを受けている最中の物体か。★眠らせない条件として updateSleeping が見る。
//   空気は薄いので加速がゆっくりで（10.8kg の箱・8m/s・Cd0.8 で a = 0.085 m/s²）、
//   眠りのしきい値 SLEEP_LIN_TH に届く前に updateSleeping が速度を 0 に戻してしまう。
//   実測：この門番が無いと 3000tick 回しても 0.001 m/s から動き出せなかった。
//   動力（Thruster）を付けた物体を眠らせないのと同じ扱いにする。
function bodyInActiveFlow(b) {
  if (!flowFields.length) return false;
  for (const f of flowFields) {
    if (!(f.speed > 0)) continue;
    // ★速度の合成のほうは Cd も密度も要らない。さらに眠らせてはいけない理由が強い：
    //   updateSleeping は眠らせるときに速度を 0 にするので、媒質が運んでいる下駄まで
    //   消えてしまい、川の中で船が止まる（_flowU との帳尻も合わなくなる）。
    if (f.isAdvect()) { if (f.contains(b.x, b.y)) return true; continue; }
    if (!(f.density > 0) || !(b.drag > 0)) continue;
    if (f.contains(b.x, b.y)) return true;
  }
  return false;
}
// 領域の中にいて、抗力係数が 0 のせいで流れを受けられない物体の数。
// ★パネルの注記に出す。置いても何も起きないときに、理由が画面から読めるようにする
//   （加熱・冷却の領域が「断熱のものには与えない」を注記で説明しているのと同じ）。
function flowFieldInertCount(f) {
  if (f.isAdvect()) return 0;      // 速度の合成は Cd に依らないので、この注記は要らない
  let n = 0;
  for (const b of objects) {
    if (b.isStatic || !(b.areaM2() > 0)) continue;
    if (b.drag > 0) continue;
    if (heatFieldBodyAreaM2(f, b) > 0) n++;
  }
  return n;
}

// 抗力モードで、流れの力より地面との静止摩擦のほうが大きくて動けない物体の数。
// ★これもパネルの注記に出す。空気は薄いので、地面に置いた物体はまず動かない
//   （実測：80×80px の箱 19.2kg で、風 8m/s の力 1.2N に対し μs·mg ＝ 113N）。
//   摩擦係数は地面との合成ではなく物体側の値で見積もる＝目安であって判定ではない。
function flowFieldStuckCount(f) {
  if (f.isAdvect() || !(f.speed > 0) || !(f.density > 0)) return 0;
  const g = Math.hypot(gravPxX(), gravPxY()) * PX2M;      // [m/s²]
  if (!(g > 0)) return 0;
  const u = f.velPx();
  let n = 0;
  for (const b of objects) {
    if (b.isStatic || b.frozen || !b.hasGravity || !(b.drag > 0) || !(b.mass > 0)) continue;
    if (!b._contactThisTick && !b.sleeping) continue;     // 何にも接していない＝摩擦で止まらない
    if (!(heatFieldBodyAreaM2(f, b) > 0)) continue;
    const rx = u.x - b.vx, ry = u.y - b.vy;
    const r = Math.hypot(rx, ry);
    if (!(r > 1e-6)) continue;
    const A  = _flowWidthM(b, rx/r, ry/r) * world.depth;
    const Fn = 0.5 * f.density * b.drag * A * (r*PX2M) * (r*PX2M);
    if (Fn < (b.frictionStatic || b.friction || 0) * b.mass * g) n++;
  }
  return n;
}

// ═══ 描画（物体より下のレイヤー）═══════════════════════════════
function drawFlowFields() {
  if (!flowFields.length) return;
  ctx.save();
  for (let i = flowFields.length - 1; i >= 0; i--) {      // 先頭ほど手前
    const f = flowFields[i];
    // ★ワールドの矩形として描く（scene.js の worldRectPath の★）
    const col = FLOWFIELD_COLOR;
    const sel = selectedElement && selectedElement.kind === 'flowfield' && selectedElement.field === f;
    const q = worldRectPath(ctx, f.x, f.y, f.w, f.h);
    ctx.fillStyle = hexToRgba(col, 0.07);
    ctx.fill();
    ctx.setLineDash(sel ? [] : [6, 4]);
    ctx.strokeStyle = sel ? '#4fc3f7' : hexToRgba(col, 0.55);
    ctx.lineWidth = sel ? 2.5 : 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
    if (f.speed > 0) _drawFlowGlyphs(f, col);
    ctx.fillStyle = hexToRgba(col, 0.9);
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`流れ ${f.label()}（${f.modeName()}）`, q[0].x + 4, q[0].y - 3);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}
// 流線（流れの向きへ伸びる矢印）。
//   ★間隔はワールド基準で決める。画面px基準にすると、拡大したとき本数が増えて模様が
//     流れて見える（_drawEMGlyphs / _drawHeatGlyphs の★と同じ）。
//   ★マス目もワールドで割る（_drawEMGlyphs の★と同じ）。
function _drawFlowGlyphs(f, col) {
  const stepW = 44, minPx = 16;
  let nx = Math.max(1, Math.round(f.w / stepW)), ny = Math.max(1, Math.round(f.h / stepW));
  nx = Math.max(1, Math.min(nx, Math.floor(f.w * cam.zoom / minPx)));
  ny = Math.max(1, Math.min(ny, Math.floor(f.h * cam.zoom / minPx)));
  const W = f.w * cam.zoom, H = f.h * cam.zoom;
  const L = Math.min(16, Math.min(W / nx, H / ny) * 0.7);   // 矢印の長さ [画面px]
  const _u = worldToScreenDir(Math.cos(f.angle), Math.sin(f.angle));   // ★向きはカメラの回転を通す
  const ux = _u.x, uy = _u.y;
  ctx.strokeStyle = hexToRgba(col, 0.6);
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const _c = worldToScreen(f.x - f.w/2 + f.w * (i + 0.5) / nx,
                             f.y - f.h/2 + f.h * (j + 0.5) / ny);
    const cx = _c.x, cy = _c.y;
    const hx = ux * L/2, hy = uy * L/2;
    ctx.beginPath();
    ctx.moveTo(cx - hx, cy - hy); ctx.lineTo(cx + hx, cy + hy);
    // 矢尻（先端から後ろへ2本）
    const k = L * 0.32;
    ctx.moveTo(cx + hx, cy + hy);
    ctx.lineTo(cx + hx - ux*k - uy*k*0.6, cy + hy - uy*k + ux*k*0.6);
    ctx.moveTo(cx + hx, cy + hy);
    ctx.lineTo(cx + hx - ux*k + uy*k*0.6, cy + hy - uy*k - ux*k*0.6);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

// ═══ 保存・復元 ═══════════════════════════════════════════════
function serializeFlowField(f) {
  return { id:f.id, x:f.x, y:f.y, w:f.w, h:f.h, speed:f.speed, angle:f.angle, density:f.density, mode:f.mode };
}
function deserializeFlowFields(arr) { return (arr || []).map(d => new FlowField(d)); }
