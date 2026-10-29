/**
 * Content Script for NotebookLM Quiz Extractor
 * Injected into NotebookLM parent frames and shim app iframes.
 */

(function () {
  'use strict';

  // Prevent multiple injections in same frame
  if (window.__NOTEBOOK_QUIZ_EXTRACTOR_LOADED__) return;
  window.__NOTEBOOK_QUIZ_EXTRACTOR_LOADED__ = true;

  let cachedQuizData = null;
  let floatingBtnEl = null;

  /**
   * Primary Extraction Strategy: High-fidelity data-app-data JSON
   */
  function extractFromAppData() {
    const rootEl = document.querySelector('[data-app-data]');
    if (!rootEl) return null;

    const rawAttr = rootEl.getAttribute('data-app-data');
    if (!rawAttr) return null;

    try {
      const decoded = typeof QuizBlockFormatter !== 'undefined'
        ? QuizBlockFormatter.decodeEntities(rawAttr)
        : rawAttr;
      const data = JSON.parse(decoded);
      if (data && (Array.isArray(data.quiz) || Array.isArray(data.questions))) {
        return data;
      }
    } catch (e) {
      console.warn('[Notebook Quiz Extractor] Could not parse data-app-data attribute:', e);
    }
    return null;
  }

  /**
   * Secondary Extraction Strategy: Embedded Scripts
   */
  function extractFromScripts() {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.includes('"answerOptions"') && text.includes('"quiz"')) {
        try {
          const match = text.match(/\{[\s\S]*"quiz"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
          if (match) {
            const data = JSON.parse(match[0]);
            if (data && data.quiz) return data;
          }
        } catch (e) {
          // ignore
        }
      }
    }
    return null;
  }

  /**
   * Tertiary Extraction Strategy: Live Rendered DOM Fallback
   */
  function extractFromRenderedDom() {
    const questionEls = document.querySelectorAll('quiz-question, multiple-select-question, .question-card');
    if (!questionEls || questionEls.length === 0) return null;

    const questions = [];
    questionEls.forEach((qEl, idx) => {
      const titleEl = qEl.querySelector('.question-text, .question-title, h1, h2');
      const qText = titleEl ? titleEl.textContent.trim() : `Question ${idx + 1}`;

      const hintEl = qEl.querySelector('.hint-text, [data-hint]');
      const hint = hintEl ? hintEl.textContent.trim() : '';

      const optionEls = qEl.querySelectorAll('.answer-option, button.option, [role="radio"], [role="checkbox"]');
      const answerOptions = [];

      optionEls.forEach((optEl) => {
        const text = optEl.textContent.trim();
        const isCorrect = optEl.classList.contains('correct') || optEl.getAttribute('aria-checked') === 'true';
        answerOptions.push({
          text,
          isCorrect,
          rationale: ''
        });
      });

      if (answerOptions.length >= 2) {
        questions.push({
          question: qText,
          hint,
          answerOptions
        });
      }
    });

    if (questions.length > 0) {
      return {
        title: document.title || "NotebookLM Quiz",
        quiz: questions
      };
    }
    return null;
  }

  /**
   * Master Detector
   */
  function detectQuiz() {
    let data = extractFromAppData();
    if (!data) data = extractFromScripts();
    if (!data) data = extractFromRenderedDom();

    if (data) {
      cachedQuizData = data;
      const normalized = typeof QuizBlockFormatter !== 'undefined'
        ? QuizBlockFormatter.normalize(data)
        : null;

      const count = normalized ? normalized.questions.length : (data.quiz ? data.quiz.length : 0);
      const title = normalized ? normalized.title : (data.title || "NotebookLM Quiz");

      // Notify background worker
      try {
        chrome.runtime.sendMessage({
          action: "QUIZ_DETECTED",
          count,
          title,
          data
        });
      } catch (e) {
        // Extension context might be invalid
      }

      injectFloatingButton(count, title);
      return { hasQuiz: true, count, title, data, normalized };
    }

    return { hasQuiz: false };
  }

  /**
   * Injects an in-page floating copy button near the quiz
   */
  function injectFloatingButton(questionCount, title) {
    if (floatingBtnEl && document.body.contains(floatingBtnEl)) {
      const labelEl = floatingBtnEl.querySelector('.nqe-label');
      if (labelEl) labelEl.textContent = `Copy Quiz (${questionCount} Qs)`;
      return;
    }

    floatingBtnEl = document.createElement('div');
    floatingBtnEl.className = 'nqe-floating-container';
    floatingBtnEl.innerHTML = `
      <button class="nqe-btn nqe-btn-primary" title="Export Quiz Data">
        <svg class="nqe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          <path d="m9 14 2 2 4-4"></path>
        </svg>
        <span class="nqe-label">Copy Quiz (${questionCount} Qs)</span>
      </button>
      <button class="nqe-btn nqe-btn-gear" title="Quiz Export Options">
        <svg class="nqe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
    `;

    const copyBtn = floatingBtnEl.querySelector('.nqe-btn-primary');
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!cachedQuizData) return;

      // Read saved options if any
      chrome.storage.local.get({
        format: 'py',
        includeHints: true,
        includeRationales: true,
        shuffle: false,
        wrapFence: false
      }, async (settings) => {
        const text = QuizBlockFormatter.format(cachedQuizData, settings.format, settings);
        try {
          await navigator.clipboard.writeText(text);
          showToast(`✓ Copied ${questionCount} questions to clipboard!`);
        } catch (err) {
          // Fallback textarea copy
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showToast(`✓ Copied ${questionCount} questions to clipboard!`);
        }
      });
    });
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showToast(`✓ Copied ${questionCount} questions to clipboard!`);
        }
      });
    });

    const gearBtn = floatingBtnEl.querySelector('.nqe-btn-gear');
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "OPEN_POPUP" });
    });

    document.body.appendChild(floatingBtnEl);
  }

  /**
   * Floating toast notification
   */
  function showToast(msg) {
    let toast = document.querySelector('.nqe-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'nqe-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('nqe-toast-visible');
    setTimeout(() => {
      toast.classList.remove('nqe-toast-visible');
    }, 3200);
  }

  // Listen for messages from popup or background service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_QUIZ") {
      const result = detectQuiz();
      sendResponse(result);
      return true;
    }

    if (request.action === "COPY_QUIZ") {
      if (cachedQuizData && typeof QuizBlockFormatter !== 'undefined') {
        const markdown = QuizBlockFormatter.format(cachedQuizData, request.format || 'py', request.options || {});
        navigator.clipboard.writeText(markdown).then(() => {
          showToast("✓ Copied to clipboard!");
          sendResponse({ success: true, markdown });
        }).catch((err) => {
          sendResponse({ success: false, error: String(err) });
        });
        return true;
      }
    }
  });

  // Initial detection
  detectQuiz();

  // Watch for dynamic DOM changes (e.g. when quiz loads dynamically)
  const observer = new MutationObserver(() => {
    if (!cachedQuizData) {
      detectQuiz();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-app-data']
  });

})();

