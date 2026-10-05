// ══════════════════════════════════════════════════════════════
//  エネルギーのグラフ
//   ★1ウィンドウ＝1つの「系」（選んだ物体の集合）。velgraph の「1ウィンドウ＝1物体」
//     とはここが違う。エネルギーには物体1個に属さない項（弾性・万有引力・静電気力）が
//     あり、系を単位にしないと置き場所が決まらないため（規則は physics/energy.js）。
//     開いたあとは対象を追い続け、キャンバス側の選択を変えても乗り換えない。
//   ★描き方は2通り。既定は「重ね」。
//     ・重ね  … どの量も 0 から立ち上がる自分自身の曲線。投げ上げなら位置は上に凸、
//               運動は下に凸で、交わりながら和が一定になるのが読める。
//               ★他の量を出しても各曲線の形は変わらない。これが既定の理由。
//     ・積み上げ… 前の量の上に積む。上端がそのまま合計になるので「運動が減った分だけ
//               位置が増える」受け渡しが面積で見えるが、各量の曲線の形は崩れる
//               （2本目以降は下駄をはくため）。変換のようすを見せたいときに使う。
//   ★量の関係（パネルにも1行で出している）
//         力学的エネルギー ＝ 運動（並進＋回転）＋ 位置（重力・弾性・万有引力・静電気力）
//     基準として E(0)（記録を始めた瞬間の力学的エネルギー）の水平線だけを引く。
//     線より下なら熱などに変わった、上なら外から仕事が入った、と読む。
//   ★「失われた分（E(0)−E(t)）」の帯は置かない。他の量がすべて“その瞬間の値”なのに
//     これだけが“始めからの積算値”で、同じ軸に混ぜると量の性格が揃わないため。
//     増減は力学的エネルギーの線が E(0) の線から離れる向きで読める（同じ情報）。
//   ★位置エネルギーの基準は「原点を通り重力に垂直な面（見かけの水平）」の一択。
//     選ばせない代わりに、その面を画面に描くスイッチをパネルに置く。
//     ・基準を「記録開始位置」に取ると E(0)=0 になり、E(0) の線と 0 の線が重なって
//       「どれだけ減ったか」が読めなくなる。それも基準を固定した理由。
// ══════════════════════════════════════════════════════════════
const EG_MAX_SAMPLES = 20000;   // 安全上限（velgraph と同じ。60fps で約5.5分ぶん）
const EG_MAX_SERIES  = 24;      // 内訳で描ける系列の上限（超えたら内訳は使えない）
const EG_READOUT_ROWS = 12;     // 読み取り箱に並べる行数の上限
const EG_MAX_WINDOWS = 6;       // 同時に開ける数（毎フレーム面を塗るので velgraph より控えめ）
const EG_COL_MECH    = '#ffd54f';   // 力学的エネルギー
const EG_COL_E0      = 'rgba(255,255,255,0.45)';   // E(0) の目安線
// 積み上げる順番＝この順番。applies はその項が今の場面に存在するか（無い項は出さない）
const EG_BANDS = [
  { key:'kt',  flag:'showKt',  label:'運動(並進)',      col:'#42a5f5', applies:() => true },
  { key:'kr',  flag:'showKr',  label:'運動(回転)',      col:'#7e57c2', applies:() => true },
  { key:'ug',  flag:'showUg',  label:'位置(重力)',      col:'#66bb6a', applies:() => true },
  { key:'us',  flag:'showUs',  label:'弾性(ばね)',      col:'#ffa726',
    // ★ばねは2種類ある：ジョイントの spring と、Slinky（demoSpring やばねツールの理想ばね）。
    //   systemEnergy は両方を us に数えるので、行の有無も両方で決める。以前は spring だけを見て
    //   いたため、Slinky のばねを使うデモ（位置→運動→ばね ほか）で弾性の線と凡例が出ず、
    //   合計にだけ入っていた（2026-10-01 に気づいて直した）。
    applies:(bodies, ids) => joints.some(j => j.type === 'spring' && springCounts(j, ids))
                          || slinkies.some(S => slinkyCounts(S, ids)) },
  { key:'ugg', flag:'showUgg', label:'位置(万有引力)',  col:'#26c6da',
    applies:(bodies, ids) => world.gravitation && bodies.some(b => b.hasGravity)
                          && objects.filter(o => o.hasGravity).length >= 2 },
  { key:'ue',  flag:'showUe',  label:'位置(静電気力)',  col:'#ec407a',
    applies:(bodies, ids) => world.coulombOn && bodies.some(b => b.charge)
                          && objects.filter(o => o.charge).length >= 2 },
];

