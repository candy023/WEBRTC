import { LocalAudioStream } from '@skyway-sdk/room';
import {
  RnnoiseWorkletNode,
  SpeexWorkletNode,
  loadRnnoise,
  loadSpeex
} from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import speexWorkletPath from '@sapphi-red/web-noise-suppressor/speexWorklet.js?url';
import speexWasmPath from '@sapphi-red/web-noise-suppressor/speex.wasm?url';

// Speex suppressor はローカル音声 publish 経路を単一チャネルで処理する。
const SUPPRESSOR_MAX_CHANNELS = 1;
// RNNoise も同様に単一チャネルで処理し、既存 publish 経路との整合を保つ。
const RNNOISE_MAX_CHANNELS = 1;
// suppressor 経路でのみ使う前段 high-pass filter の固定初期値。
const SUPPRESSOR_HIGHPASS_TYPE = 'highpass';
const SUPPRESSOR_HIGHPASS_FREQUENCY_HZ = 120;
const SUPPRESSOR_HIGHPASS_Q = 0.707;

// browser 標準経路に戻すときに使う共通マイク制約。
const createStandardAudioConstraints = (audioDeviceId) => ({
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  ...(audioDeviceId ? { deviceId: audioDeviceId } : {})
});

const createSuppressorAudioConstraints = (audioDeviceId) => ({
  noiseSuppression: false,
  echoCancellation: true,
  autoGainControl: false,
  ...(audioDeviceId ? { deviceId: audioDeviceId } : {})
});

const AUDIO_NOISE_SUPPRESSION_MODES = new Set([
  'off',
  'standard',
  'suppressor',
  'rnnoise',
  'dtln',
]);

const normalizeAudioNoiseSuppressionMode = (mode) => {
  if (typeof mode !== 'string') {
    return 'standard';
  }
  if (!AUDIO_NOISE_SUPPRESSION_MODES.has(mode)) {
    return 'standard';
  }
  return mode;
};

// composable 側の分岐を単純化するための固定返却 shape。
const createResult = (constraints) => ({
  constraints,
  originalTrack: null,
  processedTrack: null,
  denoisedTrack: null,
  processor: null,
  audioStream: null,
  cleanup: () => {},
  isActive: false
});

// web-noise-suppressor に必要な Web Audio / getUserMedia の対応可否を判定する。
const isWebNoiseSuppressorSupported = () => {
  const AudioContextCtor =
    (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
    || null;

  return !!(
    AudioContextCtor
    && typeof AudioWorkletNode !== 'undefined'
    && typeof navigator !== 'undefined'
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
  );
};

export async function setupRnnoise(audioDeviceId, options = {}) {
  const { onVad = () => {}, mode, enabled } = options;
  void onVad;
  const resolvedMode = normalizeAudioNoiseSuppressionMode(
    mode ?? (enabled ? 'suppressor' : 'standard')
  );
  // mode ごとの処理経路判定。worklet 経路のときだけ processedTrack を生成する。
  const useSuppressorPath = resolvedMode === 'suppressor';
  const useRnnoisePath = resolvedMode === 'rnnoise';
  const useWorkletPath = useSuppressorPath || useRnnoisePath;

  const constraints = {
    audio: useWorkletPath
      ? createSuppressorAudioConstraints(audioDeviceId)
      : createStandardAudioConstraints(audioDeviceId),
  };
  const fallbackResult = createResult({
    audio: createStandardAudioConstraints(audioDeviceId),
  });

  if (!useWorkletPath) {
    return fallbackResult;
  }

  if (!isWebNoiseSuppressorSupported()) {
    console.warn(`[audio] ${resolvedMode} unsupported, fallback to browser-standard microphone path`);
    return fallbackResult;
  }

  let rawStream = null;
  let originalTrack = null;
  let audioContext = null;
  let sourceNode = null;
  let highPassNode = null;
  // speex / rnnoise の処理ノード参照。cleanup で disconnect/destroy を行う。
  let processorNode = null;
  let destinationNode = null;
  let processedTrack = null;
  let cleaned = false;

  // suppressor 初期化中に生成したリソースを二重解放なしで安全に回収する。
  const releaseCreatedResources = async () => {
    if (cleaned) return;
    cleaned = true;

    try {
      sourceNode?.disconnect?.();
    } catch {}

    try {
      highPassNode?.disconnect?.();
    } catch {}

    try {
      processorNode?.disconnect?.();
    } catch {}

    try {
      destinationNode?.disconnect?.();
    } catch {}

    try {
      processorNode?.destroy?.();
    } catch {}

    try {
      processedTrack?.stop?.();
    } catch {}

    try {
      rawStream?.getTracks?.().forEach((track) => track.stop());
    } catch {}

    try {
      await audioContext?.close?.();
    } catch {}
  };

  try {
    rawStream = await navigator.mediaDevices.getUserMedia(constraints);
    originalTrack = rawStream.getAudioTracks()[0] || null;

    if (!originalTrack) {
      await releaseCreatedResources();
      return fallbackResult;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextCtor({ latencyHint: 'interactive' });

    sourceNode = audioContext.createMediaStreamSource(rawStream);
    destinationNode = audioContext.createMediaStreamDestination();

    if (useSuppressorPath) {
      const speexWasmBinary = await loadSpeex({ url: speexWasmPath });
      await audioContext.audioWorklet.addModule(speexWorkletPath);

      highPassNode = audioContext.createBiquadFilter();
      highPassNode.type = SUPPRESSOR_HIGHPASS_TYPE;
      highPassNode.frequency.value = SUPPRESSOR_HIGHPASS_FREQUENCY_HZ;
      highPassNode.Q.value = SUPPRESSOR_HIGHPASS_Q;
      processorNode = new SpeexWorkletNode(audioContext, {
        maxChannels: SUPPRESSOR_MAX_CHANNELS,
        wasmBinary: speexWasmBinary,
      });

      sourceNode.connect(highPassNode);
      highPassNode.connect(processorNode);
    } else if (useRnnoisePath) {
      const rnnoiseWasmBinary = await loadRnnoise({
        url: rnnoiseWasmPath,
        simdUrl: rnnoiseSimdWasmPath,
      });
      await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);

      processorNode = new RnnoiseWorkletNode(audioContext, {
        maxChannels: RNNOISE_MAX_CHANNELS,
        wasmBinary: rnnoiseWasmBinary,
      });

      sourceNode.connect(processorNode);
    } else {
      await releaseCreatedResources();
      return fallbackResult;
    }

    processorNode.connect(destinationNode);

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // publish へ渡す音声トラック。取得できない場合は標準マイク経路へ戻す。
    processedTrack = destinationNode.stream.getAudioTracks()[0] || null;
    if (!processedTrack || processedTrack.readyState === 'ended') {
      await releaseCreatedResources();
      return fallbackResult;
    }

    // cleanup 実行済みかどうかを呼び出し側が参照できる状態フラグ。
    let active = true;
    const cleanup = async () => {
      if (!active) return;
      active = false;
      await releaseCreatedResources();
    };

    return {
      constraints,
      originalTrack,
      processedTrack,
      denoisedTrack: processedTrack,
      processor: processorNode,
      audioStream: new LocalAudioStream(processedTrack, {
        stopTrackWhenDisabled: false,
      }),
      cleanup,
      get isActive() {
        return active;
      }
    };
  } catch (error) {
    console.warn(`[audio] ${resolvedMode} init failed. fallback to browser-standard microphone path:`, error);
    await releaseCreatedResources();
    return fallbackResult;
  }
}
