---
name: webrtc-audio-dtln
description: DataDog/dtln-rs を使って、Web Audio API + AudioWorklet + WASM ベースの音声ノイズ抑制を SkyWay の publish 経路へ最小差分で導入・調整するときに使う。現行 repo では useRoomSession.js が room join/leave の本体であり、送話経路へ DTLN を載せた後の音量低下調査と最小修正もこの Skill の責務に含める。配布は worklet / glue / wasm の分離配布を第一選択とし、single-file は AudioWorklet 環境差異で外部 wasm 取得が成立しない場合の fallback 戦術として扱う。
---

## 目的

Vue + SkyWay の既存 WebRTC 実装に対して、DataDog/dtln-rs を使った  
Web Audio API + AudioWorklet + WASM ベースのノイズ抑制を最小差分で導入する。

この Skill の目的は次の 3 点である。

1. 処理済みの音声 track を実際の publish 経路へ載せること
2. 通話不能時は通常マイク publish へ安全に戻すこと
3. DTLN 導入後に発生する声の音量低下・聞き取りづらさを、公式準拠で調査し最小差分で改善すること

---

## 現行 repo の前提

### room join / leave の本体
- 現在の room join / leave 本体は `src/composables/useRoomSession.js`
- `joinRoom()` でローカル映像 / 音声を生成し、`publishLocal()` に渡す
- `leaveRoom()` で cleanup を行う
- `replaceLocalAudioForRnnoiseToggle()` で通話中の音声差し替えを行う

### 現在の送話経路
- `createLocalAudioStream()` で `setupRnnoise()` を呼ぶ
- `processedTrack` があれば `LocalAudioStream` 化して publish する
- `processedTrack` が無い場合だけ通常マイク stream にフォールバックする

### 既存 DTLN 関連 public ファイル
- `public/dtln-worklet.js`
- `public/dtln.js`
- `public/dtln_rs.wasm`

### 既存 RNNoise 関連
- `src/services/RnnoiseService.js`
- `public/rnnoise-processor.js`

ただし、この Skill の中心は DTLN の送話経路導入と、その後の音量調整であり、RNNoise 系の全面改修ではない。

---

## この Skill が前提とする外部仕様

### DataDog/dtln-rs
- 公式 README に従う
- near real-time noise suppression を提供する
- WebAssembly module、native Rust target、Node native module を生成できる
- WebRTC と interface 可能である
- ライセンスは MIT

参考:
- https://github.com/DataDog/dtln-rs

### DataDog/dtln-rs-demo
- browser demo の構成を主資料にする
- browser では Web Audio API + AudioWorklet + WASM を使う
- demo は録音と処理を分離した限定実装であり、そのまま本番通話導線とは見なさない
- worklet ready 前や処理不能時に無音を返しうる点を前提にする

参考:
- https://github.com/DataDog/dtln-rs-demo

### Web Audio API
- `GainNode` は標準の音量補正手段として使ってよい
- 必要なら `DynamicsCompressorNode` を後段ピーク抑制に使ってよい
- AudioWorklet 内では `import()` は使えないため、dynamic import を前提にしない

### SkyWay JavaScript SDK
- 処理済み `MediaStreamTrack` または publish 可能な audio stream を `LocalAudioStream` に包んで publish できる
- 既存の `publishLocal()` / `joinRoom()` / `leaveRoom()` / late join の流れは壊さない

---

## この Skill で守ること

### 最優先
- 最小差分
- 既存 API shape 維持
- 既存の join / leave / late join / 画面共有 / 背景ぼかしを壊さない
- `useRoomSession.js` は orchestrator のまま保つ
- DOM 寄り処理を増やさない
- コメント、文字コード、日本語文言を不要に触らない

### 音声戦略
- 音声戦略は `dtln` と `none` の 2 モードのみ
- 通常は `dtln` を主経路とする
- 初期化失敗、非対応、ready timeout、処理不能時のみ `none` へフォールバックする

### 音量低下調査の原則
- まず原因調査を優先する
- 「ノイズ抑制が強すぎる」と断定しない
- `processedTrack` のレベル低下を最優先で疑う
- `autoGainControl` / `echoCancellation` / `sampleRate` / 後段 Gain の有無を確認する
- 調査前に大きなロジック変更をしない

### ブラウザ方針
- 主対象は Chromium 系実機
- Safari 対応は今回の必須目標にしない
- 非対応や不安定環境では安全に `none` へ落とす

---

## 変更対象ファイル

### 主対象
- `src/composables/useRoomSession.js`
- `src/services/RnnoiseService.js`

