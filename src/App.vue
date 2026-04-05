<script setup>
// アプリの実動線は WebRTC_UI を起点にし、配信・受信の制御は composable 側へ委譲する。
// import StreamReceiver from './components/StreamReceiver.vue';
import WebRTC_UI from './components/WebRTC_UI.vue';
</script>

<template>
  <!-- <StreamReceiver /> -->
  <!--  -->
  <WebRTC_UI />
</template>
