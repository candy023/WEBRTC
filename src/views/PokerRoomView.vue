<script setup>
import { resolvePolicyByRouteSegment } from '../composables/useRoomPolicy.js';

const pokerRoomPolicy = resolvePolicyByRouteSegment('poker');
// Poker room の固定 slug。shell 段階でも導線の対象 room を明確にする。
const POKER_ROOM_SLUG = pokerRoomPolicy?.slug ?? 'poker-room';
</script>

<template>
  <main class="min-h-screen bg-gray-50 px-4 py-10">
    <div class="mx-auto w-full max-w-2xl space-y-6 rounded-xl border bg-white p-6 shadow-sm">
      <RouterLink to="/rooms" class="text-sm text-blue-600 hover:underline">
        ← 部屋一覧へ戻る
      </RouterLink>

      <header class="space-y-2">
        <h1 class="text-2xl font-semibold text-gray-900">Poker Room</h1>
        <p class="text-sm text-gray-600">
          この画面は Poker 専用 view の初期 shell です。詳細 UI は次段階で実装します。
        </p>
      </header>

      <p class="text-xs text-gray-500">slug: {{ POKER_ROOM_SLUG }}</p>
    </div>
  </main>
</template>
