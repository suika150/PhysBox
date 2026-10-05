const world = {
  gravX: 0, gravY: G_EARTH,   // [m/s²]  ★UIの 9.8 と実体が一致（従来は 0.5 で不一致だった）
  airDensity: 1.2,            // [kg/m³] 空気。抗力係数 Cd=0 が既定なので既定では効かない
  // ★背景を「真上から見下ろした水平面（テーブル）」とみなしたときの、面と物体の間の摩擦。
  //   画面内の重力を0にした無重力表示で、摩擦のある平面上の運動を再現するための設定。
  //   摩擦力には垂直抗力が要るが、真上から見た画面には「面に垂直な重力」が現れないので、
  //   それを bgGravPerp として別に持つ（N = m·g⊥）。既定は μ=0＝摩擦なしなので何も起きない。
  bgFrictionStatic: 0, bgFriction: 0,   // 面の静止摩擦係数 μs・動摩擦係数 μk（無次元）
  bgGravPerp: G_EARTH,        // [m/s²] 画面に垂直な向きの重力。減速度 a = μ·g⊥ を決める
  depth: 0.05,                // [m]     奥行き。質量 = 密度 × 面積 × 奥行き
  iterations: 8, substeps: 4,
  positionIterations: 3,
  sleeping: true, terrain: true,
  // ★熱のやりとり（比熱・熱伝導・熱量保存）。既定ON。
  //   物体も粒子も既定は同じ 20℃ なので、温度を変えるまでは何も起きない。
  //   計算は既存の近傍探索・接触判定に相乗りするので、負荷はほぼ増えない
  //   （実測：粒子1500個で 14.73 → 14.76 ms/tick）。
  thermalOn: true,
  // ★熱の伝わる速さの倍率（＝熱の早送り）。1 が実物どおりだが、実物の熱伝導は
  //   教材で待つには遅すぎるので既定で 50000 倍にしてある。材質どうしの比は
  //   変わらないし、熱量保存にも影響しない（動く速さだけが変わる）。
  //   旧 1000 では、材質を指定しない箱（比熱1000・熱伝導率1.0）どうしを接触させても
  //   時定数 72 秒で、10秒眺めて 100℃/0℃ が 93.5/6.5℃ にしかならず「熱が伝わらない」
  //   と見えた（下の実測は 100℃ と 0℃ の 60x40px の箱を接触させた 10 秒後）。
  //       倍率  1000 → 93.5/6.5℃   5000 → 75/25℃   50000 → 50/50℃（ほぼ平衡）
  //   材質の比は保つので、断熱材は倍率を上げても断熱材のまま（スポンジは 50000 でも
  //   10 秒で 66/34℃ 止まりで、同じ倍率の金属＝1秒未満で平衡、と桁で差が出る）。
  thermalRate: 50000,
  // ★大気圧 [Pa]。気体室の可動境界（ピストン面）だけに効く。
  //   閉じた物体に一様な圧力がかかっても合力は0なので、剛体一般には掛けない。
  //   0＝真空。火星600／地上101325／水深10m 202650 あたりが目安。
  atmPressure: 101325,
  // ★ピストン面の圧力矢印は world の設定を持たない。ピストンの showForces に従う
  //   （正味の力の矢印と同じスイッチ。render/gas.js の★を参照）
  // ★周囲の温度 [K]。熱放射（js/physics/radiation.js）で「どこへ放射するか」の相手。
  //   放射率が0の物体しか無ければ一切使われないので、既定のシーンには影響しない。
  //   ★値は 20℃ ＝ ROOM_K だが、その定数は thermal.js にあり、このファイルより後に
  //     読まれる（physBox.html の script 列）。ここでは数値で書くこと。
  ambientTemp: 293.15,
  thermalViz: false,          // ★温度で色をつける（表示だけ。物理は変わらない）
  thermalVizMin: 0,           // [℃] 色の下端
  thermalVizMax: 100,         // [℃] 色の上端
  freezeDistance: 200,        // [m] 視界からこれ以上離れた非静的物体は計算を止める（0=無効）
  // ─── 壁（ワールド境界）───
  //   世界座標に固定した矩形。位置をクランプして速度を反射するので、どんな速さでも
  //   確実に閉じ込められる（薄い静的物体の壁のように貫通することがない）。
  //   床は地面の高さに合わせ、そこから上へ wallH ぶん伸ばす。余裕が必要なのは
  //   上方向だけなので、原点中心にして下側へ半分配分するのは無駄になる。
  wallsOn: false,             // 既定OFF（壁は物理を変えるので、勝手に入っていると教材の邪魔になる）
  wallW: 24,                  // [m] 幅（x = ±wallW/2）
  wallH: 60,                  // [m] 高さ（床から上へ）。横より広く取り、天井が実験の邪魔をしないように
  wallRest: 0.4,              // 反発係数（0=ぶつかって止まる／1=完全弾性）
  bgColor: '#12141a', showGrid: true, gridSize: 30,   // [px]。30px = 0.3 m（太線は5本ごと＝1.5 m）
  showAxes: true,             // ★原点と座標軸（x=0 / y=0）を描くか
  showGravityLine: false,     // ★重力に垂直な線（見かけの水平）。重力Xを使うときだけ要るので既定OFF
  showGridLabels: true,       // ★グリッドの目盛り（軸に沿って書く「何 m か」の数字）を描くか
  gravitation: false,          // 万有引力モード（物体間に引力）
  gravStrength: 6000,          // 実効万有引力定数 G_sim（単一スライダーで調整）
  gravSoften: 8,               // [px] 万有引力のソフトニング長 ε（js/physics/gravitation.js の★）
   simTime: 0,                     // ★シミュレーション経過時間[s]（…）
   forceVizScale: 1,           // [px per N]（矢印の長さ。物体プロパティの「表示」からも変えられる）
  velVizScale: 5,             // [px per (m/s)]
  showForceLegend: true,
  showLayerBadges: true,      // ★衝突レイヤーの色ドットを表示するか（表示メニューで切替）
  // ★運動方向固定のレール（破線と両向きの矢印）を描くか。**表示だけのスイッチで、
  //   拘束そのものは切れない**（切るのは物体側の「運動方向固定」）。同じレールに
  //   何個も乗る題材——生成口から流れ続ける物体の列——では、同じ1本の線が物体の数だけ
  //   重ね描きされ、矢印が列の全部に付いて題材が読めなくなる。それを消すための項目。
  showGuideRails: true,
  // ★水（SPH の粒子）をひとつながりの塊として描くか。**見た目だけのスイッチで、
  //   物理は1ビットも変わらない**。粒1つは水の分子ではなく 11.2cm 角の水のかたまりで、
  //   静かに詰まると六角格子に並ぶ（等方的な反発だけで釣り合う粒の最安定配置＝離散化の痕跡）。
  //   点で描くとそれが「分子が結晶のように並んでいる」と読めてしまうので、塊で描けるようにした。
  //   既定は点のまま：対流など粒の動きが読みどころの題材があるため。
  waterSmooth: false,
  waveSpeed: 2.0,             // [m/s] 媒質中の波速。定数として扱い、λ = v/f を導出する
  waveAbsorb: 0.15,           // [1/m] 媒質の吸収 α。計算範囲はこの値から自動で決まる
  waveViewMode: 'both',       // 'both' | 'crest' | 'trough' | 'field'
  waveCrestWidth: 0.12,       // 山・谷として描く位相の幅（0.12 なら頂点から12%）
  waveVisMin: 0.02,           // これ未満の振幅は描かず、計算範囲もここで打ち切る
  waveViewGain: 6,            // 表示の明るさ倍率
  waveBudget: 1.5,            // [百万セル更新/フレーム] 計算量の上限。低いと領域が四角く切られる
  showWaveField: true,
};
// ─── Camera ───────────────────────────
// 起動時の位置は init() が画面サイズから決める（地面を画面高さの9割の位置に置く）
//   ★angle は「ワールド → 画面」の回転 [rad]。0 が既定＝画面のx軸とワールドのx軸が一致する。
//     手で回すことはできず、カメラを物体に向き付きで接続したときだけ 0 以外になる
//     （js/app/camera.js）。回転させても物理は一切変わらない＝変わるのは見る側だけ。
//     この一点がコリオリ・慣性力の題材の要なので、ここに力を足す方向へは進めないこと。
const cam = { x: 0, y: 0, zoom: 1, angle: 0, minZoom: 0.1, maxZoom: 2.5 };
// 物体に接続したカメラ。★1台だけ（2台目を許すと「どちらの目で見ているか」が読めなくなる）。
//   { bodyId, upAngle, on, offX, offY }／null＝未設置。upAngle は物体のローカル座標での
//   「画面の上に保つ向き」[rad]、null なら回さない＝カメラは常に y 軸正を向く。
//   on＝働かせているか、offX/offY＝右ドラッグ・ホイールで生じた接続先からのずれ [px]。
//   ★on とずれは同じ窓の「選んだ物体を追う」（followEnabled / followOffX,Y）と共有しない。
//     中身と理由は js/app/camera.js。
let sceneCamera = null;
// これから接続するときの向きの決め方。'world'＝カメラは常に y 軸正を向く／
// 'body'＝物体の向きによってカメラの向きも変わる。★既定は 'world'（回さない）。
let cameraUpMode = 'world';
// ─── Simulation State ─────────────────
let running = false;
let stepCount = 0;
let speedMult = 1;
let lastTime = 0;
let fpsArr = [];
let rafId = null;
// ─── Objects ─────────────────────────
let objects = [];
let joints = [];
let particles = []; // fluid/gas SPH particles
let lasers = [];
let waveSources = [];
let slinkies = [];       // ★ばね／ダンパー（質点＋ばねの実体索）。理想ばね化を外すと波が伝わる
let emFields = [];       // ★電場・磁場の領域（矩形）。世界全体の一様場は持たない
// 新しく置く場の既定値（ツール設定ウィンドウで変える）
let efieldStrength = 5;              // [V/m]
let efieldAngle    = -Math.PI/2;     // 既定＝上向き（内部座標はy下向き正）
let bfieldStrength = 0.5;            // [T]
let bfieldOut      = true;           // 既定＝紙面から出る向き
// ★加熱・冷却の領域（矩形）。系の外から熱を出し入れする入口（js/physics/heat-field.js）
let heatFields = [];
// ★加熱と冷却は符号違いの同じ仕組みなので、ツールは1つ（'heater'）で、持つのは
//   符号つきの出力だけ（正＝加熱・負＝冷却。HeatField.power と同じ約束）。
let heaterPower = 200;               // [W] これから置く領域の出力（符号つき）
// ★液体と気体も左ツールバーのボタンは1つ（t-particle）で、窓で選ぶ。置き方も設定も共通だから。
//   ただし中身は別のソルバ（SPH と分子運動論）なので、ツール名は 'fluid'／'gas' の2つのまま。
//   これはボタンを押したときにどちらで始めるか（最後に選んだほう）。
let particleToolKind = 'fluid';      // 'fluid'=液体 / 'gas'=気体
// ★流れの場（矩形）。風・水流。中の物体は相対速度に応じた抗力を受け、流速へ漸近する
//   （js/physics/flow-field.js）。系の外から仕事を入れる入口という点は加熱・冷却と同じ。
let flowFields = [];
let flowSpeed   = 5;                 // [m/s]     これから置く領域の流速
let flowAngle   = 0;                 // [rad]     〃 の向き（内部座標はy下向き正。0＝右向き）
let flowDensity = 1.2;               // [kg/m³]   〃 の媒質密度（既定＝空気。抗力モードでのみ効く）
let flowMode    = 'advect';          //           〃 の効かせ方。'advect'＝速度の合成／'drag'＝流体の抗力
// ─── 注釈（テキスト・お絵描き）───────────────────────────
//   ★物理には一切参加しない。objects / joints / particles のどれにも入らないので、
//     衝突・レーザー・波・回路・電磁気のどのモジュールからも構造的に見えない。
//     この不変条件は守ること（見えるようにした瞬間、「背景の落書きが物理を変える」
//     という説明のつかない挙動になる）。
//   ★編集ツール（pointer）の対象外。注釈グループのツールを選んでいる間だけ掴める
//     ので、mouse.js の pointer 側の当たり判定の列には一切割り込まない。
let annotations = [];
let selectedAnnotation = null;   // ★注釈グループのツール中だけ入る（selectedElement とは別系統）
let annotDrag   = null;          // ★注釈の平行移動 {a, dx, dy, armed, moved}
let annotRotate = null;          // ★注釈の回転 {a, cx, cy, ang0, p0, armed, moved}
let annotScale  = null;          // ★注釈の拡大縮小 {a, left, top, fixed, w0, h0, …掴んだ時点の値}
// 新しく置く注釈の既定値（ツール設定ウィンドウで変える）
let annotColor    = '#ffffff';
let annotTextSize = 40;          // [px] 文字の大きさ（ワールド単位。0.4 m ＝ 拡大すると一緒に大きくなる）
let annotFont     = 'gothic';    // ANNOT_FONTS のキー（js/app/annotate.js）
let annotBold     = false;
let annotDrawMode  = 'pen';      // ANNOT_DRAW_MODES のキー（'pen'|'line'|'eraser'）
let annotLineWidth = 4;          // [px] 線の太さ（ワールド単位。0.04 m）
let annotStroke    = null;       // ★描いている最中の線 {mode, start, pts}。確定してはじめて annotations へ入る
let annotErasing   = false;      // 消しゴムで押している最中か
let annotEraseArmed = false;     // このなでで、まだ履歴を積んでいないか
// ★注釈のコピーの控え。物体の clipboard とは別に持ち、どちらか一方だけに中身を入れる
//   （両方に残ると、貼り付けたときにどちらが出るか予測できない）
let annotClipboard = null;
let slinkyStart = null;   // スリンキーツール：1回目クリックの端A
// 新しく置くばねの張り具合＝「自然長に対してどれだけ伸ばして張るか」。
//   ★0＝引いた長さがそのまま自然長。置いた瞬間のばねは無張力で、弾性エネルギーを
//     溜め込んでいない。これが既定。
//   ★旧 1.0（＝2倍に伸ばして置く）をやめた理由：置いただけで ½kx² が溜まり、
//     ばね定数を 300 N/m にしたことで 150 J にもなっていた（旧 k=20 では 10 J）。
//     先端おもりの質量は「今の張力とつり合う重さ」で決まるので 30.6kg になり、
//     「掴んで引くための小さなおもり」ではなくなっていた。さらに、おもりの重さを
//     手で書き換えた瞬間につり合いが壊れ、溜めた150Jが一気に出て暴れる
//     （実測：おもりを1kgにすると 1622px/s。張り具合0なら 49px/s）。
//   ★実体ばね（理想ばね化OFF）で横波を見たいときは張力が要る。そのときは置いたあとに
//     プロパティの自然長を縮めればよい（1.0 は「自然長＝引いた長さの半分」に相当）。
//     縦波と横波の速さの比は v縦/v横 = √((1+ε)/ε) で、ε が張り具合そのもの。
let slinkyStretch = 0.0;
// 新しく置くばねのばね定数 [N/m]。★EA（伸び剛性）ではなく k で持つ。
//   EA を固定すると k = EA / 自然長 になり、短く引いたばねほど硬くなる＝「同じ道具のはずが
//   長さで手応えが変わる」。プロパティ側も「自然長を変えても k は保つ」流儀なので揃える。
//   旧 EA=20N は自然長1mで k=20N/m しかなく、1kg を吊るすと 0.49m も伸びた（ふにゃふにゃ）。
//   300 なら 1kg で 3.3cm、5kg で 16cm と、教材のばねばかりらしい手応えになる。
//   ★下げすぎると波速がマウスの操作速度を下回り、端を掴んで動かすだけで索が波速を
//     超えて煽られる（実体ばね＝理想ばね化OFF のとき）。
//   ★0 は入れられない（つまみの下限は 0.5）。「ばね定数0のばね＝ダンパー」という部品は
//     やめた。制動器が要るなら通気にしたピストン容器で組む（js/waves/slinky.js の★）。
let slinkySpringK = 300;
let slinkyMu      = 0.2;  // [kg/m] 線密度（自然長あたり）
// 新しく置くばねを理想ばね（質量を無視した、教科書どおりの力の法則）にするか。
//   ★既定は理想ばね。ばねを置く目的のほとんどは単振動・つり合いで、そこでは
//     T = 2π√(m/k) が厳密に出るこちらが期待どおりに動く（Slinky の既定と揃えてある）。
//     波を伝えたいとき＝実体のスリンキーが要るときだけ切る。
let slinkyIdeal   = true;
let waveFreq = 2.0;      // [Hz] 新規波源の既定振動数
let waveAmp  = 1.0;      // 新規波源の既定振幅
let laserStart = null;   // レーザー配置：1回目クリックの発射点を保持
let selectedIds = new Set();
// ★範囲選択（矩形選択）に含めた要素（レーザー・波源）のID。物体の selectedIds と並列に持つ。
//   平行移動に加えて、波長・向き・振動数などのまとめて設定もできる。物体と違って
//   「代表1つ（selectedElement）＋ID集合」という持ち方なので、値を配るのは applyToBulk。
let selectedElemIds = new Set();
// ★範囲選択で選んだ「ばね／ロープ／棒の端」。中身は "<jointId>:A" / "<jointId>:B"。
//   端そのものは物体でも要素でもないので専用の入れ物を持つ（js/app/selection.js の
//   jointEndKey まわりを参照）。
let selectedJointEnds = new Set();
// ★スリンキーの端。ジョイントの端（selectedJointEnds）と同じ流儀で、専用の入れ物に持つ
let selectedSlinkyEnds = new Set();
let selectedJointId = null;   // ★選択中ジョイントのID
let selectedElement = null;   // ★選択中の要素 {kind:'laser'|'thruster'|'tracer', ...}
// ★種別ごとの一括選択（js/app/bulk-select.js）。物体以外は単一選択の変数しか無いので、
//   「代表＝右パネルに出ている1つ」＋「仲間＝bulkIds」の二本立てで複数を表す。
//   物体は selectedIds がもともと複数を持てるので、bulkKind には入れない。
let bulkKind = null;          // 'laser' | 'wave' | 'joint' | 'circuit' | 'emfield' | 'heatfield' | 'thruster' | 'tracer'
let bulkSub  = null;          // さらに細かい型（ジョイントなら 'hinge'、場なら 'E' など。無い種別は null）
let bulkIds  = new Set();
// ★直前に確定した範囲選択の枠（ワールド座標）。「◯◯のみ選択」で数え直すために残しておく
let lastSelRect = null;
let elementDrag = null;       // ★要素の平行移動 {el, dx, dy, origX, origY, armed, moved, last}
let elementRotate = null;     // ★要素の向き変更 {el, armed, moved}
let jointWholeDrag = null;    // ★ばね/ロープ/連結棒の線を掴んでの平行移動 {joint, last, armed, moved}
let boxDrag = null;           // ★選択枠ハンドルの操作 {mode:'scale'|'rotate', ...}
let pointerElemOffsets = null;   // ★集団平行移動の開始位置 {要素ID: {x,y}}（背景固定のレーザー・波源）
const DIR_HANDLE_PX = 46;     // ★向きハンドルまでの距離（画面px。ズームで割ってworld距離にする）
const GIZMO_PAD = 10;         // ★選択枠を物体から外側へ離す量（画面px。既存マーカーとの誤クリック回避）
const GIZMO_HIT = 9;          // ★ハンドルの当たり半径（画面px）
const GIZMO_ROT = 34;         // ★回転ハンドルまでの距離（画面px。枠上端から）
let hoveredId = null;
let uidCounter = 0;
let clipboard = null;
// ★プロパティのコピー用。物体そのものを写す clipboard とは別に持つ。
//   同じ入れ物にすると Ctrl+C（物体のコピー）と取り合いになり、
//   「プロパティをコピー→物体をコピー→プロパティを貼り付け」が通らなくなる。
//   中身は { kind:'body'|'optic', props:{...} }（js/app/select-helpers.js）
let propClipboard = null;
let savedState = null;
// 変位／速度／加速度 グラフの状態
//   ★1ウィンドウ＝1物体。開いたウィンドウは対象を持ち続け、選択を変えても
//     乗り換えない。複数の物体を同時に見たいときは、その数だけウィンドウを開く。
//     ウィンドウの中身は js/ui/velgraph.js の velGraphNew() が作る。
let velGraphs = [];       // 開いているグラフウィンドウ（1つにつき1物体）
let velGraphSeq = 0;      // ウィンドウ番号の発番
// エネルギーのグラフの状態
//   ★こちらは1ウィンドウ＝1つの「系」（選んだ物体の集合）。運動エネルギーは物体1個に
//     属するが、弾性・万有引力・静電気力の位置エネルギーは相互作用する相手がいて
//     はじめて決まる量で、片方へ配る根拠がないため（js/physics/energy.js）。
let eneGraphs = [];       // 開いているエネルギーのウィンドウ（1つにつき1系）
let eneGraphSeq = 0;      // ウィンドウ番号の発番
// ─── 回路グラフ（電流・電圧の時間波形＋交流のフェーザ図）───────────────
//   フェーザは「定常状態の正弦波」でしか定義できない。過渡・非線形・多周波が
//   混じっているときに矢印を描くと、正弦波でないものに無理やり位相を当てはめた
//   嘘の絵になるので、条件を満たさないときは図を出さずに理由を書く（厳格）。
//   ★ウィンドウは回路（連結成分）ごとに分かれる。繋がっていない別々の回路を
//     同じ軸に重ねると、縦のスケールを取り合ううえ、位相の基準もフェーザの基準
//     振動数もそろわない（別振動数の電源があると測定値そのものが無意味になる）。
let circGraphs = [];      // 開いているグラフウィンドウ（1回路につき1つ）
let circGraphSeq = 0;     // ウィンドウの通し番号
// ─── Tool State ──────────────────────
let currentTool = 'pointer';
let drawStart = null;
let drawPts = [];
let dragStart = null;
let selRect = null;
let jointStart = null;
let thrusterStart = null;   // 推力ツール：1回目クリックで力点を保持
let velStart = null;        // 速度ツール：掴んだ物体とクリック点（ワールド座標）
const VEL_SCALE = 0.06;     // [m/s per px]（旧 0.1 px/frame per px = 0.06 m/s per px）
let pendingOptic = null;    // 光学ツール：設置待ちの {kind, size}
let opticAutoStatic = true; // ★置いた光学素子を静的にするか。光路に据え付けるのが普通なので既定ON
let colorPickerOpen = false;   // ★カラーピッカー表示中フラグ（表示中の左クリックは設置ではなく閉じるだけ）
let pointerMoveStart = null;
let pointerInitialOffsets = null;
let pointerPress = null;     // ★編集ツールで押した点 {sx, sy, passed, begin}。mouse.js の DRAG_START_PX を参照
let rightClickStart = null;
let moveUndoArmed = false;   // ★追加：このドラッグで実際に動いたら履歴を積む合図
let mouseJoints = [];          // つかみ拘束（通常 0〜1 個）
let activeMouseJoint = null;
let grabMaxForce = 4800;   // [N]（旧 8000 × 60/PPM）
// つかんだ物体の回転の減衰 [1/s]。小さいほど、掴んだ点を軸にヒンジのように自由に回る。
//   ★旧既定は 39 で、1tick あたり角速度の 52%（exp(-39/60)）を人工的に消していた。
//     実測：3m の棒の端を掴んで水平から吊り下がるまで、ヒンジ 0.80 秒に対し 5.53 秒＝6.9倍。
//     6 なら 1.03 秒（ヒンジの1.3倍）まで戻り、カーソルを振り回しても発散しない
//     （最大角速度 12→22 rad/s に上がるが、棒を振り回せば実際そう回るので妥当な範囲）。
//   ★好みが割れる値なので、つかむツールの設定窓から変えられるようにしてある。
let grabAngDamp = 6;
let thrusterForce = 500;      // ★[N]  新規に配置する動力の推力（手動指定時）
let tracerColor = '#ff7043';    // ★新規に置く軌跡の色
let tracerDuration = 5;         // ★新規に置く軌跡の保持秒数[s]
let thrusterAutoForce = true; // ★true=自重の1.5倍を自動設定（従来の挙動）
// ★ばねツールの既定値（springStiffness / springDampingRatio）はここから消した。
//   ばねは「ばねを張る」ツール（Slinky）の1つだけになり、その既定は下の slinkySpringK ほか。
let _sliderDragging = false;       // スライダー操作中はUIの自動追従を止める
window.addEventListener('pointerup', () => { _sliderDragging = false; });
let _wheelArm = false;             // このホイール操作で履歴を積むか
let _wheelBurstT = null;           // 連続操作は1回の編集としてまとめる
document.addEventListener('wheel', e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'range' || el.disabled) return;
  e.preventDefault();              // パネルのスクロールを止める
  const st = parseFloat(el.step) || 1;
  const lo = parseFloat(el.min), hi = parseFloat(el.max);
  const cur = parseFloat(el.value) || 0;
  const v = Math.min(hi, Math.max(lo, cur + (e.deltaY < 0 ? st : -st)));
  if (v === cur) return;
  el.value = v;
  _wheelArm = _wheelBurstArm();
  el.dispatchEvent(new Event('input', { bubbles: true }));   // 既存ハンドラをそのまま起こす
  _wheelArm = false;
}, { passive: false });
function _wheelBurstArm(){
  const first = (_wheelBurstT === null);
  clearTimeout(_wheelBurstT);
  _wheelBurstT = setTimeout(() => { _wheelBurstT = null; }, 500);
  return first;
}
// ★矢印キーもホイールと同じく、500ms 以内に続けて押した分（押しっぱなしを含む）を1回の編集にする。
//   押すたびに arm すると、1目盛りごとに undo が1段積まれ、歯車では食い込みの案内も連発した。
//   区切りはつまみごとに持つ（Tab で隣のつまみへ移ったら別の編集）。値を動かさないキー
//   （Tab・Shift など）は連打に数えない。戻り値＝この押下が新しい編集の始まりか
const _SLIDER_STEP_KEYS = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End']);
function _keyBurstArm(el, e){
  if (!_SLIDER_STEP_KEYS.has(e.key)) return false;
  const first = !el._keyBurstT;
  clearTimeout(el._keyBurstT);
  el._keyBurstT = setTimeout(() => { el._keyBurstT = null; }, 500);
  return first;
}
let fixjointReleasable = false;        // ★次に置く溶接を「速度ツールで解放」にするか
const SHAPE_TOOLS = ['circle', 'box', 'triangle', 'polygon', 'freehand', 'gear'];
const SHAPE_TOOL_NAMES = { circle:'円', box:'四角', triangle:'三角', polygon:'多角形', freehand:'フリーハンド', gear:'歯車' };
// ★歯車ツールのモジュール（歯の大きさ）[px]。ドラッグした半径からは歯数だけを決め、
//   モジュールはここで固定する。かみ合うのは同じモジュールどうしだけなので、
//   続けて何枚描いてもかみ合うように、描くたびには変えない（gear.js）。
let gearModule = 10;
// 新しく描く物体の質量の決め方（排他）
//   'density' … 密度×面積×奥行き（既定）。密度は drawProps.density [kg/m³]
//   'mass'    … 大きさによらず shapeMass [kg] を与える
// ★既定を密度にしてある。質量を固定にすると、大きく描いても重くならない＝非物理で、
//   衝突の運動量・てこのモーメント・浮力がどれも見た目と食い違う。素材プリセットは
//   もともと密度から質量を出していたので、既定を質量にしておくと、プリセットを押した
//   とたんに質量が数十倍に跳ぶ（同じツールの中に規則が2つある状態だった）。
let shapeMassSource = 'density';
let shapeMass       = 1.0;      // [kg]（'mass' のときだけ使う）
let shapeMaterial   = null;     // 選択中の素材名。null＝素材なし（drawProps.density をそのまま使う）
let shapeAutoFix    = false;    // 描いた物体を「解放可能な固定」でその場に留めるか
const SHAPE_DEFAULT_LOOK = { fillColor:'#4fc3f7', restitution:0.4, friction:0.5, frictionStatic:0.6, drag:0, ior:0, abbe:ABBE_DEFAULT, dispersion:false, reflectance:0 };
const MATERIAL_DEFAULT   = { ...SHAPE_DEFAULT_LOOK, density: 600 };   // ★素材プリセット解除時に戻す値（密度＝質量も既定へ）
// 'density' のときは何もしない：Body は drawProps.density を受け取って
// 質量 = 密度 × 面積 × 奥行き で作られている（body.js の massFromDensity）。
function applyNewBodyDefaults(b) {
  if (shapeMassSource === 'mass') {
    b.setMass(Math.max(1e-3, shapeMass));
    b.density = b.mass / Math.max(b.areaM2() * world.depth, 1e-9);   // 密度と矛盾させない
  }
  if (shapeAutoFix && !b.isStatic) {
    joints.push(new Joint({
      type: 'fixjoint', bodyA: b, bodyB: null,
      anchorAx: 0, anchorAy: 0, anchorBx: b.x, anchorBy: b.y,
      restLength: 0, maxLength: 0, releasable: true,
    }));
  }
}
// ★速度ツールは常に「選択中の物体すべて」へ同じ初速を与える（設定は持たない。velocityTargets 参照）。
// ★ドラッグの向きも設定を持たない。既定は引っぱる（パチンコ。引いた逆へ飛ぶ）で、
//   ドラッグ中に Alt を押している間だけ「狙う」（カーソルの向きへ飛ぶ）になる。
//   画面の端に置いた物体は引く側の余白が無く速さを上げられないので、その逃げ道として使う。
//   Ctrl でないのは、速度ツールでは Ctrl+クリックが「選択の追加／解除」で埋まっているため。
let velocityShowPrediction = true;   // ★速度ツールのドラッグ中に予測軌道を描くか
let axleMotorSpeed  = 12;     // [rad/s] 新規モーター軸の既定回転速度（≒115 rpm）
let axleMotorTorque = 288;    // [N·m]   新規モーターの既定最大トルク（Joint の既定値と一致）
let axleMotorBrake  = false;  // 新規モーターの既定。★切＝リモコンを放したら軸は自由（車輪の流儀）
// ヒンジ・モーター・溶接ツールの留め先。'pair'＝重なった上の2つを綴じる／'board'＝重なった
//   すべてをそれぞれ背景に留める（selection.js の pinJointsAt の★）。3つのツールで共有する。
let pinMode = 'pair';
let jointedBodies = new Set(); // スリープ判定用、毎tick再構築
let connectedPairs = new Set(); // ★接触除外用（ジョイントで繋がれたペアID）、毎tick再構築
// ─── Grid / Snap ─────────────────────
// ─── ストロボ表示（多重露光）─────────────────────────────
//   一定の**シミュレーション時間**ごとに物体の形を残像として残す。ストロボ写真そのもの。
//   ★軌跡（tracer）とは読み取れるものが違う。軌跡は毎tickの連続線＝「どこを通ったか」、
//     ストロボは離散像＝「どんな速さで通ったか」（間隔そのものが情報）。だから代用できない。
//   ★間隔は必ず simTime で刻む。フレーム基準にすると倍速再生で間隔の意味が壊れる。
//   ★濃さは古い像でも変えない。目的が「間隔を読む」ことなので、薄くすると読み取りが歪む
//     （実物のストロボ写真も全部同じ濃さ）。枚数の上限だけで抑える。
let strobeEnabled  = false;
let strobeInterval = 0.1;            // [s] 露光の間隔（シミュレーション時間）
let strobeTarget   = 'selected';     // 'selected' = 選択中の物体だけ ／ 'all' = 動いている物体すべて
let strobeNextT    = 0;              // [s] 次に露光する時刻。★全物体で共有する（下の★を参照）
const STROBE_MAX   = 240;            // 1物体あたりの残像の上限（古いものから捨てる）
//   ★露光の位置に引く補助線。横線は「鉛直方向の間隔」、縦線は「水平方向の間隔」を読む線。
//     残像の輪郭どうしを目で結ぶより、間隔が詰まる／開くがはっきり出る（等間隔＝等速、
//     詰まっていく＝減速）。放物運動では縦線が等間隔・横線が開いていく＝運動の分解そのもの。
let strobeHLine    = false;          // 横線（ワールドの x 方向に伸ばす）
let strobeVLine    = false;          // 縦線（ワールドの y 方向に伸ばす）
let snapEnabled = false;
const gridStep = () => (world.gridSize > 0 ? world.gridSize : 50);
let objSnapEnabled = false;
const OBJ_SNAP_PX = 12;                                                  // 吸着半径（画面px。ズームで割る）
const OBJ_SNAP_NAME = { vertex: '頂点', mid: '辺の中点', center: '中心' };
const OBJ_SNAP_TOOLS = ['polygon','hinge','fixjoint','axle','spring','rope','rod',
                        'thruster','laser','wave','tracer','optic'];
