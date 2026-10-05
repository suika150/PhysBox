// ─── 光線追跡の数値定数 ─────────────────────────
//   物理を変える値ではなく、打ち切りと見せ方の定数なので全体設定には出さない
//   （既定のまま使うのが正解の類で、UIに出しても迷わせるだけだった）。
const RAY_MIN_I    = 0.002;   // これ未満の強度の枝は追わない。主虹≈5%・副虹≈0.3% が見える値
const RAY_MAX_SEGS = 1500;    // 1回の追跡で描く線分の総数上限（分岐の暴走を防ぐ安全弁）
const RAY_GAMMA    = 2.2;     // 弱い枝の表示ガンマ。目の応答に近く、虹が見える明るさになる
// ─── ビーム束の数値上限 ──────────────────────────
//   1本のレーザーが出すレイの本数。トレースは本数に比例して重くなるので上限を置く。
//   ★干渉の分解能ではなく描画の分解能。開口での回折（＝波面を細かく刻む必要がある話）は
//     ここでは扱わないので、束は「幅を見た目どおり埋める」ぶんだけあれば足りる。
const LASER_MAX_RAYS      = 64;
// 'solid'（太い一本）のレイ間隔 [px]。干渉バッファへは「幅がこの値の波面の板」として
// 隙間なく敷き詰めるので、ここを細かくしても滑らかさは上がらない（密度は一定になる）。
// 効くのは縞の分解能のほうで、最も細かい縞＝定在波の λ_sim/2 ≒ 6.3px を3枚で刻める幅にする。
const LASER_SOLID_STEP_PX = 2.0;
// 旧シーン（本数を [本/m] の密度で保存していた頃）の読み替え。
//   密度 ρ は「間隔 1/ρ で並べる」意味だったので、幅に間隔何個ぶん入るかで本数に直す。
function _rayNumFromDensity(widthPx, dens) {
  const d = Math.max(0.1, dens);
  const n = Math.floor(widthPx * PX2M * d + 1e-9) + 1;   // 両端を含めた個数
  return Math.max(1, Math.min(LASER_MAX_RAYS, n));
}
class Laser {
  constructor(opts) {
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;   // ★IDを保存・復元する（範囲選択の対象になるため）
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.body = opts.body || null;   // 設置先の物体（null=背景）
    this.localX = opts.localX || 0;  // body有: ローカル座標 / null: ワールド座標
    this.localY = opts.localY || 0;
    this.angle  = opts.angle  || 0;  // body有: 相対角 / null: ワールド角
    // ★白色光：1本のレーザーがプリセット全色を同時に出す（虹の説明用）。
    //   波長ごとに分散するので、水滴やプリズムに当てると色が分かれる。
    this.whiteLight = opts.whiteLight !== undefined ? !!opts.whiteLight : false;
    // ★波長が第一の属性。色は指定できず、波長から一意に決まる（白色光では白）
    this.wavelength = opts.wavelength !== undefined ? opts.wavelength : laserWavelength;   // [nm]
    this.color = this.whiteLight ? '#ffffff' : wavelengthToHex(this.wavelength);
    // 取り付けた物体をレイキャストの無視対象から外すか。ONで水中→空気の屈折・全反射が出せる
    this.interactHost = opts.interactHost !== undefined ? !!opts.interactHost : laserInteractHost;
    // ★ビーム幅 [px]。0 なら従来どおり太さのない1本
    this.width = opts.width !== undefined ? Math.max(0, opts.width) : laserWidth;
    // ★出力形式。物理はどちらも「レイ束」で同じだが、表す対象が違う：
    //     'array' … 細いレーザーを並べたもの。隙間は本物（＝N個の細い光源＝多スリット相当）
    //     'solid' … 幅を持つ連続開口。レイは開口を刻んだ標本にすぎず、隙間は存在しない
    //   'solid' は 'array' を密にした極限そのものだが、見た目は収束しない（array は
    //   どこまで密にしても隙間が残るのが正しい）。だから描画の刻み幅だけが違う。
    this.beamMode = opts.beamMode === 'solid' ? 'solid' : 'array';
    // ★'array' の本数 [本]。密度［本/m］ではなく本数そのものを持つ。
    //   密度で持つと本数が「幅×密度の四捨五入」になり、幅を少し動かしただけで境目をまたいで
    //   本数が勝手に増減する（幅0.75m・2本/m の2本が、幅0.70m にしただけで1本になる）。
    //   本数を直に持てば、幅を変える操作は「スリット間隔 d = 幅/(本数−1) を変える」ことに
    //   なり、ヤングの実験の d をそのまま指定できる（本数は動かない）。
    this.rayNum = opts.rayNum !== undefined ? Math.max(1, Math.round(opts.rayNum))
                : opts.rayDensity !== undefined ? _rayNumFromDensity(this.width, opts.rayDensity)  // 旧シーン
                : laserRayNum;
    // ★位相を持たせて干渉させるか。OFF は強度の足し算（＝従来どおり、電球のような非可干渉光）
    this.coherent = opts.coherent !== undefined ? !!opts.coherent : laserCoherent;
    // ★干渉するのは「同じレーザーから出た光」だけ。独立な2台のレーザーは相対位相が揺らぐので
    //   実際に縞は立たない。1台を分けた2本を交差させたいときは、ハーフミラー（反射率50）と鏡で
    //   本当に分岐させる：traceLaser は枝ごとに opl と ph を引き継ぐので、同じレーザーの枝
    //   どうしは無条件で干渉する（＝実験室で組むのと同じ手順がそのまま通る）。
    //   ★以前あった「コヒーレンス群」（番号を揃えた別レーザーどうしを干渉させる）は廃止した。
    //     上のとおり分岐で足りるうえ、番号を手で揃える方式では「本当は1つの光源だ」という
    //     前提が画面から見えなくなる。旧シーンの cohGroup は読み捨てられる。
  }
  getOrigin() {
    const b = this.body;
    if (!b) return { x: this.localX, y: this.localY };
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    return { x: b.x + this.localX*c - this.localY*s, y: b.y + this.localX*s + this.localY*c };
  }
  getDir() {
    const a = this.angle + (this.body ? this.body.angle : 0);
    return { x: Math.cos(a), y: Math.sin(a) };
  }
  // このレーザーが出す波長の一覧。白色光は波長プリセットの全色、単色は1つだけ
  spectrum() { return this.whiteLight ? LASER_PRESETS.map(p => p.wl) : [this.wavelength]; }
  // 束の本数。'solid' は幅を埋めるのに要る本数（自動）、'array' は指定した本数そのもの
  rayCount() {
    if (!(this.width > 0)) return 1;
    if (this.beamMode === 'solid')
      return Math.max(2, Math.min(LASER_MAX_RAYS, Math.round(this.width / LASER_SOLID_STEP_PX) + 1));
    return Math.max(1, Math.min(LASER_MAX_RAYS, Math.round(this.rayNum)));
  }
  raySpacing() { const n = this.rayCount(); return n > 1 ? this.width / (n - 1) : 0; }
  // 束の各レイの発射点。★進行方向に垂直な線分上に等間隔で並べる。
  //   こうすると全レイの初期位相がそろい、束全体がひとつの平面波になる。
  //   （斜めに並べると勝手な波面の傾きが入り、干渉の結果が配置の副作用で変わってしまう）
  rayOrigins() {
    const o = this.getOrigin();
    const n = this.rayCount();
    if (n <= 1) return [o];
    const d = this.getDir();
    const px = -d.y, py = d.x;                 // ビームに垂直な向き
    const step = this.width / (n - 1);
    const out = [];
    for (let k = 0; k < n; k++) {
      const s = -this.width / 2 + k * step;
      out.push({ x: o.x + px * s, y: o.y + py * s });
    }
    return out;
  }
}
// ─── レイキャスト（最近接ヒットを返す） ───
function _rayCircle(ox, oy, dx, dy, b) {
  const cx = ox - b.x, cy = oy - b.y;
  const bq = cx*dx + cy*dy;
  const c  = cx*cx + cy*cy - b.radius*b.radius;
  const disc = bq*bq - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -bq - sq;
  if (t < 1e-6) t = -bq + sq;        // 原点が内側の場合は遠い方
  if (t < 1e-6) return null;
  const hx = ox + dx*t, hy = oy + dy*t;
  return { t, x: hx, y: hy, nx: (hx-b.x)/b.radius, ny: (hy-b.y)/b.radius };
}
// after
// 法線の向きは、辺の並び順（ループの符号付き面積）で決める。
//   ★以前は「重心から遠ざかる向き」を外向きとしていた。凸な形ではこれで合うが、
//     凹んだ形では壁の裏側を向く。実測：ヘアピン状のファイバー（U字＋前後のまっすぐな
//     部分）の、まっすぐな部分の内側の壁。重心はU字の内側の空洞にあるので、壁の外向きが
//     裏返り、traceLaser は法線の向きだけで「入る／出る」を決めているため、
//     ガラスの中から当たった光を「これから入る光」と読んで n1=n2=1.5 で素通りさせていた
//     （全反射すべき 76.8° の入射が、1本も曲がらずに壁を突き抜けた）。
//   ★面積の符号で向きを決めれば、形が凹んでいても、頂点の並び順が逆でも正しく出る。
//     穴のループは「囲んでいるのが空洞」なので、材料から見た外向きは逆になる。
function _loopOutwardSign(verts, isHole) {
  let A = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i], q = verts[(i+1)%verts.length];
    A += p.x*q.y - q.x*p.y;
  }
  return (A < 0 ? -1 : 1) * (isHole ? -1 : 1);
}
function _rayPolygon(ox, oy, dx, dy, b) {
  const loops = [b._worldVerts()];
  if (b.holes && b.holes.length) for (const h of b._worldHoles()) loops.push(h);
  let best = null;
  for (let li = 0; li < loops.length; li++) {
    const verts = loops[li];
    const sgn = _loopOutwardSign(verts, li > 0);
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], c = verts[(i+1)%verts.length];
      const ex = c.x-a.x, ey = c.y-a.y;
      const det = ex*dy - ey*dx;
      if (Math.abs(det) < 1e-9) continue;
      const t = (ex*(a.y-oy) - ey*(a.x-ox)) / det;
      const s = (dx*(a.y-oy) - dy*(a.x-ox)) / det;
      if (t > 1e-6 && s >= 0 && s <= 1 && (!best || t < best.t)) {
        let nx = sgn*ey, ny = -sgn*ex;
        const nl = len(nx, ny) || 1; nx /= nl; ny /= nl;
        best = { t, x: ox+dx*t, y: oy+dy*t, nx, ny, loop: li, edge: i };   // ★どの辺に当たったかを記録
      }
    }
  }
  // ★曲面は「多角形の面」ではなく元の真円の法線で解く。出どころが2つある：
  //     opticArcs … レンズ・鏡の曲面（js/optics/lens.js が設計値から作る）
  //     arcs      … 図形和が「元は円だった区間」として覚えている区間（js/physics/arc.js）
  //   どちらも持たない物体は従来どおり多角形の面のまま。
  if (best) {
    if (b.opticArcs && best.loop === 0) _applyOpticNormal(b, best);
    else if (b.arcs)                    _applyArcNormal(b, best);
  }
  return best;
}
// 当たり点をローカル座標へ移し、円 (cx,cy) の法線をワールドへ書き戻す。
//   out = +1 … 材料は円の内側（出っ張り）／ −1 … 材料は円の外側（穴の内壁・お椀）
//   ★符号は効く。traceLaser は法線の向きだけで「入る／出る」を判定し、そこから n1・n2 を
//     決めているので、裏返すと屈折率が入れ替わって静かに逆の物理になる。
function _setCircleNormal(b, hit, cx, cy, out) {
  const cs = Math.cos(-b.angle), sn = Math.sin(-b.angle);
  const px = hit.x - b.x, py = hit.y - b.y;
  const lx = px*cs - py*sn, ly = px*sn + py*cs;         // 当たり点をローカル座標へ
  let nx = out * (lx - cx), ny = out * (ly - cy);
  const nl = len(nx, ny);
  if (nl < 1e-9) return false;
  nx /= nl; ny /= nl;
  const c2 = Math.cos(b.angle), s2 = Math.sin(b.angle);
  hit.nx = nx*c2 - ny*s2;                               // ワールドへ戻す
  hit.ny = nx*s2 + ny*c2;
  return true;
}
function _applyOpticNormal(b, hit) {
  for (const A of b.opticArcs) {
    if (hit.edge < A.e0 || hit.edge > A.e1) continue;   // 平面部（縁・裏面）は弦の法線のまま
    if (_setCircleNormal(b, hit, A.cx, A.cy, A.out)) return;
  }
}
// ─── 図形和が作った形の曲面 ─────────────────────────────────────────
//  ★ブーリアン演算は円を48角形に近似してから解くので、結果には多角形しか残らない
//    （js/app/clipper.js）。接触は js/physics/arc.js が、描画は js/render/body.js が、
//    どちらも b.arcs を見て真円として扱っているのに、レイキャストだけが 48角形のまま
//    だった。同じ物体が「見た目は円・ぶつかり方も円・光に対してだけ48角形」になる。
//  ★実測（太さ60px・曲率半径400pxの円弧に、軸から20°で光を入れて全反射させる。
//    真円の導波路では r·cosφ が保存する。φ＝局所の軸に対する角度）：
//      多角形の面のまま  r·cosφ = 389.5 → 367.8 → 360.4 → 337.6（−13%）
//                        外壁への入射角が跳ね回り（31°→5°→13°→38°）内壁にも当たり出す
//      真円の法線        r·cosφ = 389.5 → 389.5 → 389.5 → 389.5（保存）
//                        外壁だけに 25.0°/24.9°/24.8° で当たる（理論 arccos(389.4/430)=25.1°）
//    48角形のままだと「曲げると漏れる」が曲率ではなく面のギザギザで起きてしまう。
//  ★円弧を辺番号で選ばないこと。図形和が作る円弧は頂点列の端をまたぐ（i0 > i1、実測：
//    U字の外壁が i0=37・i1=11）ので、e0..e1 の範囲比較だと丸ごと拾えなくなる。
//    当たり点そのものを「その円周上にあるか・円弧の角度範囲に入っているか」で判定する。
function _applyArcNormal(b, hit) {
  // ★ループ番号の規約が2つある：_rayPolygon は 0=外周・1..=穴、detectArcs は -1=外周・0..=穴
  const li = hit.loop - 1;
  const cs = Math.cos(-b.angle), sn = Math.sin(-b.angle);
  const px = hit.x - b.x, py = hit.y - b.y;
  const lx = px*cs - py*sn, ly = px*sn + py*cs;
  for (const A of b.arcs) {
    if (A.loop !== li) continue;
    // 弦は真円より最大 bulge だけ内側を通る。その帯の中にいなければ平らな面。
    if (Math.abs(len(lx - A.cx, ly - A.cy) - A.r) > A.bulge + ARC_ON_TOL) continue;
    if (!arcCovers(A, lx, ly)) continue;
    if (_setCircleNormal(b, hit, A.cx, A.cy, A.concave ? -1 : 1)) return;
  }
}
function _rayGround(ox, oy, dx, dy) {
  const sa = Math.sin(ground.angle), ca = Math.cos(ground.angle);
  const sd0 = sa*ox + ca*(ground.y - oy);
  const rate = sa*dx - ca*dy;
  if (Math.abs(rate) < 1e-9) return null;
  const t = -sd0 / rate;
  if (t <= 1e-6) return null;
  return { t, x: ox+dx*t, y: oy+dy*t, nx: sa, ny: -ca };
}
// 地面からの符号付き距離 [px]。正＝地面より上（光が通る側）
function _groundSD(x, y) {
  return Math.sin(ground.angle)*x + Math.cos(ground.angle)*(ground.y - y);
}
const _groundLit = () => world.terrain && ground.layers !== 0;   // 地面が光を遮るか
// skipGround … 透明な物体の内部を進んでいる間は地面を見ない（後述の理由で必須）
function raycastAll(ox, oy, dx, dy, ignoreBody, skipGround) {
  let best = { t: Infinity };
  for (const b of objects) {
    if (b === ignoreBody || _ghostBody(b)) continue;   // ★ゴーストはレーザーも透過（旧センサー相当）
    const h = b.type === 'circle' ? _rayCircle(ox,oy,dx,dy,b) : _rayPolygon(ox,oy,dx,dy,b);
    if (h && h.t < best.t) { best = h; best.body = b; best.kind = 'body'; }
  }
  if (!skipGround && _groundLit()) {
    const g = _rayGround(ox, oy, dx, dy);
    if (g && g.t < best.t) { best = g; best.body = null; best.kind = 'ground'; }
  }
  return best.t === Infinity ? null : best;
}
// ─── 理想レンズ／理想鏡 ─────────────────────────────────────────
// 球面をスネルの法則で解く代わりに、薄肉レンズの光線変換だけを1回かける。
// 球面収差も色収差も出ない＝教科書どおりの結像になる。
//   高さ h は変えず、傾きだけを変える：   uy ← uy − (h/f)·|ux|   （ux はそのまま）
//   ★|ux| を使うのが要点。これで左右どちらから入っても符号が正しくなる。
//   この1本から作図の3本すべてが出る：
//     ・光軸に平行 (uy=0) → 焦点を通る ／ ・中心 (h=0) → 曲がらない
//     ・前側焦点を通る → 平行に出る
//   さらに 1/a + 1/b = 1/f が全光線で厳密に成り立つので、1点から出た光は1点に集まる。
// ★鏡は「ux を反転してから同じ式」。これだけで凹面鏡・凸面鏡が同じ実装で片付く。
function _idealBend(b, hx, hy, dx, dy) {
  const cs = Math.cos(b.angle), sn = Math.sin(b.angle);
  const ux =  dx*cs + dy*sn, uy = -dx*sn + dy*cs;          // ワールド → 素子ローカル
  const h  = -(hx - b.x)*sn + (hy - b.y)*cs;               // 光軸からの高さ
  const f  = idealFocalSigned(b, ux);
  if (!f) return null;
  let nx = b.reflective ? -ux : ux, ny = uy;               // 鏡：まず反射させてから度を付ける
  ny -= (h / f) * Math.abs(nx);
  const nl = len(nx, ny) || 1;
  nx /= nl; ny /= nl;
  return { dx: nx*cs - ny*sn, dy: nx*sn + ny*cs, h, f };   // ワールドへ戻す
}
// 主平面（素子の中心を通る、光軸に垂直な面）とレイの交点。理想素子はここで1回だけ曲げる。
//   理想化した素子は薄板なので、この面はほぼ素子の表面そのものになる。
function _idealPlaneCross(b, ox, oy, dx, dy) {
  const cs = Math.cos(b.angle), sn = Math.sin(b.angle);
  const ux = dx*cs + dy*sn;
  if (Math.abs(ux) < 1e-9) return null;                    // 面に沿って走る光は扱えない
  const t = -((ox - b.x)*cs + (oy - b.y)*sn) / ux;
  if (t <= 1e-6) return null;
  return { x: ox + dx*t, y: oy + dy*t };
}
function _refract(dx, dy, nx, ny, eta) {   // N は入射に対向する法線
  const cosi = -(dx*nx + dy*ny);
  const sin2t = eta*eta*(1 - cosi*cosi);
  if (sin2t > 1) return null;              // 全反射
  const cost = Math.sqrt(1 - sin2t);
  return { x: eta*dx + (eta*cosi - cost)*nx, y: eta*dy + (eta*cosi - cost)*ny };
}
function _reflect(dx, dy, nx, ny) {
  const d = dx*nx + dy*ny;
  return { x: dx - 2*d*nx, y: dy - 2*d*ny };
}
// ─── フレネルの式（無偏光＝s偏光とp偏光の反射率の平均）───
//   cosi は入射角の余弦（0..1）。n1=入射側・n2=透過側の屈折率。全反射なら 1。
//   水（n=1.333）の主虹では 入射59.6°→R≈5.8% / 背面の内部反射40.4°→R≈5.8% となり、
//   主虹の明るさ ≈0.94×0.058×0.94 ≈5%、副虹 ≈0.3% が自動的に再現される。
// ★反射率だけでなく「位相のずれ」も返す。干渉を出すには符号が要る：
//   薄膜・くさび・ニュートンリングでは、表面反射（疎→密）だけが π ずれることが
//   明暗の並びを決めている。強度 R だけを見ていると符号が消え、膜厚→0 で反射が
//   暗くなるという事実が再現できず、明暗が丸ごと逆に出てしまう。
//   偏光は扱わないので、大きさは無偏光（s・p の平均）、位相は s 偏光の符号を採る。
//   （垂直入射のまわりでは s と p の位相は一致するので、教材の範囲で差は出ない）
function _fresnelRP(cosi, n1, n2) {
  const eta = n1 / n2;
  const sin2t = eta * eta * (1 - cosi * cosi);
  if (sin2t >= 1) {
    // 全反射：大きさは 1 のままで、位相だけが連続的にずれる（s偏光）
    //   δ = −2·atan( √(n1²sin²θ − n2²) / (n1 cosθ) )
    const s = Math.sqrt(Math.max(0, n1*n1*(1 - cosi*cosi) - n2*n2));
    return { R: 1, ph: -2 * Math.atan2(s, n1 * cosi) };
  }
  const cost = Math.sqrt(1 - sin2t);
  const rs = (n1*cosi - n2*cost) / (n1*cosi + n2*cost);       // s偏光
  const rp = (n2*cosi - n1*cost) / (n2*cosi + n1*cost);       // p偏光
  return { R: Math.min(1, (rs*rs + rp*rp) / 2), ph: rs < 0 ? Math.PI : 0 };
}
// ─── 媒質スタック（今どの物体の内側にいるか。入れ子＝水槽の中の水滴にも対応）───
function _mediumIor(media, wl) {
  const b = media.length ? media[media.length - 1] : null;
  return b ? Math.max(1, iorAt(b, wl)) : 1;                  // 空なら真空（＝空気 n=1）
}
function _mediaExit(media, b) {                              // b から出る＝最後の1つを取り除く
  const i = media.lastIndexOf(b);
  if (i < 0) return media;                                   // 記録漏れ（内側から発射等）はそのまま
  const m = media.slice(); m.splice(i, 1); return m;
}
function _mediaAt(x, y, ignoreBody) {                        // 発射点が透明物体の内側ならそこから始める
  const m = [];
  for (const b of objects) {
    // 無視する物体は光学的に存在しない。★理想レンズも媒質ではない（厚みゼロの薄肉レンズ
    //   として扱うので、中から光を出しても「ガラスの中から」にはならない）
    if (b === ignoreBody || _ghostBody(b) || !(b.ior > 1) || isIdealOptic(b)) continue;
    if (b.containsPoint(x, y)) m.push(b);
  }
  return m;
}
// 発射点・方向からビーム経路を計算。すべての界面で「一部反射・一部屈折」に分岐する。
//   ・鏡     … R = 反射率、残り 1−R はそのまま直進（ハーフミラー）
//   ・透明   … R はフレネルの式（または手動の反射率）、残り 1−R は屈折して進む
//              ＝水滴の中で「屈折→背面で内部反射→屈折して出る」が自然に起きる（虹）
//   ・不透明 … R が反射し、残りは吸収
// 各線分は強度 i（0..1）を持ち、描画時に明るさへ反映される。
// ★干渉のために、各線分は位相を組み立てる材料も持つ：
//     opl … 線分の始点までの光路長 Σn·L [px]   n … その線分を進む媒質の屈折率
//     ph  … 始点までに反射で受け取った位相のずれ [rad]
//   線分の始点から距離 s の点の位相は  φ = k·(opl + n·s) + ph   （k = 2π/λ_sim）。
//   光路長は「屈折率×距離」なので、分散のある物体では波長ごとに違う値になる（自動で入る）。
// opt（省略可）
//   span … このレイが代表する波面の幅 [px]。回折格子で「開口のどれだけを照らしたか」に使う
//   hits … 回折格子に届いた光を書き出す配列。★渡さないと格子はただの不透明な板になる
//          （＝一度回折した光は二度目の格子で回折しない。組み合わせが指数的に増えるため）
//   i0 / ph0 … 追跡を始めるときの強度と位相。スリットから出し直す波面で使う
//   dif … このレイが「広がっていくくさび」であることの印 {dth, rc}。線分ごとに r0 を入れて渡す
function traceLaser(ox, oy, dx, dy, ignoreBody, wl, opt) {
  const segs = [];
  const EPS = 0.02, FAR = 1e5;
  const MIN_I = RAY_MIN_I, MAX_SEGS = RAY_MAX_SEGS;
  const MAX_DEPTH = 40;      // 1本の枝の最大反射/屈折回数
  const O = opt || {};
  const hits = O.hits || null;
  const dif = O.dif || null;
  const spanIn = O.span || 0;
  // 回折光の実効強度。i は「開口での強度」なので、広がったぶんを割り引いてから枝を判定する。
  //   これを忘れると、遠方で見えなくなっている光の分岐を延々と追うことになる。
  const iEffOf = (i, r) => dif ? i * dif.rc / Math.max(r, dif.rc) : i;
  const mkDif = r => dif ? { r0: r, dth: dif.dth, rc: dif.rc } : undefined;
  const stack = [{ ox, oy, dx, dy, ignore: ignoreBody, i: O.i0 !== undefined ? O.i0 : 1, depth: 0,
                   media: _mediaAt(ox, oy, ignoreBody), opl: 0, ph: O.ph0 || 0, r: 0 }];
  while (stack.length && segs.length < MAX_SEGS) {
    let { ox, oy, dx, dy, ignore, i, depth, media, opl, ph, r } = stack.pop();
    while (depth < MAX_DEPTH && segs.length < MAX_SEGS) {
      const nMed = _mediumIor(media, wl);               // この線分を進む媒質の屈折率
      // ★透明な物体の内部にいる間は地面を無視する。
      //   接触した物体は位置補正のスロップぶん（最大0.5px＝5mm）地面へめり込むので、
      //   そのままだと「地面に置いた膜」の中を下へ進む光が、膜の下面へ届く前に
      //   地面の線を横切って吸収されてしまう。膜自身の下面での反射（＝薄膜干渉の相手）が
      //   丸ごと消えるのが、地面に置くと干渉が出なくなる正体だった。
      //   めり込みはソルバーの都合で生じる見えない量なので、光学には出さない。
      const inMedium = media.length > 0;
      // 上の無視の後始末：物体から出たのに地面より下にいる光は、そこで吸収する。
      //   放っておくと地面の塗り（レーザーより先に描く）を突き抜けるビームが残る。
      //   地面より下は「不透明な半空間の内側」なので、吸収が正しい扱いでもある。
      if (!inMedium && _groundLit() && _groundSD(ox, oy) < 0) break;
      const hit = raycastAll(ox, oy, dx, dy, ignore, inMedium);
      if (!hit) { segs.push({ x1: ox, y1: oy, x2: ox+dx*FAR, y2: oy+dy*FAR, i, opl, n: nMed, ph, dif: mkDif(r) }); break; }
      // ─── 理想レンズ／理想鏡 ───────────────────────────
      //   面ごとの屈折・反射には落とさず、主平面で1回だけ曲げて素子を抜ける。
      //   理想素子は損失なし（レンズは100%透過・鏡は100%反射）なので分岐もしない。
      if (isIdealOptic(hit.body)) {
        const ib = hit.body;
        const p  = _idealPlaneCross(ib, ox, oy, dx, dy);
        const nd = p && _idealBend(ib, p.x, p.y, dx, dy);
        if (nd) {
          const legLen = len(p.x - ox, p.y - oy);
          segs.push({ x1: ox, y1: oy, x2: p.x, y2: p.y, i, opl, n: nMed, ph, dif: mkDif(r), end: ib });
          r += legLen;
          // 幾何光路 ＋ 薄肉レンズの位相遅れ −h²/2f。
          //   ★これが無いと、焦点に集まった光線の位相がそろわず干渉が壊れる。実レンズは
          //     中心ほど厚い（鏡は中心ほど奥）ぶん遅れることで位相をそろえているので、
          //     厚みを捨てた代わりにその遅れをここで入れ直す。レンズ・鏡で同じ式になる。
          //   中心厚ぶんの定数は全光線に共通なので落としてよい（＝厚みゼロの薄肉レンズ）。
          //   ★教科書どおりの近軸の式なので、焦点での光路長にも近軸の残差 h⁴/8f³ が残る
          //     （どの共役でも合う位相関数は存在しない。ここは全共役で誤差が均等になる側を採る）。
          //     f/2 なら 0.008λ、開口半径が f の 2/3 に達してようやく 0.3λ 程度。
          opl += nMed * legLen - nd.h * nd.h / (2 * nd.f);
          depth++;
          dx = nd.dx; dy = nd.dy;
          // 曲げた点は板の内側なので、そのまま進むと裏面でもう一度つかまる。
          //   ★ignore に入れて済ませない：鏡で折り返してきた光が同じレンズを
          //     二度目に通れなくなる（レンズ→鏡→レンズの光路が作れない）。
          const ex = _rayPolygon(p.x + dx*EPS, p.y + dy*EPS, dx, dy, ib);
          if (ex) {
            const inLen = len(ex.x - p.x, ex.y - p.y);
            segs.push({ x1: p.x, y1: p.y, x2: ex.x, y2: ex.y, i, opl, n: nMed, ph, dif: mkDif(r), end: ib });
            r += inLen; opl += nMed * inLen;
            ox = ex.x + dx*EPS; oy = ex.y + dy*EPS;
          } else {
            // 出口が見つからない（数値的な取りこぼし）。同じ素子で曲げ続けないよう置いていく
            ox = p.x + dx*EPS; oy = p.y + dy*EPS; ignore = ib;
          }
          continue;
        }
        // 主平面と交わらない（面に沿って走る）光は、下の通常処理へ落として吸収させる
      }
      // end … この線分が終わった相手の物体。スクリーンが「当たった光」を拾うのに使う
      segs.push({ x1: ox, y1: oy, x2: hit.x, y2: hit.y, i, opl, n: nMed, ph, dif: mkDif(r), end: hit.body || null });
      const legLen = len(hit.x - ox, hit.y - oy);
      opl += nMed * legLen;                             // 界面までの光路長を積む
      r += legLen;                                      // 扇の頂点からの距離（回折光でのみ意味を持つ）
      depth++;
      if (hit.kind === 'ground') break;                 // 地面で吸収
      const b = hit.body;
      if (!b) break;
      // ─── 回折格子 ───────────────────────────────
      //   スリットに当たったら、そこで枝を止めて「当たり」だけを記録する。
      //   ★ここで扇を出さないのが肝心。1つのスリットを何本ものレイが照らすので、
      //     レイごとに扇を出すと同じ扇が何重にも重なり、絵は変わらないのに計算量だけが
      //     レイ本数ぶん増える。開口の上でいったん足し合わせてから1つ出す（_difWavelets）。
      if (b.opticKind === 'grating' && b.slitN > 0) {
        const cs = Math.cos(-b.angle), sn = Math.sin(-b.angle);
        const px = hit.x - b.x, py = hit.y - b.y;
        const ly = px*sn + py*cs;                       // 板の長手方向（局所y）での当たり位置
        const N = b.slitN, dS = b.slitD;
        const j = Math.round(ly / dS + (N - 1) / 2);
        const inSlit = j >= 0 && j <= N - 1 && Math.abs(ly - (j - (N-1)/2) * dS) <= b.slitA / 2;
        if (inSlit) {
          if (!hits) break;                             // 2度目の格子：ここでは回折させないので吸収
          // 板の上での足跡の長さ。斜めから当たるほど、同じ幅のビームが長く広がる（÷cosχ）
          const nrm = Math.abs(dx*hit.nx + dy*hit.ny);
          hits.push({ body: b, slit: j, ly, i, phi: simWaveK(wl) * opl + ph, dx, dy,
                      spanPlate: spanIn > 0 ? spanIn / Math.max(0.05, nrm) : 0,
                      tx: -Math.sin(b.angle), ty: Math.cos(b.angle) });
          break;
        }
        // 遮光部はこのまま下の通常処理へ落とす（反射率を上げれば、そのぶん反射もする）
      }
      let Nx = hit.nx, Ny = hit.ny;                     // 入射に対向させた法線
      const entering = (dx*hit.nx + dy*hit.ny) < 0;     // 外向き法線に逆らう＝内側へ入る向き
      if (!entering) { Nx = -Nx; Ny = -Ny; }
      const cosi = Math.max(0, Math.min(1, -(dx*Nx + dy*Ny)));
      const nb = iorAt(b, wl);                          // この波長での屈折率（分散）
      const transparent = !b.reflective && nb > 1;
      // 透過側の進行方向。透明なら屈折（全反射なら null）、鏡なら直進
      let n1 = 1, n2 = 1, thru = null, thruMedia = media, thruIgnore = ignore;
      if (transparent) {
        n1 = entering ? _mediumIor(media, wl) : Math.max(1, nb);            // 今いる媒質
        n2 = entering ? Math.max(1, nb) : _mediumIor(_mediaExit(media, b), wl);  // 向こう側の媒質
        thru = _refract(dx, dy, Nx, Ny, n1 / n2);
        thruMedia = entering ? media.concat(b) : _mediaExit(media, b);
      } else if (b.reflective) {
        thru = { x: dx, y: dy };                        // 鏡の透過光は曲がらない
        thruIgnore = b;                                 // 裏面での再ヒットを避ける
      }
      // 反射率：透明かつ自動ならフレネル（全反射は R=1）、それ以外は物体の反射率
      //   rPh は反射で受け取る位相のずれ。透過側は（吸収のない範囲では）ずれない。
      let R, rPh = 0;
      if (transparent) {
        if (!thru) { const f = _fresnelRP(cosi, n1, n2); R = 1; rPh = f.ph; }      // 全反射
        else if (b.fresnel) { const f = _fresnelRP(cosi, n1, n2); R = f.R; rPh = f.ph; }
        else { R = clamp01(b.reflectance); rPh = entering ? Math.PI : 0; }
      } else {
        R = clamp01(b.reflectance);
        // 鏡・不透明面：表から当てたときだけ π ずれる。ハーフミラーの表と裏で π 違うのは
        // ストークスの関係そのもので、これがないとマイケルソン干渉計の明暗が合わない。
        rPh = entering ? Math.PI : 0;
      }
      // ★反射防止コート：この面が覆われていれば反射率を 0 にする（js/optics/arcoat.js）。
      //   実物のレンズや窓に蒸着してある無反射コーティングそのもの。
      //   ★全反射だけは例外にする（transparent なのに thru が無い＝臨界角を超えた枝）。
      //     臨界角の話なので膜では消せず、ここを一緒に潰すと光ファイバーのように全反射で
      //     導く題材が静かに壊れる。
      //   ★鏡にも不透明面にも同じ規則で効く（その面が反射しなくなる）。ハーフミラーの
      //     裏面を殺すのに要る。
      if (!(transparent && !thru) && b.arCoats && b.arCoats.length && arCoatCoversHit(b, hit))
        { R = 0; rPh = 0; }
      const T = thru ? 1 - R : 0;                       // 不透明物体では残りは吸収（分岐しない）
      // 透過（屈折）光：別の枝としてスタックへ
      if (T > 0 && iEffOf(i*T, r) >= MIN_I && segs.length < MAX_SEGS) {
        const tl = len(thru.x, thru.y) || 1;
        const tx = thru.x/tl, ty = thru.y/tl;
        stack.push({ ox: hit.x + tx*EPS, oy: hit.y + ty*EPS, dx: tx, dy: ty,
                     ignore: thruIgnore, i: i*T, depth, media: thruMedia, opl, ph, r });
      }
      // 反射光：この枝を継続（媒質は変わらない）
      if (R <= 0 || iEffOf(i*R, r) < MIN_I) break;
      const out = _reflect(dx, dy, Nx, Ny);
      const ol = len(out.x, out.y) || 1;
      dx = out.x/ol; dy = out.y/ol;
      ox = hit.x + dx*EPS; oy = hit.y + dy*EPS;         // 同一面の再ヒット回避
      i *= R;
      ph += rPh;
    }
  }
  return segs;
}
function laserGlowColor(color, alpha = 0.22) {
  if (typeof color === 'string' && color[0] === '#') return hexToRgba(color, alpha);
  const m = /rgba?\(([^)]+)\)/.exec(color || '');
  if (m) { const p = m[1].split(',').map(s => parseFloat(s)); return `rgba(${p[0]||255},${p[1]||60},${p[2]||60},${alpha})`; }
  return `rgba(255,60,60,${alpha})`;
}
// ════════════════════════════════════════
//  回折：開口から波面を出し直す（ホイヘンス–フレネル）
//
//  考え方
//   幾何光学のレイは曲がらないので、スリットを幾何的な穴として作っても光は
//   まっすぐ抜けるだけで、平行な光どうしは永久に重ならない＝縞は出ない。
//   そこで開口に届いた波を「そこから四方へ出る新しい波」として作り直す。
//
//     U(r,χ) = U₀ · Δ · sinc(πΔ(sinχ−sinχ_in)/λ) · (cosχ_in+cosχ)/2 · e^{ikr}/√r · e^{−iπ/4}
//                       ↑単一スリット因子              ↑傾斜因子       ↑2次元の円筒波
//
//  ★多スリット因子 sin(Nδ/2)/sin(δ/2) は書かない。
//   N 本のスリットから出た波は「同じレーザーの枝」なので、interference.js が
//   無条件に複素数で足し合わせる。格子の式はその和から勝手に立ち上がる。
//   同じ理由で、次の3つも一切の追加コードなしで正しく出る：
//     ・斜入射   d(sinχ−sinχ_in)=mλ  … 入射側の光路差が opl に入っているため
//     ・白色光の分光                  … 波長ごとに別の群として積まれるため
//     ・欠落次数（d/a が整数のとき）   … sinc の零点が次数と重なるため
//
//  エネルギー保存
//   近接クランプ r_c をフレネル距離 Δ²/λ に取ると、全角度の積分が開口に入った電力と
//   一致する（interference.js の頭の説明を参照）。正規化の係数は置いていない。
// ════════════════════════════════════════
const DIF_CHI_MAX  = 85 * Math.PI / 180;   // 扇の角度範囲（面の法線から測る）。±90°は面に平行＝無意味
const DIF_FAN_RAYS = 96;                   // 1つの副開口が出す扇のレイ本数
// ★本数の決め方：遠方でのくさびの幅が DIF_MAX_SUB(=96) セルに収まる必要がある。
//   画面の対角を 2000px とすると dθ ≤ 96/2000 = 0.048 rad なので、範囲 2.97 rad を
//   割って 62 本以上。96 本にして余裕を持たせてある（本数を増やしても積算の総量は
//   変わらない＝くさびが細くなるぶん1本あたりが軽くなるので、描画の滑らかさだけが上がる）。
const DIF_MAX_WAVELETS = 40;               // 1つの光源が出す波面の総数の上限（暴走防止）
const DIF_MIN_I = 1e-5;                    // これ未満の開口強度の波面は出さない
// スリットを刻む副開口の数。
//   ★a が λ より狭ければ1つでよい：単一スリット因子は sinc として解析的に入っているので、
//     刻まなくても正しい。a が λ より広いときだけ刻み、包絡線を和から出させる
//     （そのほうが近接場まで正しくなる）。刻むほど重くなるので上限を置く。
//   ★物体側で明示された分割数（slitM > 0）があればそれに従う。
//     ホイヘンスの原理そのものを見せたいとき——「スリットを M 個の点波源に分けると
//     単一スリットの回折が立ち上がる」——のための手動指定で、大きくしても
//     遠方の模様は変わらない（変わったらそれは計算が粗すぎたということ）。
const DIF_MAX_SUB_SLITS = 16;
const difSubCount = (b, lam) =>
  b.slitM > 0 ? Math.min(DIF_MAX_SUB_SLITS, Math.round(b.slitM))
              : Math.max(1, Math.min(4, Math.round(b.slitA / lam)));