### 必要なら追加を許可
- `src/services/DtlnService.js`
- `public/dtln-worklet.js`
- `public/dtln.js`
- `public/dtln_rs.wasm`
- dtln 導入に最低限必要な設定ファイル
- `package.json` の最小限の依存追加
- `scripts/build-dtln-singlefile.mjs`

### 原則として触らない
- `WebRTC_UI.vue`
- `VideoUIService.js`
- `SkywayRoomService.js`
- 画面共有 / 背景ぼかし / late join ロジック全体
- 無関係な整形
- 命名変更
- 関数移動
- 大規模リファクタ
- `public/rnnoise-processor.js`

---

## 配布構成の方針

### 第一選択
- `public/dtln-worklet.js` を薄い AudioWorklet エントリに保つ
- dtln glue は `public/dtln.js` に分離する
- wasm 本体は `public/dtln_rs.wasm` に分離する
- 目的は join 時の module load / parse / init コストを下げ、ready timeout を起こしにくくすること
- 巨大単体 worklet を新たに生成しない

### fallback 戦術
- AudioWorklet 実行環境差異により、外部 wasm 取得が成立しない場合がある
- そのときは single-file 化を fallback 戦術として採用してよい
- ただし single-file は常設の第一選択ではない
- single-file を使う場合も、`public/dtln.js` は手編集ではなく再生成物で管理する

---

## 現状の問題認識

### 送話経路
- DTLN の ready 到達と processedTrack publish は達成できる
- fallback 原因としては過去に `WorkletGlobalScope` での dynamic import 禁止があった
- これは `public/dtln-worklet.js` の static import 化で解消できる

### 音量低下
- DTLN 導入後、ノイズは抑制されるが声が極端に小さくなることがある
- 最有力原因は次の組み合わせ
  1. `processedTrack` の実効レベル低下
  2. `autoGainControl: false`
  3. 後段 `GainNode` 不在
- 補助要因として `sampleRate: 16000` 固定による体感上のこもり・明瞭度低下がある
- remote 再生側は二次候補として扱う

---

## 実装方針

### 1. `setupRnnoise()` の export 名は維持してよい
既存 import 互換のため、`src/services/RnnoiseService.js` の export 名 `setupRnnoise` は維持してよい。  
ただし中身は dtln 主経路でよい。

### 2. より明確に分けたい場合は新規 service を追加してよい
複雑化を避けるために、必要なら `src/services/DtlnService.js` を追加してよい。  
その場合も orchestrator 側の変更は最小に留める。

### 3. 返却 shape
既存呼び出し側に最小差分でつなげられる shape を返す。

返却例:
- `constraints`
- `originalTrack`
- `processedTrack`
- `cleanup`
- `isActive`
- 必要なら `processor` や `audioContext`

ここで:
- `originalTrack` は元のマイク track
- `processedTrack` は dtln 処理後の track
- `cleanup()` は worklet / context / raw track / destination track を安全に止める
- dtln が使えない場合は `processedTrack: null` とし、呼び出し側が `none` へ落ちるようにする

### 4. Web Audio API + AudioWorklet + WASM の主構成
service 内で次を担当する。

- `AudioContext` の生成
- `audioWorklet.addModule('/dtln-worklet.js')`
- 必要なら DTLN glue / wasm の初期化
- `navigator.mediaDevices.getUserMedia()` による元音声取得
- `MediaStreamSource -> AudioWorkletNode -> MediaStreamDestination` の接続
- 必要なら `GainNode` / `DynamicsCompressorNode` の接続
- `destination.stream.getAudioTracks()[0]` の取得

### 5. ready 待ちを必須にする
publish 前に ready 待ちを入れる。

必須:
- ready event を待つ
- timeout を設ける
- timeout 時は `processedTrack: null` を返して `none` にフォールバックする
- silent publish を既定挙動にしない

### 6. `useRoomSession.js` の join 音声生成部は最小差分で分岐させる
- dtln 初期化成功
  - `processedTrack` を `LocalAudioStream` 化して publish
- dtln 初期化失敗 / 非対応 / timeout
  - `createMicrophoneStream()` 経路へフォールバック

### 7. `none` フォールバックを明示する
`dtln` 初期化失敗、非対応、ready timeout、処理不能時は  
通常マイク経路へ戻す。

`none` のときは browser 標準設定を使う。  
例えば:
- `noiseSuppression: true`
- `echoCancellation: true`
- `autoGainControl: true`

### 8. leave 時 cleanup
`leaveRoom()` では既存どおり `rnnoiseHandle?.cleanup?.()` を呼んでよい。  
その cleanup の実体を dtln の AudioContext / Worklet / raw track / processed track 解放にする。

