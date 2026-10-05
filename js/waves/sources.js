const waveField = {
  dx: 5,                    // [px/cell]
  W: 0, H: 0, ox: 0, oy: 0, // ox,oy = セル(0,0)の左上のワールド座標 [px]
  u: null, up: null, un: null,
  cRel2: null, solid: null, sig: null, damp: null, A: null, B: null,
  cMaxRel: 1, hasFree: false, hasAbsorb: false, coefDirty: true,
  emitters: new Set(),      // 波源を抱えていて壁にしない物体のid（waveEmitterBodies 参照）
  canvas: null, cctx: null, img: null,
  acc: 0, wdt: 1 / 60, t: 0,
  geoKey: '', absKey: NaN, R: 0, sub: 1, capped: false,
};


const waveTrail = [];   // {x, y, t}  t は waveField.t
function waveUpdateTrail() {
  const act = waveActiveSources();
  if (!act.length) { waveTrail.length = 0; return; }
  const t = waveField.t;
  for (const s of act) { const o = s.getOrigin(); waveTrail.push({ x: o.x, y: o.y, t }); }
  const life = waveVisibleRadiusM() / Math.max(0.01, world.waveSpeed);   // [s] 波が消えるまで
  let cut = 0;
  while (cut < waveTrail.length && waveTrail[cut].t < t - life) cut++;
  if (waveTrail.length - cut > 20000) cut = waveTrail.length - 20000;    // 安全上限
  if (cut > 0) waveTrail.splice(0, cut);
}

class WaveSource {
  constructor(opts) {
    opts = opts || {};
    this.id = opts.id !== undefined ? opts.id : ++uidCounter;   // ★IDを保存・復元する（範囲選択の対象になるため）
    if (opts.id !== undefined && opts.id > uidCounter) uidCounter = opts.id;
    this.body = opts.body || null;    // 物体に載せるとドップラー効果が原理から出る
    this.localX = opts.localX || 0;
    this.localY = opts.localY || 0;
    this.freq  = opts.freq  !== undefined ? opts.freq  : waveFreq;   // [Hz] ★保存するのは f
    this.amp   = opts.amp   !== undefined ? opts.amp   : waveAmp;
    this.phase = opts.phase || 0;
    this.enabled = opts.enabled !== undefined ? !!opts.enabled : true;
  }
  getOrigin() {
    const b = this.body;
    if (!b) return { x: this.localX, y: this.localY };
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    return { x: b.x + this.localX * c - this.localY * s, y: b.y + this.localX * s + this.localY * c };
  }
  // λ は状態として持たない。常に v/f から導出する（二重に持つと必ずずれる）
  wavelength()     { return world.waveSpeed / Math.max(1e-6, this.freq); }
  cellsPerLambda() { return toPx(this.wavelength()) / waveField.dx; }
}
