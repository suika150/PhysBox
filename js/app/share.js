// ════════════════════════════════════════
//  シーンの共有（シーン ▸ シーンを共有… / 共有されたシーンを開く…）
// ════════════════════════════════════════
//  学校の Web アプリ版（webapp.gs が配信する結合版）でだけ使える。誰でもシーンを登録でき、
//  ほかの人がそれを開ける。置き場所は結合スクリプトのスプレッドシートの「デモ」シートと、
//  作業フォルダの shared_scenes/（webapp.gs の shareSave / shareList / shareLoad）。
//  ★入口は google.script.run があるかどうかで出し分ける（shareAvailable）。
//    file:// で開いた本体にはサーバが無いので、メニューに項目そのものが出ない
//    ＝ 結合版にだけある機能になる。ソースを結合時に差し込む形にしなかったのは、
//    読み込み順の約束（index.html の script 列）を結合側で二重に持たないため。
//  ★投稿者の名前は送らない。サーバがログイン中のアカウントから決める
//    （送った名前を信じると、誰の名前でも投稿できてしまう）。
//  ★共有したシーンは、先生が「デモ」シートの G 列（公開）にチェックを入れるまで一覧に出ない（webapp.gs）。
//  ★シーンの中身は serializeScene / applySceneData（scene-io.js）をそのまま使う
//    ＝ ファイルへの保存・読み込みと同じ形式。

const SHARE_THUMB_W = 240, SHARE_THUMB_H = 150;   // ★デモ一覧のサムネイルと同じ大きさ（tools/thumbs.js）
const SHARE_TITLE_MAX = 60, SHARE_DESC_MAX = 500; // ★webapp.gs の上限とそろえる

function shareAvailable() {
  return typeof google !== 'undefined' && !!(google.script && google.script.run);
}

// google.script.run を Promise にする（サーバ側の例外は reject で返る）
function _shareCall(fn, arg) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(e => reject(e instanceof Error ? e : new Error(String(e && e.message || e))))[fn](arg);
  });
}

// 通信中の知らせ。閉じるのは呼ぶ側（_closeAppModal）
function _shareBusy(title, text) {
  appDialog({ title, body: escHtml(text), ok: '閉じる', cancel: null });
}
function _shareFail(title, lead, e) {
  _closeAppModal(false);
  appAlert(title, lead + '<div class="am-note">' + escHtml(e && e.message || e) + '</div>');
}

