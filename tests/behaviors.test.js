/* 追加の到達点：同じ数字の「もっと上」ではなく、遊び方のバリエーション（連続で間違える、変な遊び方など） */
const { openPage, readJSON } = require('./helpers/page');

const { drops } = readJSON('data/unlocks.json');
let page;
afterEach(() => page && page.close());

const down = (p, el, init = {}) => p.pointer(el, 'pointerdown', Object.assign({ pointerId: 1 }, init));
const move = (p, el, init = {}) => p.pointer(el, 'pointermove', Object.assign({ pointerId: 1 }, init));
const up = (p, init = {}) => p.pointer(p.window, 'pointerup', Object.assign({ pointerId: 1 }, init));
const stat = (p, app, k) => p.FZ.stat(app, k);

describe('every added threshold is a different behaviour', () => {
  const ORIGINAL = { 'muda-button': 3, natto: 3, kyomu: 3, somen: 3, hanko: 3, nekosui: 3 };
  test('the added ones never reuse a stat the game already had, nor each other', () => {
    const ids = [...new Set(drops.map(d => d.app))];
    for (const app of ids) {
      const mine = drops.filter(d => d.app === app);
      const n = ORIGINAL[app] || 2;
      const old = new Set(mine.slice(0, n).map(d => d.stat));
      const added = mine.slice(n).map(d => d.stat);
      for (const s of added) expect(old.has(s)).toBe(false);
      expect(new Set(added).size).toBe(added.length);
    }
  });
});

describe('Useless Button', () => {
  const btn = p => p.$('#btn');
  test('burst: presses within one second', async () => {
    page = await openPage('/apps/muda-button/');
    for (let i = 0; i < 8; i++) btn(page).click();
    expect(stat(page, 'muda-button', 'burst')).toBe(8);
  });
  test('patience: waiting 30s before pressing again', async () => {
    page = await openPage('/apps/muda-button/');
    btn(page).click();
    page.clock.ms += 31000;
    btn(page).click();
    expect(stat(page, 'muda-button', 'patience')).toBeGreaterThanOrEqual(30);
  });
  test('long press: holding the button for 3 seconds', async () => {
    page = await openPage('/apps/muda-button/');
    down(page, btn(page));
    page.clock.ms += 3100;
    up(page);
    expect(stat(page, 'muda-button', 'longPress')).toBe(1);
  });
});

describe('Natto Stirrer', () => {
  const stir = (p, turns, dir) => {
    const cv = p.$('#c'), W = p.window.innerWidth, H = p.window.innerHeight;
    const at = a => ({ clientX: W / 2 + Math.cos(a) * 100, clientY: H / 2 + Math.sin(a) * 100 });
    let a = 0;
    for (let k = 0; k < turns * 16 + 1; k++) { a += dir * Math.PI / 8; move(p, cv, at(a)); }   // 1歩だけ余分に（ちょうど一周の境目で小数の誤差に負けないように）
    return a;
  };
  test('reverse: stirring the other way', async () => {
    page = await openPage('/apps/natto/');
    down(page, page.$('#c'), { clientX: page.window.innerWidth / 2 + 100, clientY: page.window.innerHeight / 2 });
    stir(page, 3, -1);
    up(page);
    expect(stat(page, 'natto', 'reverse')).toBe(3);
  });
  test('longStir: the most turns without lifting your finger', async () => {
    page = await openPage('/apps/natto/');
    down(page, page.$('#c'), { clientX: page.window.innerWidth / 2 + 100, clientY: page.window.innerHeight / 2 });
    stir(page, 4, 1);
    up(page);
    expect(stat(page, 'natto', 'longStir')).toBe(4);
  });
  test('switches: changing direction while stirring', async () => {
    page = await openPage('/apps/natto/');
    down(page, page.$('#c'), { clientX: page.window.innerWidth / 2 + 100, clientY: page.window.innerHeight / 2 });
    const cv = page.$('#c'), W = page.window.innerWidth, H = page.window.innerHeight;
    let a = 0;
    for (const dir of [1, -1, 1]) for (let k = 0; k < 16; k++) { a += dir * Math.PI / 8; move(page, cv, { clientX: W / 2 + Math.cos(a) * 100, clientY: H / 2 + Math.sin(a) * 100 }); }
    up(page);
    expect(stat(page, 'natto', 'switches')).toBe(2);
  });
});

