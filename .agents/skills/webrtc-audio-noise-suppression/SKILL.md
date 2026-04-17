---
name: webrtc-audio-noise-suppression
description: WebRTC アプリの音声ノイズ抑制経路を整理・修正するときに使う。今回の主用途は、実験中の DTLN 経路を完全撤去し、browser 標準の echoCancellation / noiseSuppression / autoGainControl を使う通常通話経路へ最小差分で戻すこと。join/leave/publish/subscribe の既存フローを壊さず、必要最小限の削除と復帰だけを行う。
---

# webrtc-audio-noise-suppression

## 目的

WebRTC アプリの音声処理を、実運用に適した安全な browser 標準経路へ戻す。

今回の主目的は次の 3 点。

1. DTLN 関連の live 通話経路を完全に外す
2. browser 標準の `echoCancellation / noiseSuppression / autoGainControl` を使う通常通話経路へ戻す
3. join / leave / publish / subscribe / UI フローを壊さず、最小差分で安定化する

---

## この Skill が前提にする現状

### 現在の DTLN 実装
- `src/services/RnnoiseService.js` は実質 DTLN 実装になっている
- `public/dtln-worklet.js` / `public/dtln.js` / `public/dtln_rs.wasm` を使う
- `processedTrack` を作って publish 経路へ流す
- `useRoomSession.js` は `setupRnnoise()` の戻り値に `processedTrack` があればそれを `LocalAudioStream` 化して publish する
- `isRnnoiseEnabled` が true のとき live 通話が DTLN 経路へ入る

### 現在の none fallback
- browser 標準の `noiseSuppression: true`
- browser 標準の `echoCancellation: true`
- browser 標準の `autoGainControl: true`
- これは通常通話の安全設定として扱う

### 現在の問題認識
- DTLN live 通話は端末差が大きく、スマホ送話で特に不安定
- diagnostics 上、弱い会話音声が強く落ちるフレームがある
- gain 調整だけで安定化しきれていない
- DTLN を改善するより、一度 browser 標準へ戻す方が実運用上合理的

---

## 今回の基本方針

### 最優先
- DTLN を完全削除する
- browser 標準の通話設定へ戻す
- join / leave / publish / subscribe / UI 状態を壊さない
- 最小差分
- whole-file rewrite をしない
- 既存 API shape を極力維持する

### 通話の標準設定
通常通話はこれを基準にする。

```js
{
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
}
