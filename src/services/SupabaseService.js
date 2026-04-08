import { createClient } from '@supabase/supabase-js';

// 固定ルーム一覧を DB クエリで限定するための slug 定義。
const FIXED_ROOM_SLUGS = ['work-room', 'poker-room'];

// Supabase browser client の singleton。認証状態をタブ内で共有するため 1 回だけ初期化する。
let supabaseClient = null;

const getSupabaseEnv = () => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Supabase environment variables are missing.');
  }

  return { url, anonKey };
};

/**
 * Purpose: Supabase browser client の singleton を取得する。
 * Parameters:
 * - なし
 * Returns:
 * - {import('@supabase/supabase-js').SupabaseClient} 初期化済み client。
 * Throws:
 * - {Error} `VITE_SUPABASE_URL` または `VITE_SUPABASE_ANON_KEY` が未設定の場合。
 * Side effects:
 * - 初回呼び出し時に `createClient` を実行して singleton を初期化する。
 */
export function getSupabaseClient() {
  if (!supabaseClient) {
    const { url, anonKey } = getSupabaseEnv();
    supabaseClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return supabaseClient;
}

/**
 * Purpose: Google OAuth でログインを開始する。
 * Parameters:
 * - {string} [redirectTo] 認証完了後の遷移先 URL。未指定時は現在 origin を使う。
 * Returns:
 * - {Promise<void>}
 * Throws:
 * - {Error} Supabase 側の認証開始に失敗した場合。
 * Side effects:
 * - ブラウザを Supabase Auth の Google 認証画面へ遷移させる。
 */
export async function signInWithGoogle(redirectTo = window.location.origin) {
  const client = getSupabaseClient();
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });

  if (error) {
    throw error;
  }
}

/**
 * Purpose: 現在の auth session を取得する。
 * Parameters:
 * - なし
 * Returns:
 * - {Promise<import('@supabase/supabase-js').Session | null>} 現在保持している session。
 * Throws:
 * - {Error} Supabase から session を取得できない場合。
 * Side effects:
 * - Supabase auth ストレージにアクセスして session を読み出す。
 */
export async function getAuthSession() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session ?? null;
}

/**
 * Purpose: 現在ログインしている user を取得する。
 * Parameters:
 * - なし
 * Returns:
 * - {Promise<import('@supabase/supabase-js').User | null>} 現在 user。未ログイン時は null。
 * Throws:
 * - {Error} Supabase から user を取得できない場合。
 * Side effects:
 * - Supabase auth API に user 取得リクエストを送る。
 */
export async function getCurrentUser() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getUser();

  if (error) {
    throw error;
  }

  return data.user ?? null;
}

/**
 * Purpose: auth 状態変化を購読し、session 更新を呼び出し側へ通知する。
 * Parameters:
 * - {(session: import('@supabase/supabase-js').Session | null) => void} onSessionChanged session 更新 callback。
 * Returns:
 * - {import('@supabase/supabase-js').Subscription} 解除に使う subscription。
 * Throws:
 * - {TypeError} `onSessionChanged` が関数でない場合。
 * Side effects:
 * - Supabase auth state change listener を登録する。
 */
export function onAuthStateChange(onSessionChanged) {
  if (typeof onSessionChanged !== 'function') {
    throw new TypeError('onSessionChanged must be a function.');
  }

  const client = getSupabaseClient();
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    onSessionChanged(session ?? null);
  });

  return data.subscription;
}

/**
 * Purpose: 固定 2 ルーム（work/poker）の一覧を取得する。
 * Parameters:
 * - なし
 * Returns:
 * - {Promise<Array<{
 *   slug: string,
 *   display_name: string,
 *   room_kind: 'work' | 'poker',
 *   skyway_room_name: string,
 *   media_mode: string,
 *   sort_order: number,
 *   is_active: boolean,
 *   ui_config: Record<string, any>,
 * }>>} sort_order 昇順の room 一覧。
 * Throws:
 * - {Error} Supabase から room 取得に失敗した場合。
 * Side effects:
 * - `rooms` テーブルへ select クエリを実行する。
 */
export async function fetchFixedRooms() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('rooms')
    .select(
      'slug, display_name, room_kind, skyway_room_name, media_mode, sort_order, is_active, ui_config'
    )
    .in('slug', FIXED_ROOM_SLUGS)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

const toActiveBanState = (banRow) => {
  if (!banRow) {
    return { isBanned: false, reason: null, bannedUntil: null };
  }

  if (!banRow.banned_until) {
    return {
      isBanned: true,
      reason: banRow.reason ?? null,
      bannedUntil: null,
    };
  }

  const bannedUntilDate = new Date(banRow.banned_until);
  if (Number.isNaN(bannedUntilDate.getTime())) {
    return {
      isBanned: true,
      reason: banRow.reason ?? null,
      bannedUntil: banRow.banned_until,
    };
  }

  const isStillBanned = bannedUntilDate.getTime() > Date.now();
  return {
    isBanned: isStillBanned,
    reason: isStillBanned ? banRow.reason ?? null : null,
    bannedUntil: isStillBanned ? banRow.banned_until : null,
  };
};

/**
 * Purpose: room join 前に user の BAN 状態を判定する。
 * Parameters:
 * - {string} userId 判定対象の auth user id。
 * Returns:
 * - {Promise<{ isBanned: boolean, reason: string | null, bannedUntil: string | null }>} BAN 判定結果。
 * Throws:
 * - {TypeError} `userId` が空の場合。
 * - {Error} Supabase から banned_users を取得できない場合。
 * Side effects:
 * - `banned_users` テーブルへ select クエリを実行する。
 */
export async function checkUserBanStatus(userId) {
  if (!userId) {
    throw new TypeError('userId is required.');
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('banned_users')
    .select('user_id, reason, banned_until')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return toActiveBanState(data);
}
