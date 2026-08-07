/**
 * audio-engine.js — Webゲーム音響の土台（依存ゼロ / ES Module）
 *
 * なぜこれをバンドルしているか:
 * ゲーム音響の実装で毎回書くことになる「アンロック・バス構成・発音数制限・
 * クリップ防止・正確なスケジューリング・生成音のキャッシュ」は、毎回書き直すと
 * 毎回同じ落とし穴を踏む。ここを固定して、書くべきものを音そのものに集中させる。
 *
 * 使い方:
 *   import { audio } from './audio-engine.js';
 *   document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
 *   audio.play(ctx => { ... });            // 任意の音を鳴らす
 *   audio.setVolume('bgm', 0.4);
 */

const BUSES = ['bgm', 'sfx', 'ui', 'voice'];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.buses = {};
    this.volumes = { master: 1, bgm: 0.6, sfx: 0.8, ui: 0.7, voice: 1.0 };
    this.voices = [];            // 発音中のノード（発音数制限用）
    this.maxVoices = 24;
    this.bufferCache = new Map(); // URL / キー -> AudioBuffer（AI生成音の再取得を防ぐ）
    this.unlocked = false;
    this._muted = false;
  }

  /**
   * AudioContext を生成し、再生可能な状態にする。
   * ブラウザの自動再生規制により、これは**必ずユーザー操作イベントの中**で
   * 呼ばなければならない。click / pointerdown / keydown / touchend のハンドラ内が有効で、
   * setTimeout や load イベントの中では失敗する（失敗しても例外は出ず、
   * state が 'suspended' のまま無音になるだけなので気づきにくい）。
   */
  async unlock() {
    if (!this.ctx) this._build();
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (_) { /* ジェスチャ外だと失敗する */ }
    }
    // iOS 対策: 無音バッファを1つ再生してハードウェアを起こす
    if (this.ctx.state === 'running' && !this.unlocked) {
      const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      this.unlocked = true;
    }
    return this.unlocked;
  }

  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    // sampleRate は指定しない。端末により 44100 / 48000 が異なり、
    // 強制するとリサンプリングが挟まって余計な遅延と歪みが出る。
    this.ctx = new AC({ latencyHint: 'interactive' });

    // マスター段: リミッターを挟む。SEが同時に何発も重なるとクリップして
    // 「バリッ」というノイズになるが、これは音量を下げても直らない（合成後に潰れるため）。
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;

    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    // バスを分ける理由: プレイヤーは「BGMだけ切りたい」「効果音だけ小さくしたい」と
    // 必ず言う。後から分けるのは苦しいので最初から分けておく。
    for (const name of BUSES) {
      const g = this.ctx.createGain();
      g.gain.value = this.volumes[name];
      g.connect(this.master);
      this.buses[name] = g;
    }
  }

  get destinationFor() { return (bus = 'sfx') => this.buses[bus] || this.buses.sfx; }

  setVolume(bus, value) {
    this.volumes[bus] = value;
    if (!this.ctx) return;
    const node = bus === 'master' ? this.master : this.buses[bus];
    if (node) node.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02); // 段差を避ける
  }

  setMuted(muted) {
    this._muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : this.volumes.master, this.ctx.currentTime, 0.02);
  }

  /**
   * 音を1発鳴らす。fn には (ctx, destination, startTime) が渡る。
   * 発音数の上限を超えた場合は最も古い音を停止する（ボイススティール）。
   * これがないと、弾幕や連続ヒットで数百のノードが同時に走り、
   * モバイルでフレームレートごと落ちる。
   */
  play(fn, { bus = 'sfx', when = 0 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    if (this.voices.length >= this.maxVoices) {
      const oldest = this.voices.shift();
      try { oldest.stop?.(); } catch (_) {}
    }
    const t = when || this.ctx.currentTime;
    const handle = fn(this.ctx, this.destinationFor(bus), t);
    if (handle) {
      this.voices.push(handle);
      handle.onended = () => {
        const i = this.voices.indexOf(handle);
        if (i >= 0) this.voices.splice(i, 1);
        try { handle.disconnect(); } catch (_) {}
      };
    }
    return handle;
  }

  /**
   * 外部音源（AI生成、録音素材）を読み込んでキャッシュする。
   * キャッシュしないと、同じ効果音を鳴らすたびにAPIを叩いて課金され、
   * かつネットワーク待ちで音が遅れる。生成系APIを使うなら必須。
   */
  async loadBuffer(key, fetcher) {
    if (this.bufferCache.has(key)) return this.bufferCache.get(key);
    const arrayBuffer = await fetcher();
    const buf = await this.ctx.decodeAudioData(arrayBuffer);
    this.bufferCache.set(key, buf);
    return buf;
  }

  playBuffer(buffer, { bus = 'sfx', rate = 1, when = 0 } = {}) {
    return this.play((ctx, dest, t) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      src.connect(dest);
      src.start(t);
      return src;
    }, { bus, when });
  }

  /**
   * BGMのダッキング: 重要なSE（被弾、決定音）が鳴る瞬間だけBGMを下げる。
   * 音量バランスは「全部を適切な音量にする」のではなく
   * 「今聞くべきものだけを前に出す」ことで成立する。
   */
  duck(amount = 0.4, holdSec = 0.15, releaseSec = 0.4) {
    if (!this.ctx) return;
    const g = this.buses.bgm.gain;
    const now = this.ctx.currentTime;
    const target = this.volumes.bgm * amount;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + 0.02);
    g.setValueAtTime(target, now + holdSec);
    g.linearRampToValueAtTime(this.volumes.bgm, now + holdSec + releaseSec);
  }

  /** 実測レイテンシ。リズムゲームの判定オフセットの初期値に使える。 */
  get latency() {
    if (!this.ctx) return 0;
    return (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
  }
}

