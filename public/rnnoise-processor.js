// ------------------------------------------------------------
// RNNoise AudioWorkletProcessor（ライブラリAPI準拠版）
// 目的:
//   - AudioWorklet 内で PCM 音声を受け取り、RNNoise (WASM) により
//     フレーム単位でノイズ除去を行う。
//   - 同時に VAD (Voice Activity Detection = 発話判定) を取得し
//     メインスレッドへ postMessage で送信する。
// 
// この AudioWorkletProcessor の役割:
//   1) 入力音声をバッファに蓄積
//   2) RNNoise の要求する frameSize（通常 480サンプル）ごとに処理
//   3) ノイズ除去済み PCM を output に書き込む
//   4) VAD 値を一定間隔でメインスレッドに送信
// 
// 期待される processorOptions:
//   {
//     denoiseState: DenoiseState インスタンス (rn.createDenoiseState())
//     frameSize: RNNoise が要求するフレームサイズ（480 推奨）
//     vadInterval?: number  // 何フレームごとに VAD を送るか
//   }
class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // 1. RNNoise の動作パラメータを取り出す（名前付き引数コメントスタイル）
    const {
      denoiseState,          // RNNoise の状態オブジェクト（processFrameを提供）
      frameSize = 480,       // フレームサイズ（RNNoise既定は480サンプル@48kHz）
      vadInterval = 10,      // VAD通知間隔（このフレーム数ごとにpostMessage）
    } = options.processorOptions ?? {};
    this.state = denoiseState;
    this.frameSize = frameSize;
    this.vadInterval = vadInterval;

    // 2. 入力バッファと作業用フレームを準備
    this.buf = new Float32Array(0);
    this.work = new Float32Array(this.frameSize);

    // 3. VAD 通知のためのカウンタ
    this.frameCounter = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    // 1. 入力が無ければ無音を返して終了
    if (!input || input.length === 0) {
      if (output && output[0]) output[0].fill(0);
      return true;
    }

    const inCh0 = input[0];
    const outCh0 = output[0];
    if (!inCh0 || !outCh0) return true;

    // 2. RNNoise が使えない場合は生の音声をそのまま通す
    if (!this.state) {
      for (let i = 0; i < outCh0.length; i++) outCh0[i] = inCh0[i] || 0;
      return true;
    }

    // 3. 入力を内部バッファに蓄積（RNNoise の frameSize 単位で処理するため）
    const concatenated = new Float32Array(this.buf.length + inCh0.length);
    concatenated.set(this.buf, 0);
    concatenated.set(inCh0, this.buf.length);
    this.buf = concatenated;

    let outIndex = 0;

    // 4. frameSize に達した分だけ RNNoise でノイズ除去＋VAD 取得
    while (this.buf.length >= this.frameSize && outIndex < outCh0.length) {
      this.work.set(this.buf.subarray(0, this.frameSize));

      let vad = 0;
      try {
        vad = this.state.processFrame(this.work); // work がノイズ除去済 PCM に書き換わる
      } catch (e) {
        // RNNoise 失敗時は元の音声をそのまま返す
        for (let i = 0; i < this.work.length; i++) {
          this.work[i] = this.buf[i] || 0;
        }
      }

      // 5. ノイズ除去済みフレームを出力バッファにコピー
      const copyLen = Math.min(this.work.length, outCh0.length - outIndex);
      outCh0.set(this.work.subarray(0, copyLen), outIndex);
      outIndex += copyLen;

      // 6. 消費した分を内部バッファから削除
      const remaining = this.buf.length - this.frameSize;
      const nextBuf = new Float32Array(remaining);
      nextBuf.set(this.buf.subarray(this.frameSize));
      this.buf = nextBuf;

      // 7. 一定間隔ごとに VAD 値をメインスレッドへ通知
      this.frameCounter++;
      if (this.frameCounter % this.vadInterval === 0) {
        this.port.postMessage({ type: 'vad', value: vad });
      }
    }

    // 8. 書ききれなかった出力領域は無音で埋める
    for (let i = outIndex; i < outCh0.length; i++) outCh0[i] = 0;

    return true;
  }
}

// AudioWorklet にこの Processor を登録
registerProcessor('rnnoise-processor', RnnoiseProcessor);
