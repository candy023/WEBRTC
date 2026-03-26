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
  leave as skywayLeave,
} from '../services/SkywayRoomService.js';
import {
  createCameraStream,
  createMicrophoneStream,
  createDisplayStream,
  enableBackgroundBlur,
  disableBackgroundBlur,
} from '../services/MediaStreamService.js';
import { setupRnnoise } from '../services/RnnoiseService.js';
import { enumerateDevices, getDefaultSelections } from '../services/DeviceService.js';
import { attachRemoteStream, setRemoteAudioOutput, enlargeVideo as uiEnlarge, shrinkVideo as uiShrink } from '../services/VideoUIService.js';

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
  const screenShareTiles = ref([]);
  const selectedMainSharePubId = ref(null);
  const cameraFilmstripTiles = ref([]);
  const localVideoEl = ref(null);            // ローカルプレビュー用 video 要素
  const localSelfCameraPreviewEl = ref(null);
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
  const localSelfCameraPreviewStream = ref(null);
  const context = { ctx: null, room: null }; // SkyWay Context と Room の保持
  let streamPublishedHandler = null;         // onStreamPublished の解除に使うハンドラ参照
  let streamUnpublishedHandler = null;
  const receivedPublicationIds = new Set();  // 受信済み publication の ID を記録（重複 subscribe 防止）
  let blurProcessor = null;                  // 背景ぼかしの Processor 参照
  let rnnoiseHandle = null;                  // RNNoise 初期化ハンドル
  let localTileContainerEl = null;
  let localTileVideoEl = null;

  const releaseLocalVideoStream = () => {
    try {
      localVideoStream.value?.release?.();
    } catch {}
    localVideoStream.value = null;
  };

  const unpublishCurrentVideo = async () => {
    const currentPubId = localVideoPublication.value?.id ?? null;
    try {
      if (localMember.value && localVideoPublication.value) {
        await localMember.value.unpublish(localVideoPublication.value);
      }
    } catch {}
    localVideoPublication.value = null;
    if (currentPubId) removeTileByPubId(currentPubId);
  };

  const attachLocalPreview = (stream) => {
    try {
      if (!stream || !localVideoEl.value) return;
      stream.attach(localVideoEl.value);
      localVideoEl.value.play?.().catch(() => {});

      ensureLocalTileElement();
      if (localTileVideoEl) {
        stream.attach(localTileVideoEl);
        localTileVideoEl.play?.().catch(() => {});
      }
    } catch {}
  };

  const stopLocalSelfCameraPreview = () => {
    try {
      localSelfCameraPreviewStream.value?.release?.();
    } catch {}
    localSelfCameraPreviewStream.value = null;

    try {
      localSelfCameraPreviewEl.value?.pause?.();
    } catch {}
    try {
      if (localSelfCameraPreviewEl.value) localSelfCameraPreviewEl.value.srcObject = null;
    } catch {}
  };

  const startLocalSelfCameraPreview = async () => {
    if (!isScreenSharing.value) return;

    stopLocalSelfCameraPreview();

    try {
      const previewStream = await createCameraStream(
        selectedVideoInputId.value
          ? { video: { deviceId: selectedVideoInputId.value } }
          : undefined
      );
      localSelfCameraPreviewStream.value = previewStream;

      await nextTick();

      if (localSelfCameraPreviewEl.value) {
        previewStream.attach(localSelfCameraPreviewEl.value);
        localSelfCameraPreviewEl.value.play?.().catch(() => {});
      }
    } catch {}
  };

  const reflectInitialMuteState = async () => {
    try {
      if (isVideoMuted.value) await localVideoPublication.value?.disable?.();
    } catch {}
    try {
      if (isAudioMuted.value) await localAudioPublication.value?.disable?.();
    } catch {}
  };

  const parsePublicationKind = (publication) => {
    if (!publication?.metadata) return '';
    try {
      const parsed = JSON.parse(publication.metadata);
      if (typeof parsed?.kind === 'string') return parsed.kind;
    } catch {}
    return '';
  };

  const isScreenPublication = (publication) => parsePublicationKind(publication) === 'screen';

  const isVideoStream = (stream) => !!(
    stream?.track?.kind === 'video' ||
    (stream?.mediaStream && stream.mediaStream.getVideoTracks?.().length)
  );

  const syncSelectedMainShare = () => {
    if (!screenShareTiles.value.length) {
      selectedMainSharePubId.value = null;
      return;
    }

    if (!selectedMainSharePubId.value) {
      selectedMainSharePubId.value = screenShareTiles.value[0].pubId;
      return;
    }

    const exists = screenShareTiles.value.some((tile) => tile.pubId === selectedMainSharePubId.value);
    if (!exists) {
      selectedMainSharePubId.value = screenShareTiles.value[0].pubId;
    }
  };

  const removeTileFromList = (listRef, pubId) => {
    const index = listRef.value.findIndex((tile) => tile.pubId === pubId);
    if (index < 0) return null;
    const [tile] = listRef.value.splice(index, 1);
    return tile;
  };

  const removeTileByPubId = (pubId) => {
    if (!pubId) return;

    const removedScreenTile = removeTileFromList(screenShareTiles, pubId);
    const removedCameraTile = removeTileFromList(cameraFilmstripTiles, pubId);
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

    syncSelectedMainShare();
  };

  const upsertTileToList = (listRef, tile) => {
    const index = listRef.value.findIndex((item) => item.pubId === tile.pubId);
    if (index >= 0) {
      listRef.value[index] = tile;
    } else {
      listRef.value.push(tile);
    }
  };

  const upsertVideoTile = (publication, tile) => {
    if (!publication?.id || !tile?.el) return;

    removeTileFromList(screenShareTiles, publication.id);
    removeTileFromList(cameraFilmstripTiles, publication.id);

    if (isScreenPublication(publication)) {
      upsertTileToList(screenShareTiles, tile);
    } else {
      upsertTileToList(cameraFilmstripTiles, tile);
    }

    syncSelectedMainShare();
  };

  const ensureLocalTileElement = () => {
    if (localTileContainerEl && localTileVideoEl) return;

    const container = document.createElement('div');
    container.className = 'relative w-full aspect-video bg-black rounded overflow-hidden';

    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = true;
    videoEl.className = 'w-full h-full object-cover';

    const enlargeBtn = document.createElement('button');
    enlargeBtn.innerHTML = '⛶';
    enlargeBtn.className =
      'absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded hover:bg-opacity-70 text-sm';
    enlargeBtn.onclick = (e) => {
      e.stopPropagation();
      try {
        uiEnlarge(videoEl);
        enlargedVideo.value = videoEl;
      } catch {}
    };

    container.appendChild(videoEl);
    container.appendChild(enlargeBtn);

    localTileContainerEl = container;
    localTileVideoEl = videoEl;
  };

  const syncLocalVideoTile = () => {
    screenShareTiles.value = screenShareTiles.value.filter((tile) => !tile.isLocal);
    cameraFilmstripTiles.value = cameraFilmstripTiles.value.filter((tile) => !tile.isLocal);

    const publication = localVideoPublication.value;
    if (!publication?.id || !localMember.value?.id) {
      syncSelectedMainShare();
      return;
    }

    ensureLocalTileElement();
    if (!localTileContainerEl) {
      syncSelectedMainShare();
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

    syncSelectedMainShare();
  };

  const updateLocalVideoPublicationMetadata = async (kind) => {
    try {
      await localVideoPublication.value?.updateMetadata?.(JSON.stringify({ kind }));
    } catch {}
  };

  const attachRemote = async (stream, pub) => {
    if (!pub?.id) return;
    if (receivedPublicationIds.has(pub.id)) return;
    receivedPublicationIds.add(pub.id);

    const el = attachRemoteStream(streamArea.value, stream, pub, {
      audioOutputDeviceId: selectedAudioOutputId.value
    });
    if (el) {
      try {
        if (pub?.id && !el.dataset?.pubId) el.dataset.pubId = pub.id;
      } catch {}
      remoteVideos.value.push(el);
    }

    if (!isVideoStream(stream) || !el) return;

    const tile = {
      pubId: pub.id,
      memberId: pub?.publisher?.id || '',
      label: pub?.publisher?.name || pub?.publisher?.id || '参加者',
      el,
      isLocal: false
    };
    upsertVideoTile(pub, tile);
  };

  // ルームを作成し、URL 共有の起点を確定する
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
  const joinRoom = async () => {
    if (joining.value || joined.value) return;
    joining.value = true;

    try {
      if (!roomCreated.value || !context.room) await createRoom();
      receivedPublicationIds.clear();
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
        try {
          context.room?.onStreamUnpublished?.remove(streamUnpublishedHandler);
        } catch {}
        streamUnpublishedHandler = null;
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
      streamUnpublishedHandler = async (event) => {
        const publication = event?.publication;
        if (!publication?.id) return;
        receivedPublicationIds.delete(publication.id);
        removeTileByPubId(publication.id);
      };
      context.room.onStreamUnpublished.add(streamUnpublishedHandler);

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
  const leaveRoom = async () => {
    if (!joined.value || leaving.value) return;
    leaving.value = true;

    try {
      if (streamPublishedHandler) unbindOnStreamPublished(context.room, streamPublishedHandler);
      streamPublishedHandler = null;
      if (streamUnpublishedHandler) {
        try {
          context.room?.onStreamUnpublished?.remove(streamUnpublishedHandler);
        } catch {}
      }
      streamUnpublishedHandler = null;

      stopLocalSelfCameraPreview();

      await skywayLeave(localMember.value, context.room, {
        videoPub: localVideoPublication.value,
        audioPub: localAudioPublication.value
      });

      remoteVideos.value.forEach(el => { try { el?.remove?.(); } catch {} });
      remoteVideos.value = [];
      receivedPublicationIds.clear();
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
  const screenShare = async () => {
    if (!joined.value || !localMember.value) return;

    try {
      if (isScreenSharing.value) {
        stopLocalSelfCameraPreview();
        await unpublishCurrentVideo();
        releaseLocalVideoStream();

        const camera = await createCameraStream(
          selectedVideoInputId.value
            ? { video: { deviceId: selectedVideoInputId.value } }
            : undefined
        );

        localVideoStream.value = camera;
        localVideoPublication.value = await localMember.value.publish(camera, {
          metadata: JSON.stringify({ kind: 'camera' })
        });
        attachLocalPreview(camera);
        isScreenSharing.value = false;
        syncLocalVideoTile();

        if (isBackgroundBlurred.value) {
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
        }

      } else {
        await unpublishCurrentVideo();
        releaseLocalVideoStream();

        try {
          await blurProcessor?.dispose?.();
        } catch {}
        blurProcessor = null;

        const screen = await createDisplayStream();
        localVideoStream.value = screen;
        localVideoPublication.value = await localMember.value.publish(screen, {
          metadata: JSON.stringify({ kind: 'screen' })
        });
        attachLocalPreview(screen);
        isScreenSharing.value = true;
        syncLocalVideoTile();
        await startLocalSelfCameraPreview();
      }

      try {
        if (isVideoMuted.value) await localVideoPublication.value?.disable?.();
      } catch {}

    } catch (e) {
      errorMessage.value = e?.message || String(e);
    }
  };

  // 背景ぼかしの ON / OFF 切替
  const toggleBackgroundBlur = async () => {
    const nextBlurred = !isBackgroundBlurred.value;

    if (!joined.value || !localMember.value || isScreenSharing.value) {
      isBackgroundBlurred.value = nextBlurred;
      return;
    }

    try {
      if (isBackgroundBlurred.value) {
        await disableBackgroundBlur({
          localMember,
          localVideoPublication,
          localVideoStream,
          localVideoEl,
          selectedVideoInputId
        }, blurProcessor);

        blurProcessor = null;
        isBackgroundBlurred.value = false;

      } else {
        const ret = await enableBackgroundBlur({
          localMember,
          localVideoPublication,
          localVideoStream,
          localVideoEl
        });

        blurProcessor = ret?.processor ?? null;
        isBackgroundBlurred.value = true;
      }
      await updateLocalVideoPublicationMetadata('camera');
      attachLocalPreview(localVideoStream.value);
      syncLocalVideoTile();

      try {
        if (isVideoMuted.value) await localVideoPublication.value?.disable?.();
      } catch {}

    } catch (e) {
      errorMessage.value = e?.message || String(e);
    }
  };

  // RNNoise の有効 / 無効を切り替える
  const toggleRnnoise = async () => {
    isRnnoiseEnabled.value = !isRnnoiseEnabled.value;
  };

  // カメラ選択パネルの開閉と確定
  const openCameraPanel = () => {
    showCameraPanel.value = true;
    tempSelectedVideoInputId.value = selectedVideoInputId.value;
  };
  const cancelCameraPanel = () => { showCameraPanel.value = false; };
  const confirmCameraPanel = async () => {
    selectedVideoInputId.value = tempSelectedVideoInputId.value;
    showCameraPanel.value = false;
    if (isScreenSharing.value) {
      await startLocalSelfCameraPreview();
    }
  };

  // マイク選択パネルの開閉と確定
  const openMicPanel = () => {
    showMicPanel.value = true;
    tempSelectedAudioInputId.value = selectedAudioInputId.value;
  };
  const cancelMicPanel = () => { showMicPanel.value = false; };
  const confirmMicPanel = async () => {
    selectedAudioInputId.value = tempSelectedAudioInputId.value;
    showMicPanel.value = false;
  };

  // スピーカー選択パネルの開閉と確定
  const openSpeakerPanel = () => {
    showSpeakerPanel.value = true;
    tempSelectedAudioOutputId.value = selectedAudioOutputId.value;
  };
  const cancelSpeakerPanel = () => { showSpeakerPanel.value = false; };
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
  const enlargeVideo = (videoEl) => {
    uiEnlarge(videoEl);
    enlargedVideo.value = videoEl;
  };

  // 全画面表示を解除する
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
