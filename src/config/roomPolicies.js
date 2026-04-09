const ROOM_POLICIES = Object.freeze([
  Object.freeze({
    slug: 'work-room',
    routeSegment: 'work',
    routePath: '/rooms/work',
    skywayRoomName: 'work-room',
  }),
  Object.freeze({
    slug: 'poker-room',
    routeSegment: 'poker',
    routePath: '/rooms/poker',
    skywayRoomName: 'poker-room',
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
