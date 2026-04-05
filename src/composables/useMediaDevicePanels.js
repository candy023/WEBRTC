import { ref } from 'vue';
import { enumerateDevices, getDefaultSelections } from '../services/DeviceService.js';

/**
 * device panel / selection に閉じた state と操作を管理する composable。
 *
 * ルーム接続や remote 制御には踏み込まず、device 一覧・panel 表示・一時選択・確定値だけを管理する。
 * UI からはこの composable の公開 state/handler を通してのみ device panel を操作する。
 *
 * @param {object} params composable 生成に必要な依存。
 * @param {import('vue').Ref<boolean>} params.isScreenSharing 画面共有中かどうか。カメラ確定時に self preview を更新すべきかの判定に使う。
 * @param {() => Promise<void>} params.startLocalSelfCameraPreview 画面共有中にカメラ選択を確定したときだけ、自分カメラ preview を更新する callback。
 * @param {(deviceId: string) => Promise<void>} params.onSpeakerSelectionConfirmed スピーカー選択確定後に、既存 remote audio へ出力先を再適用する callback。
 * @returns {{
 *   videoInputDevices: import('vue').Ref<any[]>,
 *   audioInputDevices: import('vue').Ref<any[]>,
 *   audioOutputDevices: import('vue').Ref<any[]>,
 *   selectedVideoInputId: import('vue').Ref<string>,
 *   selectedAudioInputId: import('vue').Ref<string>,
 *   selectedAudioOutputId: import('vue').Ref<string>,
 *   showCameraPanel: import('vue').Ref<boolean>,
 *   showMicPanel: import('vue').Ref<boolean>,
 *   showSpeakerPanel: import('vue').Ref<boolean>,
 *   tempSelectedVideoInputId: import('vue').Ref<string>,
 *   tempSelectedAudioInputId: import('vue').Ref<string>,
 *   tempSelectedAudioOutputId: import('vue').Ref<string>,
 *   initializeMediaDevices: () => Promise<void>,
 *   openCameraPanel: () => void,
 *   cancelCameraPanel: () => void,
 *   confirmCameraPanel: () => Promise<void>,
 *   openMicPanel: () => void,
 *   cancelMicPanel: () => void,
 *   confirmMicPanel: () => Promise<void>,
 *   openSpeakerPanel: () => void,
 *   cancelSpeakerPanel: () => void,
 *   confirmSpeakerPanel: () => Promise<void>,
 * }}
 * @throws {never}
 * @sideeffects DeviceService からの一覧取得、panel state の更新、選択確定値の更新、speaker 確定 callback の呼び出しを行う。
 * @note speaker 反映の実処理は orchestrator 側へ残し、この composable は device panel 境界だけを担当する。
 */
