<script setup>
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import WebRTC_UI from '../components/WebRTC_UI.vue';
import { resolvePolicyByRouteSegment } from '../composables/useRoomPolicy.js';

const workRoomPolicy = resolvePolicyByRouteSegment('work');
// Work room の SkyWay room 名。固定ルーム導線から入った時に query を正規化する。
const WORK_SKYWAY_ROOM_NAME = workRoomPolicy?.skywayRoomName ?? 'work-room';
// fixed room view で戻る導線を統一するための lobby 遷移先。
const WORK_BACK_TARGET_PATH = workRoomPolicy?.backTargetPath ?? '/rooms';
// fixed room view では create UI を出さないためのフラグ。
const WORK_ALLOW_CREATE_ROOM_UI = workRoomPolicy?.allowCreateRoomUi ?? false;
// room 画面離脱時に leave を必須化するためのフラグ。
const WORK_REQUIRES_LEAVE_ON_BACK = workRoomPolicy?.requiresLeaveOnBack ?? true;
// fixed room view で使う主要操作ラベル。
const WORK_ENTER_BUTTON_LABEL_JA = workRoomPolicy?.enterButtonLabelJa ?? '参加';
// fixed room view では URL 共有 UI を見せないためのフラグ。
const WORK_SHOW_URL_SHARE_UI = workRoomPolicy?.showUrlShareUi ?? false;

// 現在 route と router 参照。query 正規化と一覧への戻り導線に使う。
const route = useRoute();
const router = useRouter();

onMounted(async () => {
  if (route.query.room === WORK_SKYWAY_ROOM_NAME) {
    return;
  }

  await router.replace({
    path: route.path,
    query: {
      ...route.query,
      room: WORK_SKYWAY_ROOM_NAME,
    },
  });
});
</script>

<template>
  <div class="space-y-2">
    <div class="px-4 pt-4 text-sm">
      <RouterLink :to="WORK_BACK_TARGET_PATH" class="text-blue-600 hover:underline">
        ← 部屋一覧へ戻る
      </RouterLink>
    </div>
    <WebRTC_UI
      :allow-create-room-ui="WORK_ALLOW_CREATE_ROOM_UI"
      :requires-leave-on-back="WORK_REQUIRES_LEAVE_ON_BACK"
      :enter-button-label-ja="WORK_ENTER_BUTTON_LABEL_JA"
      :show-url-share-ui="WORK_SHOW_URL_SHARE_UI"
    />
  </div>
</template>
