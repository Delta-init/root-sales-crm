import type { Metadata, Viewport } from "next";

/** The open Manager TV link for the office screens — no sign-in, not for search engines. */
export const metadata: Metadata = {
  title: "Manager TV — Delta",
  description: "Dubai Sales, Draw, Remote and the CS team: closings, course payments, calls and who is on a break — live.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = { themeColor: "#0b1120" };

export default function PublicManagerTvLayout({ children }: { children: React.ReactNode }) {
  return children;
}
