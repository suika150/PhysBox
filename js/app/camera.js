// ════════════════════════════════════════
//  カメラ（物体に接続して、その物体の目で見る）
// ════════════════════════════════════════
//  ★このファイルは「見る側」だけを扱う。物理には一切触れない。回転系の題材
//    （コリオリの力・遠心力）は、見かけの力をエンジンへ足すのではなく、
//    「カメラを乗り換える＝観測者を変える」で見せる、というのがこの系の立場。
//    見かけの力を足すと「慣性系で解いている」という一点が崩れ、コリオリの力が
//    “本物の力” に見えてしまう。ここへ力を持ち込む方向へは進めないこと
//    （js/core/state.js の cam の★と対になっている）。
//  ★カメラは1台だけ。2台目を許すと「いまどちらの目で見ているのか」が画面から
//    読めなくなる。接続は常に上書きで、外すのは上バーのカメラ から。
//  ★置き場所は左のツールバーではなく上バー。左のツールバーは「キャンバスに置くもの」の
//    場所で、カメラは物体に接続するものなので筋が違う（一度ツールとして置いてみて、
//    そこだけ浮いた）。接続先は「選択中の物体」から取る＝追従がもともと持っていた流儀。
//  ★向きの決め方は2つ。言葉は画面に出しているものと同じにしておくこと：
//      'world' … カメラは常に y 軸正を向く（画面の上はいつも世界の上）
//      'body'  … 物体の向きによってカメラの向きも変わる（回転する観測者の視点）
//    「向きを固定する／しない」という言い方は、何が固定されるのかが読み取れないので使わない。
//  ★upAngle は「物体のローカル座標での向き」[rad]。その向きが常に画面の上へ来るよう
//    cam.angle を毎フレーム決め直す。null＝'world'。
//    ★向きをワールドの向きとして持たない。ワールドで持つと物体が回っても画面は回らず、
//      ただの定数回転になって、回転系の視点という目的を果たさない。
//    ★'body' の upAngle は接続した瞬間の姿勢から決める（下の★）。
//  ★実体（sceneCamera）と向きの決め方（cameraUpMode）の宣言は js/core/state.js にある
//    （この系のグローバル状態はあちらに集める約束）。
//  ★ON/OFF とずれはカメラ自身が持つ（sceneCamera.on / offX / offY）。同じ窓の
//    「選んだ物体を追う」（followEnabled）とは別のスイッチ。以前は1つの変数を共有していて、
//    「原点へ戻す」を押すとカメラが黙って止まり、回転系の画面も軌跡の描き方も
//    慣性系へ戻った。付けると追うほうの設定（中心の決め方・ズームアウト）が上書きされ、
//    外すと追うほうまで切れた。
//    ★2つは排他：入れたほうが勝ち、もう片方のチェックが外れる（見る側は1つにしかなれない）。
//    カメラは止まるだけで接続は残る。「原点へ戻す」はカメラが働いている間は押せない。
//  ★カメラは接続先へ常に即時で寄る（「追う速さ」を借りない）。
//    遅れて付いていくと、見かけの動きにカメラの遅れが混ざって観測者の系にならない。

