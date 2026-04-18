---
name: webrtc-audio-noise-suppression
description: WebRTC のローカル音声ノイズ抑制を、安全な最小差分で導入・修正するための Skill。現行の第一候補は @sapphi-red/web-noise-suppressor とし、失敗時は browser 標準 constraints にフォールバックする。
---

# webrtc-audio-noise-suppression

## 目的
WebRTC アプリのローカル音声ノイズ抑制を、安全な最小差分で導入または修正するための Skill である。
現行の第一候補は `@sapphi-red/web-noise-suppressor` を使った実装とし、失敗時は browser 標準の音声制約へフォールバックする。

## この Skill を使う場面
- ローカル音声のノイズ抑制を追加したい
- 既存の音声抑制実装を browser 標準から改善したい
- DTLN / 独自 AudioWorklet / 独自 WASM 配信をやめて、Vite + Vercel で載せやすい構成へ寄せたい
- 音声処理を変えたいが、join / leave / publish / subscribe の骨格は壊したくない

## 現在の基準方針
- 既定の音声入力は browser 標準 constraints を基準にする
- 標準セットは次を使う
  - `noiseSuppression: true`
  - `echoCancellation: true`
  - `autoGainControl: true`
- マイク選択がある場合のみ `deviceId` を追加する
- ノイズ抑制ライブラリの導入は、ローカル音声生成経路だけに閉じる
- 既存の room 接続、購読、remote 表示責務には波及させない
- `@sapphi-red/web-noise-suppressor` は第一候補として扱う
- ライブラリ初期化に失敗した場合は、browser 標準 constraints に即フォールバックする

## 守ること
- 変更対象は必要最小限に限定する
- `publishLocal(member, { videoStream, audioStream })` の呼び出し形は維持する
- 音声修正のために `subscribeExisting()`、`bindOnStreamPublished()`、`leave()` を変更しない
- UI の名称は実装実態と一致させる
- ライブラリ初期化失敗時も通話参加自体は継続可能にする
- mute 状態がある場合は、音声差し替え後も必要に応じて維持する

## 実装方針
1. まず browser 標準 constraints を基準実装として残す
2. その上で `@sapphi-red/web-noise-suppressor` をローカル音声生成経路へ最小差分で追加する
3. ノイズ抑制ライブラリの初期化と失敗時フォールバックを service 側へ寄せる
4. composable 側は orchestration にとどめる
5. UI 表示は「実際に有効な機能名」に合わせる
6. 安定しない live toggle を無理に入れない
7. live toggle が不安定なら「次回 join から反映」方式を優先してよい

## 禁止事項
- 音質改善だけの依頼で join / leave / subscribe の骨格を組み替えない
- DTLN を既定経路へ戻さない
- public 配下へ独自 wasm/js を再配置する前提で書かない
- 独自 AudioWorklet / 独自 WASM 配信 / processedTrack 差し替えを既定提案にしない
- 音声処理変更のついでに画面共有、背景ぼかし、late join 修正を混ぜない
- whole-file rewrite をしない
- 無関係なリファクタをしない

## 推奨される変更対象
- `src/composables/useRoomSession.js`
- `src/services/RnnoiseService.js`
- 必要なら UI の最小差分
- 必要なら `package.json` の依存追加のみ

## 検証
最低でも次を確認する。
1. 変更ファイルの syntax check
2. build
3. join / leave
4. 2 端末で相互に音が聞こえること
5. late join で相互音声が壊れていないこと
6. 初期化失敗時に browser 標準 constraints へ戻ること
7. UI 表示と実際の機能が一致していること

必要なら一時的に `track.getSettings()` を使って次を確認してよい。
- `noiseSuppression`
- `echoCancellation`
- `autoGainControl`
- `deviceId`
- `sampleRate`
- `channelCount`

## 完了報告
完了時は次を簡潔に書く。
- 変更ファイル
- 採用した音声経路
- browser 標準フォールバックの有無
- 実行済み検証
- 未検証項目
- 既知の制約