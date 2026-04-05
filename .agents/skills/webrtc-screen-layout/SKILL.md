---
name: webrtc-screen-layout
description: WebRTC 画面の見え方を、接続ロジックに触れずに最小差分で調整するための Skill。
---

# webrtc-screen-layout

## 目的
この Skill は、WebRTC 画面の見え方を最小差分で調整するためのものである。

対象は主に次である。
- `WebRTC_UI.vue` のレイアウト調整
- 共有画面 / 参加者カメラ / self view の表示優先順位の調整
- PC / モバイルでの見え方の改善
- プレースホルダや空状態 UI の最小修正
- 必要最小限の class / computed / 小さな helper 追加

この Skill は見た目専用である。
接続、購読、publish / unpublish、late join、background blur、RNNoise、device 選択の挙動変更は担当しない。

## この Skill を使う場面
次のような依頼で使う。
- 自分の画面が大きすぎるので小さくしたい
- 共有画面を主表示にしたい
- 参加者を 1 列固定ではなく折り返しやグリッドにしたい
- スマホで主要映像が最初に見えるようにしたい
- 「共有中の画面はありません」などのプレースホルダが大きすぎる
- 画面レイアウトを Zoom / Discord / Gather っぽい思想に寄せたい
- 接続不具合ではなく UI の見え方だけを直したい

使わない場面:
- late join 不具合
- subscribeExisting / onStreamPublished の不具合
- join / leave / 再入室不具合
- 画面共有開始 / 停止の不具合
- 背景ぼかしや RNNoise の不具合
- SkyWay SDK 呼び出し順序の修正

これらは別 Skill で扱う。

## 最重要ルール
- 変更対象は必要最小限に限定する
- まず `WebRTC_UI.vue` の責務として解く
- 見た目修正のために `useStreamReceiver.js` の接続順序を触らない
- `useRoomSession.js`, `useRemotePublications.js`, `useLocalMediaSession.js` の挙動を変えない
- コメント、文言、整形、空白、引用符、改行コードは依頼がない限り触らない
- `<template>`, `<script>`, `<style>` の並びを変えない
- テンプレート全体の書き換えはしない
- 日本語コメントと日本語 UI 文言は保持する
- whole-file rewrite をしない
- 横 1 列固定を前提にしない
- モバイルで主要映像を横スクロール前提にしない
- 実行していない検証を成功したとは書かない

## 現在の前提
このプロジェクトでは、共有画面と参加者カメラは別責務で扱う。
共有画面がある場合は、共有画面が主表示である。
参加者カメラは補助表示である。

また、ローカル self view は独立した特別レイヤーではなく、現在の実装では参加者カメラ側のタイル群に入ることがある。
したがって self view のサイズや位置を変えたい場合は、まず Vue 側で `isLocal` を見て見た目だけ分岐することを優先する。

## レイアウト思想
この Skill では、次の思想を優先する。

### 1. 通常会議時
Discord 寄りの考え方を使う。
- 参加者を主役にする
- 1 列固定ではなく、wrap または grid を使う
- self view は通常タイルより小さくする
- self view は「主役」ではなく「確認用」の補助表示とする

### 2. 共有あり時
Gather 寄りの考え方を使う。
- 共有画面を主表示にする
- 参加者カメラは別帯域に落とす
- self view はさらに小さくする
- 共有があるのに参加者カメラが共有と同格に見える構成は避ける

### 3. self view
Zoom / Gather 寄りの考え方を使う。
- self view は常時大きく置かない
- 小窓、補助表示、または非表示可能に寄せる
- self view が相手映像より目立つ構成は避ける

## 既定の UI ルール
依頼が曖昧な場合は次を既定とする。

### PC
#### 共有なし
- 参加者カメラは wrap または grid
- self view は通常参加者より小さくする
- self view は横幅 12%〜15% を目安にする
- 他参加者タイルは可読性を保つ最小幅を持たせる
- 10 人前後でも横 1 列固定にしない

#### 共有あり
- 共有画面を主表示
- 参加者カメラは下部または側部の補助帯
- self view は横幅 10%〜12% を目安にする
- 共有画面より self view や参加者帯が目立たないようにする

### モバイル
- 主要映像を最初に見せる
- 共有ありなら共有画面を上部に出す
- 参加者カメラは横スクロール前提より、縦積みまたは 1〜2 列グリッドを優先する
- self view を大きくしすぎない
- 「見えていないだけ」を接続不具合と誤認しにくい構成にする

## 推奨する実装順
修正は次の順で検討する。

### 第 1 優先
`WebRTC_UI.vue` の class / レイアウト分岐だけで直せるか確認する。
例:
- `tile.isLocal` だけ幅を変える
- `isScreenSharing` や `screenShareTiles.length` で主表示 / 補助表示を切り替える
- placeholder の `max-width`, `padding`, `aspect` を抑える
- `flex-wrap`, `grid`, `min-width`, `max-width` を調整する

