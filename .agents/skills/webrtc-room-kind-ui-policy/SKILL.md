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
- fixed room view に create UI を出すかどうかを policy で統一したい
- room 参加中に lobby へ戻る時の leave 必須化を policy に寄せたい
- RoomSelectView の日本語表示名を policy object から引きたい

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
  - fixed room として扱う
- `poker`
  - 別 view / 別 UI shell
  - 将来の table UI を載せる前提
  - work 側の通話 UI をそのまま複製しない
  - fixed room として扱う

## Hard constraints

- room_kind の分岐は 1 箇所または少数箇所へ寄せる
- `if (room === 'poker')` を各所に散らさない
- work room は `WebRTC_UI.vue` 再利用を維持する
- poker room は独立 view として扱う
- room policy は routing 層と通話ロジック層の中間で扱う
- UI 差分と game state 差分を混ぜない
- 既存の WebRTC media ロジックを大規模改造しない
- fixed room では room view に `部屋を作成` UI を出さない
- `部屋一覧へ戻る` の遷移ポリシーに leave 必須化を持たせてよい

## Fixed room operation policy

### Core operation policy

- `work` と `poker` はどちらも fixed room として扱う
- fixed room では room view に `部屋を作成` UI を出さない
- room view は create-first ではなく enter-first の操作体系にする
- room の決定は room select / route / policy 側で先に済ませる

### Room view navigation policy

- room 参加中に lobby へ戻る導線では leave を必須にしてよい
- room_kind に関係なく `部屋一覧へ戻る` は `leave before navigate` を基本にする
- room policy は「戻る時に leave が必要か」を表現してよい

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
- allowCreateRoomUi
- requiresLeaveOnBack
- enterButtonLabelJa
- backTargetPath
- fixedRoomName

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
- `allowCreateRoomUi: false` のときは room view に `部屋を作成` を出さない
- `requiresLeaveOnBack: true` のときは room 参加中の戻る導線で leave を通す

## Room select display label policy

### Japanese UI labels

- 部屋選択画面の表示文言は日本語に統一する
- `work` の表示名は `作業部屋`
- `poker` の表示名は `ポーカールーム`
- `WorkRoom` や `PokerRoom` のような英語表示を部屋カード文言として直接見せない
- typo を表示文言側へ残さない

### Internal identifier policy

- route path
- slug
- room_kind
- fixed room identifier

これらの内部識別子は英語のまま維持してよい。
表示名の日本語化と内部識別子の rename を混ぜない。

### RoomSelectView policy

- RoomSelectView では nickname 入力導線と部屋選択導線を共存させる
- nickname 未設定時は、部屋カードより nickname 設定を優先表示してよい
- nickname 設定完了後に `作業部屋` / `ポーカールーム` の選択を有効にする
- room_kind に応じた表示名、説明文、導線ラベルは policy object から取得してよい

### Recommended representation addendum

policy object に次を含めてよい。

- `displayNameJa`
- `enterButtonLabelJa`
- `descriptionJa`
- `requiresNicknameBeforeEnter`
- `allowCreateRoomUi`
- `requiresLeaveOnBack`

例:
- work
  - `displayNameJa: '作業部屋'`
  - `enterButtonLabelJa: '参加'`
  - `requiresNicknameBeforeEnter: true`
  - `allowCreateRoomUi: false`
  - `requiresLeaveOnBack: true`
- poker
  - `displayNameJa: 'ポーカールーム'`
  - `enterButtonLabelJa: '参加'`
  - `requiresNicknameBeforeEnter: true`
  - `allowCreateRoomUi: false`
  - `requiresLeaveOnBack: true`

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

## Verification checklist addendum

- RoomSelectView の部屋カード表示が日本語になっている
- 内部 slug / room_kind は英語のまま維持されている
- nickname 未設定時に room 選択が抑止される
- nickname 設定後に日本語ラベルの部屋導線が有効になる
- work / poker の policy で create UI 非表示を制御できる
- room_kind に依存せず `leave before navigate` 方針が守られる
- fixed room view の主要操作が `参加` 中心になっている
- `部屋を作成` が fixed room view に残っていない

## Anti-patterns

- string 比較を各 component に散らす
- work / poker の差分を 1 つの巨大 component の if 文で増やす
- poker 用の要件を work 側 component に直接埋め込む
- policy を router、view、service に三重管理する
- 表示名の日本語化と内部 slug rename を同時にやる
- fixed room view で create-first UI を残す

## Prompt template

この skill を使って、room_kind による UI 分岐ポリシーを中央集約してください。
work room は WebRTC_UI.vue を再利用し、poker room は別 view に分けてください。
分岐は mapping / policy object に寄せ、各所への if 文拡散を避けてください。
また、RoomSelectView の日本語表示名、nickname 未設定時の入室抑止、fixed room view の create UI 非表示、戻る時の leave 必須化を policy で扱ってよいです。

## Do not expand scope

この skill で認証基盤、route guard 実装、Poker state 同期、WebRTC media bugfix まで広げない。