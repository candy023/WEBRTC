import { highlightSpeaking } from '../services/VideoUIService.js';

/**
 * 話者ハイライトの監視と適用を管理する composable。
 *
 * `useStreamReceiver` には monitor 本体を置かず、
 * local / remote audio stream の監視責務を本 composable に集約する。
 *
 * @param {object} params
 * @param {import('vue').Ref<HTMLElement | null>} params.streamArea remote attach 先コンテナ。
 * @returns {{
 *   startSpeakingMonitor: (memberId: string, audioStream: any) => void,
 *   stopSpeakingMonitor: (memberId: string) => void,
 *   updateVadLevel: (memberId: string, vadLevel: number) => void,
 *   cleanupSpeakingMonitors: () => void,
 * }}
 * @throws {never}
 * @sideeffects interval による音量監視と、対象タイルへの話者ハイライト付与/解除を行う。
 */
export function useSpeakingHighlightSession({
  streamArea,
}) {
  // DEV 環境だけ話者判定ログを出し、本番ログノイズを抑える。
  const isDev = !!import.meta?.env?.DEV;
  // 話者判定のポーリング間隔（ms）。負荷と追従性のバランスで 150ms を採用する。
  const SPEAKING_POLL_INTERVAL_MS = 150;
  // RMS ベース判定で非発話から発話へ遷移するしきい値。
  const SPEAKING_THRESHOLD_ON = 0.02;
  // RMS ベース判定で発話から非発話へ戻すしきい値（ヒステリシス用）。
  const SPEAKING_THRESHOLD_OFF = 0.01;
  // VAD/getAudioLevel ベース判定で非発話から発話へ遷移するしきい値。
  const SPEAKING_LEVEL_THRESHOLD_ON = 0.06;
  // VAD/getAudioLevel ベース判定で発話から非発話へ戻すしきい値（ヒステリシス用）。
  const SPEAKING_LEVEL_THRESHOLD_OFF = 0.03;
  // この時間（ms）以内に更新された VAD 値だけを優先し、古い値は破棄する。
  const SPEAKING_VAD_STALE_MS = 1000;
  // 瞬間的な振れを吸収するために保持する RMS 履歴サンプル数。
  const SPEAKING_RMS_HISTORY_LENGTH = 5;
  // memberId ごとの監視状態（interval/analyser/VAD 最新値）を保持する。
  const speakingMonitors = new Map();
  // 全 monitor が共有する AudioContext。必要時のみ初期化して再利用する。
  let audioContext = null;

  // DEV 専用の話者監視ログ出力。
  const debugSpeaking = (label, payload = {}) => {
    if (!isDev) return;
    console.log(`[speaking] ${label}`, payload);
  };

  // 話者監視に使う AudioContext を遅延生成し、停止復帰時は resume を試行する。
  const ensureAudioContext = () => {
    if (!audioContext) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        return null;
      }
    }

    try {
      audioContext.resume?.();
    } catch {}
    return audioContext;
  };

  // SkyWay stream / MediaStream どちらでも先頭の audio track を取り出す。
  const extractAudioTrack = (audioStream) => {
    if (!audioStream) return null;

    if (audioStream?.track?.kind === 'audio') {
      return audioStream.track;
    }

    const mediaStreamAudioTrack = audioStream?.mediaStream?.getAudioTracks?.()[0];
    if (mediaStreamAudioTrack) return mediaStreamAudioTrack;

    const directAudioTrack = audioStream?.getAudioTracks?.()[0];
    if (directAudioTrack) return directAudioTrack;

    return null;
  };

  // 取得した audio track から analyser を組み立て、RMS 計算に必要な state を返す。
  const createAnalyserForTrack = (audioTrack) => {
    if (!audioTrack) return null;

    const context = ensureAudioContext();
    if (!context) return null;

    try {
      const sourceStream = new MediaStream([audioTrack]);
      const sourceNode = context.createMediaStreamSource(sourceStream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      sourceNode.connect(analyser);

      return {
        sourceNode,
        analyser,
        dataArray: new Uint8Array(analyser.fftSize),
      };
    } catch {
      return null;
    }
  };

  // analyser の時系列データから RMS（0-1 近辺）を計算する。
  const computeRms = (dataArray) => {
    if (!dataArray?.length) return 0;

    let sum = 0;
    for (let i = 0; i < dataArray.length; i += 1) {
      const value = (dataArray[i] - 128) / 128;
      sum += value * value;
    }
    return Math.sqrt(sum / dataArray.length);
  };

  // memberId に一致するタイル要素を優先順位つきで探索する。
  const findTileContainerByMemberId = (memberId) => {
    if (!memberId) return null;

    const visibleSpeakingHost = Array.from(
      document.querySelectorAll('[data-speaking-host="1"][data-member-id]')
    ).find((tileEl) => tileEl?.dataset?.memberId === memberId);
    if (visibleSpeakingHost) return visibleSpeakingHost;

    if (streamArea.value) {
      const inStreamArea = Array.from(streamArea.value.querySelectorAll('[data-member-id]')).find(
        (tileEl) => tileEl?.dataset?.memberId === memberId
      );
      if (inStreamArea) return inStreamArea;
    }

    return Array.from(document.querySelectorAll('[data-member-id]')).find(
      (tileEl) => tileEl?.dataset?.memberId === memberId
    ) || null;
  };

  // 話者状態に応じた視覚ハイライトを該当タイルへ適用する。
  const applySpeakingHighlight = (memberId, speaking) => {
    const containerEl = findTileContainerByMemberId(memberId);
    debugSpeaking('applyHighlight', {
      memberId,
      speaking,
      hasContainer: !!containerEl,
      tagName: containerEl?.tagName || '',
      className: containerEl?.className || '',
    });
    if (!containerEl) return;
    highlightSpeaking(containerEl, speaking);
  };

  // 指定 member の監視を停止し、monitor state とハイライトを確実に解放する。
  const stopSpeakingMonitor = (memberId) => {
    if (!memberId) return;

    const monitor = speakingMonitors.get(memberId);
    if (monitor?.intervalId) {
      clearInterval(monitor.intervalId);
    }
    try {
      monitor?.sourceNode?.disconnect?.();
    } catch {}
    speakingMonitors.delete(memberId);
    applySpeakingHighlight(memberId, false);
  };

  // 外部（RNNoise VAD）から受けた最新レベルを monitor に反映する。
  const updateVadLevel = (memberId, vadLevel) => {
    if (!memberId) return;

    const monitor = speakingMonitors.get(memberId);
    if (!monitor) return;

    if (!Number.isFinite(vadLevel)) return;
    monitor.vadLevel = vadLevel;
    monitor.vadUpdatedAt = Date.now();
  };

  // 指定 member の音声監視を開始し、RMS/VAD のハイブリッド判定で話者状態を更新する。
  const startSpeakingMonitor = (memberId, audioStream) => {
    debugSpeaking('startMonitor', {
      memberId,
      hasAudioStream: !!audioStream,
      streamType: audioStream?.constructor?.name || typeof audioStream,
      streamTrackKind: audioStream?.track?.kind || '',
    });
    if (!memberId) return;

    stopSpeakingMonitor(memberId);
    if (!audioStream) return;

    const audioTrack = extractAudioTrack(audioStream);
    debugSpeaking('audioTrack', {
      memberId,
      hasAudioTrack: !!audioTrack,
      kind: audioTrack?.kind || '',
      label: audioTrack?.label || '',
      readyState: audioTrack?.readyState || '',
      enabled: audioTrack?.enabled,
      muted: audioTrack?.muted,
    });
    const analyserState = createAnalyserForTrack(audioTrack);
    debugSpeaking('analyserState', {
      memberId,
      hasAnalyser: !!analyserState?.analyser,
      hasSourceNode: !!analyserState?.sourceNode,
      audioContextState: audioContext?.state || '',
    });

    // memberId ごとの監視中状態。tick で更新し、stop/cleanup で破棄する。
    const monitor = {
      intervalId: null,
      speaking: false,
      checking: false,
      sourceNode: analyserState?.sourceNode || null,
      analyser: analyserState?.analyser || null,
      dataArray: analyserState?.dataArray || null,
      rmsHistory: [],
      vadLevel: null,
      vadUpdatedAt: 0,
    };

    // 監視レベルの取得元を VAD -> getAudioLevel -> RMS の順でフォールバックする。
    const readAudioLevel = async () => {
      const now = Date.now();
      if (
        Number.isFinite(monitor.vadLevel) &&
        monitor.vadUpdatedAt > 0 &&
        now - monitor.vadUpdatedAt <= SPEAKING_VAD_STALE_MS
      ) {
        return {
          level: monitor.vadLevel,
          source: 'vad',
        };
      }

      const getAudioLevel = audioStream?.getAudioLevel;
      if (typeof getAudioLevel === 'function') {
        try {
          const level = await getAudioLevel.call(audioStream);
          if (Number.isFinite(level)) {
            return {
              level,
              source: 'audioLevel',
            };
          }
        } catch {}
      }

      return {
        level: null,
        source: 'none',
      };
    };

    // 1 回分の判定処理。ヒステリシスしきい値を使って speaking state を安定化する。
    const tick = async () => {
      if (monitor.checking) return;
      monitor.checking = true;

      try {
        let rmsLevel = 0;
        try {
          if (monitor.analyser && monitor.dataArray) {
            monitor.analyser.getByteTimeDomainData(monitor.dataArray);
            rmsLevel = computeRms(monitor.dataArray);
          }
        } catch {}

        monitor.rmsHistory.push(rmsLevel);
        if (monitor.rmsHistory.length > SPEAKING_RMS_HISTORY_LENGTH) {
          monitor.rmsHistory.shift();
        }
        const avgRms = monitor.rmsHistory.length
          ? monitor.rmsHistory.reduce((sum, value) => sum + value, 0) / monitor.rmsHistory.length
          : 0;
        const levelState = await readAudioLevel();
        const source = levelState.source === 'none' ? 'rms' : levelState.source;
        const audioLevel = source === 'rms' ? avgRms : (levelState.level ?? 0);
        const speakingOnThreshold = source === 'rms' ? SPEAKING_THRESHOLD_ON : SPEAKING_LEVEL_THRESHOLD_ON;
        const speakingOffThreshold = source === 'rms' ? SPEAKING_THRESHOLD_OFF : SPEAKING_LEVEL_THRESHOLD_OFF;
        debugSpeaking('rms', {
          memberId,
          rmsLevel,
          avgRms,
          source,
          audioLevel,
          audioContextState: audioContext?.state || '',
          hasAnalyser: !!monitor.analyser,
          historyLength: monitor.rmsHistory.length,
          speaking: monitor.speaking,
        });

        const prevSpeaking = monitor.speaking;
        let nextSpeaking = prevSpeaking;
        if (!prevSpeaking && audioLevel >= speakingOnThreshold) {
          nextSpeaking = true;
        } else if (prevSpeaking && audioLevel < speakingOffThreshold) {
          nextSpeaking = false;
        }

        if (nextSpeaking !== prevSpeaking) {
          monitor.speaking = nextSpeaking;
          debugSpeaking('speakingChanged', {
            memberId,
            prevSpeaking,
            nextSpeaking,
            audioLevel,
            source,
          });
          applySpeakingHighlight(memberId, nextSpeaking);
          return;
        }

        if (monitor.speaking) {
          applySpeakingHighlight(memberId, true);
        }
      } finally {
        monitor.checking = false;
      }
    };

    monitor.intervalId = setInterval(() => {
      void tick();
    }, SPEAKING_POLL_INTERVAL_MS);
    speakingMonitors.set(memberId, monitor);
    void tick();
  };

  // 全 member の監視を停止し、共有 AudioContext も閉じてセッション境界を初期化する。
  const cleanupSpeakingMonitors = () => {
    Array.from(speakingMonitors.keys()).forEach((memberId) => {
      stopSpeakingMonitor(memberId);
    });

    try {
      audioContext?.close?.();
    } catch {}
    audioContext = null;
  };

  return {
    startSpeakingMonitor,
    stopSpeakingMonitor,
    updateVadLevel,
    cleanupSpeakingMonitors,
  };
}
