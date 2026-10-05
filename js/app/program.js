// ════════════════════════════════════════
//  プログラム（きっかけ → すること）
// ════════════════════════════════════════
//  物体に「きっかけ」と「すること」を1組だけ結びつける仕掛け。窓は画面に貼り付き、
//  つないだ物体とは薄い線で結ばれる。Algodoo の Thyme（onCollide / postStep / onKey）に
//  あたるものだが、文字を書かせず選ぶだけにしてある。
//
//  ★物理には割り込まない。すること（複製・削除・色・レイヤー）は必ず tick の境界で
//    まとめて効かせる（applyPending）。接触を解いている最中にレイヤーが変わると、
//    同じ1回の接触の前半と後半で「すり抜けるかどうか」の前提が食い違う。
//  ★見かけの力や経路駆動はここに入れない。物体を掴んで動かす動作を足すと、その物体だけ
//    無限の質量になってニュートンの第3法則が成り立たなくなる（第6章の不変条件と同じ話）。
//    今ある4つの動作はどれも「物体を作る・消す・見た目を変える・当たり判定を変える」で、
//    力のやりとりには一切触れていない。
//  ★注釈とは立場が違う。注釈は物理に参加しないが、プログラムは物理を変える。
//    描き方（色・破線）をはっきり分けて、落書きと見分けがつくようにしてある。

const PROGRAM_MAX      = 12;      // 同時に置ける数（画面が埋まるので上限を置く）
const PROG_SPAWN_LIMIT = 50;     // 1つのプログラムが出せる既定の個数
const PROG_SPAWN_MAX   = 400;    // 出せる個数の上限（broadphase と描画が重くなるため）
const PROG_LINK_COLOR  = 'rgba(255,213,79,0.55)';   // つなぎ線（黄。注釈の色と重ならない）

let programs = [];
let programSeq = 0;

// きっかけと動作の名前。★保存形式なので変えない（シーンJSONにそのまま入る）
// ★どのトリガーも「つないだ物体（と、複製したもの）」についての条件である。
//   ここを揃えておかないと、プログラムが物体に結びついているという読み方が崩れる。
//   ★回路素子につないだプログラムも同じ約束に従う：条件は「つないだ素子の電流」だけ
//     （'current'。PROG_ELEM_TRIGGERS）。
const PROG_TRIGGERS = [
  ['step',  '○ステップごと'],
  ['dist',  '○m動くごと'],
  // ★速さは「またいだ瞬間」で見る（zone と同じエッジ）。満たしている間ずっとにすると、
  //   止まった物体の上で毎tick発火し続ける。加速度は入れない：エンジンは加速度を状態と
  //   して持たず tick 差分で作るしかないが、接触の力積は1 tick に集中するので
  //   （実測：接触した tick で法線 10.8、次の tick で 0）差分は接触のたび数百 m/s² へ
  //   跳ね、しきい値が判定として働かない。平滑化すれば動くが、それは打ち切り定数を
  //   パネルに出すことになる。「つり合った」「終端速度」はどちらも速さで書ける。
  ['speed', '速さが○〜○m/sになったら'],
  // ★温度も速さと同じ「範囲に入った瞬間」。熱の経路（伝導・放射・加熱冷却領域・摩擦熱）は
  //   問わない＝つないだ物体の温度だけを見る。放射と組めば「触れずに伝わる」仕掛けが組める。
  //   ★行ったり来たり（サーモスタット）は、上の範囲と下の範囲の2枚で書く。範囲に幅が
  //     あるので、そのままヒステリシスになる＝専用の欄は要らない。
  ['temp',  '温度が○〜○℃になったら'],
  ['near',  '半径○m以内の物体の数が'],
  ['zone',  '決めた場所に入ったら'],
  ['hit',   '何かが当たったら'],
  // ★光を「受ける側」の物体に付ける（どのきっかけも、つないだ物体についての条件）。
  //   光電センサーは、的になる物体にこれを付けるだけで組める＝専用の部品を足さない。
  //   向きは lightEdge で選ぶ（当たり始めた瞬間／届かなくなった瞬間）。
  ['light', '光が当たる・途切れる'],
  ['key',   'キーを押した瞬間'],
  // ★ほかのプログラムが出した合図を受ける（合図の★は PROG_ACTIONS の 'signal'）
  ['signal', '合図を受けたら'],
  // ★回路素子につないだときだけのきっかけ（PROG_ELEM_TRIGGERS）。つないだ素子を流れる
  //   電流の大きさ（向きは見ない）が範囲へ入った瞬間。速さ・温度と同じエッジで、
  //   「流れ始めたら」「止まったら」は範囲の2枚で書く（上の 'temp' のサーモスタットと同じ）。
  ['current', '電流が○〜○Aになったら'],
];
// ── 回路素子につなぐ（2026-09-30）────────────────────────────
//  ★回路 → 合図の橋。論理と記憶は回路（リレー）が受け持ち、プログラムは結果を
//    仕掛けへ渡すだけにする（合図の側に AND・NOT を持たせない、というユーザーの判断）。
//    逆向き（合図 → 回路のスイッチ）はリモコン（remote.js 冒頭の★ 2026-09-30）。
//  ★素子につないだときに選べるのは、電流のきっかけと、物に触らない2つのすることだけ。
//    素子は物体ではないので、複製・削除・色・レイヤーの相手になれない。複製などは
//    ここから合図を出し、物体につないだプログラムが受けて行う（名指ししない形は同じ）。
const PROG_ELEM_TRIGGERS = ['current'];
const PROG_ELEM_ACTIONS  = ['signal', 'pause'];
const PROG_ACTIONS = [
  ['create', '生成'],
  ['spawn',  '複製'],
  ['delete', '削除する'],
  ['color',  '色を変える'],
  ['layers', '衝突レイヤーを変える'],
  // ★これだけは物体ではなく「時計」に効く。物理には一切触らないので、運動量も
  //   エネルギーの台帳も動かない（カメラと同じ「物理はそのまま、見る側を変える」側）。
  //   ★「物体を止める」「力を加える」は入れない。運動量が無から消え、冒頭の★が崩れる。
  //   ★これが要る理由：接触の力積は1 tick にしか出ない。走ったままだとその画は
  //     1フレーム（16ms）で消えるが、その tick で止めれば _forces が次の simTick の
  //     頭まで残るので、矢印は本当の大きさのまま留まる（実測：止めて60フレーム描いても
  //     10.8 のまま。1 tick 遅れて止めると 0.2 ＝重力だけになる＝手のコマ送りでは
  //     間に合わない）。撃心のデモが ×0.25 に落としているのはこの回避策。
  ['pause',  '実行を止める'],
  // ★合図を出す。受けるのは〈合図を受けたら〉のプログラムで、同じ番号なら何個でも受ける。
  //   ★相手を名指ししない（「プログラム3が発火したら」にしない）。名指しは1対1にしかならず、
  //     名指した相手を消す・複製するとつながりが切れる。番号で結ぶのは回路のモーターを
  //     チャンネル（motorCh）でつなぐのと同じ形で、出す側も受ける側も何個あってもよい。
  //   ★これで「原因と結果が別の物体にある」仕掛けが書ける。いままでは原因（きっかけ）と
  //     結果（すること）が同じ物体か、ぶつかった2つの上にしか置けなかった
  //     （旧ピタゴラスイッチの⑦は、これを光のきっかけで回り道していた）。
  //   ★物体にも時計にも触らない（'pause' と同じく相手の欄が無い）。力のやりとりにも触れない。
  //   ★届くのは次の tick の境界（updatePrograms の頭）。同じ tick のうちに届けると、
  //     A→B→A と輪にしたとき1 tick の中で終わらない。1 tick 遅らせれば輪は
  //     「1 tick ごとに打つ時計」になるだけで、固まらない。
  //   ★1 tick に何回出しても、同じ番号は1回として届く（合図は「その tick に出たか」だけ）。
  ['signal', '合図を出す'],
];
const PROG_MAKERS = ['create', 'spawn'];   // 物体を作る操作（生成口・複製元の設定を出す）

