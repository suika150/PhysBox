// ══════════════════════════════════════════════════════════════
//  力学的エネルギー（計算だけを受け持つ。描画は js/ui/energygraph.js）
//   ★エネルギーの持ち主は「物体」ではなく「系」。
//     運動エネルギーだけは物体1個に属するが、弾性・万有引力・静電気力の位置
//     エネルギーは2つ以上のものが相互作用してはじめて決まる量で、どちらか片方へ
//     配る物理的な根拠がない。そこで「選んだ物体の集合＝系」を単位にし、
//       ・相互作用に参加する“動けるもの”が全員その系にいるときだけ計上する
//     という規則を置く（energyPairCounts）。壁・地面・静的物体は動けないので
//     参加者に数えない。つまり壁につないだばね＋おもりは、おもり1個を選ぶだけで
//     ½kx² が丸ごと入る（高校物理でいちばん出てくる形がそのまま出せる）。
//     相手が系の外の“動ける”物体のときは計上しない。その分は「失われた分」に
//     紛れるので、UI 側が注記で名指しする。
//   ★静的物体そのものは系に入れない。速度0・位置不変なので運動エネルギーは常に0、
//     位置エネルギーは定数で、和に定数を足して読みにくくするだけのため。
//   ★単位：内部は長さだけ px なので、m へ直してから J を組み立てる（core/units.js）。
//     質量[kg]・時間[s]・角度[rad] は内部もSIなのでそのまま使える。
//   ★ポテンシャルは「シミュレータが実際に使っている力」の積分でなければならない。
//     万有引力とクーロン力にはソフトニング（r²+ε²）が入っているので、教科書どおりの
//     −Gm₁m₂/r や kq₁q₂/r を描くと、接近したときに力と食い違って和が保存しなくなる。
//     下ではソフトニング込みの厳密なポテンシャルを使う（r≫ε で教科書の式に一致）。
// ══════════════════════════════════════════════════════════════