export function useMediaDevicePanels({
  isScreenSharing,
  startLocalSelfCameraPreview,
  onSpeakerSelectionConfirmed,
}) {
  // 利用可能なカメラ一覧。設定 panel の候補表示と初期選択決定に使う。
  const videoInputDevices = ref([]);
  // 利用可能なマイク一覧。join 時の入力制約と設定 panel の候補表示に使う。
  const audioInputDevices = ref([]);
  // 利用可能なスピーカー一覧。speaker panel の候補表示と出力先再適用に使う。
  const audioOutputDevices = ref([]);

  // join 時のカメラ入力制約と panel 再オープン時の初期値に使う、現在確定済みの camera deviceId。
  const selectedVideoInputId = ref('');
  // join 時の音声入力制約と panel 再オープン時の初期値に使う、現在確定済みの microphone deviceId。
  const selectedAudioInputId = ref('');
  // remote audio の再出力先として使う、現在確定済みの speaker deviceId。
  const selectedAudioOutputId = ref('');

  // カメラ panel が表示中かどうか。UI 側はこの ref を見て panel 表示を切り替える。
  const showCameraPanel = ref(false);
  // マイク panel が表示中かどうか。UI 側はこの ref を見て panel 表示を切り替える。
  const showMicPanel = ref(false);
  // スピーカー panel が表示中かどうか。UI 側はこの ref を見て panel 表示を切り替える。
  const showSpeakerPanel = ref(false);

  // カメラ panel 内の仮選択。confirm までは join に使う確定値を汚さないために分けて持つ。
  const tempSelectedVideoInputId = ref('');
  // マイク panel 内の仮選択。cancel 時に入力制約の確定値を維持するために使う。
  const tempSelectedAudioInputId = ref('');
  // スピーカー panel 内の仮選択。confirm 後にだけ remote audio の出力先再適用へ渡す。
  const tempSelectedAudioOutputId = ref('');

  // DeviceService から一覧を取得し、panel 初期表示と join 前の既定選択を同時に初期化する。
  const initializeMediaDevices = async () => {
    const devices = await enumerateDevices();

    videoInputDevices.value = devices.videoInputDevices;
    audioInputDevices.value = devices.audioInputDevices;
    audioOutputDevices.value = devices.audioOutputDevices;

    const defaultSelections = getDefaultSelections(devices);
    selectedVideoInputId.value = defaultSelections.selectedVideoInputId;
    selectedAudioInputId.value = defaultSelections.selectedAudioInputId;
    selectedAudioOutputId.value = defaultSelections.selectedAudioOutputId;
  };

  // カメラ panel を開き、現在の確定 camera deviceId を仮選択へコピーして編集開始点を揃える。
  const openCameraPanel = () => {
    showCameraPanel.value = true;
    tempSelectedVideoInputId.value = selectedVideoInputId.value;
  };

  // カメラ panel を閉じ、確定済み camera deviceId は維持したまま仮選択の編集を中断する。
  const cancelCameraPanel = () => { showCameraPanel.value = false; };

  // カメラ確定値を更新し、画面共有中だけ self preview を新しい deviceId へ合わせ直す。
  const confirmCameraPanel = async () => {
    selectedVideoInputId.value = tempSelectedVideoInputId.value;
    showCameraPanel.value = false;

    if (!isScreenSharing.value) return;
    await startLocalSelfCameraPreview();
  };

  // マイク panel を開き、現在の確定 microphone deviceId を仮選択へコピーして編集開始点を揃える。
  const openMicPanel = () => {
    showMicPanel.value = true;
    tempSelectedAudioInputId.value = selectedAudioInputId.value;
  };

  // マイク panel を閉じ、確定済み microphone deviceId は維持したまま仮選択の編集を中断する。
  const cancelMicPanel = () => { showMicPanel.value = false; };

  // マイク確定値を更新し、次回 join や再 publish 時に使う入力 deviceId を差し替える。
  const confirmMicPanel = async () => {
    selectedAudioInputId.value = tempSelectedAudioInputId.value;
    showMicPanel.value = false;
  };

  // スピーカー panel を開き、現在の確定 speaker deviceId を仮選択へコピーして編集開始点を揃える。
  const openSpeakerPanel = () => {
    showSpeakerPanel.value = true;
    tempSelectedAudioOutputId.value = selectedAudioOutputId.value;
  };

  // スピーカー panel を閉じ、確定済み speaker deviceId は維持したまま仮選択の編集を中断する。
  const cancelSpeakerPanel = () => { showSpeakerPanel.value = false; };

  // スピーカー確定値を更新し、既存 remote audio の出力先再適用を orchestrator 側へ委譲する。
  const confirmSpeakerPanel = async () => {
    selectedAudioOutputId.value = tempSelectedAudioOutputId.value;
    showSpeakerPanel.value = false;
    await onSpeakerSelectionConfirmed(selectedAudioOutputId.value);
  };

  return {
    videoInputDevices,
    audioInputDevices,
    audioOutputDevices,
    selectedVideoInputId,
    selectedAudioInputId,
    selectedAudioOutputId,
    showCameraPanel,
    showMicPanel,
    showSpeakerPanel,
    tempSelectedVideoInputId,
    tempSelectedAudioInputId,
    tempSelectedAudioOutputId,
    initializeMediaDevices,
    openCameraPanel,
    cancelCameraPanel,
    confirmCameraPanel,
    openMicPanel,
    cancelMicPanel,
    confirmMicPanel,
    openSpeakerPanel,
    cancelSpeakerPanel,
    confirmSpeakerPanel,
  };
}
