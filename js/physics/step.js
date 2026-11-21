// 粒子を2つのソルバへ振り分けるための使い回しバッファ（毎tick確保しない＝GC負荷なし）
const _sphBuf = [];

// 接線ずれの補正で「同じ物体・同じ組を二度戻さない」ための控え（step の中で使い回す）
const _driftSeen = new Set();

// ─── 拘束が変えた速度ぶん、位置も進め直す ─────────────────────────────
//   integrate は位置を先に進めてから（区間の始めの速度で）、そのあとで接触を解いて
//   速度を直す。速度は直っても、すでに進めた位置は戻らない。床に載った物体は毎サブステップ
//   ½g·dt² ずつ床へめり込み、それを位置の補正（_pushApart）が押し戻して支えていた。
//   ★これが「山がゆっくり締まる」「箱の柱が勝手に倒れる」の原因だった。位置の補正は
//     接触の法線に沿って押すので、斜めに噛み合った山では押しの横の成分が毎サブステップ
//     残り、山が這って沈む。柱では段ごとの小さな押しの食い違いが傾きとして積もる。
//     位置の補正を切ると山は 10秒に 10〜20px 沈み続けた＝速度だけでは支えていなかった。
//     反復 16・サブステップ 8・押しを弱める（percent 0.2/0.4）はどれも効かない（崩れる時刻が
//     ずれるだけで、円の山は結局 1.5px ほど落ちる）。接線ずれの補正（collision.js の
//     correctContactTangentialDrift）は接線の成分しか戻さないので、法線の成分が残っていた。
//   ★直し方：ソルバのあとで、この一歩の位置の進みを「区間の始めの速度 v0 と終わりの速度 v1 の
//     平均 × dt」に置き直す（速度ベルレ。integrate が重力について元からしている形）。
//     載っているだけの物体は v0＝v1＝0 なので位置は動かない＝めり込みがそもそも生じない
//     （位置の補正はほぼ働かなくなる）。置き直した物体には接線ずれの補正をかけない（二重になる。
//     かけると 10°の斜面に置いた箱が 10秒で 3.5px 這い上がった）。
//     ☆「ソルバの前後の速度の差 Δv の半分を足す」形も試した。重力だけならこれと同じだが、
//       動力・空気抵抗のように integrate が位置へ丸ごと入れる力では半分しか戻らず、μs·N より
//       小さい力で引いた箱が這った（実測：摩擦のデモで 9.0N（上限 9.81N）を 5秒 → 4.7cm）。
//     ☆Δv を丸ごと位置へ入れる形も試した。止まっている物体が 21mm/s で震え続けた。
//   ★v1 からは「後ろ半分」（重力・ばね・万有引力・EM を integrate のあとで足した速度）を除く。
//     位置の更新に使わない速度なので、混ぜると速度ベルレが崩れる（collision.js の contactDrift の☆：
//     摩擦0の床の上のばね振り子の振幅が 30秒で 150 → 140px に減った）。
//   ★対象は接触のある物体と、それに溶接・ヒンジ・軸でつながった全体。つながった全体はそろえて
//     置き直す。片側だけ置き直すと拘束が引き合わせるたびに食い違いが位置へ積もる（実測：
//     エレベーターの中の体重計。かごの枠は溶接で、支える動力は天井だけに付き、天井は何にも
//     触れていない。接触している床だけ置き直すと、かごは速度 0.020m/s のまま位置だけ 0.039m/s で
//     上がった。そろえると 20秒で 0.0000m＝止まったまま。直す前のコードは 0.020m/s で上がり
//     続けていた＝動力の力を位置へ丸ごと入れていたぶんのずれ）。
//   ★ヒンジ・軸を入れられるのは、ヒンジ・軸にウォームスタートがあるから（applyJointWarm の★）。
//     ☆無いまま入れると、ジュールの実験（袋を落とす）のヒンジでつないだ袋が、着地して静まった
//       あとに崩れた（休眠 OFF・着地後 8〜30秒・初期位置を揺らした6回で熱 33〜112J。位置エネルギーは
//       減らない＝数値の誤差）。調べた順に（2026-11-20）：
//       ・効いていたのはジョイント物体の平行移動の置き直し（回転だけ外しても熱 26〜52J、平行移動
//         だけ外すと 0〜1.2J）。熱は板が g·dt をわずかに超える速さで床や粒に当たったぶん。
//       ・違った仮説：①反復中のヒンジの位置寄せとの二重補正（切ると悪化）②置き直しのあとの
//         ピンの解き直し（板の速さを 0.05〜0.1px/s しか変えない）③床の接触の点滅（板は平均 −0.05px で
//         ぴったり載り熱の直前は接触なしだが、0.1/0.5px 以内を「載っている」とみなしても熱 82〜109J）
//         ④物理的な緩和（位置エネルギーが減らない）。
//       ・効いたのは反復の回数：8 → 16 → 32 で解いた直後のヒンジの相対速度 0.19 → 0.08 → 0.02px/s、
//         熱 41〜113J → 8〜76J → 0.2〜10J。ヒンジは毎サブステップ力積を 0 から探し直していたので
//         反復 8 では解き残しが出て、置き直しがその速度を位置へ入れていた（旧の扱いでは、めり込み
//         0.46px の中＝位置補正の遊び 0.5px に吸われて表に出なかった）。
//       ・ウォームスタートを入れると 6回とも熱 0.0J・解き残し 0.000〜0.007px/s。休眠 ON なら
//         6回中 4回は丸ごと眠る。残る2回は眠れずに形がゆっくり組み替わる（板の回転 最大 4.8°・熱 0J）。
//         袋は摩擦 0 の板と粒でつり合いがほぼ中立なので、組み替わり自体はどの扱いでも起きる（旧の
//         コードでも形の変化 RMS 0.03〜0.38px・熱 0〜27J）。
//     ☆ヒンジでつないだ2枚の板のテント（立つのに要る摩擦 0.289）は、ヒンジ物体を置き直すことで
//       正しく立つようになった：既定の摩擦（合成 μs 0.36）で 10秒の開き 92px → 0px、μ0.36 の板を
//       摩擦 1 の床に立てて 14.3 → 1.2px。μ0.1・0.2 では新旧とも崩れる（理論どおり）。
//   ★ばね・ロープ・棒が付いた物体は置き直さず、今までどおり接線ずれの補正だけをかける（ばねは
//     力、ロープと棒は位置で解く PBD で、ソルバの速度の差が拘束の力積を表さないため。試していない）。
//   ★接触のない物体（飛んでいる物体・振り子）は今までどおり。
//   ★ぶつかった瞬間（|v1 − v0| が 3·g·dt を超える物体）は置き直さない（接線ずれの補正も
//     かけない＝今までと同じ扱い）。跳ね返りの速度の半分が位置に入って、跳ねる高さが変わる。
//     実測（e=0.7・2m から）：置き直すと最高点が 0.9922 → 0.4996 → 0.2514m（今まで
//     0.9837 → 0.4828 → 0.2375）、除くと今までと同じ値。g は 9.8m/s² を下限にする（無重力の
//     デモで、押しつけて止まっている接触まで除かないため）。判定に v1 − v0 を使うのは、強い力で
//     押しつけて止まっている物体（ソルバの Δv は大きいが速度は変わっていない）を衝突と
//     取り違えないため。
//   実測（乱数固定。壁のあいだに円か箱 120 個・休眠 OFF・80秒）：
//     円の山：旧 20〜70秒で重心が 1.5px 沈み続ける → 新 20秒以降 0px
//     箱の山：旧 10秒あたり 34〜74px 動き回り続ける → 新 20秒以降 0px
//     めり込みの平均：旧 0.34〜0.51px → 新 0.19〜0.21px
//     40px の箱の柱（120秒）：旧 10・15・20・30段が 43・31・17・8.8秒で倒れる → 新 10〜20段は
//       立ったまま、30段は 14.9秒で倒れる（反復 8 の速度ソルバの限界と見ている。休眠 ON なら
//       30段も立つ：sleep.js の島の★）
//   変わらなかったもの：斜面（10・20・25°）に置いた箱の静止（0.000px）・35°を滑る加速度
//   2.4116 m/s²（理論 2.4116）・μs·N の 103%/110% で引いたときの 10秒の移動（理論と 0.3% 以内）・
//   跳ね返り・振り子・摩擦のデモで動き出す力（9.8N で動かず 9.85N で動く）・卵の力の山 137.3N。
//   ☆1 tick ぶんの力積を tick の頭でまとめて速度へ足す試験（実在の操作ではない）では、
//     μs·N の 90% でも 10秒に 0.15m（旧）→ 0.20m（新）すべる。1サブステップで止められる
//     力積の上限を超えるため。動力（毎サブステップに力を足す）ではどちらも 0.000m。
//     ☆一度だけ押して滑らせる（速さのつまみ・速度ツールと同じ操作）と、止まるまでの距離は
//       理論 v²/(2μk·g) に新のほうが近い：1m/s で 252.69mm（旧）→ 254.77mm（新）、理論 254.93mm。
//       0.2m/s で 9.62 → 10.03mm（理論 10.20）。
const _solveSnap = [];
// 置き直しの対象にできるジョイント（剛な拘束）。★ヒンジ・軸はウォームスタート（下）があって初めて入れられる
const _RIGID_JOINT_TYPES = new Set(['fixjoint', 'hinge', 'axle']);
// ─── ヒンジ・軸のウォームスタート ─────────────────────────────────
//   ★接触と同じく、前のサブステップの反復で打った力積の合計を、次のサブステップの最初の反復の
//     直前に打ち直す（Box2D と同じ形）。無いと毎サブステップ 0 から探し直すので、反復 8 では
//     解き残しが出る。実測（固定点から5枚の板を吊るした鎖）：解いた直後のヒンジの相対速度
//     真下に静止 0.58 → 0.000px/s、60°から放す 0.68 → 0.009px/s、10秒で失う力学的エネルギー
//     11.9 → 8.1 J。
//   ★これが「ヒンジ物体を置き直すと袋が崩れる」の原因だった（この上の☆）。解き残しの速度を
//     置き直しが位置へ入れていた。ウォームスタートを入れると、ジュールの実験の袋（休眠 OFF・
//     着地後 8〜30秒・初期位置を揺らした6回）の熱は 33〜112J → 6回とも 0.0J。
//   ★打つのは接触の準備（prepareContact・vn0 を測る）とウォームスタートのあと。前に打つと、
//     ヒンジが引く速度を接触が「近づいてくる速度」と取り違え、反発と熱の判定を狂わせる
//     （実測：準備の前に打つと袋の板と粒の熱が 6回で最大 1036J）。
//   ★反復の中で打った力積だけを持ち越す（反復のあとのピンの解き直しのぶんは入れない＝接触の
//     反発を持ち越さないのと同じ考え）。打ち直した力積は熱と力の矢印にも入れる（入れないと
//     支える力の大半が矢印から消える）。刻みが変わった tick は接触と同じ比で縮める。
function applyJointWarm() {
  for (const j of joints) {
    j._wsOn = false;
    if ((j.type !== 'hinge' && j.type !== 'axle') || j.detached || jointLengthSuspended(j)) { j._wsx = 0; j._wsy = 0; continue; }
    const A = j.bodyA, B = j.bodyB;
    const aOn = A && !A.isStatic && A.invMass > 0 && !A.sleeping, bOn = B && !B.isStatic && B.invMass > 0 && !B.sleeping;
    j._wsOn = true; j._wAccx = 0; j._wAccy = 0;
    if (!aOn && !bOn) { j._wsx = 0; j._wsy = 0; continue; }
    const wx = j._wsx * _warmDtScale, wy = j._wsy * _warmDtScale;
    if (!wx && !wy) continue;
    const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
    if (aOn) { A.applyImpulse(-wx, -wy, wa.x, wa.y); A.recordForce('constraint', -wx, -wy, wa.x, wa.y, j.id); }
    if (bOn) { B.applyImpulse( wx,  wy, wb.x, wb.y); B.recordForce('constraint',  wx,  wy, wb.x, wb.y, j.id); }
    if (j._hOn) { j._hJx += wx; j._hJy += wy; }
    j._wAccx = wx; j._wAccy = wy;
  }
}
function finishJointWarm() {
  for (const j of joints) {
    if (!j._wsOn) continue;
    j._wsOn = false; j._wsx = j._wAccx; j._wsy = j._wAccy;
  }
}
const _SOLVE_POS_G_MIN = 9.80665;   // [m/s²] 上の★の「g の下限」
function _snapOne(b) {
  if (b._solveSnap || !b._integ) return;   // ★integrate のふつうの一本道を通った物体だけ
  if (b.isStatic || b.invMass === 0 || b.isSpawner || b._remoteDrive || b.constVel
      || b.frozen || b.held || b._softJointed) return;
  b._solveSnap = true;
  b._svx = b.vx; b._svy = b.vy; b._sav = b.av;
  _solveSnap.push(b);
}
function snapshotSolveVelocities(contacts, groundContacts) {
  _solveSnap.length = 0;
  for (const b of objects) b._softJointed = false;
  let anyWeld = false;
  for (const j of joints) {
    if (_RIGID_JOINT_TYPES.has(j.type)) { anyWeld = true; continue; }
    if (j.bodyA) j.bodyA._softJointed = true;   // ★ばね・ロープ・棒（上の★）
    if (j.bodyB) j.bodyB._softJointed = true;
  }
  for (const c of contacts) { _snapOne(c.A); _snapOne(c.B); }
  for (const gc of groundContacts) _snapOne(gc.b);
  if (!anyWeld || !_solveSnap.length) return;
  for (let grew = true; grew; ) {   // ★溶接・ヒンジ・軸でつながった全体へ広げる（上の★）
    grew = false;
    for (const j of joints) {
      if (!_RIGID_JOINT_TYPES.has(j.type)) continue;
      const A = j.bodyA, B = j.bodyB;
      if (!A || !B) continue;
      if (A._solveSnap && !B._solveSnap) { _snapOne(B); grew = grew || B._solveSnap; }
      else if (B._solveSnap && !A._solveSnap) { _snapOne(A); grew = grew || A._solveSnap; }
    }
  }
}
// 置き直した物体には _posDone を立てる（接線ずれの補正が見て、その物体を動かさない）。
//   ★印は step.js が接線ずれの補正のあとで消す。
const _posDoneList = [];
function advanceBySolvedVelocity(dt) {
  const g = Math.max(Math.hypot(world.gravX, world.gravY), _SOLVE_POS_G_MIN);
  const lim2 = (3 * g * PPM * dt) ** 2;
  for (const b of _solveSnap) {
    b._solveSnap = false;
    if (b.sleeping || b.held || b.frozen) continue;
    // 区間の終わりの速度（後ろ半分を除く）＝ v − (ソルバ直前の速度 − integrate を出たときの速度)
    const v1x = b.vx - (b._svx - b._ivex), v1y = b.vy - (b._svy - b._ivey);
    const a1  = b.av - (b._sav - b._iave);
    const ex = v1x - b._iv0x, ey = v1y - b._iv0y;
    if (ex*ex + ey*ey > lim2) continue;   // ★ぶつかった瞬間（上の★）
    // 置き直す量 ＝ (v0+v1)/2·dt − 実際に進めた量
    b.x += (0.5 * (b._iv0x + v1x) - b._iadx) * dt;
    b.y += (0.5 * (b._iv0y + v1y) - b._iady) * dt;
    if (!b.fixedRotation) b.angle += (0.5 * (b._iav0 + a1) - b._iada) * dt;
    b._updateAABB();
    b._posDone = true; _posDoneList.push(b);
  }
  _solveSnap.length = 0;
}
function clearPosDone() {
  for (const b of _posDoneList) b._posDone = false;
  _posDoneList.length = 0;
}
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
// ═══ すり抜け防止：速い物体が薄いものに近づいた tick だけ、サブステップを細かくする ═══
//  ★すり抜けの条件は「1サブステップに相対的に進む距離 > 2物体の半厚みの和」。それを超えると
//    食い込んだ姿勢を初めて見たときに中心がもう相手の向こう側にあり、SAT が浅い側＝向こう側へ
//    押し出す（または一度も重ならずに飛び越える）。実測（2026-11-19・静止した壁・重力0・e=0.5）：
//        円r3 × 壁厚 4px  … 30 m/s で抜ける（1サブステップ 12.5px > 半厚みの和 5px）
//        円r10 × 壁厚 40px … 120 m/s で抜ける（50px > 30px）
//        箱20 × 壁厚 4px  … 80 m/s で抜ける
//  ★直し方は「同じ積分を細かい刻みで回す」だけにした。投機的接触の幅を広げる方法や
//    衝突時刻まで巻き戻す方法（TOI）は、それぞれ「当たらないはずの角で止まる」
//    「残りの時間を捨てる」という近似を持ち込む。刻みを細かくするのは誤差を減らす方向にしか
//    働かない。細かくするのは条件に当たった tick だけ。
//  ★実測（2026-11-19。円r10・円r3・箱20 × 壁厚 4/20px × 5〜200 m/s、固定の壁と 3000kg/m³ の動く壁）：
//        入れる前  84 条件中 32 で抜けた（固定の壁・動く壁で 16 ずつ）
//        入れた後  抜け 0。跳ね返りの速度比（両方 e=0.5 の合成で 0.25）は前後とも全条件 0.250、
//                  動く壁との運動量は 1e-6 まで一致（抜けなかった条件では前後で同じ値）
//      全デモ 263 件の軌道（300 tick）で変わったのは 2 件だけ：
//        電気振動モデル … 弾けた電子が 10px の壁に 15 m/s で当たる（刻み2 では 1刻み 12.6px ＝
//                          抜けかける）。1.4% の tick が 3〜8 刻みに。羽根車の山は
//                          1.10 → −0.63 → +0.40 → −0.29 が 1.02 → −0.61 → +0.39 → −0.29（デモの★の幅の内）
//        卵を落とす     … 割れた破片が飛ぶ 1 tick だけ 5 刻み。割れる tick・クッションの最大の力
//                          （17.1 N）は同じ
//  ★余裕は半分（CCD_FRAC）。抜ける境目（半厚みの和）ちょうどまで進めると、斜めや角から当たったとき
//    に足りない。回転ぶんは外接半径で上から見積もる。
const CCD_FRAC = 0.5;
//  ★上限。上の実測で最も細かくしたのは 円r3 × 壁 4px × 200 m/s の 128（ちょうど上限。抜けなかった）。
//    それより速い・薄い条件では抜けうる。1 tick に 128 サブステップは物体が数個なら一瞬で終わるが、
//    物体の多い山へ撃ち込むとその tick は重い（測っていない）。
const CCD_SUBSTEP_MAX = 128;
// 物体の「いちばん薄いところの半分の厚み」[px]。円は半径。多角形は輪郭（外周と穴）の
//   辺ごとに、辺の中点から内向きに光線を飛ばして向こう側の輪郭までの距離を測り、その最小の半分。
//   ★凸パーツの幅で測らない。図形和の物体は凸分割で細い三角形がたくさんでき、面に沿って
//     寝ている細片は「外側の辺の向き」で測っても薄い。実測：電気振動モデルの壁（角丸の図形和）で、
//     パーツの幅で測ると半径 7px の電子が 1 tick に最大 11 サブステップを要求した（細片の半厚み
//     0.56px）。物体を抜けるには輪郭の端から端まで進む必要があるので、測るべきは輪郭の厚み。
//   ★中点で測るので、とがった角の先端の薄さは見ない（先端で測ると 0 に近づき、刻みが上限に
//     張りつく）。角の先端をかすめて抜けても、向こう側に物体は残っていない。
//   形は配列ごと作り直される（transform.js ほか）ので、輪郭の配列そのものを鍵にして覚えておく。
function bodyHalfThickness(b) {
  if (b.type === 'circle') return b.radius;
  const outline = b._localOutline();
  if (b._hTsrc === outline) return b._hT;
  const loops = [outline];
  if (b.holes) for (const h of b.holes) if (h && h.length >= 3) loops.push(h);
  // 偶奇則の内外判定（穴も込み）
  const inside = (px, py) => {
    let c = false;
    for (const L of loops) for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
      const a = L[i], d = L[j];
      if ((a.y > py) !== (d.y > py) && px < (d.x - a.x) * (py - a.y) / (d.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  let h = Infinity;
  for (const L of loops) {
    const n = L.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const p = L[i], q = L[(i + 1) % n];
      const ex = q.x - p.x, ey = q.y - p.y, len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const mx = (p.x + q.x) * 0.5, my = (p.y + q.y) * 0.5;
      let nx = -ey / len, ny = ex / len;
      if (!inside(mx + nx * 1e-3, my + ny * 1e-3)) { nx = -nx; ny = -ny; }
      let best = Infinity;
      for (const M of loops) for (let k = 0, m = M.length; k < m; k++) {
        if (M === L && k === i) continue;
        const P = M[k], Q = M[(k + 1) % m];
        const dx = Q.x - P.x, dy = Q.y - P.y;
        const den = nx * dy - ny * dx;
        if (Math.abs(den) < 1e-12) continue;
        const wx = P.x - mx, wy = P.y - my;
        const t = (wx * dy - wy * dx) / den, s = (wx * ny - wy * nx) / den;
        if (t > 1e-6 && s >= 0 && s <= 1 && t < best) best = t;
      }
      if (best < Infinity && best * 0.5 < h) h = best * 0.5;
    }
  }
  if (!(h < Infinity)) h = 0.5;
  b._hT = Math.max(h, 0.5);   // ★線のような 0 幅でも分母が 0 にならないように
  b._hTsrc = outline;
  return b._hT;
}
// 回転で表面の点が動く速さを見積もる半径（外接半径の上界。AABB の角まで）
function _bodySweepRadius(b) {
  if (b.type === 'circle') return 0;   // 円は回っても表面が相手へ近づかない
  const a = b._aabb;
  return Math.hypot(Math.max(a.maxX - b.x, b.x - a.minX), Math.max(a.maxY - b.y, b.y - a.minY));
}
// この tick に使うサブステップ数。world.substeps を下回ることはない。
function ccdSubsteps(pairs, dt) {
  const base = Math.max(1, world.substeps | 0);
  let n = base;
  for (let k = 0; k < pairs.length; k++) {
    const A = pairs[k][0], B = pairs[k][1];
    if ((A.layers & B.layers) === 0) continue;
    if (A.isSpawner || B.isSpawner) continue;
    if (A.isStatic && B.isStatic && !A._remoteDrive && !B._remoteDrive) continue;
    if (connectedPairs.has(pairs[k][2])) continue;
    const rel = Math.hypot(A.vx - B.vx, A.vy - B.vy)
              + Math.abs(A.av) * _bodySweepRadius(A) + Math.abs(B.av) * _bodySweepRadius(B);
    const travel = rel * dt;                       // 1 tick に相対的に進む距離 [px]
    if (travel <= n * CCD_FRAC * 1.0) continue;    // ★半厚みの和は最低 1px（各 0.5px 以上）なので確実に足りる
    const need = Math.ceil(travel / (CCD_FRAC * (bodyHalfThickness(A) + bodyHalfThickness(B))));
    if (need > n) n = need;
  }
  return n > CCD_SUBSTEP_MAX ? CCD_SUBSTEP_MAX : n;
}
// ★サブステップの刻みが前の tick と変わったら、ウォームスタートで打ち直す力積を刻みの比で
//   直す（力積＝力×刻み。そのまま打つと最初のサブステップだけ支える力が刻みの比だけ狂う）。
//   刻みが変わらない tick は 1 のままなので、掛けても値は1ビットも変わらない。
let _ccdPrevSubDt = 0;
let _warmDtScale = 1;

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
    clearContactLoad(b);              // ★接触から受けた力（fracture.js）は tick ごとに積み直す
  }
  counterBeginTick();                 // ★通過カウンタ：粒子の tick 頭の位置（物体は上の _prevX）
  // ★分子気体はサブステップ列より前で回す。分子が壁へ渡す力積は「速度 → 位置」の
  //   順で効かせないとエネルギーが漏れる。位置を進めたあとに力積を足す順にすると、
  //   振動する系から系統的にエネルギーを抜き続ける（実測：気体の上に浮かせた蓋で、
  //   気体＋蓋の力学的エネルギーが 60秒で 2,383J → 1,681J と 29% 減った。
  //   重力を切って蓋を自由にすると同じコードで 1,211J が 50秒間 4桁一致で保存する＝
  //   衝突の式ではなく順序の問題であることの証拠）。
  stepMolecularGas(dt);
  const pairs = broadPhasePairs(dt);
  // ★速い物体が薄いものに近いときだけ刻みを細かくする（上の ccdSubsteps の★）。
  //   broadPhasePairs は 1 tick ぶんの移動を見込んで組を拾うので、ここで漏れはない。
  const nSub = ccdSubsteps(pairs, dt);
  const subDt = dt / nSub;
  for (let s = 0; s < nSub; s++) {
    _warmDtScale = (s === 0 && _ccdPrevSubDt > 0) ? subDt / _ccdPrevSubDt : 1;
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
    snapshotSolveVelocities(contacts, groundContacts);   // ★ソルバの直前の速度を控える（冒頭の★）

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
    applyJointWarm();   // ★ヒンジ・軸のウォームスタート（接触の準備とウォームスタートのあと。下の関数の★）
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
    finishJointWarm();
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
    advanceBySolvedVelocity(subDt);   // ★拘束が変えた速度ぶん位置も進め直す（このファイル冒頭の★）
    // ★接線方向の位置ずれを戻す（静止摩擦の位置拘束）。理由は collision.js の
    //   correctContactTangentialDrift の★。**貫入の補正とは別に、1サブステップに
    //   一度だけ**効かせる（下の positionIterations の中に入れると回数ぶん効く）。
    //   ★同じ物体に複数の接触点があっても1回だけ。角ごとに戻すと点の数だけ効く
    //     （平らに置いた箱は角が2つあるので、そのままだと2倍ずれを戻して逆へ動く）。
    //   ★上で置き直した物体（_posDone）は動かさない（このファイル冒頭の★）。
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
    clearPosDone();

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
    if (world.sleeping) updateSleeping(subDt, contacts);   // ★接触も島をつなぐ（sleep.js の★）
  }
  _ccdPrevSubDt = subDt;
  _warmDtScale = 1;
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
  // ★割れる物体は tick の最後で置き換える（fracture.js の★）。グラフの標本を取ったあとに
  //   置くのは、割れた tick の力（いちばん大きい値）を速度グラフの「受けた力」に残すため。
  applyFractures();
}
// ════════════════════════════════════════
//  RENDERING
// ════════════════════════════════════════
