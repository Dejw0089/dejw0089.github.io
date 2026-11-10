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
