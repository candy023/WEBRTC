# webrtc-invariants

## 目的
このファイルは、webrtc3 で壊してはいけない不変条件をまとめたものである。
新しい実装やバグ修正のたびに、この条件を守れているかを確認する。

---

## 1. 接続と購読の不変条件

### 1-1. late join の保証
- あとから入室した参加者は、すでに配信中の参加者の映像・音声を受信できなければならない
- これは必須要件であり、既存参加者から新規参加者だけ見える状態で終わってはいけない

### 1-2. 購読責務の分離
- `subscribeExisting()` は、既に存在する publication を購読する責務を持つ
- `onStreamPublished` 系の通知経路は、新しく追加された publication を購読する責務を持つ
- 片方の責務をもう片方で曖昧に代替しない

### 1-3. self publication を subscribe しない
- 自分自身の publication は remote 購読しない
- self 表示は local preview の責務であり、remote tile 側で実現しない

### 1-4. join 前後の race condition を無視しない
- `onStreamPublished` 系 handler は join 完了前に走る可能性がある
- `localMember` 未確定、attach 先 DOM 未確定の状態で処理を進めない
- member 未確定なら guard を入れる

### 1-5. 重複防止は初回受信を壊さない
- publication ID の重複防止は必要だが、早すぎる確定で初回受信や初回表示を潰してはいけない
- 「購読開始済み」と「表示成功済み」を同一視しない

---

## 2. 表示と UI 責務の不変条件

### 2-1. composable と service の責務を混ぜない
- `useStreamReceiver.js` は orchestrator として扱う
- DOM 生成・attach・見た目処理は既存 service に寄せる
- 見た目調整のために接続フローを組み替えない

### 2-2. 受信成功と表示成功は別物として扱う
- subscribe に成功しても、DOM attach 失敗で「見えない」ことがある
- 受信失敗と表示失敗を同じ原因として処理しない

### 2-3. attach 先コンテナが必要
- remote stream の DOM attach は、表示先コンテナが存在するタイミングで行う
- attach 先が未準備のまま受信処理を完了扱いしない

### 2-4. 話者ハイライトは保護対象
- 話者ハイライトは削除してよい装飾ではない
- 既存機能または復元対象の機能として扱う
- tile 構造、memberId 対応、stream attach 周辺を変えるときは、話者ハイライトが壊れていないか確認する

---

## 3. 画面共有と背景ぼかしの不変条件

### 3-1. publish / unpublish / attach の順序を壊さない
- 画面共有と背景ぼかしは、stream 差し替えの順序が崩れると壊れやすい
- 差し替え時は publication 参照、stream 参照、local preview を一貫して更新する

### 3-2. 画面共有停止後は camera に戻る
- 画面共有停止後に camera stream へ戻れなければならない
- local preview も新しい camera stream を参照しなければならない

### 3-3. 背景ぼかし OFF 後は通常 camera に戻る
- processed stream を破棄し、通常の camera stream へ戻れなければならない
- processor の初期化と破棄は対称である必要がある

### 3-4. 既存 state を落とさない
- stream 差し替え後も、必要ならミュート状態や UI state を維持する
- 新しい publication へ state を適切に反映する

---

## 4. room と参加導線の不変条件

### 4-1. room 決定ロジックは一貫させる
- room の決定方法を複数箇所へ散らさない
- URL クエリ、固定 room、localStorage などを導入する場合も、優先順位を 1 箇所で管理する

### 4-2. room 固定化は接続品質と別問題として扱う
- room 固定化の追加で late join や購読ロジックの不具合を埋もれさせない
- room 識別ロジック変更と購読ロジック変更を同時に大きく混ぜない

---

## 5. 修正時の必須観点
修正時は最低でも次を崩していないことを確認する。
- 既存参加者 ↔ 新規参加者 の相互表示
- self publication 非購読
- join / leave / 再入室
- 画面共有開始 / 停止
- 背景ぼかし ON / OFF
- 話者ハイライト
- attach 先 DOM の存在確認

---

## 6. このファイルの使い方
- 新機能追加前に読む
- バグ修正の完了判定に使う
- ここに書かれた条件を壊す変更は、明示的な仕様変更として扱う