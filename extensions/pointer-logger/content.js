let alignT0 = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ALIGN_START') {
    alignT0 = performance.now();
    sendResponse({ ok: true, aligned_at_ms: alignT0 });
    return true;
  }
  return false;
});

function rectPayload(el) {
  try {
    const r = el.getBoundingClientRect?.();
    if (!r) return null;
    return {
      left: Math.round(r.left * 1000) / 1000,
      top: Math.round(r.top * 1000) / 1000,
      width: Math.round(r.width * 1000) / 1000,
      height: Math.round(r.height * 1000) / 1000,
    };
  } catch {
    return null;
  }
}

document.addEventListener(
  'pointerdown',
  (e) => {
    if (alignT0 === null) return;
    const t = (performance.now() - alignT0) / 1000;
    const target = e.target;
    let labelText = '';
    try {
      if (target && typeof target.innerText === 'string') {
        labelText = target.innerText.trim().slice(0, 240);
      }
    } catch {
      labelText = '';
    }
    chrome.runtime.sendMessage({
      type: 'POINTER',
      payload: {
        t_seconds: Math.round(t * 1000) / 1000,
        client_x: e.clientX,
        client_y: e.clientY,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        target_rect: rectPayload(target),
        tag: target?.tagName ?? null,
        label_text: labelText,
        pointer_type: e.pointerType ?? null,
      },
    });
  },
  true,
);
