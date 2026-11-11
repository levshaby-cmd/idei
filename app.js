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

  function startRecording() {
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

  function stopRecording() {
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

  /* ---------- сворачивание приложения ---------- */

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (isRecording) {
        requestWakeLock();
        if (!currentRecognition && !manualStop) beginSession();
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

  function checkSupport() {
    const problems = [];
    if (!window.isSecureContext) {
      problems.push(
        'Страница открыта не по защищённой ссылке. Микрофон работает только на https или на localhost.'
      );
    }
    if (!SR) {
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
      if (isRecording) stopRecording();
      else startRecording();
    });

    els.menuBtn.addEventListener('click', () => {
      if (isRecording || manualStop) {
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
