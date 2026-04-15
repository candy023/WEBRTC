---
name: webrtc-audio-live-toggle-minimal
description: RNNoise ON/OFF を通話中に即時反映する最小修正用 Skill。音声 publication の差し替え経路だけを追加し、無関係な WebRTC フローは触らない。
---

# webrtc-audio-live-toggle-minimal

## 目的

RNNoise ON/OFF を通話中に即時反映できるようにする。  
ただし目的は最小差分であり、RNNoise 周辺を全面改修しない。

---

## この Skill が守るべき前提

- `useStreamReceiver.js` または `useRoomSession.js` は orchestrator として扱う
- 音声 publish 差し替えの責務は service へ寄せられる部分だけ寄せる
- late join、画面共有、背景ぼかしのフローは壊さない
- 既存の mute state を維持する
- 既存 API shape を不必要に変えない
- whole-file rewrite をしない
- 既存コメント、日本語文言、公開 export、関数名、変数名を不必要に変えない

---

## この Skill を使う場面

- RNNoise ON/OFF は確認済みで、現状は join 時の音声生成分岐にしか効いていない
- `toggleRnnoise()` が state 反転だけで終わっている
- 通話中に local audio stream / local audio publication を差し替える必要がある
- 修正対象を RNNoise の live toggle に限定したい
- 既存の WebRTC 接続フローを壊さずに最小差分で直したい

---

## この Skill を使わない場面

- RNNoise の現状実装をまだ確認していない
- late join や `subscribeExisting()` の不具合を直したい
- 画面共有や背景ぼかしの不具合を直したい
- UI レイアウトやモバイル表示だけを直したい
- RNNoise の本格導入や音質チューニング全般をまとめて行いたい

---

## 最小実装の考え方

通話中即時切替に必要なのは、少なくとも次である。

1. 次に publish すべき local audio stream を作る
2. 現在の local audio publication を差し替える
3. 既存 mute 状態を新しい publication / stream に反映する
4. 古い RNNoise handle の cleanup を行う
5. leave 時や再入室時の cleanup と競合しないようにする

この Skill では、これ以外の改善へ広げない。

---

## 修正範囲の基本方針

- `toggleRnnoise()` を state 反転だけで終わらせない
- joined 中だけ、音声 stream の再生成と publication 差し替えを行う
- joined 前は従来どおり state 切替だけにする
- 差し替え手順は helper 化して 1 箇所に寄せる
- video publication 側は触らない
- remote 表示ロジックは触らない
- late join や attach 周辺には触らない

---

## 推奨変更対象

実ブランチの構成に合わせて、次のうち必要なファイルだけ触る。

- `src/composables/useStreamReceiver.js`
- `src/composables/useRoomSession.js`
- `src/services/MediaStreamService.js`
- 必要なら `src/services/RnnoiseService.js`

---

## 推奨しない変更

- `WebRTC_UI.vue` 全体の組み替え
- late join ロジックの修正
- `subscribeExisting()` や `onStreamPublished` の修正
- 画面共有、背景ぼかし、スピーカー切替の同時修正
- 無関係な readable refactor
- 音声と映像の差し替えロジックの同時再設計
- 依存追加や SDK 差し替え

---

## 実装時に必ず確認すること

1. joined 前は従来どおり state だけ切り替わるか
2. joined 中は音声 stream を差し替えるか
3. 既存 `isAudioMuted` が維持されるか
4. 旧 RNNoise handle の cleanup が行われるか
5. leave 後 cleanup が二重破棄で壊れないか
6. join / leave / 再入室が壊れていないか
7. 既存の local audio publication 参照更新が漏れていないか

---

## 最小設計の方向

次のような小さな helper 追加を優先する。

- `createLocalAudioStream(...)`
  - RNNoise ON/OFF と selectedAudioInputId を受けて
  - stream と RNNoise handle をまとめて返す
- `replacePublishedAudioPublication(...)`
  - 現在の publication を差し替える
  - `replaceStream` が使えるならそれを優先する
  - 使えないなら unpublish / publish にフォールバックする
- `applyInitialAudioMuteState(...)` または既存 mute 再反映処理
  - 新しい publication に `isAudioMuted` を反映する

ただし、既存構造を壊してまで helper を増やさない。  
最小差分が最優先である。

---

## RNNoise service に関する扱い

- `setupRnnoise()` が本当に publish 用の処理済み track を返せるかを確認する
- 現状の service が `constraints` だけ返す実装なら、その制約を維持したまま最小修正に留める
- `denoisedTrack` や `processedTrack` が未実装なら、実装済みと誤認させる説明を書かない
- 「live toggle は入ったが、真の denoised track publish ではない」場合は残課題として明記する

---

## 既存不変条件として壊してはいけないもの

- self publication を remote subscribe しない
- late join の受信責務を壊さない
- attach 先 DOM や remote tile 管理を壊さない
- 画面共有停止後の camera 復帰を壊さない
- 背景ぼかし ON/OFF の差し替え順序を壊さない
- 既存 UI state を落とさない
- join / leave / 再入室フローを壊さない

---

## NG

- joined 中切替のために join 全体を書き換える
- audio と video の差し替えロジックを混ぜる
- mute state を落とす
- cleanup を忘れる
- 検証していないのに「通話中即時切替が動作確認済み」と書く
- 実装修正のついでに unrelated refactor を混ぜる
- Skill の目的を超えて広範囲を直す

---

## Codex への要求スタイル

Codex には次を明示する。

- 確認フェーズではなく修正フェーズである
- RNNoise ON/OFF の live toggle だけを最小差分で直す
- 実ブランチ上で `useStreamReceiver.js` と `useRoomSession.js` のどちらが orchestrator かを見て、その file に合わせる
- `replaceStream` が使えるなら優先する
- 使えない場合だけ unpublish / publish にフォールバックする
- 既存 `isAudioMuted` を必ず維持する
- 旧 RNNoise handle を cleanup する
- 未検証部分と残課題を明記する

---

## 出力形式

1. 変更方針
2. 変更ファイル
3. 最小差分の内容
4. 壊していない前提
5. 検証したこと
6. 未検証部分
7. 残課題