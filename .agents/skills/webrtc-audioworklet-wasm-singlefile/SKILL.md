---
name: webrtc-audioworklet-wasm-singlefile
description: 単独 AudioWorklet + WASM 配信構成を扱う場合だけ、適用条件と制約を明確にして誤採用を防ぐための Skill。現行では既定提案にしない。
---

# webrtc-audioworklet-wasm-singlefile

## 目的
単独 AudioWorklet + WASM 配信構成を扱う場合だけ、適用条件と制約を明確にして誤採用を防ぐための Skill である。

## この Skill を使う場面
- ユーザーが明示的に単独 AudioWorklet + WASM 配信を求めた
- 実験目的で単一配信構成を検証したい
- 既存の worklet / wasm 単独構成を限定的に保守したい

## 現在の扱い
- 単独 AudioWorklet + WASM 配信は現行の第一選択ではない
- Vite + Vercel での安全な最小導入を優先し、この方式を既定提案にしない
- 通常提案では browser 標準ノイズ抑制、または `@sapphi-red/web-noise-suppressor` を優先する
- この方式を提案するのは、ユーザーが明示的に単一 wasm 配信や独自 worklet 構成を求めた場合のみとする

## 基本方針
- worklet / wasm のためだけに WebRTC の接続骨格を変えない
- public 配下への静的資産追加は慎重に扱う
- Vite 側の解決設定が必要なら最小差分に限定する
- 音声処理の導入はローカル音声生成経路だけに閉じる
- 初期化失敗時は browser 標準 constraints に戻す

## 禁止事項
- 独自 worklet / wasm 構成を既定経路へ自動で戻す
- 単独配信のために join / leave / publish / subscribe の流れを変更する
- 画面共有、背景ぼかし、late join 修正を同時に混ぜる
- whole-file rewrite を行う

## 検証
この方式を使う場合は最低でも次を確認する。
1. syntax check
2. build
3. asset 解決
4. join / leave
5. 相互音声
6. late join
7. 初期化失敗時フォールバック
8. UI 表示と実装実態の一致

## 完了報告
完了時は次を簡潔に書く。
- この方式を使った理由
- 追加した資産や設定
- フォールバック有無
- 実行済み検証
- 未検証項目