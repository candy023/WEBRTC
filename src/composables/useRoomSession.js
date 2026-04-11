import { nextTick } from 'vue';
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

const normalizeMemberDisplayName = (memberDisplayName) => {
  if (typeof memberDisplayName !== 'string') {
    return '';
  }

  return memberDisplayName.trim();
};

/**
 * room lifecycle と room event bind / unbind を管理する composable。
 *
 * join / publish / subscribe / leave の順序制御と event handler のライフサイクルだけを担当し、
 * local tile DOM 管理、remote attach 実装本体、blur/local tile の要素参照管理は担当しない。
 *
 * @param {object} params
 * @param {import('vue').Ref<string>} params.roomId room 識別子。
 * @param {import('vue').Ref<boolean>} params.roomCreated room 作成済み state。
 * @param {import('vue').Ref<boolean>} params.joining join 多重実行防止 state。
 * @param {import('vue').Ref<boolean>} params.joined join 完了 state。
 * @param {import('vue').Ref<boolean>} params.leaving leave 多重実行防止 state。
 * @param {import('vue').Ref<any>} params.localMember ローカル member 参照。
 * @param {import('vue').Ref<any>} params.localVideoPublication ローカル video publication 参照。
 * @param {import('vue').Ref<any>} params.localAudioPublication ローカル audio publication 参照。
 * @param {import('vue').Ref<any>} params.localVideoStream ローカル video stream 参照。
 * @param {import('vue').Ref<HTMLVideoElement | null>} params.localVideoEl ローカル preview 要素参照。
 * @param {import('vue').Ref<boolean>} params.isAudioMuted ローカル音声 mute state。
 * @param {import('vue').Ref<boolean>} params.isVideoMuted ローカル映像 mute state。
 * @param {import('vue').Ref<boolean>} params.isScreenSharing 画面共有 state。
 * @param {import('vue').Ref<boolean>} params.isBackgroundBlurred 背景ぼかし state。
 * @param {import('vue').Ref<boolean>} params.isRnnoiseEnabled RNNoise 有効 state。
 * @param {import('vue').Ref<string>} params.selectedVideoInputId 選択済み camera deviceId。
 * @param {import('vue').Ref<string>} params.selectedAudioInputId 選択済み mic deviceId。
 * @param {import('vue').Ref<string>} params.memberDisplayName room join 時に使う表示名。
 * @param {{ ctx: any, room: any }} params.context SkyWay Context / Room 共有参照。
 * @param {(message: string) => void} params.setErrorMessage エラー文言更新 callback。
 * @param {() => any} params.getBlurProcessor 現在の blur processor 取得 callback。
 * @param {(nextBlurProcessor: any) => void} params.setBlurProcessor blur processor 更新 callback。
 * @param {() => void} params.resetRemotePublicationsForJoin join 前の remote tracking 初期化 callback。
 * @param {(stream: any, publication: any) => Promise<void>} params.attachRemote remote attach callback。
 * @param {(pubId: string) => void} params.removePublicationTracking publication tracking 解除 callback。
 * @param {(pubId: string) => void} params.removeTileByPubId pubId 指定 tile 削除 callback。
 * @param {(publication: any) => boolean} params.isRemoteAudioPublication remote audio 判定 callback。
 * @param {(publication: any) => void} params.hideRemoteAudioMuteBadge remote audio badge 非表示 callback。
 * @param {(publication: any) => void} params.syncRemoteAudioMuteBadge remote audio badge 再同期 callback。
 * @param {(stream: any) => void} params.attachLocalPreview local preview attach callback。
 * @param {(kind: string) => Promise<void>} params.updateLocalVideoPublicationMetadata local video metadata 更新 callback。
 * @param {() => void} params.syncLocalVideoTile local tile 再同期 callback。
 * @param {() => void} params.stopLocalSelfCameraPreview self camera preview 停止 callback。
 * @param {() => void} params.cleanupRemotePublicationsForLeave leave 時の remote cleanup callback。
 * @param {() => void} params.releaseLocalVideoStream ローカル video stream 解放 callback。
 * @param {(memberId: string, vadLevel: number) => void} [params.onLocalVadValue] ローカル VAD 値受信 callback。
 * @param {(memberId: string, audioStream: any) => void} [params.onJoinCompleted] join 完了後 callback。
 * @param {() => void} [params.onLeaveFinally] leave finally callback。
 * @returns {{
 *   createRoom: () => Promise<void>,
 *   joinRoom: () => Promise<void>,
 *   leaveRoom: () => Promise<void>,
 * }}
 * @throws {never}
 * @sideeffects SkyWay 接続、publish/subscribe、room event bind/unbind、join/leave state 更新を行う。
 * @note 担当範囲は room lifecycle と event bind/unbind のみ。local tile DOM 管理と remote attach 実装本体は呼び出し側 callback へ委譲する。
 */
