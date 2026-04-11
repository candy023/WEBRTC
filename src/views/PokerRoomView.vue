<script setup>
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import WebRTC_UI from '../components/WebRTC_UI.vue';
import PokerRoomShell from '../components/poker/PokerRoomShell.vue';
import PokerTablePlaceholder from '../components/poker/PokerTablePlaceholder.vue';
import { resolvePolicyByRouteSegment } from '../composables/useRoomPolicy.js';

const pokerRoomPolicy = resolvePolicyByRouteSegment('poker');
// Poker room の固定 slug。shell 段階でも導線の対象 room を明確にする。
const POKER_ROOM_SLUG = pokerRoomPolicy?.slug ?? 'poker-room';
// Poker room の SkyWay room 名。直接遷移時でも query の room 値を固定化する。
const POKER_SKYWAY_ROOM_NAME = pokerRoomPolicy?.skywayRoomName ?? 'poker-room';
// fixed room view で戻る導線を統一するための lobby 遷移先。
const POKER_BACK_TARGET_PATH = pokerRoomPolicy?.backTargetPath ?? '/rooms';
// fixed room view では create UI を出さないためのフラグ。
const POKER_ALLOW_CREATE_ROOM_UI = pokerRoomPolicy?.allowCreateRoomUi ?? false;
// room 画面離脱時に leave を必須化するためのフラグ。
const POKER_REQUIRES_LEAVE_ON_BACK = pokerRoomPolicy?.requiresLeaveOnBack ?? true;
// fixed room view で使う主要操作ラベル。
const POKER_ENTER_BUTTON_LABEL_JA = pokerRoomPolicy?.enterButtonLabelJa ?? '参加';
// fixed room view では URL 共有 UI を見せないためのフラグ。
const POKER_SHOW_URL_SHARE_UI = pokerRoomPolicy?.showUrlShareUi ?? false;

const route = useRoute();
const router = useRouter();
const isPokerRoomQueryReady = computed(() => {
  return route.query.room === POKER_SKYWAY_ROOM_NAME;
});

onMounted(async () => {
  if (isPokerRoomQueryReady.value) {
    return;
  }

  await router.replace({
    path: route.path,
    query: {
      ...route.query,
      room: POKER_SKYWAY_ROOM_NAME,
    },
  });
});
</script>

<template>
  <PokerRoomShell :room-slug="POKER_ROOM_SLUG" :back-target-path="POKER_BACK_TARGET_PATH" title="Poker Room">
    <template #table>
      <PokerTablePlaceholder />
    </template>

    <template #call>
      <section class="space-y-2 rounded border border-gray-200 bg-white p-3">
        <h2 class="text-sm font-semibold text-gray-900">通話パネル（補助）</h2>
        <p class="text-xs text-gray-600">通話機能は既存 WebRTC UI を再利用します。</p>
      </section>
      <div v-if="isPokerRoomQueryReady" class="rounded border border-gray-200">
        <WebRTC_UI
          :allow-create-room-ui="POKER_ALLOW_CREATE_ROOM_UI"
          :requires-leave-on-back="POKER_REQUIRES_LEAVE_ON_BACK"
          :enter-button-label-ja="POKER_ENTER_BUTTON_LABEL_JA"
          :show-url-share-ui="POKER_SHOW_URL_SHARE_UI"
        />
      </div>
      <p v-else class="text-xs text-gray-600">通話領域を初期化中…</p>
    </template>
  </PokerRoomShell>
</template>
