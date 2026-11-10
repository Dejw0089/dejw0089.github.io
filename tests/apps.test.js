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

/* ===== 追加の12本 ===== */
const down = (p, el, x = 0, y = 0) => p.pointer(el, 'pointerdown', { clientX: x, clientY: y, pointerId: 1 });
const move = (p, el, x = 0, y = 0) => p.pointer(el, 'pointermove', { clientX: x, clientY: y, pointerId: 1 });
const up = (p, x = 0, y = 0) => p.pointer(p.window, 'pointerup', { clientX: x, clientY: y, pointerId: 1 });

describe('Bubble Wrap', () => {
  test('popping counts once per bubble; clearing a sheet brings a new one', async () => {
    page = await openPage('/apps/puchipuchi/');
    const bubbles = page.$$('.bubble');
    expect(bubbles.length).toBe(48);
    down(page, bubbles[0]); down(page, bubbles[0]);
    expect(page.FZ.stat('puchipuchi', 'pops')).toBe(1);
    expect(bubbles[0].classList.contains('popped')).toBe(true);
    for (const b of page.$$('.bubble:not(.popped)')) down(page, b);
    expect(page.FZ.stat('puchipuchi', 'pops')).toBe(48);
    expect(page.FZ.stat('puchipuchi', 'sheets')).toBe(1);
    await page.wait(700);
    expect(page.$$('.bubble.popped').length).toBe(0);
  });
});

describe('USB First Try', () => {
  test('a first-try plug is celebrated; a flipped one still counts as plugged', async () => {
    page = await openPage('/apps/usb/', { random: () => 0.9 });
    page.$('#insert').click();
    expect(page.FZ.stat('usb', 'plugs')).toBe(1);
    expect(page.FZ.stat('usb', 'firstTry')).toBe(1);
    await page.wait(700);
    page.window.Math.random = () => 0.1;
    page.$('#insert').click();
    expect(page.FZ.stat('usb', 'plugs')).toBe(1);
    page.window.Math.random = () => 0.9;
    page.$('#insert').click();
    expect(page.FZ.stat('usb', 'plugs')).toBe(2);
    expect(page.FZ.stat('usb', 'firstTry')).toBe(1);
  });
});

describe('Meeting Nods', () => {
  test('the right reply builds a streak; the wrong one breaks it', async () => {
    page = await openPage('/apps/aizuchi/');
    const answer = () => Number(page.$('#line').dataset.answer);
    page.$$('.reply')[answer()].click();
    page.$$('.reply')[answer()].click();
    expect(page.FZ.stat('aizuchi', 'nods')).toBe(2);
    expect(page.FZ.stat('aizuchi', 'streak')).toBe(2);
    page.$$('.reply')[(answer() + 1) % 3].click();
    page.$$('.reply')[answer()].click();
    expect(page.FZ.stat('aizuchi', 'nods')).toBe(3);
    expect(page.FZ.stat('aizuchi', 'streak')).toBe(2);
  });
});

describe('Bow-Off', () => {
  test('keep bowing until the other person rises, then rise: you win', async () => {
    page = await openPage('/apps/ojigi/', { random: () => 0 });   // 相手は1.5秒で頭を上げる
    down(page, page.$('#bow'));
    page.clock.ms += 2000; await page.wait(80);
    up(page);
    expect(page.FZ.stat('ojigi', 'wins')).toBe(1);
    expect(page.FZ.stat('ojigi', 'best')).toBe(2);
  });
  test('rising first loses', async () => {
    page = await openPage('/apps/ojigi/', { random: () => 0 });
    down(page, page.$('#bow'));
    page.clock.ms += 1000; await page.wait(80);
    up(page);
    expect(page.FZ.stat('ojigi', 'wins')).toBe(0);
    expect(page.FZ.stat('ojigi', 'losses')).toBe(1);
  });
});

describe('Label Peel', () => {
  test('peeling slowly gets the whole label; yanking tears it', async () => {
    page = await openPage('/apps/label/');
    const lb = page.$('#label');
    down(page, lb, 0, 50);
    for (let x = 20; x <= 320; x += 20) { page.clock.ms += 60; move(page, lb, x, 50); }
    up(page, 320, 50);
    expect(page.FZ.stat('label', 'labels')).toBe(1);
    down(page, page.$('#label'), 0, 50);
    page.clock.ms += 10;
    move(page, page.$('#label'), 200, 50);
    expect(page.FZ.stat('label', 'tears')).toBe(1);
    expect(page.FZ.stat('label', 'labels')).toBe(1);
  });
});

describe('Ticket Gate', () => {
  test('a proper touch passes; too short or too long gets the ping-pong', async () => {
    page = await openPage('/apps/kaisatsu/', { lang: 'ja' });
    const card = page.$('#card');
    const touch = async ms => { down(page, card); page.clock.ms += ms; up(page); await page.wait(10); };
    await touch(500);
    await touch(500);
    expect(page.FZ.stat('kaisatsu', 'passes')).toBe(2);
    expect(page.FZ.stat('kaisatsu', 'streak')).toBe(2);
    await touch(80);
    expect(page.text('#say')).toMatch(/ピンポーン/);
    await touch(1500);
    expect(page.FZ.stat('kaisatsu', 'passes')).toBe(2);
  });
});

