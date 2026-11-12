# Сторонние компоненты

Приложение использует следующие открытые проекты. Все они распространяются
по лицензии MIT.

| Компонент | Версия | Что делает | Источник |
|---|---|---|---|
| GigaAM v3 (CTC, E2E) | v3 | Распознавание русской речи | https://github.com/salute-developers/GigaAM |
| Silero VAD | int8 | Находит участки речи в записи | https://huggingface.co/onnx-community/silero-vad |
| onnx-asr-web | 0.1.3 | Загрузка моделей и декодирование текста | https://github.com/SanderGi/onnx-asr-web |
| ONNX Runtime Web | 1.24.3 | Запуск модели в браузере | https://github.com/microsoft/onnxruntime |

Модель GigaAM в ONNX-формате: https://huggingface.co/istupakov/gigaam-v3-onnx

Большая модель не входит в репозиторий: она скачивается при первом
запуске и хранится в памяти браузера.
