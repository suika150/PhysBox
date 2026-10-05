// ════════════════════════════════════════
//  デモシーンの共通の道具と約束
// ════════════════════════════════════════
//  ★分野ごとの実装ファイル（js/app/demos-*.js）が共通で使う見せ方をここに集める。
//    どんなデモがあるかはここには一切書かない ＝ 一覧は目録（js/app/demos.js）の側だけ。
//  ★実装関数の約束：呼ばれた時点で clearScene() と simPause() は済んでいる（窓側が先に呼ぶ）。
//    world / ground を書き換えてよい（全体設定タブは窓側が syncWorldPanel() で作り直す）。
//    最後に cam を題材が収まる位置へ動かすこと。
//  ★どのデモも一時停止の状態で開く。止めるのは窓側（js/ui/demo-browser.js の runDemo）の
//    仕事なので、デモ側に simPause() は書かない。矢印を出すために simTick() を回して
//    落ち着かせるデモも、running が false のまま回るので何も足さなくてよい。
//  ★グラフの窓は、その題材に要るものだけをデモ側で開く。
//    要らない窓を畳む処理は書かなくてよい：clearScene() が closeAllGraphWindows() を
//    通るので（js/app/history.js）、デモの開始時点で窓は必ず1つも開いていない。
//    ＝「開けたものが出ている窓のすべて」になる。開けかたは対象を渡すだけ：
//      velGraphNew(body, opts)      速度（1窓=1物体）
//      eneGraphNew([bodyId,…], opts) 力学的エネルギー（1窓=1系。相手のいる位置エネルギーがあるため）
//      momGraphNew([bodyId,…], opts) 運動量（同上）
//      tempGraphNew([bodyId,…], opts) 温度（液体・気体の系列は向こうが今のシーンから作る）
//      pvGraphNew(chamber, opts)    P-V（1窓=1気体室）
//      circGraphOpen([elemId,…], opts) 回路（1窓=1回路。4手の作法は向こうにまとめてある）
//    opts は窓ごとの表示の選択（js/app/scene-io.js の GRAPH_OPT_KEYS がその一覧）。
//    記録は「実行」を押してから始まるので、デモ側で走らせる必要はない。
//  ★説明書きを必ず画面に置く（demoTitle / demoNote / demoLabel / demoArrow）。
//    「何をすれば何が見えるか」＝手順と読みどころを、外の説明なしに辿れるようにする。
// ── デモ共通の見せ方 ────────────────────────────────────
//  ★地面は画面の下から1/5に置く。デモ全部でこの高さに揃えると、続けて開いたときに
//    画面が跳ねない。起動時の初期位置（js/app/init.js の 0.4＝地面が9割の高さ）とは
//    別の値なので、デモ側はこの関数を通すこと。
const DEMO_GROUND_FRAC = 0.2;                  // 画面に占める地面の割合
// ★倍率は「基準の窓のときの値」として受け取り、実際の窓の大きさに合わせて掛け直す。
//   説明文は画面の左うえの角から置く（demoTextTopLeft）ので、倍率を決め打ちにすると
//   窓が小さいほど角がワールド座標で内側へ寄り、決め打ちで置いた物体に文字が乗る。
//   逆に窓が大きいと文字だけ遠くへ離れていく。＝「窓の大きさで文字の出る場所が変わる」。
//   倍率を窓の大きさに比例させると、見える範囲がワールドで一定になり、文字と物体の
//   位置関係が窓によらず同じになる（全体が拡大縮小するだけの、図版と同じふるまい）。
// ★掛ける比は幅と高さの小さいほう。こうすると基準の窓で収まっていたものは
//   どんな形の窓でも必ず収まり、余った側は余白になるだけで、何かが隠れることがない。
const DEMO_REF_W = 998;   // [px] デモの配置を決めたときのキャンバスの大きさ
const DEMO_REF_H = 736;
function demoFitScale() {
  return Math.min(canvas.width / DEMO_REF_W, canvas.height / DEMO_REF_H);
}
function demoZoomFit(zoom) { return zoom * demoFitScale(); }
function setDemoCam(x, zoom) {
  cam.zoom = demoZoomFit(zoom);
  cam.x = x;
  cam.y = ground.y - (0.5 - DEMO_GROUND_FRAC) * canvas.height / cam.zoom;
}
// ── デモが触る world の設定 ─────────────────────────────────
//  ★clearScene() は world を初期化しない＝前に開いたデモの設定がそのまま残る。
//    「速度の合成」は真上から見下ろした図なので gravY=0 にする。その直後に別のデモを
//    開くと物が落ちてこない（実測：2重振り子が水平に伸びたまま止まっていた）。
//    眠りと矢印の倍率も同じで、切ったデモ・上げたデモの次からずっとそのままだった
//    （world.sleeping を false にするデモは6つあるのに、true へ戻すデモは1つもない）。
//  ★戻す責任はデモに持たせない。デモの先頭でここを1回通して既定へ揃え、そのデモに
//    要る値だけをあとから上書きする。＝新しいデモを足す人が、前のデモが何を変えたかを
//    知らなくてよい（「後始末を忘れた1つ」が後続の全デモを壊す形をなくす）。
//  ★並べるのは「どれかのデモが変える設定」だけ。地面の有無はここに入れない
//    （updateGroundTerrain() が受け持っていて、デモは必ずどちらかを呼んでいる）。
function resetDemoWorld() {
  setDemoGravity();          // 地上の重力（真上から見下ろした図のデモだけ 0 を渡し直す）
  world.substeps = 4;        // 刻み（斜面・振り子のデモは細かくする）
  world.sleeping = true;     // 眠り（拘束力の矢印を出すデモは切る）
  world.forceVizScale = 1;   // [px per N]
  world.velVizScale   = 5;   // [px per (m/s)]
  world.gravitation   = false;   // 万有引力（宇宙速度のデモだけ入れる）
  world.gravStrength  = 6000;    // 実効万有引力定数 G_sim（同上。js/core/state.js の既定と同じ値）
  world.gravSoften    = 8;       // [px] 引力のソフトニング長 ε（縮尺模型のデモだけ下げる）
  // ★衝突レイヤーの色ドットはデモでは出さない（レイヤー分けは仕掛けで、読みどころではない。
  //   見たければ 表示›衝突レイヤーを表示 で入れられる）
  world.showLayerBadges = false;
  // ★電荷間クーロン力。箔検電器が実効定数を下げる（動ける電荷を粒として置くので、
  //   既定の 2 では粒どうしの力が強すぎて器の中に並んだまま動かない）。戻さないと
  //   次のデモまで弱いままになるので、戻す責任はここで持つ。
  world.coulombOn = true;
  world.coulombK  = 2;           // 実効クーロン定数（js/app/clipper.js の既定と同じ値）
  // ★電気力線・等電位線。既定はどちらも OFF（js/app/clipper.js）で、「電場と電気力線」の
  //   デモだけが入れる。ここで戻さないと、そのあと開いたデモの画面に無関係の力線が残る
  //   （帯電した物体が1つでもあれば画面いっぱいに引かれる）。
  world.showFieldLines   = false;
  world.showEquipotential = false;
  world.showGuideRails  = true;  // 運動方向固定の軸（光の速さのデモだけ消す。拘束は残る）
  world.waterSmooth     = false; // 水を塊で描く（見た目だけ。熱量保存のデモだけ入れる）
  // ★熱まわり。熱力学のデモは、伝わる速さの倍率・温度の色づけ・色の範囲をそれぞれ
  //   自分の題材に合わせて変える。戻さないと次のデモへ持ち越す（実測：伝導のデモが
  //   thermalRate を 2000 に落とした直後に対流のデモを開くと、20秒回しても上下の
  //   温度差が 4.36℃ → 0.20℃ にしかならず、対流が起きていないように見えた）。
  world.thermalOn     = true;    // 熱のやりとり
  world.thermalRate   = 50000;   // 熱の伝わる速さの倍率（伝導のデモだけ落とす）
  world.thermalViz    = false;   // 温度で色をつける（熱力学のデモだけ入れる）
  world.thermalVizMin = 0;       // [℃] 色の下端
  world.thermalVizMax = 100;     // [℃] 色の上端
  // ★水面波。ここも熱と同じで、デモが自分の題材に合わせて変える値が並ぶ（波速・吸収・
  //   見せ方）。戻す責任をデモに持たせない約束なので、既定へ揃えるのはここでやる。
  world.waveSpeed    = 2.0;      // [m/s] 媒質中の波速（屈折のデモだけ触る）
  world.waveAbsorb   = 0.15;     // [1/m] 吸収。計算範囲がここから決まる
  world.showWaveField = true;
  world.waveViewMode = 'both';   // 山と谷の両方（'crest' にすると山だけ）
  world.waveViewGain = 6;
  world.waveVisMin   = 0.02;
  world.waveCrestWidth = 0.12;
  world.waveBudget   = 1.5;      // 計算量の上限の目安
  // ★背景（真上から見たテーブル）の摩擦。既定は 0＝摩擦なし。真上から見下ろす図の
  //   デモがここを上げるので、戻す責任はこちらで持つ（上げっぱなしで次のデモへ渡すと、
  //   横から見た図の物体まで見えない摩擦で減速する）。
  world.bgFriction = 0; world.bgFrictionStatic = 0; world.bgGravPerp = G_EARTH;
  // ★地面の摩擦。デモが変えるのはここだけ（updateGroundTerrain は有無しか見ない）。
  ground.friction = 0.5; ground.frictionStatic = 0.6;
  // ★壁と地面の傾き。デモ自身は変えないが、チュートリアル 44 が生徒に入れさせる
  //   （2026-09-29）。戻さないと、次に開いたデモの画面の外に壁が残り、地面も傾いたままになる
  //   （斜面を転がる球の題材が、置いただけで勝手に転がり出す）。既定は js/core/state.js と同じ値。
  world.wallsOn = false; world.wallW = 24; world.wallH = 60; world.wallRest = 0.4;
  setGroundAngle(0);
  // ★反復回数・「重力に垂直な線」・大気圧も同じ理由（チュートリアル 80・81・83 が生徒に変えさせる）。
  //   反復回数を 2 に下げたまま次のデモへ行くと、積み木や振り子がつぶれて崩れる。
  //   大気圧を真空にしたまま気体のデモを開くと、蓋が飛んで器が空になる。
  world.iterations = 8;          // js/core/state.js の既定と同じ値
  world.showGravityLine = false;
  world.atmPressure = 101325;    // [Pa] 同上
  world.freezeDistance = 200;    // [m] 遠方を凍結（チュートリアル 87 が生徒に 3m へ下げさせる。js/core/state.js の既定と同じ値）
  // ★つかむ手の強さ。重い装置を手で運ばせるデモが上げるので、戻す責任はここで持つ
  //   （P-Vグラフ・スターリング・滑車の3つが上げていて、どれも戻していなかった。
  //     上げっぱなしのまま軽い題材へ行くと、指1本で何でも振り回せる世界になる）。
  grabMaxForce = 4800;           // [N]（js/core/state.js の既定と同じ値）
  setSpeed(1);                   // 再生速度（撃心のデモは落とし、電気振動モデルは上げる。ここを通さないと次のデモまで持ち越す）
}
// 重力。★引数なしで地上の重力、真上から見下ろした図のデモだけ 0 を渡す。
//   gravX も必ず 0 に戻す（横向きの重力を入れたまま来ると、真上から見た図が崩れる）
function setDemoGravity(gy) {
  world.gravX = 0;
  world.gravY = gy === undefined ? G_EARTH : gy;
}
// ── 止めたまま力の矢印を出す（空回し）──────────────────────────
//   ★liveForcesFor（js/render/vectors.js）が一時停止中に作れるのは、重力・推力・
//     地面の垂直抗力の3つだけ。摩擦も張力も物体どうしの垂直抗力も「ソルバが解いた結果」
//     なので、一度も回さないと出ない（上皿天秤のデモの★に経緯がある）。
//     矢印を読ませる題材でそれが起きると、開いた瞬間の画面が空っぽに見える。
//   ★釣り合っている題材なら、回しても物体は動かないのでそのまま止めればよい。
//     釣り合っていない題材（引かれて滑る箱・上昇するエレベータ）は回すと動いてしまうので、
//     回す前の姿勢を控えて戻す。_forces は次の simTick() の頭（Body.clearForces）まで
//     残るので、姿勢を戻しても矢印は解いた値のまま＝「配置は最初の図・力は解いた値」になる。
//   ★縄は節点を持つので、姿勢を戻したあと作り直す（戻した端点の間に真っすぐ張り直る）。
//   ★回した時間は無かったことにする（経過時間と歩数を 0 へ）。矢印のために回しただけなので。
//   ☆**粒子（水・気体分子）は戻さない。** 水のデモはこの空回しで水面が落ち着くので、
//     戻すと逆に「まだ揺れている水」で開くことになる。ただし**動く物体を戻すと、その
//     物体が粒子を飲み込むことがある**：回すあいだに浮いたふたを元の位置へ戻すと、
//     その帯にいた分子は物体の内側に取り残され、救出（molecule.js の _rescueInside）で
//     反対側へ出て容器の外へ飛ぶ。実測（気体分子運動論のデモ・30秒）：戻すと開いた
//     直後に 18個が外、戻さなければ 0個。**釣り合っている題材ではそもそも戻さなくてよい**
//     ので、粒子に接する物体が動く題材では空回しをそのまま止める（上の★）。
//   ★**最後の 1 tick は姿勢を戻してから回す。** 控えた値は「回し終わった場所での力」なので、
//     回すあいだに動く題材ではそれを最初の配置に貼ると力だけが別の場所の値になる。
//     実測（電場と電気力線・試験電荷 −0.5C）：30tick で 45px 流れ、戻したあとの画面に
//     E=0.54 N/C と F=0.31 N が並んだ（F = qE なら 0.27 N ＝ 15% 過大）。戻してから
//     もう 1 tick 回すと 0.27 N になり、矢印の長さの比も電気量どおりになる。
//     釣り合っている題材（動かないので値が同じ）では何も変わらない。
function demoWarmForces(ticks) {
  const snap = objects.map(o => ({ o, x:o.x, y:o.y, angle:o.angle, vx:o.vx, vy:o.vy, av:o.av }));
  const restore = () => {
    for (const s of snap) {
      const o = s.o;
      o.x = s.x; o.y = s.y; o.angle = s.angle; o.vx = s.vx; o.vy = s.vy; o.av = s.av;
      o._invalidateShape(); o._updateAABB();
    }
    for (const j of joints) if (j.type === 'rope') { resetRopeChain(j); ensureRopeNodes(j); }
  };
  const n = (ticks === undefined ? 30 : ticks);
  for (let i = 0; i < Math.max(0, n - 1); i++) simTick();
  restore();                       // 最初の配置へ戻し……
  if (n > 0) { simTick(); restore(); }   // ……そこでの力を解いて、また戻す
  // ★なました値も捨てる。平滑化（alpha 0.2）は止まっている画面では 20 フレームかけて
  //   新しい値へ寄るので、捨てないと開いた直後だけ上の 0.31 が見えてしまう。
  for (const o of objects) { o._forcesSmooth = null; o._torquesSmooth = null; }
  stepCount = 0; world.simTime = 0;
}
// ── 先回しして、その先の姿で開く ─────────────────────────────
//   ★demoWarmForces と対になる関数。あちらは「回した結果を捨てて姿勢を戻す」、
//     こちらは「回した結果をそのまま採る」。使い分けは題材の形で決まる：
//     読みどころが〈最初の配置〉にある題材（釣り合い・斜面）は戻す。読みどころが
//     〈流れが定常になったあと〉にある題材は、立ち上がりを見せる意味がないので先回しする。
//   ★これは早送りではなく初期状態の作り方。デモを開いた人は、装置が出来上がった
//     ところから始める（立ち上がりを待つ時間は題材ではない）。
//   ★時計は 0 に戻す（demoWarmForces と同じ）。回した時間は「デモを組み立てた時間」で、
//     見る人にとっての経過時間ではない。
//   ★呼ぶのはデモ関数のいちばん最後。カメラ（fitDemoRight）は物体の AABB から倍率を
//     決めるので、先に回すと「先回しで増えた物体」まで画面に入れようとして倍率が変わる。
function demoRunAhead(ticks) {
  for (let i = 0; i < ticks; i++) simTick();
  stepCount = 0; world.simTime = 0;
}
// ── デモの説明書き（注釈）────────────────────────────────
//  ★デモには「何をすれば何が見えるか」を必ず画面に書く。デモを開いた人が
//    手順（実行を押す・どの窓を見る）と読みどころを、外の説明なしに辿れるようにする。
//  ★注釈は物理に一切参加しない（annotations 配列だけに入り、objects/joints/particles の
//    どれにも入らない）。だから何枚置いても運動には影響しない。
//  ★置き場所は画面の左うえ。右うえはグラフの窓、下1/5は地面が占める。
//  ★左うえの角はカメラと画面の大きさから計算する。座標を決め打ちにすると、窓の幅や
//    倍率が変わったときに文字が画面の外へ出る（実測：-780px 決め打ちで左端が切れた）。
//    ＝ setDemoCam() を呼んだ「あと」に置くこと。
//  ★余白も倍率と同じ比で伸ばす。ここだけ画面 px の決め打ちにすると、窓が小さいときに
//    余白のワールド換算だけが太り、文字の左端が内側へ寄る（実測：742px 幅で 12px 内側）。
function demoTextTopLeft(margin) {
  const m = (margin === undefined ? 22 : margin) * demoFitScale();
  return { x: cam.x - (canvas.width  / 2 - m) / cam.zoom,
           y: cam.y - (canvas.height / 2 - m) / cam.zoom };
}
//  ★文字の大きさはワールドの px（プロパティ欄の「文字の大きさ [m]」×100）。
//    本文 23px＝0.23m。既定倍率 0.65 では画面上 15px 相当で、9行でも上半分に収まる。
// ★大きさは引数で上書きできる。既定はこの2つで、置ける物が少なくて画面が余るデモだけ
//   大きくする（実測：連星のデモは題材が円2つ＝直径 800px しか使わず、既定の 23px は
//   画面上 10.4px にしかならない。1.6倍の 37px で 16.6px になり、余白がそのぶん減る）。
//   ★大きくしたら題材の置き場所も詰め直すこと。本文は幅も高さも同じ比で伸びる。
const DEMO_TITLE_SIZE = 30;
const DEMO_NOTE_SIZE  = 23;
// ★文字の大きさはワールド px なので、倍率を上げたデモではそのぶん画面上でも大きくなる。
//   題材が小さくて寄らないと読めないデモは、この係数を掛けて画面上の見た目を既定へ戻す
//   （倍率 1.4 のデモで既定のまま置くと、本文1行が画面 32px ＝ 既定の2倍になり、
//     9行の本文が画面の高さの4割を占めたうえ、横も窓からはみ出す）。
//   ★行間や「題名と本文の間」も同じワールド px なので、そちらにも同じ係数を掛けること。
const DEMO_BASE_ZOOM = 0.65;                 // demoTitle/demoNote の大きさを決めたときの倍率
function demoTextScale(zoom) { return DEMO_BASE_ZOOM / zoom; }
// ── 画面に貼る題名と本文 ────────────────────────────────
//   ★カメラを「動く物体」に接続するデモ用。ワールドに置いた説明文は地面と一緒に流れて
//     画面から消えるので、走る電車に乗って見せるデモはこちらを使う（annotate.js の
//     screenPin の★）。カメラを付けないデモは従来どおり demoTitle/demoNote でよい。
//   ★大きさと余白は、既定の倍率 0.65 のときの見え方に合わせてある
//     （題名 30×0.65≒20px／本文 23×0.65≒15px／間隔 54×0.65≒35px）。
const DEMO_PIN_MARGIN = 22;      // [画面px] キャンバスの左うえからの余白
const DEMO_PIN_TITLE  = 20;      // [画面px]
const DEMO_PIN_NOTE   = 15;      // [画面px]
function demoTitlePinned(text) {
  annotations.push(new Annotation({ type:'text', x:DEMO_PIN_MARGIN, y:DEMO_PIN_MARGIN, text,
                                    screenPin:true, size:DEMO_PIN_TITLE, bold:true, color:'#4fc3f7' }));
}
function demoNotePinned(text) {
  annotations.push(new Annotation({ type:'text', x:DEMO_PIN_MARGIN, y:DEMO_PIN_MARGIN + 35, text,
                                    screenPin:true, size:DEMO_PIN_NOTE, color:'#eceff1' }));
}
// ★題名と本文は「図の外の札」なので、カメラを回しても回さない（noCamSpin）。
//   回転系のデモでこれを付け忘れると、説明文が世界と一緒に回って裏返る。
//   図の中の見出し（demoLabel）は逆に付けない。指している場所と一緒に回ってほしいので。
function demoTitle(x, y, text, size) {
  annotations.push(new Annotation({ type:'text', x, y, text, noCamSpin:true,
                                    size:size || DEMO_TITLE_SIZE, bold:true, color:'#4fc3f7' }));
}
// 左うえの本文の「下端の少し下」。本文の下に立て札の列を並べるデモの、その列の高さ。
//   ★本文の位置は demoTextTopLeft() ＝ 画面の大きさと倍率から決まるのに、下に並べる札を
//     決め打ちの y にしていたので重なった（実測：滑車のデモで本文の5行目と①の見出しが
//     3px 食い違って重なっていた。窓を縦に縮めるほど食い込みが増える形だった）。
//   ★行数を数えて足すのではなく annotMeasure で実測する。あとから本文に1行足した人が
//     札の y を直し忘れても、勝手に追いつく。
//   ★余白は 20px。上下とも詰まっている帯なので、広く取れば済む話ではない
//     （40px にしたら本文からは離れたが、今度は札の本文が下の天井の帯に掛かった）。
//     20px は「いろいろな力」がもともと収まっていた 16.5px を少し広げた値。
const DEMO_SIGN_GAP = 20;      // [px] 本文の下端と札の見出しのあいだの余白
function demoNoteBelow(noteY, text, gap, size) {
  const h = annotMeasure(text, size || DEMO_NOTE_SIZE, undefined, false).h;
  return noteY + h + (gap === undefined ? DEMO_SIGN_GAP : gap);
}
function demoNote(x, y, text, size) {
  annotations.push(new Annotation({ type:'text', x, y, text, noCamSpin:true,   // ★上の★
                                    size:size || DEMO_NOTE_SIZE, color:'#eceff1' }));
}
// 図の中に置く短い見出し（矢印や物体のそばの一言）。説明の本文と違って場所を選ぶ
//   ★大きさは題名・本文と同じく引数で上書きできる。文字はワールド px なので、倍率を
//     上げたデモではそのままだと札だけが図をふさぐ（本文は size を下げて逃げられるのに、
//     ここにだけ逃げ道が無かった）。省略時は従来どおり DEMO_NOTE_SIZE。
//  ★front を渡すと波・粒子より前に描く。注釈は既定では背面（物体より下）に描かれ、
//    その上から波動場や粒子が塗られるので、明るい波の上に置いた札は字が沈んで読めない
//    （実測：水面波の回折のデモで、波源の列に重ねた「λ = 3.0 m」が完全に消えた）。
//    図の中の札は「その場所を指す」ためのものなので、指す先が明るいときは前面へ。
function demoLabel(x, y, text, color, size, front) {
  annotations.push(new Annotation({ type:'text', x, y, text, front: !!front,
                                    size:size || DEMO_NOTE_SIZE, bold:true, color: color || '#eceff1' }));
}
// 向きの基準になる矢印（お絵描きの折れ線）。dir=+1 で右向き、-1 で左向き。
//   ★注釈の内部表現は text / path / ellipse の3つだけなので、矢印も折れ線で作る。
//     軸と鏃で2本に分けるのは、1本の折れ線だと鏃から軸へ戻る線が引かれてしまうため。
function demoArrow(x, y, len, dir, color) {
  const h = 13, tip = dir > 0 ? len : 0, back = dir > 0 ? len - 26 : 26;
  const put = pts => annotations.push(new Annotation({ type:'path', x, y, color, width:5, pts }));
  put([{ x:0, y:h }, { x:len, y:h }]);
  put([{ x:back, y:0 }, { x:tip, y:h }, { x:back, y:2*h }]);
}
// 図の中に引く線（お絵描きの折れ線そのもの）。点はワールド座標で渡す。
//   ★左うえの角は「線の縁を含めた外接箱」の角に合わせる。手で描いたときに
//     _makeAnnotPath（js/app/annotate.js:671）が作るのとまったく同じ形になり、
//     置いたあと選択・移動・回転しても手描きの線と区別がつかない。
//   ★太さは「線の太さ」スライダーの上限 0.3 m ＝ 30px までにすること。ここを超えると
//     デモにしか出てこない線になり、「手で作れる部品だけで組む」から外れる。
const DEMO_PATH_MAX_W = 30;    // [px] お絵描きツールで引ける線の最大の太さ
function demoPath(pts, color, width) {
  const w = Math.min(width || 3, DEMO_PATH_MAX_W);
  let minX = Infinity, minY = Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
  const ax = minX - w / 2, ay = minY - w / 2;
  const a = new Annotation({ type:'path', x:ax, y:ay, color, width:w,
                             pts: pts.map(p => ({ x: p.x - ax, y: p.y - ay })) });
  annotations.push(a);
  return a;
}
// 点線。★注釈に破線の設定は無い（type は text / path / ellipse だけで、線が持つのは
//   太さと色だけ）ので、短い線を並べて作る。お絵描きツールでも同じものが引けるが、
//   1本の点線が10本前後の線になる＝作れはしても手数はかかる。
//   ★用途は「そこを光が通っていないことを示す線」。実線で引くと光が通ったように見える。
//     凹レンズ・凸面鏡の虚焦点は「光が来ていないのに、来たように見える」ことが
//     読みどころそのものなので、ここを実線にすると題材が壊れる。
function demoDashedPath(x1, y1, x2, y2, color, width, dash, gap) {
  const d = Math.max(dash || 18, 1), g = Math.max(gap || 14, 1);
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  if (L < 1e-6) return;
  const ux = dx / L, uy = dy / L;
  for (let s = 0; s < L; s += d + g)
    demoPath([{ x: x1 + ux*s,               y: y1 + uy*s },
              { x: x1 + ux*Math.min(s+d,L), y: y1 + uy*Math.min(s+d,L) }], color, width || 3);
}
// グラフの窓を画面の右上へ寄せる。★既定は右下だが、地面を下1/5まで下げると
//   地面の上を走る物体が窓に隠れる。空いているのは空の側なのでそちらへ逃がす。
function moveDemoGraphTop(g) {
  if (!g || !g.panel) return;
  g.panel.style.top = '56px';   // 上端のツールヒントの帯を避ける高さ
  g.panel.style.bottom = 'auto';
}
// グラフの窓の大きさを変える。★既定（CSS の .velgraph-panel）は変位・速度・加速度の
//   3段が入る 320×420px で、段が1つしかない温度グラフには縦に長すぎ・横に短すぎる。
//   ただし既定を変えると、この大きさに合わせて本文と題材を詰めてある他のデモが隠れる
//   （実測：温度グラフを 500px 幅にしたら「放射」の本文1行と3つ目のブロックが窓に入った）。
//   そこで既定は据え置き、広げたいデモだけがここで指定する。
//   ★広げたら題材の置き場所も詰め直すこと（窓は右上・本文は左上で、境目が動く）。
//   ★min-width / min-height も一緒に外す。CSS の既定（300×300）が下限として残っていると、
//     それより小さく指定しても効かない（実測：265px を指定しても 300px のままだった）。
// 窓を画面の下端へ寄せる。★題材が縦に長くて上を空けたいデモ用（moveDemoGraphTop の対）
function moveDemoGraphBottom(g) {
  if (!g || !g.panel) return;
  g.panel.style.bottom = '14px';
  g.panel.style.top = 'auto';
}
function sizeDemoGraph(g, w, h) {
  if (!g || !g.panel) return g;
  g.panel.style.width  = w + 'px';
  g.panel.style.height = h + 'px';
  g.panel.style.minWidth  = w + 'px';
  g.panel.style.minHeight = h + 'px';
  return g;
}
// グラフの窓を「本文の下」に横に並べる。★2つ以上開くデモ用。
//   ★既定の置き方（右下から26pxずつずらすカスケード＝graphCascadeOffset）は、
//     320×420 の窓が2枚あるとほぼ完全に重なる（実測：2枚目のずれは 26px だけで、
//     ドップラーのデモでは下の窓の中身が1行も見えなかった）。
//   ★右側へ縦に積むのも駄目だった。本文が幅 560px あるので、右へ 320px の窓を置くと
//     題材に残る幅が 100px ほどしかない（実測：音源も観測者2人も窓の裏に入り、
//     画面には波紋の左端だけが見えていた）。空いているのは**本文の下**なので、そこへ置く。
//   ★大きさはデモが決める。2枚を本文の幅（560px）に収めるので、既定の 320px より狭くなる。
function rowDemoGraphs(list, w, h) {
  const gap = 10, x0 = 10, bottom = 10;
  list.forEach((g, i) => {
    if (!g || !g.panel) return;
    sizeDemoGraph(g, w, h);
    g.panel.style.left   = (x0 + i * (w + gap)) + 'px';
    g.panel.style.right  = 'auto';
    g.panel.style.bottom = bottom + 'px';
    g.panel.style.top    = 'auto';
  });
  return list;
}
// グラフの窓を画面の左下へ寄せる。★題材が画面の右側に寄っているデモ用。
//   既定の右下に置くと軌道や物体が窓に隠れるが、左うえは説明の本文の場所なので
//   上へは逃がせない。空いているのは「本文の下」＝ 左下になる。
function moveDemoGraphLeft(g) {
  if (!g || !g.panel) return;
  g.panel.style.left = '10px';
  g.panel.style.right = 'auto';
}
// グラフの窓を画面の下辺の中央へ置く。★左下（本文の真下）でも右下（題材の真下）でもなく、
//   その中間に空きがあるデモ用。本文が幅 500px・題材が画面の右寄りにあると、下辺の
//   まん中だけがどちらにも触らずに残る。
//   ★大きさを変えるなら先に sizeDemoGraph を呼ぶこと（いまの実幅から中央を出すため）。
function moveDemoGraphCenterBottom(g, bottom) {
  if (!g || !g.panel) return g;
  const host = g.panel.offsetParent || document.body;
  const hw = host.getBoundingClientRect().width;
  const pw = g.panel.getBoundingClientRect().width;
  g.panel.style.left   = Math.max(10, (hw - pw) / 2) + 'px';
  g.panel.style.right  = 'auto';
  g.panel.style.bottom = (bottom !== undefined ? bottom : 10) + 'px';
  g.panel.style.top    = 'auto';
  return g;
}
// ── デモにばねを置く ──────────────────────────────────────────
//   ★ばねは「ばねを張る」ツール（Slinky）で作る部品ひとつだけ。デモも同じ物を使う。
//     以前はジョイントの 'spring' で置いていたが、道具から外したものをデモが使い続けると
//     「デモにあるのに手で作れない部品」になるので、こちらへ寄せた。
//   引数はばねジョイント時代と同じ言葉で受ける（px・N/m・N·s/m）。内部で
//     自然長 restM [m] ＝ restLength × PX2M
//     伸び剛性 stiffEA [N] ＝ k × 自然長      （長さによらない材料定数として持つため）
//   へ直す。減衰 c [N·s/m] はそのまま渡す。
//   ★以前はここで ζ = c/(2√(k·m)) に直して渡していた。スリンキーが減衰を ζ で持っていて、
//     毎ステップ c を作り直していたため。その m は「ばねが動かす側の質量」の見積もりで、
//     両端とも物体のときは重い側で代用していたが、ソルバが使う換算質量（取り付け点の腕まで
//     入る）とは一致しない。ずれたぶんだけ実際の減衰が指定から外れていた
//     （実測：連結棒つきのデモで 3 N·s/m の指定が 0.65 N·s/m に、共振のデモで 0.8 が 0.29 に）。
//     スリンキーが c を実体で持つようになったので、見積もりごと消して素通しにする。
//   ★回る物体に付けた減衰は、ばねジョイントでは制動にならなかった（相対速度を重心の
//     速度から作るのに力積は取り付け点へ与えるため。実測：減衰120で振れ幅が 6.83°→8.60°
//     と育った）。スリンキーは取り付け点の速度で作るので、そのまま正しく効く。
// ── ヒンジ・軸・溶接を打つ（手のツールと同じ入口）──────────────────────
//   ★デモの画鋲はここを通す。中身は手のツールと同じ pinJointsAt（selection.js の★）＝
//     「クリックした点に重なっているもの」を留める。物体を名指しで渡す形にしないのは、
//     名指しだと物体の外の点にも打ててしまい、手では組めないデモができるため（2026-10-02 に
//     ロケットの反動・共振・遊星歯車などで実際に起きていた）。
//   ★mode は手の設定窓の「留め先」と同じ：'pair' 重なった2つをつなぐ／'board' 全部を背景へ。
//   ★expect に「留まるはずの物体」を並べる（背景は null）。拾ったものが違えば console.error
//     を出す（tools/shot.js の stderr で拾える）。重なりの読み違いをその場で見つけるため。
//   ★拾う範囲は 0.5px（倍率に左右されない。拡大してクリックしたのと同じ）。
//   o … pinJointsAt の o（motorSpeed / motorTorque / motorBrake / releasable / spin / opts）
//   戻り値：作ったジョイント（mode 'board' は配列、'pair' は1本）
function demoPin(type, x, y, mode, o) {
  o = Object.assign({ tol: 0.5 }, o || {});
  const made = pinJointsAt(type, { x, y }, null, mode, o);
  if (o.expect) {
    const want = new Set(o.expect.map(b => b ? b.id : 'bg'));
    const got  = mode === 'board' ? made.map(j => j.bodyA ? j.bodyA.id : j.bodyB.id)
               : made.length ? [made[0].bodyA ? made[0].bodyA.id : 'bg', made[0].bodyB ? made[0].bodyB.id : 'bg'] : [];
    const ok = got.length === want.size && got.every(id => want.has(id));
    if (!ok) console.error('demoPin: ' + type + ' (' + x.toFixed(1) + ', ' + y.toFixed(1) + ') が想定と違う物体を留めた: ' +
      made.map(j => jointEndsLabel(j)).join(' / ') + '（想定：' + o.expect.map(b => b ? (b.label || b.id) : '背景').join('・') + '）');
  }
  return mode === 'board' ? made : made[0];
}
function demoSpring(o) {
  const A = o.bodyA, B = o.bodyB;
  // ★取り付け点は物体のローカル座標。物体が傾いた状態で置かれるデモがあるので、
  //   世界座標へ直すときに回転を通す（Slinky 側もローカルで持ち、毎フレーム回す）。
  const toWorld = (b, ax, ay) => {
    if (!b) return { x: ax, y: ay };
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    return { x: b.x + ax*c - ay*s, y: b.y + ax*s + ay*c };
  };
  const wa = toWorld(A, o.anchorAx || 0, o.anchorAy || 0);
  const wb = toWorld(B, o.anchorBx || 0, o.anchorBy || 0);
  const restPx = o.restLength !== undefined ? o.restLength : Math.hypot(wb.x-wa.x, wb.y-wa.y);
  // ★下限はスリンキーと同じ SLINKY_REST_MIN（1px）で切り上げる。以前は 1e-3 で切り上げていたので、
  //   自然長 0 のばねは剛性を 0.001m で掛けたあとスリンキー側で自然長だけ 0.01m になり、
  //   **指定の 10分の1 の硬さ**になっていた（陽イオンを格子点に留めるばね：20 N/m の指定が 2 N/m）。
  const restM  = Math.max(SLINKY_REST_MIN, restPx * PX2M);
  // ★ばね定数は 0 より大きいこと。0 は「ダンパー」という物理に無い部品になってしまうので、
  //   デモからも作れないようにする（制動器は通気にしたピストン容器で組む）。
  const k      = Math.max(1e-6, o.stiffness || 0);
  const S = new Slinky({
    ax: wa.x, ay: wa.y, bx: wb.x, by: wb.y,
    restM, stiffEA: k * restM, dampC: o.damping || 0, idealSpring: true,
    endA: A ? 'body' : 'pin', endB: B ? 'body' : 'pin',
    bodyA: A || null, bodyB: B || null,
    anchorAx: A ? (o.anchorAx || 0) : 0, anchorAy: A ? (o.anchorAy || 0) : 0,
    anchorBx: B ? (o.anchorBx || 0) : 0, anchorBy: B ? (o.anchorBy || 0) : 0,
    radius: o.radius !== undefined ? o.radius : 12,
    showCoil: o.showCoil !== undefined ? o.showCoil : true,
    color: o.color,
  });
  slinkies.push(S);
  return S;
}

