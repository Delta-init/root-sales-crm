import type { Metadata, Viewport } from "next";

/** The open Class TV link for the office screens — no sign-in, not for search engines. */
export const metadata: Metadata = {
  title: "Class TV — Delta",
  description: "Today's classes: who teaches each, when and where — live.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = { themeColor: "#0f0a07" };

export default function PublicClassTvLayout({ children }: { children: React.ReactNode }) {
  return children;
}