// ── 生成口の設定変更を、出ている物体にも渡す（sync）──────────────────────
//  ★渡すのは「型を触った、そのとき一度きり」。毎フレーム型の値を押しつけるのではない。
//    押しつけにすると、出てきた物体が重力で加速できず、当たっても跳ね返らない
//    （毎フレーム型の速度へ引き戻される）＝物理が消える。触った瞬間に1回だけ揃えれば、
//    受け取ったあとは各自がふつうに自分の物理を続ける。
//  ★触ったと分かったら、変わった項目だけでなく下の全部を型の値に揃える。
//    「変わった項目だけ」にしていたときは、肝心の〈一斉に止める〉が効かなかった：
//    出ている物体の速度は物理で型から離れていくのに、型の値は据え置きなので差が出ない。
//    実測：転がる球を止めようと型の vx を 3→0 にしても、渡らなかった角速度で球は
//    転がり続け、0.5 秒で 0.27 m 進んだ。落下中の vy も同じ理由で揃わなかった。
//    「型を触ったら、出ているものが型の値に揃う」——この一言で言い切れる規則にする。
//  ★渡してよい量には2つの条件がある。両方を満たすものだけを並べてある。
//    ① エンジンが書き換えない量であること。型の値が勝手に動くと「変わった＝人が
//       触った」と読めなくなり、毎フレーム配り続けることになる。速度がここに入って
//       いられるのは、生成口が積分もマウスの掴みも通らないから（body.js:420 ほか）。
//       温度を外してあるのはこの条件のため：放射と加熱冷却領域は生成口の温度も動かす。
//    ② その物体がどこに居るかに依らない量であること。位置・向き・形は各自のもので、
//       渡すと全部が生成口の上に重なる。形は当たり判定の大きさが接触の途中で変わる。
const PROG_SYNC_PROPS = [
  'vx', 'vy', 'av',                                            // 運動（一斉に止める・進める）
  // ★density は mass より先に置く（applySyncProp が密度から質量を作り直すため）
  'density', 'mass', 'isStatic', 'constVel', 'fixedRotation', 'hasGravity',
  'restitution', 'friction', 'frictionStatic', 'drag',
  'heatCap', 'conduct', 'emissivity', 'tempFixed',             // ★temp は入れない（上の①）
  'charge', 'conductor', 'fieldSource',
  // ★運動方向固定は「向き」だけを渡し、レールの通る点（guidePx/guidePy）は渡さない（②）。
  //   点は各自が生まれた場所＝生成口の位置を控えていて、向きが同じなら全員が同じ1本の
  //   レールに乗っている。点まで揃えても何も変わらず、斜めのレールでは全部が生成口の
  //   1点へ引き寄せられる（射影の足が動く）。
  'guideEnabled', 'guideAngle',
  'layers',
  'fillColor', 'strokeColor', 'strokeWidth', 'alpha',
  // ★動力は「何本あって、それぞれ何 N でどっち向きか」がまとまって1つの量。
  //   配列そのものを渡すと、型と出ている物体が同じ配列を共有してしまう（片方を
  //   動かすと全部が動く）ので、渡し方だけ applySyncProp で別扱いにしてある。
  'thrusters',
  'tracerEnabled', 'tracerColor', 'tracerDuration', 'tracerAnchorX', 'tracerAnchorY',
  'ior', 'dispersion', 'abbe', 'reflective', 'reflectance', 'fresnel',
];

