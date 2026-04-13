// VideoUIService.js
// 責務:
// ・DOM 操作によるリモート映像 / 音声要素の生成と管理
// ・話者ハイライトの付与 / 解除
// ・映像の拡大表示 / 元サイズへの復帰

/**
 * 単一 audio 要素の出力先を、対応ブラウザだけで安全に切り替える。
 *
 * @param {HTMLAudioElement | null | undefined} audioEl 出力先を変更する audio 要素。
 * @param {string} deviceId 適用するスピーカー deviceId。
 * @returns {Promise<void>}
 * @throws {never}
 * @sideeffects `setSinkId` が利用可能な場合に audio 要素の出力先を更新する。
 */
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

function normalizeVolumePercent(volumePercent) {
	const numeric = Number(volumePercent);
	if (!Number.isFinite(numeric)) return 100;
	if (numeric < 0) return 0;
	if (numeric > 100) return 100;
	return numeric;
}

/**
 * streamArea 配下の全 remote audio 要素へ、選択中スピーカー出力先を再適用する。
 *
 * @param {HTMLElement | null | undefined} streamAreaEl remote audio 要素を含むコンテナ。
 * @param {string} deviceId 適用するスピーカー deviceId。
 * @returns {Promise<void>}
 * @throws {never}
 * @sideeffects コンテナ内 audio 要素へ `setSinkId` を並列適用する。
 */
export async function setRemoteAudioOutput(streamAreaEl, deviceId) {
	if (!streamAreaEl) return;

	// 現在存在する remote audio 要素を列挙し、遅延追加前の既存要素へ即時反映する。
	const audioEls = Array.from(streamAreaEl.querySelectorAll('audio'));
	await Promise.allSettled(audioEls.map((el) => applyAudioOutputDevice(el, deviceId)));
}

/**
 * 指定 memberId の remote audio 要素へ音量を適用する。
 *
 * @param {HTMLElement | null | undefined} streamAreaEl remote audio 要素を持つコンテナ。
 * @param {string} memberId 対象 participant の memberId。
 * @param {number} volumePercent 適用する音量パーセント（0〜100）。
 * @returns {void}
 * @throws {never}
 * @sideeffects 対象 audio 要素の volume を更新する
 */
export function setRemoteParticipantVolume(streamAreaEl, memberId, volumePercent) {
	if (!streamAreaEl || !memberId) return;

	const normalizedPercent = normalizeVolumePercent(volumePercent);
	const normalizedVolume = normalizedPercent / 100;
	const audioEls = Array.from(streamAreaEl.querySelectorAll('audio[data-member-id]'));
	for (const audioEl of audioEls) {
		if (audioEl?.dataset?.memberId !== memberId) continue;
		audioEl.volume = normalizedVolume;
	}
}

/**
 * 指定 memberId のリモート映像タイルにある「🔇」バッジの表示状態を切り替える。
 *
 * @param {HTMLElement | null} streamAreaEl リモートタイルを含むコンテナ要素。
 * @param {string} memberId バッジ表示対象の memberId。
 * @param {boolean} visible true のとき表示、false のとき非表示。
 * @returns {void}
 * @throws {never}
 * @sideeffects 該当タイルのバッジDOM classList を更新する。
 */
export function setRemoteAudioMuteBadgeVisible(streamAreaEl, memberId, visible) {
	if (!streamAreaEl || !memberId) return;

	const tileEls = Array.from(streamAreaEl.querySelectorAll('[data-member-id]'));
	for (const tileEl of tileEls) {
		if (tileEl?.dataset?.memberId !== memberId) continue;

		const badgeEl = tileEl.querySelector('[data-audio-muted-badge="1"]');
		if (!badgeEl) continue;

		badgeEl.classList.toggle('hidden', !visible);
	}
}

/**
 * local タイルの mic mute バッジ表示を更新する。
 *
 * @param {HTMLElement | null | undefined} localTileEl local camera tile の container 要素。
 * @param {boolean} visible true のとき表示、false のとき非表示。
 * @returns {void}
 * @throws {never}
 * @sideeffects local tile バッジの classList を更新する
 */
export function setLocalAudioMuteBadgeVisible(localTileEl, visible) {
	if (!localTileEl) return;

	const badgeEl = localTileEl.querySelector('[data-local-audio-muted-badge="1"]');
	if (!badgeEl) return;

	badgeEl.classList.toggle('hidden', !visible);
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

	const localAudioMuteBadge = document.createElement('span');
	localAudioMuteBadge.textContent = '\u{1F507}';
	localAudioMuteBadge.dataset.localAudioMutedBadge = '1';
	localAudioMuteBadge.className =
		'hidden absolute bottom-2 right-2 bg-black bg-opacity-60 text-white px-1.5 py-0.5 rounded text-xs pointer-events-none';

	containerEl.appendChild(videoEl);
	containerEl.appendChild(enlargeBtn);
	containerEl.appendChild(localAudioMuteBadge);

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
	const {
		audioOutputDeviceId = '',
		audioVolumePercent = 100,
	} = options;
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
		el.play?.().catch((error) => {
			console.warn('remote video play failed', {
				errorName: error?.name,
				errorMessage: error?.message,
			});
		});

		const enlargeBtn = document.createElement('button');
		enlargeBtn.innerHTML = '⛶';
		enlargeBtn.className =
			'absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded hover:bg-opacity-70 text-sm';

		enlargeBtn.onclick = (e) => {
			e.stopPropagation();
			try { enlargeVideo(el); } catch {}
		};

		container.appendChild(enlargeBtn);

		const audioMuteBadge = document.createElement('span');
		audioMuteBadge.textContent = '\u{1F507}';
		audioMuteBadge.dataset.audioMutedBadge = '1';
		audioMuteBadge.className =
			'hidden absolute bottom-2 right-2 bg-black bg-opacity-60 text-white px-1.5 py-0.5 rounded text-xs pointer-events-none';
		container.appendChild(audioMuteBadge);

		return container;
	}

	if (hasAudio) {
		const el = document.createElement('audio');
		el.autoplay = true;
		el.controls = false;
		el.style.display = 'none';
		if (publication?.publisher?.id) el.dataset.memberId = publication.publisher.id;
		el.volume = normalizeVolumePercent(audioVolumePercent) / 100;

		streamAreaEl.appendChild(el);
		stream.attach(el);
		applyAudioOutputDevice(el, audioOutputDeviceId);
		el.play?.().catch((error) => {
			console.warn('remote audio play failed', {
				errorName: error?.name,
				errorMessage: error?.message,
			});
		});

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
		if (import.meta?.env?.DEV) {
			console.debug('[highlightSpeaking:true]', {
				memberId: containerEl?.dataset?.memberId || '',
				tagName: containerEl?.tagName || '',
				className: containerEl?.className || '',
				style: containerEl?.getAttribute?.('style') || '',
			});
		}
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
