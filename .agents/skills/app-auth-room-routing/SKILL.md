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
- RoomSelectView で nickname 未設定ユーザーの入室を止めたい
- fixed room view から `部屋を作成` UI を取り除きたい
- room 画面から lobby へ戻るときに leave を必須化したい

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
- fixed room アプリの room view に `部屋を作成` UI を残さない
- room 画面から lobby へ戻るときは、単なる route push だけで戻さない

## Recommended routes

- `/login`
  - Google ログインボタン
- `/rooms`
  - 作業部屋 / ポーカー部屋の選択
  - nickname 未設定時の入力導線
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
- nickname 未設定時は、部屋カードより先に入力導線を出す

### WorkRoomView

- `WebRTC_UI.vue` を包む薄い wrapper view にする
- fixed room に入るための `参加` 導線を持つ
- fixed room view では `部屋を作成` UI を出さない

### PokerRoomView

- Poker 用の別画面
- 初期段階では薄い shell でよい
- fixed room に入るための `参加` 導線を持つ
- fixed room view では `部屋を作成` UI を出さない

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

## Fixed room view behavior

### Room view responsibility

- RoomSelectView で入る部屋はすでに確定している前提にする
- WorkRoomView / PokerRoomView は「部屋を選ぶ場所」ではなく「確定済みの部屋に入る場所」として扱う
- fixed room アプリでは room view に `部屋を作成` UI を出さない
- room view でユーザーに createRoom を明示操作させない
- room 作成準備が必要でも、それは join 導線の内部処理として隠す

### Enter-only room view policy

- WorkRoomView / PokerRoomView で見せる主要操作は `参加` を基本にする
- 固定 room の view に `部屋を作成` ボタンを残さない
- room の決定は `/rooms` 側で完了している前提を保つ
- fixed room identifier の決定と room view の UI を混ぜない

### Return-to-lobby leave policy

- room 参加中に `部屋一覧へ戻る` ときは、先に `leaveRoom()` を完了させてから `/rooms` へ戻る
- 単なる `router.push('/rooms')` だけで戻さない
- 可能なら room view に `onBeforeRouteLeave` を置き、戻るボタン以外の遷移でも leave を通す
- room 画面から離れる導線では「画面遷移」と「room 退出」を分離しない

### Routing behavior addendum

- `/rooms/work` と `/rooms/poker` は fixed room view として扱う
- room view では nickname / fixed room / join 準備が整った状態から参加する
- room view へ来た後にランダム room を新規作成する導線を増やさない

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

## Verification checklist addendum

- ログイン後に `/rooms` へ進める
- nickname 未設定時は RoomSelectView で入力が必須になる
- nickname 未設定のまま room 画面へ進めない
- nickname 保存後に room 選択が有効になる
- room join 時の表示名がランダム名ではなく確定 nickname になる
- room 参加中に `部屋一覧へ戻る` で leave が実行される
- `/rooms` に戻った後、同じ nickname で再参加しても重複 member 名エラーにならない
- WorkRoomView / PokerRoomView に `部屋を作成` UI が表示されない
- fixed room view が enter-only の導線になっている

## Anti-patterns

- Login UI を WebRTC_UI.vue に押し込む
- room select UI を通話画面に埋め込む
- 各 view 内に個別の認証判定を乱立させる
- work room と poker room を同じ view に if 文で詰め込む
- fixed room view なのに createRoom UI を残す
- room 参加中の戻る導線を route push だけで済ませる

## Prompt template

この skill を使って、ログイン画面、部屋選択画面、部屋画面の routing を最小差分で追加してください。
ルーティングと view 導線に責務を限定し、Supabase の基盤実装や WebRTC の内部ロジックには広げないでください。
また、RoomSelectView で nickname 未設定時の入力必須化、fixed room view の enter-only 化、`部屋一覧へ戻る` での leave 必須化を守ってください。

## Do not expand scope

この skill で Supabase schema 実装、room_kind policy 実装、Poker state 同期、WebRTC core の改造まで広げない。