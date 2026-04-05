---
name: webrtc-orchestrator-guard
description: Guard skill for the WebRTC repo. Keep useStreamReceiver.js as a thin orchestrator. Do not add feature logic, polling, timers, Maps, DOM search helpers, or monitoring state there. Put feature logic in sub composables or services instead.
---

# webrtc-orchestrator-guard

## 目的
この Skill は、`useStreamReceiver.js` を orchestrator として維持するためのガードである。

WebRTC の機能追加や不具合修正のたびに、
- 一時的に直すための監視ロジック
- DOM 探索 helper
- feature 専用の判定ロジック
- timer / polling / Map / Set を使う状態管理

が `useStreamReceiver.js` に流れ込みやすい。

この Skill は、それを防ぎ、
`useStreamReceiver.js` を「配線と順序制御」に限定することを目的とする。

---

## この Skill を使う場面
次のような依頼で使う。

- WebRTC 機能を追加する
- 既存機能を復元する
- late join, mute, screen share, background blur, audio UI, speaking highlight などを修正する
- `useStreamReceiver.js` に新しい処理を足したくなった
- 「とりあえずここに書けば動く」を避けたい

特に、次のような変更では必ず意識する。

- 新しい監視処理
- `setInterval` / `setTimeout`
- `getAudioLevel()` のような定期 polling
- `Map` / `Set` を使う feature state
- DOM を検索して見た目を変える処理
- publication / stream / tile の feature 専用 glue

---

## 最重要ルール

### 1. `useStreamReceiver.js` は orchestrator のまま維持する
`useStreamReceiver.js` の責務は次に限定する。

- ref の定義
- sub composable / service の初期化
- callback / bridge の受け渡し
- 高レベルな join / leave / publish / subscribe の順序制御
- UI に公開する state / handler の return

### 2. feature 本体を `useStreamReceiver.js` に置かない
次は `useStreamReceiver.js` に置いてはいけない。

- feature 専用定数
- timer / polling の実装
- `Map` / `Set` / 状態テーブルによる監視管理
- DOM 探索 helper
- 音量判定や speaking 判定の本体
- タイル検索やハイライト適用の本体
- feature 専用 wrapper の大量追加
- 一時しのぎのロジック蓄積

### 3. 実ロジックは下位へ置く
新しい機能や復元処理の本体は、次のどれかへ置く。

- 既存 sub composable
- 既存 service
- 新規の小さな sub composable
- 新規の小さな helper module

判断基準は「その責務がどこに最も近いか」で決める。

### 4. orchestrator に許可する追加は最小限
`useStreamReceiver.js` に追加してよいのは原則として次だけである。

- import 1つ
- sub composable 初期化 1つ
- callback 配線 1つ
- return への公開追加
- 既存フローへの最小 bridge

---

## 責務配置の判断基準

### `useStreamReceiver.js` に置いてよいもの
- `useXxxSession()` の呼び出し
- `useXxxSession()` に渡す callback
- sub composable の返り値を UI 用 API shape に接続する処理
- 既存の join / leave / screenShare / blur の大きな順序制御

### `useStreamReceiver.js` に置いてはいけないもの
- `startXxxMonitor()`
- `stopXxxMonitor()`
- `findXxxElement()`
- `applyXxxEffect()`
- `computeXxxState()`
- `readXxxLevel()`
- `setInterval(() => ...)`
- `setTimeout(() => ...)`
- `new Map()`
- `new Set()`
- feature 専用の状態保持

### sub composable に置くべきもの
- 1機能に閉じる監視ロジック
- feature 専用 state
- attach 後に行う追加処理
- tile / publication / stream に近い局所処理
- cleanup を含む監視ライフサイクル

### service に置くべきもの
- DOM 操作
- SDK 境界
- 純粋な UI 見た目処理
- composable state を持たない再利用処理

---

## 迷ったときの優先順位
新しい処理をどこへ置くか迷ったら、次の順で考える。

1. 既存 service で責務が合うか
2. 既存 sub composable で責務が合うか
3. 新規の小さな sub composable を作るべきか
4. それでも無理なときだけ `useStreamReceiver.js` に最小 bridge を置く

