/* トップページ：プロフィール・無駄コーナーの箱・グルーヴ機・演出・セーブ */
const { openPage, readJSON } = require('./helpers/page');

const profile = readJSON('data/profile.json');
const apps = readJSON('data/apps.json');
const { sounds, presets, maxOn } = readJSON('data/unlocks.json');
const count = bpm => sounds.filter(s => s.bpm === bpm).length;
const ALL = sounds.map(s => s.id);
const OPEN = { stats: { top: { boxOpen: 1 } } };
let page;
afterEach(() => page && page.close());

const active = p => { const c = p.audio.contexts[0]; return c ? [...c.active] : []; };
const durations = p => [...new Set(active(p).map(s => s.buffer.duration.toFixed(3)))];
const audible = p => active(p).filter(s => s.dest && s.dest.gain && s.dest.gain.value > 0);
const selected = p => p.$$('.trk.on').map(b => b.dataset.id);
const tab = (p, bpm) => p.$$('.tempo').find(b => b.querySelector('b').textContent === String(bpm));
async function playing(p) { for (let i = 0; i < 20 && !active(p).length; i++) await p.wait(10); }

describe('profile (the serious part)', () => {
  test('renders name, role, summary, links and every career entry in English by default', async () => {
    page = await openPage('/');
    expect(page.document.title).toBe('Yusuke Iwasaki');
    expect(page.text('#pname')).toBe(profile.name);
    expect(page.text('#psummary')).toBe(profile.summary.en);
    expect(page.$$('#pcareer li').length).toBe(profile.career.length);
    expect(page.$$('#pcareer .what').map(e => e.textContent)).toEqual(profile.career.map(c => c.what.en));
    expect(page.$$('#plinks a').map(a => a.textContent)).not.toContain('Wantedly');
  });
  test('switches to Japanese in place; Wantedly appears only in Japanese', async () => {
    page = await openPage('/');
    page.$('.fz-lang').click();
    expect(page.text('#psummary')).toBe(profile.summary.ja);
    expect(page.$$('#pcareer .detail').map(e => e.textContent)).toEqual(profile.career.map(c => c.detail.ja));
    expect(page.$$('#plinks a').map(a => a.textContent)).toContain('Wantedly');
    expect(page.document.title).toBe('Yusuke Iwasaki');
  });
});

describe('copy', () => {
  test('Japanese copy and line breaks', async () => {
    page = await openPage('/', { lang: 'ja', save: OPEN });
    expect(page.$('.il4').innerHTML).toBe('ご来訪のお礼に、<br>無駄の詰め合わせをどうぞ。');
    expect(page.$('.tag').innerHTML).toBe('遊ぶと音源がたまって、だんだんグルーヴになる。');
    expect(page.text('footer')).toBe('© 2026 Yusuke Iwasaki');
  });
  test('the invitation warns that sound will play', async () => {
    page = await openPage('/', { lang: 'ja' });
    const note = page.$('.interlude .sound-note');
    expect(note.textContent).toBe('※音がなります');
    expect(note.previousElementSibling.classList.contains('il4')).toBe(true);   // 「無駄の詰め合わせをどうぞ。」のすぐ下
    page.$('.fz-lang').click();
    expect(note.textContent).toBe('※ This plays sound');
  });
  test('the corner is called 無駄コーナー and quietly says why it exists', async () => {
    page = await openPage('/', { lang: 'ja', save: OPEN });
    expect(page.text('h1.boxname')).toBe('無駄コーナー');
    expect(page.text('.intent')).toBe('人は、無駄なことができるくらいの余裕があると幸せだと思うので、作っています。');
    page.$('.fz-lang').click();
    expect(page.text('h1.boxname')).toBe('The Useless Corner');
    expect(page.text('.intent')).toBe('I made this because I think people are happiest when they have room for useless things.');
  });
});

