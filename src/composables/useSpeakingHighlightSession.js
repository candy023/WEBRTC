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
  const isDev = !!import.meta?.env?.DEV;
  const SPEAKING_POLL_INTERVAL_MS = 150;
  const SPEAKING_THRESHOLD_ON = 0.02;
  const SPEAKING_THRESHOLD_OFF = 0.01;
  const SPEAKING_RMS_HISTORY_LENGTH = 5;
  const speakingMonitors = new Map();
  let audioContext = null;

  const debugSpeaking = (label, payload = {}) => {
    if (!isDev) return;
    console.debug(`[speaking] ${label}`, payload);
  };

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

  const computeRms = (dataArray) => {
    if (!dataArray?.length) return 0;

    let sum = 0;
    for (let i = 0; i < dataArray.length; i += 1) {
      const value = (dataArray[i] - 128) / 128;
      sum += value * value;
    }
    return Math.sqrt(sum / dataArray.length);
  };

  const findTileContainerByMemberId = (memberId) => {
    if (!memberId) return null;

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

  const updateVadLevel = () => {};

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

    const monitor = {
      intervalId: null,
      speaking: false,
      checking: false,
      sourceNode: analyserState?.sourceNode || null,
      analyser: analyserState?.analyser || null,
      dataArray: analyserState?.dataArray || null,
      rmsHistory: [],
    };

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
        debugSpeaking('rms', {
          memberId,
          rmsLevel,
          avgRms,
          audioContextState: audioContext?.state || '',
          hasAnalyser: !!monitor.analyser,
          historyLength: monitor.rmsHistory.length,
          speaking: monitor.speaking,
        });

        const prevSpeaking = monitor.speaking;
        let nextSpeaking = prevSpeaking;
        if (!prevSpeaking && avgRms >= SPEAKING_THRESHOLD_ON) {
          nextSpeaking = true;
        } else if (prevSpeaking && avgRms < SPEAKING_THRESHOLD_OFF) {
          nextSpeaking = false;
        }

        if (nextSpeaking !== prevSpeaking) {
          monitor.speaking = nextSpeaking;
          debugSpeaking('speakingChanged', {
            memberId,
            prevSpeaking,
            nextSpeaking,
            avgRms,
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
