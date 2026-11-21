/* ===========================================================================
 * PhysBox 結合スクリプト（Google Apps Script）
 *
 * 使い方：
 *   1. Google ドライブに作業フォルダ（index.html / js / lib / css を含む）を
 *      フォルダごとアップロードする。
 *   2. スプレッドシートを作り、そのフォルダの URL を A3 に貼る。
 *   3. スプレッドシートの「拡張機能 → Apps Script」にこのファイルを貼り、保存。
 *   4. スプレッドシートを開き直すと「PhysBox」メニューが出る。
 *      「結合して HTML を作成」で physbox_bundle.html がフォルダ直下にできる。
 *   5. できたファイルの ID が A5 に、結合日時が A6 に書かれる。
 *      A5 の ID を webapp.gs の BUNDLE_FILE_ID に貼れば Web アプリで配信できる。
 *   6. （共有を使うなら）「PhysBox → 共有シーンの自動整理をオンにする」を 1 回だけ実行する。
 *      「デモ」シートの行を消すと、shared_scenes/ のその .json もゴミ箱へ移る（下の syncSharedScenes）。
 *
 * 実測（2026-08 時点）：js/ 87 ファイル 2.73MB、lib/ 5 ファイル 258KB、
 * index.html 144KB、css 39.9KB。結合後は約 3.1MB。外部 URL 参照は 0 件なので、
 * 結合した時点で完全に自己完結した 1 枚の HTML になる。
 * =========================================================================== */

const ENTRY_NAME  = 'index.html';        // 結合の起点
const OUTPUT_NAME = 'physbox_bundle.html'; // 出力名（★毎回この名前を上書きする。下記参照）
const URL_CELL    = 'A3';                  // フォルダ URL
const ID_CELL     = 'A5';                  // 出力ファイル ID（自動で書き込む）
const TIME_CELL   = 'A6';                  // 最終結合日時（自動で書き込む）

const SKIP_FOLDERS = ['shared_scenes']; // ★webapp.gs の共有シーンの置き場。中身は結合に要らず、増えるほど走査が遅くなる
const OWN_SHEETS = ['デモ', '名簿', '教員']; // ★webapp.gs が使うシート。ここでは設定（A3 など）を読まない

const MAX_DEPTH = 8; // フォルダ再帰の打ち切り。ドライブのショートカット等で循環しても止まるように


/** スプレッドシートを開いたときにメニューを足す */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PhysBox')
    .addItem('結合して HTML を作成', 'buildBundle')
    .addSeparator()
    .addItem('共有シーンを今すぐ整理', 'syncSharedScenesNow')
    .addItem('共有シーンの自動整理をオンにする', 'installShareSync')
    .addItem('共有シーンの自動整理をオフにする', 'uninstallShareSync')
    .addToUi();
}


