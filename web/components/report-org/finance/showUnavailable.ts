"use client";

import { useEffect, useState } from "react";

/*
 * "Show unavailable" (Phase 7, 2026-11-28): reports that are not connected, or that finance cannot build, are hidden
 * in the catalog and the side menu until this is switched on. One switch for both, kept in this browser only.
 */
const KEY = "report-org:show-unavailable";
const EVENT = "report-org:show-unavailable";

const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export function useShowUnavailable(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(read());
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const set = (v: boolean) => {
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private window: this page only */ }
    setOn(v);
    window.dispatchEvent(new Event(EVENT));
  };
  return [on, set];
}
