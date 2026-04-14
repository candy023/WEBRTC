// RnnoiseService.js
// 責務:
// ・選択中のマイクから元の audio track を取得する
// ・@shiguredo/noise-suppression で処理済み track を生成する
// ・publish 側で使うための fallback 情報と cleanup を返す
// ※ファイル名は既存 import 互換のため維持する

import { NoiseSuppressionProcessor } from '@shiguredo/noise-suppression';

/**
 * 公式 dist 配布物の取得先。
 * まずは最小差分を優先し、CDN 版を使う。
 */
const NOISE_SUPPRESSION_ASSETS_PATH =
	'https://cdn.jsdelivr.net/npm/@shiguredo/noise-suppression@latest/dist';

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
 *   processor: NoiseSuppressionProcessor | null,
 *   cleanup: () => void,
 *   isActive: boolean,
 * }>}
 * @throws {never}
 * @sideeffects マイクストリーム取得、NoiseSuppressionProcessor の初期化、処理済み track 生成を行う。
 */
export async function setupRnnoise(audioDeviceId, options = {}) {
	// 既存 API 互換のため受け取る。現実装では未使用。
	const { onVad = () => {} } = options;
	void onVad;

	// ノイズ抑制処理との二重適用を避けるため、browser 標準の noiseSuppression は無効化する。
	// echoCancellation と autoGainControl は通話用途として維持する。
	const audioConstraints = {
		noiseSuppression: false,
		echoCancellation: true,
		autoGainControl: true,
		...(audioDeviceId ? { deviceId: audioDeviceId } : {})
	};

	// ノイズ抑制が使えない場合でも、呼び出し側が通常マイク publish へ戻れるように返す。
	const constraints = { audio: audioConstraints };
	const fallbackResult = {
		constraints,
		originalTrack: null,
		processedTrack: null,
		denoisedTrack: null,
		processor: null,
		cleanup: () => {},
		isActive: false
	};

	// cleanup と catch で安全に止めるため、生成した資源を外側で保持する。
	let rawStream = null;
	let originalTrack = null;
	let processedTrack = null;
	let processor = null;

	try {
		if (
			typeof NoiseSuppressionProcessor?.isSupported === 'function'
			&& !NoiseSuppressionProcessor.isSupported()
		) {
			return fallbackResult;
		}

		rawStream = await navigator.mediaDevices.getUserMedia(constraints);
		originalTrack = rawStream.getAudioTracks()[0] || null;

		if (!originalTrack) {
			try {
				rawStream.getTracks().forEach((track) => track.stop());
			} catch {}
			return fallbackResult;
		}

		processor = new NoiseSuppressionProcessor(NOISE_SUPPRESSION_ASSETS_PATH);
		processedTrack = await processor.startProcessing(originalTrack);

		let active = !!processedTrack;
		let cleaned = false;

		const cleanup = () => {
			if (cleaned) return;
			cleaned = true;

			try {
				processor?.stopProcessing?.();
			} catch {}

			try {
				processedTrack?.stop?.();
			} catch {}

			try {
				rawStream?.getTracks?.().forEach((track) => track.stop());
			} catch {}

			active = false;
		};

		return {
			constraints,
			originalTrack,
			processedTrack: processedTrack || null,
			// 既存の denoisedTrack 参照が残っていても壊れないように互換キーを残す。
			denoisedTrack: processedTrack || null,
			processor,
			cleanup,
			get isActive() {
				return active;
			}
		};

	} catch (e) {
		console.warn('RNNoise 初期化失敗:', e);

		try {
			processor?.stopProcessing?.();
		} catch {}

		try {
			processedTrack?.stop?.();
		} catch {}

		try {
			rawStream?.getTracks?.().forEach((track) => track.stop());
		} catch {}

		return fallbackResult;
	}
}