// ── ウィンドウの検索 ───────────────────────────────────
function eneGraphBodies(g) {
  const out = [];
  for (const id of g.bodyIds) { const b = objects.find(o => o.id === id); if (b) out.push(b); }
  return out;
}
function eneGraphIds(g) { return new Set(g.bodyIds); }
// いま選んでいる集合と同じ系のウィンドウ（あれば）。トグルの判定に使う
function eneGraphOfSelection() {
  const ids = objects.filter(o => selectedIds.has(o.id) && !energyDriven(o)).map(o => o.id).sort((a,b) => a-b);
  if (!ids.length) return null;
  return eneGraphs.find(g => g.bodyIds.length === ids.length
                          && g.bodyIds.every((v, i) => v === ids[i])) || null;
}
function eneGraphName(g) {
  const bs = eneGraphBodies(g);
  if (!bs.length) return '（対象なし）';
  const head = bs[0].label || ('Object ' + bs[0].id);
  return bs.length === 1 ? head : (head + ' ほか' + (bs.length - 1) + '個');
}
// 対象が消えたウィンドウの後始末。
//   ★全部消えたら閉じる。一部だけ消えた場合は閉じずに記録を止める：系の顔ぶれが
//     変わった時点で E(0) と比べる意味がなくなるので、続けて記録すると帯が嘘になる。
function eneGraphPrune() {
  for (const g of eneGraphs.slice()) {
    const n = eneGraphBodies(g).length;
    if (!n) { eneGraphClose(g); continue; }
    if (n < g.bodyIds.length && !g.frozen) {
      g.frozen = true; g.stopReason = 'lost';
      updateEnergyGraphStatus(g);
    }
  }
}