describe('Void Timer', () => {
  const begin = async p => { p.$('#start').click(); await p.wait(650); };
  test('keyFails: losing by pressing a key', async () => {
    page = await openPage('/apps/kyomu/');
    await begin(page);
    page.clock.ms += 2000;
    page.window.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'a' }));
    expect(stat(page, 'kyomu', 'keyFails')).toBe(1);
  });
  test('quickStreak: failing in under a second, several times in a row', async () => {
    page = await openPage('/apps/kyomu/');
    for (let i = 0; i < 3; i++) { await begin(page); page.clock.ms += 700; page.pointer(page.window, 'pointerdown'); }
    expect(stat(page, 'kyomu', 'quickStreak')).toBe(3);
  });
  test('away: losing by looking away (switching tabs)', async () => {
    page = await openPage('/apps/kyomu/');
    await begin(page);
    Object.defineProperty(page.document, 'hidden', { configurable: true, get: () => true });
    page.document.dispatchEvent(new page.window.Event('visibilitychange'));
    expect(stat(page, 'kyomu', 'away')).toBe(1);
  });
});

describe('Somen Slide', () => {
  async function spawnUntil(p, pred) {
    for (let i = 0; i < 60; i++) {
      const it = p.$$('.item:not(.got):not(.bad)').find(pred);
      if (it) return it;
      p.clock.ms += 100; await p.wait(20);
    }
    throw new Error('nothing spawned');
  }
  const isJunk = e => !e.querySelector('.somen');
  test('junkStreak: grabbing non-somen things in a row', async () => {
    page = await openPage('/apps/somen/', { random: () => 0.9 });
    page.$('#go').click();
    for (let i = 0; i < 3; i++) down(page, await spawnUntil(page, isJunk));
    expect(stat(page, 'somen', 'junkStreak')).toBe(3);
  });
  test('ojisan: grabbing the old man', async () => {
    page = await openPage('/apps/somen/', { random: () => 0.65 });   // 0.65 → そうめん以外で、おじさん
    page.$('#go').click();
    down(page, await spawnUntil(page, e => e.textContent === '👴'));
    expect(stat(page, 'somen', 'ojisan')).toBe(1);
  });
  test('clean: a round of 10+ without touching anything else', async () => {
    page = await openPage('/apps/somen/', { random: () => 0.1 });
    page.$('#go').click();
    for (let i = 0; i < 10; i++) down(page, await spawnUntil(page, e => !isJunk(e)));
    for (let i = 0; i < 40; i++) { page.clock.ms += 1000; await page.wait(20); }
    expect(stat(page, 'somen', 'clean')).toBe(1);
  });
});

describe('Stamp Rush', () => {
  const tap = p => p.pointer(p.$('#stage'), 'pointerdown', { clientX: 100, clientY: 200 });
  const end = async p => { p.clock.ms += 10100; await p.wait(80); };
  test('lazy: a round with 3 stamps or fewer', async () => {
    page = await openPage('/apps/hanko/');
    tap(page); tap(page);
    await end(page);
    expect(stat(page, 'hanko', 'lazy')).toBe(1);
  });
  test('eager: stamping while the results are being announced', async () => {
    page = await openPage('/apps/hanko/');
    for (let i = 0; i < 5; i++) tap(page);
    await end(page);
    for (let i = 0; i < 4; i++) tap(page);
    expect(stat(page, 'hanko', 'eager')).toBe(4);
  });
  test('deepest: reaching the 8th kind of document in one round', async () => {
    page = await openPage('/apps/hanko/');
    for (let i = 0; i < 35; i++) tap(page);
    expect(stat(page, 'hanko', 'deepest')).toBe(8);
  });
});

