"use client";

import { useState } from "react";
import { AxiosError } from "axios";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/axios";

/*
 * A call's recording (2026-10-14): the 3CX calls page's player, and the
 * Pending → Sales tab's (2026-10-17). Root asks the portal that has the call
 * for a link it signs for 10 minutes, only when Play is pressed.
 */
export /** Asks the portal for a fresh signed link only when played, so it is never stale. */
function Recording({ call }: { call: { portal: string; id: string } }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    setState("loading");
    try {
      const res = await api.get(`/calls/${call.portal}/${call.id}/recording-link`, { params: { index: 0 } });
      setUrl(res.data.data.url as string);
      setState("ready");
    } catch (e) {
      setError(e instanceof AxiosError ? (e.response?.data as { message?: string })?.message ?? "Could not open it" : "Could not open it");
      setState("error");
    }
  };
  if (state === "ready") {
    return (
      <span className="flex items-center gap-1">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls autoPlay preload="none" src={url} className="h-8 w-56" onError={() => { setError("The recording could not be played"); setState("error"); }} />
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setState("idle")} aria-label="Close the player"><Pause className="h-3.5 w-3.5" /></Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={load} disabled={state === "loading"}>
        {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Play
      </Button>
      {state === "error" && <span className="text-xs text-rose-500">{error}</span>}
    </span>
  );
}

