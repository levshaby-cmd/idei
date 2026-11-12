/* ============================================================
   Идеи — голосовой блокнот
   Распознавание: встроенное в Chrome (Web Speech API).
   Записи: localStorage, только на этом устройстве.
   ============================================================ */

(() => {
  'use strict';

  const STORAGE_KEY = 'voice-ideas.v1';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  const els = {
    notes: document.getElementById('notes'),
    empty: document.getElementById('empty'),
    count: document.getElementById('count'),
    micBtn: document.getElementById('micBtn'),
    dockLabel: document.getElementById('dockLabel'),
    recording: document.getElementById('recording'),
    recStatus: document.getElementById('recStatus'),
    liveText: document.getElementById('liveText'),
    recTime: document.getElementById('recTime'),
    toast: document.getElementById('toast'),
    toastText: document.getElementById('toastText'),
    toastAction: document.getElementById('toastAction'),
    menuBtn: document.getElementById('menuBtn'),
    menuDialog: document.getElementById('menuDialog'),
    helpDialog: document.getElementById('helpDialog'),
    installBtn: document.getElementById('installBtn'),
    copyAllBtn: document.getElementById('copyAllBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    helpBtn: document.getElementById('helpBtn'),
    clearBtn: document.getElementById('clearBtn'),
    supportBanner: document.getElementById('supportBanner'),
    quietToggle: document.getElementById('quietToggle'),
    quietToggleSub: document.getElementById('quietToggleSub'),
    downloadDialog: document.getElementById('downloadDialog'),
    downloadText: document.getElementById('downloadText'),
    downloadProgress: document.getElementById('downloadProgress'),
    downloadBar: document.getElementById('downloadBar'),
    downloadPercent: document.getElementById('downloadPercent'),
    downloadStartBtn: document.getElementById('downloadStartBtn'),
    downloadCancelBtn: document.getElementById('downloadCancelBtn'),
  };

  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  };

  /* ---------- состояние ---------- */

  let notes = [];
  let isRecording = false;
  let manualStop = false;
  let isFinishing = false;
  let finalText = '';
  let interimText = '';
  let sessionId = 0;
  let currentRecognition = null;
  let restartTimer = null;
  let finishTimer = null;
  let elapsedTimer = null;
  let startedAt = 0;
  let wakeLock = null;
  let interruptedByHidden = false;
  let pendingVisibilityMessage = '';
  let toastTimer = null;
  let undoState = null;
  let deferredInstallPrompt = null;
  let startRetries = 0;

  /* ---------- тихий режим ---------- */

  const QUIET_MODE_KEY = 'voice-ideas.quiet';
  const QUIET_MODEL_BASE =
    'https://huggingface.co/istupakov/gigaam-v3-onnx/resolve/main/';
  const QUIET_MODEL_URL = QUIET_MODEL_BASE + 'v3_e2e_ctc.int8.onnx';
  const QUIET_MODEL_CACHE = 'asr-model-v1';
  const QUIET_MODEL_BYTES = 230 * 1024 * 1024;

  let quietEnabled = localStorage.getItem(QUIET_MODE_KEY) !== '0';
  let quietWorker = null;
  let quietWorkerReady = false;
  let quietInitPromise = null;
  let quietInitResolve = null;
  let quietInitReject = null;
  let quietTranscribeResolve = null;
  let quietTranscribeReject = null;
  let quietRecorder = null;
  let quietStream = null;
  let quietChunks = [];
  let quietPreparing = false;
  let quietDownloadController = null;
  let quietDownloadResolve = null;

  function setDockLabel(text) {
    els.dockLabel.textContent = text;
  }

  function setRecordingStatus(text) {
    if (els.recStatus) els.recStatus.textContent = text;
  }

  /* ---------- мелкие помощники ---------- */

  const monthFmt = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  });
  const timeFmt = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  function plural(n, forms) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function vibrate(ms) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch (_) {
        /* не страшно */
      }
    }
  }

  function joinText(a, b) {
    const left = (a || '').trimEnd();
    const right = (b || '').trimStart();
    if (!left) return right;
    if (!right) return left;
    const needSpace =
      !/[\s\n—–-]$/.test(left) && !/^[.,!?;:…»)]/.test(right);
    return left + (needSpace ? ' ' : '') + right;
  }

  function normalizeNote(raw) {
    let s = (raw || '').replace(/\s+/g, ' ').replace(/\s+([.,!?;:…])/g, '$1').trim();
    if (!s) return '';
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (!/[.!?…]$/.test(s) && !/["'»)]$/.test(s)) s += '.';
    return s;
  }

  function addNoteFromText(text) {
    const note = {
      id: uid(),
      text,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    notes.push(note);
    saveNotes();
    render(note.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((today - day) / 86400000);
    if (diff === 0) return 'сегодня';
    if (diff === 1) return 'вчера';
    return monthFmt.format(d);
  }

  function timeLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return timeFmt.format(d);
  }

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  /* ---------- хранилище ---------- */

  function loadNotes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data)) return [];
      return data.filter(
        (n) => n && typeof n.text === 'string' && n.text.trim()
      );
    } catch (_) {
      return [];
    }
  }

  function saveNotes() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch (_) {
      showToast('Не удалось сохранить: память телефона переполнена');
    }
  }

  /* ---------- уведомления ---------- */

  function showToast(message, actionLabel = '', action = null) {
    clearTimeout(toastTimer);
    els.toastText.textContent = message;
    if (actionLabel && action) {
      els.toastAction.hidden = false;
      els.toastAction.textContent = actionLabel;
      els.toastAction.onclick = () => {
        hideToast();
        action();
      };
    } else {
      els.toastAction.hidden = true;
      els.toastAction.onclick = null;
    }
    els.toast.classList.remove('is-visible');
    requestAnimationFrame(() => els.toast.classList.add('is-visible'));
    toastTimer = setTimeout(hideToast, actionLabel ? 6500 : 2800);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    els.toast.classList.remove('is-visible');
  }

  /* ---------- буфер обмена ---------- */

  async function writeClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      /* пробуем старый способ */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  async function copyNote(note, btn) {
    const ok = await writeClipboard(note.text);
    if (!ok) {
      showToast('Не удалось скопировать. Выделите текст пальцем.');
      return;
    }
    vibrate(12);
    if (btn) {
      btn.classList.add('is-done');
      btn.innerHTML = ICONS.check + '<span>Скопировано</span>';
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('is-done');
        btn.innerHTML = ICONS.copy + '<span>Копировать</span>';
      }, 1600);
    }
    showToast('Текст скопирован');
  }

  function allAsText() {
    return [...notes]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(
        (n) =>
          dayLabel(n.createdAt) +
          ', ' +
          timeLabel(n.createdAt) +
          '\n' +
          n.text
      )
      .join('\n\n———\n\n');
  }

  async function copyAllNotes() {
    if (!notes.length) {
      showToast('Пока нет идей');
      return;
    }
    const ok = await writeClipboard(allAsText());
    if (els.menuDialog.open) els.menuDialog.close();
    showToast(ok ? 'Все идеи скопированы' : 'Не удалось скопировать');
  }

  function downloadAll() {
    if (!notes.length) {
      showToast('Пока нет идей');
      return;
    }
    if (els.menuDialog.open) els.menuDialog.close();
    const blob = new Blob(['﻿' + allAsText()], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'идеи-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Файл сохранён в «Загрузки»');
  }

  /* ---------- список записей ---------- */

  function actionButton(icon, label, onClick, extraClass = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'note__action' + (extraClass ? ' ' + extraClass : '');
    btn.innerHTML = ICONS[icon];
    if (label) {
      const span = document.createElement('span');
      span.textContent = label;
      btn.appendChild(span);
    } else {
      btn.setAttribute('aria-label', 'Удалить запись');
      btn.title = 'Удалить';
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  function buildNote(note) {
    const card = document.createElement('article');
    card.className = 'note';
    card.dataset.id = note.id;

    const meta = document.createElement('div');
    meta.className = 'note__meta';
    const date = document.createElement('span');
    const label = dayLabel(note.createdAt);
    const time = timeLabel(note.createdAt);
    date.textContent = label && time ? label + ', ' + time : label || time || 'без даты';
    meta.appendChild(date);
    if (note.updatedAt && note.updatedAt !== note.createdAt) {
      const edited = document.createElement('span');
      edited.className = 'note__edited';
      edited.textContent = 'изменено';
      meta.appendChild(edited);
    }

    const text = document.createElement('p');
    text.className = 'note__text';
    text.textContent = note.text;

    const actions = document.createElement('div');
    actions.className = 'note__actions';
    const copyBtn = actionButton('copy', 'Копировать', () =>
      copyNote(note, copyBtn)
    );
    const editBtn = actionButton('edit', 'Изменить', () => startEdit(note, card));
    const deleteBtn = actionButton(
      'trash',
      '',
      () => deleteNote(note),
      'note__action--delete'
    );
    actions.append(copyBtn, editBtn, deleteBtn);

    card.append(meta, text, actions);
    return card;
  }

  function render(newId = null) {
    const sorted = [...notes].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    els.notes.innerHTML = '';
    els.empty.hidden = sorted.length > 0;
    if (sorted.length) {
      els.count.hidden = false;
      els.count.textContent =
        sorted.length + ' ' + plural(sorted.length, ['идея', 'идеи', 'идей']);
    } else {
      els.count.hidden = true;
      els.count.textContent = '';
    }
    for (const note of sorted) {
      const card = buildNote(note);
      if (newId && note.id === newId) card.classList.add('note--new');
      els.notes.appendChild(card);
    }
  }

  function startEdit(note, card) {
    if (card.querySelector('.note__editor')) return;
    const textEl = card.querySelector('.note__text');
    const actions = card.querySelector('.note__actions');
    if (!textEl || !actions) return;

    const editor = document.createElement('div');
    editor.className = 'note__editor';
    const ta = document.createElement('textarea');
    ta.value = note.text;
    ta.setAttribute('aria-label', 'Текст записи');
    const row = document.createElement('div');
    row.className = 'note__edit-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary';
    save.textContent = 'Сохранить';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Отмена';
    row.append(save, cancel);
    editor.append(ta, row);

    textEl.hidden = true;
    actions.hidden = true;
    card.appendChild(editor);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const autosize = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.max(124, ta.scrollHeight) + 'px';
    };
    autosize();
    ta.addEventListener('input', autosize);

    const close = () => {
      editor.remove();
      textEl.hidden = false;
      actions.hidden = false;
    };

    const commit = () => {
      const value = ta.value.trim();
      if (!value) {
        showToast('Пустая запись. Напишите текст или нажмите «Отмена».');
        return;
      }
      note.text = value;
      note.updatedAt = new Date().toISOString();
      saveNotes();
      render();
      showToast('Изменения сохранены');
    };

    save.addEventListener('click', commit);
    cancel.addEventListener('click', close);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') commit();
    });
  }

  function deleteNote(note) {
    const index = notes.findIndex((n) => n.id === note.id);
    if (index < 0) return;
    const removed = notes[index];
    notes.splice(index, 1);
    saveNotes();
    render();
    undoState = { note: removed, index };
    showToast('Запись удалена', 'Отменить', () => {
      if (!undoState) return;
      const at = Math.min(undoState.index, notes.length);
      notes.splice(at, 0, undoState.note);
      undoState = null;
      saveNotes();
      render();
      showToast('Запись восстановлена');
    });
  }

  function clearAll() {
    if (!notes.length) {
      if (els.menuDialog.open) els.menuDialog.close();
      showToast('Пока нет идей');
      return;
    }
    const ok = window.confirm('Удалить все идеи? Это действие нельзя отменить.');
    if (!ok) return;
    notes = [];
    undoState = null;
    saveNotes();
    render();
    if (els.menuDialog.open) els.menuDialog.close();
    showToast('Все идеи удалены');
  }

  /* ---------- микрофон и распознавание ---------- */

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch (_) {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    try {
      wakeLock.release().catch(() => {});
    } catch (_) {
      /* не страшно */
    }
    wakeLock = null;
  }

  function updateTimer() {
    if (!startedAt) return;
    const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    els.recTime.textContent = mm + ':' + ss;
  }

  function updateLiveText() {
    const f = finalText.trim();
    const i = interimText.trim();
    if (!f && !i) {
      els.liveText.innerHTML =
        '<span class="live-placeholder">Говорите…</span>';
      return;
    }
    els.liveText.textContent = '';
    if (f) {
      els.liveText.appendChild(document.createTextNode(f));
      if (i) els.liveText.appendChild(document.createTextNode(' '));
    }
    if (i) {
      const span = document.createElement('span');
      span.className = 'interim';
      span.textContent = i;
      els.liveText.appendChild(span);
    }
    els.liveText.scrollTop = els.liveText.scrollHeight;
  }

  function startSpeechRecording() {
    if (isRecording || manualStop || isFinishing) return;
    if (!SR) {
      showToast('Этот браузер не умеет распознавать речь. Откройте Chrome.');
      return;
    }
    if (!window.isSecureContext) {
      showToast('Микрофон работает только по защищённой ссылке (https).');
      return;
    }

    manualStop = false;
    isFinishing = false;
    interruptedByHidden = false;
    pendingVisibilityMessage = '';
    finalText = '';
    interimText = '';
    startRetries = 0;
    startedAt = Date.now();
    isRecording = true;

    document.body.classList.add('recording');
    els.recording.hidden = false;
    els.liveText.innerHTML = '<span class="live-placeholder">Говорите…</span>';
    els.recTime.textContent = '00:00';
    els.micBtn.disabled = false;
    els.micBtn.setAttribute('aria-label', 'Остановить запись');
    els.dockLabel.textContent = 'Нажмите «Стоп», когда закончите';

    updateTimer();
    elapsedTimer = setInterval(updateTimer, 250);
    requestWakeLock();
    vibrate(25);
    beginSession();
  }

  function beginSession() {
    if (!isRecording || manualStop) return;
    if (currentRecognition) {
      try {
        currentRecognition.abort();
      } catch (_) {
        /* уже закончил */
      }
    }

    const my = ++sessionId;
    const r = new SR();
    currentRecognition = r;
    r.lang = 'ru-RU';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onstart = () => {
      if (my !== sessionId) return;
      startRetries = 0;
    };

    r.onresult = (event) => {
      if (my !== sessionId) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0] ? result[0].transcript : '';
        if (result.isFinal) {
          finalText = joinText(finalText, transcript);
        } else {
          interim = joinText(interim, transcript);
        }
      }
      interimText = interim;
      updateLiveText();
    };

    r.onerror = (event) => {
      if (my !== sessionId) return;
      const err = event.error || '';
      if (err === 'no-speech' || err === 'aborted') return;

      if (err === 'not-allowed' || err === 'service-not-allowed') {
        endWithError('Разрешите микрофон: Chrome → ⋮ → Настройки сайтов → Микрофон');
      } else if (err === 'network') {
        endWithError('Пропал интернет — распознавание остановилось');
      } else if (err === 'audio-capture') {
        endWithError('Микрофон не найден или занят другой программой');
      } else if (err === 'language-not-supported') {
        endWithError('Русский язык не поддерживается этим браузером');
      } else {
        console.warn('Ошибка распознавания:', err);
        endWithError('Не удалось распознать. Попробуйте ещё раз');
      }
    };

    r.onend = () => {
      if (my !== sessionId) return;
      currentRecognition = null;
      if (isRecording && !manualStop) {
        if (document.visibilityState === 'visible') {
          restartTimer = setTimeout(() => {
            if (isRecording && !manualStop) beginSession();
          }, 320);
        }
      } else if (manualStop) {
        finishRecording();
      }
    };

    try {
      r.start();
    } catch (err) {
      console.warn('Не удалось запустить распознавание:', err);
      startRetries += 1;
      if (startRetries > 1) {
        endWithError('Не удалось включить микрофон. Проверьте разрешение в Chrome');
        return;
      }
      setTimeout(() => {
        if (isRecording && !manualStop && my === sessionId) beginSession();
      }, 450);
    }
  }

  function stopSpeechRecording() {
    if (!isRecording || manualStop || isFinishing) return;
    manualStop = true;
    isRecording = false;
    clearTimeout(restartTimer);
    els.micBtn.disabled = true;
    els.dockLabel.textContent = 'Сохраняю…';
    if (currentRecognition) {
      try {
        currentRecognition.stop();
      } catch (_) {
        /* уже остановился */
      }
      if (document.visibilityState === 'hidden') {
        finishRecording();
      } else {
        finishTimer = setTimeout(() => finishRecording(), 1400);
      }
    } else {
      finishRecording();
    }
  }

  function endWithError(message) {
    showToast(message);
    manualStop = true;
    isRecording = false;
    clearTimeout(restartTimer);
    if (currentRecognition) {
      try {
        currentRecognition.abort();
      } catch (_) {
        /* не страшно */
      }
    }
    finishRecording({ quiet: true });
  }

  function finishRecording({ quiet = false } = {}) {
    if (isFinishing) return;
    isFinishing = true;
    clearTimeout(restartTimer);
    clearTimeout(finishTimer);
    clearInterval(elapsedTimer);
    sessionId += 1;
    currentRecognition = null;

    const text = normalizeNote(joinText(finalText, interimText));
    const interrupted = interruptedByHidden;

    isRecording = false;
    manualStop = false;
    document.body.classList.remove('recording');
    els.recording.hidden = true;
    els.liveText.textContent = '';
    els.micBtn.disabled = false;
    els.micBtn.setAttribute('aria-label', 'Начать запись');
    els.dockLabel.textContent = 'Нажмите и говорите';
    releaseWakeLock();

    finalText = '';
    interimText = '';
    startedAt = 0;
    interruptedByHidden = false;

    if (text) {
      addNoteFromText(text);
      vibrate(15);
      if (interrupted) {
        pendingVisibilityMessage =
          'Запись остановилась, когда приложение было свёрнуто. Текст сохранён.';
        if (document.visibilityState === 'visible') {
          showToast(pendingVisibilityMessage);
          pendingVisibilityMessage = '';
        }
      } else if (!quiet) {
        showToast('Идея сохранена');
      }
    } else if (!quiet) {
      showToast('Ничего не расслышал — попробуйте ещё раз');
    }

    isFinishing = false;
  }

  /* ---------- тихий режим: запись и распознавание ---------- */

  async function startRecording() {
    if (isRecording || manualStop || isFinishing) return;
    if (quietEnabled) return startQuietRecording();
    return startSpeechRecording();
  }

  function stopRecording() {
    if (!isRecording || manualStop || isFinishing) return;
    if (quietEnabled) return stopQuietRecording();
    return stopSpeechRecording();
  }

  async function ensureServiceWorkerReady() {
    if (!('serviceWorker' in navigator)) return false;
    try {
      await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      if (navigator.serviceWorker.controller) return true;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2500);
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
      return !!navigator.serviceWorker.controller;
    } catch (err) {
      console.warn('[asr] service worker:', err);
      return false;
    }
  }

  async function hasQuietModel() {
    if (!('caches' in window)) return false;
    try {
      const cache = await caches.open(QUIET_MODEL_CACHE);
      return !!(await cache.match(QUIET_MODEL_URL, { ignoreVary: true }));
    } catch (_) {
      return false;
    }
  }

  function updateDownloadProgress(ratio, received, total) {
    const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    els.downloadProgress.hidden = false;
    els.downloadBar.style.width = pct + '%';
    const mb = (n) => Math.round(n / (1024 * 1024));
    const size =
      total && received ? ` · ${mb(received)} из ${mb(total)} МБ` : '';
    els.downloadPercent.textContent = pct + '%' + size;
  }

  async function downloadQuietModel(onProgress) {
    if (!('caches' in window)) throw new Error('no-cache');
    const cache = await caches.open(QUIET_MODEL_CACHE);
    if (await cache.match(QUIET_MODEL_URL, { ignoreVary: true })) {
      onProgress(1, 0, 0);
      return;
    }

    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const { quota = 0, usage = 0 } = await navigator.storage.estimate();
        if (quota && quota - usage < QUIET_MODEL_BYTES + 40 * 1024 * 1024) {
          throw new Error('storage');
        }
      } catch (err) {
        if (err && err.message === 'storage') throw err;
      }
    }

    quietDownloadController = new AbortController();
    let response;
    try {
      response = await fetch(QUIET_MODEL_URL, {
        signal: quietDownloadController.signal,
      });
    } catch (err) {
      quietDownloadController = null;
      throw err;
    }
    if (!response.ok) {
      quietDownloadController = null;
      throw new Error('network');
    }

    if (!response.body) {
      const buffer = await response.arrayBuffer();
      await cache.put(QUIET_MODEL_URL, new Response(buffer));
      onProgress(1, buffer.byteLength, buffer.byteLength);
      quietDownloadController = null;
      return;
    }

    const total =
      Number(response.headers.get('content-length')) || QUIET_MODEL_BYTES;
    const [forCache, forProgress] = response.body.tee();
    const cacheHeaders = new Headers();
    cacheHeaders.set('Content-Type', 'application/octet-stream');
    cacheHeaders.set('Access-Control-Allow-Origin', '*');
    const cacheWrite = cache.put(
      QUIET_MODEL_URL,
      new Response(forCache, {
        status: 200,
        statusText: 'OK',
        headers: cacheHeaders,
      })
    );
    const reader = forProgress.getReader();
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        onProgress(total ? received / total : 0, received, total);
      }
      await cacheWrite;
    } catch (err) {
      await cacheWrite.catch(() => {});
      throw err;
    } finally {
      quietDownloadController = null;
      try {
        reader.releaseLock();
      } catch (_) {
        /* уже закрыт */
      }
    }

    onProgress(1, received, total);
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().catch(() => {});
    }
  }

  function showDownloadDialog() {
    els.downloadText.hidden = false;
    els.downloadText.textContent =
      'Первый раз скачается модель около 230 МБ. Это один раз. Потом распознавание работает без интернета. Лучше по Wi-Fi. Звук никуда не отправляется — всё работает на телефоне.';
    els.downloadProgress.hidden = true;
    els.downloadBar.style.width = '0%';
    els.downloadPercent.textContent = '';
    els.downloadStartBtn.hidden = false;
    els.downloadStartBtn.disabled = false;
    els.downloadStartBtn.textContent = 'Скачать модель';
    els.downloadCancelBtn.textContent = 'Позже';
    els.downloadCancelBtn.disabled = false;
    if (!els.downloadDialog.open) els.downloadDialog.showModal();
  }

  function hideDownloadDialog() {
    if (els.downloadDialog.open) els.downloadDialog.close();
  }

  function askDownloadConsent() {
    return new Promise((resolve) => {
      quietDownloadResolve = resolve;
      showDownloadDialog();
    });
  }

  function resolveDownloadConsent(value) {
    const resolve = quietDownloadResolve;
    quietDownloadResolve = null;
    if (resolve) resolve(value);
  }

  function cancelDownloadDialog() {
    if (quietDownloadController) {
      quietDownloadController.abort();
      return;
    }
    resolveDownloadConsent(false);
    hideDownloadDialog();
  }

  async function startQuietRecording() {
    if (quietPreparing || isRecording || isFinishing) return;
    quietPreparing = true;
    els.micBtn.disabled = true;
    try {
      if (
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function' ||
        !window.MediaRecorder ||
        !window.Worker ||
        !window.WebAssembly
      ) {
        throw new Error('unsupported');
      }

      const cached = await hasQuietModel();
      if (!cached) {
        const approved = await askDownloadConsent();
        if (!approved) {
          hideDownloadDialog();
          return;
        }
        setDockLabel('Скачиваю модель…');
        try {
          await downloadQuietModel(updateDownloadProgress);
        } catch (err) {
          hideDownloadDialog();
          if (err && err.name === 'AbortError') {
            setDockLabel('Нажмите и говорите');
            return;
          }
          console.warn('[asr] download:', err);
          const message =
            err && err.message === 'storage'
              ? 'На телефоне мало свободного места'
              : 'Не удалось скачать модель';
          setDockLabel('Нажмите и говорите');
          showToast(message, 'Повторить', () => {
            startQuietRecording();
          });
          return;
        }
        hideDownloadDialog();
      }

      setDockLabel('Готовлю распознавание…');
      await initQuietWorker();
      await beginQuietRecording();
    } catch (err) {
      console.warn('[asr] start:', err);
      hideDownloadDialog();
      stopQuietStream();
      setDockLabel('Нажмите и говорите');
      if (err && err.message === 'mic') {
        showToast('Разрешите микрофон в настройках Chrome');
      } else if (err && err.message === 'unsupported') {
        showToast('Этот браузер не умеет тихо записывать звук', 'Обычный режим', () => {
          setQuietMode(false, true);
        });
      } else {
        showToast('Не удалось подготовить распознавание', 'Обычный режим', () => {
          setQuietMode(false, true);
        });
      }
    } finally {
      quietPreparing = false;
      if (!isRecording && !isFinishing) els.micBtn.disabled = false;
    }
  }

  function initQuietWorker() {
    if (quietWorkerReady && quietWorker) return Promise.resolve();
    if (quietInitPromise) return quietInitPromise;

    quietInitPromise = (async () => {
      await ensureServiceWorkerReady();

      if (!quietWorker) {
        quietWorker = new Worker('asr-worker.js', { type: 'module' });
        quietWorker.onmessage = handleQuietWorkerMessage;
        quietWorker.onerror = handleQuietWorkerError;
      }

      const ready = new Promise((resolve, reject) => {
        quietInitResolve = resolve;
        quietInitReject = reject;
        setTimeout(() => {
          if (!quietInitReject) return;
          const rejectNow = quietInitReject;
          quietInitResolve = null;
          quietInitReject = null;
          rejectNow(new Error('timeout'));
        }, 180000);
      });

      const base = new URL('./', window.location.href).href;
      quietWorker.postMessage({
        type: 'init',
        wasmPaths: new URL('./vendor/ort/', base).href,
        vadBaseUrl: new URL('./models/vad/', base).href,
        modelBaseUrl: QUIET_MODEL_BASE,
        configUrl: new URL('./models/gigaam/config.json', base).href,
        vocabUrl: new URL('./models/gigaam/v3_vocab.txt', base).href,
      });

      await ready;
      quietWorkerReady = true;
    })()
      .catch((err) => {
        if (quietWorker) {
          quietWorker.terminate();
          quietWorker = null;
        }
        quietWorkerReady = false;
        throw err;
      })
      .finally(() => {
        quietInitPromise = null;
        quietInitResolve = null;
        quietInitReject = null;
      });

    return quietInitPromise;
  }

  function handleQuietWorkerMessage(event) {
    const msg = event.data || {};
    if (msg.type === 'ready') {
      if (quietInitResolve) {
        const resolve = quietInitResolve;
        quietInitResolve = null;
        quietInitReject = null;
        resolve();
      }
      return;
    }
    if (msg.type === 'result') {
      if (quietTranscribeResolve) {
        const resolve = quietTranscribeResolve;
        quietTranscribeResolve = null;
        quietTranscribeReject = null;
        resolve(msg);
      }
      return;
    }
    if (msg.type === 'error') {
      console.warn('[asr] worker:', msg.error);
      const err = new Error(msg.error || 'ASR error');
      if (quietTranscribeReject) {
        const reject = quietTranscribeReject;
        quietTranscribeResolve = null;
        quietTranscribeReject = null;
        reject(err);
      } else if (quietInitReject) {
        const reject = quietInitReject;
        quietInitResolve = null;
        quietInitReject = null;
        reject(err);
      }
    }
  }

  function handleQuietWorkerError(event) {
    console.warn('[asr] worker error:', event.message || event);
    const err = new Error(event.message || 'Worker error');
    if (quietTranscribeReject) {
      const reject = quietTranscribeReject;
      quietTranscribeResolve = null;
      quietTranscribeReject = null;
      reject(err);
    } else if (quietInitReject) {
      const reject = quietInitReject;
      quietInitResolve = null;
      quietInitReject = null;
      reject(err);
    }
    quietWorkerReady = false;
    if (quietWorker) {
      quietWorker.terminate();
      quietWorker = null;
    }
  }

  function pickRecorderMime() {
    if (!window.MediaRecorder) return '';
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const type of types) {
      try {
        if (MediaRecorder.isTypeSupported(type)) return type;
      } catch (_) {
        /* пробуем следующий */
      }
    }
    return '';
  }

  async function beginQuietRecording() {
    if (isRecording || isFinishing) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      const error = new Error('mic');
      error.cause = err;
      throw error;
    }
    quietStream = stream;
    const mime = pickRecorderMime();
    quietChunks = [];
    quietRecorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    quietRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size) quietChunks.push(event.data);
    };
    quietRecorder.onerror = (event) => {
      console.warn('[asr] recorder:', event.error || event);
    };
    quietRecorder.onstop = () => {
      finalizeQuietRecording();
    };

    try {
      quietRecorder.start(1000);
    } catch (err) {
      stopQuietStream();
      quietRecorder = null;
      throw err;
    }

    manualStop = false;
    isFinishing = false;
    isRecording = true;
    startedAt = Date.now();
    interruptedByHidden = false;
    document.body.classList.add('recording');
    els.recording.hidden = false;
    setRecordingStatus('Идёт запись');
    els.liveText.innerHTML =
      '<span class="live-placeholder">Говорите… Текст появится после «Стоп»</span>';
    els.recTime.textContent = '00:00';
    els.micBtn.disabled = false;
    els.micBtn.setAttribute('aria-label', 'Остановить запись');
    setDockLabel('Нажмите «Стоп», когда закончите');
    updateTimer();
    elapsedTimer = setInterval(updateTimer, 250);
    requestWakeLock();
    vibrate(25);
  }

  function stopQuietRecording() {
    if (!isRecording || manualStop || isFinishing) return;
    isRecording = false;
    manualStop = true;
    clearInterval(elapsedTimer);
    els.micBtn.disabled = true;
    els.micBtn.setAttribute('aria-label', 'Начать запись');
    setRecordingStatus('Распознаю…');
    setDockLabel('Распознаю…');
    els.liveText.innerHTML =
      '<span class="live-placeholder">Распознаю… Не закрывайте приложение</span>';

    if (quietRecorder && quietRecorder.state !== 'inactive') {
      try {
        quietRecorder.stop();
      } catch (_) {
        finalizeQuietRecording();
      }
    } else {
      finalizeQuietRecording();
    }
  }

  function finalizeQuietRecording() {
    const recorder = quietRecorder;
    quietRecorder = null;
    const chunks = quietChunks;
    quietChunks = [];
    const interrupted = interruptedByHidden;
    interruptedByHidden = false;
    stopQuietStream();

    if (!chunks.length) {
      finishQuietUi();
      manualStop = false;
      releaseWakeLock();
      showToast('Ничего не записалось — попробуйте ещё раз');
      return;
    }

    const blob = new Blob(chunks, {
      type: recorder && recorder.mimeType ? recorder.mimeType : 'audio/webm',
    });
    runQuietTranscription(blob, interrupted);
  }

  function showQuietTranscribingUi() {
    document.body.classList.add('recording');
    els.recording.hidden = false;
    setRecordingStatus('Распознаю…');
    setDockLabel('Распознаю…');
    els.liveText.innerHTML =
      '<span class="live-placeholder">Распознаю… Не закрывайте приложение</span>';
    els.micBtn.disabled = true;
    els.micBtn.setAttribute('aria-label', 'Начать запись');
  }

  function finishQuietUi() {
    document.body.classList.remove('recording');
    els.recording.hidden = true;
    els.liveText.textContent = '';
    setRecordingStatus('Идёт запись');
    els.recTime.textContent = '00:00';
    els.micBtn.disabled = false;
    els.micBtn.setAttribute('aria-label', 'Начать запись');
    setDockLabel('Нажмите и говорите');
  }

  function stopQuietStream() {
    if (!quietStream) return;
    try {
      quietStream.getTracks().forEach((track) => track.stop());
    } catch (_) {
      /* не страшно */
    }
    quietStream = null;
  }

  async function runQuietTranscription(blob, interrupted) {
    if (isFinishing) return;
    isFinishing = true;
    manualStop = true;
    showQuietTranscribingUi();
    try {
      const text = await transcribeQuietBlob(blob);
      const normalized = normalizeNote(text);
      if (normalized) {
        addNoteFromText(normalized);
        vibrate(15);
        if (interrupted) {
          pendingVisibilityMessage =
            'Запись остановилась, когда приложение было свёрнуто. Текст сохранён.';
          if (document.visibilityState === 'visible') {
            showToast(pendingVisibilityMessage);
            pendingVisibilityMessage = '';
          }
        } else {
          showToast('Идея сохранена');
        }
      } else {
        showToast('Ничего не расслышал — попробуйте ещё раз', 'Повторить', () => {
          retryQuietTranscription(blob);
        });
      }
    } catch (err) {
      console.warn('[asr] transcribe:', err);
      showToast('Не удалось распознать', 'Повторить', () => {
        retryQuietTranscription(blob);
      });
    } finally {
      isFinishing = false;
      manualStop = false;
      releaseWakeLock();
      finishQuietUi();
    }
  }

  function retryQuietTranscription(blob) {
    if (isRecording || isFinishing) return;
    runQuietTranscription(blob, false);
  }

  async function transcribeQuietBlob(blob) {
    if (!quietWorkerReady || !quietWorker) {
      await initQuietWorker();
    }
    const arrayBuffer = await blob.arrayBuffer();
    const audio = await decodeAudioBlob(arrayBuffer);
    const samples = await resampleTo16k(audio);
    const result = await new Promise((resolve, reject) => {
      quietTranscribeResolve = resolve;
      quietTranscribeReject = reject;
      try {
        quietWorker.postMessage(
          {
            type: 'transcribe',
            id: Date.now(),
            samples,
            sampleRate: 16000,
          },
          [samples.buffer]
        );
      } catch (err) {
        quietTranscribeResolve = null;
        quietTranscribeReject = null;
        reject(err);
      }
    });
    return (result && result.text) || '';
  }

  async function decodeAudioBlob(arrayBuffer) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('no-audio-context');
    const ctx = new AudioCtx();
    try {
      return await new Promise((resolve, reject) => {
        const promise = ctx.decodeAudioData(
          arrayBuffer.slice(0),
          resolve,
          reject
        );
        if (promise && typeof promise.then === 'function') {
          promise.then(resolve, reject);
        }
      });
    } finally {
      try {
        await ctx.close();
      } catch (_) {
        /* не страшно */
      }
    }
  }

  async function resampleTo16k(audioBuffer) {
    if (
      audioBuffer.sampleRate === 16000 &&
      audioBuffer.numberOfChannels === 1
    ) {
      return new Float32Array(audioBuffer.getChannelData(0));
    }

    const length = Math.max(1, Math.ceil(audioBuffer.duration * 16000));
    const OfflineCtx =
      window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OfflineCtx) {
      try {
        const offline = new OfflineCtx(1, length, 16000);
        const source = offline.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offline.destination);
        source.start(0);
        const rendered = await offline.startRendering();
        return new Float32Array(rendered.getChannelData(0));
      } catch (err) {
        console.warn('[asr] offline resample:', err);
      }
    }

    const channels = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) {
      channels.push(audioBuffer.getChannelData(c));
    }
    const ratio = audioBuffer.sampleRate / 16000;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, audioBuffer.length - 1);
      const frac = pos - i0;
      let value = 0;
      for (const channel of channels) {
        value += channel[i0] * (1 - frac) + channel[i1] * frac;
      }
      out[i] = value / channels.length;
    }
    return out;
  }

  function setQuietMode(enabled, startNow = false) {
    quietEnabled = !!enabled;
    try {
      localStorage.setItem(QUIET_MODE_KEY, quietEnabled ? '1' : '0');
    } catch (_) {
      /* память недоступна */
    }
    if (els.quietToggle) els.quietToggle.checked = quietEnabled;
    if (els.quietToggleSub) {
      els.quietToggleSub.textContent = quietEnabled
        ? 'Без писка · текст после «Стоп»'
        : 'Текст по ходу речи · Chrome пищит';
    }
    checkSupport();
    if (startNow) {
      Promise.resolve(startRecording()).catch((err) => {
        console.warn('[app] start:', err);
      });
    }
  }

  /* ---------- сворачивание приложения ---------- */

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (isRecording) {
        requestWakeLock();
        if (!quietEnabled && !currentRecognition && !manualStop) beginSession();
      }
      if (pendingVisibilityMessage) {
        const message = pendingVisibilityMessage;
        pendingVisibilityMessage = '';
        showToast(message);
      }
      return;
    }

    // Свернули приложение или погас экран: сохраняем то, что успели
    // услышать, сразу. В фоне таймеры сильно замедляются, поэтому
    // откладывать нельзя.
    if (!isRecording || manualStop) return;
    interruptedByHidden = true;
    stopRecording();
  });

  /* ---------- поддержка браузера ---------- */

  function canUseQuietMode() {
    return !!(
      window.isSecureContext &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      window.MediaRecorder &&
      window.Worker &&
      window.WebAssembly
    );
  }

  function checkSupport() {
    const problems = [];
    if (!window.isSecureContext) {
      problems.push(
        'Страница открыта не по защищённой ссылке. Микрофон работает только на https или на localhost.'
      );
    }
    if (quietEnabled) {
      if (!canUseQuietMode()) {
        problems.push(
          'Этот браузер не умеет тихо записывать звук. Откройте страницу в Chrome.'
        );
      }
    } else if (!SR) {
      problems.push(
        'Этот браузер не умеет распознавать речь. Откройте страницу в Chrome.'
      );
    }
    if (problems.length) {
      els.supportBanner.hidden = false;
      els.supportBanner.textContent = problems.join(' ');
      els.micBtn.disabled = true;
      els.dockLabel.textContent = 'Распознавание недоступно';
      return false;
    }
    els.supportBanner.hidden = true;
    els.supportBanner.textContent = '';
    if (!isRecording && !isFinishing && !quietPreparing) {
      els.micBtn.disabled = false;
      els.dockLabel.textContent = 'Нажмите и говорите';
    }
    return true;
  }

  /* ---------- меню и установка ---------- */

  function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    try {
      dialog.showModal();
    } catch (_) {
      dialog.setAttribute('open', '');
    }
  }

  function updateInstallButton() {
    if (isStandalone()) {
      els.installBtn.hidden = true;
    }
  }

  function bindEvents() {
    els.micBtn.addEventListener('click', () => {
      if (isFinishing || manualStop) return;
      if (isRecording) {
        stopRecording();
        return;
      }
      Promise.resolve(startRecording()).catch((err) => {
        console.warn('[app] start:', err);
        quietPreparing = false;
        els.micBtn.disabled = false;
        setDockLabel('Нажмите и говорите');
        showToast('Не получилось начать запись');
      });
    });

    els.menuBtn.addEventListener('click', () => {
      if (isRecording || manualStop || quietPreparing) {
        showToast('Сначала остановите запись');
        return;
      }
      if (els.helpDialog.open) els.helpDialog.close();
      openDialog(els.menuDialog);
    });

    els.helpBtn.addEventListener('click', () => {
      if (els.menuDialog.open) els.menuDialog.close();
      openDialog(els.helpDialog);
    });

    els.quietToggle.addEventListener('change', () => {
      const enabled = els.quietToggle.checked;
      setQuietMode(enabled);
      showToast(enabled ? 'Тихий режим включён' : 'Обычный режим включён');
    });

    els.downloadStartBtn.addEventListener('click', () => {
      els.downloadStartBtn.hidden = true;
      els.downloadStartBtn.disabled = true;
      els.downloadText.hidden = true;
      els.downloadProgress.hidden = false;
      els.downloadPercent.textContent = '0%';
      els.downloadBar.style.width = '0%';
      els.downloadCancelBtn.textContent = 'Отменить';
      resolveDownloadConsent(true);
    });

    els.downloadCancelBtn.addEventListener('click', cancelDownloadDialog);

    els.downloadDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      cancelDownloadDialog();
    });

    els.copyAllBtn.addEventListener('click', copyAllNotes);
    els.downloadBtn.addEventListener('click', downloadAll);
    els.clearBtn.addEventListener('click', clearAll);

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dialog = btn.closest('dialog');
        if (dialog) dialog.close();
      });
    });

    [els.menuDialog, els.helpDialog].forEach((dialog) => {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
    });

    els.installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        showToast('В меню Chrome выберите «Добавить на главный экран»');
        return;
      }
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      els.installBtn.hidden = true;
      if (els.menuDialog.open) els.menuDialog.close();
      try {
        promptEvent.prompt();
        await promptEvent.userChoice;
      } catch (_) {
        /* пользователь передумал */
      }
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (!isStandalone()) els.installBtn.hidden = false;
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      els.installBtn.hidden = true;
      showToast('Добавлено на главный экран');
    });
  }

  /* ---------- запуск ---------- */

  function init() {
    notes = loadNotes();
    render();
    bindEvents();
    updateInstallButton();
    els.quietToggle.checked = quietEnabled;
    els.quietToggleSub.textContent = quietEnabled
      ? 'Без писка · текст после «Стоп»'
      : 'Текст по ходу речи · Chrome пищит';
    checkSupport();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
