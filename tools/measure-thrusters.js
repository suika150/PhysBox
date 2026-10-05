#!/usr/bin/env node
// 1つの物体に何本も動力を付け、1本ずつ別のリモコンで操れるかを測る。
//   node tools/measure-thrusters.js
// 見るのは4つ：
//   ① 2本を別々のキーで操れる（左だけ噴けば右へ曲がる＝角速度が付く）
//   ② 両方押せば真っすぐ（回らない）
//   ③ 保存 → 読み込みで本数・値・リモコンの結びつきが残る
//   ④ 「戻る」（JSON の控え）を通しても落ちない
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'physBox.html')).href,
                  { waitUntil: 'load' });
  await page.waitForSelector('#main-canvas');

  const out = await page.evaluate(() => {
    const log = [];
    // 幅 200px の板の両端に、上向きの動力を1本ずつ。重力なし・地面なし。
    const build = () => {
      objects.length = 0; joints.length = 0; particles.length = 0;
      clearRemotes();
      world.gravX = 0; world.gravY = 0; world.terrain = false;   // ★重力なし（gravY を 0 に）
      const b = new Body({ type:'box', x:400, y:400, w:200, h:40, mass:2,
                           friction:0, frictionStatic:0, restitution:0 });
      objects.push(b);
      const L = new Thruster({ force:20, dir:-Math.PI/2, localX:-90, localY:0 }, b);
      const R = new Thruster({ force:20, dir:-Math.PI/2, localX: 90, localY:0 }, b);
      b.thrusters.push(L, R);
      return { b, L, R };
    };
    const run = (b, n) => { for (let t = 0; t < n; t++) simTick();
                            return { vy: b.vy, av: b.av }; };

    // ── ① 左だけ押す ──
    let { b, L, R } = build();
    const rL = addRemote('thruster', L, 'thruster'); rL.key = 'KeyA';
    const rR = addRemote('thruster', R, 'thruster'); rR.key = 'KeyD';
    log.push(['本数', b.thrusters.length, remotes.length]);
    rL._on = true;
    let s = run(b, 60);
    log.push(['左だけ 1.0s', s.vy, s.av]);
    // ── ② 両方押す（組み直して比べる）──
    ({ b, L, R } = build());
    const r1 = addRemote('thruster', L, 'thruster');
    const r2 = addRemote('thruster', R, 'thruster');
    r1._on = true; r2._on = true;
    s = run(b, 60);
    log.push(['両方 1.0s', s.vy, s.av]);
    // ── ③ 保存 → 読み込み ──
    ({ b, L, R } = build());
    const rr = addRemote('thruster', R, 'thruster'); rr.key = 'KeyD';
    const json = JSON.stringify({ objects: objects.map(o => o.toJSON()),
                                  remotes: remotes.map(serializeRemote) });
    const d = JSON.parse(json);
    objects.length = 0;
    for (const o of d.objects) objects.push(new Body(o));
    deserializeRemotes(d.remotes);
    const b2 = objects[0];
    log.push(['読み込み後の本数', b2.thrusters.length,
              b2.thrusters.map(t => t.force).join('/')]);
    log.push(['リモコンの相手', remotes[0].targets().length,
              remotes[0].targets()[0] === b2.thrusters[1] ? '右の動力（正しい）' : 'ちがう']);
    // ★リモコンの付いていない動力は「いつもどおり効く」ので、ここでは左も噴く。
    //   ＝両方押したときと同じ（真っすぐ上がって回らない）になるのが正しい。
    remotes[0]._on = true;
    s = run(b2, 60);
    log.push(['読み込み後 右を押す（左は無印＝常時）', s.vy, s.av]);
    // ── ④ 「戻る」の控え（JSON の往復）を通す ──
    const snap = JSON.parse(JSON.stringify(objects[0]));
    const b3 = new Body(snap);
    log.push(['控えから作り直し', b3.thrusters.length,
              b3.thrusters[0].id === objects[0].thrusters[0].id ? 'id も同じ' : 'id が変わった']);
    return log;
  });

  console.log('1つの物体に2本の動力（板の両端・どちらも上向き 20N）');
  for (const r of out) console.log('  ' + r.map(v => typeof v === 'number' ? v.toFixed(3) : v).join('  │  '));
  await browser.close();
  if (errors.length) { console.error('--- ページ内エラー ---'); errors.slice(0,5).forEach(e => console.error(e)); process.exit(1); }
})();
