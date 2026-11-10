/* core.js：保存・音源のドロップ・セーブコード・言語・アプリページの到達点の帯・獲得演出 */
const { openPage, readJSON, SAVE_KEY } = require('./helpers/page');

const { sounds, drops } = readJSON('data/unlocks.json');
const APP = '/apps/muda-button/';
let page;
afterEach(() => page && page.close());

describe('stats and storage', () => {
  test('add / max / set / stat persist to localStorage', async () => {
    page = await openPage(APP);
    const { FZ } = page;
    FZ.add('x', 'n', 2); FZ.add('x', 'n');
    FZ.max('x', 'best', 5); FZ.max('x', 'best', 3);
    FZ.set('x', 'flag', 7);
    expect(FZ.stat('x', 'n')).toBe(3);
    expect(FZ.stat('x', 'best')).toBe(5);
    expect(FZ.stat('x', 'flag')).toBe(7);
    expect(FZ.stat('x', 'missing')).toBe(0);
    expect(page.save().stats.x).toEqual({ n: 3, best: 5, flag: 7 });
  });
  test('broken or foreign data in storage starts fresh instead of crashing', async () => {
    page = await openPage(APP, { local: { [SAVE_KEY]: '{not json' } });
    expect(page.FZ.unlocked()).toEqual([]);
    page.close();
    page = await openPage(APP, { local: { [SAVE_KEY]: JSON.stringify({ v: 99, stats: { a: { b: 1 } } }) } });
    expect(page.FZ.stat('a', 'b')).toBe(0);
  });
});

describe('sound drops', () => {
  const muda = drops.filter(d => d.app === 'muda-button' && d.stat === 'presses');   // 押した回数の到達点

  test('crossing a threshold drops exactly one random locked sound and remembers which', async () => {
    page = await openPage(APP, { random: () => 0 });
    page.FZ.add('muda-button', 'presses', muda[0].gte);
    await page.wait();
    const s = page.save();
    expect(s.unlocked).toEqual([sounds[0].id]);               // random 0 → 先頭の未所持
    expect(s.drops).toEqual([muda[0].id]);
    expect(s.dropSounds).toEqual({ [muda[0].id]: sounds[0].id });
    page.FZ.add('muda-button', 'presses', 1);                  // 同じ到達点ではもう出ない
    expect(page.save().unlocked.length).toBe(1);
  });
  test('the dropped sound can come from any tempo set', async () => {
    page = await openPage(APP, { random: () => 0.999 });
    page.FZ.add('muda-button', 'presses', muda[0].gte);
    expect(page.FZ.unlocked()).toEqual([sounds[sounds.length - 1].id]);
  });
  test('reaching several thresholds at once drops one sound per threshold', async () => {
    page = await openPage(APP);
    page.FZ.add('muda-button', 'presses', muda[muda.length - 1].gte);
    expect(page.FZ.unlocked().length).toBe(muda.length);
    expect(new Set(page.FZ.unlocked()).size).toBe(muda.length);
  });
  test('every drop together unlocks every sound', async () => {
    page = await openPage(APP);
    for (const d of drops) page.FZ.set(d.app, d.stat, Math.max(page.FZ.stat(d.app, d.stat), d.gte));
    expect(page.FZ.unlocked().sort()).toEqual(sounds.map(s => s.id).sort());
  });
  test('when everything is already owned, a drop is recorded but nothing new appears', async () => {
    page = await openPage(APP, { save: { unlocked: sounds.map(s => s.id) } });
    page.FZ.add('muda-button', 'presses', muda[0].gte);
    expect(page.save().drops).toEqual([muda[0].id]);
    expect(page.save().unlocked.length).toBe(sounds.length);
    expect(page.$('.fz-unlock')).toBeNull();
  });
  test('old saves (no drops list) keep their sounds and catch up on passed thresholds', async () => {
    page = await openPage(APP, { save: { stats: { 'muda-button': { presses: muda[0].gte } }, unlocked: ['kick'] } });
    await page.wait();
    expect(page.FZ.unlocked()).toContain('kick');
    expect(page.FZ.unlocked().length).toBe(2);
  });
  test('unlockAll unlocks every sound without drops', async () => {
    page = await openPage(APP);
    await page.FZ.unlockAll();
    expect(page.FZ.unlocked().length).toBe(sounds.length);
    expect(page.save().drops || []).toEqual([]);
  });
});

