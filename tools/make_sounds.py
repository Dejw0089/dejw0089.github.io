"""ふざけ箱の音源ループを合成して sounds/ に書き出す。

テンポごとに1セット。同じセットの中は全部同じ長さなので、グルーヴ機で同時に鳴らすとピッタリ合う。
  120 BPM : 2小節 (4.0秒)      → sounds/*.wav       （最初からある6つ）
  180 BPM : 4小節 (5.333…秒)   → sounds/180/*.wav   （DnB：暗めの2ステップ＋リース）
  400 BPM : 4小節 (2.4秒)      → sounds/400/*.wav   （speedcore：8分キック＝毎分800発＋スクリーチ）
  1280 BPM: 4小節 (3.0秒)      → sounds/1280/*.wav  （extratone：キックがブザーになる＋チップチューン）
共通: 22050Hz モノラル 16bit。どのセットも長さがサンプル数でちょうど割り切れる。

使い方: python3 tools/make_sounds.py   （numpy だけあればいい）
"""
import os
import wave
import numpy as np

SR = 22050
ROOT = os.path.join(os.path.dirname(__file__), "..", "sounds")
rng = np.random.default_rng(42)

# テンポ設定（setup() で切り替える）
BEAT = LEN = OUT = None


def setup(bpm, beats, sub=""):
    global BEAT, LEN, OUT
    BEAT = 60 / bpm
    LEN = round(SR * BEAT * beats)
    OUT = os.path.join(ROOT, sub)
    os.makedirs(OUT, exist_ok=True)


def t(n):
    return np.arange(n) / SR


def env(n, attack=0.005, decay=0.2):
    x = t(n)
    a = np.clip(x / attack, 0, 1)
    return a * np.exp(-x / decay)


def place(buf, sig, beat):
    i = int(beat * BEAT * SR)
    end = min(len(buf), i + len(sig))
    buf[i:end] += sig[: end - i]


def place_wrap(buf, sig, beat):
    """はみ出した分をループの頭に回す（残響がループの継ぎ目で切れない）"""
    i = int(beat * BEAT * SR) % len(buf)
    idx = (i + np.arange(len(sig))) % len(buf)
    np.add.at(buf, idx, sig)


def note(freq):
    return 440 * 2 ** ((freq - 69) / 12)


def save(name, buf, gain=0.8):
    buf = buf / (np.max(np.abs(buf)) + 1e-9) * gain
    # ループの継ぎ目でプツッと鳴らないよう端を数msフェード
    f = int(SR * 0.004)
    buf[:f] *= np.linspace(0, 1, f)
    buf[-f:] *= np.linspace(1, 0, f)
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((buf * 32767).astype("<i2").tobytes())
    print("wrote", os.path.relpath(os.path.join(OUT, name), ROOT))


# ---- 小道具（180/400 用） ----
def saw(ph):
    return (ph / np.pi) % 2 - 1


def osc(freq, n):
    """周波数（定数 or 配列）から位相を積分"""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return 2 * np.pi * np.cumsum(f) / SR


def biquad_bp(x, f0, q):
    """バンドパス（RBJ）。素朴なループだが短い音にしか使わないので十分速い"""
    w0 = 2 * np.pi * f0 / SR
    al = np.sin(w0) / (2 * q)
    b0, b2 = al, -al
    a0, a1, a2 = 1 + al, -2 * np.cos(w0), 1 - al
    b0, b2, a1, a2 = b0 / a0, b2 / a0, a1 / a0, a2 / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def lowpass(x, cutoff):
    """1次ローパス。cutoff は定数でも配列（時間で動かす）でもいい"""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.zeros_like(x)
    s = 0.0
    for i, v in enumerate(x):
        s += a[i] * (v - s)
        y[i] = s
    return y


def lowpass4(x, cutoff):
    for _ in range(4):
        x = lowpass(x, cutoff)
    return x


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def drive(x, amount):
    return np.tanh(x * amount)


def echo(buf, delay_beats, fb=0.35, times=4):
    """ループ内で回り込むディレイ"""
    d = int(delay_beats * BEAT * SR)
    out = buf.copy()
    tap = buf.copy()
    for _ in range(times):
        tap = np.roll(tap, d) * fb
        out += tap
    return out


# =====================================================================
# 120 BPM（最初の6つ。並びと乱数の使い方を変えると音が変わるので触らない）
# =====================================================================
setup(120, 8)


# 1. 虚無キック: 四つ打ち
def kick():
    buf = np.zeros(LEN)
    n = int(SR * 0.4)
    x = t(n)
    freq = 45 + 110 * np.exp(-x * 30)
    sig = np.sin(2 * np.pi * np.cumsum(freq) / SR) * env(n, 0.001, 0.15)
    for b in range(8):
        place(buf, sig, b)
    return buf


# 2. ボタンのハイハット: 裏打ち＋たまに16分
def hat():
    buf = np.zeros(LEN)
    for i in range(16):
        n = int(SR * 0.06)
        noise = rng.standard_normal(n)
        noise = np.diff(noise, prepend=0)  # 高域寄りに
        vol = 1.0 if i % 2 == 1 else 0.35
        place(buf, noise * env(n, 0.001, 0.02) * vol, i * 0.5)
    return buf


# 3. ねばねばベース: うにょっとしたベースライン
def bass():
    buf = np.zeros(LEN)
    line = [36, 36, 48, 36, 39, 36, 41, 43,  36, 36, 48, 36, 46, 43, 39, 41]
    for i, m in enumerate(line):
        n = int(SR * 0.45)
        x = t(n)
        f0 = note(m)
        wobble = 1 + 0.03 * np.sin(2 * np.pi * 7 * x)
        ph = 2 * np.pi * np.cumsum(f0 * wobble) / SR
        sig = np.sign(np.sin(ph)) * 0.4 + np.sin(ph) * 0.6
        place(buf, sig * env(n, 0.01, 0.18), i * 0.5)
    return buf


# 4. 虚無パッド: ずっと鳴ってるだけのコード
def pad():
    buf = np.zeros(LEN)
    chords = [[60, 63, 67, 70], [58, 62, 65, 69]]
    for c, notes in enumerate(chords):
        n = int(SR * BEAT * 4)
        x = t(n)
        sig = sum(np.sin(2 * np.pi * note(m) * x * (1 + 0.002 * k)) for k, m in enumerate(notes))
        a = np.minimum(1, np.minimum(x / 0.3, (x[-1] - x) / 0.3))
        place(buf, sig * a, c * 4)
    return buf


# 5. 納豆リード: ピコピコした謎メロディ
def lead():
    buf = np.zeros(LEN)
    mel = [(72, 0), (75, 0.75), (79, 1.5), (77, 2), (75, 2.5), (72, 3.5),
           (70, 4), (72, 4.75), (75, 5.5), (74, 6), (70, 6.5), (67, 7)]
    for m, b in mel:
        n = int(SR * 0.3)
        x = t(n)
        f = note(m) * (1 + 0.5 * np.exp(-x * 60))  # ピュンと入る
        ph = 2 * np.pi * np.cumsum(f) / SR
        sig = ((ph / np.pi) % 2 - 1)  # のこぎり波
        place(buf, sig * env(n, 0.003, 0.12), b)
    return buf


# 6. ボヨヨン: 謎の打楽器
def boing():
    buf = np.zeros(LEN)
    for b in [1, 2.75, 3.5, 5, 6.75, 7.25]:
        n = int(SR * 0.35)
        x = t(n)
        f = 200 + 400 * np.exp(-x * 8) * (1 + 0.3 * np.sin(2 * np.pi * 25 * x))
        sig = np.sin(2 * np.pi * np.cumsum(f) / SR)
        place(buf, sig * env(n, 0.002, 0.1), b)
    return buf


