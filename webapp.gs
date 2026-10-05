/* ===========================================================================
 * PhysBox Web アプリ配信（Google Apps Script）
 *
 * ★これは bundle.gs とは別のプロジェクトに置く。
 *   bundle.gs はスプレッドシートに紐づくコンテナバインド、こちらはスタンドアロン。
 *   分けておくと、結合をやり直しても Web アプリのデプロイ URL が変わらない。
 *
 * 使い方：
 *   1. script.google.com で新しいプロジェクトを作り、このファイルを貼る。
 *   2. BUNDLE_FILE_ID に、結合スクリプトが A5 に書き出したファイル ID を入れる。
 *   3. 「デプロイ → 新しいデプロイ → ウェブアプリ」
 *        次のユーザーとして実行：自分
 *        アクセスできるユーザー：全員
 *      ★「自分として実行」にしないと、閲覧者が physbox_bundle.html を
 *        読む権限を持たず 404 になる。閲覧者に Google ログインも要求しない。
 *   4. 発行された URL を開く。
 *
 * 更新のしかた：結合スクリプトを再実行するだけ。出力は同じファイル ID を
 * 上書きするので、こちらは再デプロイ不要。
 * =========================================================================== */

const BUNDLE_FILE_ID = ''; // ← 結合スクリプトが A5 に書き出した ID を貼る


function doGet() {
  if (!BUNDLE_FILE_ID) {
    return HtmlService.createHtmlOutput(
      '<p>BUNDLE_FILE_ID が未設定です。結合スクリプトを実行し、' +
      'スプレッドシートの A5 に出た ID を webapp.gs に貼ってください。</p>');
  }

  const html = DriveApp.getFileById(BUNDLE_FILE_ID).getBlob().getDataAsString('UTF-8');

  return HtmlService.createHtmlOutput(html)
    .setTitle('PhysBox')
    // ★viewport は結合後の HTML の <head> にも入っているが、HtmlService は
    //   出力を自前の枠で包み直すため、外側にはこの API でしか渡せない。
    //   ★physBox.html と同じ値にそろえる（スマホでページごと拡大されると、指の操作が
    //     キャンバスに届く前にブラウザに取られる。js/input/touch.js）
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    // Google サイトや Classroom に埋め込まないなら、次の 1 行は削ってよい。
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