function cameraBody() {
  if (!sceneCamera) return null;
  const b = objects.find(o => o.id === sceneCamera.bodyId);
  if (!b) { sceneCamera = null; return null; }   // 物体が消えたらカメラも消える
  return b;
}
// カメラが画面を決めているか（接続されていて、かつ働かせている）
function cameraActive() {
  return !!cameraBody() && sceneCamera.on;
}
// カメラを物体へ接続する。mode 省略時は画面で選んである cameraUpMode を使う。
//   ★'body' の upAngle は「接続した瞬間に cam.angle が 0 になる値」にする。
//     こうすると付けた瞬間に画面が飛ばず、そこから先だけ物体と一緒に回る。
//     upAngle を 0 固定（＝物体のローカル +x を上に向ける）にすると、傾いた物体に
//     付けた瞬間に画面がその角度ぶん跳ねる。
function attachCamera(body, mode) {
  if (!body) return;
  const m = mode || cameraUpMode;
  cameraUpMode = m;            // ★画面の選択肢も実際に合わせる（デモが 'body' で付けたのに
                               //   窓が「y軸正」と表示していると、設定が効いていないように見える）
  // ★同じ物体へ付け直すとき（向きの決め方を変えたとき）は、手でずらした分を残す
  const same = sceneCamera && sceneCamera.bodyId === body.id;
  sceneCamera = { bodyId: body.id,
                  upAngle: m === 'body' ? (-Math.PI/2 - body.angle) : null,
                  on: true,    // 接続＝カメラを働かせる
                  offX: same ? sceneCamera.offX : 0, offY: same ? sceneCamera.offY : 0 };
  followEnabled = false;       // ★「選んだ物体を追う」とは排他（入れたほうが勝つ。toggleFollow の★）
  refreshCameraButton();
  refreshToolHint();
}
function detachCamera() {
  sceneCamera = null;
  cam.angle = 0;
  refreshCameraButton();
  refreshToolHint();
}
// 接続はそのままで、カメラの効果だけ止める／戻す（上バーのカメラ の「カメラを働かせる」）
function setCameraOn(on) {
  if (!sceneCamera) return;
  sceneCamera.on = !!on;
  if (on) followEnabled = false;   // ★排他（attachCamera と同じ）
  if (!on) cam.angle = 0;
  refreshCameraButton();
  refreshToolHint();
}
// ★上バーのカメラのボタンの色＝画面が何かについていっているか
//   （カメラが働いている／選んだ物体を追っている。どちらもこの窓の中の機能）
function refreshCameraButton() {
  const b = document.getElementById('btn-follow');
  if (b) b.classList.toggle('on', cameraActive() || followEnabled);
}
// 毎フレーム、画面の中心を接続先へ合わせる。「選んだ物体を追う」より先に呼び、true なら画面はカメラのもの。
function cameraFollowUpdate() {
  if (!cameraActive()) return false;
  const b = cameraBody();
  cam.x = b.x + sceneCamera.offX;   // ★即時（上の★。追う速さは借りない）
  cam.y = b.y + sceneCamera.offY;
  return true;
}
// 上バーのカメラ の2つのボタンが対象にする物体＝選択中の1つ目。
//   ★ボタンの活殺もこれで決める（窓側で選択を数え直さない。数え方が2か所に散ると必ずずれる）。
function _cameraSelBody() {
  return objects.find(o => selectedIds.has(o.id)) || null;
}
// 上バーのカメラ から。選択中の物体へ接続する（複数選んでいたら先頭）
function attachCameraToSelection() {
  const b = _cameraSelBody();
  if (b) attachCamera(b);
}
// 向きの決め方を変える。★接続中ならその場で付け直す（選び直したのに次に付けるまで
//   効かない、という間があると「効かない設定」に見える）。
function setCameraUpMode(m) {
  cameraUpMode = (m === 'body') ? 'body' : 'world';
  const b = cameraBody();
  if (b) attachCamera(b, cameraUpMode);
}
// 毎フレーム cam.angle を決める。★カメラを働かせていない間は回さない
//   （「働かせない＝カメラを離れて自由に見る」で、位置と向きの扱いを揃える）。
function updateSceneCamera() {
  const b = cameraBody();
  if (!b || !sceneCamera.on || sceneCamera.upAngle === null) { cam.angle = 0; return; }
  // ワールドでの向き φ = b.angle + upAngle。worldToScreen は向きを φ+cam.angle へ写すので、
  // 画面の上（-π/2）に一致させるには cam.angle = -π/2 - φ。
  cam.angle = -Math.PI/2 - (b.angle + sceneCamera.upAngle);
}
// ─── 軌跡・ストロボの記録の基準になる物体 ──────────────────────────
//   ★軌跡は「観測者から見た道すじ」。ワールド座標で貯めた点をそのまま描くと、
//     回転カメラでは全部の点に “いまの角” が掛かる。正しくは “その点を記録した時刻の角” で、
//     このずれのせいで軌跡はまっすぐな線のままぐるぐる回り、曲がっていく球から離れていく
//     （実際そうなった。コリオリの題材でいちばん見せたい曲線がそこだけ出ない）。
//     そこで、向きごと固定したカメラがあるあいだは、点を「その物体のローカル座標」でも
//     控えておき、描くときに現在の姿勢で戻す。
//   ★向きを固定していないカメラ（'world'）でも同じように直す。ここは以前
//     「平行移動だけなら軌跡の“形”は変わらないから何もしない」としていたが、**間違い**。
//     形が変わらないのは等速で平行移動する系だけで、加速している系では形そのものが変わる。
//     2物体の空中衝突のデモがまさにそれで、落ちていく球Bにカメラを付けると球Aは画面上を
//     まっすぐ来るのに、軌跡だけがワールドの放物線のまま描かれていた（球Bの軌跡も、
//     自分の系では点のはずなのに真下へ伸びる線になっていた）。画面の動きと軌跡が
//     食い違う＝この題材でいちばん見せたい「相対運動は等速直線」が出ない。
//   ★どちらの向きの決め方でも「観測者から見た道すじ」を描く、が一般則。
//     違うのは回すかどうかだけで、それは traceWorldFor が受け持つ。
function tracerFrameBody() {
  return cameraActive() ? cameraBody() : null;
}
// その系が向きごと回っているか（'body'）。回っていなければ平行移動だけの系。
function tracerFrameSpins() {
  return !!sceneCamera && sceneCamera.upAngle !== null;
}
// ─── 姿勢の記録（軌跡を系のあいだで“変換”するために要る）─────────────────
//   ★軌跡はワールド座標で貯める。だから「カメラを外す」側への変換は何も要らない
//     （貯めた点をそのまま描けば、それが地面から見た道すじ）。捨ててはいけない。
//   ★逆に「回る物体から見た道すじ」へ直すには、その点を記録した時刻の物体の姿勢が要る。
//     いまの姿勢で全点を回すと、線はまっすぐなまま回るだけで球から離れていく（実際そうなった）。
//     そこで物体ごとに {時刻, 位置, 角} を貯めておき、描くときに
//     「記録時の姿勢でローカルへ → いまの姿勢でワールドへ」と2段で直す。
//     これで ON⇄OFF のどちら向きでも、貯めた点を1つも捨てずに描き分けられる。
//   ★この記録を Body に持たせない。undo は物体を JSON で丸ごと複製して 30 段積むので、
//     tick ごとに伸びる配列を生やすと 30 倍で効いてくるうえ、シーンの保存にも混ざる。
//     これは「見る側」の都合なので、ここが id をキーに別で持つ。
//   ★平らな数値の配列にする（{}の配列だと 1 点あたりの重さが数倍になる）。
const POSE_STRIDE = 4;                // t, x, y, angle
const _poseLogs = new Map();          // bodyId → [t,x,y,angle, t,x,y,angle, …]（時刻順）
function clearPoseLogs() { _poseLogs.clear(); }
// 1 tick に一度、step.js から呼ぶ。軌跡もストロボも使っていないときは1件も貯めない。
function recordPoseLogs() {
  let keep = 0;
  for (const b of objects) if (b.tracerEnabled && b.tracerDuration > keep) keep = b.tracerDuration;
  if (strobeEnabled && keep < 30) keep = 30;
  if (keep <= 0) { if (_poseLogs.size) _poseLogs.clear(); return; }
  const cutoff = world.simTime - keep;
  const live = new Set();
  for (const b of objects) {
    if (b.isStatic) continue;         // 動かない物体は「いつでも今の姿勢」なので記録が要らない
    live.add(b.id);
    let a = _poseLogs.get(b.id);
    if (!a) { a = []; _poseLogs.set(b.id, a); }
    a.push(world.simTime, b.x, b.y, b.angle);
    let cut = 0;
    while (cut + POSE_STRIDE <= a.length && a[cut] < cutoff) cut += POSE_STRIDE;
    if (cut > 0) a.splice(0, cut);
  }
  for (const id of [..._poseLogs.keys()]) if (!live.has(id)) _poseLogs.delete(id);
}
// 時刻 t のときの f の姿勢を返す関数を作る。
//   ★線は古い順にたどるので、カーソルを前へ進めるだけで済む（点ごとの二分探索は要らない）。
//   ★記録より前の点は null を返す。直せない点まで無理に描くと、線が原点へ引き寄せられる。
const _poseScratch = { x: 0, y: 0, angle: 0 };
function framePoseCursor(f) {
  if (!f) return null;
  if (f.isStatic) return () => f;     // 動かない＝いつでも今の姿勢
  const a = _poseLogs.get(f.id);
  if (!a || !a.length) return () => null;
  let i = 0;
  return (t) => {
    if (t + 1e-9 < a[0]) return null;
    while (i + POSE_STRIDE < a.length && a[i + POSE_STRIDE] <= t + 1e-9) i += POSE_STRIDE;
    _poseScratch.x = a[i+1]; _poseScratch.y = a[i+2]; _poseScratch.angle = a[i+3];
    return _poseScratch;
  };
}
// 記録した点（ワールド）を、いま見ている系での位置へ直す。
//   記録時の姿勢でローカルへ落として、いまの姿勢でワールドへ戻す。
//   ★平行移動だけの系（'world'）では角を使わない。記録時の相対位置をそのまま
//     いまの位置へ足す＝観測者から見た道すじになる。ここで物体の角まで掛けると、
//     回っていないはずの画面で軌跡だけが回る（物体は fixedRotation を切ると回るので、
//     'world' のカメラでも b.angle は 0 とはかぎらない）。
function traceWorldFor(f, pose, x, y) {
  if (!tracerFrameSpins()) return { x: f.x + (x - pose.x), y: f.y + (y - pose.y) };
  const c0 = Math.cos(-pose.angle), s0 = Math.sin(-pose.angle);
  const dx = x - pose.x, dy = y - pose.y;
  const lx = dx*c0 - dy*s0, ly = dx*s0 + dy*c0;
  const c1 = Math.cos(f.angle), s1 = Math.sin(f.angle);
  return { x: f.x + lx*c1 - ly*s1, y: f.y + lx*s1 + ly*c1 };
}
// 接続先に出す印。★これが無いと「いまどの物体に乗っているか」が画面から分からない。
function drawCameraMarker() {
  const b = cameraBody();
  if (!b) return;
  const s = worldToScreen(b.x, b.y);
  ctx.save();
  ctx.strokeStyle = sceneCamera.on ? '#4fc3f7' : 'rgba(79,195,247,0.4)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(s.x, s.y, 22, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  if (sceneCamera.upAngle !== null) {
    // 「上に保っている向き」。回転が効いていれば画面の真上を指す＝印そのものが答え合わせになる
    const w = b.angle + sceneCamera.upAngle;
    const d = worldToScreenDir(Math.cos(w), Math.sin(w));
    drawArrow(ctx, s.x, s.y, s.x + d.x*34, s.y + d.y*34, sceneCamera.on ? '#4fc3f7' : 'rgba(79,195,247,0.4)', 2);
  }
  ctx.restore();
}
// 画面に出しっぱなしにする札。
//   ★これは飾りではなく機能の一部。回転しているカメラで見ると、まっすぐ進む球が
//     曲がって見える。どの系で見ているかを画面に書いておかないと、見た人が
//     「球が本当に曲がった」と読む＝この題材でいちばんしてはいけない誤読になる。
function drawCameraBadge() {
  const b = cameraBody();
  if (!b) return;
  const rot = sceneCamera.on && sceneCamera.upAngle !== null;
  const name = b.label || ('物体#' + b.id);
  const txt = 'カメラ：' + name + (rot ? ' に固定（回転系）' : ' を追う（平行移動のみ）')
            + (sceneCamera.on ? '' : '／停止中');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = 'bold 12px sans-serif';
  // ★置き場所は画面の下のまん中。上のまん中はツールヒントの帯（DOM）が覆っていて隠れ、
  //   左下は力の凡例、右はグラフの窓が使う。ここが唯一どのデモでも空いている。
  const w = ctx.measureText(txt).width + 18;
  const x = canvas.width/2 - w/2, y = canvas.height - 30;
  ctx.fillStyle = rot ? 'rgba(79,195,247,0.22)' : 'rgba(255,255,255,0.10)';
  ctx.strokeStyle = rot ? 'rgba(79,195,247,0.8)' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, 22, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = rot ? '#bde7fb' : 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, canvas.width/2, y + 11);
  ctx.restore();
}
