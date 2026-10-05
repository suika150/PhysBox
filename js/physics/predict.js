// ════════════════════════════════════════
//  予測軌道（速度ツールのプレビュー）
// ════════════════════════════════════════
//  本番の1サブステップは step.js の
//      emStepPre(subDt/2) → applyGravitation(subDt/2) → 各 body.integrate(subDt)
//        → emStepPre(subDt/2) → applyGravitation(subDt/2)
//  という順で、subDt = SIM_DT / world.substeps。ここではその順序と刻みをそのまま
//  再現する。だから下に挙げた力しか働かないかぎり、この線は「だいたいの軌道」ではなく
//  本番の軌道そのものになる（誤差ゼロ）。
//
//  ■ 扱う力（すべて位置と速度だけの関数なので、安く先読みできる）
//      重力           … body.js integrate の冒頭
//      万有引力       … gravitation.js applyGravitation
//      静電気力       … circuit.js applyCoulomb ＋ 電場（applyEMForces ①③）
//      ローレンツ力   … circuit.js applyEMForces ②（Boris 回転）
//      空気抵抗・動力・ガイド拘束
//                     … integrate() に同居している。既定では効かない（Cd=0）が、
//                       設定されているのに予測だけ真空で飛ばすと目に見えて外れるので含める。
//  ■ 扱わない力
//      接触／ジョイント／ロープ／導体棒の F=BIL ／モーターのトルク
//        これらは反復ソルバで履歴と拘束の連立を持つので安く先読みできない。
//        → 最初の接触で線を打ち切り、そこに着弾マーカーを出す（嘘をつかないため）。
//
//  ★式を直すときは、上に挙げた本番側の関数と必ず揃えること。とくに磁場は
//    Boris 回転（|v| を厳密に保存する解法）をそのまま写している。ここを
//    「F = qv×B を前進オイラーで足す」に書き換えると、予測円が閉じずに
//    外へ広がっていく。ローレンツ力は「円になること」自体が見せ場なので致命的。
//
//  ★状態を型付き配列に平らに持っているのは、万有引力とクーロン力が O(N²) で、
//    これがドラッグ中に毎フレーム回るため。オブジェクトのプロパティ経由で書くと
//    同じ計算で5倍以上遅くなり、線を引くたびに画面が引っかかる。

const PREDICT_SECONDS   = 3.0;      // [s] 先読みする時間
const PREDICT_MAX_STEPS = 3000;     // 安全上限（重い場面で1フレームを使い切らないため）
const PREDICT_MARK_SEC  = 0.5;      // [s] 等時間マーカーの間隔。点の混み具合＝速さになる
const PREDICT_MAX_DIST2 = 20000*20000;   // [px²] 発射点からこれ以上離れたら打ち切る（＝200m）
// 1フレームで許す仕事量。超えるぶんは先読み時間を縮めて受け止める
// （フレームを落とすくらいなら線が短いほうがまし）。
//   ・多体力（万有引力・クーロン）は O(N²) なので「ペア×ステップ」で数える
//   ・それ以外は動く物体1個につき1ステップぶんなので「物体×ステップ」で数える
// いずれも実測から、合計で 2〜3ms に収まる値にしてある。
const PREDICT_PAIR_BUDGET = 80000;
const PREDICT_BODY_BUDGET = 100000;
const PREDICT_MIN_STEPS   = 60;     // これ未満しか回せない場面では線を出さない（0.25秒未満）

// 当たり判定用の外接半径 [px]。接触の打ち切りに使うだけなので厳密な形状は要らない。
function _predictRadius(b) {
  if (b.type === 'circle') return b.radius;
  if (b.type === 'box')    return 0.5 * Math.hypot(b.w, b.h);
  let r2 = 0;
  for (const v of (b.verts || [])) r2 = Math.max(r2, v.x*v.x + v.y*v.y);
  if (r2 > 0) return Math.sqrt(r2);
  const a = b._aabb;
  return a ? 0.5 * Math.hypot(a.maxX - a.minX, a.maxY - a.minY) : 10;
}
// 速度に垂直な投影幅 [m]。body.js の dragWidthM と同じ式だが、本体の現在の姿勢ではなく
// 予測中の姿勢・速度で測る。幅は mx−mn の差なので平行移動は効かない＝回転だけ与えれば
// 本家と数学的に同一（近似ではない）。
function _predictDragWidthM(b, angle, vx, vy, speedPx) {
  if (b.type === 'circle') return b.radius * 2 * PX2M;
  const inv = 1 / (speedPx || 1);
  const nx = -vy * inv, ny = vx * inv;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let mn = Infinity, mx = -Infinity;
  for (const v of b._localOutline()) {
    const wx = v.x*cos - v.y*sin, wy = v.x*sin + v.y*cos;
    const d = wx*nx + wy*ny;
    if (d < mn) mn = d;
    if (d > mx) mx = d;
  }
  return Math.max(mx - mn, 1) * PX2M;
}

