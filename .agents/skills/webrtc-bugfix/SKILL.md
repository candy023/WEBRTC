---
name: webrtc-bugfix
description: WebRTC の接続、購読、表示、画面共有、背景ぼかし、音声処理まわりの不具合を、既存フローを壊さず最小差分で修正するための Skill。
---

# webrtc-bugfix

## 目的
WebRTC の接続、購読、表示、画面共有、背景ぼかし、音声処理まわりの不具合を、既存フローを壊さず最小差分で修正するための Skill である。

## この Skill を使う場面
- late join が壊れている
- self subscribe が起きている
- join / leave / 再入室がおかしい
- 画面共有や背景ぼかしの差し替え順が壊れている
- 音声抑制の導入や変更で WebRTC の骨格を守りたい

## 基本方針
- `useStreamReceiver.js` などの orchestrator は順序制御と state 管理を優先する
- DOM 寄り処理は既存 service へ寄せる
- late join、self subscribe 防止、publish / unpublish / attach の順序を最優先で守る
- 音声系修正でも接続バグ修正と切り離して考える
- `publishLocal(member, { videoStream, audioStream })` の契約は崩さない

## 不変条件
- `subscribeExisting()` と `bindOnStreamPublished()` の責務分離を維持する
- self publication を remote subscribe しない
- attach 先 DOM が未準備のまま表示成功扱いにしない
- 画面共有と背景ぼかしの差し替え順を壊さない
- 画面共有停止後は camera に戻る
- 背景ぼかし OFF 後は通常 camera に戻る
- 音声修正のために room 参加導線を変えない
- 音声 publish の差し替え時も、必要なら mute state を維持する

## 音声抑制導入時の追加方針
- `@sapphi-red/web-noise-suppressor` の導入は許可する
- ただしローカル音声生成経路だけに閉じる
- remote subscribe、remote 表示、タイル構造は触らない
- 初期化失敗時フォールバックを必須とする
- UI 表示だけを直す依頼では接続処理を触らない

## 推奨アプローチ
1. 不具合の責務を切り分ける
2. 接続問題か表示問題かを分ける
3. 最小差分で直す
4. 無関係な UI 調整や設計変更を混ぜない
5. 修正後は late join、再入室、share、blur を最低確認する

## 禁止事項
- whole-file rewrite
- 接続問題の修正に UI 全面組み替えを混ぜる
- UI 修正のついでに接続フローを広く変更する
- 音声修正のためだけに room や subscribe ロジックを再設計する
- 一度に複数の責務を大きく変える

## 検証
最低でも次を確認する。
- 既存参加者 ↔ 新規参加者 の相互表示
- self subscribe 非発生
- join / leave / 再入室
- 画面共有開始 / 停止
- 背景ぼかし ON / OFF
- 相互音声
- 音声抑制導入時のフォールバック

## 完了報告
完了時は次を簡潔に書く。
- 変更ファイル
- 修正した不具合
- 守った不変条件
- 実行済み検証
- 未検証項目
- 残課題