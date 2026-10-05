// ════════════════════════════════════════
//  デモシーンの一覧窓（シーン ▸ デモシーンを読み込み）
// ════════════════════════════════════════
//  ★中身は DEMO_CATALOG（js/app/demos.js）の写しでしかない。
//    ここには「どんなデモがあるか」を一切書かない ＝ 一覧の編集は目録側だけで済む。
//  ★以前は1段のホバーサブメニューだったが、85件・4分野になったので窓にした。
//    ホバーで4段目まで開く形は、分野→単元→デモと辿る間に横へ伸びて画面外へ出る。
//  ★分野タブは閉じても覚えておく（同じ単元の別のデモを続けて試すことが多いため）。
//  ★項目は「サムネイル＋名前」のカード。127件になり、名前の文字だけでは中身が思い出せない。
//    絵は tools/thumbs.js が撮って js/data/demo-thumbs.js（DEMO_THUMBS）に埋め込んだもので、
//    キーはデモの関数名。絵の無いデモ（撮り忘れ・未実装）は文字だけのカードになる。
//  ★単元は1つずつ改行せず、横に詰めて流す（単元＝見出し＋カードの塊）。1〜3件の単元が多く、
//    単元ごとに改行すると行の右側がほとんど空になって縦に長くなる。
//  ★note は窓の下の帯に出す（カードにマウスを乗せている間だけ）。ツールチップは出るまで待たされる。
let _demoBrowserEl    = null;
let _demoBrowserField = 0;
let _lastDemo = null;   // いま開いているデモ（目録の行）。別のシーンに入れ替わったら null（history.js の clearScene）
function openDemoBrowser() {
  if (_demoBrowserEl) return;
  const wrap = document.createElement('div');
  wrap.id = 'demo-browser';
  const box = document.createElement('div');
  box.className = 'db-box';
  const head = document.createElement('div');
  head.className = 'db-head';
  const ttl = document.createElement('div');
  ttl.className = 'db-title'; ttl.textContent = 'デモシーンを読み込み';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'db-close'; closeBtn.textContent = '×'; closeBtn.title = '閉じる (Esc)';
  closeBtn.onclick = () => closeDemoBrowser();
  head.appendChild(ttl); head.appendChild(closeBtn);
  const tabs = document.createElement('div');
  tabs.className = 'db-tabs';
  const body = document.createElement('div');
  body.className = 'db-body';
  const foot = document.createElement('div');
  foot.className = 'db-foot';
  box.appendChild(head); box.appendChild(tabs); box.appendChild(body); box.appendChild(foot);
  wrap.appendChild(box);
  // 分野タブ
  const tabBtns = DEMO_CATALOG.map((f, i) => {
    const b = document.createElement('button');
    b.className = 'btn-small'; b.textContent = f.field;
    b.onclick = () => showField(i);
    tabs.appendChild(b);
    return b;
  });
  function showField(i) {
    _demoBrowserField = i;
    tabBtns.forEach((b, k) => b.classList.toggle('active', k === i));
    body.innerHTML = '';
    let todo = 0;
    const thumbs = typeof DEMO_THUMBS !== 'undefined' ? DEMO_THUMBS : {};
    for (const u of DEMO_CATALOG[i].units) {
      const grp = document.createElement('div');
      grp.className = 'db-group';
      const h = document.createElement('div');
      h.className = 'db-unit'; h.textContent = u.name;
      grp.appendChild(h);
      const row = document.createElement('div');
      row.className = 'db-row';
      for (const d of u.demos) {
        const card = document.createElement('button');
        card.className = 'db-card';
        const pic = document.createElement('div');
        pic.className = 'db-pic';
        const src = d.fn && thumbs[d.fn.name];
        if (src) {
          const img = document.createElement('img');
          img.src = src; img.alt = ''; img.draggable = false;
          pic.appendChild(img);
        }
        const nm = document.createElement('div');
        nm.className = 'db-name'; nm.textContent = d.name;
        card.appendChild(pic); card.appendChild(nm);
        if (d.fn) {
          card.onclick = () => runDemo(d);
          card.onmouseenter = () => showNote(d.name + (d.note ? '：' + d.note : ''));
        } else {
          card.disabled = true;
          card.onmouseenter = () => showNote(d.name + '：まだ用意していません');
          todo++;
        }
        card.onmouseleave = () => showNote(null);
        row.appendChild(card);
      }
      grp.appendChild(row);
      body.appendChild(grp);
    }
    body.scrollTop = 0;
    // ★「灰色は未実装」の断り書きは、その分野が埋まったら自動で消える
    footIdle = todo ? '灰色の項目はまだ用意していません（' + todo + '件）' : 'カードにマウスを乗せると説明が出ます';
    showNote(null);
  }
  // 下の帯：乗せているカードの説明。乗せていないときは断り書き
  let footIdle = '';
  function showNote(text) {
    foot.textContent = text || footIdle;
    foot.classList.toggle('db-foot-note', !!text);
  }
  // うすい黒の部分を押したら閉じる（枠の中を押しても閉じない）
  wrap.addEventListener('mousedown', ev => { if (ev.target === wrap) closeDemoBrowser(); });
  // ★開いている間はアプリのショートカットを全部せき止める（Z で再生が始まらないように）
  const onKey = ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); closeDemoBrowser(); }
  };
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(wrap);
  _demoBrowserEl = { el: wrap, onKey };
  showField(Math.min(_demoBrowserField, DEMO_CATALOG.length - 1));
}
// ★一覧の窓の外からも呼ぶ（シミュレーション ›「デモ読み込み時に戻す」）ので、窓の中の関数にしない
// ★デモは world / ground を直接書き換えるので、全体設定タブはまとめて作り直す
//   （syncSliders() だけだと、重力を変えるデモでも欄の数字が古いまま残る）
// ★どのデモも「一時停止で開く」。デモは ▶実行 を押してもらう前提で書かれていて
//   （説明書きも手順から始まる）、読み込んだ瞬間から走り出すと初期配置が見えない。
//   ここで止めるのは、デモ側の最後の1行に任せていたのを引き取ったもの：
//   「物体の運動」の11個だけがその1行を持っておらず、実行中に開くと走り出したうえ
//   ▶/⏸ の表示も切り替わらなかった（running のままボタンだけ食い違う）。
//   ＝ 新しいデモを足す人が忘れられない位置へ移す（デモ側では簡単に落ちる約束だった）。
function runDemo(d) {
  closeDemoBrowser();
  // ★デモを開く前に、道具まわりの状態を素へ戻す。左ツールバーで何かのツール
  //   （箱・ばねなど）を選んだままデモを開くと、右パネルに「これから作る物の設定」が
  //   出たまま居座り、左ツールバーから開いた設定窓も開きっぱなしになる。
  //   デモは見るためのものなので、編集ツール＋パネルなしの状態から始める。
  closeToolPopups();          // 左ツールバーから開いた設定窓を畳む
  setTool('pointer');
  clearScene();
  simPause();
  // ★組み立てのあいだは履歴を積ませない（js/app/history.js の buildingScene の★）。
  //   デモは手で作れる部品だけで組む約束なので、置く入口も人が使うものと同じ
  //   （addProgram / addRemote）＝ その入口が積む履歴を、ここで止める。
  //   組み立て前の状態は上の clearScene が積んでいる。
  buildingScene = true;
  try { d.fn(); } finally { buildingScene = false; }
  // ★読み込んだ時点を履歴の始まりにする（2026-09-28、ユーザーの指示）。戻るで読み込む前の
  //   シーンへ抜けられると、デモの中で「崩しても戻せる」と書いたとおりに戻らない
  //   （戻りすぎて前のシーンが出る）。clearScene が積んだ1段ごと捨てる。
  //   playUndoArmed は clearScene が立てたまま＝最初の ▶実行 で読み込み時の配置が積まれる。
  undoStack.length = 0; redoStack.length = 0;
  updateUndoRedoButtons();
  updatePropsPanel(null);     // ★右パネルを隠す（未選択なら隠す。CLAUDE.md の不変条件）
  syncWorldPanel();
  // ★シミュレーション ›「デモ読み込み時に戻す」の相手。clearScene が捨てたあとに入れ直す
  _lastDemo = d;
}