### 9. 通話中 live toggle は主題にしない
この Skill の主題は join 時の送話経路へ DTLN を正しく載せることと、その後の音量問題の調査・最小修正である。  
通話中即時切替の大規模改善へ無理に広げない。

---

## 音量低下調査フェーズ

### 調査時に必ず取るもの
- raw track の `getSettings()` / `getConstraints()`
- processed track の `getSettings()` / `getConstraints()`
- `AudioContext.sampleRate`
- raw RMS / peak
- processed RMS / peak
- processed / raw の相対レベル差（dB）
- processed track の `readyState`

### 最有力原因の判定
- `processedVsRawDb` が大きくマイナス
  - DTLN 後のレベル低下が主因
- AGC off / EC off / 16kHz
  - 体感悪化の補助要因
- remote 側 volume / sink / muted
  - 二次候補

### 調査時の禁止事項
- いきなりモデルを差し替えない
- 調査前に gain 値を何個も増やしすぎない
- remote 側と send path 側を同時に大きく変えない

---

## 音量低下への最小修正ルール

### 第一候補
- `GainNode` を追加する
- 接続は `sourceNode -> workletNode -> gainNode -> destinationNode`
- 初期ゲインは小さく始める
  - 例: `1.5`
  - 必要なら `1.8`
  - 必要なら `2.0`
- まずは fixed gain で原因切り分けする

### 第二候補
- `autoGainControl: true` を戻す
- 必要なら `echoCancellation: true` も戻す
- `noiseSuppression` は DTLN と二重にならないよう慎重に扱う

### 第三候補
- ゲイン後に歪む場合だけ `DynamicsCompressorNode` を追加する

### 原則やらない
- DTLN モデル前提を壊すサンプルレート変更
- ノイズ抑制アルゴリズムそのものの置換
- UI や接続ロジックまで同時改修

---

## 実装詳細ルール

### `src/services/RnnoiseService.js` または `src/services/DtlnService.js`
- 既存コメントは必要最小限の範囲でのみ更新
- export 名 `setupRnnoise` は維持してよい
- dtln 主経路で実装してよい
- `none` は呼び出し側フォールバック前提
- 非対応や失敗時は throw より安全フォールバックを優先
- 単体巨大 worklet を前提にしない
- `public/dtln.js` の場当たり的手編集は避ける

### `src/composables/useRoomSession.js`
- orchestrator の責務を維持
- join 時の audio publish 経路だけ局所修正する
- 既存の video publish、remote subscribe、mute badge、screen share、background blur は触らない
- `publishLocal()` の object shape は維持する
- `joined`, `joining`, `leaving` などの意味を変えない

### `public/dtln-worklet.js`
- 必要最小限だけ触る
- `attachDtlnPostRunHook()` では裸の `DtlnPlugin` を使わず、`globalThis.DtlnPlugin` を使う
- ready / error を main thread 側で扱える形を維持する
- dynamic import を前提にしない
- 診断ログは検証用に限定し、本番向けでは増やしすぎない

---

## single-file fallback の扱い

### 使う条件
次のような場合のみ single-file を使ってよい。

- AudioWorklet 内の `fetch / XMLHttpRequest / importScripts / window` が使えず、外部 wasm 取得が成立しない
- `Aborted(both async and sync fetching of the wasm failed)` が発生する
- 分離配布構成では ready 到達が不可能

### やり方
- `public/dtln_rs.wasm` を base64 等で `public/dtln.js` に埋め込む
- `Module.wasmBinary` を設定して外部取得を不要にする
- `public/dtln.js` は再生成物として管理する
- 必要なら `scripts/build-dtln-singlefile.mjs` を使う

### 注意
- single-file は重くなる
- 初回ロード / パースコストが増える
- したがって常設の第一選択にしない
- fallback 戦術として位置づける

---

## 禁止事項

- whole-file rewrite
- `useRoomSession.js` の責務再設計
- DOM 操作の追加
- `WebRTC_UI.vue` 側の UI 改造
- late join ロジックの再設計
- screen share / blur の実装変更
- RNNoise 系、UI 系、接続系をまとめて全面改修すること
- wasm / glue / worklet を常設前提で 1 ファイルへ再結合すること
- 無関係な import 並び替え
- 無関係な JSDoc 修正
- コメントや日本語文言の無関係な変更

---

## 受け入れ条件

以下を満たしたら完了。

1. Chromium 系ブラウザで join したとき、
   `dtln` 経路で処理済み音声 track を publish できる

