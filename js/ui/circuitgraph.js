// ══════════════════════════════════════════════════════════════
//  回路グラフ：電流・電圧の時間波形、フェーザ図、過渡のトリガ捕捉
//   ・既定は「1段＝1素子」の段積み。段の中に入るのはその素子の V と I で、
//     教えたい位相差（コイルは V が I より π/2 進む、コンデンサーは逆、抵抗は同相）
//     が段の中だけで完結する。素子をまたぐ比較（KVL・直列の電流一致）は、
//     時間軸を全段で共有して縦に目で追う。重ね表示もトグルで残してある。
//   ・縦軸の最大値は全段で共通（V どうし・I どうし）。素子ごとの大小がそのまま
//     高さの差になる。潰れて読めない段のために、段の見出しにその段のピーク値を
//     数値で出し、「段ごとに自動スケール」の逃げ道も用意する。
//   ・段ごとの副量：コンデンサーは電気量 Q=CV [C]、コイルは磁束 Φ=LI [Wb]。
//     モデル上の厳密な比例関係なので曲線は V（Φ は I）と相似。別の線は描かず、
//     対応する軸に単位を併記する（Q ∝ V であること自体が読み取れる）。
//   ・振幅と位相は「実際に流れている波形」から直交検波で測る。フェーザ専用の
//     複素数ソルバをもう一本持つと、同じ回路を2通りに解くことになって必ず
//     食い違うため（表示と実波形が一致することを優先する）。
//   ・過渡は既定値で τ=RC≈10.5ms。1ティック(16.7ms)に1回の記録では点が取れないので、
//     スイッチが動いた瞬間だけ回路を細かく踏んで高レートで捕捉する（circuit.js 側）。
//   ・ウィンドウは回路（連結成分）ごとに自動で分かれる。どの回路に属するかは
//     ノードの連結から判定できるので、ユーザーに管理させない。
// ══════════════════════════════════════════════════════════════
const CG_MAX_PINS = 4;
const CG_COLORS = ['#4fc3f7', '#ef5350', '#66bb6a', '#ffca28'];   // 重ね表示での素子の識別色
const CG_COL_V  = '#4fc3f7';          // 段積みでの電圧（全段で固定）
const CG_COL_I  = '#ffca28';          // 段積みでの電流（全段で固定）
const CG_DASH_I = [5, 4];             // 電圧は実線・電流は破線
const CG_MAX_SAMPLES = 20000;

// ── 単位つき数値（SI接頭辞）──────────────────────────
//   Q は 1mF×10V = 10mC、τ は 10.5ms のように桁が大きく動くので接頭辞で吸収する
function cgSI(x, unit, digits = 3) {
  if (!Number.isFinite(x)) return '—';
  // ★接頭辞は丸めたあとの値で選ぶ。0.9999999V を先に m で割ると 999.9999 → 「1.00e+3mV」になった
  //   （電圧計の 10MΩ で端子電圧が 1V からわずかに欠けたとき。実測）
  x = Number(x.toPrecision(digits));
  const a = Math.abs(x);
  let s = 1, p = '';
  if      (a >= 1e6)  { s = 1e-6; p = 'M'; }
  else if (a >= 1e3)  { s = 1e-3; p = 'k'; }
  else if (a >= 1)    { s = 1;    p = '';  }
  else if (a >= 1e-3) { s = 1e3;  p = 'm'; }
  else if (a >= 1e-6) { s = 1e6;  p = 'µ'; }
  else if (a >= 1e-9) { s = 1e9;  p = 'n'; }
  else if (a > 0)     { s = 1e12; p = 'p'; }
  const t = (x * s).toPrecision(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return t + p + unit;
}
// 段の副量。コンデンサー→電気量、コイル→磁束。どちらも対応する曲線と厳密に相似。
function cgAux(e) {
  if (!e) return null;
  if (e.type === 'capacitor') return { sym:'Q', rel:'Q=CV', unit:'C',  of:'v', k:(e.C || 0) };
  if (e.type === 'inductor')  return { sym:'Φ', rel:'Φ=LI', unit:'Wb', of:'i', k:(e.L || 0) };
  return null;
}
// 蓄えているエネルギー。コンデンサー ½CV²・コイル ½LI²
function cgEnergy(e, v, i) {
  if (!e) return null;
  if (e.type === 'capacitor') return 0.5 * (e.C || 0) * v * v;
  if (e.type === 'inductor')  return 0.5 * (e.L || 0) * i * i;
  return null;
}

// ── 回路の連結成分 ────────────────────────────────────
//   素子どうしが導線でつながっているか（＝同じ回路か）を判定する。
//   ノード番号は buildCircuitNodes が出すので、そこから素子単位で union する。
function circuitComponentMap() {
  const { elemNodes } = buildCircuitNodes(world._rods || []);
  const parent = new Map();
  const add  = x => { if (!parent.has(x)) parent.set(x, x); };
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const uni  = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const e of circuitElements) {
    const nd = elemNodes.get(e); if (!nd) continue;
    uni(nd.a, nd.b);                       // 素子自身が両端のノードをつなぐ
    if (nd.c !== undefined) uni(nd.a, nd.c);   // すべり抵抗の接点の端子
  }
  const comp = new Map();                  // 素子ID → 連結成分の代表
  for (const e of circuitElements) {
    const nd = elemNodes.get(e); if (!nd) continue;
    comp.set(e.id, find(nd.a));
  }
  return comp;
}
// その素子と同じ回路を見ているウィンドウ（無ければ null）
function circGraphForCircuitOf(elem) {
  const comp = circuitComponentMap();
  const key = comp.get(elem.id);
  if (key === undefined) return null;
  for (const g of circGraphs) {
    for (const id of g.pins) {
      if (comp.get(id) === key) return g;
    }
  }
  return null;
}
function circGraphOf(elemId) {
  for (const g of circGraphs) if (g.pins.includes(elemId)) return g;
  return null;
}

