/*
 * What is in the navigation, in one place.
 *
 * Shared because it is rendered twice and must not drift: a row of tabs at the
 * top on a wide screen, a bar along the bottom on a phone. Two copies of this
 * list would mean a tab that exists on a laptop and not on a phone, and the
 * person who hit that would have no way to tell it was a bug.
 */
import type { LucideIcon } from "lucide-react";
import {
  BarChart3, CalendarDays, ClipboardCheck, ClipboardList, LayoutGrid, Users2,
} from "lucide-react";

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavItem extends Partial<NavLink> {
  label: string;
  icon: LucideIcon;
  rootOnly?: boolean;
  /** Present instead of an href: this opens rather than goes anywhere. */
  children?: NavLink[];
}

export const NAV: NavItem[] = [
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