class Program {
  constructor(o) {
    o = o || {};
    this.id = o.id !== undefined ? o.id : ++programSeq;
    if (o.id !== undefined && o.id > programSeq) programSeq = o.id;
    this.bodyId = o.bodyId !== undefined ? o.bodyId : null;   // つないだ物体
    // つないだ回路素子（PROG_ELEM_TRIGGERS の★）。bodyId とどちらか一方だけを持つ
    this.elemId = o.elemId !== undefined ? o.elemId : null;
    // ★窓の位置は画面の「割合」で持つ。px で持つと別の大きさの窓で開いたとき画面外へ出る
    //   （デモの配置が DEMO_REF_W/H を基準に掛け直しているのと同じ理由）。
    this.fx = o.fx !== undefined ? o.fx : 0.72;
    this.fy = o.fy !== undefined ? o.fy : 0.08;
    this.collapsed = !!o.collapsed;
    this.trigger = o.trigger || 'step';
    this.step = o.step !== undefined ? o.step : 60;     // 'step' の周期 [ステップ]
    this.dist = o.dist !== undefined ? o.dist : 1.0;    // 'dist' の間隔 [m]
    // 'speed'：速さ [m/s] の範囲。★既定は「ほぼ止まった」＝0〜0.1。ちょうど 0 にすると、
    //   接触で残るわずかな速度のせいでいつまでも入らないことがある。
    //   ★角速度は見ない（速さは並進の量。転がる球を「止まった」と読ませないため）。
    this.spdMin = o.spdMin !== undefined ? o.spdMin : 0;
    this.spdMax = o.spdMax !== undefined ? o.spdMax : 0.1;
    // 'temp'：温度 [K] の範囲（窓では ℃）。★既定は「熱くなったら」＝50〜1000℃。
    //   上限を置くのは速さと同じ形にそろえるため（「冷えたら」は下限を −273℃ にして書く）。
    this.tempMin = o.tempMin !== undefined ? o.tempMin : C2K(50);
    this.tempMax = o.tempMax !== undefined ? o.tempMax : C2K(1000);
    // 'current'：電流 [A] の大きさの範囲。★既定の下限はリレーの引き込み電流の既定
    //   （CIRCUIT_DEFAULTS.relay.Ipull）にそろえる＝「リレーが動くほど流れたら」。
    //   ★上限は短絡でも超えない大きさにする。電源の内部抵抗は下限 SRC_R_MIN(1mΩ) まで
    //     下がるので、10V の短絡で 1e4 A に届く。上限を低く置くと、短絡した瞬間に
    //     範囲の外へ出て「流れているのに発火しない」になる。
    this.curMin = o.curMin !== undefined ? o.curMin : CIRCUIT_DEFAULTS.relay.Ipull;
    this.curMax = o.curMax !== undefined ? o.curMax : 1e6;
    // 'near'：半径 [m] と、その中にある物体の数の範囲（自分は数えない）
    this.nearR   = o.nearR   !== undefined ? o.nearR   : 1.0;
    this.nearMin = o.nearMin !== undefined ? o.nearMin : 0;
    this.nearMax = o.nearMax !== undefined ? o.nearMax : 0;
    // ★何を数えるか。'all' だけだと、通りすがりの無関係な物体まで数えてしまい、
    //   エミッタが止まる（実測：光路の 0.6 m 横に置いた生成口は、0.067秒ごとに
    //   半径を横切る球を数えてしまい、歯が1個も出なかった）。
    this.nearWhat = o.nearWhat || 'all';   // 'all' | 'layer'（同じ衝突レイヤー） | 'kin'（自分の複製）
    // ★'hit' で何を「当たった」と数えるか。nearWhat とまったく同じ形の絞りで、
    //   理由も同じ：数えすぎると発火しっぱなしになる。地面と壁を相手に入れた以上、
    //   床に載っているだけの物体は1tick目から「地面に当たっている」ことになり、
    //   ▶を押した瞬間に止まってしまう（実測：床の上の台車2台で、衝突を待たず tick 1 で
    //   発火した）。既定を 'body' にしてあるのは、これが今までの「当たったら」の意味
    //   そのままで、既存のシーンの挙動を変えないため。
    //   ★'same'＝物体のうち、衝突レイヤーの設定が自分と**まったく同じ**もの。
    //     near の 'layer'（1つでも共有していれば数える）とは判定が違う：当たったという
    //     ことは必ずレイヤーを1つ共有しているので、共有で絞ると何も絞れない。
    //     使いどころはブロック崩し：球とブロックを同じ設定に、パドルと壁を
    //     「球と共有はするが同じではない」設定にしておけば、球に付けた
    //     「当たってきた相手を削除」1つでブロックだけが消える（ブロックごとに
    //     プログラムを貼らなくてよい＝上限の12個にかからない）。
    // ★'light' の向き。どちらも「またいだ瞬間」（zone と同じエッジ）。当たっている間
    //   ずっとにすると、照らされた的が毎 tick 発火し続ける。
    //   'on'＝当たり始めた（光を当てたらスタート）／'off'＝届かなくなった（遮ったら作動）
    this.lightEdge = o.lightEdge === 'off' ? 'off' : 'on';
    this.hitWhat = o.hitWhat || 'body';    // 'body' | 'same'（同じレイヤー設定の物体） | 'env'（地面・壁） | 'all'
    // 'step' / 'dist' の回数の上限。0＝制限なし。★物体ごとに数える（＝各自が自分の
    //   生まれた時から）。これで「出てから○ステップたったら消える」が寿命として書ける。
    this.times = o.times !== undefined ? o.times : 0;
    // ★数える：きっかけが every 回起きるたびに1回だけ「すること」をする（1＝毎回）。
    //   回数の上限（times）と同じく**物体ごと**に数える（どのきっかけも「つないだ物体に
    //   ついての条件」という約束。〈複製にも適用〉なら出てきた物体がそれぞれ数える）。
    //   ★times は以前は ○ステップごと・○m動くごと だけのものだったが、数えるのと組んで
    //     「3回目で1回だけ」（every 3・times 1）と書けるように、全部のきっかけへ広げた。
    //     数えるのも上限も fireProgram の1か所でやる（きっかけごとに書くと必ずずれる）。
    //   ★'near' は「満たしている間ずっと」＝毎 tick が1回。every 60 なら 1秒に1回になる。
    this.every = Math.max(1, (o.every | 0) || 1);
    // ★遅らせる [s]：きっかけのあと、この時間がたった tick の境界で「すること」をする
    //   （0＝すぐ）。数えるのはきっかけの時点（遅らせている間に次が来ても、それはそれで数える）。
    //   ★待っている間に相手が消えたら何もしない（applyPending がいつも確かめている）。
    //   ★時計はシミュレーションの tick（1/60 秒）。止めている間は進まない。
    this.delay = Math.max(0, +o.delay || 0);
    // ★既定は Enter。Space（つかむ）と Z（実行／停止）は予約なので初期値にしない
    //   （keyboard.js の先頭で Space だけ入力欄より先に処理している）。
    this.key  = o.key  || 'Enter';                      // 'key' のキー（e.code）
    // 合図の番号。★受ける番号と出す番号を別に持つ：「合図1を受けたら合図2を出す」で
    //   中継・枝分かれが書ける。1つにすると、受けたのと同じ番号を出し直す＝自分自身への
    //   輪（1 tick ごとの時計）しか書けない。
    this.sigIn  = Math.max(1, (o.sigIn  | 0) || 1);    // 'signal' のきっかけ
    this.sigOut = Math.max(1, (o.sigOut | 0) || 1);    // 'signal' のすること
    this.action = o.action || 'spawn';
    this.target = o.target || 'self';                   // 'self' | 'other'（'hit' のときだけ選べる）
    // ★「複製・生成した物体にもプログラムを適用」。生成・複製のときだけ設定できる。
    //   ONにすると、この物体につないでいる“すべての”プログラムが、出てきた物体も
    //   見張るようになる（このプログラムだけではない）。だから「出てから○ステップで
    //   消える」は、同じ物体にもう1枚プログラムを貼るだけで書ける＝入れ子が要らない。
    this.scope = o.scope || 'one';                      // 'one' | 'copies'
    // ★「生成口の設定変更を、出ている物体にも反映」。生成のときだけ設定できる。
    //   ONにすると、生成口を触った瞬間、すでに出ている物体が生成口の値に揃う
    //   （速度を0にすれば一斉に止まり、戻せば一斉に進む）。揃う項目は PROG_SYNC_PROPS。
    //   ★複製（spawn）には出さない。複製元は動く実体で、速度も向きも位置もエンジンが
    //     毎 tick 書き換える＝「変わった」が人の操作かどうか見分けられない。
    //     生成口だけがこの条件（PROG_SYNC_PROPS の①）を満たす。
    this.sync = !!o.sync;
    // ★速さ・向きは持たない。出てくる物体の速度は「型の右パネルの値」がそのまま入る。
    //   ここに持たせると、同じ量の置き場所が2つできて必ず食い違う（複製して“放つ”を
    //   やめたのはこのため）。
    // ★出る場所は「つないだ物体の位置」だけ。座標で指定する欄は置かない——生成口を
    //   置いた場所がそのまま出口であって、別の座標を持たせると出口の置き場所が2つに
    //   割れる（速さ・向きをプログラム側に持たせないのと同じ理由）。
    this.limit     = o.limit     !== undefined ? o.limit     : PROG_SPAWN_LIMIT;
    this.color  = o.color  || '#ef5350';
    this.layers = o.layers !== undefined ? o.layers : 0b0010;
    // ★'zone' の四角。★領域は「世界に置く要素」ではなく、このプログラムが持つ。
    //   条件は「つないだ物体についてのルール」であって、世界にある物ではないため。
    //   要素にすると電場・磁場・加熱冷却・流れの場と同じ配線が要り、置き場所も
    //   「プログラムの条件」と「世界の物」に割れる。中心＋幅高さは EMField と同じ持ち方。
    this.zx = o.zx !== undefined ? o.zx : 0;      // 中心 [px]
    this.zy = o.zy !== undefined ? o.zy : 0;
    this.zw = Math.max(4, o.zw !== undefined ? o.zw : 200);   // 幅・高さ [px]
    this.zh = Math.max(4, o.zh !== undefined ? o.zh : 200);
    this.reset();
  }
  // 実行時の状態（保存しない。リセットでここへ戻る）
  //   ★プログラムはルールだけを持ち、数えごとは「見張られている物体」が持つ（_st）。
  //     カウンタをここに1つだけ置くと、複製したものを見張るときに全員で共有してしまい、
  //     「出てから○ステップで消える」（＝各自が自分の生まれた時から数える）が書けない。
  //   ★個数の上限だけはプログラムが持たず、そのつど数える（progLiveCount）。
  reset() {
    this._pending = [];     // この tick に効かせる操作
    this._delayed = [];     // 遅らせている操作 { due: progTickNo, job }
    this._state = new Map(); // 物体id → 数えごと
    // ★sync の「前に見た型の値」。null に戻すと、次の1回は配らずに控え直すだけになる。
    //   やり直し・元に戻す・設定の変更のあとに前の控えが残っていると、戻ってきた値との
    //   差を「人が触った」と読んで配ってしまう。
    this._snap = null;
  }
  // 見張っている物体1つぶんの状態。無ければその場で作る
  _st(b) {
    let s = this._state.get(b.id);
    if (!s) {
      s = { step: 0, moved: 0, px: b.x, py: b.y,
            inZone: false, inNear: false, inSpeed: false, inTemp: false, inCur: false, lit: false,
            fired: 0, hits: 0 };
      this._state.set(b.id, s);
    }
    return s;
  }
  // 速さ [m/s] が範囲の中にあるか。★並進の速さだけを見る（角速度は別の量）
  speedContains(b) {
    const v = Math.hypot(b.vx, b.vy) * PX2M;
    return v >= this.spdMin && v <= this.spdMax;
  }
  // 温度 [K] が範囲の中にあるか
  tempContains(b) {
    return b.temp >= this.tempMin && b.temp <= this.tempMax;
  }
  // 電流 [A] の大きさが範囲の中にあるか（回路素子）。★向きは見ない（交流でも「流れている」）
  currentContains(e) {
    const I = Math.abs(e.I || 0);
    return I >= this.curMin && I <= this.curMax;
  }
  zoneContains(b) {
    return Math.abs(b.x - this.zx) <= this.zw/2 && Math.abs(b.y - this.zy) <= this.zh/2;
  }
  // 半径の中にある物体の数（自分は数えない）。生成口は物ではないので数えない
  nearCount(b) {
    const r = Math.max(0.01, this.nearR) * M2PX, r2 = r * r;
    // 'kin'＝同じ型から出たもの。b 自身が型（生成口）なら b.id が一族の目印になる
    const root = b._progOrigin !== undefined ? b._progOrigin : b.id;
    let n = 0;
    for (const o of objects) {
      if (o === b || o.isSpawner) continue;
      if (this.nearWhat === 'layer' && (o.layers & b.layers) === 0) continue;
      if (this.nearWhat === 'kin'   && o._progOrigin !== root) continue;
      const dx = o.x - b.x, dy = o.y - b.y;
      if (dx*dx + dy*dy <= r2) n++;
    }
    return n;
  }
  body() { return this.bodyId == null ? null : objects.find(o => o.id === this.bodyId) || null; }
  elem() { return this.elemId == null ? null : circuitElements.find(e => e.id === this.elemId) || null; }
  onElem() { return this.elemId != null; }
}

