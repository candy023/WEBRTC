const ROOM_POLICIES = Object.freeze([
  Object.freeze({
    slug: 'work-room',
    routeSegment: 'work',
    routePath: '/rooms/work',
    skywayRoomName: 'work-room',
    displayNameJa: '作業部屋',
    descriptionJa: '集中して作業するための通話ルームです。',
    enterButtonLabelJa: '作業部屋に入室',
    requiresNicknameBeforeEnter: true,
  }),
  Object.freeze({
    slug: 'poker-room',
    routeSegment: 'poker',
    routePath: '/rooms/poker',
    skywayRoomName: 'poker-room',
    displayNameJa: 'ポーカールーム',
    descriptionJa: '通話しながらポーカーを遊ぶためのルームです。',
    enterButtonLabelJa: 'ポーカールームに入室',
    requiresNicknameBeforeEnter: true,
  }),
]);

const createPolicyMap = (keyName) => {
  return Object.freeze(
    ROOM_POLICIES.reduce((accumulator, policy) => {
      accumulator[policy[keyName]] = policy;
      return accumulator;
    }, {})
  );
};

export const ROOM_POLICY_BY_SLUG = createPolicyMap('slug');
export const ROOM_POLICY_BY_ROUTE_SEGMENT = createPolicyMap('routeSegment');
