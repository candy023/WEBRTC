// RnnoiseService.js
// 責務:
// ・選択中のマイクから元の audio track を取得する
// ・DataDog/dtln-rs の AudioWorklet で処理済み track を生成する
// ・publish 側で使うための fallback 情報と cleanup を返す
// ※ファイル名は既存 import 互換のため維持する

const DTLN_WORKLET_MODULE_PATH = '/dtln-worklet.js';
const DTLN_SAMPLE_RATE = 16000;
const DTLN_READY_TIMEOUT_MS = 5000;
const DTLN_OUTPUT_GAIN = 6.0;

const createDtlnAudioConstraints = (audioDeviceId) => ({
	noiseSuppression: false,
	echoCancellation: false,
	autoGainControl: false,
	channelCount: 1,
	sampleRate: DTLN_SAMPLE_RATE,
	...(audioDeviceId ? { deviceId: audioDeviceId } : {})
});

const createNoneAudioConstraints = (audioDeviceId) => ({
	noiseSuppression: true,
	echoCancellation: true,
	autoGainControl: true,
	...(audioDeviceId ? { deviceId: audioDeviceId } : {})
});

const createFallbackResult = (constraints) => ({
	constraints,
	originalTrack: null,
	processedTrack: null,
	denoisedTrack: null,
	processor: null,
	cleanup: () => {},
	isActive: false
});

const isDtlnAudioWorkletSupported = () => {
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

const waitForDtlnReady = (workletNode, timeoutMs = DTLN_READY_TIMEOUT_MS) => (
	new Promise((resolve) => {
		let finished = false;
		let timer = null;

		const cleanup = () => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}

			try {
				if (typeof workletNode?.port?.removeEventListener === 'function') {
					workletNode.port.removeEventListener('message', onMessage);
				}
			} catch {}

			try {
				if (workletNode?.port) {
					workletNode.port.onmessage = null;
				}
			} catch {}
		};

		const finish = (ready) => {
			if (finished) return;
			finished = true;
			cleanup();
			resolve(ready);
		};

		const onMessage = (event) => {
			const data = event?.data;
			if (data === 'ready') {
				finish(true);
				return;
			}
			if (data?.type === 'error') {
				finish(false);
			}
		};

		timer = setTimeout(() => {
			finish(false);
		}, timeoutMs);

		try {
			if (typeof workletNode?.port?.addEventListener === 'function') {
				workletNode.port.addEventListener('message', onMessage);
				workletNode.port.start?.();
			} else if (workletNode?.port) {
				workletNode.port.onmessage = onMessage;
			}
		} catch {
			finish(false);
			return;
		}

		try {
			workletNode?.port?.postMessage?.({ type: 'ping-ready' });
		} catch {}
	})
);

/**
 * ノイズ抑制を初期化し、処理済み track と fallback 用 constraints を返す。
 *
 * @param {string} audioDeviceId マイク deviceId。空の場合はブラウザ既定入力を使う。
 * @param {{ onVad?: (vadLevel: number) => void }} [options]
 *   将来互換のため受け取るオプション。現実装では VAD 通知は行わない。
 * @returns {Promise<{
 *   constraints: { audio: MediaTrackConstraints },
 *   originalTrack: MediaStreamTrack | null,
 *   processedTrack: MediaStreamTrack | null,
 *   denoisedTrack: MediaStreamTrack | null,
 *   processor: AudioWorkletNode | null,
 *   audioContext?: AudioContext | null,
 *   cleanup: () => void,
 *   isActive: boolean,
 * }>}
 * @throws {never}
 * @sideeffects マイクストリーム取得、AudioWorklet の初期化、処理済み track 生成を行う。
 */
