// ════════════════════════════════════════
//  光の干渉（複素振幅バッファ）
//
//  考え方
//   干渉は「レイどうしの交点」で起きるのではなく、空間の各点で複素振幅を足すと現れる。
//   交点を列挙する方式だと、交点の格子の粗さがレイ間隔で決まってしまい（縞間隔とは
//   無関係）モアレになるうえ、交点の間を描けずビームが破線になる。総当たりで O(M²) でもある。
//   そこで画面のセルごとに複素振幅を積み上げ、あとから各点を参照する。
//
//     I(x,y) = | Σⱼ aⱼ·e^{iφⱼ} |²        φⱼ = k·(opl + n·s) + ph
//
//  表示への効き方
//   使うのは強度そのものではなく、「全部が同位相だったら出るはずの強度」との比
//
//     mod = |Σⱼ aⱼ·e^{iφⱼ}|² / (Σⱼ aⱼ)²        弱め合い 0 ／ 単独 1 ／ 強め合い 1
//
//   これを既存の表示ガンマに通す：vis = (強度 × mod)^(1/RAY_GAMMA)。
//     ・レイが1本しかない場所は mod=1 なので、絵は従来とまったく変わらない
//     ・弱め合いは 0 に落ちて消える
//     ・強め合いも 1。2本ぶんの明るさは、キャンバスの 'lighter' が2本を足すことで出る
//       （＝明線は「2本ぶん」、暗線は真っ黒、平均はその中間、という素直な絵になる）
//
//   ★分母を Σ|aⱼ|²（非可干渉和）にしてはいけない。1枚の平面波を N 本のレイで標本化すると
//     Σ|aⱼ|² は N に比例するのに |Σaⱼ|² は N² に比例するので、比が標本化の細かさに
//     比例してしまう（単独のビームなのに mod=N になる）。分母を (Σaⱼ)² にすると
//     N が約分されて消え、レイ本数にも刻み幅にも依存しない量になる。
//     強さの違う光どうしでも正しく効く：a₁≫a₂ なら mod は ((a₁−a₂)/(a₁+a₂))² …1 の間で
//     しか振れず、弱い光は強い光をほとんど変調できない（実際そのとおり）。
//
//  分けて積む単位
//   干渉するのは「同じレーザー × 同じ波長」の光だけ。独立な光源どうしは相対位相が
//   揺らぐので縞は立たず、波長が違えばうなりが時間平均で消える。よって
//
//     I(x,y) = Σ_光源 Σ_波長 | E_{光源,波長}(x,y) |²
//
//   となり、光源をまたぐ合成は強度の足し算＝キャンバスの 'lighter' そのもの。
//   バッファは1組だけ用意して、(光源,波長) を1つずつ「クリア→積む→描く」で回す。
//   だからレーザーが何本あってもメモリは増えない。
// ════════════════════════════════════════
const IF_DOWNSCALE = 1;      // バッファの粗さ。1＝画面と同じ解像度
// ★「セルを画面ではなくワールドに固定する（ds＝ズーム倍率）」を試したが、戻した。
//   拡大すると同じ物理を余分な点数で積むことになるのは確かで、ズーム4なら20倍速くなる。
//   だが cam.maxZoom は 2.5 で、ds が2になるのはズーム2.0以上のときだけ＝使える幅が狭い。
//   そのわずかな得のために、拡大時だけ絵が変わりうる経路を残す価値はないと判断した。
// 線分に沿って積む刻み [セル]。1未満なら按分（バイリニア）と合わせて塗り残しが出ない。
// λ_sim ≒ 12.7px なので、この刻みでも1周期あたり14点あり位相は十分なめらかに追える。
const IF_STEP_CELLS = 0.9;
// ★ただし刻みは位相のほうからも縛られる。1歩で進む位相が π を超えると複素振幅が
//   折り返してしまい（エイリアス）、積んだ場は「空白」ではなく「もっともらしい嘘」になる。
//   1歩あたり IF_MAX_DPHI [rad] を超えないところまで刻みを細かくする。
//   ズームが 1 付近では 0.45 rad なので、この制限は効かない＝従来の絵は変わらない。
//   効くのはズームアウトしたとき（λ×zoom が数pxを切る領域）だけで、そこでは
//   代わりに積む面積のほうが zoom² で小さくなるので、総処理量は跳ね上がらない。
const IF_MAX_DPHI = 1.0;
const ifStepCells = (k, n) => Math.min(IF_STEP_CELLS, IF_MAX_DPHI * cam.zoom / Math.max(1e-9, k * n));
const IF_MAX_STEPS = 8000;   // 1線分あたりの積算ステップ上限（画面対角より十分大きい安全弁）
const IF_HALF_MAX = 3;       // 波面の板を刻む副標本の数の上限（幅の広いビームでの暴走防止）
// 縞が細かくなりすぎたときのフェード [画面px]。
//   バッファのセルより細かい縞は原理的に描けず、無理に描くとモアレの砂嵐になる。
//   λ が画面上で IF_FADE_LO を切ったら干渉を切り、IF_FADE_HI で全開にする。
//   ★ズームアウトへの対策であると同時に、鏡への垂直入射で立つ定在波（間隔 λ/2）が
//     つぶれる領域でも自動的に効く。
const IF_FADE_LO = 3, IF_FADE_HI = 7;
// re,im … 複素振幅の和 Σa·e^{iφ}   mag … 大きさの和 Σa（同位相なら出るはずの振幅）
// ★この3つを1本の配列へ交互配置（[re,im,mag]の繰り返し）にすればキャッシュに乗って速く
//   なるはず……と考えて実測したが、まったく変わらなかった（0.99倍）。3本を順に舐める
//   アクセスはプリフェッチャがそのまま扱えるので、そもそもキャッシュミスで詰まっていない。
//   律速はメモリではなく、1点あたりの添字計算と範囲チェックのほうである（IF_HALF_MAX 参照）。
const lightField = { W: 0, H: 0, re: null, im: null, mag: null,
                     x0: 0, y0: 0, x1: -1, y1: -1 };   // x0..x1,y0..y1 は積んだ範囲（クリア用）
