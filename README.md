# ふざけ箱

クソゲー・バカアプリ置き場。遊ぶと音源がたまり、トップの「グルーヴ機」で重ねて鳴らせる。

公開URL: https://yusuke-iw.github.io/

## 構成

```
index.html            トップ（アプリ一覧・グルーヴ機・セーブコード）
core/core.js          共通基盤：保存・解放判定・解放演出・セーブコード
core/core.css         共通スタイル（ヘッダー・トースト）
data/apps.json        アプリ一覧
data/unlocks.json     音源の解放ルール（全員共通）
apps/<id>/index.html  各アプリ
sounds/*.wav          音源ループ（全部 120BPM・2小節 = 4秒）
tools/make_sounds.py  音源ループの合成スクリプト
```

## データの持ち方

- 進捗はブラウザの localStorage（キー `fuzake-box-v1`）に保存。サーバーなし。
- 形は `{ v: 1, stats: { <アプリid>: { <項目>: 数値 } }, unlocked: [<音源id>], since }`。
- 解放ルールは `data/unlocks.json`：「`app` の `stat` が `gte` 以上になったら `id` の音源を解放」。
- 消えたとき・端末の引っ越し用に、トップの「セーブ」からセーブコード（`FZ1.` で始まる文字列）を出し入れできる。

## アプリの増やし方

1. `apps/<新しいid>/index.html` を作る。中で `/core/core.css` と `/core/core.js` を読み込む。
2. 遊んだ実績を報告する：
   - 累計に足す … `FZ.add('<id>', '<項目>', 1)`
   - 最高記録 … `FZ.max('<id>', '<項目>', 値)`
3. `data/apps.json` に1行足す（トップに出る）。
4. 音源をつけるなら `sounds/` にファイルを置き、`data/unlocks.json` にルールを1行足す。
   グルーヴ機で他と合わせたいなら 120BPM・4秒ちょうどのループにする（WAV推奨。MP3は継ぎ目に隙間が出やすい）。

解放判定・「音源ゲット！」の演出・保存は core.js が自動でやるので、アプリ側は報告するだけでよい。

## キャッシュ対策

GitHub Pages はファイルを約10分キャッシュするので、core や data を変えたら `core/core.js` の `V` と各HTMLの `?v=` を同じ数字で上げる。

## 英語・日本語

- デフォルトは英語。右上の `EN / JA` で切り替え、選択はブラウザに保存（キー `fuzake-box-lang`。セーブコードには含めない）。
- JSONの文言は `{ "en": "...", "ja": "..." }` で書く（`FZ.t(値)` が今の言語を取り出す。ただの文字列ならそのまま）。
- ページの固定文言は `const T = { en: {...}, ja: {...} }` に書き、要素に `data-i18n="キー"`（改行入りは `data-i18n-html`）を付けて `FZ.apply(T)` を呼ぶ。切り替えボタンは `FZ.langToggle(親要素)`。

## ローカルで動かす

パスがルート基準（`/core/...`）なので、ファイルを直接開くのではなくリポジトリ直下でサーバーを立てる：

```
python3 -m http.server 8000
# → http://localhost:8000/
```
