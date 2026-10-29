/**
 * Popup Script for NotebookLM Quiz Extractor
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeIcon = document.getElementById('themeIcon');
  const statusBadge = document.getElementById('statusBadge');
  const loadingState = document.getElementById('loadingState');
  const noQuizState = document.getElementById('noQuizState');
  const quizFoundState = document.getElementById('quizFoundState');
  const quizTitleInput = document.getElementById('quizTitleInput');
  const formatButtons = document.querySelectorAll('#formatSelector .pill-btn');
  const toggleHints = document.getElementById('toggleHints');
  const toggleRationales = document.getElementById('toggleRationales');
  const toggleShuffle = document.getElementById('toggleShuffle');
  const toggleFence = document.getElementById('toggleFence');
  const questionCountBadge = document.getElementById('questionCountBadge');
  const multiCountBadge = document.getElementById('multiCountBadge');
  const topicTagsContainer = document.getElementById('topicTags');
  const codeOutput = document.getElementById('codeOutput');
  const codeLangTag = document.getElementById('codeLangTag');
  const copyBtn = document.getElementById('copyBtn');
  const copyBtnText = document.getElementById('copyBtnText');
  const downloadBtn = document.getElementById('downloadBtn');
  const rescanBtn = document.getElementById('rescanBtn');

  // Manual Tab Elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const pasteInput = document.getElementById('pasteInput');
  const parsePasteBtn = document.getElementById('parsePasteBtn');

  // State
  let currentRawQuiz = null;
  let currentNormalized = null;
  let activeFormat = 'py'; // 'py' | 'yaml' | 'json'
  let currentTheme = 'system'; // 'system' | 'light' | 'dark'

  // --- Theme Management (System by Default) ---
  function applyTheme(theme) {
    currentTheme = theme;
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
      themeToggleBtn.title = 'Theme: System (Click for Light)';
      themeIcon.innerHTML = `
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 3v18"></path>
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"></path>
      `;
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      themeToggleBtn.title = 'Theme: Light (Click for Dark)';
      themeIcon.innerHTML = `
        <circle cx="12" cy="12" r="4"></circle>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
      `;
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeToggleBtn.title = 'Theme: Dark (Click for System Auto)';
      themeIcon.innerHTML = `
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      `;
    }
  }

  themeToggleBtn.addEventListener('click', () => {
    let nextTheme = 'system';
    if (currentTheme === 'system') nextTheme = 'light';
    else if (currentTheme === 'light') nextTheme = 'dark';
    else nextTheme = 'system';

    chrome.storage.local.set({ theme: nextTheme });
    applyTheme(nextTheme);
  });

  // Load saved preferences
  chrome.storage.local.get({
    format: 'py',
    includeHints: true,
    includeRationales: true,
    shuffle: false,
    wrapFence: false, // Default: FALSE (Universal clean output without ```qblock)
    theme: 'system'   // System default
  }, (items) => {
    applyTheme(items.theme);

    activeFormat = items.format;
    toggleHints.checked = items.includeHints;
    toggleRationales.checked = items.includeRationales;
    toggleShuffle.checked = items.shuffle;
    toggleFence.checked = items.wrapFence;

    formatButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.format === activeFormat);
    });

    scanActiveTab();
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      document.getElementById(targetId).classList.add('active');
    });
  });

  // Format selection
  formatButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      formatButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFormat = btn.dataset.format;
      chrome.storage.local.set({ format: activeFormat });
      updatePreview();
    });
  });

  // Toggle changes
  [toggleHints, toggleRationales, toggleShuffle, toggleFence].forEach(toggle => {
    toggle.addEventListener('change', () => {
      chrome.storage.local.set({
        includeHints: toggleHints.checked,
        includeRationales: toggleRationales.checked,
        shuffle: toggleShuffle.checked,
        wrapFence: toggleFence.checked
      });
      updatePreview();
    });
  });

  // Title input change
  quizTitleInput.addEventListener('input', () => {
    updatePreview();
  });

  // Re-scan button
  rescanBtn.addEventListener('click', () => {
    scanActiveTab();
  });

  // Switch to manual tab shortcut from empty state
  const emptySwitchToManual = document.getElementById('emptySwitchToManual');
  if (emptySwitchToManual) {
    emptySwitchToManual.addEventListener('click', () => {
      document.querySelector('[data-tab="tab-manual"]').click();
    });
  }

  /**
   * UI State Handlers
   */
  function showLoadingState() {
    statusBadge.className = 'badge badge-waiting';
    statusBadge.textContent = 'Scanning...';
    loadingState.classList.remove('hidden');
    noQuizState.classList.add('hidden');
    quizFoundState.classList.add('hidden');
  }

  function showEmptyState() {
    statusBadge.className = 'badge badge-empty';
    statusBadge.textContent = 'No Quiz Found';
    loadingState.classList.add('hidden');
    noQuizState.classList.remove('hidden');
    quizFoundState.classList.add('hidden');
  }

  function showQuizState() {
    loadingState.classList.add('hidden');
    noQuizState.classList.add('hidden');
    quizFoundState.classList.remove('hidden');
  }

  /**
   * Scan active tab across all frames
   */
  async function scanActiveTab() {
    showLoadingState();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showEmptyState();
      return;
    }

    try {
      chrome.tabs.sendMessage(tab.id, { action: "GET_QUIZ" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.hasQuiz) {
          scanFramesViaScripting(tab.id);
        } else {
          loadQuizData(response.data);
        }
      });
    } catch (err) {
      showEmptyState();
    }
  }

  /**
   * Deep frame scanning fallback
   */
  function scanFramesViaScripting(tabId) {
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const root = document.querySelector('[data-app-data]');
        if (root) {
          return root.getAttribute('data-app-data');
        }
        return null;
      }
    }, (results) => {
      if (chrome.runtime.lastError || !results || results.length === 0) {
        showEmptyState();
        return;
      }

      for (const res of results) {
        if (res && res.result) {
          try {
            const decoded = QuizBlockFormatter.decodeEntities(res.result);
            const parsed = JSON.parse(decoded);
            if (parsed && (parsed.quiz || parsed.questions)) {
              loadQuizData(parsed);
              return;
            }
          } catch (e) {
            // continue
          }
        }
      }

      showEmptyState();
    });
  }

  /**
   * Load and render quiz data
   */
  function loadQuizData(data) {
    if (!data) {
      showEmptyState();
      return;
    }

    currentRawQuiz = data;
    currentNormalized = QuizBlockFormatter.normalize(data);

    if (!currentNormalized || currentNormalized.questions.length === 0) {
      showEmptyState();
      return;
    }

    // UI Updates
    showQuizState();

    statusBadge.className = 'badge badge-success';
    statusBadge.textContent = `✓ ${currentNormalized.questions.length} Ready`;

    quizTitleInput.value = currentNormalized.title;
    questionCountBadge.textContent = `${currentNormalized.questions.length} Questions`;

    const multiCount = currentNormalized.questions.filter(q => q.type === 'multiple').length;
    multiCountBadge.textContent = `${multiCount} Multi`;

    // Topic tags
    topicTagsContainer.innerHTML = '';
    const topics = currentNormalized.topics?.covered || [];
    topics.slice(0, 3).forEach(top => {
      const tag = document.createElement('span');
      tag.className = 'topic-tag';
      tag.textContent = top;
      topicTagsContainer.appendChild(tag);
    });

    updatePreview();
  }

  /**
   * Generate and display preview
   */
  function updatePreview() {
    if (!currentNormalized) return;

    const options = {
      includeHints: toggleHints.checked,
      includeRationales: toggleRationales.checked,
      shuffle: toggleShuffle.checked,
      wrapFence: toggleFence.checked, // Universal when false, wrapped when true
      customTitle: quizTitleInput.value.trim()
    };

    let formatted = "";
    if (activeFormat === 'yaml') {
      formatted = QuizBlockFormatter.toYaml(currentRawQuiz, options);
      codeLangTag.textContent = toggleFence.checked ? 'yaml (````qblock)' : 'yaml';
    } else if (activeFormat === 'json') {
      formatted = QuizBlockFormatter.toJson(currentRawQuiz, options);
      codeLangTag.textContent = toggleFence.checked ? 'json (````qblock)' : 'json';
    } else {
      formatted = QuizBlockFormatter.toPythonDict(currentRawQuiz, options);
      codeLangTag.textContent = toggleFence.checked ? 'python (````qblock)' : 'python dict';
    }

    codeOutput.textContent = formatted;
  }

  /**
   * Copy button handler
   */
  copyBtn.addEventListener('click', async () => {
    const text = codeOutput.textContent;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      copyBtnText.textContent = '✓ Copied!';
      copyBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      setTimeout(() => {
        copyBtnText.textContent = 'Copy Quiz';
        copyBtn.style.background = '';
      }, 2000);
    } catch (e) {
      console.error('Failed to copy', e);
    }
  });

  /**
   * Download handler (respects format and fence settings)
   */
  downloadBtn.addEventListener('click', () => {
    const text = codeOutput.textContent;
    if (!text) return;

    const title = (quizTitleInput.value.trim() || 'quiz')
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')
      .replace(/\s+/g, '_');

    // Extension determination
    let ext = 'md';
    if (!toggleFence.checked) {
      if (activeFormat === 'json') ext = 'json';
      else if (activeFormat === 'yaml') ext = 'yaml';
      else if (activeFormat === 'py') ext = 'py';
    }

    const filename = `${title}.${ext}`;
    const mimeType = ext === 'json' ? 'application/json' : 'text/plain;charset=utf-8';

    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  /**
   * Manual File Drop & Input
   */
  dropZone.addEventListener('click', () => fileInput.click());
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  });

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      processPastedOrDroppedContent(content);
    };
    reader.readAsText(file);
  }

  parsePasteBtn.addEventListener('click', () => {
    const text = pasteInput.value.trim();
    if (text) {
      processPastedOrDroppedContent(text);
    }
  });

  function processPastedOrDroppedContent(content) {
    const normalized = QuizBlockFormatter.normalize(content);
    if (normalized && normalized.questions.length > 0) {
      loadQuizData(normalized);
      // Switch back to Detected Quiz tab
      document.querySelector('[data-tab="tab-active"]').click();
    } else {
      alert("Could not detect quiz questions in the provided file/text. Please ensure it contains data-app-data or valid quiz JSON.");
    }
  }

});
