import { LocalAudioStream } from '@skyway-sdk/room';
import { SpeexWorkletNode, loadSpeex } from '@sapphi-red/web-noise-suppressor';
import speexWorkletPath from '@sapphi-red/web-noise-suppressor/speexWorklet.js?url';
import speexWasmPath from '@sapphi-red/web-noise-suppressor/speex.wasm?url';

// Speex suppressor はローカル音声 publish 経路を単一チャネルで処理する。
const SUPPRESSOR_MAX_CHANNELS = 1;

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
  const { onVad = () => {}, enabled = false } = options;
  void onVad;

  const constraints = {
    audio: enabled
      ? createSuppressorAudioConstraints(audioDeviceId)
      : createStandardAudioConstraints(audioDeviceId),
  };
  const fallbackResult = createResult({
    audio: createStandardAudioConstraints(audioDeviceId),
  });

  if (!enabled) {
    return fallbackResult;
  }

  if (!isWebNoiseSuppressorSupported()) {
    console.warn('[audio] web-noise-suppressor unsupported, fallback to browser-standard microphone path');
    return fallbackResult;
  }

  let rawStream = null;
  let originalTrack = null;
  let audioContext = null;
  let sourceNode = null;
  let suppressorNode = null;
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
      suppressorNode?.disconnect?.();
    } catch {}

    try {
      destinationNode?.disconnect?.();
    } catch {}

    try {
      suppressorNode?.destroy?.();
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

    const wasmBinary = await loadSpeex({ url: speexWasmPath });
    await audioContext.audioWorklet.addModule(speexWorkletPath);

    sourceNode = audioContext.createMediaStreamSource(rawStream);
    suppressorNode = new SpeexWorkletNode(audioContext, {
      maxChannels: SUPPRESSOR_MAX_CHANNELS,
      wasmBinary,
    });
    destinationNode = audioContext.createMediaStreamDestination();

    sourceNode.connect(suppressorNode);
    suppressorNode.connect(destinationNode);

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
      processor: suppressorNode,
      audioStream: new LocalAudioStream(processedTrack, {
        stopTrackWhenDisabled: false,
      }),
      cleanup,
      get isActive() {
        return active;
      }
    };
  } catch (error) {
    console.warn('[audio] web-noise-suppressor init failed. fallback to browser-standard microphone path:', error);
    await releaseCreatedResources();
    return fallbackResult;
  }
}
