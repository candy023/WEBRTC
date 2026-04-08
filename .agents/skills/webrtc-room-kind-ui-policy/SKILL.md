---
name: webrtc-room-kind-ui-policy
description: room_kind (work | poker) による画面選択と UI フラグを mapping / policy object に中央集約するときに使う。work は WebRTC_UI.vue 再利用、poker は別 view を維持し、if 分岐の散在を防ぐ。
---

# webrtc-room-kind-ui-policy

## Purpose

`room_kind` に応じて、どの画面を使い、どの UI ポリシーを適用するかを一元管理する。

この skill の目的は、work room と poker room の違いを
各 component / view / composable に散らさず、中央の対応表または policy 層へ寄せること。

## Common guardrails

- 最小差分で実装する
- 既存の WebRTC ロジックを全消ししない
- `src/components/WebRTC_UI.vue` は作業部屋で再利用する
- 作業部屋用に `WebRTC_UI.vue` を複製しない
- ポーカー部屋は別 view / 別 UI に分ける
- 認証前に部屋画面へ入れない
- room join 前に BAN 判定を行う
- フロントに `service_role` を置かない
- コメントや日本語 UI 文言は不必要に変えない
- Poker のゲーム状態同期は今は入れない。入れる時は `webrtc-poker-room-extension` で扱う

## Use this skill when

- `room_kind = work | poker` を導入したい
- 部屋ごとに使う view や layout を切り替えたい
- screen share 可否や UI flag を部屋ごとに変えたい
- room config の分岐を if 文だらけにしたくない

## Do not use this skill when

- 認証や Supabase schema を追加したいだけ
- router や login flow だけを作りたい
- Poker の game state 同期を実装したい
- WebRTC の media バグを修正したい

## Core policy

- `work`
  - 既存 `WebRTC_UI.vue` を再利用
  - 通話中心
  - 画面共有あり
- `poker`
  - 別 view / 別 UI shell
  - 将来の table UI を載せる前提
  - work 側の通話 UI をそのまま複製しない

## Hard constraints

- room_kind の分岐は 1 箇所または少数箇所へ寄せる
- `if (room === 'poker')` を各所に散らさない
- work room は `WebRTC_UI.vue` 再利用を維持する
- poker room は独立 view として扱う
- room policy は routing 層と通話ロジック層の中間で扱う
- UI 差分と game state 差分を混ぜない
- 既存の WebRTC media ロジックを大規模改造しない

## Recommended representation

以下のような mapping object / policy object を推奨する。

- slug -> room config
- room_kind -> component / flags
- ui_config -> feature flags

例:

- title
- room_kind
- enableScreenShare
- useExistingWorkRoomUi
- pokerTablePlaceholder

## Recommended files

- src/config/roomPolicies.js
- src/composables/useRoomPolicy.js
- 必要なら views 側の薄い adapter

## Recommended behavior

- room select で選ばれた slug から room data を取得する
- room_kind を見る
- work なら WorkRoomView + WebRTC_UI.vue
- poker なら PokerRoomView
- feature flag は policy から読む

## Do not touch unless explicitly required

- Supabase 認証フロー
- router guard の詳細
- WebRTC media service の内部
- Poker のリアルタイム state 同期

## Verification checklist

- work room の UI が `WebRTC_UI.vue` 再利用になっている
- poker room の UI が別系統で扱われている
- room_kind の条件分岐が 1 箇所に寄っている
- 各 component に room 名ハードコードが散っていない
- screen share の可否などが policy で制御できる

## Anti-patterns

- string 比較を各 component に散らす
- work / poker の差分を 1 つの巨大 component の if 文で増やす
- poker 用の要件を work 側 component に直接埋め込む
- policy を router、view、service に三重管理する

## Prompt template

この skill を使って、room_kind による UI 分岐ポリシーを中央集約してください。
work room は WebRTC_UI.vue を再利用し、poker room は別 view に分けてください。
分岐は mapping / policy object に寄せ、各所への if 文拡散を避けてください。

## Do not expand scope

この skill で認証基盤、route guard 実装、Poker state 同期、WebRTC media bugfix まで広げない。
