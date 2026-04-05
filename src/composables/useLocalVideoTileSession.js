import { ensureLocalTileElement } from '../services/VideoUIService.js';
import { isScreenPublication } from './helpers/useVideoTiles.js';

/**
 * local tile / blur / metadata の glue を管理する composable。
 *
 * local preview と local tile の参照同期、および local video publication metadata 更新だけを担当し、
 * room lifecycle、remote attach/mute badge/dedupe、device panel state は担当しない。
 *
 * @param {object} params local tile/blur/metadata の同期に必要な依存。
 * @param {import('vue').Ref<any>} params.localMember local tile の memberId 同期に使う local member 参照。
 * @param {import('vue').Ref<any>} params.localVideoPublication local tile 種別判定と metadata 更新に使う local video publication 参照。
 * @param {import('vue').Ref<any>} params.localVideoStream release 対象の local video stream 参照。
 * @param {import('vue').Ref<any[]>} params.screenShareTiles local 共有タイルの同期先配列。
 * @param {import('vue').Ref<any[]>} params.cameraFilmstripTiles local カメラタイルの同期先配列。
 * @param {() => void} params.syncSelectedMainShareState 共有主表示選択の整合を維持する callback。
 * @param {(videoEl: HTMLVideoElement) => void} params.onLocalTileEnlarge local tile 拡大時の bridge callback。
 * @returns {{
 *   syncLocalVideoTile: () => void,
 *   updateLocalVideoPublicationMetadata: (kind: string) => Promise<void>,
 *   releaseLocalVideoStream: () => void,
 *   getBlurProcessor: () => any,
 *   setBlurProcessor: (nextBlurProcessor: any) => void,
 *   getLocalTileElements: () => { containerEl: HTMLDivElement | null, videoEl: HTMLVideoElement | null },
 *   setLocalTileElements: (nextElements: { containerEl: HTMLDivElement | null, videoEl: HTMLVideoElement | null }) => void,
 * }}
 * @throws {never}
 * @sideeffects local stream release、DOM 参照更新、tile 配列更新、publication metadata 更新を行う。
 * @note local tile / local preview / metadata glue に責務を限定し、room lifecycle と remote attach の責務は持ち込まない。
 */
export function useLocalVideoTileSession({
  localMember,
  localVideoPublication,
  localVideoStream,
  screenShareTiles,
  cameraFilmstripTiles,
  syncSelectedMainShareState,
  onLocalTileEnlarge,
}) {
  // 背景ぼかし ON/OFF の差し替え時に dispose 対象を保持する processor 参照。
  let blurProcessor = null;
  // ローカルタイルを再利用するためのコンテナ要素参照。attach 先の dataset 同期にも使う。
  let localTileContainerEl = null;
  // ローカルタイル内で stream attach 先になる video 要素参照。preview 再attach に使う。
  let localTileVideoEl = null;

  // leave や差し替え時に現在のローカル映像 stream を安全に解放する。
  const releaseLocalVideoStream = () => {
    try {
      localVideoStream.value?.release?.();
    } catch {}
    localVideoStream.value = null;
  };

  // local tile 要素を確保し、再利用参照を更新する。
  const ensureLocalTileRefs = () => {
    const { containerEl, videoEl } = ensureLocalTileElement({
      currentContainerEl: localTileContainerEl,
      currentVideoEl: localTileVideoEl,
      onEnlarge: onLocalTileEnlarge,
    });
    localTileContainerEl = containerEl;
    localTileVideoEl = videoEl;
    return { containerEl, videoEl };
  };

  // 現在の local video publication を local tile 配列へ反映し、共有主表示選択の整合を維持する。
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

  // local video publication metadata の kind を更新し、camera/screen の表示責務を維持する。
  const updateLocalVideoPublicationMetadata = async (kind) => {
    try {
      await localVideoPublication.value?.updateMetadata?.(JSON.stringify({ kind }));
    } catch {}
  };

  // local tile DOM 参照を localMediaSession 側へ受け渡すための accessor。
  const getLocalTileElements = () => ({
    containerEl: localTileContainerEl,
    videoEl: localTileVideoEl,
  });

  // localMediaSession 側で確保した local tile DOM 参照を反映する accessor。
  const setLocalTileElements = ({ containerEl, videoEl }) => {
    localTileContainerEl = containerEl;
    localTileVideoEl = videoEl;
  };

  // room/session 側が参照する現在の blur processor を返す accessor。
  const getBlurProcessor = () => blurProcessor;

  // room/session 側で更新した blur processor を保持する accessor。
  const setBlurProcessor = (nextBlurProcessor) => {
    blurProcessor = nextBlurProcessor;
  };

  return {
    syncLocalVideoTile,
    updateLocalVideoPublicationMetadata,
    releaseLocalVideoStream,
    getBlurProcessor,
    setBlurProcessor,
    getLocalTileElements,
    setLocalTileElements,
  };
}
