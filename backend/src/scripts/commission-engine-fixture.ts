/**
 * One sales CRM's commission data for October 2026, as a CRM keeps it — for checking Root's commission logic
 * (commission-engine-check.ts), and for running the same data through a CRM's own code to see the two agree.
 *
 *   Teams      Gladiators (leader Lena; Ria, Gopika), Titans (leader Tom; Mo, Zed), Spartans (no leader; Zed),
 *              Manager's team (led by the Sales Manager Abrar; Nina), an inactive team (leader Old)
 *   Settings   Sales Manager Abrar; Shared login earns nothing
 *   Courses    MBT 230 / 85 / 100, DWT 500 / 200 / 300 (sales / TL / SM)
 *   Sales      s1 Ria, 15,000 paid in full in October          s2 Ria, 10,000, half paid in October (owes half)
 *              s3 Gopika, 5,000, finance not approved yet      s4 Mo, 2,250 paid in AED, lines from an older plan
 *              s5 Ria, a September sale finished in October     s6 reversed
 *              s7 Shared login's sale (excluded)                s8 Lena's own close, 1,000 paid in full
 */
import { Types } from "mongoose";

type Db = { collection: (name: string) => { insertMany: (docs: object[]) => Promise<unknown>; insertOne: (doc: object) => Promise<unknown> } };

export async function seedCrm(db: Db) {
  const id = () => new Types.ObjectId();
  const u = { abrar: id(), lena: id(), ria: id(), gopika: id(), shared: id(), tom: id(), mo: id(), zed: id(), nina: id(), old: id() };
  const name: Record<string, string> = { abrar: "Abrar", lena: "Lena", ria: "Ria", gopika: "Gopika", shared: "Shared login", tom: "Tom", mo: "Mo", zed: "Zed", nina: "Nina", old: "Old" };
  await db.collection("users").insertMany(Object.entries(u).map(([k, _id]) => ({ _id, name: name[k], status: k === "old" ? "inactive" : "active" })));
  const t = { glad: id(), titans: id(), spartans: id(), managers: id(), gone: id() };
  await db.collection("teams").insertMany([
    { _id: t.glad, name: "Gladiators", status: "active", leaders: [u.lena], members: [u.ria, u.gopika] },
    { _id: t.titans, name: "Titans", status: "active", leaders: [u.tom], members: [u.mo, u.zed] },
    { _id: t.spartans, name: "Spartans", status: "active", leaders: [], members: [u.zed] },
    { _id: t.managers, name: "Manager's team", status: "active", leaders: [u.abrar], members: [u.nina] },
    { _id: t.gone, name: "Old team", status: "inactive", leaders: [u.old], members: [] },
  ]);
  const c = { mbt: id(), dwt: id() };
  await db.collection("courses").insertMany([
    { _id: c.mbt, name: "MBT", amount: 2250, status: "active", commission: { sales: 230, tl: 85, sm: 100, creditUsd: 500 } },
    { _id: c.dwt, name: "DWT", amount: 5500, status: "active", commission: { sales: 500, tl: 200, sm: 300, creditUsd: 1000 } },
  ]);
  await db.collection("commissionsettings").insertOne({ key: "default", salesManager: u.abrar, excludedUsers: [u.shared] });

  const st = { s1: id(), s2: id(), s3: id(), s4: id(), s5: id(), s6: id(), s7: id(), s8: id() };
  const students: Array<[keyof typeof st, Types.ObjectId, Types.ObjectId, number]> = [
    ["s1", u.ria, t.glad, 15000], ["s2", u.ria, t.glad, 10000], ["s3", u.gopika, t.glad, 5000], ["s4", u.mo, t.titans, 2250],
    ["s5", u.ria, t.glad, 4000], ["s6", u.ria, t.glad, 9000], ["s7", u.shared, t.glad, 3000], ["s8", u.lena, t.glad, 1000],
  ];
  await db.collection("students").insertMany(students.map(([k, closer, team, fee]) => ({ _id: st[k], name: `Student ${k}`, assignedTo: closer, team, course: c.mbt, totalFee: fee })));
  await db.collection("financehandovers").insertMany(students.map(([k]) => ({ studentId: st[k], status: "sent", approvalState: k === "s3" ? "pending" : "approved" })));

  const at = (iso: string) => new Date(iso);
  const line = (role: string, who: keyof typeof u, amount: number) => ({ role, user: u[who], userName: name[who], amount });
  const glad = (closer: keyof typeof u, s = 230, tl = 85, sm = 100) => [line("sales", closer, s), line("tl", "lena", tl), line("sm", "abrar", sm)];
  const sale = (k: keyof typeof st, o: object) => ({ student: st[k], studentName: `Student ${k}`, course: c.mbt, courseName: "MBT", ...o });
  await db.collection("commissionsales").insertMany([
    sale("s1", { closer: u.ria, team: t.glad, state: "counted", month: "2026-10", saleDate: at("2026-10-05T08:00:00Z"), fee: 15000, owedShare: 0, collections: [{ paidAt: at("2026-10-05T08:00:00Z"), share: 1 }], lines: glad("ria") }),
    sale("s2", { closer: u.ria, team: t.glad, state: "counted", month: "2026-10", saleDate: at("2026-10-10T08:00:00Z"), fee: 10000, owedShare: 0.5, collections: [{ paidAt: at("2026-10-10T08:00:00Z"), share: 0.5 }], lines: glad("ria") }),
    sale("s3", { closer: u.gopika, team: t.glad, state: "progress", month: "2026-10", saleDate: at("2026-10-12T08:00:00Z"), fee: 5000, lines: [] }),
    sale("s4", { closer: u.mo, team: t.titans, state: "counted", month: "2026-10", saleDate: at("2026-10-03T08:00:00Z"), fee: 2250, owedShare: 0,
      collections: [{ paidAt: at("2026-10-03T08:00:00Z"), share: 1, aed: 2250 }], lines: [line("sales", "mo", 200), line("tl", "tom", 85), line("sm", "abrar", 100)] }),
    sale("s5", { closer: u.ria, team: t.glad, state: "counted", month: "2026-09", saleDate: at("2026-09-20T08:00:00Z"), fee: 4000, owedShare: 0,
      collections: [{ paidAt: at("2026-09-20T08:00:00Z"), share: 0.5 }, { paidAt: at("2026-10-02T08:00:00Z"), share: 0.5 }], lines: glad("ria") }),
    sale("s6", { closer: u.ria, team: t.glad, state: "reversed", month: "2026-10", saleDate: at("2026-10-15T08:00:00Z"), fee: 9000, owedShare: 0, collections: [{ paidAt: at("2026-10-15T08:00:00Z"), share: 1 }], lines: glad("ria") }),
    sale("s7", { closer: u.shared, team: t.glad, state: "excluded", month: "2026-10", saleDate: at("2026-10-18T08:00:00Z"), fee: 3000, lines: [] }),
    sale("s8", { closer: u.lena, team: t.glad, state: "counted", month: "2026-10", saleDate: at("2026-10-08T08:00:00Z"), fee: 1000, owedShare: 0,
      collections: [{ paidAt: at("2026-10-08T08:00:00Z"), share: 1 }], lines: [line("sales", "lena", 230), line("tl", "lena", 0), line("sm", "abrar", 100)] }),
  ]);
  return { users: u, teams: t, courses: c, students: st };
}
