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
 *        アクセスできるユーザー：（学校のドメイン）内の全員
 *      ★「自分として実行」にしないと、閲覧者が physbox_bundle.html を
 *        読む権限を持たず 404 になる。
 *      ★アクセスをドメイン内に絞るのは、シーンの共有（下）で作成者をアカウントから決めるため。
 *        共有を使わないなら「全員」でもよい（ログインを求めなくなる）。
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
    //   ★index.html と同じ値にそろえる（スマホでページごと拡大されると、指の操作が
    //     キャンバスに届く前にブラウザに取られる。js/input/touch.js）
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    // Google サイトや Classroom に埋め込まないなら、次の 1 行は削ってよい。
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/* ===========================================================================
 * シーンの共有（本体の js/app/share.js から google.script.run で呼ばれる）
 *
 * 置き場所：
 *   ・一覧   … 結合スクリプトのスプレッドシートの「デモ」シート（無ければ作る）
 *              A 作成者 / B 日時 / C タイトル / D 説明 / E サムネイル / F デモファイル / G 公開 / H メール
 *   ・公開    … ★G 列のチェックボックスを先生が入れた行だけが一覧に出て、開ける。
 *              共有した直後は未チェック（先生が中身を確かめてから公開する）。
 *   ・シーン … 作業フォルダ（physbox_bundle.html と同じフォルダ）の shared_scenes/ に .json で置く。
 *              ★シーンをセルに入れないのは、セルが 5 万字までのため。
 *                実測（2026-10）：デモ 260 件を保存形式にすると中央値 2 万字、
 *                5 万字超が 27 件（最大は「歯車の時計」31.6 万字）。
 *
 * 追加の準備：
 *   1. SPREADSHEET_ID に結合スクリプトのスプレッドシートの ID を入れる
 *      （URL の /d/ と /edit のあいだ）。
 *   2. デプロイの「アクセスできるユーザー」を「（学校のドメイン）内の全員」にする。
 *      ★「全員」のままだと、ログインしていない人・学外の人のメールが取れず、共有は断る。
 *        学外に URL が漏れても書き込めないようにするためにも、ドメイン内に絞る。
 *   3. 作成者の名前をディレクトリから引くなら、エディタ左の「サービス」から
 *      People API を追加する（無くても動く。そのときは下の順で決まる）。
 *   ・作成者の名前は次の順で決める（lookupName_）：
 *       「名簿」シート（A 列メール・B 列名前。任意）→ People API のディレクトリ → メールの @ より前
 *     ★生徒のアカウント名が学籍番号などの学校は「名簿」シートを作れば、そちらが優先される。
 *   ・先生の確認：「教員」シート（A 列にメール。任意）に載っている人と、この Web アプリをデプロイした人は、
 *     一覧に未公開のシーンも「未公開」の印つきで出て、開いて中身を確かめられる。公開は今までどおり G 列で入れる。
 *     ★シートのサムネイルは共有した瞬間の画面だけで、画面の外の注釈・お絵描きや ▶ のあとに出るものは写らない。
 *       中身を開かずに公開を決めないで済むようにするため。
 *   ・回数の制限：生徒は 1 時間に SHARE_RATE_MAX 件まで（先生は制限なし）。数えるのは「デモ」シートの B 列（日時）と
 *     H 列（メール）。★シーンは先生のドライブに溜まるので、ブラウザから shareSave を繰り返し呼ばれると
 *       未公開のままでも容量を使い切られる。メールはサーバ側で取るのでごまかせない。
 *   ・公開をやめるときは G 列のチェックを外す。消すときは「デモ」シートの行を消すだけでよい（一覧はシートから作る）。
 *     shared_scenes/ の .json は、bundle.gs の自動整理をオンにしておけばゴミ箱へ移る（syncSharedScenes）。
 *     オフのままなら一覧に出ないだけで残るので、メニューの「共有シーンを今すぐ整理」か手で消す。
 *     ★SHARE_SHEET・COL_FILE・SHARE_FOLDER・fileIdOf_ を変えるときは bundle.gs 側もそろえる。
 * =========================================================================== */

