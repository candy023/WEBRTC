<script setup>
// このコンポーネントは UI 表示に専念します。
// - 実際の WebRTC / SkyWay の接続やメディア処理は `useStreamReceiver` と各 services に委譲しています。
// - ここでは「なぜその ref/関数が必要か」を示すコメントを残し、UI 側の意図を明確にします。
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
  // ローカルプレビューの video 要素。UI が直接 DOM 参照を持つ理由は、サービス側で attach するため
  localVideoEl,
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
        <div v-if="joined" class="flex items-center gap-2">
          <button @click="toggleAudioMute" :title="isAudioMuted ? 'ミュート解除' : 'ミュート'" :class="['px-3 py-1.5 rounded text-sm', isAudioMuted ? 'bg-red-600 text-white' : 'bg-blue-600 text-white']">ミュート🎤</button>
          <button @click="toggleVideoMute" :title="isVideoMuted ? '映像ON' : '映像OFF'" :class="['px-3 py-1.5 rounded text-sm', isVideoMuted ? 'bg-red-600 text-white' : 'bg-blue-600 text-white']">映像📹</button>
          <button @click="screenShare" :title="isScreenSharing ? '共有停止' : '画面共有'" :class="['px-3 py-1.5 rounded text-sm', isScreenSharing ? 'bg-red-600 text-white' : 'bg-blue-600 text-white']">画面共有🖥️</button>
          <button @click="toggleBackgroundBlur" :title="'背景ぼかし'" :class="['px-3 py-1.5 rounded text-sm', isBackgroundBlurred ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white']">ぼかし🟣</button>
          <button @click="toggleRnnoise" :title="'ノイズ抑制(RNNoise)'" :class="['px-3 py-1.5 rounded text-sm', isRnnoiseEnabled ? 'bg紫-600 text-white' : 'bg-purple-200 text-purple-900']">ノイズ抑制</button>
        </div>
        <div class="relative">
          <button @click="showSettingsOpen = !showSettingsOpen" class="px-3 py-1.5 rounded bg-gray-100 text-sm hover:bg-gray-200" title="設定">⋮</button>
          <div v-if="showSettingsOpen" class="absolute right-0 mt-2 w-48 bg白 border rounded shadow z-40">
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" @click="openCameraPanel(); showSettingsOpen=false">カメラ切替</button>
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" @click="openMicPanel(); showSettingsOpen=false">マイク切替</button>
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" @click="openSpeakerPanel(); showSettingsOpen=false">スピーカー切替</button>
          </div>
        </div>
      </div>
      <div v-if="errorMessage" class="mt-2 text-xs text-red-600">{{ errorMessage }}</div>
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

    <div
      ref="streamArea"
      v-if="roomCreated"
      class="border rounded p-3 max-h-[65vh] overflow-y-auto"
      style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;"
    >
      <div v-if="joined" class="relative w-full aspect-video bg-black rounded overflow-hidden">
        <video ref="localVideoEl" autoplay playsinline muted class="w-full h-full object-cover" />
        <button @click="enlargeVideo(localVideoEl)" class="absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded hover:bg-opacity-70 text-sm">⛶</button>
      </div>
    </div>
    <div v-else class="text-gray-500 italic">まだルームは作成されていません。</div>
  </div>
</template>