// ── ウィンドウの生成と破棄 ─────────────────────────────
function eneGraphNew(ids, opts) {
  const g = {
    id: ++eneGraphSeq,
    bodyIds: ids.slice(),   // ★追跡する系（生きているかぎり変わらない）
    t: 0,
    samples: [],            // {t, kt, kr, ug, us, ugg, ue}
    mode: 'over',           // 'over'＝重ね（既定） / 'stack'＝積み上げ
    breakdown: false,       // ★内訳（物体ごと・ばねごと・ペアごと）に分ける
    showKt: true, showKr: true, showUg: true, showUs: true, showUgg: true, showUe: true,
    showMech: true,
    frozen: false,
    stopReason: null,       // 'user' | 'limit' | 'lost' | null
    hover: null,
    _buf: null,             // 面を塗るための作業配列（毎フレームの確保を避ける）
  };
  // ★シーンから復元するときの表示の選択。窓を組み立てる前に入れる（組み立て側が
  //   g の値からチェックを入れるので、あとから代入すると画面と中身がずれる）
  if (opts) Object.assign(g, opts);
  eneGraphs.push(g);
  eneGraphBuildPanel(g);
  eneGraphSampleNow(g);     // ★実行前の状態を t=0 の点として記録（E(0) の基準になる）
  updateEnergyGraphStatus(g);
  return g;
}
function eneGraphClose(g) {
  const at = eneGraphs.indexOf(g);
  if (at >= 0) eneGraphs.splice(at, 1);
  if (g.panel) g.panel.remove();
  refreshEneGraphButton();
}
function eneGraphBuildPanel(g) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'enegraph-panel';
  const off = graphCascadeOffset();
  panel.style.right  = (10 + off) + 'px';
  panel.style.bottom = (10 + off) + 'px';
  const chk = (cls, col, label) =>
    '<label class="vg-check ' + cls + '-row"><input type="checkbox" class="' + cls + '">' +
    '<span class="vg-chip" style="background:' + col + '"></span>' + label + '</label>';
  let bandChecks = '';
  for (const b of EG_BANDS) bandChecks += chk('eg-' + b.key, b.col, b.label);
  panel.innerHTML =
    '<div class="vg-header">' +
      '<span class="vg-title"></span>' +
      '<span class="vg-status"></span>' +
      '<span class="vg-close">×</span>' +
    '</div>' +
    '<canvas></canvas>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp" title="どれも単位は [J] です。その場面に無い項（ばねが無い、万有引力OFF など）は出しません">量</span>' +
      bandChecks +
    '</div>' +
    '<div class="vg-controls">' +
      '<span class="vg-grp" title="力学的エネルギー＝上の量の合計。あわせて E(0)（記録を始めた瞬間の値）の水平線を引きます">和</span>' +
      chk('eg-mech', EG_COL_MECH, '力学的E ＋ E(0)の線') +
      '<label class="vg-check eg-bd-row"><input type="checkbox" class="eg-bd">内訳</label>' +
      '<span class="vg-grp" style="margin-left:8px">描き方</span>' +
      '<select class="eg-mode">' +
        '<option value="over">重ね（0から）</option>' +
        '<option value="stack">積み上げ</option>' +
      '</select>' +
    '</div>' +
    '<div class="eg-ref-note">' +
      '<div><b>力学的E</b>＝運動＋位置のぜんぶ。<b>E(0)</b>の線より下なら熱などに変わった分、上なら外から入った分です</div>' +
      '<div>位置エネルギーの基準は<b>原点を通る見かけの水平面</b>（重力に垂直）です。' +
        '<span class="eg-ref-show">この面を表示</span></div>' +
    '</div>' +
    '<div class="vg-controls">' +
      '<span class="vg-hint">グラフ上にカーソルを置くと値を読めます</span>' +
      '<button class="btn-small eg-rec" title="記録を一時停止します（グラフは残ります）">停止</button>' +
      '<button class="btn-small eg-reset">リセット</button>' +
    '</div>' +
    '<div class="eg-note" style="display:none"></div>';
  host.appendChild(panel);
  g.panel    = panel;
  g.canvas   = panel.querySelector('canvas');
  g.ctx      = g.canvas.getContext('2d');
  g.titleEl  = panel.querySelector('.vg-title');
  g.statusEl = panel.querySelector('.vg-status');
  g.recBtn   = panel.querySelector('.eg-rec');
  g.noteEl   = panel.querySelector('.eg-note');
  g.rowEls   = {};
  panel.querySelector('.vg-close').addEventListener('click', () => eneGraphClose(g));
  const binds = EG_BANDS.map(b => ['.eg-' + b.key, b.flag])
                        .concat([['.eg-mech','showMech']]);
  for (const [cls, key] of binds) {
    const cb = panel.querySelector(cls);
    cb.checked = g[key];
    cb.addEventListener('change', ev => g[key] = ev.target.checked);
  }
  for (const b of EG_BANDS) g.rowEls[b.key] = panel.querySelector('.eg-' + b.key + '-row');
  g.bdBox = panel.querySelector('.eg-bd');
  g.bdBox.checked = g.breakdown;
  g.bdBox.addEventListener('change', ev => g.breakdown = ev.target.checked);
  panel.querySelector('.eg-bd-row').title =
    '各項を、その項の“自然な単位”に分けて描きます。\n'
  + '　運動・重力 … 物体ごと（物体1個で決まる量）\n'
  + '　弾性 … ばねごと／万有引力・静電気力 … ペアごと\n'
  + '※万有引力と静電気力は「2つの物体の配置」が持つ量なので、物体ごとには分けられません'
  + '（片方に配ると足したとき2倍になります）。相手が固定した物体（動かない太陽・固定した電荷）'
  + 'なら、ペア＝その動く物体1個に対応します';
  const mode = panel.querySelector('.eg-mode');
  mode.value = g.mode;
  mode.title = '重ね：どの量も0から立ち上がる自分の曲線。他の量を出しても形は変わりません。\n'
             + '積み上げ：前の量の上に積むので、上端が合計になり「運動が位置に変わる」受け渡しが見えます'
             + '（そのぶん2本目以降の曲線は下駄をはきます）';
  mode.addEventListener('change', ev => g.mode = ev.target.value);
  // ★基準の面を画面に描くスイッチ。「基準はどこに取ってもよい」は言葉で言うより、
  //   線を出して重力を傾け、値がずれても山と谷の差は変わらないのを見せるほうが早い。
  const refNote = panel.querySelector('.eg-ref-note');
  refNote.title = 'エネルギーの基準はどこに取っても構いません（差だけが物理的な意味を持ちます）。'
                + 'このグラフでは原点を通り重力に垂直な面を 0 とします。'
                + '重力が真下を向いていれば、既定の地面（y=0）と同じ高さです';
  panel.querySelector('.eg-ref-show').addEventListener('click', () => {
    world.showGravityLine = !world.showGravityLine;
    if (typeof syncWorldPanel === 'function') syncWorldPanel();
    eneGraphSyncRefNote(g);
  });
  eneGraphSyncRefNote(g);
  g.recBtn.addEventListener('click', () => toggleEnergyGraphRecording(g));
  panel.querySelector('.eg-reset').addEventListener('click', () => resetEnergyGraphOne(g));
  g.canvas.addEventListener('mousemove', ev => {
    const r = g.canvas.getBoundingClientRect();
    g.hover = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  g.canvas.addEventListener('mouseleave', () => g.hover = null);
  eneGraphMakeDraggable(g);
}
// ヘッダーのドラッグで移動（velgraph と同じ作り。right/bottom 基準のままだと
// ドラッグでサイズが変わるので、親基準の left/top へ変換してから動かす）
function eneGraphMakeDraggable(g) {
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

// ── 出し入れ ──────────────────────────────────────────
//   選択した物体をまとめて1つの系にする。同じ顔ぶれの系がもう開いていれば閉じる（トグル）。
//   ★静的物体は系に入れない（energy.js の方針）。壁を一緒に囲って選んでも結果は変わらない。
// いまこのグラフを開けるか（右パネルのボタン・表示メニュー・右クリックで同じ判定を使う）
//   ★tempGraphReady と同じ作り。入口ごとに条件を書くと「押せるのに何も起きない」項目が出る。
//   ★静的物体・等速の物体だけを選んでも系は空になる（energyDriven）ので押せない
function eneGraphReady() {
  if (eneGraphOfSelection()) return true;
  return objects.some(o => selectedIds.has(o.id) && !energyDriven(o)) && eneGraphs.length < EG_MAX_WINDOWS;
}
function toggleEnergyGraph() {
  const ids = objects.filter(o => selectedIds.has(o.id) && !energyDriven(o)).map(o => o.id).sort((a,b) => a-b);
  if (!ids.length) return;
  const same = eneGraphOfSelection();
  if (same) { eneGraphClose(same); return; }
  if (eneGraphs.length >= EG_MAX_WINDOWS) return;
  eneGraphNew(ids);
  refreshEneGraphButton();
}
function refreshEneGraphButton() {
  const b = document.getElementById('p-enegraph-btn');
  if (!b) return;
  const movable = objects.filter(o => selectedIds.has(o.id) && !energyDriven(o));
  const open = !!eneGraphOfSelection();
  b.classList.toggle('active', open);      // 表記は固定。開いているかは枠の色で示す
  const full = !open && eneGraphs.length >= EG_MAX_WINDOWS;
  b.disabled = !eneGraphReady();
  b.title = open    ? 'もう一度押すと閉じます（選択した物体の系のエネルギー）'
          : full    ? ('エネルギーのグラフは同時に' + EG_MAX_WINDOWS + '個までです。どれかを閉じてください')
          : !movable.length ? '動かせる物体を選んでください（静的物体は系に入りません）'
          : '選択した物体をひとまとめの「系」として、運動エネルギー・位置エネルギー・'
          + 'それらの和の時間変化を表示します。複数選ぶと1つの系として合計されます'
          + '（ばねや万有引力でつながった相手も一緒に選ぶと、その項が計上できるようになります）';
}
function toggleEnergyGraphRecording(g) {
  if (g.frozen) {
    if (g.samples.length >= EG_MAX_SAMPLES) return;   // 上限到達時はリセットしないと再開できない
    if (g.stopReason === 'lost') return;              // 系が変わったので、続きは記録できない
    g.frozen = false; g.stopReason = null;
  } else {
    g.frozen = true; g.stopReason = 'user';
  }
  updateEnergyGraphStatus(g);
}
// 基準面の表示スイッチの見た目を、いまの world.showGravityLine に合わせる
function eneGraphSyncRefNote(g) {
  const el = g.panel && g.panel.querySelector('.eg-ref-show');
  if (!el) return;
  el.textContent = world.showGravityLine ? 'この面を隠す' : 'この面を表示';
  el.title = '原点を通り重力に垂直な線（見かけの水平）を画面に描きます。'
           + 'その線の上にある物体の位置エネルギーが 0 です';
}
function resetEnergyGraphOne(g) {
  const stay = resetKeepsStopped(g);          // ★「停止」中のリセットで勝手に再開しない（velgraph.js）
  g.t = 0; g.samples = []; g.frozen = stay; g.stopReason = stay ? 'user' : null;
  eneGraphSampleNow(g);     // いまの状態を新しい E(0) にする
  updateEnergyGraphStatus(g);
}
function resetEnergyGraph() {
  for (const g of eneGraphs) resetEnergyGraphOne(g);
}
function updateEnergyGraphStatus(g) {
  if (g.recBtn) {
    const stuck = g.samples.length >= EG_MAX_SAMPLES || g.stopReason === 'lost';
    g.recBtn.textContent = g.frozen ? '再開' : '停止';
    g.recBtn.disabled = g.frozen && stuck;
    g.recBtn.title = g.stopReason === 'lost' ? '系の物体が消えたので、この記録の続きは取れません'
                   : g.recBtn.disabled       ? '記録が上限に達しました。「リセット」で最初から記録し直せます'
                   : g.frozen                ? '記録を再開します'
                   :                           '記録を一時停止します（グラフは残ります）';
  }
  eneGraphSyncRefNote(g);      // 表示メニュー側から切り替えられても追従させる
  // その場面に存在しない項のチェックボックスは隠す（ばねが無いのに「弾性」は出さない）
  if (g.rowEls) {
    const bodies = eneGraphBodies(g), ids = eneGraphIds(g);
    for (const b of EG_BANDS) {
      const row = g.rowEls[b.key];
      if (row) row.style.display = b.applies(bodies, ids) ? '' : 'none';
    }
  }
  // 内訳は系列が多すぎる場面では記録していない（eneGraphSampleNow）。押せなくして理由を出す
  if (g.bdBox) {
    const last = g.samples[g.samples.length - 1];
    const ok = !last || !!last.p;
    g.bdBox.disabled = !ok;
    if (!ok && g.breakdown) { g.breakdown = false; g.bdBox.checked = false; }
    if (!ok) g.bdBox.title = '系列が' + EG_MAX_SERIES + '本を超えるので内訳は出せません'
                           + '（万有引力・静電気力のペアは物体数の2乗で増えます）';
  }
  const name = eneGraphName(g);
  if (g.titleEl && g.titleEl.textContent !== name) {
    g.titleEl.textContent = name;
    g.titleEl.title = 'このウィンドウは ' + name + ' を1つの系として記録しています（選択を変えても切り替わりません）';
  }
  if (g.noteEl) {
    const note = eneGraphMissingNote(g);
    g.noteEl.textContent = note;
    g.noteEl.style.display = note ? '' : 'none';
  }
  const el = g.statusEl;
  if (!el) return;
  if (g.stopReason === 'lost')  { el.textContent = '記録停止（系の物体が消えました）'; el.style.color = 'var(--accent3)'; }
  else if (g.stopReason === 'limit') { el.textContent = '記録停止（上限）'; el.style.color = 'var(--accent3)'; }
  else if (g.frozen)            { el.textContent = '記録停止'; el.style.color = 'var(--accent3)'; }
  else if (running)             { el.textContent = '記録中'; el.style.color = '#66bb6a'; }
  else                          { el.textContent = '待機中（実行すると記録します）'; el.style.color = 'var(--text2)'; }
}
// ★この系で計上できていない項を名指しする。
//   黙っていると、ばねに蓄えられたエネルギーや系の外との引力が力学的エネルギーの
//   目減りに見えて、エネルギー保存を教えるつもりが逆のことを教える絵になる。
function eneGraphMissingNote(g) {
  const bodies = eneGraphBodies(g);
  if (!bodies.length) return '';
  const ids = eneGraphIds(g);
  const miss = [];
  const outside = b => b && !energyDriven(b) && !ids.has(b.id);      // 系の外の“動ける”相手
  if (joints.some(j => j.type === 'spring' && !springCounts(j, ids)
                    && (outside(j.bodyA) || outside(j.bodyB))
                    && ((j.bodyA && ids.has(j.bodyA.id)) || (j.bodyB && ids.has(j.bodyB.id)))))
    miss.push('系の外の物体とつないだばね');
  const pairOutside = pick =>
    bodies.some(a => pick(a) && objects.some(b => b !== a && pick(b) && outside(b)));
  if (world.gravitation && pairOutside(b => b.hasGravity)) miss.push('系の外の物体との万有引力');
  if (world.coulombOn   && pairOutside(b => !!b.charge))   miss.push('系の外の物体との静電気力');
  // 矩形の電場は保存力ではない：場のある箱を出入りする経路で一周の仕事が 0 にならないので、
  // 位置エネルギーそのものが定義できない（近似で描くと嘘になるので描かない）
  if (emFields.length && bodies.some(b => b.charge))
    miss.push('矩形の電場（保存力ではないので位置エネルギーを定義できません）');
  if (!miss.length) return '';
  return '計上できない項：' + miss.join('・') + '。その分は力学的エネルギーの増減として現れます';
}

// ── 記録 ──────────────────────────────────────────────
function sampleEnergyGraph(dt) {
  eneGraphPrune();
  for (const g of eneGraphs) {
    if (g.frozen || dt <= 0) continue;
    g.t += dt;
    eneGraphSampleNow(g);
    if (g.samples.length >= EG_MAX_SAMPLES) { g.frozen = true; g.stopReason = 'limit'; updateEnergyGraphStatus(g); }
  }
}
// いまの状態を1点として積む（時間は進めない）。生成・リセット時の t=0 の点にも使う
function eneGraphSampleNow(g) {
  const bodies = eneGraphBodies(g);
  if (!bodies.length) return;
  const p = {};
  const e = systemEnergy(bodies, eneGraphIds(g), p);
  const rec = { t: g.t, kt: e.kt, kr: e.kr, ug: e.ug, us: e.us, ugg: e.ugg, ue: e.ue };
  // ★内訳は系列が多くなりすぎると読めないうえ記録も重い。上限を超える場面では持たない
  //   （ペアは物体数の2乗で増える。10物体＋万有引力で45ペア）
  if (Object.keys(p).length <= EG_MAX_SERIES) rec.p = p;
  g.samples.push(rec);
}

// ── 描画 ──────────────────────────────────────────────
function drawEnergyGraph() {
  eneGraphPrune();
  for (const g of eneGraphs) drawEnergyGraphOne(g);
}
// 力学的エネルギー＝運動＋位置のぜんぶ
function egMech(s) { return s.kt + s.kr + s.ug + s.us + s.ugg + s.ue; }
// 描く成分（チェックが入っていて、かつその場面に存在するもの）
function egBands(g, bodies, ids) {
  return EG_BANDS.filter(b => g[b.flag] && b.applies(bodies, ids));
}
// ── 内訳の系列 ────────────────────────────────────────
function egBodyName(id) {
  const b = objects.find(o => o.id === id);
  return b ? (b.label || ('物体' + id)) : ('物体' + id);
}
function egJointName(j) {
  const nm = b => b ? (b.label || ('物体' + b.id)) : '固定点';
  return nm(j.bodyA) + '–' + nm(j.bodyB);
}
// 系列ID（'kt#3' / 'us#12' / 'ugg#3-7'）を人が読む名前にする
function egPartLabel(key) {
  const at = key.indexOf('#'), kind = key.slice(0, at), arg = key.slice(at + 1);
  // ★'s' 始まりはスリンキー（ばね）。ジョイントの id と番号がぶつかるので前置きで分ける
  if (arg[0] === 's') {
    const S = slinkies.find(x => x.id === +arg.slice(1));
    if (!S) return 'ばね' + arg.slice(1);
    const nm = w => { const b = slinkyEndBody(S, w); return b ? (b.label || ('物体' + b.id)) : '固定点'; };
    return nm('A') + '–' + nm('B');
  }
  if (kind === 'us') {
    const j = joints.find(x => x.id === +arg);
    return j ? egJointName(j) : ('ばね' + arg);
  }
  const dash = arg.indexOf('-');
  if (dash >= 0) return egBodyName(+arg.slice(0, dash)) + '–' + egBodyName(+arg.slice(dash + 1));
  return egBodyName(+arg);
}
// 内訳の系列色：もとの項の色から明度を段階的にずらす（同じ項の仲間だと分かるように）
function egShade(hex, i, n) {
  if (n <= 1) return hex;
  const t = (i / (n - 1)) * 2 - 1;                  // −1（暗い側）… +1（明るい側）
  const to = t < 0 ? 0 : 255, a = Math.abs(t) * 0.45;
  const q = v => Math.round(v + (to - v) * a).toString(16).padStart(2, '0');
  return '#' + q(parseInt(hex.slice(1,3),16)) + q(parseInt(hex.slice(3,5),16)) + q(parseInt(hex.slice(5,7),16));
}
function egClip(txt, n) { return txt.length <= n ? txt : (txt.slice(0, n - 1) + '…'); }
// 描く系列を組み立てる。内訳OFFなら項そのもの、ONなら“自然な単位”へ分解したもの。
//   ★分解の単位は項ごとに違う（energy.js の systemEnergy を参照）。万有引力と静電気力を
//     物体ごとに割るとエネルギーが二重に数えられるので、ここでもペアのまま扱う。
function egSeriesList(g, bands) {
  const last = g.samples[g.samples.length - 1];
  if (!g.breakdown || !last || !last.p)
    return bands.map(b => ({ label: b.label, col: b.col, get: s => s[b.key] }));
  const out = [];
  for (const b of bands) {
    const keys = Object.keys(last.p).filter(k => k.slice(0, b.key.length + 1) === b.key + '#');
    keys.sort();
    if (!keys.length) { out.push({ label: b.label, col: b.col, get: s => s[b.key] }); continue; }
    keys.forEach((k, i) => out.push({
      label: egClip(b.label + ' ' + egPartLabel(k), 24),
      col: egShade(b.col, i, keys.length),
      get: s => (s.p && s.p[k]) || 0,
    }));
  }
  // 名前が同じになる系列に通し番号を付ける（固定点につないだばねが2本ある場合など）
  const n = {}, seen = {};
  for (const s of out) n[s.label] = (n[s.label] || 0) + 1;
  for (const s of out) if (n[s.label] > 1) s.label += ' (' + (seen[s.label] = (seen[s.label] || 0) + 1) + ')';
  return out;
}
// 面を塗るための作業配列。毎フレーム確保すると点数ぶんのゴミが出るので使い回す
function egBuf(g, n) {
  if (!g._buf || g._buf.n < n) {
    const cap = Math.max(n, 1024);
    g._buf = { n: cap, pos: new Float64Array(cap), neg: new Float64Array(cap),
               lo: new Float64Array(cap), hi: new Float64Array(cap) };
  }
  return g._buf;
}
// 指定時刻にいちばん近いサンプルを二分探索で取り出す
function eneGraphSampleAt(g, t) {
  const a = g.samples;
  if (!a.length) return null;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].t < t) lo = mid + 1; else hi = mid; }
  const prev = a[lo - 1];
  if (prev && Math.abs(prev.t - t) < Math.abs(a[lo].t - t)) return prev;
  return a[lo];
}
function drawEnergyGraphOne(g) {
  const cv = g.canvas, c = g.ctx;
  if (!cv || !c) return;
  const cssW = cv.clientWidth  || 380;
  const cssH = cv.clientHeight || 150;
  if (cv.width  !== cssW) cv.width  = cssW;
  if (cv.height !== cssH) cv.height = cssH;
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  updateEnergyGraphStatus(g);
  const S = g.samples;
  if (!S.length) {
    c.fillStyle = 'rgba(224,230,240,0.5)'; c.font = '10px sans-serif'; c.textAlign = 'center';
    c.fillText('記録がありません', W/2, H/2);
    c.textAlign = 'left';
    return;
  }
  const bands  = egBands(g, eneGraphBodies(g), eneGraphIds(g));
  const series = egSeriesList(g, bands);   // ★内訳ONなら物体ごと・ばねごと・ペアごとに分かれる
  const stacked = (g.mode === 'stack');
  const E0 = egMech(S[0]);                  // 記録を始めた瞬間の力学的エネルギー（目安線）
  const padL = 48, padR = 10, padT = 8, padB = 16;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  if (plotW < 20 || plotH < 20) return;
  const tMax = Math.max(g.t, 1);
  const X = t => padL + (t / tMax) * plotW;
  // 点数が横幅より多いときは間引く（1列あたり2点あれば見た目は変わらない）
  const N = S.length;
  const stride = Math.max(1, Math.floor(N / (plotW * 2)));
  const idx = [];
  for (let i = 0; i < N; i += stride) idx.push(i);
  if (idx[idx.length-1] !== N-1) idx.push(N-1);
  const M = idx.length;
  // ── 縦の範囲 ──────────────────────────────────────────
  let vMin = 0, vMax = 0;
  const take = v => { if (v > vMax) vMax = v; if (v < vMin) vMin = v; };
  for (const i of idx) {
    const s = S[i];
    if (stacked) {
      let p = 0, n = 0;
      for (const b of series) { const v = b.get(s); if (v >= 0) p += v; else n += v; }
      take(p); take(n);
    } else {
      for (const b of series) take(b.get(s));
    }
    if (g.showMech) take(egMech(s));
  }
  if (g.showMech) take(E0);
  if (vMax - vMin < 1e-12) { vMin -= 1; vMax += 1; }
  const pad = (vMax - vMin) * 0.08; vMin -= pad; vMax += pad;
  const Y = v => padT + (1 - (v - vMin)/(vMax - vMin)) * plotH;
  const poly = (pick, close) => {           // 時系列を1本の折れ線にする
    c.beginPath();
    for (let k = 0; k < M; k++) {
      const x = X(S[idx[k]].t), y = Y(pick(S[idx[k]], k));
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    if (close) for (let k = M - 1; k >= 0; k--) c.lineTo(X(S[idx[k]].t), Y(close(S[idx[k]], k)));
  };
  c.save();
  c.beginPath(); c.rect(padL, padT, plotW, plotH); c.clip();
  if (stacked) {
    // ── 成分の積み上げ（正は0から上へ、負は0から下へ）──
    if (M >= 2 && series.length) {
      const buf = egBuf(g, M);
      buf.pos.fill(0, 0, M); buf.neg.fill(0, 0, M);
      for (const b of series) {
        for (let k = 0; k < M; k++) {
          const v = b.get(S[idx[k]]);
          if (v >= 0) { buf.lo[k] = buf.pos[k]; buf.pos[k] += v; buf.hi[k] = buf.pos[k]; }
          else        { buf.hi[k] = buf.neg[k]; buf.neg[k] += v; buf.lo[k] = buf.neg[k]; }
        }
        c.fillStyle = b.col + '66';                    // 面は半透明（重なりが見えるように）
        poly((s, k) => buf.hi[k], (s, k) => buf.lo[k]); c.closePath(); c.fill();
        c.strokeStyle = b.col; c.lineWidth = 1;
        poly((s, k) => buf.hi[k]); c.stroke();         // 上端をなぞって境目を出す
      }
    }
  } else {
    // ── 重ね：どの量も 0 から立ち上がる自分自身の曲線 ──
    //   ★他の量を出しても形が変わらないのがこのモードの取り柄
    for (const b of series) {
      c.strokeStyle = b.col; c.lineWidth = 1.5;
      poly(s => b.get(s)); c.stroke();
    }
  }
  // ── 基準線：0 と E(0) ────────────────────────────────
  if (vMin < 0 && vMax > 0) {
    c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(padL, Y(0)); c.lineTo(padL+plotW, Y(0)); c.stroke();
  }
  if (g.showMech) {
    c.strokeStyle = EG_COL_E0; c.lineWidth = 1; c.setLineDash([4,3]);
    c.beginPath(); c.moveTo(padL, Y(E0)); c.lineTo(padL+plotW, Y(E0)); c.stroke();
    c.setLineDash([]);
  }
  // ── 力学的エネルギー ──────────────────────────────────
  if (g.showMech && M >= 2) {
    c.strokeStyle = EG_COL_MECH; c.lineWidth = 2;
    poly(s => egMech(s)); c.stroke();
  }
  c.restore();
  // ── 目盛りと見出し ────────────────────────────────────
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
  c.strokeRect(padL, padT, plotW, plotH);
  c.font = '9px sans-serif'; c.textAlign = 'right';
  c.fillStyle = 'rgba(224,230,240,0.7)';
  c.fillText(cgSI(vMax, 'J', 3), padL-3, padT+8);
  c.fillText(cgSI(vMin, 'J', 3), padL-3, padT+plotH);
  if (vMin < 0 && vMax > 0) { c.fillStyle = 'rgba(224,230,240,0.45)'; c.fillText('0', padL-3, Y(0)+3); }
  if (g.showMech) {
    c.fillStyle = 'rgba(224,230,240,0.55)'; c.textAlign = 'left';
    c.fillText('E(0) = ' + cgSI(E0, 'J', 3), padL+4, Y(E0)-3);
  }
  c.textAlign = 'left';  c.fillStyle = 'rgba(224,230,240,0.7)';
  c.fillText('0', padL+1, padT+plotH+13);
  c.textAlign = 'right'; c.fillText(tMax.toFixed(1)+'s', padL+plotW, padT+plotH+13);
  c.textAlign = 'left';
  // ── カーソル読み取り ──────────────────────────────────
  const hv = g.hover;
  if (hv && hv.x >= padL && hv.x <= padL+plotW && hv.y >= padT && hv.y <= padT+plotH) {
    const s = eneGraphSampleAt(g, (hv.x - padL) / plotW * tMax);
    const sx = X(s.t);
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1; c.setLineDash([3,3]);
    c.beginPath(); c.moveTo(sx, padT); c.lineTo(sx, padT+plotH); c.stroke();
    c.setLineDash([]);
    const rows = [];
    // 系列が多いときは箱が画面を埋めるので、上限まで並べて残りは件数だけ知らせる
    for (const b of series.slice(0, EG_READOUT_ROWS)) rows.push([b.label, b.get(s), b.col]);
    if (series.length > EG_READOUT_ROWS)
      rows.push(["…他" + (series.length - EG_READOUT_ROWS) + "件", null, "rgba(224,230,240,0.45)"]);
    if (g.showMech) {
      rows.push(['力学的E', egMech(s), EG_COL_MECH]);
      rows.push(['E(0)',    E0,        'rgba(224,230,240,0.75)']);
    }
    c.font = '10px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
    // ★ラベル列の幅はいちばん長いラベルに合わせる。固定幅にすると「位置(万有引力)」の
    //   ような長いラベルの行だけ値が右へずれて、縦に並んだ数値がそろわない
    let labW = 0;
    for (const r of rows) labW = Math.max(labW, c.measureText(r[0]).width);
    const lines = [[{ txt:'t = ' + s.t.toFixed(3) + ' s', col:'rgba(224,230,240,0.95)' }]];
    for (const r of rows) lines.push([{ txt:r[0], col:r[1] === null ? r[2] : 'rgba(224,230,240,0.55)', w:labW },
                                      { txt:r[1] === null ? '' : cgSI(r[1], 'J', 3), col:r[2] }]);
    const GAP = 6;
    let bw = 0;
    for (const segs of lines) {
      let w = 0;
      for (const sg of segs) w += Math.max(sg.w || 0, c.measureText(sg.txt).width) + GAP;
      bw = Math.max(bw, w - GAP);
    }
    bw += 12;
    const bh = lines.length * 13 + 7;
    // 読み取り箱はカーソルから遠い隅に固定する（追従させると見たい波形を隠すため）
    let bx = (hv.x < W/2) ? (W - padR - bw) : (padL + 4);
    let by = (hv.y < H/2) ? (padT + plotH - bh - 2) : (padT + 4);
    bx = Math.max(2, Math.min(bx, W - 2 - bw));
    by = Math.max(2, Math.min(by, H - 2 - bh));
    c.fillStyle = 'rgba(18,20,26,0.92)';
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1;
    c.beginPath(); c.rect(bx, by, bw, bh); c.fill(); c.stroke();
    lines.forEach((segs, i) => {
      let tx = bx + 6;
      for (const sg of segs) {
        c.fillStyle = sg.col;
        c.fillText(sg.txt, tx, by + 4 + i*13);
        tx += Math.max(sg.w || 0, c.measureText(sg.txt).width) + GAP;
      }
    });
    c.restore();
  }
}
