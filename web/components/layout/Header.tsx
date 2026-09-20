"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, KeyRound, LayoutGrid, LogOut, Server, Shuffle, User } from "lucide-react";
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

const NAV = [
  { href: "/dashboard", label: "Organisations", icon: LayoutGrid },
  { href: "/reports", label: "Group report", icon: BarChart3 },
  { href: "/tracker", label: "Daily tracker", icon: ClipboardList },
  // Root admins only: deciding who may open which production system is the
  // portal's most consequential act, and the API refuses anybody else anyway.
  { href: "/access", label: "Access", icon: KeyRound, rootOnly: true },
  { href: "/registry", label: "Registry", icon: Server, rootOnly: true },
  { href: "/role-map", label: "Role map", icon: Shuffle, rootOnly: true },
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
            // startsWith so a drill-down like /reports/sources keeps the tab lit
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
              >
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
              {admin.role === "root_admin" ? "Root admin" : "Viewer"}
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
