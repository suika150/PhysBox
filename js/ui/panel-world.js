// 1つの物体へ1つの量を書き込む。
//   ★量ごとの決まり（質量→setMass で逆質量と慣性モーメントも直す／速度Yは上向き正で
//     受ける／μs ≧ μk を保つ／温度は絶対零度で止める…）は**ここだけ**に置く。
//     右パネルも、リモコンのスライダーも、必ずここを通す。書き込み口を2つ持つと、
//     同じ量に2通りの決まりができて必ず食い違う（単位系の★と同じ理由）。
function applyBodyProp(b, prop, val) {
    if (prop === 'mass') {
      b.setMass(parseFloat(val) || 1);
      const a = b.areaM2();
      if (a > 1e-9 && world.depth > 0) b.density = b.mass / (a * world.depth);
    } else if (prop === 'density') {
      // ★質量の裏返し：密度を決めて、質量＝密度×面積×奥行き を出し直す
      b.density = Math.max(1, parseFloat(val) || 1);
      b.setMass(b.massFromDensity());
      b.sleeping = false; b.sleepTimer = 0;
    } else if (prop === 'isStatic') {
      b.setStatic(val);
      if (val) b.setConstVel(false);      // ★背景に固定したら駆動は意味を失う（排他）
    } else if (prop === 'constVel') {
      b.setConstVel(val);
      if (val) b.setStatic(false);        // ★同上。動かし続ける以上、固定ではない
    } else if (prop === 'fixedRotation') {
      b.setFixedRotation(val);
    } else if (prop === 'vx' || prop === 'vy') {
      const _v = (parseFloat(val) || 0) * M2PX;
      b[prop] = (prop === 'vy') ? yUI(_v) : _v;      // ★速度Yの表示は上向き正
      projectGuideVelocity(b, false);
      b.sleeping = false; b.sleepTimer = 0;
    } else if (prop === 'av') {
      b.av = b.fixedRotation ? 0 : (parseFloat(val) || 0);
      b.sleeping = false; b.sleepTimer = 0;
    } else if (prop === 'angle') {
      // ★向きは「回す」＝ rotateBodyAbout を通す（形の作り直しと、つないだ物の追従が要る）。
      //   °で受け、反時計回りを正とする（内部の角は符号が逆。_dispDeg の裏返し）。
      //   ★器だけは蓋の乗り換えがあるので専用の道（rotatePistonVessel）。器を回すと
      //     容器ごと回るが、蓋は「閉端からの距離を保ったまま新しい軸へ乗り換える」必要が
      //     あり、器だけ回すと蓋が古い位置から射影されて体積が跳ぶ。
      const target = -(parseFloat(val) || 0) * Math.PI / 180;
      const ves = pistonVesselOfBody(b.id);
      if (ves && ves.cylinderId === b.id) rotatePistonVessel(ves, target);
      else rotateBodyAbout(b, target - b.angle, { x: b.x, y: b.y });
    } else if (prop === 'friction') {
      b.friction = Math.max(0, parseFloat(val) || 0);
      if (b.frictionStatic < b.friction) b.frictionStatic = b.friction;   // ★μs ≧ μk
    } else if (prop === 'frictionStatic') {
      b.frictionStatic = Math.max(b.friction, parseFloat(val) || 0);
    } else if (prop === 'temp') {
      const t = parseFloat(val);
      b.temp = Number.isFinite(t) ? Math.max(0, t) : ROOM_K;   // 絶対零度より下は作れない
    } else if (prop === 'label') {
      b.label = String(val == null ? '' : val).trim();          // ★数字だけの名前も文字のまま持つ
    } else if (prop === 'heatCap' || prop === 'conduct') {
      b[prop] = Math.max(0, parseFloat(val) || 0);             // 0＝熱をやりとりしない
    } else {
      b[prop] = typeof val === 'string' ? (isNaN(val) ? val : parseFloat(val)) : val;
    }
    if (prop === 'ior' && b.opticKind && b.opticKind !== 'planeMirror') {
      b.focal = Math.max(minOpticFocal(b.opticKind, b.opticH, b.ior, b.opticIdeal), Math.abs(b.focal));
      rebuildOpticGeometry(b);
    }
}
// 右パネル：選択している物体すべてに同じ量を書き、必要な欄を画面へ返す
function updateProp(prop, val, skipUndo) {
  if (!skipUndo && selectedIds.size > 0) pushUndo();
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b) continue;
    applyBodyProp(b, prop, val);
  }
  if (prop === 'fixedRotation') {
    const first = objects.find(o => selectedIds.has(o.id));
    if (first) {
      document.getElementById('p-av').value = first.av.toFixed(2);
      setSliderDisabled('p-av', first.fixedRotation);
    }
  }
  // ★排他の相方は、こちらが外した結果を画面に返す（選択し直さなくても追従）
  if (prop === 'isStatic' || prop === 'constVel') {
    const first = objects.find(o => selectedIds.has(o.id));
    if (first) {
      document.getElementById('p-static').checked   = first.isStatic;
      document.getElementById('p-constvel').checked = first.constVel;
    }
  }
  if (prop === 'mass') {
    const first = objects.find(o => selectedIds.has(o.id));
    if (first && first.density != null) {
      const dbox = document.getElementById('p-density');
      if (document.activeElement !== dbox) dbox.value = Math.round(first.density);
      syncSliderById('p-density');
    }
  }
  if (prop === 'ior') {   // ★不透明⇔透明でフレネル行の出し入れが変わる（選択し直さなくても追従）
    const first = objects.find(o => selectedIds.has(o.id));
    if (first) {
      const autoR = (first.ior > 1 && !first.reflective && first.fresnel);
      setSliderDisabled('p-refl', autoR, P_REFL_AUTO_MSG);
      if (!autoR) document.getElementById('p-refl').title = P_REFL_TITLE;
      document.getElementById('p-fresnel-row').style.display =
        (first.ior > 1 && !first.reflective) ? '' : 'none';
      _syncDispersionRows(first);   // ★分散行も不透明⇔透明で出し入れが変わる
    }
  }
  if (prop === 'friction' || prop === 'frictionStatic') {   // ★片方を動かしたら相方の表示も追従
    const first = objects.find(o => selectedIds.has(o.id));
    if (first) {
      const fk = document.getElementById('p-friction'), fs = document.getElementById('p-friction-s');
      if (document.activeElement !== fk) fk.value = first.friction;
      if (document.activeElement !== fs) fs.value = first.frictionStatic;
      syncSliderById('p-friction'); syncSliderById('p-friction-s');
    }
  }
}
function updateLayer(n, on) {
  if (selectedIds.size > 0) pushUndo();
  const bit = 1 << (n - 1);
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b) continue;
    b.layers = on ? (b.layers | bit) : (b.layers & ~bit);
    b.sleeping = false; b.sleepTimer = 0;
  }
  // ★drawProps へは伝播させない（新規物体は既定レイヤーのまま）
  wakeAll();
}
function updateGroundLayer(n, on) {
  pushUndo();
  const bit = 1 << (n - 1);
  ground.layers = on ? (ground.layers | bit) : (ground.layers & ~bit);
  wakeAll();
  resolveGroundEmbedding();
}
function updateDensity(v, skipUndo) {
  if (!skipUndo && selectedIds.size > 0) pushUndo();
  const d = Math.max(1, parseFloat(v) || 1);
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b) continue;
    applyBodyProp(b, 'density', d);   // ★書き込みの決まりは applyBodyProp だけに置く（冒頭の★）
  }
  const first = objects.find(o => selectedIds.has(o.id));
  if (skipUndo) {
    const mbox = document.getElementById('p-mass');
    if (document.activeElement !== mbox) mbox.value = fmtMassKg(first.mass);
    syncSliderById('p-mass');
  } else updatePropsPanel(first);
}

