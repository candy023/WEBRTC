---
name: webrtc-audio-toggle-verification
description: WebRTC の音声抑制トグル変更後に、実装実態と UI 表示、フォールバック、相互音声が一致しているかを確認するための Skill。
---

# webrtc-audio-toggle-verification

## 目的
WebRTC の音声抑制トグル変更後に、実装実態と UI 表示が一致しているかを最小コストで確認するための Skill である。

## この Skill を使う場面
- 音声抑制トグルを追加した
- 音声抑制トグルの実装を変更した
- browser 標準抑制とライブラリ抑制の切り替えを入れた
- no-op トグルや表示名変更の妥当性を確認したい

## 検証の基本方針
- 表示と実態の一致を優先する
- build 成功と実機成功を分けて扱う
- 2 端末での相互音声を最低確認にする
- late join、leave、再入室を切り分けて見る
- 実際に動いていない機能名を UI に残していないか確認する

## 最低検証項目
1. 変更ファイルへ syntax check を実行する
2. build を実行する
3. 2 端末で join / leave / 再入室を確認する
4. 相互に音が聞こえることを確認する
5. A 先入室 → B 後入室で late join の相互音声を確認する
6. トグル ON / OFF と UI 表示が一致していることを確認する
7. 初期化失敗時のフォールバックが成立することを確認する

## 追加で確認してよい項目
必要なら一時的に `MediaStreamTrack.getSettings()` を使って次を確認してよい。
- `noiseSuppression`
- `echoCancellation`
- `autoGainControl`
- `deviceId`
- `sampleRate`
- `channelCount`

必要なら一時ログを追加してよいが、恒久ログは残さない。

## 確認時の観点
- UI に RNNoise と表示するなら、本当に RNNoise 系処理が有効か
- 実態が browser 標準抑制なら、そのように表示しているか
- 音声抑制ライブラリ初期化失敗時に、通話自体は継続できるか
- 画面共有や背景ぼかしと併用しても音声が切れないか
- mute 状態の整合が崩れていないか

## 未検証として明記すること
- iOS 実機
- Android 実機
- Chrome / Safari / Edge の差分
- 長時間通話時の安定性
- 端末固有のマイク制約反映差

## 禁止事項
- build が通ったことを実機成功と書かない
- 単独端末確認だけで相互音声成功と書かない
- UI 名称と実装がズレたまま完了扱いにしない

## 完了報告
完了時は次を簡潔に書く。
- 実行済み検証
- 未検証項目
- UI 表示と実装実態の関係
- フォールバック有無
- 残課題