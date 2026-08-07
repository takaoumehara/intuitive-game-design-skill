# 動的BGM・インタラクティブミュージック（Tone.js）

ゲームの状態に応じて変化するBGMを作る時に読む。

## 目次
1. 変化のさせ方は4種類しかない
2. Tone.js の基本形（動く実装）
3. ステムのレイヤリング
4. 遷移を自然にする
5. バージョン差と落とし穴

---

## 1. 変化のさせ方は4種類しかない

BGMを「動的」にする手段は、実質この4つに集約される。**どれを使うかを先に決める**と実装が迷子にならない。

| 手法 | やること | 向いている状況 | 難易度 |
| :--- | :--- | :--- | :--- |
| **パラメータ変調** | BPM、フィルター、音量、リバーブ量を連続的に動かす | 緊張度・危険度のような**連続量** | 低 |
| **レイヤリング（ステム）** | パートを重ねる／剥がす | コンボ数、進行度、敵の数のような**段階量** | 低〜中 |
| **分岐（Branching）** | 別のフレーズへ切り替える | 戦闘⇄探索のような**状態の切り替え** | 中 |
| **生成（Generative）** | 確率・規則からフレーズを作る | 無限に続く探索・アンビエント | 高 |

**最初はパラメータ変調とレイヤリングだけで十分。** この2つは既存の曲構造を壊さないので失敗しにくい。分岐は「いつ切り替えるか」の設計（後述の小節境界待ち）を間違えると、切り替わるたびに音楽が破綻する。

---

## 2. Tone.js の基本形

**そのまま動く実装。** ユーザー操作の中で `init()` を呼ぶことが必須。

```javascript
import * as Tone from 'tone';

// Tone.js のバージョン差を吸収する。v15 で Tone.Transport は
// Tone.getTransport() に移行した。両対応で書いておくと事故らない。
const getTransport = () => (Tone.getTransport ? Tone.getTransport() : Tone.Transport);

class DynamicGameAudio {
  constructor() {
    // バスを分ける。後から「BGMだけ下げたい」は必ず来る。
    this.bgmBus = new Tone.Gain(0.6).toDestination();

    this.synth = new Tone.PolySynth(Tone.Synth).connect(this.bgmBus);

    // フィルターは MonoSynth の内蔵ではなく、外に独立して置く。
    // MonoSynth 内蔵の filter は filterEnvelope に毎音上書きされるため、
    // 外から rampTo しても音符が鳴った瞬間に戻ってしまう（元コードの不具合）。
    this.bassFilter = new Tone.Filter({ type: 'lowpass', frequency: 400, Q: 6, rolloff: -24 })
      .connect(this.bgmBus);

    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 },
    }).connect(this.bassFilter);

    this.isBgmPlaying = false;
    this.sequences = [];
  }

  /** 必ずユーザー操作（click/pointerdown/keydown）の中から呼ぶこと。 */
  async init() {
    await Tone.start();               // 自動再生規制のアンロック
    getTransport().bpm.value = 120;
    this.setupSequences();
  }

  setupSequences() {
    const melody = new Tone.Sequence((time, note) => {
      // triggerAttackRelease には必ず time を渡す。
      // 渡さないと「今すぐ」になり、スケジューラの正確さが無駄になる。
      if (note) this.synth.triggerAttackRelease(note, '8n', time);
    }, ['C4', 'E4', 'G4', 'B4', 'A4', 'G4', 'E4', 'C4'], '4n');

    const bassLine = new Tone.Sequence((time, note) => {
      if (note) this.bass.triggerAttackRelease(note, '8n', time);
    }, ['C2', null, 'C2', null, 'F2', null, 'G2', null], '4n');

    melody.start(0);
    bassLine.start(0);
    this.sequences.push(melody, bassLine);
  }

  startBgm() {
    getTransport().start();
    this.isBgmPlaying = true;
  }

  stopBgm() {
    getTransport().stop();
    this.isBgmPlaying = false;
  }

  /** ピンチ状態: テンポとフィルターで緊張度を上げる（パラメータ変調） */
  setDangerState(isDanger) {
    const t = getTransport();
    if (isDanger) {
      t.bpm.rampTo(160, 1);                      // 1秒かけて加速
      this.bassFilter.frequency.rampTo(2000, 0.5); // 明るく鋭く
    } else {
      t.bpm.rampTo(120, 1);
      this.bassFilter.frequency.rampTo(400, 0.5);
    }
  }

  /** 後片付け。シーンを跨ぐゲームでは必須。放置するとメモリを食う。 */
  dispose() {
    this.sequences.forEach(s => s.dispose());
    this.synth.dispose(); this.bass.dispose();
    this.bassFilter.dispose(); this.bgmBus.dispose();
  }
}
```