describe('the gift box', () => {
  test('starts closed, opens on tap, closes again and remembers', async () => {
    page = await openPage('/', { lang: 'ja' });
    expect(page.$('#gift').hidden).toBe(true);
    expect(page.text('#gifthint')).toBe('タップして受け取る（返品不可）');
    page.$('#giftbox').click();
    expect(page.$('#gift').hidden).toBe(false);
    expect(page.text('#gifthint')).toBe('おめでとうございます。無駄の詰め合わせです。もう一度タップで閉じます。');
    expect(page.FZ.stat('top', 'boxOpen')).toBe(1);
    expect(page.FZ.stat('top', 'gifts')).toBe(1);
    page.$('#giftbox').click();
    await page.wait(400);
    expect(page.$('#gift').hidden).toBe(true);
    expect(page.text('#gifthint')).toBe('無駄の詰め合わせは丁寧に保管されています。');
    expect(page.FZ.stat('top', 'boxOpen')).toBe(2);
  });
  test('stays open on the next visit', async () => {
    page = await openPage('/', { save: OPEN });
    expect(page.$('#gift').hidden).toBe(false);
  });
  test('lists every app with a link to its page', async () => {
    page = await openPage('/', { save: OPEN });
    expect(page.$$('#apps a').map(a => a.getAttribute('href'))).toEqual(apps.map(a => '/apps/' + a.id + '/'));
  });
  test('closing the box while music plays stops the music', async () => {
    page = await openPage('/', { save: Object.assign({ unlocked: ALL }, OPEN) });
    page.$('#play').click();
    await playing(page);
    page.$('#giftbox').click();
    expect(active(page).length).toBe(0);
  });
});

describe('coming back from a game', () => {
  test('jumps to the corner heading when the box is open', async () => {
    page = await openPage('/', { save: OPEN, session: { 'fz-from-app': '1' } });
    expect(page.scrolls).toContain(page.$('h1.boxname'));
  });
  test('does not jump on a normal visit, or when the box is closed', async () => {
    page = await openPage('/', { save: OPEN });
    expect(page.scrolls.length).toBe(0);
    page.close();
    page = await openPage('/', { session: { 'fz-from-app': '1' } });
    expect(page.scrolls.length).toBe(0);
  });
});

describe('groove machine: tempo tabs', () => {
  test('four tabs that only say BPM, each with its collected count', async () => {
    page = await openPage('/', { save: Object.assign({ unlocked: ['kick', 'dnb-vox'] }, OPEN) });
    expect(page.$$('.tempo').map(b => b.innerText || b.textContent)).toEqual([`120BPM1/${count(120)}`, `180BPM1/${count(180)}`, `400BPM0/${count(400)}`, `1280BPM0/${count(1280)}`]);
    expect(page.text('#count')).toBe('2 / ' + sounds.length + ' sounds');
  });
  test('shows only the selected tempo’s sounds; locked ones are hidden behind ???', async () => {
    page = await openPage('/', { lang: 'ja', save: Object.assign({ unlocked: ['dnb-vox'] }, OPEN) });
    tab(page, 180).click();
    const tracks = page.$$('.trk');
    expect(tracks.length).toBe(sounds.filter(s => s.bpm === 180).length);
    expect(tracks.filter(t => t.classList.contains('locked')).length).toBe(tracks.length - 1);
    expect(page.$$('.trk.locked .n').every(n => n.textContent === '？？？')).toBe(true);
    expect(page.$$('.trk.locked .h').every(n => n.textContent === 'どこかのゲームに落ちている')).toBe(true);
    expect(page.FZ.stat('top', 'bpm')).toBe(180);
  });
  test('remembers the chosen tempo', async () => {
    page = await openPage('/', { save: { stats: { top: { boxOpen: 1, bpm: 400 } } } });
    expect(tab(page, 400).getAttribute('aria-selected')).toBe('true');
  });
});

