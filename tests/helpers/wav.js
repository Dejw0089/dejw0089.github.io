/* テスト用：WAV を読んで、音の出だし（アタック）の時刻を拾う */
const fs = require('fs');

function readWav(file) {
  const buf = fs.readFileSync(file);
  const sr = buf.readUInt32LE(24);
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const n = size / 2, s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(off + 8 + i * 2) / 32768;
      return { sr, samples: s };
    }
    off += 8 + size;
  }
  throw new Error('no data chunk');
}

// 4ms ごとのエネルギーが、直前より急に（ratio 倍以上）大きくなった所を出だしとみなす
// quiet を指定すると、ほぼ無音（全体の最大の quiet 倍未満）から立ち上がった所だけを数える（持続音の揺れを拾わない）
function onsets(file, { frameMs = 4, ratio = 4, floor = 1e-4, mergeMs = 30, quiet = 0 } = {}) {
  const { sr, samples } = readWav(file);
  const f = Math.round(sr * frameMs / 1000);
  const e = [];
  for (let i = 0; i + f <= samples.length; i += f) {
    let sum = 0;
    for (let j = i; j < i + f; j++) sum += samples[j] * samples[j];
    e.push(sum / f);
  }
  const out = [];
  const top = Math.max(...e);
  for (let k = 3; k < e.length; k++) {
    const prev = (e[k - 1] + e[k - 2] + e[k - 3]) / 3;
    if (quiet && prev > top * quiet) continue;
    if (e[k] > floor && e[k] > prev * ratio) {
      // その小さな区間の中で、いちばん振幅が大きくなる前の立ち上がり位置まで戻す
      let t = k * f;
      const lim = Math.max(0, t - f);
      while (t > lim && Math.abs(samples[t - 1]) > 0.02) t--;
      const sec = t / sr;
      if (!out.length || sec - out[out.length - 1] > mergeMs / 1000) out.push(sec);
    }
  }
  return out;
}

module.exports = { readWav, onsets };
