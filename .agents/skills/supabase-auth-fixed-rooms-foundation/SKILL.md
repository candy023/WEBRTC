---
name: supabase-auth-fixed-rooms-foundation
description: Vue + Vite の WebRTC アプリで Supabase 認証と固定ルーム基盤を最小差分で追加するときに使う。Google ログイン、session 管理、rooms / profiles / banned_users、join 前 BAN 判定、RLS 前提の browser client を扱う。routing 導線や room_kind UI 分岐、Poker 固有機能には広げない。
---

# supabase-auth-fixed-rooms-foundation

## Purpose

Vue + Vite ベースの WebRTC アプリに、Supabase を使った認証と固定ルーム管理の土台を最小差分で追加する。

この skill は以下を担当する。

- Google ログイン
- auth session 管理
- fixed rooms の取得基盤
- profiles / banned_users の扱い
- browser client 前提の安全な Supabase 利用

この skill 自体は、画面遷移や room_kind ごとの UI 分岐は担当しない。
それらは別 skill に分離する。

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

- Supabase client を追加したい
- Google ログインを追加したい
- profiles / rooms / banned_users の基盤を追加したい
- 固定ルーム一覧を DB 管理にしたい
- room join 前の BAN 判定を導入したい

## Do not use this skill when

- LoginView / RoomSelectView / route guard の UI 導線を作りたいだけ
- work room / poker room の UI 差分を設計したい
- Poker 固有 UI や game state を追加したい
- WebRTC の media / publication / late join の問題を直したい

## Architecture intent

- Supabase は認証と固定ルーム定義を持つ
- rooms テーブルは固定ルームのマスタ
- profiles は auth user に対応する公開プロフィール
- banned_users は入室拒否判定用
- フロントは anon key のみを使う
- service_role は絶対にフロントへ出さない

## Hard constraints

- 最小差分で実装する
- 既存の WebRTC ロジックを全消しして書き換えない
- service_role key をブラウザに置かない
- public schema のテーブルは RLS 前提で扱う
- banned_users の client 書き込みを許可しない
- rooms は client から更新しない
- auth callback 内で重い非同期処理を連鎖させない
- 日本語 UI 文言や既存コメントは不必要に変更しない
- 既存 public API shape を無意味に変えない

## Current product assumptions

- ルームは固定で 2 つ
- `work-room`
- `poker-room`
- room_kind は `work` と `poker`
- 認証後に部屋選択画面へ進む
- room join 前に BAN 判定を行う

## Recommended schema scope

- rooms
  - slug
  - display_name
  - room_kind
  - skyway_room_name
  - media_mode
  - sort_order
  - is_active
  - ui_config
- profiles
  - id
  - display_name
  - avatar_url
  - created_at
  - updated_at
- banned_users
  - user_id
  - reason
  - banned_until
  - created_at

## RLS intent

- rooms
  - authenticated user の select のみ
- profiles
  - 本人のみ select / insert / update
- banned_users
  - 本人の row の select のみ
  - client から insert / update / delete しない

## Recommended implementation order

1. Supabase browser client を追加
2. Google ログイン関数を追加
3. session / current user 取得を整理
4. rooms / profiles / banned_users の SQL を追加
5. fixed rooms 読み出し関数を追加
6. BAN 判定関数を追加
7. 最後に routing 側へ接続する

## Recommended files

- src/services/SupabaseService.js
- src/composables/useAuthSession.js
- src/composables/useLobbyRooms.js
- src/composables/useRoomJoinGuard.js
- sql/supabase/*.sql

## Do not touch unless explicitly required

- `src/components/WebRTC_UI.vue` の通話ロジック本体
- existing SkyWay service / composable の大規模分割
- late join / screen share / mute の既存挙動

## Verification checklist

- 未ログイン時に current user が null になる
- Google ログイン後に session が取れる
- rooms が取得できる
- room_kind が work / poker の 2 件で扱える
- BAN されていないユーザーは join 前チェックを通る
- BAN されたユーザーは join 前に止まる
- service_role がフロントコードに存在しない
- rooms / profiles / banned_users が RLS 前提になっている

## Anti-patterns

- service_role を Vite env に置く
- auth.users を UI データ置き場として直接使う
- banned_users を client から自由に更新する
- routing や view 実装までこの skill で抱え込む
- 認証追加のついでに WebRTC ロジックを大規模改造する

## Prompt template

この skill を使って、Supabase 認証と fixed rooms の土台だけを最小差分で追加してください。
画面遷移や room_kind ごとの UI 分岐は別 skill の責務なので広げないでください。
Google ログイン、rooms / profiles / banned_users、BAN 判定、RLS 前提の browser client に限定してください。

## Do not expand scope

この skill で routing 実装、room_kind UI 分岐、Poker state 同期、WebRTC core の大規模整理まで広げない。

## Nickname profile policy

### Source of truth

- 表示名の正本は `public.profiles.nickname` とする
- `localStorage` は正本にしない
- Google provider の表示名や `auth.users` の値を UI の最終正本にしない
- nickname は auth user に 1:1 で紐づく profile 情報として扱う

### Recommended schema update

- profiles に `nickname` 列を持たせる
- `nickname` は not null 前提で扱う
- 既存 user への backfill が必要なら migration で補う
- profile 読み出し時は `id`, `display_name`, `avatar_url`, `nickname` を基本項目とする

### Auth and profile behavior

- Google ログイン成功後は current user の `id` を取得する
- その `id` に対応する `public.profiles` を読む
- nickname 未設定なら RoomSelectView で設定させる前提にする
- nickname 更新は本人の profile row に対する update のみ許可する
- `profiles.nickname` を room join 用表示名の正本として上位へ渡せるようにする

### RLS intent addendum

- profiles は本人のみ select / insert / update
- nickname 更新は本人 row のみ許可する
- 他人の nickname を client から変更できない
- service_role を使わず anon + authenticated + RLS 前提で成立させる

## Recommended implementation order addendum

8. profiles.nickname の migration を追加する
9. current user に対応する profile 取得関数を追加する
10. nickname 更新関数を追加する
11. RoomSelectView から nickname を保存できるように routing 側へ接続する

## Verification checklist addendum

- profiles.nickname が取得できる
- nickname 未設定 user を判定できる
- 本人だけが nickname を更新できる
- nickname 更新後に再読込しても同じ値が取れる
- room join 用表示名の正本が profiles.nickname になっている