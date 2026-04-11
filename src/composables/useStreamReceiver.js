// composables/useStreamReceiver.js
//
// WebRTC UI と各種サービス（SkyWay / Media / RNNoise / VideoUI）を橋渡しする Vue Composable。
// UI はこの composable が返す ref / 関数のみを利用し、SDK や DOM を直接操作しない設計とする。
//
// 主な責務:
// ・SkyWay ルームの作成・参加・退出
// ・ローカル / リモートの映像・音声ストリーム管理
// ・カメラ / マイク / スピーカーのデバイス管理
// ・背景ぼかし / RNNoise の ON・OFF 制御
// ・UI 状態（ミュート、拡大、設定パネルなど）の集中管理

import { ref, onMounted, onUnmounted } from 'vue';
import {
  setRemoteAudioOutput,
  enlargeVideo as uiEnlarge,
  shrinkVideo as uiShrink
} from '../services/VideoUIService.js';
import { getAuthSession, getProfileNickname } from '../services/SupabaseService.js';
import { useLocalMediaSession } from './useLocalMediaSession.js';
import { useLocalVideoTileSession } from './useLocalVideoTileSession.js';
import { useMediaDevicePanels } from './useMediaDevicePanels.js';
import { useRemotePublications } from './useRemotePublications.js';
import { useRoomSession } from './useRoomSession.js';
import { useSpeakingHighlightSession } from './useSpeakingHighlightSession.js';

/**
 * WebRTC 画面の state と service 呼び出し順序を管理する orchestrator composable。
 *
 * UI にはこの composable の公開 state/handler だけを渡し、SkyWay と各 service の呼び出し順序を一元管理する。
 *
 * @returns {object} UI から利用する state ref と操作関数の集合。
 * @throws {never}
 * @sideeffects SkyWay 接続、メディアデバイス利用、DOM 操作を行う。
 * @note late join や join/publish/subscribe/leave の順序保証を崩さないため、接続系の操作は本 composable 経由で扱う。
 */
