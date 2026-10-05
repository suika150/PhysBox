// ════════════════════════════════════════
//  デモシーン ▸ 電磁気学 ▸ 仕組みのモデル（粒で見せる）
// ════════════════════════════════════════
//  ★demos-em.js のオームの法則モデルの一族（輪・自由電子・陽イオン・電場の帯）を土台に、
//    回路ツールでは見えない「電流の中身」を見せるデモを集める。ファイルを分けたのは
//    demos-em.js が 4,000 行を超えたため。共通の約束は js/app/demo-kit.js、
//    輪の寸法と電子・陽イオンの定数（OHM_*）は demos-em.js にある（このファイルより先に読む）。
//  ★回路ツール（em/circuit.js）はどのデモも使わない。電流は粒の流れ、電圧は電場の帯、
//    抵抗は陽イオンの玉、という見立てをそのまま使う。

// ── 寸法を選べる輪（オームの法則モデルの輪を一般化したもの）─────────────────
//  ★作りはオームの法則モデル（demoOhmModel）とまったく同じ：外側の枠と島を型抜きした
//    わっか2つ・角は半径 OHM_CR の円弧・電場の帯は直線4枚＋角4枚・陽イオンは下の辺に
//    4段で並べてばねで留める・電子は周に沿って等間隔。通路の幅・壁の厚み・玉と電子の
//    寸法と質量もすべて OHM_* をそのまま使う（あちらの★の実測がそのまま効くように）。
//    変えられるのは輪の大きさ（通路の中心線の半幅 A・半高 B）と、電子の数・電気量・色、
//    抵抗の区間の長さだけ。
//  ★オームの法則モデルのほうは ohmLoopPoint ほかが OHM_XR／OHM_YB に決め打ちなので、
//    寸法を変える入口としてこちらを別に置いた（あちらの実測を崩さないため、書き換えない）。
//  o: { cx, cy, A, B, nE, q, color, stroke, resHalf, E0, W, CR, drag }
//     W：通路の幅（省くと OHM_CORR）、CR：通路の中心線の角の丸み（省くと OHM_CR）、drag：電子の抗力係数
//     ★陽イオン（resHalf）は通路の幅 OHM_CORR のときだけ置ける（4段の並べかたがその幅で決めてある）
//  戻り値: { cx, cy, A, B, point(s), per, ions, carriers, bands }
function microLoopPoint(A, B, s, CR) {
  CR = CR || OHM_CR;
  const LX = 2*A - 2*CR, LY = 2*B - 2*CR, ARC = Math.PI/2 * CR;
  const PER = 2*(LX + LY) + 4*ARC;
  s = ((s % PER) + PER) % PER;
  const arc = (cx, cy, a0, t) => {
    const a = a0 + (Math.PI/2) * t;
    return { x: cx + CR*Math.cos(a), y: cy + CR*Math.sin(a), nx: -Math.cos(a), ny: -Math.sin(a) };
  };
  const XI = A - CR, XJ = -A + CR, YI = -B + CR, YJ = B - CR;
  if (s < LX)  return { x: -A + CR + s, y: -B, nx: 0, ny: 1 };  s -= LX;
  if (s < ARC) return arc(XI, YI, -Math.PI/2, s/ARC);            s -= ARC;
  if (s < LY)  return { x: A, y: YI + s, nx:-1, ny: 0 };         s -= LY;
  if (s < ARC) return arc(XI, YJ, 0,          s/ARC);            s -= ARC;
  if (s < LX)  return { x: A - CR - s, y: B, nx: 0, ny:-1 };     s -= LX;
  if (s < ARC) return arc(XJ, YJ, Math.PI/2,  s/ARC);            s -= ARC;
  if (s < LY)  return { x: -A, y: YJ - s, nx: 1, ny: 0 };        s -= LY;
  return             arc(XJ, YI, Math.PI,     s/ARC);
}
// 下の辺に陽イオンを並べる（ohmPlaceIons と同じ4段・同じ間隔・同じばね）。x は輪の中心から
//   ★壁より先に呼ぶこと（壁が埋めた段の外半分を隠す。ohmPlaceIons の★）
function microIonsAlong(cx, y, x0, x1, ny) {
  const ions = [];
  for (let x = x0, k = 0; x <= x1; x += OHM_PITCH_R, k++) {
    const off = OHM_ROWS[k % OHM_ROWS.length];
    const bx = cx + x, by = y + ny*off;
    const b = new Body({ type:'circle', x:bx, y:by, radius:OHM_ION_R,
      mass:OHM_BALL_M, hasGravity:false, fixedRotation:true, layers:OHM_LAYER_ION,
      friction:0, frictionStatic:0, restitution:0,
      fillColor:'#ef5350', strokeColor:'#ffcdd2', strokeWidth:1.2 });
    objects.push(b); ions.push(b);
    const spr = demoSpring({ bodyB:b, anchorAx:bx, anchorAy:by, restLength:0,
                 stiffness:OHM_BALL_K, damping:OHM_BALL_C, radius:5, color:'#ff8a65' });
    if (spr) spr.layers = OHM_LAYER_SPR;
  }
  return ions;
}
const MICRO_METAL = { fillColor:'#78909c', strokeColor:'#b0bec5', strokeWidth:1.5,
                      friction:0, frictionStatic:0, restitution:0 };