save("kick.wav", kick(), 0.9)
save("hat.wav", hat(), 0.5)
save("bass.wav", bass(), 0.7)
save("pad.wav", pad(), 0.45)
save("lead.wav", lead(), 0.5)
save("boing.wav", boing(), 0.6)


# =====================================================================
# 180 BPM — DnB（暗い・硬い・2ステップ。キーは F マイナー）
# =====================================================================
setup(180, 16, "180")
rng = np.random.default_rng(180)


def dnb_kick():
    n = int(SR * 0.22)
    x = t(n)
    f = 48 + 140 * np.exp(-x * 45)
    body = np.sin(osc(f, n)) * env(n, 0.001, 0.09)
    click = highpass(rng.standard_normal(n), 2000) * env(n, 0.0005, 0.004) * 0.6
    return drive(body + click, 1.8)


def dnb_snare():
    n = int(SR * 0.28)
    x = t(n)
    tone = np.sin(osc(200 * (1 + 0.4 * np.exp(-x * 60)), n)) * env(n, 0.001, 0.05)
    noise = highpass(rng.standard_normal(n), 1200) * env(n, 0.001, 0.09)
    return drive(tone * 0.8 + noise, 2.2)


def dnb_hat(open_=False):
    n = int(SR * (0.12 if open_ else 0.04))
    sig = highpass(rng.standard_normal(n), 5000)
    return sig * env(n, 0.0005, 0.05 if open_ else 0.012)


# 1. ゆすりブレイク: 2ステップのドラム（キック1拍目と3拍目のウラ、スネア2・4）＋ゴースト＋ハット
def dnb_break():
    buf = np.zeros(LEN)
    k, s = dnb_kick(), dnb_snare()
    for bar in range(4):
        o = bar * 4
        place_wrap(buf, k, o + 0)
        place_wrap(buf, k, o + 2.5)
        place_wrap(buf, s, o + 1)
        place_wrap(buf, s, o + 3)
        place_wrap(buf, s * 0.22, o + 1.75)  # ゴースト
        place_wrap(buf, s * 0.18, o + 3.5)
        if bar == 3:  # 4小節目だけ崩す
            place_wrap(buf, k * 0.8, o + 2.25)
            place_wrap(buf, s * 0.35, o + 3.75)
        else:
            place_wrap(buf, s * 0.15, o + 2.75)
        for i in range(8):
            vel = 0.55 if i % 2 else 0.3
            place_wrap(buf, dnb_hat(open_=(i == 5)) * vel, o + i * 0.5 + 0.02 * (i % 2))  # ちょっとだけヨレる
    return buf


# 2. 膝リース: うなるリースベース（デチューンしたノコギリ2本＋サブ、フィルターがじわじわ動く）
def dnb_reese():
    buf = np.zeros(LEN)
    # (音, 開始拍, 長さ拍)
    line = [(29, 0, 2.5), (29, 2.5, 1.5), (32, 4, 2), (27, 6, 2),
            (29, 8, 2.5), (29, 10.5, 1.5), (25, 12, 2.5), (24, 14.5, 1.5)]
    for m, b, L in line:
        n = int(SR * BEAT * L)
        x = t(n)
        f = note(m + 12)
        sig = saw(osc(f, n)) + saw(osc(f * 1.012, n)) + 0.6 * saw(osc(f * 0.494, n))
        cut = 180 + 900 * (0.5 + 0.5 * np.sin(2 * np.pi * x / (BEAT * L) - np.pi / 2)) ** 2
        sig = lowpass4(sig, cut)
        sub = np.sin(osc(note(m), n)) * 1.4
        a = np.minimum(1, np.minimum(x / 0.01, (x[-1] - x) / 0.02))
        place_wrap(buf, drive(sig * 1.6 + sub, 1.5) * a, b)
    return buf


# 3. 貧乏アトモス: 暗いパッド＋風（Fm9 → Dbmaj7）
def dnb_atmos():
    buf = np.zeros(LEN)
    chords = [[53, 56, 60, 63, 67], [49, 53, 56, 60, 65]]
    for c, notes in enumerate(chords):
        n = int(SR * BEAT * 8)
        x = t(n)
        sig = sum(saw(osc(note(m) * (1 + 0.003 * (k - 2)), n)) for k, m in enumerate(notes))
        sig = lowpass4(sig, 500 + 300 * np.sin(2 * np.pi * x / (BEAT * 8)) ** 2)
        wind = lowpass(highpass(rng.standard_normal(n), 800), 2500) * 0.15
        a = np.minimum(1, np.minimum(x / 0.8, (x[-1] - x) / 0.8))
        place_wrap(buf, (sig + wind) * a, c * 8)
    return echo(buf, 0.75, 0.3, 3)


# 4. 人間ボイス: 声っぽいフォルマントの「フュー・マン」スタブ＋ディレイ
VOWELS = {"u": [(320, 1.0), (800, 0.5), (2300, 0.15)],
          "a": [(750, 1.0), (1150, 0.7), (2500, 0.25)],
          "m": [(250, 1.0), (1200, 0.08), (2200, 0.04)]}


def formant(f0, n, vowel):
    src = saw(osc(f0 * (1 + 0.01 * np.sin(2 * np.pi * 5.5 * t(n))), n))
    return sum(biquad_bp(src, f, 8) * g for f, g in VOWELS[vowel])


def human_stab(f0):
    parts = []
    h = highpass(rng.standard_normal(int(SR * 0.05)), 1500) * 0.25 * env(int(SR * 0.05), 0.01, 0.03)
    parts.append(h)
    for v, d in [("u", 0.13), ("m", 0.06), ("a", 0.2), ("m", 0.08)]:
        n = int(SR * d)
        parts.append(formant(f0, n, v))
    sig = np.concatenate(parts)
    a = np.minimum(1, np.minimum(t(len(sig)) / 0.01, (t(len(sig))[-1] - t(len(sig))) / 0.04))
    return sig * a


def dnb_vox():
    buf = np.zeros(LEN)
    place_wrap(buf, human_stab(note(53)), 0.5)
    place_wrap(buf, human_stab(note(56)) * 0.8, 8.5)
    place_wrap(buf, human_stab(note(51)) * 0.7, 13)
    return echo(buf, 0.75, 0.42, 5)


save("break.wav", dnb_break(), 0.9)
save("reese.wav", dnb_reese(), 0.55)
save("atmos.wav", dnb_atmos(), 0.45)
save("vox.wav", dnb_vox(), 0.55)


# =====================================================================
# 400 BPM — speedcore（全部歪ませる。キーは C マイナー）
# =====================================================================
setup(400, 16, "400")
rng = np.random.default_rng(400)


# 1. 承認キック: 400BPMの8分＝毎分800発。音程つきの歪んだキックがほぼ連続音になる地帯。
#    最後の拍は16分（1600）まで詰めて、ピッチを上げて頭に戻る
SC_ROOTS = [36, 36, 32, 34]  # 小節ごとのキックの音程（C → C → Ab → Bb）


def sc_kick_one(root, n):
    x = t(n)
    f = note(root) + 300 * np.exp(-x * 90)
    k = drive(np.sin(osc(f, n)) * env(n, 0.0003, 0.05), 10)
    return k * np.minimum(1, (x[-1] - x) / 0.004)


def sc_kick():
    buf = np.zeros(LEN)
    eighth = int(SR * BEAT / 2)
    for bar in range(4):
        for i in range(8):
            b = bar * 4 + i / 2
            if b >= 15:
                break
            place(buf, sc_kick_one(SC_ROOTS[bar], eighth), b)
    sixteenth = int(SR * BEAT / 4)
    for i in range(4):  # 最後の1拍：16分で駆け上がる
        place(buf, sc_kick_one(SC_ROOTS[3] + 3 * i, sixteenth) * 0.95, 15 + i / 4)
    return buf


