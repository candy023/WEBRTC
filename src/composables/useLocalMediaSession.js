import { nextTick } from 'vue';
import {
  createCameraStream,
  createDisplayStream,
  enableBackgroundBlur,
  disableBackgroundBlur,
} from '../services/MediaStreamService.js';
import { ensureLocalTileElement } from '../services/VideoUIService.js';

/**
 * ローカル映像/画面共有/背景ぼかしに関するセッション処理をまとめる。
 *
 * @param {object} params
 * @param {import('vue').Ref<boolean>} params.joined room 参加状態。
 * @param {import('vue').Ref<any>} params.localMember ローカル member。
 * @param {import('vue').Ref<any>} params.localVideoPublication ローカル video publication。
 * @param {import('vue').Ref<any>} params.localVideoStream ローカル video stream。
 * @param {import('vue').Ref<HTMLVideoElement | null>} params.localVideoEl ローカルプレビュー用 video 要素。
 * @param {import('vue').Ref<any>} params.localSelfCameraPreviewStream 画面共有中の自分カメラ preview stream。
 * @param {import('vue').Ref<HTMLVideoElement | null>} params.localSelfCameraPreviewEl 画面共有中の自分カメラ preview 要素。
 * @param {import('vue').Ref<string>} params.selectedVideoInputId 選択中カメラ deviceId。
 * @param {import('vue').Ref<boolean>} params.isScreenSharing 画面共有状態。
 * @param {import('vue').Ref<boolean>} params.isBackgroundBlurred 背景ぼかし状態。
 * @param {import('vue').Ref<boolean>} params.isVideoMuted ローカル video mute 状態。
 * @param {(message: string) => void} params.setErrorMessage 失敗時エラーメッセージの反映先。
 * @param {(pubId: string | null) => void} params.removeTileByPubId pubId 指定タイルの削除処理。
 * @param {() => void} params.syncLocalVideoTile ローカル video タイル再同期処理。
 * @param {(kind: string) => Promise<void>} params.updateLocalVideoPublicationMetadata publication metadata 更新処理。
 * @param {() => void} params.releaseLocalVideoStream ローカル video stream 解放処理。
 * @param {() => any} params.getBlurProcessor 現在の blur processor 取得関数。
 * @param {(nextProcessor: any) => void} params.setBlurProcessor blur processor 更新関数。
 * @param {() => { containerEl: HTMLDivElement | null, videoEl: HTMLVideoElement | null }} params.getLocalTileElements ローカルタイル要素取得関数。
 * @param {(nextElements: { containerEl: HTMLDivElement | null, videoEl: HTMLVideoElement | null }) => void} params.setLocalTileElements ローカルタイル要素更新関数。
 * @param {(videoEl: HTMLVideoElement) => void} params.onLocalTileEnlarge ローカルタイル拡大処理。
 * @returns {{
 *   unpublishCurrentVideo: () => Promise<void>,
 *   attachLocalPreview: (stream: any) => void,
 *   stopLocalSelfCameraPreview: () => void,
 *   startLocalSelfCameraPreview: () => Promise<void>,
 *   screenShare: () => Promise<void>,
 *   toggleBackgroundBlur: () => Promise<void>,
 * }}
 * @throws {never}
 * @sideeffects SkyWay publication の publish/unpublish、stream の attach/release、DOM 要素更新を行う
 */
export function useLocalMediaSession({
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
  onLocalTileEnlarge,
}) {
  const ensureLocalTileRefs = () => {
    const currentTileElements = getLocalTileElements();
    const ensuredTileElements = ensureLocalTileElement({
      currentContainerEl: currentTileElements.containerEl,
      currentVideoEl: currentTileElements.videoEl,
      onEnlarge: onLocalTileEnlarge,
    });
    setLocalTileElements({
      containerEl: ensuredTileElements.containerEl,
      videoEl: ensuredTileElements.videoEl,
    });
    return ensuredTileElements;
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

      const ensuredTileElements = ensureLocalTileRefs();
      if (ensuredTileElements.videoEl) {
        stream.attach(ensuredTileElements.videoEl);
        ensuredTileElements.videoEl.play?.().catch(() => {});
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
          const backgroundBlurResult = await enableBackgroundBlur({
            localMember,
            localVideoPublication,
            localVideoStream,
            localVideoEl
          });
          setBlurProcessor(backgroundBlurResult?.processor ?? null);
          await updateLocalVideoPublicationMetadata('camera');
          attachLocalPreview(localVideoStream.value);
          syncLocalVideoTile();
        }

      } else {
        await unpublishCurrentVideo();
        releaseLocalVideoStream();

        try {
          await getBlurProcessor()?.dispose?.();
        } catch {}
        setBlurProcessor(null);

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
      setErrorMessage(e?.message || String(e));
    }
  };

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
        }, getBlurProcessor());

        setBlurProcessor(null);
        isBackgroundBlurred.value = false;

      } else {
        const backgroundBlurResult = await enableBackgroundBlur({
          localMember,
          localVideoPublication,
          localVideoStream,
          localVideoEl
        });

        setBlurProcessor(backgroundBlurResult?.processor ?? null);
        isBackgroundBlurred.value = true;
      }
      await updateLocalVideoPublicationMetadata('camera');
      attachLocalPreview(localVideoStream.value);
      syncLocalVideoTile();

      try {
        if (isVideoMuted.value) await localVideoPublication.value?.disable?.();
      } catch {}

    } catch (e) {
      setErrorMessage(e?.message || String(e));
    }
  };

  return {
    unpublishCurrentVideo,
    attachLocalPreview,
    stopLocalSelfCameraPreview,
    startLocalSelfCameraPreview,
    screenShare,
    toggleBackgroundBlur,
  };
}