let followEnabled = false;
let followIds = [];                  // 追従対象のID（選択を外しても保持し続ける）
let followMode = 'com';              // 'com' = 質量重心 ／ 'aabb' = 選択範囲の中心
let followFit  = false;              // 全体が収まるまでズームアウト（ズームインはしない）
let followRate = 60;                 // [1/s] 追従の速さ。60 = 即時（ずれゼロ）
let followOffX = 0, followOffY = 0;  // 右ドラッグ・ホイールで生じた画面のずれ（カメラのずれは sceneCamera.offX/offY）
// 重心の印を出す「系」のID。★エネルギーのグラフ（1窓＝1系）と同じ扱いにする：ONにした
//   瞬間の選択を系として抱え込み、選択を外しても別の物体を選び直しても切り替わらない。
//   重心は物体ではなく系が持つ量なので、「いまの選択」に追従させると誰の重心なのかが
//   毎フレーム変わってしまう。空＝出さない。追従先の followIds と同じく保存はしない。
let comIds = [];
let modShift = false;
let modCtrl  = false;   // ★Ctrl（Mac は ⌘）。押している間だけグリッドスナップを反転（mouse.js の gridSnapActiveNow 参照）
let modAlt   = false;   // ★速度ツール：押している間だけ「カーソルの向きへ打ち出す」（velocityAimNow 参照）
const ELLIPSE_SEGMENTS = 40;             // 楕円の多角形近似の頂点数（多いほど滑らか・衝突コスト増）
