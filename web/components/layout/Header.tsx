"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, CalendarDays, ChevronDown, ClipboardCheck, ClipboardList, KeyRound, LayoutGrid, LogOut, User, Users2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Logo } from "@/components/shared/Logo";
import { useAuth } from "@/providers/AuthProvider";
import { cn, getInitials } from "@/lib/utils";

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavItem extends Partial<NavLink> {
  label: string;
  icon: LucideIcon;
  rootOnly?: boolean;
  /** Present instead of an href: this opens rather than goes anywhere. */
  children?: NavLink[];
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Organisations", icon: LayoutGrid },
  /*
   * Sales, root admins only.
   *
   * Two permanent tabs for reports that are read now and then, next to the
   * ones used all day. Folded into one that opens, which also puts the two of
   * them where they belong — both answer the same question about the same
   * three CRMs, and neither means anything for the rest of the estate.
   *
   * rootOnly hides it. The API refuses it as well, which is the part that
   * actually decides: a menu that leaves something out is tidy, and an
   * endpoint that answers anybody who types its address is open regardless.
   */
  {
    label: "Sales",
    icon: BarChart3,
    rootOnly: true,
    children: [
      { href: "/reports", label: "Group report", icon: BarChart3 },
      { href: "/tracker", label: "Daily tracker", icon: ClipboardList },
    ],
  },
  // Root admins only: deciding who may open which production system is the
  // portal's most consequential act, and the API refuses anybody else anyway.
  { href: "/users", label: "Users", icon: Users2, rootOnly: true },
  /* Not root-only. It began that way, on the reasoning that a staff timetable
     is nobody's business by default — booking changed that. The people who
     need an hour with a mentor are the people doing the work, and a calendar
     only they cannot see is one they have to ask somebody else to read. */
  { href: "/mentors", label: "Mentors", icon: CalendarDays },
  /* Also open to everybody: raising work and clearing approvals are jobs the
     people doing the work do, and Media ERP decides who may actually do
     either. */
  { href: "/tasks", label: "Tasks", icon: ClipboardCheck },
  /*
   * Registry and Role map are not in the navigation.
   *
   * Both are still there and still work — /registry reports which systems are
   * configured and names the variables any of them is missing, and /role-map
   * edits the rules that make a role in one system imply a role in another.
   * They are just not things anybody needs weekly, and two permanent links to
   * them crowded out the ones that are used daily.
   *
   * Reachable by address. Put them back here the moment that becomes a
   * nuisance rather than a tidy-up.
   */
];

export function Header() {
  const { admin, logout } = useAuth();
  const pathname = usePathname();
  if (!admin) return null;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border/40 bg-background/80 px-4 backdrop-blur-sm md:px-6">
      <div className="flex items-center gap-3">
        <Logo width={132} />
        <div className="hidden h-8 w-px bg-border sm:block" />
        <div className="hidden leading-tight lg:block">
          <div className="text-sm font-semibold">Root Sales CRM</div>
          <div className="text-xs text-muted-foreground">Delta · Banglore · Draw</div>
        </div>

        <div className="hidden h-8 w-px bg-border sm:block" />

        <nav className="flex items-center gap-1">
          {NAV.filter((item) => !item.rootOnly || admin?.role === "root_admin").map((item) => {
            // startsWith so a drill-down like /tracker/delta keeps the tab lit
            const lit = (href: string) =>
              pathname === href || pathname.startsWith(href + "/");
            const active = item.children
              ? item.children.some((c) => lit(c.href))
              : lit(item.href ?? "");

            const tab = cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            );

            if (item.children) {
              return (
                <DropdownMenu key={item.label}>
                  <DropdownMenuTrigger className={tab}>
                    <item.icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {item.children.map((c) => (
                      <DropdownMenuItem key={c.href} asChild>
                        <Link
                          href={c.href}
                          className={cn("gap-2", lit(c.href) && "font-medium text-foreground")}
                        >
                          <c.icon className="h-4 w-4" />
                          {c.label}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            return (
              <Link key={item.href} href={item.href ?? "#"} className={tab}>
                <item.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-1.5">
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-accent">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                  {getInitials(admin.name)}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{admin.name}</p>
                <p className="text-xs leading-none text-muted-foreground">{admin.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <User className="mr-2 h-4 w-4" />
              {/* All three, named. This read "Viewer" for everybody who was
                  not a root admin, so a member — most people here now — was
                  told they were something they are not, on the one screen
                  that exists to say who you are. */}
              {admin.role === "root_admin"
                ? "Root admin"
                : admin.role === "member"
                  ? "Member"
                  : "Viewer"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