# 2. 差し戻しスネア: ウラ拍のノイズスネア、2小節ごとにロール
def sc_snare():
    buf = np.zeros(LEN)
    n = int(SR * 0.07)
    s = drive(highpass(rng.standard_normal(n), 900) * env(n, 0.0005, 0.03), 4)
    for b in range(16):
        if b % 8 >= 6:
            for i in range(4):
                place(buf, s * (0.5 + 0.12 * i), b + i / 4)
        else:
            place(buf, s, b + 0.5)
    return buf


# 3. 決裁スクリーチ: 8分で駆け回るスーパーソウのアルペジオ＋FMのギャーッ
def supersaw(f, n, voices=7, spread=0.018):
    return sum(saw(osc(f * (1 + spread * (k / (voices - 1) - 0.5)), n)) for k in range(voices)) / voices


def sc_screech():
    buf = np.zeros(LEN)
    chords = [[60, 63, 67, 72], [60, 63, 67, 75], [56, 60, 63, 68], [58, 62, 65, 70]]
    shape = [0, 1, 2, 3, 2, 1, 3, 2]  # 1小節＝8分×8
    n = int(SR * BEAT / 2)
    x = t(n)
    for bar, ch in enumerate(chords):
        for i, s in enumerate(shape):
            m = ch[s] + (12 if bar % 2 and i >= 4 else 0)
            saws = supersaw(note(m), n)
            mod = np.sin(osc(note(m) * 3.01, n)) * 2.5 * np.exp(-x * 40)
            scr = np.sin(osc(note(m) * (1 + 0.05 * np.sin(2 * np.pi * 30 * x)), n) + mod) * 0.5
            a = np.minimum(1, np.minimum(x / 0.002, (x[-1] - x) / 0.006))
            place(buf, drive(highpass(saws + scr, 300) * 1.5, 2.5) * a, bar * 4 + i / 2)
    return buf


# 4. 稟議フーバー: 頭でピッチが沈むフーバーのコードスタブ
def sc_hoover():
    buf = np.zeros(LEN)
    chords = [([48, 51, 55], 0), ([46, 50, 53], 4), ([44, 48, 51], 8), ([43, 47, 50], 12)]
    for notes, b in chords:
        n = int(SR * BEAT * 3.5)
        x = t(n)
        dive = 1 - 0.25 * np.exp(-x * 18)
        sig = 0
        for m in notes:
            for d in (0.99, 1.0, 1.013):
                sig = sig + saw(osc(note(m) * d * dive, n))
        sig = lowpass4(sig, 2600)
        a = np.minimum(1, np.minimum(x / 0.004, (x[-1] - x) / 0.03))
        place(buf, drive(sig * 0.6, 2) * a, b)
    return buf


save("kick.wav", sc_kick(), 0.65)
save("snare.wav", sc_snare(), 0.6)
save("screech.wav", sc_screech(), 0.45)
save("hoover.wav", sc_hoover(), 0.45)


# =====================================================================
# 1280 BPM — extratone（キックが速すぎてブザーになる。上にかわいいチップチューン。キーは C メジャー）
#   1拍 = 46.875ms。64拍 = 4小節 = 3.0秒
# =====================================================================
setup(1280, 64, "1280")
rng = np.random.default_rng(1280)
XT_ROOTS = [36, 33, 29, 31]  # C → Am → F → G（16拍ごと）


def pulse(ph, duty=0.5):
    return np.where((ph / (2 * np.pi)) % 1 < duty, 1.0, -1.0)


