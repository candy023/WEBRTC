import { checkUserBanStatus } from '../services/SupabaseService.js';

/**
 * Purpose: room join 前に BAN 状態を確認するガード関数を提供する。
 * Parameters:
 * - なし
 * Returns:
 * - {{
 *   canJoinRoom: (params: { userId: string, roomSlug: string }) => Promise<{
 *     allowed: boolean,
 *     reason: string | null,
 *     bannedUntil: string | null,
 *     roomSlug: string,
 *   }>
 * }}
 * Throws:
 * - {never} 判定失敗は `allowed: false` と `reason` で返す。
 * Side effects:
 * - `banned_users` テーブルを読み出して join 可否を判定する。
 */
export function useRoomJoinGuard() {
  /**
   * Purpose: 指定 user が対象 room へ join 可能かを判定する。
   * Parameters:
   * - {{ userId: string, roomSlug: string }} params 判定対象の user と room slug。
   * Returns:
   * - {Promise<{
   *   allowed: boolean,
   *   reason: string | null,
   *   bannedUntil: string | null,
   *   roomSlug: string,
   * }>} BAN 状態を反映した join 可否。
   * Throws:
   * - {never} Supabase エラーは `allowed: false` と `reason` に変換して返す。
   * Side effects:
   * - Supabase へ BAN 判定クエリを送る。
   */
  const canJoinRoom = async ({ userId, roomSlug }) => {
    if (!userId) {
      return {
        allowed: false,
        reason: 'AUTH_REQUIRED',
        bannedUntil: null,
        roomSlug,
      };
    }

    try {
      const banState = await checkUserBanStatus(userId);
      if (banState.isBanned) {
        return {
          allowed: false,
          reason: banState.reason ?? 'BANNED',
          bannedUntil: banState.bannedUntil,
          roomSlug,
        };
      }

      return {
        allowed: true,
        reason: null,
        bannedUntil: null,
        roomSlug,
      };
    } catch (error) {
      return {
        allowed: false,
        reason: error?.message || String(error),
        bannedUntil: null,
        roomSlug,
      };
    }
  };

  return {
    canJoinRoom,
  };
}
