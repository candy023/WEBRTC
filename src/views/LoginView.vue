<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthSession } from '../composables/useAuthSession.js';

// 未ログインで保護ルートへ来た時の戻り先。query が不正な場合は /rooms へフォールバックする。
const route = useRoute();

// ログイン画面で扱う auth state。OAuth 開始中のボタン制御とエラー表示に使う。
const {
  authLoading,
  authErrorMessage,
  loginWithGoogle,
} = useAuthSession();

// OAuth 後の遷移先パス。open redirect を避けるためアプリ内の相対パスだけ許可する。
const redirectPath = computed(() => {
  const queryRedirectPath = typeof route.query.redirect === 'string'
    ? route.query.redirect
    : '/rooms';
  return queryRedirectPath.startsWith('/') ? queryRedirectPath : '/rooms';
});

// Supabase OAuth へ渡す redirectTo。絶対 URL 形式で固定し、ログイン後に目的ページへ戻す。
const googleRedirectTo = computed(() => {
  return `${window.location.origin}${redirectPath.value}`;
});

/**
 * Purpose: Google OAuth ログインを開始する。
 * Parameters:
 * - なし
 * Returns:
 * - {Promise<void>}
 * Throws:
 * - {never} 失敗時は `authErrorMessage` に集約される。
 * Side effects:
 * - Supabase OAuth 画面へブラウザ遷移を開始する。
 */
const startGoogleLogin = async () => {
  await loginWithGoogle(googleRedirectTo.value);
};
</script>

<template>
  <main class="min-h-screen bg-gray-50 px-4 py-10">
    <div class="mx-auto w-full max-w-md space-y-6 rounded-xl border bg-white p-6 shadow-sm">
      <header class="space-y-2">
        <h1 class="text-2xl font-semibold text-gray-900">ログイン</h1>
        <p class="text-sm text-gray-600">
          Google アカウントでログインして、部屋選択へ進んでください。
        </p>
      </header>

      <button
        class="w-full rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="authLoading"
        @click="startGoogleLogin"
      >
        {{ authLoading ? '確認中…' : 'Google でログイン' }}
      </button>

      <p v-if="authErrorMessage" class="text-sm text-red-600">
        {{ authErrorMessage }}
      </p>
    </div>
  </main>
</template>
