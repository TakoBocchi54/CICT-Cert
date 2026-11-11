import { useState } from 'react';

// Keeps an unsaved CSV/preview across tab switches and reloads (cleared when the browser tab closes).
// Storage can be blocked or full; the draft then lives in memory only.
export function useSessionDraft(key) {
  const [value, setValue] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
  });
  const update = next => {
    setValue(next);
    try {
      if (next == null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(next));
    } catch { /* memory only */ }
  };
  return [value, update];
}
