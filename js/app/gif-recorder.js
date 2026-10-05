const gifRec = {
  active:false, phase:'idle',   // 'select'|'ready'|'countdown'|'recording'|'confirm'|'encoding'
  rect:null, fps:12, gif:null, frameCount:0,
  countdown:3,                  // ★カウントダウン秒数（可変）
  maxFrames:900,                // 安全上限（≒75s @12fps）
  _tmp:null, _tmpCtx:null, _lastCap:0, _t0:0, _drag:null, _cdTimer:null,
  _ov:null, _panel:null, _sel:null, _hint:null, _cd:null, _status:null,
};
let _gifWorkerUrl = null;
// gif.js の worker を blob 化して返す（Worker はページと同一オリジンから読む必要がある）。
//   ★ソースは lib/gif.worker.embed.js（<script> で読み込み済みのただの文字列）から取る。
//     以前は fetch('lib/gif.worker.js') で取っていたが、physBox.html を file:// で
//     直接開くと fetch は CORS で必ず失敗する（"Failed to fetch"）。カウントダウンの
//     あとに「録画の初期化に失敗しました」と出ていたのはこれ。
//     埋め込みが無い環境のために fetch も残してあるが、通常はそこへは来ない。
async function ensureGifWorker() {
  if (_gifWorkerUrl) return _gifWorkerUrl;
  let src = (typeof GIF_WORKER_SRC === 'string' && GIF_WORKER_SRC) ? GIF_WORKER_SRC : null;
  if (src == null) {
    try {
      const res = await fetch('lib/gif.worker.js');
      if (res.ok) src = await res.text();
    } catch (e) { /* file:// なら必ずここへ来る。下でまとめて報告する */ }
  }
  if (src == null)
    throw new Error('lib/gif.worker.embed.js を読み込めませんでした（ファイルが揃っているか確認してください）');
  _gifWorkerUrl = URL.createObjectURL(new Blob([src], { type:'application/javascript' }));
  // ★ここで1つ試しに起こして、この開き方で Worker が使えるか先に確かめる。
  //   gif.js が worker を起こすのはエンコード（render）の時なので、確かめずに進むと
  //   「録画し終えて保存を押した瞬間に失敗」という、いちばん困る壊れ方をする。
  try {
    new Worker(_gifWorkerUrl).terminate();
  } catch (e) {
    URL.revokeObjectURL(_gifWorkerUrl);
    _gifWorkerUrl = null;
    throw new Error('このブラウザではファイルを直接開いた状態（file://）でGIFの'
                  + 'エンコードができません。フォルダをローカルサーバーで配信して'
                  + 'http://localhost/… として開いてください。');
  }
  return _gifWorkerUrl;
}
function _gifLocal(e) { const r = canvas.getBoundingClientRect(); return { x:e.clientX-r.left, y:e.clientY-r.top }; }
// 範囲を決めたあとの案内。カウントダウンは変えられるので、その値をそのまま出す
//   （以前は「3秒後に録画します」と直書きで、0秒や5秒にすると案内と食い違っていた）
function gifReadyHint() {
  const s = gifRec.countdown;
  return '範囲を確定しました。必要なら▶実行で再生し、「録画開始」で'
       + (s > 0 ? `${s}秒後に` : 'すぐに') + '録画します';
}
function gifSetHint(t) { if (gifRec._hint) gifRec._hint.textContent = t; }
function gifUpdateSelRect() {
  const r = gifRec.rect, el = gifRec._sel;
  if (!r) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.left = r.x+'px'; el.style.top = r.y+'px';
  el.style.width = r.w+'px'; el.style.height = r.h+'px';
}
function startGifMode() {
  if (gifRec.active) return;
  if (typeof GIF === 'undefined') {
    appAlert('GIFアニメを保存',
      'GIFライブラリ（<b>lib/gif.js</b>）を読み込めませんでした。'
    + '<div class="am-note">ファイルが揃っているか確認してください。</div>');
    return;
  }
  if (running) simPause();   // 既定は停止状態から。再生は録画開始前に手動で
  gifRec.active = true; gifRec.phase = 'select';
  gifBuildUI();
  gifSetHint('ドラッグして録画範囲を指定してください（Escでキャンセル）');
  gifBuildPanel();
}
function gifBuildUI() {
  const wrap = document.getElementById('canvas-wrap');
  const ov = document.createElement('div');
  ov.id = 'gif-overlay';
  ov.innerHTML = `<div id="gif-selrect"></div><div id="gif-hint"></div><div id="gif-countdown"></div>`;
  wrap.appendChild(ov);
  const panel = document.createElement('div'); panel.id = 'gif-panel'; wrap.appendChild(panel);
  gifRec._ov = ov; gifRec._panel = panel;
  gifRec._sel = ov.querySelector('#gif-selrect');
  gifRec._hint = ov.querySelector('#gif-hint');
  gifRec._cd = ov.querySelector('#gif-countdown');
  ov.addEventListener('mousedown', gifSelMouseDown);
  window.addEventListener('mousemove', gifSelMouseMove);
  window.addEventListener('mouseup', gifSelMouseUp);
}
function gifSelMouseDown(e) {
  if (e.button !== 0) return;
  if (gifRec.phase !== 'select' && gifRec.phase !== 'ready') return;
  const p = _gifLocal(e);
  gifRec._drag = { x0:p.x, y0:p.y };
  gifRec.rect = { x:p.x, y:p.y, w:0, h:0 };
  gifRec.phase = 'select';
  gifUpdateSelRect();
}
function gifSelMouseMove(e) {
  if (!gifRec._drag) return;
  const p = _gifLocal(e), x0 = gifRec._drag.x0, y0 = gifRec._drag.y0;
  gifRec.rect = { x:Math.min(x0,p.x), y:Math.min(y0,p.y), w:Math.abs(p.x-x0), h:Math.abs(p.y-y0) };
  gifUpdateSelRect();
}
function gifSelMouseUp() {
  if (!gifRec._drag) return;
  gifRec._drag = null;
  const r = gifRec.rect;
  r.x = Math.round(r.x); r.y = Math.round(r.y); r.w = Math.round(r.w); r.h = Math.round(r.h);
  if (r.w < 20 || r.h < 20) {
    gifRec.rect = null; gifUpdateSelRect(); gifRec.phase = 'select';
    gifSetHint('範囲が小さすぎます。もう一度ドラッグしてください'); gifBuildPanel(); return;
  }
  gifRec.phase = 'ready';
  gifSetHint(gifReadyHint());
  gifBuildPanel();
}
function gifBuildPanel() {
  const p = gifRec._panel; if (!p) return;
  p.innerHTML = '';
  const status = document.createElement('span'); status.className = 'gif-status'; p.appendChild(status);
  gifRec._status = status;
  const btn = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; b.className = 'gif-btn ' + cls; b.onclick = fn; p.appendChild(b); };
  const g = gifRec;
  if (g.phase === 'select') {
    status.textContent = '録画したい範囲をドラッグ';
    btn('キャンセル','gray', exitGifMode);
  } else if (g.phase === 'ready') {
    status.textContent = `範囲 ${g.rect.w}×${g.rect.h}px`;
    // パネルに置く数値欄（開始までの秒数・1秒あたりのコマ数で共用）
    const numField = (label, unit, min, max, get, set, title) => {
      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:12px; color:var(--text2)';
      if (title) wrap.title = title;
      wrap.insertAdjacentHTML('beforeend', '<span>' + label + '</span>');
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.step = '1';
      inp.value = get();
      inp.style.cssText = 'width:44px; background:var(--bg); border:1px solid var(--border);'
                        + 'color:var(--text); padding:2px 4px; border-radius:4px; font-size:12px';
      inp.onchange = () => {
        const v = Math.max(min, Math.min(max, Math.round(parseFloat(inp.value) || 0)));
        inp.value = v; set(v);
      };
      wrap.appendChild(inp);
      wrap.insertAdjacentHTML('beforeend', '<span>' + unit + '</span>');
      p.appendChild(wrap);
      return wrap;
    };
    // ★カウントダウン秒数の選択（0=即開始）
    numField('開始まで', '秒', 0, 10, () => g.countdown, v => { g.countdown = v; });
    // ★1秒あたりのコマ数。
    //   上限を30にしてあるのは、取り込みが画面の描画（requestAnimationFrame ＝ 約60コマ/秒）に
    //   相乗りしているため。それ以上を指定しても実際には上がらない。
    //   GIF の待ち時間は 1/100 秒刻みなので、細かくしてもこの辺りが頭打ちでもある。
    const fpsWrap = numField('1秒あたり', 'コマ', 1, 30, () => g.fps, v => { g.fps = v; showLimit(); },
      '多いほどなめらかになりますが、同じ長さでもコマ数が増えるのでファイルが大きくなり、'
    + 'エンコードにも時間がかかります。10〜15 くらいが目安です。\n'
    + '実際の待ち時間は取り込めた間隔をそのまま書き込むので、指定どおり出なくても速さは狂いません。');
    const limit = document.createElement('span');
    limit.style.cssText = 'font-size:11px; color:var(--text2)';
    fpsWrap.appendChild(limit);
    const showLimit = () => { limit.textContent = `（最長 ${Math.floor(g.maxFrames / g.fps)} 秒）`; };
    showLimit();
    btn('録画開始','red', gifStartCountdown);
    btn('範囲やり直し','gray', () => { g.rect=null; g.phase='select'; gifUpdateSelRect(); gifSetHint('ドラッグして録画範囲を指定してください'); gifBuildPanel(); });
    btn('キャンセル','gray', exitGifMode);
  } else if (g.phase === 'countdown') {
    status.textContent = 'まもなく録画開始…';
    btn('中止','gray', gifCancelCountdown);
  } else if (g.phase === 'recording') {
    status.textContent = '● 録画中 0.0s / 0コマ';
    btn('停止','red', gifStopRecording);
  } else if (g.phase === 'encoding') {
    status.textContent = 'エンコード中… 0%';
  }
}
function gifStartCountdown() {
  const secs = Math.max(0, Math.round(gifRec.countdown) || 0);
  if (secs === 0) {   // ★0秒＝カウントなしで即録画
    gifRec._ov.style.pointerEvents = 'none';
    gifSetHint('');
    gifBeginRecording();
    return;
  }
  gifRec.phase = 'countdown';
  gifRec._ov.style.pointerEvents = 'none';   // シミュレーションが見えるように（パネルは別要素なので操作可）
  gifSetHint(''); gifBuildPanel();
  let n = secs;
  const cd = gifRec._cd; cd.style.display = 'flex'; cd.textContent = n;
  gifRec._cdTimer = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(gifRec._cdTimer); gifRec._cdTimer = null; cd.style.display = 'none'; gifBeginRecording(); }
    else cd.textContent = n;
  }, 1000);
}
function gifCancelCountdown() {
  if (gifRec._cdTimer) { clearInterval(gifRec._cdTimer); gifRec._cdTimer = null; }
  gifRec._cd.style.display = 'none';
  gifRec._ov.style.pointerEvents = '';
  gifRec.phase = 'ready';
  gifSetHint(gifReadyHint());
  gifBuildPanel();
}
async function gifBeginRecording() {
  try {
    const workerUrl = await ensureGifWorker();
    const r = gifRec.rect;
    gifRec._tmp = document.createElement('canvas');
    gifRec._tmp.width = r.w; gifRec._tmp.height = r.h;
    gifRec._tmpCtx = gifRec._tmp.getContext('2d');
    gifRec.gif = new GIF({ workers:2, quality:10, workerScript:workerUrl, width:r.w, height:r.h });
    gifRec.frameCount = 0;
    gifRec._lastCap = performance.now();
    gifRec._t0 = performance.now();
    gifRec.phase = 'recording';
    gifBuildPanel();
  } catch (err) {
    appAlert('GIF録画', '録画の初期化に失敗しました。'
           + '<div class="am-note">' + escHtml(err.message) + '</div>');
    exitGifMode();
  }
}
// render() から毎フレーム呼ばれる。fps に合わせて選択範囲を取り込む
function gifTick(now) {
  const g = gifRec;
  if (g.phase !== 'recording') return;
  const interval = 1000 / g.fps;
  const elapsed = now - g._lastCap;
  if (elapsed < interval) return;
  g._lastCap = now;
  const r = g.rect;
  g._tmpCtx.clearRect(0, 0, r.w, r.h);
  g._tmpCtx.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  g.gif.addFrame(g._tmpCtx, { copy:true, delay:Math.max(20, Math.round(elapsed)) });
  g.frameCount++;
  if (g._status) g._status.textContent = `● 録画中 ${((now - g._t0)/1000).toFixed(1)}s / ${g.frameCount}コマ`;
  if (g.frameCount >= g.maxFrames) gifStopRecording();
}
function gifStopRecording() {
  if (gifRec.phase !== 'recording') return;
  gifRec.phase = 'confirm';
  const p = gifRec._panel; p.innerHTML = '';
  const status = document.createElement('span'); status.className = 'gif-status';
  status.textContent = `${gifRec.frameCount}コマ録画しました`; p.appendChild(status);
  gifRec._status = status;
  const save = document.createElement('button'); save.textContent = '保存'; save.className = 'gif-btn green'; save.onclick = gifSave;
  const disc = document.createElement('button'); disc.textContent = '破棄'; disc.className = 'gif-btn gray'; disc.onclick = exitGifMode;
  p.appendChild(save); p.appendChild(disc);
}
function gifTimestamp() {
  const d = new Date(), p = n => String(n).padStart(2,'0');
  return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
}
async function gifSave() {
  const g = gifRec;
  if (g.frameCount === 0) {
    appAlert('GIFアニメを保存', 'コマが1枚もありません。'
           + '<div class="am-note">録画を開始してから、シミュレーションを再生してください。</div>');
    return;
  }
  const name = 'physbox_' + gifTimestamp() + '.gif';
  // ★保存先の選択はユーザー操作直後（このクリック内）に行う。エンコード後だと権限が切れるため。
  let handle = null;
  if (window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName:name, types:[{ description:'GIFアニメ', accept:{ 'image/gif':['.gif'] } }] });
    } catch (e) { if (e && e.name === 'AbortError') return; handle = null; }   // 非対応 → ダウンロードへ
  }
  g.phase = 'encoding'; gifBuildPanel();
  g.gif.on('progress', pr => { if (g._status) g._status.textContent = 'エンコード中… ' + Math.round(pr*100) + '%'; });
  g.gif.on('finished', async blob => {
    try {
      if (handle) { const w = await handle.createWritable(); await w.write(blob); await w.close(); }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    } catch (err) {
      appAlert('GIFアニメを保存', '保存に失敗しました。'
             + '<div class="am-note">' + escHtml(err.message) + '</div>');
    }
    exitGifMode();
  });
  g.gif.render();
}
function exitGifMode() {
  const g = gifRec;
  if (g._cdTimer) { clearInterval(g._cdTimer); g._cdTimer = null; }
  window.removeEventListener('mousemove', gifSelMouseMove);
  window.removeEventListener('mouseup', gifSelMouseUp);
  if (g._ov) g._ov.remove();
  if (g._panel) g._panel.remove();
  g.active = false; g.phase = 'idle'; g.rect = null; g.gif = null; g._drag = null;
  g._tmp = null; g._tmpCtx = null;
  g._ov = g._panel = g._sel = g._hint = g._cd = g._status = null;
}
// Esc で中止（録画中は停止して確認へ）。gifRec.active のときだけ作用する
window.addEventListener('keydown', e => {
  if (!gifRec.active || e.key !== 'Escape') return;
  if (gifRec.phase === 'recording') gifStopRecording();
  else exitGifMode();
});
