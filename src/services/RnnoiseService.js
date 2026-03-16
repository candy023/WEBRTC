// RnnoiseService.js
// 責務:
// ・RNNoise の AudioWorklet 登録
// ・VAD（音声活動検出）の受信
// ・getUserMedia 用 constraints の生成
// ※「SkyWay に流す denoise 差し替え」はこのファイルでは行わない

import { Rnnoise } from '@shiguredo/rnnoise-wasm';

export async function setupRnnoise(audioDeviceId) {

	// ============================
	// ① フォールバック用の標準オーディオ設定
	// ============================
	const audioConstraints = {
		noiseSuppression: true,   // ブラウザ標準のノイズ抑制
		echoCancellation: true,  // エコーキャンセル
		autoGainControl: true,   // 自動音量調整

		// マイクデバイスIDが指定されている場合のみ追加
		...(audioDeviceId ? { deviceId: audioDeviceId } : {})
	};

	// getUserMedia に渡す最終 constraints
	const constraints = { audio: audioConstraints };

	try {
		// ② AudioContext を生成（音声処理用）
		const audioContext = new (window.AudioContext || window.webkitAudioContext)();

		// ③ AudioWorklet に RNNoise Processor を登録
		await audioContext.audioWorklet.addModule('/rnnoise-processor.js');


		// ④ RNNoise WASM ライブラリのロード
		// ※ denoise処理は行わないが、VAD通知に使用
		const rn = await Rnnoise.load();

		
		// ⑤ AudioWorkletNode を生成
		const rnnoiseNode = new AudioWorkletNode(audioContext, 'rnnoise-processor', {
			processorOptions: {
				// denoiseState は構造化クローンできないため渡さない
				frameSize: rn.frameSize, // RNNoise の推奨フレームサイズ
				vadInterval: 10,         // VAD 通知の間隔（10フレームごと）
			}
		});

		
		// ⑥ Worklet からのメッセージ受信（VADなど）
		rnnoiseNode.port.onmessage = (ev) => {
			// 呼び出し側で ev.data をそのまま扱えるようにする
			// （このファイルでは処理しない）
		};

	
		// ⑦ マイク入力ストリーム取得
		const rawStream = await navigator.mediaDevices.getUserMedia(constraints);

		// ⑧ WebAudio ノード接続構成
		// raw input → rnnoise → output
		const input = audioContext.createMediaStreamSource(rawStream);
		const output = audioContext.createMediaStreamDestination();

		input.connect(rnnoiseNode).connect(output);

		
		// ⑨ 出力ストリームから AudioTrack を取得
		
		const track = output.stream.getAudioTracks()[0] || null;

		
		// ⑩ クリーンアップ関数
		const cleanup = () => {
			try {
				input.disconnect();                // 入力ノード切断
				rnnoiseNode.disconnect();         // RNNoise ノード切断
				audioContext.close();             // AudioContext 停止
				rawStream.getTracks().forEach(t => t.stop()); // マイク停止
			} catch {}
		};

		// denoisedTrack は現状 null（SkyWay 側では通常マイクを使う想定）
		return {
			constraints,        // getUserMedia 用設定
			denoisedTrack: null, // 実際の音声差し替えは行っていない
			cleanup,            // 破棄用関数
			rnnoiseNode         // 外からVADなどを購読するため返却
		};

	} catch (e) {
		console.warn('RNNoise 初期化失敗:', e);

		// RNNoise が使えなくても通常マイクは使えるようにする
		return {
			constraints,
			denoisedTrack: null,
			cleanup: () => {}
		};
	}
}