// いまの画面からサムネイルを作る（中央を 16:10 で切り出して縮める）。
//   ★キャンバスは画面の見たままを写す。題材の外接矩形で切る tools/thumbs.js の方式は
//     デモ用（題材の置き方に約束がある）で、自由に作ったシーンでは見たままのほうが外れない。
//   ★JPEG にする。PNG だと 1 枚 5〜10 万字になり、スプレッドシートのセル（5 万字まで）に入らない。
function _shareThumb() {
  const c = document.createElement('canvas');
  c.width = SHARE_THUMB_W; c.height = SHARE_THUMB_H;
  const g = c.getContext('2d');
  g.fillStyle = '#111318'; g.fillRect(0, 0, c.width, c.height);
  const sw = canvas.width, sh = canvas.height, k = SHARE_THUMB_W / SHARE_THUMB_H;
  let cw = sw, ch = sw / k;
  if (ch > sh) { ch = sh; cw = sh * k; }
  g.drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

// ── 共有する ──
async function shareScene() {
  const T = 'シーンを共有';
  let me;
  _shareBusy(T, 'アカウントを確認しています…');
  try { me = await _shareCall('shareWhoAmI'); }
  catch (e) { _shareFail(T, '共有の準備ができませんでした。', e); return; }
  _closeAppModal(false);
  // ★回数の上限に達しているなら、書かせる前に言う（書いてから断られると、書いた分が無駄になる）。
  //   最後に決めるのはサーバ（shareSave）。ここは先回りの案内だけ
  if (!me.teacher && me.rateLeft === 0) {
    appAlert(T, '共有できるのは ' + me.rateWindowMin + ' 分間に ' + me.rateMax + ' 件までです。'
      + '<div class="am-note">あと ' + Number(me.rateWaitMin) + ' 分ほどで、また共有できます。</div>');
    return;
  }

  let title = sceneName || '', desc = '';
  for (;;) {
    const pr = appDialog({
      title: T, ok: '共有する',
      body:
        '今のシーンを、ほかの人も開けるように登録します。'
      + _shareRulesHTML(me)
      + '<div style="margin-top:10px">作成者：<b>' + escHtml(me.name) + '</b></div>'
      + '<div style="margin-top:8px">タイトル</div>'
      + '<input id="share-title" class="prop-input" style="width:100%" maxlength="' + SHARE_TITLE_MAX + '"'
      + ' value="' + escHtml(title) + '">'
      + '<div style="margin-top:8px">説明（何を見るシーンか・操作のしかた）</div>'
      + '<textarea id="share-desc" class="prop-input" rows="4" style="width:100%;resize:vertical"'
      + ' maxlength="' + SHARE_DESC_MAX + '">' + escHtml(desc) + '</textarea>'
    });
    // ★値は入力のたびに控える（appDialog は閉じるときに要素を捨てる。appPrompt と同じ理由）
    const ti = document.getElementById('share-title'), de = document.getElementById('share-desc');
    ti.addEventListener('input', () => title = ti.value);
    de.addEventListener('input', () => desc = de.value);
    ti.focus(); ti.select();
    if (!await pr) return;
    title = title.trim(); desc = desc.trim();
    if (title) break;
    await appAlert(T, 'タイトルを入れてください。');
  }

  _shareBusy(T, '送信しています…');
  try {
    const scene = serializeScene();
    scene.name = title;              // ★開いた人の画面ではタイトルがシーン名になる
    await _shareCall('shareSave', { title, desc, thumb: _shareThumb(), scene: JSON.stringify(scene) });
  } catch (e) { _shareFail(T, '共有できませんでした。', e); return; }
  setSceneName(title);
  _closeAppModal(false);
  appAlert(T, '「' + escHtml(title) + '」を送りました。'
    + '<div class="am-note">先生が確認すると公開され、シーン ▸ 共有されたシーンを開く… から'
    + 'ほかの人も開けるようになります。</div>');
}

// 投稿のきまり（共有の窓に毎回出す）。
//   ★きまりは別の説明のページに置かず、送る直前に必ず目に入る場所に出す（先生と決めた運用。2026-10-11）。
//     回数の残りもここに出す（上限に当たってから知ると、書いた説明が無駄になる）
function _shareRulesHTML(me) {
  const rules = [
    '作成者の名前（<b>' + escHtml(me.name) + '</b>）は、公開されると全員に見えます。',
    '先生が確認してから公開されます。送ってすぐには一覧に出ません。',
    'ほかの人のシーンを少し変えて出すときは、説明に元の作者を書いてください。',
    '公開したものを消してほしいときは、先生に伝えてください。',
    me.teacher
      ? '先生のアカウントなので、回数の制限はありません。'
      : me.rateWindowMin + ' 分間に ' + me.rateMax + ' 件まで共有できます（いま、あと <b>' + Number(me.rateLeft) + '</b> 件）。',
  ];
  return '<div class="am-note" style="margin-top:8px"><b>投稿のきまり</b>'
       + '<ul style="margin:4px 0 0;padding-left:1.3em">'
       + rules.map(r => '<li>' + r + '</li>').join('') + '</ul></div>';
}

// ── 共有されたシーンの一覧窓 ──
//   ★見た目はデモの一覧窓（js/ui/demo-browser.js）と同じ部品・同じ CSS（css/style.css の
//     :is(#demo-browser, #share-browser)）。カードに乗せると下の帯に説明が出るのも同じ。
//   ★一覧は開くたびに取り直す（ほかの人が今しがた登録したものが出るように）。
let _shareBrowserEl = null;
function openSharedBrowser() {
  if (_shareBrowserEl) return;
  const wrap = document.createElement('div');
  wrap.id = 'share-browser';
  wrap.innerHTML =
    '<div class="db-box">'
  + '<div class="db-head"><div class="db-title">共有されたシーンを開く</div>'
  + '<button class="db-close" title="閉じる (Esc)">×</button></div>'
  + '<div class="db-tabs"><input class="prop-input sb-filter" placeholder="タイトル・作成者・説明で絞り込み">'
  + '<label class="sb-only" hidden><input type="checkbox"> 未公開だけ</label></div>'
  + '<div class="db-body"></div><div class="db-foot"></div></div>';
  const body = wrap.querySelector('.db-body'), foot = wrap.querySelector('.db-foot');
  const filter = wrap.querySelector('.sb-filter');
  // ★「未公開だけ」は先生の確認用（未公開の行は先生にしか返ってこないので、生徒には出ない）
  const onlyLbl = wrap.querySelector('.sb-only'), only = onlyLbl.querySelector('input');
  wrap.querySelector('.db-close').onclick = () => closeSharedBrowser();
  wrap.addEventListener('mousedown', ev => { if (ev.target === wrap) closeSharedBrowser(); });
  // ★開いている間はアプリのショートカットを全部せき止める（絞り込み欄に打った文字で道具が変わらないように）
  const onKey = ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); closeSharedBrowser(); }
  };
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(wrap);
  _shareBrowserEl = { el: wrap, onKey };

  let footIdle = '読み込んでいます…', items = [];
  const showNote = text => {
    foot.textContent = text || footIdle;
    foot.classList.toggle('db-foot-note', !!text);
  };
  showNote(null);

  function render() {
    const q = filter.value.trim().toLowerCase();
    const list = items.filter(it => (!only.checked || it.pending) &&
      (!q || (it.title + '\n' + it.author + '\n' + it.desc).toLowerCase().includes(q)));
    body.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'db-row';
    for (const it of list) {
      const card = document.createElement('button');
      card.className = 'db-card' + (it.pending ? ' sb-pending' : '');
      const pic = document.createElement('div');
      pic.className = 'db-pic';
      // ★data:image/jpeg だけを絵として使う（シートは先生が手で直せるので、何が入っていてもよいように）
      if (/^data:image\/jpeg;base64,/.test(it.thumb)) {
        const img = document.createElement('img');
        img.src = it.thumb; img.alt = ''; img.draggable = false;
        pic.appendChild(img);
      }
      if (it.pending) {
        const tag = document.createElement('span');
        tag.className = 'sb-tag'; tag.textContent = '未公開';
        pic.appendChild(tag);
      }
      const nm = document.createElement('div');
      nm.className = 'db-name'; nm.textContent = it.title;
      const by = document.createElement('div');
      by.className = 'sb-by'; by.textContent = it.author;
      card.appendChild(pic); card.appendChild(nm); card.appendChild(by);
      card.onclick = () => openSharedScene(it);
      card.onmouseenter = () => showNote((it.pending ? '【未公開】' : '') + it.title + ' ― ' + it.author + '（' + it.time + '）'
                                         + (it.desc ? '：' + it.desc : ''));
      card.onmouseleave = () => showNote(null);
      row.appendChild(card);
    }
    body.appendChild(row);
    const nPending = items.filter(it => it.pending).length;
    footIdle = !items.length ? 'まだ公開されたシーンはありません。シーン ▸ シーンを共有… で送ったものは、先生が確認すると出ます'
             : !list.length ? '当てはまるシーンはありません'
             : list.length + '件。カードにマウスを乗せると説明が出ます'
               + (nPending ? '。未公開 ' + nPending + ' 件は先生にだけ見えています（公開は「デモ」シートの G 列）' : '');
    showNote(null);
  }
  filter.addEventListener('input', render);
  only.addEventListener('change', render);

  _shareCall('shareList').then(res => {
    if (!_shareBrowserEl || _shareBrowserEl.el !== wrap) return;   // 待つ間に閉じられた
    items = res || [];
    onlyLbl.hidden = !items.some(it => it.pending);
    render();
    filter.focus();
  }, e => {
    if (!_shareBrowserEl || _shareBrowserEl.el !== wrap) return;
    footIdle = '一覧を読み込めませんでした：' + (e && e.message || e);
    showNote(null);
  });
}
function closeSharedBrowser() {
  if (!_shareBrowserEl) return;
  window.removeEventListener('keydown', _shareBrowserEl.onKey, true);
  _shareBrowserEl.el.remove();
  _shareBrowserEl = null;
}