describe('unlock celebration (shown inside the games)', () => {
  test('a big unlock card appears with the sound name and its BPM, and plays the sound', async () => {
    page = await openPage(APP, { lang: 'ja', random: () => 0 });
    page.FZ.add('muda-button', 'presses', 10);
    await page.wait();
    const card = page.$('.fz-unlock');
    expect(card).not.toBeNull();
    expect(page.text('.fz-unlock-title')).toBe('音源ゲット！');
    expect(page.text('.fz-unlock-name')).toBe(sounds[0].name.ja);
    expect(page.text('.fz-unlock-bpm')).toBe(sounds[0].bpm + ' BPM');
    expect(page.window.__played.some(src => src.endsWith(sounds[0].file))).toBe(true);
  });
  test('confetti bursts out (but not when reduced motion is requested)', async () => {
    page = await openPage(APP, { random: () => 0 });
    page.FZ.add('muda-button', 'presses', 10);
    await page.wait();
    expect(page.$$('.fz-unlock .fz-confetti i').length).toBeGreaterThanOrEqual(20);
    page.close();
    page = await openPage(APP, { random: () => 0, reducedMotion: true });
    page.FZ.add('muda-button', 'presses', 10);
    await page.wait();
    expect(page.$('.fz-unlock')).not.toBeNull();
    expect(page.$$('.fz-unlock .fz-confetti i').length).toBe(0);
  });
  test('the matching chip in the strip lights up as new', async () => {
    page = await openPage(APP, { random: () => 0 });
    page.FZ.add('muda-button', 'presses', 10);
    await page.wait();
    const fresh = page.$$('.fz-drop.fresh');
    expect(fresh.length).toBe(1);
    expect(fresh[0].textContent).toContain(sounds[0].name.en);
  });
  test('tapping the card closes it; several unlocks are shown one after another', async () => {
    page = await openPage(APP);
    page.FZ.add('muda-button', 'presses', 100);           // 2つ同時
    await page.wait();
    expect(page.$$('.fz-unlock').length).toBe(1);
    const first = page.text('.fz-unlock-name');
    page.$('.fz-unlock').click();
    await page.wait(500);
    expect(page.$$('.fz-unlock').length).toBe(1);
    expect(page.text('.fz-unlock-name')).not.toBe(first);
    page.$('.fz-unlock').click();
    await page.wait(500);
    expect(page.$('.fz-unlock')).toBeNull();
  });
  test('the card closes on its own after a few seconds', async () => {
    page = await openPage(APP);
    page.FZ.add('muda-button', 'presses', 10);
    await page.wait();
    expect(page.$('.fz-unlock')).not.toBeNull();
    await page.wait(4600);
    expect(page.$('.fz-unlock')).toBeNull();
  });
});

describe('save codes', () => {
  test('export → import round-trips the whole state', async () => {
    page = await openPage(APP);
    page.FZ.add('natto', 'rotations', 42);
    await page.FZ.unlockAll();
    const code = page.FZ.exportCode();
    expect(code).toMatch(/^FZ1\./);
    page.FZ.reset();
    expect(page.FZ.stat('natto', 'rotations')).toBe(0);
    page.FZ.importCode(code);
    expect(page.save().stats.natto.rotations).toBe(42);
    expect(page.save().unlocked.length).toBe(sounds.length);
  });
  test('handles Japanese text inside the state', async () => {
    page = await openPage(APP);
    page.FZ.set('メモ', 'n', 1);
    const code = page.FZ.exportCode();
    page.FZ.reset();
    page.FZ.importCode(code);
    expect(page.FZ.stat('メモ', 'n')).toBe(1);
  });
  test('tampered, garbage or wrong-version codes are rejected and change nothing', async () => {
    page = await openPage(APP, { lang: 'ja' });
    page.FZ.add('x', 'n', 1);
    const code = page.FZ.exportCode();
    const [p, body, h] = code.split('.');
    const tampered = [p, body.slice(0, -2) + 'AA', h].join('.');
    expect(() => page.FZ.importCode(tampered)).toThrow('セーブコードが壊れているか、別物です');
    expect(() => page.FZ.importCode('hello')).toThrow();
    const v2 = Buffer.from(JSON.stringify({ v: 2, stats: {} })).toString('base64');
    let hh = 7; for (const ch of v2) hh = (hh * 31 + ch.charCodeAt(0)) >>> 0;
    expect(() => page.FZ.importCode('FZ1.' + v2 + '.' + hh.toString(36))).toThrow('対応していないバージョンです');
    expect(page.FZ.stat('x', 'n')).toBe(1);
  });
  test('reset() wipes everything', async () => {
    page = await openPage(APP, { save: { stats: { a: { b: 1 } }, unlocked: ['kick'], drops: ['muda-1'] } });
    page.FZ.reset();
    const s = page.save();
    expect(s.stats).toEqual({});
    expect(s.unlocked).toEqual([]);
    expect(s.drops || []).toEqual([]);
  });
});

