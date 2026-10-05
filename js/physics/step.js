// 粒子を2つのソルバへ振り分けるための使い回しバッファ（毎tick確保しない＝GC負荷なし）
const _sphBuf = [];

// 接線ずれの補正で「同じ物体・同じ組を二度戻さない」ための控え（step の中で使い回す）
const _driftSeen = new Set();
function sanitizeWorld() {
  let broke = false;
  for (const b of objects) {
    if (bodyIsSane(b)) {
      b._gx = b.x; b._gy = b.y; b._ga = b.angle;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > SANE_VEL) { const k = SANE_VEL / sp; b.vx *= k; b.vy *= k; }
      if (Math.abs(b.av) > 1e4) b.av = Math.sign(b.av) * 1e4;
      continue;
    }
    b.x = b._gx !== undefined ? b._gx : 0;
    b.y = b._gy !== undefined ? b._gy : 0;
    b.angle = b._ga !== undefined ? b._ga : 0;
    b.vx = 0; b.vy = 0; b.av = 0;
    b.sleeping = false; b.sleepTimer = 0;
    b._invalidateShape(); b._updateAABB();
    broke = true;
  }
  for (const j of joints) {
    if (j.type !== 'rope' || !j.nodes) continue;
    if (broke) { resetRopeChain(j); continue; }
    for (const n of j.nodes) {
      if (Number.isFinite(n.x) && Number.isFinite(n.y) &&
          Math.abs(n.x) < SANE_POS && Math.abs(n.y) < SANE_POS) continue;
      resetRopeChain(j);
      break;
    }
  }
  if (broke) {
    clearContactWarmStart();   // 発散前の力積を次のティックへ持ち込まない
    console.warn('PhysBox: 数値が発散したため直前の状態へ復帰しました');
  }
}
const SIM_HZ = 60;
const SIM_DT = 1 / SIM_HZ;
const SIM_MAX_TICKS = 8;      // 1フレームで進める上限。重いときに雪だるま式に遅れないため
let simAccum = 0;
// ★編集ツールでドラッグ中（held）の物体は integrate を通らない（body.js の早期return）ので、
//   速度が「掴んだ瞬間の値」のまま凍りつく。導体棒だと、止めているのに起電力が出続けて
//   電流が流れっぱなしになる。実際に動かした量から速度を作り直す。
//   ・掴んだ瞬間と停止中は速度0（＝止めれば電流も止まる）
//   ・ドラッグ中は動かした速さがそのまま E = BLv になる（手で動かして起電力を出せる）
//   マウスの更新はフレーム単位なので、フレームに1回だけ求める。サブステップごとに求めると
//   動きのないティックで速度が0に落ちてちらつく。
const HELD_VEL_TAU = 0.06;    // [s] なまし時間（マウス移動の飛び飛びを平す）
function updateHeldVelocities(simDt) {
  for (const b of objects) {
    // ★生成口の速度は「運動」ではなく「出てくる物体に渡す値」なので、作り直さない。
    //   ここを通すと、選ぶために枠をクリックした瞬間（掴んだ直後＝速度0）に型の速さが
    //   消え、出てきた物体がその場に留まる＝生成が止まったように見える。
    //   同じ理由の除外が mouse.js のドラッグ終了（vx を消さない）にもある。
    if (b.isSpawner) continue;
    if (!b.held) { b._heldX = undefined; continue; }
    if (b._heldX === undefined || !(simDt > 0)) {
      b.vx = 0; b.vy = 0;                       // 掴んだ直後／一時停止中は静止として扱う
    } else {
      const tx = (b.x - b._heldX) / simDt, ty = (b.y - b._heldY) / simDt;
      const a = Math.min(1, simDt / HELD_VEL_TAU);
      b.vx += (tx - b.vx) * a;
      b.vy += (ty - b.vy) * a;
    }
    b._heldX = b.x; b._heldY = b.y;
  }
  // ★つかむツールで運んでいる回路も同じ式で速度を作る。回路素子は幾何しか持たず
  //   （質量も速度も無い）ので、実際に動かした量からしか速度を出せない。
  //   なましの時定数も物体と共通にする＝手の動きに対する応答が同じになる。
  const h = typeof circuitHold !== 'undefined' ? circuitHold : null;
  if (h) {
    if (h._lx === undefined || !(simDt > 0)) { h.vx = 0; h.vy = 0; }
    else {
      const tx = (h.x - h._lx) / simDt, ty = (h.y - h._ly) / simDt;
      const a = Math.min(1, simDt / HELD_VEL_TAU);
      h.vx += (tx - h.vx) * a;
      h.vy += (ty - h.vy) * a;
    }
    h._lx = h.x; h._ly = h.y;
  }
}
function simTick() {
  const dt = SIM_DT;
  // ★リモコンの「いま押しているか」を相手へ配る。tick の頭で1回だけ（人の操作なので
  //   サブステップの途中で変わることはない）。値は書き換えず、効かせるかどうかだけ。
  applyRemotes();
  jointedBodies.clear();
  for (const j of joints) {
    if (j.detached) continue;          // ★外してあるヒンジ（joint.js の constructor の★）
    if (j.bodyA) jointedBodies.add(j.bodyA);
    if (j.bodyB) jointedBodies.add(j.bodyB);
  }
  rebuildConnectedPairs();
  updatePinnedRigidBodies();          // ★ヒンジ2本以上＝動けない物体として扱う
  let _hasRod = false;
  const _pinJoints = [];
  for (const j of joints) {
    if (j.type === 'rod') _hasRod = true;
    else if (j.detached) continue;
    else if (j.type === 'hinge' || j.type === 'fixjoint' || j.type === 'axle') _pinJoints.push(j);
  }
  for (const b of objects) {
    b.clearForces(); b._contactThisTick = false;
    b._prevX = b.x; b._prevY = b.y; b._prevA = b.angle;
  }
  counterBeginTick();                 // ★通過カウンタ：粒子の tick 頭の位置（物体は上の _prevX）
  // ★分子気体はサブステップ列より前で回す。分子が壁へ渡す力積は「速度 → 位置」の
  //   順で効かせないとエネルギーが漏れる。位置を進めたあとに力積を足す順にすると、
  //   振動する系から系統的にエネルギーを抜き続ける（実測：気体の上に浮かせた蓋で、
  //   気体＋蓋の力学的エネルギーが 60秒で 2,383J → 1,681J と 29% 減った。
  //   重力を切って蓋を自由にすると同じコードで 1,211J が 50秒間 4桁一致で保存する＝
  //   衝突の式ではなく順序の問題であることの証拠）。
  stepMolecularGas(dt);
  const subDt = dt / world.substeps;
  const pairs = broadPhasePairs(dt);
  for (let s = 0; s < world.substeps; s++) {
    // ★拘束の熱：頭の相対速度は、力を積分する**前**に控える（joint.js の heatBegin の★）
    _heatSubstepId++;
    if (world.thermalOn) {
      for (const j of joints) j.heatBegin();
      // ★接触の熱：力を積分する前の速度を控える（thermal.js の impactHeatOf の★）
      for (const b of objects) { b._vx0 = b.vx; b._vy0 = b.vy; b._av0 = b.av; b._v0Id = _heatSubstepId; }
    }
    // ★EM: E場・磁場(Boris)・クーロンで速度更新。**半分ずつ、位置を進める前と後に**効かせる
    //   （速度ベルレ）。1サブステップぶんを丸ごと前で足すと（半陰的オイラー）、一定の力の
    //   もとで1ステップごとに ½·m·a²·h² ずつエネルギーが減り、弾んで速度が反転するたびに
    //   それが実際に失われる。実測：電場の中で壁と弾む電子1個が 15秒で −4.7%（式の予測と一致）。
    //   電気振動モデルの反発をすべて1にして切った15秒では、ΔE −1.03 J のうち 0.79 J が
    //   熱にも数えられずに消えていた → 半分ずつにして +0.003 J。
    //   ★後ろの半分は integrate の直後（新しい位置で力を測り直す）、接触を解く前に置く。
    //     磁場も半分の刻みで2回まわす：前だけで1回まわすと、Boris の「電場半分→回転→電場半分」
    //     の中心がずれる。式だけを写した数値実験（qE/m=2・qB/m=4・h=1/240）で、速度選択器の
    //     v=E/B で直進するはずの粒子が 10秒で 0.021 横へずれた（旧の順序・半分ずつ2回は 0）。
    //     静止から放した E×B ドリフトの速さは旧と半分ずつ2回で同じ（0.50051 と 0.50052、理論 0.5）。
    emStepPre(subDt * 0.5);
    // ★万有引力も半分ずつ、位置を進める前と後に（速度ベルレ。上の EM と同じ理由）。
    //   以前は integrate のあとに1サブステップぶんを丸ごと足していた。それだと力の向きが
    //   区間の終わりの位置だけで決まり、衝突で速度が反転するたびにエネルギーが漏れ・湧く。
    //   実測は gravitation.js の applyGravitation の★。
    applyGravitation(subDt * 0.5);
    // ★気体室は integrate の「前」。integrate は重力を足してから位置を進めるので、
    //   後ろに置くと気体の力が位置に効くのが1サブステップ遅れ、さらにピストンの減衰が
    //   重力の加速分まで毎回食ってしまう。実測では釣り合いの圧力が理論値から
    //   c·g·dt（400×9.8/240 ＝ 16.3N ぶん）ずれていた。
    applyGasChambers(subDt);                 // ★気体室がピストンを押す力（P−大気圧）×A
    limitVesselPistons(subDt);               // ★容器の行き止まりを先読み（integrate の前。vessel.js の★）
    for (const b of objects) b.integrate(subDt);
    advanceEMFieldPhases(subDt);             // ★交流の電場の位相（field.js の★。後ろ半分は区間の終わりの場）
    emStepPre(subDt * 0.5);                 // ★EM の残り半分（上の★）
    applyGravitation(subDt * 0.5, true);    // ★万有引力の残り半分（新しい位置で測り直す）
    applyIdealSprings(subDt * 0.5, subDt, true);   // ★理想ばねの後ろ半分（接触を解く前。slinky.js の applyIdealSprings の★）
    applySphCoupling(subDt);                 // ★水など粒子が物体を押す力（重力と同じ扱い）
    applyMolPressure(subDt);                 // ★気体分子が壁を叩く力（頭打ち無し。蓋を持ち上げる）
    applyFlowFields(subDt);                  // ★流れの場（風・水流）の抗力。速度に効くので位置を進める前
    // ★EM: 回路をMNAで解き、導体棒へ F=BIL を返す。
    //   時刻を明示して渡す。world.simTime はティックの最後に dt だけ進むので、そのまま使うと
    //   substeps 個のサブステップが全部「同じ時刻」になり、交流電源の起電力が凍りつく。
    //   すると後退オイラーのコンデンサーは 2回目以降 V が動かず I=C·dV/dt が 0 に落ちる
    //   （交流＋コンデンサーだけの回路で電流が消えていた原因）。
    //   時刻はサブステップの「終わり」を渡す。ソルバは後退オイラー（未知数は区間の終端の値）
    //   なので、起電力も同じ終端で評価するのが整合する。最後のサブステップは
    //   world.simTime + dt ＝ ティック終了後の simTime になり、表示される値と時刻も揃う。
    emStepPost(subDt, world.simTime + (s + 1) * subDt);

    for (const j of joints) {
      if (j.type === 'axle') j.motorImpulse = 0;
      if (j.type === 'rope') j._posApplied = false;
    }

    if (mouseJoints.length) {
      const massOf = makeAssemblyMassOf();   // ★手のばねの硬さは組み立て全体の質量で（MouseJoint.prepare の★）
      for (const mj of mouseJoints) mj.prepare(subDt, massOf);
    }
    const contacts = [];
    // ★面（同じ対から出た接触点の並び）は解くときもひとまとめにする。2点が同じ法線を
    //   共有していると逐次 Gauss-Seidel が既定の反復数で一意解に届かないため
    //   （collision.js の prepareManifold の★に実測）。
    const manifolds = [];
    for (const [a, b, pk] of pairs) {
      const cs = detectCollision(a, b, pk);
      if (cs && (a._remoteDrive || b._remoteDrive)) {
        // ★手で動かしている物体 × 逆質量0の相手は力積で解けない（collision.js の
        //   blockHandAgainstFixed の★）。固定した相手なら手が譲る。手どうしは何もしない。
        const D = a._remoteDrive ? a : b, F = D === a ? b : a;
        if (F._remoteDrive) continue;
        if (F.isStatic) {
          blockHandAgainstFixed(cs, D, subDt);
          noteProgramContact(a, b);
          continue;
        }
      }
      if (cs) {
        for (const c of cs) contacts.push(c);
        manifolds.push(cs);
        a._contactThisTick = true; b._contactThisTick = true;
        noteThermalContact(a, b);   // ★熱は tick に一度だけ効かせるので、ここでは記録だけ
        noteProgramContact(a, b);   // ★プログラムの「当たったら」も同じ理由でここは記録だけ
      }
    }
    const groundContacts = [];
    if (world.terrain) {
      for (const b of objects) {
        if ((b.isStatic && !b._remoteDrive) || b.sleeping || b.frozen) continue;
        const gcs = detectGroundCollision(b);
        if (gcs && b._remoteDrive) {
          // ★手で動かしている物体は地面にも入り込めない（collision.js の blockHandAgainstFixed の★）
          blockHandAgainstGround(gcs, b, subDt);
          noteProgramEnvContact(b, PROG_GROUND_ID);
          continue;
        }
        if (gcs) {
          groundContacts.push(...gcs); b._contactThisTick = true;
          noteProgramEnvContact(b, PROG_GROUND_ID);   // ★プログラムの「当たったら」の相手に地面も入れる
        }
      }
    }
    if (world.sleeping) wakeOnContact(contacts);

    // ── 接触の速度ソルブ（3段階）──────────────────────────────
    //   詳しくは geometry.js「接触ソルバの共通部」。要点だけ：
    //   1. 準備 … 接触点ごとの実効質量と「サブステップ開始時の接近速度 vn0」を作り、
    //             前サブステップの力積を打ち直す（ウォームスタート）
    //   2. 反復 … 非貫入と摩擦を、力積を積算しながら解く。反発はまだ入れない。
    //             積算するので反復は同時解へ収束し、解く順序が答えを変えない
    //   3. 反発 … vn0 だけを種に、最後にまとめて与える。反復中に膨らんだ接近速度が
    //             混ざらないので、跳ね返りで力学的エネルギーが増えない
    for (const c of contacts) prepareContact(c, subDt);
    for (const m of manifolds) prepareManifold(m);   // ★prepareContact のあと（_kn を使う）
    for (const gc of groundContacts) prepareGroundContact(gc, subDt);
    // ★ウォームスタートは全部の prepare のあとで打つ（collision.js の applyContactWarm の★）
    for (const c of contacts) applyContactWarm(c, subDt);
    for (const gc of groundContacts) applyGroundWarm(gc, subDt);
    // ★法線をぜんぶ解いてから摩擦をぜんぶ解く（1つの接触点で法線→摩擦と続けない）。
    //   続けてしまうと、1点目の法線力積だけで物体が大きく回った瞬間の滑りに摩擦が
    //   全力で反応し、2点目を解いて回転が打ち消されたあとも、その大きな摩擦力積が
    //   左右で釣り合うまで何反復もかかる（背の高い箱ほどひどい）。法線をブロックで
    //   先に収束させておけば、摩擦が見る滑りは最初から本来の値に近い。
    for (let it = 0; it < world.iterations; it++) {
      for (const mj of mouseJoints) mj.solve(subDt);   // ★ジョイントと同じ反復で（MouseJoint.solve の★）
      for (const j of joints) j.solve(subDt);
      for (const m of manifolds) solveManifoldNormal(m);
      for (const gc of groundContacts) solveGroundNormal(gc);
      for (const c of contacts) solveContactFriction(c);
      for (const gc of groundContacts) solveGroundFriction(gc);
    }
    for (const mj of mouseJoints) mj.finish(subDt);   // 回転の減衰はサブステップに1回
    // ★ウォームスタートへ持ち越すのは、ここまでの「非貫入ぶん」だけにする。
    //   ウォームスタートは “ずっと触れている接触の支える力積” を次のサブステップで
    //   探し直さずに済ませるための技法（geometry.js の warmOf の★＝積み上げた箱が沈まない）。
    //   反発の力積は支える力ではなく、ぶつかった瞬間に一度だけやりとりするものなので、
    //   次のサブステップの初期値に混ぜると同じ衝突をもう一度打つことになる。
    //   ふつうは跳ねた直後に離れるので表に出ないが、離れられない配置（すきま0の溝に
    //   挟まった板）では毎サブステップ打ち直され、エネルギーが際限なく増える
    //   （実測：自由膨張デモで仕切りの固定をはずすと、prepareContact が 600tick で
    //     系の運動エネルギーの +102% を注ぎ込んでいた）。
    for (const c of contacts) c._jnWarm = c._jn;
    for (const gc of groundContacts) gc._jnWarm = gc._jn;
    // 反発パスは「いま実際に跳ねる接触」が1つでもあるときだけ回す。ふつうに載って
    // いるだけの接触は接近速度が 1 m/s 未満で e=0 なので、積み上げた箱では素通りする。
    let anyRest = false;
    for (const c of contacts) if (c._e > 0) { anyRest = true; break; }
    if (!anyRest) for (const gc of groundContacts) if (gc._e > 0) { anyRest = true; break; }
    if (anyRest) {
      // 反発も接触点ごとに逐次で打つので、複数点マニフォールド（平らに落ちた
      // 長方形の左右の角）を対称に収束させるには反復が要る。
      for (let it = 0; it < world.iterations; it++) {
        for (const m of manifolds) applyManifoldRestitution(m);
        for (const gc of groundContacts) applyGroundRestitution(gc);
      }
      // ── 反発のあとに非貫入をもう一度確かめる ────────────────────────────
      //   ★すでにそこにある壁へ向かっては跳ね返れない。向かい合う2面に挟まれた物体では、
      //     片側が「+δ で跳ね返れ」と与えた速度がそのまま反対側への接近速度になる。反発は
      //     vn0 だけを種にする＝相手側の要求を見ないので、両立しないまま解かれて力学的
      //     エネルギーが増える。実測（すきま0の溝に挟まった蓋を分子気体が叩く・20秒）：
      //         入れる前  E/E0 1.94倍・気体 20→300℃・300個中 242個が継ぎ目から漏れた
      //         入れた後  E/E0 0.73倍・気体 20→−17℃・漏れは 5個
      //     ☆残る 0.73 は別の口（挟まった蓋が分子から角速度をもらい、その回転が溝に
      //       噛んで散る）。蓋の回転を止めると確認パスの有無で1ビットも変わらなくなる
      //       ＝くさびがそもそも生じない。ピストンを1自由度に拘束するのが本筋で、
      //       ここは「増えるよりは減るほうがまし」という保険にとどめる。
      //   ★積算を分けるのが要点（collision.js の verifyContactNormal の★）。実測：
      //     自由膨張デモの仕切りを解き放って 820px/s で壁へ激突させると、
      //         積算を共有   E/E0 0.5655（−43%）・気体 20→−108.8℃
      //         積算を分ける E/E0 1.0088 ＝ 確認パス無しと 1ビットも変わらない
      //   ★既存デモ12本（ニュートンのゆりかご・床で跳ねる・斜めに跳ねる・運動量保存・
      //     斜面・転倒・はしご・浮力・自由膨張・不可逆変化・ブラウン運動・
      //     ピストンのつりあい）を 600tick 回して、物体と粒子の重心・気体温度が
      //     すべて同じであることを確かめてある。
      for (let it = 0; it < world.iterations; it++) {
        for (const c of contacts) verifyContactNormal(c);
        for (const gc of groundContacts) verifyGroundNormal(gc);
      }
    }
    for (const c of contacts) finishContact(c);          // 次サブステップへ力積を残す
    for (const gc of groundContacts) finishGroundContact(gc);
    rotateContactWarmStart();
    // ★接線方向の位置ずれを戻す（静止摩擦の位置拘束）。理由は collision.js の
    //   correctContactTangentialDrift の★。**貫入の補正とは別に、1サブステップに
    //   一度だけ**効かせる（下の positionIterations の中に入れると回数ぶん効く）。
    //   ★同じ物体に複数の接触点があっても1回だけ。角ごとに戻すと点の数だけ効く
    //     （平らに置いた箱は角が2つあるので、そのままだと2倍ずれを戻して逆へ動く）。
    _driftSeen.clear();
    for (const c of contacts) {
      const k = c.A.id < c.B.id ? c.A.id + '_' + c.B.id : c.B.id + '_' + c.A.id;
      if (_driftSeen.has(k)) continue;
      _driftSeen.add(k);
      correctContactTangentialDrift(c);
    }
    _driftSeen.clear();
    for (const gc of groundContacts) {
      if (_driftSeen.has(gc.b.id)) continue;
      _driftSeen.add(gc.b.id);
      correctGroundTangentialDrift(gc);
    }

    if (_hasRod) for (let it = 0; it < 4; it++) solveRopeBodyCollisions();
    updateRopeChains(subDt, true);
    // ★スリンキーはワールドのサブステップの中で、さらに自前の刻みで回る。
    //   剛性から決まる CFL のほうが細かいので（弦の stepDt と同じ考え方）。
    updateSlinkies(subDt);
    for (let it = 0; it < world.positionIterations; it++) {
      for (const m of manifolds) correctManifoldPosition(m);   // ★面ごとに1回（collision.js の★）
      const seen = new Set();
      for (const gc of groundContacts) {
        if (seen.has(gc.b)) continue;
        seen.add(gc.b);
        correctGroundPosition(gc);
      }
    }
    // ★理想ばねの前の半分（次のサブステップのぶん）。軸・ヒンジのピンを解く前に入れて、
    //   留めた物体に入った力積を位置が進む前に拘束へ見せる（slinky.js の applyIdealSprings の★）
    applyIdealSprings(subDt * 0.5, subDt);
    enforceRigidHinges();
    for (let it = 0; it < 3; it++) {
      for (const j of _pinJoints) j.solve(subDt);
    }
    enforceRigidHinges();
    if (world.thermalOn) for (const j of joints) j.heatEnd(subDt);   // ★拘束の熱（heatBegin の★）
    applyGuideProjection();
    enforcePistonVessels();  // ★ピストン容器：ピストンを軸上の1自由度に閉じ込める
    enforceWalls();          // ★壁は最後に効かせる（拘束で押し出された分もここで閉じ込める）
    enforceGrabbedAngles();  // ★Shift で固定中の向きを書き戻す（接触で回された分も戻す）
    bgFrictionPost(subDt);   // ★背景摩擦の静止判定：ロープ・棒・接触がかけた力まで足して決める
    if (world.sleeping) updateSleeping(subDt);
  }
  const finv = dt > 1e-9 ? 1 / (dt * M2PX) : 0;
  for (const b of objects) {
    if (!b.showForces) continue;
    for (const t in b._forces) { b._forces[t].fx *= finv; b._forces[t].fy *= finv; }
  }
  // ★粒子は2つのソルバに分かれる。SPH（水）と気体分子運動論（molecule.js）は
  //   前提が正反対（位置ベースの密度緩和 ↔ 速度ベースの弾性衝突）なので混ぜられない。
  //   配列は共有したままここで振り分ける＝保存・選択・温度グラフは1本のまま。
  //   ★分子だけはサブステップ列の「前」で回してある（この位置ではない。上の
  //     stepMolecularGas を参照）。SPH はここに残す＝較正された挙動を動かさない。
  const _sph = _sphBuf;
  _sph.length = 0;
  for (const p of particles) if (!p.prm.kinetic) _sph.push(p);
  if (_sph.length > 0) SPH.update(_sph, dt);
  else for (const b of objects) if (b._cpl) b._cpl = null;   // 粒子を消したら連成力も消す
  // ★熱のやりとりは全部「熱の網」に登録してから、tick の頭の温度で同時に解く（thermal.js の★）。
  //   粒子の伝導は上の SPH.update が走査のついでに登録済み。
  linkBodyBodyHeat();          // 物体どうしの熱伝導（このtickで接触していたペア）
  linkGasHeat();               // 気体室とシリンダー壁
  linkRadiation();             // 熱放射（接触が要らない）
  solveHeatNet(dt);
  // ★加熱・冷却の領域は取引ではなく系の外から入る熱なので、網を解いた「あと」で足す。
  //   先に足すと、足した直後の温度で取引を見積もることになり、流れ続ける定常状態が
  //   倍率に比例してずれる（網の★と同じ理由）。後にしても違いは広がり始めが1tick遅れるだけ。
  applyHeatFields(dt);
  updateWaveField(dt);
  // ★プログラム（複製・削除・色・レイヤー）は、サブステップ列を全部終えたここで効かせる。
  //   接触を解いている最中にレイヤーや物体の数が変わると、同じ1回の接触の前半と後半で
  //   前提が食い違う（program.js 冒頭の★）。
  updatePrograms(dt);
  sanitizeWorld();
  // ★軌跡は tick に一度だけ記録する（動いている物体も、静止・睡眠・運搬中の物体も同じ）。
  //   以前は動く物体だけ body.integrate の中で記録していたので、点の密度が substeps に
  //   比例していた。軌跡は見せ方であって物理ではないのに、ソルバの細かさという無関係な
  //   設定で中身が変わるうえ、20000点の上限に当たって「保持秒数」が黙って短くなる
  //   （実測：substeps 64 で 10秒と指定しても 5.2秒ぶんしか残らず、点の描画で FPS が
  //     39 まで落ちた。1 tick 1点なら substeps によらず 600点・60 FPS）。
  //   点が粗くなるぶんの折れ（連続3点の外接円から出した、弦と弧のすきま）は実測で
  //   斜方投射（比較）0.03px・速度の合成 0.76px・位置→位置+運動 0.68px・2重振り子 0.60px。
  //   線の太さ 1.5px より細かいので、見た目は変わらない（前後のスクリーンショットでも同じ）。
  // ★物体の姿勢も控える。軌跡・残像を「回る物体から見た道すじ」へあとから直すのに要る
  //   （js/app/camera.js の姿勢の記録の★）。軌跡もストロボも使っていなければ何も貯めない。
  recordPoseLogs();
  for (const b of objects) {
    if (!b.tracerEnabled) continue;
    b.recordTracePoint();
    b.trimTracePoints();
  }
  recordParticleTraces(dt);     // ★粒子にも軌跡を付けられる（particles.js の★）
  recordStrobe();               // ★ストロボの露光（tickに一度。全物体で同じ時刻に写す）
  sampleVelGraph(dt);
  sampleWaveGraph(dt);   // ★波の受信計（1窓=1物体）
  sampleCircuitGraph(dt);      // ★回路の電流・電圧の波形
  sampleEnergyGraph(dt);       // ★系の力学的エネルギー
  sampleMomGraph(dt);          // ★系の運動量（成分ごと）
  sampleTempGraph(dt);         // ★温度の時間変化
  samplePvGraph(dt);           // ★気体の状態が (V,P) 平面をたどった経路
  world.simTime += dt;
  stepCount++;
  updateCounters();              // ★通過カウンタ（位置が確定し simTime を進めたあとで数える。物理には触れない）
  updateSpdMeters();             // ★速さの分布計（同上）
}
// ════════════════════════════════════════
//  RENDERING
// ════════════════════════════════════════