2. dtln 初期化失敗、非対応、ready timeout、処理不能時は
   `none` として通常マイク publish へ安全に落ちる

3. `leaveRoom()` 後に AudioContext / Worklet / track の cleanup が走る

4. 既存の video / screen share / background blur / late join を壊していない

5. 既存の public API 名を大きく変えていない

6. 分離配布を第一選択とし、single-file は fallback として扱われている

7. 音量低下調査時に raw / processed の相対レベル差が取れる

8. 音量低下修正は GainNode / AGC / 必要時 Compressor の順で最小差分に留まっている

---

## 最低限の検証

### 基本
- syntax error がない
- join / leave が通る
- A → B の音声が届く
- Chromium 系ブラウザで console error が増えていない
- dtln ready timeout 時に `none` へ落ちる
- 既存の test scenario のうち最低限これを確認:
  - 既存参加者 ↔ 新規参加者の相互表示
  - leave 後の再入室
  - mute 状態の維持
  - 話者ハイライトが消えていない

### 音量問題の追加確認
- raw vs processed のレベル差
- 大声・通常声の両方で相手に十分聞こえるか
- イヤホン再生でも聞き取りやすいか
- ゲイン追加後に歪みが出ていないか
- AGC を戻したときにノイズ抑制が破綻しないか

---

## Codex への指示

Codex には次を明示する。

- 最小差分
- 現在の room join / leave 本体は `useRoomSession.js`
- DTLN の主題は send path への導入と、その後の音量低下調査 / 最小修正
- join 時の audio publish 経路だけ局所修正する
- `public/dtln-worklet.js` / `public/dtln.js` / `public/dtln_rs.wasm` は必要なときだけ触る
- 分離配布を第一選択
- single-file は fallback としてのみ使う
- DTLN 失敗時は通常マイクへフォールバック
- `public/rnnoise-processor.js` は触らない
- WebRTC 接続・購読・UI フローは触らない
- whole-file rewrite 禁止

---

## Codex 依頼テンプレート

Task:
現在の WebRTC 実装では DTLN の processedTrack publish は通っているが、声が極端に小さい。  
原因調査と最小修正を行ってください。room join / leave 本体は `useRoomSession.js` です。  
変更は最小差分に限定し、既存の join / leave / subscribe / UI フローは壊さないでください。

Current facts:
- `useRoomSession.js` では processedTrack があれば `LocalAudioStream` 化して publish する
- DTLN worklet は ready まで到達できる
- processedTrack ready / using dtln path が出ている
- 実通話ではノイズはかなり抑制されるが、声が極端に小さい
- 最有力候補は processedTrack のレベル低下、AGC off、後段 GainNode 不在
- 分離配布は `public/dtln-worklet.js` / `public/dtln.js` / `public/dtln_rs.wasm`
- 分離配布で外部 wasm 取得が成立しない場合のみ single-file fallback を許可する

Allowed files:
- `src/composables/useRoomSession.js`
- `src/services/RnnoiseService.js`
- 必要なら `src/services/DtlnService.js`
- 必要なら `public/dtln-worklet.js`
- 必要なら `public/dtln.js`
- 必要なら `public/dtln_rs.wasm`
- 必要なら `scripts/build-dtln-singlefile.mjs`
- 必要なら `package.json`

Do not touch:
- `src/services/MediaStreamService.js`
- `src/services/SkywayRoomService.js`
- `public/rnnoise-processor.js`
- `src/components/*`
- WebRTC の join/leave/subscribe の大枠
- UI レイヤー全般

Goals:
1. raw / processed のレベル差を確認する
2. 最有力原因を固定する
3. 必要最小限で GainNode / AGC / 必要時 Compressor の順に調整する
4. DTLN 失敗時は通常マイクへフォールバックする
5. 分離配布を第一選択にする
6. 分離配布が成立しない場合のみ single-file fallback を使う
7. 既存 API shape と UI state を壊さない

Constraints:
- 最小差分
- whole-file rewrite 禁止
- 無関係な整形やコメント変更禁止
- late join / self subscribe 防止 / 再入室 / 画面共有 / 背景ぼかしを壊さない

Expected output:
- 変更ファイル一覧
- 原因整理
- 最小修正案
- fallback 方針
- 分離配布 or single-file fallback の判断理由
- ローカル確認手順

---

## 完了報告フォーマット

- 変更ファイル
- 実装した挙動変更
- dtln 失敗時の fallback 条件
- 分離配布または single-file fallback をどう構成したか
- 音量低下の最有力原因
- 未検証部分
- 残課題