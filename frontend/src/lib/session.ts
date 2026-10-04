import { useEffect, useState } from "react";
import type { Session } from "./api";

const KEY = "historimed_session";
const EVT = "historimed-session";

export function saveSession(s: Session | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}

function read(): Session | null {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

/** Returns [session, loaded]. Reads storage after hydration. */
export function useSession(): [Session | null, boolean] {
  const [s, setS] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const sync = () => setS(read());
    sync(); setLoaded(true);
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return [s, loaded];
}
