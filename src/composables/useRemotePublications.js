import { ref, nextTick } from 'vue';
import {
  attachRemoteStream,
  setRemoteAudioMuteBadgeVisible,
} from '../services/VideoUIService.js';
import {
  parsePublicationDisplayName,
  isVideoStream,
  removeTileFromList,
  syncSelectedMainShare,
  upsertVideoTile,
} from './helpers/useVideoTiles.js';

/**
 * remote publication の受信重複防止、DOM attach、tile 同期を管理する composable。
 *
 * `subscribeExisting` と `onStreamPublished` から渡される publication を同一ロジックで扱い、
 * attach 成功時だけ受信済みとして確定することで late join と初回表示を保護する。
 *
 * @param {object} params remote 管理に必要な依存。
 * @param {import('vue').Ref<HTMLElement|null>} params.streamArea remote attach 先の DOM コンテナ。
 * @param {import('vue').Ref<any>} params.localMember self publication 判定に使う local member。
 * @param {import('vue').Ref<string>} params.selectedAudioOutputId remote audio attach 時の出力先 deviceId。
 * @param {() => any} params.getCurrentRoom 現在の room 参照を取得する callback。
 * @param {(memberId: string, stream: any, publication: any) => void} [params.onRemoteAudioAttached] remote audio attach 完了時 callback。
 * @param {(memberId: string, publication: any) => void} [params.onRemoteAudioPublicationRemoved] remote audio publication removal 時 callback。
 * @returns {{
 *   remoteVideos: import('vue').Ref<any[]>,
 *   screenShareTiles: import('vue').Ref<any[]>,
 *   selectedMainSharePubId: import('vue').Ref<string | null>,
 *   cameraFilmstripTiles: import('vue').Ref<any[]>,
 *   syncSelectedMainShareState: () => void,
 *   removeTileByPubId: (pubId: string) => void,
 *   isRemoteAudioPublication: (publication: any) => boolean,
 *   syncRemoteAudioMuteBadge: (publication: any) => void,
 *   syncRemoteAudioMuteBadgeByMemberId: (memberId: string) => void,
 *   hideRemoteAudioMuteBadge: (publication: any) => void,
 *   attachRemote: (stream: any, pub: any) => Promise<void>,
 *   removePublicationTracking: (pubId: string) => void,
 *   resetRemotePublicationsForJoin: () => void,
 *   cleanupRemotePublicationsForLeave: () => void,
 * }}
 * @throws {never}
 * @sideeffects remote stream の DOM attach / remove、tile 配列更新、mute badge 更新、重複防止 state 更新を行う。
 * @note attach 先 DOM 未準備時の `nextTick` retry を残し、表示成功前の受信確定を避ける。
 */
