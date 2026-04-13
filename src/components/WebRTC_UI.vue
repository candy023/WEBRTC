<script setup>
// このコンポーネントは UI 表示に専念します。
// - 実際の WebRTC / SkyWay の接続やメディア処理は `useStreamReceiver` と各 services に委譲しています。
// - ここでは「なぜその ref/関数が必要か」を示すコメントを残し、UI 側の意図を明確にします。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { useStreamReceiver } from '../composables/useStreamReceiver.js';

// fixed room view から渡される UI/遷移ポリシー。既存利用を壊さないため既定値を持たせる。
const props = defineProps({
  allowCreateRoomUi: {
    type: Boolean,
    default: true,
  },
  requiresLeaveOnBack: {
    type: Boolean,
    default: false,
  },
  enterButtonLabelJa: {
    type: String,
    default: '参加',
  },
  showUrlShareUi: {
    type: Boolean,
    default: true,
  },
});

const {
  // `streamArea`: remote 映像が差し込まれるコンテナ。VideoUIService が DOM を生成してここに挿入します。
  streamArea,
  // ルーム作成・参加状態（UI の表示制御と、重複アクション防止のためのフラグ）
  roomCreated,
  roomId,
  joining,
  joined,
  // SkyWay の participant オブジェクト。サービス側の内部操作で参照されるが UI は存在確認やデバッグ表示に利用
  localMember,
  // エラー表示用。サービス層で発生したエラー理由をここに設定し、UI は表示に専念する
  errorMessage,
  // VideoUIService が挿入した remote タイルの参照リスト。UI 側でのクリーンアップに利用
  remoteVideos,
  screenShareTiles,
  selectedMainSharePubId,
  cameraFilmstripTiles,
  // ローカルプレビューの video 要素。UI が直接 DOM 参照を持つ理由は、サービス側で attach するため
  localVideoEl,
  localSelfCameraPreviewEl,
  leaving,
  // ミュート・共有・背景ぼかしなど UI 表示用フラグ。実際のトグル処理はサービス側で行うためここでは同期表示用途に限定
  isAudioMuted,
  isVideoMuted,
  isScreenSharing,
  isBackgroundBlurred,
  // パネルの表示トグル（URL 共有、設定など）: UI の開閉状態管理に使う
  showShareOpen,
  showSettingsOpen,
  // デバイスリストと選択状態（UI 側の選択肢表示と確定操作のために useStreamReceiver が提供）
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
  // 共有用 URL のベース。UI はこれを組み立てて表示するだけ（ロジックはここに集約）
  baseUrl,
  // RNNoise 等の重い初期化はサービス側で行うため、UI は ON/OFF のフラグのみ保持
  isRnnoiseEnabled,
  // 以下の関数は UI から呼び出す「アクション」。それぞれサービス層の処理をトリガーする薄いラッパーです。
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
  getRemoteParticipantVolume,
  setRemoteParticipantVolume,
} = useStreamReceiver();

const selectedMainShareTile = computed(() => {
  if (!selectedMainSharePubId.value) return null;
  return screenShareTiles.value.find((tile) => tile.pubId === selectedMainSharePubId.value) || null;
});

const shareTilesForList = computed(() => {
  return screenShareTiles.value;
});

const isViewingShare = computed(() => {
  return selectedMainSharePubId.value !== null;
});

const shouldShowShareList = computed(() => {
  if (!screenShareTiles.value.length) return false;
  if (!isViewingShare.value) return true;
  return screenShareTiles.value.length > 1;
});

const hasMainShare = computed(() => {
  return !!selectedMainShareTile.value;
});

const hasShareTiles = computed(() => {
  return screenShareTiles.value.length > 0;
});

const selectedMainCameraMemberId = ref(null);
const isMobileViewport = ref(false);
const participantMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  memberId: '',
  pubId: '',
  isLocal: false,
  volumeOpen: false,
});

const selectedMainCameraTile = computed(() => {
  if (!selectedMainCameraMemberId.value) return null;
  return cameraFilmstripTiles.value.find((tile) => tile.memberId === selectedMainCameraMemberId.value) || null;
});

const hasMainCamera = computed(() => {
  return !hasShareTiles.value && !!selectedMainCameraTile.value;
});

