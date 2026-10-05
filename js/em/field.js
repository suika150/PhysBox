// ════════════════════════════════════════
//  電場・磁場の領域（EMField）
//   一様な世界全体の場ではなく「置いた矩形の内側だけに場がある」オブジェクト。
//   高校物理の定番（磁場領域へ荷電粒子を入射して円弧を描かせる／速度選別器／
//   磁場を横切る導体棒の誘導起電力）は、場が有限の領域であることが前提なので、
//   世界全体の一様場では作れない。
//   重なった領域は足す（重ね合わせ）。E領域とB領域を重ねれば速度選別器になる。
// ════════════════════════════════════════
const EMFIELD_COLOR = { E: '#ffca28', B: '#81c784' };
// 向きは内部座標（y下向き）の角度で持つ。UIは長らく上下左右の4ボタンだったが、
// 内部が角度なので、UI（数値欄・スライダー・プリセット）を足すだけで任意角に対応できた。
// 電場の向きのプリセット（表示角[°]。右0°・反時計回りが正＝_dispDeg と同じ流儀）。
//   角度そのものは数値欄とスライダーで自由に決められる。ここにあるのは近道。
//   2列グリッドに読み順で並べると反時計回りに一周する。
const EMFIELD_ANGLE_PRESETS = [
  { deg:    0, label: '→ 0°'    }, { deg:   45, label: '↗ 45°'   },
  { deg:   90, label: '↑ 90°'   }, { deg:  135, label: '↖ 135°'  },
  { deg:  180, label: '← 180°'  }, { deg: -135, label: '↙ -135°' },
  { deg:  -90, label: '↓ -90°'  }, { deg:  -45, label: '↘ -45°'  },
];
// 強さスライダーの範囲。電場[V/m]と磁場[T]で桁が違うので、選択した種類で差し替える
const EMFIELD_STRENGTH_RANGE = { E: { hi: 50, step: 0.5 }, B: { hi: 5, step: 0.05 } };
// 振動数つまみの範囲 [Hz]（0＝直流）
const EMFIELD_FREQ_MAX = 2, EMFIELD_FREQ_STEP = 0.01;
class EMField {
  constructor(opts) {
    opts = opts || {};
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.kind = opts.kind === 'B' ? 'B' : 'E';        // 'E'=電場 / 'B'=磁場
    this.x = opts.x || 0;  this.y = opts.y || 0;      // 領域の中心 [px]
    this.w = Math.max(4, opts.w || 200);              // 幅・高さ [px]
    this.h = Math.max(4, opts.h || 200);
    // 強さ。E は [V/m]、B は [T]。符号は持たせず、向きで表す（教材として迷わないように）
    this.strength = opts.strength !== undefined ? Math.abs(opts.strength)
                                                : (this.kind === 'B' ? 0.5 : 5);
    this.angle = opts.angle !== undefined ? opts.angle : -Math.PI/2;   // E の向き（既定＝上）
    this.out = opts.out !== undefined ? !!opts.out : true;             // B が紙面から出る向きか
    // 振動数 [Hz]。0＝直流（いつも strength）、正なら E(t) = strength·sin(位相) で振れ、
    //   負の半周期は向きが反転する＝交流電源（記号の回路の acsource の V·sin(2πft) と同じ形）。
    //   ★電場だけ。磁場を時間で変えると、そのまわりに誘導電場（ファラデーの法則）が
    //     生じるはずだが、この領域は矩形の内側に一様な場を置くだけでそれを作れない。
    //     振れる磁場だけを置くと「磁場が変わっても何も起きない」嘘の世界になる。
    //   ★位相は時刻から計算せず、サブステップごとに 2πf·h ずつ積み上げる（advanceEMFieldPhases）。
    //     sin(2πf·simTime) にすると、走らせたまま振動数のつまみを回した瞬間に位相が飛び、
    //     電場が 1 tick で −E から +E へ跳ねる。積み上げなら、どの振動数に変えても今の値から
    //     なめらかに続く。
    this.freq = opts.freq > 0 ? opts.freq : 0;
    this.acPhase = opts.acPhase || 0;                                  // [rad]
  }
  // いまの振れ（−1〜1）。直流と磁場は 1。ahead [s] を渡すと先読み（predict.js の予測軌道用）
  acFactor(ahead) {
    if (this.kind !== 'E' || this.freq <= 0) return 1;
    return Math.sin(this.acPhase + (ahead ? 2*Math.PI*this.freq*ahead : 0));
  }
  contains(x, y) {
    return Math.abs(x - this.x) <= this.w/2 && Math.abs(y - this.y) <= this.h/2;
  }
  ex(ahead) { return this.kind === 'E' ? this.strength * this.acFactor(ahead) * Math.cos(this.angle) : 0; }
  ey(ahead) { return this.kind === 'E' ? this.strength * this.acFactor(ahead) * Math.sin(this.angle) : 0; }   // 内部y下向き正
  // ★「紙面から手前へ出る向き（⊙）」を正とする。画面の見た目に合わせた表記なので、
  //   外積を取る計算にそのまま渡してはいけない（下の bzRightHanded を必ず通すこと）。
  bz() { return this.kind === 'B' ? (this.out ? this.strength : -this.strength) : 0; }
  // 電場は任意角を取れるので、角度そのものを出す（矢印は最も近い8方向の目安）。
  //   4方向の名前だけを返していた頃は、斜めの向きが「↑ 上」と表示されて嘘になっていた。
  dirName() {
    if (this.kind === 'B') return this.out ? '表向き（紙面から出る）' : '裏向き（紙面へ入る）';
    const deg = _dispDeg(this.angle);                 // 右0°・反時計回りが正
    const arrows = ['→','↗','↑','↖','←','↙','↓','↘'];
    const k = ((Math.round(deg / 45) % 8) + 8) % 8;
    return `${arrows[k]} ${deg.toFixed(1)}°`;
  }
}
// ★磁場の符号を「表示の向き」から「計算の向き」へ直す。外積を取る直前に必ず通すこと。
//   bz() は ⊙（紙面から手前へ出る）を正としている。画面の記号と一致していて読みやすいが、
//   これは右手系の z 成分ではない：内部座標は x=右・y=下 なので、この2軸で右手系を作ると
//   z 軸は紙面の「奥」を向く（右×下＝奥）。つまり表示の正と右手系の正は逆である。
//   ローレンツ力 F = qv×B を2次元の式へ落とすときに使えるのは右手系の z 成分だけなので、
//   ここで符号を反転する。これを省くと力が丸ごと逆を向く——正電荷が右へ動いて ⊙ の中にいる
//   とき、正しくは下へ曲がる（x̂×ẑ=−ŷ）ところを上へ曲がってしまう。
//   ※導体棒（buildRods / applyRodForces）は、この変換を通していないのが正しい。
//     あちらは perp = (−ay, ax) という90°回転を挟んでおり、y下向きの座標系では
//     この回転自体が手つきを反転させるので、表示用の Bz をそのまま使うと符号が合う。
//     数式で確認済み：emf = B·L·(v·perp) は −∫(v×B)·dl（a→b）に厳密に一致し、
//     vStamp の規約（V_a − V_b = emf）と噛み合って正しい極性になる。同様に
//     F = B·I·L·perp も I·L×B に厳密に一致する。ここへ bzRightHanded を足すと
//     二重に反転して、起電力と電流の向きが逆になる。
const bzRightHanded = bz => -bz;
// ─── 場のサンプリング（重ね合わせ）───────────────────
function emFieldAt(x, y, ahead) {
  let ex = 0, ey = 0, bz = 0;
  for (const f of emFields) {
    if (!f.contains(x, y)) continue;
    if (f.kind === 'E') { ex += f.ex(ahead); ey += f.ey(ahead); }
    else                  bz += f.bz();
  }
  bz += electromagnetBzAt(x, y);         // ★電磁石ぶん（荷電粒子もこれで曲がる）
  return { ex, ey, bz };
}
// 交流の位相を h [s] だけ進める。★step.js が integrate と EM の後ろ半分のあいだで呼ぶ：
//   速度ベルレの前半の力積は区間の頭の場、後半は区間の終わりの場で効かせる
//   （位置と同じく場も「新しい時刻で測り直す」）。区間の頭で進めると後半も頭の場のまま、
//   末尾で進めると前半も終わりの場になり、どちらも半刻みずれる。
function advanceEMFieldPhases(h) {
  for (const f of emFields) {
    if (f.kind !== 'E' || f.freq <= 0) continue;
    f.acPhase = (f.acPhase + 2*Math.PI*f.freq*h) % (2*Math.PI);
  }
}
function emBzAt(x, y) {
  let bz = 0;
  for (const f of emFields) if (f.kind === 'B' && f.contains(x, y)) bz += f.bz();
  return bz + electromagnetBzAt(x, y);   // ★電磁石がつくる磁場も重ね合わせる
}
// ★導体棒の上での磁場の平均。棒が領域に「一部だけ」入っている状態を正しく扱うため、
//   中点1点ではなく棒に沿って多点サンプリングする。1点だと領域の縁で起電力が
//   カクッと不連続に切り替わり、「棒が磁場に入りかけのときは起電力が徐々に立つ」
//   という肝心の現象（レンツの法則の観察）が出ない。
const EM_ROD_SAMPLES = 12;
function emBzAlong(ax, ay, bx, by) {
  let s = 0;
  for (let i = 0; i < EM_ROD_SAMPLES; i++) {
    const t = (i + 0.5) / EM_ROD_SAMPLES;
    s += emBzAt(ax + (bx - ax) * t, ay + (by - ay) * t);
  }
  return s / EM_ROD_SAMPLES;
}
// ─── 当たり判定（面なので「他に何も当たらなかったとき」だけ拾う）───
//   ★重なった領域はどちらの場も同じだけ効く（重ね合わせ）ので、並び順は
//     「重なったときどちらを選ぶか」だけの意味しか持たない。オブジェタブの一覧で
//     上にあるもの＝配列の先頭を優先する。描画も先頭が手前になるよう逆順で描く。
function emFieldAtPoint(x, y) {
  for (const f of emFields) if (f.contains(x, y)) return f;
  return null;
}
// ★左クリックで拾うのは「枠のそば」だけ。領域は面が広いので、内側のどこでも選ばれると
//   その広さ全域で範囲選択も選択解除もできなくなる（磁場を大きく置くと画面のほとんどが
//   埋まる）。地面が「表面から4px以内でだけ選べる」のと同じ流儀に揃える。
//   枠が画面外に出るほど大きい領域のために、内側のダブルクリックでも選べる（mouse.js）。
const EMFIELD_EDGE_PX = 6;      // 枠の当たり幅[画面px]
function emFieldEdgeAtPoint(x, y) {
  const tol = EMFIELD_EDGE_PX / cam.zoom;
  for (const f of emFields) {
    const dx = Math.abs(x - f.x) - f.w/2, dy = Math.abs(y - f.y) - f.h/2;
    // 矩形の輪郭までの距離。内側なら最も近い辺まで、外側なら通常のAABB距離
    const d = (dx > 0 || dy > 0) ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
                                 : -Math.max(dx, dy);
    if (d <= tol) return f;
  }
  return null;
}
// ─── 選択中の領域のサイズ変更（角と辺のハンドル）───────────────
//   領域は軸に沿った矩形なので、辺のハンドルで幅・高さを別々に、角で両方を変えられる。
//   掴んだ辺の反対側は動かさない（つまんだ側だけが伸び縮みする）。
const EMF_HANDLE_HIT = 9;      // 掴み判定の半径[画面px]
const EMFIELD_MIN_PX = 8;      // 潰れてハンドルを掴めなくならないための最小サイズ[px]
let emFieldResize = null;      // {field, sx, sy, fixX, fixY, armed}
function selectedEMField() {
  return (selectedElement && selectedElement.kind === 'emfield') ? selectedElement.field : null;
}
// ★ハンドルの仕組みは「軸に沿った矩形の領域」なら同じなので、加熱・冷却の領域
//   （js/physics/heat-field.js）とも共有する。種類ごとに違うのは、大きさを変えている
//   あいだ追従させる右パネルの欄だけ。
function selectedRectRegion() { return selectedEMField() || selectedHeatField() || selectedFlowField(); }
function refreshRectRegionGeomFields(f) {
  if (heatFields.includes(f))      refreshHeatFieldGeomFields(f);
  else if (flowFields.includes(f)) refreshFlowFieldGeomFields(f);
  else                             refreshEMFieldGeomFields(f);
}
function updateRectRegionPanel(f) {
  if (heatFields.includes(f)) updateHeatFieldPanel(f);
  else if (flowFields.includes(f)) updateFlowFieldPanel(f);
  else if (emFields.includes(f)) updateEMFieldPanel(f);
}
function emFieldHandles(f) {
  const a = worldToScreen(f.x - f.w/2, f.y - f.h/2);
  const b = worldToScreen(f.x + f.w/2, f.y + f.h/2);
  const x0 = Math.min(a.x,b.x), x1 = Math.max(a.x,b.x);
  const y0 = Math.min(a.y,b.y), y1 = Math.max(a.y,b.y);
  const mx = (x0+x1)/2, my = (y0+y1)/2;
  return [ { sx:-1,sy:-1,x:x0,y:y0 }, { sx: 0,sy:-1,x:mx,y:y0 }, { sx: 1,sy:-1,x:x1,y:y0 },
           { sx: 1,sy: 0,x:x1,y:my }, { sx: 1,sy: 1,x:x1,y:y1 }, { sx: 0,sy: 1,x:mx,y:y1 },
           { sx:-1,sy: 1,x:x0,y:y1 }, { sx:-1,sy: 0,x:x0,y:my } ];
}
function beginEMFieldResizeIfHit(wp) {
  if (currentTool !== 'pointer') return false;
  const f = selectedRectRegion(); if (!f) return false;
  const sp = worldToScreen(wp.x, wp.y);
  for (const h of emFieldHandles(f)) {
    if ((sp.x-h.x)*(sp.x-h.x) + (sp.y-h.y)*(sp.y-h.y) > EMF_HANDLE_HIT*EMF_HANDLE_HIT) continue;
    emFieldResize = { field:f, sx:h.sx, sy:h.sy, armed:true,
                      fixX: f.x - h.sx*f.w/2, fixY: f.y - h.sy*f.h/2 };   // 動かさない側の辺
    return true;
  }
  return false;
}
function updateEMFieldResize(wp) {
  const d = emFieldResize, f = d.field;
  if (!emFields.includes(f) && !heatFields.includes(f) && !flowFields.includes(f)) { emFieldResize = null; return; }   // 途中で消された
  const p = snapPlace(wp);
  let nx = f.x, ny = f.y, nw = f.w, nh = f.h;
  // 固定辺からの符号つき距離。負まで引いても裏返らず、最小サイズで止まる
  if (d.sx) { const e = Math.max(EMFIELD_MIN_PX, (p.x - d.fixX) * d.sx); nw = e; nx = d.fixX + d.sx*e/2; }
  if (d.sy) { const e = Math.max(EMFIELD_MIN_PX, (p.y - d.fixY) * d.sy); nh = e; ny = d.fixY + d.sy*e/2; }
  if (nx===f.x && ny===f.y && nw===f.w && nh===f.h) return;
  if (d.armed) { pushUndo(); d.armed = false; }   // 実際に変わったときだけ履歴を積む
  f.x = nx; f.y = ny; f.w = nw; f.h = nh;
  refreshRectRegionGeomFields(f);                 // 右パネルの幅・高さ・中心を追従
  wakeAll();
}
function drawEMFieldResizeHandles() {
  const f = selectedRectRegion();
  if (!f || currentTool !== 'pointer') return;
  ctx.save();
  ctx.setLineDash([]);
  for (const h of emFieldHandles(f)) {
    ctx.beginPath(); ctx.rect(h.x-4, h.y-4, 8, 8);
    ctx.fillStyle = emFieldResize ? '#ffd54f' : '#4fc3f7'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (emFieldResize) {                            // 変更中は寸法を出す（下辺の外側）
    const p = worldToScreen(f.x - f.w/2, f.y + f.h/2);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#ffd54f'; ctx.textAlign = 'left';
    ctx.fillText(`${(f.w*PX2M).toFixed(2)} × ${(f.h*PX2M).toFixed(2)} m`, p.x, p.y + 14);
  }
  ctx.restore();
}
// ─── 描画（物体より下のレイヤー）───────────────────
function drawEMFields() {
  if (!world.showEMField || !emFields.length) return;
  ctx.save();
  // 配列の先頭ほど手前（＝重なったときに選ばれる側）になるよう後ろから描く
  for (let fi = emFields.length - 1; fi >= 0; fi--) {
    const f = emFields[fi];
    // ★ワールドの矩形として描く（カメラを回すと枠も一緒に傾く。scene.js の worldRectPath の★）
    const col = EMFIELD_COLOR[f.kind];
    const sel = selectedElement && selectedElement.kind === 'emfield' && selectedElement.field === f;
    const q = worldRectPath(ctx, f.x, f.y, f.w, f.h);
    ctx.fillStyle = hexToRgba(col, 0.07);
    ctx.fill();
    ctx.setLineDash(sel ? [] : [6, 4]);
    ctx.strokeStyle = sel ? '#4fc3f7' : hexToRgba(col, 0.55);
    ctx.lineWidth = sel ? 2.5 : 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
    if (f.strength > 0) _drawEMGlyphs(f, col);
    ctx.fillStyle = hexToRgba(col, 0.9);
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    // ★交流は振幅と振動数を書く（いまの値は矢印の長さと向きで見せる）
    //   ★有効数字4桁に丸める。つまみは刻みの値しか入れないが、コードで置いた値（B ＝ π など）は
    //     「3.141592653589793 T」とそのまま出て、隣の領域の札に掛かった（サイクロトロンのデモ）
    const n4 = v => +v.toPrecision(4);
    const lab = f.kind === 'B' ? `B = ${n4(f.strength)} T`
              : f.freq > 0     ? `E = ${n4(f.strength)} V/m · ${n4(f.freq)} Hz` : `E = ${n4(f.strength)} V/m`;
    ctx.fillText(lab, q[0].x + 4, q[0].y - 3);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}
// 領域の内側にだけグリフを敷く。E は矢印、B は ⊙（手前向き）／⊗（奥向き）
//   ★間隔はワールド座標で決める。画面px基準にすると、拡大するほど個数が増えて
//     上限に達し、「間引き」ではなく「全部消える」ことになる（実際そうなっていた）。
//     ワールド基準なら本数はズームによらず一定で、模様が流れることもない。
//     画面上で詰まりすぎるとき（引きの絵）だけ、消さずに間引く。
//   ★マス目もワールドで割る。画面座標で割ると、カメラを回したときにグリフが領域の外へ
//     こぼれる（枠は傾くのに中身は画面の縦横に並んだままになる）。
function _drawEMGlyphs(f, col) {
  const stepW = 44;                                   // [ワールドpx] ≒ 0.44 m
  const minPx = 14;                                   // これ以上詰まったら間引く [画面px]
  let nx = Math.max(1, Math.round(f.w / stepW)), ny = Math.max(1, Math.round(f.h / stepW));
  nx = Math.max(1, Math.min(nx, Math.floor(f.w * cam.zoom / minPx)));
  ny = Math.max(1, Math.min(ny, Math.floor(f.h * cam.zoom / minPx)));
  const cw = f.w / nx * cam.zoom, ch = f.h / ny * cam.zoom;   // 1マスの画面サイズ
  const gx = i => f.x - f.w/2 + f.w * (i + 0.5) / nx;         // マスの中心（ワールド）
  const gy = j => f.y - f.h/2 + f.h * (j + 0.5) / ny;
  if (f.kind === 'E') {
    const _u = worldToScreenDir(Math.cos(f.angle), Math.sin(f.angle));   // ★向きはカメラの回転を通す
    // ★交流はいまの振れで矢印を伸び縮みさせ、負の半周期は向きを反転する
    //   （振幅の矢印を出したままだと、電場が 0 の瞬間も向きが逆の瞬間も同じ絵になる）
    const a = f.acFactor(), sg = a < 0 ? -1 : 1;
    const ux = _u.x * sg, uy = _u.y * sg;
    const r = Math.min(16, Math.min(cw, ch) * 0.35) * Math.abs(a);
    if (r < 1.5) return;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const c = worldToScreen(gx(i), gy(j));
      drawArrow(ctx, c.x - ux*r, c.y - uy*r, c.x + ux*r, c.y + uy*r, hexToRgba(col, 0.5), 1.3);
    }
  } else {
    ctx.strokeStyle = hexToRgba(col, 0.6); ctx.fillStyle = hexToRgba(col, 0.6); ctx.lineWidth = 1.2;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const c = worldToScreen(gx(i), gy(j)), cx = c.x, cy = c.y;
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI*2); ctx.stroke();
      if (f.out) { ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, Math.PI*2); ctx.fill(); }
      else {
        ctx.beginPath();
        ctx.moveTo(cx-4, cy-4); ctx.lineTo(cx+4, cy+4);
        ctx.moveTo(cx+4, cy-4); ctx.lineTo(cx-4, cy+4); ctx.stroke();
      }
    }
  }
}
// ─── 保存・復元 ───────────────────────────────
function serializeEMField(f) {
  return { id:f.id, kind:f.kind, x:f.x, y:f.y, w:f.w, h:f.h,
           strength:f.strength, angle:f.angle, out:f.out, freq:f.freq, acPhase:f.acPhase };
}
function deserializeEMFields(arr) { return (arr || []).map(d => new EMField(d)); }