// ── 接触の記録 ───────────────────────────────────────────
//   ★接触検出はサブステップごと（既定4回/tick）に走るので、素直に書くと1回の衝突で
//     4回発火する。しかも触れ続けている間は毎tick発火する。そこで「この tick に触れて
//     いた対」を集めておき、前の tick に無かった対だけを新しい接触として1回発火させる
//     （noteThermalContact と同じ置き場所・同じ鍵の作り方）。
//   ★相手は物体とは限らない。地面と壁は Body ではないので、負の id を割り当てて
//     同じ対の集合に入れる。これが無いと「床に当たったら」が書けない——デモの床は
//     たいてい無限地面なので、物体どうしだけ見ていると一度も発火しない。
//     負の数にしてあるのは、物体の id（正）と衝突しないことを保証するため。
const PROG_GROUND_ID = -1;
const PROG_WALL_ID   = -2;
let progPairsNow  = new Set();
let progPairsPrev = new Set();
// 合図。★出た合図は progSigNext に積み、次の updatePrograms の頭で progSigNow へ移して配る
//   （PROG_ACTIONS の 'signal' の★）。停止中にキーで出した合図は、▶で最初の tick に届く。
let progSigNext = new Set();
let progSigNow  = new Set();
// ★遅らせるための時計。updatePrograms の頭で1つ進む＝tick の番号（停止中は進まない）
let progTickNo = 0;
const progPairKey = (a, b) => (a.id < b.id ? a.id + '_' + b.id : b.id + '_' + a.id);
function noteProgramContact(A, B) {
  if (!programs.length || A === B) return;
  progPairsNow.add(progPairKey(A, B));
}
// 地面・壁との接触。★env は必ず負なので、鍵の並びは progPairKey と同じ（小さい方が先）
function noteProgramEnvContact(b, envId) {
  if (!programs.length) return;
  progPairsNow.add(envId + '_' + b.id);
}