export function useRoomSession({
  roomId,
  roomCreated,
  joining,
  joined,
  leaving,
  localMember,
  localVideoPublication,
  localAudioPublication,
  localVideoStream,
  localVideoEl,
  isAudioMuted,
  isVideoMuted,
  isScreenSharing,
  isBackgroundBlurred,
  isRnnoiseEnabled,
  selectedVideoInputId,
  selectedAudioInputId,
  memberDisplayName,
  context,
  setErrorMessage,
  getBlurProcessor,
  setBlurProcessor,
  resetRemotePublicationsForJoin,
  attachRemote,
  removePublicationTracking,
  removeTileByPubId,
  isRemoteAudioPublication,
  hideRemoteAudioMuteBadge,
  syncRemoteAudioMuteBadge,
  attachLocalPreview,
  updateLocalVideoPublicationMetadata,
  syncLocalVideoTile,
  stopLocalSelfCameraPreview,
  cleanupRemotePublicationsForLeave,
  releaseLocalVideoStream,
  onLocalVadValue = () => {},
  onJoinCompleted = () => {},
  onLeaveFinally = () => {},
}) {
  // onStreamPublished の購読解除に使う handler 参照。join/leave 境界で必ず reset する。
  let streamPublishedHandler = null;
  // onStreamUnpublished の購読解除に使う handler 参照。join/leave 境界で必ず reset する。
  let streamUnpublishedHandler = null;
  // onPublicationEnabled の購読解除に使う handler 参照。remote audio badge 同期の解除に使う。
  let publicationEnabledHandler = null;
  // onPublicationDisabled の購読解除に使う handler 参照。remote audio badge 同期の解除に使う。
  let publicationDisabledHandler = null;
  // join 中に作成した RNNoise ハンドル。leave 時の cleanup でのみ参照する。
  let rnnoiseHandle = null;

  // join 後に既存 mute state を publication へ再反映し、UI と publish state の不一致を防ぐ。
  const reflectInitialMuteState = async () => {
    try {
      if (isVideoMuted.value) await localVideoPublication.value?.disable?.();
    } catch {}
    try {
      if (isAudioMuted.value) await localAudioPublication.value?.disable?.();
    } catch {}
  };

  // room event handler の bind 状態を join/leave 境界で揃えるため、登録済み handler を一括解除する。
  const clearRoomEventHandlers = () => {
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
  };

  // roomId を使って room を準備し、create 済み state を更新する。
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

  // room 参加、local publish、existing/new publication 購読開始を順序どおりに実行する。
  const joinRoom = async () => {
    if (joining.value || joined.value) return;

    const nextMemberDisplayName = normalizeMemberDisplayName(memberDisplayName.value);
    if (!nextMemberDisplayName) {
      setErrorMessage('入室前にニックネームを設定してください。');
      return;
    }

    joining.value = true;

    try {
      if (!roomCreated.value || !context.room) await createRoom();
      resetRemotePublicationsForJoin();

      const member = await skywayJoin(context.room, nextMemberDisplayName);
      localMember.value = member;

      clearRoomEventHandlers();

      // 新規 publication 通知での subscribe 経路。self publication は除外して remote attach だけを委譲する。
      const onStreamPublished = async (stream, publication) => {
        try {
          if (publication?.publisher?.id && member?.id && publication.publisher.id === member.id) return;
          await attachRemote(stream, publication);
        } catch (err) {
          console.warn('配信の受信処理に失敗:', err);
        }
      };

      // unpublish 通知での cleanup 経路。remote audio badge と pubId tracking/tile を同期して破棄する。
      const onStreamUnpublished = async (event) => {
        const publication = event?.publication;
        if (!publication?.id) return;
        if (isRemoteAudioPublication(publication)) {
          hideRemoteAudioMuteBadge(publication);
        }
        removePublicationTracking(publication.id);
        removeTileByPubId(publication.id);
      };

      // publication enabled 通知で remote audio badge を再同期する callback。
      const onPublicationEnabled = (event) => {
        syncRemoteAudioMuteBadge(event?.publication);
      };

      // publication disabled 通知で remote audio badge を再同期する callback。
      const onPublicationDisabled = (event) => {
        syncRemoteAudioMuteBadge(event?.publication);
      };

      streamPublishedHandler = bindOnStreamPublished(
        context.room,
        member,
        onStreamPublished
      );
      streamUnpublishedHandler = bindOnStreamUnpublished(context.room, onStreamUnpublished);
      publicationEnabledHandler = onPublicationEnabled;
      publicationDisabledHandler = onPublicationDisabled;
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
        rnnoiseHandle = await setupRnnoise(selectedAudioInputId.value, {
          onVad: (vadLevel) => {
            onLocalVadValue(localMember.value?.id || member?.id || '', vadLevel);
          },
        });
        audioConstraints = rnnoiseHandle.constraints;
      }

      const audioStream = await createMicrophoneStream(audioConstraints);
      const publications = await publishLocal(member, {
        videoStream,
        audioStream
      });

      localVideoPublication.value = publications.videoPub;
      localAudioPublication.value = publications.audioPub;
      await updateLocalVideoPublicationMetadata('camera');

      joined.value = true;
      await nextTick();

      attachLocalPreview(localVideoStream.value);
      await reflectInitialMuteState();
      syncLocalVideoTile();

      if (isBackgroundBlurred.value && !isScreenSharing.value) {
        const blurred = await enableBackgroundBlur({
          localMember,
          localVideoPublication,
          localVideoStream,
          localVideoEl
        });
        setBlurProcessor(blurred?.processor ?? null);
        await updateLocalVideoPublicationMetadata('camera');
        attachLocalPreview(localVideoStream.value);
        syncLocalVideoTile();

        try {
          if (isVideoMuted.value) await localVideoPublication.value?.disable?.();
        } catch {}
      }

      await subscribeExisting(context.room, member, async (stream, publication) => {
        await attachRemote(stream, publication);
      });
      onJoinCompleted(localMember.value?.id || '', audioStream);

    } catch (error) {
      setErrorMessage(error?.message || String(error));
    } finally {
      joining.value = false;
    }
  };

  // room 退出時に event unbind、media/preview cleanup、join 関連 state reset を順序どおりに実行する。
  const leaveRoom = async () => {
    if (!joined.value || leaving.value) return;
    leaving.value = true;

    try {
      clearRoomEventHandlers();

      stopLocalSelfCameraPreview();
      await skywayLeave(localMember.value);

      cleanupRemotePublicationsForLeave();

      try { localVideoEl.value?.pause?.(); } catch {}
      try {
        if (localVideoEl.value) localVideoEl.value.srcObject = null;
      } catch {}

      releaseLocalVideoStream();

      try {
        await getBlurProcessor()?.dispose?.();
      } catch {}
      setBlurProcessor(null);

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

    } catch (error) {
      setErrorMessage(error?.message || String(error));
    } finally {
      onLeaveFinally();
      leaving.value = false;
    }
  };

  return {
    createRoom,
    joinRoom,
    leaveRoom,
  };
}
