import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** Current wall-clock time in an arbitrary IANA zone, for the org cards. */
export const timeIn = (timezone: string) => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return "--:--";
  }
};

/** A commission's INR part as Root shows it (2026-11-20): whole rupees, Indian grouping — "INR 1,25,000". */
export const inrText = (n: number) => `INR ${Math.round(n).toLocaleString("en-IN")}`;
/** Whether an INR part is worth showing: at least a whole rupee. */
export const showsInr = (n: number | null | undefined) => Math.round(n ?? 0) > 0;

/**
 * A commission in AED with the part paid in rupees kept apart (2026-11-20: the INR part shown on its own, not the whole in AED):
 * "AED X + INR Y" — the INR only when there is some, never one summed number.
 */
export const aedInrText = (aed: number, inr = 0) =>
  `AED ${aed.toLocaleString("en-US", { maximumFractionDigits: 2 })}${showsInr(inr) ? ` + ${inrText(inr)}` : ""}`;