function updateGuideEnabled(on) {
  if (selectedIds.size > 0) pushUndo();
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b) continue;
    b.guideEnabled = !!on;
    if (on) { reanchorGuide(b); projectGuideVelocity(b, false); }
    b.sleeping = false; b.sleepTimer = 0;
  }
  const first = objects.find(o => selectedIds.has(o.id));
  if (first) updatePropsPanel(first);
}
function updateGuideAngle(v, skipUndo) {
  if (!skipUndo && selectedIds.size > 0) pushUndo();
  const a = -(parseFloat(v) || 0) * Math.PI / 180;
  for (const id of selectedIds) {
    const b = objects.find(o => o.id === id);
    if (!b || !b.guideEnabled) continue;
    b.guideAngle = a;
    reanchorGuide(b);
    projectGuideVelocity(b, false);
    b.sleeping = false; b.sleepTimer = 0;
  }
}
const GUIDE_PRESETS = [0, 30, 45, 60, 90, 120, 135, 150];
function initGuidePresets() {
  const el = document.getElementById('guide-preset-grid');
  if (!el) return;
  for (const d of GUIDE_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'mat-btn';
    btn.textContent = d + '°';
    btn.onclick = () => {
      updateGuideAngle(d);
      document.getElementById('p-guideangle').value = d;
      syncSliderById('p-guideangle');
    };
    el.appendChild(btn);
  }
}
function setGridSize(v) {
  world.gridSize = Math.max(1, toPx(parseFloat(v) || 1));
  refreshGridButton();
}
// トップバーのボタンに現在の間隔を出す。表示メニュー・▾メニュー・シーン読込のどこから
// 変わってもここを通るようにしておく（設定したのに表示が古い、が起きないように）。
// ★出し先はボタンの文字ではなくツールチップ。キャンバスの目盛り（軸に沿った「何 m」）に
//   同じ値が出ているので、トップバーでも数字を持つと二重になる。ボタンには名前だけを出し、
//   間隔はツールチップへ回した（ストロボの間隔だけは他に出る場所が無いので文字のまま）。
function refreshGridButton() {
  const b = document.getElementById('btn-grid');
  if (b) b.title = 'グリッドスナップ：グリッドに合わせて配置する（ON/OFF）\n'
                 + 'いまの間隔 ' + (world.gridSize * PX2M).toFixed(1) + ' m（▾ で変更）';
}
// 矢印の倍率を右パネル「表示」の欄へ書き戻す。★倍率は上部メニュー・右クリックメニュー・
//   右パネルの3経路から変わる全体設定なので、どこから変えても残りが古い値を出さないよう、
//   world を書いたら必ずここを通す（数値欄だけでなく相方のスライダーも動かす）。
function syncVizScaleUI(id, v) {
  const el = document.getElementById(id);
  if (!el || document.activeElement === el) return;   // 入力中の欄は奪わない
  el.value = v;
  syncSliderById(id);
}
function worldVelScale(v) {
  world.velVizScale = parseFloat(v);
  syncVizScaleUI('p-vviz', world.velVizScale);
}

