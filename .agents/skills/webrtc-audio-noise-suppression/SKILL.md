---
name: webrtc-audio-noise-suppression
description: WebRTC のローカル音声ノイズ抑制を、安全な最小差分で導入・修正するための Skill。現行の実動作 mode は standard / suppressor とし、次の拡張候補は rnnoise とする。
---

# webrtc-audio-noise-suppression

## 目的
WebRTC アプリのローカル音声ノイズ抑制を、安全な最小差分で導入または修正するための Skill である。

現行の実動作モードは次の 2 つである。
- `standard`
- `suppressor`

次の段階では、`rnnoise` を 3 本目の実動作モードとして追加することを第一候補とする。

将来拡張用として `off` / `dtln` の mode shape を持つことは許可するが、
**その mode 名を UI に出すのは、実処理が入ってから** とする。

## この Skill を使う場面
- ローカル音声のノイズ抑制を追加したい
- browser 標準と suppressor を比較しやすい形へ整理したい
- 通話中でも音声抑制モードを安全に切り替えたい
- 車・電車・空調などの低域ノイズを少し抑えたい
- キーボード、クリック、風、周囲の話し声に対して次の一手を入れたい
- RNNoise を既存の mode enum に最小差分で追加したい
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

### 次の実動作候補として優先する mode
- `rnnoise`

### 将来拡張用として shape だけ持ってよい mode
- `off`
- `dtln`

ただし次を守ること。
- `rnnoise` は **実処理が入るまで UI に出さない**
- `off` / `dtln` は shape のみ許可し、**本実装前に UI 上の実モードとして見せない**
- 実装されていない mode 名を UI の選択肢、ラベル、補助説明へ出さない
- 実装されていない mode 名を「効いている機能」として説明しない
- UI 文言は常に現在の実装実態と一致させる

## suppressor 強化の方針
### 優先順位
1. まず `standard` と `suppressor` の比較ができる状態を維持する
2. その上で、`suppressor` 経路だけを局所的に強化する
3. 次の比較軸として `rnnoise` を追加する
4. いきなり DTLN を既定経路へ戻さない
5. 大きな変更より、前段の軽いフィルタ追加や mode 追加を優先する

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

### high-pass だけで解決しないノイズ
次のノイズは、high-pass だけでは原理的に取り切れない前提で扱う。
- キーボード打鍵音
- マウスクリック
- 風の広帯域ノイズ
- 周囲の話し声や研究室の環境音

これらに対しては、次の一手として `rnnoise` を優先する。

## RNNoise 追加の方針
### なぜ RNNoise を次に優先するか
- キーボードやクリックのようなインパルスノイズに対して、high-pass より有効な可能性が高い
- 周囲の広帯域ノイズや話し声に対して、suppressor より改善余地がある
- DTLN より先に比較対象へ追加しやすい
- 既存の mode enum 化と相性がよい

### 実装の基本方針
- `rnnoise` は OSS の既存実装を使うことを第一候補とする
- まずは **既存モデルをそのまま使う**
- RNNoise 導入時点では、データセットや再学習を前提にしない
- 自前学習は、既存モデル比較で不足が明確になってから検討する

### 第一候補の実装経路
- `@shiguredo/rnnoise-wasm` を第一候補とする
- `src/services/RnnoiseService.js` に `mode === 'rnnoise'` 分岐を追加する
- composable 側は既存の mode enum と local audio publication 差し替え経路を再利用する
- `publishLocal(member, { videoStream, audioStream })` の形は維持する
- 戻り値 shape は既存 service と揃える

### RNNoise 導入時の注意
- `rnnoise` 経路は `standard` / `suppressor` と並列比較できる形で追加する
- `suppressor` 経路を潰して置き換えない
- `rnnoise` が失敗した場合も browser 標準 constraints にフォールバックできるようにする
- UI には、本当に `rnnoise` が動く段階になってから表示する

## DTLN の扱い
- DTLN は将来の比較候補として保持してよい
- ただし RNNoise より先に既定経路へ戻さない
- DTLN 導入は、RNNoise 比較後でもなお不足が残る場合に検討する
- DTLN を検討するときも、まずは `standard` / `suppressor` / `rnnoise` の比較結果を壊さない

## データセット方針
### RNNoise をまず導入する段階
- データセットは不要
- OSS の既存モデルをそのまま使う

### データセットが必要になる段階
次の場合だけ、データセットを使った自前学習や追加調整を検討する。
- RNNoise 既存モデルでキーボード音や研究室ノイズが十分に抑えられない
- DTLN や独自モデルを作る
- 特定ノイズに強いモデルを自前で学習したい

### 将来候補として見てよい公開データ
- clean speech
  - LibriSpeech
  - VCTK
- noise
  - DNS Challenge 系
  - DEMAND
  - MUSAN

ただし、現段階の RNNoise 実装ではこれらを前提にしない。

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
- `standard` / `suppressor` / `rnnoise` を比較可能な形で維持する

## 実装方針
1. まず browser 標準 constraints を基準実装として残す
2. その上で `@sapphi-red/web-noise-suppressor` をローカル音声生成経路へ最小差分で追加または維持する
3. `suppressor` 強化では、まず前段 high-pass のような軽い手段を優先する
4. 次の比較軸として `rnnoise` を別 mode で追加する
5. RNNoise は `@shiguredo/rnnoise-wasm` を第一候補として service 側へ追加する
6. ノイズ抑制ライブラリの初期化と失敗時フォールバックを service 側へ寄せる
7. composable 側は orchestration にとどめる
8. 通話中切替は既存の local audio publication 差し替え経路を再利用する
9. UI 表示は「実際に有効な機能名」に合わせる
10. DTLN は RNNoise 比較後の段階で検討する

## 禁止事項
- 音質改善だけの依頼で join / leave / subscribe の骨格を組み替えない
- DTLN を RNNoise より先に既定経路へ戻さない
- public 配下へ独自 wasm/js を再配置する前提で書かない
- 独自 AudioWorklet / 独自 WASM 配信 / processedTrack 差し替えを既定提案にしない
- 音声処理変更のついでに画面共有、背景ぼかし、late join 修正を混ぜない
- whole-file rewrite をしない
- 無関係なリファクタをしない
- 実装されていない mode 名を UI に出さない
- `standard` と `suppressor` の比較軸を壊すような大変更をいきなり入れない
- RNNoise 追加前に、あたかも RNNoise が動いているような説明をしない
- RNNoise 実装のために、いきなりデータセット学習を前提にしない

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
9. RNNoise 追加時は、キーボード、クリック、風、周囲の話し声で比較評価すること
10. 声が薄くなりすぎていないこと

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
- RNNoise 追加の有無
- 実行済み検証
- 未検証項目
- 既知の制約