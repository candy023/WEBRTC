/**
 * SkywayRoomService.js
 *
 * SkyWay のビデオ会議機能を扱うサービス層。
 * Vue コンポーネントから SkyWay SDK の複雑さを隠蔽し、
 * Context / Room / Member / Publication の典型的な操作を提供します。
 *
 * 用語説明:
 * - Context: SkyWay サーバーとの接続管理オブジェクト
 * - Room: 会議室（同じ roomId なら同じ部屋に入る）
 * - Member: ルーム内の参加者（自分 or 他人）
 * - Publication: 配信中の映像・音声（publish で作成）
 * - subscribe: 他人の配信を受信すること
 *
 * 責務:
 * - Context / Room の作成・管理
 * - 入室（join）・退室（leave）処理
 * - 配信（publish）・受信（subscribe）管理
 * - 新規配信の自動受信（onStreamPublished イベント）のラップ
 *
 * 使い方の流れ（例）:
 * 1. createContext() で接続確立
 * 2. findOrCreateRoom(ctx, roomId) でルーム取得
 * 3. joinRoom(room) で入室
 * 4. publishLocal(member, {videoStream, audioStream}) で配信開始
 * 5. subscribeExisting(room, member, onStream) で既存配信を受信
 * 6. bindOnStreamPublished(room, member, onStream) で新規配信の通知を受け取る
 * 7. leave(member, room) で退室
 */

import { SkyWayContext, SkyWayRoom, SkyWayStreamFactory, uuidV4 } from '@skyway-sdk/room';
import GetToken from '../components/SkywayToken.js';

// SkyWay 用の Context を作成する
// トークンの自動更新リマインダーもここで設定する
/**
 * SkyWay の通信コンテキストを作成する
 *
 * Context = SkyWay サーバーとの接続を管理するオブジェクト
 * 一度作成すれば複数のルームで使い回せます。
 *
 * @returns {Promise<SkyWayContext>} 作成された Context
 * @throws {Error} トークン生成や Context 作成に失敗した場合
 *
 * @example
 * const ctx = await createContext();
 */
export async function createContext() {
	const appId = import.meta.env.VITE_SKYWAY_APP_ID;        // SkyWay の App ID
	const secret = import.meta.env.VITE_SKYWAY_SECRET_KEY;  // SkyWay の Secret Key

	// 認証用トークンを生成（環境変数やサーバーからの取得に置き換えてもよい）
	const tokenString = GetToken(appId, secret);

	// SkyWay の通信コンテキストを作成
	const ctx = await SkyWayContext.Create(tokenString);

	// トークンの有効期限が近づいたときに自動更新するハンドラを登録
	// 理由: 長時間接続したままの会話で切断されるのを防ぐため
	ctx.onTokenUpdateReminder.add(async () => {
		ctx.updateAuthToken(tokenString);
	});

	return ctx;
}

// 指定された roomId の SFU ルームを「検索 or 新規作成」する
/**
 * 指定 ID のルームを検索、なければ新規作成する
 *
 * SFU モード = 複数人通話に適した配信方式
 * （各参加者の映像・音声をサーバー経由で配信）
 *
 * @param {SkyWayContext} ctx - SkyWay の通信コンテキスト
 * @param {string} roomId - ルーム識別子（URL共有などで使う）
 * @returns {Promise<SkyWayRoom>} 取得または作成されたルーム
 *
 * @example
 * const room = await findOrCreateRoom(ctx, 'meeting-abc-123');
 */
export async function findOrCreateRoom(ctx, roomId) {
	const room = await SkyWayRoom.FindOrCreate(ctx, {
		type: 'sfu',   // SFU モード（複数人通話向き、P2Pより安定）
		name: roomId   // ルーム名（同じ名前なら同じルームに入る）
	});
	return room;
}

// ルームに参加し、自分自身の member を取得する
/**
 * ルームに入室し、自分の Member オブジェクトを取得する
 *
 * Member = ルーム内での自分の分身（配信・受信の主体）
 *
 * @param {SkyWayRoom} room - 入室先のルーム
 * @returns {Promise<RoomMember>} 自分の Member オブジェクト
 *
 * @example
 * const myMember = await joinRoom(room);
 * // この後 myMember.publish() で配信開始できる
 */
export async function joinRoom(room) {
	const member = await room.join({
		name: uuidV4()  // 一意な名前を自動生成（他人と衝突防止）
	});
	return member;
}

// 自分の映像・音声ストリームを publish する
// 引数は { videoStream, audioStream } の形を想定
/**
 * 自分のカメラ映像・マイク音声をルームに配信開始する
 *
 * publish = 他の参加者が subscribe（受信）できるように配信すること
 *
 * @param {RoomMember} member - 自分の Member オブジェクト
 * @param {Object} streams - 配信するストリーム
 * @param {MediaStream} [streams.videoStream] - カメラ映像（省略可）
 * @param {MediaStream} [streams.audioStream] - マイク音声（省略可）
 * @returns {Promise<{videoPub:Object|null, audioPub:Object|null}>} Publication オブジェクト
 *
 * @example
 * const { videoPub, audioPub } = await publishLocal(member, {
 *   videoStream: cameraStream,
 *   audioStream: micStream
 * });
 * // 後で videoPub.disable() で映像を止める（ミュート的操作）
 */
