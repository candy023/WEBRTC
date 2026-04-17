// RnnoiseService.js
// DTLN path removed. Keep this as a thin compatibility layer for browser-standard audio constraints.
const createStandardAudioConstraints = (audioDeviceId) => ({
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  ...(audioDeviceId ? { deviceId: audioDeviceId } : {})
});

const createResult = (constraints) => ({
  constraints,
  originalTrack: null,
  processedTrack: null,
  denoisedTrack: null,
  processor: null,
  cleanup: () => {},
  isActive: false
});

export async function setupRnnoise(audioDeviceId, options = {}) {
  const { onVad = () => {} } = options;
  void onVad;

  return createResult({
    audio: createStandardAudioConstraints(audioDeviceId),
  });
}
