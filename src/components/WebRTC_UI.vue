<script setup>
// このコンポーネントは UI 表示に専念します。
// - 実際の WebRTC / SkyWay の接続やメディア処理は `useStreamReceiver` と各 services に委譲しています。
// - ここでは「なぜその ref/関数が必要か」を示すコメントを残し、UI 側の意図を明確にします。
import { computed } from 'vue';
import { useStreamReceiver } from '../composables/useStreamReceiver.js';
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
  // 全画面表示中の video 要素参照。全画面化は DOM を body に移動させるため、この参照で状態管理する
  enlargedVideo,
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
  // 全画面化処理（DOM を移動するため UI が要素を渡す責務を持つ）。実際の DOM 操作は VideoUIService 側で行う
  enlargeVideo,
  shrinkVideo,
} = useStreamReceiver();

const selectedMainShareTile = computed(() => {
  if (!selectedMainSharePubId.value) return null;
  return screenShareTiles.value.find((tile) => tile.pubId === selectedMainSharePubId.value) || null;
});

const shareTilesForList = computed(() => {
  return screenShareTiles.value;
});

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
  applyTileVideoMode(tile, mode);
  if (tile.el.parentNode !== host) {
    host.replaceChildren(tile.el);
  }
};
</script>

<template>
  <div class="p-4 space-y-4">
    <div v-if="enlargedVideo" @click="shrinkVideo" class="fixed inset-0 bg-transparent z-40 cursor-pointer" />
    <header class="sticky top-0 z-30 bg-white/90 backdrop-blur px-3 py-2 shadow-sm">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <button v-if="!roomCreated" @click="createRoom" class="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">＋作成</button>
          <button v-if="roomId && !joined" :disabled="joining || leaving" @click="joinRoom" class="px-3 py-1.5 rounded bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50">{{ joining ? '参加中…' : '参加' }}</button>
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

    <div v-if="roomId" class="space-y-2 text-sm">
      <button @click="showShareOpen = !showShareOpen" class="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-sm">URL共有 {{ showShareOpen ? '▲' : '▼' }}</button>
      <div v-if="showShareOpen" class="space-y-2">
        <p class="text-xs text-gray-600">以下のURLを相手と共有:</p>
        <p class="break-all font-mono bg-gray-100 px-2 py-1 rounded">{{ baseUrl }}?room={{ roomId }}</p>
        <p class="text-xs text-gray-600">またはルームID:</p>
        <p class="font-mono bg-gray-100 px-2 py-1 inline-block rounded">{{ roomId }}</p>
      </div>
    </div>

    <div v-if="roomCreated" class="space-y-4 md:space-y-5">
      <div v-if="selectedMainShareTile" class="border rounded p-2 md:p-3 bg-gray-50 relative">
        <div class="relative w-full aspect-video bg-black rounded overflow-hidden" :ref="(el) => mountTileElement(el, selectedMainShareTile, 'main')" />
        <div v-if="joined && isScreenSharing" class="absolute bottom-3 right-3 z-10 w-28 md:w-40 lg:w-44 aspect-video rounded overflow-hidden bg-black border border-white/40 shadow">
          <video ref="localSelfCameraPreviewEl" autoplay playsinline muted class="w-full h-full object-cover" />
        </div>
      </div>

      <div v-if="screenShareTiles.length > 1" class="space-y-2">
        <div class="text-xs text-gray-600">共有サムネイル</div>
        <div class="grid grid-cols-2 gap-2 pb-1 md:flex md:gap-3 md:overflow-x-auto">
          <div
            v-for="tile in shareTilesForList"
            :key="`share-${tile.pubId}`"
            :class="[
              'min-w-0 w-full cursor-pointer rounded p-1 md:w-auto md:shrink-0 md:min-w-44 lg:min-w-48',
              tile.pubId === selectedMainSharePubId ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-transparent'
            ]"
            @click="selectedMainSharePubId = tile.pubId"
          >
            <div
              v-if="tile.pubId === selectedMainSharePubId"
              class="relative w-full aspect-video bg-black rounded overflow-hidden flex items-center justify-center text-xs text-white"
            >
              選択中
            </div>
            <div v-else class="relative w-full aspect-video bg-black rounded overflow-hidden" :ref="(el) => mountTileElement(el, tile, 'share')" />
            <div class="mt-1 text-xs text-gray-600">{{ tile.label }}</div>
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-xs text-gray-600">参加者カメラ</div>
        <div class="grid grid-cols-1 gap-2 pb-1 sm:grid-cols-2 md:flex md:gap-3 md:overflow-x-auto">
          <div v-for="tile in cameraFilmstripTiles" :key="`camera-${tile.pubId}`" class="min-w-0 md:w-auto md:shrink-0 md:min-w-56 lg:min-w-64">
            <div class="relative w-full aspect-video bg-black rounded overflow-hidden" :ref="(el) => mountTileElement(el, tile, 'camera')" />
            <div class="mt-1 text-xs text-gray-600">{{ tile.label }}</div>
          </div>
        </div>
      </div>

      <div ref="streamArea" class="hidden" />
      <video ref="localVideoEl" autoplay playsinline muted class="hidden" />
    </div>
    <div v-else class="text-gray-500 italic">まだルームは作成されていません。</div>
  </div>
</template>
