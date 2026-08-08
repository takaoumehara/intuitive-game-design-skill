# プラットフォーム制約とフレームワーク組み込み

「音が鳴らない」「iPhoneだけ無音」「音がずれる」と言われた時、そしてReact/Phaser/Three.js へ組み込む時に読む。

## 目次
1. 音が鳴らない時の診断順序
2. 自動再生規制（Autoplay Policy）
3. iOS / モバイルの固有問題
4. レイテンシとずれ
5. 性能予算
6. アクセシビリティ
7. フレームワーク別の組み込み

---

## 1. 音が鳴らない時の診断順序

Web Audio は**エラーを出さずに無音になる**分野なので、上から順に潰す。推測で直そうとすると時間を溶かす。

```javascript
// これをコンソールに貼れば、だいたい原因が分かる
console.log({
  state: ctx.state,                    // 'suspended' なら自動再生規制
  sampleRate: ctx.sampleRate,
  currentTime: ctx.currentTime,        // 0 のまま進まないなら動いていない
  latency: (ctx.baseLatency||0) + (ctx.outputLatency||0),
  masterGain: master.gain.value,       // 0 になっていないか
});
```

| 順 | 確認 | よくある原因 |
| :-- | :--- | :--- |
| 1 | `ctx.state === 'running'` か | **`suspended`。原因の過半数がこれ。**ユーザー操作の外で `resume()` した |
| 2 | `ctx.currentTime` が進むか | 進まないなら context が動いていない |
| 3 | 音量ノードが 0 でないか | `gain.value = 0` のまま、`exponentialRamp` の失敗で 0 に張り付いた |
| 4 | `destination` まで繋がっているか | `connect()` の繋ぎ忘れ。1本抜けるだけで無音 |
| 5 | `start()` を呼んでいるか | 作っただけで鳴らしていない |
| 6 | 端末の音量・サイレントスイッチ | iOS のサイレントスイッチ（§3） |
| 7 | ノードを使い回していないか | 一度 `start()` したノードは再利用不可 |

---

## 2. 自動再生規制（Autoplay Policy）

**ブラウザは、ユーザーが操作していない状態での音声再生を禁止している。** 広告の勝手な再生を防ぐための仕様で、回避方法は存在しない（存在させてはいけない）。

### 成功する場所・しない場所

| 場所 | 結果 |
| :--- | :--- |
| `click` / `pointerdown` / `touchend` / `keydown` のハンドラ内 | ✅ 成功 |
| `pointermove` / `scroll` のハンドラ内 | ❌ ユーザー操作と見なされない |
| `DOMContentLoaded` / `load` | ❌ |
| `setTimeout` / `Promise.then` の中（ハンドラから呼んでも**非同期を跨ぐと失敗する場合がある**） | ⚠️ 危険 |

**厄介なのは、失敗しても例外が出ないこと。** `resume()` は resolve するが state は `suspended` のまま、という挙動になる。だから「エラーが出ていないから大丈夫」と判断できない。

### 設計への影響

**「画面をタップして開始」の導線は、実装の都合ではなく仕様の一部**として最初から入れる。後から足すと、タイトル画面の設計をやり直すことになる。

```javascript
// 推奨: 最初の任意の操作でアンロックする（once で1回だけ）
const unlock = async () => {
  await audio.unlock();
  if (audio.ctx.state !== 'running') return;  // まだならリスナーを残す
  ['pointerdown','keydown','touchend'].forEach(e =>
    document.removeEventListener(e, unlock));
};
['pointerdown','keydown','touchend'].forEach(e =>
  document.addEventListener(e, unlock));
```

**タブが非アクティブになると `suspended` に戻る**ブラウザもある。`visibilitychange` で復帰させる:

```javascript
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audio.ctx?.state === 'suspended') audio.ctx.resume();
});
```

---

## 3. iOS / モバイルの固有問題

| 問題 | 内容 | 対処 |
| :--- | :--- | :--- |
| **サイレントスイッチ** | 本体側面のスイッチで Web Audio がミュートされることがある | 「音が出ない場合はサイレントを解除してください」の案内を出す。実機での確認が必須 |
| **無音バッファでの起動** | context を起こしても最初の音が出ないことがある | アンロック時に長さ1の無音バッファを1回再生（`audio-engine.js` が実装済み） |
| **sampleRate の差** | 端末により 44100 / 48000 | **`sampleRate` を指定しない。** 強制するとリサンプリングで遅延と歪みが出る |
| **バックグラウンドで停止** | アプリ切替で context が止まる | `visibilitychange` で復帰 |
| **Bluetooth の遅延** | 数十〜数百ms | キャリブレーション機能を用意する |
| **低スペック端末** | 同時発音数で描画ごと落ちる | 発音数上限を設ける（16〜32） |

**この領域は実機でしか確認できません。** シミュレータや Mac の Safari では再現しない問題が多いので、iPhone 実機で1回触ることを必ず勧めてください。

---

## 4. レイテンシとずれ

### 4.1 実測する

```javascript
const latency = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
// baseLatency: Web Audio 内部のバッファ遅延
// outputLatency: OS〜スピーカーまでの遅延（対応ブラウザのみ）
```

これはあくまで**ブラウザが把握している範囲**の遅延で、Bluetooth の遅延は含まれないことがある。だから最終的には**プレイヤー自身に合わせてもらうキャリブレーション**が必要になる。

### 4.2 キャリブレーションの置き方