describe('groove machine: playback', () => {
  const save = Object.assign({ unlocked: ALL }, OPEN);
  test('says so when there is nothing to play', async () => {
    page = await openPage('/', { lang: 'ja', save: OPEN });
    page.$('#play').click();
    await page.wait();
    expect(page.text('#play')).toBe('まだ音源がない。アプリで遊べ（またはズルしろ）');
    expect(active(page).length).toBe(0);
  });
  test('plays the collected loops of the tempo in sync; only the selected ones are audible; stops', async () => {
    page = await openPage('/', { save });
    tab(page, 120).click();
    page.$('#play').click();
    await playing(page);
    expect(active(page).length).toBe(count(120));
    expect(audible(page).length).toBe(selected(page).length);
    expect(selected(page).length).toBeLessThanOrEqual(maxOn);
    expect(durations(page)).toEqual(['4.000']);
    expect(new Set(active(page).map(s => s.when)).size).toBe(1);          // 同じ瞬間に頭を揃える
    page.$('#play').click();
    expect(active(page).length).toBe(0);
  });
  test('switching tempo while playing stops the old tempo and plays the new one', async () => {
    page = await openPage('/', { save });
    tab(page, 120).click();
    page.$('#play').click();
    await playing(page);
    for (const [bpm, len] of [[180, '5.333'], [400, '2.400'], [1280, '3.000']]) {
      tab(page, bpm).click();
      await page.wait(40);
      expect(durations(page)).toEqual([len]);
    }
  });
  test('hammering the tabs while loading never mixes tempos and keeps playing the last one', async () => {
    page = await openPage('/', { save });
    page.$('#play').click();
    for (const bpm of [180, 400, 120, 1280, 400]) tab(page, bpm).click();
    await page.wait(80);
    expect(durations(page)).toEqual(['2.400']);
    expect(active(page).length).toBe(count(400));
  });
  test('pressing play repeatedly never stacks two copies', async () => {
    page = await openPage('/', { save });
    tab(page, 120).click();
    page.$('#play').click(); page.$('#play').click(); page.$('#play').click();   // 鳴らす→（読み込み中に）止める→鳴らす
    await page.wait(80);
    expect(active(page).length).toBe(count(120));
    expect(durations(page)).toEqual(['4.000']);
  });
  test('tapping a track mutes / unmutes it', async () => {
    page = await openPage('/', { save });
    tab(page, 120).click();
    page.$('#play').click();
    await playing(page);
    const trk = page.$('.trk.on');
    const before = audible(page).length;
    trk.click();
    expect(trk.classList.contains('on')).toBe(false);
    expect(audible(page).length).toBe(before - 1);
    trk.click();
    expect(trk.classList.contains('on')).toBe(true);
    expect(audible(page).length).toBe(before);
  });
  test('cheat unlocks everything once', async () => {
    page = await openPage('/', { lang: 'ja', save: OPEN });
    page.$('#cheat').click();
    await page.wait();
    expect(page.FZ.unlocked().length).toBe(sounds.length);
    expect(page.text('#cheat')).toBe('全部解放しました。ズルです。');
    page.$('#cheat').click();
    expect(page.text('#cheat')).toBe('もう全部解放済みです。');
  });
});

