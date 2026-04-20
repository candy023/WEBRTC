---
name: app-auth-room-routing
description: ログイン画面、部屋選択画面、部屋画面の 3 段フローを認証付きで実装・拡張するときに使う。/login から /rooms、さらに /rooms/:slug へ進む route 設計、guard 集約、LoginView の複数認証手段、WorkRoomView での WebRTC_UI.vue 再利用、PokerRoomView 分離を最小差分で行う。
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
- 表示用 nickname と SkyWay join 用内部名の受け渡しを整理したい
- LoginView に複数認証手段を並べたい

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
- `profiles.nickname` をそのまま SkyWay join 名に渡さない
- LoginView の provider 追加のために router 全体を大きく組み替えない
- Email OTP は LoginView 内で code 入力型として完結させてよい
- OAuth callback 用の追加 route は必要時のみ最小で追加する

## Recommended routes

- `/login`
  - Discord ログインボタン
  - Google ログインボタン
  - Email OTP 入力導線
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
- 認証手段は複数並べてよい
- 優先順は `Discord -> Google -> Email OTP` を既定とする
- Email OTP は同一画面内で次の流れを完結させてよい
  - メール入力
  - OTP 送信
  - コード入力
  - OTP 検証

### RoomSelectView

- 固定 2 部屋をカードで表示する
- 作業部屋
- ポーカー部屋
- nickname 未設定時は、部屋カードより先に入力導線を出す
- nickname は日本語を許可してよい

### WorkRoomView

- `WebRTC_UI.vue` を包む薄い wrapper view にする
- fixed room に入るための `参加` 導線を持つ
- fixed room view では `部屋を作成` UI を出さない

### PokerRoomView

- Poker 用の別画面
- 初期段階では薄い shell でよい
- fixed room に入るための `参加` 導線を持つ
- fixed room view では `部屋を作成` UI を出さない

## LoginView auth provider policy

### Supported methods

- Discord OAuth
- Google OAuth
- Email OTP

### Ordering policy

- 認証手段の表示順は `Discord -> Google -> Email OTP` を既定とする
- 利用者導線の優先順位は LoginView 上の並びで表現してよい
- provider 追加のために RoomSelectView や room view の責務へ広げない

### Email OTP behavior

- Email OTP は code 入力型を基本とする
- LoginView 内で送信と検証を完結させてよい
- OTP 送信後は別画面へ飛ばさず、同一画面で code 入力欄を出してよい
- LoginView は provider ごとの違いを見せても、ログイン成功後の遷移先は共通で `/rooms` に揃える

### Redirect behavior

- OAuth 成功後の戻り先は `/rooms` を基本とする
- `redirect` query がある場合はそれを尊重してよい
- callback route を追加する場合も、最終的には `/rooms` または元の protected route へ戻す
- Email OTP は callback route を必須前提にしない

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

## Nickname display / join handoff policy

### RoomSelectView responsibility

- RoomSelectView では、ユーザーが見る表示名として `profiles.nickname` を扱う
- RoomSelectView の nickname 入力は日本語を許可してよい
- nickname の入力完了は UI 表示名の確定であり、SkyWay の `member.name` を直接決める操作ではない
- RoomSelectView では、表示名と WebRTC 接続用内部名を混同しない

### Join handoff responsibility

- room view へ渡す値は 1 つに固定しなくてよい
- 必要なら
  - 表示用 nickname
  - SkyWay join 用内部名
  を分けて扱ってよい
- room join 時に `profiles.nickname` をそのまま SkyWay の `member.name` に渡さない
- routing skill では「nickname が確定していること」と「join に使う内部名が安全であること」を両立させる

### Direct access behavior

- nickname 未設定 user は `/rooms` で入力を完了するまで room 画面へ進ませない
- nickname が日本語でも room 画面への遷移自体は止めない
- room join 失敗の原因を nickname 未設定と、日本語 nickname の SkyWay 制約で混同しない

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

## Auth state routing policy

### Guest only route

- `/login` は guestOnly route として扱ってよい
- ログイン済み user が `/login` へ来た場合は `/rooms` へ戻してよい

### Protected routes

- `/rooms`
- `/rooms/work`
- `/rooms/poker`

これらは requiresAuth route として扱う。
未ログイン時は `/login` へ戻してよい。

### Redirect query

- 未ログイン user が protected route へ来た場合、`redirect` query に元の path を保持してよい
- ログイン成功後は `redirect` を優先して戻してよい
- `redirect` が無い場合は `/rooms` を基本戻り先とする

## Do not touch unless explicitly required

- SkyWay service / composable の内部実装
- Supabase schema / SQL の詳細
- WebRTC_UI.vue の大規模 UI 改修
- Discord / Google / Email OTP の低レベル実装詳細

## Verification checklist

- 未ログイン時に `/rooms` へ直接入れない
- ログイン後に `/rooms` へ進める
- `/rooms/work` と `/rooms/poker` の導線が機能する
- WorkRoomView が `WebRTC_UI.vue` を再利用している
- PokerRoomView が work 側 UI を複製していない
- route guard が複数箇所に散っていない

## Verification checklist addendum

- `/login` に Discord / Google / Email OTP が並ぶ
- Discord ログイン成功後に `/rooms` へ進める
- Google ログイン成功後に `/rooms` へ進める
- Email OTP 検証成功後に `/rooms` へ進める
- nickname 未設定時は RoomSelectView で入力が必須になる
- nickname 未設定のまま room 画面へ進めない
- nickname 保存後に room 選択が有効になる
- nickname に日本語を入れて RoomSelectView を通過できる
- room join 時に日本語 nickname がそのまま SkyWay 名へ渡っていない
- room 参加後の UI 表示は `profiles.nickname` を優先している
- nickname 必須化と SkyWay join 名制約の両方が両立している
- room 参加中に `部屋一覧へ戻る` で leave が実行される
- `/rooms` に戻った後、同じユーザーで再参加しても重複 member 名エラーにならない
- WorkRoomView / PokerRoomView に `部屋を作成` UI が表示されない
- fixed room view が enter-only の導線になっている

## Anti-patterns

- Login UI を WebRTC_UI.vue に押し込む
- room select UI を通話画面に埋め込む
- 各 view 内に個別の認証判定を乱立させる
- work room と poker room を同じ view に if 文で詰め込む
- fixed room view なのに createRoom UI を残す
- room 参加中の戻る導線を route push だけで済ませる
- `profiles.nickname` をそのまま SkyWay join 名に使う
- Email OTP のために LoginView を複数 route に分解しすぎる
- provider 追加のために guard ロジックを複数箇所へ分散する

## Prompt template

この skill を使って、ログイン画面、部屋選択画面、部屋画面の routing を最小差分で追加・拡張してください。
ルーティングと view 導線に責務を限定し、Supabase の基盤実装や WebRTC の内部ロジックには広げないでください。
また、LoginView では Discord / Google / Email OTP を扱い、Email OTP は code 入力型として同一画面で完結させてください。
RoomSelectView で nickname 未設定時の入力必須化、表示用 nickname と SkyWay join 用内部名の分離、fixed room view の enter-only 化、`部屋一覧へ戻る` での leave 必須化を守ってください。

## Do not expand scope

この skill で Supabase schema 実装、provider の低レベル service 実装、room_kind policy 実装、Poker state 同期、WebRTC core の改造まで広げない。