# 1. 猫吸いキック: 毎拍キック＝毎秒21発。もはや音程のあるブザー
def xt_kick():
    buf = np.zeros(LEN)
    n = int(SR * BEAT)
    x = t(n)
    for b in range(64):
        root = XT_ROOTS[b // 16]
        f = note(root) + 500 * np.exp(-x * 160)
        k = drive(np.sin(osc(f, n)) * env(n, 0.0002, 0.03), 12)
        place(buf, k * np.minimum(1, (x[-1] - x) / 0.002), b)
    return buf


# 2. 肉球チップ: 矩形波のぴこぴこメロディ（2拍ごとに1音）
def xt_chip():
    buf = np.zeros(LEN)
    mel = [72, 76, 79, 76, 84, 79, 76, 79,
           81, 79, 76, 72, 74, 76, 72, 69,
           77, 81, 84, 81, 77, 76, 74, 72,
           74, 79, 83, 86, 84, 83, 81, 79]
    n = int(SR * BEAT * 2)
    x = t(n)
    for i, m in enumerate(mel):
        f = note(m) * (1 + 0.004 * np.sin(2 * np.pi * 9 * x))
        sig = pulse(osc(f, n), 0.5)
        a = np.minimum(1, np.minimum(x / 0.002, (x[-1] - x) / 0.004))
        place(buf, sig * a * (0.8 + 0.2 * np.exp(-x * 20)), i * 2)
    return buf


# 3. ゴロゴロアルペジオ: 毎拍で和音を駆け上がる細いパルス
def xt_arp():
    buf = np.zeros(LEN)
    chords = [[60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]]
    n = int(SR * BEAT)
    x = t(n)
    for b in range(64):
        ch = chords[b // 16]
        m = ch[b % 4] + 12 * ((b // 4) % 2)
        sig = pulse(osc(note(m), n), 0.125)
        a = np.minimum(1, np.minimum(x / 0.001, (x[-1] - x) / 0.003))
        place(buf, sig * a, b)
    return buf


# 4. シャーノイズ: 8bitっぽいノイズのハット＋小節終わりの「シャー」
def xt_noise():
    buf = np.zeros(LEN)
    n = int(SR * BEAT)
    for b in range(64):
        if b % 16 >= 12:
            continue
        hit = np.sign(rng.standard_normal(n // 4).repeat(4))[:n]  # サンプルを荒くして8bit感
        place(buf, hit * env(len(hit), 0.0005, 0.012) * (1.0 if b % 2 else 0.5), b)
    for bar in range(4):
        m = int(SR * BEAT * 4)
        x = t(m)
        hiss = highpass(rng.standard_normal(m), 3000) * np.minimum(1, x / (x[-1] + 1e-9)) ** 2
        place(buf, hiss * 0.7, bar * 16 + 12)
    return buf


save("kick.wav", xt_kick(), 0.6)
save("chip.wav", xt_chip(), 0.35)
save("arp.wav", xt_arp(), 0.22)
save("noise.wav", xt_noise(), 0.3)


# =====================================================================
# 追加セット（各テンポ6つずつ）。ここより上の音は1バイトも変えないこと
# =====================================================================

def triangle(ph):
    return 2 * np.abs(saw(ph)) - 1


def fm_bell(f, n, decay=0.6):
    x = t(n)
    mod = np.sin(osc(f * 3.5, n)) * 2.2 * np.exp(-x / (decay * 0.5))
    return np.sin(osc(f, n) + mod) * np.exp(-x / decay)


def clap_one(n):
    sig = np.zeros(n)
    for k, d in enumerate([0, 0.011, 0.022]):  # 手拍子は3回ずれて重なる
        i = int(SR * d)
        m = n - i
        sig[i:] += highpass(rng.standard_normal(m), 900) * env(m, 0.0005, 0.012 if k < 2 else 0.09)
    return sig


# ---------------- 120 BPM（Cマイナー）→ sounds/120/ ----------------
setup(120, 8, "120")
rng = np.random.default_rng(1201)


def x120_clap():
    buf = np.zeros(LEN)
    c = clap_one(int(SR * 0.3))
    for b in (1, 3, 5, 7):
        place(buf, c, b)
    return buf


def x120_shaker():
    buf = np.zeros(LEN)
    n = int(SR * 0.09)
    for i in range(32):
        s = highpass(rng.standard_normal(n), 4000) * env(n, 0.012, 0.03)
        place(buf, s * (1.0 if i % 4 == 2 else 0.45), i * 0.25 + (0.03 if i % 2 else 0))
    return buf


def x120_organ():
    buf = np.zeros(LEN)
    chords = [[60, 63, 67, 70]] * 2 + [[58, 62, 65, 69]] * 2
    n = int(SR * BEAT * 0.4)
    x = t(n)
    for bar in range(2):
        for k, b in enumerate([0.5, 1.5, 2.5, 3.5]):
            ch = chords[(bar * 2 + k // 2) % 4]
            sig = sum(np.sin(osc(note(m), n)) + 0.5 * np.sin(osc(note(m) * 2, n)) + 0.25 * np.sin(osc(note(m) * 3, n)) for m in ch)
            a = np.minimum(1, np.minimum(x / 0.005, (x[-1] - x) / 0.02))
            place(buf, sig * a, bar * 4 + b)
    return buf


def x120_pluck():
    buf = np.zeros(LEN)
    arp = [60, 63, 67, 70, 72, 70, 67, 63, 58, 62, 65, 69, 70, 69, 65, 62]
    n = int(SR * 0.45)
    for i, m in enumerate(arp):
        sig = lowpass(saw(osc(note(m), n)), 2500) * env(n, 0.002, 0.12)
        place(buf, sig, i * 0.5)
    return echo(buf, 0.75, 0.3, 3)


def x120_wobble():
    buf = np.zeros(LEN)
    x = t(LEN)
    roots = np.where(x < BEAT * 4, note(36), note(34))
    sig = drive(np.sin(osc(roots, LEN)) + 0.3 * np.sin(osc(roots * 2, LEN)), 1.6)
    lfo = 0.5 + 0.5 * np.cos(2 * np.pi * x / BEAT)       # 1拍ごとに膨らむ
    return sig * (0.2 + 0.8 * lfo)


def x120_bell():
    buf = np.zeros(LEN)
    for m, b in [(84, 0), (79, 1.5), (82, 3), (77, 4.5), (79, 6), (75, 7)]:
        place(buf, fm_bell(note(m), int(SR * 1.2)), b)
    return buf


save("clap.wav", x120_clap(), 0.7)
save("shaker.wav", x120_shaker(), 0.4)
save("organ.wav", x120_organ(), 0.4)
save("pluck.wav", x120_pluck(), 0.45)
save("wobble.wav", x120_wobble(), 0.6)
save("bell.wav", x120_bell(), 0.4)


# ---------------- 180 BPM（Fマイナー）→ sounds/180/ ----------------
setup(180, 16, "180")
rng = np.random.default_rng(1801)


def x180_ride():
    buf = np.zeros(LEN)
    n = int(SR * 0.35)
    x = t(n)
    ride = sum(np.sign(np.sin(osc(f, n))) for f in (3120, 4370, 5890, 7110))
    ride = highpass(ride, 3000) * env(n, 0.001, 0.12)
    # まっすぐな8分（表を強く）＋2拍ごとに16分の引っかけ。全部16分の格子の上
    for b in range(16):
        place_wrap(buf, ride * (1.0 if b % 2 == 0 else 0.75), b)
        place_wrap(buf, ride * 0.45, b + 0.5)
        if b % 2 == 1:
            place_wrap(buf, ride * 0.3, b + 0.75)
    return buf


def x180_sub():
    buf = np.zeros(LEN)
    roots = [29, 32, 25, 24]
    x = t(LEN)
    bar = np.minimum(3, (x / (BEAT * 4)).astype(int))
    f = np.array([note(roots[i] + 12) for i in range(4)])[bar]
    f = lowpass(f, 30)  # 音の切り替わりを少しだけ滑らせる
    return np.sin(osc(f, LEN))


def x180_stab():
    buf = np.zeros(LEN)
    ch = [65, 68, 72, 75, 79]
    n = int(SR * 0.3)
    x = t(n)
    for b in (1.5, 3.75, 9.5, 11.75):
        sig = sum(saw(osc(note(m) * (1 + 0.004 * k), n)) for k, m in enumerate(ch))
        sig = lowpass4(sig, 1800 * np.exp(-x * 6) + 300)
        place_wrap(buf, sig * env(n, 0.002, 0.15), b)
    return echo(buf, 0.75, 0.4, 4)


def x180_ghosts():
    buf = np.zeros(LEN)
    n = int(SR * 0.08)
    for i in range(64):
        if i % 8 in (4,):          # 本物のスネアの場所はあける
            continue
        v = 0.25 + 0.2 * ((i * 7) % 5) / 4
        s = highpass(rng.standard_normal(n), 1500) * env(n, 0.001, 0.025)
        place_wrap(buf, s * v, i * 0.25)
    for i in range(8):             # 4小節目の最後はロール
        place_wrap(buf, highpass(rng.standard_normal(n), 1500) * env(n, 0.001, 0.03) * (0.4 + i * 0.08), 14 + i * 0.25)
    return buf


def x180_bleep():
    buf = np.zeros(LEN)
    pat = [(89, 0.5), (84, 1.25), (91, 2.75), (89, 4.5), (96, 6.25), (84, 8.5), (91, 10), (87, 12.75), (89, 14.5)]
    n = int(SR * 0.12)
    for m, b in pat:
        place_wrap(buf, np.sin(osc(note(m), n)) * env(n, 0.002, 0.04), b)
    return echo(buf, 0.5, 0.45, 5)


def x180_choir():
    buf = np.zeros(LEN)
    for c, notes in enumerate([[65, 68, 72], [61, 65, 68]]):
        n = int(SR * BEAT * 8)
        x = t(n)
        sig = sum(formant(note(m), n, "a") for m in notes)
        a = np.minimum(1, np.minimum(x / 0.6, (x[-1] - x) / 0.6))
        place_wrap(buf, sig * a, c * 8)
    return buf


save("ride.wav", x180_ride(), 0.35)
save("sub.wav", x180_sub(), 0.6)
save("stab.wav", x180_stab(), 0.45)
save("ghosts.wav", x180_ghosts(), 0.45)
save("bleep.wav", x180_bleep(), 0.35)
save("choir.wav", x180_choir(), 0.4)


# ---------------- 400 BPM（Cマイナー）→ sounds/400/ ----------------
setup(400, 16, "400")
rng = np.random.default_rng(4001)


def x400_roll():
    buf = np.zeros(LEN)
    n = int(SR * 0.05)
    hits = [b for b in np.arange(0, 8, 0.5)] + [8 + b for b in np.arange(0, 4, 0.25)] + [12 + b for b in np.arange(0, 4, 0.125)]
    for k, b in enumerate(hits):
        s = drive(highpass(rng.standard_normal(n), 1200) * env(n, 0.0005, 0.02), 3)
        place(buf, s * (0.4 + 0.6 * b / 16), b)
    return buf


def x400_bass():
    buf = np.zeros(LEN)
    roots = [36, 36, 32, 34]
    n = int(SR * BEAT / 2)
    x = t(n)
    for i in range(32):
        m = roots[i // 8] + (12 if i % 4 == 3 else 0)
        sig = drive(lowpass(saw(osc(note(m), n)) + saw(osc(note(m) * 1.01, n)), 900) * 2, 3)
        place(buf, sig * np.minimum(1, np.minimum(x / 0.002, (x[-1] - x) / 0.004)), i * 0.5)
    return buf


def x400_rave():
    buf = np.zeros(LEN)
    chords = [[60, 63, 67], [60, 63, 67], [56, 60, 63], [58, 62, 65]]
    n = int(SR * BEAT * 0.45)
    x = t(n)
    for i in range(16):
        ch = chords[i // 4]
        sig = sum(saw(osc(note(m) * d, n)) for m in ch for d in (0.995, 1.005))
        place(buf, lowpass(sig, 3000) * env(n, 0.001, 0.05), i + 0.5)
    return buf


def x400_sweep():
    x = t(LEN)
    noise = rng.standard_normal(LEN)
    cut = 200 + 7000 * (x / x[-1]) ** 2
    return lowpass4(noise, cut) * (0.3 + 0.7 * x / x[-1])


def x400_ohat():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.45)
    for i in range(16):
        s = drive(highpass(rng.standard_normal(n), 6000) * env(n, 0.001, 0.03), 2.5)
        place(buf, s, i + 0.5)
    return buf


def x400_arp():
    buf = np.zeros(LEN)
    chords = [[72, 75, 79, 84], [72, 75, 79, 84], [68, 72, 75, 80], [70, 74, 77, 82]]
    n = int(SR * BEAT / 4)
    x = t(n)
    for i in range(64):
        m = chords[i // 16][i % 4]
        sig = pulse(osc(note(m), n), 0.25) if "pulse" in globals() else np.sign(np.sin(osc(note(m), n)))
        place(buf, sig * np.minimum(1, (x[-1] - x) / 0.003), i * 0.25)
    return buf


save("roll.wav", x400_roll(), 0.5)
save("bass.wav", x400_bass(), 0.5)
save("rave.wav", x400_rave(), 0.4)
save("sweep.wav", x400_sweep(), 0.35)
save("ohat.wav", x400_ohat(), 0.35)
save("arp.wav", x400_arp(), 0.25)


# ---------------- 1280 BPM（Cメジャー）→ sounds/1280/ ----------------
setup(1280, 64, "1280")
rng = np.random.default_rng(12801)


def x1280_counter():
    buf = np.zeros(LEN)
    mel = [64, 67, 71, 67, 69, 64, 60, 64, 65, 69, 72, 69, 67, 71, 74, 71]
    n = int(SR * BEAT * 4)
    x = t(n)
    for i, m in enumerate(mel):
        place(buf, pulse(osc(note(m), n), 0.25) * np.minimum(1, (x[-1] - x) / 0.004), i * 4)
    return buf


def x1280_sqbass():
    buf = np.zeros(LEN)
    roots = [36, 33, 29, 31]
    n = int(SR * BEAT * 8)
    x = t(n)
    for i in range(8):
        m = roots[i // 2] + (12 if i % 2 else 0)
        place(buf, pulse(osc(note(m), n), 0.5) * np.minimum(1, (x[-1] - x) / 0.004), i * 8)
    return buf


def x1280_sparkle():
    buf = np.zeros(LEN)
    for b in range(0, 64, 3):          # 前の版と同じだけ乱数を引いておく（後ろの音が変わらないように）
        rng.integers(6)
    # 4拍ごとに、その小節の和音（C → Am → F → G）を高い所で駆け上がる
    chords = [[84, 88, 91, 96], [81, 84, 88, 93], [77, 81, 84, 89], [79, 83, 86, 91]]
    for b in range(0, 64, 4):
        ch = chords[b // 16]
        m = ch[(b // 4) % 4]
        place(buf, fm_bell(note(m), int(SR * BEAT * 4), 0.06), b)
    return buf


def x1280_glitch():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.5)
    chunk = np.sin(osc(note(84), n)) * np.sign(rng.standard_normal(n))
    for b in list(range(12, 16)) + list(range(28, 32, 2)) + list(range(44, 48)) + list(range(60, 64)):
        place(buf, chunk * env(n, 0.0005, 0.01), b)
    return buf


def x1280_tribass():
    buf = np.zeros(LEN)
    roots = [48, 45, 41, 43]
    n = int(SR * BEAT * 2)
    x = t(n)
    for i in range(32):
        m = roots[i // 8] + (12 if i % 2 else 0)
        place(buf, triangle(osc(note(m), n)) * np.minimum(1, (x[-1] - x) / 0.003), i * 2)
    return buf


def x1280_laser():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 4)
    x = t(n)
    for bar in range(4):
        f = 2400 * np.exp(-x * 9) + 200
        place(buf, pulse(osc(f, n), 0.5) * np.exp(-x * 4), bar * 16 + 12)
    return buf


save("counter.wav", x1280_counter(), 0.25)
save("sqbass.wav", x1280_sqbass(), 0.3)
save("sparkle.wav", x1280_sparkle(), 0.35)
save("glitch.wav", x1280_glitch(), 0.3)
save("tribass.wav", x1280_tribass(), 0.4)
save("laser.wav", x1280_laser(), 0.25)


# =====================================================================
# 第3弾（各テンポ 120:12 / 180:10 / 400:10 / 1280:10）。音の出だしは全部、格子の上に置く
#   120/180/400 は16分、1280 は1拍が単位
# =====================================================================

def pat(buf, sig, s, step=0.25, start=0, vel=None):
    """'X'=強 'x'=弱 '.'=休み の文字列どおりに並べる（1文字 = step 拍）"""
    for i, ch in enumerate(s):
        if ch == '.':
            continue
        v = 1.0 if ch == 'X' else 0.55
        place_wrap(buf, sig * v * (vel or 1), start + i * step)


def tone_hit(f0, f1, n, decay):
    x = t(n)
    f = f1 + (f0 - f1) * np.exp(-x * 40)
    return np.sin(osc(f, n)) * env(n, 0.0005, decay)


def noise_hit(n, hp, decay, lp=None):
    s = highpass(rng.standard_normal(n), hp)
    if lp:
        s = lowpass(s, lp)
    return s * env(n, 0.0005, decay)


def chord_saws(notes, n, detune=0.004):
    return sum(saw(osc(note(m) * (1 + detune * (k - 1)), n)) for k, m in enumerate(notes))


# ---------------- 120 BPM（Cマイナー、8拍）----------------
setup(120, 8, "120")
rng = np.random.default_rng(1202)


def y120_rim():
    buf = np.zeros(LEN)
    n = int(SR * 0.05)
    rim = lowpass(np.sign(np.sin(osc(1700, n))), 4000) * env(n, 0.0005, 0.012)
    pat(buf, rim, "..x...x...x..x.x" * 2)
    return buf


def y120_conga():
    buf = np.zeros(LEN)
    n = int(SR * 0.25)
    hi, lo = tone_hit(420, 330, n, 0.08), tone_hit(300, 220, n, 0.1)
    pat(buf, hi, "X..x..x.....x...X..x..x...x.....")
    pat(buf, lo, "......x.X......x......x.X...x..x")
    return buf


def y120_tamb():
    buf = np.zeros(LEN)
    n = int(SR * 0.12)
    pat(buf, noise_hit(n, 6000, 0.04), "xxXxxxXxxxXxxxXx" * 2)
    return buf


def y120_cowbell():
    buf = np.zeros(LEN)
    n = int(SR * 0.2)
    cb = lowpass(np.sign(np.sin(osc(540, n))) + np.sign(np.sin(osc(800, n))), 3000) * env(n, 0.001, 0.06)
    pat(buf, cb, "X.....x...X.......x...X.....x.x.")
    return buf


def y120_epiano():
    buf = np.zeros(LEN)
    n = int(SR * 1.0)
    for b, ch in [(0, [60, 63, 67, 70]), (2.5, [60, 63, 67, 70]), (4, [58, 62, 65, 69]), (6.5, [58, 62, 65, 69])]:
        place_wrap(buf, sum(fm_bell(note(m), n, 0.45) for m in ch), b)
    return buf


def y120_bounce():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.45)
    x = t(n)
    for i in range(16):
        root = 36 if i < 8 else 34
        m = root + (12 if i % 2 else 0)
        place_wrap(buf, lowpass(saw(osc(note(m), n)), 700) * np.minimum(1, (x[-1] - x) / 0.01) * env(n, 0.002, 0.2), i * 0.5)
    return buf


def y120_strings():
    buf = np.zeros(LEN)
    for c, ch in enumerate([[60, 63, 67], [58, 62, 65]]):
        n = int(SR * BEAT * 4)
        x = t(n)
        sig = lowpass4(chord_saws(ch, n, 0.006), 1200)
        a = np.minimum(1, np.minimum(x / 0.6, (x[-1] - x) / 0.4))
        place_wrap(buf, sig * a, c * 4)
    return buf


def y120_whistle():
    buf = np.zeros(LEN)
    for m, b, L in [(79, 0, 1.5), (82, 1.5, 0.5), (84, 2, 2), (82, 4, 1), (79, 5, 1), (77, 6, 2)]:
        n = int(SR * BEAT * L)
        x = t(n)
        f = note(m) * (1 + 0.01 * np.sin(2 * np.pi * 6 * x))
        a = np.minimum(1, np.minimum(x / 0.02, (x[-1] - x) / 0.05))
        place_wrap(buf, np.sin(osc(f, n)) * a, b)
    return buf


def y120_vibes():
    buf = np.zeros(LEN)
    arp = [72, 75, 79, 82, 79, 75, 72, 70, 70, 74, 77, 81, 77, 74, 70, 67]
    n = int(SR * 0.6)
    x = t(n)
    for i, m in enumerate(arp):
        place_wrap(buf, np.sin(osc(note(m), n)) * (1 + 0.3 * np.sin(2 * np.pi * 5 * x)) * env(n, 0.002, 0.25), i * 0.5)
    return buf


def y120_scratch():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.5)
    x = t(n)
    sw = np.sin(osc(300 + 900 * np.abs(np.sin(2 * np.pi * 6 * x)), n)) * env(n, 0.002, 0.08)
    pat(buf, sw, "..............X.......X.....X.x.")
    return buf


def y120_snap():
    buf = np.zeros(LEN)
    n = int(SR * 0.08)
    pat(buf, noise_hit(n, 2500, 0.015, 9000), "....X.......X..." * 2)
    return buf


def y120_boom():
    buf = np.zeros(LEN)
    n = int(SR * 1.2)
    x = t(n)
    boom = drive(np.sin(osc(note(24) + 60 * np.exp(-x * 25), n)) * env(n, 0.001, 0.5), 1.4)
    pat(buf, boom, "X..........x....X.........x.....")
    return buf


save("rim.wav", y120_rim(), 0.4)
save("conga.wav", y120_conga(), 0.5)
y120_tamb()      # ベースに差し替え済み。乱数の並びを保つために呼ぶだけ
save("cowbell.wav", y120_cowbell(), 0.35)
save("epiano.wav", y120_epiano(), 0.4)
save("bounce.wav", y120_bounce(), 0.5)
save("strings.wav", y120_strings(), 0.35)
save("whistle.wav", y120_whistle(), 0.3)
save("vibes.wav", y120_vibes(), 0.35)
save("scratch.wav", y120_scratch(), 0.4)
y120_snap()      # 同上
save("boom.wav", y120_boom(), 0.7)


# ---------------- 180 BPM（Fマイナー、16拍）----------------
setup(180, 16, "180")
rng = np.random.default_rng(1802)


def y180_break2():
    buf = np.zeros(LEN)
    k, s = dnb_kick(), dnb_snare()
    for bar in range(4):
        o = bar * 4
        pat(buf, k, "X.......x.X.....", start=o)
        pat(buf, s, "....X.......X...", start=o)
        pat(buf, s * 0.25, "......x.......x." if bar % 2 else ".x.....x......x.", start=o)
    return buf


def y180_shaker():
    buf = np.zeros(LEN)
    n = int(SR * 0.06)
    pat(buf, noise_hit(n, 5000, 0.02), "xXxx" * 16)
    return buf


def y180_reese2():
    buf = np.zeros(LEN)
    line = [29, 29, 41, 29, 32, 32, 44, 32, 25, 25, 37, 25, 24, 27, 31, 36]
    n = int(SR * BEAT * 1)
    x = t(n)
    for i, m in enumerate(line):
        f = note(m)
        sig = lowpass4(saw(osc(f, n)) + saw(osc(f * 1.01, n)), 500 + 400 * np.exp(-x * 8))
        place_wrap(buf, drive(sig * 1.5, 1.3) * np.minimum(1, np.minimum(x / 0.005, (x[-1] - x) / 0.01)), i)
    return buf


def y180_piano():
    buf = np.zeros(LEN)
    n = int(SR * 0.7)
    for b, ch in [(0.5, [65, 68, 72]), (2.75, [65, 68, 72]), (4.5, [68, 72, 75]), (6.75, [68, 72, 75]),
                  (8.5, [61, 65, 68]), (10.75, [61, 65, 68]), (12.5, [60, 64, 67]), (14.75, [60, 64, 67])]:
        place_wrap(buf, sum(fm_bell(note(m), n, 0.3) for m in ch), b)
    return buf


def y180_pad2():
    buf = np.zeros(LEN)
    for c, ch in enumerate([[56, 60, 63, 67], [51, 55, 58, 63]]):
        n = int(SR * BEAT * 8)
        x = t(n)
        sig = lowpass4(chord_saws(ch, n, 0.005), 700)
        a = np.minimum(1, np.minimum(x / 1.0, (x[-1] - x) / 0.8))
        place_wrap(buf, sig * a, c * 8)
    return buf


def y180_arp():
    buf = np.zeros(LEN)
    chords = [[65, 68, 72, 77], [68, 72, 75, 80], [61, 65, 68, 73], [60, 64, 67, 72]]
    n = int(SR * BEAT * 0.25)
    x = t(n)
    for i in range(64):
        m = chords[i // 16][i % 4]
        place_wrap(buf, lowpass(saw(osc(note(m), n)), 2200) * np.minimum(1, (x[-1] - x) / 0.004), i * 0.25)
    return buf


def y180_siren():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 4)
    x = t(n)
    f = note(77) * (1 + 0.5 * x / x[-1])
    place_wrap(buf, np.sin(osc(f, n)) * np.minimum(1, (x[-1] - x) / 0.05) * env(n, 0.002, 2.0), 12)
    return buf


def y180_tom():
    buf = np.zeros(LEN)
    n = int(SR * 0.3)
    for i, f in enumerate([220, 220, 180, 180, 150, 150, 120, 120]):
        place_wrap(buf, tone_hit(f * 1.5, f, n, 0.12), 14 + i * 0.25)
    return buf


def y180_hoover():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 3)
    x = t(n)
    for b, ch in [(0, [53, 56, 60]), (8, [49, 53, 56])]:
        dive = 1 - 0.2 * np.exp(-x * 12)
        sig = sum(saw(osc(note(m) * d * dive, n)) for m in ch for d in (0.99, 1.0, 1.012))
        place_wrap(buf, lowpass4(sig, 2000) * np.minimum(1, np.minimum(x / 0.004, (x[-1] - x) / 0.05)), b)
    return buf


def y180_vchop():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.4)
    a, u = formant(note(65), n, "a"), formant(note(68), n, "u")
    x = t(n)
    fade = np.minimum(1, np.minimum(x / 0.003, (x[-1] - x) / 0.01))
    pat(buf, a * fade, "x..x..x.........x..x..x.....x...")
    pat(buf, u * fade, "..........x.x.............x.x...", start=0)
    pat(buf, a * fade, "x..x..x.........x..x..x.....x...", start=8)
    return buf


save("break2.wav", y180_break2(), 0.85)
y180_shaker()    # 同上
save("reese2.wav", y180_reese2(), 0.5)
save("piano.wav", y180_piano(), 0.4)
save("pad2.wav", y180_pad2(), 0.35)
save("arp.wav", y180_arp(), 0.3)
save("siren.wav", y180_siren(), 0.3)
y180_tom()       # 同上
save("hoover.wav", y180_hoover(), 0.4)
save("vchop.wav", y180_vchop(), 0.45)


# ---------------- 400 BPM（Cマイナー、16拍）----------------
setup(400, 16, "400")
rng = np.random.default_rng(4002)


def y400_stomp():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.5)
    x = t(n)
    tok = drive(np.sin(osc(note(36) + 200 * np.exp(-x * 80), n)) * env(n, 0.0003, 0.04), 8)
    pat(buf, tok, "X.x." * 16)
    return buf


def y400_clap():
    buf = np.zeros(LEN)
    pat(buf, drive(clap_one(int(SR * 0.15)), 3), "....X..." * 8)
    return buf


def y400_hoover2():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 3.5)
    x = t(n)
    for b, ch in [(0, [51, 55, 58]), (4, [48, 51, 55]), (8, [53, 56, 60]), (12, [50, 53, 58])]:
        dive = 1 - 0.3 * np.exp(-x * 20)
        sig = sum(saw(osc(note(m) * d * dive, n)) for m in ch for d in (0.99, 1.0, 1.013))
        place(buf, drive(lowpass4(sig, 2400) * 0.6, 2) * np.minimum(1, np.minimum(x / 0.003, (x[-1] - x) / 0.03)), b)
    return buf


def y400_piano():
    buf = np.zeros(LEN)
    riff = [72, 75, 79, 75, 72, 75, 80, 75, 70, 74, 77, 74, 72, 75, 79, 84] * 2
    n = int(SR * BEAT * 0.5)
    for i, m in enumerate(riff):
        place(buf, fm_bell(note(m), n, 0.06), i * 0.5)
    return buf


def y400_crash():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 4)
    for b in (0, 8):
        place(buf, noise_hit(n, 4000, 0.4), b)
    return buf


def y400_acid():
    buf = np.zeros(LEN)
    line = [36, 36, 48, 36, 39, 36, 46, 36, 36, 48, 36, 43, 36, 39, 48, 46] * 4
    n = int(SR * BEAT * 0.25)
    x = t(n)
    for i, m in enumerate(line):
        cut = 300 + 2500 * np.exp(-x * 30) * (0.5 + 0.5 * np.sin(i / 64 * 2 * np.pi))
        sig = drive(lowpass4(saw(osc(note(m), n)), cut) * 3, 2)
        place(buf, sig * np.minimum(1, (x[-1] - x) / 0.002), i * 0.25)
    return buf


def y400_stabs():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.3)
    st = lowpass(chord_saws([60, 63, 67], n), 3500) * env(n, 0.001, 0.03)
    pat(buf, st, "..x..x....x..x.." * 4)
    return buf


def y400_supersaw():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 4)
    x = t(n)
    for b, ch in [(0, [60, 63, 67, 72]), (4, [60, 63, 67, 72]), (8, [56, 60, 63, 68]), (12, [58, 62, 65, 70])]:
        sig = sum(supersaw(note(m), n) for m in ch)
        place(buf, lowpass(sig, 4000) * np.minimum(1, np.minimum(x / 0.004, (x[-1] - x) / 0.03)), b)
    return buf


def y400_ride():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.5)
    ride = drive(highpass(sum(np.sign(np.sin(osc(f, n))) for f in (3300, 4700, 6100)), 3000) * env(n, 0.001, 0.05), 2)
    pat(buf, ride, "X.x." * 16)
    return buf


def y400_vox():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.8)
    x = t(n)
    hey = drive(formant(note(60), n, "a") * 2, 3) * np.minimum(1, np.minimum(x / 0.003, (x[-1] - x) / 0.02))
    pat(buf, hey, "X.......X.......X.......X...X...", step=0.5)
    return buf


save("stomp.wav", y400_stomp(), 0.55)
save("clap.wav", y400_clap(), 0.5)
save("hoover2.wav", y400_hoover2(), 0.4)
save("piano.wav", y400_piano(), 0.35)
y400_crash()     # 同上
save("acid.wav", y400_acid(), 0.4)
y400_stabs()     # 同上
save("supersaw.wav", y400_supersaw(), 0.35)
y400_ride()      # 同上
save("vox.wav", y400_vox(), 0.45)


# ---------------- 1280 BPM（Cメジャー、64拍）----------------
setup(1280, 64, "1280")
rng = np.random.default_rng(12802)
XT_CH = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]


def y1280_melody2():
    buf = np.zeros(LEN)
    mel = [76, 79, 84, 79, 72, 76, 81, 76, 77, 81, 84, 81, 79, 83, 86, 83]
    n = int(SR * BEAT * 4)
    x = t(n)
    for i, m in enumerate(mel):
        place(buf, pulse(osc(note(m), n), 0.125) * np.minimum(1, (x[-1] - x) / 0.003), i * 4)
    return buf


def y1280_kick2():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 2)
    x = t(n)
    for b in range(0, 64, 2):
        root = XT_ROOTS[b // 16] + 12
        k = drive(np.sin(osc(note(root) + 400 * np.exp(-x * 120), n)) * env(n, 0.0002, 0.04), 8)
        place(buf, k * np.minimum(1, (x[-1] - x) / 0.002), b)
    return buf


def y1280_chords():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 6)
    x = t(n)
    for b in range(0, 64, 8):
        ch = XT_CH[b // 16]
        sig = sum(triangle(osc(note(m + 12), n)) for m in ch)
        place(buf, sig * np.minimum(1, (x[-1] - x) / 0.004), b)
    return buf


def y1280_bell2():
    buf = np.zeros(LEN)
    for b in range(0, 64, 8):
        ch = XT_CH[b // 16]
        m = ch[2 - (b // 8) % 3] + 24
        place(buf, fm_bell(note(m), int(SR * BEAT * 8), 0.1), b)
    return buf


def y1280_snare():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 2)
    s = np.sign(rng.standard_normal(n // 3).repeat(3))[:n] * env(n, 0.0003, 0.03)
    for b in range(4, 64, 8):
        place(buf, s, b)
    return buf


def y1280_arp2():
    buf = np.zeros(LEN)
    n = int(SR * BEAT)
    x = t(n)
    for b in range(64):
        ch = XT_CH[b // 16]
        m = ch[2 - b % 3] + 12 * (2 - (b // 3) % 2)
        place(buf, pulse(osc(note(m), n), 0.5) * np.minimum(1, (x[-1] - x) / 0.002), b)
    return buf


def y1280_bass2():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 4)
    x = t(n)
    for b in range(0, 64, 4):
        m = XT_CH[b // 16][0] - 12 + (7 if (b // 4) % 2 else 0)
        place(buf, lowpass(saw(osc(note(m), n)), 1500) * np.minimum(1, (x[-1] - x) / 0.003), b)
    return buf


def y1280_coin():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 2)
    x = t(n)
    for b in range(0, 64, 16):
        place(buf, pulse(osc(note(83), n), 0.5) * np.minimum(1, (x[-1] - x) / 0.002), b + 8)
        place(buf, pulse(osc(note(88), n * 3), 0.5)[: n * 3] * env(n * 3, 0.001, 0.08), b + 10)
    return buf


def y1280_pad():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 16)
    x = t(n)
    for b in range(0, 64, 16):
        sig = lowpass4(sum(pulse(osc(note(m), n), 0.5) for m in XT_CH[b // 16]), 900)
        place(buf, sig * np.minimum(1, np.minimum(x / 0.005, (x[-1] - x) / 0.02)), b)
    return buf


def y1280_ticks():
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.5)
    tick = np.sign(rng.standard_normal(n)) * env(n, 0.0002, 0.004)
    for b in range(64):
        place(buf, tick * (1.0 if b % 2 else 0.4), b)
    return buf


save("melody2.wav", y1280_melody2(), 0.25)
save("kick2.wav", y1280_kick2(), 0.45)
save("chords.wav", y1280_chords(), 0.3)
save("bell2.wav", y1280_bell2(), 0.35)
y1280_snare()    # 同上
save("arp2.wav", y1280_arp2(), 0.2)
save("bass2.wav", y1280_bass2(), 0.35)
save("coin.wav", y1280_coin(), 0.25)
save("pad.wav", y1280_pad(), 0.25)
y1280_ticks()    # 同上


# =====================================================================
# ベース増量（重なりの多かった打楽器系9つと差し替え）。各テンポのベースが約25%になる
# =====================================================================

def pluck_bass(f, n, decay=0.25, cut=500):
    x = t(n)
    sig = np.sin(osc(f, n)) + 0.35 * triangle(osc(f * 2, n))
    return lowpass(sig, cut) * env(n, 0.003, decay) * np.minimum(1, (x[-1] - x) / 0.006)


# ---------------- 120 BPM（Cマイナー）----------------
setup(120, 8, "120")
rng = np.random.default_rng(1203)


def b120_walk():          # 4分音符で歩くウッドベース風
    buf = np.zeros(LEN)
    line = [36, 39, 43, 46, 34, 38, 41, 45]
    n = int(SR * BEAT * 0.95)
    for i, m in enumerate(line):
        place(buf, pluck_bass(note(m), n, 0.3, 600), i)
    return buf


def b120_funk():          # 16分で跳ねるシンセベース
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 0.22)
    x = t(n)
    hits = "X..xX.x...X.x..x" "X..xX.x...X..xX."
    for i, ch in enumerate(hits):
        if ch == '.':
            continue
        m = (36 if i < 16 else 34) + (12 if ch == 'x' else 0)
        sig = lowpass4(np.sign(np.sin(osc(note(m), n))), 300 + 1500 * np.exp(-x * 40))
        place(buf, sig * np.minimum(1, (x[-1] - x) / 0.004) * (1.0 if ch == 'X' else 0.7), i * 0.25)
    return buf


save("walk.wav", b120_walk(), 0.6)
save("funk.wav", b120_funk(), 0.55)


# ---------------- 180 BPM（Fマイナー）----------------
setup(180, 16, "180")
rng = np.random.default_rng(1803)


def b180_glide():         # 2拍ごとに音をすべらせるサブベース
    x = t(LEN)
    roots = [29, 29, 32, 31, 25, 25, 24, 27]
    seg = np.minimum(7, (x / (BEAT * 2)).astype(int))
    f = np.array([note(r) for r in roots])[seg]
    f = lowpass(lowpass(f, 12), 12)                 # 音程がなめらかにすべる
    sig = np.sin(osc(f, LEN)) + 0.15 * np.sin(osc(f * 2, LEN))
    return sig


def b180_growl():         # 8分でうなる中域ベース
    buf = np.zeros(LEN)
    line = [29, 29, 41, 29, 32, 29, 44, 29, 25, 25, 37, 25, 24, 27, 31, 24]
    n = int(SR * BEAT * 0.95)
    x = t(n)
    for i, m in enumerate(line):
        f = note(m)
        wob = 0.5 + 0.5 * np.sin(2 * np.pi * x / (BEAT / 2) - np.pi / 2)
        sig = lowpass4(saw(osc(f, n)) + saw(osc(f * 1.007, n)), 120 + 900 * wob)
        sub = np.sin(osc(f, n))
        place_wrap(buf, (drive(sig * 1.4, 1.5) * 0.6 + sub) * np.minimum(1, np.minimum(x / 0.004, (x[-1] - x) / 0.01)), i)
    return buf


save("glide.wav", b180_glide(), 0.6)
save("growl.wav", b180_growl(), 0.5)


# ---------------- 400 BPM（Cマイナー）----------------
setup(400, 16, "400")
rng = np.random.default_rng(4003)


def b400_offbass():       # 裏拍で鳴る歪んだベース
    buf = np.zeros(LEN)
    roots = [36, 36, 32, 34]
    n = int(SR * BEAT * 0.45)
    x = t(n)
    for b in range(16):
        f = note(roots[b // 4])
        sig = drive(lowpass(saw(osc(f, n)), 500) * 2.5, 2) * np.minimum(1, np.minimum(x / 0.002, (x[-1] - x) / 0.004))
        place(buf, sig, b + 0.5)
    return buf


def b400_subdrop():       # 4拍ごとに落ちる808
    buf = np.zeros(LEN)
    roots = [24, 24, 20, 22]
    n = int(SR * BEAT * 3.8)
    x = t(n)
    for i, b in enumerate(range(0, 16, 4)):
        f = note(roots[i]) * (1 + 0.6 * np.exp(-x * 30))
        place(buf, drive(np.sin(osc(f, n)) * env(n, 0.001, 0.4), 1.6), b)
    return buf


def b400_reese():         # 1拍ずつ刻むリース
    buf = np.zeros(LEN)
    roots = [36, 36, 39, 36, 32, 32, 36, 32, 34, 34, 38, 34, 31, 34, 35, 31]
    n = int(SR * BEAT * 0.95)
    x = t(n)
    for b, m in enumerate(roots):
        f = note(m)
        sig = lowpass4(saw(osc(f, n)) + saw(osc(f * 1.012, n)), 700) + np.sin(osc(f, n))
        place(buf, drive(sig, 1.4) * np.minimum(1, np.minimum(x / 0.003, (x[-1] - x) / 0.006)), b)
    return buf


save("offbass.wav", b400_offbass(), 0.5)
save("subdrop.wav", b400_subdrop(), 0.6)
save("reese.wav", b400_reese(), 0.5)


# ---------------- 1280 BPM（Cメジャー）----------------
setup(1280, 64, "1280")
rng = np.random.default_rng(12803)


def b1280_pbass():        # ファミコン風に2拍ごとオクターブで跳ねるベース
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 2)
    x = t(n)
    for b in range(0, 64, 2):
        m = XT_ROOTS[b // 16] + (12 if (b // 2) % 2 else 0)
        sig = lowpass(pulse(osc(note(m), n), 0.25), 600)
        place(buf, sig * np.minimum(1, (x[-1] - x) / 0.002), b)
    return buf


def b1280_sub():          # 和音ごとのサブ＋8拍ごとに頭を押す
    buf = np.zeros(LEN)
    n = int(SR * BEAT * 8)
    x = t(n)
    for b in range(0, 64, 8):
        f = note(XT_ROOTS[b // 16])
        sig = np.sin(osc(f, n)) * (0.6 + 0.4 * np.exp(-x * 10))
        place(buf, sig * np.minimum(1, np.minimum(x / 0.002, (x[-1] - x) / 0.004)), b)
    return buf


save("pbass.wav", b1280_pbass(), 0.55)
save("sub.wav", b1280_sub(), 0.6)
