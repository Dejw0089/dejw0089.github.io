/* 各ゲームのページ */
const { openPage, readJSON } = require('./helpers/page');

const apps = readJSON('data/apps.json');
const { drops } = readJSON('data/unlocks.json');
let page;
afterEach(() => page && page.close());

describe.each(apps.map(a => [a.id, a]))('%s page basics', (id, app) => {
  test('loads cleanly with its title, back link and drop strip', async () => {
    page = await openPage(`/apps/${id}/`);
    expect(page.errors).toEqual([]);
    expect(page.document.title).toBe(app.title.en + ' | Yusuke Iwasaki');
    const back = page.$('.fz-bar a');
    expect(back.getAttribute('href')).toBe('/');
    expect(back.textContent).toBe('← Back');
    expect(page.$$('.fz-drop').length).toBe(drops.filter(d => d.app === id).length);
  });
  test('switches to Japanese in place', async () => {
    page = await openPage(`/apps/${id}/`);
    page.$('.fz-lang').click();
    expect(page.document.title).toBe(app.title.ja + ' | Yusuke Iwasaki');
    expect(page.text('.fz-bar a')).toBe('← 戻る');
  });
});

describe('Useless Button', () => {
  test('each press is counted, and press 10 drops a sound', async () => {
    page = await openPage('/apps/muda-button/', { lang: 'ja' });
    for (let i = 0; i < 9; i++) page.$('#btn').click();
    expect(page.FZ.stat('muda-button', 'presses')).toBe(9);
    expect(page.FZ.unlocked().length).toBe(0);
    page.$('#btn').click();
    expect(page.text('#say')).toBe('10回目。何か貰えるかもしれません（貰えます）');
    expect(page.FZ.unlocked().length).toBe(1);
    expect(page.text('#n')).toBe('累計 10 回');
  });
});

describe('Natto Stirrer', () => {
  test('tracing full circles counts stirs', async () => {
    page = await openPage('/apps/natto/');
    const cv = page.$('#c');
    const W = page.window.innerWidth, H = page.window.innerHeight;
    const at = a => ({ clientX: W / 2 + Math.cos(a) * 100, clientY: H / 2 + Math.sin(a) * 100, pointerId: 1 });
    page.pointer(cv, 'pointerdown', at(0));
    for (let k = 1; k <= 3 * 16; k++) page.pointer(cv, 'pointermove', at(k * Math.PI / 8));
    page.pointer(cv, 'pointerup', at(0));
    expect(page.FZ.stat('natto', 'rotations')).toBe(3);
    expect(page.text('#rot')).toBe('3 stirs');
  });
  test('wiggling without dragging does nothing', async () => {
    page = await openPage('/apps/natto/');
    page.pointer(page.$('#c'), 'pointermove', { clientX: 10, clientY: 10 });
    expect(page.FZ.stat('natto', 'rotations')).toBe(0);
  });
});

describe('Void Timer', () => {
  test('doing nothing is timed; touching ends it and records best and total', async () => {
    page = await openPage('/apps/kyomu/');
    page.$('#start').click();
    expect(page.document.body.classList.contains('void')).toBe(true);
    await page.wait(650);                       // 開始直後の指の動きは見逃す猶予
    page.clock.ms += 16500;
    await page.wait(40);
    page.pointer(page.window, 'pointerdown');
    expect(page.document.body.classList.contains('void')).toBe(false);
    expect(page.FZ.stat('kyomu', 'best')).toBe(16);
    expect(page.FZ.stat('kyomu', 'total')).toBe(16);
    expect(page.FZ.unlocked().length).toBe(1);   // 15秒の到達点
  });
  test('a twitch right after starting does not count as failing', async () => {
    page = await openPage('/apps/kyomu/');
    page.$('#start').click();
    page.pointer(page.window, 'pointermove');
    expect(page.document.body.classList.contains('void')).toBe(true);
  });
});

