# このリポジトリでの作業ルール

Yusuke Iwasaki のプロフィールサイト（GitHub Pages）。上が真面目なプロフィール、下が「無駄コーナー」（クソゲー詰め合わせ＋グルーヴ機）。ビルドなしの素の HTML / JS。構成やデータの持ち方は README.md を参照。

## TDD で進める

1. 変更・機能追加・バグ修正は、まず **失敗するテスト** を `tests/` に書き、`npm test` で赤になるのを確認する。
2. 実装して緑にする。
3. 整える（テストは緑のまま）。
4. バグを直したら、その再発を防ぐテストを必ず1つ足す。

- ページは `tests/helpers/page.js` の `openPage(path, opts)` で開く。時計は `page.clock.ms` を進める。乱数は `opts.random` / `page.window.Math.random` で固定する。
- `confirm()` / `alert()` には頼らない（アプリ内ブラウザで黙って false になる）。テストのハーネスも既定で false を返す。
- 文言を変えたらテストの期待値も合わせて更新する。

## 変更するときの約束

- `core/` や `data/` を変えたら、`core/core.js` の `V` と各 HTML の `?v=` を同じ数字で上げる（`tests/data.test.js` が見張っている）。
- 進捗の保存キー `fuzake-box-v1` は変えない（変えると訪問者の進捗が消える）。
- ゲーム（`apps/`）は BPM やテンポと無関係に、それ単体でクソゲーとして成立させる。音源はどのゲームからもランダムに出る。
- 音源名は何の楽器か分からない名前にする。
- 光の演出は、てんかんへの配慮として毎秒2回以下・枠の中だけ・ふわっと変化。`prefers-reduced-motion` なら控える。
- 音源は `python3 tools/make_sounds.py`（numpy のみ）で作り直せる。120BPM の6つはバイト単位で変わらないこと。
