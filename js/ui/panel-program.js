// ════════════════════════════════════════
//  プログラムの窓（画面に貼り付く）
// ════════════════════════════════════════
//  枠・つまみ・ドラッグはグラフの窓（.velgraph-panel / .vg-*）の CSS をそのまま借りる。
//  ★並びは「きっかけ → 相手 → すること」。日本語の文として上から読めるようにしてある。
//  ★出すのはその動作に要る欄だけ（右パネルと同じ流儀）。「複製して放つ」を選んだときだけ
//    速さと向きが出る。関係ない欄を並べると、どれが効いているのか分からなくなる。
//  ★畳める（⌄）。窓はシーンの一部で閉じられないので、畳めないと下の物体が永久に
//    クリックできなくなる（グラフの窓と違って「用が済んだら閉じる」ができない）。

let selectedProgram = null;

function buildProgramPanel(p) {
  const host = document.getElementById('canvas-wrap') || document.body;
  const panel = document.createElement('div');
  panel.className = 'velgraph-panel program-panel';
  panel.style.width = '212px';
  panel.innerHTML =
    '<div class="vg-header">' +
      '<span class="vg-title" style="flex:0 0 auto;white-space:nowrap">プログラム ' + p.id + '</span>' +
      '<span class="vg-status pg-sum" style="flex:1 1 auto;min-width:0;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis"></span>' +
      // ★「キーを押した瞬間」のときだけ出す実行ボタン。見出しに置くので畳んでも押せる
      //   （下の pg-fire の★）
      '<button class="pg-fire" style="flex:0 0 auto;padding:1px 7px;border-radius:5px;' +
        'border:1px solid var(--border);background:var(--panel2);color:var(--text);' +
        'font-size:11px;cursor:pointer;user-select:none">▶ 実行</button>' +
      '<span class="vg-close pg-fold" title="畳む／開く">⌄</span>' +
      '<span class="vg-close">×</span>' +
    '</div>' +
    '<div class="pg-body" style="padding:6px 8px 8px">' +
      '<div class="pg-sec">トリガー</div>' +
      '<select class="prop-input pg-trigger" style="width:100%"></select>' +
      '<div class="prop-row pg-row-step"><span class="prop-label">周期 [ステップ]</span>' +
        '<input class="prop-input pg-step-v" type="number" step="1" min="1"></div>' +
      '<div class="prop-row pg-row-dist"><span class="prop-label">間隔 [m]</span>' +
        '<input class="prop-input pg-dist-v" type="number" step="0.1" min="0.02"></div>' +
      '<div class="prop-row pg-row-spdmin"><span class="prop-label">○m/s以上</span>' +
        '<input class="prop-input pg-spdmin" type="number" step="0.1" min="0"></div>' +
      '<div class="prop-row pg-row-spdmax"><span class="prop-label">○m/s以下</span>' +
        '<input class="prop-input pg-spdmax" type="number" step="0.1" min="0" ' +
        'title="速さがこの範囲へ入った瞬間に1回だけ発火します（範囲に居る間ずっとではありません）。&#10;既定の 0〜0.1 は「ほぼ止まった」。&#10;向きは見ないので、転がる球の角速度は数えません"></div>' +
      '<div class="prop-row pg-row-tempmin"><span class="prop-label">○℃以上</span>' +
        '<input class="prop-input pg-tempmin" type="number" step="1" min="-273.15"></div>' +
      '<div class="prop-row pg-row-tempmax"><span class="prop-label">○℃以下</span>' +
        '<input class="prop-input pg-tempmax" type="number" step="1" min="-273.15" ' +
        'title="つないだ物体の温度がこの範囲へ入った瞬間に1回だけ発火します（範囲に居る間ずっとではありません）。&#10;既定の 50〜1000℃ は「熱くなったら」。「冷えたら」は下限を −273 にします。&#10;熱の来かた（伝導・放射・加熱・摩擦）は問いません。&#10;行ったり来たりさせたいときは、上の範囲と下の範囲の2枚に分けます"></div>' +
      '<div class="prop-row pg-row-curmin"><span class="prop-label">○A以上</span>' +
        '<input class="prop-input pg-curmin" type="number" step="0.01" min="0"></div>' +
      '<div class="prop-row pg-row-curmax"><span class="prop-label">○A以下</span>' +
        '<input class="prop-input pg-curmax" type="number" step="0.01" min="0" ' +
        'title="つないだ回路素子を流れる電流の大きさがこの範囲へ入った瞬間に1回だけ発火します。&#10;' +
        '向きは見ません。&#10;既定の 0.02A〜 は「リレーが動くほど流れたら」。&#10;' +
        '「止まったら」は 0〜0.02 にしてください"></div>' +
      '<div class="prop-row pg-row-times"><span class="prop-label">回数（0＝無制限）</span>' +
        '<input class="prop-input pg-times" type="number" step="1" min="0" ' +
        'title="1つの物体につき何回まで「すること」をするかです。&#10;複製したものにも適用しているときは、出てきた物体それぞれが自分の分を数えます。&#10;「○ステップごと・1回・削除」で寿命になります。&#10;「○回に1回」と組むと「3回目で1回だけ」になります"></div>' +
      '<div class="prop-row pg-row-every"><span class="prop-label">○回に1回</span>' +
        '<input class="prop-input pg-every" type="number" step="1" min="1" ' +
        'title="きっかけを数えて、この回数ごとに1回だけ「すること」をします（1＝毎回）。&#10;数えるのは物体ごとです。&#10;「半径○m以内」は満たしている間ずっと＝1ステップが1回です"></div>' +
      '<div class="prop-row pg-row-nearr"><span class="prop-label">半径 [m]</span>' +
        '<input class="prop-input pg-nearr" type="number" step="0.1" min="0.01"></div>' +
      '<div class="prop-row pg-row-nearmin"><span class="prop-label">○個以上</span>' +
        '<input class="prop-input pg-nearmin" type="number" step="1" min="0"></div>' +
      '<div class="prop-row pg-row-nearmax"><span class="prop-label">○個以下</span>' +
        '<input class="prop-input pg-nearmax" type="number" step="1" min="0" ' +
        'title="半径の中にある物体の数がこの範囲にあるあいだ発火します。&#10;自分自身と生成口は数えません"></div>' +
      '<div class="prop-row pg-row-nearwhat"><span class="prop-label">数えるもの</span>' +
        '<select class="prop-input pg-nearwhat" ' +
        'title="「すべて」だと、通りすがりの無関係な物体まで数えます。&#10;等間隔に並べて流すような使い方では「自分の複製」にしてください">' +
          '<option value="all">すべて</option>' +
          '<option value="layer">同じ衝突レイヤー</option>' +
          '<option value="kin">自分の複製</option></select></div>' +
      '<div class="prop-row pg-row-zx"><span class="prop-label">場所X [m]</span>' +
        '<input class="prop-input pg-zx" type="number" step="0.1"></div>' +
      '<div class="prop-row pg-row-zy"><span class="prop-label">場所Y [m]</span>' +
        '<input class="prop-input pg-zy" type="number" step="0.1"></div>' +
      '<div class="prop-row pg-row-zw"><span class="prop-label">幅 [m]</span>' +
        '<input class="prop-input pg-zw" type="number" step="0.1" min="0.04"></div>' +
      '<div class="prop-row pg-row-zh"><span class="prop-label">高さ [m]</span>' +
        '<input class="prop-input pg-zh" type="number" step="0.1" min="0.04"></div>' +
      '<div class="prop-row pg-row-zhere"><button class="btn-small pg-zhere" style="width:100%" ' +
        'title="四角の中心を、いまつないでいる物体の位置へ動かします">つないだ物体の位置へ</button></div>' +
      '<div class="prop-row pg-row-lightedge"><span class="prop-label">光が</span>' +
        '<select class="prop-input pg-lightedge" ' +
        'title="レーザーの光がこの物体に届いたか・届かなくなったかを見ます。&#10;鏡で曲げた光・レンズを通った光も数えます。回折で広がった光は数えません">' +
          '<option value="on">当たり始めたら</option>' +
          '<option value="off">届かなくなったら（遮られたら）</option></select></div>' +
      '<div class="prop-row pg-row-hitwhat"><span class="prop-label">当たる相手</span>' +
        '<select class="prop-input pg-hitwhat" ' +
        'title="床の上に置いた物体は、はじめから「地面に当たっている」ので、&#10;地面を入れると▶を押した瞬間に発火します。&#10;物体どうしの衝突を見たいときは「物体だけ」にしてください">' +
          '<option value="body">物体だけ</option>' +
          '<option value="same" title="衝突レイヤーのチェックが自分とまったく同じ物体だけです。&#10;1つ共有しているだけでは数えません（当たった相手とは必ず1つ共有しているため）">同じレイヤー設定の物体だけ</option>' +
          '<option value="env">地面・壁だけ</option>' +
          '<option value="all">どちらでも</option></select></div>' +
      '<div class="prop-row pg-row-sigin"><span class="prop-label">合図の番号</span>' +
        '<input class="prop-input pg-sigin" type="number" step="1" min="1" ' +
        'title="同じ番号の〈合図を出す〉プログラムが発火した、次のステップで発火します。&#10;出す側・受ける側とも何個あってもかまいません"></div>' +
      '<div class="prop-row pg-row-key"><span class="prop-label">キー</span>' +
        '<input class="prop-input pg-key" type="text" readonly ' +
        'title="ここを押してから、割り当てたいキーを打ってください"></div>' +
      '<div class="checkbox-row pg-row-scope" style="margin:4px 0">' +
        '<input type="checkbox" class="pg-scope" id="pg-scope-' + p.id + '">' +
        '<label for="pg-scope-' + p.id + '" ' +
        'title="ONにすると、この物体につないでいる&#10;すべてのプログラムが、出てきた物体にも効きます。&#10;&#10;「○ステップごと・1回・削除」をもう1枚貼れば寿命になります">' +
        '複製・生成した物体にもプログラムを適用</label></div>' +
      '<div class="checkbox-row pg-row-sync" style="margin:4px 0">' +
        '<input type="checkbox" class="pg-sync" id="pg-sync-' + p.id + '">' +
        '<label for="pg-sync-' + p.id + '" ' +
        'title="ONにすると、生成口を触った瞬間、すでに出ている物体が&#10;生成口の値（速度・質量・色・レイヤーなど）に揃います。&#10;速度を0にすれば一斉に止まり、戻せば一斉に進みます。&#10;&#10;揃わないもの：位置・向き・形（各自のものなので）と温度&#10;（放射や加熱冷却で生成口自身の温度が動くため）">' +
        '生成口の設定変更を、出ている物体にも反映</label></div>' +
      '<div class="pg-sec pg-sec-target">相手</div>' +
      '<select class="prop-input pg-target" style="width:100%">' +
        '<option value="self">つないだ物体</option>' +
        '<option value="other">当たってきた相手</option></select>' +
      '<div class="pg-sec">すること</div>' +
      '<select class="prop-input pg-action" style="width:100%"></select>' +
      '<div class="prop-row pg-row-limit"><span class="prop-label">同時に出せる数</span>' +
        '<input class="prop-input pg-limit" type="number" step="1" min="1" max="' + PROG_SPAWN_MAX + '" ' +
        'title="いま出ているものの数の上限です。消えたぶんはまた出せます。&#10;速度・質量・色・動力・軌跡など、出てくる物体の中身は&#10;すべて右パネル（つないだ物体のプロパティ）の値がそのまま入ります"></div>' +
      '<div class="prop-row pg-row-sigout"><span class="prop-label">合図の番号</span>' +
        '<input class="prop-input pg-sigout" type="number" step="1" min="1" ' +
        'title="〈合図を受けたら〉で同じ番号を待っているプログラムが、次のステップで発火します。&#10;物体には何もしません"></div>' +
      '<div class="prop-row pg-row-color"><span class="prop-label">色</span>' +
        '<input class="prop-input pg-color" type="color" style="padding:0;height:22px"></div>' +
      '<div class="prop-row pg-row-layers"><span class="prop-label">レイヤー</span>' +
        '<span class="pg-layers"></span></div>' +
      '<div class="prop-row pg-row-delay"><span class="prop-label">○秒後に</span>' +
        '<input class="prop-input pg-delay" type="number" step="0.1" min="0" ' +
        'title="きっかけから、この時間がたってから「すること」をします（0＝すぐ）。&#10;時間はシミュレーションの時間で、止めている間は進みません。&#10;待っている間に相手が消えたら何もしません"></div>' +
      '<div class="vg-hint pg-note" style="margin-top:4px"></div>' +
    '</div>';
  host.appendChild(panel);
  p.panel = panel;

  const sel = (c) => panel.querySelector(c);
  const trg = sel('.pg-trigger'), act = sel('.pg-action');
  // ★回路素子につないだ窓には、素子で意味のあるものだけを出す（program.js の PROG_ELEM_*）。
  //   物体の窓には電流のきっかけを出さない（物体は電流を持たない）
  const elem = p.onElem();
  for (const [v, label] of PROG_TRIGGERS)
    if (elem === PROG_ELEM_TRIGGERS.includes(v)) trg.add(new Option(label, v));
  for (const [v, label] of PROG_ACTIONS)
    if (!elem || PROG_ELEM_ACTIONS.includes(v)) act.add(new Option(label, v));
  // レイヤーのチップ（右パネルの衝突レイヤーと同じ色・同じ番号）
  let lh = '';
  for (let i = 0; i < LAYER_COUNT; i++)
    lh += '<span class="pg-lay" data-bit="' + i + '" style="display:inline-block;width:16px;height:16px;' +
          'margin-right:3px;border-radius:3px;cursor:pointer;border:1px solid var(--border);' +
          'background:' + LAYER_COLORS[i] + '"></span>';
  sel('.pg-layers').innerHTML = lh;

  const read = () => {
    p.trigger = trg.value;
    p.action  = act.value;
    p.target  = sel('.pg-target').value;
    p.scope   = sel('.pg-scope').checked ? 'copies' : 'one';
    p.sync    = sel('.pg-sync').checked;
    p.step    = Math.max(1, parseInt(sel('.pg-step-v').value) || 1);
    p.dist    = parseFloat(sel('.pg-dist-v').value) || 1;
    p.spdMin  = Math.max(0, parseFloat(sel('.pg-spdmin').value) || 0);
    p.spdMax  = Math.max(p.spdMin, parseFloat(sel('.pg-spdmax').value) || 0);
    // ★UI は ℃、内部は K（thermal.js の約束）。絶対零度より下は取らない
    const tlo = parseFloat(sel('.pg-tempmin').value), thi = parseFloat(sel('.pg-tempmax').value);
    p.tempMin = Math.max(0, C2K(Number.isFinite(tlo) ? tlo : 50));
    p.tempMax = Math.max(p.tempMin, C2K(Number.isFinite(thi) ? thi : 1000));
    p.curMin  = Math.max(0, parseFloat(sel('.pg-curmin').value) || 0);
    p.curMax  = Math.max(p.curMin, parseFloat(sel('.pg-curmax').value) || 0);
    p.times   = Math.max(0, parseInt(sel('.pg-times').value) || 0);
    p.every   = Math.max(1, parseInt(sel('.pg-every').value) || 1);
    p.delay   = Math.max(0, parseFloat(sel('.pg-delay').value) || 0);
    p.sigIn   = Math.max(1, parseInt(sel('.pg-sigin').value)  || 1);
    p.sigOut  = Math.max(1, parseInt(sel('.pg-sigout').value) || 1);
    p.nearR   = Math.max(0.01, parseFloat(sel('.pg-nearr').value) || 0.01);
    p.nearMin = Math.max(0, parseInt(sel('.pg-nearmin').value) || 0);
    p.nearMax = Math.max(p.nearMin, parseInt(sel('.pg-nearmax').value) || 0);
    p.nearWhat = sel('.pg-nearwhat').value;
    p.hitWhat  = sel('.pg-hitwhat').value;
    p.lightEdge = sel('.pg-lightedge').value;
    p.limit   = Math.max(1, Math.min(PROG_SPAWN_MAX, parseInt(sel('.pg-limit').value) || 1));
    p.color   = sel('.pg-color').value;
    // ★UI は m・y は上向きが正。内部は px・y は下向き正（units.js の約束）
    p.zx = (parseFloat(sel('.pg-zx').value) || 0) * M2PX;
    p.zy = yUI((parseFloat(sel('.pg-zy').value) || 0) * M2PX);
    p.zw = Math.max(4, (parseFloat(sel('.pg-zw').value) || 0) * M2PX);
    p.zh = Math.max(4, (parseFloat(sel('.pg-zh').value) || 0) * M2PX);
    // ★「生成」を選んだ瞬間に、つないだ物体を生成口へ切り替える（＝入口になる）。
    //   外したら実体へ戻す。枠線の色が未設定なら白にしておく（既定の見た目）。
    const bb = p.body();
    if (bb) {
      const want = (p.action === 'create');
      if (bb.isSpawner !== want) {
        bb.isSpawner = want;
        if (want && !bb.strokeColor) bb.strokeColor = '#ffffff';
        bb.sleeping = false; bb.sleepTimer = 0;
      }
    }
    p.reset();                     // 設定を変えたら数えごとも初めから
    syncProgramState(p);           // ★触った直後の暴発を防ぐ（program.js の★）
    syncProgramPanel(p);
  };
  for (const c of ['.pg-trigger', '.pg-action', '.pg-target', '.pg-scope', '.pg-sync',
                   '.pg-nearwhat', '.pg-hitwhat', '.pg-lightedge'])
    sel(c).addEventListener('change', read);
  for (const c of ['.pg-step-v', '.pg-dist-v', '.pg-spdmin', '.pg-spdmax', '.pg-tempmin', '.pg-tempmax',
                   '.pg-curmin', '.pg-curmax',
                   '.pg-times', '.pg-nearr', '.pg-nearmin', '.pg-nearmax',
                   '.pg-limit', '.pg-color', '.pg-sigin', '.pg-sigout', '.pg-every', '.pg-delay',
                   '.pg-zx', '.pg-zy', '.pg-zw', '.pg-zh'])
    sel(c).addEventListener('change', read);
  sel('.pg-zhere').addEventListener('click', () => {
    const b = p.body();
    if (!b) return;
    p.zx = b.x; p.zy = b.y;
    p.reset();
    syncProgramState(p);
    syncProgramPanel(p);
  });
  panel.querySelectorAll('.pg-lay').forEach(el => el.addEventListener('click', () => {
    p.layers ^= (1 << +el.dataset.bit);
    syncProgramPanel(p);
  }));
  // キーの割り当て：欄を押してから次に打ったキーを取る
  const keyEl = sel('.pg-key');
  keyEl.addEventListener('focus', () => { keyEl.value = '（キーを押す）'; p._grabKey = true; });
  keyEl.addEventListener('blur',  () => { p._grabKey = false; syncProgramPanel(p); });
  keyEl.addEventListener('keydown', e => {
    e.preventDefault(); e.stopPropagation();
    // ★受け取らないのは予約キーだけ（リモコンの窓と同じ判定を通す。keyboard.js の★）
    const why = keyBindConflict(e.code, p);
    if (why) flashHint(e.code + ' は' + why);
    else {
      p.key = e.code;
      const share = keyBindShared(e.code, p);
      if (share) flashHint(e.code + ' は ' + share + ' と同時に動きます');
    }
    p._grabKey = false; keyEl.blur(); syncProgramPanel(p);
  });
  // ★消す前に確かめる。畳む（⌄）の隣にあるので押し間違えやすい。removeProgram は
  //   pushUndo しているので Ctrl+Z で戻せるが、それを知らない人には設定が一瞬で
  //   消えたようにしか見えない。確認は × の操作にだけ付ける（removeProgram 自体には
  //   付けない＝呼び出し側が消すと決めた場面を止めない）
  panel.querySelector('.vg-close:last-child').addEventListener('click', async () => {
    const ok = await appConfirm('プログラムの削除',
      '<b>プログラム ' + p.id + '</b> を削除します。'
    + '<div class="am-note">Ctrl+Z（元に戻す）で戻せます。</div>',
      '削除する', true);
    if (ok) removeProgram(p);
  });
  // ★実行ボタン＝割り当てたキーを押したのと同じ1回（fireProgramNow）。キーも効いたまま。
  //   キーを覚えていなくても・キーボードが無くても（タブレット・電子黒板）打てるように。
  //   ★mousedown は止める：見出しのドラッグを始めさせないのと、ボタンにフォーカスを
  //     残さないため（残ると次の Enter がこのボタンをもう一度押す。上バーと同じ話）。
  const fire = sel('.pg-fire');
  fire.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  fire.addEventListener('click', () => fireProgramNow(p));
  // ★畳んだら置き直す。placeProgramPanel は「窓の高さ」で画面内に収める計算をするので、
  //   高さが変わったあとにもう一度通さないと、開いていた頃の高さのまま留め置かれる。
  sel('.pg-fold').addEventListener('click', () => {
    p.collapsed = !p.collapsed; syncProgramPanel(p); placeProgramPanel(p);
  });
  panel.addEventListener('mousedown', () => selectProgram(p));
  programPanelDraggable(p);
  // ★中身を先に整えてから置く。置く計算は「窓の高さ」で画面内へ収めるので（上の★と同じ
  //   理由）、畳んだ窓を開いた高さのまま置くと下端の余白ぶん上へ押し戻される。
  //   実測（撃心のデモ・fy=0.17）：戻る／進む で作り直した窓が 125px → 47px へ跳ねていた。
  syncProgramPanel(p);
  placeProgramPanel(p);
}

