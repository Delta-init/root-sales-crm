export type OrgCode = "delta" | "banglore" | "draw";

export interface Organization {
  id: string;
  code: OrgCode;
  name: string;
  appUrl: string;
  timezone: string;
  currency: string;
  accent: string;
  dataStartsAt: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface Admin {
  _id: string;
  name: string;
  email: string;
  role: "root_admin" | "viewer";
  status: "active" | "inactive";
  lastLoginAt: string | null;
}