// 角丸の板の部品（縦の板＋横の板＋四隅の円。demoOhmModel の roundParts と同じ）
function microRoundParts(cx, cy, A, B, R) {
  const mk = o => new Body(Object.assign({ isStatic:true }, MICRO_METAL, o));
  const ps = [ mk({ type:'box', x:cx, y:cy, w:2*A,       h:2*(B - R) }),
               mk({ type:'box', x:cx, y:cy, w:2*(A - R), h:2*B       }) ];
  for (const sx of [-1, 1]) for (const sy of [-1, 1])
    ps.push(mk({ type:'circle', x:cx + sx*(A - R), y:cy + sy*(B - R), radius:R }));
  return ps;
}
function microRing(cx, cy, A, B, R) {
  return demoBoolean('diff', [ demoUnion(microRoundParts(cx, cy, A, B, R)),
                               ...microRoundParts(cx, cy, A - OHM_WALL, B - OHM_WALL, R - OHM_WALL) ]);
}
function microLoop(o) {
  const cx = o.cx, cy = o.cy, A = o.A, B = o.B, W = o.W || OHM_CORR, H = W/2, CR = o.CR || OHM_CR;
  const ions = (o.resHalf > 0 && W === OHM_CORR) ? microIonsAlong(cx, cy + B, -o.resHalf, o.resHalf, -1) : [];
  const outer  = microRing(cx, cy, A + H + OHM_WALL, B + H + OHM_WALL, CR + H + OHM_WALL);
  const island = microRing(cx, cy, A - H, B - H, CR - H);
  const per = 2*(2*A - 2*CR) + 2*(2*B - 2*CR) + 2*Math.PI*CR;
  const offs = [0, 30, -30, 15, -15].map(v => v * W / OHM_CORR);
  const carriers = [];
  const clear = (x, y) => ions.every(i => (i.x - x)**2 + (i.y - y)**2 > (OHM_ION_R + OHM_E_R + 4)**2);
  for (let i = 0; i < o.nE; i++) {
    let put = null;
    for (let d = 0; d < 60 && !put; d += 4)
      for (const sgn of (d ? [1, -1] : [0]))
        for (const off of (o.spread ? [offs[i % 5]] : offs)) {
          if (put) continue;
          const p = microLoopPoint(A, B, i*per/o.nE + sgn*d, CR);
          const x = cx + p.x + p.nx*off, y = cy + p.y + p.ny*off;
          if (clear(x, y)) put = { x, y };
        }
    if (!put) continue;
    const b = new Body({ type:'circle', x:put.x, y:put.y, radius:OHM_E_R,
      mass:OHM_E_M, charge:(o.q !== undefined ? o.q : OHM_E_Q), hasGravity:false, fixedRotation:true,
      layers:(o.layers !== undefined ? o.layers : OHM_LAYER_E), drag:o.drag || 0,
      friction:0, frictionStatic:0, restitution:0,
      fillColor:o.color || '#42a5f5', strokeColor:o.stroke || '#e3f2fd', strokeWidth:1.2 });
    objects.push(b); carriers.push(b);
  }
  // 電場の帯：直線4枚と角4枚。向きは時計回り（＝電流の向き。demoOhmModel の★）
  const E0 = o.E0 !== undefined ? o.E0 : OHM_E0;
  const bands = [];
  const band = (x, y, w, h, angle) => { const f = new EMField({ kind:'E', x:cx + x, y:cy + y, w, h, strength:E0, angle });
                                        emFields.push(f); bands.push(f); };
  const LX = 2*A - 2*CR, LY = 2*B - 2*CR, CS = CR + H;
  band(0, -B, LX, W,  0);
  band(A, 0, W, LY,  Math.PI/2);
  band(0, B, LX, W,  Math.PI);
  band(-A, 0, W, LY, -Math.PI/2);
  for (let i = 0; i < 4; i++) {
    const sx = (i <= 1) ? 1 : -1, sy = (i === 0 || i === 3) ? -1 : 1;
    band(sx * (A + H - CS/2), sy * (B + H - CS/2), CS, CS, Math.PI/4 + i * Math.PI/2);
  }
  return { cx, cy, A, B, W, CR, per, ions, carriers, bands, outer, island,
           point: s => microLoopPoint(A, B, s, CR) };
}
// 電池の絵（左の辺のまん中。オームの法則モデルの絵と同じ：下が −・上が ＋）
function microBatterySketch(x, y, ts) {
  const BAT = '#ffd54f';
  const plate = (dy, half) => demoPath([{ x:x - half, y:y + dy }, { x:x + half, y:y + dy }], BAT, 5);
  plate(-24, 34); plate(-10, 15); plate(6, 34); plate(20, 15);
  demoLabel(x - 92, y - 48, '＋', BAT, DEMO_NOTE_SIZE * ts, true);
  demoLabel(x - 92, y + 34, '−', BAT, DEMO_NOTE_SIZE * ts, true);
}

