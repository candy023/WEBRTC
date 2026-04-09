import {
  ROOM_POLICY_BY_ROUTE_SEGMENT,
  ROOM_POLICY_BY_SLUG,
} from '../config/roomPolicies.js';

const normalizeStringKey = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

export function resolvePolicyBySlug(slug) {
  const normalizedSlug = normalizeStringKey(slug);
  if (!normalizedSlug) {
    return null;
  }

  return ROOM_POLICY_BY_SLUG[normalizedSlug] ?? null;
}

export function resolvePolicyByRouteSegment(routeSegment) {
  const normalizedRouteSegment = normalizeStringKey(routeSegment);
  if (!normalizedRouteSegment) {
    return null;
  }

  return ROOM_POLICY_BY_ROUTE_SEGMENT[normalizedRouteSegment] ?? null;
}

export function toRoomRouteLocation(room) {
  const roomPolicy = resolvePolicyBySlug(room?.slug);
  if (!roomPolicy) {
    return null;
  }

  const skywayRoomName = normalizeStringKey(room?.skyway_room_name) || roomPolicy.skywayRoomName;
  return {
    path: roomPolicy.routePath,
    query: {
      room: skywayRoomName,
    },
  };
}
