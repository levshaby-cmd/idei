import {
  configureOrtWeb,
  loadLocalModel,
  loadLocalVadModel,
} from 'onnx-asr-web/browser';

let modelPromise = null;

// Загрузчик onnx-asr-web проверяет файлы через HEAD и сам выбирает
// модель. Нам нужна именно v3_e2e_ctc.int8.onnx (русский, с пунктуацией,
// CTC — самый быстрый вариант). Конфиг и словарь лежат рядом с
// приложением, а большой файл модели уже сохранён в Cache API —
// поэтому проверки не должны ходить в интернет.
function makeModelFetch(configUrl, vocabUrl) {
  return async function modelFetch(input, init = {}) {
    const url =
      typeof input === 'string' ? input : (input && input.url) || String(input);

    if (url.endsWith('/config.json')) return fetch(configUrl, init);
    if (url.endsWith('/v3_vocab.txt')) return fetch(vocabUrl, init);

    if (/\/v3_e2e_ctc\.int8\.onnx(?:\?.*)?$/.test(url)) {
      return new Response(null, { status: 200, statusText: 'OK' });
    }

    if (
      /\/(v3_rnnt|v3_e2e_rnnt|v3_ctc|v3_e2e_ctc)/.test(url)
    ) {
      return new Response(null, { status: 404 });
    }

    return fetch(input, init);
  };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === 'init') {
      configureOrtWeb({ wasmPaths: msg.wasmPaths, simd: true, numThreads: 1 });

      const vadModel = await loadLocalVadModel(msg.vadBaseUrl, {
        quantization: 'int8',
        sessionOptions: { executionProviders: ['wasm'] },
      });

      modelPromise = loadLocalModel(msg.modelBaseUrl, {
        quantization: 'int8',
        sessionOptions: { executionProviders: ['wasm'] },
        vadModel,
        fetch: makeModelFetch(msg.configUrl, msg.vocabUrl),
      });

      await modelPromise;
      self.postMessage({ type: 'ready' });
      return;
    }

    if (msg.type === 'transcribe') {
      const model = await modelPromise;
      const result = await model.transcribeSamples(msg.samples, msg.sampleRate);
      self.postMessage({
        type: 'result',
        id: msg.id,
        text: result.text,
        words: result.words,
        segments: result.segments,
      });
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id || null,
      error: String((err && err.stack) || err),
    });
  }
};
