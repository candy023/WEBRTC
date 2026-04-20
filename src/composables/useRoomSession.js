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
  releaseLocalStream,
} from '../services/MediaStreamService.js';
import { setupRnnoise } from '../services/RnnoiseService.js';

const normalizeMemberDisplayName = (memberDisplayName) => {
  if (typeof memberDisplayName !== 'string') {
    return '';
  }

  return memberDisplayName.trim();
};

const normalizeMemberJoinName = (memberJoinName) => {
  if (typeof memberJoinName !== 'string') {
    return '';
  }

  return memberJoinName.trim();
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
 * @param {import('vue').Ref<string>} params.audioNoiseSuppressionMode 音声ノイズ抑制モード state。
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
 *   replaceLocalAudioForRnnoiseToggle: () => Promise<void>,
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
  audioNoiseSuppressionMode,
  selectedVideoInputId,
  selectedAudioInputId,
  memberDisplayName,
  memberJoinName,
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
  // join 中に作成したノイズ抑制ハンドル。leave 時の cleanup に使う。
  let rnnoiseHandle = null;
  // 現在 publish 中の local audio stream。差し替え時と leave 時の解放に使う。
  let localAudioStream = null;
  // 通話中トグルの二重実行で publication 差し替え順序が崩れるのを防ぐ排他フラグ。
  let replacingLocalAudioForRnnoiseToggle = false;

  // join 後に既存 mute state を publication へ再反映し、UI と publish state の不一致を防ぐ。
  const reflectInitialMuteState = async () => {
    try {
      if (isVideoMuted.value) await localVideoPublication.value?.disable?.();
    } catch {}
    try {
      if (isAudioMuted.value) await localAudioPublication.value?.disable?.();
    } catch {}
  };

  const cleanupRnnoiseHandle = async (handle) => {
    try {
      await handle?.cleanup?.();
    } catch {}
  };

  // join 時の local audio 生成経路。suppressor 成功時と標準フォールバックをここで統一する。
  const createLocalAudioStream = async () => {
    // service 返却 constraints が無い場合だけ使う標準マイク制約。
    let audioConstraints = {
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
        ...(selectedAudioInputId.value ? { deviceId: selectedAudioInputId.value } : {}),
      }
    };

    // join 中に生成した suppressor リソースを leave/join 失敗 cleanup へ渡すハンドル。
    const selectedAudioNoiseSuppressionMode = audioNoiseSuppressionMode.value;
    const nextRnnoiseHandle = await setupRnnoise(selectedAudioInputId.value, {
      mode: selectedAudioNoiseSuppressionMode,
    });

    if (nextRnnoiseHandle?.audioStream) {
      console.info('[audio] join/createLocalAudioStream: using web-noise-suppressor path');
      return {
        audioStream: nextRnnoiseHandle.audioStream,
        nextRnnoiseHandle,
      };
    }

    if (nextRnnoiseHandle?.constraints) {
      audioConstraints = nextRnnoiseHandle.constraints;
    }

    if (selectedAudioNoiseSuppressionMode === 'suppressor') {
      console.info('[audio] join/createLocalAudioStream: suppressor unavailable, using browser-standard microphone path');
    } else {
      console.info(`[audio] join/createLocalAudioStream: mode=${selectedAudioNoiseSuppressionMode}, using browser-standard microphone path`);
    }

    const audioStream = await createMicrophoneStream(audioConstraints);

    return {
      audioStream,
      nextRnnoiseHandle,
    };
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

    // SkyWay の member.name 制約を満たす join 専用内部名。UI 表示名とは責務を分離する。
    const nextMemberJoinName = normalizeMemberJoinName(memberJoinName.value);
    if (!nextMemberJoinName) {
      setErrorMessage('ログイン状態を確認できませんでした。再ログインしてください。');
      return;
    }

    joining.value = true;

    try {
      if (!roomCreated.value || !context.room) await createRoom();
      resetRemotePublicationsForJoin();

      const member = await skywayJoin(context.room, nextMemberJoinName);
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

      const createdAudio = await createLocalAudioStream();
      const audioStream = createdAudio.audioStream;
      rnnoiseHandle = createdAudio.nextRnnoiseHandle;
      localAudioStream = audioStream;

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
      releaseLocalStream(localAudioStream);
      localAudioStream = null;
      await cleanupRnnoiseHandle(rnnoiseHandle);
      rnnoiseHandle = null;
      setErrorMessage(error?.message || String(error));
    } finally {
      joining.value = false;
    }
  };

  // joined 中に RNNoise ON/OFF が切り替わった場合だけ local audio publication を即時差し替える。
  const replaceLocalAudioForRnnoiseToggle = async () => {
    if (!joined.value) return;
    if (replacingLocalAudioForRnnoiseToggle) {
      throw new Error('ノイズ抑制の切り替え処理が実行中です。');
    }

    replacingLocalAudioForRnnoiseToggle = true;

    // 差し替え候補として先に生成する次の local audio stream と suppressor handle。
    let nextAudioStream = null;
    let nextRnnoiseHandle = null;
    // 失敗時に現在通話へ戻すために保持する rollback 用の publication/stream/handle。
    const prevAudioPublication = localAudioPublication.value;
    const prevAudioStream = localAudioStream;
    const prevRnnoiseHandle = rnnoiseHandle;
    // replaceStream 非対応時に unpublish 済みかを記録し、失敗時の復旧可否判定に使う。
    let unpublishedPrevPublication = false;

    try {
      const createdAudio = await createLocalAudioStream();
      nextAudioStream = createdAudio.audioStream;
      nextRnnoiseHandle = createdAudio.nextRnnoiseHandle;

      if (!nextAudioStream) {
        throw new Error('ローカル音声ストリームの作成に失敗しました。');
      }

      let nextAudioPublication = prevAudioPublication;

      // replaceStream が使える場合は publication を維持したままストリームだけ差し替える。
      if (prevAudioPublication && typeof prevAudioPublication.replaceStream === 'function') {
        await Promise.resolve(prevAudioPublication.replaceStream(nextAudioStream));
      } else {
        if (!localMember.value) {
          throw new Error('Local member is not available.');
        }
        if (prevAudioPublication) {
          await localMember.value.unpublish(prevAudioPublication);
          unpublishedPrevPublication = true;
        }
        nextAudioPublication = await localMember.value.publish(nextAudioStream);
      }

      if (!nextAudioPublication) {
        throw new Error('ローカル音声 publication の差し替えに失敗しました。');
      }

      localAudioPublication.value = nextAudioPublication;
      localAudioStream = nextAudioStream;
      rnnoiseHandle = nextRnnoiseHandle;

      if (isAudioMuted.value) {
        await localAudioPublication.value?.disable?.();
      }

      releaseLocalStream(prevAudioStream);
      await cleanupRnnoiseHandle(prevRnnoiseHandle);
    } catch (error) {
      releaseLocalStream(nextAudioStream);
      await cleanupRnnoiseHandle(nextRnnoiseHandle);

      if (unpublishedPrevPublication && prevAudioStream && localMember.value) {
        try {
          const restoredAudioPublication = await localMember.value.publish(prevAudioStream);
          localAudioPublication.value = restoredAudioPublication;
          if (isAudioMuted.value) {
            await restoredAudioPublication?.disable?.();
          }
        } catch (restoreError) {
          console.warn('[audio] failed to restore previous local audio publication after toggle failure:', restoreError);
        }
      }

      throw error;
    } finally {
      replacingLocalAudioForRnnoiseToggle = false;
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

      releaseLocalStream(localAudioStream);
      localAudioStream = null;
      await cleanupRnnoiseHandle(rnnoiseHandle);
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
    replaceLocalAudioForRnnoiseToggle,
    leaveRoom,
  };
}