// ── ホール効果モデル ───────────────────────────────────────────
//  ★見せたいのは「磁場を入れた直後の電子は曲がって片方の壁へ寄る → 寄った電子がたまって
//    電場（ホール電場）をつくる → それが qvB とつり合うと、あとから来る電子はまっすぐ進む」。
//  ★装置は輪ではなく、左から電子が入って右へ抜ける1枚の板（ホール素子）。左端の生成口から
//    1秒ごとに電子が出て、板の中の電場（電池の電場）と抗力で一定の速さ（約 1.3 m/s）で流れ、
//    右端の出口の板に当たると消える（電池へ戻る）。
//    ★輪で作った版は捨てた。理由は2つ：
//      ・この一族の陽イオンは電気を持たないので、輪の電子は全体で負に帯電していて、電子どうしの
//        反発で輪の外側の壁へ押しつけられる。磁場が無くても上の辺で電子が 40〜60px 片寄って入り、
//        通り抜けるあいだに横へ 20〜56px 流れた（角の形にもよる）。その上に磁場の寄りが乗るだけで、
//        「曲がってから直進」には一度もならなかった（輪の大きさ・通路の幅を変えて3通り）。
//      ・陽イオンの電荷を細かい格子（20px おき・970個）にならして輪を中性にすると、横の流れは
//        減ったが 1 tick 130ms と実時間の 8倍重く、しかも通り抜けるたびに 30px 横へ流れ続けた。
//  ★**上の壁ぎわの帯（HALL_EDGE）には電池の電場をかけない。** 磁場で壁ぎわまで寄った電子はそこで
//    押されなくなり、抗力で止まって壁ぎわにとどまる＝たまった電荷になる。これは模型の工夫：
//    本物では面の電荷は流れている電子の密度の偏りとして保たれ、電子そのものは止まらない。
//    帯が無いと、壁へ寄った電子は壁に沿って出口まで流れて消え、電荷がたまらなかった（あとから
//    来る電子も壁の手前まで寄り続けた）。
//    ★帯は電子がたまる側（磁場 ⊙ で電子が寄る上の壁）だけ。下の壁ぎわにも帯を置いていたときは、
//      入口の近くで上にたまった電子に押し下げられた電子が下の帯で止まり、居座った。磁場の向きは
//      このデモでは変えられない（強さだけ）ので、上だけで足りる。
//    ★帯は磁場の範囲だけで、両端を小さな三角の出っぱりで仕切る。
//      ・仕切らずに磁場の範囲だけにすると、磁場の手前で上の壁ぎわを流れてきた電子が帯へ入って止まり、
//        磁場と関係なくたまり続けた（30個を超えて、あとの電子が下の壁まで押された）
//      ・帯を板の端から端までにすると、たまった電子が反発で帯の中を入口の近くまで広がり、磁場の無い
//        ところで入ってきた電子を下へ押し下げた（電子の流れが上下2本に割れ、下の1本は下の壁を這った）
//    ★くぼみ（溝）を壁に刻んで捕まえる作りも試したが、1つも捕まらなかった：1.3 m/s の電子が
//      幅 18px の口を渡るのは 14ms で、そのあいだに磁場で沈む深さはほぼ 0。
//  ★この模型には陽イオンの＋が無いので、反対側の壁ぎわが＋になる（電子が減る）ところは出ない。
//    電子をまっすぐにするのは上の壁ぎわにたまった − の反発だけ。本文では本物の姿として一言だけ添える。
//  ★実測（乱数は使っていない。デモを開いた姿（磁場を切ったまま 900tick 先回し）からさらに 1200tick 流し、
//    磁場 0.4 T を入れる。「たまった」＝上の壁ぎわの帯で止まった電子、「いちばん上」＝たまらなかった電子が
//    いちばん上へ寄った高さの平均、「出口の手前」＝出口の 100px 手前を通る高さの平均。板の中心が 0、
//    壁は −60px、帯の端は −38px）：
//      磁場を入れる前：帯で止まった電子 0、出口の手前の高さ 0px（まっすぐ）
//      電子が出た時刻  │ たまった │ いちばん上 │ 出口の手前
//       入れてから 0〜5秒 │  1/5   │  −39px   │ −15px
//         5〜10秒       │  0/5   │  −35px   │ −22px
//        10〜15秒       │  0/5   │  −32px   │ −23px
//        15〜25秒       │  0/10  │  −30px   │ −24px
//        25〜55秒       │  0/30  │  −30px   │ −25px
//    帯にたまった電子は 5秒ごとに 0 → 0 → 6 個で、以後ずっと 6個。たまったのは主に、磁場を入れた
//    ときに板の中を流れていた電子（入れた瞬間に流れ全体が上へ曲がり、壁まで届いたもの）。そのあとの
//    電子は 30px ほど上へ寄ったところで向きがそろい、壁に届かずにまっすぐ出口まで進む
//    （出口の手前の高さが −25px でそろう）。
//  ★決めた値の比べかた（同じ手順。あとの電子が出口の手前を通る高さ、20〜50秒に出た電子）：
//      ・電子を出す間隔 0.5秒：流れが −27px と +40px の2本に割れた（電子どうしの反発で、隣り合う電子が
//        上下へ押し分けられる）。1秒なら 23個すべてが −24〜−25px の1本。磁場の始まりを入口から
//        300px に離しても、0.5秒では割れたまま
//      ・クーロン定数 k：5 ではあとの電子が帯の端（−38px）に沿って進み、3 ではいつまでも
//        たまり続けた（帯の電子が 10〜13 個で揺れ、1分たっても壁まで曲がる電子が出る）。10 ★これ
//      ・上の壁の摩擦 0：帯にたまった電子が反発で下流へ滑り、たまらなかった（帯の電子は 0〜2 個）
//      ・板の幅 180px（帯は上下とも・入口は開いていた・間隔 0.5秒の頃）：あとの電子は中心より 31px 上へ寄った
//        （−の電荷が片側にしか無いので、その電場は壁から離れるほど弱く、つり合う高さが壁寄りに決まる）
//  ★1 tick 1ms 前後（電子は板の中に常に 10 個前後）。
const HALL_LEN   = 1000;     // [px] 導体の板の長さ（中の空き）
const HALL_H     = 120;      // [px] 板の幅（中の空き）。★180 との比較は上の★
const HALL_WALL  = 30;       // [px] 上下の壁の厚み
const HALL_EDGE  = 22;       // [px] 上の壁ぎわの、電池の電場をかけない帯の幅（上の★）。電子の直径 14px ＋ 余裕
const HALL_FX0   = -330, HALL_FX1 = 470;   // [px] 磁場のかかる範囲（板の中心から）。入口から 150px は磁場なし
const HALL_BT    = 0.4;      // [T] ↑ で入れる磁場の強さ。★曲がる向きは tanθ = vB/E ≈ 15°（約 3m で壁に届く）
const HALL_BMAX  = 1;        // [T] つまみの上限
const HALL_E     = 2;        // [V/m] 板の中の電場（オームの法則モデルの OHM_E0 と同じ）
const HALL_DRAG  = 2.5;      // 電子の抗力係数（箔検電器の ES_EDRAG と同じ。金属の抵抗の代わり）
const HALL_K     = 10;       // 実効クーロン定数。★つり合いに要る壁ぎわの電子の数はおよそ 1/k に比例する
                             //   （E_H = vB を出す線電荷 λ ≈ vB·d/(2k)）。決めかたは上の★（5 と 3 との比べ）