/**
 * 先読みスケジューラ（lookahead scheduler）
 *
 * なぜ必要か: setInterval / requestAnimationFrame のタイミングは数〜数十ms揺れる。
 * そのタイミングで音を鳴らすと、リズムが必ずヨレる。
 * 正解は「揺れるタイマーで定期的に起き、揺れない音声クロック(ctx.currentTime)に対して
 * 少し先の時刻を予約する」こと。タイマーは"いつ予約作業をするか"を決めるだけで、
 * "いつ鳴るか"はオーディオクロックが決める。
 *
 * リズムゲームを作るなら、この構造以外は使わない。
 */
export class Scheduler {
  constructor(engine, { lookaheadMs = 25, scheduleAheadSec = 0.12 } = {}) {
    this.engine = engine;
    this.lookaheadMs = lookaheadMs;       // 何msごとに予約作業をするか
    this.scheduleAheadSec = scheduleAheadSec; // 何秒先まで予約するか
    this.timer = null;
    this.nextNoteTime = 0;
    this.step = 0;
    this.bpm = 120;
    this.stepsPerBeat = 4;                // 16分音符
    this.onStep = null;                   // (step, time) => void
  }

  get secondsPerStep() { return 60 / this.bpm / this.stepsPerBeat; }

  start(atStep = 0) {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    this.step = atStep;
    this.nextNoteTime = ctx.currentTime + 0.05;
    this.timer = setInterval(() => this._tick(), this.lookaheadMs);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  _tick() {
    const ctx = this.engine.ctx;
    while (this.nextNoteTime < ctx.currentTime + this.scheduleAheadSec) {
      this.onStep?.(this.step, this.nextNoteTime);
      this.nextNoteTime += this.secondsPerStep;
      this.step++;
    }
  }

  /** 判定用: 現在の再生位置（秒）。プレイヤー入力との差分を取るのに使う。 */
  get playheadSec() {
    return this.engine.ctx ? this.engine.ctx.currentTime : 0;
  }
}

export const audio = new AudioEngine();
export default audio;