// 画面上の波長から決まる、干渉の効かせぐあい（0=切る … 1=全開）
// ★コヒーレントなレーザーが1本もなければ ifBegin すら呼ばれないので、
//   干渉を使わないシーンではバッファの確保もクリアも一切起きない。
function ifLambdaFade(wl) {
  const lp = simLambdaPx(wl) * cam.zoom;
  return clamp01((lp - IF_FADE_LO) / (IF_FADE_HI - IF_FADE_LO));
}
function ifEnsure() {
  const W = Math.max(1, Math.ceil(canvas.width  / IF_DOWNSCALE));
  const H = Math.max(1, Math.ceil(canvas.height / IF_DOWNSCALE));
  const F = lightField;
  if (F.W === W && F.H === H && F.re) return F;
  F.W = W; F.H = H;
  F.re = new Float32Array(W * H);
  F.im = new Float32Array(W * H);
  F.mag = new Float32Array(W * H);
  F.x0 = 0; F.y0 = 0; F.x1 = -1; F.y1 = -1;
  return F;
}
// 1つの (群,波長) を積み始める。前回積んだ範囲だけを消すので、
// レーザーが画面の一部しか照らしていなければクリアもその範囲で済む。
function ifBegin() {
  const F = ifEnsure();
  if (F.x1 >= F.x0 && F.y1 >= F.y0) {
    const w = F.x1 - F.x0 + 1;
    for (let y = F.y0; y <= F.y1; y++) {
      const s = y * F.W + F.x0, e = s + w;
      F.re.fill(0, s, e); F.im.fill(0, s, e); F.mag.fill(0, s, e);
    }
  }
  F.x0 = F.W; F.y0 = F.H; F.x1 = -1; F.y1 = -1;
  return F;
}
// 線分を矩形 0..W, 0..H で切る（Liang-Barsky）。戻り値は媒介変数の区間 [t0,t1]。
//   ★必須。当たらなかった光線は長さ 1e5 px あるので、切らずに刻むと際限がない。
function _ifClip(x0, y0, x1, y1, W, H) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0, W - x0, y0, H - y0];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else          { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return t0 < t1 ? [t0, t1] : null;
}
// 副標本の垂直オフセット置き場。点ごとに作り直さないよう、線分ごとに1度だけ埋める
const _ifOffX = new Float64Array(2 * IF_HALF_MAX + 1);
const _ifOffY = new Float64Array(2 * IF_HALF_MAX + 1);
// 1本の線分を複素振幅としてバッファへ積む。
//   spanCells … このレイが代表する波面の幅 [セル]。'solid'（連続開口）ではレイ間隔を渡す。
//               1本のレイは「幅 Δx の波面の板」を代表しているので、点として積むと
//               干渉していなくても隙間が縞模様になって出てしまう（標本化の偽物）。
//   ★按分（バイリニア）だけで約1セルぶんは広がるので、垂直方向へ余分に振るのは
//     レイ間隔が1セルを超えるぶんだけでよい。ここを常に振っていると、はみ出した写像に
//     3倍の書き込みが発生して、幅の広いビームで一気に重くなる。
function ifSplatSeg(F, seg, k, spanCells) {
  const a = worldToScreen(seg.x1, seg.y1), b = worldToScreen(seg.x2, seg.y2);
  const ax = a.x / IF_DOWNSCALE, ay = a.y / IF_DOWNSCALE;
  const bx = b.x / IF_DOWNSCALE, by = b.y / IF_DOWNSCALE;
  const cl = _ifClip(ax, ay, bx, by, F.W - 1, F.H - 1);
  if (!cl) return;
  const amp = Math.sqrt(Math.max(0, seg.i));
  if (amp < 1e-6) return;
  const cdx = bx - ax, cdy = by - ay;
  const cellLen = Math.hypot(cdx, cdy) * (cl[1] - cl[0]);            // 切ったあとの長さ [セル]
  const steps = Math.max(1, Math.min(IF_MAX_STEPS, Math.ceil(cellLen / ifStepCells(k, seg.n))));
  const worldLen = len(seg.x2 - seg.x1, seg.y2 - seg.y1);            // 元の長さ [ワールドpx]
  // 位相：φ(t) = k·(opl + n·t·worldLen) + ph。t について線形なので差分で回せる
  const dt = (cl[1] - cl[0]) / steps;
  const dPhi = k * seg.n * worldLen * dt;
  const phi0 = k * (seg.opl + seg.n * worldLen * (cl[0] + dt * 0.5)) + seg.ph;
  // 進行方向に垂直な単位ベクトル（セル空間）
  const cl2 = Math.hypot(cdx, cdy) || 1;
  const perpX = -cdy / cl2, perpY = cdx / cl2;
  // ★波面の板を「セル整数ぶんずらして重ねる」のではなく、幅 spanCells の帯として
  //   敷き詰める。整数ずらしだと、レイ間隔がセルの整数倍でないときに
  //   セルごとの本数が波打ち、干渉していない場所にも斑（まだら）が出る。
  //   1本あたりの合計の重みを spanCells にそろえると、敷き詰めた密度が
  //   レイ間隔によらず一定になり、標本化の粗さが結果に出なくなる。
  // ★刻みは「1セルあたり1点」。ここが積算の総処理量をそのまま決める一番重い係数で、
  //   以前の 1セルあたり2点は、実測でちょうど2倍の時間を使っていた。
  //   1点で足りるのは、re・im・mag の3つすべてに同じ重みが掛かるからである。
  //   重みにムラが出ても mod = |Σa·e^{iφ}|² / (Σa)² の分母分子で相殺し、同位相の場所では
  //   厳密に 1 のまま動かない。実際に ±10° で交差する2つの束で両者を比べたところ、
  //   縞の位置・暗線が落ちる深さ(0.0003)は一致し、差は最大0.005・平均0.001だった
  //   （表示は 0.05 刻みの20段に丸めるので、絵としては1段も動かない）。
  const nSub = Math.max(1, Math.min(2 * IF_HALF_MAX + 1, Math.ceil(spanCells)));
  const wSub = (spanCells > 0 ? spanCells : 1) / nSub;
  const am = amp * wSub;                       // 1点ぶんの重み。線分のあいだ変わらない
  let maxOff = 0;
  for (let j = 0; j < nSub; j++) {
    const off = spanCells > 0 ? spanCells * ((j + 0.5) / nSub - 0.5) : 0;
    _ifOffX[j] = perpX * off; _ifOffY[j] = perpY * off;
    if (Math.abs(off) > maxOff) maxOff = Math.abs(off);
  }
  // ★位相は毎点 cos/sin を呼ばず、「1歩ぶんの回転」を複素数で掛けて進める。
  //   dPhi は線分のあいだ一定なので (cos,sin) の更新は複素数の積1回で済む。
  //   1歩あたりの相対誤差は 1e-16、上限 8000 歩でも位相のずれは 1e-12 rad で無視できる。
  const rc = Math.cos(dPhi), rs = Math.sin(dPhi);
  let cp = Math.cos(phi0), sp = Math.sin(phi0);
  const W = F.W, H = F.H;
  const stepX = cdx * dt, stepY = cdy * dt;
  let px = ax + cdx * (cl[0] + dt * 0.5), py = ay + cdy * (cl[0] + dt * 0.5);
  const bx0 = px, by0 = py;                    // 積む範囲を出すための始点（下で使う）
  for (let s = 0; s < steps; s++) {
    const c = cp * am, sn = sp * am;
    const rot = cp * rc - sp * rs; sp = cp * rs + sp * rc; cp = rot;
    for (let j = 0; j < nSub; j++) {
      // ★4隅へ按分して積む（バイリニア）。最寄りのセル1つに丸めると、レイがどのセルを
      //   踏むかが並び方の偶然で決まり、セルごとの本数がばらつく。2本のビームで本数が
      //   ずれると暗線が打ち消しきれず、本来まっ黒な谷にまだら（斑）が残る。
      const x = px + _ifOffX[j], y = py + _ifOffY[j];
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1) continue;
      const fx = x - ix, fy = y - iy, gx = 1 - fx, gy = 1 - fy;
      const p = iy * W + ix;
      const w00 = gx*gy, w10 = fx*gy, w01 = gx*fy, w11 = fx*fy;
      F.re[p]     += c*w00; F.im[p]     += sn*w00; F.mag[p]     += am*w00;
      F.re[p+1]   += c*w10; F.im[p+1]   += sn*w10; F.mag[p+1]   += am*w10;
      F.re[p+W]   += c*w01; F.im[p+W]   += sn*w01; F.mag[p+W]   += am*w01;
      F.re[p+W+1] += c*w11; F.im[p+W+1] += sn*w11; F.mag[p+W+1] += am*w11;
    }
    px += stepX; py += stepY;
  }
  // 積んだ範囲（クリア用）は、点ごとに min/max を取らず線分から一度に出す。
  //   内側のループでの4比較は、書き込みそのものと同じくらいの重さになっていた。
  //   多めに見積もっても、余分に消すセルが増えるだけで結果は変わらない。
  const eX = Math.abs(perpX) * maxOff, eY = Math.abs(perpY) * maxOff;
  const lx = px - stepX, ly = py - stepY;                    // 最後に積んだ点
  let mnX = Math.floor(Math.min(bx0, lx) - eX), mxX = Math.floor(Math.max(bx0, lx) + eX) + 1;
  let mnY = Math.floor(Math.min(by0, ly) - eY), mxY = Math.floor(Math.max(by0, ly) + eY) + 1;
  if (mnX < 0) mnX = 0;  if (mxX > W - 1) mxX = W - 1;
  if (mnY < 0) mnY = 0;  if (mxY > H - 1) mxY = H - 1;
  if (mnX > mxX || mnY > mxY) return;
  if (mnX < F.x0) F.x0 = mnX;  if (mxX > F.x1) F.x1 = mxX;
  if (mnY < F.y0) F.y0 = mnY;  if (mxY > F.y1) F.y1 = mxY;
}
// ════════════════════════════════════════
//  回折光（広がっていくレイ）を積む
//
//  ふつうのレイと何が違うか
//   レーザーの束は平行なので、1本が代表する波面の幅も強度も線分のあいだ変わらない。
//   スリットから出た波（円筒波）はそうではない：頂点から距離 r の位置で
//
//     くさびの幅   w(r) = dθ · r          （角度幅 dθ を受け持つので、幅は r に比例）
//     強度         i(r) = i_c · r_c / r    （w × i ＝ 一定。エネルギー保存そのもの）
//     振幅         a(r) = √i(r) ∝ 1/√r    （2次元の円筒波。球面波の 1/r ではない）
//
//   なので spanCells も振幅も、1本の線分の途中で変わる。ここが専用の関数を要る理由。
//
//  近接クランプ r_c
//   r→0 で強度が発散するので、どこかで頭打ちにする必要がある。物理が決めている境目は
//   フレネル距離 r_c = Δ²/λ（Δ＝開口の幅）で、ここより内側では波はまだ広がらず
//   開口の幅のまま進む。r_c を境に i を一定にすると、全角度の積分が
//
//     ∫ i(r,θ)·r dθ = i_c·r_c·∫sinc²(πΔsinθ/λ)dθ ≈ i_c·(Δ²/λ)·(λ/Δ) = i_c·Δ
//
//   となって、開口に入った電力とぴたり一致する。★正規化の係数を手で置いていない：
//   r_c をフレネル距離に取るだけでエネルギー保存が自動的に満たされる。
// ════════════════════════════════════════
// 広がったくさびを刻む副標本の数の上限。★平行なレイ用の IF_HALF_MAX(=3) では全く足りない。
//   遠方ではくさびが数十セル幅になるので、そこを7点で刻むと隙間が縞に化ける。
//   ここを大きくしても総処理量は増えない：積む点の総数は「照らした面積」で決まっていて、
//   くさびを広く取ればレイの本数のほうが減るので、積は変わらない（レイキャストの回数だけが減る）。