`useStreamReceiver.js` に本体を書き始める前に、
「これは bridge か、feature 本体か」を明示的に判定する。

feature 本体なら、`useStreamReceiver.js` には置かない。

---

## アンチパターン

### 悪い例 1
話者ハイライトを戻すために `useStreamReceiver.js` に以下を追加する。

- `SPEAKING_POLL_INTERVAL_MS`
- `SPEAKING_LEVEL_THRESHOLD`
- `speakingMonitors`
- `findTileContainerByMemberId`
- `applySpeakingHighlight`
- `startSpeakingMonitor`
- `stopSpeakingMonitor`

これは orchestrator への責務逆流である。

### 悪い例 2
remote attach のたびに、`useStreamReceiver.js` で feature 専用 wrapper を増やし続ける。

- `attachRemoteWithSpeaking()`
- `attachRemoteWithBadge()`
- `attachRemoteWithSomethingElse()`

小さく見えても、feature ごとの橋渡し wrapper が増殖すると orchestrator が太る。

### 悪い例 3
「今回は最小修正だから」という理由で、sub composable を作らずに監視本体を直書きする。

最小差分と責務逸脱は別問題である。
最小差分でも、置き場所は正しくなければならない。

---

## 良い形の目安

### 良い例 1
話者ハイライトの監視本体を `useSpeakingHighlightSession.js` に置く。

`useStreamReceiver.js` 側では、
- import
- 初期化
- callback 配線
- cleanup 呼び出し

だけを行う。

### 良い例 2
remote publication に密接な処理なら `useRemotePublications.js` に寄せる。

- remote audio attach 後の追加処理
- remote unpublish 時の後処理
- remote tile と memberId の対応処理

は remote 側責務として閉じられるならその方が自然である。

---

## 変更前チェック
編集前に必ず次を整理する。

- 追加したい機能の本体は何か
- それは orchestrator の責務か
- 既存のどの sub composable / service が最も近いか
- `useStreamReceiver.js` に必要なのは bridge だけか
- 本当に新規 sub composable が必要か

---

## 変更時の制約
- whole-file rewrite 禁止
- 無関係な refactor 禁止
- コメント変更禁止
- 公開 API shape は必要な場合を除き維持する
- late join / subscribeExisting / join / leave / screen share / background blur を壊さない
- 既存 split 方針を後退させない

---

## 差分の良し悪し判定

### 良い差分
- `useStreamReceiver.js` の差分が小さい
- 機能本体が下位へ閉じている
- timer / Map / polling が sub composable 側にある
- orchestrator は初期化と橋渡しだけで済んでいる

### 悪い差分
- `useStreamReceiver.js` に新規定数が増える
- `useStreamReceiver.js` に監視 helper が増える
- `useStreamReceiver.js` に DOM 探索処理が入る
- `useStreamReceiver.js` に feature 専用 state が増える
- 「bridge だから」と言いながら実質本体を書いている

---

## レビュー時の確認項目
変更後は次を確認する。

- `useStreamReceiver.js` に feature 本体が入っていないか
- timer / polling / Map / DOM 探索が流入していないか
- 下位 composable / service に責務が閉じているか
- orchestrator の公開 API shape が不必要に崩れていないか
- WebRTC の不変条件を壊していないか

---

## 実行プロンプト用テンプレート
必要なら次を先頭に付ける。

### テンプレート
- `useStreamReceiver.js` は orchestrator のまま維持すること
- 監視ロジック本体、timer、Map、polling、DOM探索helperを `useStreamReceiver.js` に置かないこと
- 実ロジックは既存 sub composable / service、または新規小 composable に置くこと
- `useStreamReceiver.js` には import / 初期化 / callback配線だけを許可する
- whole-file rewrite と無関係な refactor を禁止する
- 最後に、責務をどこへ置いたかを明記すること

---

## 完了報告ルール
完了時は必ず簡潔に次を報告する。

- 変更ファイル
- 機能本体を置いた場所
- `useStreamReceiver.js` に追加したのが配線だけかどうか
- 未検証項目

---

## 一言ルール
`useStreamReceiver.js` に「とりあえず書く」を許さない。
新機能の本体は、必ず下位へ置く。