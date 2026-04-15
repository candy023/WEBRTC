---
name: webrtc-audio-toggle-verification
description: RNNoise ON/OFF が join 時だけ効いているのか、通話中の即時切替まで実装されているのかを確認するための検証用 Skill。まず実装事実を固定し、無関係な修正へ広げない。
---

# webrtc-audio-toggle-verification

## 目的

WebRTC アプリの RNNoise ON/OFF について、次を切り分けて確認する。

- UI ボタンは何を呼んでいるか
- toggle 関数に副作用があるか
- join 時の音声生成分岐にだけ効いているか
- 通話中の即時切替があるか
- replaceStream または unpublish / republish があるか
- RNNoise service が本当に処理済みトラックを publish に使っているか

## この Skill が前提にする方針

- まず修正ではなく実装事実の確認を行う
- 推測で断定しない
- WebRTC の無関係な不具合へ話を広げない
- join / leave、late join、画面共有、背景ぼかしはこの Skill の主題にしない
- 既存コメント、日本語文言、公開 API shape を不用意に変えない
- whole-file rewrite をしない

## 使う場面

- RNNoise ボタンが効いていないように見える
- ON/OFF が join 前設定なのか、通話中反映なのか分からない
- 修正前に「今できること / できないこと」を固定したい
- Codex に誤った前提で修正をさせたくない

## 使わない場面

- late join バグを直したい
- 画面共有や背景ぼかしの不具合を直したい
- UI レイアウトだけを直したい
- RNNoise の音質改善全般を広くやりたい

## 確認対象ファイル

- `src/components/WebRTC_UI.vue`
- `src/composables/useStreamReceiver.js`
- `src/services/RnnoiseService.js`
- `src/services/MediaStreamService.js`
- `src/services/SkywayRoomService.js`
- `docs/webrtc-current-behavior.md`
- `docs/webrtc-invariants.md`
- `docs/webrtc-test-scenarios.md`
- `AGENTS.md`

## 必ず確認すること

1. RNNoise ボタンが呼ぶ関数
2. `toggleRnnoise()` の副作用有無
3. `isRnnoiseEnabled` の参照箇所
4. join 時に RNNoise ON/OFF で何が分岐するか
5. 通話中に audio publication を差し替える経路の有無
6. `setupRnnoise()` の返り値のうち何が実際に publish に使われるか
7. UI 表現が実装実態より強すぎないか

## 判定ルール

次のどちらかを明確に判定する。

- A. 現状でも通話中の即時切替が実装されている
- B. 現状は join 時だけ有効で、通話中の即時切替は未実装

## NG

- state が変わるだけで「切り替わった」と判断する
- join 時の分岐があるだけで通話中反映もあるとみなす
- `denoisedTrack` 未使用なのに RNNoise 処理済み音声が publish されていると断定する
- この調査で late join や画面共有の修正まで始める

## 出力形式

1. 結論
2. 根拠
3. 今できること
4. 今できないこと
5. 修正が必要なら最小差分の候補
6. 未検証部分