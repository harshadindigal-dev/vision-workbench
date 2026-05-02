const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

document.getElementById('align').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('No active tab.');
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'ALIGN_START' });
    setStatus('Clock aligned on this tab — start capture / recording now, then click the UI.');
  } catch (e) {
    setStatus('Could not reach content script. Reload the page after installing the extension.');
  }
});

document.getElementById('clear').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS' }, () => {
    setStatus('Events cleared.');
  });
});

document.getElementById('export').addEventListener('click', () => {
  chrome.storage.local.get({ events: [] }, (data) => {
    const body = {
      schema_version: 1,
      events: data.events || [],
    };
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pointer-events-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${body.events.length} events. Upload alongside your screen recording in Session learning.`);
  });
});

chrome.storage.local.get({ events: [] }, (data) => {
  setStatus(`${(data.events || []).length} events buffered.`);
});
