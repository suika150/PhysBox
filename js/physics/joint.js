// ── 編集ツールでドラッグ中は「長さを持つジョイント」の拘束を解く ──────────────
//   編集ツールのドラッグは「掴んだ物体の位置が絶対」というオーサリング操作なので、
//   ジョイントが位置の主導権を握って相手の物体を引きずるのは方針に反する。
//   一時停止中はそもそも solve が呼ばれず自由に伸びるので、再生中も同じ結果に揃える。
//   ・ばね／ロープ／棒 … 長さを持つ＝対象。ドラッグ中は力も拘束も出さない
//   ・ヒンジ／モーター／溶接 … 距離0の拘束で「長さ」を持たない＝対象外。物体に追従する
//   ドラッグ中は相手の物体を支えなくなる（＝落ちる）が、これは避けられない。
//   「距離の変化に抵抗する」ことと「相手を支える」ことは同じ1つの性質のため。
//   離した時点の長さは refitJointLengthsForMovedBodies() が張り直す。
const JOINT_LENGTH_TYPES = ['spring', 'rope', 'rod'];
function jointLengthSuspended(j) {
  if (JOINT_LENGTH_TYPES.indexOf(j.type) < 0) return false;
  return !!((j.bodyA && j.bodyA.held) || (j.bodyB && j.bodyB.held));
}
// ── モーターがいま何を命令されているか ───────────────────────────────
//   ★リモコンは相手に2つの印を付ける（remote.js の applyRemotes）。
//     `_remoteHold` … 0/1/−1。効かせない／そのまま／逆。付いていなければ undefined。
//     `_remoteStop` … 「速度0を命令している」＝〈押すと止まる〉を押している最中。
//   ★この2つを分けている理由。0 には**意味の違う2つ**が混ざる：「切（何も命令して
//     いない＝軸は自由）」と「止めろ（目標角速度0を解く＝ブレーキ）」。1つの数に
//     まとめていたせいで、〈押すと止まる〉を押しても軸が自由になるだけで、摩擦の無い
//     はずみ車は同じ速さで回り続けていた（実測：押す前も押して4秒後も 6.000rad/s）。
function motorGate(j) { return j._remoteHold === undefined ? 1 : j._remoteHold; }
// 目標角速度を解くか（＝モーターがトルクを出すか）。切って自由に回している間は false。
function motorIsSolving(j) {
  if (j.type !== 'axle' || (j.motorCh | 0)) return false;   // 回路駆動は applyMotorTorques の担当
  return motorGate(j) !== 0 || j.motorBrake || !!j._remoteStop;
}
// 「回せ」と言われているか（＝止まっていても回り出すはず）。sleep.js が使う。
function motorIsDriving(j) {
  return motorIsSolving(j) && j.motorSpeed * motorGate(j) !== 0;
}
// 拘束が消した運動エネルギーを熱にする型（Joint.heatBegin の★）
const JOINT_HEAT_TYPES = new Set(['hinge', 'rod', 'rope', 'fixjoint', 'axle']);
class Joint {
  constructor(opts) {
    // ★id は保存・復元する（Body と同じ流儀）。リモコンがモーターを id で指すので、
    //   作り直すたびに番号が変わると、保存や「戻る」のたびに結びつきが切れる。
    //   旧いシーンには id が無いので、そのときは今までどおり採番する。
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.type = opts.type || 'spring'; // spring(ばね), hinge(ヒンジ), rope, rod(連結棒), fixjoint(溶接), axle(モーター)
    this.bodyA = opts.bodyA;
    this.bodyB = opts.bodyB;
    // ★端が地面に取り付いているか。true のときアンカーは「地面のローカル座標」
    //   （ground.js の groundLocalFromWorld）で、地面を傾ける・上下させると一緒に動く。
    //   body があるときは無効（物体への取り付けが優先）。
    this.groundA = !opts.bodyA && !!opts.groundA;
    this.groundB = !opts.bodyB && !!opts.groundB;
    this.anchorAx = opts.anchorAx || 0;
    this.anchorAy = opts.anchorAy || 0;
    this.anchorBx = opts.anchorBx || 0;
    this.anchorBy = opts.anchorBy || 0;
    // ★|| ではなく undefined で判定する。自然長 0 は正当な値（パネルの下限も 0）で、
    //   自然長 0 のばねは「中心からの距離に比例して引く力」＝等方振動子になり、
    //   横に速度を与えると等速円運動する（単振動と円運動の射影のデモが使っている）。
    //   || だと 0 が 100px にすり替わり、プログラムで作った場合もシーンの読み込みでも
    //   1m の自然長を持つ別のばねになってしまっていた。
    this.restLength = opts.restLength !== undefined ? opts.restLength : 100;
    // 既定値は state.js の springStiffness / springDampingRatio と揃えてある
    // （m=1kg で T≈2.0s・伸び≈0.98m、ζ=0.05 すなわち c=2ζ√(mk)≈0.32）。
    // 通常はばねツールが両方を明示的に渡すので、ここはプログラムから直接生成した場合の保険。
    this.stiffness = opts.stiffness !== undefined ? opts.stiffness : 10;    // [N/m]
    this.damping   = opts.damping   !== undefined ? opts.damping   : 0.32;  // [N·s/m]
    this.maxLength = opts.maxLength !== undefined ? opts.maxLength           // [px]（同上）
                   : (opts.restLength !== undefined ? opts.restLength : 100);
    this.motorSpeed  = opts.motorSpeed  || 0;                               // [rad/s]
    this.motorTorque = opts.motorTorque || 288;                             // [N·m]
    // ★リモコンを放したときに軸を止めるか。既定は false ＝ 今までどおり自由に回る
    //   （下の「モーター」の★のとおり、車輪は放したら惰性で転がるのが正しい）。
    //   true にすると、放している間は目標角速度 0 を解く＝その姿勢のまま保持する。
    //   荷を載せた台を少しずつ動かして止める、という装置がこちら（現実の a接点の
    //   モーターとサーボ／ブレーキ付きモーターの違いで、この場だけの特別扱いではない）。
    this.motorBrake = !!opts.motorBrake;
    // ★0 以外なら、その番号の「モーター端子」に流れる電流でトルクを受ける（回路駆動）。
    //   このとき上の motorSpeed 制御は止まる（電流だけが回転を決める）
    this.motorCh = opts.motorCh || 0;
    this.motorImpulse = 0;                                                  // ★モーター力積アキュムレータ
    // ★可動域（ヒンジ・モーター）。相対角 (B.angle − A.angle − refAngle) を [angleLo, angleHi] に
    //   収める。refAngle は取り付けたときの姿勢＝そこが 0。値は内部の向き（y 下向き＝時計回りが正）
    //   の rad で持ち、パネルでは画面の向き（反時計回りが正）の度へ換算する（panel-joint.js）。
    //   ひざ・ひじのように「片側にしか曲がらない」継ぎ目を、棒やロープを足さずに作るため。
    //   既定は切 ＝ 今までどおり何回でも回る。
    this.angleLimit = !!opts.angleLimit;
    this.angleLo = opts.angleLo !== undefined ? opts.angleLo : -Math.PI / 2;    // [rad]
    this.angleHi = opts.angleHi !== undefined ? opts.angleHi :  Math.PI / 2;    // [rad]
    this.color = opts.color || '#ffd54f';
    this.refAngle = (opts.bodyB ? opts.bodyB.angle : 0) - (opts.bodyA ? opts.bodyA.angle : 0);
    this.releasable = opts.releasable !== undefined ? !!opts.releasable : false;
    // ★外してあるヒンジ（2026-10-01）。釘を抜いたのと同じで、拘束も熱も出さない。
    //   リモコン〈外す・留め直す〉が切り替える（setHingeDetached）。吊り下げ法の
    //   「支点を掛け替える」のためのもの。消さずに残すのは、留め直す場所（物体側の穴）と
    //   リモコンのつなぎ先を覚えておくため。持つのはヒンジだけ（ほかの型は常に false）。
    this.detached = this.type === 'hinge' && !!opts.detached;
    this.layers = opts.layers !== undefined
      ? (opts.layers & LAYER_ALL)
      : defaultJointLayers(opts.bodyA, opts.bodyB);
    this.radius     = opts.radius     !== undefined ? opts.radius     : ROPE_CFG.radius;
    this.linDensity = opts.linDensity !== undefined ? opts.linDensity : ROPE_CFG.linDensity;
    this.friction   = opts.friction   !== undefined ? opts.friction   : ROPE_CFG.friction;
  }
  getWorldAnchorA() {
    const b = this.bodyA;
    if (!b) return this.groundA ? groundWorldFromLocal(this.anchorAx, this.anchorAy)
                                : { x: this.anchorAx, y: this.anchorAy };
    const cos=Math.cos(b.angle), sin=Math.sin(b.angle);
    return { x: b.x + this.anchorAx*cos - this.anchorAy*sin, y: b.y + this.anchorAx*sin + this.anchorAy*cos };
  }
  getWorldAnchorB() {
    const b = this.bodyB;
    if (!b) return this.groundB ? groundWorldFromLocal(this.anchorBx, this.anchorBy)
                                : { x: this.anchorBx, y: this.anchorBy };
    const cos=Math.cos(b.angle), sin=Math.sin(b.angle);
    return { x: b.x + this.anchorBx*cos - this.anchorBy*sin, y: b.y + this.anchorBx*sin + this.anchorBy*cos };
  }
  // ── 拘束が消した運動エネルギーを熱にする ─────────────────────────────
  //   ★拘束の速度補正は、つないだ物体どうしの相対速度を打ち消す＝完全非弾性の衝突と
  //     同じことをしている。実在の継ぎ目なら消えた運動エネルギーは熱になる。接触は
  //     以前から熱を台帳に載せていたが、拘束は載せておらず、行き先なしに消えていた
  //     実測（無重力で2枚の板の片方だけに速度を与え、継ぎ目で速度がそろう・5秒。
  //     失った運動 E に対する熱）：棒 99.6%・溶接 97.3%・蝶番 93.9%・モーター軸のピン 86.1%。
  //     たるみ 120px から落としてロープが張る球は 98.4%。
  //     ☆損失の大半は衝撃の瞬間ではなく、そのあと2枚が回り続けるあいだにじわじわ抜ける分
  //       （5秒で初めの運動 E の 3.6%。棒の「回すと漏れる」と同じ種類）。軸が低いのは
  //       位置の合わせかたが蝶番と違う（回転を使わず平行移動だけ）ためと思われる。未確認。
  //     ☆ジュールの実験の蝶番の袋にはほとんど効かない（3秒で 149 J ＝ 0.7%）。
  //       あの袋の熱の不足は拘束ではなく接触の門番だった（thermal.js の impactHeatOf の★★）。
  //     全デモ 300tick で熱が変わったのは7本だけで、動きは 110本とも1ビットも同じ
  //     （熱の台帳だけの変更なので）。2重振り子は収支が −0.86 → −0.16 J に閉じた。
  //   ★式は接触とまったく同じ形（thermal.js の impactHeatOf の★）：
  //       熱 ＝ −J・(u0 + u1)/2
  //     J はこのサブステップに打った力積の合計、u0/u1 はサブステップの頭と終わりの
  //     継ぎ目の相対速度。**解く前後の運動エネルギーの差を足し上げてはいけない**。
  //     重力が毎サブステップ足す速度や、接触のウォームスタートが押した板を拘束が打ち
  //     消すたびに「消した」と数え、実測で 188%（着地して静止した袋が 2,418 J/s）に
  //     なった。この式なら、そういう打ち消し合いは u0 に入らないので熱にならない。
  //   ★u0 は**力を積分する前**（サブステップの最初、step.js）に取る。積分のあとに取ると、
  //     一定の力を継ぎ目ごしに伝えているだけの拘束が毎サブステップ「ぶつかった」ことになる。
  //     実測：エレベーターの中の体重計は動力が床板 2kg だけを押し、溶接がかご全体へ伝える。
  //     積分のたびに継ぎ目が 118 px/s 開いては閉じるので、何も動かないのに 300tick で
  //     1,627 J の熱が出た。積分の前に取れば 0（伝えるだけの力は相対速度を作らない）。
  //     本物の衝突は積分の前から近づいているので、この取りかたでも数えられる。
  //   ★門番も接触と同じ（頭の相対速度が |g|·dt ＝ 重力が1サブステップで足す速さ以下なら
  //     熱にしない。thermal.js の impactHeatOf の★★）。1 m/s だったころは、蝶番が回り続ける
  //     あいだの漏れが門番の下に入って 79.6% だった（→ 93.9%）。
  //   ★対象は速度を打ち消す拘束：hinge・rod・rope・fixjoint と axle のピン。ばね（spring）は
  //     力でエネルギーを蓄えて返すので入れない。モーターの駆動は外からの仕事なので入れない。
  //     つかむ手（MouseJoint）は手の仕事なので入れない。
  //   ★ロープは1本の長さの拘束なので、スカラーの形（λ・(L̇0+L̇1)/2）で数える。L̇ を測る
  //     向きは前に解いたときの折れ線のもの（_ropeLdot。折れ線は解くときにしか作らない）。
  //   ★熱の行き先は両端の物体（ロープ自身は熱容量を持たない。巻きついた支点へは配らない）。
  heatBegin() {
    this._hOn = false;
    if (!JOINT_HEAT_TYPES.has(this.type) || this.detached) return;
    this._hOn = true;
    this._hJx = 0; this._hJy = 0; this._hJa = 0;
    this._hL = 0;
    if (this.type === 'rope') this._hL0 = this._ropeLdot();
    else this._hU0 = this._heatRelVel();
  }
  heatEnd(dt) {
    if (!this._hOn) return;
    this._hOn = false;
    const th = Math.hypot(world.gravX, world.gravY) * PPM * dt;   // ★門番（heatBegin の★）
    let E = 0;
    if (this.type === 'rope') {
      const L1 = this._ropeLdot();
      if (this._hL0 !== undefined && L1 !== undefined && this._hL0 > th) E = this._hL * (this._hL0 + L1) / 2;
    } else {
      const u0 = this._hU0, u1 = this._heatRelVel();
      if (Math.hypot(u0.x, u0.y) > th) E -= (this._hJx * (u0.x + u1.x) + this._hJy * (u0.y + u1.y)) / 2;
      // 角度の拘束（溶接）：腕の長さは回転半径で換算して、同じ門番を通す
      if (this._hJa) {
        const b = (this.bodyB && !this.bodyB.isStatic) ? this.bodyB : this.bodyA;
        const rg = b ? Math.sqrt(b.inertia / b.mass) : 0;
        if (Math.abs(u0.a) * rg > th) E -= this._hJa * (u0.a + u1.a) / 2;
      }
    }
    if (E > 0) addDissipatedHeat(this.bodyA, this.bodyB, E / (PPM * PPM));
  }
  // ロープの長さの伸び速度 L̇。向き（両端の接線・支点）は前に張って解いたときのものを使う
  //   （ロープの折れ線は解くときにしか作らない）。
  //   ★たるんでいた（向きを持っていない）ときは両端を結ぶ直線で測る。これが無いと、
  //     たるんだロープがピンと張る瞬間＝いちばん大きく散逸する瞬間の L̇0 が取れない
  //     （実測：たるみ 120px から落とした球で、失った力学的 E 42.1 J に対し熱 0 J だった）。
  _ropeLdot() {
    const A = this.bodyA, B = this.bodyB;
    const wa = this.getWorldAnchorA(), wb = this.getWorldAnchorB();
    let g = this._hGeo;
    if (!g) {
      const dx = wb.x - wa.x, dy = wb.y - wa.y, d = Math.hypot(dx, dy);
      if (!(d > 1e-9)) return undefined;
      g = { tAx: dx / d, tAy: dy / d, tBx: dx / d, tBy: dy / d, wrap: [] };
    }
    const vAx = A ? A.vx - A.av * (wa.y - A.y) : 0, vAy = A ? A.vy + A.av * (wa.x - A.x) : 0;
    const vBx = B ? B.vx - B.av * (wb.y - B.y) : 0, vBy = B ? B.vy + B.av * (wb.x - B.x) : 0;
    let L = (vBx * g.tBx + vBy * g.tBy) - (vAx * g.tAx + vAy * g.tAy);
    for (const w of g.wrap) L += (w.b.vx - w.b.av * w.ry) * w.gx + (w.b.vy + w.b.av * w.rx) * w.gy;
    return L;
  }
  // 継ぎ目の相対速度（B − A）と相対角速度
  _heatRelVel() {
    const A = this.bodyA, B = this.bodyB;
    const wa = this.getWorldAnchorA(), wb = this.getWorldAnchorB();
    const vA = A ? { x: A.vx - A.av * (wa.y - A.y), y: A.vy + A.av * (wa.x - A.x) } : { x: 0, y: 0 };
    const vB = B ? { x: B.vx - B.av * (wb.y - B.y), y: B.vy + B.av * (wb.x - B.x) } : { x: 0, y: 0 };
    return { x: vB.x - vA.x, y: vB.y - vA.y, a: (B ? B.av : 0) - (A ? A.av : 0) };
  }
  // 取り付けたときの姿勢から測った相対角 [rad]（−π〜π。内部の向き）
  relAngle() {
    const r = (this.bodyB ? this.bodyB.angle : 0) - (this.bodyA ? this.bodyA.angle : 0) - this.refAngle;
    return Math.atan2(Math.sin(r), Math.cos(r));
  }
  // ── 可動域（ヒンジ・モーターの末尾から呼ぶ）──────────────────────────
  //   ★溶接の角度拘束（fixjoint の①）と同じ形を、端を越えたときだけ片側に効かせる：
  //     越えた角度を半分ずつ戻し、さらに外へ向かう相対角速度だけを消す（内へ戻る向きは
  //     触らない＝端に貼り付かない）。反発は付けない（端で止まる＝ひざが伸びきる感じ）。
  //     消した回転の運動エネルギーは溶接と同じく _hJa で熱の台帳に載せる。
  //   ★相対角は −π〜π に折り返して測るので、可動域の幅は 360° 未満が前提。
  _solveAngleLimit() {
    if (!this.angleLimit) return;
    const bA = this.bodyA, bB = this.bodyB;
    const invIa = bA && !bA.isStatic ? bA.invInertia : 0;
    const invIb = bB && !bB.isStatic ? bB.invInertia : 0;
    const totalInvI = invIa + invIb;
    if (!(totalInvI > 0)) return;
    const rel = this.relAngle();
    let err;
    if (rel > this.angleHi) err = rel - this.angleHi;
    else if (rel < this.angleLo) err = rel - this.angleLo;
    else return;
    const angCorr = (err * 0.5) / totalInvI;
    if (bA && !bA.isStatic) bA.angle += angCorr * invIa;
    if (bB && !bB.isStatic) bB.angle -= angCorr * invIb;
    const relAv = (bB ? bB.av : 0) - (bA ? bA.av : 0);
    if (relAv * err <= 0) return;                    // もう内へ戻りつつある
    const jAv = relAv / totalInvI;
    if (this._hOn) this._hJa -= jAv;                 // ★B が受けた角力積（熱。heatBegin の★）
    if (bA && !bA.isStatic) bA.av += jAv * invIa;
    if (bB && !bB.isStatic) bB.av -= jAv * invIb;
  }
  solve(dt) {
    if (this.detached) return;                // ★外してあるヒンジ（constructor の★）
    if (jointLengthSuspended(this)) return;   // ★編集ツールでドラッグ中は長さの拘束を解く
    const wa = this.getWorldAnchorA();
    const wb = this.getWorldAnchorB();
    const dx=wb.x-wa.x, dy=wb.y-wa.y;
    const dist=Math.sqrt(dx*dx+dy*dy)+0.001;
    if (this.type==='spring') {
      // 一時停止中はつかむツール以外の力をすべて0にする方針。ばねは「力」なので
      // 位置補正をせず、つかんだおもりに合わせて自由に伸びちぢみさせる（自然長へ戻さない）。
      // 再生すると伸ばした分の復元力で振動が始まる＝初期条件の作り込みに使える。
      if (dt === 0) return;
      // ★向きは「単位ベクトル」にする。上の dist は 0 割りを避けるために +0.001 した値なので、
      //   これで割ると |n| = |d|/(|d|+0.001) となり、1 より小さくなる。ふだんは効かないが、
      //   ばねを縮めきると効いて復元力が痩せ、両端が重なる（|d|=0）と n=0 ＝ 力そのものが
      //   消える。実測：おもりを支点へ重ねて放すと、ばねは二度と伸びなかった。
      //   長さも +0.001 のほうではなく実長で測る（自然長との差がその 0.001 だけ狂うため）。
      // ★両端が完全に重なって向きが決まらないときは、直前の向きへ押し出す（縮んで来た道を
      //   戻す）。まだ一度も向きを持っていなければ真上（画面の y は下向きが正）。
      const raw = Math.sqrt(dx*dx + dy*dy);
      let nx, ny;
      if (raw > 1e-6) { nx = dx/raw; ny = dy/raw; this._nx = nx; this._ny = ny; }
      else            { nx = this._nx || 0; ny = this._ny || -1; }
      const stretch = raw - this.restLength;           // [px]
      const bA = this.bodyA, bB = this.bodyB;
      const Ldot = ((bB?bB.vx:0)-(bA?bA.vx:0))*nx + ((bB?bB.vy:0)-(bA?bA.vy:0))*ny;
      const dtSub = dt / world.iterations;             // この反復が担う時間 [s]
      let   Jk = this.stiffness * stretch * dtSub;     // ★const→let（下で上限クランプするため）
      let   Jc = this.damping   * Ldot    * dtSub;     // 減衰の力積
      const invMa = bA && !bA.isStatic ? bA.invMass : 0;
      const invMb = bB && !bB.isStatic ? bB.invMass : 0;
      const invIa = bA && !bA.isStatic ? bA.invInertia : 0;
      const invIb = bB && !bB.isStatic ? bB.invInertia : 0;
      const rAx = bA ? wa.x - bA.x : 0, rAy = bA ? wa.y - bA.y : 0;
      const rBx = bB ? wb.x - bB.x : 0, rBy = bB ? wb.y - bB.y : 0;
      const crA = rAx*ny - rAy*nx, crB = rBx*ny - rBy*nx;
      const kEff = invMa + invMb + crA*crA*invIa + crB*crB*invIb;   // 軸方向の実効逆質量 [1/kg]
      if (kEff > 1e-12) {
        const maxJc = Math.abs(Ldot) / kEff;
        if (Math.abs(Jc) > maxJc) Jc = Math.sign(Jc) * maxJc;
        const maxJk = Math.abs(stretch) / (kEff * dtSub);
        if (Math.abs(Jk) > maxJk) Jk = Math.sign(Jk) * maxJk;
      }
      const J = Jk + Jc;
      if (bA && !bA.isStatic) { bA.applyImpulse( nx*J,  ny*J, wa.x, wa.y); bA.recordForce('spring',  nx*J,  ny*J, wa.x, wa.y, this.id); }
      if (bB && !bB.isStatic) { bB.applyImpulse(-nx*J, -ny*J, wb.x, wb.y); bB.recordForce('spring', -nx*J, -ny*J, wb.x, wb.y, this.id); }
    } else if (this.type === 'rope') {
      ensureRopeNodes(this);
      // ── 張力を伝える支点（ロープが曲がっている点）を選ぶ ──────────────────
      //   ここで作る折れ線の長さ L を maxLength と比べて張力を出すので、「触れている
      //   節点」を片端から全部入れてはいけない。ロープが面にべたっと寝ていると全節点が
      //   接触点になり、L はチェーンそのものの長さになる。チェーンは離散の折れ線なので
      //   リンクのわずかな伸び（2%ほど）でも L > maxLength になり、**たるんでいるロープに
      //   ありもしない張力が立つ**。それが端の物体を硬い位置拘束で引き戻すため、
      //   「何かに引っかかって持ち上がらない・強い力を出すと外れる」になっていた。
      //   張力が伝わるのは実際に向きが変わる点だけ（そこだけが面を押している）なので、
      //   曲がり |v̂-û| がしきい値を超える節点だけを支点にする。面に寝ているだけの区間は
      //   まっすぐ＝曲がり0で落ち、ペグへの巻きつき（1節点あたり十数度）は確実に残る。
      //   ★_embed（物体の中に入り込んだ節点）も支点にしない。
      const rawPts = [];
      if (this.nodes && this.nodes.length) {
        const cand = [];
        for (const n of this.nodes) if (n._touchT > 0 && !n._embed) cand.push(n);
        if (cand.length) {
          const BEND_TH = 0.05;                 // 曲がりの大きさ。約3°より大きければ支点の候補
          const seq = [wa, ...cand, wb];
          for (let i = 1; i < seq.length - 1; i++) {
            const p = seq[i-1], n = seq[i], q = seq[i+1];
            let ux = n.x - p.x, uy = n.y - p.y; const ul = len(ux, uy) || 1; ux /= ul; uy /= ul;
            let vx = q.x - n.x, vy = q.y - n.y; const vl = len(vx, vy) || 1; vx /= vl; vy /= vl;
            const bx = vx - ux, by = vy - uy;   // 張力がこの節点に及ぼす向き（大きさ＝2sin(θ/2)）
            // 曲がりが「面へ押しつける向き」のときだけ支点。_cn は面が節点を押し返す向き。
            // たるんで面の上でくねっているロープは、山の節点で曲がりが面から離れる向きに
            // なるので落ちる（＝くねりの分だけ経路が伸びることがない）。
            if (len(bx, by) > BEND_TH && (bx * n._cnx + by * n._cny) < 0) rawPts.push(n);
          }
        }
      }
      const _calm = (this._calmT || 0) > 8;   // ★静止収束時は支点を実接触点へ即追従（斜め保持を解除）
      if (_calm || !this._wrapPts || this._wrapPts.length !== rawPts.length) {
        this._wrapPts = rawPts.map(n => ({ x: n.x, y: n.y, b: n._cb }));
      } else {
        for (let i = 0; i < rawPts.length; i++) {
          const w = this._wrapPts[i], r = rawPts[i];
          w.b = r._cb;      // ★相手は毎回追う（位置は下のしきい値で間引くが、相手を間引くと力の行き先を失う）
          if ((r.x-w.x)*(r.x-w.x) + (r.y-w.y)*(r.y-w.y) > 0.36) { w.x = r.x; w.y = r.y; }
        }
      }
      const pts = [wa, ...this._wrapPts, wb];
      let L = 0;
      for (let i = 0; i < pts.length - 1; i++)
        L += len(pts[i+1].x - pts[i].x, pts[i+1].y - pts[i].y);
      const stretch = L - this.maxLength;
      if (!(stretch > 0)) { this._hGeo = null; this._wrapBodies = null; return; }   // ★NaN も弾く（NaN<=0 は false なので従来は素通りしていた）
                                                           // ★たるんだら熱の向きも捨てる（_ropeLdot の★）
      // 端点での張力方向＝タイト経路の接線（アンカー→隣接点）
      let tAx = pts[1].x - wa.x, tAy = pts[1].y - wa.y;
      let tl = len(tAx, tAy) || 1; tAx /= tl; tAy /= tl;
      let tBx = wb.x - pts[pts.length-2].x, tBy = wb.y - pts[pts.length-2].y;
      tl = len(tBx, tBy) || 1; tBx /= tl; tBy /= tl;
      const bA = this.bodyA, bB = this.bodyB;
      const invMa = bA && !bA.isStatic ? bA.invMass : 0;
      const invMb = bB && !bB.isStatic ? bB.invMass : 0;
      const invIa = bA && !bA.isStatic ? bA.invInertia : 0;
      const invIb = bB && !bB.isStatic ? bB.invInertia : 0;
      const rAx = bA ? wa.x - bA.x : 0, rAy = bA ? wa.y - bA.y : 0;
      const rBx = bB ? wb.x - bB.x : 0, rBy = bB ? wb.y - bB.y : 0;
      const crossA = rAx*tAy - rAy*tAx;
      const crossB = rBx*tBy - rBy*tBx;
      // ── 縄が曲がっているところ（支点）に居る物体も、この拘束の参加者にする ──────
      //   ★経路長 L は支点の位置にも依存する：∂L/∂p = û − v̂（大きさ 2sin(θ/2)）。
      //     以前はここを「動かない杭」として扱い、両端の物体にしか力積を当てていなかった。
      //     静的な滑車・ペグでは違いが出ない（無限質量なので受け取っても動かないし、
      //     実効質量にも 0 しか足さない）が、**動く物体に縄を掛けると、掛けた相手に張力が
      //     まったく渡らない**＝巻き付きのところで運動量が保存しない。落ちた力の代わりに
      //     節点ごとの接触（rope.js）が場当たりに押し返すので、巻き付いた節点の数だけ
      //     力が重複した（実測：理論 12 N のところ最大 86.7 N）。
      //   ★両端の力と全支点の力を足すと telescoping で 0 になる＝運動量が構造的に保存する。
      //     180°巻きなら û−v̂ の合計がちょうど 2 になり、支える力は自動的に 2T になる。
      //     「滑車」という概念はどこにも要らない：規則は「張力は縄が曲がる相手に及ぶ」だけ。
      //   ★端の物体そのものが支点になっている場合は入れない（同じ物体に二重に当たる）。
      const wrap = [];
      for (let i = 1; i < pts.length - 1; i++) {
        const wb2 = pts[i].b;
        if (!wb2 || wb2.isStatic || wb2 === bA || wb2 === bB || wb2.invMass === 0) continue;
        let ux = pts[i].x - pts[i-1].x, uy = pts[i].y - pts[i-1].y;
        let ul = len(ux, uy) || 1; ux /= ul; uy /= ul;
        let vx = pts[i+1].x - pts[i].x, vy = pts[i+1].y - pts[i].y;
        let vl = len(vx, vy) || 1; vx /= vl; vy /= vl;
        const gx = ux - vx, gy2 = uy - vy;                 // ∂L/∂p
        if (gx === 0 && gy2 === 0) continue;
        const rx = pts[i].x - wb2.x, ry = pts[i].y - wb2.y;
        wrap.push({ b: wb2, gx, gy: gy2, rx, ry, cr: rx*gy2 - ry*gx, px: pts[i].x, py: pts[i].y });
      }
      // ★この拘束が張力を渡している「支点の物体」。rope.js の節点の接触はこの物体を押さない
      //   （同じ縄の力を2回渡さない。rope.js の viaTension の★）。たるんだら上で null に戻る。
      this._wrapBodies = wrap.length ? new Set(wrap.map(w => w.b)) : null;
      let kWrap = 0;
      for (const w of wrap)
        kWrap += w.b.invMass * (w.gx*w.gx + w.gy*w.gy) + w.b.invInertia * w.cr * w.cr;
      const k = invMa + invMb + crossA*crossA*invIa + crossB*crossB*invIb + kWrap;
      if (k === 0) return;
      // 支点の物体にも同じ拘束の位置補正を当てる（向きは −∂L/∂p）
      const wrapPos = corr => { for (const w of wrap) { const b = w.b;
        b.x -= w.gx*corr*b.invMass; b.y -= w.gy*corr*b.invMass;
        b.angle -= w.cr*corr*b.invInertia; b._updateAABB(); } };
      const grabbed = (bA && bA._grabbed) || (bB && bB._grabbed);
      if (dt === 0) {
        // 一時停止中：ロープは「伸びない幾何拘束」。ばねと違い力ではないので pause 中も効く。
        // つかんで速く引いても、伸びを全量打ち消して長さ以上には伸びない（cap を外す）。
        // ★ただし1反復で全量当てるのはやめ、棒と同じ 0.5 ずつにする。掴み拘束と交互に
        //   当てるとき、両方が毎回100%自分の拘束を満たすと互いの補正を打ち消し合って
        //   つり合いへ収束せず、物体が回り続ける（＝カーソルを動かす間ずっと暴れる）。
        //   0.5 でも applyPausedConstraints は最低20回まわすので 0.5^20≒1e-6、
        //   「伸びない」ことは変わらない。伸びの量に上限を付けないという意味での
        //   cap 無しもそのまま。
        const corr = stretch / k * 0.5;
        if (bA && !bA.isStatic) { bA.x += tAx*corr*invMa; bA.y += tAy*corr*invMa; bA.angle += crossA*corr*invIa; bA._updateAABB(); }
        if (bB && !bB.isStatic) { bB.x -= tBx*corr*invMb; bB.y -= tBy*corr*invMb; bB.angle -= crossB*corr*invIb; bB._updateAABB(); }
        wrapPos(corr);
        return;
      }
      if (grabbed) {
        const corr = Math.min(stretch, ROPE_CFG.maxPull) / k;
        if (corr > 0) {
          if (bA && !bA.isStatic) { bA.x += tAx*corr*invMa; bA.y += tAy*corr*invMa; bA.angle += crossA*corr*invIa; bA._updateAABB(); }
          if (bB && !bB.isStatic) { bB.x -= tBx*corr*invMb; bB.y -= tBy*corr*invMb; bB.angle -= crossB*corr*invIb; bB._updateAABB(); }
          wrapPos(corr);
          if (bA && !bA.isStatic) { bA.sleeping = false; bA.sleepTimer = 0; }
          if (bB && !bB.isStatic) { bB.sleeping = false; bB.sleepTimer = 0; }
        }
      } else if (!this._posApplied) {
        const slop = 1.5;
        const eff = Math.min(Math.max(stretch - slop, 0), 12);
        const corr = (eff / k) * 0.5;
        if (corr > 0) {
          if (bA && !bA.isStatic) { bA.x += tAx*corr*invMa; bA.y += tAy*corr*invMa; bA.angle += crossA*corr*invIa; bA._updateAABB(); }
          if (bB && !bB.isStatic) { bB.x -= tBx*corr*invMb; bB.y -= tBy*corr*invMb; bB.angle -= crossB*corr*invIb; bB._updateAABB(); }
          wrapPos(corr);
          if (corr > 0.5) {   // ★大きく引かれた＝実際の外乱：眠っていたら起こす（微小補正では起こさない）
            if (bA && !bA.isStatic) { bA.sleeping = false; bA.sleepTimer = 0; }
            if (bB && !bB.isStatic) { bB.sleeping = false; bB.sleepTimer = 0; }
          }
        }
        this._posApplied = true;
      }
      // ② 速度補正：経路長が伸びる速度成分（張力方向）のみ打ち消す＝ピンと張る・振り子が自然に
      const vAx = bA ? bA.vx - bA.av*rAy : 0, vAy = bA ? bA.vy + bA.av*rAx : 0;
      const vBx = bB ? bB.vx - bB.av*rBy : 0, vBy = bB ? bB.vy + bB.av*rBx : 0;
      // ★経路長の伸び速度 Ldot は全参加者の寄与の和。支点の物体が動けばそこでも L は変わる
      let Ldot = (vBx*tBx + vBy*tBy) - (vAx*tAx + vAy*tAy);
      for (const w of wrap) {
        const b = w.b;
        Ldot += (b.vx - b.av*w.ry) * w.gx + (b.vy + b.av*w.rx) * w.gy;
      }
      this._hGeo = { tAx, tAy, tBx, tBy, wrap };   // ★熱：頭と終わりの L̇ をこの向きで測る（heatBegin の★）
      if (Ldot > 0.6) {    // 0.01 px/frame → 0.6 px/s
        const jimp = Ldot / k;
        if (this._hOn) this._hL += jimp;
        if (bA && !bA.isStatic) { bA.applyImpulse( jimp*tAx,  jimp*tAy, wa.x, wa.y); bA.recordForce('spring',  jimp*tAx,  jimp*tAy, wa.x, wa.y, this.id); }
        if (bB && !bB.isStatic) { bB.applyImpulse(-jimp*tBx, -jimp*tBy, wb.x, wb.y); bB.recordForce('spring', -jimp*tBx, -jimp*tBy, wb.x, wb.y, this.id); }
        // 支点：張力が向きを変えるぶんの力積 −J·∂L/∂p ＝ T(v̂−û)。180°巻きなら合計 2T になる
        //   ★力積は支点ごとに当てる（回転の腕が支点ごとに違うので、まとめると偶力を失う）。
        //     矢印の記録だけは物体ごとに1本へまとめる。キーを同じにすると recordForce が
        //     fx/fy を足し込み、作用点も大きさで重み付けして平均してくれるので、
        //     「分布した圧力の合力」＝ 180°巻きなら 2T の1本、が描かれる。
        //     支点ごとに別々のキーにすると、滑車の周りに小さな矢印が十数本に散って
        //     「2倍の力で支えている」がまったく読めなかった（実測：13本に分裂）。
        for (const w of wrap) {
          w.b.applyImpulse(-jimp*w.gx, -jimp*w.gy, w.px, w.py);
          w.b.recordForce('spring', -jimp*w.gx, -jimp*w.gy, w.px, w.py, this.id + ':wrap');
        }
      }
       if (pts.length > 2 && dt > 0 && (this._calmT || 0) > 10) {
        const spA = bA && !bA.isStatic ? bA.vx*bA.vx + bA.vy*bA.vy : 0;
        const spB = bB && !bB.isStatic ? bB.vx*bB.vx + bB.vy*bB.vy : 0;
        if (Math.max(spA, spB) < 900) {    // (30 px/s)² = 旧 (0.5 px/frame)²
          const fr = Math.exp(-9.6 * (dt / world.iterations));   // ★substeps 非依存の指数減衰
          if (bA && !bA.isStatic) { bA.vx *= fr; bA.vy *= fr; bA.av *= fr; }
          if (bB && !bB.isStatic) { bB.vx *= fr; bB.vy *= fr; bB.av *= fr; }
        }
      }
    } else if (this.type === 'rod') {
      let stretch = dist - this.restLength;
      if (stretch !== 0) {
        const nx = dx / dist, ny = dy / dist;
        const bA = this.bodyA, bB = this.bodyB;
        
        const invMa = bA && !bA.isStatic ? bA.invMass : 0;
        const invMb = bB && !bB.isStatic ? bB.invMass : 0;
        const invIa = bA && !bA.isStatic ? bA.invInertia : 0;
        const invIb = bB && !bB.isStatic ? bB.invInertia : 0;
        const rAx = bA ? wa.x - bA.x : 0;
        const rAy = bA ? wa.y - bA.y : 0;
        const rBx = bB ? wb.x - bB.x : 0;
        const rBy = bB ? wb.y - bB.y : 0;
        const crossA = rAx * ny - rAy * nx;
        const crossB = rBx * ny - rBy * nx;
        const effectiveInvMass = invMa + invMb + crossA * crossA * invIa + crossB * crossB * invIb;
        if (effectiveInvMass === 0) return;
        // 1. 位置の補正
        const percent = 0.5;
        const correction = (stretch / effectiveInvMass) * percent;
        if (bA && !bA.isStatic) {
          bA.x += nx * correction * invMa;
          bA.y += ny * correction * invMa;
          bA.angle += crossA * correction * invIa;
          bA._updateAABB();
        }
        if (bB && !bB.isStatic) {
          bB.x -= nx * correction * invMb;
          bB.y -= ny * correction * invMb;
          bB.angle -= crossB * correction * invIb;
          bB._updateAABB();
        }
        // 2. 速度の補正（力積）
        const waNew = this.getWorldAnchorA();
        const wbNew = this.getWorldAnchorB();
        const rAxNew = bA ? waNew.x - bA.x : 0;
        const rAyNew = bA ? waNew.y - bA.y : 0;
        const rBxNew = bB ? wbNew.x - bB.x : 0;
        const rByNew = bB ? wbNew.y - bB.y : 0;
        const vAx = bA ? bA.vx - bA.av * rAyNew : 0;
        const vAy = bA ? bA.vy + bA.av * rAxNew : 0;
        const vBx = bB ? bB.vx - bB.av * rByNew : 0;
        const vBy = bB ? bB.vy + bB.av * rBxNew : 0;
        const rvx = vBx - vAx;
        const rvy = vBy - vAy;
        const relVn = rvx * nx + rvy * ny;
        // 棒は両方向に力を適用
        {
          const j = relVn / effectiveInvMass;
          if (this._hOn) { this._hJx -= j * nx; this._hJy -= j * ny; }   // ★B が受けた力積（熱）
          if (bA && !bA.isStatic) { bA.applyImpulse( j * nx,  j * ny, waNew.x, waNew.y); bA.recordForce('spring',  j * nx,  j * ny, waNew.x, waNew.y, this.id); }
          if (bB && !bB.isStatic) { bB.applyImpulse(-j * nx, -j * ny, wbNew.x, wbNew.y); bB.recordForce('spring', -j * nx, -j * ny, wbNew.x, wbNew.y, this.id); }
        }
      }
    } else if (this.type==='hinge') {
      const bA = this.bodyA, bB = this.bodyB;
      const invMa = bA && !bA.isStatic ? bA.invMass : 0;
      const invMb = bB && !bB.isStatic ? bB.invMass : 0;
      const invIa = bA && !bA.isStatic ? bA.invInertia : 0;
      const invIb = bB && !bB.isStatic ? bB.invInertia : 0;
      const totalInv = invMa + invMb;
      if (totalInv === 0) return;
      const error = Math.sqrt(dx * dx + dy * dy);
      if (error > 0.01) {
        // ★位置補正は回転も含めて解く。並進だけで寄せると、ヒンジを2本打っても
        //   「向き」を直せる補正が誰も出せず、棒がゆっくり回り続けて片方のヒンジが
        //   置き去りになる（2本目だけが合い、1本目が数十px ずれる）。
        //   速度側と同じ 2×2 の実効質量で解けば、2本のヒンジが協力して向きも止められる。
        const rAx = bA ? wa.x - bA.x : 0, rAy = bA ? wa.y - bA.y : 0;
        const rBx = bB ? wb.x - bB.x : 0, rBy = bB ? wb.y - bB.y : 0;
        const k11 = invMa + invMb + rAy*rAy*invIa + rBy*rBy*invIb;
        const k12 = -rAy*rAx*invIa - rBy*rBx*invIb;
        const k22 = invMa + invMb + rAx*rAx*invIa + rBx*rBx*invIb;
        const det = k11 * k22 - k12 * k12;
        if (det !== 0) {
          const percent = 0.5;
          // K λ = -percent·(wb-wa) を解く（λ は B へ、-λ は A へ加える擬似力積）
          const lx = -percent * ( k22 * dx - k12 * dy) / det;
          const ly = -percent * (-k12 * dx + k11 * dy) / det;
          if (bA && !bA.isStatic) {
            bA.x -= lx * invMa; bA.y -= ly * invMa;
            bA.angle -= (rAx * ly - rAy * lx) * invIa;
            bA._updateAABB();
          }
          if (bB && !bB.isStatic) {
            bB.x += lx * invMb; bB.y += ly * invMb;
            bB.angle += (rBx * ly - rBy * lx) * invIb;
            bB._updateAABB();
          }
        }
      }
      const waNew = this.getWorldAnchorA();
      const wbNew = this.getWorldAnchorB();
      const rAx = waNew.x - (bA ? bA.x : waNew.x);
      const rAy = waNew.y - (bA ? bA.y : waNew.y);
      const rBx = wbNew.x - (bB ? bB.x : wbNew.x);
      const rBy = wbNew.y - (bB ? bB.y : wbNew.y);
      const vAx = bA ? bA.vx - bA.av * rAy : 0;
      const vAy = bA ? bA.vy + bA.av * rAx : 0;
      const vBx = bB ? bB.vx - bB.av * rBy : 0;
      const vBy = bB ? bB.vy + bB.av * rBx : 0;
      const relVx = vBx - vAx;
      const relVy = vBy - vAy;
      const k11 = invMa + invMb + rAy*rAy*invIa + rBy*rBy*invIb;
      const k12 = -rAy*rAx*invIa - rBy*rBx*invIb;
      const k21 = k12;
      const k22 = invMa + invMb + rAx*rAx*invIa + rBx*rBx*invIb;
      const det = k11 * k22 - k12 * k21;
      if (det !== 0) {
        const jx = (-relVx * k22 - -relVy * k12) / det;
        const jy = (-relVy * k11 - -relVx * k21) / det;
        if (this._hOn) { this._hJx += jx; this._hJy += jy; }   // ★B が受けた力積（熱）
        if (bA && !bA.isStatic) { bA.applyImpulse(-jx, -jy, waNew.x, waNew.y); bA.recordForce('constraint', -jx, -jy, waNew.x, waNew.y, this.id); }
        if (bB && !bB.isStatic) { bB.applyImpulse( jx,  jy, wbNew.x, wbNew.y); bB.recordForce('constraint',  jx,  jy, wbNew.x, wbNew.y, this.id); }
      }
      this._solveAngleLimit();
} else if (this.type==='axle') {
      const bA = this.bodyA, bB = this.bodyB;
      const invMa = bA && !bA.isStatic ? bA.invMass : 0;
      const invMb = bB && !bB.isStatic ? bB.invMass : 0;
      const invIa = bA && !bA.isStatic ? bA.invInertia : 0;
      const invIb = bB && !bB.isStatic ? bB.invInertia : 0;
      // ── (a) 位置拘束：2アンカーを一致させ軸をピン留め（ヒンジと同一）──
      const totalInv = invMa + invMb;
      if (totalInv > 0) {
        const error = Math.sqrt(dx * dx + dy * dy);
        if (error > 0.01) {
          const percent = 0.5;
          const correction = (error * percent) / totalInv;
          const cx = (dx / error) * correction;
          const cy = (dy / error) * correction;
          if (bA && !bA.isStatic) { bA.x += cx * invMa; bA.y += cy * invMa; bA._updateAABB(); }
          if (bB && !bB.isStatic) { bB.x -= cx * invMb; bB.y -= cy * invMb; bB._updateAABB(); }
        }
        const waN = this.getWorldAnchorA(), wbN = this.getWorldAnchorB();
        const rAx = waN.x - (bA ? bA.x : waN.x), rAy = waN.y - (bA ? bA.y : waN.y);
        const rBx = wbN.x - (bB ? bB.x : wbN.x), rBy = wbN.y - (bB ? bB.y : wbN.y);
        const vAx = bA ? bA.vx - bA.av * rAy : 0, vAy = bA ? bA.vy + bA.av * rAx : 0;
        const vBx = bB ? bB.vx - bB.av * rBy : 0, vBy = bB ? bB.vy + bB.av * rBx : 0;
        const relVx = vBx - vAx, relVy = vBy - vAy;
        const k11 = invMa + invMb + rAy*rAy*invIa + rBy*rBy*invIb;
        const k12 = -rAy*rAx*invIa - rBy*rBx*invIb;
        const k22 = invMa + invMb + rAx*rAx*invIa + rBx*rBx*invIb;
        const det = k11*k22 - k12*k12;
        if (det !== 0) {
          const jx = (-relVx*k22 + relVy*k12) / det;
          const jy = (-relVy*k11 + relVx*k12) / det;
          if (this._hOn) { this._hJx += jx; this._hJy += jy; }   // ★B が受けた力積（熱）
          if (bA && !bA.isStatic) { bA.applyImpulse(-jx, -jy, waN.x, waN.y); bA.recordForce('constraint', -jx, -jy, waN.x, waN.y, this.id); }
          if (bB && !bB.isStatic) { bB.applyImpulse( jx,  jy, wbN.x, wbN.y); bB.recordForce('constraint',  jx,  jy, wbN.x, wbN.y, this.id); }
        }
      }
      // ── (b) モーター：相対角速度を motorSpeed へ収束（motorTorque で力積制限）──
      //   ★回路駆動（motorCh > 0）のときは何もしない。トルクは applyMotorTorques が
      //     電流から与えるので、ここで角速度を目標へ引っぱると二重に駆動してしまう。
      // ★リモコン（motorGate／motorIsSolving はこのファイルの冒頭）。押していない間は
      //   モーターごと何もしない＝軸は自由に回る。目標速度を0にして止めるとブレーキに
      //   なってしまい、放したとたんに車輪がロックする（放したら惰性で転がるのが正しい）。
      //   ★ただし次の2つのときは、命令が無くても目標速度0で解いて姿勢を保つ。
      //     ・〈放したら止める〉（motorBrake）… 荷を載せた台を動かして止める装置。
      //       実測：箱を2つ載せた板を 20° で放したとき、自由なら 1秒で +7.3°・5秒で
      //       112°（倒れ切る）。止めるなら 15秒たっても 20.05°（ずれ 0.04°）。
      //     ・〈押すと止まる〉を押している最中（_remoteStop）… これは「切」ではなく
      //       「止めろ」という命令。冒頭の★を参照。
      //   トルク上限は同じように効くので、能力を超える荷には負ける（＝保持できない
      //   ことも起きる。そこは現実の装置と同じ）。
      const rg = motorGate(this);
      const invISum = motorIsSolving(this) ? invIa + invIb : 0;
      if (invISum > 0) {
        const relAv = (bB ? bB.av : 0) - (bA ? bA.av : 0);   // [rad/s]
        const cdot = relAv - this.motorSpeed * rg;           // 目標との差 [rad/s]（−1 なら逆転、0 なら制動）
        // 内部トルク [kg·px²/s²] = motorTorque[N·m] × PPM²。× dt で角力積。
        const maxImpulse = this.motorTorque * M2PX * M2PX * dt;
        const oldImpulse = this.motorImpulse;
        this.motorImpulse = Math.max(-maxImpulse, Math.min(maxImpulse, oldImpulse - cdot / invISum));
        const applied = this.motorImpulse - oldImpulse;  // 実際に適用する増分
        if (bA && !bA.isStatic) bA.av -= applied * invIa;
        if (bB && !bB.isStatic) bB.av += applied * invIb;
      }
      this._solveAngleLimit();   // ★モーターのあと＝可動域の端ではモーターより可動域が勝つ
    } else if (this.type==='fixjoint') {
      // 完全固定（溶接）：位置＋角度の両方を拘束する
      const bA = this.bodyA, bB = this.bodyB;
      const invMa = bA && !bA.isStatic ? bA.invMass : 0;
      const invMb = bB && !bB.isStatic ? bB.invMass : 0;
      const invIa = bA && !bA.isStatic ? bA.invInertia : 0;
      const invIb = bB && !bB.isStatic ? bB.invInertia : 0;
      // ── ① 角度拘束：相対角を refAngle に戻す（回転を封じる）──
      const totalInvI = invIa + invIb;
      if (totalInvI > 0) {
        const curRel = (bB ? bB.angle : 0) - (bA ? bA.angle : 0);
        const angErr = curRel - this.refAngle;
        const angCorr = (angErr * 0.5) / totalInvI;      // 角度の位置補正
        if (bA && !bA.isStatic) bA.angle += angCorr * invIa;
        if (bB && !bB.isStatic) bB.angle -= angCorr * invIb;
        const relAv = (bB ? bB.av : 0) - (bA ? bA.av : 0);
        const jAv = relAv / totalInvI;                   // 角速度補正＝溶接が伝える角力積
        if (this._hOn) this._hJa -= jAv;                 // ★B が受けた角力積（熱。heatBegin の★）
        if (bA && !bA.isStatic) bA.av += jAv * invIa;
        if (bB && !bB.isStatic) bB.av -= jAv * invIb;
        // ★これが「固定端モーメント」の実体。並進の反力しか描かないと、重力と上向きの
        //   反力だけが見えて「回らないのはおかしい」という絵になるので、偶力として記録する。
        if (bA && !bA.isStatic && bA.showForces) { const w = this.getWorldAnchorA(); bA.recordTorque('constraintTorque',  jAv, w.x, w.y, this.id); }
        if (bB && !bB.isStatic && bB.showForces) { const w = this.getWorldAnchorB(); bB.recordTorque('constraintTorque', -jAv, w.x, w.y, this.id); }
      }
      // ── ② 位置拘束：2アンカーを一致させる（ヒンジと同一ロジック）──
      const totalInvM = invMa + invMb;
      if (totalInvM > 0) {
        const wa = this.getWorldAnchorA();
        const wb = this.getWorldAnchorB();
        const dx = wb.x - wa.x, dy = wb.y - wa.y;
        const err = Math.sqrt(dx*dx + dy*dy);
        if (err > 0.01) {
          const correction = (err * 0.5) / totalInvM;
          const cx = (dx / err) * correction;
          const cy = (dy / err) * correction;
          if (bA && !bA.isStatic) { bA.x += cx * invMa; bA.y += cy * invMa; bA._updateAABB(); }
          if (bB && !bB.isStatic) { bB.x -= cx * invMb; bB.y -= cy * invMb; bB._updateAABB(); }
        }
        // 速度補正
        const waN = this.getWorldAnchorA(), wbN = this.getWorldAnchorB();
        const rAx = waN.x - (bA ? bA.x : waN.x), rAy = waN.y - (bA ? bA.y : waN.y);
        const rBx = wbN.x - (bB ? bB.x : wbN.x), rBy = wbN.y - (bB ? bB.y : wbN.y);
        const vAx = bA ? bA.vx - bA.av * rAy : 0, vAy = bA ? bA.vy + bA.av * rAx : 0;
        const vBx = bB ? bB.vx - bB.av * rBy : 0, vBy = bB ? bB.vy + bB.av * rBx : 0;
        const relVx = vBx - vAx, relVy = vBy - vAy;
        const k11 = invMa + invMb + rAy*rAy*invIa + rBy*rBy*invIb;
        const k12 = -rAy*rAx*invIa - rBy*rBx*invIb;
        const k22 = invMa + invMb + rAx*rAx*invIa + rBx*rBx*invIb;
        const det = k11*k22 - k12*k12;
        if (det !== 0) {
          const jx = (-relVx*k22 + relVy*k12) / det;
          const jy = (-relVy*k11 + relVx*k12) / det;
          if (this._hOn) { this._hJx += jx; this._hJy += jy; }   // ★B が受けた力積（熱）
         if (bA && !bA.isStatic) { bA.applyImpulse(-jx, -jy, waN.x, waN.y); bA.recordForce('constraint', -jx, -jy, waN.x, waN.y, this.id); }
         if (bB && !bB.isStatic) { bB.applyImpulse( jx,  jy, wbN.x, wbN.y); bB.recordForce('constraint',  jx,  jy, wbN.x, wbN.y, this.id); }
        }
      }
    }
  }
}
// ── ジョイントの端の「取り付け先」は3通り ────────────────────────────────
//   ① 物体 … アンカーはその物体のローカル座標。物体と一緒に動く
//   ② 地面 … アンカーは地面のローカル座標。地面を傾ける／上下させると一緒に動く
//   ③ 背景 … アンカーはワールド座標＝空間に打った杭。何があっても動かない
//   端を置き直す操作（ツールでの設置・端のドラッグ・全体のドラッグ）は必ずここを通す。
//   3通りの取り違え（例：地面に付いた端をワールド座標として書き換える）が起きないように。
//   ★地面に付ける端は、必ず地面の「表面」へ吸着させる（ローカルの高さ n を 0 にする）。
//     地中に埋まったアンカーは、そこへ向かってロープ／棒が地面を貫いて伸びるだけで
//     意味がない。表面に吸着すれば、たるんだロープは素直に地面の上へ寝る。
function setJointEnd(j, end, body, wx, wy, onGround) {
  const g = !body && !!onGround;
  let a;
  if (body)   a = getLocalAnchor(body, wx, wy);
  else if (g) { a = groundLocalFromWorld(wx, wy); a.y = 0; }
  else        a = { x: wx, y: wy };
  if (end === 'A') { j.bodyA = body || null; j.groundA = g; j.anchorAx = a.x; j.anchorAy = a.y; }
  else             { j.bodyB = body || null; j.groundB = g; j.anchorBx = a.x; j.anchorBy = a.y; }
}
// ── ヒンジを外す・留め直す（2026-10-01）─────────────────────────────
//   ★留め直すときは「いまその場所で」留める。物体側のアンカー（板にあけた穴）は
//     そのままにして、反対側（釘）を穴のいまの位置へ打ち直す。外していた間に板が
//     振れていても元の場所へ引き戻さない（引き戻すと、留めた瞬間に板が跳ぶ）。
//   ★どちらが「穴」かは動ける物体の側。両端とも動けるなら A を穴にして B を合わせる。
function setHingeDetached(j, off) {
  if (!j || j.type !== 'hinge') return;
  off = !!off;
  if (j.detached === off) return;
  if (!off) {
    // ★setJointEnd は通さない。あちらは地面の端を地表へ吸着させるので、宙に打った
    //   地面付きの釘が地表まで落ちる。ここは高さを保ったまま地面のローカルへ直す。
    const local = (body, onGround, w) => body ? getLocalAnchor(body, w.x, w.y)
                                       : onGround ? groundLocalFromWorld(w.x, w.y) : { x: w.x, y: w.y };
    const dynA = j.bodyA && !j.bodyA.isStatic, dynB = j.bodyB && !j.bodyB.isStatic;
    if (!dynA && dynB) { const a = local(j.bodyA, j.groundA, j.getWorldAnchorB()); j.anchorAx = a.x; j.anchorAy = a.y; }
    else               { const a = local(j.bodyB, j.groundB, j.getWorldAnchorA()); j.anchorBx = a.x; j.anchorBy = a.y; }
    // ★可動域の 0 も留め直した姿勢にする（留めた瞬間に可動域の外にいることになるため）
    j.refAngle = (j.bodyB ? j.bodyB.angle : 0) - (j.bodyA ? j.bodyA.angle : 0);
  }
  j.detached = off;
  for (const b of [j.bodyA, j.bodyB]) if (b && !b.isStatic) { b.sleeping = false; b.sleepTimer = 0; }
}
// 取り付け先とローカル座標から world 座標を求める（Joint を作る前に使える版）
function jointEndWorld(body, onGround, lx, ly) {
  if (body) return getWorldAnchor(body, lx, ly);
  return onGround ? groundWorldFromLocal(lx, ly) : { x: lx, y: ly };
}
// ─── Joint <-> JSON（bodyA/bodyB を id 参照に変換して循環参照を回避）───
function serializeJoint(j) {
  return {
    id: j.id,                                 // ★リモコンが指すので保存する（上の★）
    type: j.type,
    bodyAId: j.bodyA ? j.bodyA.id : null,
    bodyBId: j.bodyB ? j.bodyB.id : null,
    groundA: j.groundA, groundB: j.groundB,   // ★地面に取り付けた端（旧シーンには無い＝背景固定）
    anchorAx: j.anchorAx, anchorAy: j.anchorAy,
    anchorBx: j.anchorBx, anchorBy: j.anchorBy,
    restLength: j.restLength, stiffness: j.stiffness, damping: j.damping,
    maxLength: j.maxLength, motorSpeed: j.motorSpeed, motorTorque: j.motorTorque, motorCh: j.motorCh,
    motorBrake: j.motorBrake,
    angleLimit: j.angleLimit, angleLo: j.angleLo, angleHi: j.angleHi,   // ★可動域
    color: j.color, refAngle: j.refAngle,
    releasable: j.releasable,               // ★解放フラグ。Undo/保存の両方がここを通る
    detached: j.detached,                   // ★外してあるヒンジ
    layers: j.layers,                       // ★旧シーンには無い → 両端から自動継承される
    radius: j.radius, linDensity: j.linDensity, friction: j.friction,
    nodes: (j.type === 'rope' && j.nodes && j.nodes.length)   // ★巻き付き形状を保存
      ? j.nodes.map(n => ({ x: n.x, y: n.y, vx: n.vx, vy: n.vy })) : undefined,
  };
}
function deserializeJoints(arr, bodyList) {
  if (!arr) return [];
  const byId = new Map(bodyList.map(b => [b.id, b]));
  const out = [];
  for (const d of arr) {
    const bA = d.bodyAId != null ? byId.get(d.bodyAId) : null;
    const bB = d.bodyBId != null ? byId.get(d.bodyBId) : null;
    // 非nullの参照先が1つでも解決できなければ破棄（幽霊ジョイント＝放射状化を防ぐ）
    if (d.bodyAId != null && !bA) continue;
    if (d.bodyBId != null && !bB) continue;
    const j = new Joint({ ...d, bodyA: bA, bodyB: bB });
    if (d.refAngle !== undefined) j.refAngle = d.refAngle;
    if (d.type === 'rope' && d.nodes && d.nodes.length) restoreRopeNodes(j, d.nodes);   // ★巻き付き形状を復元
    out.push(j);
  }
  return out;
}
function serializeLaser(L) {
  // ★color は波長から導出されるので保存しない（旧シーンの color は無視され、既定波長になる）
  return { id: L.id, bodyId: L.body ? L.body.id : null, localX: L.localX, localY: L.localY,
           angle: L.angle, wavelength: L.wavelength, whiteLight: L.whiteLight, interactHost: L.interactHost,
           width: L.width, beamMode: L.beamMode, rayNum: L.rayNum,
           coherent: L.coherent };
}
function deserializeLasers(arr, bodyList) {
  if (!arr) return [];
  const byId = new Map(bodyList.map(b => [b.id, b]));
  const out = [];
  for (const d of arr) {
    const body = d.bodyId != null ? byId.get(d.bodyId) : null;
    if (d.bodyId != null && !body) continue;   // 設置先が消えていたら破棄
    out.push(new Laser({ ...d, body }));
  }
  return out;
}
class MouseJoint {
  constructor(body, localX, localY, tx, ty) {
    this.body = body;
    this.localX = localX; this.localY = localY;
    this.targetX = tx; this.targetY = ty;
    this.maxForce = grabMaxForce;   // [N] 出せる力の上限
    // ★ソフト拘束のパラメータ。k=mω²・d=2mζω と質量に比例させるので、
    //   重い物体でも応答（追従の速さ）が変わらず、ζ=1 なら振動しない。
    this.frequency    = 5.0;        // [Hz] 追従の速さ
    this.dampingRatio = 1.0;        // ζ。1=臨界減衰＝行き過ぎない
    this.jx = 0; this.jy = 0;       // 力積アキュムレータ [kg·px/s]
    this.angDampRate = grabAngDamp; // [1/s] 回転の減衰（小さいほどヒンジのように回る。state.js の★）
    // ★Shift を押している間、向きを完全に固定する（掴んだ向きのまま運ぶ）。
    //   角度の書き戻しは enforceGrabbedAngles() がサブステップの最後に行うので、
    //   接触・衝突・ジョイントに押されても崩れない（＝「完全固定」）。
    this.lockAngle   = false;
    this.lockedAngle = 0;
  }
  // Shift の押し下げ／離しを反映する。押した瞬間の向きを覚え、以後それを保つ。
  syncAngleLock(on) {
    if (on && !this.lockAngle && this.body) this.lockedAngle = this.body.angle;
    this.lockAngle = !!on;
  }
  // ── サブステップの頭：ソフト拘束の係数（gamma [1/kg]・beta [1/s]）を決め、力積を 0 に戻す ──
  // ★ばねの硬さは「つかんだ物体1つ」ではなく「ジョイントでつながった物体ぜんぶ」の質量で
  //   決める（massOf＝makeAssemblyMassOf）。手が運ぶのは組み立て全体なので、1つぶんの
  //   k=mω² だと相手が重いほど手のばねが柔らかくなり、ζ も √(m/M) に落ちて振動する。
  //   実測：1kg の球に棒で 10kg を吊って持ち上げて止めると、旧式は +12.7px 行き過ぎて
  //   −21.6px まで戻り、たるみも 13.8px（単体なら行き過ぎ 0・たるみ 1.1px）。
  //   ＝つかむツールの「びよんびよん」の正体だった。
  prepare(dt, massOf) {
    const b = this.body;
    this.jx = 0; this.jy = 0;
    this._gamma = 0; this._beta = 0;
    if (!b || b.isStatic || dt <= 0) return;
    if (b.sleeping) { b.sleeping = false; b.sleepTimer = 0; }
    const m  = massOf ? massOf(b) : b.mass;
    const w  = 2 * Math.PI * this.frequency;
    const d  = 2 * m * this.dampingRatio * w;   // [kg/s]
    const k  = m * w * w;                        // [kg/s²]
    const g  = dt * (d + dt * k);
    this._gamma = g !== 0 ? 1 / g : 0;
    this._beta  = dt * k * this._gamma;
  }
  // ★接続ジョイント・接触と同じ反復の中で解く（step.js）。先に1回だけ解くと、棒や
  //   ロープの向こうの質量が見えないまま力積を決めてしまい、硬さを組み立て全体で
  //   決めても設計どおりに効かない。力積は累積（jx, jy）で持ち、gamma·j 項と
  //   上限クランプはその累積に効かせる。
  solve(dt) {
    const b = this.body;
    if (!b || b.isStatic || dt <= 0 || !this._gamma) return;
    const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
    const rx = this.localX * cos - this.localY * sin;
    const ry = this.localX * sin + this.localY * cos;
    const ax = b.x + rx, ay = b.y + ry;
    const gamma = this._gamma, beta = this._beta;
    const Cx = ax - this.targetX, Cy = ay - this.targetY;   // 位置誤差 [px]
    const im = b.invMass, ii = b.invInertia;
    const k11 = im + ry*ry*ii + gamma;
    const k12 = -rx*ry*ii;
    const k22 = im + rx*rx*ii + gamma;
    const det = k11*k22 - k12*k12;
    if (det === 0) return;
    const vx = b.vx - b.av * ry, vy = b.vy + b.av * rx;
    const rhsX = -(vx + beta*Cx + gamma*this.jx);
    const rhsY = -(vy + beta*Cy + gamma*this.jy);
    let ix = ( k22*rhsX - k12*rhsY) / det;
    let iy = (-k12*rhsX + k11*rhsY) / det;
    // 累積力積を上限でクランプ（重い物体は届かない＝手応えが出る）
    const oldX = this.jx, oldY = this.jy;
    this.jx += ix; this.jy += iy;
    const maxImp = this.maxForce * M2PX * dt;
    const jl = Math.hypot(this.jx, this.jy);
    if (jl > maxImp) { this.jx = this.jx/jl*maxImp; this.jy = this.jy/jl*maxImp; }
    ix = this.jx - oldX; iy = this.jy - oldY;
    b.applyImpulse(ix, iy, ax, ay);
  }
  // ── 反復のあと：回転の減衰はサブステップに1回だけ（反復ごとに掛けると iterations 倍効く）──
  finish(dt) {
    const b = this.body;
    if (!b || b.isStatic || dt <= 0) return;
    b.av *= Math.exp(-this.angDampRate * dt);
    if (this.lockAngle) b.av = 0;     // 固定中は回転の種を残さない（角度の書き戻しは後段）
  }
  // ── 停止中(!running)の追従 ─────────────────────────────────────────────
  //   ① 目標が動いた分は、そのまま本体を平行移動させて運ぶ（moveTarget）。
  //      「掴んだ点をカーソルに合わせる」オーサリング操作なので、何にも邪魔され
  //      なければ回転しない＝置きたい向きのまま動かせる。
  //   ② 邪魔された分（ロープ・棒・接触が押し返した分）だけを solvePosition が
  //      引き戻す。引き戻しは「掴んだ点に、誤差の向きへ加える力」として解くので、
  //      並進だけでなく回転も出る。再生中のソフト拘束（solve）と同じ形の力なので、
  //      つり合いの形も同じになり、背景の固定点・接続点・掴んだ点・カーソルが
  //      一直線に並んだところへ収まる。
  //   ※ ②を並進だけで解くと、ロープ/棒が加える回転補正を打ち消す相手がいなくなり、
  //     反復のたびに同じ向きへ回り続ける（＝カーソルを動かす間ずっと暴れ、
  //     止めた位置の回転量で静止するので直線に並ばない）。
  moveTarget(tx, ty) {
    const b = this.body;
    const dx = tx - this.targetX, dy = ty - this.targetY;
    this.targetX = tx; this.targetY = ty;
    if (!b || b.isStatic) return;
    b.x += dx; b.y += dy; b._updateAABB();
  }
  solvePosition() {
    const b = this.body;
    if (!b || b.isStatic) return;
    const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
    const rx = this.localX * cos - this.localY * sin;      // 重心→掴んだ点
    const ry = this.localX * sin + this.localY * cos;
    const ex = this.targetX - (b.x + rx);                  // 掴んだ点→カーソル
    const ey = this.targetY - (b.y + ry);
    const dist = Math.hypot(ex, ey);
    if (dist < 1e-6) return;
    const ux = ex / dist, uy = ey / dist;                  // 引く向き
    const cross = rx * uy - ry * ux;                       // 腕 × 引く向き
    const k = b.invMass + cross * cross * b.invInertia;    // その向きの実効逆質量 [1/kg]
    if (k <= 1e-12) return;
    // 0.5 ずつ寄せる。ジョイント側と交互に当てるので、両方が毎回100%自分の拘束を
    // 満たすと打ち消し合って回り続ける。半分ずつなら数反復でつり合いへ収束する。
    const corr = dist / k * 0.5;                           // [kg·px]
    const dAng = cross * corr * b.invInertia;
    // 1反復で回しすぎると線形化が破れて行き過ぎる。回転量で頭打ちにし、続きは次の反復へ。
    const MAX_ANG = 0.12;                                  // [rad]
    const sc = Math.abs(dAng) > MAX_ANG ? MAX_ANG / Math.abs(dAng) : 1;
    b.x += ux * corr * sc * b.invMass;
    b.y += uy * corr * sc * b.invMass;
    b.angle += dAng * sc;
    b._updateAABB();
  }
}
// 掴んだ物体の向きを、覚えた角度へ書き戻す（Shift で固定している間だけ）。
// ★サブステップの最後に呼ぶこと。接触・衝突・ジョイントを解いたあとでないと、
//   それらが加えた回転がそのまま残ってしまい「完全固定」にならない
//   （enforceWalls や enforcePistonVessels を最後に効かせているのと同じ理由）。
// ★角速度も 0 に落とす。残すと、手を離した瞬間に溜まっていた回転が飛び出す。
// つかんだ物体とジョイントで（何段でも）つながった、動ける物体の質量の和 [kg] を返す関数を作る。
// ★固定物体（逆質量0）の先はたどらない。固定した相手は手で運ばないので質量に入れない。
//   接触はつながりに数えない：押している相手は運んでいるのではないため。
//   mouseJoints があるときだけ、サブステップごとに1回作る（step.js）。
function makeAssemblyMassOf() {
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const j of joints) {
    const a = j.bodyA, b = j.bodyB;
    if (!a || !b || a === b) continue;
    link(a, b); link(b, a);
  }
  const cache = new Map();
  return body => {
    if (cache.has(body)) return cache.get(body);
    const seen = new Set([body]), stack = [body];
    let m = 0;
    while (stack.length) {
      const b = stack.pop();
      m += b.mass;
      for (const n of adj.get(b) || []) {
        if (seen.has(n) || n.isStatic || n.invMass === 0) continue;
        seen.add(n); stack.push(n);
      }
    }
    for (const b of seen) cache.set(b, m);
    return m;
  };
}
function enforceGrabbedAngles() {
  for (const mj of mouseJoints) {
    if (!mj.lockAngle) continue;
    const b = mj.body;
    if (!b || b.isStatic) continue;
    if (b.angle !== mj.lockedAngle) { b.angle = mj.lockedAngle; b._updateAABB(); }
    b.av = 0;
  }
}
