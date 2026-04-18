---
name: webrtc-audio-dtln
description: DTLN ベースの音声抑制を扱う場合だけ、適用条件と制約を明確にして誤採用を防ぐための Skill。現行では既定提案にしない。
---

# webrtc-audio-dtln

## 目的
DTLN ベースの音声抑制を扱う場合だけ、適用条件と制約を明確にして誤採用を防ぐための Skill である。

## この Skill を使う場面
- ユーザーが明示的に DTLN を使いたいと指定した
- DTLN と他方式の比較実験をしたい
- 既存の DTLN 実装を限定的に保守したい

## 現在の扱い
- DTLN は現行の第一選択ではない
- 既定提案として DTLN を採用しない
- 通常提案では browser 標準ノイズ抑制、または `@sapphi-red/web-noise-suppressor` を優先する
- DTLN を使うのは、ユーザーが明示的に DTLN を求めた場合か、比較実験が目的の場合のみとする

## 基本方針
- DTLN 採用時も join / leave / publish / subscribe の骨格は壊さない
- DTLN 導入は音声生成経路だけに閉じる
- remote subscribe、remote 表示、タイル構造は変更しない
- DTLN のためだけに UI 名称を先行変更しない
- 初期化失敗時は browser 標準 constraints に戻せる設計を優先する

## 禁止事項
- DTLN を既定提案として復活させる
- public 配下の独自資産管理を前提とした大きな構成へ自動で戻す
- DTLN 導入のついでに room session や subscribe 経路を再設計する
- whole-file rewrite を行う

## 検証
DTLN を触る場合は最低でも次を確認する。
1. syntax check
2. build
3. join / leave
4. 相互音声
5. late join
6. 初期化失敗時フォールバック
7. UI 表示と実装実態の一致

## 完了報告
完了時は次を簡潔に書く。
- DTLN を使った理由
- 変更ファイル
- browser 標準フォールバック有無
- 実行済み検証
- 未検証項目