export function useRemotePublications({
  streamArea,
  localMember,
  selectedAudioOutputId,
  getCurrentRoom,
  onRemoteAudioAttached = () => {},
  onRemoteAudioPublicationRemoved = () => {},
}) {
  // attach 開始前に streamArea mount を待機し、初回 join 直後の DOM 未準備を吸収する。
  const waitForStreamAreaReady = async () => {
    if (streamArea.value) return streamArea.value;

    for (let i = 0; i < 10; i += 1) {
      await nextTick();
      if (streamArea.value) return streamArea.value;

      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      if (streamArea.value) return streamArea.value;
    }

    return streamArea.value;
  };

  // 生成済み remote 要素を保持する配列。leave 時の一括 remove と fallback 探索に使う。
  const remoteVideos = ref([]);
  // 共有画面タイルの一覧。主表示対象の選択同期と画面共有帯の描画に使う。
  const screenShareTiles = ref([]);
  // 現在の主表示共有 pubId。共有削除時のフォールバック判定に使う。
  const selectedMainSharePubId = ref(null);
  // 参加者カメラタイルの一覧。フィルムストリップ描画と削除同期に使う。
  const cameraFilmstripTiles = ref([]);

  // 受信済み publication ID の集合。重複 subscribe を防ぎつつ初回表示確定後にのみ記録する。
  const receivedPublicationIds = new Set();
  // attach 処理中 publication ID の集合。新規通知との並行実行による二重 attach を防ぐ。
  const pendingPublicationIds = new Set();

  // 共有タイル一覧と主表示 pubId を同期し、削除後も UI 側が有効な共有を参照できるようにする。
  const syncSelectedMainShareState = () => {
    selectedMainSharePubId.value = syncSelectedMainShare(
      selectedMainSharePubId.value,
      screenShareTiles.value
    );
  };

  // remote tile 表示名は publication metadata の displayName を最優先にする。
  const resolveRemoteTileLabel = (publication) => {
    const metadataDisplayName = parsePublicationDisplayName(publication);
    if (metadataDisplayName) {
      return metadataDisplayName;
    }

    return publication?.publisher?.name || publication?.publisher?.id || '参加者';
  };

  // 指定 pubId の tile 要素を共有帯/カメラ帯から除去し、関連 DOM と参照配列を同期する。
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

  // publication が remote 音声かどうかを判定し、self publication を mute badge 更新対象から除外する。
  const isRemoteAudioPublication = (publication) => {
    if (!publication) return false;
    if (publication.contentType !== 'audio') return false;

    const publisherId = publication.publisher?.id;
    if (!publisherId) return false;
    if (localMember.value?.id && publisherId === localMember.value.id) return false;

    return true;
  };

  // remote 音声 publication の現在 state を mute badge へ反映する。
  const syncRemoteAudioMuteBadge = (publication) => {
    if (!isRemoteAudioPublication(publication)) return;

    setRemoteAudioMuteBadgeVisible(
      streamArea.value,
      publication.publisher.id,
      publication.state === 'disabled'
    );
  };

  // 指定 member の音声 publication state を room から再取得し、mute badge を再同期する。
  const syncRemoteAudioMuteBadgeByMemberId = (memberId) => {
    if (!memberId) return;

    const currentRoom = getCurrentRoom();
    if (!currentRoom) return;

    const memberAudioPublication = (currentRoom.publications ?? []).find(
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

  // publication 削除イベント時に該当 member の mute badge を非表示へ戻す。
  const hideRemoteAudioMuteBadge = (publication) => {
    if (!isRemoteAudioPublication(publication)) return;

    setRemoteAudioMuteBadgeVisible(streamArea.value, publication.publisher.id, false);
    onRemoteAudioPublicationRemoved(publication.publisher.id, publication);
  };

  // remote publication を attach し、受信重複防止・tile upsert・pubId 付与を一貫して行う。
  const attachRemote = async (stream, pub) => {
    if (!pub?.id) return;
    if (receivedPublicationIds.has(pub.id)) return;
    if (pendingPublicationIds.has(pub.id)) return;
    pendingPublicationIds.add(pub.id);

    try {
      await waitForStreamAreaReady();

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

      if (!isVideoStream(stream)) {
        if (isRemoteAudioPublication(pub)) {
          onRemoteAudioAttached(pub?.publisher?.id || '', stream, pub);
        }
        return;
      }

      const tile = {
        pubId: pub.id,
        memberId: pub?.publisher?.id || '',
        label: resolveRemoteTileLabel(pub),
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

  // publication 削除時の追跡状態を解除し、再配信時に再度受信できるようにする。
  const removePublicationTracking = (pubId) => {
    if (!pubId) return;
    receivedPublicationIds.delete(pubId);
    pendingPublicationIds.delete(pubId);
  };

  // join 開始前に remote 受信追跡状態と tile 状態を初期化する。
  const resetRemotePublicationsForJoin = () => {
    receivedPublicationIds.clear();
    pendingPublicationIds.clear();
    screenShareTiles.value = [];
    cameraFilmstripTiles.value = [];
    selectedMainSharePubId.value = null;
  };

  // leave 時に remote DOM を解放し、remote publication/tile 状態を完全初期化する。
  const cleanupRemotePublicationsForLeave = () => {
    remoteVideos.value.forEach((el) => {
      try {
        el?.remove?.();
      } catch {}
    });
    remoteVideos.value = [];
    receivedPublicationIds.clear();
    pendingPublicationIds.clear();
    screenShareTiles.value = [];
    cameraFilmstripTiles.value = [];
    selectedMainSharePubId.value = null;
  };

  return {
    remoteVideos,
    screenShareTiles,
    selectedMainSharePubId,
    cameraFilmstripTiles,
    syncSelectedMainShareState,
    removeTileByPubId,
    isRemoteAudioPublication,
    syncRemoteAudioMuteBadge,
    syncRemoteAudioMuteBadgeByMemberId,
    hideRemoteAudioMuteBadge,
    attachRemote,
    removePublicationTracking,
    resetRemotePublicationsForJoin,
    cleanupRemotePublicationsForLeave,
  };
}
