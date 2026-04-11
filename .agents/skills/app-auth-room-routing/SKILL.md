---
name: app-auth-room-routing
description: ログイン画面、部屋選択画面、部屋画面の 3 段フローを認証付きで実装するときに使う。/login から /rooms、さらに /rooms/:slug へ進む route 設計、guard 集約、WorkRoomView での WebRTC_UI.vue 再利用、PokerRoomView 分離を最小差分で行う。
---

# app-auth-room-routing

## Purpose

アプリの画面遷移を、以下の 3 段フローに固定する。

- ログイン画面
- 部屋選択画面
- 部屋画面

この skill は認証付きの routing と view 導線を担当する。
Supabase の中身や WebRTC の media ロジックは主担当ではない。

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

- LoginView を追加したい
- RoomSelectView を追加したい
- protected route を追加したい
- `/login -> /rooms -> /rooms/:slug` の導線を作りたい
- 未ログイン時の route guard を実装したい

## Do not use this skill when

- Supabase schema や RLS を追加したいだけ
- WebRTC の room join / media / publication を直したい
- room_kind ごとの中身の UI 分岐を作りたい
- Poker 固有の機能を追加したい

## Target flow

- `/login`
- `/rooms`
- `/rooms/work`
- `/rooms/poker`

必要なら `/` は `/login` または `/rooms` にリダイレクトする。

## Hard constraints

- 最小差分で実装する
- routing の責務を view と guard に限定する
- 認証ロジックを各 view に重複実装しない
- route guard は 1 箇所に寄せる
- 作業部屋 view では `src/components/WebRTC_UI.vue` を再利用する
- `WebRTC_UI.vue` を複製しない
- ポーカー部屋は別 view を使う
- view 層で Supabase の低レベル実装を増やしすぎない
- 既存の main app 構造を壊しすぎない

## Recommended routes

- `/login`
  - Google ログインボタン
- `/rooms`
  - 作業部屋 / ポーカー部屋の選択
- `/rooms/work`
  - WorkRoomView
- `/rooms/poker`
  - PokerRoomView

## Recommended files

- src/router/index.js
- src/views/LoginView.vue
- src/views/RoomSelectView.vue
- src/views/WorkRoomView.vue
- src/views/PokerRoomView.vue
- src/App.vue

## UI intent

### LoginView

- ログインだけに集中する
- 余計な部屋情報を出さない

### RoomSelectView

- 固定 2 部屋をカードで表示する
- 作業部屋
- ポーカー部屋

### WorkRoomView

- `WebRTC_UI.vue` を包む薄い wrapper view にする

### PokerRoomView

- Poker 用の別画面
- 初期段階では薄い shell でよい

## Do not touch unless explicitly required

- SkyWay service / composable の内部実装
- Supabase schema / SQL の詳細
- WebRTC_UI.vue の大規模 UI 改修

## Verification checklist

- 未ログイン時に `/rooms` へ直接入れない
- ログイン後に `/rooms` へ進める
- `/rooms/work` と `/rooms/poker` の導線が機能する
- WorkRoomView が `WebRTC_UI.vue` を再利用している
- PokerRoomView が work 側 UI を複製していない
- route guard が複数箇所に散っていない

## Anti-patterns

- Login UI を WebRTC_UI.vue に押し込む
- room select UI を通話画面に埋め込む
- 各 view 内に個別の認証判定を乱立させる
- work room と poker room を同じ view に if 文で詰め込む

## Prompt template

この skill を使って、ログイン画面、部屋選択画面、部屋画面の routing を最小差分で追加してください。
ルーティングと view 導線に責務を限定し、Supabase の基盤実装や WebRTC の内部ロジックには広げないでください。

## Do not expand scope

この skill で Supabase schema 実装、room_kind policy 実装、Poker state 同期、WebRTC core の改造まで広げない。

## Nickname gate policy

### RoomSelectView nickname requirement

- RoomSelectView では、入室前に表示名を確定させる
- `profiles.nickname` が未設定なら、RoomSelectView で入力必須にする
- nickname 未設定のまま `/rooms/work` や `/rooms/poker` へ進ませない
- nickname 入力と保存は RoomSelectView で完結させる
- ログイン直後に nickname が未設定なら、RoomSelectView 上で入力導線を最優先表示する
- route guard で細かい UI を持たず、view 側で入力 UI、guard 側で入室禁止を分担する

### Routing behavior for nickname completion

- `/login` 通過後は `/rooms` へ進めてよい
- ただし `/rooms` で nickname 未設定なら、部屋カードより先に nickname 入力を促す
- nickname 保存成功後に部屋選択を有効化する
- nickname 未設定時に `/rooms/work` または `/rooms/poker` へ直接アクセスした場合は `/rooms` へ戻してよい

### Join display name handoff

- RoomSelectView で確定した nickname は、その後の room join 表示名に使う
- room join 時にランダム名を使い続けない
- join 用表示名の source は RoomSelectView で確定した nickname とする
- routing skill では join 実装詳細を抱え込まず、「部屋入室前に nickname が確定している状態」を保証することを優先する

## Verification checklist addendum

- ログイン後に `/rooms` へ進める
- nickname 未設定時は RoomSelectView で入力が必須になる
- nickname 未設定のまま room 画面へ進めない
- nickname 保存後に room 選択が有効になる
- room join 時の表示名がランダム名ではなく確定 nickname になる