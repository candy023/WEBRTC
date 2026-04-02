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
import { enumerateDevices, getDefaultSelections } from '../services/DeviceService.js';
import {
  attachRemoteStream,
  setRemoteAudioOutput,
  setRemoteAudioMuteBadgeVisible,
  ensureLocalTileElement,
  enlargeVideo as uiEnlarge,
  shrinkVideo as uiShrink
} from '../services/VideoUIService.js';
import {
  isScreenPublication,
  isVideoStream,
  removeTileFromList,
  syncSelectedMainShare,
  upsertVideoTile,
} from './helpers/useVideoTiles.js';
import { useLocalMediaSession } from './useLocalMediaSession.js';

/**
 * WebRTC 画面の state と service 呼び出し順序を管理する orchestrator composable。
 *
 * @returns {object} UI から利用する state ref と操作関数の集合。
 * @throws {never}
 * @sideeffects SkyWay 接続、メディアデバイス利用、DOM 操作を行う。
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
  const remoteVideos = ref([]);              // 生成済みリモート映像 DOM の管理配列
  const screenShareTiles = ref([]);          // 画面共有タイル一覧。メイン共有の選択同期と描画に使う
  const selectedMainSharePubId = ref(null);  // メイン表示中の共有 pubId。共有削除時のフォールバック判定で使う
  const cameraFilmstripTiles = ref([]);      // カメラ映像タイル一覧。フィルムストリップ描画と削除同期に使う
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
  const videoInputDevices = ref([]);         // 利用可能なカメラ一覧
  const audioInputDevices = ref([]);         // 利用可能なマイク一覧
  const audioOutputDevices = ref([]);        // 利用可能なスピーカー一覧
  const selectedVideoInputId = ref('');      // 選択中のカメラ ID
  const selectedAudioInputId = ref('');      // 選択中のマイク ID
  const selectedAudioOutputId = ref('');     // 選択中のスピーカー ID
  const showCameraPanel = ref(false);        // カメラ選択パネルの表示状態
  const showMicPanel = ref(false);           // マイク選択パネルの表示状態
  const showSpeakerPanel = ref(false);       // スピーカー選択パネルの表示状態
  const tempSelectedVideoInputId = ref('');  // 設定画面内の一時的なカメラ選択
  const tempSelectedAudioInputId = ref('');  // 設定画面内の一時的なマイク選択
  const tempSelectedAudioOutputId = ref(''); // 設定画面内の一時的なスピーカー選択
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
  const receivedPublicationIds = new Set();  // 受信済み publication の ID を記録（重複 subscribe 防止）
  const pendingPublicationIds = new Set();   // attach 進行中の publication を記録（新規通知との競合防止）
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

  const syncSelectedMainShareState = () => {
    selectedMainSharePubId.value = syncSelectedMainShare(
      selectedMainSharePubId.value,
      screenShareTiles.value
    );
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

  const removeTileByPubId = (pubId) => {
    if (!pubId) return;

    const removedScreenTile = removeTileFromList(screenShareTiles.value, pubId);
    const removedCameraTile = removeTileFromList(cameraFilmstripTiles.value, pubId);
    const removedTile = removedScreenTile || removedCameraTile;

    if (removedTile?.el && !removedTile.isLocal) {
      try {
        removedTile.el.remove?.();
      } catch {}
    }

    remoteVideos.value = remoteVideos.value.filter((el) => el !== removedTile?.el);

    if (!removedTile) {
      const fallbackEl = remoteVideos.value.find((el) => el?.dataset?.pubId === pubId);
      if (fallbackEl) {
        try {
          fallbackEl.remove?.();
        } catch {}
        remoteVideos.value = remoteVideos.value.filter((el) => el !== fallbackEl);
      }
    }

    syncSelectedMainShareState();
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

  const isRemoteAudioPublication = (publication) => {
    if (!publication) return false;
    if (publication.contentType !== 'audio') return false;

    const publisherId = publication.publisher?.id;
    if (!publisherId) return false;
    if (localMember.value?.id && publisherId === localMember.value.id) return false;

    return true;
  };

  const syncRemoteAudioMuteBadge = (publication) => {
    if (!isRemoteAudioPublication(publication)) return;

    setRemoteAudioMuteBadgeVisible(
      streamArea.value,
      publication.publisher.id,
      publication.state === 'disabled'
    );
  };

  const syncRemoteAudioMuteBadgeByMemberId = (memberId) => {
    if (!memberId || !context.room) return;

    const memberAudioPublication = (context.room.publications ?? []).find(
      (publication) => (
        publication?.contentType === 'audio' &&
        publication?.publisher?.id === memberId
      )
    );

    setRemoteAudioMuteBadgeVisible(
      streamArea.value,
      memberId,
      memberAudioPublication?.state === 'disabled'
    );
  };

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

  const attachRemote = async (stream, pub) => {
    if (!pub?.id) return;
    if (receivedPublicationIds.has(pub.id)) return;
    if (pendingPublicationIds.has(pub.id)) return;
    pendingPublicationIds.add(pub.id);

    try {
      if (!streamArea.value) {
        await nextTick();
      }

      let el = attachRemoteStream(streamArea.value, stream, pub, {
        audioOutputDeviceId: selectedAudioOutputId.value
      });

      if (!el && streamArea.value) {
        await nextTick();
        el = attachRemoteStream(streamArea.value, stream, pub, {
          audioOutputDeviceId: selectedAudioOutputId.value
        });
      }

      if (!el) {
        console.warn('remote attach skipped', {
          pubId: pub?.id,
          contentType: pub?.contentType,
          publisherId: pub?.publisher?.id,
          hasStreamArea: !!streamArea.value,
          hasVideoTrack: isVideoStream(stream),
          hasAudioTrack: !!(
            stream?.track?.kind === 'audio' ||
            (stream?.mediaStream && stream.mediaStream.getAudioTracks?.().length)
          ),
        });
        return;
      }

      receivedPublicationIds.add(pub.id);

      try {
        if (pub?.id && !el.dataset?.pubId) el.dataset.pubId = pub.id;
      } catch {}
      remoteVideos.value.push(el);

      syncRemoteAudioMuteBadge(pub);

      if (!isVideoStream(stream)) return;

      const tile = {
        pubId: pub.id,
        memberId: pub?.publisher?.id || '',
        label: pub?.publisher?.name || pub?.publisher?.id || '参加者',
        el,
        isLocal: false
      };
      upsertVideoTile({
        publication: pub,
        tile,
        screenShareTiles: screenShareTiles.value,
        cameraFilmstripTiles: cameraFilmstripTiles.value,
      });
      syncSelectedMainShareState();
      syncRemoteAudioMuteBadgeByMemberId(pub?.publisher?.id);
    } finally {
      pendingPublicationIds.delete(pub.id);
    }
  };

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
      receivedPublicationIds.clear();
      pendingPublicationIds.clear();
      screenShareTiles.value = [];
      cameraFilmstripTiles.value = [];
      selectedMainSharePubId.value = null;

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
          setRemoteAudioMuteBadgeVisible(streamArea.value, publication.publisher.id, false);
        }
        receivedPublicationIds.delete(publication.id);
        pendingPublicationIds.delete(publication.id);
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

      remoteVideos.value.forEach(el => { try { el?.remove?.(); } catch {} });
      remoteVideos.value = [];
      receivedPublicationIds.clear();
      pendingPublicationIds.clear();
      screenShareTiles.value = [];
      cameraFilmstripTiles.value = [];
      selectedMainSharePubId.value = null;

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

  // カメラ選択パネルの開閉と確定
  /**
   * カメラ選択パネルを開く。
   *
   * @returns {void}
   * @throws {never}
   * @sideeffects showCameraPanel / tempSelectedVideoInputId を更新する。
   */
  const openCameraPanel = () => {
    showCameraPanel.value = true;
    tempSelectedVideoInputId.value = selectedVideoInputId.value;
  };
  /**
   * カメラ選択パネルを閉じる。
   *
   * @returns {void}
   * @throws {never}
   * @sideeffects showCameraPanel を更新する。
   */
  const cancelCameraPanel = () => { showCameraPanel.value = false; };
  /**
   * カメラ選択パネルの選択を確定する。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects selectedVideoInputId とプレビュー表示を更新する。
   */
  const confirmCameraPanel = async () => {
    selectedVideoInputId.value = tempSelectedVideoInputId.value;
    showCameraPanel.value = false;
    if (isScreenSharing.value) {
      await startLocalSelfCameraPreview();
    }
  };

  // マイク選択パネルの開閉と確定
  /**
   * マイク選択パネルを開く。
   *
   * @returns {void}
   * @throws {never}
   * @sideeffects showMicPanel / tempSelectedAudioInputId を更新する。
   */
  const openMicPanel = () => {
    showMicPanel.value = true;
    tempSelectedAudioInputId.value = selectedAudioInputId.value;
  };
  /**
   * マイク選択パネルを閉じる。
   *
   * @returns {void}
   * @throws {never}
   * @sideeffects showMicPanel を更新する。
   */
  const cancelMicPanel = () => { showMicPanel.value = false; };
  /**
   * マイク選択パネルの選択を確定する。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects selectedAudioInputId を更新する。
   */
  const confirmMicPanel = async () => {
    selectedAudioInputId.value = tempSelectedAudioInputId.value;
    showMicPanel.value = false;
  };

  // スピーカー選択パネルの開閉と確定
  /**
   * スピーカー選択パネルを開く。
   *
   * @returns {void}
   * @throws {never}
   * @sideeffects showSpeakerPanel / tempSelectedAudioOutputId を更新する。
   */
  const openSpeakerPanel = () => {
    showSpeakerPanel.value = true;
    tempSelectedAudioOutputId.value = selectedAudioOutputId.value;
  };
  /**
   * スピーカー選択パネルを閉じる。
   *
   * @returns {void}
   * @throws {never}
   * @sideeffects showSpeakerPanel を更新する。
   */
  const cancelSpeakerPanel = () => { showSpeakerPanel.value = false; };
  /**
   * スピーカー選択パネルの選択を確定し、出力先を再適用する。
   *
   * @returns {Promise<void>}
   * @throws {never}
   * @sideeffects selectedAudioOutputId と既存 remote audio 要素の sinkId を更新する。
   */
  const confirmSpeakerPanel = async () => {
    selectedAudioOutputId.value = tempSelectedAudioOutputId.value;
    showSpeakerPanel.value = false;

    try {
      await setRemoteAudioOutput(streamArea.value, selectedAudioOutputId.value);
    } catch (e) {
      errorMessage.value = e?.message || String(e);
    }
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
      const devices = await enumerateDevices();

      videoInputDevices.value = devices.videoInputDevices;
      audioInputDevices.value = devices.audioInputDevices;
      audioOutputDevices.value = devices.audioOutputDevices;

      const sel = getDefaultSelections(devices);
      selectedVideoInputId.value = sel.selectedVideoInputId;
      selectedAudioInputId.value = sel.selectedAudioInputId;
      selectedAudioOutputId.value = sel.selectedAudioOutputId;

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