// ── 図形和で1つの物体にする ───────────────────────────────────────
//   左ツールバーの「図形和」とまったく同じ経路（applyClipper）を通す。
//   ★デモの部品は生徒が手で作れるものに限る。頂点を自前で並べれば任意の形が作れるが、
//     それは UI から作れない＝デモだけの特別な部品になる。ここを通せば、円の48角形
//     近似も円弧の復元（js/physics/arc.js）も本番と同じものが入る。
//   ★渡した部品のうち、まだ objects に入っていないものはここで入れる。呼ぶ側が
//     push を書き忘れると applyClipper が黙って対象から落とす（id で引くため）。
//   ★applyClipper は1手ごとに undo を積む。組み立てのぶんは捨てる（デモを開いた直後に
//     「元に戻す」を押すと、作りかけの形が出てくることになるため）。
//   ★合成すると性質は「最初に渡した部品」から引き継がれる（js/app/clipper.js の
//     INHERIT_KEYS）。色・摩擦・衝突レイヤー・温度・熱伝導率が部品ごとに違う組み立ては
//     ここへ渡してはいけない。その違いが仕掛けの本体であることがある
//     （例：demos-mechanics.js の押さえレールは、重なった2枚が別レイヤーであることで
//      「おもりだけを押さえて円筒の壁は素通りする」を作っている）。
//   ★静的な容器では、合成しても力学は変わらない。実測（コップに水630粒・乱数を固定シードの
//     xorshift に差し替え・100tick 落ち着かせてから 300tick の時間平均）：
//       長方形3枚 ／ 図形和1つ ／ 手書きU字ポリゴン
//       漏れた粒 0／0／0 粒、水面の高さ 174.21／174.21／174.21 px、σ 1.07／1.07／1.07 px
//     3方式が完全に一致した。つまりこの置き換えは「見た目の継ぎ目を消し、1つの物体として
//     掴める」ためのもので、静的な容器の物理を良くするものではない（誇張しないこと）。
function demoBoolean(mode, parts) {
  for (const p of parts) if (!objects.includes(p)) objects.push(p);
  const depth = undoStack.length;
  selectedIds.clear();
  for (const p of parts) selectedIds.add(p.id);
  applyClipper(mode);
  undoStack.length = depth;
  selectedIds.clear();
  return objects[objects.length - 1];
}
// よく使う「重ねた部品を1つにする」だけの入口
function demoUnion(...parts) {
  return demoBoolean('union', parts.flat());
}
