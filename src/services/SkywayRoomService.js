// SkywayRoomService.js
// 責務:
// ・SkyWay の Context 作成
// ・ルームの検索 / 作成
// ・入室（join）処理
// ・publish / subscribe 管理
// ・イベント購読（onStreamPublished）
// ・退室（leave）処理

import { SkyWayContext, SkyWayRoom, SkyWayStreamFactory, uuidV4 } from '@skyway-sdk/room';
import GetToken from '../components/SkywayToken.js';

// SkyWay 用の Context を作成する
// トークンの自動更新リマインダーもここで設定する
export async function createContext() {
	const appId = import.meta.env.VITE_SKYWAY_APP_ID;        // SkyWay の App ID
	const secret = import.meta.env.VITE_SKYWAY_SECRET_KEY;  // SkyWay の Secret Key

	// 認証用トークンを生成
	const tokenString = GetToken(appId, secret);

	// SkyWay の通信コンテキストを作成
	const ctx = await SkyWayContext.Create(tokenString);

	// トークンの期限更新が必要になったときに自動で再設定する
	ctx.onTokenUpdateReminder.add(async () => {
		ctx.updateAuthToken(tokenString);
	});

	return ctx;
}

// 指定された roomId の SFU ルームを「検索 or 新規作成」する
export async function findOrCreateRoom(ctx, roomId) {
	const room = await SkyWayRoom.FindOrCreate(ctx, {
		type: 'sfu',   // SFU モード（複数人通話向き）
		name: roomId   // ルームID（名前）
	});
	return room;
}

// ルームに参加し、自分自身の member を取得する
export async function joinRoom(room) {
	const member = await room.join({
		name: uuidV4()  // 他メンバーと被らない一意な名前を自動生成
	});
	return member;
}

// 自分の映像・音声ストリームを publish する
// 引数は { videoStream, audioStream } の形を想定
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
export async function subscribeExisting(room, member, onStream) {

	// ルーム内のすべての Publication 一覧を取得
	const pubs = room.publications ?? [];

	for (const pub of pubs) {

		// 自分が publish したものは subscribe しない
		if (pub.publisher.id === member.id) continue;

		// 他人の Publication を subscribe して stream を取得
		const { stream } = await member.subscribe(pub.id);

		// 呼び出し側に stream と publication を通知
		onStream(stream, pub);
	}
}

// 新しく stream が publish されたときのイベントを登録する
export function bindOnStreamPublished(room, member, onStream) {

	// onStreamPublished イベントのハンドラ定義
	const handler = async (e) => {

		// 自分自身の publish には反応しない
		if (e.publication.publisher.id === member.id) return;

		// 相手の Publication を subscribe
		const { stream } = await member.subscribe(e.publication.id);

		// 呼び出し側へ stream と publication を通知
		onStream(stream, e.publication);
	};

	// SkyWay のルームイベントに登録
	room.onStreamPublished.add(handler);

	// remove 用に handler を返す
	return handler;
}

// onStreamPublished のイベント購読を解除する
export function unbindOnStreamPublished(room, handler) {
	try {
		room.onStreamPublished.remove(handler);
	} catch {}
}

// ルームから退室する
// 原則 leave を先に行い、leave 後は unpublish しない
export async function leave(member, room, pubs) {
	try {
		await member.leave();
	} catch {}
}
