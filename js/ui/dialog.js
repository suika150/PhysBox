// ════════════════════════════════════════
//  アプリ内ダイアログ（ブラウザの confirm / alert の置き換え）
// ════════════════════════════════════════
//  ブラウザ標準の窓は OS のものなので、配色も書体もアプリから浮くうえ、
//  文字の強調ができない（何が消えるのかを目立たせられない）。
//  他のポップアップと同じ「水色の枠・うすい黒の背景・白文字」で作り直す。
//
//  ★Promise を返すので、呼ぶ側は await で書ける。
//    標準の confirm と違って実行が止まらない（その場で false が返るのではなく、
//    ボタンを押すまで待つ）ので、呼ぶ関数は async にすること。
//  ★開いている間はキーボードのショートカットを全部せき止める。
//    素通しにすると、確認の窓が出ているのに Z で再生が始まってしまう。
let _appModal = null;
function appModalOpen() { return !!_appModal; }
function _closeAppModal(result) {
  if (!_appModal) return;
  const done = _appModal.resolve;
  window.removeEventListener('keydown', _appModal.onKey, true);
  _appModal.el.remove();
  _appModal = null;
  done(result);
}
// opts: { title, body(HTML可), ok, cancel(null で「OK」だけの通知窓), danger }
function appDialog(opts) {
  return new Promise(resolve => {
    if (_appModal) _closeAppModal(false);      // 二重に開かない
    const o = opts || {};
    const wrap = document.createElement('div');
    wrap.id = 'app-modal';
    const box = document.createElement('div');
    box.className = 'am-box';
    const ttl = document.createElement('div');
    ttl.className = 'am-title'; ttl.textContent = o.title || '';
    const body = document.createElement('div');
    body.className = 'am-body'; body.innerHTML = o.body || '';
    const btns = document.createElement('div');
    btns.className = 'am-btns';
    box.appendChild(ttl); box.appendChild(body); box.appendChild(btns);
    wrap.appendChild(box);
    let cancelBtn = null;
    if (o.cancel !== null) {
      cancelBtn = document.createElement('button');
      cancelBtn.className = 'am-btn';
      cancelBtn.textContent = o.cancel || 'キャンセル';
      cancelBtn.onclick = () => _closeAppModal(false);
      btns.appendChild(cancelBtn);
    }
    const okBtn = document.createElement('button');
    okBtn.className = 'am-btn ' + (o.danger ? 'am-danger' : 'am-ok');
    okBtn.textContent = o.ok || 'OK';
    okBtn.onclick = () => _closeAppModal(true);
    btns.appendChild(okBtn);
    // うすい黒の部分を押したら取り消し（枠の中を押しても閉じない）
    wrap.addEventListener('mousedown', ev => { if (ev.target === wrap) _closeAppModal(false); });
    const onKey = ev => {
      ev.stopPropagation();                    // アプリのショートカットへは通さない
      if (ev.key === 'Escape') { ev.preventDefault(); _closeAppModal(false); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        _closeAppModal(document.activeElement !== cancelBtn);
      }
    };
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    _appModal = { el: wrap, resolve, onKey };
    // 取り返しのつかない操作では「キャンセル」に合わせておく
    // （Enter を押しただけで消えてしまわないように）
    (o.danger && cancelBtn ? cancelBtn : okBtn).focus();
  });
}
function appConfirm(title, body, ok, danger) {
  return appDialog({ title, body, ok, danger });
}
function appAlert(title, body) {
  return appDialog({ title, body, ok: 'OK', cancel: null });
}
// 1行の文字を受け取るダイアログ（window.prompt の置き換え）。
//   返り値は入力した文字列。キャンセル（Esc・×・うすい黒の部分）なら null。
//   ★値は入力のたびに控える。appDialog は閉じるときに要素を捨てるので、
//     OK を押したあとに DOM から読もうとしても手遅れになる。
function appPrompt(title, body, defValue, ok) {
  let value = defValue == null ? '' : String(defValue);
  const html = (body || '') +
    `<input id="am-prompt-input" class="prop-input" style="width:100%;margin-top:8px"` +
    ` value="${escHtml(value)}">`;
  const pr = appDialog({ title, body: html, ok: ok || '保存' });
  const el = document.getElementById('am-prompt-input');
  if (el) {
    el.addEventListener('input', () => value = el.value);
    el.focus(); el.select();
  }
  return pr.then(okPressed => okPressed ? value.trim() : null);
}
// 本文は innerHTML で入れる（<b> で強調したいため）ので、
// 例外のメッセージのように中身が読めない文字列はこれを通してから埋め込む。
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