const SPREADSHEET_ID = ''; // ← 結合スクリプトのスプレッドシートの ID を貼る
const SHARE_SHEET    = 'デモ';
const ROSTER_SHEET   = '名簿';
const TEACHER_SHEET  = '教員';          // A 列に先生のメール（任意。デプロイした人は載せなくても先生扱い）
const SHARE_FOLDER   = 'shared_scenes'; // ★bundle.gs の走査からも外している（名前をそろえること）
const SHARE_HEADER   = ['作成者', '日時', 'タイトル', '説明', 'サムネイル', 'デモファイル', '公開', 'メール'];
const COL_TIME = 2, COL_FILE = 6, COL_PUBLIC = 7, COL_EMAIL = 8;   // B・F・G・H 列（1 始まり）

// ★上限は js/app/share.js とそろえる。サーバ側でも必ず切る（ページ側の制限は書き換えられる）
const SHARE_TITLE_MAX = 60;
const SHARE_DESC_MAX  = 500;
const SHARE_THUMB_MAX = 45000;   // ★セルは 5 万字まで。240×150 の JPEG(0.7) は実測 1.1 万字（遊星歯車）
const SHARE_SCENE_MAX = 5000000; // 5MB。上の実測の最大の 15 倍
const SHARE_RATE_MAX    = 5;              // 1 人が SHARE_RATE_WINDOW のあいだに共有できる件数（生徒だけ）
const SHARE_RATE_WINDOW = 60 * 60 * 1000; // 1 時間 [ms]


/** ログイン中の人（共有の窓に作成者・投稿のきまり・残りの件数を出す） */
function shareWhoAmI() {
  const email = currentEmail_();
  const teacher = isTeacher_(email);
  const me = { name: lookupName_(email), teacher, rateMax: SHARE_RATE_MAX, rateWindowMin: SHARE_RATE_WINDOW / 60000 };
  if (!teacher) {
    const r = rateInfo_(shareSheet_(), email);
    me.rateLeft = Math.max(0, SHARE_RATE_MAX - r.used);
    me.rateWaitMin = r.waitMin;
  }
  return me;
}


/** 一覧（新しい順）。公開（G 列）にチェックの入った行だけ。先生には未公開の行も pending: true を付けて出す。
 *  シーン本体は含めない（開くときに shareLoad で取る） */
function shareList() {
  const teacher = isTeacher_(Session.getActiveUser().getEmail());
  const sh = shareSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rows = sh.getRange(2, 1, n, COL_PUBLIC).getValues();
  const tz = Session.getScriptTimeZone();
  const out = [];
  for (const r of rows) {
    // ★未確認・非公開は生徒には出さない。チェックボックスの値は真偽値（文字の "TRUE" は数えない）
    const pending = r[COL_PUBLIC - 1] !== true;
    if (pending && !teacher) continue;
    const id = fileIdOf_(r[COL_FILE - 1]);
    if (!id) continue;   // 先生が手で消しかけた行・空行は出さない
    out.push({
      id,
      author: String(r[0]),
      time: r[1] instanceof Date ? Utilities.formatDate(r[1], tz, 'yyyy/MM/dd HH:mm') : String(r[1]),
      title: String(r[2]),
      desc: String(r[3]),
      thumb: String(r[4]),
      pending,
    });
  }
  return out.reverse();
}