const hasMainDisplay = computed(() => {
  return hasMainShare.value || hasMainCamera.value;
});

const cameraTilesForList = computed(() => {
  if (!hasMainCamera.value || !selectedMainCameraMemberId.value) {
    return cameraFilmstripTiles.value;
  }

  return cameraFilmstripTiles.value.filter((tile) => tile.memberId !== selectedMainCameraMemberId.value);
});

const localSelfPreviewMenuTile = computed(() => {
  return {
    memberId: localMember.value?.id || '',
    pubId: 'local-self-preview',
    isLocal: true,
  };
});

const isMenuTargetMainCamera = computed(() => {
  if (!participantMenu.value.memberId) return false;
  return !hasShareTiles.value && participantMenu.value.memberId === selectedMainCameraMemberId.value;
});

const currentMenuVolume = computed(() => {
  if (!participantMenu.value.memberId || participantMenu.value.isLocal) {
    return 100;
  }

  return getRemoteParticipantVolume(participantMenu.value.memberId);
});

const shouldShowMobileVolumeSection = computed(() => {
  return isMobileViewport.value && !participantMenu.value.isLocal;
});

const roomLayoutClass = computed(() => {
  return hasMainDisplay.value
    ? 'space-y-4 md:space-y-5 lg:grid lg:grid-cols-5 lg:gap-3 lg:items-start lg:space-y-0'
    : 'space-y-4 md:space-y-5';
});

const shareAreaClass = computed(() => {
  return hasMainDisplay.value ? 'space-y-4 md:space-y-5 lg:col-span-4' : 'space-y-4 md:space-y-5';
});

const cameraAreaClass = computed(() => {
  return hasMainDisplay.value ? 'space-y-2 lg:col-span-1' : 'space-y-2';
});

const cameraGridClass = computed(() => {
  return hasMainDisplay.value
    ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-1'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
});

const hasLocalCameraTile = computed(() => {
  return cameraFilmstripTiles.value.some((tile) => tile?.isLocal);
});

const shouldShowSelfPreviewTile = computed(() => {
  return joined.value && isScreenSharing.value && !hasLocalCameraTile.value;
});

const cameraTileClass = (tile) => {
  if (!tile?.isLocal) return 'min-w-0';

  if (!hasMainDisplay.value) return 'min-w-0';

  return 'min-w-0 w-3/4 justify-self-start sm:w-2/3 lg:w-full lg:max-w-[180px]';
};

const applyTileVideoMode = (tile, mode) => {
  const videoEl = tile?.el?.querySelector?.('video');
  if (!videoEl) return;

  if (mode === 'main' || mode === 'share') {
    videoEl.classList.remove('object-cover');
    videoEl.classList.add('object-contain');
    return;
  }

  videoEl.classList.remove('object-contain');
  videoEl.classList.add('object-cover');
};

const mountTileElement = (host, tile, mode = 'camera') => {
  if (!host || !tile?.el) return;
  host.dataset.speakingHost = '1';
  if (tile.el.dataset?.memberId) {
    host.dataset.memberId = tile.el.dataset.memberId;
  } else {
    delete host.dataset.memberId;
  }
  if (tile.el.dataset?.pubId) {
    host.dataset.pubId = tile.el.dataset.pubId;
  } else {
    delete host.dataset.pubId;
  }
  applyTileVideoMode(tile, mode);
  if (tile.el.parentNode !== host) {
    host.replaceChildren(tile.el);
  }
};

const closeParticipantMenu = () => {
  if (!participantMenu.value.visible) return;
  participantMenu.value = {
    ...participantMenu.value,
    visible: false,
    volumeOpen: false,
  };
};

const updateMobileViewport = () => {
  if (typeof window === 'undefined') return;
  isMobileViewport.value = window.matchMedia('(max-width: 767px)').matches;
};

const openParticipantMenuWithTile = (tile, options = {}) => {
  if (!tile?.memberId) return;
  const {
    x = 0,
    y = 0,
    volumeOpen = false,
  } = options;

  participantMenu.value = {
    visible: true,
    x,
    y,
    memberId: tile.memberId,
    pubId: tile.pubId || '',
    isLocal: !!tile.isLocal,
    volumeOpen: !tile.isLocal && volumeOpen,
  };
};

