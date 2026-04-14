---
name: webrtc-audio-noise-suppression
description: `@shiguredo/noise-suppression` を使って、処理済み音声 track を SkyWay の publish 経路へ最小差分で載せるときに使う。変更対象は主に RnnoiseService.js と useStreamReceiver.js に限定し、Chromium 系ではノイズ抑制を有効化し、非対応ブラウザでは通常マイク publish へ安全にフォールバックする。
---

## 目的
Vue + SkyWay の既存 WebRTC 実装に対して、`@shiguredo/noise-suppression` を用いた無料のノイズ抑制を最小差分で導入する。

この Skill の目的は「新しいノイズ抑制ライブラリを増やすこと」ではなく、
**処理済みの音声 track を実際の publish 経路へ載せること**である。

---

## この Skill が前提とする公式仕様

### `@shiguredo/noise-suppression`
- 公式 npm README の `NoiseSuppressionProcessor` を使う
- `startProcessing(original_audio_track)` で処理済み `MediaStreamTrack` を取得する
- `stopProcessing()` で処理を停止する
- 対応ブラウザは **Chromium ベースのみ**
- まずは README の `assetsPath` 例に合わせ、公式 CDN の dist を使う
- 独自の wasm 配布パイプラインや Vite plugin 追加はこのタスクでは行わない

参考:
- https://www.npmjs.com/package/@shiguredo/noise-suppression
- https://github.com/shiguredo/media-processors

### SkyWay JavaScript SDK
- 任意の `MediaStreamTrack` から `LocalAudioStream` を生成できる
- そのため、処理済み `MediaStreamTrack` を `LocalAudioStream` に包んで publish する

参考:
- https://javascript-sdk.api-reference.skyway.ntt.com/core/classes/LocalAudioStream.html
- https://javascript-sdk.api-reference.skyway.ntt.com/core/index.html

---

## この Skill で守ること

### 最優先
- **最小差分**
- **既存 API shape 維持**
- **既存の join / leave / late join / 画面共有 / 背景ぼかしを壊さない**
- **`useStreamReceiver.js` は orchestrator のまま保つ**
- **DOM 寄り処理を増やさない**
- **コメント、文字コード、日本語文言を不要に触らない**

### ブラウザ方針
- `@shiguredo/noise-suppression` は Chromium ベースのみ対応
- 非対応ブラウザでは **現在の通常マイク publish へ安全にフォールバック**する
- Safari / Firefox 対応をこのタスクで追加しない

---

## 変更対象ファイル
- `src/services/RnnoiseService.js`
- `src/composables/useStreamReceiver.js`

必要最小限で許可:
- import 追加
- 小さな helper 追加
- package 追加（`@shiguredo/noise-suppression` のみ）

原則として触らない:
- `WebRTC_UI.vue`
- `VideoUIService.js`
- `SkywayRoomService.js`
- 画面共有 / 背景ぼかし / late join ロジック全体
- 無関係な整形
- 命名変更
- 関数移動
- 大規模リファクタ

---

## 現状の問題認識
現状の `RnnoiseService.js` は AudioWorklet を組んでいるが、
**SkyWay に流す処理済み track を返していない**。

また `useStreamReceiver.js` の join 時は、
`setupRnnoise()` から受けた `constraints` を `createMicrophoneStream()` に渡し、
**通常のマイク stream を publish している**。

この Skill では、
**「処理済み track を publish へ載せる」**
ところだけを直す。

---

## 実装方針

### 1. `RnnoiseService.js` の責務を差し替える
`setupRnnoise(audioDeviceId)` の export 名は維持する。
ただし中身は `@shiguredo/noise-suppression` ベースへ置き換える。

### 2. `setupRnnoise()` が返す shape
既存呼び出し側に最小差分でつなげられる shape を返す。

返却例:
- `originalTrack`
- `processedTrack`
- `processor`
- `cleanup`
- `isActive`

ここで:
- `originalTrack` は `getUserMedia()` から得た元の track
- `processedTrack` は `processor.startProcessing(originalTrack)` の戻り値
- `cleanup()` は `processor.stopProcessing()` と track stop を安全に行う
- 非対応ブラウザや初期化失敗時は `processedTrack: null` とし、フォールバック可能にする

### 3. 音声入力取得方法
`setupRnnoise()` 内で `navigator.mediaDevices.getUserMedia()` を使って元の audio track を取得する。

