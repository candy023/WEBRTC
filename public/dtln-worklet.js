const DTLN_SCRIPT_PATH = '/dtln.js';
const DTLN_WASM_PATH = '/dtln_rs.wasm';
const DTLN_FIXED_BUFFER_SIZE = 512;
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

    this.port.onmessage = (event) => {
      const data = event?.data;

      if (data === 'shutdown' || data?.type === 'shutdown') {
        this.dispose();
        return;
      }

      if (data?.type === 'ping-ready' && this.isModuleReady) {
        this.notifyReady();
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

    if (!this.tryActivateModule()) {
      this.startModuleInitialization();
    }
  }

  postDiagnostic(payload) {
    try {
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
    const plugin = globalThis.DtlnPlugin;
    if (!plugin) return;
    plugin.postRun = [() => {
      this.tryActivateModule();
    }];
  }

  startModuleInitialization() {
    if (this.moduleInitPromise) return;

    const { applied: windowShimApplied, restore: restoreWindowShim } = this.applyWindowShimForModuleImport();
    this.configureModuleOverrides();
    this.postDiagnostic({
      type: 'dtln-module-bootstrap',
      windowShimApplied,
      locateFileConfigured: typeof globalThis.Module?.locateFile === 'function',
      wasmBinaryConfigured: !!globalThis.Module?.wasmBinary,
    });

    this.moduleInitPromise = import(DTLN_SCRIPT_PATH)
      .then(() => {
        this.attachDtlnPostRunHook();
        this.tryActivateModule();
      })
      .catch((error) => {
        this.postDiagnostic({
          type: 'error',
          stage: 'module-import',
          message: error?.message || String(error),
        });
      })
      .finally(() => {
        restoreWindowShim();
        this.postDiagnostic({
          type: 'dtln-window-shim-restored',
          windowTypeAfterRestore: typeof window,
        });
      });
  }

  notifyReady() {
    if (this.readyNotified) return;
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

    if (!this.tryActivateModule()) {
      this.startModuleInitialization();
      output.fill(0);
      return true;
    }

    try {
      if (!plugin) {
        output.fill(0);
        return true;
      }

      if (this.dtlnHandle === null || this.dtlnHandle === undefined) {
        this.dtlnHandle = plugin.dtln_create();
      }

      this.inputBuffer.set(input, this.inputIndex);
      this.inputIndex += input.length;

      if (this.inputIndex >= DTLN_FIXED_BUFFER_SIZE) {
        plugin.dtln_denoise(this.dtlnHandle, this.inputBuffer, this.outputBuffer);
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
    } catch (error) {
      output.fill(0);

      if (!this.disableMetrics) {
        try {
          this.port.postMessage({
            type: 'error',
            message: error?.message || String(error),
          });
        } catch {}
      }
    }

    return true;
  }
}

registerProcessor('NoiseSuppressionWorker', NoiseSuppressionWorker);
