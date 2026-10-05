/* ===========================================================================
 * PhysBox 結合スクリプト（Google Apps Script）
 *
 * 使い方：
 *   1. Google ドライブに作業フォルダ（physBox.html / js / lib / css を含む）を
 *      フォルダごとアップロードする。
 *   2. スプレッドシートを作り、そのフォルダの URL を A3 に貼る。
 *   3. スプレッドシートの「拡張機能 → Apps Script」にこのファイルを貼り、保存。
 *   4. スプレッドシートを開き直すと「PhysBox」メニューが出る。
 *      「結合して HTML を作成」で physbox_bundle.html がフォルダ直下にできる。
 *   5. できたファイルの ID が A5 に、結合日時が A6 に書かれる。
 *      A5 の ID を webapp.gs の BUNDLE_FILE_ID に貼れば Web アプリで配信できる。
 *
 * 実測（2026-08 時点）：js/ 87 ファイル 2.73MB、lib/ 5 ファイル 258KB、
 * physBox.html 144KB、css 39.9KB。結合後は約 3.1MB。外部 URL 参照は 0 件なので、
 * 結合した時点で完全に自己完結した 1 枚の HTML になる。
 * =========================================================================== */

const ENTRY_NAME  = 'physBox.html';        // 結合の起点
const OUTPUT_NAME = 'physbox_bundle.html'; // 出力名（★毎回この名前を上書きする。下記参照）
const URL_CELL    = 'A3';                  // フォルダ URL
const ID_CELL     = 'A5';                  // 出力ファイル ID（自動で書き込む）
const TIME_CELL   = 'A6';                  // 最終結合日時（自動で書き込む）

const MAX_DEPTH = 8; // フォルダ再帰の打ち切り。ドライブのショートカット等で循環しても止まるように


/** スプレッドシートを開いたときにメニューを足す */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PhysBox')
    .addItem('結合して HTML を作成', 'buildBundle')
    .addToUi();
}


/** 本体。A3 のフォルダを読んで 1 枚の HTML にまとめ、同じフォルダに書き出す */
function buildBundle() {
  const t0 = Date.now();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

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

  // ── 2. physBox.html の記述順のまま、その場で中身に差し替える ──
  // ★読み込み順に意味がある（js/core/units.js が先頭、js/app/boot.js が末尾）。
  //   順序表をこちらで持たず、physBox.html の並びをそのまま使うことで、
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
      'physBox.html が参照しているファイルがドライブ上にありません：\n  ' +
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


/* --- 以下、下請け ------------------------------------------------------- */

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