- 起動時ではなく、**初回プレイ後**に「ズレを感じましたか？」と聞く。ズレを体験する前に基準は持てない
- 自動推定（プレイヤーの入力の平均偏差から補正値を出す）のほうが、手動調整画面より成功率が高い
- 補正値は判定側に足す。音や映像を遅らせるのではなく、**判定の基準時刻をずらす**

### 4.3 リズムがヨレる

`setInterval` / `requestAnimationFrame` は数〜数十ms揺れる。音は必ず**先読みスケジューラ**（`audio-engine.js` の `Scheduler`）で予約する。タイマーは「いつ予約作業をするか」を決めるだけで、「いつ鳴るか」はオーディオクロックが決める。

### 4.4 効果音だけが遅れて聞こえる

**§4.3 のヨレ（揺れる）とは別の症状です。** 毎回同じだけ遅れるなら、原因は下の3つのどれかで、いずれもコードの側にあります。

| 原因 | 症状 | 対処 |
| :--- | :--- | :--- |
| **素材の頭に無音がある** | 常に一定量だけ遅れる。数十msあることも珍しくない | 波形の先頭を、音が立ち上がる位置まで切り詰める。書き出し設定によっては自動で無音が入る |
| **再生のたびに fetch / decode している** | 初回だけ大きく遅れる、または毎回数百ms遅れる | 起動時に `decodeAudioData` まで済ませ、`AudioBuffer` を保持しておく。再生時は `BufferSource` を作って `start()` するだけにする |
| **アタックの立ち上がりが緩い** | 遅れて聞こえるが、計測上は遅れていない | ゲイン包絡のアタックを 1〜3ms に。ここが 20ms あると、人間には「遅れた」と感じられる |

**「押した瞬間に鳴る」の判定基準は、入力から発音まで 100ms 以下**（本スキルの数値表）。上の3つを潰すと、残るのは出力機器側の遅延（Bluetooth・液晶）だけになり、それはコードでは消せません。**触覚と視覚も同時に返して**、遅延の知覚を分散させてください。

---

## 5. 性能予算

| 項目 | 目安 | 超えると |
| :--- | :--- | :--- |
| 同時発音数 | **16〜32** | モバイルで描画ごとフレーム落ち |
| AudioWorklet | 1〜2個まで | 音声スレッドが詰まりノイズが出る |
| リバーブ（Convolver） | 1個を共有 | 個別に持つと極端に重い |
| `decodeAudioData` | 事前に済ませる | プレイ中に呼ぶと一瞬固まる |
| ノードの生成 | 使ったら `disconnect()` | リークして徐々に重くなる |

**リバーブは1つを共有バスとして持ち、各音から send する。** 音ごとに Convolver を持つと即座に破綻する。

---

## 6. アクセシビリティ

**音だけで情報を伝えない。** 音を切っている人、聴覚に困難がある人、電車の中の人、音が出ない環境の人がいる。

- 重要な合図（危険、判定、通知）には、必ず**視覚か触覚の冗長性**を持たせる
- BGM / SFX / UI / ボイスを**独立して音量調整できる**ようにする。全部まとめて1つのスライダーは不十分で、「BGMだけ切ってSEは残したい」は非常に多い要望
- 完全ミュートでもゲームが成立するかを確認する
- 突然の大音量を避ける。特に起動直後
- 3Hzを超える点滅と同様、音でも**急激で反復する刺激**は負担になる

---

## 7. フレームワーク別の組み込み

### React

**音のインスタンスをコンポーネントの state に入れない。** 再レンダリングのたびに作り直され、ノードが積み上がる。モジュールスコープのシングルトン（`audio-engine.js` の `audio`）を import して使う。

```jsx
import { useEffect } from 'react';
import { audio } from './audio-engine.js';
import { sfx } from './sfx-library.js';

function Game() {
  useEffect(() => {
    const unlock = () => audio.unlock();
    document.addEventListener('pointerdown', unlock, { once: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, []);

  // StrictMode の二重実行に注意。副作用で音を鳴らすと開発時に2回鳴る。
  return <button onClick={() => sfx.jump()}>Jump</button>;
}
```

**注意点**: React 18 の StrictMode は開発時に `useEffect` を2回実行する。`useEffect` の中で音を鳴らすと2回鳴るので、音はイベントハンドラから鳴らす。

### Phaser

Phaser は独自の Sound Manager を持つが、**プロシージャル合成をするなら Web Audio を直接使うほうが素直**。Phaser の context を借りると衝突を避けられる。

```javascript
create() {
  // Phaser の AudioContext を再利用する（2つ作らない）
  const ctx = this.sound.context;
  this.input.once('pointerdown', () => {
    if (ctx.state === 'suspended') ctx.resume();
  });
}
```

Phaser の `this.sound.unlock()` も使える。**両方の仕組みを混在させないこと**が重要で、片方に寄せる。

### Three.js

Three.js の `AudioListener` は3D空間音響（`PositionalAudio`）を持つ。**空間性が要るなら Three.js 側、要らないなら素の Web Audio。**

```javascript
const listener = new THREE.AudioListener();
camera.add(listener);
// listener.context が AudioContext。これを audio-engine と共有する
```

`PositionalAudio` は内部で `PannerNode` を使う。自前で作るなら `ctx.createPanner()` を直接使えばよく、Three.js は不要。

### Vue

React と同じ。シングルトンを import し、`onMounted` でアンロックリスナーを登録、`onUnmounted` で解除する。
