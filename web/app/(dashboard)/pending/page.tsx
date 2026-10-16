import { redirect } from "next/navigation";

/** Pending opens on its first tab, the CS portal. */
export default function PendingPage() {
  redirect("/pending/cs");
}