// シミュレーション ›「デモ読み込み時に戻す」。★デモ関数をもう一度走らせる：控えの状態（snapshotState）は
//   重力などの全体設定・カメラ・グラフの窓を持たないので、控えを戻すより開き直すほうが読み込み時と確実に同じになる。
//   開き直しは履歴を空にする（runDemo の★）＝戻るでは取り返せないので、先に確かめる。
async function reloadLastDemo() {
  const d = _lastDemo;
  if (!d) return;
  const ok = await appConfirm('デモ読み込み時に戻す',
    '「' + d.name + '」を、読み込んだ直後の状態から開き直します。'
  + '<div class="am-note">置いた物・変えた設定もすべて消え、戻るボタンでは取り返せません。'
  + '変えた設定を残したまま最初の位置へ戻すには「実行前に戻す」を使います。</div>',
    '開き直す', true);
  if (ok) runDemo(d);
}
// チュートリアルのタブで一覧を開く（上のバーの初心者マークのボタン）。
//   ★分野は名前で探す（目録の並びを変えても追いつくように）。開いていたら一度閉じて開き直す。
function openTutorials() {
  const i = DEMO_CATALOG.findIndex(f => f.field === 'チュートリアル');
  if (i >= 0) _demoBrowserField = i;
  if (_demoBrowserEl) closeDemoBrowser();
  openDemoBrowser();
}
function closeDemoBrowser() {
  if (!_demoBrowserEl) return;
  window.removeEventListener('keydown', _demoBrowserEl.onKey, true);
  _demoBrowserEl.el.remove();
  _demoBrowserEl = null;
}