const _sinc = x => Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
// 格子への当たりを (格子, スリット, 副開口) ごとにまとめ、出すべき波面の一覧を作る
function _difWavelets(hits, wl) {
  if (!hits.length) return [];
  const lam = simLambdaPx(wl), k = simWaveK(wl);
  const acc = new Map();
  for (const h of hits) {
    const b = h.body;
    const N = b.slitN, aW = b.slitA;
    const yc = (h.slit - (N - 1) / 2) * b.slitD;        // このスリットの中心（局所y）
    const M = difSubCount(b, lam);
    const dw = aW / M;                                  // 副開口の幅 Δ
    // 足跡が 0（＝太さのない1本のレイ）なら、そのレイがスリット全体を照らしているとみなす。
    //   ★これが教室でいちばん多い使い方（細いレーザーを格子に当てる）で、
    //     このとき Δ=a となり単一スリット因子がそのまま効く＝教科書どおりの式になる。
    const half = (h.spanPlate > 0 ? h.spanPlate : aW) / 2;
    const lo = h.ly - half, hi = h.ly + half;
    const amp = Math.sqrt(Math.max(0, h.i));
    const sChiIn = h.dx * h.tx + h.dy * h.ty;           // sinχ_in（面に沿う成分）
    for (let q = 0; q < M; q++) {
      const c0 = yc - aW / 2 + dw * q, c1 = c0 + dw;
      const L = Math.min(hi, c1) - Math.max(lo, c0);    // 副開口と足跡の重なりの長さ
      if (L <= 1e-9) continue;
      const key = b.id + '|' + h.slit + '|' + q;
      let e = acc.get(key);
      if (!e) acc.set(key, e = { body: b, yc: (c0 + c1) / 2, dw, re: 0, im: 0, w: 0, dx: 0, dy: 0 });
      // ★入射の傾きぶんの位相を、副開口の中心を基準にして取り除いてから足す。
      //   そうしないと、下で掛ける sinc(πΔ(sinχ−sinχ_in)/λ) と二重に効いてしまう
      //   （和のほうが既に sinχ_in ぶんの単一スリット因子を含んでいるため）。
      const ph = h.phi - k * (h.ly - e.yc) * sChiIn;
      e.re += amp * Math.cos(ph) * L;
      e.im += amp * Math.sin(ph) * L;
      e.w  += L;
      e.dx += h.dx * L; e.dy += h.dy * L;
    }
  }
  const out = [];
  for (const e of acc.values()) {
    if (e.w <= 1e-9) continue;
    // 標本化で埋まらなかったぶんを補う（覆えた範囲と同じ光が開口全体に来ているとみなす）。
    //   入射ビームのレイ間隔が副開口より粗いときに効く保険で、等しく照らされていれば 1 になる。
    const S = Math.hypot(e.re, e.im) * (e.dw / e.w);    // 開口積分 ∫U ds
    const iEq = (S / e.dw) * (S / e.dw);                // 開口での平均強度
    if (!(iEq > DIF_MIN_I)) continue;
    const dl = Math.hypot(e.dx, e.dy) || 1;
    out.push({ body: e.body, yc: e.yc, dw: e.dw, i: iEq,
               ph: Math.atan2(e.im, e.re), dx: e.dx / dl, dy: e.dy / dl });
  }
  // 明るい波面から先に使う（上限で切るときに、暗いものから捨てられるように）
  out.sort((p, q) => q.i - p.i);
  return out.length > DIF_MAX_WAVELETS ? out.slice(0, DIF_MAX_WAVELETS) : out;
}
// 1つの波面から出る扇（レイの初期条件の配列）を作る
function _difEmit(w, wl) {
  const b = w.body, lam = simLambdaPx(wl), k = simWaveK(wl);
  const ux = Math.cos(b.angle), uy = Math.sin(b.angle);   // 局所x＝面の法線
  const tx = -uy, ty = ux;                                // 局所y＝面に沿う向き
  const sgn = (w.dx*ux + w.dy*uy) >= 0 ? 1 : -1;          // 光が出ていく側
  const nx = ux*sgn, ny = uy*sgn;
  const T = opticPlateT('grating', b.opticH);
  // 波面の出どころは「副開口の中心を、板の出射面へ移したところ」。
  //   ★板の厚みぶんの光路 T/cosχ_in も足す。全スリットに等しく効くので縞の位置は動かないが、
  //     回折していない光と干渉させる配置（マイケルソン等）では効いてくるので入れておく。
  const apX = b.x + nx*(T/2) + tx*w.yc;
  const apY = b.y + ny*(T/2) + ty*w.yc;
  const sIn = w.dx*tx + w.dy*ty;                          // sinχ_in
  const cIn = Math.abs(w.dx*nx + w.dy*ny);                // cosχ_in
  const rc = Math.max(0.05, w.dw * w.dw / lam);           // フレネル距離
  const dth = 2 * DIF_CHI_MAX / DIF_FAN_RAYS;
  const ph0 = w.ph - Math.PI/4 + k * T / Math.max(0.2, cIn);   // −π/4 は2次元キルヒホッフの定数位相
  const out = [];
  for (let q = 0; q < DIF_FAN_RAYS; q++) {
    const chi = -DIF_CHI_MAX + dth * (q + 0.5);
    const sOut = Math.sin(chi), cOut = Math.cos(chi);
    const env = _sinc(Math.PI * w.dw * (sOut - sIn) / lam);    // 単一スリット因子
    const obl = (cIn + cOut) / 2;                              // 傾斜因子
    const iRay = w.i * env * env * obl * obl;
    if (iRay < DIF_MIN_I) continue;
    const rdx = nx*cOut + tx*sOut, rdy = ny*cOut + ty*sOut;
    out.push({ x: apX + rdx*0.5, y: apY + rdy*0.5, dx: rdx, dy: rdy,
               i: iRay, ph: ph0, dif: { r0: 0, dth, rc } });
  }
  return out;
}
// ─── ビーム束のトレースをまとめる ─────────────────────────
//   干渉するのは「同じレーザー × 同じ波長」の光だけなので、その単位で束ねる。
//   （1台のレーザーの中では、ハーフミラーで分かれた枝どうしも無条件で干渉する。
//     traceLaser が枝ごとに opl と ph を引き継ぐので、経路差はそのまま位相差になる。）
//   非可干渉のレーザーは干渉計算が要らないので、波長ごとに1つへまとめてしまってよい。
function _buildLaserGroups() {
  const map = new Map();
  for (const L of lasers) {
    const ignore = L.interactHost ? null : L.body;
    const origins = L.rayOrigins();
    const d = L.getDir();
    // 'solid' は連続開口なので、レイ間隔ぶんの幅を持たせて積む（隙間は存在しない）。
    // 'array' は本当に細い光源の集まりなので、点のまま積む（隙間は本物）。
    const solid = L.beamMode === 'solid' && L.width > 0;
    const spScr = L.raySpacing() * cam.zoom;                 // レイ間隔 [画面px]
    const spanCells = solid ? spScr / IF_DOWNSCALE : 0;
    // ★描画の線幅：'solid' では隣り合うレイを「重ねず、隙間なく敷き詰める」。
    //   既定の 1.6px のまま 1.5px 間隔で何十本も描くと、加算合成で真っ白に飽和し、
    //   干渉の明暗どころか強度の差が一切見えなくなる（1本の太いビームのはずが
    //   数十本ぶんの明るさで描かれてしまう）。にじみも同じ理由で本数ぶん薄める。
    const style = solid ? { w: Math.max(1.2, spScr), ga: Math.min(1, spScr / 6) }
                        : { w: 1.6, ga: 1 };
    // 開口を照らした「幅」を渡す。'solid' はレイ間隔ぶん、それ以外は 0
    //   （0 は「このレイ1本がスリット全体を照らす」の意味。_difWavelets を参照）
    const spanW = solid ? L.raySpacing() : 0;
    for (const wl of L.spectrum()) {
      const key = L.coherent ? `c${L.id}|${wl.toFixed(3)}` : `i|${wl.toFixed(3)}`;
      let g = map.get(key);
      if (!g) { g = { coherent: L.coherent, wl, traces: [], srcs: new Set() }; map.set(key, g); }
      g.srcs.add(L);                      // 露出を決めるのに使う（何本ぶんが重なりうるか）
      // ★格子への当たりは「このレーザー × この波長」ごとに集める。
      //   集約は複素振幅の足し算なので、独立な光源のぶんを混ぜてはいけない
      //   （非可干渉の群には複数のレーザーが同居しうる）。
      const hits = [];
      for (const o of origins)
        g.traces.push({ segs: traceLaser(o.x, o.y, d.x, d.y, ignore, wl, { span: spanW, hits }),
                        spanCells, style });
      if (!hits.length) continue;
      // ─── 回折：スリットに届いた光を波面としてまとめ直し、そこから扇を出す ───
      const ws = _difWavelets(hits, wl);
      // ★露出は波面の数に応じて下げる。扇どうしは重なるので、そのまま 'lighter' で足すと
      //   強め合った次数が真っ白に振り切れ、包絡線（次数ごとの明るさの違い）が読めなくなる。
      // ★下げ幅は 1/N ではなく 1/√N。N で割ると波面が増えるほど暗くなりすぎる。
      //   実測：回折格子のデモは波面 12 枚で露出 1/12、ヤング（2枚）の 1/2 に対して6倍暗く、
      //   格子を出たあとの光がほとんど見えなかった（薄い赤がぼんやり残るだけ）。
      //   1/√N にすると格子は 3.5 倍明るくなって扇の縞まで読めるようになり、ヤングも
      //   1.4 倍になるが飽和はしない（どちらも次数ごとの明暗の差が残っていることを確認）。
      //   重なる扇の数は N ではなく「その点に届いた扇の数」なので、N で割るのは過剰だった。
      // ★これは描画の露出だけ。スクリーンの強度分布（js/optics/screen.js）はこの値を見ない
      //   ので、明線の位置・本数・間隔の読みは1つも変わらない。
      const dstyle = { w: 1.6, ga: 1, expo: 1 / Math.sqrt(Math.max(1, ws.length)) };
      for (const w of ws) for (const rr of _difEmit(w, wl))
        g.traces.push({ segs: traceLaser(rr.x, rr.y, rr.dx, rr.dy, w.body, wl,
                                         { i0: rr.i, ph0: rr.ph, dif: rr.dif }),
                        spanCells: 0, style: dstyle });
    }
  }
  return [...map.values()];
}
// ─── トレース結果のキャッシュ ─────────────────────────────
//   束にすると1フレームのトレース本数が二桁増える。幸い授業での実演はほとんど静止画なので、
//   光学的に関係する量が1つも動いていないフレームは前回の結果を使い回す。
//   ★キャッシュはワールド座標のまま持つ。カメラ（位置・ズーム）は光路を変えないので、
//     スクロールやズームでは作り直さなくてよい。
const _laserCache = { key: '', groups: null, zoom: -1 };
function _laserSceneKey() {
  let s = '';
  for (const L of lasers) {
    const o = L.getOrigin(), d = L.getDir();
    s += `L${o.x.toFixed(2)},${o.y.toFixed(2)},${d.x.toFixed(5)},${d.y.toFixed(5)},`
       + `${L.wavelength},${L.whiteLight?1:0},${L.width.toFixed(2)},${L.beamMode},`
       + `${L.rayNum},${L.coherent?1:0},${L.interactHost?1:0},${L.body?L.body.id:-1};`;
  }
  for (const b of objects) {
    if (b.layers === 0 && !(b.ior > 1)) continue;
    // ★形の編集も拾う必要がある（頂点を1つ動かしただけでも光路は変わる）。頂点数だけでは
    //   ドラッグを取りこぼすので、座標の重み付き和をチェックサムとして混ぜる。
    let vs = 0;
    if (b.verts) for (const v of b.verts) vs += v.x + v.y * 1.7;
    s += `B${b.id},${b.x.toFixed(2)},${b.y.toFixed(2)},${b.angle.toFixed(5)},${b.ior},`
       + `${b.opticKind||''},${b.focal},${b.opticIdeal?1:0},`                // ★理想化と焦点距離も光路を変える
       + `${b.slitN},${b.slitD},${b.slitA},${b.slitM},`
       + `${b.reflective?1:0},${b.reflectance},${b.fresnel?1:0},${b.dispersion?1:0},${b.abbe},${b.layers},`
       // ★反射防止コートも光路を変える。付けた／外した／端を動かしたを取りこぼすと、
       //   絵が古いまま残る（キャッシュは「光学的に関係する量」だけを見る約束）。
       + `${(b.arCoats||[]).map(c => c.s.toFixed(4)+':'+c.len.toFixed(4)).join('|')},`
       + `${b.type === 'circle' ? b.radius : vs.toFixed(3)},${b.verts?b.verts.length:0},`
       + `${b.holes?b.holes.length:0},${b.opticArcs?b.opticArcs.length:0};`;
  }
  s += `G${world.terrain?1:0},${ground.y.toFixed(2)},${ground.angle.toFixed(5)},${ground.layers}`;
  return s;
}
// ─── 光が届いている物体（プログラムの〈光が当たる／途切れる〉が読む）──────────
//   ★描画と同じトレース（上のキャッシュ）をそのまま読む。別に追い直すと、画面に見えて
//     いる光と「当たった」の判定が食い違いうる（計算量も倍になる）。キャッシュの鍵は
//     光路に関係する量だけで、カメラによらない＝ tick から読んでも同じ光路が返る。
//     simTick から呼ぶので、フレームの速さによらず tick ごとに判定が決まる。
//   ★数えるのは幾何的な光線だけ（反射・屈折・理想レンズで曲がったものは含む）。
//     回折で広がった光（seg.dif のあるもの）は数えない。縞の暗線の上に置いた的が
//     光ったり消えたりして、きっかけとして読めなくなるため。
//   ★弱い枝（ガラスの表面反射 4% など）も光として数える。追うのをやめる強さ
//     RAY_MIN_I（0.2%）より上なら画面にも描かれている光なので、見えている光と揃える。
function laserLitIds() {
  const ids = new Set();
  if (!lasers.length) return ids;
  for (const g of _laserGroups()) for (const tr of g.traces) for (const s of tr.segs)
    if (s.end && !s.dif) ids.add(s.end.id);
  return ids;
}
function _laserGroups(key) {
  // spanCells と線幅はズームに依存するので、ズームが変わったら作り直す（光路そのものは不変）
  if (key === undefined) key = _laserSceneKey();
  if (_laserCache.groups && _laserCache.key === key && _laserCache.zoom === cam.zoom)
    return _laserCache.groups;
  _laserCache.key = key; _laserCache.zoom = cam.zoom;
  _laserCache.groups = _buildLaserGroups();
  return _laserCache.groups;
}
function laserGlowColor(color, alpha = 0.22) {
  if (typeof color === 'string' && color[0] === '#') return hexToRgba(color, alpha);
  const m = /rgba?\(([^)]+)\)/.exec(color || '');
  if (m) { const p = m[1].split(',').map(s => parseFloat(s)); return `rgba(${p[0]||255},${p[1]||60},${p[2]||60},${alpha})`; }
  return `rgba(255,60,60,${alpha})`;
}
// ─── 変調ありの描画 ───────────────────────────────────
//   明るさが線分の途中で変わるので、線分を細かく刻んで1本ずつ濃さを変える必要がある。
//   刻みをそのまま stroke すると数千回の呼び出しになるので、明るさをバケットに丸めて
//   同じ濃さのものを1本のパスにまとめ、バケットの数だけ stroke する。
// 変調を読み取る刻み [画面px]。明るさが変わる速さは縞の細かさで決まるので、画面上の波長に
// 比例させる（固定値だと、拡大したときに必要のない細かさで刻んで重くなるだけ）。
// ★1/6 にしてあるのは、いちばん細かい縞が λ ではなく λ/2 だから。鏡への垂直入射で
//   立つ定在波の間隔が λ/2 なので、λ/4 刻みではちょうど1周期に2点しか乗らず（ナイキスト
//   ぎりぎり）、折り返して実際より粗い縞に化ける。1/6 なら1周期に3点乗る。
const _ifDrawStep = wl => Math.max(1.5, Math.min(8, simLambdaPx(wl) * cam.zoom / 6));
// 明るさの段数。★変調は 0..1 に収まる（強め合いでも従来の明るさを超えない）ので、
//   段はそのまま 0..1 を割る。「明線が2本ぶん明るい」のは 'lighter' が重なった2本を
//   足すことで出るので、描き方の側でわざわざ持ち上げる必要はない。
const IF_BUCKETS = 20;
function _visBucket(vis) {
  return Math.max(0, Math.min(IF_BUCKETS - 1, Math.round(vis * (IF_BUCKETS - 1))));
}
// ★回折光は「線」ではなく「くさび（四角形）」として塗る。
//   以前は距離に応じた線幅を等比24段に丸めて stroke していたが、丸めの誤差（±12%）が
//   そのまま隣り合うくさびの隙間になり、扇の中に放射状の筋が何十本も出ていた。
//   筋の間隔は dθ·r なので「格子の近くほど細かく、遠いほど広がる」——見た目は
//   いかにも物理だが、完全に標本化の跡である（実測：バッファのさざ波は13%なのに、
//   描いた絵のコントラストは100%＝完全な黒い隙間になっていた）。
//   四角形なら隣どうしが辺を共有するので、原理的に隙間も重なりもできない。
//   さらに1つの Path2D にまとめて fill すると、共有する辺は同じ塗りの内側になるので
//   アンチエイリアスの継ぎ目も出ない。塗りは明るさの段ごとに1回でよく、
//   線幅ごとに分けていた頃より stroke/fill の呼び出し回数もむしろ減る。
// buckets … { line: Map, fill: Map }。平行なレイは line（従来どおりの stroke）へ。
function _emitSeg(seg, buckets, F, fade, drawStep) {
  const D = seg.dif || null;                          // 回折光なら {r0, dth, rc}
  const inten0 = seg.i !== undefined ? seg.i : 1;
  if (inten0 <= 1e-4) return;
  const a = worldToScreen(seg.x1, seg.y1), b = worldToScreen(seg.x2, seg.y2);
  // ★画面外を切ってから刻む。当たらなかった光線は 1e5 px あるので、切らないと
  //   刻み数が青天井になる（描画結果は同じなのに数万回のループになる）。
  const M = 8;
  const cl = _ifClip(a.x + M, a.y + M, b.x + M, b.y + M, canvas.width + 2*M, canvas.height + 2*M);
  if (!cl) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const px = Math.hypot(dx, dy) * (cl[1] - cl[0]);
  const steps = Math.max(1, Math.min(4096, Math.ceil(px / drawStep)));
  const dt = (cl[1] - cl[0]) / steps;
  const mx = dx * dt * 0.5, my = dy * dt * 0.5;       // 刻みの中点までのずれ
  const worldLen = D ? len(seg.x2 - seg.x1, seg.y2 - seg.y1) : 0;
  // くさびの向き（画面座標での単位法線）。直線なので線分のあいだ一定
  const sl = Math.hypot(dx, dy) || 1;
  const pxn = -dy / sl, pyn = dx / sl;
  const map = D ? buckets.fill : buckets.line;
  // ★同じ段が続くあいだは1つの区間としてつなぐ。刻みごとに図形を積むと、
  //   縞のない場所（＝たいていは絵の大半）でも1本のビームが数百個の小片に分解され、
  //   その個数がそのまま描画の時間になる。つなげても小片は同一直線上に並んでいるので、
  //   絵は1ピクセルも変わらない。
  let runK = -1, rx = 0, ry = 0, rh = 0;
  for (let s = 0; s <= steps; s++) {
    const t = cl[0] + dt * s;
    const x = a.x + dx*t, y = a.y + dy*t;
    // くさびの半幅は区間の「端」の値を使う（強度は下の中点の値を使う）
    const h = D ? difSpanAt(seg, D.r0 + worldLen * t) * cam.zoom * 0.5 : 0;
    let k = -1;                                       // s === steps は終端。必ず区間を閉じる
    if (s < steps) {
      let inten = inten0;
      if (D) inten = difIntensityAt(seg, D.r0 + worldLen * (t + dt * 0.5));
      let mod = 1;
      if (F) {
        mod = ifModAt(F, x + mx, y + my);
        mod = 1 + (mod - 1) * fade;                   // 縞が細かすぎるときは干渉なしへ寄せる
      }
      const vis = Math.pow(Math.max(0, inten * mod), 1 / RAY_GAMMA);
      k = D ? _difBucket(vis) : _visBucket(vis);
      if (k <= 0) k = -1;                             // 段0（弱め合いで消えた区間）は描かない
    }
    if (k === runK) continue;
    if (runK > 0) {
      let p = map.get(runK);
      if (!p) map.set(runK, p = new Path2D());
      if (D) {                                        // 台形（両端で幅が違う）
        // ★closePath() を呼ばないこと。fill() は開いた部分パスを必ず閉じてから塗るので
        //   絵は1ピクセルも変わらないのに、closePath だけが桁違いに重い。
        //   実測（Path2D に四角を N 個積む時間。Chromium）：
        //     closePath なし  N=20000 → 6.6ms（0.33µs/個）
        //     closePath あり  N=20000 → 5047ms（252µs/個）
        //   しかも1回あたりが N とともに伸びる＝全体では O(N²)。回折格子のデモは
        //   76,000 個の台形を積むので、これだけで 8.7 秒かかっていた（塗りは 10ms）。
        p.moveTo(rx + pxn*rh, ry + pyn*rh);
        p.lineTo(x  + pxn*h,  y  + pyn*h);
        p.lineTo(x  - pxn*h,  y  - pyn*h);
        p.lineTo(rx - pxn*rh, ry - pyn*rh);
      } else {
        p.moveTo(rx, ry); p.lineTo(x, y);
      }
    }
    runK = k; rx = x; ry = y; rh = h;
  }
}
const _newBuckets = () => ({ line: new Map(), fill: new Map() });
// 回折光の明るさの段数。★ビーム用の IF_BUCKETS(=20) より細かくする。
//   細いビームでは段の境目が線の途中の色の変わり目にしかならないが、回折光は
//   広い面をなだらかに埋めるので、20段だと等高線状のブロックとして見えてしまう。
//   くさびは段ごとに1回 fill するだけなので、段を増やしても呼び出しは段数ぶんしか増えない。
const DIF_BUCKETS = 64;
const _difBucket = vis => Math.max(0, Math.min(DIF_BUCKETS - 1, Math.round(vis * (DIF_BUCKETS - 1))));
// 干渉なしの描画。★従来と完全に同じ経路のまま残す（バケットに丸めず、線分ごとに正確な濃さで
//   描く）。虹の副虹のように微妙な明るさの差そのものが見せどころの絵を、段に丸めたくない。
function _drawSegPlain(seg, col, st) {
  const inten = seg.i !== undefined ? seg.i : 1;
  if (inten <= 1e-4) return;
  // ★表示ガンマ：主虹は元の光の約5%、副虹は約0.3%しかない。強度をそのまま
  //   不透明度にすると見えないので、目の応答に近いガンマをかけて持ち上げる。
  const vis = Math.pow(inten, 1 / RAY_GAMMA);
  const a = worldToScreen(seg.x1, seg.y1), b = worldToScreen(seg.x2, seg.y2);
  const c = _bctx;
  c.strokeStyle = laserGlowColor(col, 0.22 * vis * st.ga); c.lineWidth = 6;   // グロー
  c.beginPath(); c.moveTo(a.x,a.y); c.lineTo(b.x,b.y); c.stroke();
  c.strokeStyle = laserGlowColor(col, vis);                c.lineWidth = st.w; // コア（強度で減光）
  c.beginPath(); c.moveTo(a.x,a.y); c.lineTo(b.x,b.y); c.stroke();
}
// ★干渉時はにじみを描かない。既定の 6px のにじみは、縞の暗線（λ_sim ≒ 12.7px の系では
//   十数pxしかない）を両隣の明線から埋めてしまい、せっかくの縞をつぶす。
//   線の端も丸めない（'butt'）。刻んだ小片の丸い端が隣の縞へはみ出すため。
//   小片どうしは端点を共有するので、角を落としても継ぎ目は出ない。
// ★露出。重なった光は 'lighter' で足されるので、2本が強め合うと 2倍になって白に振り切れる。
//   振り切れた領域では明るさの差が一切見えなくなり、暗線しか読めない絵になる。
//   そこで干渉している群は、重なる本数ぶん露出を下げる（実験で露光を合わせるのと同じ）。
//   こうすると強め合いがちょうど最大の明るさに、弱め合いが 0 に落ちて、縞が全振幅で出る。
function _strokeBuckets(buckets, col, st, exposure) {
  _bctx.lineCap = 'butt';
  _bctx.lineWidth = st.w;
  for (let k = 1; k < IF_BUCKETS; k++) {              // 平行なレイ：線として描く（従来どおり）
    const p = buckets.line.get(k);
    if (!p) continue;
    _bctx.strokeStyle = laserGlowColor(col, k / (IF_BUCKETS - 1) * exposure);
    _bctx.stroke(p);
  }
  for (let k = 1; k < DIF_BUCKETS; k++) {             // 回折光：くさびを塗る
    const p = buckets.fill.get(k);
    if (!p) continue;
    _bctx.fillStyle = laserGlowColor(col, k / (DIF_BUCKETS - 1) * exposure);
    _bctx.fill(p);
  }
  _bctx.lineCap = 'round';
}
// ─── ビーム本体を描く（干渉ONのときは変調しながら）───
//   ctx は const なので差し替えられない。ビーム層はオフスクリーンに描くので、
//   下請けの描画関数はこの _bctx を見る。
let _bctx = null;
function _paintBeams(g2d, key) {
  _bctx = g2d;
  _bctx.save();
  _bctx.lineCap = 'round';
  _bctx.globalCompositeOperation = 'lighter'; // ★重なった光を加算（＝非可干渉な光どうしの合成）
  screenBegin();                              // ★スクリーンの強度分布もこの1回で作り直す
  const hasScreen = screenBodies().length > 0;
  for (const g of _laserGroups(key)) {
    const col = wavelengthToHex(g.wl);        // ★色は常に波長から導出（白色光は波長ごとに分かれる）
    const fade = g.coherent ? ifLambdaFade(g.wl) : 0;
    // ★スクリーンがあるときは、縞が画面上で細かすぎてもバッファは作って読み取る。
    //   フェードが要るのは「空中に描くと縞がセルより細かくなってモアレの砂嵐になる」から
    //   であって、面に沿って1本読み取るだけのスクリーンにはその問題がない
    //   （スクリーン上の次数の間隔は、ズームアウトしても数十セルある）。
    //   ★積算そのものの正しさは ifStepCells が守っている：ズームアウトで1歩あたりの位相が
    //     π を超えると複素振幅が折り返し、分布が「空白」ではなく「もっともらしい嘘」に
    //     なるので、刻みのほうを細かくして防いでいる。ここを分けないと、
    //     回折格子の次数を見るためにズームアウトした瞬間にスクリーンの縞まで消える。
    if (fade > 0.01 || (g.coherent && hasScreen)) {
      // 1つの (群,波長) ぶんだけ複素振幅を積み、その場で描いてからバッファを捨てる。
      // 群ごとに変調が違うので混ぜられない代わり、バッファは1組で足りる。
      // ★積むのは群ぜんぶ（干渉は群の中で起きる）、描くのは線幅ごと（幅の違う
      //   ビームが同じ群にいることがあるので、パスを混ぜると線幅が化ける）。
      const F = ifBegin();
      const k = simWaveK(g.wl);
      // 回折光は「広がっていくくさび」なので専用の積み方をする（幅も振幅も距離で変わる）
      for (const tr of g.traces) for (const s of tr.segs)
        s.dif ? ifSplatDiffSeg(F, s, k) : ifSplatSeg(F, s, k, tr.spanCells);
      screenCollect(g, F);                      // ★スクリーンの受光面に強度分布を積む
      const byStyle = new Map();
      const dstep = _ifDrawStep(g.wl);
      for (const tr of g.traces) {
        let e = byStyle.get(tr.style);
        if (!e) byStyle.set(tr.style, e = _newBuckets());
        for (const s of tr.segs) _emitSeg(s, e, F, fade, dstep);
      }
      const expo = 1 / Math.max(1, g.srcs.size);
      for (const [st, buckets] of byStyle) _strokeBuckets(buckets, col, st, st.expo !== undefined ? st.expo : expo);
    } else {
      // 非可干渉：従来どおり強度をそのまま描く。ただし回折光だけは距離で強度も太さも
      // 変わるので、バケットに載せて刻みながら描く（縞は立たず、なめらかに広がるだけ）。
      const byStyle = new Map();
      const dstep = _ifDrawStep(g.wl);
      for (const tr of g.traces) for (const s of tr.segs) {
        if (!s.dif) { _drawSegPlain(s, col, tr.style); continue; }
        let e = byStyle.get(tr.style);
        if (!e) byStyle.set(tr.style, e = _newBuckets());
        _emitSeg(s, e, null, 0, dstep);
      }
      const expo = 1 / Math.max(1, g.srcs.size);
      for (const [st, buckets] of byStyle) _strokeBuckets(buckets, col, st, st.expo !== undefined ? st.expo : expo);
      screenCollectPlain(g);                    // ★非可干渉の光はレイの当たりから直接積む
    }
  }
  screenEnd();
  _bctx.restore();
  _bctx = null;
}
// ─── ビーム層のキャッシュ ───────────────────────────────
//   干渉は「複素振幅を積む → 線分を細かく刻んで濃さを変えながら描く」ので、幅の広い
//   ビームでは1フレームぶんが数十msかかる。だが光路もカメラも動いていないフレームでは
//   結果は完全に同じなので、オフスクリーンに描いておいて貼るだけにする。
//   ★授業での実演はほとんど静止画なので、これが効く場面がほぼ全部である。
//   マーカー（選択の印・群番号）はキャッシュに入れず毎フレーム描く（選択で変わるため）。
// ★動かしている間は、この作り直しを間引く。
//   幅の広いビームでは1回が数十〜数百ms かかるので、毎フレーム作り直すと、その重さが
//   そのままアプリ全体のフレームレートになる（膜をつかんで動かす操作そのものが引っかかる）。
//   前回かかった時間ぶんの間隔を空けてから作り直すことにすると、重いシーンでも
//   ビーム以外は最大で半分の時間しか奪われない＝ドラッグは滑らかなまま、ビームだけが
//   少し遅れて追いつく。★絵の中身は1ピクセルも変えない：手を止めれば必ず最新の絵になるので、
//   静止画としての正しさ（授業で見せる状態）は完全に保たれる。
// ★カメラを動かしている間は、前回の絵を「いまのカメラに合わせて貼り直す」。
//   以前はカメラが動いたら必ず作り直していた（前回の絵をそのまま 0,0 に貼ると、ビームだけ
//   世界に取り残された絵になるため）。だがワールド→画面は平行移動・回転・拡大だけの
//   相似変換なので、前回の絵を「そのときのカメラ→いまのカメラ」の相似変換で貼れば、
//   ビームは世界に貼り付いたまま付いてくる。地図アプリが古いタイルを拡大して見せるのと同じ。
//   画面の外から入ってきた縁だけが空白のまま残り、手を止めた瞬間の作り直しで埋まる。
//   実測（回折格子のデモ・998×736）：パン中のフレーム間隔 517ms → 17ms。
//   ★止めた瞬間には必ず全部を描き直すので、静止画（授業で見せる状態）は1ピクセルも変わらない。
//   ★ckey にカメラの角度も入れる。入れていなかったので、カメラを回すとビーム層が
//     作り直されず、光だけが回らずに取り残されていた。
const IF_LAYER_FREE_MS = 8;    // これより軽ければ間引かない（毎フレーム作り直す）
const IF_LAYER_STALE_MS = 600; // カメラが動き続けているときに、それでも作り直す間隔の下限
//   at … その絵を描いたときのカメラ（貼り直しの相似変換を作るのに要る）
//   frameCam … 前フレームのカメラ。「いまカメラが動いている最中か」の判定に使う
const _laserLayer = { canvas: null, g2d: null, key: '', cam: '', at: null,
                      frameCam: '', cost: 0, t: 0 };
