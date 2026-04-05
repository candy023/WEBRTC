import { SkyWayStreamFactory } from '@skyway-sdk/room';
import { BlurBackground, VirtualBackground } from 'skyway-video-processors';

/**
 * この service はローカルの音声・映像 stream の生成と解放、
 * そして publication 更新時の差し替え手順をまとめる責務を持つ。
 */

/**
 * 選択中のカメラから素の映像 stream を生成する。
 */
export async function createCameraStream(options) {
  return SkyWayStreamFactory.createCameraVideoStream(options);
}

/**
 * 選択中のマイクから音声 stream を生成する。
 */
export async function createMicrophoneStream(options) {
  return SkyWayStreamFactory.createMicrophoneAudioStream(options);
}

/**
 * 画面共有用の映像 stream を生成する。
 */
export async function createDisplayStream() {
  const { video } = await SkyWayStreamFactory.createDisplayStreams({
    audio: false,
    video: { displaySurface: 'monitor' },
  });

  return video;
}

/**
 * 背景ぼかし用の processor を初期化し、local video publication を処理済み stream へ差し替える。
 *
 * @param {object} state
 * @param {import('vue').Ref<any>} state.localMember publish/unpublish を実行する local member。
 * @param {import('vue').Ref<any>} state.localVideoPublication 差し替え対象の local video publication。
 * @param {import('vue').Ref<any>} state.localVideoStream 差し替え対象の local video stream。
 * @param {import('vue').Ref<HTMLVideoElement | null>} state.localVideoEl ローカル preview の再attach先。
 * @returns {Promise<{ processor: any | null }>}
 * @throws {never}
 * @sideeffects unpublish/publish、stream release、preview attach を実行する。
 */
export async function enableBackgroundBlur(state) {
  const {
    localMember,
    localVideoPublication,
    localVideoStream,
    localVideoEl,
  } = state;

  if (!localMember?.value) return { processor: null };

  if (localVideoPublication?.value) {
    await localMember.value.unpublish(localVideoPublication.value);
  }

  if (localVideoStream?.value) {
    localVideoStream.value.release?.();
  }

  // 差し替え後も呼び出し側で dispose できるよう processor を返却する。
  const processor = new BlurBackground();
  await processor.initialize();

  const processedVideo = await SkyWayStreamFactory.createCustomVideoStream(processor, {
    stopTrackWhenDisabled: true,
  });

  localVideoStream.value = processedVideo;
  const videoPub = await localMember.value.publish(processedVideo);
  localVideoPublication.value = videoPub;

  if (localVideoEl?.value) {
    processedVideo.attach(localVideoEl.value);
    localVideoEl.value.play?.().catch(() => {});
  }

  return { processor };
}

/**
 * 背景ぼかしを解除し、カメラ stream を再生成して local video publication を元の経路へ戻す。
 *
 * @param {object} state
 * @param {import('vue').Ref<any>} state.localMember publish/unpublish を実行する local member。
 * @param {import('vue').Ref<any>} state.localVideoPublication 差し替え対象の local video publication。
 * @param {import('vue').Ref<any>} state.localVideoStream 差し替え対象の local video stream。
 * @param {import('vue').Ref<HTMLVideoElement | null>} state.localVideoEl ローカル preview の再attach先。
 * @param {import('vue').Ref<string>} state.selectedVideoInputId カメラ再生成時に使う deviceId。
 * @param {any} processor 現在有効な背景ぼかし processor。dispose 対象。
 * @returns {Promise<void>}
 * @throws {never}
 * @sideeffects unpublish/publish、stream release、processor dispose、preview attach を実行する。
 */
export async function disableBackgroundBlur(state, processor) {
  const {
    localMember,
    localVideoPublication,
    localVideoStream,
    localVideoEl,
    selectedVideoInputId,
  } = state;

  if (!localMember?.value) return;

  if (localVideoPublication?.value) {
    await localMember.value.unpublish(localVideoPublication.value);
  }

  if (localVideoStream?.value) {
    localVideoStream.value.release?.();
  }

  try {
    await processor?.dispose?.();
  } catch {}

  const cameraStream = await createCameraStream(
    selectedVideoInputId?.value
      ? { video: { deviceId: selectedVideoInputId.value } }
      : undefined
  );

  localVideoStream.value = cameraStream;
  const videoPub = await localMember.value.publish(cameraStream);
  localVideoPublication.value = videoPub;

  if (localVideoEl?.value) {
    cameraStream.attach(localVideoEl.value);
    localVideoEl.value.play?.().catch(() => {});
  }
}

/**
 * 現在の背景エフェクト設定に応じて処理済み映像 stream を作り直す。
 * 既存 processor は先に破棄し、呼び出し側が新しい参照を保持する。
 */
export async function createProcessedVideoStream({
  effectMode,
  backgroundImageUrl,
  selectedVideoInputId,
  existingProcessor,
}) {
  await disposeVideoProcessor(existingProcessor);

  let processor;
  if (effectMode === 'blur') {
    processor = new BlurBackground();
  } else if (effectMode === 'image') {
    if (!backgroundImageUrl) {
      throw new Error('背景画像が選択されていません。');
    }
    processor = new VirtualBackground({ image: backgroundImageUrl });
  } else {
    throw new Error(`Unsupported video effect mode: ${effectMode}`);
  }

  await processor.initialize();

  const stream = await SkyWayStreamFactory.createCustomVideoStream(processor, {
    stopTrackWhenDisabled: true,
    video: selectedVideoInputId ? { deviceId: selectedVideoInputId } : undefined,
  });

  return { stream, processor };
}

/**
 * 背景 processor が残っていれば破棄する。
 */
export async function disposeVideoProcessor(processor) {
  try {
    await processor?.dispose?.();
  } catch {}
}

/**
 * SkyWay stream と underlying track の両方に対して解放処理を試みる。
 */
export function releaseLocalStream(stream) {
  if (!stream) return;

  try {
    stream.detach?.();
  } catch {}

  try {
    stream.release?.();
  } catch {}

  try {
    stream.track?.stop?.();
  } catch {}

  try {
    stream.mediaStream?.getTracks?.().forEach((track) => track.stop());
  } catch {}
}

/**
 * 映像 publication を現在の SDK 仕様に沿って更新する。
 * local publication に replaceStream が使える場合はそれを優先し、
 * publish を取り下げるケースでは unpublish にフォールバックする。
 */
export async function updatePublishedVideoPublication({ member, currentPublication, nextStream }) {
  if (!member) {
    throw new Error('Local member is not available.');
  }

  if (currentPublication && nextStream && typeof currentPublication.replaceStream === 'function') {
    // SkyWay SDK v1.15.1 exposes replaceStream on local publications.
    currentPublication.replaceStream(nextStream);
    return currentPublication;
  }

  if (currentPublication) {
    await member.unpublish(currentPublication);
  }

  if (!nextStream) {
    return null;
  }

  return member.publish(nextStream);
}