// 画面の割合 → 実際の位置。窓の大きさが変わっても画面内に留める
function placeProgramPanel(p) {
  const host = p.panel.offsetParent || document.body;
  const hr = host.getBoundingClientRect();
  const w = p.panel.offsetWidth || 212, h = p.panel.offsetHeight || 80;
  p.panel.style.right = 'auto'; p.panel.style.bottom = 'auto';
  p.panel.style.left = Math.max(56, Math.min(hr.width  - w - 4, p.fx * hr.width))  + 'px';
  p.panel.style.top  = Math.max(4,  Math.min(hr.height - h - 4, p.fy * hr.height)) + 'px';
}
function programPanelDraggable(p) {
  const header = p.panel.querySelector('.vg-header');
  let drag = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', e => {
    if (e.target.classList.contains('vg-close')) return;
    const r = p.panel.getBoundingClientRect();
    drag = true; ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const host = p.panel.offsetParent || document.body;
    const hr = host.getBoundingClientRect();
    p.fx = (e.clientX - hr.left - ox) / hr.width;
    p.fy = (e.clientY - hr.top  - oy) / hr.height;
    placeProgramPanel(p);
  });
  window.addEventListener('mouseup', () => drag = false);
}
function selectProgram(p) {
  selectedProgram = p;
  for (const q of programs) if (q.panel) q.panel.classList.toggle('active', q === p);
}

