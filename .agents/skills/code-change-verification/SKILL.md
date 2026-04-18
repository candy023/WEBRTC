---
name: code-change-verification
description: 変更差分の妥当性と検証の正確性を担保し、実行したことと未実行のことを混同せずに完了報告するための Skill。
---

# code-change-verification

## 目的
変更差分の妥当性と検証の正確性を担保し、実行したことと実行していないことを混同せずに完了報告するための Skill である。

## この Skill を使う場面
- 実行時挙動に影響する変更を行う
- WebRTC の接続、購読、画面共有、背景ぼかし、音声処理を変更する
- 小さな修正でも build や実機確認の範囲を整理したい
- Codex に「最小差分で検証も含めて」指示したい

## 基本方針
- 必要ファイルだけ変更する
- 必要行だけ変更する
- 無関係な整形、import 並び替え、コメント変更をしない
- syntax check と build を最初の確認軸にする
- build 成功と実機成功を分けて書く
- 実行していない検証を成功したとは書かない

## WebRTC 変更時の追加方針
- join / leave / subscribeExisting / bindOnStreamPublished の骨格を壊していないか確認する
- 音声系変更でも 2 端末の相互音声確認を別枠で扱う
- late join と再入室を最低確認項目へ入れる
- UI 表示と実装の意味がズレていないか確認する
- 旧 DTLN / 自前 WASM 前提へ戻っていないか確認する

## 最低検証
1. 変更ファイルの syntax check
2. 関連 build
3. join / leave
4. late join
5. 相互音声
6. 必要なら画面共有、背景ぼかし
7. UI 表示と実装実態の一致
8. フォールバック動作

## 音声系変更の完了報告テンプレート
- 変更ファイル
- 変更した音声経路
- 実行済み検証
  - syntax check
  - build
  - 2 端末通話の有無
  - late join の有無
- 未検証
  - iOS / Android
  - Chrome / Safari / Edge 差分
  - 長時間通話
- 既知の制約
  - browser 標準機能への依存
  - no-op 互換の残存有無
  - 一時ログの有無

## 禁止事項
- build 通過だけで実機成功と書く
- 未確認の端末差を確認済みと書く
- 修正範囲を必要以上に広げる
- whole-file rewrite を前提にする

## 完了報告
完了時は次を簡潔に書く。
- 変更ファイル
- 依頼された挙動変更
- 実行済み検証
- 未検証項目
- 制約や残課題