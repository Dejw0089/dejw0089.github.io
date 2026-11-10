/* テスト用：リポジトリのページを jsdom で本物に近い形で開く
 *
 *   const page = await openPage('/', { lang: 'ja', save: {...} });
 *   page.$('#play').click();
 *   page.FZ.stat('top', 'bpm');
 *
 * - /core/core.js などはリポジトリのファイルをそのまま読み込む（ビルドなし）
 * - fetch / AudioContext / 時計 / confirm などブラウザ依存のものは差し替える
 * - confirm() は既定で false を返す（Claude のブラウザやアプリ内ブラウザで実際にそうなるため）
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const ORIGIN = 'http://localhost';
const SAVE_KEY = 'fuzake-box-v1';

function fileFor(url) {
  const u = new URL(url, ORIGIN);
  if (u.origin !== ORIGIN) return null;
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  return f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null;
}

class LocalLoader extends ResourceLoader {
  fetch(url) {
    const f = fileFor(url);
    if (!f) return null;                       // 外部（Google Fonts など）は読まない
    return Promise.resolve(fs.readFileSync(f));
  }
}

// WAV のヘッダから長さ（秒）を読む
function wavDuration(buf) {
  const sr = buf.readUInt32LE(24), ch = buf.readUInt16LE(22), bits = buf.readUInt16LE(34);
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'data') return size / (sr * ch * bits / 8);
    off += 8 + size;
  }
  throw new Error('no data chunk');
}

// ---- 偽の WebAudio：何がいつ鳴っているかを記録する ----
function makeAudio(clock) {
  const contexts = [];
  const param = v => ({ value: v, setValueAtTime() {}, setTargetAtTime(x) { this.value = x; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = extra => Object.assign({ connect(n) { this.dest = n; return n || this; }, disconnect() {} }, extra);
  class FakeAudioContext {
    constructor() {
      this.active = new Set();
      this.started = [];
      this.state = 'running';
      this.sampleRate = 22050;
      this.destination = node({});
      this.outputLatency = 0;
      this.baseLatency = 0;
      contexts.push(this);
    }
    get currentTime() { return clock.ms / 1000; }
    resume() { return Promise.resolve(); }
    createBufferSource() {
      const ctx = this;
      return node({
        buffer: null, loop: false,
        start(t) { ctx.active.add(this); ctx.started.push(this); this.when = t; },
        stop() { ctx.active.delete(this); },
      });
    }
    createGain() { return node({ gain: param(1) }); }
    createOscillator() { return node({ type: 'sine', frequency: param(440), start() {}, stop() {} }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1) }); }
    createDynamicsCompressor() { return node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }); }
    createBuffer(ch, n, sr) { const d = new Float32Array(n); return { duration: n / sr, length: n, getChannelData: () => d }; }
    decodeAudioData(ab) { return Promise.resolve({ duration: wavDuration(Buffer.from(ab)) }); }
  }
  return { FakeAudioContext, contexts };
}

async function openPage(urlPath, opts = {}) {
  const clock = { ms: 1000 };
  const audio = makeAudio(clock);
  const errors = [];
  const navigations = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    if (/navigation/i.test(e.message)) navigations.push(e.message);   // location.reload() など
    else errors.push(e.message + (e.detail ? ' ' + e.detail : ''));
  });
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const file = fileFor(urlPath);
  if (!file) throw new Error('no page ' + urlPath);
  const html = fs.readFileSync(file, 'utf8');
  const scrolls = [];

  const dom = new JSDOM(html, {
    url: ORIGIN + urlPath,
    runScripts: 'dangerously',
    resources: new LocalLoader(),
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      if (opts.lang) w.localStorage.setItem('fuzake-box-lang', opts.lang);
      if (opts.save) w.localStorage.setItem(SAVE_KEY, JSON.stringify(Object.assign({ v: 1, stats: {}, unlocked: [], since: 1 }, opts.save)));
      for (const [k, v] of Object.entries(opts.local || {})) w.localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(opts.session || {})) w.sessionStorage.setItem(k, v);

      w.fetch = url => {
        const f = fileFor(new URL(url, w.location.href).href);
        if (!f) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404 ' + url)) });
        const buf = fs.readFileSync(f);
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(JSON.parse(buf.toString('utf8'))),
          text: () => Promise.resolve(buf.toString('utf8')),
          arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
        });
      };
      w.AudioContext = audio.FakeAudioContext;
      w.webkitAudioContext = audio.FakeAudioContext;
      w.HTMLMediaElement.prototype.play = function () { (w.__played = w.__played || []).push(this.src); return Promise.resolve(); };
      w.matchMedia = q => ({ matches: /reduce/.test(q) ? !!opts.reducedMotion : false, media: q, addEventListener() {}, removeEventListener() {} });
      w.confirm = () => (opts.confirm === undefined ? false : opts.confirm);
      w.alert = () => {};
      w.Element.prototype.scrollIntoView = function () { scrolls.push(this); };
      w.Element.prototype.setPointerCapture = function () {};
      w.Element.prototype.releasePointerCapture = function () {};
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
      if (!w.PointerEvent) w.PointerEvent = class PointerEvent extends w.MouseEvent {};
      Object.defineProperty(w.performance, 'now', { configurable: true, value: () => clock.ms });
      if (opts.random) w.Math.random = opts.random;
    },
  });
  const w = dom.window;
  await new Promise(r => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', r)));
  const page = {
    window: w, document: w.document, dom, clock, audio, errors, navigations, scrolls,
    get FZ() { return w.FZ; },
    $: sel => w.document.querySelector(sel),
    $$: sel => [...w.document.querySelectorAll(sel)],
    text: sel => (w.document.querySelector(sel) || {}).textContent,
    // 実時間で少し待つ（fetch の Promise や setTimeout を流す）
    wait: (ms = 30) => new Promise(r => setTimeout(r, ms)),
    // 偽の時計を進めて、その間のタイマーも流す
    async advance(ms, step = 50) {
      for (let t = 0; t < ms; t += step) { clock.ms += Math.min(step, ms - t); await new Promise(r => setTimeout(r, 1)); }
      await new Promise(r => setTimeout(r, 20));
    },
    save: () => JSON.parse(w.localStorage.getItem(SAVE_KEY) || 'null'),
    pointer(el, type, init = {}) { el.dispatchEvent(new w.PointerEvent(type, Object.assign({ bubbles: true, cancelable: true }, init))); },
    close() { w.close(); },
  };
  await page.wait(60);   // FZ のデータ読み込みとページの初期描画を待つ
  return page;
}

const readJSON = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

module.exports = { openPage, ROOT, readJSON, wavDuration, SAVE_KEY };