const HALL_EVERY = 60;       // [tick] 電子を出す間隔（1秒）。★0.5秒にすると、電子どうしの反発で流れが上下2本に割れた（上の★）
const HALL_TRACE = 6;        // [s] 軌跡の長さ。★長くすると、つり合ったあとも最初の曲がった線が残って読めない
function demoHallModel() {
  resetDemoWorld();
  setDemoGravity(0);
  updateGroundTerrain(false);
  world.sleeping  = false;
  world.substeps  = 8;
  world.coulombOn = true;
  world.coulombK  = HALL_K;
  setDemoCam(0, 0.62);
  const cx = 60, cy = cam.y + 190;
  const x0 = cx - HALL_LEN/2, x1 = cx + HALL_LEN/2;
  const yTop = cy - HALL_H/2, yBot = cy + HALL_H/2;
  // ★摩擦は上の壁だけ 1（電子も 1。摩擦係数は積で合成）。たまった電子をその場に留めるため：0 にすると
  //   帯の中を反発で下流へ滑っていき、たまらなかった。ほかの壁は 0。
  const metal = MICRO_METAL, rough = Object.assign({}, MICRO_METAL, { friction:1, frictionStatic:1 });
  objects.push(new Body(Object.assign({ isStatic:true, type:'box', x:cx, y:yBot + HALL_WALL/2, w:HALL_LEN, h:HALL_WALL, label:'下の壁' }, metal)));
  objects.push(new Body(Object.assign({ isStatic:true, type:'box', x:cx, y:yTop - HALL_WALL/2, w:HALL_LEN, h:HALL_WALL, label:'上の壁' }, rough)));
  // 磁場（⊙）。★最初は 0 ＝ 切ってある。↑ で入れる
  const field = new EMField({ kind:'B', x:cx + (HALL_FX0 + HALL_FX1)/2, y:cy, w:HALL_FX1 - HALL_FX0,
    h:HALL_H + 2*HALL_WALL + 40, strength:0, out:true });
  emFields.push(field);
  // 板の中の電場（電池がつくる。左向きなので電子は右へ流れる＝電流は左向き）。
  //   ★磁場の範囲の上の壁ぎわの帯だけ除く（上の★）。3枚に分けて並べる：磁場の手前・磁場の範囲（帯を除いた丈）・磁場の先
  const bandE = (xa, xb, ya, yb) => emFields.push(new EMField({ kind:'E', x:(xa + xb)/2, y:(ya + yb)/2, w:xb - xa, h:yb - ya, strength:HALL_E, angle:Math.PI }));
  bandE(x0, cx + HALL_FX0, yTop, yBot);
  bandE(cx + HALL_FX0, cx + HALL_FX1, yTop + HALL_EDGE, yBot);
  bandE(cx + HALL_FX1, x1, yTop, yBot);
  // 帯の両端の小さな出っぱり（三角）。★帯にたまった電子が帯の外へ広がらないように、帯の外で上の壁ぎわを
  //   流れてきた電子が帯へ入らないように（下の坂を滑って、押される側へ出る）
  for (const xb of [cx + HALL_FX0, cx + HALL_FX1])
    objects.push(new Body(Object.assign({ isStatic:true, type:'polygon', x:xb, y:yTop, verts:[
      { x:-HALL_EDGE * 1.5, y:-1 }, { x:HALL_EDGE * 1.5, y:-1 }, { x:0, y:HALL_EDGE } ] }, metal)));
  // 入口の側の壁（ふさぐ）。★開けておくと、たまった電子に押し返された電子が左へ飛び出していった
  objects.push(new Body(Object.assign({ isStatic:true, type:'box', x:x0 - HALL_WALL/2, y:cy, w:HALL_WALL, h:HALL_H + 2*HALL_WALL, label:'入口の壁' }, metal)));
  // 電子の入口（生成口）。出てくる電子の値をここに持たせる
  const gun = new Body({ type:'circle', x:x0 + 20, y:cy, radius:OHM_E_R, mass:OHM_E_M, charge:OHM_E_Q,
    hasGravity:false, fixedRotation:true, friction:1, frictionStatic:1, restitution:0, isSpawner:true, drag:HALL_DRAG,
    tracerEnabled:true, tracerColor:'#90caf9', tracerDuration:HALL_TRACE,
    fillColor:'#42a5f5', strokeColor:'#e3f2fd', strokeWidth:1.2, label:'電子の入口' });
  objects.push(gun);
  // 出口の板：当たった電子を消す（電池へ戻る）
  const sink = new Body(Object.assign({ isStatic:true, type:'box', x:x1 - 6, y:cy, w:12, h:HALL_H + 2, label:'出口（電池へ）' }, metal,
    { fillColor:'#ffd54f', strokeColor:'#fff8e1' }));
  objects.push(sink);
  const pg = addProgram(gun);
  if (pg) { Object.assign(pg, { trigger:'step', step:HALL_EVERY, action:'create', limit:200 }); pg.reset(); syncProgramState(pg);
            pg.collapsed = true; pg.fx = 0.035; pg.fy = 0.80; syncProgramPanel(pg); placeProgramPanel(pg); }
  const pk = addProgram(sink);
  if (pk) { Object.assign(pk, { trigger:'hit', hitWhat:'body', target:'other', action:'delete' }); pk.reset(); syncProgramState(pk);
            pk.collapsed = true; pk.fx = 0.035; pk.fy = 0.86; syncProgramPanel(pk); placeProgramPanel(pk); }
  // ── 窓：磁場の入り切り（↑）と強さ ──
  const sw = addRemote('ghost', field, 'emfield');
  if (sw) { sw.key = 'ArrowUp'; sw.savedStrength = HALL_BT; sw.fx = 0.795; sw.fy = 0.04;
            placeRemotePanel(sw); syncRemotePanel(sw); }
  const bk = addRemote('prop', field, 'emfield');
  if (bk) { bk.prop = 'strength'; bk.lo = 0; bk.hi = HALL_BMAX; bk.fx = 0.795; bk.fy = 0.30;
            placeRemotePanel(bk); syncRemotePanel(bk); }

  const ts = demoTextScale(cam.zoom);
  const LS = DEMO_NOTE_SIZE * 0.85 * ts;
  demoLabel(cx + HALL_FX0, yTop - HALL_WALL - 104, '磁場（紙面から出る向き ⊙）：↑ キーで入れる', '#81c784', LS, true);
  demoLabel(cx + HALL_FX0, yTop - HALL_WALL - 70, '電子がここ（上の壁ぎわ）にたまる', '#90caf9', LS, true);
  demoLabel(x0, yBot + HALL_WALL + 12, '電子の入口', '#90caf9', LS, true);
  demoLabel(x1 - 150, yBot + HALL_WALL + 12, '出口（電池へ）', '#ffd54f', LS, true);
  demoLabel(cx - 120, yBot + HALL_WALL + 12, '← 電流の向き（電子は →）', '#ffd54f', LS, true);
  const p = demoTextTopLeft();
  demoTitle(p.x, p.y, 'ホール効果モデル', DEMO_TITLE_SIZE * ts);
  demoNote (p.x, p.y + 54 * ts,
    '導体の板（ホール素子）を電子が左から右へ流れている（電流は左向き）。いまは磁場が無いので、まっすぐ進む。\n'
  + '\n'
  + '【手順】▶実行 を押し、↑ キーで磁場を入れる\n'
  + '・はじめの電子はローレンツ力で上へ曲がり、上の壁ぎわにたまっていく\n'
  + '・たまった − が下向きの電場（ホール電場）をつくり、あとから来る電子を押し返す\n'
  + '・電場の力 qE が qvB とつり合うと、あとの電子は少し上へ寄っただけで、まっすぐ進むようになる\n'
  + '　本物では下の壁ぎわは電子が減って ＋ になり、上下の壁のあいだに電圧（ホール電圧）が現れる\n'
  + '・〈強さ〉で磁場を強くすると、また曲がりはじめ、さらにたまってからまっすぐに戻る',
    DEMO_NOTE_SIZE * ts);
  // ★磁場を切ったまま流れが行き渡った姿で開く（入口から出口まで電子が並んでいる）
  demoRunAhead(900);
}

