import { onMounted, ref } from 'vue';
import { fetchFixedRooms } from '../services/SupabaseService.js';

/**
 * Purpose: 固定ルーム 2 件（work-room / poker-room）を lobby 用 state として管理する。
 * Parameters:
 * - なし
 * Returns:
 * - {{
 *   lobbyRooms: import('vue').Ref<Array<{
 *     slug: string,
 *     display_name: string,
 *     room_kind: 'work' | 'poker',
 *     skyway_room_name: string,
 *     media_mode: string,
 *     sort_order: number,
 *     is_active: boolean,
 *     ui_config: Record<string, any>,
 *   }>>,
 *   roomsLoading: import('vue').Ref<boolean>,
 *   roomsErrorMessage: import('vue').Ref<string>,
 *   fetchLobbyRooms: () => Promise<void>,
 * }}
 * Throws:
 * - {never} すべての失敗は `roomsErrorMessage` へ集約する。
 * Side effects:
 * - mount 時に rooms テーブルを読み出して `lobbyRooms` を更新する。
 */
export function useLobbyRooms() {
  // 部屋選択画面へ渡す固定ルーム一覧。sort_order 昇順で保持する。
  const lobbyRooms = ref([]);
  // ルーム一覧取得中の UI 制御フラグ。
  const roomsLoading = ref(false);
  // ルーム一覧取得失敗時の表示メッセージ。
  const roomsErrorMessage = ref('');

  /**
   * Purpose: rooms テーブルから固定ルーム一覧を再取得する。
   * Parameters:
   * - なし
   * Returns:
   * - {Promise<void>}
   * Throws:
   * - {never} 失敗時は `roomsErrorMessage` に反映する。
   * Side effects:
   * - `roomsLoading` / `roomsErrorMessage` / `lobbyRooms` を更新する。
   */
  const fetchLobbyRooms = async () => {
    roomsLoading.value = true;
    roomsErrorMessage.value = '';

    try {
      const rooms = await fetchFixedRooms();
      lobbyRooms.value = rooms;
    } catch (error) {
      lobbyRooms.value = [];
      roomsErrorMessage.value = error?.message || String(error);
    } finally {
      roomsLoading.value = false;
    }
  };

  onMounted(async () => {
    await fetchLobbyRooms();
  });

  return {
    lobbyRooms,
    roomsLoading,
    roomsErrorMessage,
    fetchLobbyRooms,
  };
}
