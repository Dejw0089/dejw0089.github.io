/* ふざけ箱 共通基盤
 * 各アプリはこれを読み込んで FZ.add / FZ.max を呼ぶだけ。
 * 保存・音源の解放判定・解放演出・セーブコードはここでまとめて面倒を見る。
 *
 *   FZ.add('natto', 'rotations', 1)   // 累計に足す
 *   FZ.max('kyomu', 'best', 42)       // 最高記録を更新（大きいときだけ）
 *   FZ.stat('natto', 'rotations')     // 現在値
 */
(function () {
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

  // 解放ルールは全員共通の /data/unlocks.json
  let rules = null;
  const rulesReady = fetch('/data/unlocks.json')
    .then(r => r.json())
    .then(j => { rules = j; check(); return j; })
    .catch(() => (rules = []));

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
    if (!rules) return;
    for (const r of rules) {
      if (!state.unlocked.includes(r.id) && stat(r.app, r.stat) >= r.gte) {
        state.unlocked.push(r.id);
        save();
        celebrate(r);
      }
    }
  }

  // ---- 言語（デフォルト英語。進捗とは別に保存し、セーブコードにも含めない） ----
  const LKEY = 'fuzake-box-lang';
  let lang = 'en';
  try { if (localStorage.getItem(LKEY) === 'ja') lang = 'ja'; } catch (e) {}
  document.documentElement.lang = lang;
  function setLang(l) {
    try { localStorage.setItem(LKEY, l); } catch (e) {}
    location.reload();
  }
  // {en: '...', ja: '...'} から今の言語を取り出す。ただの文字列ならそのまま
  function t(v) { return v && typeof v === 'object' ? (v[lang] ?? v.en) : v; }
  // data-i18n="key"（テキスト）/ data-i18n-html="key"（改行入り）に辞書の文言を入れる
  function apply(dict) {
    const d = dict[lang] || dict.en;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = d[el.dataset.i18n]; });
    document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = d[el.dataset.i18nHtml]; });
    return d;
  }
  // 右上の EN / JA 切り替え
  function langToggle(parent) {
    const b = document.createElement('button');
    b.className = 'fz-lang';
    b.innerHTML = '<span' + (lang === 'en' ? ' class="on"' : '') + '>EN</span> / <span' + (lang === 'ja' ? ' class="on"' : '') + '>JA</span>';
    b.setAttribute('aria-label', lang === 'en' ? '日本語に切り替え' : 'Switch to English');
    b.onclick = () => setLang(lang === 'en' ? 'ja' : 'en');
    (parent || document.body).appendChild(b);
    return b;
  }

  // ---- 解放演出 ----
  function celebrate(rule) {
    const el = document.createElement('div');
    el.className = 'fz-toast';
    el.innerHTML = '<div class="fz-toast-small"></div><div class="fz-toast-big"></div>';
    el.querySelector('.fz-toast-small').textContent = lang === 'ja' ? '音源ゲット！' : 'SOUND UNLOCKED!';
    el.querySelector('.fz-toast-big').textContent = '♪ ' + t(rule.name);
    document.body.appendChild(el);
    try { new Audio(rule.file).play().catch(() => {}); } catch (e) {}
    setTimeout(() => el.classList.add('fz-out'), 2600);
    setTimeout(() => el.remove(), 3200);
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
    add, max, stat,
    unlocked: () => state.unlocked.slice(),
    rules: () => rulesReady,
    exportCode, importCode, reset,
    lang: () => lang, setLang, t, apply, langToggle,
  };
})();