const openParticipantMenu = (event, tile) => {
  if (isMobileViewport.value) return;
  openParticipantMenuWithTile(tile, {
    x: event?.clientX ?? 0,
    y: event?.clientY ?? 0,
  });
};

const openParticipantSheet = (tile) => {
  if (!isMobileViewport.value) return;
  openParticipantMenuWithTile(tile, {
    volumeOpen: !tile?.isLocal,
  });
};

const pinParticipantAsMain = () => {
  if (hasShareTiles.value || !participantMenu.value.memberId) return;
  selectedMainCameraMemberId.value = participantMenu.value.memberId;
  closeParticipantMenu();
};

const clearMainParticipant = () => {
  selectedMainCameraMemberId.value = null;
  closeParticipantMenu();
};

const toggleVolumeMenu = () => {
  if (participantMenu.value.isLocal) return;
  participantMenu.value = {
    ...participantMenu.value,
    volumeOpen: !participantMenu.value.volumeOpen,
  };
};

const handleMenuVolumeInput = (event) => {
  if (participantMenu.value.isLocal) return;
  const nextVolume = Number(event?.target?.value ?? 100);
  setRemoteParticipantVolume(participantMenu.value.memberId, nextVolume);
};

const handleGlobalPointerDown = (event) => {
  if (!participantMenu.value.visible) return;
  if (event?.target?.closest?.('[data-participant-menu="1"]')) return;
  closeParticipantMenu();
};

const handleWindowResize = () => {
  updateMobileViewport();
  closeParticipantMenu();
};

watch(hasShareTiles, (value) => {
  if (!value) return;
  selectedMainCameraMemberId.value = null;
  closeParticipantMenu();
});

watch(cameraFilmstripTiles, (tiles) => {
  const currentMemberIds = new Set(tiles.map((tile) => tile.memberId));
  if (
    selectedMainCameraMemberId.value &&
    !currentMemberIds.has(selectedMainCameraMemberId.value)
  ) {
    selectedMainCameraMemberId.value = null;
  }

  if (
    participantMenu.value.visible &&
    participantMenu.value.pubId !== 'local-self-preview' &&
    participantMenu.value.memberId &&
    !currentMemberIds.has(participantMenu.value.memberId)
  ) {
    closeParticipantMenu();
  }
});

onMounted(() => {
  updateMobileViewport();
  window.addEventListener('pointerdown', handleGlobalPointerDown);
  window.addEventListener('resize', handleWindowResize);
  window.addEventListener('scroll', closeParticipantMenu, true);
});

onUnmounted(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown);
  window.removeEventListener('resize', handleWindowResize);
  window.removeEventListener('scroll', closeParticipantMenu, true);
});

// room 参加中に別 route へ遷移する前に leave を完了し、同名再入室時の重複エラーを防ぐ。
onBeforeRouteLeave(async () => {
  if (!props.requiresLeaveOnBack || !joined.value) {
    return true;
  }

  await leaveRoom();
  return true;
});
</script>

