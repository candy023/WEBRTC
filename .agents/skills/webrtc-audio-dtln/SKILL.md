---
name: webrtc-audio-dtln
description: DataDog/dtln-rs を使って、Web Audio API + AudioWorklet + WASM ベースの音声ノイズ抑制を SkyWay の publish 経路へ最小差分で導入するときに使う。現行 repo では useStreamReceiver.js を orchestrator として扱い、送話経路へ DTLN を載せる。配布は worklet / glue / wasm の分離配布を第一選択とし、single-file は AudioWorklet 環境差異で外部 wasm 取得が成立しない場合の fallback 戦術として扱う。
---

## 目的

Vue + SkyWay の既存 WebRTC 実装に対して、DataDog/dtln-rs を使った  
Web Audio API + AudioWorklet + WASM ベースのノイズ抑制を最小差分で導入する。

この Skill の目的は次の 2 点である。

1. 処理済みの音声 track を実際の publish 経路へ載せること  
2. 通話不能時は通常マイク publish へ安全に戻すこと

---

## 現行 repo の前提

### orchestrator
- 現在の orchestrator は `src/composables/useStreamReceiver.js`
- `joinRoom()` でローカル映像 / 音声を生成し、`publishLocal()` に渡す
- `leaveRoom()` で cleanup を行う

### 現在の送話経路
- 現状の音声 publish は、通常マイク stream を `publishLocal()` に渡す形が中心
- DTLN worklet が存在していても、それだけでは送話経路へ入ったことにはならない
- この Skill では、「publish する audioStream を DTLN 処理済みへ差し替える」ことを主題にする

### 既存 DTLN 関連 public ファイル
- `public/dtln-worklet.js`
- `public/dtln.js`
- `public/dtln_rs.wasm`

### 既存 RNNoise 関連
- `src/services/RnnoiseService.js`
- `public/rnnoise-processor.js`

ただし、この Skill の中心は **DTLN の送話経路導入** であり、RNNoise まわりの全面改修ではない。

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

### SkyWay JavaScript SDK
- 処理済み `MediaStreamTrack` または publish 可能な audio stream を `LocalAudioStream` に包んで publish できる
- 既存の `publishLocal()` / `joinRoom()` / `leaveRoom()` / late join の流れは壊さない

---

## この Skill で守ること

### 最優先
- **最小差分**
- **既存 API shape 維持**
- **既存の join / leave / late join / 画面共有 / 背景ぼかしを壊さない**
- **`useStreamReceiver.js` は orchestrator のまま保つ**
- **DOM 寄り処理を増やさない**
- **コメント、文字コード、日本語文言を不要に触らない**

### 音声戦略
- 音声戦略は **`dtln` と `none` の 2 モードのみ**
- 通常は `dtln` を主経路とする
- 初期化失敗、非対応、ready timeout、処理不能時のみ `none` へフォールバックする

### ブラウザ方針
- 主対象は Chromium 系実機
- Safari 対応は今回の必須目標にしない
- 非対応や不安定環境では安全に `none` へ落とす

---

## 変更対象ファイル

### 主対象
- `src/composables/useStreamReceiver.js`
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
- そのときは **single-file 化** を fallback 戦術として採用してよい
- ただし single-file は常設の第一選択ではない
- single-file を使う場合も、`public/dtln.js` は手編集ではなく再生成物で管理する

---

## 現状の問題認識

`dtln-rs` は強さ優先の候補だが、  
Web Audio API + AudioWorklet + WASM の ready 待ち、固定バッファ、CPU 負荷、  
初期無音、例外時の無音化など、通話安定性の注意点がある。

この Skill では、  
**`dtln` を主経路にしつつ、通話不能時は `none` に安全フォールバックする**  
ところまでを責務とする。

また、**worklet が存在すること** と **送話 publish 経路へ入っていること** は別物として扱う。  
最終目標は、実際に publish される `audioStream` を DTLN 処理済みに差し替えることである。

---

## 実装方針

### 1. `setupRnnoise()` の export 名は維持してよい
既存 import 互換のため、`src/services/RnnoiseService.js` の export 名 `setupRnnoise` は維持してよい。  
ただし中身は dtln 主経路でもよい。

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
- `destination.stream.getAudioTracks()[0]` の取得

### 5. ready 待ちを必須にする
`dtln-rs-demo` 系の worklet は ready 前に無音を返しうる。  
そのため publish 前に ready 待ちを入れる。

