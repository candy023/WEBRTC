// MediaStreamService.js
// カメラ / マイク / 画面共有 / 背景ぼかし など、
// ローカルメディアストリームの生成・切り替え・管理を担当するサービス。
// UI や RoomService からは「どの映像・音声を使うか」だけを指定し、
// 実際のストリーム操作の詳細はこのファイルに集約する。

import { SkyWayStreamFactory } from '@skyway-sdk/room';
import { BlurBackground } from 'skyway-video-processors';

/**
 * 指定されたカメラデバイスを使ってカメラ映像ストリームを生成する
 *
 * opts:
 *  - { video: { deviceId } } などの MediaTrackConstraints
 *
 * 用途:
 *  - カメラ切り替え時
 *  - 背景ぼかし解除後の通常映像復帰時
 */
export async function createCameraStream(opts) {
	// 指定されたデバイス条件でカメラ映像ストリームを生成する
	return await SkyWayStreamFactory.createCameraVideoStream(opts);
}

/**
 * 指定されたマイクデバイスを使って音声ストリームを生成する
 *
 * opts:
 *  - { audio: { deviceId, ... } } などの MediaTrackConstraints
 *
 * 用途:
 *  - マイク切り替え時
 *  - 初期入室時の音声入力設定
 */
export async function createMicrophoneStream(opts) {
	// 指定された条件でマイク音声ストリームを生成する
	return await SkyWayStreamFactory.createMicrophoneAudioStream(opts);
}

/**
 * 画面共有用の映像ストリームを生成する
 *
 * 仕様:
 *  - 音声は扱わず、映像のみを取得する
 *  - displaySurface: 'monitor' により画面全体の共有を想定
 *
 * Returns:
 *  - video: 画面共有用の VideoStream
 */
export async function createDisplayStream() {
	// 画面共有用に displayStream を生成（音声は使用しない）
	const { video } = await SkyWayStreamFactory.createDisplayStreams({
		audio: false,
		video: { displaySurface: 'monitor' }
	});

	// 呼び出し元では映像ストリームのみ扱うため video だけ返却する
	return video;
}

/**
 * 背景ぼかしを有効化する処理
 * 処理の流れ:
 *  1. 既存の映像配信を停止（unpublish）
 *  2. 既存の映像ストリームを解放
 *  3. 背景ぼかしプロセッサを初期化
 *  4. プロセッサを通したカスタム映像ストリームを生成
 *  5. 新しい映像ストリームを publish し直す
 *  6. UI の video 要素へ再アタッチ
 */
export async function enableBackgroundBlur(state) {
	const {
		localMember,            // ローカル参加者（publish / unpublish の実行主体）
		localVideoPublication, // 現在 publish 中の映像 Publication
		localVideoStream,      // 現在使用中のローカル映像ストリーム
		localVideoEl           // 映像を表示している video DOM 要素
	} = state;

	// まだ入室・参加していない場合は何もしない
	if (!localMember.value) return;

	// 既存の映像が publish されていれば一度停止する
	if (localVideoPublication.value) {
		await localMember.value.unpublish(localVideoPublication.value);
	}

	// 既存の映像ストリームが存在すれば解放する
	if (localVideoStream.value) {
		localVideoStream.value.release?.();
	}

	// 背景ぼかし用のビデオプロセッサを生成
	const processor = new BlurBackground();

	// WebAssembly などの初期化処理を実行
	await processor.initialize();

	// 背景ぼかし処理を通したカスタム映像ストリームを生成
	const processedVideo =
		await SkyWayStreamFactory.createCustomVideoStream(
			processor,
			{ stopTrackWhenDisabled: true }
		);

	// 現在のローカル映像ストリーム参照を更新する
	localVideoStream.value = processedVideo;

	// 新しい映像ストリームを publish する
	const videoPub = await localMember.value.publish(processedVideo);
	localVideoPublication.value = videoPub;

	// 表示先の video 要素が存在すれば再アタッチする
	if (localVideoEl.value) {
		processedVideo.attach(localVideoEl.value);
	}

	// 呼び出し元で disable 時に破棄できるよう processor を返す
	return { processor };
}

/**
 * 背景ぼかしを無効化し、通常のカメラ映像へ戻す処理
 * processor:
 *  - enableBackgroundBlur で使用していた背景ぼかしプロセッサ
 * 処理の流れ:
 *  1. 背景ぼかし映像の配信停止（unpublish）
 *  2. 背景ぼかし用ストリームの解放
 *  3. 背景ぼかしプロセッサの破棄
 *  4. 通常のカメラ映像ストリームを再生成
 *  5. 新しい通常映像を publish し直す
 *  6. UI の video 要素へ再アタッチ
 */
export async function disableBackgroundBlur(state, processor) {
	// 現在のローカル映像・参加者状態を取得する
	const {
		localMember,            // ローカル参加者（publish / unpublish の実行主体）
		localVideoPublication, // 現在 publish 中の映像 Publication
		localVideoStream,      // 現在使用中のローカル映像ストリーム
		localVideoEl,          // 映像を表示している video DOM 要素
		selectedVideoInputId   // 復帰時に使用するカメラデバイス ID
	} = state;


	// まだ入室・参加していない場合は何もしない
	if (!localMember.value) return;

	// 背景ぼかし映像が publish されていれば停止する
	if (localVideoPublication.value) {
		await localMember.value.unpublish(localVideoPublication.value);
	}

	// 背景ぼかし映像ストリームが存在すれば解放する
	if (localVideoStream.value) {
		localVideoStream.value.release?.();
	}

	// 背景ぼかしプロセッサを安全に破棄する（未定義対策あり）
	try {
		await processor?.dispose?.();
	} catch {}

	// 選択中のカメラデバイスに復帰するための映像ストリームを生成
	const cameraStream =
		await SkyWayStreamFactory.createCameraVideoStream(
			selectedVideoInputId?.value
				? { video: { deviceId: selectedVideoInputId.value } }
				: undefined
		);

	// 通常のカメラ映像ストリームに参照を戻す
	localVideoStream.value = cameraStream;

	// 通常のカメラ映像を再度 publish する
	const videoPub = await localMember.value.publish(cameraStream);
	localVideoPublication.value = videoPub;

	// 表示先の video 要素が存在すれば再アタッチする
	if (localVideoEl.value) {
		cameraStream.attach(localVideoEl.value);
	}
}