/** 本体。A3 のフォルダを読んで 1 枚の HTML にまとめ、同じフォルダに書き出す */
function buildBundle() {
  const t0 = Date.now();
  const sheet = settingsSheet_();

  const root = DriveApp.getFolderById(extractFolderId_(String(sheet.getRange(URL_CELL).getValue())));

  // ── 1. フォルダを再帰的に走査し「相対パス → File」の索引を作る ──
  // ★ファイル名ではなくパスで引く。body.js / field.js / gas.js / joint.js / clipper.js は
  //   別ディレクトリに同名で存在するので、DriveApp.getFilesByName() だと別物を掴む。
  const index = {};
  const dups  = [];
  indexFolder_(root, '', index, dups, 0);

  if (dups.length) {
    throw new Error(
      'ドライブ上に同じパスのファイルが重複しています。アップロードし直してください：\n  ' +
      dups.join('\n  '));
  }

  const entry = index[ENTRY_NAME];
  if (!entry) {
    throw new Error(
      ENTRY_NAME + ' がフォルダ直下に見つかりません。' +
      'A3 のURLが作業フォルダそのものを指しているか確認してください。');
  }

  // ── 2. index.html の記述順のまま、その場で中身に差し替える ──
  // ★読み込み順に意味がある（js/core/units.js が先頭、js/app/boot.js が末尾）。
  //   順序表をこちらで持たず、index.html の並びをそのまま使うことで、
  //   本体に script タグを足すだけで結合側は何も直さなくてよくなる。
  let html = readText_(entry);
  const missing = [];
  let cssCount = 0, jsCount = 0;

  html = html.replace(
    /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref="([^"]+)"[^>]*>/gi,
    function (tag, href) {
      const text = pick_(index, href, missing);
      if (text === null) return tag;
      cssCount++;
      return '<style>\n' + text + '\n</style>';
    });

  html = html.replace(
    /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi,
    function (tag, src) {
      const text = pick_(index, src, missing);
      if (text === null) return tag;
      jsCount++;
      return '<script>\n' + text + '\n</script>';
    });
  // ★置換に文字列ではなく関数を渡している。3.1MB の JS には `$` が多数含まれ
  //   （テンプレートリテラルの `${}` など）、文字列で渡すと `$&` や `$1` が
  //   置換指示として解釈されてソースが静かに壊れる。関数の戻り値は常にそのまま入る。

  if (missing.length) {
    throw new Error(
      'index.html が参照しているファイルがドライブ上にありません：\n  ' +
      missing.join('\n  '));
  }

  // ── 3. 書き出し ──
  // ★同名ファイルがあれば中身だけ差し替える。新規作成し直すとファイル ID が変わり、
  //   webapp.gs の BUNDLE_FILE_ID を毎回貼り直すことになるため。
  const out = putText_(root, OUTPUT_NAME, html);

  sheet.getRange(ID_CELL).setValue(out.getId());
  sheet.getRange(TIME_CELL).setValue(new Date());

  // ★サイズは html.length ではなく書き出したファイルの実バイト数で報告する。
  //   html.length は UTF-16 の文字数で、日本語コメントが多いぶんバイト数と大きくずれる
  //   （実測：223 万字に対して約 3.1MB）。ドライブ上の表示と一致するほうが確認しやすい。
  const msg = 'CSS ' + cssCount + ' 件 / JS ' + jsCount + ' 件を結合しました（' +
              (out.getSize() / 1048576).toFixed(2) + ' MB, ' +
              ((Date.now() - t0) / 1000).toFixed(1) + ' 秒）';
  Logger.log(msg + '\nID: ' + out.getId() + '\n' + out.getUrl());
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'PhysBox', 10);
}


/* ===========================================================================
 * 共有シーンの整理（webapp.gs の「デモ」シートと shared_scenes/ をそろえる）
 *
 * 「デモ」シートの F 列に載っていない .json をゴミ箱へ移し、載っているのにゴミ箱にあるものは戻す。
 *   ★「行が消えたら、その行のファイルを消す」にしないのは、onChange が消えた行の中身を教えないため
 *     （REMOVE_ROW と分かるだけ）。シートを正として、毎回まるごと突き合わせる。
 *   ★削除ではなくゴミ箱（30 日は戻せる）。行を消してから元に戻す（Ctrl+Z）と行が復活するので、
 *     次の整理でファイルもゴミ箱から戻る。F 列を書き直しかけて一瞬ずれた場合も同じ。
 *   ★「デモ」シートが見つからないとき（名前を変えた・シートごと消した）は何もしない。
 *     そこで全部を「載っていない」と数えると、全シーンがゴミ箱へ行く。
 *   ★作られて SHARE_SYNC_GRACE 以内のファイルは触らない。webapp.gs の shareSave はファイルを作ってから
 *     行を足すので、その間に整理が走ると投稿直後のファイルを消してしまう（鍵は別プロジェクトなので共有できない）。
 * =========================================================================== */

const SHARE_SHEET_NAME   = 'デモ';            // ★webapp.gs の SHARE_SHEET とそろえる
const SHARE_FILE_COL     = 6;                 // ★webapp.gs の COL_FILE（F 列）とそろえる
const SHARE_SYNC_GRACE   = 10 * 60 * 1000;    // 10 分 [ms]
const SHARE_SYNC_HANDLER = 'onShareSheetChange';

