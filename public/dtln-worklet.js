import '/dtln.js';

const DTLN_FIXED_BUFFER_SIZE = 512;

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

    this.tryActivateModule();

    if (!this.isModuleReady && typeof DtlnPlugin !== 'undefined') {
      DtlnPlugin.postRun = [() => {
        this.tryActivateModule();
      }];
    }
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

    if (
      typeof Module !== 'undefined'
      && typeof Module._dtln_create_wasm === 'function'
      && typeof Module._dtln_denoise_wasm === 'function'
      && typeof Module.HEAPF32 !== 'undefined'
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

    try {
      if (this.dtlnHandle !== null && this.dtlnHandle !== undefined) {
        DtlnPlugin.dtln_destroy(this.dtlnHandle);
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

    if (!this.tryActivateModule()) {
      output.fill(0);
      return true;
    }

    try {
      if (this.dtlnHandle === null || this.dtlnHandle === undefined) {
        this.dtlnHandle = DtlnPlugin.dtln_create();
      }

      this.inputBuffer.set(input, this.inputIndex);
      this.inputIndex += input.length;

      if (this.inputIndex >= DTLN_FIXED_BUFFER_SIZE) {
        DtlnPlugin.dtln_denoise(this.dtlnHandle, this.inputBuffer, this.outputBuffer);
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
