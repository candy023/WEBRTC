---
name: webrtc-poker-room-extension
description: PokerRoomView と poker 専用 UI shell を作業部屋 UI から分離して育てるときに使う。初期段階では通話可能な薄い shell と placeholder を最小差分で用意し、未確定の game state 同期や backend 実装には踏み込まない。
---

# webrtc-poker-room-extension

## Purpose

ポーカー部屋専用の拡張を、作業部屋の通話 UI と切り離して育てるための skill。

この skill は将来拡張用の受け皿でもある。
現段階では、PokerRoomView の薄い shell や placeholder を作るところから始める。
まだ game state 同期が未確定なら、通話ロジック本体へ過剰に入り込まない。

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
- Poker のゲーム状態同期は今は入れない。入れる時はこの skill で扱う

## Use this skill when

- PokerRoomView を追加したい
- poker room 専用の layout を作りたい
- seat / table / ready UI の placeholder を置きたい
- 作業部屋とポーカー部屋を UI レベルで切り離したい
- 将来の Poker 機能追加先を先に確保したい

## Do not use this skill when

- Google ログインや session を追加したい
- route guard や room select を作りたい
- work room の既存 WebRTC_UI.vue を整理したい
- Poker の state 同期方式がまだ未決定なのに backend まで入れたい

## Current phase assumption

現段階の Poker room は以下まででよい。

- 別 view で表示できる
- 通話画面として入室できる
- table 領域の placeholder を持てる
- 後から seat / ready / action log を追加しやすい

## Future extension scope

将来ここに寄せる候補:

- table UI
- seat UI
- ready state
- dealer / blind 表示
- round info
- action log
- game state 同期

ただし、これらは今すぐ全部実装しない。

## Hard constraints

- work room の UI に poker 要件を混ぜない
- 既存 WebRTC_UI.vue を poker 用に無理やり流用しない
- poker 用の見た目や状態は PokerRoomView 配下へ閉じ込める
- 共有可能な最小部品だけを抽出する
- game state 同期は明示要求があるまで実装しない
- 通話ロジック本体を巻き込んだ大規模改修をしない

## Recommended files

- src/views/PokerRoomView.vue
- src/components/poker/PokerRoomShell.vue
- src/components/poker/PokerTablePlaceholder.vue
- 必要なら src/composables/poker/*

## UI intent

- 通話はできる
- 将来 table を中央に置ける余白構成にする
- participant video は work room より補助的に扱う
- 初期段階ではプレースホルダでもよい

## Do not touch unless explicitly required

- WorkRoomView
- WebRTC_UI.vue の core UI
- Supabase auth / routing 基盤
- 既存の late join / screen share / mute 実装

## Verification checklist

- poker room が独立した view として表示される
- work room の UI や route に副作用がない
- PokerRoomView が将来拡張しやすい構造になっている
- 今は placeholder 中心でも、責務の分離ができている

## Anti-patterns

- poker room を work room の if 分岐で雑に追加する
- poker 専用 UI を WebRTC_UI.vue へ直接埋め込む
- game state 未確定なのに backend 同期まで一気に入れる
- work room の layout を壊して共通化しすぎる

## Prompt template

この skill を使って、PokerRoomView とその専用 UI shell を最小差分で追加してください。
今は将来拡張用の受け皿を作る段階です。
work room の UI へ poker 要件を混ぜず、通話可能な薄い shell と placeholder に留めてください。

## Do not expand scope

この skill で認証基盤、routing 全体、room_kind policy、未確定の Poker state 同期、WebRTC core 改造まで広げない。

