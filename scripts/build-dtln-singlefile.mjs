import { readFile, writeFile } from 'node:fs/promises';

const DTLN_JS_PATH = 'public/dtln.js';
const DTLN_WASM_PATH = 'public/dtln_rs.wasm';
const PREAMBLE_BEGIN = '/* DTLN_SINGLE_FILE_PREAMBLE_BEGIN */';
const PREAMBLE_END = '/* DTLN_SINGLE_FILE_PREAMBLE_END */';

const stripExistingPreamble = (source) => {
  const start = source.indexOf(PREAMBLE_BEGIN);
  if (start === -1) return source;

  const end = source.indexOf(PREAMBLE_END, start);
  if (end === -1) return source;

  return source.slice(end + PREAMBLE_END.length).replace(/^\s*/, '');
};

const createPreamble = (base64) => `${PREAMBLE_BEGIN}
var Module = globalThis.Module || {};
(() => {
  const embeddedWasmBase64 = '${base64}';
  const shouldUseEmbeddedWasm = () => (
    typeof fetch !== 'function'
    && typeof XMLHttpRequest !== 'function'
    && typeof importScripts !== 'function'
  );
  const decodeEmbeddedBase64 = (input) => {
    const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const cleaned = input.replace(/\\s+/g, '').replace(/=+$/, '');
    const out = new Uint8Array((cleaned.length * 3) >> 2);
    let bits = 0;
    let value = 0;
    let offset = 0;

    for (let i = 0; i < cleaned.length; i++) {
      const index = table.indexOf(cleaned[i]);
      if (index === -1) continue;

      value = (value << 6) | index;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[offset++] = (value >> bits) & 0xff;
      }
    }

    return offset === out.length ? out : out.subarray(0, offset);
  };

  if (shouldUseEmbeddedWasm()) {
    Module.wasmBinary = decodeEmbeddedBase64(embeddedWasmBase64);
  } else {
    try {
      delete Module.wasmBinary;
    } catch {}
  }
  Module.wasmBinaryFile = '/dtln_rs.wasm';
  globalThis.Module = Module;
})();
${PREAMBLE_END}
`;

const run = async () => {
  const [jsSource, wasmBinary] = await Promise.all([
    readFile(DTLN_JS_PATH, 'utf8'),
    readFile(DTLN_WASM_PATH),
  ]);

  const loaderSource = stripExistingPreamble(jsSource);
  const preamble = createPreamble(wasmBinary.toString('base64'));
  const output = `${preamble}\n${loaderSource}`;

  await writeFile(DTLN_JS_PATH, output, 'utf8');
  console.log('[build-dtln-singlefile] updated public/dtln.js');
};

run().catch((error) => {
  console.error('[build-dtln-singlefile] failed', error);
  process.exitCode = 1;
});
