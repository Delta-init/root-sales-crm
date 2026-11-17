import type { Metadata, Viewport } from "next";

/** The open Mentors TV link for the office screens — no sign-in, not for search engines. */
export const metadata: Metadata = {
  title: "Mentors TV — Delta",
  description: "Each mentor's revenue this month — course payments after their meetings — and their meetings, live.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = { themeColor: "#0b1120" };

export default function PublicMentorsTvLayout({ children }: { children: React.ReactNode }) {
  return children;
}
