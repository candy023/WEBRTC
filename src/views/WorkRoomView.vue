<script setup>
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import WebRTC_UI from '../components/WebRTC_UI.vue';

// Work room の SkyWay room 名。固定ルーム導線から入った時に query を正規化する。
const WORK_SKYWAY_ROOM_NAME = 'work-room';

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
      <RouterLink to="/rooms" class="text-blue-600 hover:underline">
        ← 部屋一覧へ戻る
      </RouterLink>
    </div>
    <WebRTC_UI />
  </div>
</template>