describe('Cat Sniffing', () => {
  const cat = p => p.$('#cat');
  test('scratchStreak: getting scratched several times in a row', async () => {
    page = await openPage('/apps/nekosui/', { random: () => 0 });
    for (let i = 0; i < 3; i++) {
      down(page, cat(page));
      page.clock.ms += 2600; await page.wait(80);
      up(page);
      await page.wait(1300);
    }
    expect(stat(page, 'nekosui', 'scratchStreak')).toBe(3);
  });
  test('tiny: letting go almost immediately', async () => {
    page = await openPage('/apps/nekosui/');
    for (let i = 0; i < 2; i++) { down(page, cat(page)); page.clock.ms += 100; up(page); }
    expect(stat(page, 'nekosui', 'tiny')).toBe(2);
  });
  test('closeCalls: letting go right when the cat is about to snap', async () => {
    page = await openPage('/apps/nekosui/', { random: () => 0 });     // 我慢は2.5秒
    down(page, cat(page));
    page.clock.ms += 2300; await page.wait(80);
    up(page);
    expect(stat(page, 'nekosui', 'closeCalls')).toBe(1);
  });
});

describe('Bubble Wrap', () => {
  test('repops: pressing bubbles that are already popped', async () => {
    page = await openPage('/apps/puchipuchi/');
    const b = page.$('.bubble');
    down(page, b); down(page, b); down(page, b);
    expect(stat(page, 'puchipuchi', 'repops')).toBe(2);
  });
  test('fastSheets: clearing a sheet in 20 seconds', async () => {
    page = await openPage('/apps/puchipuchi/');
    page.clock.ms += 5000;
    for (const b of page.$$('.bubble')) down(page, b);
    expect(stat(page, 'puchipuchi', 'fastSheets')).toBe(1);
  });
});

describe('USB First Try', () => {
  test('failStreak: wrong way several times in a row', async () => {
    page = await openPage('/apps/usb/', { random: () => 0.1 });
    for (let i = 0; i < 4; i++) page.$('#insert').click();
    expect(stat(page, 'usb', 'failStreak')).toBe(4);
  });
  test('firstStreak: first try several times in a row', async () => {
    page = await openPage('/apps/usb/', { random: () => 0.9 });
    for (let i = 0; i < 3; i++) { page.$('#insert').click(); await page.wait(650); }
    expect(stat(page, 'usb', 'firstStreak')).toBe(3);
  });
});

describe('Meeting Nods', () => {
  const answer = p => Number(p.$('#line').dataset.answer);
  test('wrongStreak: the wrong reply several times in a row', async () => {
    page = await openPage('/apps/aizuchi/');
    for (let i = 0; i < 3; i++) page.$$('.reply')[(answer(page) + 1) % 3].click();
    expect(stat(page, 'aizuchi', 'wrongStreak')).toBe(3);
  });
  test('sameStreak: always giving the same reply', async () => {
    page = await openPage('/apps/aizuchi/');
    for (let i = 0; i < 5; i++) page.$$('.reply')[2].click();
    expect(stat(page, 'aizuchi', 'sameStreak')).toBe(5);
  });
});

describe('Bow-Off', () => {
  const bow = async (p, ms) => { down(p, p.$('#bow')); p.clock.ms += ms; await p.wait(60); up(p); };
  test('loseStreak: rising first several times in a row', async () => {
    page = await openPage('/apps/ojigi/', { random: () => 0 });
    for (let i = 0; i < 3; i++) await bow(page, 500);
    expect(stat(page, 'ojigi', 'loseStreak')).toBe(3);
  });
  test('quickBows: a tiny nod instead of a bow', async () => {
    page = await openPage('/apps/ojigi/');
    await bow(page, 200);
    expect(stat(page, 'ojigi', 'quickBows')).toBe(1);
  });
});

describe('Label Peel', () => {
  test('tearStreak: tearing it several times in a row', async () => {
    page = await openPage('/apps/label/');
    for (let i = 0; i < 3; i++) {
      down(page, page.$('#label'), { clientX: 0, clientY: 50 });
      page.clock.ms += 10;
      move(page, page.$('#label'), { clientX: 200, clientY: 50 });
      up(page);
    }
    expect(stat(page, 'label', 'tearStreak')).toBe(3);
  });
  test('giveUps: letting go halfway', async () => {
    page = await openPage('/apps/label/');
    down(page, page.$('#label'), { clientX: 0, clientY: 50 });
    for (let x = 20; x <= 160; x += 20) { page.clock.ms += 60; move(page, page.$('#label'), { clientX: x, clientY: 50 }); }
    up(page);
    expect(stat(page, 'label', 'giveUps')).toBe(1);
  });
});

