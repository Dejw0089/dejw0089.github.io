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
