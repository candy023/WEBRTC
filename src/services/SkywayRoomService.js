import { SkyWayContext, SkyWayRoom, uuidV4 } from '@skyway-sdk/room';
import GetToken from '../components/SkywayToken.js';

/**
 * この service は SkyWay Room SDK との境界をまとめ、
 * room 生成・join・購読対象列挙・イベント bind の薄いラッパーを提供する。
 *
 * subscribe の重複管理や UI 反映は持たず、上位の composable に委ねる。
 */

/**
 * 認証トークンを使って SkyWayContext を生成し、期限更新通知に追従できる状態を作る。
 */
export async function createContext() {
  const appId = import.meta.env.VITE_SKYWAY_APP_ID;
  const secret = import.meta.env.VITE_SKYWAY_SECRET_KEY;
  const tokenString = GetToken(appId, secret);

  const ctx = await SkyWayContext.Create(tokenString);
  ctx.onTokenUpdateReminder.add(async () => {
    ctx.updateAuthToken(tokenString);
  });

  return ctx;
}

/**
 * roomId をキーに SFU room を取得し、存在しなければ作成する。
 */
export async function findOrCreateRoom(ctx, roomId) {
  return SkyWayRoom.FindOrCreate(ctx, {
    type: 'sfu',
    name: roomId,
  });
}

/**
 * ランダムな member 名で room に参加する。
 */
export async function joinRoom(room) {
  return room.join({
    name: uuidV4(),
  });
}

export async function publishLocal(member, { videoStream, audioStream }) {
  const videoPub = videoStream ? await member.publish(videoStream) : null;
  const audioPub = audioStream ? await member.publish(audioStream) : null;
  return { videoPub, audioPub };
}

/**
 * 既存の publication を列挙し、自分以外の stream だけを順に subscribe する。
 * join 時点ですでに存在していた stream の受信責務を担う。
 */
export async function subscribeExisting(room, member, onStream) {
  if (!room || !member?.subscribe) return;

  let pubs = room.publications ?? [];
  if (!pubs.length) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    pubs = room.publications ?? [];
  }

  for (const pub of pubs) {
    if (member?.id && pub.publisher?.id === member.id) continue;

    try {
      const { stream } = await member.subscribe(pub.id);
      await onStream(stream, pub);
    } catch (err) {
      console.warn('subscribeExisting failed', {
        pubId: pub?.id,
        contentType: pub?.contentType,
        publisherId: pub?.publisher?.id,
        errorMessage: err?.message,
      });
    }
  }
}

/**
 * 新規 publish を通知する handler を room に登録する。
 * publish を受けたら member で subscribe し、onStream(stream, publication) を呼ぶ。
 */
export function bindOnStreamPublished(room, member, onStream) {
  if (!room || !member?.subscribe || !onStream) return null;

  const handler = async (event) => {
    try {
      const publication = event.publication;
      if (!publication?.id) return;
      const { stream } = await member.subscribe(publication.id);
      await onStream(stream, publication);
    } catch {}
  };

  room.onStreamPublished.add(handler);
  return handler;
}

/**
 * 登録済みの publish handler を安全に解除する。
 */
export function unbindOnStreamPublished(room, handler) {
  if (!room || !handler) return;

  try {
    room.onStreamPublished.remove(handler);
  } catch {}
}

/**
 * onStreamUnpublished を購読して handler を返す。
 *
 * @param {import('@skyway-sdk/room').Room | null | undefined} room 購読対象の room。
 * @param {(event: any) => (void | Promise<void>)} onUnpublished unpublish 発生時に実行する処理。
 * @returns {(event: any) => Promise<void> | null} 登録した handler。登録できない場合は null。
 * @throws {never}
 * @sideeffects room.onStreamUnpublished に handler を追加する
 */
export function bindOnStreamUnpublished(room, onUnpublished) {
  if (!room || !onUnpublished) return null;

  const handler = async (event) => {
    try {
      await onUnpublished(event);
    } catch {}
  };

  room.onStreamUnpublished.add(handler);
  return handler;
}

/**
 * 登録済みの onStreamUnpublished handler を解除する。
 *
 * @param {import('@skyway-sdk/room').Room | null | undefined} room 解除対象の room。
 * @param {(event: any) => Promise<void> | null} handler 解除する handler。
 * @returns {void}
 * @throws {never}
 * @sideeffects room.onStreamUnpublished から handler を削除する
 */
export function unbindOnStreamUnpublished(room, handler) {
  if (!room || !handler) return;

  try {
    room.onStreamUnpublished.remove(handler);
  } catch {}
}

/**
 * local member が存在する場合だけ退室を試みる。
 */
export async function leave(member) {
  try {
    await member?.leave?.();
  } catch {}
}