describe('groove machine: lights', () => {
  const save = Object.assign({ unlocked: ALL }, OPEN);
  // 偽の時計を進めながら、ランプが進んだ回数（＝光った回数）を数える
  async function countPulses(p, seconds) {
    const lead = () => p.$$('.lamps i').findIndex(i => i.classList.contains('on'));
    let n = 0, prev = lead();
    for (let t = 0; t < seconds * 1000; t += 40) {
      p.clock.ms += 40;
      await p.wait(18);
      const now = lead();
      if (now !== prev) { n++; prev = now; }
    }
    return n;
  }
  test.each([[120, 2], [180, 1.5], [400, 1.67], [1280, 1.33]])('at %i BPM it pulses about %f times a second, never more than 2', async (bpm, rate) => {
    page = await openPage('/', { save });
    tab(page, bpm).click();
    page.$('#play').click();
    await playing(page);
    const n = await countPulses(page, 6);
    expect(n / 6).toBeLessThanOrEqual(2.1);
    expect(Math.abs(n / 6 - rate)).toBeLessThan(0.35);
  });
  test('lights are on by default and can be switched off (remembered)', async () => {
    page = await openPage('/', { lang: 'ja', save });
    page.$('#play').click();
    await playing(page);
    expect(page.$('#groove').classList.contains('lit')).toBe(true);
    page.$('#fxbtn').click();
    expect(page.text('#fxbtn')).toBe('✨ 演出：OFF');
    expect(page.$('#groove').classList.contains('lit')).toBe(false);
    expect(page.window.localStorage.getItem('fz-fx')).toBe('0');
  });
  test('reduced-motion users start with the lights off', async () => {
    page = await openPage('/', { save, reducedMotion: true });
    page.$('#play').click();
    await playing(page);
    expect(page.$('#groove').classList.contains('lit')).toBe(false);
  });
  test('the jackpot label says ★ FEVER ★ in both languages', async () => {
    page = await openPage('/', { lang: 'ja', save });
    expect(page.text('#kakutei')).toBe('★ FEVER ★');
    page.$('.fz-lang').click();
    expect(page.text('#kakutei')).toBe('★ FEVER ★');
  });
  test('FEVER is a 1/128 lottery on every pulse', async () => {
    page = await openPage('/', { save });
    page.window.Math.random = () => 1 / 128;          // ちょうど 1/128 は外れ
    tab(page, 120).click();
    page.$('#play').click();
    await playing(page);
    await countPulses(page, 20);
    expect(page.$('#groove').classList.contains('fever')).toBe(false);
    page.window.Math.random = () => 1 / 128 - 1e-9;   // 1/128 未満は当たり
    await countPulses(page, 0.6);
    expect(page.$('#groove').classList.contains('fever')).toBe(true);
  });
  test('FEVER lasts 8 pulses, then calms down', async () => {
    page = await openPage('/', { save });
    page.window.Math.random = () => 0;
    tab(page, 120).click();
    page.$('#play').click();
    await playing(page);
    await countPulses(page, 0.6);
    expect(page.$('#groove').classList.contains('fever')).toBe(true);
    page.window.Math.random = () => 0.99;
    await countPulses(page, 3.4);                      // 7拍目あたり：まだ続いている
    expect(page.$('#groove').classList.contains('fever')).toBe(true);
    await countPulses(page, 1.5);
    expect(page.$('#groove').classList.contains('fever')).toBe(false);
  });
  test('during FEVER the background turns rainbow too', async () => {
    page = await openPage('/', { save });
    expect(page.$('#groove .fx .fx-rainbow')).not.toBeNull();
    const css = [...page.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    expect(css).toMatch(/\.groove\.fever \.fx-rainbow\s*\{[^}]*opacity/);
  });
  test('stopping clears the lights', async () => {
    page = await openPage('/', { save });
    page.window.Math.random = () => 0;
    page.$('#play').click();
    await playing(page);
    await countPulses(page, 0.6);
    page.$('#play').click();
    expect(page.$('#groove').classList.contains('lit')).toBe(false);
    expect(page.$('#groove').classList.contains('fever')).toBe(false);
  });
});

describe('save section', () => {
  test('shows a save code', async () => {
    page = await openPage('/', { save: OPEN });
    page.$('#exp').click();
    expect(page.$('#code').value).toMatch(/^FZ1\./);
  });
  test('loads a save code and reloads', async () => {
    page = await openPage('/', { save: Object.assign({ unlocked: ALL }, OPEN) });
    const code = page.FZ.exportCode();
    page.close();
    page = await openPage('/', { lang: 'ja', save: OPEN });
    page.$('#code').value = code;
    page.$('#imp').click();
    expect(page.text('#msg')).toBe('読み込みました。');
    expect(page.save().unlocked.length).toBe(sounds.length);
    await page.wait(700);
    expect(page.navigations.length).toBe(1);
  });
  test('a broken save code shows an error and changes nothing', async () => {
    page = await openPage('/', { lang: 'ja', save: Object.assign({ unlocked: ['kick'] }, OPEN) });
    page.$('#code').value = 'FZ1.nope.nope';
    page.$('#imp').click();
    expect(page.text('#msg')).toBe('セーブコードが壊れているか、別物です');
    expect(page.FZ.unlocked()).toEqual(['kick']);
  });
  test('erasing works even where confirm() dialogs are blocked: tap twice', async () => {
    page = await openPage('/', { lang: 'ja', save: Object.assign({ unlocked: ALL }, OPEN) });   // confirm() は false を返す
    page.$('#rst').click();
    expect(page.text('#rst')).toBe('本当に全部消す？（もう一度押す）');
    expect(page.FZ.unlocked().length).toBe(sounds.length);       // 1回目ではまだ消えない
    page.$('#rst').click();
    expect(page.save().unlocked).toEqual([]);
    expect(page.save().stats).toEqual({});
    expect(page.navigations.length).toBe(1);
  });
  test('the erase button calms down if you do not tap again', async () => {
    page = await openPage('/', { lang: 'ja', save: Object.assign({ unlocked: ['kick'] }, OPEN) });
    page.$('#rst').click();
    await page.wait(4200);
    expect(page.text('#rst')).toBe('全部消す');
    page.$('#rst').click();
    expect(page.FZ.unlocked()).toEqual(['kick']);
  });
});

test('the top page loads without script errors', async () => {
  page = await openPage('/', { save: Object.assign({ unlocked: ALL }, OPEN) });
  page.$('#play').click();
  await playing(page);
  expect(page.errors).toEqual([]);
});

describe('apps pager', () => {
  const ids = apps.map(a => a.id);
  const visible = p => p.$$('.app-page:not([inert]) a.app').map(a => a.getAttribute('href').split('/')[2]);
  test('shows 6 games per page, with a page count', async () => {
    page = await openPage('/', { save: OPEN });
    expect(page.$$('.app-page').length).toBe(Math.ceil(apps.length / 6));
    expect(visible(page)).toEqual(ids.slice(0, 6));
    expect(page.text('.pager-count')).toBe('1 / ' + Math.ceil(apps.length / 6));
    expect(page.$$('.app-page[inert] a.app').length).toBe(apps.length - 6);   // 見えないページはタブ移動もしない
  });
  test('next / previous buttons turn pages and stop at the ends', async () => {
    page = await openPage('/', { save: OPEN });
    expect(page.$('.pager-prev').disabled).toBe(true);
    page.$('.pager-next').click();
    expect(visible(page)).toEqual(ids.slice(6, 12));
    page.$('.pager-next').click();
    expect(visible(page)).toEqual(ids.slice(12, 18));
    expect(page.$('.pager-next').disabled).toBe(true);
    page.$('.pager-prev').click();
    expect(visible(page)).toEqual(ids.slice(6, 12));
  });
  test('dots jump straight to a page', async () => {
    page = await openPage('/', { save: OPEN });
    page.$$('.pager-dots button')[2].click();
    expect(visible(page)).toEqual(ids.slice(12, 18));
    expect(page.$$('.pager-dots button')[2].getAttribute('aria-current')).toBe('true');
  });
  test('swiping left / right turns pages; a tiny drag does not', async () => {
    page = await openPage('/', { save: OPEN });
    const vp = page.$('.apps-viewport');
    const swipe = (from, to) => { page.pointer(vp, 'pointerdown', { clientX: from, clientY: 100 }); page.pointer(vp, 'pointerup', { clientX: to, clientY: 105 }); };
    swipe(300, 100);
    expect(visible(page)).toEqual(ids.slice(6, 12));
    swipe(100, 300);
    expect(visible(page)).toEqual(ids.slice(0, 6));
    swipe(200, 180);
    expect(visible(page)).toEqual(ids.slice(0, 6));
  });
  test('coming back from a game opens the page that game is on', async () => {
    page = await openPage('/', { save: OPEN, session: { 'fz-from-app': ids[17] } });
    expect(visible(page)).toContain(ids[17]);
    expect(page.scrolls).toContain(page.$('h1.boxname'));
  });
});

describe('groove machine: presets and the limit', () => {
  const all = Object.assign({ unlocked: ALL }, OPEN);
  const ps = bpm => presets.filter(p => p.bpm === bpm);
  test('each tempo offers its 3 presets', async () => {
    page = await openPage('/', { lang: 'ja', save: all });
    for (const bpm of [120, 180, 400, 1280]) {
      tab(page, bpm).click();
      expect(page.$$('.preset').map(b => b.querySelector('.preset-name').textContent)).toEqual(ps(bpm).map(p => p.name.ja));
    }
  });
  test('picking a preset selects exactly its sounds and shows the count', async () => {
    page = await openPage('/', { save: all });
    tab(page, 180).click();
    const p = ps(180)[1];
    page.$$('.preset')[1].click();
    expect(selected(page).sort()).toEqual([...p.sounds].sort());
    expect(page.text('#oncount')).toBe('ON ' + p.sounds.length + '/' + maxOn);
    expect(page.$$('.preset')[1].getAttribute('aria-pressed')).toBe('true');
  });
  test('a preset with sounds you do not have yet is locked and says how many are missing', async () => {
    const p = ps(120)[0];
    page = await openPage('/', { lang: 'ja', save: Object.assign({ unlocked: [p.sounds[0]] }, OPEN) });
    tab(page, 120).click();
    const b = page.$$('.preset')[0];
    expect(b.disabled).toBe(true);
    expect(b.textContent).toContain('🔒 あと' + (p.sounds.length - 1));
  });
  test('you cannot turn on more than the limit', async () => {
    page = await openPage('/', { lang: 'ja', save: all });
    tab(page, 120).click();
    for (const b of page.$$('.trk.on')) b.click();          // 全部オフ
    const trks = page.$$('.trk');
    for (let i = 0; i < maxOn; i++) trks[i].click();
    expect(selected(page).length).toBe(maxOn);
    trks[maxOn].click();
    expect(trks[maxOn].classList.contains('on')).toBe(false);
    expect(selected(page).length).toBe(maxOn);
    expect(page.text('#groovemsg')).toBe('同時に鳴らせるのは' + maxOn + 'つまでです');
  });
  test('by default a tempo starts with its first complete preset', async () => {
    page = await openPage('/', { save: all });
    tab(page, 400).click();
    expect(selected(page).sort()).toEqual([...ps(400)[0].sounds].sort());
  });
  test('with no complete preset, the first collected sounds are on (up to the limit)', async () => {
    const some = sounds.filter(s => s.bpm === 120).slice(-2).map(s => s.id);
    page = await openPage('/', { save: Object.assign({ unlocked: some }, OPEN) });
    tab(page, 120).click();
    expect(selected(page).sort()).toEqual([...some].sort());
  });
  test('choosing a preset while playing changes what you hear', async () => {
    page = await openPage('/', { save: all });
    tab(page, 1280).click();
    page.$('#play').click();
    await playing(page);
    page.$$('.preset')[2].click();
    expect(audible(page).length).toBe(ps(1280)[2].sounds.length);
  });
  test('each tempo keeps its own selection', async () => {
    page = await openPage('/', { save: all });
    tab(page, 180).click();
    page.$$('.preset')[2].click();
    tab(page, 400).click();
    tab(page, 180).click();
    expect(selected(page).sort()).toEqual([...ps(180)[2].sounds].sort());
  });
});
