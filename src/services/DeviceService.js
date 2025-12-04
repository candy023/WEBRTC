// DeviceService.js
// メディアデバイス（カメラ・マイク・スピーカー）の
// 一覧取得とデフォルト選択状態の決定を担当するサービス。
// UI 側でデバイス選択 UI を構築するための土台となる。
import { SkyWayStreamFactory } from '@skyway-sdk/room';

/**
 * 利用可能なメディアデバイス一覧を取得する
 *
 * 目的:
 *  - ユーザーに選択肢として提示するカメラ / マイク / スピーカーの一覧を取得する
 *
 * Note:
 *  ブラウザ仕様により、デバイスの「ラベル名」を正しく取得するには
 *  事前にユーザーのメディア利用許可が必要となる。
 *  そのため、ここでは一度だけ仮のメディアストリームを取得して
 *  即座に解放することで、以降の enumerate 系 API で
 *  正しいデバイス情報が取得できる状態を作っている。
 */
export async function enumerateDevices() {
	// デバイスのラベル取得を有効化するための一時的なストリーム生成
	const temp = await SkyWayStreamFactory.createMicrophoneAudioAndCameraStream();

	// 権限取得が完了したら、実体のストリームは不要なので即解放する
	temp.audio?.release();
	temp.video?.release();

	// ユーザーが選択可能な「カメラ入力デバイス」の一覧を取得する
	const videoInputDevices = await SkyWayStreamFactory.enumerateInputVideoDevices();

	// ユーザーが選択可能な「マイク入力デバイス」の一覧を取得する
	const audioInputDevices = await SkyWayStreamFactory.enumerateInputAudioDevices();

	// ユーザーが選択可能な「音声出力先（スピーカー）」の一覧を取得する
	const audioOutputDevices = await SkyWayStreamFactory.enumerateOutputAudioDevices();

	// UI 側でそのまま扱いやすい形でまとめて返却する
	return { videoInputDevices, audioInputDevices, audioOutputDevices };
}

/**
 * デバイス一覧の先頭要素を「初期選択値」として返す
 *
 * 目的:
 *  - デバイス未選択状態を防ぎ、画面表示直後から最低限の入出力が成立する状態を作る
 *
 * Note:
 *  - 対象デバイスが存在しない場合は空文字を返し、UI 側で「未選択状態」として扱えるようにしている
 */
export function getDefaultSelections({ videoInputDevices, audioInputDevices, audioOutputDevices }) {
	// 最初のカメラデバイスをデフォルト選択とする
	const selectedVideoInputId = videoInputDevices[0]?.deviceId || '';

	// 最初のマイクデバイスをデフォルト選択とする
	const selectedAudioInputId = audioInputDevices[0]?.deviceId || '';

	// 最初のスピーカーデバイスをデフォルト選択とする
	const selectedAudioOutputId = audioOutputDevices[0]?.deviceId || '';

	// UI 側がそのままバインドできる形で返却する
	return { selectedVideoInputId, selectedAudioInputId, selectedAudioOutputId };
}

