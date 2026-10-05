const FORCE_VIZ = {
  gravity:  { color: '#ef5350', label: '重力 [N]' },
  electric: { color: '#ffca28', label: '電気力 [N]' },
  magnetic: { color: '#26c6da', label: '磁気力 [N]' },
  normal:   { color: '#42a5f5', label: '垂直抗力 [N]' },
  friction: { color: '#ffca28', label: '摩擦 [N]' },
  spring:   { color: '#66bb6a', label: 'ばね/張力 [N]' },
  constraint:{color: '#ec407a', label: '支点反力 [N]' },   // ヒンジ・溶接・モーターの拘束反力
  // ★偶力のモーメント（曲がった矢印）。溶接＝固定支持だけが持つ。ヒンジには出ない＝だから回る
  constraintTorque:{ color: '#f48fb1', label: '支点モーメント', arc: true },
  // ★モーターが電流から出している駆動トルク。反力（受動）と区別するため色を分ける
  driveTorque:{ color: '#ff9800', label: '駆動トルク', arc: true },
  thrust:   { color: '#ff7043', label: '推力 [N]' },
  drag:     { color: '#ab47bc', label: '空気抵抗 [N]' },
  // ★水などの粒子が物体を押す力（particles.js の二方向連成）。
  //   recordForce では記録していたのにここに無く、!cfg で黙って捨てられていた。
  fluid:    { color: '#29b6f6', label: '流体の力 [N]' },
  // ★気体室がピストンに及ぼす正味の力 (P − 大気圧)×A。
  //   内側と外側それぞれの圧力は面に並ぶ短い矢印で別に描く（render/gas.js）。
  //   どちらも5000N級で差は数十Nなので、同じスケールで2本描いても見分けられない。
  pressure: { color: '#26c6da', label: '気体の正味の力 [N]' },
  // ★分子気体が壁を叩く力（molecule.js の applyMolPressure）。fluid と同じで、
  //   recordForce では記録していたのにここに無く、!cfg で黙って捨てられていた。
  //   気体室の pressure と分けるのは、あちらが「連続体の圧力差 × 面積」なのに対し、
  //   こちらは**衝突の力積をなましたもの**だから＝このモデルで見せたい量そのもの。
  gas:      { color: '#4fc3f7', label: '気体分子の力 [N]' },
};
// ★px,py は recordForce と揃えて「物体のローカル座標」で入れる（body.js の★）。
function liveForcesFor(b) {
  const out = {};
  if (b.isStatic) return out;
  // ★キーは recordForce と同じ 'type:' 形式に統一する。
  //   一時停止中(live)→再生(recorded)で同じキーが再利用され、二重描画にならない。
  if (b.hasGravity)
    out['gravity:'] = { type: 'gravity', fx: b.mass * world.gravX, fy: b.mass * world.gravY, px: 0, py: 0, wsum: 1 };
  // ★動力は何個でも付く。キーは id で分ける（まとめると1本しか出ない）。
  //   リモコンで切ってある動力は矢印も出さない（body.js の integrate と揃える）。
  for (const th of b.thrusters) {
    const tg = th._remoteHold === undefined ? 1 : th._remoteHold;
    const F = th.force * tg;
    if (!F) continue;
    const ta = b.angle + th.dir;
    out['thrust:' + th.id] = { type: 'thrust', fx: Math.cos(ta) * F, fy: Math.sin(ta) * F,
                               px: th.localX, py: th.localY, wsum: 1 };
  }
  // 地面接地中は重力の地面法線成分を打ち消す垂直抗力を近似表示。
  //   ★キーは ground.js の recordForce と揃える（'normal:ground'+接地点番号）。
  //     止めているとき（ここ）と動かしているとき（ソルバ）で同じキーになるので、
  //     再生・一時停止をまたいでも矢印が二重に出ない。
  if (world.terrain && (b.layers & ground.layers)) {
    const nx = Math.sin(ground.angle), ny = -Math.cos(ground.angle);
    const a = b._aabb;
    const reach = (b.type === 'circle' ? b.radius
                                       : Math.hypot(a.maxX - a.minX, a.maxY - a.minY) / 2) + 2;
    if (signedDistToGround(b.x, b.y) <= reach) {
      const gn = (b.mass*world.gravX)*nx + (b.mass*world.gravY)*ny;
      if (gn < 0) {
        const W = -gn;                    // 地面が支えるべき荷重
        // 触れている面をひとつずつ拾う。凹型を伏せて置けば脚の数だけ出る。
        const sup = b.type === 'circle' ? null : groundSupportRegions(b, false);
        if (!sup || sup.length <= 1) {
          const c = sup && sup[0];
          const cx = c ? c.x : b.x - nx * (b.type === 'circle' ? b.radius : 0);
          const cy = c ? c.y : b.y - ny * (b.type === 'circle' ? b.radius : 0);
          const l = b._localPoint(cx, cy);
          out['normal:ground' + (c ? c.region : 0)] =
            { type: 'normal', fx: W*nx, fy: W*ny, px: l.x, py: l.y, wsum: 1 };
        } else {
          // 支点が複数：てこの関係（力とモーメントの釣り合い）で荷重を分ける
          const tx = Math.cos(ground.angle), ty = Math.sin(ground.angle);
          const share = shareLoadOnSupports(sup.map(c => c.t), b.x*tx + b.y*ty, W);
          if (share) {
            for (let i = 0; i < sup.length; i++) {
              if (share[i] <= 0) continue;
              const l = b._localPoint(sup[i].x, sup[i].y);
              out['normal:ground' + sup[i].region] =
                { type: 'normal', fx: share[i]*nx, fy: share[i]*ny,
                  px: l.x, py: l.y, wsum: 1 };
            }
          }
        }
      }
    }
  }
  return out;
}
// ★摩擦の矢印は、同じ接触の垂直抗力と同じ点に立てる。
//   面で触れている物体は接触点が複数（箱なら底の両隅）あり、そこへ静止摩擦をどう割り振る
//   かをソルバは一意に決められない（静定でない問題で、和だけが決まる）。そのため
//   垂直抗力の圧力中心と摩擦の作用点が別々の場所に出る。実測：2kg の箱を 5N で引くと
//     垂直抗力 左隅 0.112／右隅 0.215 → 作用点 +36.8px（引く力で前の隅へ荷重が移る＝正しい）
//     摩擦     左隅 0.053／右隅 0.030 → 作用点 −32.6px
//   幅 234px の底面で 69px 離れ、接触面が箱をねじっているように見える。
//   クーロン摩擦は法線圧力に比例した面の分布なので、合力の作用点は圧力中心と同じ＝
//   垂直抗力と同じ点。割り振りの不定性は画面に出さない。垂直抗力の側は「どこで支えて
//   いるか」に意味がある（傾く条件のデモはこの移動そのものが題材）ので動かさない。
//   ★キーが対になっているものだけ。背景摩擦（key 'bg'）には対になる垂直抗力が無く、
//     面の接触でもないので重心のまま。
//   ★返す座標は物体のローカル（recordForce と同じ流儀。body.js の★）。
function _pairedNormalPos(raw, k) {
  if (k.lastIndexOf('friction:', 0) !== 0) return null;
  const n = raw['normal:' + k.slice(9)];
  return (n && n.wsum > 0) ? { x: n.px / n.wsum, y: n.py / n.wsum } : null;
}
function smoothForces(b) {
  const s = b._forcesSmooth || (b._forcesSmooth = {});
  let raw = b._forces;
  if (!raw || Object.keys(raw).length === 0) raw = liveForcesFor(b);
  const alpha = 0.2;          // 大きさの平滑化（ソルバのちらつき対策）
  const posAlpha = 0.5;       // 取り付け点（ローカル）の平滑化。速く追従させる
  for (const k in raw) {
    const f = raw[k];
    // ★取り付け点はローカル座標で貯まっている（recordForce の★）。ここで世界座標から
    //   引き直すと、貯めた時点と今とで物体が動いたぶんだけ根元がずれる
    const np = _pairedNormalPos(raw, k);
    const lx = np ? np.x : (f.wsum > 0 ? f.px/f.wsum : 0);
    const ly = np ? np.y : (f.wsum > 0 ? f.py/f.wsum : 0);
    const t = s[k] || (s[k] = { type: f.type || k, fx: f.fx, fy: f.fy, lx, ly });
    const mNew = Math.hypot(f.fx, f.fy);
    const mOld = Math.hypot(t.fx, t.fy);
    const m = mOld + (mNew - mOld) * alpha;
    if (mNew > 1e-9) { t.fx = f.fx / mNew * m; t.fy = f.fy / mNew * m; }
    else             { t.fx = 0; t.fy = 0; }
    t.lx += (lx - t.lx) * posAlpha;
    t.ly += (ly - t.ly) * posAlpha;
    t._seen = true;
  }
  for (const k in s) {
    if (!s[k]._seen) {
      const isContact = s[k].type === 'normal' || s[k].type === 'friction';
      if (isContact && !b._contactThisTick) { delete s[k]; continue; }
      s[k].fx *= (1 - alpha); s[k].fy *= (1 - alpha);
      if (Math.hypot(s[k].fx, s[k].fy) * world.forceVizScale < 1) delete s[k];
    } else s[k]._seen = false;
  }
  return s;
}
// 偶力のモーメントも力と同じ流儀で平滑化する（ソルバのちらつき対策）
function smoothTorques(b) {
  const s = b._torquesSmooth || (b._torquesSmooth = {});
  const raw = b._torques || {};
  const alpha = 0.2, posAlpha = 0.5;
  for (const k in raw) {
    const q = raw[k];
    const lx = q.wsum > 0 ? q.px/q.wsum : 0, ly = q.wsum > 0 ? q.py/q.wsum : 0;  // ★ローカル座標
    const t = s[k] || (s[k] = { type: q.type, tz: q.tz, lx, ly });
    t.tz += (q.tz - t.tz) * alpha;
    t.lx += (lx - t.lx) * posAlpha;
    t.ly += (ly - t.ly) * posAlpha;
    t._seen = true;
  }
  for (const k in s) {
    if (!s[k]._seen) {
      s[k].tz *= (1 - alpha);
      if (torqueArcLen(s[k].tz) < 1) delete s[k];
    } else s[k]._seen = false;
  }
  return s;
}
// 弧の長さ [px]。モーメント T を「重心から 1 m の点に加えた接線力」に直し、
// 力の矢印とまったく同じ表示倍率で長さにする（＝矢印と大きさを見比べられる）。
const TORQUE_ARC_R = 30;                   // 弧の半径 [px]（画面固定）
function torqueArcLen(tz) { return Math.abs(tz) / PPM * world.forceVizScale; }
// 曲がった矢印。時計回り／反時計回りが、その拘束が止めている回転の向きを表す
function drawTorqueArc(cx, cy, tz, color) {
  let alen = torqueArcLen(tz);
  if (alen < 2) return false;
  alen = Math.min(Math.max(alen, 16), TORQUE_ARC_R * 5);      // 5 rad ≒ 286°で頭打ち
  const sweep = (tz >= 0 ? 1 : -1) * (alen / TORQUE_ARC_R);   // 内部角は画面では時計回りが正
  const a0 = -Math.PI * 0.75;                                 // 左上から描き始める
  const a1 = a0 + sweep;
  const stroke = (col, w) => {
    ctx.beginPath();
    ctx.arc(cx, cy, TORQUE_ARC_R, a0, a1, sweep < 0);
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.stroke();
  };
  stroke('rgba(0,0,0,0.6)', 5);
  stroke(color, 2);
  // 終端に矢じり（接線方向へ短い矢印を1本描いて頭だけ見せる）
  const ex = cx + Math.cos(a1) * TORQUE_ARC_R, ey = cy + Math.sin(a1) * TORQUE_ARC_R;
  const tx = -Math.sin(a1) * Math.sign(sweep), ty = Math.cos(a1) * Math.sign(sweep);
  drawArrow(ctx, ex - tx*0.1, ey - ty*0.1, ex + tx*0.1, ey + ty*0.1, 'rgba(0,0,0,0.6)', 5);
  drawArrow(ctx, ex - tx*0.1, ey - ty*0.1, ex + tx*0.1, ey + ty*0.1, color, 2);
  return true;
}
const _visibleForceTypes = new Set();   // このフレームで実際に描いた種類（凡例用）
function drawForceVectors() {
  _visibleForceTypes.clear();
  const scale = world.forceVizScale;
  const minLen = 12, maxLen = 260;
  for (const b of objects) {
    if (!b.showForces) { b._forcesSmooth = null; b._torquesSmooth = null; continue; }
    const forces = smoothForces(b);
    const cos = Math.cos(b.angle), sin = Math.sin(b.angle);   // local → world
    for (const key in forces) {
      const f = forces[key];
      const cfg = FORCE_VIZ[f.type];
      if (!cfg) continue;
      const mag = Math.hypot(f.fx, f.fy);
      let alen = mag * scale;                 // ★len → alen（矢印長）
      // ★2px 未満は描かない。ここは「最短 12px まで伸ばす」の前なので、
      //   これを外すと、ほぼ 0 の力まで 12px の矢印になって大きさを誤読させる
      //   （実測：分裂デモで別れたあとに残るばねの 0.012 N が、3px/N の倍率で
      //     12px＝4 N ぶんの矢印に見えた）。
      //   ★力そのものが小さい題材（万有引力）で矢印が出ないときは、ここではなく
      //     倍率のほうを上げること。倍率は 20000 px/N まで上げられる。
      if (alen < 2) continue;
      alen = Math.min(Math.max(alen, minLen), maxLen);
      const wx = b.x + f.lx*cos - f.ly*sin;
      const wy = b.y + f.lx*sin + f.ly*cos;
      const origin = worldToScreen(wx, wy);
      const d = worldToScreenDir(f.fx/mag, f.fy/mag);   // ★向きはカメラの回転を通す
      const ex = origin.x + d.x * alen;   // ★
      const ey = origin.y + d.y * alen;   // ★
      drawArrow(ctx, origin.x, origin.y, ex, ey, 'rgba(0,0,0,0.6)', 5);
      drawArrow(ctx, origin.x, origin.y, ex, ey, cfg.color, 2);
      _visibleForceTypes.add(f.type);
    }
    const torques = smoothTorques(b);
    for (const key in torques) {
      const t = torques[key];
      const cfg = FORCE_VIZ[t.type];
      if (!cfg) continue;
      const wx = b.x + t.lx*cos - t.ly*sin;
      const wy = b.y + t.lx*sin + t.ly*cos;
      const o = worldToScreen(wx, wy);
      if (drawTorqueArc(o.x, o.y, t.tz, cfg.color)) _visibleForceTypes.add(t.type);
    }
  }
}
// 速度ベクトル表示：矢印の長さ＝速さ（大きさ）、向き＝運動の向き。色は速度ツールと同じ緑。
function drawVelocityVectors() {
  const minLen = 14, maxLen = 300;
  for (const b of objects) {
    if (!b.showVelocity || b.isStatic) continue;
    const speedPx = Math.hypot(b.vx, b.vy);       // [px/s]
    const speedMs = speedPx * PX2M;               // [m/s]
    if (speedMs < 0.02) continue;
    let alen = speedMs * world.velVizScale;   // ★len → alen
    alen = Math.min(Math.max(alen, minLen), maxLen);
    const o = worldToScreen(b.x, b.y);
    const d = worldToScreenDir(b.vx / speedPx, b.vy / speedPx);   // ★同上
    const ex = o.x + d.x * alen; // ★
    const ey = o.y + d.y * alen; // ★
    drawArrow(ctx, o.x, o.y, ex, ey, 'rgba(0,0,0,0.6)', 5);
    drawArrow(ctx, o.x, o.y, ex, ey, '#66bb6a', 2);
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#66bb6a';
    ctx.fillText('v=' + speedMs.toFixed(2) + ' m/s', ex + 6, ey - 6);
    ctx.restore();
  }
}
// 電気力線・等電位線について、絵と物理が食い違って見えかねないことを画面へ出す。
//   ★どちらも「出さないと壊れているように見える」ための注記。加熱・冷却や流れの場が
//     効かない相手を注記で断っているのと同じ流儀。
function drawFieldNotes() {
  if (!world.showFieldLines && !world.showEquipotential) return;
  const lines = [];
  // ① 源を絞っている：外した電荷からも力は働いているので、表示だけの選択だと明示する
  const off = fieldSourceExcludedCount();
  if (off)
    lines.push(`電気力線・等電位線：源は ${fieldSourceBodies().length} 個の電荷のみ`
             + `（${off} 個を源から除外中／力は全電荷で計算）`);
  // ② 等電位線は「電場の領域」を含まない（箱の中だけ一様な場は電位が大域的に決まらない）。
  //    領域と重なっている間は、力線と等電位線が直交しなくなるので、その理由を出す。
  if (world.showEquipotential && chargedBodies().length && emFields.some(f => f.kind === 'E'))
    lines.push('等電位線に「電場の領域」は入っていません（箱の中だけの一様な場は電位が決まらないため）。'
             + '領域の中では電気力線と直交しません');
  if (!lines.length) return;
  ctx.save();
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#ffd54f';
  ctx.textAlign = 'left';
  // ★力の凡例が出ているときはその右へ逃がす（凡例は左下に不透明な箱を描くので、
  //   同じ場所に書くと隠れる。凡例の幅 120 ＋ 余白）
  const x0 = (world.showForceLegend && _visibleForceTypes.size) ? 140 : 12;
  let y = canvas.height - 12;
  for (let i = lines.length - 1; i >= 0; i--) { ctx.fillText(lines[i], x0, y); y -= 15; }
  ctx.restore();
}
// ★「運動の向き」を編集している最中で、かつ速さが0の物体に、向きだけを示す矢印を描く。
//   速度ベクトルは長さ0で何も描けないが、向きを決めてから速さを与えたい場面が
//   あるため。実際の速度ではないことが分かるよう、破線＋固定長で描く。
function drawVelDirGhost() {
  if (selectedIds.size !== 1 || !velDirEditing()) return;
  const b = objects.find(o => selectedIds.has(o.id));
  if (!b) return;
  if (Math.hypot(b.vx, b.vy) * PX2M >= 0.02) return;      // 動いていれば速度ベクトル側に任せる
  const a = _velDirDeg * Math.PI / 180;
  const o = worldToScreen(b.x, b.y);
  const L = 60;                                            // [画面px] 固定長（速さとは無関係）
  const d = worldToScreenDir(Math.cos(a), yUI(Math.sin(a)));   // ★向きはカメラの回転を通す
  const ex = o.x + d.x * L, ey = o.y + d.y * L;
  ctx.save();
  ctx.setLineDash([5, 4]);
  drawArrow(ctx, o.x, o.y, ex, ey, 'rgba(102,187,106,0.85)', 2);
  ctx.setLineDash([]);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#66bb6a';
  ctx.fillText('向き ' + _velDirDeg.toFixed(0) + '°（速さ0）', ex + 6, ey - 6);
  ctx.restore();
}
function drawForceLegend() {
  if (!world.showForceLegend) return;
  if (_visibleForceTypes.size === 0) return;     // ← objects.some(...) 判定から変更
  const items = [];
  for (const t in FORCE_VIZ) {
    if (_visibleForceTypes.has(t)) items.push(FORCE_VIZ[t]);   // ← forceVizTypes 参照を削除
  }
  if (!items.length) return;
  ctx.save();
  ctx.font = '11px sans-serif';
  const pad = 8, lh = 16, w = 120, h = pad * 2 + items.length * lh;
  const x = 10, y = canvas.height - h - 10;
  ctx.fillStyle = 'rgba(26,28,35,0.82)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.strokeRect(x, y, w, h);
  items.forEach((it, i) => {
    const ly = y + pad + i * lh + 6;
    ctx.strokeStyle = it.color; ctx.lineWidth = 2;
    ctx.beginPath();
    if (it.arc) ctx.arc(x + 17, ly, 6, -Math.PI * 0.75, Math.PI * 0.6);   // 曲がった矢印は弧で示す
    else { ctx.moveTo(x + 8, ly); ctx.lineTo(x + 26, ly); }
    ctx.stroke();
    ctx.fillStyle = '#e0e6f0';
    ctx.fillText(it.label, x + 32, ly + 3);
  });
  ctx.restore();
}
// ── 系の重心の印（表示メニューの「選択系の重心を表示」）─────────────
//   ★印は「上半分が黒・下半分に支点の三角」の丸。黒い上半分（物体の重さ）を三角の頂点
//     （＝丸の中心＝重心）1点で支えて釣り合っている絵で、「その点で支えると釣り合う点」という
//     高校物理での重心の教え方をそのまま描いている。★4分割の丸（機械・航空の図面の重心記号）
//     から替えた：あれは日本の高校の教科書には出てこず（教科書は黒い点に「G」）、意味を
//     知っている人にしか読めなかった。6案を実寸で並べて比べ、これが半径 7px のままでも
//     三角が読めることを確かめて決めた（他の案：点の下に支点の三角／やじろべえ／黒点＋G／
//     吊り下げ法の2本の鉛直線）。
//   ★それでも記号だけで読ませず、必ず「重心」の札を添える（初見では札で読ませる）。
//   ★色は白と黒だけ。FORCE_VIZ のどの色とも重ならず、明るい背景でも暗い背景でも読める。
//   ★大きさは画面px で固定する。ワールドpx にすると拡大したときに印だけが太り、
//     「点」を指すという役目が崩れる（軌跡の記録点マーカーと同じ考え。render/body.js）。
//   ★印は画面の縦横に合わせる（cam.angle では回さない）。三角は常に画面の上を指す。
//     カメラを回すと「支える向き」と重力の向きが食い違うが、回すと印そのものが傾いて
//     「何かの向きを表している」と読めてしまうので、印は回さないほうを取った。
//     重力のない題材（連星）でも同じ姿で出す：そこでは「支えて釣り合う」は比喩になるが、
//     質量中心という一点を指す役目は変わらない。
//   ★重心そのものの計算はここに書かない（physics/energy.js の centerOfMass）。
//     カメラの追従と同じ一点を指していることが、この印の意味そのものだから。
//   ★半径は 7画面px。上と下から挟んで決めた（連星②のデモで実測）。この題材がいちばん
//     厳しい：印は星Aの首振りの円（半径 30 ワールドpx ＝ 倍率 0.50 で画面 15px）の
//     内側に入り、しかも 15px 隣にある軌跡の記録点マーカー（半径 5px の ⊕）と
//     見分けが付かないといけない。
//       9px … 塗り分けはよく読めるが、首振りの円の直径の半分を印が占める
//       7px … 塗り分けと支点の三角がまだ読め、⊕ とも大きさで区別できる  ← これ
//       6px … ⊕ と同じ大きさになり、隣り合った2つがどちらも「小さい丸」に見える
//     ★連星のデモが以前ペンで置いていた丸（半径 13 ワールドpx ＝ 画面 6.5px）は
//       「首振りの円と入れ子に見える」として連星②では外されていた。こちらが同じ
//       大きさでも成り立つのは**塗りつぶしてあるから**で、輪郭だけの丸と違って
//       軌道の円には見えない（実測で確認済み）。輪郭だけに戻すならこの寸法は使えない。
//   ★三角は頂点を丸の中心に、底辺を中心から 5.2px 下に置く（底辺の半幅 3.6px は、その高さの
//     弦の半分 4.9px より内側＝縁の輪にかからない）。頂点が黒い上半分に接して「支えている」と読める。
//   ★札は右上。
const COM_MARK_R = 7;   // [画面px] 印の半径。速度ベクトルの最短 14px より小さくしてある
function drawCenterOfMass() {
  if (!comIds.length) return;
  const bodies = [];
  for (const id of comIds) { const b = objects.find(o => o.id === id); if (b) bodies.push(b); }
  const c = centerOfMass(bodies);
  if (!c) return;                       // 系が消えた・全部が静的（重心を語れない）
  const o = worldToScreen(c.x, c.y), r = COM_MARK_R;
  ctx.save();
  ctx.translate(o.x, o.y);
  // 本体：白の丸に、上半分を黒で塗り、下半分に支点の三角（頂点＝中心）を置く
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = '#000000'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(3.6, 5.2); ctx.lineTo(-3.6, 5.2); ctx.closePath();
  ctx.fill();
  // 縁：白の輪の外に黒の細い輪（白い下半分は明るい物体に、黒い上半分は暗い背景に溶けないように）
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r + 1, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1; ctx.stroke();
  // 札「重心」（上の★：記号は共通認識ではないので文字を必ず添える）
  ctx.font = '11px sans-serif';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';   // ★物体の上に重なっても読めるよう縁取る
  ctx.strokeText('重心', r + 4, -r + 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('重心', r + 4, -r + 2);
  ctx.restore();
}
function drawOpticFocalMarkers() {
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b || !opticHasFocal(b.opticKind) || !b.focal) continue;
    const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
    const p1 = worldToScreen(b.x - b.focal*cos, b.y - b.focal*sin);
    const p2 = worldToScreen(b.x + b.focal*cos, b.y + b.focal*sin);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,213,79,0.35)'; ctx.lineWidth = 1;   // 光軸
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 1.5;               // 焦点×印（両側）
    for (const sp of [p1, p2]) {
      ctx.beginPath();
      ctx.moveTo(sp.x-5, sp.y-5); ctx.lineTo(sp.x+5, sp.y+5);
      ctx.moveTo(sp.x-5, sp.y+5); ctx.lineTo(sp.x+5, sp.y-5);
      ctx.stroke();
    }
    ctx.restore();
  }
}
function render(now) {
  try {
    const dt = now - (lastTime||now);
    lastTime = now;
    fpsArr.push(1000/Math.max(dt,1));
    if (fpsArr.length > 30) fpsArr.shift();
    const fps = Math.round(fpsArr.reduce((a,b)=>a+b,0)/fpsArr.length);
    document.getElementById('info-fps').textContent = `FPS: ${fps}`;
    updateFrozenBodies();
    let ticked = 0;
    // ★範囲選択の枠を引いているあいだは時計を止める。動いたままだと「囲んだつもりのもの」と
    //   「離した瞬間に枠の中に居たもの」が食い違う（枠の判定は離した時の中心位置で1回きり。
    //   実測：走らせたままオームの法則モデルの導線をひと囲みすると、枠を広げた時点で中に
    //   居た電子2個のうち、選ばれたのは1個だった）。選ぶのは編集の操作なので、枠を引いて
    //   いる1秒ぶん止めても題材は失われない。
    //   ★running そのものは触らない。simPause/simPlay は savedState を取り直すので、
    //     呼ぶと▶の戻り先（リセットの行き先）が枠を引いた時点へずれてしまう。
    const simDtFrame = (running && !selRect) ? Math.min(dt / 1000, 0.25) * speedMult : 0;
    updateHeldVelocities(simDtFrame);   // ★掴んで動かしている物体の速度を実際の移動量から作る
    // ★生成口の設定変更を、すでに出ている物体へ渡す（プログラムの〈…にも反映〉がONのとき）。
    //   simTick の列より前で、一時停止中も通す＝速度を0にした瞬間に矢印が消える。
    syncSpawnerProps();
    if (running) {
      simAccum += simDtFrame;
      // ★running も見る。プログラムの「実行を止める」は tick の終わりに効くので、
      //   ここで抜けないと、止めたあとも残りの tick（1フレーム最大8）を回りきってしまう。
      //   接触した瞬間で止める使い方では、それだけで衝撃の tick を通り過ぎる
      //   （＝ _forces が上書きされ、読ませたかった矢印が消える）。
      while (simAccum >= SIM_DT && ticked < SIM_MAX_TICKS && running) { simTick(); simAccum -= SIM_DT; ticked++; }
      if (ticked >= SIM_MAX_TICKS) simAccum = 0;   // 追いつけない分は捨てる（時間を巻き戻さない）
    }
    // ★このフレームで1ステップも進まなかったときは、導体棒の接点を描画用に取り直す。
    //   進まないと emStepPost が走らず world._rods が古い位置のまま残るので、やり直し・
    //   手でのドラッグ・一時停止で物体だけが動き、棒の黄色い線が置き去りになる。
    if (!ticked) emRefreshRodsForDraw();
    // ★索（ばね）も、停止中は自分では端に追随できない。停止中に端の物体を運ぶ経路は
    //   「つかむ・編集ツールの物体ドラッグ・端のドラッグ・矢印キー・元に戻す…」と多いので、
    //   経路ごとではなくここで一度だけ投影する（アフィンなので刻んでも一度でも同じ形に
    //   着く。slinky.js の settleSlinkies の★）。
    // ★条件は !ticked ではなく !running。再生中は索の持ち主はソルバなので、tick の来ない
    //   フレーム（120Hz 表示では半分がそう）に横から投影すると、接触で押されたぶんを
    //   静的な形へ引き戻してしまう＝表示のリフレッシュレートで物理が変わる。
    if (!running) settleSlinkies();
    followUpdate(dt);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = world.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (world.showGrid || gridSnapActiveNow()) drawGrid();
    if (world.showAxes) drawAxes();
    if (world.showGravityLine) drawGravityLine();   // ★重力に垂直な線（見かけの水平）
    // ★水を塊で描くときは物体・地面より奥に敷く。塊の縁は壁に少し潜るので、そこを
    //   壁が隠す（手前に描くと、ぼかしで縮んだ角と壁の間に隙間が見えた）。点のときは下の drawParticles
    if (world.waterSmooth) drawWaterSmooth();
    drawInfiniteGround();
    drawWalls();        // ★壁（ワールド境界）
    drawGuideRails();
    drawEMFields();     // ★電場・磁場の領域（半透明の面なので物体より下に敷く）
    drawHeatFields();   // ★加熱・冷却の領域（同じく面なので物体より下）
    drawFlowFields();   // ★流れの場（風・水流。同じく面なので物体より下）
    drawEquipotential();// ★等電位線（電気力線より下。どちらも物体の下）
    drawFieldLines();   // ★電気力線
    syncAttachedAnnotations(); // ★物体に貼った注釈を物体の姿勢へ（annotate.js。描く前に1回）
    drawAnnotations(false);   // ★注釈（背面）。既定はここ＝物体より下に敷く
    drawStrobeGhosts();       // ★ストロボの残像（実物が隠れないよう物体より下に敷く）
    for (const b of objects) {
      const isSelected = selectedIds.has(b.id);
      drawBody(b, isSelected);
    }
    for (const j of joints) drawJoint(j);
    drawCircuit();      // ★回路（導線・素子・導体棒）
    pruneElemSelection();      // ★消えた／物体に付いた要素のIDを範囲選択から落とす
    pruneJointEndSelection();  // ★消えたジョイントの端も同じく落とす
    pruneSlinkyEndSelection(); // ★消えたスリンキーの端も同じく落とす
    drawWaveField();
    drawWaveSourceMarkers();   // ★場の有無に関係なく波源の位置を描く（起動直後も見えるように）
    drawSlinkies();
    drawWaveGraphMarks();   // ★受信計がばねの上に置いた観測点の印（媒質の上に重ねる）
    drawParticles();
    drawGasChambers();   // ★気体室（領域・圧力の矢印・P/V/T の読み取り）
    drawLasers();
    drawArCoats();            // ★反射防止コート（面の上に重ねる。ビームより手前でないと埋もれる）
    drawAnnotations(true);    // ★注釈（前面）。物体に隠れて読めないときだけこちらへ回す
    drawAnnotationOverlay();  // ★注釈の選択枠・回転ハンドル（注釈ツール中のみ）
    drawAnnotDrawing();       // ★描いている最中の線／消しゴムの当たる範囲
    drawSelectedElement();
    drawTransformGizmo();
    drawSelectedElemMarks();    // ★範囲選択で拾ったレーザー・波源の印（枠はギズモ側に一本化）
    drawEMFieldResizeHandles();   // ★選択中の電場・磁場の領域のサイズ変更ハンドル
    drawOpticFocalMarkers();
    drawForceVectors();
    drawVelocityVectors();
    // ★電荷の ⊕⊖ 記号。**矢印より手前**に描く。記号は物体の重心に 14px で置くが、
    //   力・速度の矢印はどれも重心から生えるので、物体と一緒に描いていた頃は
    //   矢印の根もとが記号をまるごと覆っていた（実測：帯電した小球のつりあいで、
    //   電気力と重力と張力の3本が重心で交わり、⊕ が1画も見えなかった）。
    //   符号は「その物体が何なのか」＝ラベルにあたるもので、矢印はその上に乗る飾り。
    //   隠していい側は矢印の根もと 14px のほうなので、順序をこちらに寄せる。
    drawCharges();
    drawFieldNotes();         // ★源を絞っているとき・等電位線が領域を含まないときの注記
    drawVelDirGhost();   // ★速さ0で「運動の向き」を操作中のときだけ出る向き矢印
    drawCenterOfMass();  // ★選んだ系の重心の印（矢印より手前。点を指すものなので隠れない）
    // ★グリッドの目盛り。線は背景（drawGrid）だが、数字は地面の塗りや物体の下に
    //   潜ると読めなくなるので、ものさしとしてここで手前に描く
    if ((world.showGrid || gridSnapActiveNow()) && world.showGridLabels) drawGridLabels();
    drawCameraMarker();       // ★カメラを付けた物体の印（どの物体に乗っているかを図の中で示す）
    drawCameraBadge();        // ★どの系で見ているかの札。回転系では出しっぱなしにする（camera.js の★）
    drawForceLegend();
    drawProgramLinks();       // ★プログラムの窓と、つないだ物体を結ぶ線（画面座標で引く）
    drawRemoteLinks();        // ★リモコンの窓と、つないだ動力・モーターを結ぶ線
    drawCounters();           // ★通過カウンタの線・矢印と窓の数（見る側の道具）
    drawSpdMeters();          // ★速さの分布計の枠と窓の棒グラフ（見る側の道具）
    drawCircTables();         // ★回路の表（素子の横の札。画面座標で描く）
    refreshProgramCounts();   // ★窓の「いま○個」だけを書き直す（残りは触ったときだけ）
    drawPreview();
    drawSnapMarker();
    drawGearCoatHover();      // ★歯車コート：カーソルの下の面（js/app/gear-tools.js）
    drawBulkSelectionMarks();   // ★種別一括選択に入っているもの（代表以外）にも選択の印を付ける
    drawParticleSelection();    // ★選んだ粒子の輪（粒子は数が多いので専用に描く）
    drawSelRect();
    if (hoveredId && !selectedIds.has(hoveredId)) {
      const b = objects.find(o=>o.id===hoveredId);
      if (b) {
        const sc = worldToScreen(b.x, b.y);
        ctx.save();
        ctx.translate(sc.x, sc.y);
        ctx.rotate(b.angle + cam.angle);   // ★カメラの回転ぶんを足す
        ctx.scale(cam.zoom, cam.zoom);
        if (b.type==='circle') { ctx.beginPath(); ctx.arc(0,0,b.radius+2/cam.zoom,0,Math.PI*2); }
        else if (b.type==='box') { ctx.beginPath(); ctx.rect(-b.w/2-2/cam.zoom,-b.h/2-2/cam.zoom,b.w+4/cam.zoom,b.h+4/cam.zoom); }
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    }
    document.getElementById('st-objs').textContent = objects.length;
    document.getElementById('st-step').textContent = stepCount;
    document.getElementById('st-zoom').textContent = Math.round(cam.zoom*100)+'%';
    const fzEl = document.getElementById('st-frozen-item');
    if (fzEl) {
      fzEl.style.display = frozenCount > 0 ? '' : 'none';
      if (frozenCount > 0) document.getElementById('st-frozen').textContent = frozenCount;
    }
    updateLiveVelocityReadout();
    updateLiveGasReadout();      // ★気体の P・V・T と帳簿も動くので追従させる
    refreshTotalHeatReadout();   // ★系の熱量（保存されていることを目で確かめられるように）
    refreshCircuitReadout();   // ★選択中の回路素子の電流・電圧を追従表示
    refreshSpringDampUI();
    refreshJointAngleUI();
    refreshSceneList();   // ★シーンタブを開いていれば内容の変化を追う
    simPopTick(now);      // ★シミュレーションメニューの設定ウィンドウを全体設定タブと同じ値に保つ
    armAllToolPopups();   // ★開いているツール設定ウィンドウを貫通モードに保つ
    drawThermalLegend();   // ★温度の色目盛り（画面座標なので最後に描く）
    drawVelGraph();
    drawWaveGraphs();      // ★波の受信計（y-t と振動数）
    drawTempGraph();
    drawPvGraph();
    drawCircuitGraph();
    drawEnergyGraph();
    drawMomGraph();
    gifTick(now);
    
  } catch (e) {
    console.error('render error:', e);
  } finally {
    rafId = requestAnimationFrame(render);
  }
}
// ════════════════════════════════════════
//  INPUT HANDLING
// ════════════════════════════════════════
let mouseWorld = {x:0,y:0};
let mouseScreen = {x:0,y:0};
let isMouseDown = false;
let lastMouseScreen = {x:0,y:0};
let polyDrawing = false;
