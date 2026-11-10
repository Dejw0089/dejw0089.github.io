"""ふざけ箱の音源ループを合成して sounds/*.wav に書き出す。
全ループ共通: 120 BPM / 2小節 (4.0秒) / 22050Hz モノラル。
同じ長さなので、グルーヴ機で同時に鳴らすとピッタリ合う。
使い方: python3 tools/make_sounds.py
"""
import os
import numpy as np
from scipy.io import wavfile

SR = 22050
BPM = 120
BEAT = 60 / BPM          # 0.5s
LEN = int(SR * BEAT * 8)  # 2小節 = 8拍
OUT = os.path.join(os.path.dirname(__file__), "..", "sounds")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(42)


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


def note(freq):
    return 440 * 2 ** ((freq - 69) / 12)


def save(name, buf, gain=0.8):
    buf = buf / (np.max(np.abs(buf)) + 1e-9) * gain
    # ループの継ぎ目でプツッと鳴らないよう端を数msフェード
    f = int(SR * 0.004)
    buf[:f] *= np.linspace(0, 1, f)
    buf[-f:] *= np.linspace(1, 0, f)
    wavfile.write(os.path.join(OUT, name), SR, (buf * 32767).astype(np.int16))
    print("wrote", name)


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