function drawLasers() {
  const wantLayer = lasers.length > 0;
  if (wantLayer) {
    if (!_laserLayer.canvas) {
      _laserLayer.canvas = document.createElement('canvas');
      _laserLayer.g2d = _laserLayer.canvas.getContext('2d');
      _laserLayer.key = '';
    }
    const lc = _laserLayer.canvas;
    if (lc.width !== canvas.width || lc.height !== canvas.height) {
      // ★大きさを変えると中身は消えるので、貼り直しの材料も捨てる（at=null で必ず描き直す）。
      //   残しておくと、窓の大きさを変えている最中に空の層を貼って光が消える。
      lc.width = canvas.width; lc.height = canvas.height;
      _laserLayer.key = ''; _laserLayer.at = null;
    }
    const camA = cam.angle || 0;
    const ckey = `${cam.x.toFixed(2)},${cam.y.toFixed(2)},${cam.zoom.toFixed(5)},${camA.toFixed(5)}`;
    const skey = _laserSceneKey();          // ★1フレームに1回だけ作って _laserGroups と共有する
    const key = `${skey}|${ckey}`;
    const camMoving = _laserLayer.frameCam !== '' && _laserLayer.frameCam !== ckey;
    _laserLayer.frameCam = ckey;
    if (key !== _laserLayer.key) {
      const now = performance.now();
      // 重い（前回が IF_LAYER_FREE_MS 超）ときは今回を見送る。見送ってもキーは古いままなので、
      //   次のフレームでまた判定に来る＝取りこぼしはない。
      //   ・カメラが動いている最中 … 見送って貼り直しで済ませる（絵は世界に付いてくる）。
      //     ただし見送り続けると、画面の外から入ってきた縁がいつまでも空白のまま残る
      //     （カメラを物体に接続したデモのように、カメラが止まらない場合がある）。
      //     そこで前回から IF_LAYER_STALE_MS か「前回の4倍の時間」のどちらか長いほうが
      //     過ぎたら、動いていても作り直す＝縁の空白は最長でもその時間で埋まる。
      //   ・カメラは止まっている   … 前回かかった時間ぶんだけ間隔を空ける（物をつかんで
      //     動かしている間、ビーム以外に半分の時間を残すため）
      //   GIF記録中は1コマも古い絵を出せないので、必ず作り直す。
      const wait = camMoving ? Math.max(IF_LAYER_STALE_MS, _laserLayer.cost * 4) : _laserLayer.cost;
      const skip = _laserLayer.cost > IF_LAYER_FREE_MS
                && _laserLayer.at
                && now - _laserLayer.t < wait
                && !(typeof gifRec !== 'undefined' && gifRec.active);
      if (!skip) {
        _laserLayer.g2d.clearRect(0, 0, lc.width, lc.height);
        _paintBeams(_laserLayer.g2d, skey);
        _laserLayer.t = performance.now();
        _laserLayer.cost = _laserLayer.t - now;
        _laserLayer.key = key; _laserLayer.cam = ckey;
        _laserLayer.at = { x: cam.x, y: cam.y, zoom: cam.zoom, angle: camA };
      }
    }
    ctx.save();
    // 透明な下地に 'lighter' で積んだ結果を 'lighter' で貼ると、直接描いたのと同じ絵になる
    // （どちらも「色×不透明度」の総和を足しているため）
    ctx.globalCompositeOperation = 'lighter';
    const at = _laserLayer.at;
    if (at && (at.x !== cam.x || at.y !== cam.y || at.zoom !== cam.zoom || at.angle !== camA)) {
      // 描いたときのカメラ → いまのカメラ の相似変換で貼る（上の★）。
      //   画面 p₀ の点は、いま p₁ = A·(p₀−C) + C + t にいる。
      //     A = (z₁/z₀)·R(θ₁−θ₀)   t = R(θ₁)·z₁·(cam₀ − cam₁)   C = 画面の中心
      const s = cam.zoom / at.zoom, phi = camA - at.angle;
      const m = Math.cos(phi) * s, n = Math.sin(phi) * s;
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const dx0 = (at.x - cam.x) * cam.zoom, dy0 = (at.y - cam.y) * cam.zoom;
      const ca = Math.cos(camA), sa = Math.sin(camA);
      const tx = dx0*ca - dy0*sa, ty = dx0*sa + dy0*ca;
      ctx.setTransform(m, n, -n, m, cx + tx - (m*cx - n*cy), cy + ty - (n*cx + m*cy));
    }
    ctx.drawImage(lc, 0, 0);
    ctx.restore();
  }
  drawScreens();          // ★スクリーンに映った縞と断面グラフ（ビーム層を貼ったあとに重ねる）
  ctx.save();
  for (const L of lasers) {
    const o = L.getOrigin();
    const so = worldToScreen(o.x, o.y);
    if (L.width > 0) {                                        // ★幅を持つビームは開口を線で示す
      const d = L.getDir();
      const hw = L.width / 2 * cam.zoom;
      ctx.beginPath();
      ctx.moveTo(so.x + d.y*hw, so.y - d.x*hw);
      ctx.lineTo(so.x - d.y*hw, so.y + d.x*hw);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(so.x, so.y, 5, 0, Math.PI*2);
    ctx.fillStyle = darkenColor(L.color, 0.6); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    if (L.coherent) {                                         // ★干渉ONの印（位相を持っている）
      // 小さな正弦波を描く。以前は群の番号を出していたが、群を廃したので数字は無くなった。
      // 文字（'≈' など）ではなくパスで描くのは、字形と大きさを環境に左右されないため。
      const my = so.y - 12;
      ctx.beginPath();
      for (let t = 0; t <= 10; t++) {
        const x = so.x - 5 + t, y = my - Math.sin(t / 10 * Math.PI * 2) * 2;
        t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    if (selectedElemIds.has(L.id)) {                          // ★範囲選択に入っている印
      ctx.beginPath(); ctx.arc(so.x, so.y, 9, 0, Math.PI*2);
      ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  ctx.restore();
}
// ─── Particle 型別パラメータ ──────────────
