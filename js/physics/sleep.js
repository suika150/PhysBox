// 眠りに入れる速さ [px/s]。★ここを外から参照するものがある（スリンキーの端に付けた物体を
//   「起こすべきか」の判定に同じしきい値を使う。別々に持つと、片方だけが起こし続ける）。
const SLEEP_LIN_TH = 4.8;
// 眠りに入れる角速度 [rad/s] と、それを下回り続けて眠るまでの時間 [s]。★回路のモーター
//   （circuit.js の applyMotorTorques）が「このトルクは起こすに値するか」の判定に同じ値を使う。
const SLEEP_ANG_TH = 1.2, SLEEP_TIME_TH = 0.6;
// 重心からいちばん遠い点までの距離 [px]（AABB の角で上から押さえる）。
//   ★回転の眠りは「角速度」ではなく「縁の速さ」で決める（下の判定）。角速度だけで見ると
//     大きな物体ほど速く動いたまま眠る：半径 2.25m の外歯車（遊星歯車のデモの外の輪）は
//     0.6rad/s（縁で 1.35m/s）で回っていても 1.2rad/s を下回るので 1秒で眠り、速度を 0 に
//     消されていた。眠るたびに輪の角運動量が消えるので、太陽を回すと輪が止まった側へ
//     引き戻され、腕を止めて輪を回すと太陽のモーターが上限に張り付いた。
//     実測（乱数固定・300tick の平均。太陽 3rad/s・200N·m、腕を止める）：
//       旧 輪 −0.49±0.18rad/s・モーターの張り付き 100% → 眠りを切ると −0.991±0.013・5%
//       （理論 −1）。惰性で回すだけでも角運動量が 1秒で −404 → +49 に消えていた。
//   ★角速度のしきい値も残す（小さな物体は従来どおり）。縁の条件は並進と同じ SLEEP_LIN_TH。
function _sleepReach(b) {
  const a = b._aabb;
  if (!a) return 0;
  const dx = Math.max(b.x - a.minX, a.maxX - b.x), dy = Math.max(b.y - a.minY, a.maxY - b.y);
  return Math.sqrt(dx*dx + dy*dy);
}
function updateSleeping(subDt) {
  const linTh2 = SLEEP_LIN_TH * SLEEP_LIN_TH, angTh = SLEEP_ANG_TH, timeTh = SLEEP_TIME_TH;   // [px/s]², [rad/s], [s]
  const jointTimeTh = 1.0;   // ジョイント接続物は少し長めに様子を見てから眠らせる
  // ① 1つずつ「眠る準備ができたか」（しきい値を下回り続けた時間）を数える。ここでは眠らせない
  for (const b of objects) {
    // ★生成口は眠らせない。動かないので必ず眠りに落ちるが、眠りは速度を0にするので、
    //   出す速さが遅い型（4.8px/s＝0.048m/s 未満）だと 0.6 秒で型の速さが消える。
    if (b.isStatic || b.frozen || b.isSpawner) continue;
    // ★外から力を受け続けているものは眠らせない。流れの場の中も同じ扱いにする
    //   （bodyInActiveFlow の★を参照。入れないと、薄い媒質では加速がしきい値に届く前に
    //     下の判定が速度を 0 に戻してしまい、いつまでも動き出せない）
    // ★動力は「いま 0 でも」眠らせない。つまみやリモコンで 0 から上げる使い方が
    //   いちばん多く（引く力をだんだん強くして、いつ滑り出すか）、眠ったまま上げると
    //   速度を 0 に戻され続けて動き出せない（モーターの★と同じ形の事故）。
    if (b.held || bodyHasThrusters(b) || b.showForces || bodyInActiveFlow(b)) {
      b.sleeping = false; b.sleepTimer = 0; continue;
    }
    if ((b.vx*b.vx + b.vy*b.vy) < linTh2 && Math.abs(b.av) < angTh
        && Math.abs(b.av) * _sleepReach(b) < SLEEP_LIN_TH) b.sleepTimer += subDt;
    else { b.sleepTimer = 0; b.sleeping = false; }
  }
  // ★モーターが「回せ」と言われている軸につながった物体は眠らせない（上の「外から力を
  //   受け続けているもの」と同じ扱い。動力を付けた物体を眠らせないのと同じ理由）。
  //   モーターはトルクで回すので、止まっているところからは 1サブステップで
  //   角速度が少ししか積めない（実測：I=0.18kg·m² に 20N·m で 0.46rad/s）。眠りの
  //   しきい値 1.2rad/s に届かないまま毎サブステップ 0 へ戻されるので、いちど眠った
  //   軸は二度と回り出せない（実測：リモコン〈押すと効く〉を付けた円板は 3秒で眠り、
  //   そのあとキーを押しても 0.000rad/s のままだった）。
  for (const j of joints) {
    if (!motorIsDriving(j)) continue;
    const A = j.bodyA, B = j.bodyB;
    if (A && !A.isStatic) { A.sleeping = false; A.sleepTimer = 0; }
    if (B && !B.isStatic) { B.sleeping = false; B.sleepTimer = 0; }
  }
  // ② ジョイントでつながったまとまり（島）は、全員の準備ができたときにそろって眠る。
  //   1人でもまだなら全員起きたまま。★準備の時間（sleepTimer）は起こしても消さない。
  //   以前は「眠った者を、起きている相手が起こしてタイマーを 0 に戻す」形だったので、
  //   島の中でタイマーがずれると交互に起こし合って永久に眠れなかった（実測：自己保持の
  //   デモで止まった台車と後輪・前輪が 0.5秒ずれて 1秒ごとに起こし合い、極小の揺れが
  //   モーター端子に 1e-7〜5e-6A の電流を流し続けた＝電流の点が止まったまま残った）。
  const parent = new Map();
  const find = b => { let r = b; while (parent.get(r) !== r) r = parent.get(r); parent.set(b, r); return r; };
  const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const b of objects) if (!b.isStatic) parent.set(b, b);
  for (const j of joints) {
    const A = j.bodyA, B = j.bodyB;
    if (A && B && parent.has(A) && parent.has(B)) unite(A, B);
  }
  const notReady = new Set();
  for (const b of objects) {
    if (!parent.has(b)) continue;
    const th = jointedBodies.has(b) ? jointTimeTh : timeTh;
    if (b.frozen || b.isSpawner || !(b.sleepTimer > th)) notReady.add(find(b));
  }
  for (const b of objects) {
    if (!parent.has(b) || b.frozen || b.isSpawner) continue;
    if (notReady.has(find(b))) { b.sleeping = false; continue; }
    if (!b.sleeping) { b.sleeping = true; b.vx = 0; b.vy = 0; b.av = 0; }
  }
}
function wakeOnContact(contacts) {
  for (const c of contacts) {
    const a = c.A, b = c.B;
    if (a.sleeping && !b.isStatic && !b.sleeping) { a.sleeping = false; a.sleepTimer = 0; }
    if (b.sleeping && !a.isStatic && !a.sleeping) { b.sleeping = false; b.sleepTimer = 0; }
  }
}
function wakeAll() {
  for (const b of objects) { b.sleeping = false; b.sleepTimer = 0; }
}
// --- Clipper.jsを用いた図形処理 ---