// ── 運動エネルギー ────────────────────────────────────
//   並進 ½mv² と回転 ½Iω² を分けて返す。転がる物体では両方が同じ大きさで
//   現れる（一様な円板なら 2:1）ので、まとめてしまうと教材として使えない。
//   inertia は kg·px² なので PX2M² で kg·m² へ直す。
function bodyKineticTrans(b) {
  const v2 = (b.vx * b.vx + b.vy * b.vy) * PX2M * PX2M;   // [m²/s²]
  return 0.5 * b.mass * v2;
}
function bodyKineticRot(b) {
  if (!(b.inertia > 0)) return 0;                         // 回転を止めた物体は invInertia=0
  return 0.5 * (b.inertia * PX2M * PX2M) * b.av * b.av;
}
// ── 一様重力の位置エネルギー ──────────────────────────
//   world.gravX/gravY は任意方向を向けるので mgh ではなくベクトルで書く。
//     U = −m·g·(r − r_ref)
//   画面の y は下向きが正で、重力も既定で +y（下）を向く。物体が上へ動くと
//   (b.y − ry) は負になり、U は増える。
//   ★基準は「原点を通り、重力に垂直な面」ただ1つに固定する（＝見かけの水平）。
//     ・重力の向きの成分しか効かないので、基準“点”を原点に取ることは、その点を通る
//       基準“面”を決めることと同じ。重力を傾ければ面も一緒に傾く。
//     ・この面は表示メニューの「重力に垂直な線」で画面に描ける。U=0 の場所が
//       目に見えるので、「基準はどこに取ってもよい」ことを線を動かして確かめられる。
//     ・既定の地面（y=0）と一致するので、ふつうの場面では U = mgh がそのまま出る。
function bodyGravPE(b) {
  return -b.mass * (world.gravX * b.x + world.gravY * b.y) * PX2M;
}
// ── ばねの弾性エネルギー ──────────────────────────────
//   U = ½k·x²（x は自然長からの伸び[m]）。ばねは joint.js の 'spring' だけが持つ。
//   ロープ・棒は伸びない拘束（PBD／位置補正）なので、蓄えるエネルギーを持たない。
//   減衰 damping は散逸なので、ここには入らず「失われた分」に現れる。
function springPE(j) {
  const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
  const d = Math.hypot(wb.x - wa.x, wb.y - wa.y);
  const x = (d - j.restLength) * PX2M;                    // [m]
  return 0.5 * j.stiffness * x * x;
}
// ── スリンキー（ばね）のエネルギー ────────────────────
//   ★ばねジョイントと同じ扱いをする。ばねの持ち主は物体ではなく系なので、
//     両端の“動ける”側がすべて系の中にあるときだけ数える（springCounts と同じ規則）。
//   理想ばね（idealSpring）… 節点を持たないので U = ½k·x² の1項だけ。
//   実体のばね            … 質量を持つ索そのものなので、リンクの弾性・曲げに加えて
//                            節点の運動エネルギーと重力の位置エネルギーまで数える。
//                            弾性だけ数えて運動を落とすと、和が保存しなくなる。
//   端の扱い：'body' なら相手の物体、'pin'/'free' は動かない点（＝null と同じ）。
function slinkyEndBody(S, which) {
  const mode = which === 'A' ? S.endA : S.endB;
  return mode === 'body' ? (which === 'A' ? S.bodyA : S.bodyB) : null;
}
function slinkyCounts(S, ids) {
  return energyPairCounts(slinkyEndBody(S, 'A'), slinkyEndBody(S, 'B'), ids);
}
function slinkyEnergy(S) {
  if (S.idealSpring) {
    const A = S._idealEnd('A'), B = S._idealEnd('B');
    if (!A || !B || !Number.isFinite(A.x) || !Number.isFinite(B.x)) return { us: 0, kt: 0, ug: 0 };
    const x = (Math.hypot(B.x - A.x, B.y - A.y) - toPx(S.restM)) * PX2M;   // [m]
    return { us: 0.5 * S.springK() * x * x, kt: 0, ug: 0 };
  }
  let us = 0, kt = 0, ug = 0;
  const nd = S.nodes, m = S.m;
  for (let i = 0; i < nd.length; i++) {
    const p = nd[i];
    kt += 0.5 * m * (p.vx * p.vx + p.vy * p.vy) * PX2M * PX2M;
    ug += -m * (world.gravX * p.x + world.gravY * p.y) * PX2M;
    if (i + 1 < nd.length) {
      const dx = nd[i+1].x - p.x, dy = nd[i+1].y - p.y;
      const e = (Math.hypot(dx, dy) - S.restLen) * PX2M;                   // [m]
      us += 0.5 * S.k * e * e;
    }
    // 曲げ：隣り合う2本のなす“折れ”を、軸のばねと同じ形で数える（kb = β·k）
    if (i > 0 && i + 1 < nd.length && S.kb > 0) {
      const bx = nd[i+1].x - 2 * p.x + nd[i-1].x, by = nd[i+1].y - 2 * p.y + nd[i-1].y;
      const b2 = (bx * bx + by * by) * PX2M * PX2M;
      us += 0.5 * S.kb * b2;
    }
  }
  return { us, kt, ug };
}
// ── 万有引力の位置エネルギー（ソフトニング込み）────────
//   力は F = G·m₁m₂/(r²+ε²)（gravitation.js）。その積分は
//     U(r) = (G·m₁m₂/ε)·(arctan(r/ε) − π/2)
//   r→∞ で 0、r≫ε で −G·m₁m₂/r に一致し、r→0 でも発散しない。
//   G は内部単位（力が kg·px/s²）なので、px² を m² に直す PX2M² を掛けて J にする。
function gravitationPairPE(a, b) {
  const eps = Math.sqrt(gravSoften2());                   // [px]
  const r = Math.hypot(b.x - a.x, b.y - a.y);             // [px]
  return world.gravStrength * a.mass * b.mass / eps
       * (Math.atan(r / eps) - Math.PI / 2) * PX2M * PX2M;
}
// ── 静電気力の位置エネルギー（ソフトニング込み）────────
//   力は F = k·q₁q₂/(r²+ε²)（em/circuit.js の applyCoulomb、こちらは最初からSI）。
//     U(r) = (k·q₁q₂/ε)·(π/2 − arctan(r/ε))
//   同符号なら正（近づくほど大きい）、異符号なら負。r→∞ で 0。
function coulombPairPE(a, b) {
  const k = world.coulombK * world.emForceScale;
  const eps = Math.sqrt(COULOMB_SOFTEN2) * PX2M;          // [m]
  const r = Math.hypot(b.x - a.x, b.y - a.y) * PX2M;      // [m]
  return k * a.charge * b.charge / eps * (Math.PI / 2 - Math.atan(r / eps));
}

// ── 帰属の規則 ────────────────────────────────────────
//   相互作用の相手が「動けない（静的・固定点）」なら、それは系の外にあっても
//   エネルギーをやり取りしない相手なので計上してよい。動ける相手が系の外にいる
//   ときだけ計上しない。null は世界に固定されたアンカー（＝動けない）。
// ★「一定の速度で動かし続ける」物体も、力を受け取らないので系に入れない。
//   静的物体を外すのと同じ理由の一段強い版で、こちらは仕事までする：運動エネルギーは
//   一定のまま相手を押せるので、系に入れると和が理由もなく増減する（外部からの
//   仕事の源であって、系の一員ではない）。
const energyDriven = b => !!b && (b.isStatic || b.constVel);
function energyParticipantOK(b, ids) { return !b || energyDriven(b) || ids.has(b.id); }
function energyPairCounts(a, b, ids) {
  return energyParticipantOK(a, ids) && energyParticipantOK(b, ids)
      && ((a && ids.has(a.id)) || (b && ids.has(b.id)));   // 少なくとも一方は系の中
}
// ばねが系に属するか（両端の“動ける”側がすべて系の中か）
function springCounts(j, ids) { return energyPairCounts(j.bodyA, j.bodyB, ids); }

