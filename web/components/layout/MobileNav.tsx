"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navFor, type NavItem } from "./nav";
import { useAuth } from "@/providers/AuthProvider";
import { cn } from "@/lib/utils";

/*
 * The navigation, along the bottom, on a phone.
 *
 * The same links the header shows on a wide screen — read from the same list,
 * so the two cannot drift — moved to where a thumb actually reaches. A row of
 * tabs across the top of a 375px screen had already given up: the labels were
 * hidden below `sm`, leaving five unexplained icons competing with the logo
 * and the avatar for a strip of space none of them fit in.
 *
 * Icon over label, one column each. The labels come back because down here
 * there is room for them, and an icon alone is a guess.
 *
 * Seven-odd tabs do not fit 375px at a size a thumb can hit, so each keeps a
 * width of its own and the row scrolls sideways (the user, 2026-10-11): it
 * starts at the open page, and a fade at an edge says there is more that way.
 */
export function MobileNav() {
  const { admin } = useAuth();
  const pathname = usePathname();
  /* Which group is open, by label. A dropdown anchored to a bar at the very
     bottom of the screen opens upward into the page rather than off it, so
     this is a panel of our own rather than a menu component fighting gravity. */
  const [open, setOpen] = useState<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  /** Whether more of the row lies off each edge. */
  const [more, setMore] = useState({ left: false, right: false });
  const measure = () => {
    const el = row.current;
    if (!el) return;
    setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };

  // The open page's tab in view — on arriving, and after every navigation.
  useEffect(() => {
    const el = row.current;
    const tab = el?.querySelector<HTMLElement>("[data-active='true']");
    if (el && tab) {
      const left = tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2;
      el.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    }
    measure();
  }, [pathname, admin]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  if (!admin) return null;

  const items = navFor(admin);
  const lit = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const isActive = (i: NavItem) =>
    i.children ? i.children.some((c) => lit(c.href)) : lit(i.href ?? "");

  return (
    <>
      {/* Tapping anywhere else puts the panel away — the usual way out of a
          sheet on a phone, and the one people try first. */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
        />
      )}

      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-md md:hidden",
          // Clear of the home indicator on a phone that has one.
          "pb-[env(safe-area-inset-bottom)]"
        )}
      >
        {items.map((item) =>
          item.children && open === item.label ? (
            <div key={item.label} className="border-b border-border/60 p-2">
              {item.children.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  onClick={() => setOpen(null)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    lit(c.href)
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground active:bg-accent/60"
                  )}
                >
                  <c.icon className="h-4 w-4 shrink-0" />
                  {c.label}
                </Link>
              ))}
            </div>
          ) : null
        )}

        <div className="relative">
        <div ref={row} onScroll={measure} className="no-scrollbar flex items-stretch overflow-x-auto overscroll-x-contain">
          {items.map((item) => {
            const active = isActive(item);
            const body = (
              <>
                <item.icon className={cn("h-5 w-5 shrink-0", active && "text-primary")} />
                {/* Truncated rather than wrapped: "Organisations" under a
                    52px column would otherwise push the bar two lines tall
                    and shove the page up with it. */}
                <span className="w-full truncate px-0.5 text-center text-[10px] leading-none">
                  {item.label}
                </span>
              </>
            );
            const cls = cn(
              // At least a thumb's width each; when they all fit, they share the bar.
              "flex min-w-[68px] flex-1 shrink-0 flex-col items-center justify-center gap-1 px-1 py-2 text-muted-foreground transition-colors",
              active && "text-foreground",
              "active:bg-accent/50"
            );

            return item.children ? (
              <button
                key={item.label}
                type="button"
                data-active={active}
                aria-expanded={open === item.label}
                onClick={() => setOpen((o) => (o === item.label ? null : item.label))}
                className={cls}
              >
                {body}
              </button>
            ) : (
              <Link key={item.href} href={item.href ?? "#"} data-active={active} onClick={() => setOpen(null)} className={cls}>
                {body}
              </Link>
            );
          })}
        </div>
        {more.left && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />}
        {more.right && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />}
        </div>
      </nav>
    </>
  );
}