// 値を窓へ書き戻し、その動作に要る欄だけを出す
function syncProgramPanel(p) {
  const panel = p.panel;
  if (!panel) return;
  const sel = c => panel.querySelector(c);
  sel('.pg-trigger').value = p.trigger;
  sel('.pg-action').value  = p.action;
  sel('.pg-target').value  = p.target;
  sel('.pg-scope').checked = (p.scope === 'copies');
  sel('.pg-sync').checked  = p.sync;
  sel('.pg-step-v').value  = p.step;
  sel('.pg-dist-v').value  = p.dist;
  sel('.pg-spdmin').value  = p.spdMin;
  sel('.pg-spdmax').value  = p.spdMax;
  sel('.pg-tempmin').value = +K2C(p.tempMin).toFixed(2);
  sel('.pg-tempmax').value = +K2C(p.tempMax).toFixed(2);
  sel('.pg-curmin').value  = p.curMin;
  sel('.pg-curmax').value  = p.curMax;
  sel('.pg-times').value   = p.times;
  sel('.pg-sigin').value   = p.sigIn;
  sel('.pg-every').value   = p.every;
  sel('.pg-delay').value   = p.delay;
  sel('.pg-sigout').value  = p.sigOut;
  sel('.pg-nearr').value   = p.nearR;
  sel('.pg-nearmin').value = p.nearMin;
  sel('.pg-nearmax').value = p.nearMax;
  sel('.pg-nearwhat').value = p.nearWhat;
  sel('.pg-hitwhat').value  = p.hitWhat;
  sel('.pg-lightedge').value = p.lightEdge;
  sel('.pg-limit').value   = p.limit;
  sel('.pg-color').value   = p.color;
  sel('.pg-zx').value = (p.zx * PX2M).toFixed(2);
  sel('.pg-zy').value = (yUI(p.zy) * PX2M).toFixed(2);
  sel('.pg-zw').value = (p.zw * PX2M).toFixed(2);
  sel('.pg-zh').value = (p.zh * PX2M).toFixed(2);
  if (!p._grabKey) sel('.pg-key').value = p.key;
  const show = (c, on) => { const e = sel(c); if (e) e.style.display = on ? '' : 'none'; };
  const maker = PROG_MAKERS.includes(p.action);
  show('.pg-row-step', p.trigger === 'step');
  show('.pg-row-dist', p.trigger === 'dist');
  show('.pg-row-spdmin', p.trigger === 'speed');
  show('.pg-row-spdmax', p.trigger === 'speed');
  show('.pg-row-tempmin', p.trigger === 'temp');
  show('.pg-row-tempmax', p.trigger === 'temp');
  show('.pg-row-curmin', p.trigger === 'current');
  show('.pg-row-curmax', p.trigger === 'current');
  // ★回数の上限・○回に1回・○秒後に は、どのきっかけ・どのすることにも付く（program.js の★）
  for (const c of ['.pg-row-nearr', '.pg-row-nearmin', '.pg-row-nearmax', '.pg-row-nearwhat'])
    show(c, p.trigger === 'near');
  show('.pg-row-hitwhat', p.trigger === 'hit');
  show('.pg-row-lightedge', p.trigger === 'light');
  show('.pg-row-key',  p.trigger === 'key');
  show('.pg-row-sigin', p.trigger === 'signal');
  for (const c of ['.pg-row-zx', '.pg-row-zy', '.pg-row-zw', '.pg-row-zh', '.pg-row-zhere'])
    show(c, p.trigger === 'zone');
  // ★〈複製・生成した物体にもプログラムを適用〉は、物体を作る操作にだけ出す。
  //   出てきた物体があってはじめて意味を持つ設定なので、作らない操作では選べても効かない。
  //   ONにするとこの物体につないだ“すべての”プログラムが複製先へ及ぶ（program.js の★）。
  show('.pg-row-scope', maker);
  // ★〈生成口の設定変更を反映〉は「生成」にだけ出す。複製元は動く実体なので、
  //   値が変わったのが人の操作か物理かを見分けられない（program.js の★）。
  show('.pg-row-sync', p.action === 'create');
  // ★「実行を止める」は時計に効くので、誰に効かせるかという欄がそもそも無い（見出しごと消す）
  // ★「合図を出す」も同じ（物体には何もしない）
  const needsTarget = (p.action !== 'pause' && p.action !== 'signal');
  show('.pg-sec-target', needsTarget);
  show('.pg-target', needsTarget);
  // ★「当たってきた相手」は、当たったときにしか決まらない
  const canOther = p.trigger === 'hit';
  sel('.pg-target').disabled = !canOther;
  if (!canOther && p.target === 'other') { p.target = 'self'; sel('.pg-target').value = 'self'; }
  show('.pg-row-limit', maker);
  show('.pg-row-color',  p.action === 'color');
  show('.pg-row-sigout', p.action === 'signal');
  show('.pg-row-layers', p.action === 'layers');
  panel.querySelectorAll('.pg-lay').forEach(el => {
    el.style.opacity = (p.layers >> +el.dataset.bit) & 1 ? 1 : 0.25;
  });
  sel('.pg-fire').style.display = p.trigger === 'key' ? '' : 'none';
  sel('.pg-body').style.display = p.collapsed ? 'none' : '';
  sel('.pg-fold').textContent = p.collapsed ? '⌃' : '⌄';
  sel('.pg-sum').textContent = p.collapsed ? programSummaryText(p) : '';
  sel('.pg-sum').title = sel('.pg-sum').textContent;   // ★幅が足りず … で切れたときの全文
  sel('.pg-note').textContent = programNoteText(p);
}
// 畳んだ窓の見出しの1行
function programSummaryText(p) {
  // ★キーのときは「どのキーか」を出す。実行ボタンと並ぶので「キーを押した瞬間」は
  //   長すぎて4行に折れた（212px の見出しに入らない）うえ、畳むとキーが読めなくなる。
  // ★合図は番号が読めないと、畳んだ窓どうしのつながりが追えない
  const trgLabel = p.trigger === 'key' ? remoteKeyLabel(p.key) + ' キー'
                 : p.trigger === 'signal' ? '合図' + p.sigIn
                 : (PROG_TRIGGERS.find(t => t[0] === p.trigger) || ['', ''])[1];
  const actLabel = (p.delay > 0 ? p.delay + '秒後 ' : '')
                 + (p.action === 'signal' ? '合図' + p.sigOut
                 : (PROG_ACTIONS.find(a => a[0] === p.action)   || ['', ''])[1]);
  // ★数えの進みは先頭に置く（見出しは狭く、末尾は … で切れる）
  const b = p.onElem() ? p.elem() : p.body(), s = b && p._state.get(b.id);
  const cnt = p.every > 1 ? '[' + ((s ? s.hits : 0) % p.every) + '/' + p.every + '] ' : '';
  return cnt + trgLabel + ' → ' + actLabel;
}
function programNoteText(p) {
  if (p.onElem()) {
    const e = p.elem();
    if (!e) return 'つないだ回路素子がありません（消えました）';
    const c = programNoteCount(p, e);
    const nm = CIRCUIT_LABELS[e.type] || '回路素子';
    const main = p.action === 'pause' ? nm + ' の電流で実行を止めます'
               : nm + ' の電流で合図' + p.sigOut + ' を出します（いま ' + Math.abs(e.I || 0).toFixed(3) + ' A）';
    return (c ? c + ' ／ ' : '') + main;
  }
  const b = p.body();
  if (!b) return 'つないだ物体がありません（消えました）';
  const c = programNoteCount(p, b);
  return (c ? c + ' ／ ' : '') + programNoteMain(p, b);   // ★数えは先頭（注は末尾が … で切れる）
}
// ★数えている途中と、待っている数。これが見えないと「3回目で」が壊れているのか
//   まだ2回なのかが分からない。数えは、つないだ物体の分だけ出す（複製の分は出さない）。
function programNoteCount(p, b) {
  const t = [];
  const s = p._state.get(b.id);
  if (p.every > 1) t.push('数え ' + ((s ? s.hits : 0) % p.every) + '/' + p.every);
  if (p.times > 0) t.push('残り ' + Math.max(0, p.times - (s ? s.fired : 0)) + '回');
  if (p._delayed.length) t.push('待ち ' + p._delayed.length);
  return t.join(' ／ ');
}
function programNoteMain(p, b) {
  const nm = b.label || '物体 ' + b.id;
  // ★止めたあと矢印が残ることを書いておく（これが「止める」を入れた理由そのもの）
  if (p.action === 'pause') return nm + ' で実行を止めます（そのtickの力の矢印が残る）';
  if (p.action === 'signal') return nm + ' から合図' + p.sigOut + ' を出します（次のステップで届く）';
  if (!PROG_MAKERS.includes(p.action)) return nm + ' につないでいます';
  // ★数えるのは「いま出ているもの」。消えたぶんはまた出せる（program.js の progLiveCount）
  const root = b._progOrigin !== undefined ? b._progOrigin : b.id;
  return (p.action === 'create' ? nm + ' は生成口です（物理に参加しません）' : nm + ' を複製')
       + ' ／ いま ' + progLiveCount(root) + ' ／ ' + Math.min(p.limit, PROG_SPAWN_MAX) + ' 個';
}
// ★「いま○個」だけは毎フレーム書き直す（render から。他の欄は触ったときだけでよい）。
//   刻々変わる値なので、止まったのか上限に当たっているのかがその場で読めないと意味がない。
function refreshProgramCounts() {
  for (const p of programs) {
    if (!p.panel) continue;
    if (p.collapsed) {
      // ★畳んだ窓でも数えの進みは毎フレーム書き直す（数えている途中が見えることが要）
      if (p.every <= 1) continue;
      const sum = p.panel.querySelector('.pg-sum'), t = programSummaryText(p);
      if (sum.textContent !== t) { sum.textContent = t; sum.title = t; }
      continue;
    }
    // ★回路素子につないだ窓は、いまの電流を毎フレーム出す（しきい値との比べが見えるように）
    if (!PROG_MAKERS.includes(p.action) && !p.onElem() && p.every <= 1 && p.times <= 0 && !p.delay) continue;
    const note = p.panel.querySelector('.pg-note');
    const s = programNoteText(p);
    if (note.textContent !== s) note.textContent = s;
  }
}
function syncAllProgramPanels() { for (const p of programs) { placeProgramPanel(p); syncProgramPanel(p); } }
