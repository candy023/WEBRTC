/**
 * publication metadata から kind を取り出す。
 *
 * @param {import('@skyway-sdk/room').Publication | null | undefined} publication
 * @returns {string} kind 文字列。取得できない場合は空文字。
 * @throws {never}
 * @sideeffects なし
 */
export function parsePublicationKind(publication) {
  if (!publication?.metadata) return '';

  try {
    const parsed = JSON.parse(publication.metadata);
    if (typeof parsed?.kind === 'string') return parsed.kind;
  } catch {}

  return '';
}

/**
 * publication metadata から表示名を取り出す。
 *
 * @param {import('@skyway-sdk/room').Publication | null | undefined} publication
 * @returns {string} 表示名。取得できない場合は空文字。
 * @throws {never}
 * @sideeffects なし
 */
export function parsePublicationDisplayName(publication) {
  if (!publication?.metadata) return '';

  try {
    const parsed = JSON.parse(publication.metadata);
    if (typeof parsed?.displayName === 'string') return parsed.displayName.trim();
  } catch {}

  return '';
}

/**
 * publication が画面共有かどうかを判定する。
 *
 * @param {import('@skyway-sdk/room').Publication | null | undefined} publication
 * @returns {boolean}
 * @throws {never}
 * @sideeffects なし
 */
export function isScreenPublication(publication) {
  return parsePublicationKind(publication) === 'screen';
}

/**
 * stream が映像トラックを持つかどうかを判定する。
 *
 * @param {any} stream
 * @returns {boolean}
 * @throws {never}
 * @sideeffects なし
 */
export function isVideoStream(stream) {
  return !!(
    stream?.track?.kind === 'video' ||
    (stream?.mediaStream && stream.mediaStream.getVideoTracks?.().length)
  );
}

/**
 * 共有タイル配列から次に選択すべきメイン表示 pubId を求める。
 *
 * @param {string | null} selectedMainSharePubId 現在選択中の pubId。
 * @param {Array<{ pubId: string }>} screenShareTiles 共有タイル配列。
 * @returns {string | null}
 * @throws {never}
 * @sideeffects なし
 */
export function syncSelectedMainShare(selectedMainSharePubId, screenShareTiles) {
  if (!Array.isArray(screenShareTiles) || !screenShareTiles.length) {
    return null;
  }

  if (!selectedMainSharePubId) {
    return null;
  }

  const exists = screenShareTiles.some((tile) => tile.pubId === selectedMainSharePubId);
  return exists ? selectedMainSharePubId : null;
}

/**
 * 指定 pubId のタイルを配列から削除する。
 *
 * @param {Array<{ pubId: string }>} tileList
 * @param {string} pubId
 * @returns {any | null} 削除したタイル。見つからない場合は null。
 * @throws {never}
 * @sideeffects tileList を破壊的に更新する
 */
export function removeTileFromList(tileList, pubId) {
  if (!Array.isArray(tileList)) return null;

  const index = tileList.findIndex((tile) => tile.pubId === pubId);
  if (index < 0) return null;

  const [tile] = tileList.splice(index, 1);
  return tile;
}

/**
 * pubId をキーにタイルを追加または更新する。
 *
 * @param {Array<{ pubId: string }>} tileList
 * @param {{ pubId: string }} tile
 * @returns {void}
 * @throws {never}
 * @sideeffects tileList を破壊的に更新する
 */
export function upsertTileToList(tileList, tile) {
  if (!Array.isArray(tileList) || !tile?.pubId) return;

  const index = tileList.findIndex((item) => item.pubId === tile.pubId);
  if (index >= 0) {
    tileList[index] = tile;
    return;
  }

  tileList.push(tile);
}

/**
 * publication kind に応じてタイルを共有配列/カメラ配列へ振り分ける。
 *
 * @param {object} params
 * @param {import('@skyway-sdk/room').Publication | null | undefined} params.publication
 * @param {{ pubId: string, el: HTMLElement }} params.tile
 * @param {Array<any>} params.screenShareTiles
 * @param {Array<any>} params.cameraFilmstripTiles
 * @returns {void}
 * @throws {never}
 * @sideeffects screenShareTiles / cameraFilmstripTiles を破壊的に更新する
 */
export function upsertVideoTile({
  publication,
  tile,
  screenShareTiles,
  cameraFilmstripTiles,
}) {
  if (!publication?.id || !tile?.el) return;

  removeTileFromList(screenShareTiles, publication.id);
  removeTileFromList(cameraFilmstripTiles, publication.id);

  if (isScreenPublication(publication)) {
    upsertTileToList(screenShareTiles, tile);
    return;
  }

  upsertTileToList(cameraFilmstripTiles, tile);
}
