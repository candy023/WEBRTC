<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthSession } from '../composables/useAuthSession.js';

// 未ログインで保護ルートへ来た時の戻り先。query が不正な場合は /rooms へフォールバックする。
const route = useRoute();
const router = useRouter();

// ログイン画面で扱う auth state。OAuth 開始中のボタン制御とエラー表示に使う。
const {
  authLoading,
  authErrorMessage,
  loginWithDiscord,
  loginWithGoogle,
  requestEmailOtpCode,
  loginWithEmailOtpCode,
} = useAuthSession();

// Supabase dashboard 側の Email OTP 桁数設定（6 桁）に合わせる。
const EMAIL_OTP_CODE_LENGTH = 6;

// Email OTP の送信先メールアドレス。OTP 検証でも同じ値を使う。
const emailInput = ref('');
// ユーザーが入力した Email OTP コード。
const emailOtpCodeInput = ref('');
// OTP を送信済みかどうか。同一画面内でコード入力 UI を切り替える。
const emailOtpRequested = ref(false);
// Email OTP の送信・検証で成功した時の補助メッセージ。
const emailOtpInfoMessage = ref('');

// OAuth 後の遷移先パス。open redirect を避けるためアプリ内の相対パスだけ許可する。
const redirectPath = computed(() => {
  const queryRedirectPath = typeof route.query.redirect === 'string'
    ? route.query.redirect
    : '/rooms';
  return queryRedirectPath.startsWith('/') ? queryRedirectPath : '/rooms';
});

// Supabase OAuth へ渡す redirectTo。絶対 URL 形式で固定し、ログイン後に目的ページへ戻す。
const oauthRedirectTo = computed(() => {
  return `${window.location.origin}${redirectPath.value}`;
});

const normalizedEmailInput = computed(() => {
  return typeof emailInput.value === 'string' ? emailInput.value.trim() : '';
});

const normalizedEmailOtpCodeInput = computed(() => {
  return typeof emailOtpCodeInput.value === 'string' ? emailOtpCodeInput.value.trim() : '';
});

const canRequestEmailOtp = computed(() => {
  return !authLoading.value && normalizedEmailInput.value.length > 0;
});

const canVerifyEmailOtp = computed(() => {
  if (authLoading.value || !emailOtpRequested.value) {
    return false;
  }

  return normalizedEmailOtpCodeInput.value.length === EMAIL_OTP_CODE_LENGTH;
});

// 認証成功後の遷移先は既存 redirect 方針に揃える。
const moveToPostLoginRoute = async () => {
  await router.replace(redirectPath.value);
};

// OAuth provider の差分は composable/service に閉じ込め、view は呼び分けだけ行う。
const startDiscordLogin = async () => {
  await loginWithDiscord(oauthRedirectTo.value);
};

// Email OTP を送信したら、同一画面でコード入力 UI を表示する。
const sendEmailOtpCode = async () => {
  emailOtpInfoMessage.value = '';

  const requestedEmail = await requestEmailOtpCode(normalizedEmailInput.value);
  if (!requestedEmail) {
    return;
  }

  emailInput.value = requestedEmail;
  emailOtpCodeInput.value = '';
  emailOtpRequested.value = true;
  emailOtpInfoMessage.value = '認証コードを送信しました。メールを確認してください。';
};

// Email OTP 検証が通ったら既存の導線どおり room 選択へ進める。
const verifyEmailOtpCode = async () => {
  emailOtpInfoMessage.value = '';

  const isOtpVerified = await loginWithEmailOtpCode({
    email: normalizedEmailInput.value,
    token: normalizedEmailOtpCodeInput.value,
  });
  if (!isOtpVerified) {
    return;
  }

  await moveToPostLoginRoute();
};

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
  await loginWithGoogle(oauthRedirectTo.value);
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
        class="w-full rounded bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="authLoading"
        @click="startDiscordLogin"
      >
        {{ authLoading ? '確認中…' : 'Discord でログイン' }}
      </button>

      <button
        class="w-full rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="authLoading"
        @click="startGoogleLogin"
      >
        {{ authLoading ? '確認中…' : 'Google でログイン' }}
      </button>

      <section class="space-y-3 rounded border border-gray-200 bg-gray-50 p-4">
        <h2 class="text-sm font-semibold text-gray-900">Email OTP ログイン</h2>

        <div class="space-y-2">
          <label class="block text-xs text-gray-700" for="login-email-input">
            メールアドレス
          </label>
          <input
            id="login-email-input"
            v-model="emailInput"
            type="email"
            autocomplete="email"
            class="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="name@example.com"
          >
          <button
            class="w-full rounded bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="!canRequestEmailOtp"
            @click="sendEmailOtpCode"
          >
            OTPコードを送信
          </button>
        </div>

        <div v-if="emailOtpRequested" class="space-y-2">
          <label class="block text-xs text-gray-700" for="login-email-otp-input">
            認証コード（6桁）
          </label>
          <input
            id="login-email-otp-input"
            v-model="emailOtpCodeInput"
            type="text"
            inputmode="numeric"
            maxlength="6"
            class="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="123456"
          >
          <button
            class="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="!canVerifyEmailOtp"
            @click="verifyEmailOtpCode"
          >
            OTPコードを検証
          </button>
        </div>

        <p v-if="emailOtpInfoMessage" class="text-sm text-green-700">
          {{ emailOtpInfoMessage }}
        </p>
      </section>

      <p v-if="authErrorMessage" class="text-sm text-red-600">
        {{ authErrorMessage }}
      </p>
    </div>
  </main>
</template>
