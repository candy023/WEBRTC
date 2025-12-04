// VideoUIService.js
// 責務:
// ・DOM 操作によるリモート映像 / 音声要素の生成と管理
// ・話者ハイライトの付与 / 解除
// ・映像の拡大表示 / 元サイズへの復帰

/**
 * リモートの MediaStream を UI へアタッチする
 *
 * 目的:
 * ・SkyWay で subscribe したリモート映像 / 音声を DOM 要素として表示する
 * ・video / audio の種別を自動判定し、適切な要素を生成する
 * 作用:
 * ・DOM に要素を追加し、即座に再生を開始する
 */
export function attachRemoteStream(streamAreaEl, stream, publication) {
	if (!streamAreaEl) return;

	// 映像トラックを含むかの判定
	const hasVideo = !!(
		stream?.track?.kind === 'video' ||
		(stream.mediaStream && stream.mediaStream.getVideoTracks?.().length)
	);

	// 音声トラックのみかの判定
	const hasAudio = !!(
		stream?.track?.kind === 'audio' ||
		(stream.mediaStream && stream.mediaStream.getAudioTracks?.().length)
	);

	if (hasVideo) {
		// 映像タイル用の外枠コンテナを作成（レイアウト・角丸・背景色を統一）
		const container = document.createElement('div');
		container.className = 'relative w-full aspect-video bg-black rounded overflow-hidden';

		// 後続の UI 操作（話者ハイライト等）のために memberId と pubId を埋め込む
		if (publication?.publisher?.id) container.dataset.memberId = publication.publisher.id;
		if (publication?.id) container.dataset.pubId = publication.id;

		// 親コンテナへ映像タイルを追加
		streamAreaEl.appendChild(container);

		// 自動再生・インライン再生対応の video 要素を生成
		const el = document.createElement('video');
		el.autoplay = true;
		el.playsInline = true;
		el.className = 'w-full h-full object-cover';

		// 映像タイルに video 要素を配置
		container.appendChild(el);

		// SkyWay の stream を video 要素へアタッチ
		stream.attach(el);

		// ブラウザ制約対策として play の失敗は握りつぶす
		el.play?.().catch(() => {});

		// 映像タイルごとに拡大ボタンを付与（視認性と操作性向上）
		const enlargeBtn = document.createElement('button');
		enlargeBtn.innerHTML = '⛶';
		enlargeBtn.className =
			'absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded hover:bg-opacity-70 text-sm';

		// クリック時に映像のみを全画面化
		enlargeBtn.onclick = (e) => {
			e.stopPropagation();
			try { enlargeVideo(el); } catch {}
		};

		container.appendChild(enlargeBtn);

		return container;

	} else if (hasAudio) {
		// 音声専用ストリームは UI に表示しないため、非表示の audio 要素として扱う
		const el = document.createElement('audio');
		el.autoplay = true;
		el.controls = false;
		el.style.display = 'none';

		streamAreaEl.appendChild(el);
		stream.attach(el);
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
		// 発話中は枠線と影を付与して視認性を上げる
		containerEl.classList.add('speaking');
		containerEl.style.outline = '3px solid #22c55e';
		containerEl.style.boxShadow = '0 0 8px #22c55e';
	} else {
		// 発話が止まったら装飾をすべて解除する
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

	// すでに拡大状態の場合は二重実行を防止
	if (videoEl.__originalNextSibling) return;

	// 元の状態を video 要素自身に退避保存
	videoEl.__originalClass = videoEl.className;      // 元のクラス
	videoEl.__originalParent = videoEl.parentNode;   // 元の親DOM
	videoEl.__originalNextSibling = videoEl.nextSibling; // 元の挿入位置

	// 全画面表示用のクラスに置き換え
	videoEl.className = 'fixed inset-0 w-screen h-screen object-contain bg-black z-50 cursor-pointer';

	// body 直下へ移動して最前面表示
	document.body.appendChild(videoEl);

	// 閉じるためのボタンを右上に追加
	const closeBtn = document.createElement('button');
	closeBtn.innerHTML = '✕';
	closeBtn.className =
		'fixed top-4 right-4 z-50 bg-red-600 text-white p-3 rounded-full hover:bg-red-700 text-xl font-bold';

	closeBtn.onclick = (e) => {
		e.stopPropagation();
		shrinkVideo(videoEl);
	};

	document.body.appendChild(closeBtn);

	// 復帰時に削除できるよう参照を保持
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

	// 元のクラスへ戻す
	videoEl.className = videoEl.__originalClass;

	// 元の DOM 挿入位置へ正確に復帰
	if (videoEl.__originalNextSibling) {
		videoEl.__originalParent.insertBefore(videoEl, videoEl.__originalNextSibling);
	} else {
		videoEl.__originalParent.appendChild(videoEl);
	}

	// クリックイベントの解除
	videoEl.onclick = null;

	// 閉じるボタンの削除
	if (videoEl.__closeBtn) {
		videoEl.__closeBtn.remove();
		delete videoEl.__closeBtn;
	}

	// 拡大状態フラグとして使っていた退避データを削除
	delete videoEl.__originalNextSibling;
}
