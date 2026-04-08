import { onMounted, onUnmounted, ref } from 'vue';
import {
  getAuthSession,
  getCurrentUser,
  onAuthStateChange,
  signInWithGoogle,
} from '../services/SupabaseService.js';

/**
 * Purpose: Supabase の auth session と current user を UI から扱いやすい state にまとめる。
 * Parameters:
 * - なし
 * Returns:
 * - {{
 *   authSession: import('vue').Ref<import('@supabase/supabase-js').Session | null>,
 *   currentUser: import('vue').Ref<import('@supabase/supabase-js').User | null>,
 *   authLoading: import('vue').Ref<boolean>,
 *   authErrorMessage: import('vue').Ref<string>,
 *   refreshAuthSession: () => Promise<void>,
 *   loginWithGoogle: (redirectTo?: string) => Promise<void>,
 * }}
 * Throws:
 * - {never} すべての失敗は `authErrorMessage` へ集約する。
 * Side effects:
 * - mount 時に auth session/user を取得し、auth state change listener を登録する。
 */
export function useAuthSession() {
  // UI 全体で参照する auth session。route guard や room 選択前提判定に使う。
  const authSession = ref(null);
  // 現在ログイン中の user。join 前 BAN 判定やプロフィール取得の起点として使う。
  const currentUser = ref(null);
  // 初期読み込みと再取得中の UI 制御フラグ。
  const authLoading = ref(false);
  // auth 取得系の失敗を表示するためのメッセージ。
  const authErrorMessage = ref('');

  // auth state change を解除する subscription 参照。
  let authSubscription = null;

  const setAuthSnapshot = async (session) => {
    authSession.value = session;
    currentUser.value = session?.user ?? null;

    if (!session) {
      return;
    }

    const user = await getCurrentUser();
    currentUser.value = user;
  };

  /**
   * Purpose: 最新の session/user を Supabase から再取得して state を更新する。
   * Parameters:
   * - なし
   * Returns:
   * - {Promise<void>}
   * Throws:
   * - {never} 失敗時は `authErrorMessage` に反映する。
   * Side effects:
   * - `authLoading` と `authSession` / `currentUser` / `authErrorMessage` を更新する。
   */
  const refreshAuthSession = async () => {
    authLoading.value = true;
    authErrorMessage.value = '';

    try {
      const session = await getAuthSession();
      await setAuthSnapshot(session);
    } catch (error) {
      authSession.value = null;
      currentUser.value = null;
      authErrorMessage.value = error?.message || String(error);
    } finally {
      authLoading.value = false;
    }
  };

  /**
   * Purpose: Google OAuth ログイン処理を開始する。
   * Parameters:
   * - {string} [redirectTo] 認証完了後の遷移先 URL。
   * Returns:
   * - {Promise<void>}
   * Throws:
   * - {never} 失敗時は `authErrorMessage` に反映する。
   * Side effects:
   * - ブラウザ遷移を伴う OAuth フローを開始する。
   */
  const loginWithGoogle = async (redirectTo) => {
    authErrorMessage.value = '';

    try {
      await signInWithGoogle(redirectTo);
    } catch (error) {
      authErrorMessage.value = error?.message || String(error);
    }
  };

  onMounted(async () => {
    await refreshAuthSession();

    try {
      authSubscription = onAuthStateChange(async (session) => {
        try {
          await setAuthSnapshot(session);
          authErrorMessage.value = '';
        } catch (error) {
          authSession.value = null;
          currentUser.value = null;
          authErrorMessage.value = error?.message || String(error);
        }
      });
    } catch (error) {
      authSession.value = null;
      currentUser.value = null;
      authErrorMessage.value = error?.message || String(error);
    }
  });

  onUnmounted(() => {
    try {
      authSubscription?.unsubscribe?.();
    } catch {}
    authSubscription = null;
  });

  return {
    authSession,
    currentUser,
    authLoading,
    authErrorMessage,
    refreshAuthSession,
    loginWithGoogle,
  };
}
