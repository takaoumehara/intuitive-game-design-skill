/**
 * chunk-generator.js — 無限ステージのチャンク生成（詰み回避つき）
 *
 * なぜバンドルしているか:
 * 重み付きランダム抽出そのものは短いが、**詰みを出さない保証**を後付けするのは難しい。
 * 「現在の速度で物理的に通過不能な配置」が1回でも出ると、そのゲームの
 * 完全自己責任の原則が崩壊し、プレイヤーは理不尽だと感じて離れる。
 * しかも再現条件がランダムなので、テストで見つけにくい。
 *
 * だから「通過可能性を先にフィルタしてから重み付けする」順序を固定してある。
 */

export class ChunkGenerator {
  /**
   * @param {Array<{
   *   id: string,
   *   minSpeed: number,      // このチャンクを通過するのに必要な最低速度
   *   maxSpeed?: number,     // 速すぎると通過不能な場合の上限
   *   difficulty: number,    // 1〜10
   *   length: number,
   *   spawn: Function
   * }>} chunks
   */
  constructor(chunks, { alpha = 1.7, noRepeat = 2, rng = Math.random } = {}) {
    if (!chunks?.length) throw new Error('ChunkGenerator: chunks is empty');
    this.chunks = chunks;
    this.alpha = alpha;          // 難易度カーブの鋭さ（1.5〜2.0）
    this.noRepeat = noRepeat;    // 直近N個は再抽選（同じ配置の連続を防ぐ）
    this.rng = rng;              // シード固定したい場合に差し替える
    this.recent = [];

    // 起動時に「最低速度が最も低いチャンク」が存在することを確認する。
    // これがないと、速度が低い序盤に候補ゼロになって落ちる。
    this.fallback = chunks.reduce((a, b) => (a.minSpeed <= b.minSpeed ? a : b));
  }

  /**
   * @param {number} speed 現在の移動速度
   * @returns {object} 次に配置するチャンク
   */
  next(speed) {
    // 1. 通過可能なものだけに絞る（詰み回避の本体）。
    //    重み付けより先にやること。順序を逆にすると、
    //    通過不能なチャンクが低確率で混ざる状態になる。
    let valid = this.chunks.filter(c =>
      speed >= c.minSpeed && (c.maxSpeed == null || speed <= c.maxSpeed));

    // 候補が消えたら必ず安全な1つに落とす。例外を投げてはいけない
    // （プレイ中に落ちるくらいなら簡単な地形が出るほうが遥かにマシ）。
    if (valid.length === 0) return this._remember(this.fallback);

    // 2. 直近と同じものを避ける。ただし候補が尽きるなら妥協する。
    const filtered = valid.filter(c => !this.recent.includes(c.id));
    if (filtered.length > 0) valid = filtered;

    // 3. 速度が上がるほど高難度チャンクの重みを指数的に増やす。
    //    線形だと「いつまでも簡単なのが出る」ので体感が単調になる。
    const weighted = valid.map(c => ({ chunk: c, weight: Math.pow(c.difficulty, this.alpha) }));
    const total = weighted.reduce((s, w) => s + w.weight, 0);

    let r = this.rng() * total;
    for (const w of weighted) {
      if (r < w.weight) return this._remember(w.chunk);
      r -= w.weight;
    }
    return this._remember(valid[valid.length - 1]); // 浮動小数の誤差対策
  }

  _remember(chunk) {
    this.recent.push(chunk.id);
    if (this.recent.length > this.noRepeat) this.recent.shift();
    return chunk;
  }

  /**
   * 全速度域で候補が存在するかを検証する。**リリース前に必ず1回走らせること。**
   * 詰みはランダムに出るのでプレイテストでは見つからない。ここで潰す。
   * @returns {Array<{speed:number, reason:string}>} 問題のある速度域
   */
  validate({ from = 0, to = 2000, step = 10 } = {}) {
    const problems = [];
    for (let v = from; v <= to; v += step) {
      const valid = this.chunks.filter(c =>
        v >= c.minSpeed && (c.maxSpeed == null || v <= c.maxSpeed));
      if (valid.length === 0) problems.push({ speed: v, reason: '通過可能なチャンクが存在しない' });
      else if (valid.length === 1) problems.push({ speed: v, reason: `候補が1つのみ (${valid[0].id}) — 単調になる` });
    }
    return problems;
  }
}

/**
 * 難易度カーブ
 *
 * 「時間とともに速くする」だけだと、上手い人ほど早く壁に当たって
 * 短時間で飽きる。上限に漸近させると、終盤は速度ではなく
 * 配置の難しさで難易度が上がる構造になり、伸びしろが長く残る。
 */
export function speedAt(elapsedSec, { base = 300, max = 900, halfLife = 60 } = {}) {
  // 指数的に max へ漸近する。halfLife 秒で残り差分の半分まで到達。
  return max - (max - base) * Math.pow(0.5, elapsedSec / halfLife);
}