function updateJointProp(prop, val, skipUndo) {
  const j = joints.find(x => x.id === selectedJointId);
  if (!j) return;
  if (!skipUndo) pushUndo();   // ★スライダードラッグ中は履歴を積まない（開始時に1回だけ積む）
  const v = parseFloat(val) || 0;
  if (prop === 'restLength' || prop === 'maxLength') j[prop] = Math.max(1, toPx(v));   // m → px
  else if (prop === 'radius')     j.radius     = Math.max(0.5, toPx(v));               // ★ m → px
  else if (prop === 'linDensity') j.linDensity = Math.max(0.001, v);                   // ★ [kg/m]
  else if (prop === 'friction')   j.friction   = Math.max(0, v);                       // ★ ロープ表面の摩擦
  else j[prop] = v;  
  // ★軸のパラメータは、次に置く軸の既定値にも反映する（ばね・レーザーと同じ流儀）
  if (j.type === 'axle') {
    if (prop === 'motorSpeed')  axleMotorSpeed  = j.motorSpeed;
    else if (prop === 'motorTorque') axleMotorTorque = j.motorTorque;
  }
  // ★節点間隔・節点質量は最大長と線密度から決まるので、変えたら作り直す。
  //   ただし今の形（たるみ）は残す＝弧長で等分割し直す。数値欄からは「どちらの端を
  //   動かしたか」が決まらないので、縄は全体へ均等に配られる。
  if ((prop === 'maxLength' || prop === 'linDensity') && j.type === 'rope') {
    resampleRopeNodes(j);
  }
  if (j.bodyA) { j.bodyA.sleeping = false; j.bodyA.sleepTimer = 0; }
  if (j.bodyB) { j.bodyB.sleeping = false; j.bodyB.sleepTimer = 0; }
  if (j.type === 'spring') {                    // ★c や k を直接いじったら ζ 表示を合わせる
    const z = ratioFromDamping(j);
    if (z != null) document.getElementById('j-zeta').value = z.toFixed(2);
    updateDampHint(j);
  }
  // ★同じ型のジョイントをまとめて選んでいるなら、代表と同じ値を全員に入れる。
  //   長さ（自然長・最大長）は各ジョイントの取り付け位置で決まる量なので、
  //   同じ値を配ると縮んだり伸びたりする。それも「まとめて同じ長さにする」意図に
  //   合致するため配るが、ロープはチェーンを張り直さないと節点数が合わない。
  applyToBulk('joint', j, o => {
    o[prop] = j[prop];                    // 代表でクランプ・単位換算を済ませた実効値をそのまま配る
    if ((prop === 'maxLength' || prop === 'linDensity') && o.type === 'rope') {
      resampleRopeNodes(o);   // 代表と同じく、形は残して刻みだけ合わせ直す
    }
    _wake(o.bodyA); _wake(o.bodyB);
  });
}
function updateColor(type, val) {
  for (const id of selectedIds) {
    const b=objects.find(o=>o.id===id);
    if (!b) continue;
    if (type==='fill') { b.fillColor=val; document.getElementById('fill-swatch').style.background=val; }
    else { b.strokeColor=val; document.getElementById('stroke-swatch').style.background=val; }
  }
  // ★drawProps へは伝播させない（選択中の物体だけを変える。新規物体は既定色のまま）
}
function worldUpdate(prop, val) {
  world[prop]=typeof val==='string'?(val==='true'?true:val==='false'?false:(isNaN(val)?val:parseFloat(val))):val;
  if (prop==='bgColor') { document.getElementById('bg-swatch').style.background=val; }
}
// まわりの温度。★欄は℃、world.ambientTemp は K で持つ（units.js の流儀。UI 境界で換算する）
function updateAmbientTemp(val) {
  const c = parseFloat(val);
  if (!isFinite(c)) return;
  world.ambientTemp = Math.max(0, C2K(c));
}
// 背景（真上から見下ろした水平面）の設定。摩擦係数は物体・地面と同じく μs ≧ μk を保つ。
// ★垂直な重力 g⊥ もここを通す。全体設定タブとシミュレーションメニューの2か所から
//   書けるので、worldUpdate で直に書くと片方の欄が古い値のまま残る。
function updateBgFriction(prop, val) {
  world[prop] = Math.max(0, parseFloat(val) || 0);
  if (world.bgFrictionStatic < world.bgFriction) world.bgFrictionStatic = world.bgFriction;
  syncBgFrictionUI();
  wakeAll();   // 新しい係数を即座に反映（眠っている物体も起こす）
}
// world の値を「背景」グループの3つの入力欄へ書き戻す（相方の追従・シーン読込・初期化で使う）
function syncBgFrictionUI() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = v;   // 入力中の欄は奪わない
  };
  set('w-bgfriction-s', world.bgFrictionStatic);
  set('w-bgfriction',   world.bgFriction);
  set('w-bggravperp',   world.bgGravPerp);
  syncSliderById('w-bgfriction-s'); syncSliderById('w-bgfriction'); syncSliderById('w-bggravperp');
}
function worldForceScale(v) {
  world.forceVizScale = Math.max(FVIZ_SCALE_MIN, parseFloat(v) || FVIZ_SCALE_MIN);
  syncVizScaleUI('p-fviz', world.forceVizScale);
}
// ★力の矢印の倍率は桁で変わる。日常の題材は 1〜100 px/N で足りるが、万有引力の題材は
//   力が mN の桁なので数千が要る（太陽系デモの火星は 0.0019 N ＝ 12px にするのに 6200）。
//   線形のスライダーで 0.001〜20000 を覆うと、よく使う 1〜100 が全体の 0.5% に潰れるので、
//   スライダーだけ常用対数で持つ。数値欄は今までどおり実数をそのまま打つ。
// ★下限は 0.001。0.1 だった頃は、力の大きい題材で矢印が上限（vectors.js の maxLen = 260
//   画面px）に張り付き、つまみを端から端まで動かしても長さが 1px も変わらなかった。
//   実測・連星のデモ：星の間の引力は 129,964 N（30万kg・10万kg、間隔 4.8m、G_sim=100）で、
//   260px を割るには 0.0020 px/N が要る。つまみの下限 0.1 では 12,996px ＝ ずっと上限のまま。
//   ＝ 上限 20000 が「小さすぎる力」を救っているのと対の措置で、下限は「大きすぎる力」を救う。
//   ★代償：対数目盛りが 5.3 桁から 7.3 桁に伸びるので、よく使う 1〜100 の帯は
//     つまみの 37% から 27% に縮む。細かく合わせるときは数値欄に直接打つ。
const FVIZ_SCALE_MIN = 0.001;                  // [px/N] 倍率の下限（数値欄・つまみ共通）
const FVIZ_LOG_MIN = -3, FVIZ_LOG_MAX = 4.3;   // 10^-3 = 0.001 〜 10^4.3 ≒ 20000
function forceScaleLog()    { return Math.log10(Math.max(FVIZ_SCALE_MIN, world.forceVizScale)); }
function forceScaleSetLog(v){ worldForceScale(forceScaleRound(Math.pow(10, parseFloat(v)))); }
// ★つまみから来た値は 10^x なので端数が長い（10^0.5 = 3.1622776601683795）。
//   ラベルと同じ桁に丸めてから world に入れる。丸めないと、つまみは「3.16」と出しているのに
//   右パネルの数値欄が 3.1622776601683795 になり、同じ設定が2つの数字で見える。
//   ★1 未満は有効数字2桁では足りない（0.002 が 0.00 に潰れて下限へ落ちる）ので小数5桁まで持つ。
function forceScaleRound(s) {
  return s >= 100 ? Math.round(s) : s >= 10 ? Math.round(s * 10) / 10
       : s >= 1   ? Math.round(s * 100) / 100 : Math.round(s * 1e5) / 1e5;
}
function forceScaleLabel(v) {
  const s = forceScaleRound(Math.pow(10, parseFloat(v)));
  return s >= 100 ? s.toFixed(0) : s >= 10 ? s.toFixed(1) : s >= 1 ? s.toFixed(2) : String(s);
}
// 全体設定タブの表示を world / ground から作り直す。
//   ★シミュレーションメニューの設定ウィンドウ（js/ui/sim-popover.js）は、右パネルの欄を
//     動かすのではなく world を直接書き換える。どちらから変えても両方の表示が合うよう、
//     値を書いたあとは必ずここを通す。起動時とシーン読込の初期化も同じ経路にしてある。
//   ★入力中の欄は上書きしない（打ち込んでいる最中に値を奪わない）。
// 系の熱量の追従表示。合計 Σ(比熱×質量×温度) は熱が移っても変わらないので、
// これが動かないことが熱量保存の目視確認になる（毎フレーム全部を足すのは
// 物体+粒子ぶんの単純な和なので軽い）。世界タブを開いていないときは計算しない。
function refreshTotalHeatReadout() {
  const el = document.getElementById('w-totalheat');
  if (!el || el.offsetParent === null) return;             // 世界タブを開いていなければ計算しない
  if (document.activeElement !== el) el.value = Math.round(totalHeat() / 1000);
  const fe = document.getElementById('w-fricheat');
  if (fe && document.activeElement !== fe) fe.value = Math.round(frictionHeatTotal);
  const re = document.getElementById('w-reservoirheat');
  if (re && document.activeElement !== re) re.value = Math.round(reservoirHeatTotal);
}
function syncWorldPanel() {
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  set('w-gx', world.gravX);
  set('w-gy', yUI(world.gravY));
  chk('w-gravline', world.showGravityLine);
  chk('w-gravitation', world.gravitation);
  set('w-gravstr', world.gravStrength);
  set('w-gravsoften', +(world.gravSoften * PX2M).toFixed(4));   // 内部は px、UI は m
  set('w-airdensity', world.airDensity);
  set('w-iters', world.iterations);
  set('w-substeps', world.substeps);
  set('w-freezedist', world.freezeDistance);
  chk('w-sleeping', world.sleeping);
  chk('w-terrain', world.terrain);
  chk('w-thermal', world.thermalOn);
  set('w-thermalrate', world.thermalRate);
  set('w-ambienttemp', +K2C(world.ambientTemp).toFixed(1));
  set('w-totalheat', Math.round(totalHeat() / 1000));   // [kJ]（保存の確認用）
  set('w-fricheat', Math.round(frictionHeatTotal));
  set('w-reservoirheat', Math.round(reservoirHeatTotal));
  chk('w-thermalviz', world.thermalViz);
  set('w-thermalvizmin', world.thermalVizMin);
  set('w-thermalvizmax', world.thermalVizMax);
  set('w-atm', (world.atmPressure / 1000).toFixed(3));
  const deg = yUI(ground.angle) * 180 / Math.PI;
  set('w-ground-angle', deg);
  const av = document.getElementById('w-ground-angle-val');
  if (av) av.textContent = (Math.round(deg * 10) / 10) + '°';
  set('w-ground-y', yUI(ground.y * PX2M).toFixed(2));
  syncGroundCoefUI();          // 地面の反発係数・静止摩擦係数・動摩擦係数（プロパティ側と共通）
  const gsw = document.getElementById('ground-swatch');
  if (gsw) gsw.style.background = ground.fillColor;
  const bsw = document.getElementById('bg-swatch');
  if (bsw) bsw.style.background = world.bgColor;
  syncBgFrictionUI();          // 背景（テーブル面）の摩擦係数と g⊥
  syncWallUI();                // 壁
  syncEMWorldUI();             // 電磁気
  fillWaveFieldControls('w-'); // 波動場
  syncSliders();
  refreshWaveInfo();
}
let _ctxCandidates = [];
let _ctxWorld = null;
let _ctxInSelRect = false;   // ★右クリック位置が直前の範囲選択の枠の中か（種別で選び直す項目の出し分け）
// ★右クリックした場所そのもの。_ctxWorld は showCtxMenu の頭で使い切って null にするが、
//   「ばねのこの点に受信計を開く」は**項目を組み立てるときに位置が要る**ので、
//   捨てる直前にここへ控える。オブジェ一覧からの右クリックでは _ctxWorld が無い＝
//   ここも null になり、位置を使う項目はばねの真ん中を既定にする。
let _ctxPickWorld = null;
// ★「同じ種類／同じ設定をすべて選択」の基準。メニューを組み立てた時点で決めて控え、
//   押されたときはそれを使う（押すまでの間に選択が変わっても、見出しと中身が食い違わない）
let _ctxSameTarget = null;

// 熱のスイッチ。全体設定タブとシミュレーションメニューの両方から通す。
//   ★プロパティタブの「熱力学的性質」はこのスイッチで丸ごと出し入れするので、
//     切り替えたその場で選択中の物体のパネルも作り直す。メニューの設定ウィンドウは
//     プロパティタブを開いたまま使えるため、作り直さないと消えたはずの欄が残って見える。
//     タブは動かさない（全体設定タブを見ている最中に勝手に切り替わらないように）。
function setThermalOn(on) {
  worldUpdate('thermalOn', on);
  withoutPropsTabJump(refreshPropsForSelection);
  syncWorldPanel();
}
// 大気圧のプリセット（真空／火星／地上／水深10m）
function uiSetAtm(pa) {
  world.atmPressure = Math.max(0, pa);
  const el = document.getElementById('w-atm');
  if (el) el.value = (world.atmPressure / 1000).toFixed(3);
}