// ── 毎 tick ───────────────────────────────────────────────
//   step.js がサブステップ列を終えたあとに1回だけ呼ぶ。
function updatePrograms(dt) {
  // ★前の tick（とその後のキー操作）で出た合図を、この tick に届ける
  progSigNow = progSigNext; progSigNext = new Set();
  progTickNo++;
  // ★待ち時間が明けた操作を、この tick の終わりに効かせる列へ移す
  for (const p of programs) {
    if (!p._delayed.length) continue;
    const keep = [];
    for (const d of p._delayed) { if (d.due <= progTickNo) p._pending.push(d.job); else keep.push(d); }
    p._delayed = keep;
  }
  if (!programs.length) { progPairsPrev = progPairsNow; progPairsNow = new Set(); return; }
  // ★光が届いている物体は、使うプログラムがあるときだけ、tick に1回だけ求める
  let lit = null;
  for (const p of programs) {
    // ★回路素子につないだもの。電流は同じ tick のサブステップ列（emStepPost）で解き終えている
    if (p.onElem()) {
      const e = p.elem();
      if (!e || p.trigger !== 'current') continue;
      const s = p._st(e), on = p.currentContains(e);
      if (on && !s.inCur) fireProgram(p, e, null);
      s.inCur = on;
      continue;
    }
    const b = p.body();
    if (!b) continue;                        // つないだ物体が消えていたら何もしない
    // ★step / dist / near / zone は、見張っている物体を1つずつ、それぞれの状態で判定する。
    //   だから複製したものを見張っているときも、各自が自分の生まれた時から数える。
    if (p.trigger === 'step' || p.trigger === 'dist' || p.trigger === 'speed' ||
        p.trigger === 'temp' || p.trigger === 'near' || p.trigger === 'zone' || p.trigger === 'light' ||
        p.trigger === 'signal') {
      const fam = progFamily(p, b);
      const live = new Set();
      for (const o of objects) {
        if (!fam.has(o.id)) continue;
        // ★生成口は「物」ではないので、物を変える操作（削除・色・レイヤー）の対象に
        //   しない。これが無いと、寿命のプログラムが入口そのものを消してしまう。
        //   ★時計と合図（'pause'／'signal'）は物に触らないので、生成口の上でも働かせる。
        if (o.isSpawner && !PROG_MAKERS.includes(p.action) &&
            p.action !== 'pause' && p.action !== 'signal') continue;
        live.add(o.id);
        const s = p._st(o);
        // 回数の上限（0＝制限なし）。step / dist だけが持つ
        if ((p.trigger === 'step' || p.trigger === 'dist') &&
            p.times > 0 && s.fired >= p.times) continue;
        if (p.trigger === 'step') {
          if (++s.step >= Math.max(1, Math.round(p.step))) { s.step = 0; fireProgram(p, o, null); }
        } else if (p.trigger === 'dist') {
          // ★つないだ物体“自身”が進んだ道のりで刻む。時間で刻むと、速さを上げたときに
          //   間隔も比例して伸び、単位時間あたりの回数が速さによらなくなる
          //   （＝速くしても何も起きない。フィゾーの題材はこれで成立しなくなる）。
          s.moved += Math.hypot(o.x - s.px, o.y - s.py) * PX2M;
          s.px = o.x; s.py = o.y;
          const step = Math.max(0.02, p.dist);
          while (s.moved >= step && !(p.times > 0 && s.fired >= p.times)) {
            s.moved -= step; fireProgram(p, o, null);
          }
        } else if (p.trigger === 'speed') {
          // ★またいだ瞬間だけ（zone と同じエッジ）。範囲の中に居る間ずっとにすると、
          //   止まった物体の上で毎tick発火し続ける。
          const on = p.speedContains(o);
          if (on && !s.inSpeed) fireProgram(p, o, null);
          s.inSpeed = on;
        } else if (p.trigger === 'temp') {
          // ★速さと同じく、またいだ瞬間だけ（範囲に居る間ずっとにすると、熱い物体の上で
          //   毎 tick 発火し続ける）。
          const on = p.tempContains(o);
          if (on && !s.inTemp) fireProgram(p, o, null);
          s.inTemp = on;
        } else if (p.trigger === 'near') {
          // ★これだけは「満たしている間ずっと」で判定する（他は出来事＝エッジ）。
          //   瞬間だけにすると、始めから満たしている場合（まわりに何も無い生成口が
          //   まさにこれ）に一度も発火せず、エミッタが作れない。
          //   ★物を作る操作では自分で止まる：1個出せば数が増えて条件を外れ、
          //     出したものが半径から出ていってはじめて次が出る＝間隔がちょうど半径になる。
          if (p.nearCount(o) >= p.nearMin && p.nearCount(o) <= p.nearMax) fireProgram(p, o, null);
        } else if (p.trigger === 'signal') {
          // ★見張っている物体ごとに1回。〈複製にも適用〉なら出ている物体が全員受ける
          //   （「合図で出ているものを一斉に消す」が書ける）。
          if (progSigNow.has(p.sigIn)) fireProgram(p, o, null);
        } else if (p.trigger === 'light') {
          if (!lit) lit = laserLitIds();
          const on = lit.has(o.id);
          if (on !== s.lit && on === (p.lightEdge === 'on')) fireProgram(p, o, null);
          s.lit = on;
        } else {
          const on = p.zoneContains(o);
          if (on && !s.inZone) fireProgram(p, o, null);       // 外→中の一歩だけ
          s.inZone = on;
        }
      }
      // 消えた物体の状態は捨てる（残すと id が再利用されたときに古い数が効く）
      for (const id of Array.from(p._state.keys())) if (!live.has(id)) p._state.delete(id);
    } else if (p.trigger === 'hit') {
      const fam = progFamily(p, b);
      for (const k of progPairsNow) {
        if (progPairsPrev.has(k)) continue;              // 触れ続けているだけ＝発火しない
        const ids = k.split('_');
        const ia = +ids[0], ib = +ids[1];
        // ★どちらが「見張っている側」かを決める。両方とも身内なら発火しない
        //   （歯どうしがぶつかっても意味がないし、片方を消すと左右が決まらない）。
        const aIn = fam.has(ia), bIn = fam.has(ib);
        if (aIn === bIn) continue;
        const selfId = aIn ? ia : ib, otherId = aIn ? ib : ia;
        const isEnv = otherId < 0;                       // 相手が地面・壁
        if (p.hitWhat === 'body' && isEnv) continue;
        if (p.hitWhat === 'env'  && !isEnv) continue;
        if (p.hitWhat === 'same' && isEnv) continue;
        const self  = objects.find(o => o.id === selfId);
        // ★相手が地面・壁（負の id）なら「相手」は居ない。〈当たってきた相手〉を選んで
        //   いれば fireProgram が何もせずに戻る＝床を消そうとして落ちることはない。
        const other = otherId < 0 ? null : objects.find(o => o.id === otherId);
        if (p.hitWhat === 'same' && (!self || !other || other.layers !== self.layers)) continue;
        if (self) fireProgram(p, self, other);
      }
    }
    // 'key' は keyboard.js から fireProgramsByKey で入る
  }
  applyPendingPrograms();
  progPairsPrev = progPairsNow;
  progPairsNow = new Set();
}

