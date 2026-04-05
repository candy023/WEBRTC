import { SkyWayStreamFactory } from '@skyway-sdk/room';

/**
 * この service は、SkyWay SDK 経由で利用可能な入出力デバイス一覧を取得し、
 * UI 初期表示に使う既定のデバイス選択値を組み立てる責務を持つ。
 *
 * ローカル state は持たず、取得結果の整形だけを行う。
 */

/**
 * カメラ・マイク・スピーカーの各デバイス一覧をまとめて取得する。
 * 呼び出し側は、この結果をそのまま選択 UI の候補に使う。
 *
 * @returns {Promise<{
 *   videoInputDevices: any[],
 *   audioInputDevices: any[],
 *   audioOutputDevices: any[],
 * }>}
 * @throws {never}
 * @sideeffects SkyWay SDK のデバイス列挙 API を呼び出す。
 */
export async function enumerateDevices() {
  const videoInputDevices = await SkyWayStreamFactory.enumerateInputVideoDevices();
  const audioInputDevices = await SkyWayStreamFactory.enumerateInputAudioDevices();
  const audioOutputDevices = await SkyWayStreamFactory.enumerateOutputAudioDevices();

  return { videoInputDevices, audioInputDevices, audioOutputDevices };
}

/**
 * 取得済みのデバイス一覧から、各種別の先頭要素を既定選択として返す。
 * デバイスが存在しない場合は空文字を返し、呼び出し側で未選択として扱えるようにする。
 *
 * @param {object} params
 * @param {any[]} params.videoInputDevices カメラ候補一覧。
 * @param {any[]} params.audioInputDevices マイク候補一覧。
 * @param {any[]} params.audioOutputDevices スピーカー候補一覧。
 * @returns {{
 *   selectedVideoInputId: string,
 *   selectedAudioInputId: string,
 *   selectedAudioOutputId: string,
 * }}
 * @throws {never}
 */
export function getDefaultSelections({ videoInputDevices, audioInputDevices, audioOutputDevices }) {
  // 参加前に使う既定のカメラ deviceId。候補なしなら未選択として空文字を返す。
  const selectedVideoInputId = videoInputDevices[0]?.deviceId || '';
  // 参加前に使う既定のマイク deviceId。候補なしなら未選択として空文字を返す。
  const selectedAudioInputId = audioInputDevices[0]?.deviceId || '';
  // remote audio の既定出力先 deviceId。候補なしなら未選択として空文字を返す。
  const selectedAudioOutputId = audioOutputDevices[0]?.deviceId || '';

  return { selectedVideoInputId, selectedAudioInputId, selectedAudioOutputId };
}
