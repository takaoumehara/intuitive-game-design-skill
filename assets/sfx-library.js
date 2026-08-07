/**
 * sfx-library.js — コードだけで鳴らす効果音の実装集（外部アセット・ライブラリ ゼロ）
 *
 * audio-engine.js の audio.play() に渡す形で書いてある。
 *   import { audio } from './audio-engine.js';
 *   import { sfx } from './sfx-library.js';
 *   sfx.jump();
 *
 * ここにある音はそのまま使うためのものではなく、**改変の出発点**。
 * ゲームの性格に合わせて周波数・長さ・波形を動かすことを前提にしている。
 * 数値を変える時の指針は references/audio/web-audio-patterns.md にある。
 */

import { audio } from './audio-engine.js';

// exponentialRampToValueAtTime は 0 を扱えない（例外になる）。
// 無音は 0 ではなく十分小さい正の値で表現する。これは Web Audio で最も多いエラー。
const SILENT = 0.0001;

/** ADSRの簡易版。ほとんどの効果音は attack + decay だけで十分成立する。 */
function env(gainNode, t, { peak = 0.3, attack = 0.005, decay = 0.15 }) {
  const g = gainNode.gain;
  g.setValueAtTime(SILENT, t);
  g.exponentialRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(SILENT, t + attack + decay);
  return t + attack + decay;
}

function noiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export const sfx = {
  /** ジャンプ: 低→高のスウィープ。上昇＝上向きの動きという連想が効く。 */
  jump({ from = 150, to = 600, dur = 0.15, type = 'square', bus = 'sfx' } = {}) {
    return audio.play((ctx, dest, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      env(gain, t, { peak: 0.3, attack: 0.005, decay: dur });
      osc.connect(gain); gain.connect(dest);
      osc.start(t); osc.stop(t + dur + 0.02);
      return osc;
    }, { bus });
  },

  /** 着地・被弾: 高→低。下降は重さ・落下・失敗の連想。 */
  land({ from = 400, to = 80, dur = 0.12, bus = 'sfx' } = {}) {
    return audio.play((ctx, dest, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      env(gain, t, { peak: 0.35, attack: 0.003, decay: dur });
      osc.connect(gain); gain.connect(dest);
      osc.start(t); osc.stop(t + dur + 0.02);
      return osc;
    }, { bus });
  },

  /**
   * 爆発: ホワイトノイズ + ローパスのスウィープ + 低域のサイン。
   * ノイズだけだと「シャー」で終わる。低い成分を足して初めて質量が出る。
   */
  explosion({ dur = 0.6, bus = 'sfx' } = {}) {
    return audio.play((ctx, dest, t) => {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx, dur);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, t);
      filter.frequency.exponentialRampToValueAtTime(60, t + dur);

      const gain = ctx.createGain();
      env(gain, t, { peak: 0.5, attack: 0.005, decay: dur });

      // 低域の「ドン」。これがあるかないかで迫力が決まる。
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(90, t);
      sub.frequency.exponentialRampToValueAtTime(35, t + dur * 0.6);
      env(subGain, t, { peak: 0.4, attack: 0.005, decay: dur * 0.6 });

      noise.connect(filter); filter.connect(gain); gain.connect(dest);
      sub.connect(subGain); subGain.connect(dest);
      noise.start(t); noise.stop(t + dur);
      sub.start(t); sub.stop(t + dur);
      return noise;
    }, { bus });
  },

  /** コイン・取得: 2音の上行。単音より「達成」の記号性が強い。 */
  coin({ bus = 'ui' } = {}) {
    return audio.play((ctx, dest, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(988, t);       // B5
      osc.frequency.setValueAtTime(1319, t + 0.06); // E6
      env(gain, t, { peak: 0.25, attack: 0.005, decay: 0.22 });
      osc.connect(gain); gain.connect(dest);
      osc.start(t); osc.stop(t + 0.3);
      return osc;
    }, { bus });
  },

  /** レーザー: 高速な下降スウィープ + わずかなデチューン。 */
  laser({ from = 1800, to = 200, dur = 0.18, bus = 'sfx' } = {}) {
    return audio.play((ctx, dest, t) => {
      const gain = ctx.createGain();
      env(gain, t, { peak: 0.22, attack: 0.002, decay: dur });
      gain.connect(dest);
      let first = null;
      for (const detune of [0, 12]) { // 2本重ねると厚みが出る
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.detune.value = detune;
        osc.frequency.setValueAtTime(from, t);
        osc.frequency.exponentialRampToValueAtTime(to, t + dur);
        osc.connect(gain);
        osc.start(t); osc.stop(t + dur + 0.02);
        first = first || osc;
      }
      return first;
    }, { bus });
  },

  /** 打撃・ヒット: 短いノイズバースト + バンドパス。硬さは Q で決まる。 */
  hit({ freq = 320, q = 2, dur = 0.09, bus = 'sfx' } = {}) {
    return audio.play((ctx, dest, t) => {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx, dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
      const gain = ctx.createGain();
      env(gain, t, { peak: 0.45, attack: 0.001, decay: dur });
      noise.connect(bp); bp.connect(gain); gain.connect(dest);
      noise.start(t); noise.stop(t + dur);
      return noise;
    }, { bus });
  },

  /** UIクリック: 極短。UI音は「聞こえる」より「気づかない程度に在る」が正解。 */
  click({ freq = 1000, bus = 'ui' } = {}) {
    return audio.play((ctx, dest, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      env(gain, t, { peak: 0.12, attack: 0.001, decay: 0.035 });
      osc.connect(gain); gain.connect(dest);
      osc.start(t); osc.stop(t + 0.06);
      return osc;
    }, { bus });
  },

  /** エラー・拒否: 不協和な2音。下行の短2度は文化を問わず「ダメ」に読まれる。 */
  error({ bus = 'ui' } = {}) {
    return audio.play((ctx, dest, t) => {
      const gain = ctx.createGain();
      env(gain, t, { peak: 0.2, attack: 0.005, decay: 0.3 });
      gain.connect(dest);
      let first = null;
      for (const f of [220, 233]) { // 短2度でぶつける
        const osc = ctx.createOscillator();
        osc.type = 'square'; osc.frequency.value = f;
        osc.connect(gain); osc.start(t); osc.stop(t + 0.32);
        first = first || osc;
      }
      return first;
    }, { bus });
  },

  /**
   * 足音: 毎回まったく同じ音だと3歩目で偽物だと分かる。
   * ピッチと音色をランダムに±で振るだけで、耳は「別の一歩」として受け取る。
   * これは全ての反復するSEに効く（打撃、着地、タイプ音）。
   */
  footstep({ bus = 'sfx' } = {}) {
    const freq = 180 + Math.random() * 120;
    const dur = 0.05 + Math.random() * 0.03;
    return this.hit({ freq, q: 1.2, dur, bus });
  },

  /**
   * リズムゲームの判定音。判定の成否に関わらず「押した」ことには必ず音を返す。
   * 無反応は「自分が下手」ではなく「機械が壊れている」と解釈されるため。
   */
  judge(kind = 'perfect', { bus = 'sfx' } = {}) {
    const map = { perfect: 1319, great: 1047, good: 784, miss: 196 };
    return audio.play((ctx, dest, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'miss' ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(map[kind] ?? 784, t);
      env(gain, t, { peak: kind === 'miss' ? 0.15 : 0.25, attack: 0.001, decay: kind === 'miss' ? 0.18 : 0.1 });
      osc.connect(gain); gain.connect(dest);
      osc.start(t); osc.stop(t + 0.25);
      return osc;
    }, { bus });
  },
};

export default sfx;
