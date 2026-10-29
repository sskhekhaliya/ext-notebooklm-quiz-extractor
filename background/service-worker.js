/**
 * Background Service Worker for NotebookLM Quiz Extractor
 */

// Initialize default state
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
  chrome.action.setTitle({ title: "Extract Quize from Google NotebookLM" });
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'QUIZ_DETECTED' && sender.tab) {
    const count = request.count;
    if (count > 0) {
      chrome.action.setBadgeText({
        tabId: sender.tab.id,
        text: String(count)
      });
      chrome.action.setBadgeBackgroundColor({
        tabId: sender.tab.id,
        color: '#7c3aed'
      });
      chrome.action.setTitle({
        tabId: sender.tab.id,
        title: `Extract Quize from Google NotebookLM (${count} Questions ready)`
      });
    }
  }

  if (request.action === 'OPEN_POPUP') {
    if (chrome.action && chrome.action.openPopup) {
      chrome.action.openPopup().catch(() => {
        // Fallback if popup cannot be opened programmatically
      });
    }
  }
});