/** シーン本体（JSON の文字列）を返す */
function shareLoad(fileId) {
  const id = String(fileId || '');
  // ★「自分として実行」なので、任意の ID を受け付けると先生のドライブの何でも読めてしまう。
  //   一覧（デモ シート）に載っていて、公開にチェックの入った ID だけを開く（先生は未公開も開ける）。
  const teacher = isTeacher_(Session.getActiveUser().getEmail());
  const sh = shareSheet_();
  const n = sh.getLastRow() - 1;
  const listed = n > 0 && sh.getRange(2, COL_FILE, n, 2).getValues()
    .some(r => (r[1] === true || teacher) && fileIdOf_(r[0]) === id);
  if (!listed) throw new Error('このシーンは公開が取りやめられたか、一覧から消されています。一覧を開き直してください。');
  return DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
}


/** 共有する。作成者・メール・日時はサーバ側で決める（ページから送られた値は使わない） */
function shareSave(p) {
  const email = currentEmail_();
  const title = String(p && p.title || '').trim().slice(0, SHARE_TITLE_MAX);
  const desc  = String(p && p.desc  || '').trim().slice(0, SHARE_DESC_MAX);
  let thumb   = String(p && p.thumb || '');
  const scene = String(p && p.scene || '');
  if (!title) throw new Error('タイトルを入れてください。');
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(thumb) || thumb.length > SHARE_THUMB_MAX) thumb = '';
  if (scene.length > SHARE_SCENE_MAX) throw new Error('シーンが大きすぎます（' + (scene.length / 1e6).toFixed(1) + 'MB）。');
  let data;
  try { data = JSON.parse(scene); } catch (e) { data = null; }
  if (!data || !Array.isArray(data.objects)) throw new Error('シーンの形式が正しくありません。');

  const name = lookupName_(email);
  const teacher = isTeacher_(email);

  // ★数えてからファイルを作って行を足すまでを 1 つの鍵の中でやる。鍵の外で数えると、
  //   同時に何回も呼ばれたとき全部が「まだ 0 件」と数えて通ってしまう。
  //   （シートを作る瞬間が重なって「デモ」シートが 2 枚できるのも、この鍵で防いでいる）
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = shareSheet_();
    if (!teacher) {
      const r = rateInfo_(sh, email);
      if (r.used >= SHARE_RATE_MAX)
        throw new Error('共有できるのは ' + (SHARE_RATE_WINDOW / 60000) + ' 分間に ' + SHARE_RATE_MAX +
                        ' 件までです。あと ' + r.waitMin + ' 分ほどで、また共有できます。');
    }
    const now = new Date();
    const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    const file = shareFolder_().createFile(Utilities.newBlob(
      scene, 'application/json', stamp + '_' + title.replace(/[\\\/:*?"<>|]/g, '_') + '.json'));
    sh.appendRow([cellText_(name), now, cellText_(title), cellText_(desc),
                  thumb, file.getUrl(), false, email]);
    sh.getRange(sh.getLastRow(), COL_PUBLIC).insertCheckboxes();   // 未チェック＝先生の確認待ち
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}


/* --- 以下、下請け ------------------------------------------------------- */

function currentEmail_() {
  // ★「自分として実行」でも、同じドメインの人が開いたときはその人のメールが取れる。
  //   空になるのは、ドメイン外・未ログインの人が開いたとき（アクセスを「全員」にしている場合）。
  const email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('学校のアカウントでログインしてから開いてください。');
  return email;
}

/** 先生か（「教員」シートの A 列に載っている／この Web アプリをデプロイした本人） */
function isTeacher_(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (e === String(Session.getEffectiveUser().getEmail()).toLowerCase()) return true;
  const sh = shareBook_().getSheetByName(TEACHER_SHEET);
  if (!sh || sh.getLastRow() < 1) return false;
  return sh.getRange(1, 1, sh.getLastRow(), 1).getValues()
    .some(r => String(r[0]).trim().toLowerCase() === e);
}

/** この人が直近 SHARE_RATE_WINDOW に共有した件数と、次に 1 件空くまでの分。
 *  ★先生が行を消せば数からも外れる（消した投稿は数えない＝シートが正）。 */
function rateInfo_(sh, email) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return { used: 0, waitMin: 0 };
  const times  = sh.getRange(2, COL_TIME,  n, 1).getValues();
  const emails = sh.getRange(2, COL_EMAIL, n, 1).getValues();
  const now = Date.now(), e = email.toLowerCase();
  const recent = [];
  for (let i = 0; i < n; i++) {
    const t = times[i][0];
    if (!(t instanceof Date) || String(emails[i][0]).trim().toLowerCase() !== e) continue;
    if (now - t.getTime() < SHARE_RATE_WINDOW) recent.push(t.getTime());
  }
  recent.sort((a, b) => a - b);
  // いちばん古い 1 件が窓から出る時刻まで（上限に達しているときだけ意味がある）
  const waitMin = recent.length >= SHARE_RATE_MAX
    ? Math.ceil((recent[recent.length - SHARE_RATE_MAX] + SHARE_RATE_WINDOW - now) / 60000) : 0;
  return { used: recent.length, waitMin };
}

function shareBook_() {
  if (!SPREADSHEET_ID) throw new Error('webapp.gs の SPREADSHEET_ID が未設定です。先生に伝えてください。');
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/** 「デモ」シート。無ければ見出し付きで作る */
function shareSheet_() {
  const ss = shareBook_();
  let sh = ss.getSheetByName(SHARE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHARE_SHEET);
    sh.getRange(1, 1, 1, SHARE_HEADER.length).setValues([SHARE_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(5, 120);   // サムネイル（data URI の長い文字）で表が横に伸びないように
  }
  return sh;
}

/** 作業フォルダ（結合した HTML と同じフォルダ）の shared_scenes/。無ければ作る */
function shareFolder_() {
  if (!BUNDLE_FILE_ID) throw new Error('webapp.gs の BUNDLE_FILE_ID が未設定です。');
  const parents = DriveApp.getFileById(BUNDLE_FILE_ID).getParents();
  if (!parents.hasNext()) throw new Error('結合した HTML のフォルダが見つかりません。');
  const root = parents.next();
  const it = root.getFoldersByName(SHARE_FOLDER);
  return it.hasNext() ? it.next() : root.createFolder(SHARE_FOLDER);
}

/** F 列（ドライブの URL。先生が ID だけ書いても読めるように）からファイル ID を取り出す */
function fileIdOf_(v) {
  const s = String(v || '').trim();
  const m = s.match(/\/d\/([-\w]{15,})/) || s.match(/[?&]id=([-\w]{15,})/);
  if (m) return m[1];
  return /^[-\w]{15,}$/.test(s) ? s : '';
}

/** ★= + - @ で始まる文字はシートが数式として解釈するので、先頭に ' を付けて文字のまま入れる */
function cellText_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** メール → 表示する名前（名簿シート → ディレクトリ → @ より前）。6 時間覚えておく */
function lookupName_(email) {
  const cache = CacheService.getScriptCache();
  const key = 'name:' + email.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  let name = '';
  const roster = shareBook_().getSheetByName(ROSTER_SHEET);
  if (roster && roster.getLastRow() > 0) {
    const rows = roster.getRange(1, 1, roster.getLastRow(), 2).getValues();
    const row = rows.find(r => String(r[0]).trim().toLowerCase() === email.toLowerCase());
    if (row) name = String(row[1]).trim();
  }
  if (!name && typeof People !== 'undefined') {
    try {
      const res = People.People.searchDirectoryPeople({
        query: email, readMask: 'names',
        sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
      });
      const p = res.people && res.people[0];
      if (p && p.names && p.names[0]) name = p.names[0].displayName || '';
    } catch (e) {
      // ★ディレクトリの共有が切られている学校では失敗する。名前はメールで代用して投稿は通す
      Logger.log('People API: ' + e);
    }
  }
  if (!name) name = email.split('@')[0];
  cache.put(key, name, 21600);
  return name;
}