describe('language', () => {
  test('defaults to English, remembers Japanese, and t() picks the right text', async () => {
    page = await openPage(APP);
    expect(page.FZ.lang()).toBe('en');
    expect(page.document.documentElement.lang).toBe('en');
    expect(page.FZ.t({ en: 'A', ja: 'あ' })).toBe('A');
    expect(page.FZ.t('plain')).toBe('plain');
    page.FZ.setLang('ja');
    expect(page.FZ.t({ en: 'A', ja: 'あ' })).toBe('あ');
    expect(page.FZ.t({ en: 'only en' })).toBe('only en');
    expect(page.window.localStorage.getItem('fuzake-box-lang')).toBe('ja');
    expect(page.document.documentElement.lang).toBe('ja');
  });
  test('the EN / JA toggle switches language in place and tells listeners', async () => {
    page = await openPage(APP);
    const heard = [];
    page.FZ.onLang(l => heard.push(l));
    const toggle = page.$('.fz-lang');
    expect(toggle.querySelector('.on').textContent).toBe('EN');
    toggle.click();
    expect(page.FZ.lang()).toBe('ja');
    expect(toggle.querySelector('.on').textContent).toBe('JA');
    expect(heard).toEqual(['ja']);
    expect(page.text('[data-i18n="press"]')).toBe('押す');
  });
});

describe('drop strip on game pages', () => {
  const muda = drops.filter(d => d.app === 'muda-button');
  test('shows every threshold of this game with its condition and progress', async () => {
    page = await openPage(APP, { lang: 'ja', save: { stats: { 'muda-button': { presses: 3 } } } });
    const chips = page.$$('.fz-drop');
    expect(chips.length).toBe(muda.length);
    expect(page.text('.fz-drops-head')).toBe('♪ 0/' + muda.length);
    expect(chips[0].textContent).toBe('🔒 ' + muda[0].label.ja + ' 3/' + muda[0].gte);
  });
  test('updates live, and names the sound once it drops', async () => {
    page = await openPage(APP, { random: () => 0 });
    page.FZ.add('muda-button', 'presses', 10);
    const chip = page.$$('.fz-drop')[0];
    expect(chip.classList.contains('got')).toBe(true);
    expect(chip.textContent).toBe('✓ ' + muda[0].label.en + ' → ' + sounds[0].name.en);
    expect(page.text('.fz-drops-head')).toBe('♪ 1/' + muda.length);
  });
  test('progress on fractional stats is shown with one decimal', async () => {
    page = await openPage('/apps/nekosui/', { save: { stats: { nekosui: { total: 3.25 } } } });
    expect(page.$$('.fz-drop')[0].textContent).toMatch(/ 3\.3\/20$|3\.2\/20$/);
  });
  test('follows the language toggle', async () => {
    page = await openPage(APP);
    page.$('.fz-lang').click();
    expect(page.$$('.fz-drop')[0].textContent).toContain(muda[0].label.ja);
  });
  test('reserves room at the top so the game is not covered', async () => {
    page = await openPage(APP);
    expect(page.document.body.classList.contains('fz-has-drops')).toBe(true);
    expect(page.document.body.style.getPropertyValue('--fz-top')).toMatch(/px$/);
  });
  test('is not shown on the top page', async () => {
    page = await openPage('/');
    expect(page.$('.fz-drops')).toBeNull();
  });
});

describe('coming back from a game', () => {
  test('game pages leave a note so the top page can jump back to the corner', async () => {
    page = await openPage(APP);
    expect(page.window.sessionStorage.getItem('fz-from-app')).toBe('muda-button');   // どのゲームから戻ったか
    page.close();
    page = await openPage('/');
    expect(page.window.sessionStorage.getItem('fz-from-app')).toBeNull();
  });
});

describe('drop strip with many thresholds', () => {
  test('stays on one line and scrolls sideways inside itself', async () => {
    page = await openPage('/apps/muda-button/');
    expect(page.$$('.fz-drop').length).toBe(6);
    const cs = page.window.getComputedStyle(page.$('.fz-drops'));
    expect(cs.flexWrap).toBe('nowrap');
    expect(cs.overflowX).toBe('auto');
  });
});
