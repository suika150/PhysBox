// ════════════════════════════════════════
//  粒子（液体・気体）のパネルと操作
// ════════════════════════════════════════
//  ★ほかの種別は「代表1つを出して、変更を仲間へ配る」形だが、粒子だけは群れとして
//    扱う。1粒子は水なら 0.63kg の塊で、個体を見分ける意味がないため。
//    そこで選択ぜんぶの個数と平均温度を出し、打ち替えたら全部に入れる。
//  選択の実体は bulk-select.js の bulkIds（種別 'particle'）。selectedParticles() で取る。

function updateParticlePanel() {
  const list = selectedParticles();
  if (!list.length) { updatePropsPanel(null); return; }
  _hideAllPropForms();
  document.getElementById('particle-form').style.display = '';
  const gas = list.filter(p => p.type === 'gas').length;
  const kind = gas === 0 ? '液体' : gas === list.length ? '気体' : `液体${list.length-gas}＋気体${gas}`;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('pcl-kind',  kind);
  set('pcl-count', list.length);
  document.getElementById('pcl-title').textContent = `粒子 ${list.length}個を選択中`;
  showParticleSwatch(list[0].color);   // 代表1つの色を見本に出す（打ち替えは全部へ配る）
  // 熱の欄は、世界の熱スイッチがONのときだけ意味がある
  const on = !!world.thermalOn;
  for (const id of ['pcl-temp-row']) {
    const r = document.getElementById(id); if (r) r.style.display = on ? '' : 'none';
  }
  const hc = document.getElementById('pcl-heatcap');
  if (hc) hc.closest('.prop-row').style.display = on ? '' : 'none';
  if (on) {
    refreshParticleThermal();                    // 型ごとの熱容量は奥行きに依存するので引き直す
    let sumT = 0, sumC = 0;
    for (const p of list) { sumT += p.T; sumC += p.heatC; }
    set('pcl-temp',    K2C(sumT / list.length).toFixed(1));
    set('pcl-heatcap', Math.round(sumC));
  }
  // ── 分子だけの欄（気体を1つでも選んでいるときに出す）────────────────
  //   ★液体には出さない。SPH の1粒子は分子ではなく 0.63kg の水の塊なので、
  //     「分子の速さ」も「物質量」も意味を持たない（particles.js の注と同じ話）。
  const s = gas > 0 ? molGasStats() : null;
  for (const id of ['pcl-vrms-row', 'pcl-mol-row']) {
    const r = document.getElementById(id); if (r) r.style.display = s ? '' : 'none';
  }
  if (s) {
    set('pcl-vrms', Math.round(s.vrms));
    set('pcl-mol',  s.mol.toPrecision(3));
  }
  document.getElementById('pcl-tracer').checked = list.every(p => p.tracerEnabled);
  // ── グラフ（右クリックの ctxParticleGraphItem と同じ門番）──────────────
  //   ★温度は熱がONのときだけ。選択ではなく世界じゅうの粒子が対象（title で断ってある）。
  //   ★速さの分布はここに出さない。範囲に置く計器（左ツールバーの「速さ分布」＝spdmeter.js）に移した。
  const tb = document.getElementById('pcl-tempgraph-btn');
  tb.style.display = on ? '' : 'none';
  tb.disabled = !tempGraphReady();
  tb.classList.toggle('active', !!tempGraphOfSelection());
  document.getElementById('pcl-graph-title').style.display = on ? '' : 'none';
  syncSliders();
}
// 選んだ粒子ぜんぶの軌跡を付ける／外す（軌跡ツールで1つずつクリックするのと同じ）
function updateParticleTracer(on) {
  const list = selectedParticles();
  if (!list.length) return;
  pushUndo();
  for (const p of list) if (!!p.tracerEnabled !== !!on) setParticleTracer(p, on, tracerColor, tracerDuration);
}
// 選んだ粒子ぜんぶを同じ温度にする。
//   ★系の熱量はこれで変わる。物体の温度欄を打ち替えたときと同じ扱い（手で与えた熱）で、
//     熱量保存の台帳（散逸＋熱源）とは別勘定になる。パネルの注記でそう断ってある。
//   ★気体（分子）だけは選択によらず全分子へ配る。分子運動論の温度は集団の速度分布その
//     ものであって、分子の一部には配れない：MolecularGas.update は毎tick 全分子の p.T の
//     平均 Tset を取り、全員を同じ係数 √(Tset/Tk) でスケールする（molecule.js:118-131）。
//     部分選択に書くと平均で薄まり、半分だけ選んで 300℃ と打っても (300+20)/2 の
//     約160℃に落ち着く＝打った値が実現しない。液体（SPH）は1粒子ごとに温度を持つので従来どおり。
//   live=true … スライダーのドラッグ中。undo はドラッグ開始時に1回だけ積む（物体の温度と同じ）
function updateParticleTemp(val, live) {
  const list = selectedParticles();
  if (!list.length) return;
  const t = C2K(parseFloat(val));
  if (!Number.isFinite(t)) return;
  if (!live) pushUndo();
  const T = Math.max(0, t);                      // 絶対零度より下は作れない（物体と同じ）
  for (const p of list) if (!p.prm.kinetic) p.T = T;
  if (list.some(p => p.prm.kinetic))
    for (const p of particles) if (p.prm.kinetic) p.T = T;
  // ★ドラッグ中は引き直さない。数値欄はスライダー自身が書いており、ここで平均を読み戻すと
  //   つまみと数値が引っ張り合う。離した後の値は次に選び直したときに揃う。
  if (!live) updateParticlePanel();
}
// 粒子の印の色を決める。★選んでいる粒子があればそれ全部に配り、無ければ
//   「次に置く粒子の色」を変える（注釈の applyAnnotColor と同じ約束）。
//   色は物理に効かない（particles.js の particleColor の注）。
function applyParticleColor(v) {
  const list = selectedParticles();
  if (list.length) {
    pushUndo();
    for (const p of list) p.color = v;
  } else {
    particleColor = v;
  }
  showParticleSwatch(v);
}
// 選んだ粒子（無ければ次に置く粒子）の印を消して、型の色へ戻す。
function resetParticleColor() {
  const list = selectedParticles();
  if (list.length) {
    pushUndo();
    for (const p of list) p.color = p.prm.color;
    showParticleSwatch(list[0].prm.color);
    return;
  }
  particleColor = null;
  showParticleSwatch((currentTool === 'gas' ? PARTICLE_TYPES.gas : PARTICLE_TYPES.fluid).color);
}
// 色の見本はツール窓と右パネルの2か所にある（地面の色と同じ扱い）
function showParticleSwatch(c) {
  for (const id of ['pt-swatch', 'pcl-swatch']) {
    const sw = document.getElementById(id);
    if (sw) sw.style.background = c;
  }
}
// 選んだ粒子を削除。
//   ★1個だけでも消せる（deleteBulkSelection は2個以上が条件だが、粒子はクリックで
//     1個だけ選ぶこともできるので、ここは自前で持つ）。
function deleteSelectedParticles() {
  const list = selectedParticles();
  if (!list.length) return false;
  pushUndo();
  const doomed = new Set(list.map(p => p.id));
  for (let i = particles.length - 1; i >= 0; i--)
    if (doomed.has(particles[i].id)) particles.splice(i, 1);
  clearAllSelections();
  lastSelRect = null;
  const st = document.getElementById('st-sel');
  if (st) st.textContent = 'なし';
  updatePropsPanel(null);
  return true;
}
// ── まとめて平行移動 ──────────────────────────────────────────
//   ★位置ベース法なので、p.x だけ動かしてはいけない。速度は毎tick
//       v = (x − px) / dt
//     で作り直されるので、前ステップ位置 px を置き去りにすると、掴んで動かした距離が
//     そのまま巨大な速度に化けて水が弾け飛ぶ（実測：40px 動かすと 2400px/s）。
//     px も同じだけ動かせば、相対位置＝速度は保たれる。
let particleDrag = null;    // { offs:[{p,dx,dy}], origX, origY, armed, moved }
function beginParticleDrag(wp) {
  const list = selectedParticles();
  if (!list.length) return false;
  particleDrag = {
    offs: list.map(p => ({ p, dx: p.x - wp.x, dy: p.y - wp.y })),
    origX: wp.x, origY: wp.y, armed: true, moved: false,
  };
  return true;
}
function dragParticlesTo(wp) {
  const d = particleDrag;
  if (!d) return;
  if (!d.moved) {                                  // 選ぶだけのクリックでは動かさない
    const dz = ELEMENT_DRAG_DEADZONE_PX / cam.zoom;
    if ((wp.x - d.origX) ** 2 + (wp.y - d.origY) ** 2 < dz * dz) return;
    if (d.armed) { pushUndo(); d.armed = false; }  // 実際に動いた時だけ履歴を積む
    d.moved = true;
  }
  for (const o of d.offs) {
    const nx = wp.x + o.dx, ny = wp.y + o.dy;
    o.p.px += nx - o.p.x;            // ★前ステップ位置も一緒に動かす（上の注を参照）
    o.p.py += ny - o.p.y;
    o.p.x = nx; o.p.y = ny;
  }
}
function endParticleDrag() { particleDrag = null; }
// クリックした点が、いま選んでいる粒子の上か（＝掴んでまとめて動かす合図）
function hitSelectedParticle(wp) {
  if (bulkKind !== 'particle' || !bulkIds.size) return false;
  const p = particleAt(wp.x, wp.y, PICK_TOL_PX / cam.zoom);
  return !!p && bulkIds.has(p.id);
}
// クリックした点にいる粒子（近傍探索の格子は使わず、選択は毎フレームではないので素直に走査）
function particleAt(wx, wy, pad) {
  const m = pad || 0;
  let best = null, bd = Infinity;
  for (const p of particles) {
    const r = p.radius + m;
    const d2 = (p.x - wx) ** 2 + (p.y - wy) ** 2;
    if (d2 <= r * r && d2 < bd) { bd = d2; best = p; }
  }
  return best;
}
// 選択中の粒子に印を描く（粒子そのものは render/scene.js が描くので、ここは輪だけ）
function drawParticleSelection() {
  if (bulkKind !== 'particle' || !bulkIds.size) return;
  ctx.save();
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 1.5;
  for (const p of particles) {
    if (!bulkIds.has(p.id)) continue;
    const s = worldToScreen(p.x, p.y);
    const r = Math.max(3, p.radius * cam.zoom + 2);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
