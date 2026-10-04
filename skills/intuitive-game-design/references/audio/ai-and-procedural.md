# 生成AI・プロシージャル・アルゴリズム作曲

合成では作れない音（ボイス、リッチなBGM、リアルな環境音）が必要な時に読む。

## 目次
1. 生成AIを使う前に：4つの制約
2. APIキーを漏らさない構成
3. 実装（サーバー経由・キャッシュ付き）
4. プロシージャル環境音（AudioWorklet）
5. アルゴリズム作曲（マルコフ鎖）
6. コストとライセンス

---

## 1. 生成AIを使う前に：4つの制約

生成AIは魅力的に見えるが、**Webゲームの効果音としては多くの場合不適当**。使う前に4つを確認する。

| 制約 | 内容 | 帰結 |
| :--- | :--- | :--- |
| **遅延** | ネットワーク往復＋生成時間で、早くて数百ms、遅ければ数秒 | 押した瞬間には鳴らせない。**事前生成してキャッシュする前提でしか使えない** |
| **APIキー** | ブラウザのコードに書けば必ず漏れる | サーバーが必須。「Webだけで完結」という前提が壊れる |
| **課金** | 生成ごとに費用。合成なら無限に鳴らして0円 | 効果音には向かない。BGM・ボイスなど**個数が有限のもの**向き |
| **ライセンス** | 商用利用の可否・条件がサービスごとに異なり、変わる | リリース前に必ず現物の規約を確認する |

### 使い分けの結論

| 用途 | 推奨 | 理由 |
| :--- | :--- | :--- |
| ジャンプ、打撃、UI音 | **合成**（`assets/sfx-library.js`） | 遅延ゼロ、0円、無限にバリエーションを作れる |
| 環境音（風、雨） | **プロシージャル**（§4） | パラメータ連動で無限に変化。ループの継ぎ目がない |
| キャラクターボイス | **生成AI** | 合成では作れない。個数が有限で事前生成できる |
| リッチなBGM | **生成AI or 人間** | 尺が長く事前生成できる。ただしライセンス要確認 |
| 素材のプロトタイピング | **生成AI** | 後で差し替える前提なら有効 |

---

## 2. APIキーを漏らさない構成

**`process.env.ELEVENLABS_API_KEY` をブラウザのコードに書いてはいけない。**

- ブラウザに `process` は存在しない（そのまま実行すると `ReferenceError`）
- Vite / webpack などのバンドラは、ビルド時にこれを**実際のキー文字列へ置換する**。結果、キーが配信ファイルにそのまま載る
- 「難読化すれば大丈夫」ではない。DevTools のネットワークタブでリクエストヘッダを見れば一発で見える

正しい構成はひとつだけ。**キーはサーバーに置き、ブラウザは自前のエンドポイントを叩く。**

```
[ブラウザ] --POST /api/sfx--> [自分のサーバー] --APIキー--> [生成AI]
                                    ↑ ここにだけキーがある
```

サーバー側（Node / Edge Function / Cloud Functions のいずれでも同じ）:

```javascript
// server: /api/sfx  — キーはここから外に出ない
export async function POST(req) {
  const { text, duration_seconds = 1.5 } = await req.json();

  // 課金される経路なので、入力を検証し、レート制限をかける。
  // 公開エンドポイントを無防備に置くと、他人に請求書を書かせることになる。
  if (typeof text !== 'string' || text.length > 200) {
    return new Response('bad request', { status: 400 });
  }

  const r = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': process.env.ELEVENLABS_API_KEY,   // サーバー環境変数
    },
    body: JSON.stringify({ text, duration_seconds, prompt_influence: 0.75 }),
  });

  if (!r.ok) return new Response('upstream error', { status: 502 });
  return new Response(r.body, { headers: { 'Content-Type': 'audio/mpeg' } });
}
```

---

## 3. 実装（クライアント側・キャッシュ付き）

```javascript
import { audio } from '../assets/audio-engine.js';

/**
 * AI生成音を取得して再生する。
 * キャッシュが要点。これがないと、同じ音を鳴らすたびに課金され、
 * かつネットワーク待ちで音が遅れる。
 */
async function playAiSound(key, promptText, { duration = 1.5, bus = 'sfx' } = {}) {
  const buffer = await audio.loadBuffer(key, async () => {
    const res = await fetch('/api/sfx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: promptText, duration_seconds: duration }),
    });
    // これを忘れると、401 のエラーHTMLを decodeAudioData に渡して
    // 「DOMException: Unable to decode audio data」という無関係なエラーで悩むことになる。
    if (!res.ok) throw new Error(`sfx fetch failed: ${res.status}`);
    return res.arrayBuffer();
  });

  return audio.playBuffer(buffer, { bus });
}

// 実戦での使い方: ゲーム開始前にまとめて取得しておく（プリロード）。
// 「鳴らしたい瞬間に取りに行く」は、この方式では必ず遅れる。
async function preloadVoices() {
  await Promise.all([
    playAiSoundPreload('laser',    'futuristic laser cannon firing with heavy bass'),
    playAiSoundPreload('gameover', 'deep ominous game over sting'),
  ]);
}
```

