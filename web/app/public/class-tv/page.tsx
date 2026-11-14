"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ClassTvBoard } from "@/components/class-tv/ClassTvBoard";

/*
 * The open Class TV (the user, 2026-11-14): for the office TVs, no sign-in — /public/class-tv for Dubai,
 * /public/class-tv?academy=bangalore for Bangalore. Asks the backend's GET /public/class-tv every half minute (names,
 * courses, times and places, never an email); the backend's cache decides how often the LMS is actually asked.
 */
function Board() {
  const academy = useSearchParams().get("academy") === "bangalore" ? "bangalore" : "dubai";
  return <ClassTvBoard key={academy} academy={academy} />;
}

export default function PublicClassTvPage() {
  return (
    <Suspense fallback={null}>
      <Board />
    </Suspense>
  );
}
