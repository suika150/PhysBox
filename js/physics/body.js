// 背景摩擦の「静止しているとみなす」しきい値。これ以下の速さ・角速度なら静止摩擦の判定へ回す。
// （動摩擦で減速しきった物体がいつまでも微速で這うのを防ぐ役目も兼ねる）
const BG_REST_VM = 0.02;    // [m/s]
const BG_REST_AV = 0.05;    // [rad/s]
// ─── 動力（1つの物体に何個でも付く）───────────────────────────────
//  ★以前は Body が thrusterForce / thrusterDir / thrusterAnchorX / thrusterAnchorY の
//    4つのスカラーで**1個だけ**持っていた。2個目を置くと1個目を黙って上書きしていた。
//  ★id を持つ（レーザー・波源と同じ扱い）。リモコンは相手を id で指すので、番号が
//    作り直しのたびに変わると、保存や「戻る」のたびに結びつきが切れる。
//  ★`body` は「どの物体に付いているか」の逆参照。**保存しない**（toJSON で落とす）。
//    落とさないと Body → thrusters → body の輪ができて JSON にできず、
//    「戻る」（history.js の JSON.parse(JSON.stringify(b))）がその場で落ちる。
class Thruster {
  constructor(o, body) {
    o = o || {};
    this.id = o.id !== undefined ? o.id : ++uidCounter;
    if (o.id !== undefined && o.id > uidCounter) uidCounter = o.id;
    // ★負の推力も許す（1本のつまみで押す／引くを切り替える題材がある。
    //   demos-thermal.js の P-V の窓が −F 〜 +F のつまみを使っている）。
    this.force  = o.force  || 0;      // [N]
    this.dir    = o.dir    || 0;      // [rad] 物体基準の向き（+X＝推力方向 / −X＝噴射方向）
    this.localX = o.localX || 0;      // 力点（物体のローカル座標 [px]）
    this.localY = o.localY || 0;
    this.body = body || null;
  }
  // 力点のワールド座標（物体が回れば一緒に回る）
  worldPos() {
    const b = this.body;
    if (!b) return { x: this.localX, y: this.localY };
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    return { x: b.x + this.localX*c - this.localY*s,
             y: b.y + this.localX*s + this.localY*c };
  }
  worldDir() { return (this.body ? this.body.angle : 0) + this.dir; }
  toJSON() { const o = { ...this }; delete o.body; delete o._remoteHold; delete o._remoteStop; return o; }
}
// 世界じゅうの動力（リモコンのつなぎ先・一覧・一括選択が引く唯一の入口）。
//   ★物体の並び順で返す。オブジェタブの並びと一括選択の代表（list[0]）が揃う。
function allThrusters() {
  const out = [];
  for (const b of objects) for (const t of b.thrusters) out.push(t);
  return out;
}
// その物体に効いている動力があるか（眠らせてよいかの判定に使う）
function bodyHasThrusters(b) { return b.thrusters.length > 0; }
// 動力を1つ外す。★つないであったリモコンは何もしなくてよい——Remote.targets() が
//   「消えた相手は黙って落とす」ので、指し先を失った窓は残りの相手だけで動き続ける
//   （レーザーや波源を消したときとまったく同じ扱い）。
function removeThruster(b, th) {
  const i = b.thrusters.indexOf(th);
  if (i >= 0) b.thrusters.splice(i, 1);
}
class Body {
  constructor(opts) {
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.type = opts.type || 'box';
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.angle = opts.angle || 0;
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.av = opts.av || 0;
    this.mass = 1;
    this.invMass = 1;
    this.inertia = 0;
    this.invInertia = 0;
    this.density = opts.density !== undefined ? opts.density : null;
    this.restitution = opts.restitution !== undefined ? opts.restitution : 0.4;
    this.friction = opts.friction !== undefined ? opts.friction : 0.5;
    this.frictionStatic = opts.frictionStatic !== undefined
      ? Math.max(opts.frictionStatic, this.friction) : this.friction;
    this.drag = opts.drag !== undefined ? opts.drag : 0;
    // ★熱：温度は内部では絶対温度 K（UI では ℃）。熱容量 C = heatCap × mass。
    //   heatCap か conduct が0の物体は熱のやりとりから外れる＝完全な断熱材。
    this.temp    = opts.temp    !== undefined ? opts.temp    : ROOM_K;   // [K]
    this.heatCap = opts.heatCap !== undefined ? opts.heatCap : 1000;     // 比熱 c [J/(kg·K)]
    this.conduct = opts.conduct !== undefined ? opts.conduct : 1.0;      // 熱伝導率 k [W/(m·K)]
    // ★放射率 ε（0〜1）。**既定は 0 ＝ 放射しない。** 実物どおりの 0.9 を既定にすると、
    //   既存のシーンで温めた物体がすべて勝手に冷え始める（radiation.js の★）。
    //   空気抵抗（drag）を既定 0 にしてあるのと同じ扱い。
    this.emissivity = opts.emissivity !== undefined ? opts.emissivity : 0;
    // ★恒温物体＝熱容量が無限大の理想的な熱源／冷源。温度が動かず、いくらでも
    //   熱を出し入れできる。氷水や加熱板を置くのに使う。出入りした熱は
    //   reservoirHeatTotal に別勘定で積むので、系の熱量の台帳は閉じたままになる。
    this.tempFixed = !!opts.tempFixed;
    this.isStatic = opts.isStatic || false;
    // ★外から一定の速度で駆動されている物体（モーターに繋がれた歯車・ベルトの類）。
    //   逆質量を0にするので、どんな力積を受けても速度が変わらない。第3法則は破れるが、
    //   これは「背景に固定」がすでに受け入れている破り方の“動く版”であって、新種ではない
    //   （静的な壁で球を跳ね返しても、球と壁の系の運動量は保存していない）。
    //   ★並進だけを止める。回転は普通に扱う＝モーター（回転速度＋最大トルク）と併用でき、
    //     衝突で回りもする。定速回転はモーター側の役目なので、ここでは奪わない。
    this.constVel = opts.constVel || false;
    // ★生成口。プログラムの「生成」がこれを立てる。物理には一切参加しないが、
    //   物体としてのプロパティは全部ふつうに持っている＝「出てくる物体の型」。
    //   ・当たらない・レーザーも水も透過する・積分もされない（速度を持っても動かない）
    //   ・でも右パネル・速度ツール・編集ツールはそのまま効く（Body のままなので配線ゼロ）
    //   ★layers を 0 にして表すことはできない。layers はそのまま複製先へ渡す値だから、
    //     0 にすると出てきた物体まで透過してしまう。だから独立したフラグにしてある。
    this.isSpawner = opts.isSpawner || false;
    this.fixedRotation = opts.fixedRotation || false;
    // ★反射防止コート。輪郭のどこからどこまでを覆うかを {s, len}（周長に対する割合）で持つ。
    //   1つの物体に何枚でも付けられる（重なりは単に和。どちらでも反射率0なので競合しない）。
    //   詳しくは js/optics/arcoat.js。付けていない物体では null のまま＝光の扱いは一切変わらない。
    this.arCoats = opts.arCoats || null;
    // ★ロープの先端おもり（掴んで引くための取っ手）。ロープを消すと一緒に消える。
    //   詳しくは js/physics/rope.js の addRopeTip を参照。
    this.ropeTip = !!opts.ropeTip;
    this.guideEnabled = opts.guideEnabled || false;
    this.guideAngle   = opts.guideAngle || 0;
    this.guidePx = opts.guidePx !== undefined ? opts.guidePx : (opts.x || 0);
    this.guidePy = opts.guidePy !== undefined ? opts.guidePy : (opts.y || 0);
    this.layers = opts.layers !== undefined
      ? (opts.layers & LAYER_ALL)
      : ((opts.isSensor || opts.noCollide) ? 0 : LAYER_DEFAULT);
    this.sleeping = false;
    this.sleepTimer = 0;
    this.held = false;
    this.fillColor = opts.fillColor || '#4fc3f7';
    this.strokeColor = opts.strokeColor || '#ffffff';
    this.strokeWidth = opts.strokeWidth !== undefined ? opts.strokeWidth : 1.5;
    this.alpha = opts.alpha !== undefined ? opts.alpha : 1;
    this.label = opts.label || '';
    // ★軌跡の「入っているか」も opts から受ける。取り付け点・色・保持秒数だけを読んで
    //   ここを false 固定にしていたころは、シーンを読み込んでも「戻る」を押しても
    //   （どちらも new Body(控えた値) で作り直す）軌跡だけが外れて消えていた。
    this.tracerEnabled = !!opts.tracerEnabled;
    // 記録済みの点は保存しない（見せ方だけの一時状態）。読み込み直後は空から貯め直す
    this.tracePoints = [];
    // ストロボ表示の残像 {x, y, angle}。★保存しない（tracePoints と同じ、見せ方だけの一時状態）
    this.strobePoints = [];
    this.tracerAnchorX = opts.tracerAnchorX || 0;   // 軌跡の記録点（ローカル座標）
    this.tracerAnchorY = opts.tracerAnchorY || 0;
    this.tracerColor = opts.tracerColor || '#ff7043';   // ★軌跡の色
    this.tracerDuration = opts.tracerDuration !== undefined ? opts.tracerDuration : 5;   // ★軌跡の保持秒数[s]（時間基準で古い点を破棄）
    // 動力。★何個でも付く（Thruster の★）。逆参照を張るのでここで作り直す
    //   （シーンの読み込みも「戻る」も new Body(控えた値) を通るので、この1行で足りる）。
    this.thrusters = (opts.thrusters || []).map(t => new Thruster(t, this));
    this.hasGravity = opts.hasGravity !== undefined ? opts.hasGravity : true;
    this.ior = opts.ior !== undefined ? opts.ior : 0;   // d線屈折率 n_d（0=不透明。ガラス等で>1）
    // ★アッベ数 V_d と分散のON/OFF。V_d は常に実在する値（1〜100）を持ち、分散を切るのは
    //   dispersion 側で行う（V_d=0 は物理的には無分散ではなく分散無限大なので使わない）。
    //   旧シーンは abbe:0 を「分散なし」の印に使っていたので、そこだけOFF＋既定値へ読み替える。
    this.dispersion = opts.dispersion !== undefined ? !!opts.dispersion : (opts.abbe > 0);
    this.abbe = (opts.abbe > 0) ? opts.abbe : ABBE_DEFAULT;
    this.charge    = opts.charge    !== undefined ? opts.charge    : 0;   // ★電荷 [C]
    this.conductor = opts.conductor !== undefined ? !!opts.conductor : false; // ★導体（レール上で棒として機能）
    // ★電気力線・等電位線を描くときの「場の源」に含めるか（既定は含める）。
    //   表示だけの選択で、クーロン力の計算からは外れない（charge-field.js の★）。
    this.fieldSource = opts.fieldSource !== undefined ? !!opts.fieldSource : true;
    this.opticKind = opts.opticKind || null;   // 光学素子種（convexLens 等。通常物体は null）
    this.opticH = opts.opticH || 0;            // 開口半径（作成時のドラッグで決定）
    this.showProfile = opts.showProfile !== undefined ? !!opts.showProfile : true;   // スクリーンの強度分布を描くか
    this.focal = opts.focal || 0;              // 焦点距離の大きさ（凹レンズは発散＝表示上は負）
    // ★理想化。球面をスネルの法則で解く代わりに、薄肉レンズの光線変換だけをかける
    //   （＝球面収差も色収差も無い教科書のレンズ・鏡になる）。詳細は traceLaser 側。
    this.opticIdeal = opts.opticIdeal !== undefined ? !!opts.opticIdeal : false;
    this.opticArcs = opts.opticArcs || null;   // ★曲面の元の円（レイキャストの法線に使う）
    // ★回折格子のスリット（opticKind==='grating' のときだけ意味を持つ）。
    //   板の中央に、間隔 d で N 本のスリットが長手方向（局所y）へ並ぶ。
    //   幾何的な穴としては開けない：穴にすると通った光がまっすぐ進むだけになり、
    //   回折（波面の再放射）が起きず縞が出ない。開口の判定は traceLaser が行う。
    this.slitN = opts.slitN !== undefined ? Math.max(1, Math.round(opts.slitN)) : 0;   // 0=格子ではない
    this.slitD = opts.slitD !== undefined ? Math.max(1, opts.slitD) : 0;               // [px] 間隔 d
    this.slitA = opts.slitA !== undefined ? Math.max(0.5, opts.slitA) : 0;             // [px] 幅 a
    // ★1本のスリットを何個の波源（副開口）に分けて扱うか。0＝自動。
    //   物理の設定ではなく計算の細かさで、遠方の模様は分割数によらない
    //   （幅 Δ の副開口には sinc(πΔ·sinθ/λ) を式として掛けているので、
    //     1個でも「幅 a の開口そのもの」を表す＝無限分割の極限と厳密に一致する）。
    //   分けて初めて変わるのは近接場だけ。自動では a/λ から必要なぶんだけ分ける。
    this.slitM = opts.slitM !== undefined ? Math.max(0, Math.round(opts.slitM)) : 0;
    this.reflective = opts.reflective !== undefined ? opts.reflective
      : (opts.opticKind === 'planeMirror' || opts.opticKind === 'curvedMirror');   // 鏡（不透明な反射面）か
    // ★反射率 R（0..1）：鏡だけでなくすべての物体が持つ。界面に来た光のうち R が反射し、
    //   残り 1−R は 透明（ior>1）なら屈折して進み、不透明なら吸収される。
    //   旧シーンは鏡の「透過率 T」しか持たないので、鏡に限って R = 1 − T を引き継ぐ。
    //   （旧シーンは鏡でない物体にも transmittance:0 を書き出しているので、
    //     鏡かどうかで分けないと、木材や石まで全反射になってしまう）
    this.reflectance = opts.reflectance !== undefined ? clamp01(opts.reflectance)
      : (!this.reflective ? 0
         : (opts.transmittance !== undefined ? 1 - clamp01(opts.transmittance) : 1));
    // ★フレネルの式で反射率を入射角から自動計算するか（透明な物体でのみ意味を持つ）。
    //   ONにすると水滴の背面で数%だけ内部反射する＝虹が正しい明るさ・正しい角度で出る。
    //   既定はOFF。ONだとレンズやプリズムにも実物と同じゴースト（数%の反射光）が出るので、
    //   虹のように必要な場面で物体ごとに入れる。
    this.fresnel = opts.fresnel !== undefined ? !!opts.fresnel : false;
    // ★波動場での扱い。pass=素通り／medium=屈折／fixed=固定端反射／free=自由端反射
    //   光の ior は流用できない（光はガラスで遅く、音は逆に速い＝屈折が逆向きになる）
    //   既定は固定端＝剛体壁。空気と固体では音響インピーダンスが桁違いなので、壁面で
    //   媒質は動けない＝変位の節になる（気柱の閉端と同じ）。この場は変位 u を解いている
    //   ので固定端が正解で、自由端になるのは開口部（開管の端）の側。地面の既定と揃える。
    this.waveMode  = opts.waveMode || 'fixed';
    this.waveIor = opts.waveIor !== undefined ? opts.waveIor
      : (opts.waveSpeed > 0 ? 2.0 / opts.waveSpeed : 1.5);
    this.showForces = opts.showForces || false;  // この物体の力ベクトルを表示
    this.showVelocity = opts.showVelocity || false;  // ★この物体の速度ベクトルを表示
    this._forces = {};                            // { type: {fx,fy} } 1フレーム分の力積を蓄積
    // ★偶力のモーメント（拘束が伝える回転の作用）。力の矢印では表せないので別に持つ。
    //   溶接＝固定支持は力2成分＋モーメントを伝えるが、モーメントを描かないと
    //   「上向きの力しか受けていないのに回らない」という破綻した自由物体図になる。
    this._torques = {};                           // { type: {tz,px,py} } 1フレーム分の角力積
    this._contactThisTick = false;                // ★このtickで実接触したか（接触力の残像対策）
    // shape-specific（形状の確定のみ。慣性はここでは計算しない）
    this.partEdgeInternal = null;   // ★凸パーツごとの内部エッジフラグ（凸形状は null）
    if (this.type === 'circle') {
      this.radius = opts.radius || 30;
    } else if (this.type === 'box') {
      this.w = opts.w || 60;
      this.h = opts.h || 60;
      const hw=this.w/2, hh=this.h/2;
      this.convexParts = [[{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}]];
    } else if (this.type === 'polygon') {
      // ★同じ位置の頂点は取り除く。多角形ツールは確定のダブルクリックで最後の点を
      //   二重に入れるため、そのままだと長さ0の辺ができて凸分解が途中で止まり、
      //   図形の一部が当たり判定から抜け落ちる（見た目はあるのにすり抜ける）。
      //   保存済みのシーンを読み直したときもここで直る。
      this.verts = dedupePolyLoop(opts.verts || []);
      this.holes = (opts.holes || []).map(h => dedupePolyLoop(h)).filter(h => h && h.length >= 3);
      // ★元が円だった区間（図形和ツールが残した円弧）。その区間は真円として衝突を解く
      this.arcs  = (opts.arcs && opts.arcs.length) ? opts.arcs : null;
      // ★歯車ツールで描いた形なら歯数とモジュール（かみ合わせの吸着だけが使う。gear.js）
      this.gear  = opts.gear ? { z: opts.gear.z, m: opts.gear.m } : null;
      // ★歯車コートで刻んだ歯の面の控え（吸着だけが使う。形は verts に焼き込み済み）
      this.toothFaces = (opts.toothFaces && opts.toothFaces.length) ? opts.toothFaces.map(f => ({ ...f })) : null;
      const cp = buildConvexParts(this.verts, this.holes);   // ★
      this.convexParts      = cp.parts;
      this.partEdgeInternal = cp.internal;
      this.partEdgeArc      = buildPartArcFlags(cp.parts, this.arcs);
    }
    if (this.opticKind && !this.opticArcs && this.type === 'polygon' && this.opticH > 0) {
      const g = opticGeometry(this.opticKind, this.opticH, this.focal, this.ior, this.opticIdeal);
      if (g) this.opticArcs = g.arcs;
    }
    if (opts.mass > 0) this.setMass(opts.mass);
    else {
      if (this.density == null) this.density = 600;   // 密度未指定なら木材相当を既定に
      this.setMass(this.massFromDensity());
    }
    // AABB cache
    this._aabb = { minX:0, minY:0, maxX:0, maxY:0 };
    this._updateAABB();
  }
  _calcInertiaCircle() {
    this.inertia = 0.5 * this.mass * this.radius * this.radius;
    this.invInertia = this.mass > 0 ? 1 / this.inertia : 0;
  }
  _calcInertiaBox() {
    this.inertia = (1/12) * this.mass * (this.w*this.w + this.h*this.h);
    this.invInertia = this.mass > 0 ? 1 / this.inertia : 0;
  }
  _calcInertiaPolygon() {
    if (!this.verts.length) return;
    // ★1辺ごとの cross は「符号つき」で足す。ここを Math.abs にしてはいけない。
    //   この積分は「原点と辺で作る三角形」を全部足し合わせる形（靴ひも公式）で、
    //   図形の外側へはみ出した三角形は負で入って打ち消えることで成り立っている。
    //   1辺ずつ絶対値を取るとその打ち消しが消え、へこんだ図形で結果が壊れる。
    //   実測（mass=1 での I/m [px²]、理論値と比べて）：
    //     中実 900x120 … 6.87e4（一致）／中央に穴 … 7.71e4（一致）／L字 … 6.67e3（一致）
    //     歯のついた空洞のさお … −3.25e9（理論は 7〜9e4 程度）＝ 負の慣性モーメント。
    //   凸な図形や、原点から見て全部の辺が同じ向きに回る図形ではたまたま一致するので、
    //   ふつうの箱や三角形では表に出てこなかった。くし形の空洞のように、辺が行って
    //   戻ってくる形で初めて壊れる。負になると下の `inertia > 0` が偽になり、
    //   invInertia = 0 ＝「回転しない物体」になって静かに壊れる（天秤のさおが傾かない）。
    // ★ループ全体の符号は最後にそろえる。穴は外周と逆向きに巻かれていることがあり、
    //   そのままだと差し引きが足し算になるため（頂点の並び順に結果を依存させない）。
    const loopIntegral = (loop) => {
      let I = 0, area = 0;
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const a = loop[i], b = loop[(i+1)%n];
        const cross = a.x*b.y - b.x*a.y;
        I += cross * (a.x*a.x + a.y*a.y + a.x*b.x + a.y*b.y + b.x*b.x + b.y*b.y);
        area += cross;
      }
      return area < 0 ? { I: -I, area: -area } : { I, area };
    };
    let { I, area } = loopIntegral(this.verts);
    if (this.holes) for (const h of this.holes) {       // 穴の寄与を差し引く
      if (h.length < 3) continue;
      const hi = loopIntegral(h);
      I -= hi.I; area -= hi.area;
    }
    this.inertia = (I / (6 * (area > 0 ? area : 1))) * this.mass;
    this.invInertia = this.mass > 0 && this.inertia > 0 ? 1 / this.inertia : 0;
  }
  // 面積 [px²]（穴を差し引く）
  area() {
    const loopArea = loop => {
      let a = 0;
      for (let i = 0; i < loop.length; i++) { const p = loop[i], q = loop[(i+1)%loop.length]; a += p.x*q.y - q.x*p.y; }
      return Math.abs(a) / 2;
    };
    if (this.type === 'circle') return Math.PI * this.radius * this.radius;
    if (this.type === 'box')    return this.w * this.h;
    if (this.type === 'polygon' && this.verts.length >= 3) {
      let a = loopArea(this.verts);
      if (this.holes) for (const h of this.holes) if (h.length >= 3) a -= loopArea(h);
      return Math.max(a, 1);
    }
    return 1;
  }
  areaM2() { return this.area() * PX2M * PX2M; }                          // [m²]
  massFromDensity() { return Math.max(1e-3, this.density * this.areaM2() * world.depth); }  // [kg]
  // 質量を設定し、invMass と慣性モーメントを一括で整合させる
  setMass(m) {
    this.mass = Math.max(1e-6, m);
    // ★constVel も逆質量0。これ1つで接触ソルバ・ジョイント・ロープの全部が
    //   「押しても動かない」を守る（各所の imA/imB は invMass をそのまま読むため）。
    this.invMass = (this.isStatic || this.constVel) ? 0 : 1 / this.mass;
    if (this.type === 'circle')       this._calcInertiaCircle();
    else if (this.type === 'box')     this._calcInertiaBox();
    else if (this.type === 'polygon') this._calcInertiaPolygon();
    // inertia（慣性モーメントそのもの）は物理量として残し、逆数だけをゼロにする
    if (this.isStatic || this.fixedRotation) this.invInertia = 0;
  }
  setStatic(v) {
    this.isStatic = !!v;
    this.sleeping = false; this.sleepTimer = 0;
    this.setMass(this.mass);
  }
  // ★一定の速度で駆動する／やめる。やめた瞬間はそのときの速度のまま自由になる
  //   （手を離した台車と同じ。速度を0に落とすと「駆動を切ったら消える」ように見える）
  setConstVel(v) {
    this.constVel = !!v;
    this.sleeping = false; this.sleepTimer = 0;
    this.setMass(this.mass);   // invMass を確定させる
  }
  // ★回転の可否を切り替える。ONにした瞬間、残っていた角速度も捨てる
  setFixedRotation(v) {
    this.fixedRotation = !!v;
    if (this.fixedRotation) this.av = 0;
    this.sleeping = false; this.sleepTimer = 0;
    this.setMass(this.mass);   // invInertia を確定させる
  }
  // 速度に垂直な投影幅 [m]（2Dなので断面積は 幅 × world.depth）
  dragWidthM(speedPx) {
    if (this.type === 'circle') return this.radius * 2 * PX2M;
    const inv = 1 / (speedPx || 1);
    const nx = -this.vy * inv, ny = this.vx * inv;
    let mn = Infinity, mx = -Infinity;
    for (const v of this._worldVerts()) { const d = v.x*nx + v.y*ny; if (d < mn) mn = d; if (d > mx) mx = d; }
    return Math.max(mx - mn, 1) * PX2M;
  }
  _localOutline() {                       // 外周のローカル頂点（box は初回だけ生成）
    if (this.type === 'box') {
      if (!this._lv) { const hw=this.w/2, hh=this.h/2; this._lv=[{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}]; }
      return this._lv;
    }
    return this.verts || [];
  }
  _invalidateShape() { this._lv = null; this._wv = null; this._wp = null; this._wh = null; this._wpbb = null; }  // 形状を作り直したら呼ぶ
  _ensureWorldCache() {
    if (this._wv && this._wvX === this.x && this._wvY === this.y && this._wvA === this.angle) return;
    const lv = this._localOutline();
    if (!this._wv || this._wv.length !== lv.length) {   // 初回／形状変更時のみ確保
      this._wv = lv.map(() => ({ x: 0, y: 0 }));
      this._wp = (this.convexParts && this.convexParts.length)
        ? this.convexParts.map(p => p.map(() => ({ x: 0, y: 0 })))
        : null;
      this._wh = (this.holes && this.holes.length) ? this.holes.map(h => h.map(() => ({ x: 0, y: 0 }))) : [];
    }
    const x = this.x, y = this.y, cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    for (let i = 0; i < lv.length; i++) {
      const v = lv[i], o = this._wv[i];
      o.x = x + v.x*cos - v.y*sin;  o.y = y + v.x*sin + v.y*cos;
    }
    if (this._wp) {
      const cp = this.convexParts;
      for (let k = 0; k < cp.length; k++) {
        const p = cp[k], w = this._wp[k];
        for (let i = 0; i < p.length; i++) {
          const v = p[i], o = w[i];
          o.x = x + v.x*cos - v.y*sin;  o.y = y + v.x*sin + v.y*cos;
        }
      }
    }
    const hs = this.holes;
    if (hs && hs.length) for (let k = 0; k < hs.length; k++) {
      const h = hs[k], w = this._wh[k];
      for (let i = 0; i < h.length; i++) {
        const v = h[i], o = w[i];
        o.x = x + v.x*cos - v.y*sin;  o.y = y + v.x*sin + v.y*cos;
      }
    }
    this._wvX = x; this._wvY = y; this._wvA = this.angle;
  }
  _worldVerts()     { if (this.type === 'circle') return []; this._ensureWorldCache(); return this._wv; }
  _worldParts()     { this._ensureWorldCache(); return this._wp || [this._wv]; }
  _worldPartAt(i)   { this._ensureWorldCache(); return this._wp ? this._wp[i] : this._wv; }
  // ★凸パーツごとのワールド AABB（detectCollision のふるい）。姿勢が変わったときだけ作り直す。
  //   判定のたびに作っていると、パーツの多い物体（内歯車 502 個）が相手の数×サブステップ数
  //   だけ作り直すことになり、遊星歯車の組で 1tick に 8000 個を作っていた。
  _worldPartBoxes() {
    const wp = this._worldParts();
    if (this._wpbb && this._wpbb.length === wp.length && this._wpbbX === this._wvX
        && this._wpbbY === this._wvY && this._wpbbA === this._wvA) return this._wpbb;
    if (!this._wpbb || this._wpbb.length !== wp.length) this._wpbb = wp.map(() => ({ minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, r: 0 }));
    for (let k = 0; k < wp.length; k++) {
      const v = wp[k], o = this._wpbb[k];
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity, sx = 0, sy = 0;
      for (let i = 0; i < v.length; i++) { const p = v[i]; sx += p.x; sy += p.y;
        if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x; if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y; }
      o.minX = mnx; o.minY = mny; o.maxX = mxx; o.maxY = mxy;
      // ★外接円（頂点の平均を中心に、いちばん遠い頂点まで）も持つ。斜めに伸びたパーツは
      //   AABB が面積の何倍にもなってふるいを素通りする（歯車の歯元のパーツ。時計デモの★）
      const cx = sx / v.length, cy = sy / v.length;
      let r2 = 0;
      for (let i = 0; i < v.length; i++) { const dx = v[i].x - cx, dy = v[i].y - cy, d = dx*dx + dy*dy; if (d > r2) r2 = d; }
      o.cx = cx; o.cy = cy; o.r = Math.sqrt(r2);
    }
    this._wpbbX = this._wvX; this._wpbbY = this._wvY; this._wpbbA = this._wvA;
    return this._wpbb;
  }
  _worldHoles()     { if (this.type !== 'polygon' || !this.holes || !this.holes.length) return []; this._ensureWorldCache(); return this._wh; }
  _updateAABB() {
    if (this.type === 'circle') {
      this._aabb = { minX: this.x-this.radius, minY: this.y-this.radius, maxX: this.x+this.radius, maxY: this.y+this.radius };
    } else {
      const verts = this._worldVerts();
      let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
      for (const v of verts) {
        if (v.x < mnx) mnx=v.x; if (v.y < mny) mny=v.y;
        if (v.x > mxx) mxx=v.x; if (v.y > mxy) mxy=v.y;
      }
      // ★出っ張り側の円弧は多角形の辺より外側へふくらむので、その分だけ広げる
      //   （へこみ側＝穴の内壁は多角形の内側なので広げる必要はない）
      if (this.arcs) {
        let bulge = 0;
        for (const a of this.arcs) if (!a.concave && a.bulge > bulge) bulge = a.bulge;
        if (bulge > 0) { mnx -= bulge; mny -= bulge; mxx += bulge; mxy += bulge; }
      }
      this._aabb = { minX:mnx, minY:mny, maxX:mxx, maxY:mxy };
    }
  }

  applyForce(fx, fy, px, py, dt) {
    // ★constVel は逆質量0でも素通しにする。並進こそ効かないが、回転は普通に受ける
    if (this.isStatic || (this.invMass === 0 && !this.constVel)) return;
    this.sleeping = false; this.sleepTimer = 0;
    this.applyImpulse(fx * dt, fy * dt, px, py);
  }
  applyImpulse(jx, jy, px, py) {
    // held＝編集ツールでドラッグ中。位置をカーソルで直接指定しているので、
    // 力積で動かされるとカーソルとずれる。静的物体と同じく一切受け付けない。
    if (this.isStatic || this.held || (this.invMass === 0 && !this.constVel && !this._remoteDrive)) return;
    if (!Number.isFinite(jx) || !Number.isFinite(jy)) return;
    if (this.constVel || this._remoteDrive) {
      // 駆動側が受け止めた分。ガイド（レール）と同じく拘束反力として矢印に出す
      this.recordForce('constraint', -jx, -jy, this.x, this.y, 'constvel');
    } else if (this.guideEnabled) {
      const dx = Math.cos(this.guideAngle), dy = Math.sin(this.guideAngle);
      const jd = jx*dx + jy*dy;
      const ax = jd*dx, ay = jd*dy;
      this.recordForce('constraint', ax - jx, ay - jy, this.x, this.y, 'guide');
      this.vx += ax * this.invMass;
      this.vy += ay * this.invMass;
    } else {
      this.vx += jx * this.invMass;
      this.vy += jy * this.invMass;
    }
    if (px !== undefined && py !== undefined) {
      const rx = px - this.x, ry = py - this.y;
      this.av += (rx*jy - ry*jx) * this.invInertia;
    }
  }
  // ★作用点は「記録した時点の物体の座標系」に直してから貯める（px,py は世界座標で来る）。
  //   世界座標のまま貯めると、貯めてから描くまでに物体が進んだぶん、矢印の根元だけが
  //   後ろに取り残される。力は tick 内の各サブステップで記録され、描くのはその tick が
  //   終わったあとなので、平均するとおよそ 1.5 サブステップぶん過去の場所になる。
  //   実測（加速する電車の振り子。7秒押し続けて秒速 40m）：1 tick に 66px 進む速さで、
  //   張力の矢印の根元がおもりの中心から 25px ずれた（＝0.38 tick ぶん）。止まっている
  //   ものや遅いものでは見えないが、速いほど広がる。重力の矢印がずれないのは、
  //   作用点を渡していない（＝重心を使う）から。
  _localPoint(px, py) {
    const c = Math.cos(-this.angle), s = Math.sin(-this.angle);
    const dx = px - this.x, dy = py - this.y;
    return { x: dx*c - dy*s, y: dx*s + dy*c };
  }
  recordForce(type, fx, fy, px, py, key) {
    if (!this.showForces) return;
    const k = type + ':' + (key !== undefined ? key : '');
    const f = this._forces[k] || (this._forces[k] = { type, fx: 0, fy: 0, px: 0, py: 0, wsum: 0 });
    f.fx += fx; f.fy += fy;
    if (px !== undefined && py !== undefined) {
      const w = Math.hypot(fx, fy);
      const l = this._localPoint(px, py);      // ★上の★。px,py はローカル座標で貯まる
      f.px += l.x * w; f.py += l.y * w; f.wsum += w;
    }
  }

  // 偶力のモーメント [kg·px²/s]（角力積）。力と同じく1フレーム分を種類ごとに足し込む。
  //   px,py は「どの拘束が与えているか」を示すための描画位置（偶力自体は作用点を持たない）。
  recordTorque(type, tz, px, py, key) {
    if (!this.showForces) return;
    const k = type + ':' + (key !== undefined ? key : '');
    const t = this._torques[k] || (this._torques[k] = { type, tz: 0, px: 0, py: 0, wsum: 0 });
    t.tz += tz;
    if (px !== undefined && py !== undefined) {
      const w = Math.abs(tz);
      const l = this._localPoint(px, py);      // ★力と同じ（recordForce の★）
      t.px += l.x * w; t.py += l.y * w; t.wsum += w;
    }
  }
  clearForces() {
    for (const k in this._torques) { this._torques = {}; break; }
    for (const k in this._forces) { this._forces = {}; return; }
  }