<template>
  <div class="p-4 space-y-4">
    <header class="sticky top-0 z-30 bg-white/90 backdrop-blur px-3 py-2 shadow-sm">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <button v-if="props.allowCreateRoomUi && !roomCreated" @click="createRoom" class="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">＋作成</button>
          <button v-if="roomId && !joined" :disabled="joining || leaving" @click="joinRoom" class="px-3 py-1.5 rounded bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50">{{ joining ? '参加中…' : props.enterButtonLabelJa }}</button>
          <button v-if="joined" :disabled="leaving" @click="leaveRoom" class="px-3 py-1.5 rounded bg-gray-600 text-white text-sm hover:bg-gray-700 disabled:opacity-50">{{ leaving ? '退出中…' : '退出' }}</button>
        </div>
        <div class="flex items-center gap-2">
          <button @click="toggleAudioMute" :title="isAudioMuted ? 'マイクをオン' : 'マイクをオフ'" :class="['px-3 py-1.5 rounded text-sm', isAudioMuted ? 'bg-red-600 text-white' : 'bg-blue-600 text-white']">マイク</button>
          <button @click="toggleVideoMute" :title="isVideoMuted ? 'カメラをオン' : 'カメラをオフ'" :class="['px-3 py-1.5 rounded text-sm', isVideoMuted ? 'bg-red-600 text-white' : 'bg-blue-600 text-white']">カメラ</button>
          <button @click="screenShare" :disabled="!joined" :title="isScreenSharing ? '共有停止' : '画面共有'" :class="['px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed', isScreenSharing ? 'bg-red-600 text-white' : 'bg-blue-600 text-white']">画面共有🖥️</button>
          <button @click="toggleBackgroundBlur" :title="'背景ぼかし'" :class="['px-3 py-1.5 rounded text-sm', isBackgroundBlurred ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white']">{{ isBackgroundBlurred ? '背景ぼかし ON' : '背景ぼかし OFF' }}</button>
          <button @click="toggleRnnoise" :title="'ノイズ抑制(RNNoise)'" :class="['px-3 py-1.5 rounded text-sm', isRnnoiseEnabled ? 'bg-purple-600 text-white' : 'bg-purple-200 text-purple-900']">ノイズ抑制</button>
        </div>
        <div class="relative">
          <button @click="showSettingsOpen = !showSettingsOpen" class="px-3 py-1.5 rounded bg-gray-100 text-sm hover:bg-gray-200" title="設定">設定</button>
          <div v-if="showSettingsOpen" class="absolute right-0 mt-2 w-48 bg-white border rounded shadow z-40">
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" @click="openCameraPanel(); showSettingsOpen=false">カメラ設定</button>
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" @click="openMicPanel(); showSettingsOpen=false">マイク設定</button>
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" @click="openSpeakerPanel(); showSettingsOpen=false">スピーカー設定</button>
          </div>
        </div>
      </div>
      <div v-if="errorMessage" class="mt-2 text-xs text-red-600">{{ errorMessage }}</div>
      <div class="mt-2 text-xs text-gray-600">カメラ OFF 中も設定は保持されます</div>
      <div class="mt-1 text-xs text-gray-600">画面共有中は背景処理は無効です</div>
    </header>

    <div v-if="showCameraPanel" class="mt-2 p-3 bg-white border rounded shadow absolute z-50">
      <div class="flex items-center gap-2">
        <select v-model="tempSelectedVideoInputId" class="px-3 py-2 rounded border text-sm">
          <option v-for="d in videoInputDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || d.deviceId }}</option>
        </select>
        <button @click="confirmCameraPanel" class="px-3 py-1 bg-green-600 text-white rounded text-sm">確定</button>
        <button @click="cancelCameraPanel" class="px-3 py-1 bg-gray-300 rounded text-sm">キャンセル</button>
      </div>
    </div>
    <div v-if="showMicPanel" class="mt-2 p-3 bg-white border rounded shadow absolute z-50">
      <div class="flex items-center gap-2">
        <select v-model="tempSelectedAudioInputId" class="px-3 py-2 rounded border text-sm">
          <option v-for="d in audioInputDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || d.deviceId }}</option>
        </select>
        <button @click="confirmMicPanel" class="px-3 py-1 bg-green-600 text-white rounded text-sm">確定</button>
        <button @click="cancelMicPanel" class="px-3 py-1 bg-gray-300 rounded text-sm">キャンセル</button>
      </div>
    </div>
    <div v-if="showSpeakerPanel" class="mt-2 p-3 bg-white border rounded shadow absolute z-50">
      <div class="flex items-center gap-2">
        <select v-model="tempSelectedAudioOutputId" class="px-3 py-2 rounded border text-sm">
          <option v-for="d in audioOutputDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || d.deviceId }}</option>
        </select>
        <button @click="confirmSpeakerPanel" class="px-3 py-1 bg-green-600 text-white rounded text-sm">確定</button>
        <button @click="cancelSpeakerPanel" class="px-3 py-1 bg-gray-300 rounded text-sm">キャンセル</button>
      </div>
    </div>

    <div v-if="props.showUrlShareUi && roomId" class="space-y-2 text-sm">
      <button @click="showShareOpen = !showShareOpen" class="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-sm">URL共有 {{ showShareOpen ? '▲' : '▼' }}</button>
      <div v-if="showShareOpen" class="space-y-2">
        <p class="text-xs text-gray-600">以下のURLを相手と共有:</p>
        <p class="break-all font-mono bg-gray-100 px-2 py-1 rounded">{{ baseUrl }}?room={{ roomId }}</p>
        <p class="text-xs text-gray-600">またはルームID:</p>
        <p class="font-mono bg-gray-100 px-2 py-1 inline-block rounded">{{ roomId }}</p>
      </div>
    </div>

    <div v-if="roomCreated" class="space-y-4 md:space-y-5">
      <div :class="roomLayoutClass">
        <div :class="shareAreaClass">
          <div v-if="selectedMainShareTile" class="border rounded p-2 md:p-3 bg-gray-50 relative">
            <button
              type="button"
              class="absolute top-2 right-2 z-10 px-2 py-1 rounded bg-black/60 text-white text-xs hover:bg-black/70"
              @click="selectedMainSharePubId = null"
            >
              閉じる
            </button>
            <div class="relative w-full aspect-video bg-black rounded overflow-hidden" :ref="(el) => mountTileElement(el, selectedMainShareTile, 'main')" />
          </div>
          <div
            v-else-if="hasMainCamera && selectedMainCameraTile"
            class="border rounded p-2 md:p-3 bg-gray-50 relative"
            @contextmenu.prevent="openParticipantMenu($event, selectedMainCameraTile)"
          >
            <button
              v-if="isMobileViewport"
              type="button"
              class="absolute top-2 right-12 z-10 h-7 w-7 rounded-full bg-black/55 text-white text-sm leading-none hover:bg-black/70"
              @click.stop="openParticipantSheet(selectedMainCameraTile)"
            >
              ⋮
            </button>
            <button
              type="button"
              class="absolute top-2 right-2 z-10 px-2 py-1 rounded bg-black/60 text-white text-xs hover:bg-black/70"
              @click="clearMainParticipant"
            >
              閉じる
            </button>
            <div class="relative w-full aspect-video bg-black rounded overflow-hidden" :ref="(el) => mountTileElement(el, selectedMainCameraTile, 'main')" />
          </div>

          <div v-if="shouldShowShareList" class="space-y-2">
            <div class="text-xs text-gray-600">共有サムネイル</div>
            <div class="grid grid-cols-2 gap-2 pb-1 sm:grid-cols-3 lg:grid-cols-4">
              <div
                v-for="tile in shareTilesForList"
                :key="`share-${tile.pubId}`"
                :class="[
                  'min-w-0 w-full rounded p-1',
                  tile.pubId === selectedMainSharePubId ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-transparent'
                ]"
              >
                <div
                  v-if="tile.pubId === selectedMainSharePubId"
                  class="relative w-full aspect-video bg-black rounded overflow-hidden"
                >
                  <span class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] leading-none text-white">選択中</span>
                </div>
                <div v-else class="relative w-full aspect-video bg-black rounded overflow-hidden" :ref="(el) => mountTileElement(el, tile, 'share')" />
                <div class="mt-1 text-xs text-gray-600">{{ tile.label }}</div>
                <div class="mt-1">
                  <span
                    v-if="tile.pubId === selectedMainSharePubId"
                    class="inline-block px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] leading-none"
                  >
                    視聴中
                  </span>
                  <button
                    v-else
                    type="button"
                    class="px-2 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700"
                    @click="selectedMainSharePubId = tile.pubId"
                  >
                    配信を見る
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div :class="cameraAreaClass">
          <div class="text-xs text-gray-600">参加者カメラ</div>
          <div :class="['grid gap-2 pb-1', cameraGridClass]">
            <div
              v-if="shouldShowSelfPreviewTile"
              :class="cameraTileClass({ isLocal: true })"
              @contextmenu.prevent="openParticipantMenu($event, localSelfPreviewMenuTile)"
            >
              <div class="relative w-full aspect-video bg-black rounded overflow-hidden border border-white/30">
                <button
                  v-if="isMobileViewport"
                  type="button"
                  class="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-black/55 text-white text-sm leading-none hover:bg-black/70"
                  @click.stop="openParticipantSheet(localSelfPreviewMenuTile)"
                >
                  ⋮
                </button>
                <video ref="localSelfCameraPreviewEl" autoplay playsinline muted class="w-full h-full object-cover" />
                <span
                  v-if="isAudioMuted"
                  class="absolute bottom-2 right-2 bg-black/60 text-white px-1.5 py-0.5 rounded text-xs pointer-events-none"
                >
                  🔇
                </span>
              </div>
              <div class="mt-1 text-xs text-gray-600">あなた</div>
            </div>
            <div
              v-for="tile in cameraTilesForList"
              :key="`camera-${tile.pubId}`"
              :class="cameraTileClass(tile)"
              @contextmenu.prevent="openParticipantMenu($event, tile)"
            >
              <div class="relative">
                <button
                  v-if="isMobileViewport"
                  type="button"
                  class="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-black/55 text-white text-sm leading-none hover:bg-black/70"
                  @click.stop="openParticipantSheet(tile)"
                >
                  ⋮
                </button>
                <div class="relative w-full aspect-video bg-black rounded overflow-hidden" :ref="(el) => mountTileElement(el, tile, 'camera')" />
              </div>
              <div class="mt-1 text-xs text-gray-600">{{ tile.label }}</div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="participantMenu.visible && !isMobileViewport"
        data-participant-menu="1"
        class="fixed z-50 min-w-[180px] rounded border bg-white shadow-lg"
        :style="{ left: `${participantMenu.x}px`, top: `${participantMenu.y}px` }"
      >
        <button
          v-if="!hasShareTiles && !isMenuTargetMainCamera"
          type="button"
          class="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
          @click="pinParticipantAsMain"
        >
          主表示にする
        </button>
        <button
          v-if="!hasShareTiles && isMenuTargetMainCamera"
          type="button"
          class="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
          @click="clearMainParticipant"
        >
          主表示を解除
        </button>
        <div
          v-if="participantMenu.isLocal && hasShareTiles"
          class="px-3 py-2 text-xs text-gray-500"
        >
          共有中は主表示を変更できません
        </div>
        <button
          v-if="!participantMenu.isLocal"
          type="button"
          class="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
          @click="toggleVolumeMenu"
        >
          音量を調整
        </button>
        <div v-if="!participantMenu.isLocal && participantMenu.volumeOpen" class="border-t px-3 py-2 space-y-1">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            :value="currentMenuVolume"
            class="w-full"
            @input="handleMenuVolumeInput"
          />
          <div class="text-[11px] text-gray-500">{{ currentMenuVolume }}%</div>
        </div>
      </div>

      <div
        v-if="participantMenu.visible && isMobileViewport"
        class="fixed inset-0 z-50 bg-black/35"
        @click="closeParticipantMenu"
      >
        <div
          data-participant-menu="1"
          class="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white px-4 pt-3 pb-5 shadow-2xl space-y-2"
          @click.stop
        >
          <div class="mx-auto h-1.5 w-10 rounded-full bg-gray-300" />
          <button
            v-if="!hasShareTiles && !isMenuTargetMainCamera"
            type="button"
            class="block w-full rounded px-3 py-3 text-left text-sm hover:bg-gray-50"
            @click="pinParticipantAsMain"
          >
            主表示にする
          </button>
          <button
            v-if="!hasShareTiles && isMenuTargetMainCamera"
            type="button"
            class="block w-full rounded px-3 py-3 text-left text-sm hover:bg-gray-50"
            @click="clearMainParticipant"
          >
            主表示を解除
          </button>
          <div
            v-if="hasShareTiles"
            class="px-3 py-2 text-xs text-gray-500"
          >
            共有中は主表示を変更できません
          </div>
          <button
            v-if="!participantMenu.isLocal"
            type="button"
            class="block w-full rounded px-3 py-3 text-left text-sm hover:bg-gray-50"
            @click="toggleVolumeMenu"
          >
            音量を調整
          </button>
          <div v-if="shouldShowMobileVolumeSection && participantMenu.volumeOpen" class="rounded border px-3 py-3 space-y-2">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              :value="currentMenuVolume"
              class="w-full"
              @input="handleMenuVolumeInput"
            />
            <div class="text-xs text-gray-500">{{ currentMenuVolume }}%</div>
          </div>
          <button
            type="button"
            class="mt-1 block w-full rounded border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            @click="closeParticipantMenu"
          >
            閉じる
          </button>
        </div>
      </div>

      <div ref="streamArea" class="hidden" />
      <video ref="localVideoEl" autoplay playsinline muted class="hidden" />
    </div>
    <div v-else class="text-gray-500 italic">まだルームは作成されていません。</div>
  </div>
</template>
