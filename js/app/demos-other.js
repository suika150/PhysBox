// ════════════════════════════════════════
//  デモ：その他（物理の単元に入らないもの。単元は「道具のしくみ」と「遊び」）
// ════════════════════════════════════════
//  ★教科書の単元立てには乗らないが、同じ部品で組める遊び。組み方の約束は
//    ほかの分野と同じ（手で作れる部品だけ・リモコンで触る）。

// ── よろよろ走り（4つのキーで走る）──────────────────────────
//   ★ブラウザゲーム QWOP の見立て（名前は借りない。2026-09 に「QWOP」から改名）。Q/W で両ももと両腕を、O/P で両ひざを互い違いに動かす。
//     部品は四角形の和・モーター（axle）・ヒンジ・リモコンだけで、どれも手で置ける。
//   ★1つのキー＝モーター2台に〈効かせる〉と〈逆向きに効かせる〉のリモコンを1台ずつ。
//     Q/W は股と肩の2組を動かすので4台ずつ、O/P は2台ずつ ＝ 12台（リモコンの上限ちょうど）。
//   ★ひざ・股には可動域を付ける（joint.js の angleLimit）。無いとひざが前へ折れ、
//     股が一回転して「走る体」にならない。
//   ★衝突レイヤー。体の部品どうしは当ててはいけない（股・ひざで常に重なっている／
//     走ると左右の脚が交差する）。レイヤーは4つしかないので、頭と胴・すねと足を
//     図形和で1つにして 5部品にし、4本の脚にレイヤーを1つずつ割り当てる。
//     胴は左すねとレイヤーを共有する（かかとが尻に届くほどひざを曲げないと当たらない。
//     ひざの可動域はその手前で止めてある）。地面は全レイヤーにいる。
//   ★放したら止める（motorBrake）。力を抜くと自由に回る軸では、立っているだけで
//     ひざが折れて崩れる。止める軸でもトルクの上限を超える荷には負ける。
const QW_THIGH_H = 46, QW_THIGH_W = 14;   // [px] もも
const QW_CALF_H  = 46, QW_CALF_W  = 12;   // [px] すね
const QW_FOOT_W  = 30, QW_FOOT_H  = 8;    // [px] 足（前へ突き出す）
const QW_TORSO_H = 70, QW_TORSO_W = 28;   // [px] 胴
const QW_HEAD_R  = 13;                    // [px] 頭
const QW_M_TORSO = 35, QW_M_THIGH = 7, QW_M_CALF = 5;   // [kg]（胴は頭込み、すねは足込み）
// ★モーターの速さ。遊べるかどうかをここで決めた。実測（キーを押さなければ 10 秒立ったまま
//   ＝胴の沈み 1px。4相までの決まった押し方を乱数で 200 通り作って 20 秒ずつ回し、頭が地面に
//   着いたら終わり）：
//     股 5・ひざ 7 rad/s … 20秒もったもの 14通り、倒れるまでの中央値 1.2秒、最遠 2.3 m
//     股 3・ひざ 4 rad/s … 20秒もったもの 17通り、倒れるまでの中央値 1.3秒、最遠 3.1 m（倒れずに）
//   目をつぶって同じ押し方を繰り返すだけでも 3 m 進める＝見ながら押せば走れる。すぐ倒れるのは
//   本家 QWOP と同じで、それが遊びの本体なので易しくはしない。
//   トルクを 120/80 N·m に落とすと倒れにくくなるが、足が上がらず前へ出ない（最遠 2.2 m で転倒）。
const QW_HIP_W   = 3,  QW_KNEE_W  = 4;    // [rad/s] モーターの速さ
const QW_HIP_T   = 250, QW_KNEE_T = 150;  // [N·m] トルクの上限
// 可動域（内部の向き＝時計回りが正。取り付けた直立の姿勢が 0）
//   股：ももを前へ（ひざが前＝負）110°、後ろへ 40°。
//   ひざ：前へは曲がらない（0）、後ろへ（足が後ろ＝正）130°。
const QW_HIP_LO  = -110 * Math.PI / 180, QW_HIP_HI  = 40 * Math.PI / 180;
const QW_KNEE_LO = 0,                    QW_KNEE_HI = 130 * Math.PI / 180;
// 腕。★当たり判定なし（衝突レイヤーを全部切る＝地面も素通り）。質量はあるので、
//   振れた腕が胴を揺さぶる。ひじはヒンジで、前へだけ曲がる（前腕の先が前＝負）。
//   ★肩はモーター（本家どおり）。Q/W で脚と逆向きに振る＝右ももが前なら右腕は後ろ。
//     放したら自由に振れる（motorBrake 切）。腕は止めて支える荷が無いので、止めると
//     ただの棒になってつまらない。
//   ★以下は肩がまだヒンジ（力なし）だったときの実測。200 通りの押し方で、腕を外したものを対照に：
//     20秒もったもの 17 → 27通り、倒れるまでの平均 2.9 → 4.0秒、胴の回る速さの平均 −21%。
//     腕の重さが胴の回りにくさ（慣性モーメント）を足し、振れた腕が逆向きに胴を押し返すため。
//     進む距離はほぼ同じ（1m 以上進んだもの 5 → 4通り）。倒れにくくなるが速くはならない。
//   ★肩をモーターにした今の実測（同じ 200 通り。対照は肩をヒンジに戻したもの）：
//     20秒もったもの 27 → 28通り、倒れるまでの平均 4.04 → 4.12秒（ほぼ同じ）。
//     1m 以上進んだもの 4 → 19通り、最遠 1.97 → 2.83 m。脚と逆に振る腕が、股を振ったときに
//     胴がひねり返される分を打ち消すので、脚の振りがそのまま前へ進む力になる。
//   ★当たらないので、倒れると腕は地面にめり込んで見える（飾りと割り切った）。
const QW_UARM_H = 40, QW_UARM_W = 10, QW_FARM_H = 38, QW_FARM_W = 9;   // [px]
const QW_M_UARM = 3, QW_M_FARM = 2;                                     // [kg]
const QW_ELBOW_LO = -140 * Math.PI / 180, QW_ELBOW_HI = 0;
const QW_SH_W = 4, QW_SH_T = 40;                                        // [rad/s]・[N·m] 肩
const QW_SH_LO = -160 * Math.PI / 180, QW_SH_HI = 70 * Math.PI / 180;   // 前へ 160°・後ろへ 70°

function demoQwop() {
  resetDemoWorld();
  updateGroundTerrain(true);
  // ★走るには足が地面をつかまないといけない（摩擦なしの約束の外。遊びのデモなので入れる）
  ground.friction = 1; ground.frictionStatic = 1.2;
  const gy = ground.y;
  const hipY = gy - QW_FOOT_H - QW_CALF_H - QW_THIGH_H;
  const col = { skin:'#ffcc80', shirt:'#ef5350', legL:'#5c6bc0', legR:'#3949ab', edge:'#263238' };
  const part = (o) => new Body(Object.assign({ restitution:0, friction:1, frictionStatic:1.2,
    strokeColor:col.edge, strokeWidth:1.5 }, o));

  // 胴＋頭（1つの物体）
  const torso = demoUnion(
    part({ type:'box', x:0, y:hipY - QW_TORSO_H/2, w:QW_TORSO_W, h:QW_TORSO_H, mass:1,
           layers:0b0100, fillColor:col.shirt }),
    part({ type:'circle', x:0, y:hipY - QW_TORSO_H - QW_HEAD_R + 4, radius:QW_HEAD_R, mass:1,
           layers:0b0100, fillColor:col.shirt }));
  torso.setMass(QW_M_TORSO);

  // 片脚（もも1本＋すね＆足1つ）。layers はももとすねで別々
  const leg = (thighLayer, calfLayer, color) => {
    const thigh = part({ type:'box', x:0, y:hipY + QW_THIGH_H/2, w:QW_THIGH_W, h:QW_THIGH_H,
                         mass:QW_M_THIGH, layers:thighLayer, fillColor:color });
    objects.push(thigh);
    const kneeY = hipY + QW_THIGH_H;
    const calf = demoUnion(
      part({ type:'box', x:0, y:kneeY + QW_CALF_H/2, w:QW_CALF_W, h:QW_CALF_H, mass:1,
             layers:calfLayer, fillColor:color }),
      part({ type:'box', x:(QW_FOOT_W - QW_CALF_W)/2, y:gy - QW_FOOT_H/2, w:QW_FOOT_W, h:QW_FOOT_H,
             mass:1, layers:calfLayer, fillColor:color }));
    calf.setMass(QW_M_CALF);
    // ★アンカーは各物体のローカル座標。図形和の重心は足のぶん前下へずれているので、
    //   世界の点から取り直す（getLocalAnchor）。
    const hipJ = new Joint({ type:'axle', bodyA:torso, bodyB:thigh,
      anchorAx:0, anchorAy:0, anchorBx:0, anchorBy:0,
      motorSpeed:-QW_HIP_W, motorTorque:QW_HIP_T, motorBrake:true,
      angleLimit:true, angleLo:QW_HIP_LO, angleHi:QW_HIP_HI });
    setJointEnd(hipJ, 'A', torso, 0, hipY, false);
    setJointEnd(hipJ, 'B', thigh, 0, hipY, false);
    const kneeJ = new Joint({ type:'axle', bodyA:thigh, bodyB:calf,
      anchorAx:0, anchorAy:0, anchorBx:0, anchorBy:0,
      motorSpeed:QW_KNEE_W, motorTorque:QW_KNEE_T, motorBrake:true,
      angleLimit:true, angleLo:QW_KNEE_LO, angleHi:QW_KNEE_HI });
    setJointEnd(kneeJ, 'A', thigh, 0, kneeY, false);
    setJointEnd(kneeJ, 'B', calf,  0, kneeY, false);
    joints.push(hipJ, kneeJ);
    return { thigh, calf, hipJ, kneeJ };
  };
  // ★奥の脚（左）を先に置く＝手前の脚（右）が上に描かれる
  const L = leg(0b0001, 0b0100, col.legL);
  const R = leg(0b0010, 0b1000, col.legR);
  // 腕。肩は胴の上端から少し下
  const shY = hipY - QW_TORSO_H + 8;
  const arm = (color) => {
    const up = part({ type:'box', x:0, y:shY + QW_UARM_H/2, w:QW_UARM_W, h:QW_UARM_H,
                      mass:QW_M_UARM, layers:0, fillColor:color });
    const elY = shY + QW_UARM_H;
    const fore = part({ type:'box', x:0, y:elY + QW_FARM_H/2, w:QW_FARM_W, h:QW_FARM_H,
                        mass:QW_M_FARM, layers:0, fillColor:col.skin });
    objects.push(up, fore);
    const sh = new Joint({ type:'axle', bodyA:torso, bodyB:up,
      motorSpeed:-QW_SH_W, motorTorque:QW_SH_T, motorBrake:false,
      angleLimit:true, angleLo:QW_SH_LO, angleHi:QW_SH_HI });
    setJointEnd(sh, 'A', torso, 0, shY, false); setJointEnd(sh, 'B', up, 0, shY, false);
    const el = new Joint({ type:'hinge', bodyA:up, bodyB:fore,
      angleLimit:true, angleLo:QW_ELBOW_LO, angleHi:QW_ELBOW_HI });
    setJointEnd(el, 'A', up, 0, elY, false); setJointEnd(el, 'B', fore, 0, elY, false);
    joints.push(sh, el);
    return sh;
  };
  // ★描く順：奥の腕 → 胴 → 手前の腕（objects の並びが描く順）
  const shL = arm('#c62828');
  objects.splice(objects.indexOf(torso), 1); objects.push(torso);
  const shR = arm(col.shirt);

  // ── リモコン12台 ───────────────────────────────
  //   ★キーは Q/W/O/P。文字キーのツール切替は外したので（keyboard.js の★）、4つとも
  //     リモコンの窓から手で割り当てられる。
  const rm = (joint, mode, key, fx, fy) => {
    const r = addRemote('motor', joint);
    if (!r) return;
    r.kind = 'motor'; r.mode = mode; r.key = key; r.fx = fx; r.fy = fy;
    placeRemotePanel(r); syncRemotePanel(r);
  };
  //   ★窓は地面より下に 6列×2段（上が右、下が左）。窓は1枚 170×205px と大きく、
  //     体の横には収まらない。代わりにカメラを下へずらして（sceneCamera.offY）体と地面を
  //     画面の上半分へ上げ、空いた下半分を窓に使う。6列は 1280px 幅の画面で
  //     ほぼ隙間なく並ぶ幅（列の間隔 0.157 ＝ 約165px。窓どうしが 5px ほど重なる）。
  const cx = [0, 1, 2, 3, 4, 5].map(i => 0.053 + i * 0.157), ry = [0.435, 0.715];
  // Q：右ももを前・左ももを後ろ、腕はその逆（右腕を後ろ・左腕を前） ／ W：すべてその逆
  rm(R.hipJ,  'on',  'KeyQ', cx[0], ry[0]); rm(L.hipJ,  'rev', 'KeyQ', cx[0], ry[1]);
  rm(shR,     'rev', 'KeyQ', cx[1], ry[0]); rm(shL,     'on',  'KeyQ', cx[1], ry[1]);
  rm(R.hipJ,  'rev', 'KeyW', cx[2], ry[0]); rm(L.hipJ,  'on',  'KeyW', cx[2], ry[1]);
  rm(shR,     'on',  'KeyW', cx[3], ry[0]); rm(shL,     'rev', 'KeyW', cx[3], ry[1]);
  // O：右ひざを曲げ・左ひざを伸ばす ／ P：その逆
  rm(R.kneeJ, 'on',  'KeyO', cx[4], ry[0]); rm(L.kneeJ, 'rev', 'KeyO', cx[4], ry[1]);
  rm(R.kneeJ, 'rev', 'KeyP', cx[5], ry[0]); rm(L.kneeJ, 'on',  'KeyP', cx[5], ry[1]);

  setDemoCam(0, 1.2);
  attachCamera(torso, 'world');   // ★走った先まで画面がついていく（説明は画面に貼る）
  sceneCamera.offY = 183;         // [px] 胴を画面の中央より 220 画面px 上に（上の★）
  demoTitlePinned('よろよろ走り');
  demoNotePinned(
    '▶実行 して、4つのキーで走る。\n'
  + '・Q／W … 両ももを互い違いに振る（腕は脚と逆向きに振れる）\n'
  + '・O／P … 両ひざを互い違いに曲げる\n'
  + '・キーを放した関節はその姿勢で止まる（力負けすると折れる）');
}