/** onChange のトリガーから呼ばれる。★書式だけの変更では走らせない */
function onShareSheetChange(e) {
  if (e && e.changeType === 'FORMAT') return;
  try { syncSharedScenes(); }
  catch (err) { Logger.log('共有シーンの整理: ' + err); }   // トリガーの失敗は画面に出せないので記録だけ
}

/** メニューから：今すぐ整理して結果を出す */
function syncSharedScenesNow() {
  const r = syncSharedScenes();
  SpreadsheetApp.getUi().alert(r.skipped
    ? '整理しませんでした：' + r.skipped
    : 'ゴミ箱へ移した：' + r.trashed + ' 件／ゴミ箱から戻した：' + r.restored + ' 件' +
      (r.young ? '\n（作られて 10 分以内の ' + r.young + ' 件は、投稿の途中かもしれないので残しました）' : ''));
}

/** 本体。{ trashed, restored, young } か、整理しなかった理由を skipped に入れて返す */
function syncSharedScenes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHARE_SHEET_NAME);
  if (!sh) return { skipped: '「' + SHARE_SHEET_NAME + '」シートがありません' };
  const folder = sharedFolder_(ss);
  if (!folder) return { skipped: 'shared_scenes フォルダが見つかりません' };

  // ★続けて何回も変更すると onChange も続けて来る。重ねて走らせず、後のほうは待たずに抜ける
  //   （取りこぼした分は次の変更か「今すぐ整理」で拾われる）
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: '別の整理が走っています' };
  try {
    const listed = {};
    const n = sh.getLastRow() - 1;
    if (n > 0) sh.getRange(2, SHARE_FILE_COL, n, 1).getValues().forEach(r => {
      const id = shareFileIdOf_(r[0]);
      if (id) listed[id] = true;
    });

    const now = Date.now();
    let trashed = 0, restored = 0, young = 0;
    const live = folder.searchFiles('trashed = false');
    while (live.hasNext()) {
      const f = live.next();
      if (listed[f.getId()]) continue;
      if (now - f.getDateCreated().getTime() < SHARE_SYNC_GRACE) { young++; continue; }
      f.setTrashed(true);
      trashed++;
    }
    const gone = folder.searchFiles('trashed = true');
    while (gone.hasNext()) {
      const f = gone.next();
      if (!listed[f.getId()]) continue;
      f.setTrashed(false);
      restored++;
    }
    return { trashed, restored, young };
  } finally {
    lock.releaseLock();
  }
}

/** onChange のトリガーを付ける（★1 つだけ。2 つ付くと同じ整理が 2 回ずつ走るので、あれば付けない） */
function installShareSync() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === SHARE_SYNC_HANDLER);
  if (!has) ScriptApp.newTrigger(SHARE_SYNC_HANDLER).forSpreadsheet(ss).onChange().create();
  const r = syncSharedScenes();
  SpreadsheetApp.getUi().alert((has ? '自動整理はすでにオンです。' : '自動整理をオンにしました。') +
    '\n「' + SHARE_SHEET_NAME + '」シートの行を消すと、そのシーンのファイルもゴミ箱へ移ります（30 日は戻せます）。' +
    (r.skipped ? '\n（いまの整理は行いませんでした：' + r.skipped + '）'
               : '\nいまの整理：ゴミ箱へ ' + r.trashed + ' 件／戻した ' + r.restored + ' 件'));
}

function uninstallShareSync() {
  let k = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === SHARE_SYNC_HANDLER) { ScriptApp.deleteTrigger(t); k++; }
  });
  SpreadsheetApp.getUi().alert(k ? '自動整理をオフにしました。' : '自動整理はもともとオフです。');
}


/* --- 以下、下請け ------------------------------------------------------- */

