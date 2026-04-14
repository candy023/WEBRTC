---
name: webrtc-audio-dtln
description: DataDog/dtln-rs を使って、Web Audio API + AudioWorklet + WASM ベースの音声ノイズ抑制を SkyWay の publish 経路へ最小差分で導入するときに使う。音声戦略は dtln と none の2モードだけに限定し、dtln 初期化失敗・非対応・ready timeout・処理不能時は通常マイク publish へ安全にフォールバックする。巨大単体 worklet は作らず、worklet / glue / wasm を分離配布する。
---

## 目的
Vue + SkyWay の既存 WebRTC 実装に対して、DataDog/dtln-rs を使った  
Web Audio API + AudioWorklet + WASM ベースのノイズ抑制を最小差分で導入する。

この Skill の目的は、処理済みの音声 track を実際の publish 経路へ載せることと、  
通話不能時は通常マイク publish へ安全に戻すことにある。

---

## この Skill が前提とする公式仕様

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
- 既存の publishLocal / join / leave / late join の流れは壊さない

---

## この Skill で守ること

### 最優先
- **最小差分**
- **既存 API shape 維持**
- **既存の join / leave / late join / 画面共有 / 背景ぼかしを壊さない**
- **`useRoomSession.js` は orchestrator のまま保つ**
- **DOM 寄り処理を増やさない**
- **コメント、文字コード、日本語文言を不要に触らない**

### 音声戦略
- 音声戦略は **`dtln` と `none` の2モードのみ**
- `shiguredo` は採用しない
- 通常は `dtln` を主経路とする
- 初期化失敗、非対応、ready timeout、処理不能時のみ `none` へフォールバックする

### ブラウザ方針
- 主対象は Chromium 系実機
- Safari 対応は今回の必須目標にしない
- 非対応や不安定環境では安全に `none` へ落とす

---

## 変更対象ファイル
- `src/services/RnnoiseService.js`
- `src/composables/useRoomSession.js`

必要なら追加を許可:
- `public/dtln-worklet.js`
- `public/dtln.js`
- `public/dtln_rs.wasm`
- dtln 導入に最低限必要な設定ファイル
- `package.json` の最小限の依存追加

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

## 配布構成の方針
- `public/dtln-worklet.js` を巨大単体配布にしない
- AudioWorklet 本体は薄いエントリに保つ
- dtln glue は `public/dtln.js` に分離する
- wasm 本体は `public/dtln_rs.wasm` に分離する
- 目的は join 時の module load / parse / init コストを下げ、ready timeout を起こしにくくすること
- 単体巨大 worklet を新たに生成しない

---

## 現状の問題認識
`dtln-rs` は強さ優先の候補だが、  
Web Audio API + AudioWorklet + WASM の ready 待ち、固定バッファ、CPU 負荷、  
初期無音、例外時の無音化など、通話安定性の注意点がある。

この Skill では、  
**`dtln` を主経路にしつつ、通話不能時は `none` に安全フォールバックする**  
ところまでを責務とする。

---

## 実装方針

### 1. `RnnoiseService.js` の責務を dtln 主経路へ置き換える
ファイル名と export 名 `setupRnnoise` は既存 import 互換のため維持してよい。  
ただし中身は `dtln-rs` ベースの初期化へ置き換える。

### 2. `setupRnnoise()` が返す shape
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

### 3. Web Audio API + AudioWorklet + WASM の主構成
`RnnoiseService.js` 内で次を担当する。

- `AudioContext` の生成
- `audioWorklet.addModule()` による worklet 読み込み
- WASM / dtln 初期化
- `navigator.mediaDevices.getUserMedia()` による元音声取得
- `MediaStreamSource -> AudioWorkletNode -> MediaStreamDestination` の接続
- `destination.stream.getAudioTracks()[0]` の取得

### 4. ready 待ちを必須にする
`dtln-rs-demo` の worklet は ready 前に無音を返しうるため、  
publish 前に ready 待ちを入れる。

必須:
- ready event を待つ
- timeout を設ける
- timeout 時は `processedTrack: null` を返して `none` にフォールバックする
- silent publish を既定挙動にしない

### 5. `none` フォールバックを明示する
`dtln` 初期化失敗、非対応、ready timeout、処理不能時は  
現在の `createMicrophoneStream()` 経路へ戻す。

`none` のときは browser 標準設定を使う。  
例えば:
- `noiseSuppression: true`
- `echoCancellation: true`
- `autoGainControl: true`

### 6. `useRoomSession.js` の join 音声生成部は最小差分で分岐させる
現状:
- `setupRnnoise()` を呼ぶ
- `processedTrack` があれば `LocalAudioStream` 化して publish
- 無ければ `createMicrophoneStream()` へフォールバック

この shape を維持し、  
内部戦略だけ `dtln` / `none` にする。

### 7. `stopTrackWhenDisabled`
mute/unmute や再利用の安全性を優先し、基本は `false` を検討する。  
ただし SDK 既存挙動との整合を崩さないこと。

### 8. leave 時 cleanup
`leaveRoom()` では既存どおり `rnnoiseHandle?.cleanup?.()` を呼ぶ。  
その cleanup の実体を dtln の AudioContext / Worklet / raw track / processed track 解放にする。

---

## 実装詳細ルール

### `RnnoiseService.js`
- 既存コメントは必要最小限の範囲でのみ更新
- export 名 `setupRnnoise` は維持してよい
- dtln 主経路で実装する
- `none` は呼び出し側フォールバック前提
- 非対応や失敗時は throw より安全フォールバックを優先
- 単体巨大 worklet を前提にしない

### `useRoomSession.js`
- orchestrator の責務を維持
- join 時の audio publish 経路だけ局所修正する
- 既存の video publish、remote subscribe、mute badge、screen share、background blur は触らない
- `publishLocal()` の object shape は維持する
- `joined`, `joining`, `leaving` などの意味を変えない

---

## 禁止事項
- whole-file rewrite
- `useRoomSession.js` の責務再設計
- DOM 操作の追加
- `WebRTC_UI.vue` 側の UI 改造
- late join ロジックの再設計
- screen share / blur の実装変更
- `shiguredo` を比較経路として残すこと
- wasm / glue / worklet を 1 ファイルへ再結合する巨大単体配布
- 無関係な import 並び替え
- 無関係な JSDoc 修正

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
6. `public/dtln-worklet.js` が巨大単体になっていない
7. `public/dtln.js` と `public/dtln_rs.wasm` を分離配布し、参照が通っている

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
- 分離配布後に ready timeout が改善しているか

---

## 完了報告フォーマット
- 変更ファイル
- 実装した挙動変更
- dtln 失敗時の fallback 条件
- 分離配布をどう構成したか
- 未検証部分
- 残課題