// VideoUIService.js
// 責務:
// ・DOM 操作によるリモート映像 / 音声要素の生成と管理
// ・話者ハイライトの付与 / 解除
// ・映像の拡大表示 / 元サイズへの復帰

async function applyAudioOutputDevice(audioEl, deviceId) {
	if (!audioEl) return;
	if (!deviceId) return;
	if (typeof audioEl.setSinkId !== 'function') return;

	try {
		await audioEl.setSinkId(deviceId);
	} catch (err) {
		console.warn('スピーカー出力先の切り替えに失敗:', err);
	}
}

export async function setRemoteAudioOutput(streamAreaEl, deviceId) {
	if (!streamAreaEl) return;

	const audioEls = Array.from(streamAreaEl.querySelectorAll('audio'));
	await Promise.allSettled(audioEls.map((el) => applyAudioOutputDevice(el, deviceId)));
}

/**
 * ローカルタイル用の DOM 要素を再利用または新規作成して返す。
 *
 * @param {object} params
 * @param {HTMLDivElement | null} params.currentContainerEl 既存コンテナ要素。
 * @param {HTMLVideoElement | null} params.currentVideoEl 既存 video 要素。
 * @param {(videoEl: HTMLVideoElement) => void} params.onEnlarge 拡大表示ボタン押下時の処理。
 * @returns {{ containerEl: HTMLDivElement, videoEl: HTMLVideoElement }}
 * @throws {never}
 * @sideeffects DOM 要素を生成する
 */
export function ensureLocalTileElement({
	currentContainerEl,
	currentVideoEl,
	onEnlarge,
}) {
	if (currentContainerEl && currentVideoEl) {
		return {
			containerEl: currentContainerEl,
			videoEl: currentVideoEl,
		};
	}

	const containerEl = document.createElement('div');
	containerEl.className = 'relative w-full aspect-video bg-black rounded overflow-hidden';

	const videoEl = document.createElement('video');
	videoEl.autoplay = true;
	videoEl.playsInline = true;
	videoEl.muted = true;
	videoEl.className = 'w-full h-full object-cover';

	const enlargeBtn = document.createElement('button');
	enlargeBtn.innerHTML = '&#9974;';
	enlargeBtn.className =
		'absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded hover:bg-opacity-70 text-sm';
	enlargeBtn.onclick = (event) => {
		event.stopPropagation();
		try {
			onEnlarge?.(videoEl);
		} catch {}
	};

	containerEl.appendChild(videoEl);
	containerEl.appendChild(enlargeBtn);

	return { containerEl, videoEl };
}

/**
 * リモートの MediaStream を UI へアタッチする
 *
 * 目的:
 * ・SkyWay で subscribe したリモート映像 / 音声を DOM 要素として表示する
 * ・video / audio の種別を自動判定し、適切な要素を生成する
 * 作用:
 * ・DOM に要素を追加し、即座に再生を開始する
 */
export function attachRemoteStream(streamAreaEl, stream, publication, options = {}) {
	const { audioOutputDeviceId = '' } = options;
	if (!streamAreaEl) return;

	const hasVideo = !!(
		stream?.track?.kind === 'video' ||
		(stream.mediaStream && stream.mediaStream.getVideoTracks?.().length)
	);

	const hasAudio = !!(
		stream?.track?.kind === 'audio' ||
		(stream.mediaStream && stream.mediaStream.getAudioTracks?.().length)
	);

	if (hasVideo) {
		const container = document.createElement('div');
		container.className = 'relative w-full aspect-video bg-black rounded overflow-hidden';

		if (publication?.publisher?.id) container.dataset.memberId = publication.publisher.id;
		if (publication?.id) container.dataset.pubId = publication.id;

		streamAreaEl.appendChild(container);

		const el = document.createElement('video');
		el.autoplay = true;
		el.playsInline = true;
		el.className = 'w-full h-full object-cover';

		container.appendChild(el);
		stream.attach(el);
		el.play?.().catch(() => {});

		const enlargeBtn = document.createElement('button');
		enlargeBtn.innerHTML = '⛶';
		enlargeBtn.className =
			'absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded hover:bg-opacity-70 text-sm';

		enlargeBtn.onclick = (e) => {
			e.stopPropagation();
			try { enlargeVideo(el); } catch {}
		};

		container.appendChild(enlargeBtn);

		return container;
	}

	if (hasAudio) {
		const el = document.createElement('audio');
		el.autoplay = true;
		el.controls = false;
		el.style.display = 'none';

		streamAreaEl.appendChild(el);
		stream.attach(el);
		applyAudioOutputDevice(el, audioOutputDeviceId);
		el.play?.().catch(() => {});

		return el;
	}
}

/**
 * 話者状態に応じて、映像コンテナへ視覚的ハイライトを付与 / 除去する
 *
 * 目的:
 * ・現在発話中のユーザーを視覚的に分かりやすくする
 */
export function highlightSpeaking(containerEl, speaking) {
	if (!containerEl) return;

	if (speaking) {
		containerEl.classList.add('speaking');
		containerEl.style.outline = '3px solid #22c55e';
		containerEl.style.boxShadow = '0 0 8px #22c55e';
	} else {
		containerEl.classList.remove('speaking');
		containerEl.style.outline = '';
		containerEl.style.boxShadow = '';
	}
}

/**
 * 指定された video 要素を全画面オーバーレイへ移動して拡大表示する
 *
 * 目的:
 * ・特定の参加者映像を一時的にフルスクリーンで確認できるようにする
 *
 * 副作用:
 * ・元の親要素・クラス・挿入位置を videoEl 自体に退避保存する
 * ・body 直下へ移動し、閉じるボタンを追加する
 */
export function enlargeVideo(videoEl) {
	if (!videoEl) return;

	if (videoEl.__originalNextSibling) return;

	videoEl.__originalClass = videoEl.className;
	videoEl.__originalParent = videoEl.parentNode;
	videoEl.__originalNextSibling = videoEl.nextSibling;

	videoEl.className = 'fixed inset-0 w-screen h-screen object-contain bg-black z-50 cursor-pointer';
	document.body.appendChild(videoEl);

	const closeBtn = document.createElement('button');
	closeBtn.innerHTML = '✕';
	closeBtn.className =
		'fixed top-4 right-4 z-50 bg-red-600 text-white p-3 rounded-full hover:bg-red-700 text-xl font-bold';

	closeBtn.onclick = (e) => {
		e.stopPropagation();
		shrinkVideo(videoEl);
	};

	document.body.appendChild(closeBtn);
	videoEl.__closeBtn = closeBtn;
}

/**
 * 拡大表示した video を元のコンテナへ戻す
 *
 * 副作用:
 * ・クラスと DOM の挿入位置を完全に元通りに復元する
 * ・拡大用の閉じるボタンを削除する
 */
export function shrinkVideo(videoEl) {
	if (!videoEl || !videoEl.__originalParent) return;

	videoEl.className = videoEl.__originalClass;

	if (videoEl.__originalNextSibling) {
		videoEl.__originalParent.insertBefore(videoEl, videoEl.__originalNextSibling);
	} else {
		videoEl.__originalParent.appendChild(videoEl);
	}

	videoEl.onclick = null;

	if (videoEl.__closeBtn) {
		videoEl.__closeBtn.remove();
		delete videoEl.__closeBtn;
	}

	delete videoEl.__originalNextSibling;
}