describe('Ticket Gate', () => {
  const touch = async (p, ms) => { down(p, p.$('#card')); p.clock.ms += ms; up(p); await p.wait(5); };
  test('shortStreak: too short several times in a row', async () => {
    page = await openPage('/apps/kaisatsu/');
    for (let i = 0; i < 3; i++) await touch(page, 50);
    expect(stat(page, 'kaisatsu', 'shortStreak')).toBe(3);
  });
  test('longOnes: holding it far too long', async () => {
    page = await openPage('/apps/kaisatsu/');
    await touch(page, 2000); await touch(page, 2000);
    expect(stat(page, 'kaisatsu', 'longOnes')).toBe(2);
  });
});

describe('Static Shock', () => {
  test('duds: touching the knob with no charge', async () => {
    page = await openPage('/apps/seidenki/');
    page.$('#knob').click(); page.$('#knob').click();
    expect(stat(page, 'seidenki', 'duds')).toBe(2);
  });
  test('maxed: charging all the way to the limit', async () => {
    page = await openPage('/apps/seidenki/');
    const rug = page.$('#carpet');
    down(page, rug, { clientX: 0 });
    for (let i = 1; i <= 30; i++) move(page, rug, { clientX: i % 2 ? 300 : 0 });
    up(page);
    expect(stat(page, 'seidenki', 'maxed')).toBe(1);
  });
});

describe('Cup Noodle Clock', () => {
  const bowl = (p, ms) => { p.$('#pour').click(); p.clock.ms += ms; p.$('#eat').click(); };
  test('hungry: eating before 10 seconds', async () => {
    page = await openPage('/apps/cupmen/');
    bowl(page, 5000);
    expect(stat(page, 'cupmen', 'hungry')).toBe(1);
  });
  test('forgot: leaving it for over a minute', async () => {
    page = await openPage('/apps/cupmen/');
    bowl(page, 65000);
    expect(stat(page, 'cupmen', 'forgot')).toBe(1);
  });
});

describe('Snooze', () => {
  test('caughtStreak: the boss calls twice in a row', async () => {
    page = await openPage('/apps/nidone/', { random: () => 0 });
    page.$('#snooze').click(); page.$('#snooze').click();
    expect(stat(page, 'nidone', 'caughtStreak')).toBe(2);
  });
  test('honest: getting up after just one snooze', async () => {
    page = await openPage('/apps/nidone/', { random: () => 0.99 });
    page.$('#snooze').click(); page.$('#wake').click();
    expect(stat(page, 'nidone', 'honest')).toBe(1);
  });
});

describe('Almost Sneeze', () => {
  test('fizzleStreak: nothing comes out, several times in a row', async () => {
    page = await openPage('/apps/kushami/');
    for (let i = 0; i < 5; i++) page.$('#sneeze').click();
    expect(stat(page, 'kushami', 'fizzleStreak')).toBe(5);
  });
  test('perfects: a full-power 100 sneeze', async () => {
    page = await openPage('/apps/kushami/');
    page.clock.ms += 700 * Math.PI / 2;
    page.$('#sneeze').click();
    expect(stat(page, 'kushami', 'perfects')).toBe(1);
  });
});

describe('Odd Sock', () => {
  const socks = p => p.$$('.sock');
  const dup = p => { const k = socks(p).map(s => s.dataset.kind); return k.find((x, i) => k.indexOf(x) !== i); };
  test('wrongStreak: picking mismatched socks several times in a row', async () => {
    page = await openPage('/apps/kutsushita/');
    const others = socks(page).filter(s => s.dataset.kind !== dup(page));
    for (let i = 0; i < 5; i++) { others[i].click(); others[i + 1].click(); }
    expect(stat(page, 'kutsushita', 'wrongStreak')).toBe(5);
  });
  test('slowFinds: taking over 30 seconds to find the pair', async () => {
    page = await openPage('/apps/kutsushita/');
    page.clock.ms += 31000;
    const pair = socks(page).filter(s => s.dataset.kind === dup(page));
    pair[0].click(); pair[1].click();
    expect(stat(page, 'kutsushita', 'slowFinds')).toBe(1);
  });
});