必須:
- ready event を待つ
- timeout を設ける
- timeout 時は `processedTrack: null` を返して `none` にフォールバックする
- silent publish を既定挙動にしない

### 6. `useStreamReceiver.js` の join 音声生成部は最小差分で分岐させる
現状の flow を大きく壊さず、次のように扱う。

- dtln 初期化成功  
  -> `processedTrack` を `LocalAudioStream` 化して publish
- dtln 初期化失敗 / 非対応 / timeout  
  -> `createMicrophoneStream()` 経路へフォールバック

### 7. `none` フォールバックを明示する
`dtln` 初期化失敗、非対応、ready timeout、処理不能時は  
現在の通常マイク経路へ戻す。

`none` のときは browser 標準設定を使う。  
例えば:
- `noiseSuppression: true`
- `echoCancellation: true`
- `autoGainControl: true`

### 8. leave 時 cleanup
`leaveRoom()` では既存どおり `rnnoiseHandle?.cleanup?.()` を呼んでよい。  
その cleanup の実体を dtln の AudioContext / Worklet / raw track / processed track 解放にする。

### 9. 通話中 live toggle は主題にしない
この Skill の主題は **join 時の送話経路へ DTLN を正しく載せること** である。  
通話中即時切替は別 Skill の責務として扱う。ここで無理に広げない。

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

### `src/composables/useStreamReceiver.js`
- orchestrator の責務を維持
- join 時の audio publish 経路だけ局所修正する
- 既存の video publish、remote subscribe、mute badge、screen share、background blur は触らない
- `publishLocal()` の object shape は維持する
- `joined`, `joining`, `leaving` などの意味を変えない

### `public/dtln-worklet.js`
- 必要最小限だけ触る
- `attachDtlnPostRunHook()` では裸の `DtlnPlugin` を使わず、`globalThis.DtlnPlugin` を使う
- ready / error を main thread 側で扱える形を維持する
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
- `useStreamReceiver.js` の責務再設計
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

7. `public/dtln-worklet.js` が巨大単体になっていない  
   ただし fallback として `public/dtln.js` 単体化を採用する場合は、その理由を明示する

---

## 最低限の検証

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

追加で望ましい検証:
- キーボード打鍵音の比較
- join 直後の初期無音時間
- 5分以上の連続通話での音切れ有無
- CPU 負荷が高い状態での安定性
- fallback 発動時でも通常通話が成立するか

---

## Codex への指示

Codex には次を明示する。

- 最小差分
- 現在の orchestrator は `useStreamReceiver.js`
- DTLN の主題は send path への導入
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
現在の WebRTC 実装で publish しているローカル音声を、通常マイクから DTLN 処理済み音声へ差し替えてください。  
現行 repo では `useStreamReceiver.js` が orchestrator です。  
変更は最小差分に限定し、既存の join / leave / subscribe / UI フローは壊さないでください。

Current facts:
- `useStreamReceiver.js` の `joinRoom()` は通常マイク audio stream を作って `publishLocal()` に渡している
- DTLN worklet が存在しても、それだけでは送話経路へ入ったことにはならない
- `public/dtln-worklet.js` は `ready` / `error` を port で返せる
- `attachDtlnPostRunHook()` は `globalThis.DtlnPlugin` 前提
- 分離配布は `public/dtln-worklet.js` / `public/dtln.js` / `public/dtln_rs.wasm`
- 分離配布で外部 wasm 取得が成立しない場合のみ single-file fallback を許可する
- DTLN 初期化失敗時は通常マイクへフォールバックしたい

Allowed files:
- `src/composables/useStreamReceiver.js`
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
1. DTLN AudioWorklet を使った処理済み audio stream を publish する
2. `joinRoom()` の音声生成を最小差分で差し替える
3. `leaveRoom()` で cleanup する
4. DTLN 失敗時は通常マイクへフォールバックする
5. 分離配布を第一選択にする
6. 分離配布が成立しない場合のみ single-file fallback を使う
7. 既存 API shape と UI state を壊さない

Constraints:
- 最小差分
- whole-file rewrite 禁止
- 無関係な整形やコメント変更禁止
- late join / self subscribe 防止 / 再入室 / 画面共有 / 背景ぼかし を壊さない

Expected output:
- 変更ファイル一覧
- 変更理由
- fallback 方針
- 分離配布 or single-file fallback の判断理由
- ローカル確認手順

---

## 完了報告フォーマット

- 変更ファイル
- 実装した挙動変更
- dtln 失敗時の fallback 条件
- 分離配布または single-file fallback をどう構成したか
- 未検証部分
- 残課題