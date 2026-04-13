---
name: webrtc-ui-enhancements
description: join/subscribe/画面共有フローを変えずに、参加者タイルの右クリックメニュー、レイアウト内主表示、ミュート可視化、参加者ごとの音量調整を最小差分で追加する
---

# webrtc-ui-enhancements

## 目的
この Skill は、WebRTC UI に対する小さな機能追加を、安全な最小差分で実装するためのものである。

主な対象は次の 3 点。
- 参加者タイルの右クリックメニュー追加
- 映像のレイアウト内主表示
- local / remote の mic mute 可視化
- remote participant ごとの音量調整

## この Skill を使う場面
- WebRTC UI に小さな操作追加を入れたいとき
- 参加者タイルの操作性を上げたいとき
- 接続フローは変えずに、表示や参加者ごとの音量制御を足したいとき
- 最小差分で `WebRTC_UI.vue` / `useStreamReceiver.js` / `VideoUIService.js` を直したいとき

## この Skill を使わない場面
- late join 不具合の修正
- subscribeExisting / onStreamPublished の責務見直し
- SkyWay 接続フローの変更
- 大きなレイアウト全面改修
- 無関係なリファクタ
- WebRTC ロジック全体の再設計

## 変更対象
優先して触るファイル:
- `src/components/WebRTC_UI.vue`
- `src/composables/useStreamReceiver.js`
- `src/services/VideoUIService.js`

原則として触らないファイル:
- `src/services/SkywayRoomService.js`
- `src/services/MediaStreamService.js`
- `src/services/RnnoiseService.js`

必要性が明確でない限り、他ファイルへ広げない。

## プロジェクト前提
- `useStreamReceiver.js` は orchestrator として扱う
- DOM 生成・attach・audio/video 要素操作は `VideoUIService.js` に寄せる
- SkyWay の join / leave / subscribeExisting / onStreamPublished の流れは変更しない
- self publication を remote subscribe 側へ混ぜない
- late join、再入室、画面共有、背景ぼかし、既存のスピーカー出力切替を壊さない
- 共有画面と参加者カメラは別責務として扱う

## 実装ルール

### 1. 主表示レーンの優先制御
- 共有が存在する場合、主表示エリアは共有コンテンツ用として扱う
- どの共有を主表示するかは、既存の「配信を見る」導線または共有選択 UI に従う
- 共有が存在する間は、参加者カメラの「主表示にする」は無効化または非表示にする
- 共有が存在しないときだけ、参加者タイルの右クリックメニューから「主表示にする / 主表示を解除」を使えるようにする
- 音量調整は共有の有無に関係なく使える

### 2. 参加者タイルの右クリックメニュー
- 各参加者タイルにコンテキストメニューを追加してよい
- 共有がないときは、`主表示にする` / `主表示を解除` / `音量を調整` を出せるようにする
- 共有があるときは、`音量を調整` は使えるようにし、`主表示にする` は出さないか無効化する
- `主表示を解除` は、現在その参加者がカメラ主表示中のときだけ出してよい
- local participant に volume 調整は出さない

### 3. レイアウト内主表示
- 「主表示にする」は full screen overlay ではなく、既存 layout 内で大きく表示する
- 既存の `enlargeVideo()` など full screen 用の挙動は、今回の主表示機能とは分けて扱う
- 既存の local / remote tile DOM を可能な範囲で再利用する
- 同じ participant の映像 DOM を不要に重複生成しない
- `主表示を解除` 時は、通常の filmstrip / grid 表示へ戻す

### 4. ミュート状態の可視化
- 最低限、mic mute は local / remote ともに画面上で分かるようにする
- remote は publication state に同期させる
- local は既存 `isAudioMuted` state に同期させる
- 既存の remote mute badge の仕組みを流用してよい
- 今回の主目的は mic mute 可視化であり、全面的な状態表示システムへ広げない

### 5. 参加者ごとの音量調整
- 対象は remote participant ごと
- 初期値は 100%
- 範囲は 0〜100 とする
- 100 を超える増幅はしない
- hidden audio 要素に対して `volume` を member 単位で適用する
- UI は participant camera tile 側にだけ置く
- share thumbnail 側へ volume UI を重複表示しない
- local participant には volume slider を出さない
- 状態保持はセッション中の in-memory state でよい
- 永続化は不要

## 最小差分の実装指針
- `useStreamReceiver.js` に追加する state は最小限にする
- `WebRTC_UI.vue` の変更は狭く保つ
- remote audio 要素へ、member 単位操作に必要な属性だけ追加する
- 必要なら `VideoUIService.js` に member 単位 volume 適用 helper を小さく追加する
- 既存の remote mute badge ロジックは再利用する
- 無関係な整形、rename、コメント変更、関数移動はしない

## 不変条件
以下は壊さない。
- late join
- self publication 非購読
- join / leave / 再入室
- 画面共有開始 / 停止
- 背景ぼかし ON / OFF
- 共有がある場合は共有側が主表示レーンを使うこと
- 参加者カメラと共有画面を同じ責務に戻さないこと
- モバイルで主要映像が初見で見えること

## 受け入れ条件
- 画面共有なし時に、参加者タイルの右クリックから `主表示にする / 主表示を解除 / 音量を調整` を使える
- 画面共有なし時に、選択した participant camera を layout 内の主表示へ出せる
- その操作は full screen overlay ではない
- 画面共有あり時は、既存の共有主表示導線を維持し、参加者タイルでは `音量を調整` のみ使える
- local / remote の mic mute が画面上で分かる
- remote participant ごとの slider で個別に音量が変わる
- 他参加者の音量には影響しない
- 既存の global speaker 出力切替は維持される

## 禁止事項
- whole-file rewrite
- 接続フローの再設計
- subscribe ロジックの再設計
- 共有画面レイアウトの全面改修
- 無関係な readable 化
- 無関係なコメント書き換え
- 無関係な import 並び替え
- 無関係な formatting

## 完了報告
完了時は簡潔に次を報告する。
- 変更ファイル
- 実装した挙動
- 未検証部分
- 手元で確認すべきシナリオ