// 設定を触った直後は「いまの状態」を現状のまま記録し直す。
//   ★zone と near は「満たした瞬間」で発火するので、これをやらないと、四角を物体の
//     上へ動かしただけ／個数の範囲を広げただけで「入った」と判定されて暴発する。
//     位置・大きさ・半径・個数を触ったら必ずここを通すこと。
function syncProgramState(p) {
  if (p.onElem()) {
    const e = p.elem();
    if (e) p._st(e).inCur = p.currentContains(e);
    return;
  }
  const b = p.body();
  if (!b) return;
  const fam = progFamily(p, b);
  for (const o of objects) {
    if (!fam.has(o.id)) continue;
    const s = p._st(o);
    s.px = o.x; s.py = o.y;
    s.inZone = p.zoneContains(o);
    s.inSpeed = p.speedContains(o);
    s.inTemp = p.tempContains(o);
    if (p.trigger === 'light') s.lit = laserLitIds().has(o.id);
    const n = p.nearCount(o);
    s.inNear = (n >= p.nearMin && n <= p.nearMax);
  }
}
// この物体につないだ「生成・複製」のどれかが〈複製した物体にもプログラムを適用〉なら真。
//   ★判定を作る側のプログラムに置いてあるのが肝。ONにすると、この物体につないでいる
//     すべてのプログラムが複製先にも及ぶ（このプログラムだけではない）。だから
//     「出てから○ステップで消える」は、同じ物体にプログラムをもう1枚貼るだけで書ける。
function progAppliesToCopies(b) {
  return programs.some(q => q.bodyId === b.id &&
                            PROG_MAKERS.includes(q.action) && q.scope === 'copies');
}
// 見張る物体の id 一式。上が真なら、この物体から作られたものも入れる。
//   ★複製の複製も元をたどれるように、_progOrigin は「いちばん最初の型の id」を持ち回る。
function progFamily(p, b) {
  const s = new Set([b.id]);
  // ★物を作るプログラム自身は、複製先へ広げない。広げると出てきた物体が全部
  //   生成口になって倍々に増える（実測：上限20個が2秒で埋まった）。
  //   〈複製した物体にもプログラムを適用〉が及ぶのは、同じ物体につないだ“他の”
  //   プログラム——寿命・色・レイヤー・当たり判定——のほうである。
  if (PROG_MAKERS.includes(p.action)) return s;
  if (progAppliesToCopies(b))
    for (const o of objects) if (o._progOrigin === b.id) s.add(o.id);
  return s;
}
// この型から出て、いま生きているものの数（一族で1つの予算）。
//   ★「出した合計」ではなく「いま出ている数」で数える。上限は broadphase と描画を
//     守るためのものなので、消えたぶんは戻ってよい。合計で数えると、出したそばから
//     片づけるしくみ（寿命・片づけの四角）と組み合わせたときに、画面には十数個しか
//     無いのに予算だけが尽きて生成が止まる（実測：フィゾーの模型で 53 秒＝400発
//     ちょうどで光源が黙り、以後1発も出なかった。そのとき生きていた球と歯は合わせて
//     11〜20 個だった）。
//   ★暴走止めとしても live のほうが素直：ねずみ算で困るのは「同時にいる数」である。
//     「合計で○回まで」が要るときは回数の上限（times）が別にある＝役割が分かれている。
function progLiveCount(root) {
  let n = 0;
  for (const o of objects) if (o._progOrigin === root) n++;
  return n;
}
// きっかけが起きた。すぐには効かせず、この tick の終わりへ積む
function fireProgram(p, self, other) {
  // ★「実行を止める」「合図を出す」は相手が要らない（物体ではなく時計・合図に効くので）。
  //   ここで先に分けておかないと、地面に当たったとき（相手が居ない）に止められない。
  let job;
  if (p.action === 'pause')       job = { kind: 'pause' };
  else if (p.action === 'signal') job = { kind: 'signal' };
  else {
    const t = p.target === 'other' ? other : self;
    if (!t) return;          // ★相手が居ない＝起きなかった。数えもしない
    job = { kind: PROG_MAKERS.includes(p.action) ? 'spawn' : p.action, t };
  }
  // ── 数える・回数の上限（Program の every／times の★）──
  if (self) {
    const s = p._st(self);
    s.hits++;
    if (p.every > 1 && s.hits % p.every !== 0) return;
    if (p.times > 0 && s.fired >= p.times) return;
    s.fired++;
  }
  if (job.kind === 'spawn') {
    const t = job.t, root = t._progOrigin !== undefined ? t._progOrigin : t.id;
    // ★この tick にもう積んである分・遅らせている分も数える（applyPending はまだ走っていない）。
    //   数えないと、1 tick に何度も発火するきっかけで上限を飛び越える。
    let pend = 0;
    for (const j of p._pending) if (j.kind === 'spawn') pend++;
    for (const d of p._delayed) if (d.job.kind === 'spawn') pend++;
    if (progLiveCount(root) + pend >= Math.min(p.limit, PROG_SPAWN_MAX)) return;
  }
  if (p.delay > 0) p._delayed.push({ due: progTickNo + Math.max(1, Math.round(p.delay / SIM_DT)), job });
  else p._pending.push(job);
}
// 積んだ操作を tick の境界でまとめて効かせる（★この関数の外では物体を作らない・消さない）
function applyPendingPrograms() {
  let removed = false, unsupported = false;
  for (const p of programs) {
    for (const job of p._pending) {
      const t = job.t;
      if (job.kind === 'pause') {
        // ★物体には触らない。止めるのは時計だけ。この tick で解いた力は _forces に
        //   残ったままなので、接触した瞬間の矢印がそのまま画面に留まる。
        if (running) simPause();
      } else if (job.kind === 'signal') {
        progSigNext.add(p.sigOut);        // ★届くのは次の tick（上の★）
      } else if (job.kind === 'spawn') {
        if (!objects.includes(t)) continue;
        spawnFromProgram(p, t);
      } else if (job.kind === 'delete') {
        const i = objects.indexOf(t);
        if (i >= 0) { objects.splice(i, 1); removed = true; unsupported = true; }
      } else if (job.kind === 'color') {
        if (objects.includes(t)) t.fillColor = p.color;
      } else if (job.kind === 'layers') {
        if (objects.includes(t)) { t.layers = p.layers & LAYER_ALL; unsupported = true; }
      }
    }
    p._pending.length = 0;
  }
  if (removed) dropDanglingRefs();
  // ★支えを消した・すり抜けにしたら、眠っているものを起こす。眠った物体は接触が
  //   無くなっても自分では起きない（wakeOnContact は「起きている相手に触れられた」
  //   ときだけ起こす）ので、消えた床の上の物体が宙に浮いたまま残る。
  //   実測（旧ピタゴラスイッチ：戸の上で 0.6秒で眠った球）：戸が消えて 19秒たっても
  //   1px も落ちなかった。手で消すのは停止中なので、▶の時点で眠りから始め直せば済む。
  //   実行中に物を消せるのはプログラムだけなので、ここで起こす（リモコンの〈手で動かす〉
  //   が動き出す瞬間に wakeAll するのと同じ形）。
  if (unsupported) wakeAll();
}
// 消えた物体を指しているジョイント・要素を落とす（残すと落ちる）
function dropDanglingRefs() {
  const live = new Set(objects);
  for (let i = joints.length - 1; i >= 0; i--) {
    const j = joints[i];
    if ((j.bodyA && !live.has(j.bodyA)) || (j.bodyB && !live.has(j.bodyB))) joints.splice(i, 1);
  }
  for (let i = lasers.length - 1; i >= 0; i--)
    if (lasers[i].body && !live.has(lasers[i].body)) lasers.splice(i, 1);
  for (const id of Array.from(selectedIds))
    if (!objects.some(o => o.id === id)) selectedIds.delete(id);
}
// 複製する。★型の右パネルの値をそのまま引き継ぐ——速度も、向きも、動力も、軌跡も。
//   プログラム側は速さ・向きを持たない。持たせると同じ量の置き場所が2つできて必ず
//   食い違うため（「複製して放つ」を複製と初速の2つに割った理由がこれ）。
//   ★軌跡（tracerEnabled ほか）は Body のプロパティなので、この JSON コピーだけで
//     自動的に引き継がれる。動力も同じ経路で引き継がれる（本数ぶんそのまま）が、
//     id だけは下で落とす。
function spawnFromProgram(p, t) {
  const d = JSON.parse(JSON.stringify(t));
  delete d.id;
  // ★動力の id も落とす（落とさないと、出てきた物体ぜんぶが型と同じ番号の動力を持つ。
  //   リモコンは id で相手を探すので、1台の窓が出てきた全部を握ることになる）。
  if (d.thrusters) for (const th of d.thrusters) delete th.id;
  const nb = new Body(d);
  // ★出どころを覚えておく（〈複製にも適用〉がこれで身内を集める）。複製の複製も
  //   いちばん最初の型を指し続ける＝世代が増えても family が分裂しない。
  nb._progOrigin = t._progOrigin !== undefined ? t._progOrigin : t.id;
  // ★出てきたものは必ず実体にする。生成口は「入口」であって中身ではないので、
  //   入口そのものが複製されると、物が出てこないまま入口だけが増える。
  nb.isSpawner = false;
  nb.sleeping = false; nb.sleepTimer = 0;
  nb._updateAABB();
  objects.push(nb);
}
// ── 生成口の設定変更を、出ている物体へ渡す ───────────────────────────
//   ★フレームの頭で1回だけ呼ぶ（render の simTick 列より前）。tick の中ではない。
//     きっかけは人の操作なので、物理が進んでいるかどうかとは関係がない——一時停止中に
//     速度を0にしても、その場で矢印が消えて「止めた」ことが見えなければならない。
//     物体を作らない・消さないので、applyPending の tick 境界の約束には触れない。
//   ★きっかけは「前に見た値と1つでも違う」こと、配るのは「全部」。毎フレーム配らない
//     理由と、変わった項目だけにしない理由は PROG_SYNC_PROPS の★を参照。
function syncSpawnerProps() {
  for (const p of programs) {
    const b = p.body();
    // 生成口でなくなったら控えを捨てる（付け直したときに古い差が出ないように）
    if (!p.sync || p.action !== 'create' || !b || !b.isSpawner) { p._snap = null; continue; }
    const now = {};
    // ★動力だけは配列なので、参照を控えても「変わった」が分からない（同じ配列を
    //   指したまま中身が書き換わる）。値を並べた文字列を控えて比べる。
    for (const k of PROG_SYNC_PROPS) now[k] = (k === 'thrusters') ? _thrusterSig(b) : b[k];
    const prev = p._snap;
    p._snap = now;
    if (!prev) continue;                       // ONにした直後は控えるだけ＝何も配らない
    if (!PROG_SYNC_PROPS.some(k => now[k] !== prev[k])) continue;
    const root = b._progOrigin !== undefined ? b._progOrigin : b.id;
    for (const o of objects) {
      if (o === b || o._progOrigin !== root) continue;
      for (const k of PROG_SYNC_PROPS) applySyncProp(o, k, now[k], b);
      o.sleeping = false; o.sleepTimer = 0;    // 眠っていても届く（止める・進めるは眠りより強い）
    }
  }
}
// 1項目を渡す。★質量と固定・駆動・回転止めは、逆質量と慣性モーメントを整える
//   Body の設定関数を通す（値を直に代入すると invMass が古いまま残る）。
// 動力の中身を並べた文字列（「触ったか」を見るためだけの控え）
function _thrusterSig(b) {
  return b.thrusters.map(t => `${t.force},${t.dir},${t.localX},${t.localY}`).join('|');
}
// 型の動力を出ている物体へ写す。★本数が同じなら中身だけ上書きする（id を変えない＝
//   出ている物体の動力につないであったリモコンが、揃えたとたんに指し先を失わない）。
function _copyThrusters(src, dst) {
  if (dst.thrusters.length === src.thrusters.length) {
    src.thrusters.forEach((t, i) => Object.assign(dst.thrusters[i],
      { force: t.force, dir: t.dir, localX: t.localX, localY: t.localY }));
  } else {
    dst.thrusters = src.thrusters.map(t => new Thruster(
      { force: t.force, dir: t.dir, localX: t.localX, localY: t.localY }, dst));
  }
}
function applySyncProp(o, k, v, src) {
  // ★質量は「材質（密度）から作り直す」。大きさは各自のものなので、型を拡大縮小した
  //   ときに重さだけが飛び火しない（型を2倍にすると型の質量は4倍になるが、出ている
  //   物体は同じ大きさのまま同じ密度＝同じ重さで居続ける）。密度を持たない物体
  //   （density が null）だけは、質量そのものを渡すしかない。
  if      (k === 'thrusters')     _copyThrusters(src, o);   // ★v は控えの文字列。中身は型から取る
  else if (k === 'mass')          o.setMass(o.density != null ? o.massFromDensity() : v);
  else if (k === 'isStatic')      o.setStatic(v);
  else if (k === 'constVel')      o.setConstVel(v);
  else if (k === 'fixedRotation') o.setFixedRotation(v);
  else if (k === 'layers')        o.layers = v & LAYER_ALL;
  else o[k] = v;
}
// キーが押された瞬間（keyboard.js から）
function fireProgramsByKey(key) {
  let any = false;
  for (const p of programs) {
    if (p.trigger !== 'key' || p.key !== key) continue;
    const b = p.body();
    if (!b) continue;
    fireProgram(p, b, null);
    any = true;
  }
  if (any) applyPendingPrograms();
  return any;
}