// 他人のシーンを開く前の、もう一段の関所。★形の検査（id は数・__proto__ を捨てる）は
//   applySceneData（scene-io.js の sanitizeSceneData）がファイルの読み込みと共通でやる。
//   文字を HTML に出す箇所もそれぞれ逃がしてあるが、共有では書いた人と開く人が違い、
//   1 か所でも漏れると開いた人の画面でスクリプトが動いて、その人の名前で shareSave を呼べてしまう。
//   そこで共有に限り、text 以外の文字列の < > " ' ` を全角に置き換えて、漏れがあっても効かないようにする。
//   text（注釈の本文）は「N = mg」「a < b」など式が入るので触らない（実測：デモ 260 件で
//   この置き換えに当たる文字は注釈の本文にしか無く、ほかは 1 文字も変わらない）。
const _SHARE_WIDE = { '<': '＜', '>': '＞', '"': '＂', "'": '＇', '`': '｀' };
function _shareSanitize(v, key) {
  if (Array.isArray(v)) return v.map(x => _shareSanitize(x, key));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v))
      if (k !== '__proto__') o[k] = _shareSanitize(v[k], k);   // ★代入すると o の親の差し替えになる（捨てるのは applySceneData でも同じ）
    return o;
  }
  if (typeof v === 'string' && key !== 'text') return v.replace(/[<>"'`]/g, c => _SHARE_WIDE[c]);
  return v;
}

// ★開いたあとはデモを開いたときと同じ「素の状態」にそろえる（runDemo の★）：
//   道具は選択・一時停止・右パネルは隠す。履歴はファイルからの読み込みと同じく触らない。
async function openSharedScene(it) {
  const T = '共有されたシーンを開く';
  closeSharedBrowser();
  _shareBusy(T, '「' + it.title + '」を読み込んでいます…');
  let text;
  try { text = await _shareCall('shareLoad', it.id); }
  catch (e) { _shareFail(T, 'シーンを取り出せませんでした。', e); return; }
  _closeAppModal(false);
  try {
    closeToolPopups();
    setTool('pointer');
    simPause();
    applySceneData(_shareSanitize(JSON.parse(text), ''));
    updatePropsPanel(null);
    showSharedCredit(it.title, it.author, it.pending);
  } catch (e) {
    appAlert(T, 'シーンの読み込みに失敗しました。<div class="am-note">' + escHtml(e.message) + '</div>');
  }
}

// ── 開いている共有シーンの作者とタイトル（下のステータスバー） ──
//   ★開いている間ずっと出す。一覧のカードで見ただけでは、開いたあとに誰の何かが分からなくなる
//     （シーンの中身は作者を持たない。作者は「デモ」シートの行にだけある）。
//   ★別のシーンに入れ替わったら消す：clearScene（デモ・新規作成）と applySceneData（ファイル・共有）が呼ぶ。
//   ★ステータスバーの項目は index.html に書かず、ここで足す（共有は結合版だけの機能なので）。
function showSharedCredit(title, author, pending) {
  clearSharedCredit();
  const bar = document.getElementById('statusbar');
  if (!bar) return;
  const el = document.createElement('div');
  el.className = 'status-item'; el.id = 'st-shared';
  el.style.color = 'var(--accent)';
  el.appendChild(document.createTextNode(pending ? '共有（未公開・確認中）：' : '共有：'));
  const t = document.createElement('span'); t.textContent = '「' + title + '」';
  el.appendChild(t);
  el.appendChild(document.createTextNode(' 作成者：'));
  const a = document.createElement('span'); a.textContent = author;
  el.appendChild(a);
  // ズームの項目（margin-left:auto で右へ寄せてある）の手前に入れる
  const zoom = document.getElementById('st-zoom');
  bar.insertBefore(el, zoom ? zoom.parentNode : null);
  flashHint('共有されたシーン「' + title + '」（作成者：' + author + '）を開きました');
}
function clearSharedCredit() {
  const el = document.getElementById('st-shared');
  if (el) el.remove();
}