const DIF_MAX_SUB = 96;
function ifSplatDiffSeg(F, seg, k) {
  const D = seg.dif;
  // ★物体で止まった線分は、くさび半分ぶんだけ先まで積む。
  //   くさびはレイに垂直な板なので、斜めに当たったレイでは板の半分が面の向こう側へ
  //   はみ出す。伸ばさないと、面のすぐ手前だけがレイごとに虫食いになり、
  //   そこを読み取るスクリーンの分布に「くさびの幅の周期でほぼ0まで落ちる切れ込み」が
  //   並ぶ（実際にこれで、ヤングの明線が19px周期の櫛に割れていた）。
  //   はみ出した先は不透明な物体の内側なので、絵には一切出ない。
  let x2 = seg.x2, y2 = seg.y2;
  if (seg.end) {
    const L0 = len(seg.x2 - seg.x1, seg.y2 - seg.y1);
    if (L0 > 1e-9) {
      const rEnd = D.r0 + L0;
      const ex = 0.5 * D.dth * (rEnd > D.rc ? rEnd : D.rc) / L0;
      x2 += (seg.x2 - seg.x1) * ex; y2 += (seg.y2 - seg.y1) * ex;
    }
  }
  const a = worldToScreen(seg.x1, seg.y1), b = worldToScreen(x2, y2);
  const ax = a.x / IF_DOWNSCALE, ay = a.y / IF_DOWNSCALE;
  const bx = b.x / IF_DOWNSCALE, by = b.y / IF_DOWNSCALE;
  const cl = _ifClip(ax, ay, bx, by, F.W - 1, F.H - 1);
  if (!cl) return;
  if (!(seg.i > 1e-9)) return;
  const cdx = bx - ax, cdy = by - ay;
  const cellLen = Math.hypot(cdx, cdy) * (cl[1] - cl[0]);
  const steps = Math.max(1, Math.min(IF_MAX_STEPS, Math.ceil(cellLen / ifStepCells(k, seg.n))));
  const worldLen = len(x2 - seg.x1, y2 - seg.y1);      // ★伸ばした後の長さで媒介変数を張る
  const dt = (cl[1] - cl[0]) / steps;
  const dPhi = k * seg.n * worldLen * dt;
  const phi0 = k * (seg.opl + seg.n * worldLen * (cl[0] + dt * 0.5)) + seg.ph;
  const cl2 = Math.hypot(cdx, cdy) || 1;
  const perpX = -cdy / cl2, perpY = cdx / cl2;
  // 位相は平行なレイと同じく「1歩ぶんの回転」を掛けて進める（cos/sin は毎点呼ばない）
  const rc = Math.cos(dPhi), rs = Math.sin(dPhi);
  let cp = Math.cos(phi0), sp = Math.sin(phi0);
  const W = F.W, H = F.H;
  const stepX = cdx * dt, stepY = cdy * dt;
  let px = ax + cdx * (cl[0] + dt * 0.5), py = ay + cdy * (cl[0] + dt * 0.5);
  const bx0 = px, by0 = py;
  // 頂点からの距離 r [ワールドpx]。線分の始点で r0、そこから t·worldLen だけ増える
  const zc = cam.zoom / IF_DOWNSCALE;
  let r = D.r0 + worldLen * (cl[0] + dt * 0.5);
  const dr = worldLen * dt;
  const iRc = seg.i * D.rc;               // i(r) = iRc / max(r, rc)
  let maxOff = 0;
  for (let s = 0; s < steps; s++) {
    const rr = r > D.rc ? r : D.rc;
    const spanCells = D.dth * rr * zc;
    const nSub = Math.max(1, Math.min(DIF_MAX_SUB, Math.ceil(spanCells)));
    const wSub = spanCells / nSub;
    const am = Math.sqrt(iRc / rr) * wSub;      // 1点ぶんの重み（＝振幅 × 受け持つ幅）
    const c = cp * am, sn = sp * am;
    const rot = cp * rc - sp * rs; sp = cp * rs + sp * rc; cp = rot;
    const half = spanCells * 0.5;
    if (half > maxOff) maxOff = half;
    for (let j = 0; j < nSub; j++) {
      const off = spanCells * ((j + 0.5) / nSub) - half;
      const x = px + perpX * off, y = py + perpY * off;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1) continue;
      const fx = x - ix, fy = y - iy, gx = 1 - fx, gy = 1 - fy;
      const p = iy * W + ix;
      const w00 = gx*gy, w10 = fx*gy, w01 = gx*fy, w11 = fx*fy;
      F.re[p]     += c*w00; F.im[p]     += sn*w00; F.mag[p]     += am*w00;
      F.re[p+1]   += c*w10; F.im[p+1]   += sn*w10; F.mag[p+1]   += am*w10;
      F.re[p+W]   += c*w01; F.im[p+W]   += sn*w01; F.mag[p+W]   += am*w01;
      F.re[p+W+1] += c*w11; F.im[p+W+1] += sn*w11; F.mag[p+W+1] += am*w11;
    }
    px += stepX; py += stepY; r += dr;
  }
  const eX = Math.abs(perpX) * maxOff, eY = Math.abs(perpY) * maxOff;
  const lx = px - stepX, ly = py - stepY;
  let mnX = Math.floor(Math.min(bx0, lx) - eX), mxX = Math.floor(Math.max(bx0, lx) + eX) + 1;
  let mnY = Math.floor(Math.min(by0, ly) - eY), mxY = Math.floor(Math.max(by0, ly) + eY) + 1;
  if (mnX < 0) mnX = 0;  if (mxX > W - 1) mxX = W - 1;
  if (mnY < 0) mnY = 0;  if (mxY > H - 1) mxY = H - 1;
  if (mnX > mxX || mnY > mxY) return;
  if (mnX < F.x0) F.x0 = mnX;  if (mxX > F.x1) F.x1 = mxX;
  if (mnY < F.y0) F.y0 = mnY;  if (mxY > F.y1) F.y1 = mxY;
}
// 回折光の、頂点から距離 r における強度とくさびの幅 [ワールドpx]。描画側でも使う
function difIntensityAt(seg, r) {
  const D = seg.dif, rr = r > D.rc ? r : D.rc;
  return seg.i * D.rc / rr;
}
function difSpanAt(seg, r) {
  const D = seg.dif;
  return D.dth * (r > D.rc ? r : D.rc);
}
// 画面座標での変調係数。弱め合い 0 ／ 単独のビーム 1 ／ 強め合い 1
function ifModAt(F, sx, sy) {
  const ix = (sx / IF_DOWNSCALE) | 0, iy = (sy / IF_DOWNSCALE) | 0;
  if (ix < 0 || iy < 0 || ix >= F.W || iy >= F.H) return 1;
  const p = iy * F.W + ix;
  const m = F.mag[p];
  if (m <= 1e-9) return 1;
  return (F.re[p] * F.re[p] + F.im[p] * F.im[p]) / (m * m);
}