// 窓の実行ボタン。★このプログラム1つだけを、キーを押したときと同じ道で1回発火させる
//   （同じキーを割り当てた別のプログラムは巻き込まない。押したのはこの窓だから）。
function fireProgramNow(p) {
  const b = p.body();
  if (!b) return;
  fireProgram(p, b, null);
  applyPendingPrograms();
}

// ── 置く・消す ───────────────────────────────────────────
// ★相手は物体か回路素子（elem＝true）。素子なら、選べるきっかけ・することはそれ用に絞る
function addProgram(body, elem) {
  if (programs.length >= PROGRAM_MAX) {
    appAlert('プログラム', '同時に置けるのは<b>' + PROGRAM_MAX + '個</b>までです。'
           + '<div class="am-note">要らない窓を ✕ で閉じてください。</div>');
    return null;
  }
  pushUndo();
  // ★窓は畳んでも見出しのぶん（約26px）は残るので、重ならない間隔で並べる。
  //   0.03 だと 800px の窓で 24px しかずれず、6個並べると見出しが重なって読めなかった。
  // ★'zone' の四角は、つないだ物体の位置を既定にする。原点に置くと、装置が
  //   画面の隅にあるときに四角だけ遠くに現れて「壊れている」ように見える。
  const fy = 0.05 + (programs.length % 8) * 0.055;
  const p = elem
    ? new Program({ elemId: body.id, fy, trigger: 'current', action: 'signal' })
    : new Program({ bodyId: body.id, fy, zx: body.x, zy: body.y });
  programs.push(p);
  buildProgramPanel(p);
  return p;
}
function removeProgram(p) {
  const i = programs.indexOf(p);
  if (i >= 0) { pushUndo(); programs.splice(i, 1); }
  if (p.panel) p.panel.remove();
}
function resetProgramRuntime() { for (const p of programs) p.reset(); }

