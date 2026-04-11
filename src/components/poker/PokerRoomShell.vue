<script setup>
defineProps({
  roomSlug: {
    type: String,
    default: 'poker-room',
  },
  title: {
    type: String,
    default: 'Poker Room',
  },
});
</script>

<template>
  <main class="min-h-screen bg-gray-50 px-4 py-10">
    <div class="mx-auto w-full max-w-7xl space-y-6 rounded-xl border bg-white p-6 shadow-sm">
      <RouterLink to="/rooms" class="text-sm text-blue-600 hover:underline">
        ← 部屋一覧へ戻る
      </RouterLink>

      <header class="space-y-2">
        <h1 class="text-2xl font-semibold text-gray-900">{{ title }}</h1>
        <p class="text-sm text-gray-600">
          この画面は Poker 専用 view の初期 shell です。詳細 UI は次段階で実装します。
        </p>
      </header>

      <p class="text-xs text-gray-500">slug: {{ roomSlug }}</p>

      <div class="grid gap-4 lg:grid-cols-3">
        <section class="space-y-4 lg:col-span-2">
          <slot name="table" />
        </section>
        <aside class="space-y-4">
          <slot name="call" />
        </aside>
      </div>
    </div>
  </main>
</template>
