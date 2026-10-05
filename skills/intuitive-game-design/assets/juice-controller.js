/**
 * juice-controller.js — 手触り補正（コヨーテタイム＋入力バッファ＋ヒットストップ）
 *
 * なぜバンドルしているか:
 * コヨーテタイムと入力バッファは、単体では簡単だが**組み合わせの順序**を間違えると
 * 二重発動（1回のタップで2回ジャンプ）やすり抜け（押したのに出ない）が起きる。
 * バグの再現条件が「着地の1フレーム前に押した時だけ」のような形になるため、
 * 気づくのが遅れ、しかもプレイヤーからは「たまに反応しない」としか報告されない。
 *
 * 使い方（毎フレーム）:
 *   const jump = juice.update(dt, isGrounded, wasTapPressedThisFrame);
 *   if (jump) player.jump();
 */

export class JuiceInputController {
  constructor({ coyoteTime = 0.12, inputBuffer = 0.10 } = {}) {
    this.COYOTE_TIME_MAX = coyoteTime;  // 120ms
    this.INPUT_BUFFER_MAX = inputBuffer; // 100ms
    this.coyoteTimer = 0;
    this.bufferTimer = 0;
    this.wasGrounded = false;
  }

  /**
   * @param {number}  dt          前フレームからの経過秒
   * @param {boolean} isGrounded  現在接地しているか
   * @param {boolean} tapPressed  このフレームで「押された瞬間」か（押しっぱなしは false）
   * @returns {boolean} ジャンプを実行すべきか
   */
  update(dt, isGrounded, tapPressed) {
    // 1. コヨーテタイマー
    //    接地している間は満タンに保ち、離れた瞬間から減り始める。
    if (isGrounded) {
      this.coyoteTimer = this.COYOTE_TIME_MAX;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    // 2. 入力バッファ
    //    押された瞬間に満タン。以降は減る。
    //    「押しっぱなし」で満タンを維持してはいけない（押しっぱなしで
    //    着地するたびに自動ジャンプし続けるバグになる）。
    if (tapPressed) {
      this.bufferTimer = this.INPUT_BUFFER_MAX;
    } else {
      this.bufferTimer = Math.max(0, this.bufferTimer - dt);
    }

    // 3. 発動判定
    //    両方が生きている時だけ発動し、**発動したら両方を即座に消費する**。
    //    消費しないと次のフレームでも条件が成立して二重発動する。
    if (this.bufferTimer > 0 && this.coyoteTimer > 0) {
      this.coyoteTimer = 0;
      this.bufferTimer = 0;
      return true;
    }
    return false;
  }

  /** 死亡・リスポーン時に呼ぶ。持ち越すと復帰直後に暴発する。 */
  reset() { this.coyoteTimer = 0; this.bufferTimer = 0; }
}

/**
 * 可変ジャンプ（押した長さで高さが変わる）
 *
 * 1ビットの入力を、アナログな表現力に変換する中核。
 * 「チョン押しで小ジャンプ、長押しで大ジャンプ」は、ボタンを増やさずに
 * 表現を増やす（＝密結合）の最も分かりやすい実装。
 */
export class VariableJump {
  constructor({
    initialVelocity = 380,   // 踏み切りの初速
    holdAccel = 900,         // 押している間の追加上昇力
    maxHoldTime = 0.20,      // これ以上押しても伸びない（150〜250msが目安）
    gravityUp = 1400,        // 上昇中の重力
    gravityDownScale = 1.6,  // 下降時の重力倍率（1.2〜1.8）
    dragUp = 0.0008,         // 上昇時の空気抵抗。頂点で滞空感が出る
  } = {}) {
    Object.assign(this, { initialVelocity, holdAccel, maxHoldTime, gravityUp, gravityDownScale, dragUp });
    this.vy = 0;
    this.holdTime = 0;
    this.isJumping = false;
  }

  start() {
    this.vy = this.initialVelocity;
    this.holdTime = 0;
    this.isJumping = true;
  }

  /**
   * @param {number}  dt
   * @param {boolean} isHolding 現在ボタンを押し続けているか
   * @returns {number} このフレームの垂直移動量（上が正）
   */
  update(dt, isHolding) {
    // 押し続けている間だけ、上限時間まで追加の上昇力を積む。
    // 離した瞬間に加算を止めるのがポイントで、これにより
    // 「離すタイミングで高さを決める」という操作が成立する。
    if (this.isJumping && isHolding && this.holdTime < this.maxHoldTime && this.vy > 0) {
      this.vy += this.holdAccel * dt;
      this.holdTime += dt;
    }

    // 上昇と下降で重力を変える。
    // 下降を速くすると、滞空は長く見えるのに着地は素早い、という
    // 現実にはない気持ちよさが出る。これが「手触り」の正体のひとつ。
    if (this.vy > 0) {
      this.vy -= (this.gravityUp + this.dragUp * this.vy * this.vy) * dt;
    } else {
      this.vy -= this.gravityUp * this.gravityDownScale * dt;
    }

    return this.vy * dt;
  }

  land() { this.vy = 0; this.isJumping = false; this.holdTime = 0; }
}

/**
 * ヒットストップ（決定的瞬間にゲーム全体を止める）
 *
 * 打撃の重さは、エフェクトの派手さではなく「止まる時間」で決まる。
 * 2〜5フレーム（30〜80ms）。長いと「固まった」と感じられる。
 */
export class HitStop {
  constructor() { this.remaining = 0; }
  trigger(seconds = 0.05) { this.remaining = Math.max(this.remaining, seconds); }
  /** @returns {number} 実際に進めるべき dt（停止中は 0） */
  filter(dt) {
    if (this.remaining > 0) { this.remaining -= dt; return 0; }
    return dt;
  }
}

/**
 * 画面シェイク（Trauma モデル）
 *
 * 単純なランダム揺れは「安っぽい」。Trauma（打撃値 0〜1）を持ち、
 * その**二乗**で振幅を決めて減衰させると、強い衝撃は激しく、
 * 弱い衝撃は控えめに、そして自然に収束する。
 */
export class ScreenShake {
  constructor({ maxOffset = 24, maxAngle = 0.08, decay = 1.6 } = {}) {
    Object.assign(this, { maxOffset, maxAngle, decay });
    this.trauma = 0;
    this.t = 0;
  }
  add(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    const shake = this.trauma * this.trauma;  // 二乗が要点
    // ランダムではなくノイズ的な連続値にすると、揺れが滑らかになる
    const n = (seed) => Math.sin(this.t * 47 + seed) * Math.sin(this.t * 31.7 + seed * 2.3);
    return {
      x: this.maxOffset * shake * n(0),
      y: this.maxOffset * shake * n(10),
      angle: this.maxAngle * shake * n(20),
    };
  }
}
