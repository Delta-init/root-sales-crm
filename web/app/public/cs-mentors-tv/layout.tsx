import type { Metadata, Viewport } from "next";

/** The open CS & Mentors TV link for the office screens — no sign-in, not for search engines. */
export const metadata: Metadata = {
  title: "CS & Mentors TV — Delta",
  description: "The CS and the mentors side by side: what each collected or brought in this month, with their teams' leaders, live.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = { themeColor: "#0b1120" };

export default function PublicCsMentorsTvLayout({ children }: { children: React.ReactNode }) {
  return children;
}