### 元の実装から直した点

| 箇所 | 問題 |
| :--- | :--- |
| URL がマークダウンリンクのまま貼られていた（`'[https://...](https://...)'`） | この文字列で `fetch` すると相対パス扱いになり 404。**コピペ由来の事故で、実際によく起きる** |
| `process.env.ELEVENLABS_API_KEY` をブラウザで参照 | キーが配信ファイルに載る／`process` が存在しない |
| `response.ok` を確認せず `decodeAudioData` | 401/429 のエラーレスポンスをデコードしようとして、原因と無関係なエラーになる |
| キャッシュなし | 鳴らすたびに課金・遅延 |
| `audioCtx.destination` へ直結 | 音量バスを通らないので、ユーザーの音量設定が効かない |

---

## 4. プロシージャル環境音（AudioWorklet）

風・雨・エンジンのような**継続音**は、ループ素材よりプロシージャル生成が向く。ループには必ず継ぎ目があり、数十秒聴けば気づかれるため。

最も簡単で効果が高いのが**フィルターノイズ**。ホワイトノイズをフィルターに通し、フィルターのパラメータを揺らすだけで風になる。

```javascript
/** 風。強さ 0〜1 で連続的に変化する。ループの継ぎ目が存在しない。 */
function createWind(ctx, dest) {
  const bufferSec = 2;
  const buf = ctx.createBuffer(1, ctx.sampleRate * bufferSec, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;   // ノイズなのでループの継ぎ目が聞こえない

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 400;
  filter.Q.value = 1.5;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  // LFO でフィルターを揺らす。これが「吹いている」感じを作る。
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.15;   // ゆっくり
  lfoGain.gain.value = 250;     // 揺れ幅
  lfo.connect(lfoGain); lfoGain.connect(filter.frequency);

  src.connect(filter); filter.connect(gain); gain.connect(dest);
  src.start(); lfo.start();

  return {
    setStrength(v) {              // 0〜1
      const t = ctx.currentTime;
      gain.gain.setTargetAtTime(v * 0.25, t, 0.5);
      filter.frequency.setTargetAtTime(300 + v * 900, t, 0.5);
      filter.Q.setTargetAtTime(1.5 + v * 3, t, 0.5);
    },
    stop() { src.stop(); lfo.stop(); },
  };
}
```

**AudioWorklet が必要になるのは**、サンプル単位の処理（物理モデル、カスタム合成）を書く時だけ。上のようなノード合成で済むなら、そちらのほうが速く軽い。`ScriptProcessorNode` は非推奨なので使わない（メインスレッドで動くためカクつく）。

---

## 5. アルゴリズム作曲（マルコフ鎖）

無限に変化する探索BGMを、モデルなしで作る最小の方法。Magenta.js はモデルが数MBあるため、この程度で足りるなら不要。

```javascript
/** 音の遷移確率テーブル。次に鳴る音を確率で選ぶ。 */
const TRANSITIONS = {
  'C4': ['E4', 'G4', 'A4', 'C4'],
  'E4': ['G4', 'C4', 'D4'],
  'G4': ['A4', 'C5', 'E4'],
  'A4': ['G4', 'C5', 'E4'],
  'C5': ['A4', 'G4'],
  'D4': ['E4', 'C4'],
};

function nextNote(current) {
  const options = TRANSITIONS[current] || ['C4'];
  return options[Math.floor(Math.random() * options.length)];
}
```

**なぜ完全ランダムにしないのか**: 完全ランダムな音列は音楽に聞こえない。「どの音の次にどの音が来やすいか」という制約だけで、耳は調性を感じ取る。テーブルをペンタトニック（黒鍵だけ）に限定すると、何を選んでも不協和にならないので失敗しにくい。

生成した音列は **§2 の先読みスケジューラ**（`audio-engine.js` の `Scheduler`）で鳴らす。`setInterval` で直接鳴らすとリズムがヨレる。

---

## 6. コストとライセンス

**このセクションの具体的な数値・条件は、必ず実装前に公式ドキュメントで確認してください。** 生成AIサービスの料金体系と利用規約は頻繁に変わり、本スキルの記述は古くなっている可能性があります。

確認すべき項目:

- **商用利用の可否**。無料プランでは商用不可というサービスは多い
- **生成物の権利帰属**。誰のものになるか、独占的に使えるか
- **クレジット表記の要否**
- **単価と課金単位**（生成秒数か、リクエスト数か、文字数か）
- **レート制限**（同時リクエスト数、月間上限）
- **学習データへの利用**（入力したプロンプトが学習に使われるか）

ユーザーに伝える時は、断定せずに「◯◯の確認が必要です」と項目で示すほうが有用です。「無料で商用利用できます」と言って後で覆るのが最悪の結果になります。

### 費用が読めなくなる典型パターン

- **キャッシュしない**: 同じ音を鳴らすたびに課金される
- **クライアントから直接叩く**: キーが漏れ、他人に使われる
- **公開エンドポイントに制限がない**: 自分のサーバー経由でも、レート制限がなければ同じこと
- **開発中のホットリロード**: 保存のたびに再生成される。開発時こそキャッシュが効く