export function useStreamReceiver() {

  // --- UI 側と直接バインドされる状態（状態管理の中核） ---
  const streamArea = ref(null);              // リモート映像タイルを挿入する DOM コンテナ
  const roomCreated = ref(false);            // ルーム作成済みかどうか
  const roomId = ref('');                    // ルーム識別子（URL・検索のキー）
  const joining = ref(false);                // join の多重実行防止フラグ
  const joined = ref(false);                 // 参加完了状態（UI 切替用）
  const localMember = ref(null);             // 自分自身の SkyWay Member
  const errorMessage = ref('');              // UI 表示用エラーメッセージ
  const localVideoEl = ref(null);            // ローカルプレビュー用 video 要素
  const localSelfCameraPreviewEl = ref(null); // 画面共有中の自分カメラプレビュー表示先 video 要素
  const leaving = ref(false);                // leave の多重実行防止フラグ
  const isAudioMuted = ref(false);           // マイクがミュート中か
  const isVideoMuted = ref(false);           // カメラがミュート中か
  const isScreenSharing = ref(false);        // 画面共有中かどうか
  const isBackgroundBlurred = ref(false);    // 背景ぼかしが有効かどうか
  const showShareOpen = ref(false);          // URL 共有パネルの表示状態
  const showSettingsOpen = ref(false);       // 設定パネルの表示状態
  const enlargedVideo = ref(null);           // 現在拡大表示されている video 要素
  const baseUrl = window.location.href.split('?')[0]; // 共有用のベース URL
  const isRnnoiseEnabled = ref(true);        // RNNoise を有効にするか（初期は ON）
  // room join 時に SkyWay member 名として使う表示名。`profiles.nickname` を正本として保持する。
  const memberDisplayName = ref('');

  // --- 内部制御用（UI には直接返さない） ---
  const localVideoPublication = ref(null);   // 自分の映像 Publication
  const localAudioPublication = ref(null);   // 自分の音声 Publication
  const localVideoStream = ref(null);        // ローカル映像ストリーム参照
  const localSelfCameraPreviewStream = ref(null); // プレビュー専用のローカルカメラ stream。切替時の解放に使う
  const context = { ctx: null, room: null }; // SkyWay Context と Room の保持

  const handleLocalTileEnlarge = (videoEl) => {
    try {
      uiEnlarge(videoEl);
      enlargedVideo.value = videoEl;
    } catch {}
  };

  // 各 sub composable からの失敗を UI 表示用 state に集約する callback。
  const setErrorMessage = (message) => {
    errorMessage.value = message;
  };

  const loadMemberDisplayName = async () => {
    try {
      const session = await getAuthSession();
      const currentUserId = session?.user?.id ?? '';
      if (!currentUserId) {
        memberDisplayName.value = '';
        return;
      }

      memberDisplayName.value = await getProfileNickname(currentUserId);
    } catch (error) {
      memberDisplayName.value = '';
      errorMessage.value = error?.message || String(error);
    }
  };

  // useMediaDevicePanels の speaker 確定時に呼ばれる bridge callback。既存 remote audio へ出力先を再適用する処理は streamArea を保持する orchestrator 側で実行する必要がある。
  const onSpeakerSelectionConfirmed = async (deviceId) => {
    try {
      await setRemoteAudioOutput(streamArea.value, deviceId);
    } catch (e) {
      errorMessage.value = e?.message || String(e);
    }
  };

  // useMediaDevicePanels の camera 確定時に使う bridge handler 参照。useLocalMediaSession 初期化前に受け渡しが必要なため、先に no-op で定義して後段で実体を差し込む。
  let startLocalSelfCameraPreviewHandler = async () => {};

  const {
    startSpeakingMonitor,
    stopSpeakingMonitor,
    updateVadLevel,
    cleanupSpeakingMonitors,
  } = useSpeakingHighlightSession({
    streamArea,
  });

  // 分離済みの device panel state と操作群。orchestrator 側の公開 API shape を維持したまま bridge 経由で受け取る。
  const {
    // 設定 UI で表示するカメラ候補一覧。パネル描画時に参照する。
    videoInputDevices,
    // 設定 UI で表示するマイク候補一覧。パネル描画時に参照する。
    audioInputDevices,
    // 設定 UI で表示するスピーカー候補一覧。パネル描画時に参照する。
    audioOutputDevices,
    // join 時のカメラ入力制約に使う確定済み camera deviceId。
    selectedVideoInputId,
    // join 時の音声入力制約に使う確定済み microphone deviceId。
    selectedAudioInputId,
    // remote audio 再出力先の指定に使う確定済み speaker deviceId。
    selectedAudioOutputId,
    // カメラ設定 panel の開閉 state。UI 表示制御に使う。
    showCameraPanel,
    // マイク設定 panel の開閉 state。UI 表示制御に使う。
    showMicPanel,
    // スピーカー設定 panel の開閉 state。UI 表示制御に使う。
    showSpeakerPanel,
    // カメラ panel 内の仮選択。confirm まで確定値を汚さないために使う。
    tempSelectedVideoInputId,
    // マイク panel 内の仮選択。confirm まで確定値を汚さないために使う。
    tempSelectedAudioInputId,
    // スピーカー panel 内の仮選択。confirm まで確定値を汚さないために使う。
    tempSelectedAudioOutputId,
    // 初回 mount 時に device 一覧と既定選択を初期化する handler。
    initializeMediaDevices,
    // カメラ panel を開く handler。UI 操作から直接呼ばれる。
    openCameraPanel,
    // カメラ panel を閉じる handler。確定値は維持したまま編集を中断する。
    cancelCameraPanel,
    // カメラ panel の仮選択を確定する handler。必要時は self preview 更新へ橋渡しする。
    confirmCameraPanel,
    // マイク panel を開く handler。UI 操作から直接呼ばれる。
    openMicPanel,
    // マイク panel を閉じる handler。確定値は維持したまま編集を中断する。
    cancelMicPanel,
    // マイク panel の仮選択を確定する handler。次回 join/publish 制約へ反映する。
    confirmMicPanel,
    // スピーカー panel を開く handler。UI 操作から直接呼ばれる。
    openSpeakerPanel,
    // スピーカー panel を閉じる handler。確定値は維持したまま編集を中断する。
    cancelSpeakerPanel,
    // スピーカー panel の仮選択を確定する handler。remote audio 出力先再適用を bridge callback へ委譲する。
    confirmSpeakerPanel,
  } = useMediaDevicePanels({
    // camera 確定時に self preview 更新要否を判定するため、画面共有 state を panel 側へ渡す。
    isScreenSharing,
    // useLocalMediaSession で確定する実体を遅延バインドし、screen share 中の camera 再選択で再利用する。
    startLocalSelfCameraPreview: () => startLocalSelfCameraPreviewHandler(),
    // speaker 確定時に remote audio の出力先再適用を orchestrator 側で実行する bridge callback。
    onSpeakerSelectionConfirmed,
  });

  // remote publication / remote tile 管理を担当する sub composable。orchestrator 側は高レベルフロー制御に専念する。
  const {
    // 生成済み remote 要素配列。leave 時の一括 cleanup と fallback 探索に使う。
    remoteVideos,
    // 共有画面タイル一覧。主表示選択と共有帯描画に使う。
    screenShareTiles,
    // 現在主表示中の共有 pubId。共有削除時のフォールバック判定に使う。
    selectedMainSharePubId,
    // 参加者カメラタイル一覧。フィルムストリップ描画と削除同期に使う。
    cameraFilmstripTiles,
    // 共有タイル一覧と主表示 pubId の整合を保つ handler。local tile 更新後にも使う。
    syncSelectedMainShareState,
    // pubId 指定で remote tile/DOM を除去する handler。unpublish と local unpublish cleanup で使う。
    removeTileByPubId,
    // publication が remote audio かを判定する handler。self publication 除外に使う。
    isRemoteAudioPublication,
    // publication state から remote audio mute badge を再同期する handler。enabled/disabled イベントで使う。
    syncRemoteAudioMuteBadge,
    // publication 削除時に remote audio mute badge を非表示へ戻す handler。
    hideRemoteAudioMuteBadge,
    // remote stream の attach/tile upsert/pubId 管理をまとめて行う handler。subscribeExisting と onStreamPublished から共通利用する。
    attachRemote,
    // publication 削除時に重複防止 tracking を解除する handler。
    removePublicationTracking,
    // join 前に remote 受信追跡と tile state を初期化する handler。
    resetRemotePublicationsForJoin,
    // leave 時に remote DOM と remote publication/tile state を完全初期化する handler。
    cleanupRemotePublicationsForLeave,
  } = useRemotePublications({
    // remote attach や mute badge 更新の対象になる表示先コンテナ。
    streamArea,
    // self publication 判定に使う local member 参照。
    localMember,
    // remote audio attach 時に使う現在の speaker deviceId。
    selectedAudioOutputId,
    // mute badge 再同期時に publication 一覧を参照するための room getter。
    getCurrentRoom: () => context.room,
    // remote audio attach 完了時に memberId ごとの話者監視を開始する callback。
    onRemoteAudioAttached: startSpeakingMonitor,
    // remote audio publication 削除時に memberId ごとの話者監視を停止する callback。
    onRemoteAudioPublicationRemoved: stopSpeakingMonitor,
  });

  // local tile / blur / metadata glue を担当する sub composable。orchestrator 側は room lifecycle と UI 公開 API shape の維持に専念する。
  const {
    // local tile と local stream 解放を publish 状態へ同期する handler。
    syncLocalVideoTile,
    // local video publication の metadata を更新する handler。
    updateLocalVideoPublicationMetadata,
    // leave や差し替え時にローカル映像 stream を解放する handler。
    releaseLocalVideoStream,
    // background blur の processor 参照を取得する accessor。
    getBlurProcessor,
    // background blur の processor 参照を更新する accessor。
    setBlurProcessor,
    // local tile の DOM 参照を取得する accessor。
    getLocalTileElements,
    // local tile の DOM 参照を更新する accessor。
    setLocalTileElements,
  } = useLocalVideoTileSession({
    // local tile の memberId/pubId を同期するための local member 参照。
    localMember,
    // metadata 更新と local tile 種別判定に使う local video publication 参照。
    localVideoPublication,
    // leave・差し替え時の release 対象になる local video stream 参照。
    localVideoStream,
    // 共有画面帯の local tile を更新する配列参照。
    screenShareTiles,
    // 参加者カメラ帯の local tile を更新する配列参照。
    cameraFilmstripTiles,
    // local tile 更新後に主表示共有 pubId を整合させる callback。
    syncSelectedMainShareState,
    // local tile の拡大操作を UI 状態に橋渡しする callback。
    onLocalTileEnlarge: handleLocalTileEnlarge,
  });

  // ローカルメディア操作（画面共有/背景ぼかし/ローカルプレビュー）の委譲先。
  const localMediaSessionHandlers = useLocalMediaSession({
    joined,
    localMember,
    localVideoPublication,
    localVideoStream,
    localVideoEl,
    localSelfCameraPreviewStream,
    localSelfCameraPreviewEl,
    selectedVideoInputId,
    isScreenSharing,
    isBackgroundBlurred,
    isVideoMuted,
    setErrorMessage,
    removeTileByPubId,
    syncLocalVideoTile,
    updateLocalVideoPublicationMetadata,
    releaseLocalVideoStream,
    getBlurProcessor,
    setBlurProcessor,
    getLocalTileElements,
    setLocalTileElements,
    onLocalTileEnlarge: handleLocalTileEnlarge,
  });

  const {
    attachLocalPreview,
    stopLocalSelfCameraPreview,
    startLocalSelfCameraPreview,
  } = localMediaSessionHandlers;
  // panel 側へ渡した bridge handler 参照へ実体を接続し、camera 再選択時に local self preview 更新を呼べるようにする。
  startLocalSelfCameraPreviewHandler = startLocalSelfCameraPreview;

  // room lifecycle と room event bind/unbind を担当する sub composable。orchestrator 側は local/remote glue の責務を維持しつつ callback 注入で利用する。
  const {
    // room 作成と URL 共有の起点確定を行う handler。
    createRoom,
    // room 参加、publish、subscribeExisting、event bind を順序どおりに実行する handler。
    joinRoom,
    // room 退出、event unbind、join 関連 state cleanup を行う handler。
    leaveRoom,
  } = useRoomSession({
    // room 識別子。createRoom 時の room 生成キーに使う。
    roomId,
    // room 作成済み state。join 前の createRoom 要否判定に使う。
    roomCreated,
    // join 多重実行防止 state。joinRoom の排他に使う。
    joining,
    // join 完了 state。join/leave ガードと UI 表示切替に使う。
    joined,
    // leave 多重実行防止 state。leaveRoom の排他に使う。
    leaving,
    // self publication 判定と publish/unpublish 呼び出しに使う local member。
    localMember,
    // ローカル映像 publication。mute 反映と metadata 更新に使う。
    localVideoPublication,
    // ローカル音声 publication。mute 反映と leave cleanup に使う。
    localAudioPublication,
    // ローカル映像 stream。publish と preview attach の参照元。
    localVideoStream,
    // ローカル preview 要素。leave 時の preview cleanup に使う。
    localVideoEl,
    // ローカル音声 mute state。join 後の初期 mute 反映に使う。
    isAudioMuted,
    // ローカル映像 mute state。join 後の初期 mute と blur 後再反映に使う。
    isVideoMuted,
    // 画面共有 state。join 後の blur 適用可否判定に使う。
    isScreenSharing,
    // 背景ぼかし state。join 後の blur 再適用可否判定に使う。
    isBackgroundBlurred,
    // RNNoise を join 時に有効化するかの判定 state。
    isRnnoiseEnabled,
    // camera stream 生成時に使う選択済み deviceId。
    selectedVideoInputId,
    // mic stream 生成時に使う選択済み deviceId。
    selectedAudioInputId,
    // room join 時の SkyWay member 名として使う表示名。
    memberDisplayName,
    // SkyWay Context/Room 参照。room create/join/leave 全体で共有する。
    context,
    // sub composable 失敗時の UI エラー反映 callback。
    setErrorMessage,
    // join/leave 周辺で blur processor を読み出す accessor。
    getBlurProcessor,
    // join/leave 周辺で blur processor を更新する accessor。
    setBlurProcessor,
    // join 直前に remote publication/tile tracking を初期化する callback。
    resetRemotePublicationsForJoin,
    // subscribe 済み remote stream を attach/tile 同期する callback。
    attachRemote,
    // unpublish 後に publication 重複防止 tracking を解除する callback。
    removePublicationTracking,
    // unpublish 後に pubId 対応 tile を除去する callback。
    removeTileByPubId,
    // publication が remote audio かを判定する callback。
    isRemoteAudioPublication,
    // remote audio unpublish 時に mute badge を非表示へ戻す callback。
    hideRemoteAudioMuteBadge,
    // publication enabled/disabled 時に remote audio mute badge を再同期する callback。
    syncRemoteAudioMuteBadge,
    // join 後に local preview へ stream を attach する callback。
    attachLocalPreview,
    // local video publication metadata を更新する callback。
    updateLocalVideoPublicationMetadata,
    // local tile を publish 状態に合わせて再同期する callback。
    syncLocalVideoTile,
    // leave 時に画面共有中 self preview を停止する callback。
    stopLocalSelfCameraPreview,
    // leave 時に remote publication/tile/DOM を初期化する callback。
    cleanupRemotePublicationsForLeave,
    // leave 時にローカル映像 stream を解放する callback。
    releaseLocalVideoStream,
    // ローカル RNNoise から受けた VAD 値を話者監視へ橋渡しする callback。
    onLocalVadValue: updateVadLevel,
    // join 完了後に local member の話者監視を開始する callback。
    onJoinCompleted: startSpeakingMonitor,
    // leave finally で話者監視を一括停止する callback。
    onLeaveFinally: cleanupSpeakingMonitors,
  });

  // マイクのミュート切替
  /**
   * ローカル音声 publication の mute/unmute を切り替える。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects localAudioPublication と isAudioMuted を更新する。
   */
  const toggleAudioMute = async () => {
    try {
      if (!localAudioPublication.value) {
        isAudioMuted.value = !isAudioMuted.value;
        return;
      }

      if (!isAudioMuted.value) {
        await localAudioPublication.value.disable?.();
        isAudioMuted.value = true;
      } else {
        await localAudioPublication.value.enable?.();
        isAudioMuted.value = false;
      }
    } catch (e) {
      errorMessage.value = e?.message || String(e);
    }
  };

  // カメラ映像のミュート切替
  /**
   * ローカル映像 publication の mute/unmute を切り替える。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects localVideoPublication と isVideoMuted を更新する。
   */
  const toggleVideoMute = async () => {
    try {
      if (!localVideoPublication.value) {
        isVideoMuted.value = !isVideoMuted.value;
        return;
      }

      if (!isVideoMuted.value) {
        await localVideoPublication.value.disable?.();
        isVideoMuted.value = true;
      } else {
        await localVideoPublication.value.enable?.();
        isVideoMuted.value = false;
      }
    } catch (e) {
      errorMessage.value = e?.message || String(e);
    }
  };

  // 画面共有の開始 / 停止を切り替える
  /**
   * 画面共有とカメラ配信を相互に切り替える。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects localVideoStream/publication、プレビュー、タイル state を更新する。
   */
  const screenShare = async () => {
    await localMediaSessionHandlers.screenShare();
  };

  // 背景ぼかしの ON / OFF 切替
  /**
   * 背景ぼかしの ON/OFF を切り替える。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects video processor、local publication、タイル state を更新する。
   */
  const toggleBackgroundBlur = async () => {
    await localMediaSessionHandlers.toggleBackgroundBlur();
  };

  // RNNoise の有効 / 無効を切り替える
  /**
   * RNNoise 利用フラグを切り替える。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects isRnnoiseEnabled を更新する。
   */
  const toggleRnnoise = async () => {
    isRnnoiseEnabled.value = !isRnnoiseEnabled.value;
  };

  // 映像を全画面表示する
  /**
   * 指定 video 要素を全画面オーバーレイ表示へ移す。
   *
   * @param {HTMLVideoElement} videoEl
   * @returns {void}
   * @throws {never}
   * @sideeffects DOM 再配置と enlargedVideo の更新を行う。
   */
  const enlargeVideo = (videoEl) => {
    uiEnlarge(videoEl);
    enlargedVideo.value = videoEl;
  };

  // 全画面表示を解除する
  /**
   * 全画面オーバーレイ表示を解除する。
   *
   * @returns {void}
   * @throws {never}
   * @sideeffects DOM 復元と enlargedVideo の初期化を行う。
   */
  const shrinkVideo = () => {
    uiShrink(enlargedVideo.value);
    enlargedVideo.value = null;
  };

  // 初期化処理（デバイス取得・URL クエリ反映）
  onMounted(async () => {
    await loadMemberDisplayName();

    try {
      await initializeMediaDevices();

      const qRoom = new URLSearchParams(window.location.search).get('room');
      if (qRoom) roomId.value = qRoom;

    } catch (e) {
      console.warn('Device enumerate failed', e);
    }
  });

  onUnmounted(() => {
    cleanupSpeakingMonitors();
  });

  // UI コンポーネントに公開する状態と操作一覧
  return {
    streamArea,
    roomCreated,
    roomId,
    joining,
    joined,
    localMember,
    errorMessage,
    remoteVideos,
    screenShareTiles,
    selectedMainSharePubId,
    cameraFilmstripTiles,
    localVideoEl,
    localSelfCameraPreviewEl,
    leaving,
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    isBackgroundBlurred,
    showShareOpen,
    showSettingsOpen,
    enlargedVideo,
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
    baseUrl,
    isRnnoiseEnabled,
    createRoom,
    joinRoom,
    leaveRoom,
    toggleAudioMute,
    toggleVideoMute,
    screenShare,
    toggleBackgroundBlur,
    toggleRnnoise,
    openCameraPanel,
    cancelCameraPanel,
    confirmCameraPanel,
    openMicPanel,
    cancelMicPanel,
    confirmMicPanel,
    openSpeakerPanel,
    cancelSpeakerPanel,
    confirmSpeakerPanel,
    enlargeVideo,
    shrinkVideo,
  };
}
