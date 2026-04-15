---
name: webrtc-audioworklet-wasm-singlefile
description: AudioWorklet 内で Emscripten/WASM ベースの音声処理が失敗する問題を切り分けし、DTLN の single-file 化を優先して最小差分で修正するための Skill。対象は public/dtln-worklet.js, public/dtln.js, public/dtln_rs.wasm を中心とし、public/rnnoise-processor.js は参照用として扱う。
---

# AudioWorklet + DTLN single-file 修正 Skill

## 目的

AudioWorklet 内で DTLN の Emscripten ローダーが失敗する問題を、最小差分で安全に直す。  
この Skill では、AudioWorklet 実行環境で `fetch` / `XMLHttpRequest` / `importScripts` / `window` が使えない前提を置き、**DTLN の single-file 化を本命**として扱う。

---

## 現在の対象ファイル

- `public/dtln-worklet.js`
- `public/dtln.js`
- `public/dtln_rs.wasm`
- `public/rnnoise-processor.js`

### 役割
- `public/dtln-worklet.js`  
  DTLN 用の AudioWorkletProcessor。本 Skill の主対象。

- `public/dtln.js`  
  DTLN の Emscripten 生成ローダー。本来は手編集せず、再生成物で置き換える。

- `public/dtln_rs.wasm`  
  元の wasm バイナリ。single-file 化の元データ。残してよいが、single-file 採用後は実行時依存先にしない。

- `public/rnnoise-processor.js`  
  RNNoise 用の AudioWorkletProcessor。比較対象・参考実装。**明示依頼がない限り変更しない。**

---

## この Skill を使う症状

- `Aborted(both async and sync fetching of the wasm failed)`
- AudioWorklet 内で `dtln.js` は読めるが `dtln_rs.wasm` が使えない
- Network に wasm リクエストが出ない
- DevTools 実測で `fetch/XMLHttpRequest/importScripts/window` が `undefined`
- `window shim` や `locateFile` を入れても安定しない

---

## 既知の前提

AudioWorklet は通常の Window 環境でも通常 Worker 環境でもない。  
そのため、Emscripten 生成 JS の以下の前提が崩れることがある。

- `typeof window === "object"`
- `typeof importScripts === "function"`
- `typeof fetch === "function"`
- `typeof XMLHttpRequest === "function"`

この前提が崩れると、別ファイル wasm の取得に失敗し、`both async and sync fetching of the wasm failed` に落ちる。  
この問題に対しては、**single-file 化して wasm を `dtln.js` に内包する構成が最短で確実**。

---

## 作業方針

### 第一選択
DTLN を single-file 化する。  
`public/dtln_rs.wasm` を base64 などで `public/dtln.js` に埋め込み、`Module.wasmBinary` を使って外部取得を不要にする。

### 第二選択
`public/dtln-worklet.js` の最小差分修正を行う。  
特に次を守る。

- 裸の `DtlnPlugin` / `Module` 参照を避ける
- `globalThis.DtlnPlugin`
- `globalThis.Module`

### 第三選択
診断ログを追加して状態を可視化する。  
ただし本番向けではログを増やしすぎない。

---

## 修正優先順位

### 優先度 A
- `public/dtln-worklet.js` の `attachDtlnPostRunHook()` を `globalThis.DtlnPlugin` 経由に統一
- DTLN 初期化まわりの最小差分修正
- 必要なら single-file 前提の初期化フロー確認

### 優先度 B
- `public/dtln.js` を手編集ではなく再生成物で置換
- `public/dtln_rs.wasm` から single-file 版を作るビルド手順を残す
- `package.json` に必要最小限の script を追加

### 優先度 C
- 一時的な診断ログ追加
- `window shim`
- `locateFile` の補助的調整

### 触らない
- `public/rnnoise-processor.js`
- WebRTC の join/leave/publish/subscribe フロー
- UI レイヤー全般
- RNNoise 系の既存安定動作部分

---

## 重要な判断

### `locateFile` を過信しない
Emscripten 生成 JS が module 内ローカル `Module` を使う場合、外から設定した `globalThis.Module.locateFile` は効かないことがある。  
主役にしない。

### `window shim` を過信しない
`window` 判定だけ通しても、`fetch` / `XMLHttpRequest` が無ければ本質解決にはならない。  
補助策としてのみ扱う。

### `public/dtln.js` を直接書き換えすぎない
場当たり的な手編集は避ける。  
再生成物で置換する。

---

## 受け入れ基準

修正案は次を満たすこと。

1. AudioWorklet 内で外部 wasm 取得に依存しない
2. `public/dtln-worklet.js` の `DtlnPlugin` 参照が `globalThis` ベースで一貫している
3. `public/dtln.js` は再生成物で管理される
4. `public/dtln_rs.wasm` は single-file 生成の入力として扱われる
5. `public/rnnoise-processor.js` は不要なら触らない
6. 変更対象が最小限
7. API shape を変えない
8. join/leave/publish/subscribe 順序を壊さない

---

## Codex への指示

Codex には次を明示する。

- 最小差分
- DTLN の single-file 化を優先
- `public/dtln-worklet.js` を主対象にする
- `public/dtln.js` は再生成物で更新
- `public/dtln_rs.wasm` は single-file 生成の元として使う
- `public/rnnoise-processor.js` は参照のみ。明示依頼がなければ変更禁止
- WebRTC 本体フローは触らない
- whole-file rewrite 禁止

---

## Codex 依頼テンプレート

Task:
AudioWorklet 内で DTLN の Emscripten + wasm ローダーが失敗しています。  
DTLN を残したいので、single-file 化を優先して最小差分で修正してください。

Current files:
- `public/dtln-worklet.js`
- `public/dtln.js`
- `public/dtln_rs.wasm`
- `public/rnnoise-processor.js`

Known facts:
- AudioWorklet 内では `fetch/XMLHttpRequest/importScripts/window` が使えない前提
- `Aborted(both async and sync fetching of the wasm failed)` が出ていた
- `public/dtln-worklet.js` は主対象
- `public/dtln.js` は再生成物で更新したい
- `public/dtln_rs.wasm` は single-file 生成の元にする
- `public/rnnoise-processor.js` は参照用で、明示依頼がない限り変更しない

Goals:
1. `public/dtln-worklet.js` を最小差分で修正
2. `public/dtln.js` を single-file 再生成物で置換
3. `public/dtln_rs.wasm` を元にした生成手順を残す
4. `public/rnnoise-processor.js` は触らない
5. 既存 WebRTC フローは触らない

Constraints:
- 最小差分
- API shape を変えない
- whole-file rewrite 禁止
- join/leave/publish/subscribe 順序に触れない
- `DtlnPlugin` / `Module` の裸参照を避ける

Expected output:
- 原因整理
- 変更ファイル一覧
- single-file 化の実装内容
- 触らないファイル一覧
- ローカル確認手順

---

## 補足

single-file 化で `public/dtln.js` は重くなる。  
ただし、AudioWorklet 内で外部 wasm 取得が成立しないなら、まずは動作成立を優先する。  
最適化はその後で行う。