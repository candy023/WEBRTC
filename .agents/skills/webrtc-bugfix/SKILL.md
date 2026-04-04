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

# 基本方針
- 原因候補を先に 3 個以内に絞る
- いきなり大規模リファクタしない
- composable は orchestrator として扱い、DOM 寄り処理は既存 service を優先する
- 既存の export、引数、戻り値、state shape は必要な場合を除き変えない
- 変更は症状に直結する経路だけに限定する
- UI 修正だけの依頼なら、接続処理まで広げない

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