// ── 保存・復元 ───────────────────────────────────────────
//   ★実行時の状態（出した個数・積算時間）は保存しない。シーンは「実行前の姿」なので、
//     開いた直後に「残り 3 発」から始まると、配った人と開いた人で見えるものが変わる。
function serializeProgram(p) {
  return { id: p.id, bodyId: p.bodyId, elemId: p.elemId, fx: p.fx, fy: p.fy, collapsed: p.collapsed,
           trigger: p.trigger, step: p.step, dist: p.dist, key: p.key,
           spdMin: p.spdMin, spdMax: p.spdMax, tempMin: p.tempMin, tempMax: p.tempMax,
           curMin: p.curMin, curMax: p.curMax,
           nearR: p.nearR, nearMin: p.nearMin, nearMax: p.nearMax, nearWhat: p.nearWhat,
           hitWhat: p.hitWhat, lightEdge: p.lightEdge, times: p.times,
           sigIn: p.sigIn, sigOut: p.sigOut, every: p.every, delay: p.delay,
           action: p.action, target: p.target, scope: p.scope, sync: p.sync,
           limit: p.limit,
           color: p.color, layers: p.layers,
           zx: p.zx, zy: p.zy, zw: p.zw, zh: p.zh };
}
function deserializePrograms(arr) {
  for (const p of programs) if (p.panel) p.panel.remove();
  programs = (arr || []).map(d => new Program(d));
  progSigNext = new Set(); progSigNow = new Set();   // ★戻した先に、戻す前の合図を持ち込まない
  for (const p of programs) buildProgramPanel(p);
  return programs;
}
function clearPrograms() {
  for (const p of programs) if (p.panel) p.panel.remove();
  programs = [];
  progSigNext = new Set(); progSigNow = new Set();
}

// ── つなぎ線 ─────────────────────────────────────────────
//   render() の最後（HUDと同じ画面座標）で引く。★破線＋窓側に小さな●で、
//   注釈のお絵描きと見分けがつくようにする。
function drawProgramLinks() {
  if (!programs.length) return;
  ctx.save();
  for (const p of programs) {
    // ★回路素子につないだものは素子の中点へ引く（リモコンのつなぎ線と同じ点）
    const e = p.onElem() ? p.elem() : null;
    const b = e ? remoteTargetPos('circuit', e) : p.body();
    if (!b || !p.panel) continue;
    const r = p.panel.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const px = r.left - cr.left + r.width / 2, py = r.top - cr.top + r.height;
    const s = worldToScreen(b.x, b.y);
    // 物体が画面の外なら、画面のふちで止めて向きだけ示す
    const m = 14;
    const cx = Math.max(m, Math.min(canvas.width - m, s.x));
    const cy = Math.max(m, Math.min(canvas.height - m, s.y));
    const off = (cx !== s.x || cy !== s.y);
    const sel = (p === selectedProgram);
    // ★'zone' の四角。つなぎ線と同じ色・同じ破線で描く＝「プログラムの持ち物」と読める
    //   （世界に置いた場は電場なら緑、加熱なら赤、と色で意味を持たせてあるので混ぜない）。
    if (p.trigger === 'zone') {
      const a = worldToScreen(p.zx - p.zw/2, p.zy - p.zh/2);
      const c = worldToScreen(p.zx + p.zw/2, p.zy + p.zh/2);
      ctx.strokeStyle = PROG_LINK_COLOR;
      ctx.lineWidth = sel ? 2 : 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = PROG_LINK_COLOR;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.setLineDash(sel ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PROG_LINK_COLOR;
    ctx.beginPath(); ctx.arc(cx, cy, off ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    if (off) {                                   // 画面外：距離を添える
      const d = Math.hypot(b.x - screenToWorld(cx, cy).x, b.y - screenToWorld(cx, cy).y) * PX2M;
      ctx.font = '10px sans-serif';
      ctx.fillText(d.toFixed(1) + 'm', cx + 8, cy - 6);
    }
  }
  ctx.restore();
}