// ── ブロック崩し ─────────────────────────────────────────
//   ★部品は四角形・円・多角形・リモコン2台・プログラム2つだけで、どれも手で置ける。
//     ブロックを消すのはブロックの側ではなく**球の側の1つのプログラム**
//     （何かが当たったら → 当たってきた相手を削除）。ブロックごとに貼ると上限の
//     12個にかかるので、ここで「同じレイヤー設定の物体だけ」の絞りを使う。
//   ★衝突レイヤーの組み方（これが絞りの中身）：
//       球・ブロック … {1}         ＝ 設定がまったく同じ → 当たると消える
//       壁・パドル   … {1, 2}      ＝ 球とは共有する（跳ね返る）が同じではない → 消えない
//     「1つ共有していれば」で絞ると、当たった相手とは必ず共有しているので何も絞れない。
//   ★重力0・摩擦0・反発1。反発は積で合成される（geometry.js）ので、両側を1にしないと
//     跳ねるたびに遅くなる。摩擦が0なので球は回らず、当たった面で鏡のように跳ねる。
//   ★パドルの上面は山形の多角形。平らだと入った角度のまま返るだけで狙えない。
//     端で受けるほど外へ倒れた面に当たる＝打ち分けは面の向きという幾何だけで決まる。
//   ★パドルは固定した物体を〈手で動かす〉。押している間は逆質量0の等速物体になるので
//     球に押し負けない。固定した壁では止まる（パドルと壁は同じレイヤー {1,2}。
//     collision.js の blockHandAgainstFixed の★。2026-09-27 より前は壁を通り抜けていた）。
//   ★球の速さは止まったパドル・壁・ブロックでは変わらない。動かしながら斜めの面で打つと
//     変わる（面が球へ向かえば速く、逃げれば遅く）。これは動く斜面の物理そのものなので、
//     速さの上限・下限で押さえ込まない（押さえ込むと原因のない結果になる）。
//     実測（自動で追いかけて打つ・60秒）：壁だけの箱／ブロックあり／プログラムあり／
//     パドルあり のどれも 3.500 m/s のまま。パドルに当たった16回のうち、止まっていた
//     10回は ±0.000、4 m/s で動いていた6回は ±0.88〜1.15 m/s（向きは面の動きどおり）。
const BO_W = 560, BO_H = 700;             // [px] 内のり
const BO_WALL = 24;                       // [px] 壁の厚み
const BO_COLS = 7, BO_ROWS = 5;
const BO_BW = 72, BO_BH = 24, BO_GAP = 6; // [px] ブロック
const BO_BALL_R = 9;                      // [px]
const BO_BALL_V = 3.5;                    // [m/s] 球の速さ
const BO_PAD_W = 110, BO_PAD_H = 16, BO_PAD_RISE = 10;   // [px] パドル（上面の山の高さ）
const BO_PAD_V = 4;                       // [m/s] パドルを動かす速さ
function demoBreakout() {
  resetDemoWorld();
  updateGroundTerrain(false);
  setDemoGravity(0);
  setDemoCam(0, 0.74);
  // ★題材は本文の右（画面 x>540）。中心を画面 765px・上下は操作ヒントの帯の下へ。
  const cx = cam.x + (760 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const cy = cam.y + (30 * demoFitScale()) / cam.zoom;
  const L = cx - BO_W/2, R = cx + BO_W/2, T = cy - BO_H/2, B = cy + BO_H/2;
  const hard = { restitution:1, friction:0, frictionStatic:0 };
  const wall = (x, y, w, h) => new Body(Object.assign({ type:'box', x, y, w, h, isStatic:true,
    layers:0b0011, fillColor:'#455a64', strokeColor:'#78909c', strokeWidth:1 }, hard));
  objects.push(wall(L - BO_WALL/2, cy - BO_WALL/2, BO_WALL, BO_H + BO_WALL),
               wall(R + BO_WALL/2, cy - BO_WALL/2, BO_WALL, BO_H + BO_WALL),
               wall(cx, T - BO_WALL/2, BO_W + 2*BO_WALL, BO_WALL));
  // ブロック（段ごとに色を変える）
  const rowCol = ['#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#42a5f5'];
  const x0 = cx - (BO_COLS * BO_BW + (BO_COLS - 1) * BO_GAP) / 2 + BO_BW/2;
  for (let r = 0; r < BO_ROWS; r++) for (let c = 0; c < BO_COLS; c++)
    objects.push(new Body(Object.assign({ type:'box', isStatic:true, layers:0b0001,
      x: x0 + c * (BO_BW + BO_GAP), y: T + 70 + r * (BO_BH + BO_GAP), w:BO_BW, h:BO_BH,
      fillColor: rowCol[r], strokeColor:'#263238', strokeWidth:1 }, hard)));
  // パドル。上面は5つの面の山形（左右対称・凸）
  const hw = BO_PAD_W/2, hh = BO_PAD_H/2, padY = B - 50;
  const top = [-1, -0.6, -0.2, 0.2, 0.6, 1].map(u => ({ x:u*hw, y:-hh - BO_PAD_RISE*(1 - u*u) }));
  const pad = new Body(Object.assign({ type:'polygon', x:cx, y:padY, isStatic:true, layers:0b0011,
    verts: top.concat([{ x:hw, y:hh }, { x:-hw, y:hh }]),
    fillColor:'#eceff1', strokeColor:'#90a4ae', strokeWidth:1 }, hard));
  objects.push(pad);
  // 球。★右上へ打ち出す（真上だとパドルの頂点とだけ往復する）
  const a = 60 * Math.PI / 180, v = BO_BALL_V * M2PX;
  const ball = new Body(Object.assign({ type:'circle', x:cx, y:padY - 60, radius:BO_BALL_R,
    mass:0.1, layers:0b0001, vx:v*Math.cos(a), vy:-v*Math.sin(a),
    fillColor:'#ffffff', strokeColor:'#b0bec5', strokeWidth:1 }, hard));
  objects.push(ball);
  // ── プログラム：当てたブロックを消す／落としたら止める ──
  const pg = addProgram(ball);
  pg.trigger = 'hit'; pg.hitWhat = 'same'; pg.action = 'delete'; pg.target = 'other';
  pg.collapsed = true; pg.fx = 0.07; pg.fy = 0.86;
  pg.reset(); syncProgramState(pg); syncProgramPanel(pg); placeProgramPanel(pg);
  const lose = addProgram(ball);
  lose.trigger = 'zone'; lose.action = 'pause';
  lose.zx = cx; lose.zy = B + 40; lose.zw = BO_W + 2*BO_WALL + 200; lose.zh = 80;
  lose.collapsed = true; lose.fx = 0.07; lose.fy = 0.92;
  lose.reset(); syncProgramState(lose); syncProgramPanel(lose); placeProgramPanel(lose);
  // ── リモコン：← → でパドルを動かす ──
  const rm = (dir, key, fx) => {
    const r = addRemote('drive', pad);
    if (!r) return;
    r.speed = BO_PAD_V; r.dir = dir; r.key = key; r.fx = fx; r.fy = 0.55;
    placeRemotePanel(r); syncRemotePanel(r);
  };
  rm(180, 'ArrowLeft', 0.07); rm(0, 'ArrowRight', 0.26);
  demoTitlePinned('ブロック崩し');
  demoNotePinned(
    '▶実行 して、← → でパドルを動かす。\n'
  + '・球が当たったブロックは消える\n'
  + '・パドルの上面は山形。端で受けるほど外へ打ち返す\n'
  + '・動かしながら打つと球の速さが変わる\n'
  + '・球が下へ抜けたら止まる。上のバーの ↩（Ctrl+Z）で\n'
  + '　打ち出す前へ戻る\n'
  + '\n'
  + 'しくみ：球に付けたプログラム1つで消している。\n'
  + '球とブロックだけ衝突レイヤーの設定が同じ（{1}）で、\n'
  + '壁とパドルは {1,2}。「当たる相手」を〈同じレイヤー\n'
  + '設定の物体だけ〉にすると、ブロックだけが消える。');
}

// ── きっかけのいろいろ ───────────────────────────────────
//   ★道具の見本：プログラムのきっかけ。連鎖の1段ずつに別のきっかけを使う。
//     ① 当たったら（当たる相手〈同じレイヤー設定の物体だけ〉）→ 削除
//        転がってきた球Aが落とし戸に乗ると戸が消え、戸の上の球Bと一緒に落ちる。
//     ② 光が当たる・途切れる（途切れたら）→ 削除
//        転がり出た球Bが光の根元を遮ると、光を受けていた棚が消える（棚そのものが受光器）。
//     ③ 決めた場所に入ったら → 色を変える
//        棚から落ちた球Cがカップに入ると色が変わる。
//     ④ 速さが 0〜0.1 m/s になったら → 実行を止める
//        球Cがカップの中で止まったら、シミュレーションが止まる。
//   ★ほかのきっかけは別の見本にある：合図（合図でつなぐ仕掛け）・○ステップごと
//     （ふるい分け）・半径○m以内（生成口と通過カウンタ）・キー（クレーン）。
//   ★①の絞り。戸の上の球Bは、はじめから戸に載っている＝▶を押した tick に「当たった」が
//     立ってしまう（program.js の hitWhat の★）。そこで戸と球Aだけを {1,2} にし、
//     ほかは全部 {1} にする。球Bは戸と共有する（載っていられる）が同じではないので数えない。
//     （旧ピタゴラスイッチの④の落とし戸と同じ組み方）
//   ★②の光は地面すれすれから斜め上の棚の裏へ向ける。転がってきた球が横切るのは光の根元
//     （地面から球の直径ぶんの高さまで）なので、根元を球の通り道に置く。
//   ★2026-09-27、ユーザーの指示で「ピタゴラスイッチ」を、ほかの道具のしくみの見本にそろえて改名し、
//     紹介するきっかけを整理して作り直した。
//     鐘・振り子・ドミノの段は、紹介するきっかけが「当たったら」の重複だったので外した。
//   ★摩擦は既定のまま（遊びの見本。摩擦が無いと球が転がらずに滑る）。
function demoTriggerKinds() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.7);
  const cx = cam.x + (690 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const soft = { restitution:0.1, friction:0.5, frictionStatic:0.6, strokeWidth:1.5 };
  const plank = (x0, y0, x1, y1, th, o) => new Body(Object.assign({ type:'box', isStatic:true, layers:0b0001,
    x:(x0 + x1)/2, y:(y0 + y1)/2 + th/2, w:Math.hypot(x1 - x0, y1 - y0), h:th,
    angle:Math.atan2(y1 - y0, x1 - x0), fillColor:'#8d6e63', strokeColor:'#5d4037' }, soft, o));
  const ball = (x, y, r, col, o) => new Body(Object.assign({ type:'circle', x, y:y - r, radius:r, mass:1,
    layers:0b0001, fillColor:col, strokeColor:'#263238' }, soft, o));
  // ① 坂・球A・落とし戸・戸の上の球B（右端の止めにもたれる）・その下の坂
  objects.push(plank(cx - 330, gy - 360, cx - 170, gy - 290, 12));
  const A = ball(cx - 315, gy - 366, 15, '#ef5350', { layers:0b0011 });
  objects.push(A);
  objects.push(plank(cx - 170, gy - 290, cx - 130, gy - 290, 12));
  const door = plank(cx - 130, gy - 290, cx - 40, gy - 290, 10,
    { layers:0b0011, fillColor:'#ffb74d', strokeColor:'#e65100' });
  objects.push(door);
  objects.push(plank(cx - 40, gy - 320, cx - 32, gy - 320, 40));   // 戸の右端の止め
  const B = ball(cx - 55, gy - 290, 14, '#42a5f5');
  objects.push(B);
  objects.push(plank(cx - 150, gy - 200, cx + 60, gy - 100, 12));
  // ② 光と、光を受ける棚・棚の上の球C・球Bの止め
  const src = { x:cx + 120, y:gy - 3 }, shelfC = { x:cx + 260, y:gy - 300 };
  const shelf = plank(shelfC.x - 35, shelfC.y, shelfC.x + 35, shelfC.y, 10,
    { fillColor:'#4dd0e1', strokeColor:'#006064' });
  objects.push(shelf);
  const tgt = { x:shelfC.x, y:shelf.y + shelf.h/2 };            // 棚の裏の中央
  lasers.push(new Laser({ body:null, localX:src.x, localY:src.y, width:0, wavelength:633,
                          angle: Math.atan2(tgt.y - src.y, tgt.x - src.x) }));
  const C = ball(shelfC.x, shelfC.y, 14, '#ffd54f');
  objects.push(C);
  //   ★止めの高さ 50px。30px だと勢いのついた球Aが飛び越えてカップまで行った。
  //     光はここでは地面から 95px の高さを通るので、止めには当たらない。
  objects.push(plank(cx + 160, gy - 50, cx + 168, gy - 50, 50));   // 転がってきた球の止め（光より右）
  // ③ カップ（棚の下）
  const kx = shelfC.x, KW = 70;
  objects.push(plank(kx - KW/2 - 4, gy - 8, kx + KW/2 + 4, gy - 8, 8),
               plank(kx - KW/2 - 4, gy - 50, kx - KW/2 + 4, gy - 50, 50),
               plank(kx + KW/2 - 4, gy - 50, kx + KW/2 + 4, gy - 50, 50));
  // ── プログラム ──
  const prog = (b, o, fy) => {
    const p = addProgram(b);
    Object.assign(p, o, { collapsed:true, fx:0.07, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  };
  prog(door,  { trigger:'hit', hitWhat:'same', action:'delete', target:'self' }, 0.62);
  prog(shelf, { trigger:'light', lightEdge:'off', action:'delete', target:'self' }, 0.68);
  prog(C,     { trigger:'zone', zx:kx, zy:gy - 30, zw:KW - 8, zh:44, action:'color', color:'#66bb6a' }, 0.74);
  prog(C,     { trigger:'speed', spdMin:0, spdMax:0.1, action:'pause' }, 0.80);
  const lab = (x, y, t) => demoLabel(x, y, t, '#eceff1', 15);
  lab(cx - 85, gy - 345, '① 当たったら');
  lab(cx + 60, gy - 120, '② 光が途切れたら');
  lab(shelfC.x, shelfC.y - 50, '棚（受光）');
  lab(kx - 20, gy - 80, '③ 入ったら → ④ 止まったら');
  demoTitlePinned('きっかけのいろいろ');
  demoNotePinned(
    '▶実行 して見るだけ。1段ずつ、プログラムのきっかけが違う。\n'
  + '① 当たったら … 赤い球が橙の戸に乗ると戸が消え、青い球と落ちる\n'
  + '　（相手を〈同じレイヤー設定の物体だけ〉に絞る）\n'
  + '② 光が途切れたら … 転がってきた球が光を遮ると、光を受けていた棚が消える\n'
  + '③ 決めた場所に入ったら … 黄色い球がカップに入ると緑になる\n'
  + '④ 速さが 0〜0.1 m/s になったら … 球が止まると実行が止まる');
}

// ── ブランコこぎ ─────────────────────────────────────────
//   ★部品は四角形・円の和・ヒンジ・モーター（axle）・リモコンだけ。どれも手で置ける。
//   ★吊り具はロープではなく**細長い剛体**（座板と一体）を支点にヒンジで留める。
//     張ったロープは質量の無い理想の糸で（physbox-taut-rope-is-massless-and-undamped）、
//     座った人が体をひねっても座板が糸の端でくるりと回るだけで、揺れに伝わらない。
//     本物のブランコでも、こぐ人は鎖を手で握って鎖ごと体を回している＝張っている
//     間の鎖は棒と同じ。代わりに高く振っても鎖がたるまない（1回転もできてしまう）。
//   ★こぐしくみ。股（胴⇔座板）とひざ（すね⇔座板）のモーターは内力なので、
//     支点まわりの角運動量を直接は変えない。変わるのは体の重心の位置で、
//     重力のトルクが揺れの向きに合わせて増減する＝押し方が揺れと合えば振れが育つ。
//   ★実測（10秒ごとの最大の振れ角。棒の角速度の向きで押し分ける理想の押し方）：
//     押さない               … 2.6° のまま（重心を支点の真下に置いた静止の姿勢）
//     前へ振れる間 →・戻る間 ← … 18° → 32° → 43° → 50° → 56° → 60°（60秒）
//     その逆                 … 6.5° → 5.2°（振れが育たない）
//     でたらめ（0.2〜1秒で持ち替え）… 10° → 19°
//     ※以前ここに「吊り具 3kg だと股のブレーキが 20秒で 51° ずれる→10kg」と書いていたが、
//       胴と吊り具が objects に2回入っていた（1 tick に2回積分）せいだった。3kg で 0.1°。
//   ★衝突レイヤーは部品ごとに1つずつ（枠 1・吊り具 2・すね 3・胴 4）＝互いに当たらない。
//     人と座板は股・ひざで重なっているし、枠は飾り。支点は地面から十分高く、足は地面に届かない。
const SW_BAR_L = 200;                     // [px] 支点から座面まで
const SW_PIV_H = 300;                     // [px] 支点の高さ（地面から）
const SW_SEAT_W = 44, SW_SEAT_H = 8;      // [px] 座板
const SW_THIGH_L = 40, SW_THIGH_W = 13;   // [px] もも（座板と一体。前へ水平）
const SW_SHIN_L = 44, SW_SHIN_W = 11;     // [px] すね（ひざでモーター）
const SW_TORSO_H = 60, SW_TORSO_W = 24, SW_HEAD_R = 12;   // [px]
const SW_M_BAR = 3, SW_M_TORSO = 30, SW_M_SHIN = 6;       // [kg]（吊り具は座板・もも込み）
const SW_HIP_W = 4,  SW_HIP_T = 300;      // [rad/s]・[N·m] 股（のけぞる・起き上がる）
const SW_KNEE_W = 6, SW_KNEE_T = 150;     // [rad/s]・[N·m] ひざ（伸ばす・たたむ）
// 可動域（時計回りが正。取り付けた姿勢が 0＝胴は吊り具に沿って真っすぐ、すねは真下）
//   股：のけぞる（頭が後ろ＝左＝負）60°、前かがみ 15°。
//   ひざ：伸ばす（足が前へ上がる＝負）80°、たたむ（足が座板の下へ）50°。
const SW_HIP_LO  = -60 * Math.PI / 180, SW_HIP_HI  = 15 * Math.PI / 180;
const SW_KNEE_LO = -80 * Math.PI / 180, SW_KNEE_HI = 50 * Math.PI / 180;
function demoSwing() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.95);
  const cx = cam.x + (760 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y, py = gy - SW_PIV_H, sy = py + SW_BAR_L;   // 支点・座面の高さ
  const col = { skin:'#ffcc80', shirt:'#26a69a', leg:'#5c6bc0', wood:'#8d6e63', edge:'#263238' };
  const part = (o) => new Body(Object.assign({ restitution:0, friction:0.5,
    strokeColor:col.edge, strokeWidth:1.5 }, o));
  // 枠（飾り。固定。レイヤーが1つだけ違うので、揺れる側とは当たらない）
  const post = (x0, x1) => {
    const dx = x1 - x0, dy = gy - py, L = Math.hypot(dx, dy);
    return part({ type:'box', isStatic:true, x:(x0 + x1)/2, y:(py + gy)/2, w:10, h:L, layers:0b0001,
                  angle: -Math.atan2(dx, dy), fillColor:'#546e7a', strokeColor:'#37474f' });
  };
  objects.push(post(cx, cx - 120), post(cx, cx + 120),
               part({ type:'box', isStatic:true, layers:0b0001, x:cx, y:py - 6, w:40, h:12,
                      fillColor:'#546e7a', strokeColor:'#37474f' }));
  // 吊り具（棒＋座板＋もも）
  const bar = demoUnion(
    part({ type:'box', x:cx, y:py + SW_BAR_L/2, w:5, h:SW_BAR_L, mass:1, fillColor:'#b0bec5' }),
    part({ type:'box', x:cx + 4, y:sy + SW_SEAT_H/2, w:SW_SEAT_W, h:SW_SEAT_H, mass:1, fillColor:col.wood }),
    part({ type:'box', x:cx + SW_THIGH_L/2, y:sy - SW_THIGH_W/2, w:SW_THIGH_L, h:SW_THIGH_W,
           mass:1, fillColor:col.leg }));
  bar.layers = 0b0010; bar.setMass(SW_M_BAR);
  // すね（ひざはももの先）
  const kx = cx + SW_THIGH_L - 4, ky = sy - SW_THIGH_W/2;
  const shin = part({ type:'box', x:kx, y:ky + SW_SHIN_L/2, w:SW_SHIN_W, h:SW_SHIN_L,
                      mass:SW_M_SHIN, layers:0b0100, fillColor:col.leg });
  // 胴＋頭（股は座面の上）
  const hy = sy - SW_THIGH_W/2;
  const torso = demoUnion(
    part({ type:'box', x:cx + 2, y:hy - SW_TORSO_H/2, w:SW_TORSO_W, h:SW_TORSO_H, mass:1, fillColor:col.shirt }),
    part({ type:'circle', x:cx + 2, y:hy - SW_TORSO_H - SW_HEAD_R + 3, radius:SW_HEAD_R, mass:1, fillColor:col.skin }));
  torso.layers = 0b1000; torso.setMass(SW_M_TORSO);
  // ★図形和（demoUnion）は自分で objects へ入れる。ここで push し直すと同じ物体が2回入り、
  //   ↩ で JSON から作り直したときに2人に分かれる。描く順（すね → 胴）だけ並べ直す。
  for (const b of [bar, torso]) objects.splice(objects.indexOf(b), 1);
  objects.push(bar, shin, torso);
  // 支点（背景に打った杭）
  const pv = new Joint({ type:'hinge', bodyA:null, bodyB:bar });
  setJointEnd(pv, 'A', null, cx, py, false); setJointEnd(pv, 'B', bar, cx, py, false);
  const hipJ = new Joint({ type:'axle', bodyA:bar, bodyB:torso,
    motorSpeed:-SW_HIP_W, motorTorque:SW_HIP_T, motorBrake:true,
    angleLimit:true, angleLo:SW_HIP_LO, angleHi:SW_HIP_HI });
  setJointEnd(hipJ, 'A', bar, cx + 2, hy, false); setJointEnd(hipJ, 'B', torso, cx + 2, hy, false);
  const kneeJ = new Joint({ type:'axle', bodyA:bar, bodyB:shin,
    motorSpeed:-SW_KNEE_W, motorTorque:SW_KNEE_T, motorBrake:true,
    angleLimit:true, angleLo:SW_KNEE_LO, angleHi:SW_KNEE_HI });
  setJointEnd(kneeJ, 'A', bar, kx, ky, false); setJointEnd(kneeJ, 'B', shin, kx, ky, false);
  joints.push(pv, hipJ, kneeJ);
  // ★全体を支点まわりに回して、重心を支点の真下へ置く（放っておけば静止する姿勢）。
//   脚が前へ出ているぶん重心は座面より前にあり、真っすぐ吊ると放しただけで揺れ出す。
  //   アンカーは物体のローカル座標なので、物体ごと回せば軸はずれない。
  const ps = [bar, shin, torso];
  let M = 0, mx = 0, my = 0;
  for (const b of ps) { M += b.mass; mx += b.mass * b.x; my += b.mass * b.y; }
  const th = Math.atan2(mx / M - cx, my / M - py);
  const c = Math.cos(th), s = Math.sin(th);
  for (const b of ps) {
    const dx = b.x - cx, dy = b.y - py;
    b.x = cx + c * dx - s * dy; b.y = py + s * dx + c * dy; b.angle += th;
    b._updateAABB();
  }
  // ── リモコン4台：→ のけぞって脚を伸ばす ／ ← 起き上がって脚をたたむ ──
  //   ★1つのキーで股とひざの2台を同時に動かす（よろよろ走りの Q/W と同じ組み方）。
  //     こぐ動作は2つの関節がいつも組になっていて、別々のキーにしても遊びが増えない。
  const rm = (joint, mode, key, fx, fy) => {
    const r = addRemote('motor', joint);
    if (!r) return;
    r.kind = 'motor'; r.mode = mode; r.key = key; r.fx = fx; r.fy = fy; r.collapsed = true;
    placeRemotePanel(r); syncRemotePanel(r);
  };
  rm(hipJ, 'on',  'ArrowRight', 0.07, 0.58); rm(kneeJ, 'on',  'ArrowRight', 0.07, 0.78);
  rm(hipJ, 'rev', 'ArrowLeft',  0.26, 0.58); rm(kneeJ, 'rev', 'ArrowLeft',  0.26, 0.78);
  demoTitlePinned('ブランコこぎ');
  demoNotePinned(
    '▶実行 して、← → でこぐ。\n'
  + '・→ … のけぞって脚を前へ伸ばす\n'
  + '・← … 起き上がって脚をたたむ\n'
  + '・キーを放した関節はその姿勢で止まる\n'
  + '・揺れに合わせて押すと少しずつ高く振れる。\n'
  + '　押す向きが逆だと振れが小さくなる\n'
  + '・吊り具は鎖ではなく棒（張った鎖と同じ）');
}

// ── 一輪車 ───────────────────────────────────────────────
//   ★部品は円（車輪）・四角形と円の和（乗り手）・モーター（axle）1つ・リモコン2台だけ。
//   ★乗り手は車輪の軸の上に立つ倒立振子。車輪をモーターで回すと、その反作用で
//     乗り手は逆向きに回される（内力）。だから「倒れそうな側へ車輪を送り込む」と
//     車輪が体の下へ回り込み、同時に反作用が体を起こす向きに効く＝立て直せる。
//     逆へ回すと、体は倒れる向きへさらに押される。直感の逆なのが遊びの本体。
//   ★重力は月面（1.62 m/s²）。2026-09-27、ユーザーの判断で弱くした。地上の重力では
//     キーの入り切りで立てていられない。倒立振子の倒れ方の時間は 1/√g で伸びる。
//   ★放したら自由に回る（motorBrake 切）。ペダルから力を抜いた状態。止める軸にすると、
//     弱い重力では押さなければ倒れない＝何もしないのが最善になって遊びにならない。
//   ★実測。人の操作の模型：体の傾き・角速度・車輪の角速度を 0.15 秒遅れて見て、遅れの
//     ぶんを先読みし、しきい値で ← → を押し分ける。係数 27 通りで、20秒立っていられた数
//     （平均の立っていた秒数・平均の進んだ距離）：
//       地上 … 自由 8 rad/s・120 N·m：0/27（2.2秒）／止める 2 rad/s・60 N·m：0/27（3.6秒）
//       ×0.5 … 止める：9/27（10.8秒）  ×0.3 … 止める：18/27（16.5秒）  ※どれも押さなければ倒れない
//       ×0.3 … 自由：0/27（13.5秒・9.8m）。押さなければ 1.9秒で倒れる
//       月面 … 自由：27/27（20秒）。押さなければ 2.8秒で倒れる
//              前へ 0.05 rad 傾けて走らせる：15/27（19.2秒・3.7m）、0.1 rad：12/27（17.4秒・5.4m）
//     ※以前の実測（地上で 0.5 秒で倒れる、など）は、乗り手が objects に2回入っていた
//       （1 tick に2回積分）せいで倒れ方が速すぎた。直したあとの値が上。
//   ★車輪は 15kg（実物の一輪車は 3kg ほど）。弱い重力では車輪がすぐ浮く：
//     乗り手が軸のまわりを角速度 ω で回ると、軸は 乗り手の質量×ω²×（重心までの距離）で
//     上へ引かれる（向心力の反作用）。これが全体の重さを超えると浮く。月面では乗り手が
//     毎秒 80° ほど回るだけで超える＝キーで急に逆転させるたびに跳ねる（物理としては正しい）。
//     車輪を重くして、地面を押さえる重さを増やした。実測（上の操作の模型12通り・20秒）：
//       車輪 3kg  … でたらめに押して立っている間に浮いた割合 19.4%／小山のコースで浮いた時間
//                   4.1%・最大 53px、20秒もったもの 4/12、平均 1.9m
//       車輪 15kg … 同 0.0%／0.7%・最大 3px、11/12、平均 8.7m
//     重力のほうを地球の 1/4 に上げても浮かなくなるが、20秒もつのが 8/12 に減る。
//     トルクの上限を下げるのは効かない（120 → 60 N·m で浮き方がばらつき、単調に減らない）。
//   ★摩擦は既定のまま（摩擦なしの約束の外。遊びのデモなので入れる）。タイヤが
//     地面をつかまないと、車輪が空回りして体の下へ回り込めない。
//   ★乗り手が地面に当たったら止める（プログラム1つ。当たる相手〈地面・壁〉）。
//     車輪と乗り手はレイヤーを分けてある（軸で常に重なっている）。
const UC_WHEEL_R = 28;                    // [px]
const UC_POST_H = 50;                     // [px] 軸からサドルまで
const UC_TORSO_H = 62, UC_TORSO_W = 24, UC_HEAD_R = 12;   // [px]
const UC_ARM_L = 46;                      // [px] 左右に広げた腕の長さ（肩から）
const UC_M_WHEEL = 15, UC_M_RIDER = 40;   // [kg]（車輪が重いのは下の★）
const UC_W = 8, UC_T = 120;               // [rad/s]・[N·m] 車輪のモーター
const UC_G = 1.62;                        // [m/s²] 月面の重力（上の★）
function demoUnicycle() {
  resetDemoWorld();
  setDemoGravity(UC_G);
  updateGroundTerrain(true);
  ground.friction = 1; ground.frictionStatic = 1.2;
  const gy = ground.y, ay = gy - UC_WHEEL_R;          // 軸の高さ
  const col = { skin:'#ffcc80', shirt:'#ffa726', leg:'#5c6bc0', frame:'#b0bec5', edge:'#263238' };
  const part = (o) => new Body(Object.assign({ restitution:0, friction:1, frictionStatic:1.2,
    strokeColor:col.edge, strokeWidth:1.5 }, o));
  const wheel = part({ type:'circle', x:0, y:ay, radius:UC_WHEEL_R, mass:UC_M_WHEEL,
                       layers:0b0001, fillColor:'#37474f', strokeColor:'#90a4ae' });
  // 乗り手（フレーム＋脚＋胴＋広げた腕＋頭を1つの物体に）
  const sy = ay - UC_POST_H, shY = sy - UC_TORSO_H + 10;
  const L = 0b0010;
  const rider = demoUnion(
    part({ type:'box', x:0, y:ay - UC_POST_H/2, w:5, h:UC_POST_H, mass:1, layers:L, fillColor:col.frame }),
    part({ type:'box', x:-7, y:ay - UC_POST_H/2 + 4, w:9, h:UC_POST_H - 8, mass:1, layers:L, fillColor:col.leg }),
    part({ type:'box', x:0, y:sy - 3, w:26, h:6, mass:1, layers:L, fillColor:'#455a64' }),
    part({ type:'box', x:0, y:sy - 6 - UC_TORSO_H/2, w:UC_TORSO_W, h:UC_TORSO_H, mass:1, layers:L, fillColor:col.shirt }),
    part({ type:'box', x:0, y:shY, w:2 * UC_ARM_L + UC_TORSO_W, h:8, mass:1, layers:L, fillColor:col.skin }),
    part({ type:'circle', x:0, y:sy - 6 - UC_TORSO_H - UC_HEAD_R + 3, radius:UC_HEAD_R, mass:1, layers:L, fillColor:col.skin }));
  rider.fillColor = col.shirt; rider.strokeColor = col.edge;   // ★図形和は部品の色を持ち越さない
  rider.setMass(UC_M_RIDER);
  objects.splice(objects.indexOf(rider), 1);   // ★図形和は自分で入る（ブランコの★）
  objects.push(wheel, rider);
  const axle = new Joint({ type:'axle', bodyA:rider, bodyB:wheel,
    motorSpeed:UC_W, motorTorque:UC_T, motorBrake:false });
  setJointEnd(axle, 'A', rider, 0, ay, false); setJointEnd(axle, 'B', wheel, 0, ay, false);
  joints.push(axle);
  // コース：1m ごとの目盛りと、3m 先から低い小山
  for (let m = 1; m <= 20; m++) demoLabel(m * M2PX, gy + 22, m + 'm', '#90a4ae', 14);
  //   ★小山は台形（上り・下りの坂は高さの7倍の長さ）。四角い段差だと、車輪が角に当たって
  //     弱い重力では跳ね上げられる（上の★の実測）。
  for (const [xm, h] of [[3, 4], [5, 6], [7, 8], [9.5, 10], [12, 12]]) {
    const run = h * 7, top = 60;
    objects.push(new Body({ type:'polygon', isStatic:true, x:xm * M2PX, y:gy - h/2,
      verts:[{ x:-top/2 - run, y:h/2 }, { x:top/2 + run, y:h/2 }, { x:top/2, y:-h/2 }, { x:-top/2, y:-h/2 }],
      restitution:0, friction:1, frictionStatic:1.2, fillColor:'#6d4c41', strokeColor:'#3e2723', strokeWidth:1 }));
  }
  // 倒れたら止める
  const pg = addProgram(rider);
  pg.trigger = 'hit'; pg.hitWhat = 'env'; pg.action = 'pause';
  pg.collapsed = true; pg.fx = 0.07; pg.fy = 0.86;
  pg.reset(); syncProgramState(pg); syncProgramPanel(pg); placeProgramPanel(pg);
  // ── リモコン2台：→ 車輪を右へ ／ ← 左へ ──
  //   ★車輪を時計回り（右へ進む向き）に回すのが motorSpeed の正（体に対して）。
  const rm = (mode, key, fx) => {
    const r = addRemote('motor', axle);
    if (!r) return;
    r.kind = 'motor'; r.mode = mode; r.key = key; r.fx = fx; r.fy = 0.62; r.collapsed = true;
    placeRemotePanel(r); syncRemotePanel(r);
  };
  rm('rev', 'ArrowLeft', 0.07); rm('on', 'ArrowRight', 0.26);
  setDemoCam(0, 1.1);
  attachCamera(rider, 'world');
  demoTitlePinned('一輪車');
  demoNotePinned(
    '▶実行 して、← → で車輪を回して倒れないように進む。\n'
  + '・倒れそうな側へ車輪を送り込むと立て直せる\n'
  + '・重力は月面（地球の約 1/6）\n'
  + '・キーを放すと車輪は自由に回る\n'
  + '・車輪を回すと、その反作用で体は逆向きに回される\n'
  + '・体が地面に着いたら止まる。上のバーの ↩（Ctrl+Z）で\n'
  + '　はじめへ戻る');
}

// ── クレーンで荷運び ─────────────────────────────────────
//   ★部品は四角形・ロープ・リモコン2台・プログラム3つだけ。
//   ★台車は固定した物体を〈手で動かす〉（ブロック崩しのパドルと同じ）。押している間は
//     一定の速さで動き、放すとその場で止まる。荷はロープの先で振り子になるので、
//     急に動かす・急に止めると振れる。本物のクレーンの腕前と同じで、振れは台車の
//     動かし方で消せる（たとえば、動かしていた時間がちょうど振れの周期の整数倍なら、
//     止めたときに振れが残らない）。
//   ★荷を放すしくみ。↓ に荷のプログラムを2つ結ぶ：〈複製〉と〈自分を削除〉。同じ tick の
//     境界で、元の荷と同じ位置・速度の写しが出て、ロープのついた元の荷が消える
//     （消えた物体につながっていたロープは一緒に外れる）＝荷だけが放たれる。
//     ジョイントを外す操作は無いので、物体を入れ替えて外す。
//   ★箱に入ったかは箱の側で見る（箱の床に〈半径の中の物体の数〉→ 色を変える）。
//     荷の側に付けると、放した瞬間に元の荷ごとプログラムの相手が消えて働かない。
//     半径 0.3 m は、入った荷の中心（床から 25px）には届き、両壁（49px）と
//     吊ったままの荷（95px 上）には届かない。
//   ★吊り方で振れの減り方がまるで違う。台車を 2秒動かして止めたあとの振れ幅
//     （5秒ごと・台車と荷の横のずれの最大）：
//       フック＋留め具（溶接）＋短いロープ … 74 → 56 → 39 → 30 → 22 → 16px（止めて25秒待てば入った）
//       フック＋留め具（溶接2本）          … 71 → 54 → 40 → 30 → 21 → 16px
//       ロープで吊ったかごに載せる          … 73 → 47 → 14 → 13 → 13 → 12px（隙間 0.5px。4px だと 48 → 17）
//       ロープ1本で荷を直に吊る            … 75 → 71 → 68 → 65 → 61 → 59px
//       いまの形（ロープ → フック → ロープ） … 73 → 66 → 61 → 56 → 50 → 46px
//     溶接は振れのエネルギーを食い、かごは中の荷がこすれて食う。どちらも「待てば入る」
//     遊びになってしまうので、ロープだけでつなぐ。
//   ★荷の振れの大きさは、台車の速さ v で急に止めたとき v/ω（ω＝2π/T、T は実測 2.9 秒）。
//     v＝1 m/s で約 0.46 m。箱の内のりは荷より左右 15cm ずつ広いだけなので、
//     振れたまま放すと入らない。
const CR_RAIL_H = 330;                    // [px] レールの高さ（地面から）
const CR_ROPE_L = 150, CR_SLING_L = 25;   // [px] 台車〜フック・フック〜荷
const CR_LOAD_W = 50, CR_LOAD_H = 40;     // [px] 荷
const CR_M_LOAD = 20, CR_M_HOOK = 2;      // [kg]
const CR_CUP_IN = 80, CR_CUP_H = 50;      // [px] 箱の内のり・壁の高さ
const CR_V = 1.0;                         // [m/s] 台車の速さ
function demoCrane() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.72);
  const cx = cam.x + (770 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y, ry = gy - CR_RAIL_H;
  const x0 = cx - 240, xc = cx + 230;   // 荷の出発点・箱の中心
  const deco = { restitution:0, friction:0.5, strokeWidth:1.5 };
  // レールと柱（固定。台車とはレイヤーを分ける）
  objects.push(new Body(Object.assign({ type:'box', isStatic:true, x:cx, y:ry - 6, w:620, h:12,
      layers:0b0001, fillColor:'#607d8b', strokeColor:'#37474f' }, deco)));
  for (const px of [cx - 300, cx + 300])
    objects.push(new Body(Object.assign({ type:'box', isStatic:true, x:px, y:(ry + gy)/2, w:14, h:CR_RAIL_H,
        layers:0b0001, fillColor:'#607d8b', strokeColor:'#37474f' }, deco)));
  // レールの両端の止め。★台車と同じレイヤー {2}＝手で動かしている台車はここで止まる
  //   （collision.js の blockHandAgainstFixed の★。柱はレイヤー {1} なので当たらない）
  for (const sx of [cx - 285, cx + 285])
    objects.push(new Body(Object.assign({ type:'box', isStatic:true, x:sx, y:ry + 10, w:10, h:24,
        layers:0b0010, fillColor:'#ef5350', strokeColor:'#b71c1c' }, deco)));
  // 台車
  const cart = new Body(Object.assign({ type:'box', isStatic:true, x:x0, y:ry + 10, w:50, h:20,
      layers:0b0010, fillColor:'#ffca28', strokeColor:'#f57f17' }, deco));
  // フックと荷。台車 →（ロープ）→ フック →（短いロープ）→ 荷
  const hy = ry + 20 + CR_ROPE_L;
  const hook = new Body(Object.assign({ type:'box', x:x0, y:hy + 6, w:18, h:12, mass:CR_M_HOOK,
      layers:0b0010, fillColor:'#90a4ae', strokeColor:'#455a64' }, deco));
  const ly = hy + 12 + CR_SLING_L;          // 荷の上面
  const load = new Body(Object.assign({ type:'box', x:x0, y:ly + CR_LOAD_H/2, w:CR_LOAD_W, h:CR_LOAD_H,
      mass:CR_M_LOAD, layers:0b0100, fillColor:'#8d6e63', strokeColor:'#4e342e' }, deco));
  objects.push(cart, hook, load);
  const rope = (A, ay, B, by, L) => {
    const j = new Joint({ type:'rope', bodyA:A, bodyB:B, restLength:L, maxLength:L,
                          linDensity:0.02, color:'#cfd8dc' });
    setJointEnd(j, 'A', A, x0, ay, false); setJointEnd(j, 'B', B, x0, by, false);
    return j;
  };
  joints.push(rope(cart, ry + 20, hook, hy, CR_ROPE_L), rope(hook, hy + 12, load, ly, CR_SLING_L));
  // 出発台と箱（地面に置いた固定の板）
  objects.push(new Body(Object.assign({ type:'box', isStatic:true, x:x0, y:gy - 10, w:90, h:20,
      layers:0b0101, fillColor:'#546e7a', strokeColor:'#37474f' }, deco)));
  const cup = (x, y, w, h) => new Body(Object.assign({ type:'box', isStatic:true, x, y, w, h,
      layers:0b0101, fillColor:'#26a69a', strokeColor:'#00695c' }, deco));
  const floor = cup(xc, gy - 5, CR_CUP_IN + 20, 10);
  objects.push(floor,
               cup(xc - CR_CUP_IN/2 - 5, gy - CR_CUP_H/2, 10, CR_CUP_H),
               cup(xc + CR_CUP_IN/2 + 5, gy - CR_CUP_H/2, 10, CR_CUP_H));
  // ── プログラム：↓ で放す（複製＋削除）／箱に入ったら箱の色を変える ──
  //   ★複製を先に置く。同じ tick に積んだ操作はプログラムの並び順に効くので、
  //     削除が先だと写しの元が無くなる。
  const prog = (b, o, fy) => {
    const p = addProgram(b);
    Object.assign(p, o, { collapsed:true, fx:0.07, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  };
  prog(load,  { trigger:'key', key:'ArrowDown', action:'spawn', limit:1 }, 0.80);
  prog(load,  { trigger:'key', key:'ArrowDown', action:'delete', target:'self' }, 0.86);
  prog(floor, { trigger:'near', nearR:0.3, nearMin:1, nearMax:5, action:'color', color:'#ffee58' }, 0.92);
  // ── リモコン：← → で台車を動かす ──
  const rm = (dir, key, fx) => {
    const r = addRemote('drive', cart);
    if (!r) return;
    r.speed = CR_V; r.dir = dir; r.key = key; r.fx = fx; r.fy = 0.62; r.collapsed = true;
    placeRemotePanel(r); syncRemotePanel(r);
  };
  rm(180, 'ArrowLeft', 0.07); rm(0, 'ArrowRight', 0.26);
  demoTitlePinned('クレーンで荷運び');
  demoNotePinned(
    '▶実行 して、← → で台車を動かし、↓ で荷を放す。\n'
  + '・荷を右の箱に入れたら箱の色が変わる\n'
  + '・急に動かす・止めると荷が振れる。振れたまま\n'
  + '　放すと箱に入らない\n'
  + '・振れを止めるには、振れに合わせてもう一度動かす\n'
  + '・上のバーの ↩（Ctrl+Z）ではじめへ戻る');
}

// ── 合図でつなぐ仕掛け ───────────────────────────────────
//   ★プログラムの〈合図を出す〉〈合図を受けたら〉の見本。原因と結果が別の物体にある：
//     ① 転がった球がボタンに当たる → ボタンが合図1を出す
//     ② 合図1で、離れた棚の扉が消える・ランプ1が点く（受ける側は何個あってもよい）
//     ③ 扉が消えて転がり落ちた球がカップに入る → カップの底が合図2を出す → ランプ2が点く
//   ★合図が無かったころは、①→② をつなぐのに「ボタンと扉を同じ物体にする」か、
//     旧ピタゴラスイッチの⑦のように光のきっかけで回り道するしかなかった。
//   ★部品は板・球・円・プログラム5つだけ。摩擦は既定のまま（遊びのデモ）。
function demoSignals() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.9);
  const cx = cam.x + (770 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const soft = { restitution:0.1, friction:0.5, frictionStatic:0.6, strokeWidth:1.5 };
  const plank = (x0, y0, x1, y1, th, o) => new Body(Object.assign({ type:'box', isStatic:true,
    x:(x0 + x1)/2, y:(y0 + y1)/2 + th/2, w:Math.hypot(x1 - x0, y1 - y0), h:th,
    angle:Math.atan2(y1 - y0, x1 - x0), fillColor:'#8d6e63', strokeColor:'#5d4037' }, soft, o));
  const ball = (x, y, r, col) => new Body(Object.assign({ type:'circle', x, y, radius:r, mass:1,
    fillColor:col, strokeColor:'#263238' }, soft));
  // ① 坂と球A、ボタン
  objects.push(plank(cx - 300, gy - 150, cx - 140, gy - 10, 12));
  objects.push(ball(cx - 285, gy - 172, 14, '#ef5350'));
  const button = new Body(Object.assign({ type:'box', isStatic:true, x:cx - 40, y:gy - 14, w:14, h:28,
    fillColor:'#e53935', strokeColor:'#b71c1c' }, soft));
  objects.push(button);
  // ② 右の棚（左へ少し下がる）・扉・球B
  const shelfY = gy - 200;
  objects.push(plank(cx + 80, shelfY, cx + 260, shelfY - 16, 10));
  const door = new Body(Object.assign({ type:'box', isStatic:true, x:cx + 76, y:shelfY - 22, w:8, h:44,
    fillColor:'#ffb74d', strokeColor:'#e65100' }, soft));
  objects.push(door);
  objects.push(ball(cx + 110, shelfY - 18, 14, '#42a5f5'));
  // ③ カップ（棚の左端の下）
  const kx = cx + 50;
  const floor = new Body(Object.assign({ type:'box', isStatic:true, x:kx, y:gy - 4, w:60, h:8,
    fillColor:'#26a69a', strokeColor:'#00695c' }, soft));
  objects.push(floor,
    new Body(Object.assign({ type:'box', isStatic:true, x:kx - 34, y:gy - 20, w:8, h:40, fillColor:'#26a69a', strokeColor:'#00695c' }, soft)),
    new Body(Object.assign({ type:'box', isStatic:true, x:kx + 34, y:gy - 20, w:8, h:40, fillColor:'#26a69a', strokeColor:'#00695c' }, soft)));
  // ランプ（高いところに置く＝何も当たらない）
  const lamp = (x) => new Body(Object.assign({ type:'circle', isStatic:true, x, y:gy - 330, radius:18,
    fillColor:'#455a64', strokeColor:'#90a4ae' }, soft));
  const L1 = lamp(cx - 60), L2 = lamp(cx + 60);
  objects.push(L1, L2);
  // ── プログラム ──
  const prog = (b, o, fy) => {
    const p = addProgram(b);
    Object.assign(p, o, { collapsed:true, fx:0.07, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  };
  prog(button, { trigger:'hit', hitWhat:'body', action:'signal', sigOut:1 }, 0.62);
  prog(door,   { trigger:'signal', sigIn:1, action:'delete', target:'self' }, 0.68);
  prog(L1,     { trigger:'signal', sigIn:1, action:'color', color:'#ffee58' }, 0.74);
  // ★カップの底は〈半径の中の物体の数〉。半径 0.3 m は入った球（底から 18px）に届き、
  //   両壁（38px）には届かない（クレーンの箱と同じ考え）
  prog(floor,  { trigger:'near', nearR:0.3, nearMin:1, nearMax:5, action:'signal', sigOut:2 }, 0.80);
  prog(L2,     { trigger:'signal', sigIn:2, action:'color', color:'#ffee58' }, 0.86);
  demoLabel(cx - 60, gy - 375, '合図1', '#eceff1', 18);
  demoLabel(cx + 60, gy - 375, '合図2', '#eceff1', 18);
  demoTitlePinned('合図でつなぐ仕掛け');
  demoNotePinned(
    '▶実行 して見るだけ。\n'
  + '① 赤い球がボタンに当たると、ボタンが「合図1」を出す\n'
  + '② 合図1を受けて、離れた棚の扉が消え、ランプ1が点く\n'
  + '③ 青い球がカップに入ると、カップの底が「合図2」を出し、\n'
  + '　 ランプ2が点く\n'
  + '\n'
  + 'しくみ：プログラムの「すること」の〈合図を出す〉と、\n'
  + '「きっかけ」の〈合図を受けたら〉。番号が同じなら、\n'
  + '出す側・受ける側とも何個あってもよい。\n'
  + '合図は次のステップで届く。');
}

// ── 合図で折り返す台車 ───────────────────────────────────
//   ★リモコンを合図で入り切りする見本（remote.js の sigOn／sigOff の★）。人は何も押さない。
//     台車の2つの車輪のモーターを、リモコン2台（正転・逆転）がまとめて受け持つ：
//       正転 … 合図1で入る・合図2で切れる     逆転 … 合図2で入る・合図1で切れる
//     台車に付けたプログラムが、右の四角に入ったら合図2、左の四角に入ったら合図1 を出す。
//     始まりは〈1ステップごと・1回〉の合図1。
//   ★部品は四角形・円・モーター2つ・リモコン2台・プログラム3つだけ。
//   ★摩擦は既定のまま（車輪が地面をつかまないと走らない。遊びのデモ）。
const SG_SPAN = 340;                      // [px] 折り返す2つの四角の間隔
function demoSignalShuttle() {
  resetDemoWorld();
  updateGroundTerrain(true);
  ground.friction = 1; ground.frictionStatic = 1.2;
  setDemoCam(0, 0.8);
  const cx = cam.x + (760 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y, R = 16, ay = gy - R;
  // ★車体の下面は車輪の中心より 4px 下（軸の点を車体と車輪の両方に重ねる＝軸は画鋲。
  //   台車の上を走る車のデモの★）。以前は中心の 4px 上で、軸の点が車体の外だった（2026-10-02）
//   実測（30秒）：車体が 8px 下がって重心が低くなり、走り出しの前後の揺れが 5.7°→0.56° に減った。
//   往復の周期は 3.65→3.75 秒、巡航 0.963→0.953 m/s、往復の範囲は同じ（折り返しは合図の場所で決まる）。
  const body = new Body({ type:'box', x:cx, y:ay - 14, w:110, h:36, mass:10, layers:0b0010,
    fillColor:'#42a5f5', strokeColor:'#0d47a1', strokeWidth:1.5 });
  objects.push(body);
  const axles = [];
  for (const dx of [-38, 38]) {
    const w = new Body({ type:'circle', x:cx + dx, y:ay, radius:R, mass:1, layers:0b0001,
      friction:1, frictionStatic:1.2, fillColor:'#37474f', strokeColor:'#90a4ae', strokeWidth:1.5 });
    objects.push(w);
    //   ★打つのは手のツールと同じ入口（demo-kit.js の demoPin）。spin:w ＝車輪が車体に対して ＋に回る
    const j = demoPin('axle', cx + dx, ay, 'pair', { expect:[body, w], spin:w, motorSpeed:6, motorTorque:40 });
    axles.push(j);
  }
  // 両端の車止め（飾り兼、行き過ぎたときの止め）
  for (const x of [cx - SG_SPAN/2 - 80, cx + SG_SPAN/2 + 80])
    objects.push(new Body({ type:'box', isStatic:true, x, y:gy - 20, w:14, h:40,
      fillColor:'#ef5350', strokeColor:'#b71c1c', strokeWidth:1 }));
  // ── リモコン：2台とも両方の車輪を受け持つ ──
  const rm = (mode, on, off, fx) => {
    const r = addRemote('motor', axles[0], 'joint', axles.map(j => j.id));
    if (!r) return;
    Object.assign(r, { kind:'motor', mode, key: mode === 'on' ? 'ArrowRight' : 'ArrowLeft',
                       sigOn:on, sigOff:off, fx, fy:0.58 });
    placeRemotePanel(r); syncRemotePanel(r);
  };
  rm('on', 1, 2, 0.07); rm('rev', 2, 1, 0.26);
  // ── プログラム ──
  const prog = (o, fy) => {
    const p = addProgram(body);
    Object.assign(p, o, { collapsed:true, fx:0.45, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  };
  prog({ trigger:'step', step:1, times:1, action:'signal', sigOut:1 }, 0.80);
  prog({ trigger:'zone', zx:cx + SG_SPAN/2 + 30, zy:ay - 22, zw:60, zh:120, action:'signal', sigOut:2 }, 0.86);
  prog({ trigger:'zone', zx:cx - SG_SPAN/2 - 30, zy:ay - 22, zw:60, zh:120, action:'signal', sigOut:1 }, 0.92);
  demoTitlePinned('合図で折り返す台車');
  demoNotePinned(
    '▶実行 して見るだけ（キーは押さなくてよい）。\n'
  + '・台車が右の四角に入ると「合図2」、左の四角に入ると\n'
  + '　「合図1」を出す（台車に付けたプログラム）\n'
  + '・リモコン1（正転）は合図1で入り、合図2で切れる\n'
  + '・リモコン2（逆転）は合図2で入り、合図1で切れる\n'
  + '・リモコンは合図でもキーでも押せる。← → で割り込める');
}

// ── 数えて遅らせる仕掛け ─────────────────────────────────
//   ★プログラムの〈○回に1回〉と〈○秒後に〉の見本（program.js の every／delay の★）。
//     ① 跳ね続ける球が皿に当たるのを、皿のプログラムが数える（3回に1回・上限1回）
//     ② 3回目で合図1 → ランプはすぐ点く／扉は〈2秒後に〉消える
//     ③ 扉が消えると棚の球が転がり出す
//   ★球と皿は反発1・摩擦0（反発は積で合成されるので両方1）。跳ねる高さが変わらないので、
//     当たる間隔が一定になり「数えている」のが目で追える。
//   ★部品は板・球・円・プログラム3つだけ。
function demoCountDelay() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.9);
  const cx = cam.x + (770 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const hard = { restitution:1, friction:0, frictionStatic:0, strokeWidth:1.5 };
  const soft = { restitution:0.1, friction:0.5, frictionStatic:0.6, strokeWidth:1.5 };
  // ① 皿と跳ねる球
  const plate = new Body(Object.assign({ type:'box', isStatic:true, x:cx - 150, y:gy - 60, w:90, h:12,
    fillColor:'#ab47bc', strokeColor:'#6a1b9a' }, hard));
  objects.push(plate,
    new Body(Object.assign({ type:'box', isStatic:true, x:cx - 150, y:gy - 27, w:12, h:54,
      fillColor:'#546e7a', strokeColor:'#37474f' }, soft)));
  objects.push(new Body(Object.assign({ type:'circle', x:cx - 150, y:gy - 230, radius:14, mass:1,
    fillColor:'#ef5350', strokeColor:'#263238' }, hard)));
  // ② ランプと、棚・扉・球
  const lamp = new Body(Object.assign({ type:'circle', isStatic:true, x:cx - 20, y:gy - 330, radius:18,
    fillColor:'#455a64', strokeColor:'#90a4ae' }, soft));
  objects.push(lamp);
  const shelfY = gy - 180;
  objects.push(new Body(Object.assign({ type:'box', isStatic:true, x:cx + 150, y:shelfY + 5,
    w:180, h:10, angle:-6 * Math.PI / 180, fillColor:'#8d6e63', strokeColor:'#5d4037' }, soft)));
  const door = new Body(Object.assign({ type:'box', isStatic:true, x:cx + 58, y:shelfY - 13, w:8, h:40,
    fillColor:'#ffb74d', strokeColor:'#e65100' }, soft));
  objects.push(door);
  objects.push(new Body(Object.assign({ type:'circle', x:cx + 80, y:shelfY - 16, radius:14, mass:1,
    fillColor:'#42a5f5', strokeColor:'#263238' }, soft)));
  // ── プログラム ──
  const prog = (b, o, fy) => {
    const p = addProgram(b);
    Object.assign(p, o, { fx:0.07, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
    return p;
  };
  //   ★皿の窓の見出しに [1/3] と数えの進みが出る（このデモの読みどころ）
  prog(plate, { trigger:'hit', hitWhat:'body', every:3, times:1, action:'signal', sigOut:1, collapsed:true }, 0.62);
  prog(lamp,  { trigger:'signal', sigIn:1, action:'color', color:'#ffee58', collapsed:true }, 0.68);
  prog(door,  { trigger:'signal', sigIn:1, action:'delete', target:'self', delay:2, collapsed:true }, 0.74);
  demoLabel(cx - 45, gy - 75, '3回目で合図1', '#eceff1', 16);
  demoLabel(cx - 20, gy - 375, 'すぐ点く', '#eceff1', 16);
  demoLabel(cx + 60, shelfY - 60, '2秒後に消える', '#eceff1', 16);
  demoTitlePinned('数えて遅らせる仕掛け');
  demoNotePinned(
    '▶実行 して見るだけ。\n'
  + '① 赤い球が皿で跳ねるたびに、皿のプログラムが数える\n'
  + '② 3回目で「合図1」。ランプはすぐ点き、扉は2秒後に消える\n'
  + '③ 青い球が棚から転がり出す\n'
  + '\n'
  + 'しくみ：プログラムの〈○回に1回〉（皿：3回に1回・上限1回）と\n'
  + '〈○秒後に〉（扉：2秒後）。皿の窓の [1/3] が数えている途中。');
}

// ── 生成口と通過カウンタ ─────────────────────────────────
//   ★道具の見本：〈生成〉（生成口）・〈複製にも適用〉・〈生成口の設定変更を反映〉・通過カウンタ。
//     真上から見た図（重力0・摩擦0）。
//     ① 生成口：半径の中に自分の複製が居なくなったら1個出す（〈半径○m以内〉・数えるのは
//        〈自分の複製〉）＝間隔が速さによらず半径で決まる。止めれば出るのも止まる。
//     ② つまみで生成口の速さを変えると、出ている球が一斉にその速さにそろう（〈反映〉）。
//     ③ 真ん中を過ぎたら色が変わり（決めた場所に入ったら → 色）、右端で消える
//        （→ 削除）。どちらも生成口に付けたプログラムで、〈複製にも適用〉で出た球に効く。
//     ④ 通過カウンタが、線を横切った数と毎秒の個数を数える。
//   ★部品は円・プログラム3つ・リモコン1台（つまみ）・通過カウンタ1本。
const GS_LEN = 460;                       // [px] 流す長さ
const GS_V = 1.0;                         // [m/s] はじめの速さ
function demoSpawnerCounter() {
  resetDemoWorld();
  updateGroundTerrain(false);
  setDemoGravity(0);
  setDemoCam(0, 0.8);
  const cx = cam.x + (770 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const cy = cam.y - 60 / cam.zoom;
  const x0 = cx - GS_LEN / 2, x1 = cx + GS_LEN / 2;
  const gate = new Body({ type:'circle', x:x0, y:cy, radius:12, mass:0.2, isSpawner:true,
    restitution:1, friction:0, frictionStatic:0, fixedRotation:true,
    fillColor:'#42a5f5', strokeColor:'#ffffff', strokeWidth:1.5, label:'生成口' });
  gate.vx = GS_V * M2PX;           // ★出てくる球が持つ速度（生成口そのものは動かない）
  objects.push(gate);
  const prog = (o, fy) => {
    const p = addProgram(gate);
    Object.assign(p, o, { collapsed:true, fx:0.07, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  };
  prog({ trigger:'near', nearR:0.6, nearMin:0, nearMax:0, nearWhat:'kin',
         action:'create', scope:'copies', sync:true, limit:40 }, 0.74);
  prog({ trigger:'zone', zx:cx + GS_LEN / 4, zy:cy, zw:GS_LEN / 2, zh:80,
         action:'color', color:'#ffca28' }, 0.80);
  prog({ trigger:'zone', zx:x1 + 30, zy:cy, zw:60, zh:80, action:'delete', target:'self' }, 0.86);
  // つまみ：生成口の速度 X
  const k = addRemote('prop', gate);
  if (k) {
    k.kind = 'prop'; k.prop = 'vx'; k.lo = 0; k.hi = 3;
    k.fx = 0.07; k.fy = 0.50;
    placeRemotePanel(k); syncRemotePanel(k);
  }
  // 通過カウンタ（真ん中を縦に横切る線）
  const c = addCounter(cx, cy + 50, cx, cy - 50);   // ★下から上へ引く＝右向きに通ると +1
  if (c) { c.what = "bodies"; c.span = 30; c.collapsed = true; c.fx = 0.55; c.fy = 0.80; placeCounterPanel(c); syncCounterPanel(c); }
  demoLabel(x0, cy - 45, '生成口', '#eceff1', 16);
  demoTitlePinned('生成口と通過カウンタ');
  demoNotePinned(
    '▶実行 して、つまみを動かす。\n'
  + '① 生成口：前の球が 0.6 m 離れたら次を出す（間隔は速さによらない）\n'
  + '② つまみで生成口の速さを変えると、出ている球が一斉にそろう。\n'
  + '　 0 にすると全部止まり、出るのも止まる\n'
  + '③ 真ん中を過ぎると黄色に、右端で消える（生成口のプログラムが\n'
  + '　 出てきた球にも効く）\n'
  + '④ 通過カウンタが、線を通った数と毎秒の個数を数える');
}

// ── 衝突レイヤーでふるい分け ─────────────────────────────
//   ★道具の見本：衝突レイヤー。2つの物体は、レイヤーを**1つでも共有していれば**当たる。
//     上から4色の球を落とす（色ごとに生成口1つ・〈○ステップごと〉で生成）：
//       赤 {2}・青 {3}・緑 {2,3}・黄 {4}
//     上の坂 {3}：青と緑を受けて左の箱へ。赤と黄はすり抜ける。
//     下の坂 {2}：赤を受けて右の箱へ（緑は上で受け止められていて、ここへ来ない）。
//     黄はどちらの坂とも共有しないので、真ん中の箱へ落ちる。
//     箱と地面は全部のレイヤー {1,2,3,4}。
//   ★緑が「上の坂で止まる」のが読みどころ：{2,3} は下の坂とも共有するが、先に当たる上の坂と
//     共有しているので、そこで受け止められる。当たるかどうかは1組ずつの共有で決まる。
//   ★部品は板・円・プログラム4つだけ。
function demoLayerSieve() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.8);
  const cx = cam.x + (770 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const ALL = 0b1111;
  const soft = { restitution:0.1, friction:0.3, frictionStatic:0.4, strokeWidth:1.5 };
  const plank = (x0, y0, x1, y1, th, layers, col) => new Body(Object.assign({ type:'box', isStatic:true,
    x:(x0 + x1)/2, y:(y0 + y1)/2, w:Math.hypot(x1 - x0, y1 - y0), h:th,
    angle:Math.atan2(y1 - y0, x1 - x0), layers, fillColor:col, strokeColor:'#263238' }, soft));
  // 坂（上は左へ、下は右へ下がる）
  objects.push(plank(cx + 120, gy - 330, cx - 170, gy - 250, 10, 0b0100, '#42a5f5'));
  objects.push(plank(cx - 120, gy - 190, cx + 170, gy - 110, 10, 0b0010, '#ef5350'));
  // 箱（左・真ん中・右）。仕切りの高さ 50px。★外側の壁は高くする（坂を降りた勢いで飛び越す）
  for (const x of [cx - 130, cx - 60, cx + 60, cx + 130])
    objects.push(plank(x, gy - 50, x, gy, 8, ALL, '#78909c'));
  for (const x of [cx - 270, cx + 270])
    objects.push(plank(x, gy - 200, x, gy, 8, ALL, '#78909c'));
  //   ★真ん中の箱の底は少し傾ける。黄はまっすぐ同じ所へ落ちるので、平らだと縦一列に積み上がる
  objects.push(plank(cx - 56, gy - 18, cx + 56, gy - 4, 6, ALL, '#78909c'));
  // 生成口（4色）。出る間隔は色ごとにずらす。★置く場所：黄は真ん中の箱の真上。
  //   赤は右寄り＝上の坂を左へ転がる青・緑の通り道の外（赤 {2} と緑 {2,3} は当たる。
  //   通り道に落とすと緑にはじかれて左の箱へ入っていた）。
  const cols = [['緑', '#66bb6a', 0b0110, -45], ['青', '#42a5f5', 0b0100, -25], ['黄', '#ffee58', 0b1000, 0], ['赤', '#ef5350', 0b0010, 45]];
  cols.forEach(([nm, col, layers, dx], i) => {
    const g = new Body(Object.assign({ type:'circle', x:cx + dx, y:gy - 400, radius:9, mass:0.2,
      isSpawner:true, layers, fillColor:col, strokeColor:'#ffffff' }, soft));
    objects.push(g);
    const p = addProgram(g);
    Object.assign(p, { trigger:'step', step:80 + i * 7, action:'create', limit:8,
                       collapsed:true, fx:0.07, fy:0.62 + i * 0.06 });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  });
  const lab = (x, y, t) => demoLabel(x, y, t, '#eceff1', 15);
  lab(cx + 150, gy - 350, '上の坂 {3}');
  lab(cx - 150, gy - 100, '下の坂 {2}');
  lab(cx, gy - 440, '緑{2,3} 青{3} 黄{4} 赤{2}');
  lab(cx - 200, gy + 20, '青・緑'); lab(cx, gy + 20, '黄'); lab(cx + 200, gy + 20, '赤');
  demoTitlePinned('衝突レイヤーでふるい分け');
  demoNotePinned(
    '▶実行 して見るだけ。\n'
  + '・2つの物体は、衝突レイヤーを1つでも共有していれば当たる\n'
  + '・上の坂 {3} は青 {3} と緑 {2,3} を受けて左の箱へ\n'
  + '・下の坂 {2} は赤 {2} を受けて右の箱へ\n'
  + '・黄 {4} はどちらとも共有しないので、すり抜けて真ん中へ\n'
  + '・緑は下の坂とも共有するが、先に上の坂で受け止められる\n'
  + '\n'
  + 'レイヤーは右パネルの「衝突レイヤー」の4つのチェック');
}

// ── リモコンのいろいろ ───────────────────────────────────
//   ★道具の見本：リモコンの種類（remote.js の kind）。1つの画面に5種類を置く。
//     動力を効かせる（台車・← →）／すり抜けにする（門・G）／モーターを回す（風車・M）／
//     手で動かす（エレベーターの床・↑ ↓）／物理量を変える（跳ねる球の反発係数・つまみ）。
//   ★〈手で動かす〉だけは相手が固定した物体でも動く（人の手なので。remote.js の★）。
//     床に載った球は、床に押されて一緒に上がる。
//   ★摩擦は台車だけ 0（動力で押した分がそのまま進みに出る）。
//   ★跳ねる球と台の反発係数は 1 から始める（反発は積で合成＝台は 1 なので、つまみの値がそのまま効く）。
//   ★部品は四角形・円・モーター1つ・リモコン7台だけ。
function demoRemoteKinds() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.8);
  const cx = cam.x + (770 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const edge = { strokeColor:'#263238', strokeWidth:1.5 };
  const box = (o) => new Body(Object.assign({ type:'box' }, edge, o));
  // 台車の通り道：両端の止め
  objects.push(box({ isStatic:true, x:cx - 280, y:gy - 25, w:12, h:50, fillColor:'#78909c' }),
               box({ isStatic:true, x:cx + 280, y:gy - 25, w:12, h:50, fillColor:'#78909c' }));
  // ① 台車と動力（右向き1本。← は同じ動力を逆向きに効かせる）
  const cart = box({ x:cx - 230, y:gy - 16, w:60, h:30, mass:4, friction:0, frictionStatic:0,
    fillColor:'#42a5f5', label:'台車' });
  cart.thrusters.push(new Thruster({ force:8, dir:0 }, cart));
  // ② 門（すり抜けにする）
  const gate = box({ isStatic:true, x:cx - 110, y:gy - 35, w:14, h:70, fillColor:'#ffb74d', strokeColor:'#e65100', label:'門' });
  // ③ 風車（固定した柱にモーター）
  const post = box({ isStatic:true, x:cx - 150, y:gy - 190, w:10, h:130, layers:0b1000, fillColor:'#78909c' });
  const hub = { x:cx - 150, y:gy - 250 };
  const blades = demoUnion(
    box({ x:hub.x, y:hub.y, w:130, h:12, mass:1, fillColor:'#ab47bc' }),
    box({ x:hub.x, y:hub.y, w:12, h:130, mass:1, fillColor:'#ab47bc' }));
  blades.layers = 0b1000; blades.fillColor = '#ab47bc'; blades.strokeColor = '#4a148c'; blades.setMass(2);
  objects.splice(objects.indexOf(blades), 1);   // ★図形和は自分で入る（描く順だけ並べ直す）
  //   ★〈放したら止める〉（motorBrake）。入れないと、放したあとも風車が惰性で回り続けて
  //     「押している間だけ」が見えない（摩擦の無い軸は止まらない）。
  const mill = new Joint({ type:'axle', bodyA:post, bodyB:blades, motorSpeed:4, motorTorque:50, motorBrake:true });
  setJointEnd(mill, 'A', post, hub.x, hub.y, false); setJointEnd(mill, 'B', blades, hub.x, hub.y, false);
  // ④ エレベーターの床（固定した板を手で動かす）と、載った球
  const lift = box({ isStatic:true, x:cx + 180, y:gy - 60, w:80, h:10, fillColor:'#26a69a', strokeColor:'#00695c', label:'床' });
  const rider = new Body(Object.assign({ type:'circle', x:cx + 180, y:gy - 80, radius:14, mass:1,
    fillColor:'#ffca28' }, edge));
  // ⑤ 跳ねる球（つまみで反発係数）
  const plate = box({ isStatic:true, x:cx + 40, y:gy - 130, w:70, h:10, restitution:1, fillColor:'#78909c' });
  const bouncer = new Body(Object.assign({ type:'circle', x:cx + 40, y:gy - 330, radius:12, mass:0.5,
    restitution:1, friction:0, frictionStatic:0, fillColor:'#ef5350', label:'跳ねる球' }, edge));
  objects.push(cart, gate, post, blades, lift, rider, plate, bouncer);
  joints.push(mill);
  // ── リモコン ──
  const put = (r, o) => { if (!r) return; Object.assign(r, o, { collapsed:true }); placeRemotePanel(r); syncRemotePanel(r); };
  put(addRemote('thruster', cart.thrusters[0], 'thruster'), { kind:'thruster', mode:'on',  key:'ArrowRight', fx:0.03, fy:0.27 });
  put(addRemote('thruster', cart.thrusters[0], 'thruster'), { kind:'thruster', mode:'rev', key:'ArrowLeft',  fx:0.23, fy:0.27 });
  put(addRemote('ghost', gate, 'body'),   { kind:'ghost', key:'KeyG', fx:0.03, fy:0.42 });
  put(addRemote('motor', mill),           { kind:'motor', mode:'on', key:'KeyM', fx:0.23, fy:0.42 });
  put(addRemote('drive', lift),           { kind:'drive', speed:0.5, dir:90,  key:'ArrowUp',   fx:0.03, fy:0.57 });
  put(addRemote('drive', lift),           { kind:'drive', speed:0.5, dir:-90, key:'ArrowDown', fx:0.23, fy:0.57 });
  const k = addRemote('prop', bouncer);
  if (k) { k.kind = 'prop'; k.prop = 'restitution'; k.lo = 0; k.hi = 1; k.fx = 0.03; k.fy = 0.72;
           placeRemotePanel(k); syncRemotePanel(k); }
  const lab = (x, y, t) => demoLabel(x, y, t, '#eceff1', 15);
  lab(cx - 230, gy + 22, '① 台車 ← →');
  lab(cx - 110, gy - 90, '② 門 G');
  lab(cx - 150, gy - 335, '③ 風車 M');
  lab(cx + 180, gy - 150, '④ 床 ↑ ↓');
  lab(cx + 40, gy - 360, '⑤ 反発係数のつまみ');
  demoTitlePinned('リモコンのいろいろ');
  demoNotePinned(
    '▶実行 して、キーやつまみで動かす。\n'
  + '① 動力を効かせる … 押している間だけ台車を押す（← は逆向き）\n'
  + '② すり抜けにする … 押すたびに門が消える／戻る\n'
  + '③ モーターを回す … 押している間だけ風車が回る（放すと止まる）\n'
  + '④ 手で動かす … 固定した床でも動く。載った球も一緒に上がる\n'
  + '⑤ 物理量を変える … つまみで跳ねる球の反発係数を変える');
}

// ════════════════════════════════════════
//  回路の仕掛け（押しボタン・電磁石・リレー・モーター端子の見本）
// ════════════════════════════════════════
//  ★回路の素子のうち「力学とつながる」5つ（circuit.js の CIRCUIT_DEFAULTS の後半）は、
//    電磁気の単元のデモに1つも出てこなかった。ここでは教科書の題材ではなく
//    「これで何が作れるか」を見せる。部品はどれも左ツールバーの回路ツールから置ける。

// ── 発電機とモーター（手回し発電機を2台つなぐ）─────────────────
//   ★モーター端子は τ = kI と E = kω を同じ k で結んでいる（circuit.js の applyMotorTorques）。
//     外から回せば発電機、電流を流せばモーター＝同じ部品が2役をこなす。2台を導線でつなぎ、
//     片方を回すともう片方が回る、を見せる（理科の手回し発電機の定番の実験）。
//   ★車輪の軸は背景に留めたモーター（axle）で、「回路で駆動 ch」だけを入れる。
//     ch を入れた軸はリモコンのモーターでは回らない（joint.js の motorIsSolving）ので、
//     左の車輪は縁に付けた動力で回す（接線向きに押す＝トルク）。
function demoMotorGenerator() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.9);
  const cx = cam.x + (770 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const edge = { strokeColor:'#263238', strokeWidth:1.5 };
  const R = 60, wy = gy - 300, dx = 160;
  const wheel = (x, col) => new Body(Object.assign({ type:'circle', x, y:wy, radius:R, mass:MG_M,
    layers:0b1000, fillColor:col }, edge));
  const A = wheel(cx - dx, '#ffb74d'), B = wheel(cx + dx, '#4fc3f7');
  A.label = '発電機'; B.label = 'モーター';
  A.thrusters.push(new Thruster({ force:MG_F, dir:0, localX:0, localY:-R }, A));
  objects.push(A, B);
  const axle = (b, ch) => {
    const j = new Joint({ type:'axle', bodyA:null, bodyB:b, motorCh:ch });
    setJointEnd(j, 'A', null, b.x, b.y, false); setJointEnd(j, 'B', b, b.x, b.y, false);
    joints.push(j);
  };
  axle(A, 1); axle(B, 2);
  const add = (type, ax, ay, bx, by, o) => {
    const e = new CircuitElement(type, ax, ay, bx, by);
    Object.assign(e, o || {});
    circuitElements.push(e);
    return e;
  };
  const yT = wy + R + 40, yB = yT + 110, xL = cx - dx, xR = cx + dx;
  add('motor', xL, yT, xL, yB, { ch:1, k:MG_K, R:MG_R });
  add('motor', xR, yT, xR, yB, { ch:2, k:MG_K, R:MG_R });
  add('wire', xL, yT, xR, yT);
  add('wire', xL, yB, cx - 40, yB);
  add('bulb', cx - 40, yB, cx + 40, yB, { Vr:MG_BULB_V, Pr:MG_BULB_P });
  add('wire', cx + 40, yB, xR, yB);
  const put = (r, o) => { if (!r) return; Object.assign(r, o, { collapsed:true }); placeRemotePanel(r); syncRemotePanel(r); };
  put(addRemote('thruster', A.thrusters[0], 'thruster'), { kind:'thruster', mode:'on',  key:'ArrowRight', fx:0.03, fy:0.55 });
  put(addRemote('thruster', A.thrusters[0], 'thruster'), { kind:'thruster', mode:'rev', key:'ArrowLeft',  fx:0.23, fy:0.55 });
  const lab = (x, y, t) => demoLabel(x, y, t, '#eceff1', 16);
  lab(cx - dx - 45, wy - R - 45, '発電機 → ←');
  lab(cx + dx - 35, wy - R - 45, 'モーター');
  demoTitlePinned('発電機とモーター');
  demoNotePinned(
    '▶実行 して、→ で左の車輪を回す（← は逆向き）。\n'
  + '① 左の車輪が回ると、モーター端子 M1 に起電力 E = kω\n'
  + '　 が生じ、導線に電流が流れる（発電機）\n'
  + '② 同じ電流が M2 にトルク τ = kI を生み、右の車輪が回る\n'
  + '③ 右が追いつくと両方の起電力が打ち消し合い、電流は\n'
  + '　 ほぼ 0 になる（豆電球が消える）\n'
  + '④ 「つかむ」で右の車輪を押さえると、電流が流れて\n'
  + '　 豆電球が点き、左の車輪は重くなって止まる\n'
  + '\n'
  + '2つは同じ部品（モーター端子）。回されれば発電機、\n'
  + '電流を流されればモーターになる。軸に摩擦は無いので、\n'
  + '放しても回り続ける。');
}
// ★数値の決め方（実測。→ を2秒押して放す）：
//   k = 1 N·m/A・端子の抵抗 0.5Ω・豆電球 2.5V 2.5W … 右の車輪は約1秒遅れて左に追いつき
//     （2秒後に 左 5.8・右 3.1 rad/s、5秒後に 左右とも 4.44）、電流は 0 へ落ちる。豆電球は加速中だけ
//     点く（最高 2362K）。右を止めると左は約3秒で止まり、その間だけ明るく点く（2644K）。
//   k = 1.5・2Ω・豆電球 6V 3W だと追いつくまでの時定数が 3秒を超え、→ を押している間は
//     ほとんど動かず、豆電球が切れた（融点 3695K）。時定数は（右の慣性モーメント）×（回路の
//     抵抗）/ k² なので、k を上げるか抵抗を下げると早く追いつく。
//   動力 4N（縁の半径 0.6m でトルク 2.4N·m）は、押している2秒で 6rad/s に届く強さ。
const MG_M = 3, MG_F = 4, MG_K = 1, MG_R = 0.5, MG_BULB_V = 2.5, MG_BULB_P = 2.5;

// ── 自己保持回路で走る台車（押しボタン・リレー・モーター端子）────────
//   ★リレーの定番「自己保持」。START（押すと入）を一瞬踏むとコイル R1 に電流が流れ、
//     R1 の接点がそろって動く。そのうち1つ（R1a）が START と並列なので、球が離れても
//     コイルは自分の接点で電流を流し続ける。STOP（押すと切）を踏むと電流が切れて戻る。
//   ★どちらのボタンも「物体が点線の円にかかったら」押される（updatePushSwitches）。
//     START は棚を転がる球が、STOP は台車自身が踏む＝原因がどれも画面の中にある。
//   ★＋と−のあいだの段：モーター（R1a）・運転中のランプ（R1a）・停止中のランプ（R1b）と、
//     モーターを短絡する発電ブレーキ（R1b）。b接点（ふだん閉じている）の使い道を2つ見せる。
//   ★H のスイッチは自己保持の線に直列（リモコンの〈すり抜け〉＝回路のスイッチの切替）。
//   ★モーターは 6V・k 1.2・2Ω。空回りの速さ 6/1.2 = 5rad/s ＝ 車輪の半径 0.16m で
//     0.8m/s（実測 0.78m/s）。START から STOP まで約3秒。
function demoRelayLatch() {
  resetDemoWorld();
  updateGroundTerrain(true);
  ground.friction = 1; ground.frictionStatic = 1.2;   // 車輪が地面をつかむ
  setDemoCam(0, 0.72);
  const cx = cam.x + (804 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const edge = { strokeColor:'#263238', strokeWidth:1.5 };
  const box = (o) => new Body(Object.assign({ type:'box' }, edge, o));
  const add = (type, ax, ay, bx, by, o) => {
    const e = new CircuitElement(type, ax, ay, bx, by);
    Object.assign(e, o || {});
    circuitElements.push(e);
    return e;
  };
  const xL = cx - 230, xR = cx + 190, T = gy - 430, ys = gy - 260, yM = gy - 130;
  // ── 台車（後ろの車輪がモーター）──
  const Rw = 16, cartX = cx - 60, ay = gy - Rw;
  // ★車体の下面は車輪の中心より 4px 下（軸・ヒンジは画鋲。合図で折り返す台車の★）。以前は
  //   中心の 9px 上で、留め点が車体の外だった（2026-10-02）
  const cart = box({ x:cartX, y:ay - 11, w:90, h:30, mass:3, layers:0b0010, fillColor:'#42a5f5', label:'台車' });
  objects.push(cart);
  for (const [k, dx] of [[0, -32], [1, 32]]) {
    const w = new Body(Object.assign({ type:'circle', x:cartX + dx, y:ay, radius:Rw, mass:0.5, layers:0b0001,
      friction:1, frictionStatic:1.2, fillColor:'#37474f' }, edge));
    objects.push(w);
    //   ★打つのは手のツールと同じ入口（demoPin）。spin:w ＝回路のモーターが車輪を車体に対して ＋に回す
    demoPin(k === 0 ? 'axle' : 'hinge', cartX + dx, ay, 'pair',
            { expect:[cart, w], spin:w, opts: k === 0 ? { motorCh:1 } : {} });
  }
  objects.push(box({ isStatic:true, x:xR + 45, y:gy - 30, w:14, h:60, fillColor:'#78909c' }));   // 車止め
  // ── 球と棚（左へ下る棚を転がって START を踏み、左端からカップへ落ちる）──
  const sx0 = xL - 60, sx1 = xL + 150;                  // 棚の左端・右端
  const shelfTop = ys + RL_BALL_R;
  objects.push(box({ isStatic:true, x:(sx0 + sx1) / 2, y:shelfTop + 6, w:sx1 - sx0, h:12,
    angle:-RL_SLOPE, fillColor:'#8d6e63', strokeColor:'#5d4037' }));
  objects.push(new Body(Object.assign({ type:'circle', x:sx1 - 20, y:ys - 16, radius:RL_BALL_R, mass:1,
    restitution:0.1, fillColor:'#ef5350' }, edge)));
  //   ★棚の左端の先に背の高い壁。球は壁に当たって真下のカップへ落ちる
  //     （壁が無いと、棚を下りた勢いのまま 2m 先まで飛んでカップを越えた）
  const kx = sx0 - 22, kTop = shelfTop - 40;           // カップ
  const cupC = { fillColor:'#26a69a', strokeColor:'#00695c' };
  objects.push(box({ isStatic:true, x:kx, y:gy - 4, w:60, h:8, ...cupC }),
               box({ isStatic:true, x:kx - 34, y:(kTop + gy) / 2, w:8, h:gy - kTop, ...cupC }),
               box({ isStatic:true, x:kx + 34, y:gy - 20, w:8, h:40, ...cupC }));
  // ── 回路 ──
  add('dcsource', cx - 40, T, cx + 40, T, { V:RL_V });
  add('wire', cx - 40, T, xL, T);                       // ＋側
  add('wire', xL, T, xL, ys - 60);
  add('relayswitch', xL, ys - 60, xL + 60, ys - 60, { ch:1 });     // 自己保持の接点
  add('wire', xL, ys - 60, xL, ys);
  add('pushswitch', xL, ys, xL + 60, ys, { br:RL_BTN_R });         // START
  const hold = add('switch', xL + 60, ys - 60, xL + 60, ys, { closed:true });   // 自己保持を外すスイッチ
  add('wire', xL + 60, ys, xL + 60, yM);
  add('wire', xL + 60, yM, xR - 20, yM);
  add('wire', xR - 20, yM, xR - 20, gy - 40);
  add('pushswitch', xR - 20, gy - 40, xR + 20, gy - 40, { nc:true, br:RL_BTN_R });   // STOP
  add('wire', xR + 20, gy - 40, xR + 20, T + 80);
  add('relay', xR + 20, T + 80, xR + 20, T + 20, { ch:1 });
  add('wire', xR + 20, T + 20, xR + 20, T);
  add('wire', xR + 20, T, cx + 40, T);                  // −側
  // ＋と−のあいだの3段：モーター（a接点）・運転中のランプ（a接点）・停止中のランプ（b接点）
  //   ★段は下の段（y0）から y へ積む。ランプの段どうしは 85px 空ける（記号の札が重なるため）
  const rung = (y0, y, nc, load, o) => {
    add('wire', xL, y0, xL, y);
    add('relayswitch', xL, y, xL + 80, y, { ch:1, nc });
    add(load, xL + 80, y, xL + 200, y, o);
    add('wire', xL + 200, y, xR + 20, y);
    add('wire', xR + 20, y, xR + 20, y0);
  };
  const yMo = T - 70, yRun = T - 170, yStop = T - 255;
  rung(T, yMo, false, 'motor', { ch:1, k:RL_K, R:RL_MR });
  // ★発電ブレーキ：R1 が切れるとb接点がモーターの両端をつなぐ。軸に摩擦が無いので、
  //   これが無いと電流が切れても台車は惰性で最後まで走り、自己保持の有無が見分けられない
  //   （実測：自己保持を外すと、ブレーキ無しでは STOP まで 2m 惰性で走り切った。
  //     ブレーキありなら START を踏んでいた間の 0.44m で止まる）
  add('wire', xL + 80, yMo, xL + 80, yMo - 40);
  add('relayswitch', xL + 80, yMo - 40, xL + 200, yMo - 40, { ch:1, nc:true });
  add('wire', xL + 200, yMo - 40, xL + 200, yMo);
  rung(yMo, yRun, false, 'bulb', { Vr:RL_V, Pr:1 });
  rung(yRun, yStop, true, 'bulb', { Vr:RL_V, Pr:1 });
  const lab = (x, y, t) => demoLabel(x, y, t, '#eceff1', 15);
  lab(xL + 215, yStop - 28, '停止中');
  lab(xL + 215, yRun - 28, '運転中');
  lab(xL + 215, yMo - 28, 'モーター');
  lab(xL + 215, yMo - 58, 'ブレーキ');
  lab(xR - 45, T + 40, 'リレー');
  lab(xL - 150, ys - 75, '自己保持 R1a');
  lab(xL - 75, ys - 20, 'START');
  lab(xR - 30, yM - 30, 'STOP');
  lab(xL + 72, ys - 38, 'H');
  const r = addRemote('ghost', hold, 'circuit');
  if (r) { Object.assign(r, { kind:'ghost', key:'KeyH', collapsed:true, fx:0.03, fy:0.60 });
           placeRemotePanel(r); syncRemotePanel(r); }
  demoTitlePinned('自己保持回路で走る台車');
  demoNotePinned(
    '▶実行 して見るだけ。\n'
  + '① 球が START のボタンを一瞬だけ踏む\n'
  + '② リレーのコイル R1 に電流が流れ、R1 の接点（R1a）が\n'
  + '　 全部閉じる → モーターが回り、「運転中」が点く\n'
  + '③ 球はすぐ離れるが、R1a の1つが START と並んで\n'
  + '　 コイルの電流を流し続ける（自己保持）\n'
  + '④ 台車が STOP（押すと切れるボタン）を踏むと\n'
  + '　 コイルの電流が切れ、全部の接点がもとに戻る\n'
  + '\n'
  + 'H で自己保持の線を切ってから↩で最初に戻すと、\n'
  + '台車はボタンを踏んでいる間しか動かない。\n'
  + '「停止中」はふだん閉じている接点（R1b）で点く。');
}
const RL_BALL_R = 14, RL_SLOPE = 0.08, RL_V = 6, RL_K = 1.2, RL_MR = 2, RL_BTN_R = 16;

// ── 電磁石でふり分ける（真上から見た図）──────────────────────
//   ★電磁石は点線の円の中に一様な磁場 B = μrμ₀NI/(2a) を置く（circuit.js の electromagnetBzAt）。
//     荷電物体は矩形の磁場ツールと同じくローレンツ力で曲がる。電源の電圧をつまみで回すと
//     電流 → 磁場 → 曲がり方、が順につながる。電磁石の自己インダクタンス（約4H・5.5Ω で
//     時定数 0.7秒）のぶん、つまみから少し遅れる。
//   ★電磁石の素子は円の中心に置く（円は素子の中点が中心）。球は記号の上を通る。
//   ★球どうしのクーロン力は切る（全体設定の「クーロン力」）。実測（3V、中心から右 1.5m を
//     通るときの中心線からのずれ、700 tick）：切ると 14個が 77±4px。入れると押し合いで列が
//     詰まって6個しか出ず、ずれも 99±34px とばらけて、箱に入れ分けられない。
//   ★電荷の決め方（実測。600 tick 回して右の箱に着いた球の、中心線からのずれ）：
//     0.1C では 1V（0.46T）で下の箱、2V で箱を飛び越えて画面の外へ。
//     0.03C なら 0〜1V（〜0.46T）がまっすぐの箱、2V（0.91T）から横の箱、4V（1.83T）でも
//     箱の中（ずれ 190〜226px、箱の外壁は 240px）。飽和の 2T はつまみの端 4V の少し先。
function demoElectromagnetSorter() {
  resetDemoWorld();
  updateGroundTerrain(false);
  setDemoGravity(0);
  world.coulombOn = false;
  setDemoCam(0, 0.68);
  const cx = cam.x + (770 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const cy = cam.y - 40 / cam.zoom;
  const xc = cx - 110;                                  // 電磁石の中心
  const edge = { strokeColor:'#263238', strokeWidth:1.5 };
  const wall = (x, y, w, h) => new Body(Object.assign({ type:'box', isStatic:true, x, y, w, h,
    restitution:0, friction:0, frictionStatic:0, fillColor:'#78909c' }, edge));
  const add = (type, ax, ay, bx, by, o) => {
    const e = new CircuitElement(type, ax, ay, bx, by);
    Object.assign(e, o || {});
    circuitElements.push(e);
    return e;
  };
  // ── 生成口（正の電荷の球を右へ）──
  const gate = new Body(Object.assign({ type:'circle', x:xc - ES2_FR - 60, y:cy, radius:10, mass:ES2_M,
    charge:ES2_Q, isSpawner:true, restitution:0, friction:0, frictionStatic:0, fixedRotation:true,
    fillColor:'#ef5350', label:'生成口' }, edge));
  gate.vx = ES2_V * M2PX;
  objects.push(gate);
  const p = addProgram(gate);
  Object.assign(p, { trigger:'near', nearR:0.6, nearMin:0, nearMax:0, nearWhat:'kin',
    action:'create', scope:'copies', limit:ES2_LIMIT, collapsed:true, fx:0.07, fy:0.86 });
  p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  // ── 電磁石と電源 ──
  const src = add('dcsource', xc - 60, cy + 200, xc + 60, cy + 200, { V:ES2_V0 });   // ★最初から下の箱へ曲げておく（0V だと開いた画面で何も起きていない）
  add('electromagnet', xc - 30, cy, xc + 30, cy, { fr:ES2_FR });
  add('wire', xc - 30, cy, xc - 30, cy + 140); add('wire', xc - 30, cy + 140, xc - 60, cy + 140);
  add('wire', xc - 60, cy + 140, xc - 60, cy + 200);
  add('wire', xc + 30, cy, xc + 30, cy + 140); add('wire', xc + 30, cy + 140, xc + 60, cy + 140);
  add('wire', xc + 60, cy + 140, xc + 60, cy + 200);
  // ── 受け箱（上・まっすぐ・下の3つ）──
  const x0 = xc + ES2_BOX_X0, x1 = xc + ES2_BOX_X1;
  objects.push(wall((x0 + x1) / 2, cy - ES2_SEP, x1 - x0, 8), wall((x0 + x1) / 2, cy + ES2_SEP, x1 - x0, 8),
               wall((x0 + x1) / 2, cy - ES2_OUT, x1 - x0, 8), wall((x0 + x1) / 2, cy + ES2_OUT, x1 - x0, 8),
               wall(x1 + 4, cy, 8, 2 * ES2_OUT + 8));
  const k = addRemote('prop', src, 'circuit');
  if (k) { Object.assign(k, { kind:'prop', prop:'V', lo:-ES2_VMAX, hi:ES2_VMAX, fx:0.07, fy:0.70 });
           placeRemotePanel(k); syncRemotePanel(k); }
  demoTitlePinned('電磁石でふり分ける');
  demoNotePinned(
    '▶実行 して、つまみで電源の電圧を変える（真上から見た図）。\n'
  + '・生成口から、正の電荷をもつ球が右へ流れてくる\n'
  + '・電磁石に電流が流れると点線の円の中に磁場ができ、\n'
  + '　球はローレンツ力で曲がる（速さは変わらない）\n'
  + '・電圧を上げるほど強く曲がる。3つの箱に入れ分けよう。\n'
  + '　電圧を負にすると逆向きに曲がる\n'
  + '・電磁石はコイルなので電流はすぐには増えない。\n'
  + '　つまみを回してから少し遅れて曲がり方が変わる');
}
const ES2_FR = 120, ES2_M = 0.2, ES2_Q = 0.03, ES2_V = 1, ES2_LIMIT = 40, ES2_VMAX = 4, ES2_V0 = 2.5;
const ES2_BOX_X0 = 220, ES2_BOX_X1 = 420, ES2_SEP = 50, ES2_OUT = 240;

// ── リレーで作る論理回路（AND・OR・NOT・XOR）─────────────────────
//   ★入力は2つ。キーを押している間だけレバーが上がって押しボタンを押す。ボタンの回路は
//     リレーのコイル（A は R1、B は R2）を動かすだけで、ランプの回路とは電源から別。
//     2つの回路をつないでいるのは「同じ番号の接点が一斉に動く」ことだけ＝リレーの本分。
//   ★上のはしご（＋の縦線と−の縦線のあいだの段）で、接点のつなぎ方がそのまま論理になる：
//     AND … a接点を直列（R1a・R2a）       OR … a接点を並列
//     NOT … b接点（電流が流れると開く）    XOR … (R1a・R2b) と (R1b・R2a) を並列
//     1つのコイルが何個の接点でも動かせるので、A と B の信号を4つの段で使い回せる。
//   ★レバーは背景に留めたモーター（axle）の右端を支点にした板。可動域（angleLimit）で
//     下 −25°〜上 +15° に収める。キーを押す間だけリモコンのモーターで持ち上げ、放すと
//     自分の重さで落ちる（〈放したら止める〉は入れない）。止め具の物体は要らない。
//     押しボタンの円は、上がりきったレバーの先から 15px 内側の位置に置く
//     （下がっているときは 70px 以上離れる＝押されない）。
function demoRelayLogic() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.8);
  const cx = cam.x + (780 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const edge = { strokeColor:'#263238', strokeWidth:1.5 };
  const add = (type, ax, ay, bx, by, o) => {
    const e = new CircuitElement(type, ax, ay, bx, by);
    Object.assign(e, o || {});
    circuitElements.push(e);
    return e;
  };
  const lab = (x, y, t, c, s) => demoLabel(x, y, t, c || '#eceff1', s || 15);
  const put = (r, o) => { if (!r) return; Object.assign(r, o, { collapsed:true }); placeRemotePanel(r); syncRemotePanel(r); };

  // ── 入力：レバー＋押しボタン＋リレーのコイル（1つの入力に1つの回路）──
  const input = (mx, ch, key, name, fx) => {
    const py = gy - RLG_PIVOT_H, px = mx + RLG_BTN_R * Math.cos(RLG_UP) + 6;   // 支点
    const my = py - RLG_BTN_R * Math.sin(RLG_UP);                             // ボタンの中心
    const lever = new Body(Object.assign({ type:'box', x:px - 6 - RLG_LEVER / 2 + 6, y:py, w:RLG_LEVER, h:12,
      mass:RLG_LEVER_M, fillColor:'#ffb74d', label:'レバー' + name }, edge));
    objects.push(lever);
    const j = new Joint({ type:'axle', bodyA:null, bodyB:lever, motorSpeed:RLG_W, motorTorque:RLG_T,
      angleLimit:true, angleLo:-RLG_DOWN, angleHi:RLG_UP });
    setJointEnd(j, 'A', null, px - 6, py, false); setJointEnd(j, 'B', lever, px - 6, py, false);
    joints.push(j);
    put(addRemote('motor', j), { kind:'motor', mode:'on', key, fx, fy:0.84 });
    add('pushswitch', mx - 30, my, mx + 30, my, { br:16 });
    add('wire', mx - 30, my, mx - 90, my);
    add('wire', mx - 90, my, mx - 90, my - 90);
    add('dcsource', mx - 90, my - 90, mx - 10, my - 90, { V:RLG_V });
    add('relay', mx - 10, my - 90, mx + 70, my - 90, { ch });
    add('wire', mx + 70, my - 90, mx + 70, my);
    add('wire', mx + 70, my, mx + 30, my);
    lab(mx - 60, my - 122, '入力' + name + '（' + name + ' キー）→ R' + ch, '#ffcc80', 16);
  };
  input(cx - 170, 1, 'KeyA', 'A', 0.03);
  input(cx + 70, 2, 'KeyB', 'B', 0.23);

  // ── 出力：はしご（左の縦線が＋、右の縦線が−）──
  const x0 = cx - 190, x1 = cx + 190, T = gy - 625;
  const yAnd = T + 60, yOr = T + 140, yNot = T + 250, yXor = T + 330, dy = 40;
  add('wire', x0, T, cx - 40, T);
  add('dcsource', cx - 40, T, cx + 40, T, { V:RLG_V });
  add('wire', cx + 40, T, x1, T);
  const rail = (x, ys) => { for (let i = 1; i < ys.length; i++) add('wire', x, ys[i - 1], x, ys[i]); };
  rail(x0, [T, yAnd, yOr, yOr + dy, yNot, yXor, yXor + dy]);
  rail(x1, [T, yAnd, yOr, yNot, yXor]);
  // 接点を左から並べる。[ch, nc] の組。並べ終わりは x0 + 160
  const contacts = (y, list) => {
    let x = x0;
    for (const [ch, nc] of list) { add('relayswitch', x, y, x + 80, y, { ch, nc }); x += 80; }
    if (x < x0 + 160) add('wire', x, y, x0 + 160, y);
  };
  const tail = (y, name) => {
    add('wire', x0 + 160, y, x1 - 110, y);
    add('bulb', x1 - 110, y, x1 - 30, y, { Vr:RLG_V, Pr:1 });
    add('wire', x1 - 30, y, x1, y);
    lab(x0 + 175, y - 30, name);
  };
  const branch = (y) => add('wire', x0 + 160, y + dy, x0 + 160, y);   // 下の枝を上の段へ合流
  contacts(yAnd, [[1, false], [2, false]]);            tail(yAnd, 'AND：A かつ B');
  contacts(yOr, [[1, false]]); contacts(yOr + dy, [[2, false]]); branch(yOr);
  tail(yOr, 'OR：A または B');
  contacts(yNot, [[1, true]]);                         tail(yNot, 'NOT：A でない');
  contacts(yXor, [[1, false], [2, true]]); contacts(yXor + dy, [[1, true], [2, false]]); branch(yXor);
  tail(yXor, 'XOR：どちらか一方だけ');

  demoTitlePinned('リレーで作る論理回路');
  demoNotePinned(
    '▶実行 して、A キー・B キーを押す（押している間だけ入る）。\n'
  + '・キーを押すとレバーが上がり、押しボタンを押す\n'
  + '・ボタンの回路がリレーのコイルに電流を流す\n'
  + '　（A は R1、B は R2）\n'
  + '・すると上の回路の、同じ番号の接点が一斉に動く。\n'
  + '　a接点（R1a など）… 電流が流れると閉じる\n'
  + '　b接点（R1b など）… 電流が流れると開く\n'
  + '・接点を直列にすると AND、並列にすると OR、\n'
  + '　b接点を使うと NOT。組み合わせると XOR も作れる\n'
  + '\n'
  + 'A・B を両方押す、片方だけ押す、を試して\n'
  + 'どのランプが点くか見比べよう。');
}
const RLG_V = 6;                    // [V] どちらの回路も
const RLG_LEVER = 132, RLG_LEVER_M = 0.5;   // [px]・[kg] レバー
const RLG_BTN_R = 105;              // [px] 支点からボタンの中心まで（レバーの先は 126px）
const RLG_UP = 15 * Math.PI / 180, RLG_DOWN = 25 * Math.PI / 180;   // 可動域
const RLG_PIVOT_H = 60;             // [px] 支点の高さ
const RLG_W = 4, RLG_T = 20;        // [rad/s]・[N·m] レバーを上げるモーター


// ── 回路と合図をつなぐ（AND がそろったら球を出す）──────────────────
//   ★回路 → 合図 → 回路 の橋の見本（2026-09-30）。論理は回路が受け持ち、合図は「つなぐ」だけ：
//     ① 床の押しボタン A・B を直列につないだ回路＝AND。両方が踏まれたときだけ AND ランプが点く
//     ② AND ランプにつないだプログラム〈電流が○〜○Aになったら → 合図1〉（回路 → 合図）
//     ③ 合図1で、上の生成口が球を1個出す
//     ④ 球がカップに入ると、カップの底が合図2を出す
//     ⑤ 合図2で、リモコンが右の回路のスイッチを入れ、ゴールのランプが点く（合図 → 回路）
//   ★始めは A だけが踏まれている（箱が落ちて乗る）。B の球は坂を転がって少し遅れて着く。
//     A だけの間は何も起きない＝AND であることが、走らせるだけで見える。
//     箱や球を Space でつかんでどけ、また乗せると、そろうたびに1個出る。
//   ★B の止め具は左側。球は左へ転がってきて止め具に当たり、回転がそのまま止め具へ
//     押しつける向きなので、跳ね返ってボタンから離れない。
function demoCircuitSignalAnd() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.6);
  const cx = cam.x + (730 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const edge = { strokeColor:'#263238', strokeWidth:1.5 };
  const soft = { restitution:0.1, friction:0.5, frictionStatic:0.6 };
  const box = (o) => new Body(Object.assign({ type:'box' }, edge, soft, o));
  const add = (type, ax, ay, bx, by, o) => {
    const e = new CircuitElement(type, ax, ay, bx, by);
    Object.assign(e, o || {});
    circuitElements.push(e);
    return e;
  };
  const lab = (x, y, t, c, s) => demoLabel(x, y, t, c || '#eceff1', s || 15);
  const prog = (t, elem, o, fy) => {
    const p = addProgram(t, elem);
    Object.assign(p, o, { collapsed:true, fx:0.07, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
    return p;
  };
  // ── ① 押しボタン A・B（床の上）と AND の回路 ──
  const xA = cx - 400, xB = cx - 230, yb = gy - 10, T = gy - 250;
  add('pushswitch', xA - 30, yb, xA + 30, yb, { br:CSA_BTN_R });
  add('wire', xA + 30, yb, xB - 30, yb);
  add('pushswitch', xB - 30, yb, xB + 30, yb, { br:CSA_BTN_R });
  add('wire', xB + 30, yb, xB + 30, T);
  const andLamp = add('bulb', xB + 30, T, xB - 60, T, { Vr:CSA_V, Pr:1 });
  add('wire', xB - 60, T, xA + 50, T);
  add('dcsource', xA + 50, T, xA - 30, T, { V:CSA_V });
  add('wire', xA - 30, T, xA - 30, yb);
  // 箱 A：ボタン A の真上から落ちて乗る
  objects.push(box({ x:xA, y:gy - 120, w:56, h:40, mass:1, fillColor:'#ffb74d', label:'箱A' }));
  // 球 B：右の坂を転がってきて、止め具の手前（ボタン B の上）で止まる
  objects.push(box({ isStatic:true, x:xB - 40, y:gy - 15, w:8, h:30, fillColor:'#78909c' }));   // 止め具
  const r0x = xB + 80, r1x = xB + 270, r1y = gy - 150;
  objects.push(box({ isStatic:true, x:(r0x + r1x) / 2, y:(gy + r1y) / 2, w:Math.hypot(r1x - r0x, gy - r1y), h:10,
    angle:Math.atan2(r1y - gy, r1x - r0x), fillColor:'#8d6e63', strokeColor:'#5d4037' }));
  objects.push(new Body(Object.assign({ type:'circle', x:r1x - 20, y:r1y - 30, radius:CSA_BALL_R, mass:1,
    fillColor:'#42a5f5', label:'球B' }, edge, soft)));
  // ── ②③ AND ランプ → 合図1 → 生成口 ──
  prog(andLamp, true, { trigger:'current', curMin:0.02, curMax:1e6, action:'signal', sigOut:1 }, 0.62);
  const sx = cx + 20, sy = gy - 420;
  const gate = new Body(Object.assign({ type:'circle', x:sx, y:sy, radius:CSA_BALL_R, mass:1, isSpawner:true,
    fillColor:'#ef5350', label:'生成口' }, edge, soft, { strokeColor:'#ffffff' }));
  objects.push(gate);
  prog(gate, false, { trigger:'signal', sigIn:1, action:'create', limit:20 }, 0.68);
  // 生成口の下の坂（右へ下る）→ カップ
  const k0x = sx - 40, k1x = sx + 220, k0y = sy + 120, k1y = gy - 90;
  objects.push(box({ isStatic:true, x:(k0x + k1x) / 2, y:(k0y + k1y) / 2, w:Math.hypot(k1x - k0x, k1y - k0y), h:10,
    angle:Math.atan2(k1y - k0y, k1x - k0x), fillColor:'#8d6e63', strokeColor:'#5d4037' }));
  // ── ④ カップ（坂の下）──
  const kx = k1x + 55;
  const cupC = { fillColor:'#26a69a', strokeColor:'#00695c' };
  const cupFloor = box({ isStatic:true, x:kx, y:gy - 4, w:70, h:8, ...cupC });
  objects.push(cupFloor,
    box({ isStatic:true, x:kx + 39, y:gy - 60, w:8, h:120, ...cupC }),   // ★右は高い壁（坂を下りた勢いで越えないように）
    box({ isStatic:true, x:kx - 39, y:gy - 20, w:8, h:40, ...cupC }));
  // ★底の〈半径の中の物体の数〉。半径 0.3m は入った球（底から約 20px）に届き、壁には届かない
  //   （合図でつなぐ仕掛けのカップと同じ考え）。壁と底は固定物で、数えるのは物体だけ
  prog(cupFloor, false, { trigger:'near', nearR:0.3, nearMin:1, nearMax:99, action:'signal', sigOut:2 }, 0.74);
  // ── ⑤ 合図2 → 右の回路のスイッチ → ゴールのランプ ──
  const gx = kx - 80, gT = gy - 330, gB = gy - 230;
  const sw = add('switch', gx - 60, gB, gx + 20, gB, { closed:false });
  add('wire', gx + 20, gB, gx + 100, gB);
  add('wire', gx + 100, gB, gx + 100, gT);
  add('bulb', gx + 100, gT, gx + 10, gT, { Vr:CSA_V, Pr:1 });
  add('dcsource', gx + 10, gT, gx - 60, gT, { V:CSA_V });
  add('wire', gx - 60, gT, gx - 60, gB);
  const r = addRemote('ghost', sw, 'circuit');
  if (r) { Object.assign(r, { kind:'ghost', key:'KeyG', sigOn:2, collapsed:true, fx:0.07, fy:0.44 });
           placeRemotePanel(r); syncRemotePanel(r); }
  lab(xA, gy + 50, 'A', null, 22);
  lab(xB, gy + 50, 'B', null, 22);
  lab(xB - 15, T - 100, 'AND ランプ', '#ffee58', 20);
  lab(sx, sy - 40, '生成口（合図1）', null, 18);
  lab(kx - 20, gy + 50, 'カップ → 合図2', null, 18);
  lab(gx + 20, gT - 100, 'ゴール（合図2で入る）', '#ffee58', 18);
  demoTitlePinned('回路と合図をつなぐ（AND で球を出す）');
  demoNotePinned(
    '▶実行 して見るだけ。\n'
  + '① 床の押しボタン A と B は直列＝両方踏まれたときだけ\n'
  + '　 AND ランプに電流が流れる（始めは A だけ）\n'
  + '② 球 B が転がってきて B を踏むと、AND ランプが点く。\n'
  + '　 ランプにつないだプログラムが電流を見て合図1を出す\n'
  + '③ 合図1で、生成口が球を1個出す\n'
  + '④ 球がカップに入ると、カップの底が合図2を出す\n'
  + '⑤ 合図2で、リモコンが右の回路のスイッチを入れる\n'
  + '\n'
  + '箱や球を Space でつかんでどけ、また乗せると、\n'
  + 'そろうたびに1個出る。論理（AND・OR・NOT）は回路で組み、\n'
  + '合図は回路と仕掛けをつなぐだけ。');
}
const CSA_V = 6, CSA_BALL_R = 16, CSA_BTN_R = 16;

// ── 回路と合図の仕掛け：共通の部品 ─────────────────────────────
//   ★以下4つ（2進カウンタ・踏切・大きさで仕分け・防犯ブザー）は、回路 → 合図
//     （プログラム〈電流が○〜○Aになったら〉）と 合図 → 回路（リモコンの「合図 入／切」）の
//     見本（2026-09-30、ユーザーの依頼）。論理と記憶は回路、合図はつなぐだけ、の分担を守る。
function csgAdd(type, ax, ay, bx, by, o) {
  const e = new CircuitElement(type, ax, ay, bx, by);
  Object.assign(e, o || {});
  circuitElements.push(e);
  return e;
}
// プログラムを付けて畳んで置く（elem＝回路素子につなぐ）
function csgProg(t, elem, o, fx, fy) {
  const p = addProgram(t, elem);
  if (!p) return null;
  Object.assign(p, o, { collapsed:true, fx, fy });
  p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  return p;
}
// 回路のスイッチにリモコンを付ける（合図で入り切り）。on と off が同じなら合図のたびに入れ替わる
function csgSwitchRemote(sw, on, off, key, fx, fy) {
  const r = addRemote('ghost', sw, 'circuit');
  if (!r) return null;
  Object.assign(r, { kind:'ghost', sigOn:on, sigOff:off, key, collapsed:true, fx, fy });
  placeRemotePanel(r); syncRemotePanel(r);
  return r;
}
const csgLab = (x, y, t, c, s) => demoLabel(x, y, t, c || '#eceff1', s || 16);
const CSG_V = 3;                           // [V] 表示用の小さな回路の電源（豆電球も 3V 定格）

// ── 玉を数える2進カウンタ ───────────────────────────────────
//   ★桁ごとに1つの小さな回路（電源・スイッチ・豆電球）。スイッチは合図で入れ替わる
//     （リモコンの合図 入＝切＝同じ番号）。
//     ① 玉が坂の途中の四角に入るたびに合図1 → 1の位のスイッチが入れ替わる
//     ② ある桁のランプが**消えた瞬間**（電流が 0〜0.01A に入った瞬間）、そのランプに
//        つないだプログラムが次の番号の合図を出す → 上の桁が入れ替わる＝繰り上がり
//   ★「消えた瞬間」を繰り上がりにするのが要。1→0 になるのは繰り上がるときだけなので、
//     点いた瞬間で上げると 1 ごとに上の桁が動いてしまう（2進の T フリップフロップの連鎖）。
//   ★通過カウンタを同じ坂に置いて10進の答え合わせにする（数えるのは物体の通過）。
//   ★玉は生成口から一定の間隔で出て、下の箱で消える（生成口のプログラムが〈複製にも適用〉で効く）。
function demoBinaryCounter() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.7);
  const cx = cam.x + (740 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const edge = { strokeColor:'#263238', strokeWidth:1.5 };
  const soft = { restitution:0.05, friction:0.5, frictionStatic:0.6 };
  const plank = (x0, y0, x1, y1, o) => new Body(Object.assign({ type:'box', isStatic:true,
    x:(x0 + x1) / 2, y:(y0 + y1) / 2 + 5, w:Math.hypot(x1 - x0, y1 - y0), h:10,
    angle:Math.atan2(y1 - y0, x1 - x0), fillColor:'#8d6e63', strokeColor:'#5d4037' }, soft, o));
  // ── 玉の通り道（左上の生成口 → 右へ下る坂 → 箱）──
  //   ★通り道と箱は台の上へ持ち上げてある。画面の下端にはリモコンの窓が4つ並ぶので、
  //     床の高さに置くと箱が窓に隠れる。
  const sx = cx - 300, sy = gy - 430;
  const gate = new Body(Object.assign({ type:'circle', x:sx, y:sy, radius:BC_BALL_R, mass:0.5, isSpawner:true,
    fillColor:'#ffca28', label:'生成口' }, edge, soft, { strokeColor:'#ffffff' }));
  objects.push(gate);
  const r0x = sx - 30, r0y = sy + 40, r1x = cx + 150, r1y = gy - 220;
  objects.push(plank(r0x, r0y, r1x, r1y));
  const bx = r1x + 70;                     // 箱（玉はここで消える）
  const binC = { fillColor:'#546e7a', strokeColor:'#263238' };
  const by = gy - 150;                     // 箱の底（台の上）
  objects.push(new Body(Object.assign({ type:'box', isStatic:true, x:bx + 45, y:by - 70, w:10, h:140 }, binC)),
               new Body(Object.assign({ type:'box', isStatic:true, x:bx, y:by - 5, w:100, h:10 }, binC)),
               new Body(Object.assign({ type:'box', isStatic:true, x:bx, y:(by + gy) / 2, w:24, h:gy - by }, binC)));
  // 数える四角：坂のまん中。★高さは坂の上下を十分に含める（跳ねて出入りすると2回数える）
  const zx = (r0x + r1x) / 2, zy = (r0y + r1y) / 2 - 10;
  csgProg(gate, false, { trigger:'step', step:BC_PERIOD, action:'create', scope:'copies', limit:12 }, 0.07, 0.50);
  csgProg(gate, false, { trigger:'zone', zx, zy, zw:40, zh:160, action:'signal', sigOut:1 }, 0.07, 0.555);
  csgProg(gate, false, { trigger:'zone', zx:bx, zy:by - 40, zw:80, zh:70, action:'delete', target:'self' }, 0.07, 0.61);
  // 答え合わせの通過カウンタ（四角と同じ所を縦に横切る。★下から上へ引く＝右へ通ると +1）
  const c = addCounter(zx - 20, zy + 90, zx - 20, zy - 90);
  if (c) { c.what = 'bodies'; c.collapsed = true; c.fx = 0.78; c.fy = 0.40; placeCounterPanel(c); syncCounterPanel(c); }
  // ── 4桁の回路（左が 8 の位、右が 1 の位）──
  const top = gy - 640, h = 100, w = 90, gap = 130, x0 = cx - 230;
  const lamps = [], sws = [];
  for (let k = 0; k < 4; k++) {           // k＝桁（0 が 1 の位）
    const L = x0 + (3 - k) * gap, R = L + w, T = top, B = top + h;
    csgAdd('dcsource', L, B, L, T, { V:CSG_V });
    lamps[k] = csgAdd('bulb', L, T, R, T, { Vr:CSG_V, Pr:1 });
    csgAdd('wire', R, T, R, B);
    csgAdd('wire', R, B, R - 15, B);
    sws[k] = csgAdd('switch', R - 15, B, L + 15, B, { closed:false });
    csgAdd('wire', L + 15, B, L, B);
    csgLab(L + w / 2, T - 42, String(1 << k), '#ffee58', 26);
  }
  // 繰り上がり：k 桁のランプが消えた瞬間 → 合図 k+2 → k+1 桁のスイッチ
  for (let k = 0; k < 3; k++)
    csgProg(lamps[k], true, { trigger:'current', curMin:0, curMax:0.01, action:'signal', sigOut:k + 2 },
            0.07, 0.665 + k * 0.055);
  for (let k = 0; k < 4; k++) csgSwitchRemote(sws[k], k + 1, k + 1, 'Digit' + (k + 1), 0.30 + (3 - k) * 0.175, 0.99);   // ★下端に並べる（画面内へ押し戻される）
  csgLab(zx, zy - 100, '合図1', '#ffca28', 16);
  csgLab(sx, sy - 34, '生成口', '#eceff1', 15);
  demoTitlePinned('玉を数える2進カウンタ');
  demoNotePinned(
    '▶実行 して見るだけ。玉が坂のまん中を通るたびに1つ増える。\n'
  + '① 玉が点線の四角に入ると合図1 → 1の位のスイッチが入れ替わる\n'
  + '② ランプが消えた瞬間、そのランプのプログラムが合図を出し、\n'
  + '　 1つ上の位のスイッチが入れ替わる（繰り上がり）\n'
  + '　 1の位のランプ → 合図2 → 2の位、2の位 → 合図3 → 4の位 …\n'
  + '\n'
  + '点いているランプの数字を足すと、通った玉の数になる\n'
  + '（右上の通過カウンタが10進の答え合わせ）。\n'
  + '16個目で 0000 に戻る（4桁）。\n'
  + '1〜4 のキーで各桁のスイッチを手で入れ替えることもできる。');
}
const BC_BALL_R = 14, BC_PERIOD = 90;     // [px]・[ステップ] 玉の大きさと出る間隔（1.5秒）

// ── 踏切（真上から見た図）────────────────────────────────────
//   ★線路は左右、道路は上下。電車は等速で右へ、車は動力で上へ走る（重力 0・空気抵抗で頭打ち）。
//     ① 電車が手前の押しボタン（入）を踏む → リレー R1 に電流、R1 の接点で自己保持
//        （電車が離れても「電車が来ている」を覚えている）
//     ② R1 の電流が流れ始めた瞬間、コイルのプログラムが合図1 → 遮断機のモーターが閉じる向きに回る
//     ③ R1 の接点が警報灯の回路を入れる。2つの灯は 0.5 秒ごとの合図5で入れ替わるスイッチを
//        通っているので、交互に点滅する（R1 が切れていれば点かない）
//     ④ 電車が向こうの押しボタン（押すと切）を踏む → 自己保持が切れる → 電流が止まった瞬間に
//        合図2 → 遮断機が開く。止まっていた車が走り出す
//   ★遮断機は背景に留めたモーター（axle）の腕。可動域 0〜90°、閉じる／開くは同じ軸に付けた
//     リモコン2台（正転・逆転）が合図で受け持つ（合図で折り返す台車と同じ形）。
//   ★衝突レイヤー：車と遮断機はレイヤー1、電車はレイヤー2（遮断機にも車にも当たらない）、
//     線路と道路の絵はレイヤー4（誰とも当たらない。レイヤー0 にすると薄く描かれる）。
function demoLevelCrossing() {
  resetDemoWorld();
  updateGroundTerrain(false);
  setDemoGravity(0);
  world.sleeping = false;                  // ★止まった車が眠ると、遮断機が開いても走り出さない
  setDemoCam(0, 0.6);
  const cx = cam.x + (740 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const cy = cam.y;
  const xC = cx, yR = cy + 40;             // 踏切の中心（線路と道路の交わる所）
  const deco = (x, y, w, h, c) => new Body({ type:'box', isStatic:true, x, y, w, h, layers:0b1000,
    fillColor:c, strokeColor:c, strokeWidth:1 });
  // 道路・線路（絵）
  objects.push(deco(xC, yR + 150, LC_ROAD_W, 700, '#37474f'));
  for (let x = xC - 900; x <= xC + 700; x += 40) objects.push(deco(x, yR, 10, 56, '#6d4c41'));   // まくら木
  objects.push(deco(xC - 100, yR - 20, 1600, 5, '#b0bec5'), deco(xC - 100, yR + 20, 1600, 5, '#b0bec5'));
  // 電車（等速。レイヤー2）
  const train = new Body({ type:'box', x:xC - 720, y:yR, w:LC_TRAIN_L, h:46, mass:20, constVel:true,
    layers:0b0010, fillColor:'#43a047', strokeColor:'#1b5e20', strokeWidth:2, label:'電車' });
  train.vx = LC_TRAIN_V * M2PX;
  objects.push(train);
  // 車（動力で上へ。空気抵抗で頭打ちの速さになる）
  const car = new Body({ type:'box', x:xC, y:yR + 360, w:50, h:80, mass:1, layers:0b0001,
    drag:LC_CAR_DRAG, fixedRotation:true, restitution:0, friction:0.3, frictionStatic:0.3,
    fillColor:'#e53935', strokeColor:'#b71c1c', strokeWidth:2, label:'車',
    thrusters:[{ force:LC_CAR_F, dir:-Math.PI / 2 }] });
  objects.push(car);
  // 遮断機：道路の左に支点。開いているとき腕は線路の側（上）を向き、閉じると道路をふさぐ。
  //   ★開くときは車から離れる向きに回す。車の側（下）へ開くと、止まっていた車を腕が
  //     はたき返した（実測：開いた瞬間に車が 3.2 m/s で後ろへ飛んだ）。
  //     上へ開いた腕は線路に重なるが、電車はレイヤー2なので当たらない。
  const px = xC - LC_ROAD_W / 2 - 18, py = yR + 70;
  const arm = new Body({ type:'box', x:px, y:py - LC_ARM_L / 2 + 8, w:LC_ARM_L, h:12, angle:-Math.PI / 2,
    mass:1, hasGravity:false, layers:0b0001, fillColor:'#fdd835', strokeColor:'#f57f17', strokeWidth:2,
    label:'遮断機' });
  objects.push(arm);
  objects.push(new Body({ type:'circle', isStatic:true, x:px, y:py, radius:10, layers:0b1000,
    fillColor:'#eceff1', strokeColor:'#263238', strokeWidth:1.5, label:'支柱' }));
  const post = objects[objects.length - 1];
  const j = new Joint({ type:'axle', bodyA:null, bodyB:arm, motorSpeed:LC_ARM_W, motorTorque:LC_ARM_T,
    angleLimit:true, angleLo:0, angleHi:Math.PI / 2 });
  setJointEnd(j, 'A', null, px, py, false); setJointEnd(j, 'B', arm, px, py, false);
  joints.push(j);
  // ── 回路：R1 のコイル（入・自己保持・切）──
  const xS = xC - 470, xE = xC + 330, yb = yR, yT = yR - 150, yT2 = yR - 210;
  csgAdd('pushswitch', xS - 30, yb, xS + 30, yb, { br:16 });                  // 入（電車が来たら）
  csgAdd('wire', xS - 30, yb, xS - 30, yb - 60);
  csgAdd('relayswitch', xS - 30, yb - 60, xS + 30, yb - 60, { ch:1 });         // 自己保持 R1a
  csgAdd('wire', xS + 30, yb, xS + 30, yb - 60);
  csgAdd('wire', xS + 30, yb - 60, xS + 30, yT);
  csgAdd('wire', xS + 30, yT, xC - 45, yT);
  const coil = csgAdd('relay', xC - 45, yT, xC + 45, yT, { ch:1 });
  csgAdd('wire', xC + 45, yT, xE - 30, yT);
  csgAdd('wire', xE - 30, yT, xE - 30, yb);
  csgAdd('pushswitch', xE - 30, yb, xE + 30, yb, { nc:true, br:16 });          // 切（電車が過ぎたら）
  csgAdd('wire', xE + 30, yb, xE + 30, yT2);
  csgAdd('wire', xE + 30, yT2, xC + 40, yT2);
  csgAdd('dcsource', xC + 40, yT2, xC - 40, yT2, { V:6 });
  csgAdd('wire', xC - 40, yT2, xS - 30, yT2);
  csgAdd('wire', xS - 30, yT2, xS - 30, yb - 60);
  // ── 回路：警報灯（R1a を通り、点滅スイッチ S1・S2 で左右に分かれる）──
  const Lx = xC + 130, Rx = xC + 330, t1 = yR - 460, t2 = yR - 380, bt = yR - 300;
  csgAdd('dcsource', Lx, bt, Lx, t1, { V:CSG_V });
  csgAdd('relayswitch', Lx, t1, Lx + 50, t1, { ch:1 });
  const s1 = csgAdd('switch', Lx + 50, t1, Lx + 100, t1, { closed:true });
  csgAdd('bulb', Lx + 100, t1, Lx + 160, t1, { Vr:CSG_V, Pr:1 });
  csgAdd('wire', Lx + 160, t1, Rx, t1);
  csgAdd('wire', Lx + 50, t1, Lx + 50, t2);
  const s2 = csgAdd('switch', Lx + 50, t2, Lx + 100, t2, { closed:false });
  csgAdd('bulb', Lx + 100, t2, Lx + 160, t2, { Vr:CSG_V, Pr:1 });
  csgAdd('wire', Lx + 160, t2, Rx, t2);
  csgAdd('wire', Rx, t1, Rx, t2);
  csgAdd('wire', Rx, t2, Rx, bt);
  csgAdd('wire', Rx, bt, Lx, bt);
  // ── プログラムとリモコン ──
  csgProg(coil, true, { trigger:'current', curMin:0.02, curMax:1e6, action:'signal', sigOut:1 }, 0.07, 0.50);
  csgProg(coil, true, { trigger:'current', curMin:0, curMax:0.01, action:'signal', sigOut:2 }, 0.07, 0.555);
  csgProg(post, false, { trigger:'step', step:LC_BLINK, action:'signal', sigOut:5 }, 0.07, 0.61);
  // ★リモコンの窓は下端に1列に並べる（畳んでもボタンが残るので、縦に積むと重なる）
  const mot = (mode, on, off, key, fx) => {
    const r = addRemote('motor', j);
    if (!r) return;
    Object.assign(r, { kind:'motor', mode, sigOn:on, sigOff:off, key, collapsed:true, fx, fy:0.99 });
    placeRemotePanel(r); syncRemotePanel(r);
  };
  mot('on',  1, 2, 'ArrowDown', 0.07);     // 閉じる（motorSpeed の向き）
  mot('rev', 2, 1, 'ArrowUp',   0.25);     // 開く
  csgSwitchRemote(s1, 5, 5, 'KeyQ', 0.43, 0.99);
  csgSwitchRemote(s2, 5, 5, 'KeyW', 0.61, 0.99);
  csgLab(xS, yb + 50, '入', '#ffee58', 20);
  csgLab(xE, yb + 50, '切', '#ffee58', 20);
  csgLab(xS - 150, yb - 60, '自己保持 R1a', '#eceff1', 15);
  csgLab(xC, yT - 30, 'リレー R1', '#eceff1', 15);
  csgLab((Lx + Rx) / 2, t1 - 40, '警報灯', '#ffee58', 18);
  demoTitlePinned('踏切（真上から見た図）');
  demoNotePinned(
    '▶実行 して見るだけ。\n'
  + '① 電車が「入」のボタンを踏むとリレー R1 が入り、\n'
  + '　 R1 の接点で入ったままになる（自己保持＝電車が来ていることを覚える）\n'
  + '② R1 に電流が流れ始めた瞬間、R1 のプログラムが合図1を出し、\n'
  + '　 遮断機のモーターが閉じる。車は遮断機の手前で止まる\n'
  + '③ 警報灯は R1 の接点を通るので、R1 が入っている間だけ点く。\n'
  + '　 0.5秒ごとの合図5でスイッチが入れ替わり、交互に点滅する\n'
  + '④ 電車が「切」のボタンを踏むと自己保持が切れ、電流が止まった\n'
  + '　 瞬間に合図2 → 遮断機が開き、車が走り出す');
}
const LC_ROAD_W = 130;                    // [px] 道路の幅
const LC_TRAIN_L = 260, LC_TRAIN_V = 1.6; // [px]・[m/s] 電車
// ★車の頭打ちの速さは、動力 F と空気抵抗が釣り合う v。実測で抵抗 ≈ 0.015·drag·v² [N]
//   （drag 3・F 3N で 8.15 m/s）。F 1N・drag 65 で約 1 m/s ＝遮断機が閉じてから着く速さ。
const LC_CAR_F = 1, LC_CAR_DRAG = 65;
const LC_ARM_L = 170, LC_ARM_W = 2.5, LC_ARM_T = 200;   // [px]・[rad/s]・[N·m] 遮断機
const LC_BLINK = 30;                      // [ステップ] 点滅の間隔（0.5秒）

// ── 大きさで仕分ける機械 ─────────────────────────────────────
//   ★大玉と小玉が交じって転がってくる。平らな所の上に、宙に浮いた押しボタン（計り）がある。
//     押しボタンは回路の素子なので物に当たらず、「円に物体がかかったら押される」だけ
//     （circuit.js の updatePushSwitches）。円は床から 42px の高さ＝大玉（直径 52px）の
//     頭はかかり、小玉（直径 26px）はくぐる。
//     ① 大玉が計りを押す → リレー R1 に電流、R1 の接点で自己保持（大玉が来たことを覚える）
//     ② R1 の電流が流れ始めた瞬間、コイルのプログラムが合図1 → 落とし戸がすり抜けになる
//        （プログラム〈衝突レイヤーを変える〉。落とし戸は薄く描かれる）→ 大玉が下の箱へ落ちる
//     ③ 落ちる途中の押しボタン（押すと切）で自己保持が切れる → 電流が止まった瞬間に合図2 →
//        落とし戸が戻る。小玉は落とし戸の上を通って右の箱へ
//   ★計りを押す時間は一瞬なので、覚えておく回路（自己保持）がないと落とし戸まで持たない。
//     計りと落とし戸の間は短くしてある（大玉の直前を行く小玉が、開いた戸に落ちないように）。
//   ★大玉と小玉は別の生成口から、周期をずらして出す（大 5秒・小 1.67秒、大は 0.8秒遅れ）。
function demoSizeSorter() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.65);
  const cx = cam.x + (650 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const edge = { strokeColor:'#263238', strokeWidth:1.5 };
  const soft = { restitution:0.05, friction:0.4, frictionStatic:0.5 };
  const wood = { fillColor:'#8d6e63', strokeColor:'#5d4037', strokeWidth:1.5 };
  const bar = (x0, y0, x1, y1, o) => new Body(Object.assign({ type:'box', isStatic:true,
    x:(x0 + x1) / 2, y:(y0 + y1) / 2 + 5, w:Math.hypot(x1 - x0, y1 - y0), h:10,
    angle:Math.atan2(y1 - y0, x1 - x0) }, wood, soft, o));
  const yF = gy - 250;                     // 平らな所の上面
  const xG = cx - 60;                      // 計りの位置
  const d0 = cx - 20, d1 = cx + 60;        // 落とし戸の左右
  // ── 通り道 ──
  objects.push(bar(cx - 420, yF - 24, cx - 120, yF));      // 下り坂
  objects.push(bar(cx - 120, yF, d0, yF));
  const door = bar(d0, yF, d1, yF, { fillColor:'#ffb74d', strokeColor:'#e65100', label:'落とし戸' });
  objects.push(door);
  objects.push(bar(d1, yF, cx + 300, yF));
  // 大玉の落ちる筒と箱（落とし戸の真下）
  const box = (x, y, w, h, c) => new Body(Object.assign({ type:'box', isStatic:true, x, y, w, h }, soft,
    { fillColor:c, strokeColor:'#263238', strokeWidth:1.5 }));
  objects.push(box(d0 - 14, (yF + 10 + gy - 70) / 2, 8, gy - 70 - yF - 10, '#546e7a'));
  objects.push(box(d1 + 4, (yF + 10 + gy - 70) / 2, 8, gy - 70 - yF - 10, '#546e7a'));
  objects.push(box(d0 - 60, gy - 35, 8, 70, '#26a69a'), box(d1 + 50, gy - 35, 8, 70, '#26a69a'));
  // 小玉の箱（通り道の右端の先）
  objects.push(box(cx + 330, gy - 60, 8, 120, '#26a69a'), box(cx + 440, gy - 60, 8, 120, '#26a69a'));
  // ── 生成口（小・大）──
  const sp = (x, r, col, label) => {
    const b = new Body(Object.assign({ type:'circle', x, y:yF - 24 - r - 6 - (x - (cx - 420)) * 0,
      radius:r, mass:r > 20 ? 2 : 0.3, isSpawner:true, fillColor:col, label }, edge, soft,
      { strokeColor:'#ffffff' }));
    objects.push(b);
    return b;
  };
  const small = sp(cx - 400, SS_R_SMALL, '#42a5f5', '小玉の生成口');
  const big   = sp(cx - 340, SS_R_BIG,   '#ef5350', '大玉の生成口');
  big.y = yF - 24 + (big.x - (cx - 420)) * 24 / 300 - SS_R_BIG - 4;
  small.y = yF - 24 + (small.x - (cx - 420)) * 24 / 300 - SS_R_SMALL - 4;
  // ── 回路：計り（入）‖ 自己保持 R1a → 筒の押しボタン（切）→ コイル ──
  const yS = yF - SS_GAUGE_H, yH = yF - 110, yC = yF - 190, yD = yF - 250;
  const xL = xG - 25, xR = xG + 25, yRs = yF + 110, xW = cx + 150;
  csgAdd('pushswitch', xL, yS, xR, yS, { br:SS_GAUGE_R });                 // 計り
  csgAdd('wire', xL, yS, xL, yH);
  csgAdd('relayswitch', xL, yH, xR, yH, { ch:1 });                          // 自己保持 R1a
  csgAdd('wire', xR, yS, xR, yH);
  csgAdd('wire', xR, yH, xW, yH);
  csgAdd('wire', xW, yH, xW, yRs);
  csgAdd('wire', xW, yRs, d1 - 10, yRs);
  csgAdd('pushswitch', d1 - 10, yRs, d0 + 10, yRs, { nc:true, br:22 });   // 筒の中（押すと切）
  csgAdd('wire', d0 + 10, yRs, cx - 200, yRs);
  csgAdd('wire', cx - 200, yRs, cx - 200, yC);
  const coil = csgAdd('relay', cx - 200, yC, cx - 200, yD, { ch:1 });
  csgAdd('dcsource', xL, yD, cx - 200, yD, { V:6 });
  csgAdd('wire', xL, yD, xL, yH);
  // ── プログラム ──
  csgProg(small, false, { trigger:'step', step:SS_SMALL_T, action:'create', limit:12 }, 0.07, 0.48);
  csgProg(big,   false, { trigger:'step', step:SS_BIG_T, delay:0.8, action:'create', limit:6 }, 0.07, 0.535);
  csgProg(coil, true, { trigger:'current', curMin:0.02, curMax:1e6, action:'signal', sigOut:1 }, 0.07, 0.59);
  csgProg(coil, true, { trigger:'current', curMin:0, curMax:0.01, action:'signal', sigOut:2 }, 0.07, 0.645);
  csgProg(door, false, { trigger:'signal', sigIn:1, action:'layers', layers:0 }, 0.07, 0.70);
  csgProg(door, false, { trigger:'signal', sigIn:2, action:'layers', layers:LAYER_DEFAULT }, 0.07, 0.755);
  csgLab(xG - 75, yS - 10, '計り →', '#ffee58', 18);
  csgLab(cx - 260, (yC + yD) / 2, 'リレー R1', '#eceff1', 15);
  csgLab((d0 + d1) / 2, gy + 30, '大玉の箱', '#80cbc4', 17);
  csgLab(cx + 385, gy + 30, '小玉の箱', '#80cbc4', 17);
  demoTitlePinned('大きさで仕分ける機械');
  demoNotePinned(
    '▶実行 して見るだけ。\n'
  + '① 宙に浮いた押しボタン「計り」は床から 42cm の高さ。\n'
  + '　 大玉の頭はかかり、小玉はくぐる\n'
  + '② 大玉が計りを押すとリレー R1 が入り、R1a で入ったままになる\n'
  + '　（押すのは一瞬なので、覚えておく回路が要る）\n'
  + '③ R1 に電流が流れ始めた瞬間に合図1 → 落とし戸がすり抜けになり、\n'
  + '　 大玉が下の箱へ落ちる\n'
  + '④ 落ちる途中のボタン（押すと切）で R1 が切れ、電流が止まった\n'
  + '　 瞬間に合図2 → 落とし戸が戻る。小玉はそのまま右の箱へ');
}
const SS_R_BIG = 26, SS_R_SMALL = 13;     // [px] 玉の半径（直径 52cm・26cm）
const SS_GAUGE_H = 42, SS_GAUGE_R = 8;    // [px] 計りの高さ（床から）と反応半径
const SS_BIG_T = 300, SS_SMALL_T = 100;   // [ステップ] 大玉・小玉の出る間隔

// ── 防犯ブザー（光のセンサーと自己保持）─────────────────────────
//   ★床から天井のセンサーへ光が通っている。坂を転がってきた球（侵入者）が光を横切ると：
//     ① センサーの〈光が途切れたら〉→ 合図1 → リモコンが回路のスイッチ「センサー接点」を入れる
//        （〈光が当たったら〉→ 合図2 で切る＝光が遮られている間だけ入っているスイッチ）
//     ② センサー接点がリレー R1 を入れ、R1 の接点 R1a で入ったままになる（自己保持）。
//        球が通り過ぎて光が戻っても、警報灯は消えない＝「一度でも横切った」を覚えている
//     ③ R1 の電流が流れ始めた瞬間、コイルのプログラムが合図3 → 檻の留め具が〈○秒後に〉消え、
//        檻が落ちて球を閉じ込める
//     R キーで解除スイッチを開くと自己保持が切れて警報灯が消える（もう一度 R で元に戻す）。
//   ★留め具を遅らせるのは、光から止まる所まで球が転がる時間のぶん（実測で合わせる：
//     LA_DELAY の★）。すぐ落とすと、檻が先に着いて球が檻の外で止まる。
function demoBurglarAlarm() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.7);
  const cx = cam.x + (740 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const edge = { strokeColor:'#263238', strokeWidth:1.5 };
  const soft = { restitution:0.05, friction:0.5, frictionStatic:0.6 };
  const box = (o) => new Body(Object.assign({ type:'box' }, edge, soft, o));
  // 坂と球
  const RX = cx - 300, RW = 70, RH = 90;
  objects.push(new Body(Object.assign({ type:'polygon', isStatic:true, x:RX, y:gy, fillColor:'#78909c',
    verts:[{ x:-RW, y:-RH }, { x:RW, y:0 }, { x:-RW, y:0 }] }, edge, soft)));
  objects.push(new Body(Object.assign({ type:'circle', x:RX - RW + 22, y:gy - RH - 22, radius:18, mass:1,
    fillColor:'#7e57c2', label:'侵入者' }, edge, soft)));
  // 光とセンサー
  const xB = cx - 120;
  lasers.push(new Laser({ body:null, localX:xB, localY:gy - 4, angle:-Math.PI / 2, wavelength:633 }));
  const sensor = box({ isStatic:true, x:xB, y:gy - 330, w:40, h:14, fillColor:'#26a69a', label:'センサー' });
  objects.push(sensor);
  // 止め具（球はここで止まる）
  const xW = cx + 120;
  objects.push(box({ isStatic:true, x:xW, y:gy - 30, w:16, h:60, fillColor:'#78909c' }));
  // 檻（逆さのコの字＝3枚を固定でつなぐ）と留め具
  const kx = cx + 75, kw = 150, kh = 110, kb = gy - 200, t = 8;   // kb＝檻の下端
  const cage = [
    box({ x:kx, y:kb - kh + t / 2, w:kw + t, h:t, mass:1, fillColor:'#b0bec5', label:'檻' }),
    box({ x:kx - kw / 2, y:kb - kh / 2, w:t, h:kh, mass:0.5, fillColor:'#b0bec5' }),
    box({ x:kx + kw / 2, y:kb - kh / 2, w:t, h:kh, mass:0.5, fillColor:'#b0bec5' }),
  ];
  objects.push(...cage);
  for (const [s, dx] of [[1, -kw / 2], [2, kw / 2]]) {
    const j = new Joint({ type:'fixjoint', bodyA:cage[0], bodyB:cage[s] });
    setJointEnd(j, 'A', cage[0], kx + dx, kb - kh + t / 2, false);
    setJointEnd(j, 'B', cage[s], kx + dx, kb - kh + t / 2, false);
    joints.push(j);
  }
  const pin = box({ isStatic:true, x:kx, y:kb - kh + t + 7, w:30, h:14, fillColor:'#ffb74d', label:'留め具' });
  objects.push(pin);
  // ── 回路（はしご）：上の段＝(センサー接点 ‖ R1a) → 解除 → コイル、下の段＝R1a → 警報灯 ──
  const Lx = cx - 200, Rx = cx + 260, y1 = gy - 560, y2 = gy - 470, yb = gy - 400, yh = y1 - 60;
  csgAdd('wire', Lx, y1, Lx, y2); csgAdd('wire', Lx, y2, Lx, yb);
  csgAdd('wire', Rx, y1, Rx, y2); csgAdd('wire', Rx, y2, Rx, yb);
  const mid = (Lx + Rx) / 2;
  csgAdd('wire', Lx, yb, mid - 40, yb);
  csgAdd('dcsource', mid - 40, yb, mid + 40, yb, { V:6 });
  csgAdd('wire', mid + 40, yb, Rx, yb);
  const trip = csgAdd('switch', Lx, y1, Lx + 80, y1, { closed:false });            // センサー接点
  csgAdd('wire', Lx, y1, Lx, yh);
  csgAdd('relayswitch', Lx, yh, Lx + 80, yh, { ch:1 });                           // 自己保持 R1a
  csgAdd('wire', Lx + 80, y1, Lx + 80, yh);
  csgAdd('wire', Lx + 80, y1, Lx + 140, y1);
  const reset = csgAdd('switch', Lx + 140, y1, Lx + 220, y1, { closed:true });    // 解除
  csgAdd('wire', Lx + 220, y1, Lx + 300, y1);
  const coil = csgAdd('relay', Lx + 300, y1, Lx + 390, y1, { ch:1 });
  csgAdd('wire', Lx + 390, y1, Rx, y1);
  csgAdd('relayswitch', Lx, y2, Lx + 80, y2, { ch:1 });
  csgAdd('wire', Lx + 80, y2, Lx + 250, y2);
  csgAdd('bulb', Lx + 250, y2, Lx + 330, y2, { Vr:6, Pr:1 });
  csgAdd('wire', Lx + 330, y2, Rx, y2);
  // ── プログラムとリモコン ──
  csgProg(sensor, false, { trigger:'light', lightEdge:'off', action:'signal', sigOut:1 }, 0.07, 0.50);
  csgProg(sensor, false, { trigger:'light', lightEdge:'on',  action:'signal', sigOut:2 }, 0.07, 0.555);
  csgProg(coil, true, { trigger:'current', curMin:0.02, curMax:1e6, action:'signal', sigOut:3 }, 0.07, 0.61);
  csgProg(pin, false, { trigger:'signal', sigIn:3, action:'delete', target:'self', delay:LA_DELAY }, 0.07, 0.665);
  csgSwitchRemote(trip, 1, 2, 'KeyT', 0.07, 0.99);   // ★左下の隅（坂を窓で隠さない）
  csgSwitchRemote(reset, 0, 0, 'KeyR', 0.25, 0.99);
  csgLab(Lx + 40, y1 + 26, 'センサー接点', '#ffee58', 15);
  csgLab(Lx + 40, yh - 30, '自己保持 R1a', '#eceff1', 15);
  csgLab(Lx + 180, y1 + 26, '解除（R）', '#ffee58', 15);
  csgLab(Lx + 345, y1 - 30, 'リレー R1', '#eceff1', 15);
  csgLab(Lx + 290, y2 + 30, '警報灯', '#ff8a80', 18);
  csgLab(xB + 60, gy - 340, 'センサー', '#80cbc4', 16);
  demoTitlePinned('防犯ブザー（光のセンサーと自己保持）');
  demoNotePinned(
    '▶実行 して見るだけ。\n'
  + '① 球が光を横切ると、センサーが合図1を出し、リモコンが\n'
  + '　「センサー接点」を入れる（光が戻ると合図2で切る）\n'
  + '② センサー接点でリレー R1 が入り、R1a で入ったままになる。\n'
  + '　 光が戻っても警報灯は消えない（横切ったことを覚えている）\n'
  + '③ R1 に電流が流れ始めた瞬間に合図3 → 少し遅れて\n'
  + '　 留め具が消え、檻が落ちて球を閉じ込める\n'
  + '\n'
  + 'R キーで「解除」を開くと警報灯が消える（もう一度 R で元に戻す）。');
}
// [s] 留め具を消すまでの遅れ。★実測：球が光を切るのが t≈77、止め具で止まるのが t≈128（0.85秒後）、
//   1.0秒後に留め具が消えて檻は t≈175 に着く＝止まった球の上に落ちる。
const LA_DELAY = 1.0;

// ── リレーの足し算機（4桁＋4桁の2進数）──────────────────────
//   ★キーで入り切りするスイッチ8個が A・B の各桁のリレー（R1〜R8）を動かし、
//     接点の組み合わせ（直列＝かつ・並列＝または・b接点＝でない）で各桁の和と繰り上がりを出す。
//     部品はスイッチ・リレーコイル・リレー接点・豆電球・直流電源・導線とリモコンだけ。
//   ★各桁の式（加算器の教科書どおりの積和形。1段＝1つの「かつ」、段を並べて「または」）：
//       和         S = A·B'·C' ＋ A'·B·C' ＋ A'·B'·C ＋ A·B·C   （1の位は C が無いので A·B' ＋ A'·B）
//       繰り上がり C = A·B ＋ A·C ＋ B·C                      （1の位は A·B）
//   ★和は豆電球へ直接つながず、いったんリレー（R12〜R15、16 の位は R16）で受けて、右上の表示の
//     回路で豆電球を点ける。直接つなぐと和の豆電球が4つの桁のブロックに散らばり、答えが読みにくい。
//   ★「繰り上がり0の線・1の線」を接点で切り替える方式（初期のリレー計算機）なら接点は3割少ないが、
//     裏回り（死んだ線が別の接点を通って生き返る）を避ける配線が読みにくいので、積和形にした。
//   ★チャンネル：A の 1・2・4・8 ＝ R1〜R4、B ＝ R5〜R8、繰り上がり（2・4・8 の位へ）＝ R9〜R11、
//     和 ＝ R12〜R15、16 の位 ＝ R16。
//   ★実測：A・B の 256 通りを順番をばらばらにして入り切りし、豆電球（0.05A 以上で点灯とみなす）を
//     読んだ。256/256 が A＋B に一致し、切り替えてから正しい表示に落ち着くまで最長 2 tick。
//     リレーは遅れなく動くので、繰り上がりが3段伝わっても待つ必要がない。
//   ★2026-09-27 に「ビー玉の足し算機」（シーソーの2進加算＋脱進機のゲート）をこれに置き換えた。
//     ユーザーの希望は「物理的というより電気的に」。
function demoRelayAdder() {
  resetDemoWorld();
  setDemoGravity(0);                 // ★回路図だけ。重力も地面も出さない
  updateGroundTerrain(false);
  setDemoCam(-700, 1);
  // ★座標は基準画面（998×736）の px で書く。記号の大きさは画面 px で一定なので、倍率 1 で合わせる
  const fit = demoFitScale();
  const WX = x => cam.x + (x * fit - canvas.width / 2) / cam.zoom;
  const WY = y => cam.y + (y * fit - canvas.height / 2) / cam.zoom;
  const add = (type, x1, y1, x2, y2, o) => {
    const e = new CircuitElement(type, WX(x1), WY(y1), WX(x2), WY(y2));
    Object.assign(e, o || {});
    circuitElements.push(e);
    return e;
  };
  const lab = (x, y, t, c, s) => demoLabel(WX(x), WY(y), t, c || '#eceff1', s || 13);
  const chA = i => 1 + i, chB = i => 5 + i, chC = i => 8 + i, chS = i => 12 + i;   // chC(i)＝i の位へ入る繰り上がり
  const CH_OUT = 16;

  // ── 縦に並べる帯（入力・表示）：上の横線が＋、下の横線が−。枝＝上の素子＋下の素子 ──
  const strip = (x0, pitch, branches) => {
    const yT = RA_STRIP_Y, yM = yT + RA_EL, yB = yT + 2 * RA_EL;
    add('dcsource', x0, yT, x0, yB, { V:RA_V });   // 1点目が＋極
    let xp = x0;
    const out = [];
    branches.forEach((br, k) => {
      const x = x0 + pitch * (k + 1);
      add('wire', xp, yT, x, yT); add('wire', xp, yB, x, yB);
      out.push(br(x, yT, yM, yB));
      xp = x;
    });
    return out;
  };
  // 入力：スイッチ → リレーコイル（A は Q W E R、B は A S D F。左から 1・2・4・8）
  const keys = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF'];
  const names = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F'];
  const sws = strip(RA_IN_X, RA_STRIP_P, keys.map((_, k) => (x, yT, yM, yB) => {
    const sw = add('switch', x, yT, x, yM, { closed:false });
    add('relay', x, yM, x, yB, { ch: k < 4 ? chA(k) : chB(k - 4) });
    lab(x - 5, yT - 12, names[k], k < 4 ? '#ffcc80' : '#90caf9', 14);
    return sw;
  }));
  lab(RA_IN_X + RA_STRIP_P - 8, RA_STRIP_Y - 30, 'A  1  2  4  8', '#ffcc80', 13);
  lab(RA_IN_X + RA_STRIP_P * 5 - 8, RA_STRIP_Y - 30, 'B  1  2  4  8', '#90caf9', 13);
  // ── はしご（加算の回路）：左の縦線が＋、右の縦線が−。1段＝接点の直列、同じ行き先の段は並列 ──
  const ladder = (L, yTop, groups, n, P) => {
    const xm = L + n * RA_CL, xo = xm + 10, R = xo + RA_CL + 14;
    let y = yTop;
    const mid = (L + R) / 2;
    add('wire', L, y, mid - RA_CL / 2, y);
    add('dcsource', mid - RA_CL / 2, y, mid + RA_CL / 2, y, { V:RA_V });
    add('wire', mid + RA_CL / 2, y, R, y);
    const lys = [y], rys = [y];
    for (const g of groups) {
      y += g.head ? RA_HEAD : (g.gap !== undefined ? g.gap : RA_GAP);
      if (g.head) lab(L + 4, y - RA_HEAD + 13, g.head, '#b0bec5', 12);
      const y0 = y + P / 2;
      g.rungs.forEach((rung, k) => {
        const yr = y0 + k * P;
        let x = L;
        for (const [ch, nc] of rung) { add('relayswitch', x, yr, x + RA_CL, yr, { ch, nc }); x += RA_CL; }
        if (x < xm) add('wire', x, yr, xm, yr);
        if (k > 0) add('wire', xm, yr, xm, yr - P);   // 下の段を上の段の行き先へ合流
        lys.push(yr);
      });
      add('wire', xm, y0, xo, y0);
      if (g.bulb) add('bulb', xo, y0, xo + RA_CL, y0, { Vr:RA_V, Pr:1 });
      else add('relay', xo, y0, xo + RA_CL, y0, { ch:g.out });
      if (g.tag) lab(R + 8, y0 + 5, g.tag, '#fff59d', 15);
      add('wire', xo + RA_CL, y0, R, y0);
      rys.push(y0);
      y = y0 + (g.rungs.length - 1) * P + P / 2;
    }
    for (let i = 1; i < lys.length; i++) add('wire', L, lys[i - 1], L, lys[i]);
    for (let i = 1; i < rys.length; i++) add('wire', R, rys[i - 1], R, rys[i]);
  };
  const bitGroups = i => {
    const A = [chA(i), false], a = [chA(i), true], B = [chB(i), false], b = [chB(i), true];
    const w = 1 << i;
    if (i === 0) return [
      { head: w + ' の位　和 → R' + chS(0), rungs: [[A, b], [a, B]], out: chS(0) },
      { head: null, rungs: [[A, B]], out: chC(1) },
    ];
    const C = [chC(i), false], c = [chC(i), true];
    return [
      { head: w + ' の位　和 → R' + chS(i), rungs: [[A, b, c], [a, B, c], [a, b, C], [A, B, C]], out: chS(i) },
      { head: null, rungs: [[A, B], [A, C], [B, C]], out: i === 3 ? CH_OUT : chC(i + 1) },
    ];
  };
  ladder(RA_COL1_X, RA_LAD_Y, [...bitGroups(0), ...bitGroups(1)], 3, RA_P);
  ladder(RA_COL2_X, RA_LAD_Y, [...bitGroups(2), ...bitGroups(3)], 3, RA_P);
  // 表示：和のリレーの接点 → 豆電球（上から 1・2・4・8・16）
  ladder(RA_OUT_X, RA_OUT_Y, [chS(0), chS(1), chS(2), chS(3), CH_OUT].map((ch, k) =>
    ({ head:null, gap:0, rungs:[[[ch, false]]], bulb:true, tag:String(1 << k) })), 1, RA_OUT_P);
  lab(RA_OUT_X + RA_CL * 2 + 36, RA_OUT_Y - 8, 'A＋B', '#fff59d', 14);

  // ── リモコン：スイッチの入り切り（押すたびに開け閉め）──
  sws.forEach((sw, k) => {
    const r = addRemote('ghost', sw, 'circuit');
    if (!r) return;
    Object.assign(r, { key: keys[k], collapsed:true, fx: 0.03 + (k >> 2) * 0.19, fy: RA_RM_Y + (k & 3) * RA_RM_DY });
    placeRemotePanel(r); syncRemotePanel(r); placeRemotePanel(r);
  });
  demoTitlePinned('リレーの足し算機');
  demoNotePinned(
    '▶実行 して、キーで A と B を決める。\n'
  + '　A：Q W E R ＝ 1・2・4・8\n'
  + '　B：A S D F ＝ 1・2・4・8（押すたびに入り切り）\n'
  + '・スイッチがリレー R1〜R8 を動かす\n'
  + '・接点の直列＝かつ、並列＝または、b接点＝でない\n'
  + '・この組み合わせで、各桁の和と繰り上がりを出す\n'
  + '・繰り上がりは R9〜R11 で次の桁へ\n'
  + '・和は R12〜R16 で右上の豆電球を点ける。\n'
  + '　点いた数字を足すと A＋B');
}
const RA_V = 6;                          // [V] どの回路も
const RA_EL = 44;                        // [px] 帯の素子の長さ（縦）
const RA_STRIP_Y = 100, RA_STRIP_P = 30;  // [px] 入力の帯の上の横線・枝の間隔
const RA_IN_X = 460;                     // [px] 入力の帯の電源の位置
const RA_OUT_X = 770, RA_OUT_Y = 72, RA_OUT_P = 30;   // [px] 表示のはしご（左の縦線・上の横線・段の間隔）
const RA_CL = 46;                        // [px] はしごの接点1つの長さ
const RA_P = 30, RA_HEAD = 20, RA_GAP = 6;   // [px] 段の間隔・桁の見出し・和と繰り上がりの間
const RA_LAD_Y = 245;                    // [px] はしごの上の横線（電源）
const RA_COL1_X = 460, RA_COL2_X = 705;  // [px] 2本のはしごの左の縦線
const RA_RM_Y = 0.34, RA_RM_DY = 0.16;   // リモコンの窓（左下に2列×4段）
