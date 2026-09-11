import { useEffect, useState } from 'react';

// Disaster-readiness audit item 5.1: detects (does not solve — real offline
// capability would need a service worker, a HIGH-effort item not done here)
// loss of connectivity so the UI can say so honestly instead of silently
// showing stale data as if it were current.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

// Disaster-readiness audit item 5.4 (overloaded mobile networks): the
// Network Information API is only available in Chromium browsers and is
// explicitly best-effort — returns null when unsupported, and callers must
// treat that as "unknown", not "fast".
type ConnectionInfo = { effectiveType: string; saveData: boolean } | null;

function readConnection(): ConnectionInfo {
  const nav = navigator as Navigator & { connection?: { effectiveType: string; saveData: boolean } };
  if (!nav.connection) return null;
  return { effectiveType: nav.connection.effectiveType, saveData: nav.connection.saveData };
}

export function useConnectionQuality(): { isSlow: boolean; effectiveType: string | null } {
  const [info, setInfo] = useState<ConnectionInfo>(() => readConnection());

  useEffect(() => {
    const nav = navigator as Navigator & { connection?: EventTarget & { effectiveType: string; saveData: boolean } };
    const conn = nav.connection;
    if (!conn) return;
    const update = () => setInfo(readConnection());
    conn.addEventListener('change', update);
    return () => conn.removeEventListener('change', update);
  }, []);

  return {
    isSlow: info !== null && (info.effectiveType === 'slow-2g' || info.effectiveType === '2g' || info.saveData),
    effectiveType: info?.effectiveType ?? null,
  };
}
