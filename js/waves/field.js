function serializeWaveSource(s) {
  return { id: s.id, bodyId: s.body ? s.body.id : null, localX: s.localX, localY: s.localY,
           freq: s.freq, amp: s.amp, phase: s.phase, enabled: s.enabled };
}
function deserializeWaveSources(arr, bodyList) {
  if (!arr) return [];
  const byId = new Map(bodyList.map(b => [b.id, b]));
  const out = [];
  for (const d of arr) {
    const body = d.bodyId != null ? byId.get(d.bodyId) : null;
    if (d.bodyId != null && !body) continue;
    out.push(new WaveSource({ ...d, body }));
  }
  return out;
}
function waveActiveSources() { return waveSources.filter(s => s.enabled && s.amp > 0); }

// ─── 波が見えなくなる半径 [m] ───
//   A(r) = A₀·exp(−αr)/√(r/r₀)。2次元の円形波なので 1/√r（球面波の 1/r ではない）
function waveVisibleRadiusM() {
  let A = 0;
  for (const s of waveActiveSources()) if (s.amp > A) A = s.amp;
  if (A <= 0) return 1;
  const vm = Math.max(0.001, world.waveVisMin);
  const al = Math.max(WAVE_ABS_MIN, world.waveAbsorb);
  const r0 = 0.25;
  const F = r => A * Math.exp(-al * r) / Math.sqrt(Math.max(r, r0) / r0) - vm;
  if (F(r0) <= 0) return r0;
  let lo = r0, hi = r0 * 2;
  while (F(hi) > 0 && hi < 500) hi *= 2;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (F(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// ─── 格子間隔・領域の自動決定 ───
function waveComputeLayout() {
  const act = waveActiveSources();
  let fmax = 0;
  for (const s of act) if (s.freq > fmax) fmax = s.freq;
  if (fmax <= 0) fmax = 1;
  const dx = Math.max(0.5, toPx(world.waveSpeed / fmax / WAVE_CPL));
  const R = toPx(waveVisibleRadiusM());
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (const s of act) {
    const o = s.getOrigin();
    if (o.x < mnX) mnX = o.x;  if (o.x > mxX) mxX = o.x;
    if (o.y < mnY) mnY = o.y;  if (o.y > mxY) mxY = o.y;
  }
  for (const p of waveTrail) {                       // ★まだ生きている波面の中心も含める
    if (p.x < mnX) mnX = p.x;  if (p.x > mxX) mxX = p.x;
    if (p.y < mnY) mnY = p.y;  if (p.y > mxY) mxY = p.y;
  }
  if (!isFinite(mnX)) { mnX = mxX = cam.x; mnY = mxY = cam.y; }
  const q = n => Math.max(WAVE_QUANT, Math.ceil(n / WAVE_QUANT) * WAVE_QUANT);
  let nw = q(((mxX - mnX) + 2 * R) / dx);
  let nh = q(((mxY - mnY) + 2 * R) / dx);
  // 1フレームに進めるステップ数（波速が速いほど細かく刻む必要がある）
  const wdt = WAVE_S_MAX * (dx * PX2M) / Math.max(0.01, world.waveSpeed);
  const sub = Math.max(1, Math.round((1 / 60) / wdt));
  // 計算量の上限に収まるまで領域を縮める（dx は精度の生命線なので絶対に粗くしない）
  const cap = Math.max(0.1, world.waveBudget) * 1e6;
  let capped = false, guard = 0;
  while ((nw + 2 * WAVE_PAD) * (nh + 2 * WAVE_PAD) * sub > cap && guard++ < 200) {
    if (nw <= WAVE_QUANT && nh <= WAVE_QUANT) break;
    if (nw >= nh) nw = Math.max(WAVE_QUANT, nw - WAVE_QUANT);
    else          nh = Math.max(WAVE_QUANT, nh - WAVE_QUANT);
    capped = true;
  }
  const W = nw + 2 * WAVE_PAD, H = nh + 2 * WAVE_PAD;
  const cx = (mnX + mxX) / 2, cy = (mnY + mxY) / 2;
  return { dx, R, W, H, sub, capped,
           ox: Math.round(cx / dx - W / 2) * dx,     // 平行移動が整数セルになるよう格子に載せる
           oy: Math.round(cy / dx - H / 2) * dx };
}
function waveAlloc(W, H) {
  const f = waveField, n = W * H;
  f.W = W; f.H = H;
  f.u = new Float32Array(n); f.up = new Float32Array(n); f.un = new Float32Array(n);
  f.cRel2 = new Float32Array(n).fill(1);
  f.solid = new Uint8Array(n);
  f.sig = new Float32Array(n);
  f.damp = new Float32Array(n);          // 無反射の壁の損失（waveStampAbsorbers）
  f.A = new Float32Array(n); f.B = new Float32Array(n);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const d = Math.min(i, W - 1 - i, j, H - 1 - j);
    if (d < WAVE_PAD) f.sig[j * W + i] = WAVE_SIGMA * Math.pow((WAVE_PAD - d) / WAVE_PAD, WAVE_RAMP);
  }
  f.canvas = document.createElement('canvas');
  f.canvas.width = W; f.canvas.height = H;   // ★吸収層も描く（波が減衰して消える様子を見せる）
  f.cctx = f.canvas.getContext('2d');
  f.img = f.cctx.createImageData(f.canvas.width, f.canvas.height);
  f.absKey = NaN; f.coefDirty = true; f.geoKey = '';
}
// 旧格子から新格子へ波を補間して引き継ぐ（セル幅 dx が変わったとき）。
//   FDTD の状態は u（現在）と up（1つ前）の組で、速度は (u-up)/wdt として入っている。
//   波速が同じなら wdt は dx に比例するので、変位差を dx の比で換算すれば速度が保たれる。
function waveResample(old) {
  const f = waveField, ow = old.W, oh = old.H;
  const r = f.dx / old.dx;                       // = wdt_new / wdt_old
  for (let j = 0; j < f.H; j++) {
    const gy = (f.oy + (j + 0.5) * f.dx - old.oy) / old.dx - 0.5;   // 旧格子のセル中心座標
    let j0 = Math.floor(gy), j1 = j0 + 1; const ty = gy - j0;
    if (j1 < 0 || j0 > oh - 1) continue;         // 旧格子の外は 0 のまま
    if (j0 < 0) j0 = 0; if (j1 < 0) j1 = 0;
    if (j0 > oh - 1) j0 = oh - 1; if (j1 > oh - 1) j1 = oh - 1;
    const r0 = j0 * ow, r1 = j1 * ow, base = j * f.W;
    for (let i = 0; i < f.W; i++) {
      const gx = (f.ox + (i + 0.5) * f.dx - old.ox) / old.dx - 0.5;
      let i0 = Math.floor(gx), i1 = i0 + 1; const tx = gx - i0;
      if (i1 < 0 || i0 > ow - 1) continue;
      if (i0 < 0) i0 = 0; if (i1 < 0) i1 = 0;
      if (i0 > ow - 1) i0 = ow - 1; if (i1 > ow - 1) i1 = ow - 1;
      const w00 = (1-tx)*(1-ty), w10 = tx*(1-ty), w01 = (1-tx)*ty, w11 = tx*ty;
      const u = old.u [r0+i0]*w00 + old.u [r0+i1]*w10 + old.u [r1+i0]*w01 + old.u [r1+i1]*w11;
      const p = old.up[r0+i0]*w00 + old.up[r0+i1]*w10 + old.up[r1+i0]*w01 + old.up[r1+i1]*w11;
      const k = base + i;
      f.u[k]  = u;
      f.up[k] = u - (u - p) * r;                 // 1ステップ分の変位を新しい刻みへ換算
    }
  }
}
// 格子を作り直す／平行移動する。dx が同じなら中身を持ち越すので波は消えない
function waveEnsureGrid() {
  const f = waveField;
  if (!waveActiveSources().length) return false;
  const L = waveComputeLayout();
  f.R = L.R; f.sub = L.sub; f.capped = L.capped;
  const dxSame = f.u && Math.abs(f.dx - L.dx) < 1e-9;
  const sameMedium = f.u && world.waveSpeed === f.builtSpeed;   // 波速を変えた＝媒質が別物
  f.builtSpeed = world.waveSpeed;
  if (!f.u || !dxSame || f.W !== L.W || f.H !== L.H) {
    const old = (dxSame || sameMedium)
      ? { u: f.u, up: f.up, W: f.W, H: f.H, dx: f.dx, ox: f.ox, oy: f.oy } : null;
    waveAlloc(L.W, L.H);
    f.dx = L.dx; f.ox = L.ox; f.oy = L.oy;
    if (old && !dxSame) waveResample(old);       // 振動数・波長の変更：補間して引き継ぐ
    else if (old) {                              // 大きさだけ変わった場合は中身を持ち越す
      const sh = Math.round((f.ox - old.ox) / f.dx), sv = Math.round((f.oy - old.oy) / f.dx);
      for (let j = 0; j < f.H; j++) {
        const sj = j + sv; if (sj < 0 || sj >= old.H) continue;
        for (let i = 0; i < f.W; i++) {
          const si = i + sh; if (si < 0 || si >= old.W) continue;
          f.u[j * f.W + i] = old.u[sj * old.W + si];
          f.up[j * f.W + i] = old.up[sj * old.W + si];
        }
      }
    } else { f.t = 0; f.acc = 0; }               // 波速を変えた＝媒質が別物。波は最初から
    return true;
  }
  if (L.ox !== f.ox || L.oy !== f.oy) {          // 波源に追従して平行移動
    const sh = Math.round((L.ox - f.ox) / f.dx), sv = Math.round((L.oy - f.oy) / f.dx);
    if (sh || sv) {
      const nu = new Float32Array(f.W * f.H), nup = new Float32Array(f.W * f.H);
      const j0 = Math.max(0, -sv), j1 = Math.min(f.H, f.H - sv);
      const i0 = Math.max(0, -sh), i1 = Math.min(f.W, f.W - sh);
      for (let j = j0; j < j1; j++) {
        const d = j * f.W, s = (j + sv) * f.W + sh;
        for (let i = i0; i < i1; i++) { nu[d + i] = f.u[s + i]; nup[d + i] = f.up[s + i]; }
      }
      f.u = nu; f.up = nup; f.un = new Float32Array(f.W * f.H);
      f.ox = L.ox; f.oy = L.oy; f.geoKey = '';
    }
  }
  return true;
}
function waveUpdateCoef() {
  const f = waveField;
  const sAbs = Math.max(WAVE_ABS_MIN, world.waveAbsorb) * world.waveSpeed * f.wdt;
  if (f.absKey === sAbs && !f.coefDirty) return;   // 壁が動いたら damp も変わる（coefDirty）
  f.absKey = sAbs; f.coefDirty = false;
  const dp = f.damp;
  for (let k = 0; k < f.A.length; k++) {
    const s = f.sig[k] + dp[k] + sAbs;
    f.A[k] = 1 / (1 + s); f.B[k] = 1 - s;
  }
}
const waveCellX = i => waveField.ox + (i + 0.5) * waveField.dx;
const waveCellY = j => waveField.oy + (j + 0.5) * waveField.dx;
function waveCellIndex(wx, wy) {
  const f = waveField;
  const i = Math.floor((wx - f.ox) / f.dx), j = Math.floor((wy - f.oy) / f.dx);
  if (i < 1 || i >= f.W - 1 || j < 1 || j >= f.H - 1) return -1;
  return j * f.W + i;
}

// その点の変位を読む（双一次補間）。★セル中心を基準にする取り方は waveInject と同じ。
//   ★格子の節点をそのまま読んではいけない。動く観測者はセルを跨いだ瞬間に値が飛び、
//     その段差が偽のゼロ交差を作る＝受信計の周期が割れる。実測（ドップラーの
//     「観測者が動く」デモ、遠ざかる観測者B）：真の周期 1.006 秒のあいだに 0.557/0.449/0.04
//     といった交差が混ざり、10秒のうち振動数を出せたのは 0.55秒ぶんだけだった。
//     入れる側（waveInject）が双一次で配っているのだから、読む側も同じ取り方にそろえる。
function waveSampleAt(wx, wy) {
  const f = waveField;
  if (!f.u) return null;
  const gx = (wx - f.ox) / f.dx - 0.5, gy = (wy - f.oy) / f.dx - 0.5;
  const i0 = Math.floor(gx), j0 = Math.floor(gy);
  if (i0 < 0 || j0 < 0 || i0 + 1 >= f.W || j0 + 1 >= f.H) return null;
  const tx = gx - i0, ty = gy - j0, u = f.u;
  const a = u[ j0      * f.W + i0] * (1 - tx) + u[ j0      * f.W + i0 + 1] * tx;
  const b = u[(j0 + 1) * f.W + i0] * (1 - tx) + u[(j0 + 1) * f.W + i0 + 1] * tx;
  return a * (1 - ty) + b * ty;
}

function waveInject(wx, wy, val) {
  const f = waveField;
  const gx = (wx - f.ox) / f.dx - 0.5, gy = (wy - f.oy) / f.dx - 0.5;   // セル中心基準
  const i0 = Math.floor(gx), j0 = Math.floor(gy);
  const tx = gx - i0, ty = gy - j0;
  for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) {
    const i = i0 + di, j = j0 + dj;
    if (i < 1 || i >= f.W - 1 || j < 1 || j >= f.H - 1) continue;
    const k = j * f.W + i;
    if (f.solid[k]) continue;
    const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty);   // 4セルの合計は 1
    f.u[k] = f.u[k] * (1 - w) + val * w;
  }
}
// ★波源を抱えている物体は壁にしない。
//   物体は既定で固定端（剛体壁）なので、波源を物体に載せる使い方（ドップラー効果）だと
//   波源が自分の内部の solid セルに埋まり、waveInject が届かず音が一切出なくなる。
//   スピーカーの筐体も本当は音を反射するが、自分の音を自分で閉じ込める方が教材として害が大きい。
function waveEmitterBodies() {
  const set = new Set();
  const act = waveActiveSources();
  if (!act.length) return set;
  for (const b of objects) {
    const m = b.waveMode || 'pass';
    if (m !== 'fixed' && m !== 'free') continue;
    for (const s of act) {
      if (s.body === b) { set.add(b.id); break; }
      const o = s.getOrigin();
      if (b.containsPoint(o.x, o.y)) { set.add(b.id); break; }   // 載せずに重ねただけの波源も
    }
  }
  return set;
}
function waveGeoKey() {
  const f = waveField;
  const em = f.emitters;
  let s = `${f.ox}|${f.oy}|${f.W}|${f.H}|${f.dx}|${world.waveSpeed}`;
  for (const b of objects) {
    if (!b.waveMode || b.waveMode === 'pass') continue;
    if (em.has(b.id)) { s += `;E${b.id}`; continue; }   // 壁から外れた／戻ったら組み直す
    s += `;${b.id},${Math.round(b.x*2)},${Math.round(b.y*2)},${Math.round(b.angle*200)},${b.waveMode},${b.waveIor}`;
  }
  if (world.terrain && ground.waveMode !== 'pass')
    s += `;G${Math.round(ground.y*2)},${Math.round(ground.angle*200)},${ground.waveMode}`;
  return s;
}
// ─── 無反射の壁 ───
//  ★壁を solid（固定端）にすると必ず反射する。無反射の壁は「中へ入るほど損失が強くなる
//    媒質」として表す＝領域の縁の吸収層（f.sig）とまったく同じ作りで、それを物体の形に
//    貼る。損失を一様に与えると入口でインピーダンスが飛んで反射するので、壁の面からの
//    深さ d に対して σ(d) = WAVE_WSIG·(min(d/L,1))^WAVE_WRAMP と滑らかに立ち上げる。
//  ★立ち上がり長 L は λ（= WAVE_CPL セル）。dx = λ/WAVE_CPL なので、振動数を変えて
//    波長が変わっても壁の効き方（反射率・透過率）は変わらない。
//  ★深さは「壁の外までの距離」なので、壁の中央で最大になり反対の面へ向かって 0 に戻る
//    ＝どちらの面から当たっても同じに効く（片面だけの吸音材にはしない）。
//  実測（平面波の列を厚さ t の壁に当て、手前1λの区間と後方の RMS を 300tick の時間平均で
//    読み、壁なしの対照で割る。λ=1m）。反射率は定在波比から (max−min)/(max+min)：
//      t=1λ  反射 0.043 / 透過 0.379     ← 薄すぎる。素通しに近い
//      t=2λ  反射 0.025 / 透過 0.012
//      t=3λ  反射 0.025 / 透過 0.006
//    立ち上がり長 L を λ/2 にすると t=2λ でも反射 0.121、σ を 1.0 まで上げると 0.062 と
//    どちらも悪化する（損失が急に立つほど入口で反射する）。**壁は 2λ 以上の厚みを取ること。**
//    比較：同じ厚さの固定端の壁は反射 0.864。
function waveStampAbsorbers(list) {
  const f = waveField, W = f.W, H = f.H;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const b of list) {                      // 対象の外接矩形（±1 セルの余白＝「外側」の種）
    const a = b._aabb;
    i0 = Math.min(i0, Math.floor((a.minX - f.ox) / f.dx) - 1);
    i1 = Math.max(i1, Math.ceil ((a.maxX - f.ox) / f.dx) + 1);
    j0 = Math.min(j0, Math.floor((a.minY - f.oy) / f.dx) - 1);
    j1 = Math.max(j1, Math.ceil ((a.maxY - f.oy) / f.dx) + 1);
  }
  i0 = Math.max(0, i0); i1 = Math.min(W - 1, i1);
  j0 = Math.max(0, j0); j1 = Math.min(H - 1, j1);
  if (i1 < i0 || j1 < j0) return;
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  const INF = 1e9, d = new Float32Array(w * h);
  for (const b of list) {
    const a = b._aabb;
    const bi0 = Math.max(i0, Math.floor((a.minX - f.ox) / f.dx) - 1);
    const bi1 = Math.min(i1, Math.ceil ((a.maxX - f.ox) / f.dx) + 1);
    const bj0 = Math.max(j0, Math.floor((a.minY - f.oy) / f.dx) - 1);
    const bj1 = Math.min(j1, Math.ceil ((a.maxY - f.oy) / f.dx) + 1);
    for (let j = bj0; j <= bj1; j++) {
      const wy = waveCellY(j), r = (j - j0) * w - i0;
      for (let i = bi0; i <= bi1; i++)
        if (b.containsPoint(waveCellX(i), wy)) d[r + i] = INF;
    }
  }
  // 壁の外までの距離（2パスのチャンファ距離。斜めは √2）
  const S = Math.SQRT2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (d[k] === 0) continue;
    let v = d[k];
    if (i > 0)            v = Math.min(v, d[k-1] + 1);
    if (j > 0)            v = Math.min(v, d[k-w] + 1);
    if (j > 0 && i > 0)   v = Math.min(v, d[k-w-1] + S);
    if (j > 0 && i < w-1) v = Math.min(v, d[k-w+1] + S);
    d[k] = v;
  }
  const L = WAVE_CPL;                           // 立ち上がり長 [cells] = λ（dx = λ/WAVE_CPL）
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i;
    if (d[k] === 0) continue;
    let v = d[k];
    if (i < w-1)            v = Math.min(v, d[k+1] + 1);
    if (j < h-1)            v = Math.min(v, d[k+w] + 1);
    if (j < h-1 && i < w-1) v = Math.min(v, d[k+w+1] + S);
    if (j < h-1 && i > 0)   v = Math.min(v, d[k+w-1] + S);
    d[k] = v;
    const t = v >= L ? 1 : v / L;
    f.damp[(j + j0) * W + i + i0] = WAVE_WSIG * Math.pow(t, WAVE_WRAMP);
  }
}
function waveRasterize() {
  const f = waveField;
  f.cRel2.fill(1); f.solid.fill(0);
  f.hasFree = false; f.cMaxRel = 1;
  // ★無反射の壁が1枚も無いなら damp は触らない。触ると A・B（格子1枚ぶん）を組み直す
  //   ことになり、波源が動くだけで毎フレーム地形を焼き直しているシーンでは丸損になる。
  const hadAbs = f.hasAbsorb;
  if (hadAbs) f.damp.fill(0);
  const c0 = Math.max(0.01, world.waveSpeed);
  const em = f.emitters;
  const absList = [];
  for (const b of objects) {
    const m = b.waveMode || 'pass';
    if (m === 'pass') continue;
    if (em.has(b.id)) continue;        // 波源を抱えた壁は素通しにする（em は fixed/free のみ）
    if (m === 'absorb') { absList.push(b); continue; }
    const flag = m === 'fixed' ? 1 : m === 'free' ? 2 : 0;
    const rel = flag ? 0 : 1 / Math.max(0.1, b.waveIor || 1.5);   // n = c₀/v ⇒ rel = v/c₀ = 1/n
    if (flag === 2) f.hasFree = true;
    if (!flag && rel > f.cMaxRel) f.cMaxRel = rel;
    const a = b._aabb;
    let i0 = Math.max(0, Math.floor((a.minX - f.ox) / f.dx) - 1);
    let i1 = Math.min(f.W - 1, Math.ceil((a.maxX - f.ox) / f.dx) + 1);
    let j0 = Math.max(0, Math.floor((a.minY - f.oy) / f.dx) - 1);
    let j1 = Math.min(f.H - 1, Math.ceil((a.maxY - f.oy) / f.dx) + 1);
    const rel2 = rel * rel;
    for (let j = j0; j <= j1; j++) {
      const wy = waveCellY(j), r = j * f.W;
      for (let i = i0; i <= i1; i++) {
        if (!b.containsPoint(waveCellX(i), wy)) continue;
        if (flag) f.solid[r + i] = flag; else f.cRel2[r + i] = rel2;
      }
    }
  }
  if (world.terrain && ground.waveMode !== 'pass') {
    const flag = ground.waveMode === 'fixed' ? 1 : 2;
    if (flag === 2) f.hasFree = true;
    for (let j = 0; j < f.H; j++) {
      const wy = waveCellY(j), r = j * f.W;
      for (let i = 0; i < f.W; i++)
        if (signedDistToGround(waveCellX(i), wy) < 0) f.solid[r + i] = flag;
    }
  }
  f.hasAbsorb = absList.length > 0;
  if (f.hasAbsorb) waveStampAbsorbers(absList);
  if (hadAbs || f.hasAbsorb) f.coefDirty = true;
}
function waveStep(a) {     // a: フレーム内でのこのステップの位置 0<a≤1（波源位置の補間に使う）
  const f = waveField;
  const W = f.W, H = f.H, u = f.u, up = f.up, un = f.un;
  const A = f.A, B = f.B, cR = f.cRel2, sd = f.solid;
  const S0 = WAVE_S_MAX / f.cMaxRel, S0sq = S0 * S0;
  if (f.hasFree) {
    // 自由端（∂u/∂n = 0）は「隣が自由端セルなら自分の値で置き換える」ことで表す
    for (let j = 1; j < H - 1; j++) {
      const r = j * W;
      for (let i = 1; i < W - 1; i++) {
        const k = r + i;
        if (sd[k]) { un[k] = 0; continue; }
        const c = u[k];
        const lap = (sd[k-1]===2?c:u[k-1]) + (sd[k+1]===2?c:u[k+1])
                  + (sd[k-W]===2?c:u[k-W]) + (sd[k+W]===2?c:u[k+W]) - 4*c;
        un[k] = (2*c - B[k]*up[k] + S0sq*cR[k]*lap) * A[k];
      }
    }
  } else {
    for (let j = 1; j < H - 1; j++) {
      const r = j * W;
      for (let i = 1; i < W - 1; i++) {
        const k = r + i;
        if (sd[k]) { un[k] = 0; continue; }
        const c = u[k];
        un[k] = (2*c - B[k]*up[k] + S0sq*cR[k]*(u[k-1]+u[k+1]+u[k-W]+u[k+W]-4*c)) * A[k];
      }
    }
  }
  for (let i = 0; i < W; i++) { un[i] = 0; un[(H-1)*W + i] = 0; }
  for (let j = 0; j < H; j++) { un[j*W] = 0; un[j*W + W - 1] = 0; }
  f.up = u; f.u = un; f.un = up;
  f.t += f.wdt;

  for (const s of waveSources) {
    if (!s.enabled || s.amp <= 0) continue;
    const val = waveSourceValue(s, f);
    if (val === null) continue;            // リモコンで止めている（注入しない＝素通しの水面）
    const o = s.getOrigin();
    const px = s._pox !== undefined ? s._pox : o.x;
    const py = s._poy !== undefined ? s._poy : o.y;
    waveInject(px + (o.x - px) * a, py + (o.y - py) * a, val);
  }
}
// ─── 波源がいま押し付ける変位（null＝出していない）───
//   リモコンの〈押している間だけ波を出す〉（remote.js の 'emit'。2026-10-03）。印は
//   s._remoteHold（0/1/−1。undefined＝リモコンなし＝いつもどおり鳴り続ける）。
//   ★止めている間は「0 を押し付ける」のではなく**注入そのものをやめる**。0 を押し付けると
//     波源の点が水面に打った杭になり、ほかの波源から来た波をそこで散らしてしまう。
//   ★止めていても waveActiveSources からは外さない。外すと最後の1つを止めた瞬間に
//     格子が畳まれ（waveEnsureGrid が false）、出したばかりのパルスが画面から消える。
//   ★出し始めと出し終わりは **sin(ωt+φ) が 0 を通る瞬間**にそろえる。
//     ・門をいきなり開け閉めすると、注入する値が 0 と A·sin のあいだで一気に跳び、
//       段差から全振動数の波（輪のノイズ）が出る。
//     ・時刻の原点を「押した瞬間」に取り直す手も試したが捨てた：押すたびに位相が
//       ずれるので、ほかの波源と位相をそろえて鳴らす使い方（ノイズキャンセルの打ち消し側を
//       〈押している間だけ止める〉にする）で、離した後に打ち消しが二度と合わなくなった。
//     そこで、押したら次の上向きの 0（位相が 2π の倍数を越える瞬間）まで待って出し始め、
//     放したら今の半周期の終わり（次の 0）まで出してから止める。待ちは最大1周期。
//     これで「短く押すと山1つ（半波長のパルス）」になり、位相 φ も鳴り続ける波源と同じ意味を保つ。
//   ★〈逆向きに効かせる〉（−1）は符号を返す＝谷から出す。
//   ★1発の山は、通り過ぎたあとに同じ符号の**尾**を残す（2次元の波動方程式の性質で、
//     グリーン関数が波面の内側で 0 に戻らない）。実測：列から 3.2m で 山 0.30 → 1秒後 0.16 →
//     5秒後 0.055。1波長（山と谷）にしても符号が変わるだけで同じ桁。山1つを「見せる」
//     デモには向かない（demoWaveReflectLaw の★）。鳴らし続ける・止めるの切り替えには効く。
function waveSourceValue(s, f) {
  const g = s._remoteHold;
  const ph = 2*Math.PI*s.freq*f.t + s.phase;
  if (g === undefined && !s._emitOn && !s._emitArm) return s.amp * Math.sin(ph);   // リモコンなし
  // ★押したことは「次の 0 まで」覚えておく（_emitArm）。0 を待つ間に放しても取り消さない：
  //   1 tick だけの短い押しでも、必ず山が1つ出る（覚えないと、押した tick に 0 が来たときだけ
  //   出る＝出たり出なかったりする）。
  if (g) { s._emitArm = g; s._emitEnd = null; }            // 押し直したら終わりの予約も消す
  if (!s._emitOn) {
    if (!s._emitArm) return null;
    const prev = ph - 2*Math.PI*s.freq*f.wdt;
    if (Math.floor(ph / (2*Math.PI)) === Math.floor(prev / (2*Math.PI))) return null;   // 0 を待つ
    s._emitOn = true; s._emitSign = s._emitArm;
  }
  if (!g) {                                                // 放している：今の半周期で終える
    s._emitArm = 0;
    if (s._emitEnd == null) s._emitEnd = (Math.floor(ph / Math.PI) + 1) * Math.PI;
    if (ph >= s._emitEnd) { s._emitOn = false; s._emitEnd = null; return null; }
  }
  return s._emitSign * s.amp * Math.sin(ph);
}
function waveRefFreq() {
  let fr = 0;
  for (const s of waveActiveSources()) if (s.freq > fr) fr = s.freq;
  return fr > 0 ? fr : 1;
}
function updateWaveField(dt) {
  const f = waveField;
  waveUpdateTrail();
  if (!waveEnsureGrid()) return;
  f.emitters = waveEmitterBodies();     // ★geoKey とラスタライズの両方が同じ判定を使う
  const gk = waveGeoKey();
  if (gk !== f.geoKey) { f.geoKey = gk; waveRasterize(); }
  f.wdt = WAVE_S_MAX * (f.dx * PX2M) / (Math.max(0.01, world.waveSpeed) * f.cMaxRel);
  waveUpdateCoef();
  // ★〈波を出す〉の押しはここで tick ごとに受け取る（waveSourceValue の _emitArm）。
  //   振動数が低いと格子が粗く、場の1ステップ（wdt）が 1 tick より長くなるので、
  //   場を1歩も進めない tick がある。押した tick がそれに当たると、押しが届かずに
  //   消えていた（実測：f=1.3Hz で 1 tick の押しが何も出さなかった）。
  for (const s of waveSources) if (s._remoteHold) { s._emitArm = s._remoteHold; s._emitEnd = null; }
  f.acc += dt;
  let n = Math.floor(f.acc / f.wdt);
  const lim = Math.max(1, f.sub * 2);
  if (n > lim) { n = lim; f.acc = 0; } else f.acc -= n * f.wdt;
  for (let s = 0; s < n; s++) waveStep((s + 1) / n);
  if (n > 0) for (const s of waveSources) { const o = s.getOrigin(); s._pox = o.x; s._poy = o.y; }
}
function resetWaveField() {
  const f = waveField;
  if (f.u) { f.u.fill(0); f.up.fill(0); f.un.fill(0); }
  f.t = 0; f.acc = 0;
  waveTrail.length = 0;                    // ★波が消えたので軌跡も捨てる
  for (const s of waveSources) { s._pox = undefined; s._poy = undefined; s._emitOn = false; s._emitArm = 0; s._emitEnd = null; }
}
// ─── 描画 ───
//   単色の濃淡ではなく発散配色（赤＝山／青＝谷）。|u| にすると山と谷が同じ色になり、
//   見かけの振動数が2倍になって定在波の節も読めなくなる。
function drawWaveField() {
  const f = waveField;
  if (!world.showWaveField || !f.u || !waveActiveSources().length) return;
  const W = f.W, u = f.u, up = f.up, d = f.img.data;
  const IW = f.canvas.width, IH = f.canvas.height;
  const omega = 2 * Math.PI * waveRefFreq();
  const invW = 1 / (f.wdt * omega);
  const mode = world.waveViewMode;
  const thr = 1 - Math.max(0.01, Math.min(0.6, world.waveCrestWidth));
  const gain = world.waveViewGain, vmin = world.waveVisMin;
  // ★画面に映る範囲だけを塗る。格子は「波が見えなくなる半径」まで広げてあるので
  //   （waveVisibleRadiusM）、たいていは画面よりずっと大きい。全セルを塗って1枚に
  //   合成しても、はみ出したぶんはキャンバスの外で捨てられる＝丸ごと無駄になる。
  //   実測（ドップラーのデモ：格子 1104×1104、倍率 0.35）：全面 24.0 ms に対し、
  //   映るのは 12.6% で 3.4 ms。見えるものは1画素も変わらない。
  //   ★カメラが回っていても正しいよう、画面の四隅を格子座標へ移してその外接矩形を取る。
  const vis = waveVisibleIndexRect(f);
  if (!vis) return;
  const { i0, j0, i1, j1 } = vis;
  for (let j = j0; j <= j1; j++) {
    const r = j * W;
    let p = (j * IW + i0) * 4;
    for (let i = i0; i <= i1; i++, p += 4) {
      const k = r + i;
      if (f.solid[k]) { d[p+3] = 0; continue; }
      const uk = u[k];
      if (mode === 'field') {
        const v = uk * gain;
        const a = v < 0 ? -v : v;
        // ★飽和したその先も見せる。濃さ（不透明度）は |u|·倍率 が 1 で振り切れてしまうので、
        //   そこから上は色を白へ寄せる。波がいくつも重なって強くなっている場所——衝撃波の
        //   円錐・干渉の腹・焦点——が「白いところ」として1目盛り上に出る。
        //   実測（マッハ2の衝撃波、倍率4）：円錐の縁 |u|=0.688 で 2.75、すぐ内側 0.43 で
        //   1.72、後方のふつうの波は 0.06〜0.23 で 0.24〜0.92（＝白くならない）。
        //   ★超過ぶんを WAVE_HOT で割る。2 は「縁が白くなり、内側は白みがかる」値。
        const t = a > 1 ? Math.min(1, (a - 1) / WAVE_HOT) : 0;
        if (v >= 0) { d[p]=255;             d[p+1]=90 +165*t;  d[p+2]=70 +185*t; }
        else        { d[p]=70 +185*t;       d[p+1]=140+115*t;  d[p+2]=255;       }
        // ★この目盛りは「背景 ⇄ 色」の**明るさ**のグラデーションで、それ以上にはできない。
        //   重ね描きなので u≒0 は透明＝背景がそのまま出る。だから見た目は赤・青・黒の
        //   3色に読める。中間に見える色を置こうとすると場を不透明にするしかなく、実測で
        //   どれも悪化した：
        //     ・飽和を丸める（α = 1−e^{−a}）… 見た目がほぼ変わらない
        //     ・表示の強さを 6→2 … 遠方が消えて、いちばん読ませたい節線が読めなくなる
        //     ・不透明な発散配色（谷=青／凪=灰／山=赤、α一定）… 場が本文と目盛りを
        //       塗りつぶし、FPS も 55→40 に落ちた（全セルを塗るので透明の早抜けが効かない）
        //   濃さの当たりを動かしたいときは「表示の強さ」（waveViewGain）で調整する。
        d[p+3] = Math.round(Math.min(1, a) * 225);
        continue;
      }
      // 包絡線 A = √(u² + (u̇/ω)²)。単一振動数なら厳密で、状態を持たずに済む
      //   ★ここでいう ω は波源の振動数（waveRefFreq）。だから「動く波源」では合わない——
      //     ドップラーでずれた分だけ env が狂い、セルごとにばらついて帯が点々に割れる
      //     （実測：マッハ2の円錐を 'crest' で拡大すると、円弧が読めない斑点の雲になる）。
      //     動く波源を見せるデモは 'field'（u をそのまま塗る）を使うこと。あちらは
      //     振動数を仮定しないので、速く動いても円弧はなめらかなまま出る。
      const vk = (uk - up[k]) * invW;
      const env = Math.sqrt(uk*uk + vk*vk);
      if (env < vmin) { d[p+3] = 0; continue; }   // ★弱い波（境界の残留反射など）を拾わない
      const cph = uk / env;                        // = cos(位相)
      let a;
      if (mode === 'crest')       a = cph >=  thr ? ( cph - thr) / (1 - thr) : 0;
      else if (mode === 'trough') a = cph <= -thr ? (-cph - thr) / (1 - thr) : 0;
      else                        a = Math.abs(cph) >= thr ? (Math.abs(cph) - thr) / (1 - thr) : 0;
      if (a <= 0) { d[p+3] = 0; continue; }
      if (uk >= 0) { d[p]=255; d[p+1]=120; d[p+2]=90;  }   // 山
      else         { d[p]=90;  d[p+1]=170; d[p+2]=255; }   // 谷
      d[p+3] = Math.round(Math.min(1, a * Math.min(1, env * gain)) * 255);
    }
  }
  // ★転送も塗った矩形だけ。範囲外には前のフレームの塗り残しがあるので、貼るときも
  //   同じ矩形を切り出す（切り出さないと、カメラを動かした瞬間に古い波が見える）。
  const vw = i1 - i0 + 1, vh = j1 - j0 + 1;
  f.cctx.putImageData(f.img, 0, 0, i0, j0, vw, vh);
  // ★格子はワールドに貼り付いているので、カメラを回したぶんだけこの絵も回す
  //   （画面に沿って貼ると、波だけ回らず物体と食い違う）。cam.angle が 0 なら rotate(0)。
  const a0 = worldToScreen(f.ox + i0 * f.dx, f.oy + j0 * f.dx);
  const sw = vw * f.dx * cam.zoom, sh = vh * f.dx * cam.zoom;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.translate(a0.x, a0.y);
  ctx.rotate(cam.angle);
  ctx.drawImage(f.canvas, i0, j0, vw, vh, 0, 0, sw, sh);
  ctx.restore();
}
// 画面に映っている格子の添字の範囲（外接矩形）。★カメラの回転も込みで四隅から作る。
//   1セルぶん外へ広げるのは、端の画素が拡大されて画面のふちに掛かるため。
function waveVisibleIndexRect(f) {
  let mnI = Infinity, mnJ = Infinity, mxI = -Infinity, mxJ = -Infinity;
  for (const [sx, sy] of [[0, 0], [canvas.width, 0], [0, canvas.height], [canvas.width, canvas.height]]) {
    const w = screenToWorld(sx, sy);
    const gi = (w.x - f.ox) / f.dx, gj = (w.y - f.oy) / f.dx;
    if (gi < mnI) mnI = gi;  if (gi > mxI) mxI = gi;
    if (gj < mnJ) mnJ = gj;  if (gj > mxJ) mxJ = gj;
  }
  const i0 = Math.max(0, Math.floor(mnI) - 1), i1 = Math.min(f.W - 1, Math.ceil(mxI) + 1);
  const j0 = Math.max(0, Math.floor(mnJ) - 1), j1 = Math.min(f.H - 1, Math.ceil(mxJ) + 1);
  if (i1 < i0 || j1 < j0) return null;              // 格子が画面の外（何も描かない）
  return { i0, j0, i1, j1 };
}
// 波源のマーカーは場の計算・表示とは切り離して常に描く。
//   場のバッファ（f.u）は最初の再生で初めて確保されるので、これを drawWaveField() の
//   中に置くと「起動直後に置いた波源が、再生するまで見えない」ことになる。
//   波動場の表示をOFFにしたときや、停止中・振幅0の波源も、置いた場所は見えるべき。
function drawWaveSourceMarkers() {
  if (!waveSources.length) return;
  ctx.save();
  ctx.setLineDash([]);
  for (const s of waveSources) {
    const o = s.getOrigin(), sp = worldToScreen(o.x, o.y);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 5, 0, Math.PI*2);
    // ★リモコンで止めている波源も灰色にする（いま出ているかが印で分かる。waveSourceValue）
    const quiet = s._remoteHold !== undefined && !s._remoteHold && !s._emitOn;
    ctx.fillStyle = (s.enabled && !quiet) ? '#4dd0e1' : '#607d8b';
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    if (selectedElemIds.has(s.id)) {                  // ★範囲選択に入っている印
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 9, 0, Math.PI*2);
      ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  ctx.restore();
}
// ─── 全体設定タブからの設定 ───
function setWaveSpeed(v) {
  world.waveSpeed = Math.max(0.1, Math.min(8, parseFloat(v) || 2));
  waveField.geoKey = '';
  const s = (selectedElement && selectedElement.kind === 'wave') ? selectedElement.source : null;
  if (s) { const el = document.getElementById('ws-lambda'); if (el && document.activeElement !== el) el.value = s.wavelength().toFixed(3); }
  refreshWaveInfo();
}
function setWaveAbsorb(v) {
  world.waveAbsorb = Math.max(WAVE_ABS_MIN, Math.min(0.2, parseFloat(v) || 0.15));
  waveField.absKey = NaN; refreshWaveInfo();
}
function setWaveViewMode(v) { world.waveViewMode = v; }
function setWaveCrestWidth(v) { world.waveCrestWidth = Math.max(0.01, Math.min(0.6, (parseFloat(v)||12)/100)); }
function setWaveVisMin(v) { world.waveVisMin = Math.max(0.005, Math.min(0.2, (parseFloat(v)||2)/100)); refreshWaveInfo(); }
function setWaveBudget(v) { world.waveBudget = Math.max(0.1, parseFloat(v) || 0.8); refreshWaveInfo(); }
// 1波長あたりのセル数は数値精度の生命線なので、常に見えるところに出す
function refreshWaveInfo() {
  // 全体設定タブ・波源のプロパティ・シミュレーションメニューの設定ウィンドウの3か所
  const els = ['w-wave-info', 'wf-wave-info', 'sp-wave-info'].map(id => document.getElementById(id)).filter(Boolean);
  if (!els.length) return;
  let html;
  if (!waveActiveSources().length) { html = '波源がありません。'; }
  else {
    const L = waveComputeLayout();
    const cells = L.W * L.H, work = cells * L.sub;
    const cpl = toPx(world.waveSpeed / waveRefFreq()) / L.dx;
    const ms = work * WAVE_NS_CELL / 1e6;
    let s = `格子 <b>${(L.dx*PX2M).toFixed(3)}</b> m/セル・${L.W}×${L.H}<br>`;
    s += `1波長あたり <b>${cpl.toFixed(1)}</b> セル`;
    if (cpl < WAVE_MIN_CPL) s += ' <span style="color:#ffa726">（波面がゆがみます）</span>';
    else if (cpl < 15) s += ' <span style="color:#ffca28">（15以上を推奨）</span>';
    s += `<br>波の到達半径 <b>${(L.R*PX2M).toFixed(1)}</b> m`;
    if (L.capped) s += ' <span style="color:#ffa726">（上限で切られています）</span>';
    s += `<br>${L.sub} ステップ/フレーム・目安 <b>${ms.toFixed(1)}</b> ms`;
    html = s;
  }
  for (const el of els) el.innerHTML = html;
}

// ─── Infinite Ground ─────────────────