### 第 2 優先
Vue 側で読みにくい条件だけ、小さな computed や helper を追加する。
例:
- `hasScreenShare`
- `isLocalTile(tile)`
- `cameraTileClass(tile)`
- `shareLayoutClass`
- `participantGridClass`

### 第 3 優先
どうしても必要な場合だけ、UI に必要な state の橋渡しを `useStreamReceiver.js` に追加する。
ただし、接続フローや publication 処理には触れない。

## 触ってよい範囲
優先して触ってよい:
- `WebRTC_UI.vue`
- その画面専用の小さな helper
- class 切り替え
- computed
- プレースホルダのサイズ
- レイアウト用 wrapper の構造

必要なら最小限で触ってよい:
- UI 表示専用の小さな state bridge
- 既存 return shape を壊さない範囲の公開 state 追加

原則触らない:
- `useRoomSession.js`
- `useRemotePublications.js`
- `useLocalMediaSession.js`
- SkyWay service
- subscribe / publish / unpublish の順序
- remote attach 本体
- dedupe ロジック
- mute badge ロジック
- blur / RNNoise ロジック

## 変更の判断基準
良い修正:
- `WebRTC_UI.vue` 中心で完結している
- self view が補助表示として自然
- 共有ありで共有が主役になっている
- 10 人前後でも破綻しない
- スマホで主要映像が初見で見える
- 変更理由を class と構造で説明できる
- 接続ロジックへ広がっていない

悪い修正:
- 見た目修正のために composable を大きく組み替える
- self view を常に通常参加者より大きくする
- 10 人時に横 1 列固定へ押し込む
- モバイルで横スクロールしないと主表示へ到達できない
- 共有ありでも参加者カメラが主役に見える
- UI 修正なのに join / leave / subscribe 系へ手を出す

## 依頼の読み替えルール
### 「自分の画面が大きすぎる」
- まず `tile.isLocal` だけ見た目を小さくする案を優先する
- ローカル self view を通常参加者タイルと完全同格にしない

### 「10 人くらいで自然にしたい」
- 1 列固定ではなく wrap または grid を採用する
- self view だけ小さくするか、参加者全体を 2 段以上で見せる
- 10 人 × 15% を横 1 列で押し込むような設計は避ける

### 「Zoom / Discord / Gather を参考にしたい」
- そのまま複製しない
- Zoom: self view は補助表示 / 非表示可能
- Discord: 通常時は grid / focus 思想
- Gather: 共有時は content first、通常時は mode 切り替え思想
- この 3 つの思想を今の WebRTC UI に最小差分で落とす

### 「共有中の画面はありません、の box が大きすぎる」
- まず placeholder の max-width と padding を下げる
- aspect 比や min-height の持ちすぎを疑う
- 接続不具合の調査へ広げない

## 実装パターン
### パターン A: 最小修正
- `WebRTC_UI.vue` のみ変更
- `tile.isLocal` の class 分岐追加
- wrap / grid の切り替え追加
- placeholder のサイズ調整

最優先で選ぶ。

### パターン B: 小さな helper 追加
- `WebRTC_UI.vue` が読みにくいときだけ採用
- 小さな computed / helper を追加
- API shape は維持する

### パターン C: 軽い mode 分離
- 通常会議モード
- 共有優先モード

必要時のみ採用する。
大規模な状態管理追加はしない。

## 受け入れ条件
修正後は最低でも次を満たすこと。
- self view が補助表示として自然
- 共有ありで共有画面が主役
- 共有なしでも参加者映像が読みやすい
- 10 人前後で横 1 列固定に見えない
- モバイルで主要映像が最初に見える
- late join, join / leave, 画面共有, 背景ぼかし, mute の挙動を壊していない
- 変更差分が小さい
- 文字化けがない
- 無関係なコメント変更がない

## 検証
優先順は次のとおり。
1. 変更ファイルの syntax 確認
2. `WebRTC_UI.vue` の表示崩れがないか確認
3. PC で共有なし / 共有ありを確認
4. スマホ幅で主要映像の見え方を確認
5. 可能なら 2 端末で最低限の join / share 表示だけ確認

検証していない項目は未検証として明記する。

## Codex への指示テンプレート
依頼を受けたら、まず次を整理する。

- 変更対象ファイル
- 今回の表示問題
- 変えてよい範囲
- 触ってはいけない範囲
- 最小差分の案
- 検証方法

出力では次を簡潔に書く。
- 変更ファイル
- 何をどう小さく / 大きく / 並べ替えたか
- 接続ロジックに触れていないこと
- 未検証項目

## 禁止事項
- whole-file rewrite
- composable の大規模分割
- SkyWay 接続順序の変更
- subscribeExisting / onStreamPublished の責務変更
- 共有 / blur / mute の実行順序変更
- 無関係な import 並び替え
- 無関係な整形
- コメントの書き換え
- UI 修正に見せかけた設計大改造

## 一言でいうと
この Skill は、
「WebRTC の見た目だけを、Discord / Gather / Zoom 的な優先順位に寄せて、`WebRTC_UI.vue` 中心の最小差分で直す」
ための Skill である。