// ── ウィンドウの生成と破棄 ─────────────────────────────
function circGraphNew(opts) {
  const g = {
    id: ++circGraphSeq,
    pins: [], samples: [], t: 0,
    // ★ベクトル図は既定で非表示。交流で定常のときにしか意味がなく、必要なときだけ
    //   チェックを入れて出す（波形は常に見たいが、ベクトル図は場面が限られるため）
    showV: true, showI: true, showPhasor: false,
    stacked: true,          // ★既定は1段1素子の段積み
    iv: false,              // 横軸を電圧にした 電流−電圧 グラフ（特性曲線・負荷直線を描く）
    ivSwap: false,          // その縦横を入れ替える（横＝電流・縦＝電圧。電池の内部抵抗の測定の向き）
    perRowScale: false,     // 縦軸は全段共通（共通スケールで潰れる段のための逃げ道）
    trigArm: false,         // トリガ捕捉を待つ
    cap: null,              // 捕捉中のバッファ
    captures: [],           // 捕捉し終えた波形（末尾が最新。手前は残像として薄く描く）
    view: 'live',           // 'live' | 'capture'
    frozen: false, stopReason: null, hover: null, _ph: null,
    _rows: [], _rowKey: null,          // 読み取り行の DOM（系列が変わったときだけ作り直す）
  };
  // ★シーンから復元するときの表示の選択。窓を組み立てる前に入れる（組み立て側が
  //   g の値からチェックを入れるので、あとから代入すると画面と中身がずれる）
  if (opts) Object.assign(g, opts);
  circGraphs.push(g);
  circGraphBuildPanel(g);
  return g;
}
// 素子を指定して窓を開く。★回路グラフだけは「作る → pins を入れる → 読み直す → 高さを合わせる」
//   の4手が要る（pins の数で段数＝窓の高さが決まるため）。シーンの復元とデモで同じ手順を踏むよう、
//   まとめてここに置く。生きていない素子は落とし、1つも残らなければ窓を開かず null を返す。
function circGraphOpen(pins, opts) {
  const live = (pins || []).filter(id => circuitElements.some(e => e.id === id));
  if (!live.length) return null;
  const g = circGraphNew(opts);
  g.pins = live;
  resetCircGraph(g);
  circGraphFitHeight(g);
  return g;
}
function circGraphClose(g) {
  const at = circGraphs.indexOf(g);
  if (at >= 0) circGraphs.splice(at, 1);
  if (g.panel) g.panel.remove();
  refreshCircGraphButton();
}
function circGraphBuildPanel(g) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'circgraph-panel';
  const off = graphCascadeOffset();
  panel.style.right = (10 + off) + 'px';
  panel.style.bottom = (10 + off) + 'px';
  panel.innerHTML =
    '<div class="vg-header">' +
      '<span class="vg-title"></span>' +
      '<span class="vg-status"></span>' +
      '<span class="vg-close">×</span>' +
    '</div>' +
    '<canvas></canvas>' +
    '<div class="cg-note" style="display:none"></div>' +
    '<div class="cg-readout" style="margin-top:4px"></div>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp">表示</span>' +
      '<label class="vg-check"><input type="checkbox" class="cg-v">電圧 [V]</label>' +
      '<label class="vg-check"><input type="checkbox" class="cg-i">電流 [A]</label>' +
      '<label class="vg-check" title="交流で定常状態のときだけ描けます。条件を満たさないときは理由が表示されます">' +
        '<input type="checkbox" class="cg-ph">ベクトル図</label>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp">波形</span>' +
      '<label class="vg-check" title="1段に1素子。時間軸は全段で共有します">' +
        '<input type="checkbox" class="cg-stack">段積み</label>' +
      '<label class="vg-check" title="既定は全段で共通の縦軸。小さい素子が潰れて読めないときだけ入れてください">' +
        '<input type="checkbox" class="cg-rowscale">段ごとに自動スケール</label>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp">横軸</span>' +
      '<label class="vg-check" title="横軸を電圧・縦軸を電流にして、記録した点の跡を描きます（特性曲線）。時間は消えます">' +
        '<input type="checkbox" class="cg-iv">電流−電圧</label>' +
      '<label class="vg-check" title="横軸を電流・縦軸を電圧にします。電池の起電力と内部抵抗を測るときの向きで、傾きが −r、縦軸の切片が E になります">' +
        '<input type="checkbox" class="cg-ivswap">縦横を入れ替える</label>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp">過渡</span>' +
      '<label class="vg-check" title="スイッチの開閉や値の変更の瞬間を、回路を細かく踏んで高レートで記録します">' +
        '<input type="checkbox" class="cg-trig">トリガ捕捉</label>' +
      '<button class="btn-small cg-live" title="ライブ波形へ戻します">ライブ</button>' +
      '<button class="btn-small cg-clearcap" title="重ねて表示している過去の捕捉を消します">残像消去</button>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<span class="vg-hint">実線＝電圧・破線＝電流。カーソルを置くと値を読めます</span>' +
      '<button class="btn-small cg-rec">停止</button>' +
      '<button class="btn-small cg-reset">リセット</button>' +
    '</div>';
  host.appendChild(panel);
  g.panel   = panel;
  g.canvas  = panel.querySelector('canvas');
  g.ctx     = g.canvas.getContext('2d');
  g.titleEl = panel.querySelector('.vg-title');
  g.statusEl= panel.querySelector('.vg-status');
  g.noteEl  = panel.querySelector('.cg-note');
  g.readEl  = panel.querySelector('.cg-readout');
  g.recBtn  = panel.querySelector('.cg-rec');
  g.liveBtn = panel.querySelector('.cg-live');
  g.hintEl  = panel.querySelector('.vg-hint');
  g.titleEl.textContent = '回路グラフ ' + g.id;
  panel.querySelector('.vg-close').addEventListener('click', () => circGraphClose(g));
  // チェックの初期状態はインスタンスの値から入れる（markup と二重に持つとずれるため）
  const q = s => panel.querySelector(s);
  const cbV = q('.cg-v'), cbI = q('.cg-i'), cbP = q('.cg-ph');
  const cbS = q('.cg-stack'), cbR = q('.cg-rowscale'), cbT = q('.cg-trig'), cbIV = q('.cg-iv'), cbSw = q('.cg-ivswap');
  cbV.checked = g.showV; cbI.checked = g.showI; cbP.checked = g.showPhasor;
  cbS.checked = g.stacked; cbR.checked = g.perRowScale; cbT.checked = g.trigArm; cbIV.checked = g.iv; cbSw.checked = g.ivSwap;
  cbSw.addEventListener('change', ev => g.ivSwap = ev.target.checked);
  cbIV.addEventListener('change', ev => { g.iv = ev.target.checked; updateCircGraphStatus(g); });
  cbV.addEventListener('change', ev => g.showV = ev.target.checked);
  cbI.addEventListener('change', ev => g.showI = ev.target.checked);
  cbP.addEventListener('change', ev => g.showPhasor = ev.target.checked);
  cbS.addEventListener('change', ev => { g.stacked = ev.target.checked; circGraphFitHeight(g); });
  cbR.addEventListener('change', ev => g.perRowScale = ev.target.checked);
  cbT.addEventListener('change', ev => { g.trigArm = ev.target.checked; if (!g.trigArm) g.cap = null;
                                         updateCircGraphStatus(g); });
  g.liveBtn.addEventListener('click', () => { g.view = 'live'; updateCircGraphStatus(g); });
  q('.cg-clearcap').addEventListener('click', () => {
    g.captures = []; g.view = 'live'; updateCircGraphStatus(g);
  });
  g.recBtn.addEventListener('click', () => toggleCircGraphRecording(g));
  q('.cg-reset').addEventListener('click', () => resetCircGraph(g));
  g.canvas.addEventListener('mousemove', ev => {
    const r = g.canvas.getBoundingClientRect();
    g.hover = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  g.canvas.addEventListener('mouseleave', () => g.hover = null);
  circGraphMakeDraggable(g);
}
// 段が増えたら既定の高さを伸ばす。手で広げたぶんは縮めない（resize:both で調整できる）
function circGraphFitHeight(g) {
  if (!g.panel || !g.stacked) return;
  // 段の高さが 78px を切るとベクトル図が出せないので、段あたり 104px を目安に確保する
  const want = 210 + Math.max(1, g.pins.length) * 104;
  if (g.panel.offsetHeight < want)
    g.panel.style.height = Math.min(want, Math.floor(window.innerHeight * 0.9)) + 'px';
}
function circGraphMakeDraggable(g) {
  const panel = g.panel, header = panel.querySelector('.vg-header');
  let dragging = false, offX = 0, offY = 0;
  header.addEventListener('mousedown', e => {
    if (e.target.classList.contains('vg-close')) return;
    const r = panel.getBoundingClientRect(), wr = panel.parentElement.getBoundingClientRect();
    dragging = true; offX = e.clientX - r.left; offY = e.clientY - r.top;
    panel.style.left = (r.left - wr.left) + 'px';
    panel.style.top  = (r.top  - wr.top)  + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const wr = panel.parentElement.getBoundingClientRect();
    let x = e.clientX - offX - wr.left, y = e.clientY - offY - wr.top;
    x = Math.max(0, Math.min(x, wr.width  - panel.offsetWidth));
    y = Math.max(0, Math.min(y, wr.height - panel.offsetHeight));
    panel.style.left = x + 'px'; panel.style.top = y + 'px';
  });
  window.addEventListener('mouseup', () => dragging = false);
}

// ── 監視対象の出し入れ ────────────────────────────────
function refreshCircGraphButton() {
  const b = document.getElementById('c-graph-btn');
  if (!b) return;
  const e = selectedCircuit;
  const on = !!(e && circGraphOf(e.id));
  b.textContent = on ? 'グラフから外す' : 'グラフに追加';
  b.classList.toggle('active', on);
}
// 選択中の素子をグラフへ。同じ回路のウィンドウがあればそこへ、無ければ新しく開く
function toggleCircGraphPin() {
  const e = selectedCircuit;
  if (!e) return;
  const cur = circGraphOf(e.id);
  if (cur) { circGraphUnpin(cur, e.id); return; }
  let g = circGraphForCircuitOf(e);
  if (g) {
    // ★満杯なら理由を出す。以前は黙って何も起きず、右クリックから呼べるように
    //   なった今は「押したのに反応しない」としか見えない
    if (g.pins.length >= CG_MAX_PINS) {
      appAlert('回路のグラフ', `1つの窓に出せるのは<b>${CG_MAX_PINS}個</b>までです。`
             + '<div class="am-note">どれかを「グラフから外す」で外してから追加してください。'
             + '（同じ回路の素子は同じ窓にまとまります）</div>');
      return;
    }
    g.pins.push(e.id);
    resetCircGraph(g);             // 増えた系列ぶんの過去が無いので記録は作り直す
  } else {
    g = circGraphNew();
    g.pins.push(e.id);
    resetCircGraph(g);
  }
  circGraphFitHeight(g);
  refreshCircGraphButton();
}
// ★グラフ側から系列を外す。残った系列の記録は捨てずに、その列だけ抜く
function circGraphUnpin(g, id) {
  const k = g.pins.indexOf(id);
  if (k < 0) return;
  g.pins.splice(k, 1);
  for (const s of g.samples) { s.v.splice(k, 1); s.i.splice(k, 1); s.q.splice(k, 1); }
  g._ph = null;
  g.cap = null; g.captures = []; g.view = 'live';   // 捕捉は列の並びに依存するので捨てる
  g._rowKey = null;                                   // 行を組み直させる
  if (!g.pins.length) { circGraphClose(g); return; }   // 空になったら閉じる
  refreshCircGraphButton();
  updateCircGraphStatus(g);
}
function circGraphElems(g) {
  return g.pins.map(id => circuitElements.find(e => e.id === id) || null);
}
function circGraphLabel(e) {
  return e ? (CIRCUIT_LABELS[e.type] || e.type) + '#' + e.id : '—';
}
function resetCircGraph(g) {
  const stay = resetKeepsStopped(g);          // ★「停止」中のリセットで勝手に再開しない（velgraph.js）
  g.t = 0; g.samples = []; g.frozen = stay; g.stopReason = stay ? 'user' : null; g._ph = null;
  g.cap = null; g.captures = []; g.view = 'live';
  updateCircGraphStatus(g);
}
function toggleCircGraphRecording(g) {
  if (g.frozen) {
    if (g.samples.length >= CG_MAX_SAMPLES) return;
    g.frozen = false; g.stopReason = null;
  } else { g.frozen = true; g.stopReason = 'user'; g.cap = null; }
  updateCircGraphStatus(g);
}
function updateCircGraphStatus(g) {
  if (g.recBtn) {
    const atLimit = g.samples.length >= CG_MAX_SAMPLES;
    g.recBtn.textContent = g.frozen ? '再開' : '停止';
    g.recBtn.disabled = g.frozen && atLimit;
  }
  if (g.liveBtn) g.liveBtn.disabled = (g.view === 'live');
  // ★色の意味は表示方式で変わる（段積み＝量ごと、重ね＝素子ごと）ので案内も切り替える
  if (g.hintEl) {
    const h = g.iv ? '点の跡＝これまでの (V, I)、丸＝いま。電流計と電圧計を両方入れると読みを組にします'
            : g.stacked ? '1段＝1素子。実線＝電圧・破線＝電流。縦軸は全段共通です'
                        : '色＝素子。実線＝電圧・破線＝電流';
    if (g.hintEl.textContent !== h) g.hintEl.textContent = h;
  }
  const el = g.statusEl;
  if (!el) return;
  const names = circGraphElems(g).map(circGraphLabel).join('・');
  if (g.view === 'capture')     { el.textContent = names + '：過渡を表示中'; el.style.color = '#4fc3f7'; }
  else if (g.cap)               { el.textContent = names + '：過渡を捕捉中'; el.style.color = '#4fc3f7'; }
  else if (g.stopReason === 'limit') { el.textContent = names + '：記録停止（上限）'; el.style.color = 'var(--accent3)'; }
  else if (g.frozen)            { el.textContent = names + '：記録停止'; el.style.color = 'var(--accent3)'; }
  else if (g.trigArm && running){ el.textContent = names + '：記録中／トリガ待ち'; el.style.color = '#66bb6a'; }
  else if (running)             { el.textContent = names + '：記録中'; el.style.color = '#66bb6a'; }
  else                          { el.textContent = names + '：待機中'; el.style.color = 'var(--text2)'; }
}
// ── 記録 ──────────────────────────────────────────────
//   ★Q・Φ はサンプルした瞬間の C・L で作って持つ。あとから「C × 過去のV」で
//     復元すると、実行中に C を変えたときに過去まで書き換わってしまう。
//   ★電源の電流は＋極から出ていく向きを正にする（ソルバの e.I は素子の a→b＝＋極へ入る向き）。
//     a→b のままだと、電源の段の V と I がいつも半周ずれ（RLC直列で φ＝117°・理論 −63°）、
//     電源の電力 P も負で出た。抵抗・コイル・コンデンサーは a→b の向きを V と I で共有して
//     いるので、どちら向きに描いても位相差は変わらない。電源だけが「送り出す側」の規約になる。
const cgSrcSign = e => (e && (e.type === 'dcsource' || e.type === 'acsource')) ? -1 : 1;
function cgSampleRow(els) {
  return {
    v: els.map(e => (e && e.Vread) || 0),
    i: els.map(e => cgSrcSign(e) * ((e && e.I) || 0)),
    q: els.map(e => { const a = cgAux(e); if (!a) return null;
                      return a.k * (a.of === 'v' ? (e.Vread || 0) : (e.I || 0)); }),
  };
}
function sampleCircuitGraph(dt) {
  if (dt <= 0) return;
  for (const g of circGraphs.slice()) {
    if (g.frozen || !g.pins.length) continue;
    const els = circGraphElems(g);
    if (els.some(e => !e)) {                      // 素子が消えていたらピンを外す
      for (const id of g.pins.slice())
        if (!circuitElements.some(e => e.id === id)) circGraphUnpin(g, id);
      continue;
    }
    g.t += dt;
    g.samples.push(Object.assign({ t: g.t }, cgSampleRow(els)));
    if (g.samples.length >= CG_MAX_SAMPLES) { g.frozen = true; g.stopReason = 'limit'; updateCircGraphStatus(g); }
  }
}

// ══════════════════════════════════════════════════════════════
//  過渡のトリガ捕捉（ストレージオシロと同じ考え方）
//   既定値の RC は τ=(R+r)C≈10.5ms。1ティック 16.7ms の記録では τ より粗いので、
//   曲線が「速すぎて見えない」のではなく最初から点が無い。そこでスイッチが動いた
//   瞬間だけ回路を細かく踏み（circuit.js の CIRCUIT_FINE_SUBSTEPS＝1920Hz）、
//   その区間だけ高レートで記録する。捕捉後は τ を波形から測って横軸を 5τ に合わせる。
// ══════════════════════════════════════════════════════════════
const CG_CAP_SPAN = 0.6;      // [s] 捕捉する長さ。既定の LR（τ=95ms）の 5τ=476ms が収まる
const CG_CAP_LEAD = 0.06;     // [s] トリガ前の助走（変化前の水平線を見せる）
const CG_CAP_MAX  = 4000;     // 捕捉バッファの上限（1920Hz×0.6s≒1150 に対して余裕を持つ）
const CG_KEEP_CAPTURES = 3;   // 残像として残す過去の捕捉の数

// circuit.js から呼ぶ：いま細かく踏む必要があるか
function circGraphCaptureActive() {
  for (const g of circGraphs) if (g.cap) return true;
  return false;
}
// circuit.js から呼ぶ：不連続が起きた瞬間に捕捉を開始する
function circGraphCaptureBegin() {
  if (!running) return;                       // 編集中の値変更では始めない
  for (const g of circGraphs) {
    if (!g.trigArm || g.frozen || !g.pins.length || g.cap) continue;
    const els = circGraphElems(g);
    if (els.some(e => !e)) continue;
    // 助走：ライブ記録から直前の数点をそのまま持ってくる（実データなので作り話にならない）
    const lead = g.samples.filter(s => s.t >= g.t - CG_CAP_LEAD)
                          .map(s => ({ t: s.t, v: s.v.slice(), i: s.i.slice(), q: s.q.slice() }));
    // ★トリガの瞬間の値。ここは呼び出し元（solveCircuit）がまだ解く前なので、
    //   素子が持っているのは「変化する直前」の値そのもの。60Hz 記録の最後の点は
    //   最大 16.7ms 古く、それを起点に使うと τ が数%〜十数%ずれる（実測で確認）。
    const pre = Object.assign({ t: g.t }, cgSampleRow(els));
    lead.push(pre);
    g.cap = { tEvent: g.t, t: g.t, samples: lead, pre, pinKey: g.pins.join(',') };
  }
}
// circuit.js から呼ぶ：細分した1ステップぶんを記録する
function circGraphFineSample(h) {
  if (!(h > 0)) return;
  for (const g of circGraphs) {
    const cap = g.cap;
    if (!cap) continue;
    const els = circGraphElems(g);
    if (els.some(e => !e)) { g.cap = null; continue; }
    cap.t += h;
    cap.samples.push(Object.assign({ t: cap.t }, cgSampleRow(els)));
    if (cap.t - cap.tEvent >= CG_CAP_SPAN || cap.samples.length >= CG_CAP_MAX)
      circGraphCaptureFinish(g);
  }
}
function circGraphCaptureFinish(g) {
  const cap = g.cap;
  g.cap = null;
  if (!cap || cap.samples.length < 8) return;
  cgAnalyzeCapture(g, cap);
  // 系列の並びが変わっていたら過去の捕捉と重ねられない
  if (g.captures.length && g.captures[0].pinKey !== cap.pinKey) g.captures = [];
  g.captures.push(cap);
  while (g.captures.length > CG_KEEP_CAPTURES) g.captures.shift();
  g.view = 'capture';
  updateCircGraphStatus(g);
}
// 捕捉した波形から時定数を測る。
//   指数応答 x(t) = x∞ + (x0−x∞)e^(−t/τ) の定義そのままに、全変化の 63.2% に達する
//   時刻を線形補間で拾う（非線形フィットは要らないし、教科書の τ の定義と同じ）。
//   ・行き過ぎ（オーバーシュート）があれば指数応答ではない＝LC の振動なので測らない。
//   ・交流電源があると応答が正弦波に乗るので τ は意味を持たない。測らない。
function cgFitTau(samples, tEvent, pick, preVal) {
  const n = samples.length;
  if (n < 8) return null;
  let i0 = 0;
  while (i0 < n - 1 && samples[i0].t < tEvent) i0++;
  if (n - i0 < 8) return null;
  // ★起点はトリガ直前の値。そうすると「連続な量」（コンデンサーの V、コイルの I）は
  //   ちょうど τ が出て、「跳ぶ量」（同じ回路の I や V_L）は起点と終端がどちらも同じ値に
  //   なって振れ幅が消え、自動的に対象から外れる。素子の種類で場合分けしなくてよい。
  const x0 = Number.isFinite(preVal) ? preVal
           : (i0 > 0 ? pick(samples[i0 - 1]) : pick(samples[i0]));
  const mean = (a, b) => { let s = 0; for (let k = a; k < b; k++) s += pick(samples[k]); return s / (b - a); };
  const seg = Math.max(2, Math.floor((n - i0) * 0.1));
  if (n - i0 < 3 * seg) return null;
  const xInf = mean(n - seg, n), swing = xInf - x0;
  let peak = 0;
  for (let k = i0; k < n; k++) peak = Math.max(peak, Math.abs(pick(samples[k])));
  if (Math.abs(swing) < 0.05 * Math.max(peak, 1e-12)) return null;   // ほとんど動いていない
  // ★終端値が本当に落ち着いたか。落ち着く前に測ると x∞ を小さく見積もり、63.2% の
  //   到達時刻が手前にずれて τ を過小評価する（τ=500ms を 281ms と答えてしまう）。
  //   捕捉の最後の1割と、その手前の1割がまだ動いているなら τ は測らない。
  if (Math.abs(xInf - mean(n - 2 * seg, n - seg)) > 0.03 * Math.abs(swing))
    return { unsettled: true };
  const target = x0 + 0.632 * swing;
  const passed = v => swing > 0 ? v >= target : v <= target;
  for (let k = i0; k < n; k++) {
    if (!passed(pick(samples[k]))) continue;
    // 最初の捕捉点でもう超えている＝τ が刻みより速い。測ったふりをしない
    if (k === i0) return null;
    const a = samples[k - 1], b = samples[k];
    const va = pick(a), vb = pick(b);
    const u = Math.abs(vb - va) > 1e-15 ? (target - va) / (vb - va) : 0;
    const tau = a.t + (b.t - a.t) * u - tEvent;
    // 行き過ぎの判定：以降で x∞ を 5% 以上超えていたら指数応答ではない（LC の振動）
    let osc = false;
    for (let m = k; m < n; m++) {
      const d = (pick(samples[m]) - xInf) * Math.sign(swing);
      if (d > 0.05 * Math.abs(swing)) { osc = true; break; }
    }
    return tau > 0 ? { tau, osc, x0, xInf } : null;
  }
  return null;
}
function cgAnalyzeCapture(g, cap) {
  const els = circGraphElems(g);
  const ac = circuitElements.some(e => e.type === 'acsource');
  cap.rows = els.map(() => null);
  if (ac) { cap.note = '交流電源があるため時定数は測っていません'; cap.tau = null; return; }
  let tauMax = 0, anyOsc = false, anyUnsettled = false;
  for (let k = 0; k < els.length; k++) {
    if (!els[k]) continue;
    // V と I のうち、変化が大きいほうで測る。跳ぶ量は起点＝終端で振れ幅が消えて自然に外れる
    const pv = cap.pre ? cap.pre.v[k] : undefined, pi = cap.pre ? cap.pre.i[k] : undefined;
    const fits = [cgFitTau(cap.samples, cap.tEvent, s => s.v[k], pv),
                  cgFitTau(cap.samples, cap.tEvent, s => s.i[k], pi)].filter(Boolean);
    if (fits.some(f => f.unsettled)) anyUnsettled = true;
    const ok = fits.filter(f => f.tau);
    if (!ok.length) continue;
    const best = ok.reduce((a, b) =>
      Math.abs(b.xInf - b.x0) > Math.abs(a.xInf - a.x0) ? b : a);
    cap.rows[k] = best;
    if (best.osc) anyOsc = true;
    if (best.tau > tauMax) tauMax = best.tau;
  }
  cap.osc = anyOsc;
  cap.tau = (!anyOsc && tauMax > 0) ? tauMax : null;
  cap.note = anyOsc ? '振動応答のため時定数は測っていません（LC）'
           : (anyUnsettled && !tauMax)
             ? `捕捉した ${CG_CAP_SPAN} 秒では応答が終わりません。時定数が大きすぎるので、`
               + 'この場合はライブ波形のほうが見やすいはずです'
             : null;
}
// 捕捉の表示範囲。τ が測れていれば 5τ、だめなら捕捉した全体。
//   ★助走はそのまま全部出さない。τ=0.5ms のとき 60ms の助走を出すと画面の 99% が
//     変化前の水平線になり、肝心の曲線が潰れる。助走は本体の 15% までに抑える。
function cgCaptureWindow(cap) {
  const last = cap.samples[cap.samples.length - 1].t;
  const first = cap.samples[0].t;
  const b = cap.tau ? Math.min(last, cap.tEvent + 5 * cap.tau) : last;
  const span = Math.max(b - cap.tEvent, 1e-6);
  const lead = Math.min(cap.tEvent - first, span * 0.15);
  return { t0: cap.tEvent - Math.max(lead, 0), t1: cap.tEvent + span };
}

// ── フェーザ図が使える状態かの判定（厳格）───────────────────────
function circPhasorValidity() {
  const acs = circuitElements.filter(e => e.type === 'acsource');
  if (!acs.length) return { ok: false, why: '交流電源がありません' };
  const f = acs[0].freq;
  if (acs.some(e => Math.abs(e.freq - f) > 1e-9))
    return { ok: false, why: '振動数の違う交流電源が混ざっています（基準になる振動数が決まりません）' };
  if (!(f > 0)) return { ok: false, why: '振動数が 0 です' };
  // ★ここで弾くのは「基準の振動数が決まらない」場合だけ。直流の混入・非線形素子・
  //   モーター・導体棒は、素子の種類で決めうちにせず、実際の波形が正弦波になって
  //   いるかどうか（analyzeCircuitPhasors の残差判定）で見る。
  return { ok: true, f };
}
function circDistortionHint() {
  const kinds = new Set();
  for (const e of circuitElements) {
    if (e.type === 'diode' || e.type === 'bulb' || e.type === 'dcsource' || e.type === 'motor')
      kinds.add(CIRCUIT_LABELS[e.type] || e.type);
  }
  if ((world._rods || []).length) kinds.add('導体棒');
  return kinds.size ? `（${[...kinds].join('・')}が入っていると波形がひずみます）` : '';
}
function circIndexBefore(samples, t) {
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (samples[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}
//   ★積分区間は「ちょうど1周期」でなければならない。サンプル点に丸めると区間が
//     1サンプルぶんずれ（毎秒60サンプル・2Hz なら 3.3%）、振幅・位相・直流分の
//     すべてに誤差が乗る。両端は線形補間して、区間長を厳密に T に合わせる。
function _circWindow(samples, tA, tB, pick, cb) {
  let k = circIndexBefore(samples, tA);
  if (k < 1) k = 1;
  for (; k < samples.length; k++) {
    const s0 = samples[k - 1], s1 = samples[k];
    if (s1.t <= tA) continue;
    if (s0.t >= tB) break;
    const t0 = Math.max(s0.t, tA), t1 = Math.min(s1.t, tB);
    const h = t1 - t0;
    if (!(h > 0)) continue;
    const span = s1.t - s0.t;
    const tm = (t0 + t1) / 2;
    const u = span > 0 ? (tm - s0.t) / span : 0;
    const x0 = pick(s0), x1 = pick(s1);
    cb(tm, x0 + (x1 - x0) * u, h);
  }
}
// 直交検波。x = A sin(ωt+φ) に対して
//   (2/T)∫x·sin(ωt)dt = A cosφ、(2/T)∫x·cos(ωt)dt = A sinφ
function circDetect(samples, tA, tB, pick, f) {
  let a = 0, b = 0, sq = 0, mean = 0, dur = 0;
  _circWindow(samples, tA, tB, pick, (tm, xm, h) => {
    const w = 2 * Math.PI * f * tm;
    a += xm * Math.cos(w) * h;
    b += xm * Math.sin(w) * h;
    sq += xm * xm * h;
    mean += xm * h;
    dur += h;
  });
  if (dur <= 0) return null;
  const A = 2 / dur * Math.hypot(a, b), phase = Math.atan2(a, b);
  // ★残差：測った正弦波と実際の波形のずれ。ひずみ・高調波・過渡がここに現れる
  let res = 0;
  _circWindow(samples, tA, tB, pick, (tm, xm, h) => {
    const fit = A * Math.sin(2 * Math.PI * f * tm + phase);
    res += (xm - fit) * (xm - fit) * h;
  });
  return { amp: A, phase, rms: Math.sqrt(sq / dur), mean: mean / dur, res: Math.sqrt(res / dur) };
}
const CG_STEADY_TOL = 0.02;      // 振幅・位相の許容差（2%・0.02rad）
const CG_FIT_TOL    = 0.03;      // 正弦波とのずれ（残差／振幅）の許容値
function analyzeCircuitPhasors(g) {
  const val = circPhasorValidity();
  if (!val.ok) { g._ph = { ok: false, why: val.why }; return; }
  const f = val.f, T = 1 / f, S = g.samples;
  if (!S.length) { g._ph = { ok: false, why: '記録がありません' }; return; }
  const tEnd = S[S.length - 1].t;
  if (tEnd < 2 * T) { g._ph = { ok: false, why: 'まだ2周期ぶん記録できていません' }; return; }
  const els = circGraphElems(g);
  const items = [];
  for (let k = 0; k < els.length; k++) {
    const e = els[k]; if (!e) continue;
    const V  = circDetect(S, tEnd - T,     tEnd,     s => s.v[k], f);
    const I  = circDetect(S, tEnd - T,     tEnd,     s => s.i[k], f);
    const V0 = circDetect(S, tEnd - 2 * T, tEnd - T, s => s.v[k], f);
    const I0 = circDetect(S, tEnd - 2 * T, tEnd - T, s => s.i[k], f);
    if (!V || !I || !V0 || !I0) { g._ph = { ok: false, why: '記録が足りません' }; return; }
    // 定常判定 その1：波形が本当に正弦波か（残差と、1周期の平均が0からずれていないか）
    for (const d of [V, I]) {
      const scale = Math.max(d.amp, 1e-12);
      if (d.amp < 1e-9) continue;
      if (Math.abs(d.mean) / scale > CG_FIT_TOL) {
        g._ph = { ok: false, why: `直流分が残っています（振幅の${(Math.abs(d.mean)/scale*100).toFixed(0)}%）。`
          + 'コイルを理想電源に直結すると、投入時の直流分を減衰させる抵抗が無いため永久に残ります。'
          + '電源の内部抵抗 r を 0.5Ω などにすると消えます' };
        return;
      }
      if (d.res / scale > CG_FIT_TOL) {
        g._ph = { ok: false, why: '波形が正弦波になっていません' + circDistortionHint()
                       + '。過渡のあいだも表示されません' };
        return;
      }
    }
    // 定常判定 その2：前の周期と一致しているか（振幅がゆっくり動く場合を捕まえる）
    const near = (x, y, scale) => Math.abs(x - y) <= CG_STEADY_TOL * Math.max(scale, 1e-12);
    const dPh = a => { let d = Math.abs(a); return d > Math.PI ? 2*Math.PI - d : d; };
    const amps = Math.max(V.amp, V0.amp, 1e-12), ampsI = Math.max(I.amp, I0.amp, 1e-12);
    if (!near(V.amp, V0.amp, amps) || !near(I.amp, I0.amp, ampsI)
        || (V.amp > 1e-9 && dPh(V.phase - V0.phase) > CG_STEADY_TOL)
        || (I.amp > 1e-9 && dPh(I.phase - I0.phase) > CG_STEADY_TOL)) {
      g._ph = { ok: false, why: 'まだ過渡状態です（振幅・位相が変化しています）' };
      return;
    }
    // ★位相差は −180°〜180° に畳む。atan2 の差のままだと 1周ぶん巻いて、コイルが
    //   φ＝−270°（＝+90°）、RLC直列の電源が −298°（＝+62°）と出た（実測）
    let phi = V.phase - I.phase;
    phi -= 2 * Math.PI * Math.round(phi / (2 * Math.PI));
    items.push({ e, k, V, I, phi, P: V.rms * I.rms * Math.cos(phi) });
  }
  g._ph = { ok: true, f, T, items, tEnd };
}

// ══════════════════════════════════════════════════════════════
//  描画
// ══════════════════════════════════════════════════════════════
function drawCircuitGraph() {
  for (const g of circGraphs) drawCircGraphOne(g);
}
// 表示するデータ（ライブ波形／捕捉した過渡）と、その時間範囲を決める
function cgPlotData(g) {
  if (g.view === 'capture' && g.captures.length) {
    const cap = g.captures[g.captures.length - 1];
    const w = cgCaptureWindow(cap);
    return { S: cap.samples, t0: w.t0, t1: w.t1, cap,
             ghosts: g.captures.slice(0, -1) };
  }
  const S = g.samples;
  if (!S.length) return null;
  const tEnd = S[S.length - 1].t;
  const ph = g._ph;
  const win = (ph && ph.ok) ? Math.min(tEnd, 3 * ph.T) : tEnd;   // 交流なら直近3周期
  return { S, t0: Math.max(0, tEnd - win), t1: Math.max(tEnd, 1e-6), cap: null, ghosts: [] };
}
// 縦スケール。電圧と電流は単位が違うので別々に、どちらも0を中心に対称にとる。
//   ks を渡すとその段だけ、省略すると全段（＝共通スケール）で最大を探す。
function cgScales(S, t0, t1, nk, ks) {
  let vMax = 0, iMax = 0;
  const from = circIndexBefore(S, t0);
  for (let k = from; k < S.length; k++) {
    const s = S[k];
    if (s.t > t1) break;
    for (let j = 0; j < nk; j++) {
      if (ks && !ks.includes(j)) continue;
      const a = Math.abs(s.v[j]); if (a > vMax) vMax = a;
      const b = Math.abs(s.i[j]); if (b > iMax) iMax = b;
    }
  }
  return { vMax: vMax > 1e-12 ? vMax * 1.15 : 1, iMax: iMax > 1e-12 ? iMax * 1.15 : 1 };
}
// ★残像も込みで縦軸を決める。R を変えて撮り直した波形が枠外に出てしまうと、
//   重ねて比べるという残像の目的そのものが果たせない
function cgScalesAll(D, nk, ks) {
  const sc = cgScales(D.S, D.t0, D.t1, nk, ks);
  if (D.cap) for (const gh of D.ghosts) {
    const sh = D.cap.tEvent - gh.tEvent;
    const s2 = cgScales(gh.samples, D.t0 - sh, D.t1 - sh, nk, ks);
    if (s2.vMax > sc.vMax) sc.vMax = s2.vMax;
    if (s2.iMax > sc.iMax) sc.iMax = s2.iMax;
  }
  return sc;
}
// 過去の捕捉を薄く重ねる。捕捉ごとにトリガの時刻が違うので、トリガの瞬間を揃えて描く
function cgDrawGhosts(c, g, D, k, X, YV, YI, colV, colI) {
  if (!D.cap) return;
  for (const gh of D.ghosts) {
    const sh = D.cap.tEvent - gh.tEvent;          // ghost の時刻 + sh ＝ 表示中の時間軸
    const Xg = t => X(t + sh);
    const a = D.t0 - sh, b = D.t1 - sh;
    const from = circIndexBefore(gh.samples, a);
    if (g.showV) cgCurve(c, gh.samples, from, b, s => s.v[k], Xg, YV, [], colV, 0.26);
    if (g.showI) cgCurve(c, gh.samples, from, b, s => s.i[k], Xg, YI, CG_DASH_I, colI, 0.26);
  }
}
function drawCircGraphOne(g) {
  const cv = g.canvas, c = g.ctx;
  if (!cv || !c) return;
  const cssW = cv.clientWidth || 420, cssH = cv.clientHeight || 200;
  if (cv.width !== cssW) cv.width = cssW;
  if (cv.height !== cssH) cv.height = cssH;
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  updateCircGraphStatus(g);
  if (!g.pins.length) return;
  if (g.iv) {                                   // ★時間を捨てるので捕捉・ベクトル図は使わない
    drawCircGraphIV(g, circGraphElems(g), W, H);
    cgDrawNote(g);
    drawCircGraphReadout(g, circGraphElems(g), null);
    return;
  }
  analyzeCircuitPhasors(g);
  const D = cgPlotData(g);
  if (!D) return;
  const els = circGraphElems(g);
  if (g.stacked) drawCircGraphStacked(g, D, els, W, H);
  else           drawCircGraphOverlay(g, D, els, W, H);
  cgDrawNote(g);
  drawCircGraphReadout(g, els, g._ph);
}
// 折れ線を1本引く
function cgCurve(c, S, from, to, pick, X, Y, dash, col, alpha) {
  c.save();
  c.globalAlpha = alpha === undefined ? 1 : alpha;
  c.setLineDash(dash); c.strokeStyle = col; c.lineWidth = 1.6;
  c.beginPath();
  let started = false;
  for (let k = Math.max(0, from - 1); k < S.length; k++) {   // 1点手前から引いて左端まで届かせる
    if (S[k].t > to) break;
    const px = X(S[k].t), py = Y(pick(S[k]));
    if (!started) { c.moveTo(px, py); started = true; } else c.lineTo(px, py);
  }
  c.stroke(); c.restore();
}

// ── 段積み：1段＝1素子 ────────────────────────────────
function drawCircGraphStacked(g, D, els, W, H) {
  const c = g.ctx, { S, t0, t1, cap } = D;
  const ph = g._ph;
  const showPh = g.showPhasor && ph && ph.ok;
  const n = g.pins.length;
  const padL = 44, padR = 46, padT = 6, padB = 18, gapY = 10;
  const rowH = (H - padT - padB - gapY * (n - 1)) / n;
  if (rowH < 18) return;
  // ベクトル図は段の高さに余裕があるときだけ。小さすぎると角度が読めず邪魔になるだけ
  const phOn = showPh && rowH >= 78;
  const phSize = phOn ? Math.min(rowH - 4, Math.floor(W * 0.28)) : 0;
  const plotL = padL + (phOn ? phSize + 12 : 0);
  const plotW = Math.max(30, W - plotL - padR);
  const X = t => plotL + ((t - t0) / Math.max(1e-9, t1 - t0)) * plotW;
  const from = circIndexBefore(S, t0);
  const gScale = cgScalesAll(D, n, null);            // 全段共通

  c.font = '9px sans-serif';
  const rows = [];
  for (let k = 0; k < n; k++) {
    const e = els[k];
    const top = padT + k * (rowH + gapY);
    const cy = top + rowH / 2;
    const sc = g.perRowScale ? cgScalesAll(D, n, [k]) : gScale;
    const half = rowH / 2 - 2;
    const YV = v => cy - (v / sc.vMax) * half;
    const YI = i => cy - (i / sc.iMax) * half;
    rows.push({ k, e, top, h: rowH, cy, sc, YV, YI });

    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
    c.strokeRect(plotL, top, plotW, rowH);
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.beginPath(); c.moveTo(plotL, cy); c.lineTo(plotL + plotW, cy); c.stroke();

    // 縦軸のラベル：左＝電圧、右＝電流。副量（Q・Φ）は対応する側に併記する
    const aux = cgAux(e);
    c.textBaseline = 'middle';
    if (g.showV) {
      c.fillStyle = CG_COL_V; c.textAlign = 'right';
      c.fillText(cgSI(sc.vMax, 'V'), plotL - 3, top + 7);
      c.fillStyle = 'rgba(224,230,240,0.45)';
      c.fillText('0', plotL - 3, cy);
      if (aux && aux.of === 'v') {
        c.fillStyle = 'rgba(79,195,247,0.75)';
        c.fillText(cgSI(aux.k * sc.vMax, aux.unit), plotL - 3, top + 18);
      }
    }
    if (g.showI) {
      c.fillStyle = CG_COL_I; c.textAlign = 'left';
      c.fillText(cgSI(sc.iMax, 'A'), plotL + plotW + 3, top + 7);
      if (aux && aux.of === 'i') {
        c.fillStyle = 'rgba(255,202,40,0.75)';
        c.fillText(cgSI(aux.k * sc.iMax, aux.unit), plotL + plotW + 3, top + 18);
      }
    }
    // 段の見出し：素子名＋この段のピーク値（共通スケールで潰れていても定量的に読める）
    let peakV = 0, peakI = 0;
    for (let m = from; m < S.length; m++) {
      if (S[m].t > t1) break;
      peakV = Math.max(peakV, Math.abs(S[m].v[k]));
      peakI = Math.max(peakI, Math.abs(S[m].i[k]));
    }
    let head = circGraphLabel(e);
    if (g.showV) head += '  |V|≤' + cgSI(peakV, 'V');
    if (g.showI) head += '  |I|≤' + cgSI(peakI, 'A');
    if (aux) head += '  ' + aux.rel;
    if (cap && cap.rows && cap.rows[k]) head += '  τ=' + cgSI(cap.rows[k].tau, 's');
    c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillStyle = 'rgba(224,230,240,0.55)';
    c.fillText(head, plotL + 4, top + 2);

    // 波形。過去の捕捉は薄く重ねる（R や C を変えて再トリガすると比較できる）
    c.save();
    c.beginPath(); c.rect(plotL, top, plotW, rowH); c.clip();
    cgDrawGhosts(c, g, D, k, X, YV, YI, CG_COL_V, CG_COL_I);
    if (g.showV) cgCurve(c, S, from, t1, s => s.v[k], X, YV, [], CG_COL_V);
    if (g.showI) cgCurve(c, S, from, t1, s => s.i[k], X, YI, CG_DASH_I, CG_COL_I);
    c.restore();

    // ── その段のベクトル図。V と I の間の角がその素子の位相差 φ そのもの ──
    if (phOn) {
      const it = ph.items.find(o => o.k === k);
      if (it) cgDrawPhasor(c, padL + phSize / 2, cy, phSize / 2 - 8, ph, it,
                           sc, g, plotL + plotW);
    }
  }
  cgDrawTimeAxis(c, g, D, plotL, plotW, H - padB);
  cgDrawCursor(c, g, D, rows, plotL, plotW, padT, H - padB, W, H);
}
// 回転ベクトル1組（V と I）。縦成分が波形の現在値になるよう同じ縦スケールで描く
function cgDrawPhasor(c, ccx, ccy, R, ph, it, sc, g, tipX) {
  if (R < 8) return;
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
  c.beginPath(); c.arc(ccx, ccy, R, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(ccx - R, ccy); c.lineTo(ccx + R, ccy);
  c.moveTo(ccx, ccy - R); c.lineTo(ccx, ccy + R); c.stroke();
  const wt = 2 * Math.PI * ph.f * ph.tEnd;
  const arrow = (amp, phase, scale, col, dash) => {
    const r = (amp / scale) * R;
    if (!(r > 0.5)) return null;
    const ang = wt + phase;                          // x = A sin(ωt+φ)
    const ex = ccx + r * Math.cos(ang), ey = ccy - r * Math.sin(ang);
    c.save(); c.setLineDash(dash);
    drawArrow(c, ccx, ccy, ex, ey, 'rgba(0,0,0,0.6)', 4);
    drawArrow(c, ccx, ccy, ex, ey, col, 2);
    c.restore();
    return { x: ex, y: ey };
  };
  const tipV = g.showV ? arrow(it.V.amp, it.V.phase, sc.vMax, CG_COL_V, []) : null;
  const tipI = g.showI ? arrow(it.I.amp, it.I.phase, sc.iMax, CG_COL_I, CG_DASH_I) : null;
  c.save(); c.setLineDash([2, 3]); c.strokeStyle = 'rgba(255,255,255,0.30)'; c.lineWidth = 1;
  for (const tip of [tipV, tipI]) {
    if (!tip) continue;
    c.beginPath(); c.moveTo(tip.x, tip.y); c.lineTo(tipX, tip.y); c.stroke();
  }
  c.restore();
  // 位相差を数値で。コイル +90°／コンデンサー −90°／抵抗 0° が段の中で確認できる
  c.fillStyle = 'rgba(224,230,240,0.6)'; c.font = '9px sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'top';
  c.fillText('φ=' + (it.phi * 180 / Math.PI).toFixed(0) + '°', ccx, ccy + R + 1);
  c.textAlign = 'left';
}
// 時間軸。捕捉表示のときはトリガ時刻を 0 にとって τ の目盛りを重ねる
function cgDrawTimeAxis(c, g, D, plotL, plotW, yBase) {
  const { t0, t1, cap } = D;
  const X = t => plotL + ((t - t0) / Math.max(1e-9, t1 - t0)) * plotW;
  c.font = '9px sans-serif'; c.textBaseline = 'alphabetic';
  c.fillStyle = 'rgba(224,230,240,0.6)';
  if (!cap) {
    c.textAlign = 'left';  c.fillText(t0.toFixed(2) + 's', plotL + 1, yBase + 12);
    c.textAlign = 'right'; c.fillText(t1.toFixed(2) + 's', plotL + plotW, yBase + 12);
    c.textAlign = 'left';
    return;
  }
  // トリガの瞬間
  c.save();
  c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1; c.setLineDash([2, 2]);
  c.beginPath(); c.moveTo(X(cap.tEvent), 0); c.lineTo(X(cap.tEvent), yBase); c.stroke();
  // τ・2τ・3τ の目盛り。生徒が横軸から時定数を読み取れるようにする
  if (cap.tau) {
    c.strokeStyle = 'rgba(102,187,106,0.35)'; c.setLineDash([4, 4]);
    for (let m = 1; m <= 5; m++) {
      const tx = X(cap.tEvent + m * cap.tau);
      if (tx > plotL + plotW) break;
      c.beginPath(); c.moveTo(tx, 0); c.lineTo(tx, yBase); c.stroke();
      c.fillStyle = 'rgba(102,187,106,0.7)'; c.textAlign = 'center';
      c.fillText(m === 1 ? 'τ' : m + 'τ', tx, yBase + 12);
    }
  }
  c.restore();
  c.fillStyle = 'rgba(224,230,240,0.6)';
  c.textAlign = 'left';
  c.fillText('0（トリガ）', X(cap.tEvent) + 2, yBase + 12);
  c.textAlign = 'right';
  c.fillText('+' + cgSI(t1 - cap.tEvent, 's'), plotL + plotW, yBase + 12);
  c.textAlign = 'left';
}

// ── 重ね表示（従来の見せ方）─────────────────────────
//   直列回路で「電流はどこでも同じ」を示すときは、2本がぴったり重なることが証拠になる
function drawCircGraphOverlay(g, D, els, W, H) {
  const c = g.ctx, { S, t0, t1 } = D;
  const ph = g._ph;
  const showPh = g.showPhasor && ph && ph.ok;
  const padL = 38, padR = 34, padT = 10, padB = 18;
  const phSize = showPh ? Math.min(H - padT - padB, Math.floor(W * 0.42)) : 0;
  const plotL = padL + (showPh ? phSize + 16 : 0);
  const plotW = Math.max(30, W - plotL - padR);
  const plotT = padT, plotH = H - padT - padB;
  const cy = plotT + plotH / 2;
  const X = t => plotL + ((t - t0) / Math.max(1e-9, t1 - t0)) * plotW;
  const from = circIndexBefore(S, t0);
  const sc = cgScalesAll(D, g.pins.length, null);
  const half = plotH / 2;
  const YV = v => cy - (v / sc.vMax) * half;
  const YI = i => cy - (i / sc.iMax) * half;

  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
  c.strokeRect(plotL, plotT, plotW, plotH);
  c.beginPath(); c.moveTo(plotL, cy); c.lineTo(plotL + plotW, cy); c.stroke();
  c.font = '9px sans-serif'; c.textBaseline = 'middle';
  c.fillStyle = 'rgba(224,230,240,0.6)'; c.textAlign = 'right';
  if (g.showV) { c.fillText(cgSI(sc.vMax, 'V'), plotL - 3, plotT + 6);
                 c.fillText('0', plotL - 3, cy); }
  if (g.showI) { c.textAlign = 'left';
                 c.fillText(cgSI(sc.iMax, 'A'), plotL + plotW + 3, plotT + 6); }

  c.save();
  c.beginPath(); c.rect(plotL, plotT, plotW, plotH); c.clip();
  for (let k = 0; k < els.length; k++) {
    if (!els[k]) continue;
    const col = CG_COLORS[k % CG_COLORS.length];
    cgDrawGhosts(c, g, D, k, X, YV, YI, col, col);
    if (g.showV) cgCurve(c, S, from, t1, s => s.v[k], X, YV, [], col);
    if (g.showI) cgCurve(c, S, from, t1, s => s.i[k], X, YI, CG_DASH_I, col);
  }
  c.restore();

  if (showPh) {
    for (const it of ph.items) {
      const col = CG_COLORS[it.k % CG_COLORS.length];
      cgDrawPhasorOverlay(c, padL + phSize / 2, cy, phSize / 2 - 12, ph, it, sc, g,
                          plotL + plotW, col);
    }
    c.fillStyle = 'rgba(224,230,240,0.6)'; c.font = '9px sans-serif'; c.textAlign = 'center';
    c.fillText(`${ph.f}Hz で回転中（縦成分＝波形の現在値）`, padL + phSize / 2, plotT + plotH + 12);
    c.textAlign = 'left';
  }
  cgDrawTimeAxis(c, g, D, plotL, plotW, plotT + plotH);
  const rows = els.map((e, k) => ({ k, e, top: plotT, h: plotH, cy, sc, YV, YI }));
  cgDrawCursor(c, g, D, rows, plotL, plotW, plotT, plotT + plotH, W, H, true);
}
// ── 電流−電圧：既定は横軸＝電圧・縦軸＝電流。入れ替えると横＝電流・縦＝電圧 ─────────
//   記録した (V, I) の跡をそのまま描く。素子の特性（豆電球の曲線・抵抗の原点を通る直線）も、
//   回路のほうが課す関係（電池の端子電圧 V ＝ E − rI の直線）も、
//   式を与えて描くのではなく、つまみを回して通った点の並びとして出る。
//   ★向きは2通りとも要る。特性曲線（オームの法則・豆電球）は横＝V・縦＝I が教科書の向きで、
//     傾きが 1/R。電池の起電力と内部抵抗の測定は横＝I・縦＝V が教科書の向きで、
//     傾きがそのまま −r・縦軸の切片が E になる（横＝V だと傾きは −1/r で、r が直接読めない）。
//   ★原点はいつも枠に入れる。切片（V＝0 の I、I＝0 の V）を読むのが主な使い道なので、
//     点の範囲だけに合わせると軸が枠の外へ出て読めなくなる。
//   ★縦軸・横軸は全素子で共通（重ね表示と同じ）。同じ回路の素子どうしを同じ目盛りで比べる。
function cgNiceStep(range, n) {
  const raw = range / Math.max(1, n);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
// 描く系列。1系列＝電圧をとる列 kv と電流をとる列 ki の組。ふつうは1素子の V と I（kv＝ki）。
//   ★電流計と電圧計を両方入れた窓では、電流計の読みと電圧計の読みを組にして1系列にする
//     （k 番目の電流計と k 番目の電圧計）。計器は片方の量しか読まない（電流計の電圧・電圧計の
//     電流はほぼ 0）ので、素子ごとに描くと軸に張り付いた線が2本出るだけになる。実験で
//     グラフにするのは「計器の読み」で、どの素子の V・I かは計器のつなぎ方が決める。
function cgIVSeries(els) {
  const am = [], vm = [], out = [];
  els.forEach((e, k) => { if (e && e.type === 'ammeter') am.push(k); else if (e && e.type === 'voltmeter') vm.push(k); });
  const n = Math.min(am.length, vm.length);
  const paired = new Set([...am.slice(0, n), ...vm.slice(0, n)]);
  for (let j = 0; j < n; j++) out.push({ kv: vm[j], ki: am[j], col: CG_COLORS[am[j] % CG_COLORS.length] });
  els.forEach((e, k) => { if (e && !paired.has(k)) out.push({ kv: k, ki: k, col: CG_COLORS[k % CG_COLORS.length] }); });
  return out;
}
function drawCircGraphIV(g, els, W, H) {
  const c = g.ctx, S = g.samples;
  const AV = { of: (s, q) => s.v[q.kv], name: '電圧 V [V]', sym: 'V', unit: 'V' };
  const AI = { of: (s, q) => s.i[q.ki], name: '電流 I [A]', sym: 'I', unit: 'A' };
  const ser = cgIVSeries(els);
  const ax = g.ivSwap ? AI : AV, ay = g.ivSwap ? AV : AI;   // 横・縦
  const padL = 46, padR = 12, padT = 16, padB = 28;   // ★上の余白は縦軸の名前の場所（枠の中に置くと点に掛かる）
  const plotL = padL, plotT = padT;
  const plotW = Math.max(30, W - padL - padR), plotH = Math.max(30, H - padT - padB);
  let xLo = 0, xHi = 0, yLo = 0, yHi = 0;
  for (const s of S) for (const q of ser) {
    const x = ax.of(s, q), y = ay.of(s, q);
    if (x < xLo) xLo = x; if (x > xHi) xHi = x;
    if (y < yLo) yLo = y; if (y > yHi) yHi = y;
  }
  const padRange = (lo, hi) => {
    const d = hi - lo > 1e-12 ? hi - lo : 1;
    return [lo < 0 ? lo - 0.08 * d : 0, hi > 0 ? hi + 0.08 * d : (lo < 0 ? 0 : 1)];
  };
  [xLo, xHi] = padRange(xLo, xHi);
  [yLo, yHi] = padRange(yLo, yHi);
  const X = x => plotL + (x - xLo) / (xHi - xLo) * plotW;
  const Y = y => plotT + plotH - (y - yLo) / (yHi - yLo) * plotH;

  // 目盛りと格子。0 の線だけ明るくする
  c.font = '9px sans-serif'; c.lineWidth = 1;
  const sx = cgNiceStep(xHi - xLo, Math.max(2, Math.floor(plotW / 60)));
  const sy = cgNiceStep(yHi - yLo, Math.max(2, Math.floor(plotH / 32)));
  c.fillStyle = 'rgba(224,230,240,0.6)';
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let x = Math.ceil(xLo / sx) * sx; x <= xHi + 1e-9 * sx; x += sx) {
    const px = X(x), zero = Math.abs(x) < sx * 1e-6;
    c.strokeStyle = zero ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)';
    c.beginPath(); c.moveTo(px, plotT); c.lineTo(px, plotT + plotH); c.stroke();
    c.fillText(zero ? '0' : cgSI(x, ''), px, plotT + plotH + 3);
  }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let y = Math.ceil(yLo / sy) * sy; y <= yHi + 1e-9 * sy; y += sy) {
    const py = Y(y), zero = Math.abs(y) < sy * 1e-6;
    c.strokeStyle = zero ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)';
    c.beginPath(); c.moveTo(plotL, py); c.lineTo(plotL + plotW, py); c.stroke();
    if (!zero) c.fillText(cgSI(y, ''), plotL - 3, py);
  }
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.strokeRect(plotL, plotT, plotW, plotH);
  c.fillStyle = 'rgba(224,230,240,0.75)';
  c.textAlign = 'right'; c.textBaseline = 'bottom';
  c.fillText(ax.name, plotL + plotW, H - 1);
  c.textAlign = 'left'; c.textBaseline = 'bottom';
  c.fillText(ay.name, 4, plotT - 3);

  // 点の跡。★線でつながず点で打つ。つまみを跳ばしたときに、通っていない区間まで
  //   線で埋めると「そこも測った」ように見える
  c.save();
  c.beginPath(); c.rect(plotL, plotT, plotW, plotH); c.clip();
  const last = S[S.length - 1];
  for (const q of ser) {
    c.fillStyle = q.col;
    c.globalAlpha = 0.55;
    for (const s of S) c.fillRect(X(ax.of(s, q)) - 1.2, Y(ay.of(s, q)) - 1.2, 2.4, 2.4);
    c.globalAlpha = 1;
    if (last) {
      c.beginPath(); c.arc(X(ax.of(last, q)), Y(ay.of(last, q)), 4.5, 0, Math.PI * 2);
      c.fill(); c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.2; c.stroke();
    }
  }
  c.restore();

  // カーソル：その位置の電圧・電流を読む（切片や傾きを読むため）
  const hv = g.hover;
  if (hv && hv.x >= plotL && hv.x <= plotL + plotW && hv.y >= plotT && hv.y <= plotT + plotH) {
    const x = xLo + (hv.x - plotL) / plotW * (xHi - xLo);
    const y = yLo + (plotT + plotH - hv.y) / plotH * (yHi - yLo);
    c.save();
    c.setLineDash([3, 3]); c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.beginPath(); c.moveTo(hv.x, plotT); c.lineTo(hv.x, plotT + plotH);
    c.moveTo(plotL, hv.y); c.lineTo(plotL + plotW, hv.y); c.stroke();
    c.setLineDash([]);
    const txt = ax.sym + '=' + cgSI(x, ax.unit) + '  ' + ay.sym + '=' + cgSI(y, ay.unit);
    c.font = '10px sans-serif';
    const bw = c.measureText(txt).width + 12, bh = 18;
    const bx = hv.x < W / 2 ? plotL + plotW - bw - 2 : plotL + 2;
    const by = hv.y < H / 2 ? plotT + plotH - bh - 2 : plotT + 2;
    c.fillStyle = 'rgba(16,18,24,0.92)'; c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(bx, by, bw, bh); c.strokeRect(bx, by, bw, bh);
    c.fillStyle = 'rgba(224,230,240,0.95)'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(txt, bx + 6, by + bh / 2);
    c.restore();
  }
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}
// 重ね表示のベクトル図。素子ごとの色で V・I を1つの円に描く（従来どおり）
function cgDrawPhasorOverlay(c, ccx, ccy, R, ph, it, sc, g, tipX, col) {
  if (R < 8) return;
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
  c.beginPath(); c.arc(ccx, ccy, R, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(ccx - R, ccy); c.lineTo(ccx + R, ccy);
  c.moveTo(ccx, ccy - R); c.lineTo(ccx, ccy + R); c.stroke();
  const wt = 2 * Math.PI * ph.f * ph.tEnd;
  const arrow = (amp, phase, scale, dash) => {
    const r = (amp / scale) * R;
    if (!(r > 0.5)) return null;
    const ang = wt + phase;
    const ex = ccx + r * Math.cos(ang), ey = ccy - r * Math.sin(ang);
    c.save(); c.setLineDash(dash);
    drawArrow(c, ccx, ccy, ex, ey, 'rgba(0,0,0,0.6)', 4);
    drawArrow(c, ccx, ccy, ex, ey, col, 2);
    c.restore();
    return { x: ex, y: ey };
  };
  const tipV = g.showV ? arrow(it.V.amp, it.V.phase, sc.vMax, []) : null;
  const tipI = g.showI ? arrow(it.I.amp, it.I.phase, sc.iMax, CG_DASH_I) : null;
  c.save(); c.setLineDash([2, 3]); c.strokeStyle = 'rgba(255,255,255,0.30)'; c.lineWidth = 1;
  for (const tip of [tipV, tipI]) {
    if (!tip) continue;
    c.beginPath(); c.moveTo(tip.x, tip.y); c.lineTo(tipX, tip.y); c.stroke();
  }
  c.restore();
}

// ── カーソル：全段を貫く1本の縦線で、同じ時刻の値をまとめて読む ────────
//   KVL（各素子の電圧の和＝電源電圧）や、直列での電流の一致をその場で確かめられる
function cgDrawCursor(c, g, D, rows, plotL, plotW, yTop, yBot, W, H, overlay) {
  const hv = g.hover;
  const { S, t0, t1, cap } = D;
  if (!hv || !S.length) return;
  if (hv.x < plotL || hv.x > plotL + plotW || hv.y < yTop || hv.y > yBot) return;
  const X = t => plotL + ((t - t0) / Math.max(1e-9, t1 - t0)) * plotW;
  const tCur = t0 + ((hv.x - plotL) / plotW) * (t1 - t0);
  const idx = circIndexBefore(S, tCur);
  const s = (idx > 0 && Math.abs(S[idx - 1].t - tCur) < Math.abs(S[idx].t - tCur)) ? S[idx - 1] : S[idx];
  const hx = X(s.t);
  c.save();
  c.setLineDash([3, 3]); c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(hx, yTop); c.lineTo(hx, yBot); c.stroke();
  c.setLineDash([]);
  const tTxt = cap ? ('t = ' + cgSI(s.t - cap.tEvent, 's') + '（トリガから）')
                   : ('t = ' + s.t.toFixed(3) + ' s');
  const lines = [{ txt: tTxt, col: 'rgba(224,230,240,0.95)' }];
  for (const r of rows) {
    if (!r.e) continue;
    const colV = overlay ? CG_COLORS[r.k % CG_COLORS.length] : CG_COL_V;
    const colI = overlay ? CG_COLORS[r.k % CG_COLORS.length] : CG_COL_I;
    c.save();
    c.beginPath(); c.rect(plotL, r.top, plotW, r.h); c.clip();   // 枠外の点は隣の段へ漏らさない
    if (g.showV) { c.beginPath(); c.arc(hx, r.YV(s.v[r.k]), 3.2, 0, Math.PI * 2);
                   c.fillStyle = colV; c.fill();
                   c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.stroke(); }
    if (g.showI) { c.beginPath(); c.arc(hx, r.YI(s.i[r.k]), 3.2, 0, Math.PI * 2);
                   c.fillStyle = '#1a1c23'; c.fill();
                   c.strokeStyle = colI; c.lineWidth = 1.6; c.stroke(); }
    c.restore();
    let txt = circGraphLabel(r.e) + '  ';
    if (g.showV) txt += 'V=' + cgSI(s.v[r.k], 'V') + '  ';
    if (g.showI) txt += 'I=' + cgSI(s.i[r.k], 'A');
    const aux = cgAux(r.e);
    if (aux && s.q[r.k] !== null && s.q[r.k] !== undefined)
      txt += '  ' + aux.sym + '=' + cgSI(s.q[r.k], aux.unit);
    const U = cgEnergy(r.e, s.v[r.k], s.i[r.k]);
    if (U !== null) txt += '  U=' + cgSI(U, 'J');
    lines.push({ txt, col: overlay ? CG_COLORS[r.k % CG_COLORS.length] : 'rgba(224,230,240,0.85)' });
  }
  c.font = '10px sans-serif'; c.textBaseline = 'top'; c.textAlign = 'left';
  let bw = 0;
  for (const L of lines) bw = Math.max(bw, c.measureText(L.txt).width);
  bw += 12;
  const bh = lines.length * 13 + 8;
  // 読み取り箱はカーソルに追従させず、カーソルから遠い隅へ寄せる（波形を隠さない）
  let bx = (hv.x < W / 2) ? (W - 4 - bw) : 4;
  let by = (hv.y < H / 2) ? (yBot - bh - 2) : (yTop + 2);
  bx = Math.max(2, Math.min(bx, W - 2 - bw));
  by = Math.max(2, Math.min(by, H - 2 - bh));
  c.fillStyle = 'rgba(16,18,24,0.92)'; c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1;
  c.beginPath(); c.rect(bx, by, bw, bh); c.fill(); c.stroke();
  lines.forEach((L, i) => { c.fillStyle = L.col; c.fillText(L.txt, bx + 6, by + 5 + i * 13); });
  c.textBaseline = 'alphabetic';
  c.restore();
}
// ★注意書きは canvas ではなくパネル側の行に出す（波形と重ならないように）
function cgDrawNote(g) {
  if (!g.noteEl) return;
  const ph = g._ph;
  const cap = (g.view === 'capture' && g.captures.length) ? g.captures[g.captures.length - 1] : null;
  const msgs = [];
  if (g.showPhasor && !(ph && ph.ok))
    msgs.push('ベクトル図は表示できません — ' + ((ph && ph.why) || '判定中'));
  if (cap && cap.note) msgs.push(cap.note);
  if (g.trigArm && !cap && !g.cap && running)
    msgs.push('トリガ待ち — スイッチの開閉や値の変更で過渡を捕捉します');
  if (!msgs.length) { g.noteEl.style.display = 'none'; return; }
  g.noteEl.style.display = '';
  g.noteEl.textContent = msgs.join(' ／ ');
}
// 素子ごとの現在値と、定常なら実効値・位相差・平均電力。行の × でその系列を外せる。
//   ★行の DOM は系列が変わったときだけ作り直し、毎フレームは文字だけ差し替える。
//     毎フレーム innerHTML を組み直すと、× を押し下げてから離すまでのあいだに
//     要素が作り替えられてしまい、click が成立しない（＝ボタンが効かない）。
function circGraphBuildRows(g, els) {
  g.readEl.innerHTML = '';
  g._rows = [];
  for (let k = 0; k < els.length; k++) {
    const e = els[k];
    if (!e) continue;
    const col = CG_COLORS[k % CG_COLORS.length];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:10px;color:' + col;
    const txt = document.createElement('span');
    txt.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const x = document.createElement('span');
    x.textContent = '×';
    x.title = 'この系列をグラフから外します';
    x.style.cssText = 'cursor:pointer;color:var(--text2);padding:0 4px;line-height:1';
    x.addEventListener('click', ev => { ev.stopPropagation(); circGraphUnpin(g, e.id); });
    row.appendChild(txt); row.appendChild(x);
    g.readEl.appendChild(row);
    g._rows.push({ id: e.id, k, txt });
  }
  g._rowKey = g.pins.join(',');
}
function drawCircGraphReadout(g, els, ph) {
  const S = g.samples;
  if (!S.length || !g.readEl) return;
  if (g._rowKey !== g.pins.join(',')) circGraphBuildRows(g, els);
  const last = S[S.length - 1];
  for (const r of g._rows) {
    const e = els[r.k];
    if (!e) continue;
    const it = (ph && ph.ok) ? ph.items.find(o => o.k === r.k) : null;
    let s = `${circGraphLabel(e)}  V=${last.v[r.k].toFixed(2)}  I=${last.i[r.k].toFixed(3)}`;
    const aux = cgAux(e);
    if (aux && last.q[r.k] !== null && last.q[r.k] !== undefined)
      s += `  ${aux.rel}=${cgSI(last.q[r.k], aux.unit)}`;
    const U = cgEnergy(e, last.v[r.k], last.i[r.k]);
    if (U !== null) s += `  U=${cgSI(U, 'J')}`;
    if (it) s += `  Vrms=${it.V.rms.toFixed(2)} Irms=${it.I.rms.toFixed(3)}`
              + `  φ=${(it.phi * 180 / Math.PI).toFixed(0)}°  P=${it.P.toFixed(3)}W`;
    if (r.txt.textContent !== s) r.txt.textContent = s;
  }
}