integrate(dt) {
    this._gHx = 0; this._gHy = 0;   // ★位置の更新で引いた重力の半分（接触の接線ずれの補正が使う）
    if (this.isSpawner) return;   // ★生成口は動かない。速度は「出てくる物体に渡す値」として持つだけ
    // ★リモコンの〈手で動かす〉で押されている間は、固定してあっても進める（_remoteDrive）。
    //   新しい運動を足すのではなく、下の「等速で駆動されている」一本道へ入れるだけ。
    //   速度は applyRemoteDrives() が毎 tick 書き込み、放した瞬間に 0 へ戻す。
    if (!this._remoteDrive && (this.isStatic || (this.invMass === 0 && !this.constVel))) return;
    if (this.sleeping) return;
    if (this.frozen) return;
    if (this.held) return;

    // ★一定の速度で駆動されている物体は、力を一切受け取らずに位置だけ進める。
    //   重力・空気抵抗・動力・背景摩擦はどれも駆動側が受け止めるので、ここを通さない。
    //   重力だけは矢印に残す（重力が描かれないと「無重力なのか」と読めてしまう）。
    //   打ち消している拘束反力も並べて出すので、2本が釣り合った図になる。
    if (this.constVel || this._remoteDrive) {
      if (this.hasGravity) {
        const ax = gravPxX(), ay = gravPxY();
        this.recordForce('gravity', this.mass*ax*dt, this.mass*ay*dt);
        this.recordForce('constraint', -this.mass*ax*dt, -this.mass*ay*dt,
                         this.x, this.y, 'constvel');
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.fixedRotation) this.av = 0;
      this.angle += this.av * dt;
      this._updateAABB();
      return;
    }

    // ★背景摩擦の判定用に「この一歩で他の力が入る前」の速度を控える。
    //   静止摩擦は「加えられた力が μs·N を超えたか」で決まるので、増分を見る必要がある。
    const _v0x = this.vx, _v0y = this.vy, _av0 = this.av;

    let gHx = 0, gHy = 0;                // 重力による速度の増し分の半分（下の位置更新の★）
    if (this.hasGravity) {
      const ax = gravPxX(), ay = gravPxY();
      this.vx += ax * dt; this.vy += ay * dt;
      gHx = ax * dt * 0.5; gHy = ay * dt * 0.5;
      this.recordForce('gravity', this.mass*ax*dt, this.mass*ay*dt);
    }

    if (this.drag > 0 && world.airDensity > 0) {
      // ★空気抵抗は「まわりの空気に対する速度」で決まる。流れの場の「速度の合成」モードで
      //   運ばれている物体は、その媒質ごと動いている＝相対速度は v − u なので、下駄を引く。
      //   引かないと、川に流されている船が向かい風を受けて必ず岸と同じ速度まで戻される
      //   （Cd を上げた瞬間に速度の合成が消える）。
      const ux = this._flowU ? this._flowU.x : 0, uy = this._flowU ? this._flowU.y : 0;
      const rx = this.vx - ux, ry = this.vy - uy;
      const v2 = rx*rx + ry*ry;
      if (v2 > 1e-6) {
        const v  = Math.sqrt(v2);
        const vm = v * PX2M;
        // 断面は相対速度に垂直な向きで測る（dragWidthM は法線を自分の速度から作るので、
        // 媒質に運ばれている物体では向きがずれる。向きを渡せる版が流れの場にある）
        const A  = _flowWidthM(this, rx/v, ry/v) * world.depth;
        const Fn = 0.5 * world.airDensity * this.drag * A * vm * vm;
        const aPx = (Fn / this.mass) * M2PX;
        const dvx = -(rx/v) * aPx * dt, dvy = -(ry/v) * aPx * dt;
        const k0 = this.vx*this.vx + this.vy*this.vy;
        this.vx += dvx; this.vy += dvy;
        this.recordForce('drag', this.mass*dvx, this.mass*dvy);
        // ★空気抵抗で削れた運動エネルギーも熱にする。捨てると行方不明になる
        //   （実測：Cd=0.47 で 20m/s から減速させると 9617 J が消えていた）。
        //   実際は空気側が温まるが、空気を物体として持っていないので物体へ入れる。
        addDissipatedHeat(this, null,
          0.5 * this.mass * (k0 - (this.vx*this.vx + this.vy*this.vy)) / (PPM*PPM));
      }
    }

    // ★「全体減衰」（速度を exp(-λt) で一様に減らす設定）は廃止した。
    //   物理量ではないうえ、すぐ隣に本物の空気抵抗（空気密度 × 抗力係数 Cd）があり、
    //   同じ現象を2通りでモデル化できてしまう。放物運動が理論値と合わない原因にもなる。
    // ★動力は1つずつリモコンを付けられるので、押されているかの印（_remoteHold は
    //   0/1/−1。付いていなければ undefined＝いつもどおり）は**物体ではなくその動力**が
    //   持つ。左右の噴射を別のキーで操って曲がる、という使い方がこれで通る。
    //   値そのものは書き換えない——0 で上書きすると、放したときに戻す元の値が消える。
    if (this.thrusters.length) {
      const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
      for (const th of this.thrusters) {
        const tg = th._remoteHold === undefined ? 1 : th._remoteHold;
        if (!th.force || !tg) continue;
        const ta = this.angle + th.dir;
        const F  = th.force * M2PX * tg;            // ★−1 なら向きが反転する
        const fx = Math.cos(ta) * F, fy = Math.sin(ta) * F;
        const ax = this.x + th.localX * cos - th.localY * sin;
        const ay = this.y + th.localX * sin + th.localY * cos;
        this.applyForce(fx, fy, ax, ay, dt);
        // ★力の矢印のキーは動力ごとに分ける（id を渡す）。まとめると2本目以降が
        //   1本目のキーを上書きして、1本しか出なくなる。
        this.recordForce('thrust', fx*dt, fy*dt, ax, ay, th.id);
      }
    }
    this._bgFriction(dt, _v0x, _v0y, _av0);   // ★背景（テーブル面）の摩擦は、他の力を入れ終えた最後にかける
    projectGuideVelocity(this, true);
    // ★位置は「重力の半分だけ手前の速度」で進める（重力を位置の前後に半分ずつ＝速度ベルレ。
    //   一定の力ならこれで厳密：x += v·h + ½g·h²）。速度は今までどおり重力を丸ごと足した値で
    //   ソルバへ渡る。以前は丸ごと足した速度で進めていて（半陰的オイラー）、1サブステップごとに
    //   ½·m·g²·h² ずつ力学的エネルギーが減り、衝突で速度が反転するたびにそれが本当に失われた
    //   （電磁気の力は 2026-09 に同じ理由で直してある。step.js の emStepPre の★）。
    //   実測（気体分子運動論のデモ・乱数固定・120秒）：分子に叩かれて浮いている 99kg のふたが
    //   旧は高さ 255→226px・気体 13→−32℃ と沈み続けた（1秒あたり ½·m·g²·h²×960 ≈ 5 J が
    //   気体から消える）。直すと高さ 249〜259px・9〜21℃ の間を揺れるだけで傾向が無い。
    //   ★背景摩擦が止めた（速度を0にした）ときは引かない。引くと重力と逆へ這い出す。
    //     運動方向固定の物体は、引くぶんもレールの向きに揃える。
    if (gHx || gHy) {
      if (this._bgHold & 1) { gHx = 0; gHy = 0; }
      else if (this.guideEnabled) {
        const gdx = Math.cos(this.guideAngle), gdy = Math.sin(this.guideAngle);
        const gd = gHx*gdx + gHy*gdy;
        gHx = gd*gdx; gHy = gd*gdy;
      }
    }
    this._gHx = gHx; this._gHy = gHy;
    this.x += (this.vx - gHx) * dt;
    this.y += (this.vy - gHy) * dt;
    if (this.fixedRotation) this.av = 0;
    this.angle += this.av * dt;
    this._updateAABB();
    // ★軌跡はここでは記録しない（サブステップごとに1点貯まってしまう）。
    //   tick に一度、step.js がすべての物体をまとめて記録する。理由はその★を参照。
  }

  // ─── 背景（真上から見下ろした水平面）の摩擦 ─────────────────────────
  //   画面を上から見たテーブルとみなしたときの、面と物体のあいだの摩擦。
  //   垂直抗力は画面に垂直な向きの重力から N = m·g⊥（world.bgGravPerp）で決まるので、
  //   減速度は a = F/m = μ·g⊥ となり、教科書どおり質量によらない。
  //   ・静止摩擦：止まっている物体に加わった正味の力が μs·N 以下なら動き出せない（速度を0に保つ）
  //   ・動摩擦  ：動いている間は速度と逆向きに μk·N。1ステップで速度が反転しないようクランプする
  //   ・回転    ：一様な圧力分布の円板とみなすと摩擦トルクは τ = (2/3)·μ·m·g⊥·R。
  //               任意形状は面積から等価半径 R_eff = √(A/π) を作って当てる。
  //   ★画面内の重力がある「横から見た」場面で μ を入れると、空中の物体まで減速して
  //     物理的に誤った運動になる。既定 μ=0 は「摩擦なし」で、そのときは何もしない。
  //   ★ロープ・棒・接触・マウスがかける力は、ソルバが integrate の外から速度を直接
  //     書き換える形で入る。したがって integrate の中だけで静止摩擦を判定すると、
  //     糸で引いた物体は張力が μs·N を超える前から動き出してしまう。
  //     そこで「直前に静止していた自由度」は、ここでいったん速度を0に戻したうえで
  //     判定を保留し（_bgHold）、拘束を解き終えたサブステップの最後に
  //     bgFrictionPost() が加わった速度変化を合計して決着をつける。
  _bgFriction(dt, v0x, v0y, av0) {
    this._bgHold = 0;
    const muK = world.bgFriction || 0, muS = world.bgFrictionStatic || 0;
    if (muK <= 0 && muS <= 0) return;
    const gPx = (world.bgGravPerp || 0) * M2PX;    // [px/s²] 画面に垂直な重力
    if (gPx <= 0) return;

    // ── 並進 ──
    let moving = true;
    if (Math.hypot(v0x, v0y) <= BG_REST_VM * M2PX) {       // 直前は静止していた
      const dvx = this.vx - v0x, dvy = this.vy - v0y;      // この一歩で加えられた速度変化
      if (Math.hypot(dvx, dvy) <= muS * gPx * dt) {        // 正味の力が μs·N 以下 → まだ動き出さない
        this.recordForce('friction', -this.mass * dvx, -this.mass * dvy, this.x, this.y, 'bg');
        this.vx = 0; this.vy = 0;
        moving = false;
        this._bgHold |= 1;                                 // ★ソルバの分を足して判定し直す
        this._bgDvx = dvx; this._bgDvy = dvy;              //   ここで打ち消した分（戻せるよう控える）
        this._bgV0x = v0x; this._bgV0y = v0y;              //   滑り出したときに書き戻す元の速度
      }
    }
    if (moving) {
      const v = Math.hypot(this.vx, this.vy);
      if (v > 1e-9) {
        const dv  = Math.min(muK * gPx * dt, v);           // 1ステップで速度を反転させない
        const dvx = -(this.vx / v) * dv, dvy = -(this.vy / v) * dv;
        this.vx += dvx; this.vy += dvy;
        this.recordForce('friction', this.mass * dvx, this.mass * dvy, this.x, this.y, 'bg');
        // ★背景（テーブル面）との動摩擦で削れたぶんも熱にする
        addDissipatedHeat(this, null,
          0.5 * this.mass * (v*v - (this.vx*this.vx + this.vy*this.vy)) / (PPM*PPM));
      }
    }

    // ── 回転 ── τ = (2/3)·μ·m·g⊥·R_eff、角減速度 α = τ/I（これも質量によらない）
    if (this.invInertia > 0) {
      const Reff = Math.sqrt(Math.max(this.area(), 1e-9) / Math.PI);   // [px] 等価半径
      const tau  = (2 / 3) * this.mass * gPx * Reff;                   // μ を掛ける前の摩擦トルク
      const alp  = tau * this.invInertia;                              // 同じく角減速度 [rad/s²]
      let spinning = true;
      if (Math.abs(av0) <= BG_REST_AV) {
        const dav = this.av - av0;
        if (Math.abs(dav) <= muS * alp * dt) {
          this.recordTorque('friction', -this.inertia * dav, this.x, this.y, 'bg');
          this.av = 0;
          spinning = false;
          this._bgHold |= 2;
          this._bgDav = dav; this._bgAlpha = alp; this._bgAv0 = av0;
        }
      }
      if (spinning && Math.abs(this.av) > 1e-9) {
        const s   = Math.sign(this.av);                    // ★減らす前の向きで記録する
        const dav = Math.min(muK * alp * dt, Math.abs(this.av));
        this.av -= s * dav;
        this.recordTorque('friction', -s * this.inertia * dav, this.x, this.y, 'bg');
      }
    }
  }

  recordTracePoint() {
    if (!this.tracerEnabled) return;
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    // ★貯めるのはワールド座標だけ。回転する物体から見た道すじへは、描くときに
    //   「その時刻の姿勢」を使って直す（js/app/camera.js の姿勢の記録の★）。
    //   ここで特定の系のローカル座標に焼き込むと、あとで別の系へ直せなくなる。
    this.tracePoints.push({
      x: this.x + this.tracerAnchorX * cos - this.tracerAnchorY * sin,
      y: this.y + this.tracerAnchorX * sin + this.tracerAnchorY * cos,
      t: world.simTime,
    });
  }

  trimTracePoints() {
    const cutoff = world.simTime - this.tracerDuration;
    let cut = 0;
    while (cut < this.tracePoints.length && this.tracePoints[cut].t < cutoff) cut++;
    if (this.tracePoints.length > 20000) cut = Math.max(cut, this.tracePoints.length - 20000);
    if (cut > 0) this.tracePoints.splice(0, cut); 
  }
  containsPoint(px, py) {
    const cos = Math.cos(-this.angle), sin = Math.sin(-this.angle);
    const lx = cos*(px-this.x) - sin*(py-this.y);
    const ly = sin*(px-this.x) + cos*(py-this.y);
    if (this.type === 'circle') return lx*lx+ly*ly <= this.radius*this.radius;
    if (this.type === 'box') return Math.abs(lx)<=this.w/2 && Math.abs(ly)<=this.h/2;
    if (this.type === 'polygon') {
      if (!pointInPolygon({x:lx,y:ly}, this.verts)) return false;
      if (this.holes) for (const h of this.holes)
        if (h.length>=3 && pointInPolygon({x:lx,y:ly}, h)) return false;
      return true;
    }
    return false;
  }

  toJSON() {
    const o = { ...this };
    delete o._lv; delete o._wv; delete o._wp; delete o._wh;
    delete o._wvX; delete o._wvY; delete o._wvA;
    delete o._wpbb; delete o._wpbbX; delete o._wpbbY; delete o._wpbbA;   // ★パーツの AABB（_worldPartBoxes）
    delete o._aabb; delete o._forces; delete o._forcesSmooth;
    delete o._torques; delete o._torquesSmooth;
    delete o.partEdgeInternal;
    delete o.partEdgeArc;          // ★arcs から作り直せるキャッシュなので保存しない
    delete o._pinRigid;            // ★ヒンジの本数から毎tick決まるので保存しない
    delete o.frozen;
    delete o._gx; delete o._gy; delete o._ga;
    delete o._prevX; delete o._prevY; delete o._prevA;
    delete o._flowU;               // ★流れの場が履かせている速度の下駄（読み込み後に組み直す）
    delete o._bgHold; delete o._bgDvx; delete o._bgDvy;   // ★背景摩擦の判定持ち越し（1サブステップ限り）
    delete o._bgV0x; delete o._bgV0y;
    delete o._bgDav; delete o._bgAlpha; delete o._bgAv0;
    delete o.isSensor; delete o.noCollide;
    o.tracePoints = [];
    return o;
  }
}
// ─── 背景摩擦：「動き出すか」の最終判定 ───────────────────────────────
//   Body._bgFriction() は integrate の中で呼ばれるが、そこで見えているのは
//   重力・空気抵抗・スラスターまで。ロープ・棒・ヒンジ・接触・マウスがかける力は、
//   このあとソルバが「速度を直接書き換える」形で入れるので、integrate の時点では
//   まだ足りていない。そのままだと張力がいくら小さくても物体が動き出してしまい、
//   「糸で少しずつ引いて μs·mg を超えた瞬間に動き出す」が再現できない。
//   → 直前に静止していた自由度は判定を保留してあるので、拘束を解き終えた
//     サブステップの最後にここで合計して決める。
//       Δv の合計 ≦ μs·g⊥·dt → 動き出さない（速度0のまま）
//       超えた                → 打ち消してあった分を戻し、動摩擦 μk·g⊥·dt を差し引く
//   ★摩擦が切ってあるとき（既定 μ=0）は _bgHold が立たないので、objects を1周する
//     だけで抜ける。有効なときも1物体あたり数十回の四則演算しか増えない。
function bgFrictionPost(dt) {
  const muK = world.bgFriction || 0, muS = world.bgFrictionStatic || 0;
  if (muK <= 0 && muS <= 0) return;
  const gPx = (world.bgGravPerp || 0) * M2PX;
  if (gPx <= 0) return;
  for (const b of objects) {
    const hold = b._bgHold;
    if (!hold) continue;
    b._bgHold = 0;                                  // 持ち越しは1サブステップ限り
    if (b.isStatic || b.invMass === 0 || b.sleeping || b.frozen || b.held) continue;

    if (hold & 1) {                                 // ── 並進 ──
      const dvx = b._bgDvx + b.vx, dvy = b._bgDvy + b.vy;   // Δv ＝ integrate の分 ＋ ソルバの分
      const d = Math.hypot(dvx, dvy);
      if (d <= muS * gPx * dt) {                    // まだ静止摩擦の範囲内 → 動き出さない
        if (b.vx !== 0 || b.vy !== 0) {
          b.recordForce('friction', -b.mass * b.vx, -b.mass * b.vy, b.x, b.y, 'bg');
          b.vx = 0; b.vy = 0;
        }
      } else {                                      // μs·N を超えた → 滑り出して動摩擦へ
        //   ★ここで v0 を足し戻すのが要点。しきい値 BG_REST_VM 未満の速度は
        //     _bgFriction が 0 に丸めてしまうが、滑り出した直後の加速中はまさに
        //     その領域を通る。丸めたままだと毎サブステップ速度が捨てられ、
        //     張力が μs·N をわずかに超えた物体が「這うだけで加速しない」ことになる。
        const fx = b._bgV0x + dvx, fy = b._bgV0y + dvy;     // 摩擦を引く前の速度
        const f  = Math.hypot(fx, fy);
        const k  = Math.max(0, 1 - muK * gPx * dt / f);
        b.recordForce('friction', b.mass * ((k - 1) * fx + b._bgDvx),
                                  b.mass * ((k - 1) * fy + b._bgDvy), b.x, b.y, 'bg');
        b.vx = fx * k; b.vy = fy * k;
        if (b.guideEnabled) projectGuideVelocity(b, false);   // レール上ならレール方向へ戻す
      }
    }

    if (hold & 2) {                                 // ── 回転 ──
      const dav = b._bgDav + b.av;
      if (Math.abs(dav) <= muS * b._bgAlpha * dt) {
        if (b.av !== 0) {
          b.recordTorque('friction', -b.inertia * b.av, b.x, b.y, 'bg');
          b.av = 0;
        }
      } else {
        const fa = b._bgAv0 + dav;
        const k  = Math.max(0, 1 - muK * b._bgAlpha * dt / Math.abs(fa));
        b.recordTorque('friction', b.inertia * ((k - 1) * fa + b._bgDav), b.x, b.y, 'bg');
        b.av = fa * k;
      }
    }
  }
}
// ─── Coordinate Transformations for Joints ───