// ── 本体 ────────────────────────────────────────
//  targets … 初速を与える物体（velocityTargets の戻り値）
//  vx,vy   … 与える初速（内部単位 [px/s]。computeLaunchVelocity の info.vx/vy と同じ）
//  戻り値  … [{ body, pts:[{x,y}], marks:[{x,y}], hit:{x,y}|null }]
//
//  他の物体も同じ場の中で一緒に動かす。万有引力とクーロン力は多体問題なので、
//  相手を固定すると同程度の質量どうしの系（二重星など）で明確に嘘になるため。
//  1回の積分で全員の位置が出るので、対象が複数でもコストは変わらない。
function predictTrajectories(targets, vx, vy) {
  if (!targets || !targets.length || !objects.length) return [];
  const n = objects.length;
  const dt = SIM_DT / Math.max(1, world.substeps);

  // ── 状態を平らに写す ──
  const B = objects;
  const X = new Float64Array(n), Y = new Float64Array(n);
  const VX = new Float64Array(n), VY = new Float64Array(n);
  const ANG = new Float64Array(n), AV = new Float64Array(n);
  const M = new Float64Array(n), Q = new Float64Array(n);
  const IM = new Float64Array(n), II = new Float64Array(n), RAD = new Float64Array(n);
  // takes＝力を受け取れるか（acceptsForce）、moves＝位置が動くか（integrate の早期 return）。
  // 眠っている物体は「力は受け取るが動かない」という本番の挙動をそのまま再現する。
  const TAKES = new Uint8Array(n), MOVES = new Uint8Array(n);
  const HASG = new Uint8Array(n), STAT = new Uint8Array(n);
  // PLAIN＝抗力も動力もガイドも回転固定も持たない、ふつうの物体。積分の最内側で
  // 本体のプロパティを引かずに済ませるための印（教材シーンではほぼ全部がこれ）。
  const PLAIN = new Uint8Array(n);
  const tset = new Set(targets);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const b = B[i];
    X[i] = b.x; Y[i] = b.y; VX[i] = b.vx; VY[i] = b.vy;
    ANG[i] = b.angle; AV[i] = b.av;
    M[i] = b.mass; Q[i] = isFieldSource(b) ? (b.charge || 0) : 0;
    IM[i] = b.invMass; II[i] = b.invInertia; RAD[i] = _predictRadius(b);
    TAKES[i] = acceptsForce(b) ? 1 : 0;
    MOVES[i] = (!b.isStatic && b.invMass > 0 && !b.frozen && !b.held && !b.sleeping) ? 1 : 0;
    HASG[i] = (b.hasGravity && isFieldSource(b)) ? 1 : 0;
    STAT[i] = b.isStatic ? 1 : 0;
    PLAIN[i] = (!(b.drag > 0 && world.airDensity > 0) && !b.thrusters.length &&
                !b.guideEnabled && !b.fixedRotation) ? 1 : 0;
  }
  // 対象へ初速を与える。mouse.js の適用と同じ（並進のみ・角速度0・必ず起こす）
  for (let i = 0; i < n; i++) {
    const b = B[i];
    if (!tset.has(b) || b.isStatic) continue;
    VX[i] = vx; VY[i] = vy; AV[i] = 0;
    TAKES[i] = 1; MOVES[i] = 1;
    if (b.guideEnabled) {                       // ガイド付きはレール方向の成分だけ残る
      const gx = Math.cos(b.guideAngle), gy = Math.sin(b.guideAngle);
      const vd = VX[i]*gx + VY[i]*gy;
      VX[i] = vd*gx; VY[i] = vd*gy;
    }
    lines.push({ i, out: { body: b, pts: [{ x: X[i], y: Y[i] }], marks: [], hit: null,
                           straight: null, straightMarks: [] },
                 x0: X[i], y0: Y[i], done: false,
                 // ★与えた初速そのもの（ガイド付きならレール方向に落とした後の値）。
                 //   「力が働かなければ」の直線を引くのに使う
                 vx0: VX[i], vy0: VY[i],
                 // t=0 ですでに重なっている相手は、いったん離れるまで当たり判定から外す。
                 // これが無いと、地面に載っている物体が発射した瞬間に「着地」してしまう。
                 armedGround: true, blocked: new Set() });
  }
  if (!lines.length) return [];

  // ── 参加者リスト（ゼロ電荷や重力を切った物体を毎ステップ触らないため）──
  const qi = [], gi = [], ci = [];
  for (let i = 0; i < n; i++) {
    if (Q[i]) qi.push(i);
    if (HASG[i]) gi.push(i);
    if (B[i].layers) ci.push(i);                // 衝突なし（layers=0）は当たり判定から外す
  }
  const nq = world.coulombOn ? qi.length : 0;
  const ng = world.gravitation ? gi.length : 0;
  const gSoften2 = gravSoften2();               // 本体と同じ ε²（world.gravSoften）
  const pairs = nq*(nq-1)/2 + ng*(ng-1);   // ★万有引力は1歩に2回数える（半分ずつ前後。③の★）
  // 1ステップの仕事量から先読み時間を決める。予算に下限（「最低◯歩は回す」）を
  // 置いてはいけない：物体が多い場面で予算を無視して回り続け、線は短いのに
  // フレームだけ落ちる、といういちばん困る状態になる。
  let nSteps = Math.min(PREDICT_MAX_STEPS, Math.round(PREDICT_SECONDS / dt));
  if (pairs > 0) nSteps = Math.min(nSteps, Math.floor(PREDICT_PAIR_BUDGET / pairs));
  let nMove = 0;
  for (let i = 0; i < n; i++) if (MOVES[i]) nMove++;
  nSteps = Math.min(nSteps, Math.floor(PREDICT_BODY_BUDGET / Math.max(1, nMove)));
  // 短すぎる線は軌道として読めないので、出さないほうがよい（誤読のもと）
  if (nSteps < PREDICT_MIN_STEPS) return [];
  const markEvery = Math.max(1, Math.round(PREDICT_MARK_SEC / dt));

  // 発射時点で重なっているものを控えておく
  const groundOn = world.terrain;
  for (const L of lines) {
    const i = L.i;
    L.armedGround = !(groundOn && (B[i].layers & ground.layers) &&
                      signedDistToGround(X[i], Y[i]) <= RAD[i]);
    for (const j of ci) {
      if (j === i || !(B[i].layers & B[j].layers)) continue;
      const dx = X[j]-X[i], dy = Y[j]-Y[i], rr = RAD[i]+RAD[j];
      if (dx*dx + dy*dy <= rr*rr) L.blocked.add(j);
    }
  }

  const hasFields = emFields.length > 0;
  const kC = world.coulombK * world.emForceScale;
  const G  = world.gravStrength;
  const eScale = world.emForceScale;
  let live = lines.length;

  // ① emStepPre 相当：電場の半分 → Boris 回転 → 電場の残り半分 → クーロン。
  //   ★本番と同じく、刻みの半分ずつを位置を進める前と後に効かせる（step.js の★）
  //   ★交流の電場は先読みの時刻 tAhead で測る（本番は位相を積み上げるが、予測は場を進めない）
  let tAhead = 0;
  const emKick = dt => {
    if (hasFields) {
      for (let k = 0; k < qi.length; k++) {
        const i = qi[k];
        if (!TAKES[i]) continue;
        const F = emFieldAt(X[i], Y[i], tAhead);
        const Ex = F.ex, Ey = F.ey, Bz = F.bz;
        if (!Ex && !Ey && !Bz) continue;
        const q = Q[i], m = M[i];
        const hax = (q*Ex/m) * M2PX * (dt*0.5) * eScale;
        const hay = (q*Ey/m) * M2PX * (dt*0.5) * eScale;
        VX[i] += hax; VY[i] += hay;
        if (Bz) {                                // ★Boris 回転（|v| を厳密に保存）
          // ★本番（circuit.js applyEMForces ②）と同じく bzRightHanded を通す。
          //   ここを素の Bz に戻すと、予測線だけが実際と逆向きに曲がる
          const tt = q*bzRightHanded(Bz)*dt/(2*m), s = 2*tt/(1+tt*tt);
          const vpx = VX[i] + VY[i]*tt, vpy = VY[i] - VX[i]*tt;
          VX[i] = VX[i] + vpy*s;
          VY[i] = VY[i] - vpx*s;
        }
        VX[i] += hax; VY[i] += hay;
      }
    }
    if (nq) {
      for (let a = 0; a < nq; a++) {
        const i = qi[a];
        for (let b2 = a + 1; b2 < nq; b2++) {
          const j = qi[b2];
          if (STAT[i] && STAT[j]) continue;
          const dx = X[j]-X[i], dy = Y[j]-Y[i];
          const r2px = dx*dx + dy*dy + COULOMB_SOFTEN2;
          const invr = 1 / Math.sqrt(r2px);
          const F = kC * Q[i] * Q[j] / (r2px * PX2M * PX2M);   // [N]（同符号＝正＝斥力）
          const fx = F*dx*invr * M2PX * dt, fy = F*dy*invr * M2PX * dt;
          if (TAKES[j]) { VX[j] += fx/M[j]; VY[j] += fy/M[j]; }
          if (TAKES[i]) { VX[i] -= fx/M[i]; VY[i] -= fy/M[i]; }
        }
      }
    }
  };
  // ③ applyGravitation 相当。★本番と同じく1歩に半分ずつ、位置の前と後に効かせる
  //   （step.js の★。gravitation.js の applyGravitation の★に実測）
  const gravKick = (h) => {
    if (!ng) return;
    for (let a = 0; a < ng; a++) {
      const i = gi[a];
      for (let b2 = a + 1; b2 < ng; b2++) {
        const j = gi[b2];
        if (STAT[i] && STAT[j]) continue;
        const dx = X[j]-X[i], dy = Y[j]-Y[i];
        const r2 = dx*dx + dy*dy + gSoften2;
        const invr = 1 / Math.sqrt(r2);
        const f = G * M[i] * M[j] / r2;
        const fx = f * dx * invr * h, fy = f * dy * invr * h;
        if (TAKES[i]) { VX[i] += fx/M[i]; VY[i] += fy/M[i]; }
        if (TAKES[j]) { VX[j] -= fx/M[j]; VY[j] -= fy/M[j]; }
      }
    }
  };
  for (let step = 0; step < nSteps && live > 0; step++) {
    tAhead = step * dt;
    emKick(dt * 0.5);
    gravKick(dt * 0.5);                          // ★万有引力の前半（③の★）
    // ② integrate 相当：重力 → 空気抵抗 → 動力 → ガイド → 位置更新
    const gx = gravPxX() * dt, gy = gravPxY() * dt;
    for (let i = 0; i < n; i++) {
      if (!MOVES[i]) continue;
      if (HASG[i]) { VX[i] += gx; VY[i] += gy; }
      // ★大多数の物体は抗力も動力もガイドも持たない。その場合は本体のプロパティを
      //   一切引かずに位置を進める（ここは全ステップ×全物体で回る最内側）
      // ★位置は重力の半分だけ手前の速度で進める（body.js の integrate の★。本番と揃える）
      const hgx = HASG[i] ? gx * 0.5 : 0, hgy = HASG[i] ? gy * 0.5 : 0;
      if (PLAIN[i]) {
        X[i] += (VX[i] - hgx) * dt;
        Y[i] += (VY[i] - hgy) * dt;
        ANG[i] += AV[i] * dt;
        continue;
      }
      const b = B[i];
      if (b.drag > 0 && world.airDensity > 0) {
        const v2 = VX[i]*VX[i] + VY[i]*VY[i];
        if (v2 > 1e-6) {
          const v = Math.sqrt(v2), vm = v * PX2M;
          const A  = _predictDragWidthM(b, ANG[i], VX[i], VY[i], v) * world.depth;
          const Fn = 0.5 * world.airDensity * b.drag * A * vm * vm;
          const aPx = (Fn / M[i]) * M2PX * dt;
          VX[i] -= (VX[i]/v) * aPx;
          VY[i] -= (VY[i]/v) * aPx;
        }
      }
      // ★動力は何個でも付く。リモコンで切ってあるものは予測にも入れない
      //   （body.js の integrate と同じ判定を通す）。
      for (const th of b.thrusters) {
        const tg = th._remoteHold === undefined ? 1 : th._remoteHold;
        if (!th.force || !tg) continue;
        const ta = ANG[i] + th.dir;
        const F = th.force * tg * M2PX * dt;
        const jx = Math.cos(ta) * F, jy = Math.sin(ta) * F;
        const cos = Math.cos(ANG[i]), sin = Math.sin(ANG[i]);
        const rx = th.localX*cos - th.localY*sin;
        const ry = th.localX*sin + th.localY*cos;
        if (b.guideEnabled) {                    // applyImpulse と同じくレール方向だけ通す
          const dx = Math.cos(b.guideAngle), dy = Math.sin(b.guideAngle);
          const jd = jx*dx + jy*dy;
          VX[i] += jd*dx * IM[i]; VY[i] += jd*dy * IM[i];
        } else {
          VX[i] += jx * IM[i]; VY[i] += jy * IM[i];
        }
        AV[i] += (rx*jy - ry*jx) * II[i];
      }
      if (b.guideEnabled) {
        const dx = Math.cos(b.guideAngle), dy = Math.sin(b.guideAngle);
        const vd = VX[i]*dx + VY[i]*dy;
        VX[i] = vd*dx; VY[i] = vd*dy;
      }
      let px = hgx, py = hgy;
      if (b.guideEnabled) {
        const dx = Math.cos(b.guideAngle), dy = Math.sin(b.guideAngle);
        const d = px*dx + py*dy;
        px = d*dx; py = d*dy;
      }
      X[i] += (VX[i] - px) * dt;
      Y[i] += (VY[i] - py) * dt;
      if (b.fixedRotation) AV[i] = 0;
      ANG[i] += AV[i] * dt;
    }
    tAhead = (step + 1) * dt;
    emKick(dt * 0.5);                            // ★EM の残り半分（①の★）
    gravKick(dt * 0.5);                          // ★万有引力の残り半分（③の★）
    // ④ 記録と打ち切り判定
    const mark = ((step + 1) % markEvery === 0);
    for (const L of lines) {
      if (L.done) continue;
      const i = L.i, xi = X[i], yi = Y[i], ri = RAD[i];
      let hit = false;
      if (groundOn && (B[i].layers & ground.layers)) {
        if (signedDistToGround(xi, yi) <= ri) { if (L.armedGround) hit = true; }
        else L.armedGround = true;
      }
      if (!hit) {
        const li = B[i].layers, blocked = L.blocked;
        for (let k = 0; k < ci.length; k++) {
          const j = ci[k];
          if (j === i || !(li & B[j].layers)) continue;
          const dx = X[j]-xi, dy = Y[j]-yi, rr = ri + RAD[j];
          if (dx*dx + dy*dy <= rr*rr) { if (!blocked.has(j)) { hit = true; break; } }
          else if (blocked.size) blocked.delete(j);
        }
      }
      L.out.pts.push({ x: xi, y: yi });
      if (mark) L.out.marks.push({ x: xi, y: yi });
      if (hit) { L.out.hit = { x: xi, y: yi }; L.done = true; live--; continue; }
      const ddx = xi - L.x0, ddy = yi - L.y0;
      if (ddx*ddx + ddy*ddy > PREDICT_MAX_DIST2) { L.done = true; live--; }
    }
  }
  // ── 「力が何も働かなかったら」の直線（慣性のまま進んだ場合の位置）──
  //   曲がった線との隔たりが、そのまま重力や電磁気力の効いた量になる。斜方投射なら
  //   同じ時刻での縦のずれが ½gt² そのもので、教科書の図と同じ読み方ができる。
  //   ★長さも点も「本物の予測と同じ時刻」でそろえる。時間をそろえないと同時刻の比較に
  //     ならず、ただの方向線になってしまう（接触で打ち切られた線はそこまでで止める）。
  for (const L of lines) {
    const T = (L.out.pts.length - 1) * dt;
    L.out.straight = { x: L.x0 + L.vx0 * T, y: L.y0 + L.vy0 * T };
    L.out.straightMarks = L.out.marks.map((_, k) => {
      const t = (k + 1) * markEvery * dt;
      return { x: L.x0 + L.vx0 * t, y: L.y0 + L.vy0 * t };
    });
  }
  return lines.map(L => L.out);
}
