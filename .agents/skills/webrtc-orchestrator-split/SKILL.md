---
name: webrtc-orchestrator-split
description: useStreamReceiver.js を orchestrator として保ったまま、安全に責務分割するときに使う。挙動変更なしを最優先とし、late join、join/leave、screen share、background blur、RNNoise を壊さない。UIだけの修正や whole-file rewrite では使わない。
---

# 目的
この Skill は、`src/composables/useStreamReceiver.js` を **orchestrator として保ったまま安全に分割する** ためのものである。

目的は次の 3 つに限定する。

1. `useStreamReceiver.js` の責務を減らす
2. 接続順序や既存挙動を壊さずに小さく分割する
3. 将来の Supabase 連携や room 管理追加に耐えられる構造へ寄せる

この Skill は **大規模リファクタ** のためではない。  
**挙動変更なしの責務分割** を最優先にする。

---

## この Skill を使う場面
次のような依頼で使う。

- `useStreamReceiver.js` が大きすぎるので分けたい
- orchestrator としての責務だけに戻したい
- device state / remote publications / room session を別ファイルへ出したい
- Supabase 用の room 管理を後で足せるように境界を作りたい
- 行数を減らしたいが、late join や screen share は絶対に壊したくない

---

## この Skill を使わない場面
次の依頼では、この Skill を主導にしない。

- UI 文言やレイアウトだけを直したい
- 既存の late join バグだけを最小修正したい
- 背景ぼかしや RNNoise の実装だけを直したい
- whole-file rewrite を前提に別アーキテクチャへ置き換えたい

その場合は既存の `webrtc-bugfix` や `ui-minimal-fix` を優先する。

---

## 最重要方針
- `useStreamReceiver.js` は orchestrator として扱う
- 接続順序を変えない
- 既存挙動を変えない
- 1 回の変更で 1 責務だけを分離する
- 変更対象ファイルは必要最小限に限定する
- whole-file rewrite をしない
- コメント、文言、日本語テキスト、既存 API shape は必要な場合を除き維持する
- late join, join / leave, screen share, background blur, RNNoise を保護対象として扱う
- 分割後も `useStreamReceiver.js` には **順序制御 + 依存注入 + 公開 API の束ね** を残す
- `useStreamReceiver.js` を「ロジックゼロ」にすることは目的ではない

---

## readable-code 併用方針
- `readable-code` Skill が併用される場合、touched code の可読性改善は任意ではなく要求仕様として扱う
- 新規 composable を作る場合、公開 API だけでなく **何を担当し、何を担当しないか** を JSDoc の Note や冒頭説明で明記する
- 重要な state / ref / handler / callback のコメント密度を、分割前より下げてはならない

---

## 不変条件
分割中も次を壊してはいけない。

### 1. 接続と購読
- あとから入室した参加者は既存参加者の映像・音声を見られる
- 既存参加者はあとから入った参加者の映像・音声を見られる
- `subscribeExisting()` は既存 publication の購読責務を持つ
- `onStreamPublished` 系は新規 publication の購読責務を持つ
- self publication を remote 側で subscribe しない
- publication 重複防止で初回受信を潰さない
- 「購読開始済み」と「表示成功済み」を同一視しない

### 2. 表示
- DOM attach は attach 先が存在するタイミングで行う
- subscribe 成功と表示成功を同一視しない
- 共有画面と参加者カメラを同じ責務に戻さない
- 共有画面がある場合は共有画面を主表示として扱う
- 話者ハイライトや mute badge を壊さない
- attach 先 DOM 未準備時の retry を安易に削除しない

### 3. stream 差し替え
- publish / unpublish / attach の順序を崩さない
- 画面共有停止後に camera に戻れる
- 背景ぼかし OFF 後に通常 camera に戻れる
- 差し替え後も必要な mute state や UI state を維持する

---

## 分割の基本原則
`useStreamReceiver.js` に残してよいのは、次だけである。

- UI へ公開する state の束ね
- service / sub composable の呼び出し順序制御
- join / leave の高レベルな流れ
- 各責務モジュール間の接着
- どうしても sub composable 側へ持ち込めない最小限の bridge callback

