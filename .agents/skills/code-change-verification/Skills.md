---
name: code-change-verification
description: Vue, JavaScript, Python, build, state, lifecycle, WebRTC 接続処理など、実行時挙動に影響する変更を検証するときに使う。変更後の確認手順を固定し、実行した検証と未実行の検証を区別して報告する。
---

# 目的
変更後の確認漏れを防ぎ、実行した検証だけを正確に報告する。

# 使う場面
- `src/**/*.vue` を変更した
- `src/**/*.js` を変更した
- `*.py` を変更した
- join / leave / publish / subscribe / state / lifecycle を触った
- build, lint, typecheck, test に影響しうる変更をした
- UI 変更に見えても実行時挙動が変わる可能性がある

# 基本方針
- 重い検証を最初から走らせない
- 変更範囲に近い軽い検証から始める
- 実行していない検証を成功扱いしない
- 環境都合で検証できない場合は、その事実を明記する

# 検証の基本順序
1. 変更ファイルを確認する
2. 最小の syntax check を行う
3. 軽量な lint / typecheck があれば変更範囲に近いものを行う
4. 変更箇所に関係する build / 実行確認を行う
5. full build は必要な場合だけ行う

# webrtc3 で優先して見ること
- join が多重実行されないか
- leave 後に再入室できるか
- late join で既存参加者の映像・音声を受信できるか
- self publication を subscribe していないか
- `subscribeExisting()` と新規配信通知の両方が想定どおり動くか
- screen share の開始と停止で camera に正しく戻るか
- background blur の ON/OFF 後に local preview と publish が両立しているか
- ミュート状態が publish 後にも反映されるか
- 既存 UI 文言や表示崩れが起きていないか

# ファイル種別ごとの目安
## `.vue` / フロントエンド `.js`
- 変更ファイルの syntax を確認する
- 軽量な lint / typecheck があれば行う
- 変更箇所に関係する画面またはフローを確認する
- 必要な場合だけ build を行う

## `.py`
- 変更ファイルの syntax を確認する
- 最小の関連 CLI 実行または対象処理の確認を行う
- 無関係な全体テストまでは広げない

# 報告ルール
完了時は次だけを書く。
- 変更ファイル
- 実行した検証
- 未実行の検証
- 確認できたこと
- まだ未確認のリスク

# 禁止事項
- 実行していない検証を成功扱いしない
- full build が不要なのに重い検証を増やさない
- 無関係な失敗ログまで問題化しない
- 検証のために無関係なコード変更をしない