### 元の実装から直した点

| 箇所 | 問題 | 直し方 |
| :--- | :--- | :--- |
| `filter: { rollover: -24 }` | **プロパティ名の綴り間違い**。正しくは `rolloff`。誤った名前は黙って無視されるので、効いていないことに気づけない | `rolloff` に修正し、フィルター自体を外出し |
| `bass.filter.frequency.rampTo()` | MonoSynth 内蔵フィルターは `filterEnvelope` が毎音上書きするため、変調が音符ごとに巻き戻る | 独立した `Tone.Filter` をチェーンに置いて、そちらを変調 |
| `Tone.Transport` 直参照 | v15 で `Tone.getTransport()` へ移行済み。将来のバージョンで壊れる | 両対応のヘルパー経由に |
| `toDestination()` を各音源で個別に | バス単位の音量制御ができない | `Tone.Gain` のバスに集約 |
| `dispose()` なし | シーン遷移でリークする | 追加 |

---

## 3. ステムのレイヤリング

**コンボや進行度に応じてパートを重ねていく。** 「上手くなるほど音楽が厚くなる」という体験は、スコア表示より強く上達を実感させる。

```javascript
class StemLayers {
  constructor(bus) {
    // 各ステムは常に鳴らし続け、音量だけで出し入れする。
    // 途中から start() すると位相がズレて音楽が破綻するため。
    this.layers = ['drums', 'bass', 'chords', 'melody'].map((name, i) => {
      const gain = new Tone.Gain(i === 0 ? 1 : 0).connect(bus);
      return { name, gain, threshold: i * 10 }; // コンボ10ごとに1枚増える
    });
  }

  setIntensity(combo) {
    for (const layer of this.layers) {
      const target = combo >= layer.threshold ? 1 : 0;
      // 一瞬で切り替えるとプツッと鳴る。必ず時間をかける。
      layer.gain.gain.rampTo(target, 0.4);
    }
  }
}
```

**失敗時は不協和音で罰さず、レイヤーを剥がす。** 罰ではなく「物足りなさ」として届くため、再挑戦につながる。

---

## 4. 遷移を自然にする

BGMの切り替えで最も多い失敗は、**押した瞬間に切り替えてしまうこと**。音楽は拍と小節の構造を持つので、途中で切ると人間の耳は「壊れた」と認識する。

```javascript
// 悪い例: 即座に切り替わる → 必ず音楽が破綻する
function switchToBattle_BAD() { battleLoop.start(); exploreLoop.stop(); }

// 良い例: 次の小節境界まで待ってから切り替える
function switchToBattle() {
  const t = getTransport();
  t.scheduleOnce((time) => {
    exploreLoop.stop(time);
    battleLoop.start(time);
  }, '@1m');   // 次の小節頭
}
```

**待ち時間が体験を壊さないか**は別途考える必要がある。最大で1小節（BPM120の4/4で2秒）待つことになるので、即応性が必要な場面（被弾、ゲームオーバー）では小節を待たず、**クロスフェード**で逃がす。

| 遷移の種類 | 手法 | 待ち |
| :--- | :--- | :--- |
| 探索⇄戦闘 | 小節境界で切り替え | 最大1小節 |
| 被弾・ゲームオーバー | 0.3秒クロスフェード＋フィルターで曇らせる | なし |
| ステージクリア | 現在の曲をフェードアウトし、ジングルを重ねる | なし |
| 緊張度の上下 | パラメータ変調（BPM・フィルター） | なし（連続変化） |

---

## 5. 落とし穴

- **`Tone.start()` はユーザー操作の中でしか成功しない。** 例外は出ず、無音になるだけ。
- **コールバックの `time` 引数を必ず使う。** `triggerAttackRelease(note, '8n')` と書くと「今すぐ」になり、Tone.js の正確なスケジューリングが無意味になる。リズムがヨレる原因の大半がこれ。
- **`rampTo` の第2引数（秒）を省略しない。** 省略すると瞬時に変化し、ノイズが出る。
- **Tone.js は約200KB。** SEしか鳴らさないなら過剰。素の Web Audio（`assets/sfx-library.js`）で足りる。
- **`dispose()` を忘れない。** SPA やシーン遷移のあるゲームでは、繰り返すたびにノードが積み上がる。
- **バージョンを確認する。** v14 と v15 で API が変わっている。ユーザーの `package.json` を見るのが確実。
