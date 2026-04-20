---
name: webrtc-audio-noise-suppression
description: WebRTC のローカル音声ノイズ抑制を、安全な最小差分で導入・修正するための Skill。現行の実動作 mode は standard / suppressor とし、off / rnnoise / dtln は将来拡張用 shape のみを許可する。
---

# webrtc-audio-noise-suppression

## 目的
WebRTC アプリのローカル音声ノイズ抑制を、安全な最小差分で導入または修正するための Skill である。

現行の実動作モードは次の 2 つである。
- `standard`
- `suppressor`

将来拡張用として `off` / `rnnoise` / `dtln` の mode shape を持つことは許可するが、
**その mode 名を UI に出すのは、実処理が入ってから** とする。

## この Skill を使う場面
- ローカル音声のノイズ抑制を追加したい
- browser 標準と suppressor を比較しやすい形へ整理したい
- 通話中でも音声抑制モードを安全に切り替えたい
- 車・電車・空調などの低域ノイズを少し抑えたい
- DTLN / RNNoise へ将来拡張しやすい shape に寄せたい
- 音声処理を変えたいが、join / leave / publish / subscribe の骨格は壊したくない

## 現在の基準方針
- 既定の音声入力は browser 標準 constraints を基準実装として残す
- `standard` は browser 標準経路を意味する
- 標準セットは次を使う
  - `noiseSuppression: true`
  - `echoCancellation: true`
  - `autoGainControl: true`
- マイク選択がある場合のみ `deviceId` を追加する
- `suppressor` は `@sapphi-red/web-noise-suppressor` を使う経路を意味する
- suppressor 経路では browser 標準ノイズ抑制を切り、独自処理を優先する
- ライブラリ初期化に失敗した場合は、browser 標準 constraints に即フォールバックする
- ローカル音声生成経路だけを変え、room 接続・購読・remote 表示責務には波及させない

## mode 方針
### 現時点で実動作として扱う mode
- `standard`
- `suppressor`

### 将来拡張用として shape だけ持ってよい mode
- `off`
- `rnnoise`
- `dtln`

ただし次を守ること。
- `off` / `rnnoise` / `dtln` は shape のみ許可し、**本実装前に UI 上の実モードとして見せない**
- 実装されていない mode 名を UI の選択肢、ラベル、補助説明へ出さない
- 実装されていない mode 名を「効いている機能」として説明しない
- UI 文言は常に現在の実装実態と一致させる

## suppressor 強化の方針
### 優先順位
1. まず `standard` と `suppressor` の比較ができる状態を維持する
2. その上で、`suppressor` 経路だけを局所的に強化する
3. いきなり DTLN を既定経路へ戻さない
4. 大きな変更より、前段の軽いフィルタ追加を優先する

### まず許可する強化
車・電車・空調などの低域ノイズ対策として、
`suppressor` 経路の前段に軽い `high-pass filter` を追加してよい。

推奨初期値:
- `type: highpass`
- `frequency: 120`
- `Q: 0.707`

接続順の推奨:
- `sourceNode -> highPassNode -> suppressorNode -> destinationNode`

この強化は次の条件でのみ行う。
- `suppressor` 経路だけに追加する
- `standard` 経路には追加しない
- cleanup で安全に切断・破棄できるようにする
- UI 設定追加なしで導入する場合は固定値でよい
- 動的制御や複雑なフィルタチェーンは後回しにする

### 後回しにする強化
- 動的パラメータ調整
- UI から cutoff を変更する設定
- heavy な DTLN 回帰
- 独自 WASM 配信前提の複雑な処理
- 複数段の重いフィルタチェーン

## 守ること
- 変更対象は必要最小限に限定する
- `publishLocal(member, { videoStream, audioStream })` の呼び出し形は維持する
- 音声修正のために `subscribeExisting()`、`bindOnStreamPublished()`、`leave()` を変更しない
- UI の名称は実装実態と一致させる
- ライブラリ初期化失敗時も通話参加自体は継続可能にする
- mute 状態がある場合は、音声差し替え後も必要に応じて維持する
- join 中の差し替え失敗時は previous state / previous mode へ戻せる形を優先する
- 通話中切替は既存の local audio publication 差し替え経路を再利用する
- audio mode の state は boolean より enum を優先する

## 実装方針
1. まず browser 標準 constraints を基準実装として残す
2. その上で `@sapphi-red/web-noise-suppressor` をローカル音声生成経路へ最小差分で追加または維持する
3. ノイズ抑制ライブラリの初期化と失敗時フォールバックを service 側へ寄せる
4. composable 側は orchestration にとどめる
5. 通話中切替は既存の local audio publication 差し替え経路を再利用する
6. UI 表示は「実際に有効な機能名」に合わせる
7. `suppressor` 強化では、まず前段 high-pass のような軽い手段を優先する
8. RNNoise / DTLN は別 mode として段階的に追加する

## 禁止事項
- 音質改善だけの依頼で join / leave / subscribe の骨格を組み替えない
- DTLN を既定経路へ戻さない
- public 配下へ独自 wasm/js を再配置する前提で書かない
- 独自 AudioWorklet / 独自 WASM 配信 / processedTrack 差し替えを既定提案にしない
- 音声処理変更のついでに画面共有、背景ぼかし、late join 修正を混ぜない
- whole-file rewrite をしない
- 無関係なリファクタをしない
- 実装されていない mode 名を UI に出さない
- `standard` と `suppressor` の比較軸を壊すような大変更をいきなり入れない

## 推奨される変更対象
- `src/composables/useRoomSession.js`
- `src/services/RnnoiseService.js`
- 必要なら `src/composables/useStreamReceiver.js`
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
8. suppressor 強化時は、車・電車・空調などの低域ノイズで悪化していないこと
9. 声が薄くなりすぎていないこと

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
- suppressor 強化の有無
- 実行済み検証
- 未検証項目
- 既知の制約
