---
name: webrtc-bugfix
description: Vue + SkyWay の WebRTC アプリで、join, leave, publish, subscribe, remote stream 表示, screen share, background blur, RNNoise まわりの不具合を最小差分で修正するときに使う。広いリファクタはしない。
---

# 目的
WebRTC 固有の不具合を、既存 API shape と責務分離を壊さず最小差分で修正する。

# まず確認するファイル
- `src/composables/useStreamReceiver.js`
- `src/services/SkywayRoomService.js`
- `src/services/MediaStreamService.js`
- `src/services/VideoUIService.js`
- 必要なら room 画面の wrapper view
  - `src/views/WorkRoomView.vue`
  - `src/views/PokerRoomView.vue`

# 基本方針
- 原因候補を先に 3 個以内に絞る
- いきなり大規模リファクタしない
- composable は orchestrator として扱い、DOM 寄り処理は既存 service を優先する
- 既存の export、引数、戻り値、state shape は必要な場合を除き変えない
- 変更は症状に直結する経路だけに限定する
- UI 修正だけの依頼なら、接続処理まで広げない
- fixed room 導線の不具合なら、まず room view の戻る導線と leave 漏れを疑う

# 再発防止ルール
- `onStreamPublished` 系 handler は join 完了前に走る可能性を考慮する
- self publication を subscribe しない
- `localMember` や attach 先 DOM が未確定の時点で処理しない guard を忘れない
- 新規配信通知の購読と、既存 publication の購読は役割を分けて扱う
- remote stream の DOM attach は、表示先コンテナが存在するタイミングで行う
- 非同期 callback が前提なら `await` 漏れを疑う
- 「受信失敗」と「受信成功だが表示失敗」を分けて切り分ける
- publication ID の重複防止は、実際の受信・表示フローを潰していないか慎重に確認する
- `bindOnStreamPublished()` に渡す member は、null 許容実装でない限り未確定のまま渡さない
- screen share と background blur では `publish / unpublish / attach` の順序を壊さない
- 画面共有停止後は camera stream の再生成、publication 参照差し替え、local preview 再 attach の順を崩さない
- background blur の ON/OFF では processor の初期化と dispose を対称に保ち、normal camera stream へ戻る経路を切らない
- room 画面から lobby へ戻る導線では、画面遷移前に leave が完了しているかを確認する
- fixed room view に不要な `部屋を作成` UI を残さない
- UI 表示用 nickname と SkyWay join 用 `member.name` を混同しない

# 症状別の優先切り分け

## 1. late join で既存参加者が見えない
- `subscribeExisting()` が必ず走っているか
- self publication 除外条件が強すぎないか
- attach 先 DOM があるタイミングで attach しているか
- `receivedPublicationIds` / `pendingPublicationIds` が初回受信を潰していないか

## 2. 先に入った人があとから来た人を見られない
- `onStreamPublished` の経路が生きているか
- join 前後の race で member 未確定になっていないか
- subscribe に成功しても UI attach に失敗していないか

## 3. 画面共有や背景ぼかしの切り替えで壊れる
- `publish / unpublish / attach` の順序を確認する
- local publication 参照と local stream 参照の差し替えが対称か
- mute state の引き継ぎを落としていないか

## 4. room 画面から戻るだけで leave していない再入室不具合
- 症状:
  - room 参加中に `/rooms` へ戻る
  - しかし room から leave していない
  - 同じユーザー由来の join 名で再参加すると duplicate member name エラーになる
- まず確認すること:
  - 戻る導線が `leaveRoom()` を await しているか
  - `onBeforeRouteLeave` で leave を補強しているか
  - 画面遷移だけで退出した前提になっていないか
  - `useStreamReceiver.js` 側の自動 cleanup を過信していないか
- 推奨修正:
  - room view の戻る導線で `leaveRoom()` を先に通す
  - 必要なら `onBeforeRouteLeave` で補強する
  - fixed room view に `部屋を作成` UI を残さない

## 5. 日本語 nickname で join すると invalidRequestParameter になる
- 症状:
  - 日本語 nickname で room join すると失敗する
  - ログに `Parameter 'name' must match pattern "^(?![*]$)[.A-Za-z0-9%*_-]+$"` が出る
  - 英数字 nickname では join できる
- 原因:
  - SkyWay の `member.name` に使える文字種制約へ違反している
  - `profiles.nickname` などの表示名を、そのまま join 用 `name` に渡している可能性が高い
- まず確認すること:
  - room join 時の `name` に何を渡しているか
  - `profiles.nickname` を直接 `joinRoom()` に渡していないか
  - 表示名と内部 join 名を分離できているか
- 推奨修正:
  - UI 表示用 nickname と SkyWay join 用内部名を分離する
  - join 用内部名は auth user id 由来の ASCII 安全な値で生成する
  - UI 表示は `profiles.nickname` を正本にする
- やってはいけないこと:
  - 日本語 nickname を禁止して問題を隠す
  - UI 表示名まで SkyWay 制約へ合わせて英数字だけに下げる

# 修正の進め方
1. 症状に対応する最短経路を特定する
2. state の受け渡し経路だけ直す
3. 必要なら service に小さな helper を足す
4. 無関係な UI や命名整理はしない
5. join / leave / 再入室 / stream 差し替えの観点で確認する

# 完了条件
- 依頼された症状だけが改善している
- 既存の接続フローを広く壊していない
- 変更理由を簡潔に説明できる
- 最低限の確認項目を列挙できる
- fixed room の戻る導線なら、leave 前提が満たされている
- 日本語 nickname 問題なら、表示名と join 用内部名の分離ができている