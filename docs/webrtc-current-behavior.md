# webrtc-current-behavior

## 目的
このファイルは、webrtc3 の現在の挙動と、今後も維持したい運用方針を短く整理するためのメモである。
Codex や人間が修正前に読む前提で、実装事実と今後の方針を分けて記録する。

---

## 1. 現在確認済みの実装挙動

### ルーム参加
- ルーム参加の主経路は `createRoom()` → `joinRoom()` である
- `roomId` は URL クエリ `?room=` があればその値を使う
- URL クエリが無い場合、現在は `createRoom()` 内で `roomId` を生成する実装である
- SkyWay の Context と Room は composable 側で保持する

### ローカル publish
- join 完了後に camera stream と microphone stream を生成し、自分の映像・音声を publish する
- 映像 publication と音声 publication は別々に保持する
- 既存のミュート状態は publish 後にも反映する

### リモート subscribe
- 新規配信の受信は `onStreamPublished` 系の通知経路が担う
- 既に配信中の参加者の受信は `subscribeExisting()` が担う
- 自分自身の publication は subscribe しない
- publication ID の重複受信は防止したいが、初回受信を潰さないよう慎重に扱う必要がある

### リモート表示
- リモート映像・音声の DOM attach は `VideoUIService` 側が担う
- 映像は video 要素、音声は非表示 audio 要素として扱う
- attach 先コンテナが未準備だと、受信していても表示されない可能性がある

### 画面共有
- 画面共有開始時は display stream を publish する
- 停止時は camera stream を再生成して publish し直す
- local preview も新しい stream に付け替える

### 背景ぼかし
- 背景ぼかし ON 時は processor を通した video stream に差し替える
- OFF 時は通常の camera stream に戻す
- `publish / unpublish / attach` の順序が崩れると壊れやすい

### RNNoise
- RNNoise の有効 / 無効状態は state として保持する
- 音声入力制約や初期化ハンドルは join 周辺処理に影響する

---

## 2. 今後も維持したい挙動

### late join
- あとから入室した参加者は、すでに配信中の参加者の映像・音声を見られなければならない
- 先にいた参加者は、あとから入った参加者の映像・音声も見られなければならない
- 「新規配信の購読」と「既存配信の購読」は責務を分けて維持する

### self subscribe 防止
- 自分の publication を自分で subscribe しない
- 自己映像の表示は local preview の責務とし、remote tile 側へ混ぜない

### UI 責務分離
- composable は orchestrator として扱う
- DOM 寄り処理は既存 service に寄せる
- 見た目修正だけの依頼では接続処理を触らない

### 話者ハイライト
- 話者ハイライトは消えてよい機能ではなく、維持または復元対象の機能として扱う
- stream attach や tile 更新を変えるときは、話者ハイライトが壊れていないか確認する

---

## 3. 今後の実装方針として明文化しておきたい事項

### room 固定化
現在は「URL クエリがあればそれを使い、無ければ roomId を生成する」実装である。
今後は、URL を毎回変えなくてよい運用を目指す。

ただし、room 固定化の仕様はまだ最終確定ではないため、実装時は次の候補から選ぶ。
- URL クエリがあればそれを最優先
- URL クエリが無ければ固定 room 名を使う
- URL クエリが無ければ localStorage の前回 room を使う
- 完全固定 room にする場合は、誤入室や並行検証のしづらさも考慮する

room 固定化を実装する場合は、次を同時に確認する。
- 既存の join / leave フローを壊さない
- URL 共有導線との整合
- 再読み込み後の挙動
- 複数端末テスト時の使い勝手

---

## 4. 未確定・要確認事項
- room 固定化の最終仕様
- 話者ハイライトの現在の有効状態と復元方法
- late join 問題が再現する条件の正確な特定
- `receivedPublicationIds` の確定タイミングの最適化
- `bindOnStreamPublished()` に渡す member の確定タイミング整理

---

## 5. このファイルの使い方
- 新しい修正の前に読む
- 実装事実と未実装の希望を混同しない
- 仕様が変わったら、このファイルも短く更新する