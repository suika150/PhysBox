// ════════════════════════════════════════
//  デモ：その他 › 遊び（2026-09-27 追加。光の迷路・パチンコ・ミニゴルフは同日削除）
// ════════════════════════════════════════
//  ★demos-other.js が 1,600 行を超えたので、この回に足した遊びはここへ分けた。
//    組み方の約束は同じ（手で作れる部品だけ・リモコンとプログラムで触る）。
//    目録（demos.js）より前に読み込む。

// ── 月面着陸 ─────────────────────────────────────────────
//   ★部品は四角形の和（着陸船）・動力3本・リモコン3台・プログラムだけ。
//     ↑ で下向きの主エンジン、← → で左右の姿勢制御（向きを変えるだけ）。
//   ★姿勢制御は「逆向きの2本の動力を1台のリモコンで同時に」効かせる＝偶力。
//     重心の左右に上向き・下向きの動力を1本ずつ置けば、合力は0でトルクだけが残る
//     （1本だけだと船が横へ流れ、どちらのキーが何をするのか分からなくなる）。
//   ★判定は触れた相手で決める。プログラムの〈当たったら〉は相手しか見られず、
//     〈速さが○〜○〉はまたいだ瞬間なので「着いたときの速さ」は取れない：
//     ・谷底（地面）か岩に触れたら失敗 → 船が赤くなり実行が止まる
//       岩は船と衝突レイヤーの設定を同じ {1} にし、〈同じレイヤー設定の物体だけ〉で拾う。
//       出発台と着陸台は {1,2}＝船と共有はするが同じではないので、拾わない。
//     ・着陸台の上に止まった高さの帯へ船が入ったら、船が緑になる（〈決めた場所に入ったら〉）。
//   ★着いたときの速さは「ばねで浮かせた板」に測らせる。強く降りるほど板が深く沈み、
//     底の赤い止めに当たると失敗（止めの〈当たったら〉）。速さの判定をプログラムに
//     書くのではなく、速さ → 沈み → 当たる、という原因と結果でつなぐ。
//     実測（台の真上から、船だけを下向きの速さで落とす）：1.0 m/s までは止めに届かず、
//     1.2 m/s 以上で当たる。横に 0.3 m/s 流れていても同じ。
//   ★ばねを入れる前は、脚を開いた船が月の重力では倒れようがなく、3 m/s で真下に
//     落としても台の上に立った（傾けて 3 m/s で落としたときだけ転がった）。
//     荷を皿に載せて「強く降りるとこぼれる」も試したが、2.5 m/s でもこぼれなかった
//     （船と一緒に落ちている荷は船に対して近づく速さを持たないので、跳ね返らない）。
//   ★通して飛べることの確認（実測）：キーの押し下げ・放しだけを使う自動操縦で、
//     出発台から尖塔を越えて着陸台に止まり、緑になった（約25秒）。
const LL_G = 1.62;                        // [m/s²] 月面の重力
const LL_M = 10;                          // [kg] 着陸船
// ★主エンジン 30N は重さ 16.2N の約2倍（押している間 1.38 m/s² で上がる）。
//   姿勢制御 1N×2本（腕 0.2m）。0.6N のときは 0.25秒押して 0.12 rad/s（1秒後に 7.5°）で、
//   手応えが鈍かったので上げた（力に比例するので 1N でおよそ 0.19 rad/s）。
const LL_MAIN = 30;                       // [N] 主エンジン
const LL_RCS = 1.0;                       // [N] 姿勢制御の動力1本
const LL_PAD_M = 5;                       // [kg] 着陸台の板
const LL_K = 300, LL_C = 20;              // [N/m]・[N·s/m] 板を支えるばね2本の合計（下の★）
const LL_GAP = 22, LL_STOP_H = 38;        // [px] 板と止めのすき間・止めの高さ
function demoLunarLander() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoGravity(LL_G);
  setDemoCam(0, 0.68);
  //   ★板の運動方向固定の軸は消す（画面を縦に貫く線になる。拘束は残る）
  world.showGuideRails = false;
  const cx = cam.x + (745 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const LAND = 0b0011, ROCK = 0b0001;     // 台 {1,2}／岩と船 {1}
  const rock = { restitution:0.1, friction:0.6, frictionStatic:0.7, strokeWidth:1.5 };
  const mesa = (x, w, h, o) => new Body(Object.assign({ type:'box', isStatic:true, x, y:gy - h/2, w, h,
    layers:LAND, fillColor:'#757575', strokeColor:'#bdbdbd' }, rock, o));
  const start = mesa(cx - 270, 100, 120);
  const px = cx + 245, baseH = 150, baseTop = gy - baseH;
  const padBase = mesa(px, 120, baseH);
  // 止め（板が底を打つところ）2本と、ばねで浮かせた板
  const stopY = baseTop - LL_STOP_H;
  const stops = [px - 45, px + 45].map(x => new Body(Object.assign({ type:'box', isStatic:true,
    x, y:baseTop - LL_STOP_H/2, w:10, h:LL_STOP_H, layers:LAND,
    fillColor:'#e57373', strokeColor:'#ffcdd2', label:'止め' }, rock)));
  const plateY = stopY - LL_GAP - 6;      // 板（厚み12）の中心。板だけが載ったときのつりあいの位置
  const pad = new Body(Object.assign({ type:'box', x:px, y:plateY, w:110, h:12, mass:LL_PAD_M,
    layers:LAND, fixedRotation:true, guideEnabled:true, guideAngle:Math.PI/2,
    fillColor:'#90a4ae', strokeColor:'#eceff1', label:'着陸台' }, rock));
  objects.push(start, padBase, pad);
  const stop = demoUnion(...stops);       // ★2本を1つに（プログラム1つで両方を見張る）
  objects.splice(objects.indexOf(stop), 1); objects.splice(objects.indexOf(pad), 0, stop);
  //   ★自然長は「板の重さで縮んだぶん」だけ長くしておく（開いた瞬間に板が沈まない）
  const springL = baseTop - (plateY + 6);
  const pre = LL_PAD_M * LL_G / LL_K * M2PX;   // [px] 板の重さでの縮み
  for (const dx of [-20, 20])
    demoSpring({ bodyA:null, bodyB:pad, anchorAx:px + dx, anchorAy:baseTop, anchorBx:dx, anchorBy:6,
                 restLength:springL + pre, stiffness:LL_K / 2, damping:LL_C / 2, radius:8 });
  // 岩（船と同じレイヤーの設定＝触れたら失敗）：谷の真ん中の尖塔と、上から垂れる岩
  const spire = new Body(Object.assign({ type:'polygon', isStatic:true, x:cx - 20, y:gy - 130, layers:ROCK,
    verts:[{ x:-60, y:130 }, { x:60, y:130 }, { x:18, y:-110 }, { x:-8, y:-130 }],
    fillColor:'#6d4c41', strokeColor:'#a1887f' }, rock));
  const hang = new Body(Object.assign({ type:'polygon', isStatic:true, x:cx + 150, y:gy - 500, layers:ROCK,
    verts:[{ x:-70, y:-40 }, { x:70, y:-40 }, { x:30, y:60 }, { x:-20, y:40 }],
    fillColor:'#6d4c41', strokeColor:'#a1887f' }, rock));
  objects.push(spire, hang);
  // 着陸船：胴＋脚2本＋足2つを1つに
  const sx = cx - 270, sy = gy - 120;     // 出発台の上面
  const hull = new Body({ type:'box', x:sx, y:sy - 46, w:40, h:30 });
  const legL = new Body({ type:'box', x:sx - 20, y:sy - 18, w:5, h:30, angle: 0.35 });
  const legR = new Body({ type:'box', x:sx + 20, y:sy - 18, w:5, h:30, angle:-0.35 });
  const footL = new Body({ type:'box', x:sx - 26, y:sy - 2, w:16, h:4 });
  const footR = new Body({ type:'box', x:sx + 26, y:sy - 2, w:16, h:4 });
  const ship = demoUnion(hull, legL, legR, footL, footR);
  Object.assign(ship, { layers:ROCK, restitution:0.4, friction:0.6, frictionStatic:0.7,
    fillColor:'#eceff1', strokeColor:'#546e7a', strokeWidth:1.5, label:'着陸船' });
  ship.setMass(LL_M);
  // 動力。★ローカル座標は重心から（図形和は重心が原点）。dir は +X が押す向き。
  const oy = hull.y - ship.y;             // 胴の中心の高さ（重心から）
  const main = new Thruster({ force:LL_MAIN, dir:-Math.PI/2, localX:0, localY:oy + 15 }, ship);
  const rcsL = new Thruster({ force:LL_RCS, dir:-Math.PI/2, localX:-20, localY:oy }, ship);
  const rcsR = new Thruster({ force:LL_RCS, dir: Math.PI/2, localX: 20, localY:oy }, ship);
  ship.thrusters.push(main, rcsL, rcsR);

  // ── プログラム ──
  const prog = (b, o, fy) => {
    const p = addProgram(b);
    Object.assign(p, o, { collapsed:true, fx:0.23, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  };
  prog(ship, { trigger:'hit', hitWhat:'env',  action:'color', color:'#ef5350' }, 0.535);
  prog(ship, { trigger:'hit', hitWhat:'env',  action:'pause' }, 0.58);
  prog(ship, { trigger:'hit', hitWhat:'same', action:'color', color:'#ef5350' }, 0.625);
  prog(ship, { trigger:'hit', hitWhat:'same', action:'pause' }, 0.67);
  //   ★台に載って止まったときの船の重心の高さ（板の上面から 33px ＝ 足の裏から重心まで）の帯
  prog(ship, { trigger:'zone', zx:px, zy:plateY - 6 - (sy - ship.y), zw:110, zh:24, action:'color', color:'#66bb6a' }, 0.715);
  //   ★底を打ったら合図2 → 船が赤くなる。強く降りると、板が沈む途中で船が上の帯を通って
  //     いったん緑になるので、赤で上書きする。★止めるのは 0.05秒遅らせる：合図は次の tick に
  //     届くので、同じ tick に止めると届かないまま止まり、船が緑のまま残った（実測）。
  prog(stop, { trigger:'hit', hitWhat:'body', action:'signal', sigOut:2 }, 0.76);
  prog(stop, { trigger:'hit', hitWhat:'body', action:'pause', delay:0.05 }, 0.805);
  prog(ship, { trigger:'signal', sigIn:2, action:'color', color:'#ef5350' }, 0.85);
  // ── リモコン ──
  const put = (r, o) => { if (!r) return; Object.assign(r, o, { collapsed:true }); placeRemotePanel(r); syncRemotePanel(r); };
  put(addRemote('thruster', main, 'thruster'), { kind:'thruster', mode:'on', key:'ArrowUp', fx:0.03, fy:0.535 });
  //   ★← で左へ傾く（反時計回り）＝左の動力が下向き・右が上向き＝登録した向きの逆
  put(addRemote('thruster', rcsL, 'thruster', [rcsL.id, rcsR.id]), { kind:'thruster', mode:'rev', key:'ArrowLeft',  fx:0.03, fy:0.35 });
  put(addRemote('thruster', rcsL, 'thruster', [rcsL.id, rcsR.id]), { kind:'thruster', mode:'on',  key:'ArrowRight', fx:0.23, fy:0.35 });
  const lab = (x, y, t) => demoLabel(x, y, t, '#eceff1', 15);
  lab(sx - 40, gy + 22, '出発台');
  lab(px - 30, gy + 22, '着陸台');
  lab(cx - 60, gy + 22, '谷底（触れたら失敗）');
  demoTitlePinned('月面着陸');
  demoNotePinned(
    '▶実行 して、↑ でエンジンを噴かし、← → で向きを変える。\n'
  + '右の着陸台に止まれば、台が緑になる。\n'
  + '・重力は月面（地球の約 1/6）。エンジンは船の向きに押す\n'
  + '・谷底や茶色の岩に触れたら失敗（船が赤くなって止まる）\n'
  + '・着陸台はばねで浮いている。速く降りると沈みきって\n'
  + '　赤い止めに当たり、失敗\n'
  + '・上のバーの ↩（Ctrl+Z）ではじめへ戻る\n'
  + 'しくみ：← → は左右の小さな動力を逆向きに同時に効かせる\n'
  + '偶力。押す力の合計は 0 で、回す働きだけが残る。');
}

// ── スイングバイ ─────────────────────────────────────────
//   ★部品は円（太陽・惑星）・生成口・プログラム・リモコン（つまみ）だけ。働く力は万有引力だけ。
//   ★本当のスイングバイは「動いている」惑星の後ろを通って速さをもらう。止まった星の横を
//     通るだけでは、近づくときにもらった速さを離れるときに同じだけ返す（行きと帰りで
//     エネルギーが変わらない）。だから惑星は太陽のまわりを回らせ、太陽だけ固定にする。
//   ★遊び方：生成口は内側の軌道にあり、真横（右）へ打ち出す。つまみで速さを決め、
//     ↑ で打つ。つまみの上限でも、自力では上のゴールの帯に届かない（下の★）。
//     惑星が来る時刻に合わせて打つと、惑星に後ろから引かれて外へ放り出される。
//   ★出てきた探査機は、太陽か惑星に当たると消え、20秒たつと消える（画面が埋まらないように）。
//     ゴールの帯に入ると緑になる。どれも生成口のプログラムを〈複製にも適用〉にして書く。
//   ★自力では届かないこと（実測。惑星を外して打つ）：いちばん遠くまで行く点は
//     1.7 m/s で 112px・1.9 で 186・2.0 で 253・2.05 で 300px。ゴールの帯は 470px から。
//     接線に打った楕円の遠い点の式 v² = 2GM·r/(r0(r0+r)) から出す値と一致する。
//   ★惑星を使えば届くこと（実測。0.1秒おきに1周ぶん＝100通りの時刻 × 速さ 15通りで打つ）：
//     帯に届いたのは 1,500 のうち 53。速さごとでは 1.95 m/s が 28/100 といちばん多く、
//     1.9 で 4、2.0 で 2、1.8 以下では 0。惑星にぶつかるのは速さによって 2〜8 割。
//     ＝打つ速さを決めてから、惑星の位置を見て時刻を合わせる遊びになる。
//     1.8 m/s 未満では惑星の軌道（200px）まで上がらないので、つまみの下限は 1.8。
//     ☆2026-09-27 に万有引力を位置の前後へ半分ずつにした（gravitation.js の★）。太陽・惑星・
//       探査機だけの場面で 1.8〜2.05 m/s × 100 時刻を打ち直すと、帯に届いたのは
//       旧 0/0/4/30/2/4 → 新 0/0/4/25/2/4（1.8, 1.85, 1.9, 1.95, 2.0, 2.05 の順）。
//       1.95 がいちばん届きやすいのは変わらない。
//   ★惑星の軌道は 22秒回したあとも半径 200.2px（ずれ 0.1%）。探査機は 0.01kg で、
//     惑星（3000kg）への引き戻しは無視できる。
const SB_G = 31.58;                       // 実効万有引力定数（下の SB_M と組んで G·M = 3.158e6 px³/s²）
const SB_M = 100000;                      // [kg] 太陽（固定）
const SB_SUN_R = 36;                      // [px]
const SB_RP = 200;                        // [px] 惑星の軌道半径。★周期 10 秒になる G·M を選んだ
const SB_MP = 3000;                       // [kg] 惑星（太陽の 3%）
const SB_PLANET_R = 14;                   // [px]
const SB_R0 = 110;                        // [px] 生成口（太陽の真下）
const SB_VLO = 1.8, SB_VHI = 2.05;        // [m/s] 打ち出す速さのつまみ（上の★）
const SB_GOAL_R = 470;                    // [px] ゴールの帯の下の縁（太陽の中心から上へ）
const SB_LIFE = 20;                       // [s] 探査機が消えるまで
function demoSwingBy() {
  resetDemoWorld();
  updateGroundTerrain(false);
  setDemoGravity(0);
  world.gravitation  = true;
  world.gravStrength = SB_G;
  world.gravSoften   = 1;                 // [px] 点の天体だけなので下げる（gravitation.js の★）
  world.sleeping     = false;
  setDemoCam(0, 0.56);
  const sx = cam.x + (765 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const sy = cam.y + (190 * demoFitScale()) / cam.zoom;
  // 太陽（固定）と惑星（太陽のまわりを回る）。★惑星は太陽の真上から左向きに出す＝
  //   生成口から右へ打った探査機と同じ向きに回る（同じ向きに回っていないと速さをもらえない）
  const sun = new Body({ type:'circle', x:sx, y:sy, radius:SB_SUN_R, mass:SB_M, isStatic:true, layers:0b0011,
    fillColor:'#ffb300', strokeColor:'#ffe082', strokeWidth:2, label:'太陽' });
  const vp = Math.sqrt(SB_G * SB_M * SB_RP * SB_RP / Math.pow(SB_RP * SB_RP + gravSoften2(), 1.5));
  const planet = new Body({ type:'circle', x:sx, y:sy - SB_RP, radius:SB_PLANET_R, mass:SB_MP, layers:0b0011,
    vx:-vp, fillColor:'#4fc3f7', strokeColor:'#e1f5fe', strokeWidth:1.5, label:'惑星' });
  planet.tracerEnabled = true; planet.tracerColor = '#4fc3f7'; planet.tracerDuration = 10;
  objects.push(sun, planet);
  // 生成口（太陽の真下。右へ打つ）
  const gun = new Body({ type:'circle', x:sx, y:sy + SB_R0, radius:6, mass:0.01, isSpawner:true,
    layers:0b0010, fixedRotation:true,
    tracerEnabled:true, tracerColor:'#ffee58', tracerDuration:SB_LIFE,
    fillColor:'#ffee58', strokeColor:'#ffffff', strokeWidth:1, label:'探査機' });
  gun.vx = 1.95 * M2PX;                  // ★開いたときのつまみは、いちばん届きやすい速さ（上の★）
  objects.push(gun);
  // ── プログラム（どれも〈複製にも適用〉で、出てきた探査機を見張る）──
  const prog = (o, fy) => {
    const p = addProgram(gun);
    Object.assign(p, o, { collapsed:true, fx:0.07, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  };
  const goalH = 90;
  prog({ trigger:'key', key:'ArrowUp', action:'create', scope:'copies', limit:30 }, 0.755);
  prog({ trigger:'hit', hitWhat:'body', action:'delete', target:'self' }, 0.80);
  prog({ trigger:'step', step:SB_LIFE * 60, times:1, action:'delete', target:'self' }, 0.845);
  prog({ trigger:'zone', zx:sx, zy:sy - SB_GOAL_R - goalH/2, zw:760, zh:goalH, action:'color', color:'#66bb6a' }, 0.89);
  // つまみ：打ち出す速さ
  const k = addRemote('prop', gun, 'body');
  if (k) { Object.assign(k, { prop:'vx', lo:SB_VLO, hi:SB_VHI, fx:0.03, fy:0.50 }); placeRemotePanel(k); syncRemotePanel(k); }
  const lab = (x, y, t, c) => demoLabel(x, y, t, c || '#eceff1', 22);
  lab(sx - 60, sy - SB_GOAL_R - goalH/2 + 8, 'ゴールの帯', '#a5d6a7');
  lab(sx + 14, sy + SB_R0 + 30, '生成口 → 右へ打つ', '#fff59d');
  lab(sx - 170, sy - SB_RP - 30, '惑星（左回り）', '#81d4fa');
  demoTitlePinned('スイングバイ');
  demoNotePinned(
    '▶実行 して、↑ で探査機を打ち出す。上のゴールの帯に届けば緑。\n'
  + '・つまみで打ち出す速さを変える。いちばん速くしても、\n'
  + '　自力では帯に届かない\n'
  + '・回っている惑星の「後ろ」をかすめると、引っぱられて\n'
  + '　速くなり、外へ放り出される。打つ時刻が鍵\n'
  + '・太陽や惑星に当たると消える。20秒たっても消える\n'
  + '\n'
  + '止まった星の横を通っても速くはならない。近づくときに\n'
  + 'もらった速さを、離れるときに同じだけ返すから。');
}

// ── 投石機 ───────────────────────────────────────────────
//   ★部品は四角形（やぐら・腕・おもり・留め具・城）・円（石）・ヒンジ・ロープ・リモコン・
//     プログラムだけ。吊りおもりを留め具の台に載せておき、↑ で留め具をすり抜けにすると
//     おもりが落ちて腕が振り上がり、ロープ（スリング）の先の石が振り回される。↓ で石を放す。
//   ★放すのはクレーンと同じ〈複製〉＋〈自分を削除〉（複製を先に）。写しは速度もそのまま持つ。
//   ★軸は背景に留めたヒンジ（モーター無し）。腕とおもりは図形和で1つにする。
//   ★衝突レイヤー：やぐら {3}・腕と留め具 {2}・おもり {4}・石と城 {1}。地面は全部。
//     腕は軸のところでやぐらと重なっているので、やぐらとは当てない。石は腕をすり抜ける。
//   ★おもり 30kg（実測。留め具を外してから放すまでの tick ごとに、石がどこへ行くか）：
//     〜74 tick … 城の手前に落ちる（0.9〜6.0 m）
//     76〜104 … 城に当たる。80〜104 の 0.4秒は王冠を落とす（赤くなる）
//     （2026-09-27 に接触の押し戻しを直したあとの値。直す前は 78〜104 だった）
//     106〜   … 腕の先から落ちるだけで、城の下の段に当たる
//     80kg では放す瞬間の石が 20 m/s に達し、城まで届く向きが 1 tick しか続かなかった。
//     20〜26kg では腕が振り切れず、石は腕の先から落ちるだけ（遠くへ飛ぶ時刻が無い）。
//   ★城の位置：石が 6.8m 進んだところで高さ 2.0m ＝王冠の段の高さになる（城を外して実測）。
//     城をそこから右に置けば、よく飛んだ石が上の段にじかに当たる。
//   ★待っている間は動かない（実測：10秒で腕 0.38°・城の積み木 2.5px）。
const TB_PIV_H = 210;                     // [px] 軸の高さ（地面から）
const TB_SHORT = 70, TB_LONG = 240;       // [px] 軸からおもり側・投げる側の腕の長さ
const TB_M_ARM = 6, TB_M_CW = 30;         // [kg] 腕・おもり（下の★）
const TB_SLING = 150;                     // [px] スリングの長さ
const TB_M_STONE = 2, TB_STONE_R = 10;    // [kg]・[px] 石
function demoTrebuchet() {
  resetDemoWorld();
  updateGroundTerrain(true);
  setDemoCam(0, 0.35);
  const cx = cam.x + (745 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y;
  const px = cx - 420, py = gy - TB_PIV_H;          // 軸
  const edge = { strokeColor:'#3e2723', strokeWidth:1.5 };
  // やぐら（飾り。軸は背景に留める）
  for (const dx of [-60, 60])
    objects.push(new Body(Object.assign({ type:'box', isStatic:true, x:px + dx/2, y:(py + gy)/2, w:12,
      h:Math.hypot(dx/2, gy - py), angle:Math.atan2(dx/2, gy - py), layers:0b0100,
      fillColor:'#8d6e63' }, edge)));
  // 腕（はじめは投げる側が左下。先端が地面の少し上）＋おもり
  const tipDrop = TB_PIV_H - 24;
  const a0 = Math.PI - Math.asin(tipDrop / TB_LONG);   // 軸から投げる側の先端への向き（左下）
  const ux = Math.cos(a0), uy = Math.sin(a0);
  const armC = { x:px + ux * (TB_LONG - TB_SHORT)/2, y:py + uy * (TB_LONG - TB_SHORT)/2 };
  const arm = new Body(Object.assign({ type:'box', x:armC.x, y:armC.y, w:TB_LONG + TB_SHORT, h:12,
    angle:a0 - Math.PI, fillColor:'#a1887f' }, edge));
  const beam = arm;
  Object.assign(beam, { layers:0b0010, mass:TB_M_ARM, label:'腕' });
  beam.setMass(TB_M_ARM);
  // おもり：腕の短い側の端からヒンジで吊る（吊りおもり式）。
  //   ★腕と図形和にすると、質量は面積の比で配られて重心が投げる側へ寄り（面積は腕のほうが
  //     大きい）、腕が振り上がらない。別の物体にしてヒンジで吊れば、質量をそのまま持たせられる。
  //     本物の投石機も吊りおもり式のほうが、おもりがまっすぐ落ちるぶん効率がよい。
  const cwX = px - ux * TB_SHORT, cwY = py - uy * TB_SHORT;   // 腕の短い側の端
  //   ★おもりには上へ吊り金具（細い四角）を足し、吊る点（腕の端）まで届かせる。ヒンジは画鋲で、
  //     重なった2つを1点で留めるもの。以前はおもりの箱が吊る点の 12px 下にあり、留め点が
  //     おもりの外＝手では組めなかった（2026-10-02 に直した）。腕 {2} とおもり {4} はもとから
  //     レイヤーが別なので、金具が腕と重なっても押し合わない。質量は 30kg のまま（setMass）。
  const cw = demoUnion(
    new Body(Object.assign({ type:'box', x:cwX, y:cwY + 40, w:56, h:56 }, edge)),
    new Body(Object.assign({ type:'box', x:cwX, y:cwY + 3, w:10, h:18 }, edge)));   // 吊り金具（吊る点の 6px 上まで）
  cw.setMass(TB_M_CW);
  Object.assign(cw, { layers:0b1000, fillColor:'#616161', label:'おもり' });
  objects.push(beam);
  // ★打つのは手のツールと同じ入口（demo-kit.js の demoPin）。
  //   軸の点には腕と、やぐらの2本の脚の上端が重なっている。'pair' では腕とやぐら（固定物）が
  //   つながる。物理は同じだが「軸は背景に留める」（冒頭の★）に合わせ、'board'（重なったものを
  //   全部背景へ。固定物は飛ばす）で腕だけを背景に留める。
  demoPin('hinge', px, py, 'board', { expect:[beam] });
  demoPin('hinge', cwX, cwY, 'pair', { expect:[beam, cw] });   // 吊り金具は腕の端と重なっている
  // 留め具：おもりの下に置いた台（おもり {4} だけを受ける）。
  //   ★はじめは腕の上の面を押さえる留め具にしたが、腕が毎 tick 沈み込んで抜けた
  //     （16 tick で 11px めり込み、2秒で 153° 回った）。原因はエンジンの側で、軸で留めた物体の
  //     めり込みを並進だけで押し戻していたこと（collision.js の correctContactPosition の★。
  //     2026-09-27 に直した。直したあとは同じ形の留め具で 10秒 0.41°・めり込み 1.15px）。
  //     台でおもりを受ける形はそのまま残した：どちらでも働き、こちらのほうが「おもりを
  //     支えている台を抜く」と見てすぐ分かる。腕は投げる側の重さで先端が地面に着いて止まる。
  const tip = { x:px + ux * TB_LONG, y:py + uy * TB_LONG };
  const catchBar = new Body(Object.assign({ type:'box', isStatic:true, x:cwX, y:cwY + 40 + 28 + 8, w:70, h:16,
    layers:0b1000, fillColor:'#ffb74d', strokeColor:'#e65100', label:'留め具' }, edge));
  objects.push(catchBar);
  // 石とスリング。★石は地面に置き、先端から右へ（やぐらの下をくぐる溝の上）
  const stone = new Body(Object.assign({ type:'circle', x:tip.x + TB_SLING, y:gy - TB_STONE_R, radius:TB_STONE_R,
    mass:TB_M_STONE, layers:0b0001, friction:0.4, frictionStatic:0.5, restitution:0.2,
    fillColor:'#bdbdbd', label:'石' }, edge));
  objects.push(stone);
  const sling = new Joint({ type:'rope', bodyA:beam, bodyB:stone, restLength:TB_SLING, maxLength:TB_SLING,
    linDensity:0.02, color:'#d7ccc8' });
  setJointEnd(sling, 'A', beam, tip.x, tip.y, false); setJointEnd(sling, 'B', stone, stone.x, stone.y, false);
  joints.push(sling);
  // 城：積み木（石と同じ {1}）。柱3本×2段の上に王冠
  const bx = cx + 370, bw = 36, bh = 70, span = 120;
  const blocks = [];
  const brick = (x, y, w, h, col) => { const b = new Body(Object.assign({ type:'box', x, y, w, h, mass:2,
    layers:0b0001, friction:0.6, frictionStatic:0.7, restitution:0.05, fillColor:col || '#90a4ae' }, edge)); blocks.push(b); return b; };
  for (let r = 0; r < 2; r++) {
    const y = gy - bh/2 - r * (bh + 12);
    for (const dx of [-span, 0, span]) brick(bx + dx, y, bw, bh);
    //   ★梁は柱の上で半分ずつ（真ん中の柱の上で 4px あける。重ねて置くと押し合って崩れる）
    const beamW = span + bw/2 - 2;
    for (const sg of [-1, 1]) brick(bx + sg * (beamW/2 + 2), y - bh/2 - 6, beamW, 12, '#78909c');
  }
  const king = brick(bx, gy - 2 * (bh + 12) - 20, 30, 40, '#ffd54f');
  king.label = '王冠';
  objects.push(...blocks);
  // ── プログラム ──
  const prog = (b, o, fy) => {
    const p = addProgram(b);
    Object.assign(p, o, { collapsed:true, fx:0.07, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  };
  //   ★複製を先に置く（クレーンの★と同じ。削除が先だと写しの元が無くなる）
  prog(stone, { trigger:'key', key:'ArrowDown', action:'spawn', limit:1 }, 0.78);
  prog(stone, { trigger:'key', key:'ArrowDown', action:'delete', target:'self' }, 0.825);
  //   ★「落とした」は2つの場所で見る：2段目の梁より下へ入った／もとの場所から右へ 40px 以上
  //     ずれた。地面に触れたらにすると、崩れた積み木の上に落ちた王冠は地面に届かず、
  //     落としたのに赤くならなかった。石は左から来るので、じかに当てると王冠は梁の上を
  //     右へ押し出される（実測：54px）。
  prog(king,  { trigger:'zone', zx:bx, zy:gy - 70, zw:900, zh:140, action:'color', color:'#ef5350' }, 0.87);
  prog(king,  { trigger:'zone', zx:bx + 40 + 200, zy:gy - 300, zw:400, zh:600, action:'color', color:'#ef5350' }, 0.915);
  // ── リモコン：↑ で留め具をすり抜けにする ──
  const r = addRemote('ghost', catchBar, 'body');
  if (r) { Object.assign(r, { kind:'ghost', key:'ArrowUp', fx:0.03, fy:0.55, collapsed:true }); placeRemotePanel(r); syncRemotePanel(r); }
  const lab = (x, y, t, c) => demoLabel(x, y, t, c || '#eceff1', 30);
  lab(cwX + 45, cwY + 80, '留め具 ↑');
  lab(bx - 40, gy + 30, '城');
  lab(stone.x - 20, gy + 30, '石');
  demoTitlePinned('投石機');
  demoNotePinned(
    '▶実行 して、↑ で留め具を外し、↓ で石を放す。\n'
  + '・おもりが落ちると腕が振り上がり、ロープの先の石が振り回される\n'
  + '・放す時刻で飛ぶ向きが変わる。早すぎると手前に落ち、\n'
  + '　遅すぎると腕の先から落ちるだけ。石が真上を過ぎたころが狙い目\n'
  + '・城のてっぺんの黄色い王冠が下へ落ちたら赤くなる\n'
  + '・上のバーの ↩（Ctrl+Z）ではじめへ戻る\n'
  + '\n'
  + 'しくみ：放すのは石のプログラム2つ（↓ で複製 → 自分を削除）。\n'
  + '写しは速度をそのまま持って飛んでいく。');
}

// ── 遊星歯車（その他 › 道具のしくみ。2026-09-27）──────────────────────────
//   ★歯車ツールと歯車コートの見本。部品は手で作れるものだけ：
//     外の輪 … 円 − 円（図形和の型抜き）に、つまみの出っ張り（四角）を足し、
//              穴の内壁に歯車コート → 内歯車 36枚
//     裏板 … 円（何とも当たらないレイヤー）。外の輪と溶接し、中心を軸で背景へ（⓪の★）
//     太陽・遊星 … 歯車ツール（12枚・12枚×3）
//     腕 … 四角3本と円の図形和。遊星の中心にヒンジ、中心に軸
//     リモコン3台（→ 太陽を回す／A 外の輪を止める／S 腕を止める）
//   ★組み立ての順番は「輪 → 遊星（輪に吸着）→ 太陽（遊星に吸着）」。
//     太陽から組むと遊星が輪の歯に 19px 食い込んだ（輪の歯の位相は刻んだときに決まって
//     いて、太陽に合わせた遊星とは合わない）。輪から組めば、組立条件
//     (Zs+Zr)/遊星の数 = 48/3 = 16 が整数なので、3つとも太陽にも輪にも食い込み 0 で入る。
//   ★止めるのは速さ0のモーター＋リモコン〈押している間だけ効く〉。押していない間は
//     軸は自由に回る（〈押している間だけ止める〉だと、押していない間に速さ0で解き続けて
//     ずっとブレーキになる）。
//   実測（乱数固定・300tick の平均。太陽は 3 rad/s・200 N·m）：
//     輪を止める → 腕 / 太陽 = 0.2503（理論 Zs/(Zs+Zr) = 1/4）
//     腕を止める → 輪 / 太陽 = −0.339（腕の漏れ 0.02 rad/s を差し引いた値。理論 −Zs/Zr = −1/3）
//     何も止めない → 腕が 1/4 で回り、輪はほぼ止まる（力は回しやすい＝軽い腕へ逃げる）
//   ★2026-09-28 上の「何も止めない」と、腕を止めたときに輪の速さが揺れる（−0.49±0.18・
//     太陽のモーターが上限に張り付き 100%）のは、眠りの判定が角速度だけを見ていたせいだった
//     （sleep.js の _sleepReach の★）。半径 2.25m の輪は 1rad/s でも「止まっている」扱いで
//     1秒ごとに速度を 0 に消されていた。直したあと（300tick の平均）：
//       腕を止める → 輪 −1.004±0.013（理論 −1）・張り付き 4%
//       輪を止める → 腕 0.748（理論 0.75）
//       何も止めない → 勢いのまま。はじめから → だけなら輪は −0.02 でほぼ腕だけが回る
//         （遊星3つが腕に載っていても、171kg の輪のほうが回しにくい）。S で輪を回して
//         から放すと輪は −0.956 で回り続け、A で止まる
//     残る差：何も止めないと、輪は 30秒で 0.1 rad/s ほど太陽の向きへ引きずられる。
//     歯の当たり（反発0）で運動エネルギーが減るため（惰性で回すと 10秒で 35%。角運動量は保存）。
//   ★重い。輪の凸パーツが 502 個あり、1tick 6.5ms（当たり判定 3.7ms）。
//     歯面の折れ線を5本→3本にすると 4.9ms になるが、歯数8の相手とのがたつきが増え、
//     内歯車に 0.03px 食い込むので採らなかった（gear.js の GEAR_FLANK_PTS）。
//     2026-09-27 凸分解の修正（convex.js の mergeConvex・外接円のふるい）で、デモ全体の
//     凸パーツ 610→545 個・組み立て 1.9秒→0.1秒・1tick 5.7→3.8ms（全デモ比較の計測）。
const PG_M = 10;                          // [px] 歯の大きさ（モジュール）
const PG_ZS = 12, PG_ZP = 12, PG_ZR = PG_ZS + 2 * PG_ZP;   // 太陽・遊星・外の輪（36）
const PG_RIM = 45;                        // [px] 外の輪の歯元から外周までの厚み
const PG_W = 3, PG_T = 200;               // [rad/s]・[N·m] 太陽のモーター
const PG_HOLD_T = 5000;                   // [N·m] 止める手（速さ0のモーター）の強さ
function demoPlanetaryGear() {
  resetDemoWorld();
  updateGroundTerrain(false);
  setDemoCam(0, 0.9);
  const s = demoFitScale();
  const toWX = sx => cam.x + (sx - canvas.width  / 2) / cam.zoom;
  const toWY = sy => cam.y + (sy - canvas.height / 2) / cam.zoom;
  const cx = toWX(745 * s), cy = toWY(320 * s);
  const G = 0b0001, ARM = 0b0100;          // 歯車どうしは当たる／腕は歯車と当たらない
  const P = { restitution: 0, friction: 0, frictionStatic: 0, density: 600, layers: G, strokeColor: '#263238', strokeWidth: 1.2 };
  const saveM = gearModule;
  gearModule = PG_M;
  const Rr = PG_M * PG_ZR / 2;
  // ⓪ 外の輪の裏板。★外の輪は中心が穴なので、中心に軸（画鋲）を刺せない。そこで輪の裏に
  //   同じ大きさの円板を置いて輪と溶接し、その円板の中心を背景に軸で留める（実物の内歯車が
  //   裏蓋で軸に支えられているのと同じ形）。以前は輪そのものを穴の中心で軸に留めていて、
  //   手では組めなかった（2026-10-02 に直した。軸・溶接は画鋲：重なった2つを1点で留める）。
  //   ★レイヤーは歯車とも腕とも別（PLATE）＝何にも当たらない。いちばん先に置いて奥に描く。
  //   ★質量は 40 kg。軽いと溶接がたわむ：2 kg では 171 kg の輪が重さで裏板にぶら下がり、
  //     輪の中心が 1.4px ずれて、何も止めないときの輪が −0.03 → ＋0.18 rad/s と逆へ回った。
  //     40 kg なら直す前と同じ（300tick の平均。輪を止める：腕/太陽 0.2504 → 0.2503、
  //     腕を止める：輪/太陽 −0.3311 → −0.3313、何も止めない：腕 0.726 → 0.730・輪 −0.032 → −0.028、
  //     輪の中心のずれ 0.03px）。171 kg（輪と同じ）にしても値はほぼ同じで、重くする理由はない。
  const PLATE = 0b1000;
  const plate = new Body({ type: 'circle', x: cx, y: cy, radius: Rr + PG_RIM, mass: 40, layers: PLATE,
    restitution: 0, friction: 0, frictionStatic: 0, fillColor: '#263238', strokeColor: '#37474f', strokeWidth: 1.2,
    label: '外の輪の裏板' });
  objects.push(plate);
  // ① 外の輪：円 − 円 → つまみを足す → 内壁に歯車コート
  let ring = demoBoolean('diff', [new Body({ type: 'circle', x: cx, y: cy, radius: Rr + PG_RIM, ...P }),
                                  new Body({ type: 'circle', x: cx, y: cy, radius: Rr, ...P })]);
  //   ★つまみは上下に2つ（輪の重心を軸に合わせる）。1つだけだと重心が軸から 2.3px ずれ、
  //     重力が振り子のように輪を揺すった：何も止めずに → を押すと、輪が 40秒で
  //     −0.05 → −0.38 → +0.37 rad/s とさまよった（輪の重力を切ると 0 に落ち着く）。
  ring = demoUnion(ring, new Body({ type: 'box', x: cx, y: cy - Rr - PG_RIM - 8, w: 26, h: 26, ...P }),
                         new Body({ type: 'box', x: cx, y: cy + Rr + PG_RIM + 8, w: 26, h: 26, ...P }));
  ring.fillColor = '#90a4ae'; ring.strokeColor = '#263238';
  const face = gearCoatFaceAt(ring, cx + Rr, cy);
  const carved = gearCoatCarve(ring, face, PG_M);
  reshapeBodyInPlace(ring, carved.verts, carved.holes, carved.arcs, carved.rec);
  // ② 遊星3つ：輪に吸着（真上から120°ごと）
  const a = PG_M * (PG_ZS + PG_ZP) / 2, planets = [];
  for (let k = 0; k < 3; k++) {
    const th = -Math.PI / 2 + k * 2 * Math.PI / 3;
    const pose = gearMeshPose(cx + a * Math.cos(th), cy + a * Math.sin(th), PG_ZP, PG_M, null, ring);
    const p = new Body({ type: 'polygon', x: pose.x, y: pose.y, angle: pose.angle,
      verts: gearOutline(PG_ZP, PG_M), gear: { z: PG_ZP, m: PG_M }, ...P, fillColor: '#4fc3f7' });
    objects.push(p); planets.push(p);
  }
  // ③ 太陽：遊星に吸着（中心に来る）
  const sp = gearMeshPose(cx, cy, PG_ZS, PG_M, null, planets[0]);
  const sun = new Body({ type: 'polygon', x: sp.x, y: sp.y, angle: sp.angle,
    verts: gearOutline(PG_ZS, PG_M), gear: { z: PG_ZS, m: PG_M }, ...P, fillColor: '#ffb74d' });
  objects.push(sun);
  gearModule = saveM;
  // ④ 腕：中心から遊星の中心へ3本。歯車とは別のレイヤーで、手前に半透明で描く
  const arms = planets.map(p => { const dx = p.x - cx, dy = p.y - cy;
    return new Body({ type: 'box', x: cx + dx / 2, y: cy + dy / 2, w: a, h: 14, angle: Math.atan2(dy, dx), layers: ARM, density: 600 }); });
  const carrier = demoUnion(...arms, new Body({ type: 'circle', x: cx, y: cy, radius: 20, layers: ARM, density: 600 }));
  carrier.fillColor = '#66bb6a'; carrier.strokeColor = '#1b5e20'; carrier.alpha = 0.75;
  sun.label = '太陽歯車'; ring.label = '外の輪'; carrier.label = '腕';
  planets.forEach((p, k) => { p.label = '遊星歯車' + (k + 1); });
  // ⑤ 軸とヒンジ
  //   ★打つのは手のツールと同じ入口（demo-kit.js の demoPin）。
  //   中心には太陽・腕・裏板が重なっている。手のモーターツールの留め先〈重なったものを全部、
  //   背景に留める〉で1度に3本打ち（'board'）、そのあと1本ずつ設定する（手なら右クリックの
  //   「この場所の要素」で選んで右パネルで直す）。spin で3つとも背景に対して ＋に回る向きにそろえる。
  const center = demoPin('axle', cx, cy, 'board', { expect:[sun, carrier, plate], spin:[sun, carrier, plate],
                                                    motorTorque: PG_HOLD_T });
  const onBody = b => center.find(j => j.bodyB === b);
  const jSun = onBody(sun), jRing = onBody(plate), jArm = onBody(carrier);
  jSun.motorSpeed = PG_W; jSun.motorTorque = PG_T;
  // ★輪は裏板と溶接し（輪の縁の上で。輪と裏板が重なっている）、軸は裏板の中心（⓪の★）
  demoPin('fixjoint', cx, cy - Rr - PG_RIM / 2, 'pair', { expect:[ring, plate] });
  for (const p of planets) demoPin('hinge', p.x, p.y, 'pair', { expect:[carrier, p] });
  // ── 札 ──
  const ts = demoTextScale(cam.zoom), LS = DEMO_NOTE_SIZE * ts * 0.9;
  demoLabel(cx - 40 * ts, cy + 28 * ts, '太陽', '#ffe0b2', LS, true);
  demoLabel(cx - 80 * ts, cy + Rr + PG_RIM + 30 * ts, '外の輪（内歯車）', '#cfd8dc', LS, true);
  demoLabel(planets[0].x + 70 * ts, planets[0].y - 10 * ts, '遊星', '#b3e5fc', LS, true);
  // ── 本文 ──
  const p0 = demoTextTopLeft();
  const NOTE =
      '▶実行 して、→ を押している間、まん中の太陽歯車が回る。\n'
    + '→ と一緒に押すキーで、どこを止めるかを選ぶ：\n'
    + '・A：外の輪を止める → 緑の腕が同じ向きにゆっくり回る\n'
    + '　（太陽が4回まわると腕が1回。遅くなるぶん回す力は強い）\n'
    + '・S：腕を止める → 外の輪が逆向きに回る\n'
    + '・どちらも止めない → どこも止まらず、勢いのまま回る\n'
    + '　（S で輪を回してから放すと、輪は回り続ける。そこで A）\n'
    + '\n'
    + '同じ一組の歯車で、止める所を変えるだけで\n'
    + '減速・逆転を切り替えられる。自動車の自動変速機は\n'
    + 'これを何組も重ねて、止める所をブレーキで切り替えている。\n'
    + '\n'
    + '部品：外の輪＝円の型抜き＋歯車コート、太陽と遊星＝歯車、\n'
    + '腕＝四角の和、軸とヒンジ、リモコン3台。\n'
    + '力は歯どうしがぶつかって伝わる（歯車専用のしくみは無い）';
  const noteY = p0.y + 54 * ts;
  demoNote(p0.x, noteY, NOTE, DEMO_NOTE_SIZE * ts);
  demoTitle(p0.x, p0.y, '遊星歯車', DEMO_TITLE_SIZE * ts);
  // ── リモコン：本文の下に横1列 ──
  const toSY = wy => (wy - cam.y) * cam.zoom + canvas.height / 2;
  const noteBot = toSY(demoNoteBelow(noteY, NOTE, 0, DEMO_NOTE_SIZE * ts));
  const rs = [];
  for (const [j, key] of [[jSun, 'ArrowRight'], [jRing, 'KeyA'], [jArm, 'KeyS']]) {
    const r = addRemote('motor', j);
    if (!r) continue;
    r.mode = 'on'; r.key = key; r.collapsed = true;
    syncRemotePanel(r);          // ★幅を測る前に中身を入れる
    rs.push(r);
  }
  // ★左端は 56（窓の位置はツールバーを含む親の幅で測られ、56 未満は押し戻される。
  //   22 を渡したら1枚目だけが押し戻されて2枚目に重なった）
  //   ★1列に3枚並べると3枚目が外の輪の左端にかかったので、2枚＋1枚の2段にする
  dcPlaceRow(rs.slice(0, 2), 56, noteBot + 8);
  if (rs[2]) dcPlaceRow(rs.slice(2), 56, noteBot + 8 + (rs[0].panel.offsetHeight || 120) + 6);
}

// ── 歯車の時計（その他 › 道具のしくみ。2026-09-27）────────────────────────
//   リモコン1台（→）で秒の軸だけを回し、分針・時針は歯車の列で 1/60・1/12 に落として回す。
//   部品は手で作れるものだけ：歯車ツール（8枚の小歯車4つ・24/32/48/80枚）、針＝四角
//   （レイヤーを全部外して何とも当たらない）、軸・ヒンジ・溶接、リモコン1台。
//   ★3本の針は同じ中心（同軸）。中心の軸には 秒の歯車・分の大歯車・分の小歯車・時の歯車 の
//     4枚が重なるので、4枚を別々のレイヤーに置き、かみ合う相手とだけ同じレイヤーにする：
//       L1 秒の小歯車 8 ↔ 中継A 48    L2 中継A 8 ↔ 分の大歯車 80
//       L3 分の小歯車 8 ↔ 中継B 24    L4 中継B 8 ↔ 時の歯車 32
//     レイヤーはちょうど4つで足りる（LAYER_COUNT = 4）。
//   ★中継の軸は1本ずつ。中心から出て中心へ戻るので、かみ合いは2回＝向きが揃う
//     （中継を2本にすると3回かみ合って分針が逆に回る）。
//     1/60 = (8/48)(8/80)。2組のかみ合いの中心距離を揃えるため歯の大きさを変える：
//       11·(8+48)/2 = 7·(8+80)/2 = 308px。1/12 = (8/24)(8/32) は 10·32/2 = 8·40/2 = 160px。
//     8枚の小歯車1段で 1/60 を割る組は、これが最も小さい（大歯車の半径 280px）。
//   ★モーターは 10000 N·m・〈放したら止める〉。2000 だと放してから秒針が 141° 惰性で進んだ
//     （大歯車が重い）。10000 で 29〜32°、40000 で 12°。
//   実測（押し続けて 600tick の前後差）：秒→分 0.01669（理論 1/60）、分→時 0.0835（理論 1/12）。
//     30秒押すと分針 0.997 回転・時針 29.9°（理論 1回転・30°）。秒の軸を 50 rad/s まで上げても
//     比は変わらない（歯を飛ばさない）。押さずに10秒置くと、時針が自分の重さで 0.16° 下がるだけ。
//   ★1tick 5.3ms（はじめは 9.6ms）。分の大歯車（80枚）が凸パーツ 458 個に割れ、中を横切る
//     細長いパーツが AABB のふるいを抜けていた（1回の判定で SAT 187 回）。凸分解を直して
//     81 個（歯80＋歯元1）になり、パーツの外接円でもふるうようにした（convex.js・collision.js の★）。
const GC_W = 4 * Math.PI;                  // [rad/s] 秒の軸のモーター（1秒で2周＝実際の120倍）
const GC_T = 10000;                        // [N·m]（上の★）
function demoGearClock() {
  resetDemoWorld();
  updateGroundTerrain(false);
  setDemoCam(0, 0.6);
  const s = demoFitScale();
  const toWX = sx => cam.x + (sx - canvas.width  / 2) / cam.zoom;
  const toWY = sy => cam.y + (sy - canvas.height / 2) / cam.zoom;
  const cx = toWX(755 * s), cy = toWY(275 * s);
  const L1 = 0b0001, L2 = 0b0010, L3 = 0b0100, L4 = 0b1000;
  const P = { restitution: 0, friction: 0, frictionStatic: 0, density: 600, strokeColor: '#263238', strokeWidth: 1.2 };
  const gear = (x, y, z, m, layers, fill, only, angle) => {
    const pose = only ? gearMeshPose(x, y, z, m, null, only) : { x, y, angle: angle || 0 };
    const g = new Body({ type: 'polygon', x: pose.x, y: pose.y, angle: pose.angle,
      verts: gearOutline(z, m), gear: { z, m }, ...P, layers, fillColor: fill });
    objects.push(g); return g;
  };
  // 中継の軸の置き場所：A は右下、B は左下
  const dA = 11 * (8 + 48) / 2, thA = Math.PI * 0.40;
  const dB = 10 * (8 + 24) / 2, thB = Math.PI * 0.80;
  const ax = cx + dA * Math.cos(thA), ay = cy + dA * Math.sin(thA);
  const bx = cx + dB * Math.cos(thB), by = cy + dB * Math.sin(thB);
  // ① 分→時（奥に描く小さい列から）
  const m2 = gear(cx, cy, 8, 10, L3, '#ffb74d');
  const b1 = gear(bx, by, 24, 10, L3, '#ffe0b2', m2);
  const b2 = gear(bx, by, 8, 8, L4, '#ce93d8', null, 0);
  const h1 = gear(cx, cy, 32, 8, L4, '#ce93d8', b2);
  // ② 秒→分
  const s1 = gear(cx, cy, 8, 11, L1, '#ef9a9a');
  const a1 = gear(ax, ay, 48, 11, L1, '#ef9a9a', s1);
  const a2 = gear(ax, ay, 8, 7, L2, '#90caf9', null, 0);
  const m1 = gear(cx, cy, 80, 7, L2, '#90caf9', a2);
  // 奥から：分の大歯車 → 中継A → 時の列 → 秒の小歯車
  for (const g of [m1, a1, a2, b1, b2, h1, m2, s1]) { objects.splice(objects.indexOf(g), 1); objects.push(g); }
  for (const g of [m1, a1, h1, b1]) g.alpha = 0.8;
  // ★中継B の目印。針の付かない歯車はこれだけで、分針の 1/3（毎秒 4°）でしか回らないので、
  //   歯の並んだ円のままでは止まって見えた（ユーザーの指摘）。レイヤーを全部外した棒を溶接する
  const markB = new Body({ type: 'box', x: bx, y: by, w: 10 * 24 - 30, h: 10, angle: 0,
    density: 100, layers: 0, fillColor: '#8d6e63', strokeColor: '#4e342e', strokeWidth: 1, label: '中継Bの目印' });
  objects.splice(objects.indexOf(b2), 0, markB);
  s1.label = '秒の歯車'; a1.label = '中継A 48'; a2.label = '中継A 8'; m1.label = '分の歯車';
  m2.label = '分の小歯車'; b1.label = '中継B 24'; b2.label = '中継B 8'; h1.label = '時の歯車';
  // ③ 針：レイヤーを全部外す（何とも当たらない）。根元を中心に少し出す
  const hand = (len, w, fill, deg, label) => {
    const th = (deg - 90) * Math.PI / 180, c = len / 2 - 20;
    const b = new Body({ type: 'box', x: cx + c * Math.cos(th), y: cy + c * Math.sin(th), w: len, h: w, angle: th,
      density: 100, layers: 0, fillColor: fill, strokeColor: '#212121', strokeWidth: 1, label });
    objects.push(b); return b;
  };
  // 10時10分0秒から
  const hH = hand(170, 18, '#6a1b9a', (10 + 10 / 60) * 30, '時針');
  const hM = hand(260, 12, '#1565c0', 10 * 6, '分針');
  const hS = hand(290, 5, '#c62828', 0, '秒針');
  const cap = new Body({ type: 'circle', x: cx, y: cy, radius: 14, density: 100, layers: 0,
    fillColor: '#37474f', strokeColor: '#212121' });
  objects.push(cap);
  // ④ 軸・ヒンジ・溶接
  const J = (type, A, B, x, y, o) => { const j = new Joint({ type, bodyA: A, bodyB: B, ...(o || {}) });
    setJointEnd(j, 'A', A, x, y, false); setJointEnd(j, 'B', B, x, y, false); joints.push(j); return j; };
  // ★秒の軸だけがモーター。〈放したら止める〉で、放すと3本とも止まる（摩擦の無い軸は惰性で回り続ける）
  const jSec = J('axle', null, s1, cx, cy, { motorSpeed: GC_W, motorTorque: GC_T, motorBrake: true });
  J('fixjoint', s1, hS, cx, cy);
  J('hinge', null, a1, ax, ay); J('fixjoint', a1, a2, ax, ay);
  J('hinge', null, m1, cx, cy); J('fixjoint', m1, m2, cx, cy); J('fixjoint', m1, hM, cx, cy);
  J('hinge', null, b1, bx, by); J('fixjoint', b1, b2, bx, by); J('fixjoint', b1, markB, bx, by);
  J('hinge', null, h1, cx, cy); J('fixjoint', h1, hH, cx, cy);
  J('fixjoint', s1, cap, cx, cy);
  // ── 文字盤の数字 ──
  const ts = demoTextScale(cam.zoom), LS = DEMO_NOTE_SIZE * ts;
  const RN = 330;
  for (let k = 1; k <= 12; k++) {
    const th = (k * 30 - 90) * Math.PI / 180;
    demoLabel(cx + RN * Math.cos(th) - 8 * ts, cy + RN * Math.sin(th) + 6 * ts, String(k), '#eceff1', LS * 1.2, true);
  }
  // ── 本文 ──
  const p0 = demoTextTopLeft();
  const NOTE =
      '▶実行 して → を押している間、秒の軸のモーターが回る。\n'
    + '動力はこの1つだけ。分針・時針は歯車で回される。\n'
    + '\n'
    + '秒 → 分：8枚 → 48枚、同じ軸の8枚 → 80枚\n'
    + '　（1/6 × 1/10 ＝ 1/60）\n'
    + '分 → 時：8枚 → 24枚、同じ軸の8枚 → 32枚\n'
    + '　（1/3 × 1/4 ＝ 1/12）\n'
    + '\n'
    + '3本の針は同じ中心で、別々の軸に付いている。\n'
    + '重なった歯車は衝突レイヤーを分けて、\n'
    + 'かみ合う相手とだけ当たるようにしてある。\n'
    + '中継の軸を1本はさむと、かみ合いが2回で向きが戻る。\n'
    + '\n'
    + '部品：歯車・四角（針。レイヤーを全部外す）、\n'
    + '軸・ヒンジ・溶接、リモコン1台。\n'
    + '茶色の棒は、針の無い中継Bが回るのを見る目印。';
  const noteY = p0.y + 54 * ts;
  demoNote(p0.x, noteY, NOTE, DEMO_NOTE_SIZE * ts);
  demoTitle(p0.x, p0.y, '歯車の時計', DEMO_TITLE_SIZE * ts);
  const toSY = wy => (wy - cam.y) * cam.zoom + canvas.height / 2;
  const noteBot = toSY(demoNoteBelow(noteY, NOTE, 0, DEMO_NOTE_SIZE * ts));
  const r = addRemote('motor', jSec);
  if (r) {
    r.mode = 'on'; r.key = 'ArrowRight'; r.collapsed = true;
    syncRemotePanel(r);
    dcPlaceRow([r], 56, noteBot + 8);
  }
}

// ── 黒い板と磨いた板（その他 › 道具のしくみ。2026-09-28 遊びから移した）──────────
//   ★放射と〈温度が○〜○℃になったら〉の見本。真ん中の恒温の熱源から等距離に、放射率だけが
//     違う2枚の板を置く。板のプログラムが 50℃ で合図を出し、合図を受けた棚が消えて球が落ちる。
//   ★はじめは衝立が黒い板の前にある。▶実行 だけだと磨いた板が先に開く。途中で衝立を
//     〈つかむ〉でどければ黒い板が追い抜く＝「どこまで待てるか」の遊び。
//     衝立を最初から外しておくと、黒い板が3秒で開いて終わる（遊ぶ余地が無い）。
//   ★部品は四角形・円・プログラム4つだけ（熱源は恒温、板と衝立は放射率を右パネルで入れる）。
//   ★倍率 RB_RATE と磨いた板の放射率 RB_EPS の選び方（実測。板 16×80・熱源 500℃・距離 250px、
//     50℃ に届くまで）：上がり方は「放射率 × 倍率」に比例するので、時間の比は 0.9／ε で決まる。
//         倍率 1500・ε0.05   黒 6.1秒  磨 109.1秒
//         倍率 1500・ε0.1    黒 6.1秒  磨  54.6秒
//         倍率 3000・ε0.1    黒 3.0秒  磨  27.3秒   ← これ
//     ε0.05（よく磨いたアルミ）だと待つ側が長すぎる。ε0.1 は磨いた鋼くらい。
//     黒い板は衝立をどけてから 3 秒で届くので、磨いた板が 24 秒のあたりまでに
//     どければ黒い板が勝つ。
//   ★衝立は放射率・比熱・熱伝導率を 0 にする（放射デモの衝立と同じ）。自分が温まって
//     二次的に放射すると「遮った」が崩れる。
//   ★球と棚は板と熱源を結ぶ線から外す。放射の影は中心どうしを結ぶ1本で判定するので、
//     線の上に何か置くとそれも衝立になる。
const RB_RATE = 3000;         // このデモの熱の伝わる速さの倍率（上の★）
const RB_EPS  = 0.1;          // 磨いた板の放射率（上の★）
const RB_D    = 250;          // [px] 熱源から板まで
const RB_TH   = 50;           // [℃] 棚が消える温度
function demoRadiationRace() {
  resetDemoWorld();
  updateGroundTerrain(true);
  world.sleeping = false;
  world.thermalOn = true;
  world.thermalRate = RB_RATE;
  world.ambientTemp = C2K(20);
  world.thermalViz = true;
  world.thermalVizMin = 20; world.thermalVizMax = 80;
  setDemoCam(0, 0.62);
  const cx = cam.x + (770 * demoFitScale() - canvas.width / 2) / cam.zoom;
  const gy = ground.y, hy = gy - 170;           // 熱源と板の中心の高さ
  const hot = new Body({ type:'box', isStatic:true, x:cx, y:hy, w:70, h:70, density:2700,
    heatCap:900, conduct:200, temp:C2K(500), tempFixed:true, emissivity:1,
    fillColor:'#b71c1c', strokeColor:'#ff8a80', strokeWidth:2, label:'熱源 500℃' });
  hot.setMass(hot.massFromDensity());
  const plate = (x, eps, o) => {
    const b = new Body(Object.assign({ type:'box', isStatic:true, x, y:hy, w:16, h:80, density:2700,
      heatCap:900, conduct:200, emissivity:eps, strokeColor:'#eceff1', strokeWidth:1.5 }, o));
    b.setMass(b.massFromDensity());
    return b;
  };
  // ★磨いた板は枠を白く太くする（温度で塗るので、中の色では見分けられない。放射デモと同じ）
  const black = plate(cx - RB_D, 0.9,    { label:'黒い板 ε0.9' });
  const shiny = plate(cx + RB_D, RB_EPS, { label:'磨いた板 ε' + RB_EPS, strokeColor:'#ffffff', strokeWidth:4 });
  objects.push(hot, black, shiny);
  // ── 衝立（黒い板の前。地面に立っている＝つかんで動かせる）──
  const shield = new Body({ type:'box', x:cx - RB_D / 2, y:gy - 115, w:14, h:230, density:600,
    emissivity:0, heatCap:0, conduct:0, friction:0.6, frictionStatic:0.8, restitution:0,
    fillColor:'#263238', strokeColor:'#78909c', strokeWidth:2, label:'衝立' });
  shield.setMass(shield.massFromDensity());
  objects.push(shield);
  // ── 棚と球（板の外側。熱源と板を結ぶ線より上）──
  const soft = { restitution:0.1, friction:0.5, frictionStatic:0.6, strokeWidth:1.5 };
  const lane = (x, col) => {
    const shelf = new Body(Object.assign({ type:'box', isStatic:true, x, y:hy - 110, w:56, h:10,
      fillColor:'#ffb74d', strokeColor:'#e65100' }, soft));
    const ball = new Body(Object.assign({ type:'circle', x, y:hy - 110 - 5 - 14, radius:14, mass:1,
      fillColor:col, strokeColor:'#263238' }, soft));
    objects.push(shelf, ball);
    return shelf;
  };
  const shelfB = lane(cx - RB_D - 60, '#90a4ae');
  const shelfS = lane(cx + RB_D + 60, '#eceff1');
  // ── プログラム ──
  const prog = (b, o, fy) => {
    const p = addProgram(b);
    Object.assign(p, o, { collapsed:true, fx:0.07, fy });
    p.reset(); syncProgramState(p); syncProgramPanel(p); placeProgramPanel(p);
  };
  const T = { trigger:'temp', tempMin:C2K(RB_TH), tempMax:C2K(1000), action:'signal' };
  prog(black,  Object.assign({ sigOut:1 }, T), 0.70);
  prog(shelfB, { trigger:'signal', sigIn:1, action:'delete', target:'self' }, 0.76);
  prog(shiny,  Object.assign({ sigOut:2 }, T), 0.82);
  prog(shelfS, { trigger:'signal', sigIn:2, action:'delete', target:'self' }, 0.88);
  demoLabel(cx - 150, hy - 170, RB_TH + '℃ になった板の側の棚が消える', '#eceff1', 16);
  moveDemoGraphTop(sizeDemoGraph(tempGraphNew([black.id, shiny.id]), 400, 240));
  demoTitlePinned('黒い板と磨いた板');
  demoNotePinned(
    '真ん中の熱源から同じ距離に2枚の板。違うのは\n'
  + '表面だけ（黒い面と磨いた面）。どちらも熱源に\n'
  + '触れていない。熱は放射で届く。\n'
  + '\n'
  + '【遊び方】▶実行 する。いまは衝立が黒い板の\n'
  + '前にあるので、磨いた板がゆっくり温まっていく。\n'
  + '好きなときに Space を押したまま衝立をつかんで\n'
  + 'どける。黒い板はすぐに追いつく。\n'
  + '磨いた板の球が落ちる前に黒い板の球を落とせば\n'
  + '勝ち。どこまで待てるか。\n'
  + '\n'
  + 'しくみ：板のプログラム〈温度が○〜○℃になったら〉\n'
  + '→〈合図を出す〉、棚の〈合図を受けたら〉→〈削除〉。\n'
  + '黒い面はよく吸い、磨いた面ははね返す。');
}
