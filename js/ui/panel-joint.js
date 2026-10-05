// 表示名のみ。型名（spring/rope/rod/hinge/axle/fixjoint）はシーンの保存形式なので変えない
const JOINT_TYPE_LABELS = { spring:'ばね', rope:'ロープ', rod:'連結棒', hinge:'ヒンジ', axle:'モーター', fixjoint:'溶接' };
function jointAxisEffMass(j) {
  const wa = j.getWorldAnchorA(), wb = j.getWorldAnchorB();
  const dx = wb.x - wa.x, dy = wb.y - wa.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const nx = dx/d, ny = dy/d;
  const A = j.bodyA, B = j.bodyB;
  const imA = A && !A.isStatic ? A.invMass : 0, imB = B && !B.isStatic ? B.invMass : 0;
  const iiA = A && !A.isStatic ? A.invInertia : 0, iiB = B && !B.isStatic ? B.invInertia : 0;
  const rAx = A ? wa.x - A.x : 0, rAy = A ? wa.y - A.y : 0;
  const rBx = B ? wb.x - B.x : 0, rBy = B ? wb.y - B.y : 0;
  const cA = rAx*ny - rAy*nx, cB = rBx*ny - rBy*nx;
  const kEff = imA + imB + cA*cA*iiA + cB*cB*iiB;   // [1/kg]
  return kEff > 1e-12 ? 1/kEff : null;
}
// 臨界減衰 c_crit = 2√(mk) [N·s/m]
function jointCriticalDamping(j) {
  const m = jointAxisEffMass(j);
  if (!m || !(j.stiffness > 0)) return null;
  return 2 * Math.sqrt(m * j.stiffness);
}
function dampingFromRatio(j, zeta) {
  const cc = jointCriticalDamping(j);
  return cc == null ? null : zeta * cc;
}
function ratioFromDamping(j) {
  const cc = jointCriticalDamping(j);
  return cc == null ? null : j.damping / cc;
}
// ζ と臨界減衰を表示する。c [N·s/m] は物理量として保存し、ζ は「今この構成での」導出値。
function updateDampHint(j) {
  const el = document.getElementById('j-damp-hint');
  if (!el) return;
  if (!j || j.type !== 'spring') { el.style.display = 'none'; return; }
  el.style.display = '';
  const m  = jointAxisEffMass(j);
  const cc = jointCriticalDamping(j);
  if (cc == null) { el.textContent = '両端が固定されているため減衰比を定義できません'; return; }
  const z = j.damping / cc;
  const tag = z < 0.99 ? '振動しながら減衰' : z > 1.01 ? '過減衰（振動せず、ゆっくり戻る）' : '臨界減衰（最短で静止）';
  el.innerHTML =
    `実効質量 m = ${m.toFixed(3)} kg ／ 臨界減衰 c<sub>crit</sub> = 2√(mk) = <b>${cc.toFixed(1)}</b> N·s/m<br>` +
    `ζ = <b style="color:var(--accent)">${z.toFixed(2)}</b> → ${tag}`;
}
// 選択中のばねの ζ 表示を毎フレーム追従させる（質量やばね定数を変えると ζ も変わるため）
function refreshSpringDampUI() {
  if (selectedJointId == null) return;
  const j = joints.find(x => x.id === selectedJointId);
  if (!j || j.type !== 'spring') return;
  updateDampHint(j);
  if (_sliderDragging) return;                                   // 操作中はつまみを動かさない
  const ae = document.activeElement;
  if (ae && ae.tagName === 'INPUT') return;                      // 入力中も触らない
  const z = ratioFromDamping(j);
  if (z == null) return;
  const zEl = document.getElementById('j-zeta');
  const s = z.toFixed(2);
  if (zEl.value !== s) { zEl.value = s; syncSliders(); }
}
// ζ を動かす＝ c を 2ζ√(mk) に書き換える（保存されるのは c）
function updateJointZeta(v, skipUndo) {
  const j = joints.find(x => x.id === selectedJointId);
  if (!j || j.type !== 'spring') return;
  if (!skipUndo) pushUndo();
  const z = Math.max(0, parseFloat(v) || 0);
  const c = dampingFromRatio(j, z);
  if (c == null) return;                        // 両端固定
  j.damping = c;
  document.getElementById('j-damping').value = c.toFixed(1);
  if (j.bodyA) { j.bodyA.sleeping = false; j.bodyA.sleepTimer = 0; }
  if (j.bodyB) { j.bodyB.sleeping = false; j.bodyB.sleepTimer = 0; }
  updateDampHint(j);
  // ★まとめて選んでいるばねにも同じ ζ を与える。c は保存量だが ζ = c/2√(mk) は
  //   ばねごとに実効質量 m が違うので、c をコピーすると ζ が揃わない。ζ を揃えるのが
  //   ここでの意図なので、各ばねで c を計算し直す。
  applyToBulk('joint', j, o => {
    const co = dampingFromRatio(o, z);
    if (co == null) return;                  // 両端固定のばねは ζ を定義できないので触らない
    o.damping = co;
    _wake(o.bodyA); _wake(o.bodyB);
  });
}
function updateJointPanel(j) {
  _hideAllPropForms();
  document.getElementById('joint-form').style.display = '';
  document.getElementById('j-type').textContent = JOINT_TYPE_LABELS[j.type] || j.type;
  const show = (id, on) => document.getElementById(id).style.display = on ? '' : 'none';
  show('j-row-stiff',   j.type === 'spring');
  show('j-row-damp',    j.type === 'spring');
  show('j-row-zeta',    j.type === 'spring');   // ★減衰比
  show('j-row-rest',    j.type === 'spring' || j.type === 'rod');
  show('j-row-max',     j.type === 'rope');
  show('j-row-radius',  j.type === 'rope'); 
  show('j-row-lden',    j.type === 'rope'); 
  show('j-row-friction',j.type === 'rope'); 
  show('j-row-mspeed',  j.type === 'axle');
  show('j-row-mtorque', j.type === 'axle');
  show('j-row-mch',     j.type === 'axle');
  show('j-row-mbrake',  j.type === 'axle');
  document.getElementById('j-mbrake').checked = !!j.motorBrake;   // ★放したら止めるか
  const _pin = j.type === 'hinge' || j.type === 'axle';            // ★可動域（joint.js の angleLimit の★）
  show('j-row-alimit', _pin);
  show('j-row-alo', _pin && j.angleLimit);
  show('j-row-ahi', _pin && j.angleLimit);
  document.getElementById('j-alimit').checked = !!j.angleLimit;
  document.getElementById('j-alo').value = jointLimitDispDeg(j).lo;
  document.getElementById('j-ahi').value = jointLimitDispDeg(j).hi;
  updateAngleHint(j);
  document.getElementById('j-mch').value = j.motorCh || 0;   // ★0＝回路駆動なし
  show('j-row-release', j.type === 'fixjoint');                   // ★解放フラグは溶接限定
  // ★留め先（selection.js の setPinModeOf）。重なりが1つならどちらでも同じなので押せなくする
  show('j-row-pinmode', PIN_TYPES.includes(j.type));
  if (PIN_TYPES.includes(j.type)) {
    const m = pinModeOf(j);
    for (const k of ['pair', 'board']) {
      const r = document.getElementById('j-pinmode-' + k);
      r.checked = m === k; r.disabled = m === 'single';
    }
    document.getElementById('j-pinmode-hint').textContent = m === 'single'
      ? 'この点に重なっている物体は1つだけなので、どちらでも背景に留まります'
      : m === 'board' ? '同じ点の画鋲：' + pinsAtSamePoint(j).length + ' 本（右クリックの「この場所の要素」で選べます）' : '';
  }
  // ★先端おもり。ロープで、かつ背景に固定した端（＝動かせない端）があるときだけ出す。
  //   おもりが付いている端では、同じボタンが「外す」に変わる（ばねの refreshSlinkyTipRow と同じ流儀）
  let anyTip = false;
  for (const w of ['A', 'B']) {
    const btn = document.getElementById('j-tip-' + w.toLowerCase());
    const tip = ropeEndTip(j, w);
    const on = !!tip || ropeEndIsFree(j, w);
    btn.style.display = on ? '' : 'none';
    if (on) {
      btn.textContent = tip ? `端${w}の先端おもりを外す` : `端${w}に先端おもりを付ける`;
      btn.onclick = tip ? () => removeRopeTipFromPanel(w) : () => addRopeTipFromPanel(w);
      anyTip = true;
    }
  }
  show('j-row-tip', anyTip);
  show('j-row-layers',  j.type === 'rope' || j.type === 'rod');   // ★当たり判定を持つのはこの2つだけ
  document.getElementById('j-radius').value = (j.radius * PX2M).toFixed(3);    // ★ [m]
  document.getElementById('j-linden').value = j.linDensity;                    // ★ [kg/m]
  document.getElementById('j-friction').value = j.friction;                    // ★
  document.getElementById('j-stiffness').value = j.stiffness;                  // [N/m]
  document.getElementById('j-damping').value   = j.damping;                    // [N·s/m]
  document.getElementById('j-restlen').value   = (j.restLength * PX2M).toFixed(3);  // [m]
  document.getElementById('j-maxlen').value    = (j.maxLength  * PX2M).toFixed(3);  // [m]
  document.getElementById('j-mspeed').value    = j.motorSpeed;                 // [rad/s]
  document.getElementById('j-mtorque').value   = j.motorTorque;                // [N·m]
  document.getElementById('j-releasable').checked = !!j.releasable;  // ★解放フラグ
  for (let i = 1; i <= LAYER_COUNT; i++)                             // ★衝突レイヤー
    document.getElementById('j-layer'+i).checked = !!(j.layers & (1 << (i-1)));
  const _z = (j.type === 'spring') ? ratioFromDamping(j) : null;      // ★減衰比
  document.getElementById('j-zeta').value = (_z == null) ? '' : _z.toFixed(2);
  updateDampHint(j);
  syncSliders();   // ★スライダー位置を数値ボックスへ再同期
}
// ── 可動域 ───────────────────────────────────────────────
//   ★内部は y 下向き＝時計回りが正の rad、パネルは画面の向き（反時計回りが正）の度。
//     符号が反転するので、画面の下限は内部の上限から、画面の上限は内部の下限から作る
//     （物体の角度の表示 _dispDeg と同じ向き）。
//   ★ただし相対角 relAngle() は「B の角 − A の角」。ツールで物体1つを背景に留めると
//     物体が A・背景が B になり（mouse.js のヒンジ・軸）、符号がもう一度反転する。
//     以前はこれを見ておらず、背景に留めた棒で「0〜90°」と入れると下向きの 90° が
//     許されていた（2026-09-29 実測：ω=+2 で反時計回りに回る棒が 0° のまま動かなかった）。
//     画面の向きへの係数は jointDispSign で1か所にまとめる。
function jointDispSign(j) { return (j.bodyA && !j.bodyB) ? 1 : -1; }
function jointLimitDispDeg(j) {
  const k = 180 / Math.PI;
  return jointDispSign(j) > 0
    ? { lo: Math.round(j.angleLo * k), hi: Math.round(j.angleHi * k) }
    : { lo: Math.round(-j.angleHi * k), hi: Math.round(-j.angleLo * k) };
}
// 今の相対角を画面の向きで出す（可動域を決めるときの目安。毎フレーム追従）
function updateAngleHint(j) {
  const el = document.getElementById('j-angle-hint');
  if (!el) return;
  if (!j || (j.type !== 'hinge' && j.type !== 'axle')) { el.style.display = 'none'; return; }
  el.style.display = '';
  const d = jointDispSign(j) * j.relAngle() * 180 / Math.PI;
  el.textContent = `今の角度 ${d.toFixed(0)}°（取り付けたときの姿勢が 0°・反時計回りが正）`;
}
function refreshJointAngleUI() {
  if (selectedJointId == null) return;
  const j = joints.find(x => x.id === selectedJointId);
  if (j) updateAngleHint(j);
}
function updateJointAngleLimit(on) {
  const j = joints.find(x => x.id === selectedJointId);
  if (!j || (j.type !== 'hinge' && j.type !== 'axle')) return;
  pushUndo();
  j.angleLimit = !!on;
  applyToBulk('joint', j, o => { if (o.type === 'hinge' || o.type === 'axle') o.angleLimit = j.angleLimit; });
  _wake(j.bodyA); _wake(j.bodyB);
  updateJointPanel(j);                           // 下限・上限の欄を出し入れする
}
// which: 'lo' | 'hi'（画面の向きで）。下限が上限を越えたら、もう片方を押して揃える
function updateJointLimitDeg(which, v, skipUndo) {
  const j = joints.find(x => x.id === selectedJointId);
  if (!j || (j.type !== 'hinge' && j.type !== 'axle')) return;
  if (!skipUndo) pushUndo();
  const deg = Math.max(-180, Math.min(180, parseFloat(v) || 0));
  const d = jointLimitDispDeg(j);
  if (which === 'lo') { d.lo = deg; if (d.hi < deg) d.hi = deg; }
  else                { d.hi = deg; if (d.lo > deg) d.lo = deg; }
  const set = o => {
    const r = Math.PI / 180;
    if (jointDispSign(o) > 0) { o.angleLo = d.lo * r; o.angleHi = d.hi * r; }
    else                      { o.angleHi = -d.lo * r; o.angleLo = -d.hi * r; }
  };
  set(j);
  applyToBulk('joint', j, o => { if (o.type === 'hinge' || o.type === 'axle') { set(o); _wake(o.bodyA); _wake(o.bodyB); } });
  _wake(j.bodyA); _wake(j.bodyB);
  document.getElementById('j-alo').value = d.lo;
  document.getElementById('j-ahi').value = d.hi;
  syncSliders();
}
function updateJointLayer(n, on) {
  const j = joints.find(x => x.id === selectedJointId);
  if (!j) return;
  pushUndo();
  const bit = 1 << (n - 1);
  j.layers = on ? (j.layers | bit) : (j.layers & ~bit);
  if (j.type === 'rope') resetRopeChain(j);   // 接触条件が変わったのでチェーンを張り直す
  applyToBulk('joint', j, o => {
    o.layers = j.layers;
    if (o.type === 'rope') resetRopeChain(o);
  });
  wakeAll();                                   // 新たに当たるようになった物体を起こす
}
// ★リモコンを放したときに軸を止めるか（joint.js の motorBrake の★）。既定は切で、
//   入れると放している間も姿勢を保つ。荷を載せた台を少しずつ動かす装置がこちら。
function updateJointMotorBrake(on) {
  const j = joints.find(x => x.id === selectedJointId);
  if (!j || j.type !== 'axle') return;
  pushUndo();
  j.motorBrake = !!on;
  applyToBulk('joint', j, o => { o.motorBrake = j.motorBrake; });
  axleMotorBrake = !!on;   // 次に置く軸の既定にも反映（回転速度・最大トルクと同じ流儀）
}
function updateJointReleasable(on) {
  const j = joints.find(x => x.id === selectedJointId);
  if (!j || j.type !== 'fixjoint') return;
  pushUndo();
  j.releasable = !!on;
  applyToBulk('joint', j, o => { o.releasable = j.releasable; });
  fixjointReleasable = !!on;   // 次に置く溶接の既定にも反映（ばね・モーターと同じ流儀）
  refreshToolHint();
}
// プロパティの「端◯に先端おもりを付ける」。右クリックの同じ項目もここを通す。
//   端を選択している（selectedElement.end）ならその端、選んでいなければ引数の端。
function addRopeTipFromPanel(end) {
  const j = joints.find(x => x.id === selectedJointId);
  if (!ropeEndIsFree(j, end)) return;
  pushUndo();
  addRopeTip(j, end);
  updateJointPanel(j);          // 付いた端のボタンを引っ込める
}
// 「この端の先端おもりを外す」。付けるのと同じく、右クリックからもここを通す。
function removeRopeTipFromPanel(end) {
  const j = joints.find(x => x.id === selectedJointId);
  if (!ropeEndTip(j, end)) return;
  pushUndo();
  removeRopeTip(j, end);
  updateJointPanel(j);          // 外した端に「付ける」ボタンが戻る
}
function deleteSelectedJoint() {
  pushUndo();   // ★
  // ★removeJointAt を通す。ロープの先端おもりも一緒に消える（起こす処理も中でやる）
  const i = joints.findIndex(x => x.id === selectedJointId);
  if (i >= 0) removeJointAt(i);
  selectedJointId = null;
  document.getElementById('st-sel').textContent = 'なし';
  updatePropsPanel(null);
}
