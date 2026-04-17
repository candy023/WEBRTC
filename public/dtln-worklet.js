import '/dtln.js';
const DTLN_WASM_PATH = '/dtln_rs.wasm';
const DTLN_FIXED_BUFFER_SIZE = 512;
const DTLN_BYPASS_MODE = false;
const DTLN_DIAGNOSTICS_ENABLED = true;
const DTLN_DIAGNOSTIC_FIRST_FRAMES = 8;
const DTLN_DIAGNOSTIC_INTERVAL_FRAMES = 64;
const DTLN_OUTPUT_MINMAX_HISTORY_SIZE = 6;
const DTLN_NEAR_ZERO_RMS_THRESHOLD = 1e-4;
const DTLN_NEAR_ZERO_PEAK_THRESHOLD = 5e-4;
const createWorkletEnvSnapshot = () => ({
  fetchType: typeof fetch,
  xmlHttpRequestType: typeof XMLHttpRequest,
  importScriptsType: typeof importScripts,
  windowType: typeof window,
});

class NoiseSuppressionWorker extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.dtlnHandle = null;
    this.isModuleReady = false;
    this.isDisposed = false;
    this.readyNotified = false;
    this.inputBuffer = new Float32Array(DTLN_FIXED_BUFFER_SIZE);
    this.outputBuffer = new Float32Array(DTLN_FIXED_BUFFER_SIZE);
    this.inputIndex = 0;
    this.outputSamples = 0;
    this.disableMetrics = !!options?.processorOptions?.disableMetrics;
    this.moduleInitPromise = null;
    this.processFrameCount = 0;
    this.outputMinMaxHistory = [];
    this.lastDenoiseBlockStats = null;

    this.port.onmessage = (event) => {
      const data = event?.data;

      if (data === 'shutdown' || data?.type === 'shutdown') {
        this.dispose();
        return;
      }

      if (data?.type === 'ping-ready' && this.isModuleReady) {
        try {
          this.port.postMessage('ready');
        } catch {}
      }
    };

    const envSnapshot = createWorkletEnvSnapshot();
    this.postDiagnostic({
      type: 'dtln-worklet-env',
      ...envSnapshot,
    });
    try {
      console.info('[dtln-worklet] env', envSnapshot);
    } catch {}

    if (DTLN_BYPASS_MODE) {
      this.isModuleReady = true;
      this.notifyReady();
      this.postDiagnostic({
        type: 'dtln-bypass-enabled',
        fixedBufferSize: DTLN_FIXED_BUFFER_SIZE,
      });
      try {
        console.warn('[dtln-worklet] DTLN_BYPASS_MODE enabled: input is routed directly to output');
      } catch {}
      return;
    }

    if (!this.tryActivateModule()) {
      try {
        console.info('[dtln-worklet] constructor: calling startModuleInitialization');
      } catch {}
      this.startModuleInitialization();
    }
  }

  postDiagnostic(payload) {
    try {
      if (payload?.type === 'error') {
        try {
          console.error('[dtln-worklet] about to post error message', payload);
        } catch {}
      }
      this.port.postMessage(payload);
    } catch {}
  }

  applyWindowShimForModuleImport() {
    if (typeof window !== 'undefined') {
      return {
        applied: false,
        restore: () => {},
      };
    }

    let shimApplied = false;
    try {
      globalThis.window = globalThis;
      shimApplied = true;
    } catch {}

    return {
      applied: shimApplied,
      restore: () => {
        if (!shimApplied) return;
        try {
          delete globalThis.window;
        } catch {}
      },
    };
  }

  configureModuleOverrides() {
    const moduleRef = (typeof globalThis.Module === 'object' && globalThis.Module)
      ? globalThis.Module
      : {};
    const previousLocateFile = moduleRef.locateFile;

    moduleRef.locateFile = (path, scriptDirectory) => {
      if (typeof path === 'string' && path.endsWith('.wasm')) {
        return DTLN_WASM_PATH;
      }

      if (typeof previousLocateFile === 'function') {
        return previousLocateFile(path, scriptDirectory);
      }

      return path;
    };

    globalThis.Module = moduleRef;
  }

  attachDtlnPostRunHook() {
    try {
      console.info('[dtln-worklet] attachDtlnPostRunHook: invoked');
    } catch {}
    const plugin = globalThis.DtlnPlugin;
    if (!plugin) {
      try {
        console.error('[dtln-worklet] attachDtlnPostRunHook: DtlnPlugin missing');
      } catch {}
      return;
    }
    plugin.postRun = [() => {
      this.tryActivateModule();
    }];
  }

  startModuleInitialization() {
    if (this.moduleInitPromise) return;
    try {
      console.info('[dtln-worklet] startModuleInitialization: begin');
    } catch {}

    try {
      this.attachDtlnPostRunHook();
      this.tryActivateModule();
      this.moduleInitPromise = Promise.resolve();
    } catch (error) {
      this.moduleInitPromise = Promise.resolve();
      this.postDiagnostic({
        type: 'error',
        stage: 'module-init',
        message: error?.message || String(error),
      });
    }
  }

  notifyReady() {
    if (this.readyNotified) return;
    try {
      console.info('[dtln-worklet] notifyReady: posting ready');
    } catch {}
    this.readyNotified = true;

    try {
      this.port.postMessage('ready');
    } catch {}
  }

  tryActivateModule() {
    if (this.isModuleReady) return true;

    const moduleRef = globalThis.Module;
    if (
      moduleRef
      && typeof moduleRef._dtln_create_wasm === 'function'
      && typeof moduleRef._dtln_denoise_wasm === 'function'
      && typeof moduleRef.HEAPF32 !== 'undefined'
    ) {
      try {
        console.info('[dtln-worklet] tryActivateModule: module became ready');
      } catch {}
      this.isModuleReady = true;
      this.notifyReady();
      return true;
    }

    return false;
  }

  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    const plugin = globalThis.DtlnPlugin;

    try {
      if (plugin && this.dtlnHandle !== null && this.dtlnHandle !== undefined) {
        plugin.dtln_destroy(this.dtlnHandle);
      }
    } catch {}

    this.dtlnHandle = null;
  }

  hasValidInput(inputs) {
    return !!(inputs && inputs.length && inputs[0] && inputs[0].length);
  }

  hasValidOutput(outputs) {
    return !!(outputs && outputs.length && outputs[0] && outputs[0].length);
  }

  fillSilence(outputs) {
    if (this.hasValidOutput(outputs)) {
      outputs[0][0].fill(0);
    }
  }

  calculateBufferStats(buffer, length = buffer?.length || 0) {
    if (!buffer || length <= 0) {
      return {
        rms: 0,
        peak: 0,
        min: 0,
        max: 0,
      };
    }

    let sumSquares = 0;
    let peak = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let index = 0; index < length; index += 1) {
      const sample = buffer[index];
      const absSample = Math.abs(sample);
      if (absSample > peak) {
        peak = absSample;
      }
      if (sample < min) {
        min = sample;
      }
      if (sample > max) {
        max = sample;
      }
      sumSquares += sample * sample;
    }

    return {
      rms: Math.sqrt(sumSquares / length),
      peak,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
    };
  }

  isNearZero(stats) {
    return (
      (stats?.rms || 0) <= DTLN_NEAR_ZERO_RMS_THRESHOLD
      && (stats?.peak || 0) <= DTLN_NEAR_ZERO_PEAK_THRESHOLD
    );
  }

  recordOutputMinMax(outputStats) {
    this.outputMinMaxHistory.push({
      frame: this.processFrameCount,
      min: outputStats.min,
      max: outputStats.max,
    });
    if (this.outputMinMaxHistory.length > DTLN_OUTPUT_MINMAX_HISTORY_SIZE) {
      this.outputMinMaxHistory.shift();
    }
  }

  compareLevelStats(inputStats, outputStats) {
    const inputRms = inputStats?.rms || 0;
    const outputRms = outputStats?.rms || 0;
    if (inputRms <= 0) {
      return {
        outputInputRmsRatio: null,
        outputInputDb: null,
      };
    }

    const outputInputRmsRatio = outputRms / inputRms;
    return {
      outputInputRmsRatio,
      outputInputDb: outputRms > 0 ? (20 * Math.log10(outputInputRmsRatio)) : null,
    };
  }

  shouldEmitDiagnostics() {
    this.processFrameCount += 1;
    if (!DTLN_DIAGNOSTICS_ENABLED) return false;
    if (this.processFrameCount <= DTLN_DIAGNOSTIC_FIRST_FRAMES) return true;
    return this.processFrameCount % DTLN_DIAGNOSTIC_INTERVAL_FRAMES === 0;
  }

  emitFrameDiagnostics(mode, input, output) {
    if (!this.shouldEmitDiagnostics()) return;

    const inputStats = this.calculateBufferStats(input, input.length);
    const outputStats = this.calculateBufferStats(output, output.length);
    this.recordOutputMinMax(outputStats);

    const payload = {
      type: 'dtln-levels',
      mode,
      frame: this.processFrameCount,
      input: inputStats,
      output: outputStats,
      ...this.compareLevelStats(inputStats, outputStats),
      outputNearZero: this.isNearZero(outputStats),
      outputMinMaxHistory: this.outputMinMaxHistory.slice(),
      denoiseBlockComparison: this.lastDenoiseBlockStats,
    };

    this.postDiagnostic(payload);
    try {
      console.info('[dtln-worklet] levels', payload);
    } catch {}
  }

  process(inputs, outputs) {
    if (this.isDisposed) {
      this.fillSilence(outputs);
      return false;
    }

    if (!this.hasValidInput(inputs) || !this.hasValidOutput(outputs)) {
      this.fillSilence(outputs);
      return true;
    }

    const input = inputs[0][0];
    const output = outputs[0][0];
    const plugin = globalThis.DtlnPlugin;

    if (DTLN_BYPASS_MODE) {
      output.set(input);
      this.emitFrameDiagnostics('bypass', input, output);
      return true;
    }

    if (!this.tryActivateModule()) {
      this.startModuleInitialization();
      output.fill(0);
      this.emitFrameDiagnostics('module-not-ready', input, output);
      return true;
    }

    try {
      if (!plugin) {
        output.fill(0);
        this.emitFrameDiagnostics('plugin-missing', input, output);
        return true;
      }

      if (this.dtlnHandle === null || this.dtlnHandle === undefined) {
        this.dtlnHandle = plugin.dtln_create();
      }

      this.inputBuffer.set(input, this.inputIndex);
      this.inputIndex += input.length;

      if (this.inputIndex >= DTLN_FIXED_BUFFER_SIZE) {
        const denoiseInputStats = this.calculateBufferStats(this.inputBuffer, DTLN_FIXED_BUFFER_SIZE);
        plugin.dtln_denoise(this.dtlnHandle, this.inputBuffer, this.outputBuffer);
        const denoiseOutputStats = this.calculateBufferStats(this.outputBuffer, DTLN_FIXED_BUFFER_SIZE);
        this.lastDenoiseBlockStats = {
          input: denoiseInputStats,
          output: denoiseOutputStats,
          ...this.compareLevelStats(denoiseInputStats, denoiseOutputStats),
          outputNearZero: this.isNearZero(denoiseOutputStats),
        };
        this.inputIndex = 0;
        this.outputSamples = DTLN_FIXED_BUFFER_SIZE;
      }

      if (this.outputSamples > 0) {
        output.set(this.outputBuffer.subarray(0, input.length));
        this.outputBuffer.copyWithin(0, input.length);
        this.outputSamples = Math.max(0, this.outputSamples - input.length);
      } else {
        output.fill(0);
      }
      this.emitFrameDiagnostics('dtln', input, output);
    } catch (error) {
      output.fill(0);
      this.emitFrameDiagnostics('dtln-error', input, output);

      if (!this.disableMetrics) {
        try {
          const message = error?.message || String(error);
          try {
            console.error('[dtln-worklet] about to post error message', { type: 'error', message });
          } catch {}
          this.port.postMessage({
            type: 'error',
            message,
          });
        } catch {}
      }
    }

    return true;
  }
}

registerProcessor('NoiseSuppressionWorker', NoiseSuppressionWorker);
