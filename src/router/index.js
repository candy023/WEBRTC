import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import RoomSelectView from '../views/RoomSelectView.vue';
import WorkRoomView from '../views/WorkRoomView.vue';
import PokerRoomView from '../views/PokerRoomView.vue';
import { getAuthSession } from '../services/SupabaseService.js';
import { useRoomJoinGuard } from '../composables/useRoomJoinGuard.js';

// 認証導線の起点となるログイン画面パス。
const LOGIN_PATH = '/login';
// 認証後の部屋選択画面パス。保護ルート未認証時の戻し先判定にも使う。
const ROOM_SELECT_PATH = '/rooms';

// 部屋ルートへ進む前に BAN 判定へ渡す固定 room slug 定義。
const ROOM_SLUG_BY_ROUTE_NAME = {
  workRoom: 'work-room',
  pokerRoom: 'poker-room',
};

// 画面導線全体の route 定義。auth guard が meta を参照してアクセス可否を一元判定する。
const routes = [
  {
    path: '/',
    redirect: ROOM_SELECT_PATH,
  },
  {
    path: LOGIN_PATH,
    name: 'login',
    component: LoginView,
    meta: {
      guestOnly: true,
    },
  },
  {
    path: ROOM_SELECT_PATH,
    name: 'room-select',
    component: RoomSelectView,
    meta: {
      requiresAuth: true,
    },
  },
  {
    path: '/rooms/work',
    name: 'work-room',
    component: WorkRoomView,
    meta: {
      requiresAuth: true,
      roomSlug: ROOM_SLUG_BY_ROUTE_NAME.workRoom,
    },
  },
  {
    path: '/rooms/poker',
    name: 'poker-room',
    component: PokerRoomView,
    meta: {
      requiresAuth: true,
      roomSlug: ROOM_SLUG_BY_ROUTE_NAME.pokerRoom,
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: ROOM_SELECT_PATH,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

const { canJoinRoom } = useRoomJoinGuard();

const hasAuthRequirement = (to) => {
  return to.matched.some((record) => record.meta?.requiresAuth);
};

const hasGuestOnlyConstraint = (to) => {
  return to.matched.some((record) => record.meta?.guestOnly);
};

const getRouteRoomSlug = (to) => {
  const roomRecord = to.matched.find((record) => typeof record.meta?.roomSlug === 'string');
  return roomRecord?.meta?.roomSlug ?? null;
};

/**
 * Purpose: 認証済みかどうかと room 入室可否を 1 箇所で判定し、遷移可否を決める。
 * Parameters:
 * - {import('vue-router').RouteLocationNormalized} to 遷移先 route。
 * Returns:
 * - {Promise<true | import('vue-router').RouteLocationRaw>} 遷移許可またはリダイレクト先。
 * Throws:
 * - {never} 取得失敗は未ログイン扱いにフォールバックする。
 * Side effects:
 * - 認証不足または BAN 状態の場合にリダイレクトを返す。
 */
const resolveGuardNavigation = async (to) => {
  let session = null;
  try {
    session = await getAuthSession();
  } catch {}

  // guard 判定の基準になる current user id。未ログイン時は null として扱う。
  const currentUserId = session?.user?.id ?? null;

  if (hasAuthRequirement(to) && !currentUserId) {
    return {
      path: LOGIN_PATH,
      query: { redirect: to.fullPath },
    };
  }

  if (hasGuestOnlyConstraint(to) && currentUserId) {
    return {
      path: ROOM_SELECT_PATH,
    };
  }

  const roomSlug = getRouteRoomSlug(to);
  if (!roomSlug || !currentUserId) {
    return true;
  }

  const joinAvailability = await canJoinRoom({
    userId: currentUserId,
    roomSlug,
  });

  if (joinAvailability.allowed) {
    return true;
  }

  return {
    path: ROOM_SELECT_PATH,
    query: {
      ban: roomSlug,
      reason: joinAvailability.reason ?? 'BANNED',
    },
  };
};

router.beforeEach(async (to) => {
  return resolveGuardNavigation(to);
});

export default router;