// ── 電流が磁場から受ける力モデル ────────────────────────────────────
//  ★オームの法則モデルと同じ寸法の輪（microLoop）の上の辺に ⊙ の磁場をかけ、上の辺の
//    **島の側の壁**を切り取って「動く導線」（ばねで吊った板）に置き換えた。磁場の中を流れる
//    電子はローレンツ力で島の側へ曲がって板を押し、板が受ける力はばねの力の矢印で読める。
//    F = IBL の力は、電子1個1個が受ける qvB の和が導線の格子へ渡ったもの、というのが芯。
//    ★本物の導体では、寄った電子がつくるホール電場が陽イオンの格子を押して力が渡る。
//      この模型では電子が壁にぶつかって押す（接触の力）。渡しかたは違うが、行き先は同じ導線。
//  ★動く板を**外側の壁**ではなく**島の側**に置いた理由：外側の壁にすると、磁場 0 でも板が
//    押された（0.031 N）。この模型は陽イオンに電気を持たせていないので輪全体が負に帯電していて、
//    電子どうしの反発がどの電子も輪の外側へ押しつけているため（ホール効果モデルで、磁場が
//    無くても粒が外側の壁に貼りつくのと同じ根）。島の側ならその押しは板から離れる向きなので、
//    磁場 0 で力は 0 になる（下の表の対照）。磁場を ⊙ にしたのは、電流（上の辺で右向き）と
//    磁場から F = IL×B が下＝島の側を向くようにするため（フレミングの左手）。
//  ★**板はほとんど動かない（1px 未満）ようにばねを硬くしてある**。最初は柔らかいばね
//    （0.35 N/m）で板を大きく動かしていたが、板が下がって開いた溝の両端が垂直な壁で、
//    そこに入った電子が電場の無い溝の中で止まり、出られなくなった（実測：磁場の区間にいる
//    電子が 2.2 → 8.6 個に増え、板の動きは磁場 0.5／1／2 T で 11／12／14px と頭打ち）。
//    溝の深さを電子の直径（14px）よりずっと浅く保てば溝に入る電子はいない。動きの代わりに
//    **ばねの力の矢印**（緑）を読ませる。力の矢印は平滑化されて出るので、電子1個ずつの
//    衝突のばらつきは目立たない。
//  ★実測（乱数固定・1200tick 落ち着かせ、1800tick＝30秒の時間平均。ばねの力 ＝ 2本のばね定数×
//    板の変位。予想 ＝ 磁場の区間にいる電子の q·v·B の和）：
//      磁場 電圧 │ ばねの力 │ 予想  │ 磁場の区間の電子
//       0    2  │ 0.000 N │ 0     │ 3.4    ← 対照
//       0.5  2  │ 0.067 N │ 0.089 │ 3.1
//       1    2  │ 0.150 N │ 0.175 │ 3.2   ★既定
//       2    2  │ 0.299 N │ 0.331 │ 3.4
//       1    1  │ 0.079 N │ 0.096 │ 2.5
//       1    3  │ 0.189 N │ 0.214 │ 3.2
//    磁場に比例し（0.5 → 1 → 2 で 0.067 → 0.150 → 0.299）、電圧を上げて電流が増えると増える。
//    予想の 85〜90% が板に届く（区間の電子がいつも板に触れているわけではない）。
//    電子が溝や輪の外へ出たのは延べ 0。
//  ★板の長さと電子の数（FORCE_BAR_W・FORCE_N）は矢印が読めるかで決めた。電子は塊になって
//    回ってくるので、板が受ける力は時間で揺れる。矢印と同じ平滑化（毎フレーム 0.2）をかけた値が
//    平均の 40% を下回っていた時間の割合（磁場 1 T／2 T）：
//      板 300px・電子 18個 … 10%／9%（平均 0.094／0.169 N。0.5 T では 0 ＝外向きの反発に負けた）
//      板 480px・電子 18個 … 11%／3%
//      板 480px・電子 26個 …  3%／1% ★これ（平均 0.150／0.299 N）
//    電子を増やすと外向きの反発も強まるが、0.5 T でも板まで寄るようになった（上の表）。
const FORCE_A = 355, FORCE_B = 185;   // [px] オームの法則モデルと同じ寸法
const FORCE_N = 26;       // 電子の数（オームの法則モデルは 18。上の★）
const FORCE_BAR_W = 480;   // [px] 動く導線（上の辺の島の側の壁の一部）の長さ。上の辺の直線は 530px
const FORCE_BAR_M = 0.5;   // [kg]
const FORCE_K = 15;        // [N/m] ばね1本（2本で吊る）。★硬い理由は上の★
const FORCE_C = 3;         // [N·s/m] ばね1本の減衰
const FORCE_BT = 1;        // [T] 磁場の強さの初期値
const FORCE_BMAX = 2;      // [T] つまみの上限
const FORCE_LAYER_BAR = 0b0100;   // 動く板。★電子だけが当たる（壁・陽イオンとは当たらない＝窓の縁に引っかからない）
const MAGF_VIZ = 1000;    // [px per N] 力の矢印の倍率。★既定の 1 では 0.1 N が 0.1px で見えない。
                           //   既定の磁場で ばね1本 0.044 N ＝ 70px
function demoMagForceModel() {
  resetDemoWorld();
  setDemoGravity(0);
  updateGroundTerrain(false);
  world.sleeping  = false;
  world.substeps  = 8;
  world.coulombOn = true;
  world.coulombK  = OHM_COULOMB_K;
  setDemoCam(0, 0.62);
  const cx = 0, cy = cam.y + 200;
  const L = microLoop({ cx, cy, A:FORCE_A, B:FORCE_B, nE:FORCE_N, resHalf:OHM_RES_HALF,
                        layers: OHM_LAYER_E | FORCE_LAYER_BAR });
  const H = OHM_CORR/2;
  const yIn = cy - FORCE_B + H;                       // 上の辺の島の側の壁の面（通路の下の縁）
  // 島の上の壁に窓を抜く（壁の厚みを貫く）
  const slot = new Body(Object.assign({ isStatic:true, type:'box', x:cx, y:yIn + OHM_WALL/2,
                         w:FORCE_BAR_W + 4, h:OHM_WALL + 2 }, MICRO_METAL));
  demoBoolean('diff', [L.island, slot]);
  const bar = new Body({ type:'box', x:cx, y:yIn + OHM_WALL/2, w:FORCE_BAR_W, h:OHM_WALL,
    mass:FORCE_BAR_M, hasGravity:false, fixedRotation:true, layers:FORCE_LAYER_BAR,
    guideEnabled:true, guideAngle:Math.PI/2, friction:0, frictionStatic:0, restitution:0,
    label:'動く導線', fillColor:'#90a4ae', strokeColor:'#ffe082', strokeWidth:2 });
  objects.push(bar);
  for (const sx of [-1, 1]) {
    const ax = cx + sx*(FORCE_BAR_W/2 - 30), ay = yIn + OHM_WALL + 150;
    demoSpring({ bodyB:bar, anchorAx:ax, anchorAy:ay, anchorBx:sx*(FORCE_BAR_W/2 - 30), anchorBy:OHM_WALL/2,
                 stiffness:FORCE_K, damping:FORCE_C, radius:10, color:'#ffb74d' });
  }
  const LX = 2*FORCE_A - 2*OHM_CR;
  const field = new EMField({ kind:'B', x:cx, y:cy - FORCE_B, w:LX, h:OHM_CORR, strength:FORCE_BT, out:true });
  emFields.push(field);
  bar.showForces = true; world.forceVizScale = MAGF_VIZ;

  const bk = addRemote('prop', field, 'emfield');
  if (bk) { bk.prop = 'strength'; bk.lo = 0; bk.hi = FORCE_BMAX; bk.fx = 0.795; bk.fy = 0.04;
            placeRemotePanel(bk); syncRemotePanel(bk); }
  const volt = addRemote('prop', L.bands[0], 'emfield', L.bands.map(f => f.id));
  if (volt) { volt.prop = 'strength'; volt.lo = 0; volt.hi = OHM_EMAX; volt.fx = 0.795; volt.fy = 0.28;
              placeRemotePanel(volt); syncRemotePanel(volt); }

  const ts = demoTextScale(cam.zoom);
  microBatterySketch(cx - FORCE_A, cy, ts);
  // ★札は輪の下の空き。島の中はばね2本が縦に通っていて、横に札を置く幅が無い
  const yLab = cy + FORCE_B + OHM_CORR/2 + OHM_WALL + 14;
  demoLabel(cx - 330, yLab, '島の上の灰色の板＝動く導線（ばねで吊ってある）', '#ffe082', DEMO_NOTE_SIZE * 0.85 * ts, true);
  demoLabel(cx - 330, yLab + 34, '青の矢印＝電子が押す力（下向き）　緑の矢印＝つり合うばねの力', '#81c784', DEMO_NOTE_SIZE * 0.85 * ts, true);
  demoLabel(cx - FORCE_A + 70, cy - FORCE_B - OHM_CORR/2 - OHM_WALL - 34, '電流 →（時計回り）', '#ffd54f', DEMO_NOTE_SIZE * ts, true);
  const p = demoTextTopLeft();
  demoTitle(p.x, p.y, '電流が磁場から受ける力モデル', DEMO_TITLE_SIZE * ts);
  demoNote (p.x, p.y + 54 * ts,
    'オームの法則モデルの輪の上の辺に、紙面から出る向き（⊙）の磁場をかけた。\n'
  + '上の辺の内側の壁の一部を切り取り、ばねで吊った「動く導線」にしてある。\n'
  + '\n'
  + '【手順】▶実行 を押す\n'
  + '・磁場の中の電子はローレンツ力で下へ曲がり、動く導線を押す（青の矢印）。緑の矢印はつり合うばねの力\n'
  + '・電流は右向き・磁場は手前向きなので、力は下向き（フレミングの左手）\n'
  + '・〈磁場の強さ〉を 1 → 2 にすると緑の矢印は2倍。0 にすると矢印は消える\n'
  + '・〈電圧〉を上げると電流が増え、矢印が伸びる（F = IBL）\n'
  + '　導線が受ける力は、電子1個1個が受けるローレンツ力 qvB が導線へ渡ったもの',
    DEMO_NOTE_SIZE * ts);
  demoRunAhead(600);
}