export async function publishLocal(member, { videoStream, audioStream }) {

	// 映像ストリームがあれば publish
	const videoPub = videoStream
		? await member.publish(videoStream)
		: null;

	// 音声ストリームがあれば publish
	const audioPub = audioStream
		? await member.publish(audioStream)
		: null;

	return { videoPub, audioPub };
}

// すでにルームに存在している Publication をすべて subscribe する
// 自分自身の Publication は除外する
/**
 * 入室時点で既に配信している他人の映像・音声を受信開始する
 * タイミング:
 * 1. 自分が入室（join）
 * 2. 既に他人が配信中 ← この配信を受信する
 * 3. この後の新規配信は onStreamPublished イベントで拾う
 *
 * @param {SkyWayRoom} room - 対象のルーム
 * @param {RoomMember} member - 自分の Member オブジェクト
 * @param {Function} onStream - 受信した stream を処理するコールバック (stream, publication)
 *
 * @example
 * await subscribeExisting(room, member, (stream, pub) => {
 *   console.log('既存配信を受信:', pub.id);
 *   attachVideoElement(stream);
 * });
 */
export async function subscribeExisting(room, member, onStream) {

	// ルーム内の全配信一覧を取得
	const pubs = room.publications ?? [];

	for (const pub of pubs) {

		// 自分の配信は受信しない（echo back 防止）
		if (pub.publisher.id === member.id) continue;

		// 他人の配信を受信開始
		const { stream } = await member.subscribe(pub.id);

		// 呼び出し側に stream を渡して DOM 追加などを任せる
		onStream(stream, pub);
	}
}

// 新しく stream が publish されたときのイベントを登録する
/**
 * 新しい配信が開始されたときの通知を受け取る設定をする
 *
 * タイミング:
 * 1. 自分が入室済み
 * 2. 他人が新しく配信開始 ← このタイミングで通知が来る
 * 3. このハンドラで自動受信する
 *
 * @param {SkyWayRoom} room - 監視対象のルーム
 * @param {RoomMember} member - 自分の Member オブジェクト
 * @param {Function} onStream - 受信した stream を処理するコールバック (stream, publication)
 * @returns {Function} イベントハンドラ（後で remove するために保持する）
 *
 * @example
 * const handler = bindOnStreamPublished(room, member, (stream, pub) => {
 *   console.log('新規配信を受信:', pub.id);
 *   attachVideoElement(stream);
 * });
 * // 退室時: unbindOnStreamPublished(room, handler);
 */
export function bindOnStreamPublished(room, member, onStream) {

	// onStreamPublished イベントが呼ばれたときの処理
	const handler = async (e) => {

		// 自分の配信通知には反応しない（echo back 防止）
		if (e.publication.publisher.id === member.id) return;

		// 他人の配信を自動受信
		const { stream } = await member.subscribe(e.publication.id);

		// 呼び出し側に stream を渡して DOM 追加などを任せる
		onStream(stream, e.publication);
	};

	// SkyWay のルームイベントに登録
	room.onStreamPublished.add(handler);

	// 退室時に解除できるよう handler を返す
	return handler;
}

// onStreamPublished のイベント購読を解除する
/**
 * 新規配信の通知受け取りを停止する（退室時に呼ぶ）
 *
 * これを呼ばないと退室後も通知が来続けてメモリリークの原因になる
 *
 * @param {SkyWayRoom} room - 監視対象のルーム
 * @param {Function} handler - bindOnStreamPublished の戻り値
 *
 * @example
 * unbindOnStreamPublished(room, streamHandler);
 */
export function unbindOnStreamPublished(room, handler) {
	try {
		room.onStreamPublished.remove(handler);
	} catch {
		// 既に削除済みなどでエラーが出ても無視（害がないため）
	}
}

// ルームから退室する
// 原則 leave を先に行い、leave 後は unpublish しない
/**
 * ルームから退室する（配信も自動停止される）
 *
 * 注意: leave() を呼べば自動的に配信停止されるため
 *       unpublish() を明示的に呼ぶ必要はない
 *
 * @param {RoomMember} member - 自分の Member オブジェクト
 * @param {SkyWayRoom} room - 退室するルーム（未使用だが互換性のため残す）
 * @param {Object} pubs - Publication オブジェクト（未使用だが互換性のため残す）
 *
 * @example
 * await leave(localMember, room, { videoPub, audioPub });
 * // この後 DOM 削除やストリーム解放を行う
 */
export async function leave(member, room, pubs) {
	try {
		await member.leave();
	} catch {
		// 退室処理でエラーが起きても無視（既に切断済みなどの状況を考慮）
	}
}
