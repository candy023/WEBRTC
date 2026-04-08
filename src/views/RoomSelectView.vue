<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useLobbyRooms } from '../composables/useLobbyRooms.js';

// DB の room slug からルーティング先を引く固定マップ。固定 2 ルーム導線を view 側で明示する。
const ROOM_PATH_BY_SLUG = {
  'work-room': '/rooms/work',
  'poker-room': '/rooms/poker',
};

// 部屋一覧 UI で必要な state。fixed rooms の表示と再取得操作に利用する。
const {
  lobbyRooms,
  roomsLoading,
  roomsErrorMessage,
  fetchLobbyRooms,
} = useLobbyRooms();

// room ルートで BAN により戻された時の通知表示に使う query 参照。
const route = useRoute();

const selectableRooms = computed(() => {
  return lobbyRooms.value
    .map((room) => {
      return {
        ...room,
        routePath: ROOM_PATH_BY_SLUG[room.slug] ?? null,
      };
    })
    .filter((room) => !!room.routePath);
});

const bannedRoomSlug = computed(() => {
  return typeof route.query.ban === 'string' ? route.query.ban : '';
});

const bannedReason = computed(() => {
  return typeof route.query.reason === 'string' ? route.query.reason : '';
});

const bannedMessage = computed(() => {
  if (!bannedRoomSlug.value) {
    return '';
  }

  if (bannedReason.value) {
    return `入室できません: ${bannedReason.value}`;
  }

  return '入室できません。管理者に確認してください。';
});

/**
 * Purpose: 選択した room の route location を組み立てる。
 * Parameters:
 * - {{
 *   routePath: string,
 *   skyway_room_name: string,
 * }} room 遷移対象の room 情報。
 * Returns:
 * - {{ path: string, query: { room: string } }} 遷移先 location。
 * Throws:
 * - {never}
 * Side effects:
 * - なし
 */
const toRoomLocation = (room) => {
  return {
    path: room.routePath,
    query: {
      room: room.skyway_room_name,
    },
  };
};
</script>

<template>
  <main class="min-h-screen bg-gray-50 px-4 py-10">
    <div class="mx-auto w-full max-w-3xl space-y-6">
      <header class="space-y-2">
        <h1 class="text-2xl font-semibold text-gray-900">部屋選択</h1>
        <p class="text-sm text-gray-600">参加する部屋を選択してください。</p>
      </header>

      <div v-if="bannedMessage" class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {{ bannedMessage }}
      </div>

      <div class="rounded border bg-white p-5 shadow-sm space-y-4">
        <div v-if="roomsLoading" class="text-sm text-gray-600">部屋一覧を読み込み中です…</div>

        <div v-else-if="roomsErrorMessage" class="space-y-3">
          <p class="text-sm text-red-600">{{ roomsErrorMessage }}</p>
          <button
            class="rounded bg-gray-200 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-300"
            @click="fetchLobbyRooms"
          >
            再読み込み
          </button>
        </div>

        <div v-else class="grid gap-3 sm:grid-cols-2">
          <RouterLink
            v-for="room in selectableRooms"
            :key="room.slug"
            :to="toRoomLocation(room)"
            class="block rounded-lg border border-gray-200 px-4 py-4 hover:border-blue-400 hover:bg-blue-50"
          >
            <p class="text-base font-medium text-gray-900">{{ room.display_name }}</p>
            <p class="mt-1 text-xs text-gray-500">slug: {{ room.slug }}</p>
          </RouterLink>
        </div>
      </div>
    </div>
  </main>
</template>