推奨方針:
- `deviceId` は選択中マイクを使う
- `noiseSuppression: false`
- `echoCancellation: true`
- `autoGainControl: true`

理由:
- ノイズ抑制処理を二重に掛けない
- エコーキャンセルは通話用途なので維持
- `echoCancellation: false` は 1 人ループバック確認時だけ有効な設定であり、実運用では採用しない

### 4. `assetsPath`
このタスクでは、公式 README の例に合わせて CDN を使う。

例:
`https://cdn.jsdelivr.net/npm/@shiguredo/noise-suppression@latest/dist`

このタスクでは:
- wasm を public へ手動コピーしない
- Vite の asset 解決まわりを新設しない
- まず動作優先で公式例に寄せる

### 5. `useStreamReceiver.js` の join 時音声 publish を変更する
現状:
- `setupRnnoise()` -> `constraints`
- `createMicrophoneStream(audioConstraints)`
- `publishLocal(member, { videoStream, audioStream })`

変更後:
- `setupRnnoise()` で `processedTrack` を受け取る
- `processedTrack` がある場合は `new LocalAudioStream(processedTrack, { stopTrackWhenDisabled: false })` を作る
- それを `publishLocal()` へ渡す
- `processedTrack` が無い場合だけ現在の `createMicrophoneStream()` 経路へフォールバックする

### 6. export / state 名は維持する
次は変えない:
- `setupRnnoise`
- `isRnnoiseEnabled`
- `rnnoiseHandle`

内部で package が `noise-suppression` に変わっても、
今回のタスクでは public shape の rename はしない。

### 7. leave 時 cleanup
`leaveRoom()` では既存どおり `rnnoiseHandle?.cleanup?.()` を呼ぶ。
ただし cleanup の実体は新しい `NoiseSuppressionProcessor` 側の停止処理にする。

### 8. マイク切替は今回無理に拡張しない
今回の最小差分実装では、
**join 時の publish 経路を正しくすること**を優先する。

設定パネルでマイク選択を変えたあと即時 publish 差し替えまでは、
このタスクでは必須にしない。
必要なら次タスクに分ける。

---

## 実装詳細ルール

### `RnnoiseService.js`
- 既存コメントは必要最小限の範囲でのみ更新
- `@shiguredo/rnnoise-wasm` ベースの自前 AudioWorklet 実装は今回の対象外
- `@shiguredo/noise-suppression` を公式 API の範囲だけで使う
- 未対応ブラウザや失敗時は throw より安全フォールバックを優先

### `useStreamReceiver.js`
- `useStreamReceiver.js` は orchestrator として扱う
- 音声 stream の生成分岐だけ局所修正する
- 既存の video publish、remote subscribe、mute badge、screen share、background blur は触らない
- `publishLocal()` の object shape は維持する
- `joined`, `joining`, `receivedPublicationIds`, `pendingPublicationIds` の意味を変えない

---

## 禁止事項
- whole-file rewrite
- `useStreamReceiver.js` の責務再設計
- DOM 操作の追加
- `WebRTC_UI.vue` 側の UI 改造
- late join ロジックの再設計
- screen share / blur の実装変更
- 独自ノイズ抑制アルゴリズム追加
- `@sapphi-red/web-noise-suppressor` への寄り道
- `PersonaPlex` や NVIDIA 系 SDK の導入
- 無関係な import 並び替え
- 無関係な JSDoc 修正

---

## 受け入れ条件
以下を満たしたら完了。

1. Chromium 系ブラウザで join したとき、
   ローカル音声 publish が `@shiguredo/noise-suppression` の処理済み track になる
2. 非対応ブラウザでは通常の `createMicrophoneStream()` 経路へフォールバックする
3. `leaveRoom()` 後に processor / track の cleanup が走る
4. 既存の video / screen share / background blur / late join を壊していない
5. 既存の public API 名を変えていない

---

## 最低限の検証
- syntax error がない
- join / leave が通る
- A → B の音声が届く
- Chromium 系ブラウザで console error が増えていない
- 非対応ブラウザではクラッシュせず通常マイクに落ちる
- 既存の test scenario のうち最低限これを確認:
  - 既存参加者 ↔ 新規参加者の相互表示
  - leave 後の再入室
  - mute 状態の維持
  - 話者ハイライトが消えていない

---

## 完了報告フォーマット
- 変更ファイル
- 実装した挙動変更
- 公式仕様に従った点
- フォールバック条件
- 未検証部分