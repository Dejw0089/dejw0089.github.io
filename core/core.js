/* 共通基盤（トップの「無駄コーナー」と apps/ の各ゲーム）
 * 各アプリはこれを読み込んで FZ.add / FZ.max を呼ぶだけ。
 * 保存・音源の解放判定・解放演出・セーブコードはここでまとめて面倒を見る。
 *
 *   FZ.add('natto', 'rotations', 1)   // 累計に足す
 *   FZ.max('kyomu', 'best', 42)       // 最高記録を更新（大きいときだけ）
 *   FZ.stat('natto', 'rotations')     // 現在値
 */
(function () {
  // 更新したらここと各HTMLの ?v= を上げる（GitHub Pagesのキャッシュ対策）
  const V = '8';
  const KEY = 'fuzake-box-v1';
  const blank = () => ({ v: 1, stats: {}, unlocked: [], since: Date.now() });

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1) return s;
    } catch (e) {}
    return blank();
  }
  let state = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // iOS Safari などでデータが消されにくくなるよう頼んでおく（断られても気にしない）
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

  // 音源と「ドロップ」（各ゲームの到達点）は全員共通の /data/unlocks.json
  //   sounds: 音源の一覧 / drops: 「app の stat が gte 以上」になるたびに、まだ持っていない音源がランダムに1つ出る
  let data = null;
  const rulesReady = fetch('/data/unlocks.json?v=' + V)
    .then(r => r.json())
    .then(j => { data = j; check(); return j.sounds; })
    .catch(() => { data = { sounds: [], drops: [] }; return []; });

  function stat(app, name) {
    return (state.stats[app] && state.stats[app][name]) || 0;
  }
  function set(app, name, val) {
    (state.stats[app] = state.stats[app] || {})[name] = val;
    save();
    check();
  }
  function add(app, name, delta = 1) { set(app, name, stat(app, name) + delta); }
  function max(app, name, val) { if (val > stat(app, name)) set(app, name, val); }

  function check() {
    if (!data) return;
    state.drops = state.drops || [];
    state.dropSounds = state.dropSounds || {};   // どの到達点でどの音源が出たか（アプリのページに出す）
    for (const d of data.drops) {
      if (state.drops.includes(d.id) || stat(d.app, d.stat) < d.gte) continue;
      state.drops.push(d.id);
      const pool = data.sounds.filter(s => !state.unlocked.includes(s.id));
      if (pool.length) {
        const s = pool[Math.floor(Math.random() * pool.length)];
        state.unlocked.push(s.id);
        state.dropSounds[d.id] = s.id;
        freshDrops.add(d.id);
        celebrate(s);
      }
      save();
    }
    paintDrops();
  }

  // ---- アプリのページ：そのゲームの到達点（条件・進み具合・出た音源）を上に小さく並べる ----
  // /apps/<id>/ なら自動で出す。スクロールさせないよう、画面上部に固定した1〜2行のチップにする
  const PAGE_APP = (location.pathname.match(/^\/apps\/([^/]+)\//) || [])[1];
  // アプリから戻ったとき、トップは「無駄コーナー」の位置から見せる（箱が開いているときだけ。トップ側で見る）
  if (PAGE_APP) { try { sessionStorage.setItem('fz-from-app', PAGE_APP); } catch (e) {} }   // どのゲームから戻ったか
  let dropsEl = null;
  const freshDrops = new Set();   // このページで今取ったもの（チップを光らせる）
  function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
  function paintDrops() {
    if (!PAGE_APP || !data || !document.body) return;
    const mine = data.drops.filter(d => d.app === PAGE_APP);
    if (!mine.length) return;
    if (!dropsEl) {
      dropsEl = document.createElement('div');
      dropsEl.className = 'fz-drops';
      document.body.appendChild(dropsEl);
      document.body.classList.add('fz-has-drops');
    }
    dropsEl.textContent = '';
    const got = mine.filter(d => (state.drops || []).includes(d.id)).length;
    const head = document.createElement('span');
    head.className = 'fz-drops-head';
    head.textContent = '♪ ' + got + '/' + mine.length;
    dropsEl.appendChild(head);
    for (const d of mine) {
      const chip = document.createElement('span');
      const done = (state.drops || []).includes(d.id);
      chip.className = 'fz-drop' + (done ? ' got' : '') + (freshDrops.has(d.id) ? ' fresh' : '');
      const sid = state.dropSounds && state.dropSounds[d.id];
      const snd = sid && data.sounds.find(s => s.id === sid);
      if (done) {
        chip.textContent = '✓ ' + t(d.label) + (snd ? ' → ' + t(snd.name) : '');
      } else {
        chip.textContent = '🔒 ' + t(d.label) + ' ' + fmt(Math.min(stat(d.app, d.stat), d.gte)) + '/' + d.gte;
      }
      dropsEl.appendChild(chip);
    }
    // 中身が帯の下に収まるよう、帯の高さぶんだけ上をあける（行数は画面幅で変わる）
    document.body.style.setProperty('--fz-top', Math.ceil(dropsEl.getBoundingClientRect().bottom + 6) + 'px');
  }

  // ---- 言語（デフォルト英語。進捗とは別に保存し、セーブコードにも含めない） ----
  const LKEY = 'fuzake-box-lang';
  let lang = 'en';
  try { if (localStorage.getItem(LKEY) === 'ja') lang = 'ja'; } catch (e) {}
  document.documentElement.lang = lang;
  // 切り替えはリロードせずその場で書き換える（ページは FZ.onLang で再描画を登録する）
  let dictRef = null;
  const langListeners = [];
  const toggles = [];
  function setLang(l) {
    if (l === lang) return;
    lang = l;
    try { localStorage.setItem(LKEY, l); } catch (e) {}
    document.documentElement.lang = lang;
    if (dictRef) apply(dictRef);
    toggles.forEach(paintToggle);
    paintDrops();
    langListeners.forEach(fn => fn(lang));
  }
  function onLang(fn) { langListeners.push(fn); }
  // {en: '...', ja: '...'} から今の言語を取り出す。ただの文字列ならそのまま
  function t(v) { return v && typeof v === 'object' ? (v[lang] ?? v.en) : v; }
  // data-i18n="key"（テキスト）/ data-i18n-html="key"（改行入り）に辞書の文言を入れる
  function apply(dict) {
    dictRef = dict;
    const d = dict[lang] || dict.en;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = d[el.dataset.i18n]; });
    document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = d[el.dataset.i18nHtml]; });
    return d;
  }
  // 右上の EN / JA 切り替え
  function paintToggle(b) {
    b.innerHTML = '<span' + (lang === 'en' ? ' class="on"' : '') + '>EN</span> / <span' + (lang === 'ja' ? ' class="on"' : '') + '>JA</span>';
    b.setAttribute('aria-label', lang === 'en' ? '日本語に切り替え' : 'Switch to English');
  }
  function langToggle(parent) {
    const b = document.createElement('button');
    b.className = 'fz-lang';
    paintToggle(b);
    b.onclick = () => setLang(lang === 'en' ? 'ja' : 'en');
    (parent || document.body).appendChild(b);
    toggles.push(b);
    return b;
  }

  // 全音源を一気に解放（ズル用）。解放演出は出さない
  async function unlockAll() {
    const rs = await rulesReady;
    for (const r of rs) if (!state.unlocked.includes(r.id)) state.unlocked.push(r.id);
    save();
  }

  // ---- 獲得演出：画面の真ん中にカード＋紙吹雪。その音源を1回鳴らす ----
  // 一度に複数出たら順番に。タップで閉じる／4秒で自動で閉じる。
  // てんかんへの配慮で明滅はさせない（ポンと出て、紙吹雪が落ちるだけ）。視差効果を減らす設定なら紙吹雪もなし
  const toastQueue = [];
  let toasting = false;
  function celebrate(sound) {
    toastQueue.push(sound);
    if (!toasting) nextToast();
  }
  function nextToast() {
    const sound = toastQueue.shift();
    if (!sound) { toasting = false; return; }
    toasting = true;
    const el = document.createElement('div');
    el.className = 'fz-unlock';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="fz-confetti" aria-hidden="true"></div>' +
      '<div class="fz-unlock-card"><div class="fz-unlock-title"></div><div class="fz-unlock-name"></div>' +
      '<div class="fz-unlock-bpm"></div><div class="fz-unlock-hint"></div></div>';
    el.querySelector('.fz-unlock-title').textContent = lang === 'ja' ? '音源ゲット！' : 'NEW SOUND!';
    el.querySelector('.fz-unlock-name').textContent = t(sound.name);
    el.querySelector('.fz-unlock-bpm').textContent = sound.bpm + ' BPM';
    el.querySelector('.fz-unlock-hint').textContent = lang === 'ja' ? 'トップの「グルーヴ機」で鳴らせます（タップで閉じる）' : 'Play it in the Groove Machine on the top page (tap to close)';
    let calm = false;
    try { calm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (!calm) {
      const box = el.querySelector('.fz-confetti');
      const colors = ['#ff8fa3', '#ffe066', '#8ce99a', '#74c0fc', '#b197fc', '#ffa94d'];
      for (let i = 0; i < 36; i++) {
        const p = document.createElement('i');
        p.style.setProperty('--x', (Math.random() * 100).toFixed(1) + '%');
        p.style.setProperty('--dx', (Math.random() * 120 - 60).toFixed(0) + 'px');
        p.style.setProperty('--r', (Math.random() * 720 - 360).toFixed(0) + 'deg');
        p.style.setProperty('--d', (1.4 + Math.random() * 1.2).toFixed(2) + 's');
        p.style.setProperty('--delay', (Math.random() * 0.25).toFixed(2) + 's');
        p.style.background = colors[i % colors.length];
        box.appendChild(p);
      }
    }
    document.body.appendChild(el);
    try { new Audio(sound.file).play().catch(() => {}); } catch (e) {}
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      el.classList.add('fz-out');
      setTimeout(() => { el.remove(); nextToast(); }, 300);
    };
    el.addEventListener('click', close);
    const timer = setTimeout(close, 4000);
  }

  // ---- セーブコード（端末の引っ越し・Safariに消された時の保険） ----
  function hash(str) {
    let h = 7;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function exportCode() {
    const body = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    return 'FZ1.' + body + '.' + hash(body);
  }
  function importCode(code) {
    const parts = String(code).trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'FZ1' || hash(parts[1]) !== parts[2]) {
      throw new Error(lang === 'ja' ? 'セーブコードが壊れているか、別物です' : 'That save code is broken or not ours.');
    }
    const s = JSON.parse(decodeURIComponent(escape(atob(parts[1]))));
    if (!s || s.v !== 1) throw new Error(lang === 'ja' ? '対応していないバージョンです' : 'Unsupported save version.');
    state = s;
    save();
  }
  function reset() { state = blank(); save(); }

  window.FZ = {
    add, max, stat, set,
    unlocked: () => state.unlocked.slice(),
    rules: () => rulesReady,
    catalog: () => rulesReady.then(() => data),   // 音源・到達点・おすすめ・同時に鳴らせる数
    unlockAll,
    exportCode, importCode, reset,
    lang: () => lang, setLang, onLang, t, apply, langToggle, V,
  };
})();