describe('Somen Slide', () => {
  async function startRound(p) {
    p.$('#go').click();
    for (let i = 0; i < 40 && !p.$('.item'); i++) { p.clock.ms += 100; await p.wait(20); }
  }
  test('catching somen scores, catching junk costs a point and says what it was', async () => {
    page = await openPage('/apps/somen/', { lang: 'ja', random: () => 0.1 });   // 0.1 → そうめん
    await startRound(page);
    const item = page.$('.item');
    expect(item.querySelector('.somen')).not.toBeNull();
    page.pointer(item, 'pointerdown');
    expect(page.text('#score')).toBe('1');
    expect(page.FZ.stat('somen', 'somen')).toBe(1);
    page.window.Math.random = () => 0.9;                                          // 0.9 → そうめん以外
    for (let i = 0; i < 40 && !page.$('.item:not(.got) .somen') && !page.$$('.item:not(.got)').some(e => !e.querySelector('.somen')); i++) { page.clock.ms += 100; await page.wait(20); }
    const junk = page.$$('.item:not(.got)').find(e => !e.querySelector('.somen'));
    page.pointer(junk, 'pointerdown');
    expect(page.text('#score')).toBe('0');
    expect(page.text('#say')).toMatch(/です。/);
  });
  test('the round ends after 30 seconds and keeps the best score', async () => {
    page = await openPage('/apps/somen/', { random: () => 0.1 });
    await startRound(page);
    page.pointer(page.$('.item'), 'pointerdown');
    for (let i = 0; i < 40; i++) { page.clock.ms += 1000; await page.wait(20); }
    expect(page.$('#go').hidden).toBe(false);
    expect(page.FZ.stat('somen', 'best')).toBe(1);
    expect(page.text('#time')).toBe('0.0');
  });
});

describe('Stamp Rush', () => {
  const tap = p => p.pointer(p.$('#stage'), 'pointerdown', { clientX: 100, clientY: 200 });
  test('the first stamp starts a 10 second round; every stamp counts', async () => {
    page = await openPage('/apps/hanko/', { lang: 'ja' });
    for (let i = 0; i < 12; i++) tap(page);
    expect(page.text('#count')).toBe('12件');
    expect(page.FZ.stat('hanko', 'stamps')).toBe(12);
    expect(page.$$('.doc').length).toBeGreaterThanOrEqual(1);
  });
  test('documents escalate into paperwork about paperwork', async () => {
    page = await openPage('/apps/hanko/', { lang: 'ja' });
    expect(page.$('.doc:last-child h3').textContent).toBe('稟議書');
    for (let i = 0; i < 5; i++) tap(page);
    expect(page.$('.doc:last-child h3').textContent).toBe('稟議書の承認申請書');
  });
  test('after 10 seconds the round ends, the best is kept and taps are ignored for a moment', async () => {
    page = await openPage('/apps/hanko/', { lang: 'ja' });
    for (let i = 0; i < 26; i++) tap(page);
    page.clock.ms += 10100;
    await page.wait(80);
    expect(page.FZ.stat('hanko', 'best')).toBe(26);
    expect(page.text('#say')).toMatch(/^26件承認しました。/);
    tap(page);
    expect(page.FZ.stat('hanko', 'stamps')).toBe(26);
  });
  test('a tap that lands after the 10 seconds is not counted', async () => {
    page = await openPage('/apps/hanko/');
    tap(page);
    page.clock.ms += 10001;
    tap(page);
    expect(page.FZ.stat('hanko', 'stamps')).toBe(1);
    expect(page.FZ.stat('hanko', 'best')).toBe(1);
  });
});

describe('Cat Sniffing', () => {
  const cat = p => p.$('#cat');
  test('holding sniffs; letting go banks the seconds', async () => {
    page = await openPage('/apps/nekosui/', { random: () => 0.99 });   // 我慢できる時間：長め
    page.pointer(cat(page), 'pointerdown');
    page.clock.ms += 3000;
    await page.wait(80);
    page.pointer(page.window, 'pointerup');
    expect(page.FZ.stat('nekosui', 'total')).toBe(3);
    expect(page.FZ.stat('nekosui', 'best')).toBe(3);
  });
  test('the face warns you, then the cat scratches and the sniff is lost', async () => {
    page = await openPage('/apps/nekosui/', { lang: 'ja', random: () => 0 });   // 我慢は2.5秒
    page.pointer(cat(page), 'pointerdown');
    page.clock.ms += 1600; await page.wait(80);
    expect(cat(page).textContent).toBe('😼');
    page.clock.ms += 600; await page.wait(80);
    expect(cat(page).textContent).toBe('😾');
    page.clock.ms += 600; await page.wait(80);
    expect(cat(page).textContent).toBe('🙀');
    expect(page.text('#say')).toMatch(/^シャーッ！/);
    expect(page.FZ.stat('nekosui', 'scratches')).toBe(1);
    expect(page.FZ.stat('nekosui', 'total')).toBe(0);
  });
  test('a tiny tap is not a sniff', async () => {
    page = await openPage('/apps/nekosui/');
    page.pointer(cat(page), 'pointerdown');
    page.clock.ms += 200;
    page.pointer(page.window, 'pointerup');
    expect(page.FZ.stat('nekosui', 'total')).toBe(0);
  });
});
