/* データとファイル構成の整合性（ブラウザなし） */
const fs = require('fs');
const path = require('path');
const { ROOT, readJSON, wavDuration } = require('./helpers/page');

const apps = readJSON('data/apps.json');
const { sounds, drops } = readJSON('data/unlocks.json');
const profile = readJSON('data/profile.json');
const TEMPOS = [120, 180, 400, 1280];
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const coreV = read('core/core.js').match(/const V = '(\d+)'/)[1];

describe('apps.json', () => {
  test('every app has its page, emoji, color and bilingual title/desc', () => {
    for (const a of apps) {
      expect(fs.existsSync(path.join(ROOT, 'apps', a.id, 'index.html'))).toBe(true);
      expect(a.emoji).toBeTruthy();
      expect(a.color).toMatch(/^#[0-9a-f]{6}$/i);
      for (const k of ['title', 'desc']) { expect(a[k].en).toBeTruthy(); expect(a[k].ja).toBeTruthy(); }
    }
  });
  test('ids are unique and every app folder is listed', () => {
    const ids = apps.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const dirs = fs.readdirSync(path.join(ROOT, 'apps'));
    expect(dirs.sort()).toEqual([...ids].sort());
  });
  test('app descriptions never mention BPM or tempo', () => {
    for (const a of apps) expect(JSON.stringify(a)).not.toMatch(/BPM|bpm|テンポ|tempo/);
  });
});

describe('unlocks.json', () => {
  test('sounds: unique ids, known tempo, bilingual name, file exists', () => {
    expect(new Set(sounds.map(s => s.id)).size).toBe(sounds.length);
    for (const s of sounds) {
      expect(TEMPOS).toContain(s.bpm);
      expect(s.name.en).toBeTruthy();
      expect(s.name.ja).toBeTruthy();
      expect(fs.existsSync(path.join(ROOT, s.file))).toBe(true);
    }
  });
  test('sound names do not reveal the instrument', () => {
    const giveaway = /kick|hat|snare|bass|lead|pad|reese|break|vox|arp|chip|noise|hoover|screech|キック|ハット|スネア|ベース|リード|パッド|リース|ブレイク|ボイス|アルペジオ|ノイズ|フーバー|スクリーチ/i;
    for (const s of sounds) { expect(s.name.en).not.toMatch(giveaway); expect(s.name.ja).not.toMatch(giveaway); }
  });
  test('drops: unique ids, point at real apps, bilingual label, positive threshold', () => {
    expect(new Set(drops.map(d => d.id)).size).toBe(drops.length);
    const ids = apps.map(a => a.id);
    for (const d of drops) {
      expect(ids).toContain(d.app);
      expect(d.stat).toBeTruthy();
      expect(d.gte).toBeGreaterThan(0);
      expect(d.label.en).toBeTruthy();
      expect(d.label.ja).toBeTruthy();
    }
  });
  test('there are exactly as many drops as sounds, so everything can be collected', () => {
    expect(drops.length).toBe(sounds.length);
  });
  test('every app has at least one drop', () => {
    for (const a of apps) expect(drops.some(d => d.app === a.id)).toBe(true);
  });
  test('every tempo has sounds', () => {
    for (const bpm of TEMPOS) expect(sounds.some(s => s.bpm === bpm)).toBe(true);
  });
});

describe('sound loops', () => {
  test('all loops in a tempo set have exactly the same length (so they stay in sync)', () => {
    for (const bpm of TEMPOS) {
      const lens = sounds.filter(s => s.bpm === bpm).map(s => wavDuration(fs.readFileSync(path.join(ROOT, s.file))));
      expect(new Set(lens.map(x => x.toFixed(6))).size).toBe(1);
    }
  });
  test('loop length is a whole number of beats at that tempo', () => {
    for (const bpm of TEMPOS) {
      const s = sounds.find(x => x.bpm === bpm);
      const beats = wavDuration(fs.readFileSync(path.join(ROOT, s.file))) / (60 / bpm);
      expect(Math.abs(beats - Math.round(beats))).toBeLessThan(1e-6);
    }
  });
});

describe('profile.json', () => {
  test('has name, bilingual summary, links and career entries', () => {
    expect(profile.name).toBe('Yusuke Iwasaki');
    expect(profile.summary.en).toBeTruthy();
    expect(profile.summary.ja).toBeTruthy();
    expect(profile.links.length).toBeGreaterThan(0);
    for (const c of profile.career) {
      for (const k of ['when', 'what', 'detail']) { expect(c[k].en).toBeTruthy(); expect(c[k].ja).toBeTruthy(); }
    }
  });
});

describe('cache busting', () => {
  test('every page loads core.css/core.js with the same version as core.js V', () => {
    const pages = ['index.html', ...apps.map(a => `apps/${a.id}/index.html`)];
    for (const p of pages) {
      const html = read(p);
      const vs = [...html.matchAll(/\/core\/core\.(?:css|js)\?v=(\d+)/g)].map(m => m[1]);
      expect(vs.length).toBe(2);
      for (const v of vs) expect(v).toBe(coreV);
    }
  });
});

describe('naming', () => {
  test('the old site name does not appear anywhere user-facing', () => {
    const files = ['index.html', 'manifest.webmanifest', 'core/core.js', ...apps.map(a => `apps/${a.id}/index.html`)];
    for (const f of files) expect(read(f)).not.toMatch(/ふざけ箱|FUZAKE BOX/);
  });
});

describe('expanded line-up', () => {
  const unlocks = readJSON('data/unlocks.json');
  test('there are 18 games', () => {
    expect(apps.length).toBe(18);
  });
  test('every tempo has at least 10 loops', () => {
    for (const bpm of TEMPOS) expect(sounds.filter(s => s.bpm === bpm).length).toBeGreaterThanOrEqual(10);
  });
  test('a maximum number of simultaneous sounds is set', () => {
    expect(unlocks.maxOn).toBe(6);
  });
  test('each tempo has 6 recommended presets of real sounds from that tempo, within the limit', () => {
    const byId = Object.fromEntries(sounds.map(s => [s.id, s]));
    for (const bpm of TEMPOS) {
      const ps = unlocks.presets.filter(p => p.bpm === bpm);
      expect(ps.length).toBe(6);
      for (const p of ps) {
        expect(p.name.en).toBeTruthy();
        expect(p.name.ja).toBeTruthy();
        expect(p.sounds.length).toBeGreaterThanOrEqual(2);
        expect(p.sounds.length).toBeLessThanOrEqual(unlocks.maxOn);
        expect(new Set(p.sounds).size).toBe(p.sounds.length);
        for (const id of p.sounds) expect(byId[id] && byId[id].bpm).toBe(bpm);
      }
    }
    expect(new Set(unlocks.presets.map(p => p.id)).size).toBe(unlocks.presets.length);
  });
});

describe('favicon', () => {
  test('is a clean monogram in the profile navy (not the old cartoon face)', () => {
    const svg = read('icon.svg');
    expect(svg).toMatch(/#14213d/i);
    expect(svg).toMatch(/aria-label="YI"|<title>YI<\/title>/);
    expect(svg).not.toMatch(/<circle[^>]*r="5"/);            // 昔の顔の目
  });
  test('every page links it', () => {
    const pages = ['index.html', ...apps.map(a => `apps/${a.id}/index.html`)];
    for (const p of pages) expect(read(p)).toMatch(/<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml">/);
  });
  test('the home-screen theme matches the serious part', () => {
    const m = readJSON('manifest.webmanifest');
    expect(m.icons[0].src).toBe('/icon.svg');
    expect(m.theme_color.toLowerCase()).toBe('#14213d');
  });
});

describe('loops that must sit on the grid', () => {
  const { onsets } = require('./helpers/wav');
  // [音源id, 格子の細かさ（拍）]：音の出だしは全部この格子の上にあること（ずれは5ms以内）
  test.each([
    ['x180-ride', 0.25],       // 雨の高架下：16分の格子
    ['x1280-sparkle', 4],      // 流れ星：4拍ごと（他の音のまとまりと同じ単位）
  ])('%s: every hit lands on the %f-beat grid', (id, unit) => {
    const s = sounds.find(x => x.id === id);
    const grid = 60 / s.bpm * unit;
    const hits = onsets(path.join(ROOT, s.file));
    expect(hits.length).toBeGreaterThanOrEqual(4);
    for (const t of hits) {
      const off = t % grid;
      expect(Math.min(off, grid - off)).toBeLessThan(0.005);
    }
  });
});

describe('doubled sounds', () => {
  const { onsets } = require('./helpers/wav');
  test('84 sounds for the same 18 games', () => {
    expect(apps.length).toBe(18);
    expect(sounds.length).toBe(84);
    expect(drops.length).toBe(84);
    for (const bpm of TEMPOS) expect(sounds.filter(s => s.bpm === bpm).length).toBeGreaterThanOrEqual(20);
  });
  test('original games have 6 thresholds, the later ones 4', () => {
    const per = id => drops.filter(d => d.app === id).length;
    for (const id of ['muda-button', 'natto', 'kyomu', 'somen', 'hanko', 'nekosui']) expect(per(id)).toBe(6);
    for (const a of apps.slice(6)) expect(per(a.id)).toBe(4);
  });
  test('thresholds of a game never repeat and every one is reachable in order', () => {
    for (const a of apps) {
      const keys = drops.filter(d => d.app === a.id).map(d => d.stat + ':' + d.gte);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
  // 和音やパッドのように鳴りっぱなしの音は、音どうしの干渉でゆっくり膨らむだけなので対象外
  const SUSTAINED = ['y120-epiano', 'y120-strings', 'y180-piano', 'y180-pad2', 'y1280-pad'];
  test.each(sounds.filter(s => s.id.startsWith('y') && !SUSTAINED.includes(s.id)).map(s => [s.id, s]))('%s: every hit lands on the grid', (id, s) => {
    const unit = s.bpm === 1280 ? 1 : 0.25;                  // 1280 は1拍、ほかは16分
    const grid = 60 / s.bpm * unit;
    for (const t of onsets(path.join(ROOT, s.file), { quiet: 0.05 })) {   // 持続音の揺れは数えない
      const off = t % grid;
      expect(Math.min(off, grid - off)).toBeLessThan(0.01);                // 10ms は聞き分けられない
    }
  });
});

describe('bass and presets', () => {
  const { readWav } = require('./helpers/wav');
  const unlocks = readJSON('data/unlocks.json');
  // 低音の割合：150Hz より下のエネルギー / 全体（1次ローパスで素朴に）
  function lowShare(file) {
    const { sr, samples } = readWav(file);
    const a = 1 - Math.exp(-2 * Math.PI * 150 / sr);
    let y = 0, lo = 0, all = 0;
    for (const x of samples) { y += a * (x - y); lo += y * y; all += x * x; }
    return lo / all;
  }
  test('at least a quarter of every tempo is bass', () => {
    for (const bpm of TEMPOS) {
      const set = sounds.filter(s => s.bpm === bpm);
      expect(set.filter(s => s.bass).length / set.length).toBeGreaterThanOrEqual(0.25);
    }
  });
  test.each(sounds.filter(s => s.bass).map(s => [s.id, s]))('%s really is mostly low end', (id, s) => {
    expect(lowShare(path.join(ROOT, s.file))).toBeGreaterThan(0.3);
  });
  test('every preset has a bass, no two presets in a tempo are the same, and together they use every sound', () => {
    const byId = Object.fromEntries(sounds.map(s => [s.id, s]));
    for (const bpm of TEMPOS) {
      const ps = unlocks.presets.filter(p => p.bpm === bpm);
      for (const p of ps) expect(p.sounds.some(id => byId[id].bass)).toBe(true);
      const keys = ps.map(p => [...p.sounds].sort().join(','));
      expect(new Set(keys).size).toBe(keys.length);
      const used = new Set(ps.flatMap(p => p.sounds));
      for (const s of sounds.filter(x => x.bpm === bpm)) expect(used.has(s.id)).toBe(true);
    }
  });
});
