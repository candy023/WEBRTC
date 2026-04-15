---
name: webrtc-audio-toggle-verification
description: DTLN を含むノイズ抑制 ON/OFF が join 時だけ効くのか、通話中の即時切替まで実装されているのかを確認するための検証用 Skill。まず実装事実を固定し、無関係な修正へ広げない。
---

# webrtc-audio-toggle-verification

## 目的

WebRTC アプリのノイズ抑制 ON/OFF について、次を切り分けて確認する。

- UI ボタンは何を呼んでいるか
- toggle 関数に副作用があるか
- join 時の音声生成分岐にだけ効いているか
- 通話中の即時切替があるか
- replaceStream または unpublish / republish があるか
- 処理済み track が本当に publish に使われているか
- fallback で通常マイクに落ちる条件は何か

この Skill は、RNNoise という名前がコードに残っていても、実装実態としては **DTLN を含むノイズ抑制トグル全般** を確認対象にする。

---

## この Skill が前提にする方針

- まず修正ではなく実装事実の確認を行う
- 推測で断定しない
- WebRTC の無関係な不具合へ話を広げない
- join / leave、late join、画面共有、背景ぼかしはこの Skill の主題にしない
- 既存コメント、日本語文言、公開 API shape を不用意に変えない
- whole-file rewrite をしない

---

## 使う場面

- ノイズ抑制 ON/OFF が効いているのか分からない
- join 前設定なのか、通話中反映なのか分からない
- DTLN が ready しても本当に publish 経路へ入っているか確認したい
- fallback が起きているのか、DTLN 経路なのかを切り分けたい
- 修正前に「今できること / できないこと」を固定したい
- Codex に誤った前提で修正をさせたくない

---

## 使わない場面

- late join バグを直したい
- 画面共有や背景ぼかしの不具合を直したい
- UI レイアウトだけを直したい
- ノイズ抑制アルゴリズム全般を広く改善したい
- 音量低下の恒久修正を先に入れたい

---

## 確認対象ファイル

- `src/components/WebRTC_UI.vue`
- `src/composables/useStreamReceiver.js`
- `src/composables/useRoomSession.js`
- `src/services/RnnoiseService.js`
- `src/services/MediaStreamService.js`
- `src/services/SkywayRoomService.js`
- `public/dtln-worklet.js`
- 必要なら `public/dtln.js`
- 必要なら `public/dtln_rs.wasm`
- `docs/webrtc-current-behavior.md`
- `docs/webrtc-invariants.md`
- `docs/webrtc-test-scenarios.md`
- `AGENTS.md`

---

## 必ず確認すること

1. ノイズ抑制ボタンが呼ぶ関数
2. `toggleRnnoise()` などトグル関数の副作用有無
3. `isRnnoiseEnabled` など状態フラグの参照箇所
4. join 時に ON/OFF で何が分岐するか
5. 通話中に audio publication を差し替える経路の有無
6. `setupRnnoise()` の返り値のうち何が実際に publish に使われるか
7. `processedTrack` が `LocalAudioStream` 化されているか
8. fallback で通常マイクに落ちる条件
9. UI 表現が実装実態より強すぎないか

---

## 現行実装を前提にした確認ポイント

### 1. room join / leave の本体
- 現在の room join / leave 本体が `useRoomSession.js` か、別 file へ委譲されているかを確認する
- `useStreamReceiver.js` は orchestrator か、join 実装本体かを区別する

### 2. join 時の送話経路
- `createLocalAudioStream()` のような helper があるか
- `setupRnnoise()` を呼んでいるか
- `processedTrack` がある場合に `LocalAudioStream` 化して publish しているか
- 無い場合だけ通常マイク stream にフォールバックしているか

### 3. 通話中トグル
- `replaceLocalAudioForRnnoiseToggle()` のような差し替え関数があるか
- `updatePublishedAudioPublication()` / `replaceStream()` / unpublish→publish のどれを使っているか
- 既存 `isAudioMuted` を再反映しているか
- old handle cleanup があるか

### 4. DTLN ready / fallback
- `public/dtln-worklet.js` が ready を port で返せるか
- `setupRnnoise()` が ready timeout で fallback するか
- `processedTrack ready, using dtln path` のようなログがあるか
- `using microphone fallback path` に落ちていないか

---

## 判定ルール

次のどれかを明確に判定する。

- A. 現状でも通話中の即時切替が実装されている
- B. 現状は join 時だけ有効で、通話中の即時切替は未実装
- C. DTLN 経路は存在するが、ready timeout / fallback により実際は通常マイクが publish されている
- D. DTLN 経路が ready し、processedTrack publish まで実際に通っている

---

## NG

- state が変わるだけで「切り替わった」と判断する
- join 時の分岐があるだけで通話中反映もあるとみなす
- `processedTrack` 未使用なのに DTLN 処理済み音声が publish されていると断定する
- fallback ログがあるのに DTLN が使われていると断定する
- この調査で late join や画面共有の修正まで始める
- 実通話確認なしに「音質改善済み」と断定する

---

## 実装事実の確認手順

### コード確認
1. UI ボタン → toggle 関数の接続を見る
2. toggle 関数の副作用を確認する
3. join 実装本体を見て、音声 publish 経路を追う
4. `setupRnnoise()` の返り値 shape を確認する
5. `processedTrack` が publish に使われているか確認する
6. live toggle 関数が publication 差し替えをしているか確認する

### ログ確認
必要なら一時ログで次を確認する。

- join/createLocalAudioStream: using processedTrack publish path
- join/createLocalAudioStream: using microphone fallback path
- replaceLocalAudioForRnnoiseToggle: audio publication replaced
- setupRnnoise: processedTrack ready, using dtln path
- setupRnnoise: waitForDtlnReady returned false
- dtln-worklet: notifyReady

### 実通話確認
- A/B 2 端末で通話する
- ON 時に相手へ声が届くか
- OFF 時に通話継続できるか
- leave → 再join でも成立するか

---

## 出力形式

1. 結論
2. 根拠
3. 今できること
4. 今できないこと
5. fallback 条件
6. 修正が必要なら最小差分の候補
7. 未検証部分