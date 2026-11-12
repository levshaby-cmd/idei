Модели распознавания речи
=========================

1. GigaAM v3 (CTC, E2E) — распознавание русской речи.
   Автор: Sber / salute-developers. Лицензия MIT.
   Источник: https://github.com/salute-developers/GigaAM
   ONNX-версия: https://huggingface.co/istupakov/gigaam-v3-onnx

   В репозитории лежат только небольшие служебные файлы:
     models/gigaam/config.json
     models/gigaam/v3_vocab.txt

   Сама модель (v3_e2e_ctc.int8.onnx, около 225 МБ) не хранится в
   репозитории. Приложение скачивает её один раз с Hugging Face и
   сохраняет в памяти телефона (Cache API). Дальше распознавание
   работает без интернета.

2. Silero VAD — определение участков речи.
   Автор: Silero Team. Лицензия MIT.
   Источник: https://huggingface.co/onnx-community/silero-vad
   Файл: models/vad/onnx/model_int8.onnx (около 640 КБ)