/** 設定（A3 のフォルダ URL など）を読み書きするシート。
 *  ★開いているシートを使うが、webapp.gs が作る「デモ」「名簿」「教員」を開いたまま結合すると
 *    そこの A3（投稿の中身）をフォルダ URL と読んでしまうので、そのときは最初の別のシートにする */
function settingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getActiveSheet();
  if (OWN_SHEETS.indexOf(active.getName()) < 0) return active;
  const other = ss.getSheets().filter(s => OWN_SHEETS.indexOf(s.getName()) < 0)[0];
  if (!other) throw new Error('設定用のシート（A3 にフォルダ URL）が見つかりません。');
  return other;
}


/** フォルダ URL（または ID 直書き）からフォルダ ID を取り出す */
function extractFolderId_(url) {
  const s = (url || '').trim();
  if (!s) throw new Error(URL_CELL + ' が空です。ドライブのフォルダ URL を入れてください。');

  const m = s.match(/\/folders\/([-\w]+)/);
  if (m) return m[1];
  if (/^[-\w]{15,}$/.test(s)) return s; // ID をそのまま貼った場合

  throw new Error(URL_CELL + ' がフォルダ URL に見えません：' + s);
}


/** フォルダを再帰的に走査して「相対パス → File」の索引を作る */
function indexFolder_(folder, prefix, index, dups, depth) {
  if (depth > MAX_DEPTH) return;

  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const path = prefix + f.getName();
    if (path === OUTPUT_NAME) continue; // 自分の出力は取り込まない
    if (index[path]) dups.push(path);   // ドライブは同一フォルダ内の同名を許すので検出する
    index[path] = f;
  }

  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const s = subs.next();
    if (depth === 0 && SKIP_FOLDERS.indexOf(s.getName()) >= 0) continue;
    indexFolder_(s, prefix + s.getName() + '/', index, dups, depth + 1);
  }
}


/** 索引から相対パスで引いて中身を返す。無ければ missing に積んで null */
function pick_(index, path, missing) {
  const key = path.replace(/^\.\//, '');
  if (/^(https?:)?\/\//i.test(key)) return null; // 外部 URL はそのまま残す（現状 0 件）

  const f = index[key];
  if (!f) { missing.push(key); return null; }
  return readText_(f);
}


/** テキストとして読む。★日本語コメントが大量にあるので UTF-8 を明示する */
function readText_(file) {
  return file.getBlob().getDataAsString('UTF-8');
}


/** 同名があれば上書き、無ければ新規作成。いずれも File を返す */
function putText_(folder, name, text) {
  const it = folder.getFilesByName(name);
  if (it.hasNext()) {
    const f = it.next();
    f.setContent(text);
    return f;
  }
  return folder.createFile(Utilities.newBlob(text, 'text/html', name));
}


/** 共有シーンの置き場（A3 のフォルダ直下の shared_scenes/）。無ければ null（★ここでは作らない）
 *  ★トリガーから呼ばれると「開いているシート」が決まらないので、settingsSheet_ ではなく
 *    webapp.gs のシート以外で最初のシートの A3 を読む */
function sharedFolder_(ss) {
  const conf = ss.getSheets().filter(s => OWN_SHEETS.indexOf(s.getName()) < 0)[0];
  if (!conf) return null;
  let root;
  try { root = DriveApp.getFolderById(extractFolderId_(String(conf.getRange(URL_CELL).getValue()))); }
  catch (e) { return null; }
  const it = root.getFoldersByName(SKIP_FOLDERS[0]);
  return it.hasNext() ? it.next() : null;
}

/** F 列（ドライブの URL か ID）からファイル ID。★webapp.gs の fileIdOf_ と同じ（別プロジェクトなので写してある） */
function shareFileIdOf_(v) {
  const s = String(v || '').trim();
  const m = s.match(/\/d\/([-\w]{15,})/) || s.match(/[?&]id=([-\w]{15,})/);
  if (m) return m[1];
  return /^[-\w]{15,}$/.test(s) ? s : '';
}