// ── 系の合計 ──────────────────────────────────────────
//   bodies は系の物体（静的でないもの）、ids はその id の Set。
//   ペアの相互作用は「系の物体 × 世界の全物体」で走査し、系の中どうしは
//   id の順で1回だけ数える（全物体×全物体を回さないので、物体が増えても軽い）。
//
//   ★parts（省略可）を渡すと、内訳を「その項の“自然な単位”」で書き込む。
//     単位は項によって違い、勝手に付け替えることはできない：
//       運動・重力    … 物体ごと（'kt#3' のように id を付ける）。物体1個で決まる量
//       弾性          … ばねごと（'us#12' はジョイント id）。ばねが持つ量
//       万有引力・静電気力 … ペアごと（'ugg#3-7'）。2つの物体の配置が持つ量で、
//                        片方に配ると和が2倍になってしまうため物体別にはできない。
//     ただし相手が静的（固定した太陽・固定した点電荷）なら、ペアの可動側は1個
//     しかないので、ペアごと＝その物体ごと になる。高校物理で出てくる形はこちら。
function systemEnergy(bodies, ids, parts) {
  const put = parts ? (k, v) => { parts[k] = (parts[k] || 0) + v; } : null;
  let kt = 0, kr = 0, ug = 0, us = 0, ugg = 0, ue = 0;
  for (const b of bodies) {
    const t = bodyKineticTrans(b), r = bodyKineticRot(b), u = bodyGravPE(b);
    kt += t; kr += r; ug += u;
    if (put) { put('kt#' + b.id, t); put('kr#' + b.id, r); put('ug#' + b.id, u); }
  }
  for (const j of joints)
    if (j.type === 'spring' && springCounts(j, ids)) {
      const v = springPE(j); us += v;
      if (put) put('us#' + j.id, v);
    }
  // ★スリンキーも同じ項に入れる（生徒から見ればどちらも「ばね」）。内訳の系列 id は
  //   ジョイントと衝突しないよう 's' を前に付ける（'us#s7'）。
  for (const S of slinkies)
    if (slinkyCounts(S, ids)) {
      const e = slinkyEnergy(S);
      us += e.us; kt += e.kt; ug += e.ug;
      if (put) {
        put('us#s' + S.id, e.us);
        if (e.kt) put('kt#s' + S.id, e.kt);
        if (e.ug) put('ug#s' + S.id, e.ug);
      }
    }
  const doG = world.gravitation, doC = world.coulombOn;
  if (doG || doC) {
    for (const a of bodies) for (const b of objects) {
      if (b === a) continue;
      if (ids.has(b.id) && b.id < a.id) continue;          // 系の中どうしの二重計上を防ぐ
      if (!energyParticipantOK(b, ids)) continue;          // 相手が系の外の可動物体
      if (!isFieldSource(a) || !isFieldSource(b)) continue; // ★生成口は場の源にならない（geometry.js）
      if (doG && a.hasGravity && b.hasGravity) {
        const v = gravitationPairPE(a, b); ugg += v;
        if (put) put('ugg#' + a.id + '-' + b.id, v);       // 系の側（動くほう）を先に書く
      }
      if (doC && a.charge && b.charge) {
        const v = coulombPairPE(a, b); ue += v;
        if (put) put('ue#' + a.id + '-' + b.id, v);
      }
    }
  }
  return { kt, kr, ug, us, ugg, ue };
}

// ── 系の質量重心 Σmr/Σm ────────────────────────────────
//   ★エネルギーと同じで、これも物体ではなく「系」が持つ量。だから計算はここに1つだけ
//     置き、カメラの追従（sim-controls.js の followPoint）も表示メニューの重心の印
//     （render/vectors.js の drawCenterOfMass）も必ずここを通す。2か所で書くと
//     「静的物体を数えるかどうか」の答えが2通りできて、必ず食い違う。
//   ★静的物体（背景に固定した物体）は数えない。動かせない＝実質無限大の質量なので、
//     入れた瞬間に重心はその物体の上へ貼り付き、系の運動を語る量ではなくなる。
//     エネルギーの側で静的物体を系に入れないのと同じ線引き。
//   ★外力の合力が 0 なら、この点は等速直線運動をする（＝止まって見えるなら運動量の
//     合計が 0）。連星でも2球の衝突でも、この一点だけを見れば運動量保存が読める。
//   返り値は { x, y, m }。数えられる物体が1つも無ければ null。
function centerOfMass(bodies) {
  let m = 0, sx = 0, sy = 0;
  for (const b of bodies) {
    if (!b || b.isStatic) continue;
    m += b.mass; sx += b.mass * b.x; sy += b.mass * b.y;
  }
  return m > 1e-9 ? { x: sx / m, y: sy / m, m } : null;
}
