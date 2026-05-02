chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'POINTER') {
    chrome.storage.local.get({ events: [] }, (data) => {
      const row = {
        ...msg.payload,
        page_url: sender.tab?.url ?? null,
      };
      chrome.storage.local.set({ events: [...data.events, row] });
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'CLEAR_EVENTS') {
    chrome.storage.local.set({ events: [] }, () => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

