# Сборка asr-worker.js

`asr-worker.js` — это собранный (bundled) файл. Его исходник —
`tools/asr-worker-src.js`. Рядом с приложением он уже лежит готовым,
поэтому для обычной работы ничего собирать не нужно.

Если понадобится пересобрать (например, после обновления onnx-asr-web):

1. Установите Node.js.
2. В папке `tools` выполните:

```bash
npm install
npx esbuild asr-worker-src.js --bundle --format=esm --platform=browser --minify --alias:onnxruntime-web=onnxruntime-web/wasm --outfile=../asr-worker.js
```

Важно: используется alias `onnxruntime-web/wasm`, чтобы не тянуть
WebGPU-сборку и лишние 30 МБ WASM. Для работы нужны файлы из
`vendor/ort/`:

- `ort-wasm-simd-threaded.mjs`
- `ort-wasm-simd-threaded.wasm`

Они скопированы из пакета `onnxruntime-web@1.24.3/dist/`.
