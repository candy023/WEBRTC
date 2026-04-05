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
 *   cleanupSpeakingMonitors: () => void,
 * }}
 * @throws {never}
 * @sideeffects interval による音量監視と、対象タイルへの話者ハイライト付与/解除を行う。
 */
export function useSpeakingHighlightSession({
  streamArea,
}) {
  const SPEAKING_POLL_INTERVAL_MS = 150;
  const SPEAKING_LEVEL_THRESHOLD = 0.06;
  const SPEAKING_HOLD_MS = 500;
  const speakingMonitors = new Map();

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
    if (!containerEl) return;
    highlightSpeaking(containerEl, speaking);
  };

  const stopSpeakingMonitor = (memberId) => {
    if (!memberId) return;

    const monitor = speakingMonitors.get(memberId);
    if (monitor?.intervalId) {
      clearInterval(monitor.intervalId);
    }
    speakingMonitors.delete(memberId);
    applySpeakingHighlight(memberId, false);
  };

  const startSpeakingMonitor = (memberId, audioStream) => {
    if (!memberId) return;

    stopSpeakingMonitor(memberId);
    if (!audioStream) return;

    const monitor = {
      intervalId: null,
      speaking: false,
      lastAboveThresholdAt: 0,
      checking: false,
    };

    const readAudioLevel = async () => {
      const getAudioLevel = audioStream?.getAudioLevel;
      if (typeof getAudioLevel !== 'function') return 0;

      try {
        const level = await getAudioLevel.call(audioStream);
        return Number.isFinite(level) ? level : 0;
      } catch {
        return 0;
      }
    };

    const tick = async () => {
      if (monitor.checking) return;
      monitor.checking = true;

      try {
        const now = Date.now();
        const audioLevel = await readAudioLevel();

        if (audioLevel >= SPEAKING_LEVEL_THRESHOLD) {
          monitor.lastAboveThresholdAt = now;
          if (!monitor.speaking) {
            monitor.speaking = true;
            applySpeakingHighlight(memberId, true);
          }
          return;
        }

        if (monitor.speaking && now - monitor.lastAboveThresholdAt >= SPEAKING_HOLD_MS) {
          monitor.speaking = false;
          applySpeakingHighlight(memberId, false);
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
  };

  return {
    startSpeakingMonitor,
    stopSpeakingMonitor,
    cleanupSpeakingMonitors,
  };
}