`useStreamReceiver.js` から優先的に外す候補は次の通り。

### 優先度 1: device panel / device selection
安全に外しやすい。  
接続順序や late join に触れにくい。

対象例:
- `videoInputDevices`
- `audioInputDevices`
- `audioOutputDevices`
- `selectedVideoInputId`
- `selectedAudioInputId`
- `selectedAudioOutputId`
- `showCameraPanel`
- `showMicPanel`
- `showSpeakerPanel`
- `tempSelectedVideoInputId`
- `tempSelectedAudioInputId`
- `tempSelectedAudioOutputId`
- `open/cancel/confirm` 系関数
- 初期 device enumerate と既定値選択

推奨ファイル名例:
- `src/composables/useMediaDevicePanels.js`
- `src/composables/useMediaDeviceState.js`

### 優先度 2: remote publications / remote tiles
行数削減効果が大きい。  
ただし late join と attach 失敗に直結するため慎重に分ける。

対象例:
- `attachRemote`
- `removeTileByPubId`
- `receivedPublicationIds`
- `pendingPublicationIds`
- remote audio mute badge 同期
- remote tile 配列更新
- remote attach の retry 的な `nextTick()` 処理

推奨ファイル名例:
- `src/composables/useRemotePublications.js`
- `src/composables/useRemoteMediaSession.js`

### 優先度 3: room session
`createRoom / joinRoom / leaveRoom` 周辺。  
効果は高いが最も壊しやすい。  
優先度 1 と 2 の後に扱う。

対象例:
- `createRoom`
- `joinRoom`
- `leaveRoom`
- `reflectInitialMuteState`
- `streamPublishedHandler`
- `streamUnpublishedHandler`
- `publicationEnabledHandler`
- `publicationDisabledHandler`

推奨ファイル名例:
- `src/composables/useRoomSession.js`

この分割で守ること:
- `subscribeExisting()` と `onStreamPublished` の責務を混ぜない
- join / publish / subscribe / leave の順序を変えない
- self publication を remote 側で subscribe しない
- `useRoomSession.js` に local tile DOM 管理を入れない
- `useRoomSession.js` に remote attach 実装本体を入れない
- `useRoomSession.js` は room lifecycle と event bind / unbind に責務を限定する

### 優先度 4: local tile / blur / metadata glue
room session を分けた後でも `useStreamReceiver.js` に残りやすい local glue を分離する。

対象例:
- `syncLocalVideoTile`
- `ensureLocalTileRefs`
- `updateLocalVideoPublicationMetadata`
- `getLocalTileElements`
- `setLocalTileElements`
- `getBlurProcessor`
- `setBlurProcessor`
- `releaseLocalVideoStream`

推奨ファイル名例:
- `src/composables/useLocalVideoTileSession.js`
- `src/composables/useLocalVideoPresentation.js`

この分割で守ること:
- local preview / local tile / metadata の glue だけを扱う
- room lifecycle を持ち込まない
- remote attach / mute badge / dedupe を持ち込まない
- `useLocalMediaSession.js` と責務を重ねすぎない

### 既存維持
すでに分離済みの責務は戻さない。

例:
- `src/composables/useLocalMediaSession.js`
- `src/composables/helpers/useVideoTiles.js`
- `src/services/VideoUIService.js`
- `src/services/SkywayRoomService.js`
- `src/services/MediaStreamService.js`

---

## 将来の Supabase 連携に関する方針
Supabase を入れる場合も、`useStreamReceiver.js` に直接 DB 操作を書かない。

room 管理や presence 管理の境界は service に置く。

推奨ファイル名例:
- `src/services/RoomStoreService.js`
- `src/services/SupabaseRoomService.js`

`useStreamReceiver.js` からは、次のような薄い呼び出しだけにする。

- `getOrCreateRoomRecord(roomId)`
- `joinRoomMember(roomId, memberId)`
- `leaveRoomMember(roomId, memberId)`

今の段階では Supabase を先に実装しなくてよい。  
まずは orchestrator の責務整理を優先する。

---

