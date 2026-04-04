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

import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import {
  createContext,
  findOrCreateRoom,
  joinRoom as skywayJoin,
  publishLocal,
  subscribeExisting,
  bindOnStreamPublished,
  unbindOnStreamPublished,
  bindOnStreamUnpublished,
  unbindOnStreamUnpublished,
  leave as skywayLeave,
} from '../services/SkywayRoomService.js';
import {
  createCameraStream,
  createMicrophoneStream,
  enableBackgroundBlur,
} from '../services/MediaStreamService.js';
import { setupRnnoise } from '../services/RnnoiseService.js';
import {
  setRemoteAudioOutput,
  ensureLocalTileElement,
  enlargeVideo as uiEnlarge,
  shrinkVideo as uiShrink
} from '../services/VideoUIService.js';
import {
  isScreenPublication,
} from './helpers/useVideoTiles.js';
import { useLocalMediaSession } from './useLocalMediaSession.js';
import { useMediaDevicePanels } from './useMediaDevicePanels.js';
import { useRemotePublications } from './useRemotePublications.js';

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

  // --- 内部制御用（UI には直接返さない） ---
  const localVideoPublication = ref(null);   // 自分の映像 Publication
  const localAudioPublication = ref(null);   // 自分の音声 Publication
  const localVideoStream = ref(null);        // ローカル映像ストリーム参照
  const localSelfCameraPreviewStream = ref(null); // プレビュー専用のローカルカメラ stream。切替時の解放に使う
  const context = { ctx: null, room: null }; // SkyWay Context と Room の保持
  let streamPublishedHandler = null;         // onStreamPublished の解除に使うハンドラ参照
  let streamUnpublishedHandler = null;       // onStreamUnpublished の購読解除に使うハンドラ参照
  let publicationEnabledHandler = null;      // onPublicationEnabled の購読解除に使うハンドラ参照
  let publicationDisabledHandler = null;     // onPublicationDisabled の購読解除に使うハンドラ参照
  let blurProcessor = null;                  // 背景ぼかしの Processor 参照
  let rnnoiseHandle = null;                  // RNNoise 初期化ハンドル
  let localTileContainerEl = null;           // ローカルタイルを再利用するためのコンテナ要素参照
  let localTileVideoEl = null;               // ローカルタイル内で stream attach 先になる video 要素参照

  const releaseLocalVideoStream = () => {
    try {
      localVideoStream.value?.release?.();
    } catch {}
    localVideoStream.value = null;
  };

  const reflectInitialMuteState = async () => {
    try {
      if (isVideoMuted.value) await localVideoPublication.value?.disable?.();
    } catch {}
    try {
      if (isAudioMuted.value) await localAudioPublication.value?.disable?.();
    } catch {}
  };

  const handleLocalTileEnlarge = (videoEl) => {
    try {
      uiEnlarge(videoEl);
      enlargedVideo.value = videoEl;
    } catch {}
  };

  const ensureLocalTileRefs = () => {
    const { containerEl, videoEl } = ensureLocalTileElement({
      currentContainerEl: localTileContainerEl,
      currentVideoEl: localTileVideoEl,
      onEnlarge: handleLocalTileEnlarge,
    });
    localTileContainerEl = containerEl;
    localTileVideoEl = videoEl;
    return { containerEl, videoEl };
  };

  const syncLocalVideoTile = () => {
    screenShareTiles.value = screenShareTiles.value.filter((tile) => !tile.isLocal);
    cameraFilmstripTiles.value = cameraFilmstripTiles.value.filter((tile) => !tile.isLocal);

    const publication = localVideoPublication.value;
    if (!publication?.id || !localMember.value?.id) {
      syncSelectedMainShareState();
      return;
    }

    ensureLocalTileRefs();
    if (!localTileContainerEl) {
      syncSelectedMainShareState();
      return;
    }

    localTileContainerEl.dataset.memberId = localMember.value.id;
    localTileContainerEl.dataset.pubId = publication.id;

    const tile = {
      pubId: publication.id,
      memberId: localMember.value.id,
      label: 'あなた',
      el: localTileContainerEl,
      isLocal: true
    };

    if (isScreenPublication(publication)) {
      screenShareTiles.value.push(tile);
    } else {
      cameraFilmstripTiles.value.push(tile);
    }

    syncSelectedMainShareState();
  };

  const updateLocalVideoPublicationMetadata = async (kind) => {
    try {
      await localVideoPublication.value?.updateMetadata?.(JSON.stringify({ kind }));
    } catch {}
  };

  const getLocalTileElements = () => ({
    containerEl: localTileContainerEl,
    videoEl: localTileVideoEl,
  });

  const setLocalTileElements = ({ containerEl, videoEl }) => {
    localTileContainerEl = containerEl;
    localTileVideoEl = videoEl;
  };

  const getBlurProcessor = () => blurProcessor;

  const setBlurProcessor = (nextBlurProcessor) => {
    blurProcessor = nextBlurProcessor;
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
    setErrorMessage: (message) => {
      errorMessage.value = message;
    },
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

  // ルームを作成し、URL 共有の起点を確定する
  /**
   * URL または入力値の roomId を使って room を準備する。
   *
   * @returns {Promise<void>}
   * @throws {Error} SkyWay Context / Room 作成時の例外をそのまま伝播。
   * @sideeffects context.ctx / context.room / roomCreated / roomId を更新する。
   */
  const createRoom = async () => {
    if (!roomId.value) {
      roomId.value = window.crypto?.randomUUID?.() || 'demo-room';
    }

    if (!context.ctx) {
      context.ctx = await createContext();
    }

    context.room = await findOrCreateRoom(context.ctx, roomId.value);
    roomCreated.value = true;
  };

  // ルームに参加し、ローカル publish とリモート subscribe をまとめて行う
  /**
   * room 参加とローカル publish、および既存/新規 publication の購読を開始する。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects 接続 state、ローカル publication、タイル state、イベントハンドラを更新する。
   */
  const joinRoom = async () => {
    if (joining.value || joined.value) return;
    joining.value = true;

    try {
      if (!roomCreated.value || !context.room) await createRoom();
      resetRemotePublicationsForJoin();

      const member = await skywayJoin(context.room);
      localMember.value = member;

      if (streamPublishedHandler) {
        unbindOnStreamPublished(context.room, streamPublishedHandler);
        streamPublishedHandler = null;
      }
      if (streamUnpublishedHandler) {
        unbindOnStreamUnpublished(context.room, streamUnpublishedHandler);
        streamUnpublishedHandler = null;
      }
      if (publicationEnabledHandler) {
        try {
          context.room?.onPublicationEnabled?.remove(publicationEnabledHandler);
        } catch {}
        publicationEnabledHandler = null;
      }
      if (publicationDisabledHandler) {
        try {
          context.room?.onPublicationDisabled?.remove(publicationDisabledHandler);
        } catch {}
        publicationDisabledHandler = null;
      }

      streamPublishedHandler = bindOnStreamPublished(
        context.room,
        member,
        async (stream, pub) => {
          try {
            if (pub?.publisher?.id && member?.id && pub.publisher.id === member.id) return;
            await attachRemote(stream, pub);
          } catch (err) {
            console.warn('配信の受信処理に失敗:', err);
          }
        }
      );
      streamUnpublishedHandler = bindOnStreamUnpublished(context.room, async (event) => {
        const publication = event?.publication;
        if (!publication?.id) return;
        if (isRemoteAudioPublication(publication)) {
          hideRemoteAudioMuteBadge(publication);
        }
        removePublicationTracking(publication.id);
        removeTileByPubId(publication.id);
      });
      publicationEnabledHandler = (event) => {
        syncRemoteAudioMuteBadge(event?.publication);
      };
      publicationDisabledHandler = (event) => {
        syncRemoteAudioMuteBadge(event?.publication);
      };
      context.room?.onPublicationEnabled?.add(publicationEnabledHandler);
      context.room?.onPublicationDisabled?.add(publicationDisabledHandler);

      const videoStream = await createCameraStream(
        selectedVideoInputId.value
          ? { video: { deviceId: selectedVideoInputId.value } }
          : undefined
      );
      localVideoStream.value = videoStream;

      let audioConstraints = { audio: { deviceId: selectedAudioInputId.value || undefined } };
      if (isRnnoiseEnabled.value) {
        rnnoiseHandle = await setupRnnoise(selectedAudioInputId.value);
        audioConstraints = rnnoiseHandle.constraints;
      }

      const audioStream = await createMicrophoneStream(audioConstraints);
      const pubs = await publishLocal(member, {
        videoStream,
        audioStream
      });

      localVideoPublication.value = pubs.videoPub;
      localAudioPublication.value = pubs.audioPub;
      await updateLocalVideoPublicationMetadata('camera');

      joined.value = true;
      await nextTick();

      attachLocalPreview(localVideoStream.value);
      await reflectInitialMuteState();
      syncLocalVideoTile();

      if (isBackgroundBlurred.value && !isScreenSharing.value) {
        const ret = await enableBackgroundBlur({
          localMember,
          localVideoPublication,
          localVideoStream,
          localVideoEl
        });
        blurProcessor = ret?.processor ?? null;
        await updateLocalVideoPublicationMetadata('camera');
        attachLocalPreview(localVideoStream.value);
        syncLocalVideoTile();

        try {
          if (isVideoMuted.value) await localVideoPublication.value?.disable?.();
        } catch {}
      }

      await subscribeExisting(context.room, member, async (stream, pub) => {
        await attachRemote(stream, pub);
      });

    } catch (e) {
      errorMessage.value = e?.message || String(e);
    } finally {
      joining.value = false;
    }
  };

  // ルーム退出およびすべてのリソース解放
  /**
   * room 退出とローカル/リモート資源の解放を行う。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects SkyWay 退出、DOM 要素削除、stream 解放、各種 state 初期化を行う。
   */
  const leaveRoom = async () => {
    if (!joined.value || leaving.value) return;
    leaving.value = true;

    try {
      if (streamPublishedHandler) unbindOnStreamPublished(context.room, streamPublishedHandler);
      streamPublishedHandler = null;
      if (streamUnpublishedHandler) {
        unbindOnStreamUnpublished(context.room, streamUnpublishedHandler);
      }
      streamUnpublishedHandler = null;
      if (publicationEnabledHandler) {
        try {
          context.room?.onPublicationEnabled?.remove(publicationEnabledHandler);
        } catch {}
      }
      publicationEnabledHandler = null;
      if (publicationDisabledHandler) {
        try {
          context.room?.onPublicationDisabled?.remove(publicationDisabledHandler);
        } catch {}
      }
      publicationDisabledHandler = null;

      stopLocalSelfCameraPreview();
      await skywayLeave(localMember.value);

      cleanupRemotePublicationsForLeave();

      try { localVideoEl.value?.pause?.(); } catch {}
      try {
        if (localVideoEl.value) localVideoEl.value.srcObject = null;
      } catch {}

      releaseLocalVideoStream();

      try {
        await blurProcessor?.dispose?.();
      } catch {}
      blurProcessor = null;

      try {
        rnnoiseHandle?.cleanup?.();
      } catch {}
      rnnoiseHandle = null;

      joined.value = false;
      isScreenSharing.value = false;
      localMember.value = null;
      localVideoPublication.value = null;
      localAudioPublication.value = null;
      roomCreated.value = false;
      context.room = null;
      context.ctx = null;

    } catch (e) {
      errorMessage.value = e?.message || String(e);
    } finally {
      leaving.value = false;
    }
  };

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
    try {
      await initializeMediaDevices();

      const qRoom = new URLSearchParams(window.location.search).get('room');
      if (qRoom) roomId.value = qRoom;

    } catch (e) {
      console.warn('Device enumerate failed', e);
    }
  });

  onUnmounted(() => {});

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