describe('Static Shock', () => {
  test('rubbing builds charge; touching the knob zaps and records the voltage', async () => {
    page = await openPage('/apps/seidenki/');
    const rug = page.$('#carpet');
    down(page, rug, 0, 10);
    for (let i = 1; i <= 20; i++) move(page, rug, i % 2 ? 200 : 0, 10);
    up(page);
    expect(Number(page.$('#volt').dataset.v)).toBeGreaterThan(5000);
    page.$('#knob').click();
    expect(page.FZ.stat('seidenki', 'zaps')).toBe(1);
    expect(page.FZ.stat('seidenki', 'bestVolt')).toBeGreaterThan(5000);
    expect(Number(page.$('#volt').dataset.v)).toBe(0);
  });
});

describe('Cup Noodle Clock', () => {
  test('eating closest to 30 seconds (no timer shown) scores highest', async () => {
    page = await openPage('/apps/cupmen/');
    page.$('#pour').click();
    page.clock.ms += 30200;
    page.$('#eat').click();
    expect(page.FZ.stat('cupmen', 'bowls')).toBe(1);
    expect(page.FZ.stat('cupmen', 'best')).toBe(96);
  });
});

describe('Packed Train', () => {
  test('without balancing you eventually fall; time standing is recorded', async () => {
    page = await openPage('/apps/tsurikawa/', { random: () => 1 });   // ずっと同じ向きに揺れる
    page.$('#start').click();
    for (let i = 0; i < 40 && page.$('#start').hidden; i++) { page.clock.ms += 500; await page.wait(60); }
    expect(page.$('#start').hidden).toBe(false);
    expect(page.FZ.stat('tsurikawa', 'best')).toBeGreaterThan(0);
    expect(page.FZ.stat('tsurikawa', 'total')).toBeGreaterThan(0);
  });
});

describe('Snooze', () => {
  test('snoozing banks minutes when you get up; the boss calling loses them', async () => {
    page = await openPage('/apps/nidone/', { random: () => 0.99 });
    for (let i = 0; i < 3; i++) page.$('#snooze').click();
    page.$('#wake').click();
    expect(page.FZ.stat('nidone', 'minutes')).toBe(15);
    expect(page.FZ.stat('nidone', 'best')).toBe(15);
    page.window.Math.random = () => 0;
    page.$('#snooze').click();
    expect(page.FZ.stat('nidone', 'caught')).toBe(1);
    expect(page.FZ.stat('nidone', 'minutes')).toBe(15);
  });
});

describe('Almost Sneeze', () => {
  test('sneezing at the peak of the tickle gives the biggest sneeze', async () => {
    page = await openPage('/apps/kushami/');
    page.clock.ms += 700 * Math.PI / 2;      // むずむずが最大になる瞬間
    page.$('#sneeze').click();
    expect(page.FZ.stat('kushami', 'sneezes')).toBe(1);
    expect(page.FZ.stat('kushami', 'best')).toBe(100);
  });
  test('a weak tickle does not count as a sneeze', async () => {
    page = await openPage('/apps/kushami/');
    page.$('#sneeze').click();               // 始まった瞬間は0
    expect(page.FZ.stat('kushami', 'sneezes')).toBe(0);
  });
});

describe('Odd Sock', () => {
  test('finding the one matching pair scores; quick finds are counted', async () => {
    page = await openPage('/apps/kutsushita/');
    const socks = page.$$('.sock');
    expect(socks.length).toBe(12);
    const kinds = socks.map(s => s.dataset.kind);
    const dup = kinds.find((k, i) => kinds.indexOf(k) !== i);
    expect(kinds.filter(k => k === dup).length).toBe(2);
    const others = socks.filter(s => s.dataset.kind !== dup);
    others[0].click(); others[1].click();                  // 違う2足
    expect(page.FZ.stat('kutsushita', 'pairs')).toBe(0);
    const pair = socks.filter(s => s.dataset.kind === dup);
    page.clock.ms += 2000;
    pair[0].click(); pair[1].click();
    expect(page.FZ.stat('kutsushita', 'pairs')).toBe(1);
    expect(page.FZ.stat('kutsushita', 'quick')).toBe(1);
  });
});

describe('layout stays centered', () => {
  // 結果の長い文で外枠が広がっても、幅を決めた中身は真ん中に残る（以前ハンコ連打で左に寄った）
  test.each([['hanko', '#stage'], ['puchipuchi', '#sheet']])('%s keeps %s centered', async (id, sel) => {
    page = await openPage(`/apps/${id}/`);
    const cs = page.window.getComputedStyle(page.$(sel));
    expect(cs.marginLeft).toBe('auto');
    expect(cs.marginRight).toBe('auto');
  });
});