## やってよい変更
- 小さな helper composable の追加
- state 群の安全な移動
- DOM 寄り処理の既存 service / composable への寄せ
- `useStreamReceiver.js` の return 整理
- 同一責務の小さなまとまりの移動
- 必要最小限の import / export 更新
- 変更箇所に限った JSDoc の追加または維持
- 新規 composable 冒頭に責務境界の説明を追加すること

---

## やってはいけない変更
- whole-file rewrite
- 無関係な整形
- 無関係な import 並び替え
- コメント書き換え
- 日本語コメントの書き換え
- UI レイアウトの再設計
- 接続ロジックの全面再設計
- `subscribeExisting()` と `onStreamPublished` の責務混同
- self subscribe の再導入
- 共有画面と参加者カメラの責務混同
- working な service を別アーキテクチャへ置換
- room 固定化や Supabase 追加を責務分割と同時に混ぜること
- `useRoomSession.js` に local tile / local preview / blur processor の DOM glue を持ち込むこと

---

## 変更単位
1 回の作業では **1 責務だけ** 分ける。

良い例:
- device panel だけ分ける
- remote publications だけ分ける
- room session だけ分ける
- local tile glue だけ分ける

悪い例:
- device, remote, room session, UI layout, Supabase を同時に触る

---

## 進め方
毎回この順で進める。

### 1. 変更前に整理すること
- 変更対象ファイル
- 今回分離する責務
- 触ってはいけない範囲
- 壊しやすい不変条件
- 最小経路

### 2. Plan を出す
Plan には次を含める。
- どの責務を切り出すか
- どの state / 関数を移すか
- `useStreamReceiver.js` に何を残すか
- リスク
- 最小検証

### 3. 実装する
- 近傍スタイルに合わせる
- 既存命名を尊重する
- API shape を必要最小限だけ変える
- 一気に大きく動かさない

### 4. 検証する
最低限これを行う。
1. 変更ファイルの syntax check
2. import/export の破綻確認
3. join / leave / late join に影響する変更なら関連動線の確認ポイント整理

---

## Codex への出力形式
この Skill を使うとき、出力は次の順にする。

1. Plan
2. Files to change
3. Minimal patch strategy
4. Risks
5. Verification
6. List of important variables/handlers/callbacks that received individual comments

Plan の時点で、次を明示する。
- 今回は何を分けるか
- 今回は何を分けないか
- どの不変条件を守るか

---

## 品質基準
良い差分の条件:
- 必要ファイルだけ変更している
- 挙動変更がない
- `useStreamReceiver.js` の責務が明確に減っている
- 既存 service と composable の境界を壊していない
- 文字化けがない
- merge marker がない
- コメントや日本語テキストを壊していない
- 新規 composable に「何を担当し、何を担当しないか」が明記されている

悪い差分の兆候:
- 差分が大きすぎる
- コメントまで大量に変わっている
- `useStreamReceiver.js` 以外まで広く巻き込んでいる
- UI 修正や Supabase 追加まで同時に始めている
- late join や screen share の順序を暗黙に変えている
- room session 分割で local tile / remote attach / blur glue まで一緒に持ち込んでいる

---

## 完了報告ルール
完了時は簡潔に次を書く。

- 変更ファイル
- 今回分けた責務
- `useStreamReceiver.js` に残した責務
- 未検証部分
- 残る次の分割候補

---

## 例: 良い依頼文
`useStreamReceiver.js` から room lifecycle の責務だけを `src/composables/useRoomSession.js` へ切り出してください。挙動変更は禁止です。`subscribeExisting()` と `onStreamPublished` の責務を混ぜず、join / publish / subscribe / leave の順序を維持してください。whole-file rewrite は禁止です。変更後は Plan, Files to change, Minimal patch strategy, Risks, Verification の順でまとめてください。

---

## 例: 悪い依頼文
`useStreamReceiver.js` を全部きれいに書き直して Supabase も入れて room 固定化もして UI も整理してください。

---

## 最後の原則
`useStreamReceiver.js` を小さくすること自体が目的ではない。

**順序制御を壊さず、責務を分け、将来の変更点を安全に置ける構造にすること** が目的である。