export async function setupRnnoise(audioDeviceId, options = {}) {
	// 既存 API 互換のため受け取る。現実装では未使用。
	const { onVad = () => {} } = options;
	void onVad;

	const dtlnAudioConstraints = createDtlnAudioConstraints(audioDeviceId);
	const noneAudioConstraints = createNoneAudioConstraints(audioDeviceId);

	const constraints = { audio: dtlnAudioConstraints };
	const fallbackResult = createFallbackResult({ audio: noneAudioConstraints });

	// cleanup と catch で安全に止めるため、生成した資源を外側で保持する。
	let rawStream = null;
	let originalTrack = null;
	let processedTrack = null;
	let audioContext = null;
	let sourceNode = null;
	let workletNode = null;
	let gainNode = null;
	let destinationNode = null;

	const releaseCreatedResources = () => {
		try {
			workletNode?.port?.postMessage?.({ type: 'shutdown' });
		} catch {}

		try {
			sourceNode?.disconnect?.();
		} catch {}

		try {
			workletNode?.disconnect?.();
		} catch {}

		try {
			gainNode?.disconnect?.();
		} catch {}

		try {
			destinationNode?.disconnect?.();
		} catch {}

		try {
			processedTrack?.stop?.();
		} catch {}

		try {
			rawStream?.getTracks?.().forEach((track) => track.stop());
		} catch {}

		try {
			audioContext?.close?.();
		} catch {}
	};

	try {
		if (!isDtlnAudioWorkletSupported()) {
			console.warn('[dtln-audio] setupRnnoise: AudioWorklet unsupported, fallback to microphone path');
			return fallbackResult;
		}

		rawStream = await navigator.mediaDevices.getUserMedia(constraints);
		originalTrack = rawStream.getAudioTracks()[0] || null;

		if (!originalTrack) {
			console.warn('[dtln-audio] setupRnnoise: getUserMedia succeeded but originalTrack is missing, fallback to microphone path');
			releaseCreatedResources();
			return fallbackResult;
		}

		const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
		audioContext = new AudioContextCtor({
			sampleRate: DTLN_SAMPLE_RATE,
			latencyHint: 'interactive'
		});

		try {
			await audioContext.audioWorklet.addModule(DTLN_WORKLET_MODULE_PATH);
		} catch (error) {
			console.warn('[dtln-audio] setupRnnoise: addModule failed, fallback to microphone path', error);
			releaseCreatedResources();
			return fallbackResult;
		}

		workletNode = new AudioWorkletNode(audioContext, 'NoiseSuppressionWorker', {
			channelCount: 1,
			channelCountMode: 'explicit',
			channelInterpretation: 'speakers',
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [1],
			processorOptions: {
				disableMetrics: true
			}
		});

		sourceNode = audioContext.createMediaStreamSource(rawStream);
		gainNode = audioContext.createGain();
		gainNode.gain.value = DTLN_OUTPUT_GAIN;
		destinationNode = audioContext.createMediaStreamDestination();

		sourceNode.connect(workletNode);
		workletNode.connect(gainNode);
		gainNode.connect(destinationNode);

		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}

		const isReady = await waitForDtlnReady(workletNode, DTLN_READY_TIMEOUT_MS);
		if (!isReady) {
			console.warn('[dtln-audio] setupRnnoise: waitForDtlnReady returned false (timeout or not ready), fallback to microphone path');
			releaseCreatedResources();
			return fallbackResult;
		}

		processedTrack = destinationNode.stream.getAudioTracks()[0] || null;
		if (!processedTrack || processedTrack.readyState === 'ended') {
			console.warn('[dtln-audio] setupRnnoise: processedTrack missing or ended, fallback to microphone path', {
				hasProcessedTrack: !!processedTrack,
				readyState: processedTrack?.readyState || 'missing',
			});
			releaseCreatedResources();
			return fallbackResult;
		}
		console.info('[dtln-audio] setupRnnoise: processedTrack ready, using dtln path');

		let active = !!processedTrack;
		let cleaned = false;

		const cleanup = () => {
			if (cleaned) return;
			cleaned = true;

			releaseCreatedResources();
			active = false;
		};

		return {
			constraints,
			originalTrack,
			processedTrack: processedTrack || null,
			// 既存の denoisedTrack 参照が残っていても壊れないように互換キーを残す。
			denoisedTrack: processedTrack || null,
			processor: workletNode || null,
			audioContext: audioContext || null,
			cleanup,
			get isActive() {
				return active;
			}
		};

	} catch (e) {
		console.warn('DTLN 初期化失敗:', e);
		releaseCreatedResources();

		return fallbackResult;
	}
}