// ── 誘導起電力のミクロモデル ─────────────────────────────────────────
//  ★中を空洞にした導体棒（型抜きした管）に自由電子を入れ、磁場（⊗）の中を手で動かす。
//    電子は棒の壁に押されて棒と一緒に動くので、速さ v でローレンツ力 qvB を受けて棒の
//    下の端へ寄る（右へ動かしたとき）。寄った電子どうしの反発が上向きの電気力になって
//    qvB とつり合ったところで止まる＝棒の両端に電位差（誘導起電力 vBL）が残る。
//    上の端は電子が減って＋、下の端は電子が余って−。回路ツールの導体棒（em/circuit.js の
//    buildRods）が「起電力 vBL」という数で扱っているものの中身。
//  ★この系は慣性系で解いている（CLAUDE.md の不変条件）。電子を押しているのは、棒と一緒に
//    動いている電子の速度にかかる、ふつうのローレンツ力だけ。棒の上に乗った観測者から見ると
//    「電場がある」ように見える、という話は出さない（見かけの力を足さない約束と同じ線）。
//  ★棒は固定した物体で、〈手で動かす〉のリモコン（→ と ←）で動かす。手は棒の速度を決めるだけで、
//    電子を押すのは棒の壁（接触の力）。
//  ★電子には抗力を付ける（Cd 2.5。箔検電器の ES_EDRAG と同じ値・同じ理由）。無いと棒を
//    止めたあと電子が管の中を上下に行き来し続けて、元の並びに戻らない。★抗力は世界に対する
//    速度で効くので、棒が動いているあいだは電子を後ろの壁へ押しつける向きにもかかる
//    （横向き。上下の寄りには効かない）。
//  ★陽イオンは置かない（オームの法則モデルと同じく、置いても電気を持たせないので）。
//    「上が＋」は「電子が減った」の言い換えで、本文でもそう書く。
//  ★実測（乱数は使っていない。止めたまま 300tick 並ばせ、そこから一定の速さで 6秒動かし、
//    後半 3秒の時間平均。ずれ ＝ 電子の高さの平均と棒の中心の差、+ が下）：
//      速さ v  磁場 B │ v·B │ ずれ    │ 上半分の電子
//       0     2     │  0  │  0.0px │ 5.0個   ← 対照（止めたまま）
//       1     0     │  0  │  0.0px │ 5.0個   ← 対照（磁場なし）
//       0.5   2     │  1  │ 42.8px │ 3.6個
//       1     1     │  1  │ 32.5px │ 4.0個
//       1     2     │  2  │ 71.9px │ 3.0個
//       1     3     │  3  │ 94.7px │ 2.0個   ★既定（上の端が空いて、寄ったのがひと目で分かる）
//       1     4     │  4  │ 108.6px│ 1.0個   ← 上の端がほぼ空になって頭打ち
//    v·B が大きいほど大きく寄る。同じ v·B でも v=0.5 のほうが寄るのは抗力のぶん
//    （速いほど電子を後ろの壁へ押しつけ、壁ぞいの上下の動きが渋くなる）。
//    電子が管の外へ出たのは延べ 0。
const EMFR_W = 70, EMFR_H = 420;   // [px] 棒（中が空洞の管）の外寸
const EMFR_WALL = 12;              // [px] 管の壁の厚み
const EMFR_N = 10;                 // 自由電子の数
const EMFR_DRAG = 2.5;             // 電子の抗力係数（箔検電器の ES_EDRAG と同じ）
const EMFR_BT = 3;                 // [T] 磁場の強さの初期値（上の★の表）
const EMFR_BMAX = 4;               // [T] つまみの上限（上の表で上の端がほぼ空になる）
const EMFR_V = 1;                  // [m/s] 手で動かす速さ（窓で変えられる）。★磁場の幅 900px を 9秒で横切る
const EMFR_FIELD_W = 900;          // [px] 磁場の領域の幅
function demoInducedEmfMicro() {
  resetDemoWorld();
  setDemoGravity(0);
  updateGroundTerrain(false);
  world.sleeping  = false;
  world.substeps  = 8;
  world.coulombOn = true;
  world.coulombK  = OHM_COULOMB_K;
  setDemoCam(0, 0.62);
  const cx = -EMFR_FIELD_W/2 + 120, cy = cam.y + 170;
  const tube = demoBoolean('diff', [
    new Body(Object.assign({ isStatic:true, type:'box', x:cx, y:cy, w:EMFR_W, h:EMFR_H }, MICRO_METAL)),
    new Body(Object.assign({ isStatic:true, type:'box', x:cx, y:cy, w:EMFR_W - 2*EMFR_WALL, h:EMFR_H - 2*EMFR_WALL }, MICRO_METAL)) ]);
  tube.label = '導体棒';
  const es = [];
  const innerH = EMFR_H - 2*EMFR_WALL;
  for (let i = 0; i < EMFR_N; i++) {
    const b = new Body({ type:'circle', x:cx + ((i % 2) ? 6 : -6), y:cy - innerH/2 + (i + 0.5) * innerH/EMFR_N,
      radius:OHM_E_R, mass:OHM_E_M, charge:OHM_E_Q, hasGravity:false, fixedRotation:true,
      drag:EMFR_DRAG, friction:0, frictionStatic:0, restitution:0,
      fillColor:'#42a5f5', strokeColor:'#e3f2fd', strokeWidth:1.2 });
    objects.push(b); es.push(b);
  }
  const field = new EMField({ kind:'B', x:0, y:cy, w:EMFR_FIELD_W, h:EMFR_H + 160, strength:EMFR_BT, out:false });
  emFields.push(field);
  // ★電子に力の矢印は出さない。磁気力と電気力のほかに、壁の垂直抗力・抗力・衝突の瞬間の
  //   電気力が重なって、管のまわりが矢印で埋まった（読めるのは寄った電子の並びのほう）

  // ── 窓：棒を右へ・左へ動かす手（→・←）と、磁場の強さ ──
  const mk = (key, dir, fy) => {
    const r = addRemote('drive', tube, 'body');
    if (!r) return;
    r.key = key; r.dir = dir; r.speed = EMFR_V; r.fx = 0.795; r.fy = fy;
    placeRemotePanel(r); syncRemotePanel(r);
  };
  mk('ArrowRight', 0, 0.04);
  mk('ArrowLeft', 180, 0.36);   // ★〈手で動かす〉の窓は背が高い（0.3 だと上の窓に重なった）
  const bk = addRemote('prop', field, 'emfield');
  if (bk) { bk.prop = 'strength'; bk.lo = 0; bk.hi = EMFR_BMAX; bk.fx = 0.795; bk.fy = 0.68;
            placeRemotePanel(bk); syncRemotePanel(bk); }

  const ts = demoTextScale(cam.zoom);
  demoLabel(-EMFR_FIELD_W/2 + 10, cy - EMFR_H/2 - 80 + 8, '磁場（紙面の裏へ向かう向き ⊗）', '#81c784', DEMO_NOTE_SIZE * ts, true);
  const p = demoTextTopLeft();
  demoTitle(p.x, p.y, '誘導起電力のミクロモデル', DEMO_TITLE_SIZE * ts);
  demoNote (p.x, p.y + 54 * ts,
    '導体棒の中を覗いた図。青い粒が自由電子で、たがいに反発する。棒は磁場の中にある。\n'
  + '\n'
  + '【手順】→ キーを押しているあいだ、棒が右へ動く（← で左へ）\n'
  + '・電子も棒と一緒に動くので、ローレンツ力 qvB を受けて下の端へ寄る\n'
  + '・上の端は電子が減って＋、下の端は電子が余って−になる。これが誘導起電力（上が高電位）\n'
  + '・寄った電子どうしの反発（上向きの電気力）が qvB とつり合うところで寄りが止まる\n'
  + '・棒を止める、または磁場の外へ出すと、電子は反発で広がって元に戻る（起電力が消える）\n'
  + '・〈磁場の強さ〉を上げる・速く動かす（窓の速さ）と、大きく寄る（V = vBL）',
    DEMO_NOTE_SIZE * ts);
  demoRunAhead(300);
}

