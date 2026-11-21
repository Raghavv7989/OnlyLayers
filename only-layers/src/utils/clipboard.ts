/**
 * Robust Cross-Platform Native Clipboard Helper
 * 
 * In Electron with `focusable: false` / panel mode, Chromium's `navigator.clipboard.writeText()`
 * is blocked because the document does not hold OS focus.
 * 
 * This helper uses:
 * 1. Native Electron IPC (`clipboard.writeText()`) — works 100% of the time regardless of focus.
 * 2. Fallback to `navigator.clipboard.writeText()`.
 * 3. Fallback to `document.execCommand('copy')` via an off-screen textarea.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Native Electron Clipboard IPC (Primary & Unrestricted)
  if (typeof window.electronAPI?.copyToClipboard === 'function') {
    try {
      const ok = await window.electronAPI.copyToClipboard(text);
      if (ok) return true;
    } catch (ipcErr) {
      console.warn('[copyTextToClipboard] IPC copy failed, attempting fallbacks:', ipcErr);
    }
  }

  // 2. Browser Clipboard API
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('[copyTextToClipboard] navigator.clipboard failed, attempting execCommand fallback:', err);
    }
  }

  // 3. Off-screen Textarea execCommand Fallback
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  } catch (domErr) {
    console.error('[copyTextToClipboard] All clipboard copy mechanisms failed:', domErr);
    return false;
  }
}