// ── 導体と不導体モデル ───────────────────────────────────────────
//  ★2つの箱に、同じ数の陽イオン（＋、固定）と電子（−）を入れる。違いは1つだけ：
//      導体   … 電子は自由に動ける（陽イオンにぶつかりながら箱の中をどこへでも行ける）
//      不導体 … 電子は自分の陽イオンにばねでつながれている（陽イオンのまわりしか動けない）
//    あいだに帯電した棒を置くと、導体では電子が棒の側へ集まり（静電誘導）、遠い側には
//    陽イオンの ＋ が取り残される。不導体では電子が自分の陽イオンの棒の側へずれるだけ（誘電分極）。
//  ★陽イオンに**電気を持たせる**（オームの法則モデルの一族とここが違う）。箱が全体で中性で
//    ないと、棒が無くても箱どうし・電子どうしが押し合って、「誘導で分かれた」のか「もともと
//    偏っていた」のかが区別できない。持たせると電子は陽イオンに引かれてくっつく（中性の原子の姿）
//    ので、電子は陽イオンにぶつかる（すり抜けない）ようにしてある：すり抜けると電子が陽イオンの
//    中心に沈み、やわらげた クーロン力の井戸（COULOMB_SOFTEN2）が深すぎて、導体でも動けなくなる。
//    ぶつかる距離（23px）での引力は 0.09 N で、棒の電場で引きはがせる。
//  ★電子には抗力（Cd 2.5。箔検電器の ES_EDRAG と同じ）。無いと落ち着かずに揺れ続ける。
//  ★実測（乱数は使っていない。棒の電気量を設定し、900tick 落ち着かせて 600tick の時間平均。
//    導体＝棒の側の半分にいる電子の数（全部で 12個）、不導体＝電子が自分の陽イオンから棒の向きへ
//    ずれた距離の平均、はみ出し＝導体の箱の外に出た／不導体で自分の陽イオンから 40px 以上離れた電子）：
//      棒の電気量 │ 導体：棒の側 │ 不導体：ずれ │ はみ出し
//        0       │   6 個     │   0 px     │ 0
//        0.5     │   9 個     │  20 px     │ 0
//        1       │  12 個     │  21 px     │ 0
//        2       │  12 個     │  21 px     │ 0   ★既定
//        4       │  12 個     │  22 px     │ 0
//       −2       │   0 個     │ −21 px     │ 0   （棒から遠ざかる）
//    不導体のずれは陽イオンの半径＋電子の半径（23px）で頭打ちになる：電子は自分の陽イオンの
//    表面を転がって棒の側へ回るだけで、となりの陽イオンへは移らない。
//  ★不導体のばね（CI_BIND）は 8 N/m。電子が陽イオンの表面にいるとき 1.8 N で引き戻す。棒の電気量 4 で
//    いちばん近い列にかかる電気力は 0.9 N なので、はがれない。★ばねが弱いと（0.8 N/m で試した
//    とき）、四隅の電子が引き出されて箱の壁まで行った。
//    同じ理由で、端の陽イオンと壁のあいだ（CI_PAD）は電子が陽イオンの表面にいても壁に触れない幅にしてある。
const CI_K     = 50;        // 実効クーロン定数（オームの法則モデルと同じ）
const CI_Q     = 0.01;      // [C] 陽イオン・電子1個の電気量の大きさ
const CI_COLS = 4, CI_ROWS = 3;
const CI_PITCH = 62;        // [px] 陽イオンの間隔
const CI_WALL  = 20;        // [px] 箱の壁の厚み
const CI_PAD   = 44;        // [px] 端の陽イオンから壁の内面まで
const CI_BIND  = 8;         // [N/m] 不導体の電子を自分の陽イオンにつなぐばね
const CI_BIND_C = 0.2;      // [N·s/m] その減衰
const CI_DRAG  = 2.5;       // 電子の抗力係数（箔検電器の ES_EDRAG と同じ）
const CI_ROD_Q = 2;         // [C] 棒の電気量の初期値
const CI_ROD_QMAX = 4;       // [C] つまみの上限（上の表の 4 まで確かめた）
const CI_GAP   = 80;        // [px] 棒の面から箱の外面まで
const CI_ROD_W = 40, CI_ROD_H = 260;
const CI_LAYER_ROD = 0b0100;   // ★棒は誰とも当たらない。レイヤー 0（すり抜け）にすると破線で描かれて「無いもの」に見える
const CI_LAYER_ION = 0b0010, CI_LAYER_E = 0b0011, CI_LAYER_WALL = 0b0001, CI_LAYER_SPR = 0b1000;
// 陽イオンと電子を入れた箱。bound なら電子を自分の陽イオンにばねでつなぐ（不導体）
function ciBlock(cx, cy, bound) {
  const iw = (CI_COLS - 1) * CI_PITCH + 2*CI_PAD, ih = (CI_ROWS - 1) * CI_PITCH + 2*CI_PAD;
  const box = demoBoolean('diff', [
    new Body(Object.assign({ isStatic:true, type:'box', x:cx, y:cy, w:iw + 2*CI_WALL, h:ih + 2*CI_WALL, layers:CI_LAYER_WALL }, MICRO_METAL)),
    new Body(Object.assign({ isStatic:true, type:'box', x:cx, y:cy, w:iw, h:ih, layers:CI_LAYER_WALL }, MICRO_METAL)) ]);
  box.label = bound ? '不導体' : '導体';
  const ions = [], es = [];
  for (let r = 0; r < CI_ROWS; r++) for (let c = 0; c < CI_COLS; c++) {
    const x = cx - iw/2 + CI_PAD + c*CI_PITCH, y = cy - ih/2 + CI_PAD + r*CI_PITCH;
    const ion = new Body({ type:'circle', x, y, radius:OHM_ION_R, isStatic:true, charge:CI_Q,
      layers:CI_LAYER_ION, friction:0, frictionStatic:0, restitution:0,
      fillColor:'#ef5350', strokeColor:'#ffcdd2', strokeWidth:1.2 });
    objects.push(ion); ions.push(ion);
    // 電子は陽イオンの真上に接して置く（中性の姿）
    const d = OHM_ION_R + OHM_E_R + 0.5;
    const e = new Body({ type:'circle', x, y:y - d, radius:OHM_E_R, mass:OHM_E_M,
      charge:-CI_Q, hasGravity:false, fixedRotation:true, drag:CI_DRAG, layers:CI_LAYER_E,
      friction:0, frictionStatic:0, restitution:0,
      fillColor:'#42a5f5', strokeColor:'#e3f2fd', strokeWidth:1.2 });
    objects.push(e); es.push(e);
    if (bound) {
      const spr = demoSpring({ bodyA:ion, bodyB:e, restLength:0, stiffness:CI_BIND, damping:CI_BIND_C,
                               radius:3, color:'#90caf9', showCoil:false });
      if (spr) spr.layers = CI_LAYER_SPR;
    }
  }
  return { box, ions, es, cx, cy, iw, ih };
}
function demoConductorInsulatorModel() {
  resetDemoWorld();
  setDemoGravity(0);
  updateGroundTerrain(false);
  world.sleeping  = false;
  world.substeps  = 8;
  world.coulombOn = true;
  world.coulombK  = CI_K;
  setDemoCam(0, 0.85);
  const cy = cam.y + 150;
  const iw = (CI_COLS - 1) * CI_PITCH + 2*CI_PAD;
  const off = CI_ROD_W/2 + CI_GAP + CI_WALL + iw/2;
  const cond = ciBlock(-off, cy, false);
  const ins  = ciBlock( off, cy, true);
  const rod = new Body({ type:'box', x:0, y:cy, w:CI_ROD_W, h:CI_ROD_H, isStatic:true, charge:CI_ROD_Q,
    label:'帯電した棒', fillColor:'#ffcc80', strokeColor:'#fff3e0', strokeWidth:1.5, layers:CI_LAYER_ROD });
  objects.push(rod);

  const qk = addRemote('prop', rod, 'body');
  if (qk) { qk.prop = 'charge'; qk.lo = -CI_ROD_QMAX; qk.hi = CI_ROD_QMAX; qk.fx = 0.795; qk.fy = 0.04;
            placeRemotePanel(qk); syncRemotePanel(qk); }
  const ts = demoTextScale(cam.zoom);
  const yTop = cy - cond.ih/2 - CI_WALL - 70;
  demoLabel(cond.cx - cond.iw/2, yTop, '導体', '#eceff1', DEMO_TITLE_SIZE * ts, true);
  demoLabel(cond.cx - cond.iw/2, yTop + 40, '電子は箱の中を自由に動ける', '#90caf9', DEMO_NOTE_SIZE * 0.85 * ts, true);
  demoLabel(ins.cx - ins.iw/2, yTop, '不導体（絶縁体）', '#eceff1', DEMO_TITLE_SIZE * ts, true);
  demoLabel(ins.cx - ins.iw/2, yTop + 40, '電子は自分の陽イオンにばねでつながれている', '#90caf9', DEMO_NOTE_SIZE * 0.85 * ts, true);
  demoLabel(-70, cy + CI_ROD_H/2 + 16, '帯電した棒', '#ffcc80', DEMO_NOTE_SIZE * 0.85 * ts, true);
  const p = demoTextTopLeft();
  demoTitle(p.x, p.y, '導体と不導体モデル', DEMO_TITLE_SIZE * ts);
  demoNote (p.x, p.y + 54 * ts,
    '赤い＋が陽イオン（動かない）、青い−が電子。どちらの箱も同じ数で、全体では電気を持たない。\n'
  + 'あいだの棒は ＋ に帯電している。\n'
  + '\n'
  + '【手順】▶実行 を押す\n'
  + '・導体：電子が棒の側へ集まり、遠い側には陽イオンの ＋ が残る（静電誘導）\n'
  + '・不導体：電子は自分の陽イオンの棒の側へずれるだけ。表面に − と ＋ が少し現れる（誘電分極）\n'
  + '・〈棒の電気量〉を − にすると、どちらも逆向きに寄る。0 にすると元に戻る',
    DEMO_NOTE_SIZE * ts);
}
