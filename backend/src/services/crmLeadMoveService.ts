import { Types } from "mongoose";
import { z } from "zod";
import { CrmLeadMove, type ICrmLeadMove } from "../models/CrmLeadMove.js";
import { getSources } from "./crmConnections.js";
import { intakeConfig, postToCrm } from "../lib/crmIntakeClient.js";

/*
 * Moving leads between the sales CRMs (the user, 2026-11-19: "we need option to transfer between crms"). The CRM a lead
 * leaves asks here, with its own secret (so Root knows which CRM is asking — never from the body); Root hands the leads
 * to the other CRM through that CRM's sheet door and its sheet key, the way the lead sheets' leads already reach it, and
 * keeps a row per lead. The CRM it left only lets go of a lead once the other CRM has it. Undo (24 hours) asks the
 * other CRM to give it back first.
 */

export const MOVE_CRMS = ["delta", "draw", "remote"] as const;
export type MoveCrm = (typeof MOVE_CRMS)[number];
export const CRM_NAME: Record<MoveCrm, string> = { delta: "Sales CRM", draw: "Draw CRM", remote: "Remote CRM" };
const isCrm = (v: unknown): v is MoveCrm => MOVE_CRMS.includes(v as MoveCrm);
const UNDO_MS = 24 * 3_600_000;
const MAX_LEADS = 500;

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
function asking(from: string): MoveCrm {
  if (!isCrm(from)) throw fail("Only the Sales, Draw and Remote CRMs move leads between them", 403);
  return from;
}

/** The other CRMs, their active teams and who is in them — what the CRM's Move dialog offers. */
export async function moveTargets(fromCode: string) {
  const from = asking(fromCode);
  const { sources, failures } = await getSources();
  return Promise.all(MOVE_CRMS.filter((c) => c !== from).map(async (code) => {
    const missing = intakeConfig(code).missing;
    const src = sources.find((s) => s.org.code === code);
    const base = { code, name: CRM_NAME[code], ready: !missing.length, missing };
    if (!src) return { ...base, teams: [], error: failures.find((f) => f.code === code)?.error ?? `${CRM_NAME[code]} can't be read just now` };
    try {
      const teams = await src.conn.collection("teams").find({ status: { $ne: "inactive" } }, { projection: { name: 1, leaders: 1, members: 1 } }).sort({ name: 1 }).toArray();
      const ids = [...new Set(teams.flatMap((t) => [...(t.leaders ?? []), ...(t.members ?? [])].map(String)))].filter((i) => Types.ObjectId.isValid(i));
      const users = await src.conn.collection("users").find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) }, status: { $ne: "inactive" } }, { projection: { name: 1 } }).toArray();
      const name = new Map(users.map((u) => [String(u._id), String(u.name ?? "")]));
      return {
        ...base,
        teams: teams.map((t) => {
          const leaders = new Set((t.leaders ?? []).map(String));
          const people = [...new Set([...(t.leaders ?? []), ...(t.members ?? [])].map(String))]
            .filter((i) => name.has(i))
            .map((i) => ({ id: i, name: name.get(i)!, leader: leaders.has(i) }))
            .sort((a, b) => Number(b.leader) - Number(a.leader) || a.name.localeCompare(b.name));
          return { id: String(t._id), name: String(t.name ?? ""), people };
        }),
      };
    } catch (e) {
      return { ...base, teams: [], error: `${CRM_NAME[code]} can't be read just now (${(e as Error).message})` };
    }
  }));
}

const leadSchema = z.object({
  fromLeadId: z.string().min(1),
  name: z.string().default(""),
  phone: z.string().min(1),
  email: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  platform: z.string().optional().nullable(),
  campaign: z.string().optional().nullable(),
  ownerName: z.string().optional().nullable(),
  teamName: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  history: z.string().optional().nullable(),
  notes: z.array(z.object({ content: z.string(), at: z.string().optional().nullable(), by: z.string().optional().nullable() })).max(200).optional(),
});
export const moveSchema = z.object({
  to: z.string(),
  mode: z.enum(["person", "team", "split"]),
  teamId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  byName: z.string().default(""),
  leads: z.array(leadSchema).min(1).max(MAX_LEADS),
});
export type MoveInput = z.infer<typeof moveSchema>;

interface CrmResult { index: number; status: "created" | "repeat" | "invalid"; leadId?: string; holder?: string; reason?: string; teamName?: string; personName?: string }

/**
 * Hand the leads to the other CRM; a row for each it took. Answers lead by lead: moved (with the row's id, which the
 * CRM it left keeps for Undo) or not, and why. The other CRM refusing the whole batch (a person not in that team, its
 * server down) is an error — nothing moved.
 */
export async function moveLeads(fromCode: string, raw: unknown) {
  const from = asking(fromCode);
  const parsed = moveSchema.safeParse(raw);
  if (!parsed.success) throw fail(`Can't move these: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, 400);
  const input = parsed.data;
  if (!isCrm(input.to)) throw fail(`No CRM "${input.to}" to move to`, 400);
  if (input.to === from) throw fail("That's this CRM", 400);
  if (input.mode !== "split" && !input.teamId) throw fail("Pick a team", 400);
  if (input.mode === "person" && !input.userId) throw fail("Pick a person", 400);
  const to = input.to;

  let answer: { results: CrmResult[] };
  try {
    answer = await postToCrm<{ results: CrmResult[] }>(to, "/lead-moves", { from, fromName: CRM_NAME[from], ...input });
  } catch (e) {
    const status = (e as { crmStatus?: number }).crmStatus;
    throw fail(`${CRM_NAME[to]} ${(e as Error).message}`, status && status >= 400 && status < 500 && status !== 404 ? 400 : 502);
  }
  const results = Array.isArray(answer?.results) ? answer.results : [];
  return Promise.all(input.leads.map(async (l, index) => {
    const r = results.find((x) => x.index === index);
    if (!r || r.status === "invalid" || !r.leadId) {
      return { fromLeadId: l.fromLeadId, moved: false as const, reason: r?.reason || `${CRM_NAME[to]} didn't take it` };
    }
    const row = await CrmLeadMove.create({
      from, to, fromLeadId: l.fromLeadId, toLeadId: r.leadId, outcome: r.status, holder: r.holder ?? "",
      name: l.name, phone: l.phone, mode: input.mode, teamName: r.teamName ?? "", personName: r.personName ?? "",
      byName: input.byName, ownerName: l.ownerName ?? "", status: l.status ?? "",
    });
    return { fromLeadId: l.fromLeadId, moved: true as const, moveId: String(row._id), to, toLeadId: r.leadId, outcome: r.status, holder: r.holder ?? "" };
  }));
}

/**
 * Undo one move, asked by the CRM it left (within 24 hours): the other CRM gives it back first — it refuses a lead
 * that has been closed there — and only then is it the CRM it left's again.
 */
export async function undoMove(fromCode: string, moveId: string, byName: string) {
  const from = asking(fromCode);
  if (!Types.ObjectId.isValid(moveId)) throw fail("No such move", 404);
  const row = await CrmLeadMove.findById(moveId);
  if (!row || row.from !== from) throw fail("No such move", 404);
  if (row.undoneAt) throw fail("Already undone", 409);
  if (Date.now() - row.createdAt.getTime() > UNDO_MS) throw fail("A move can only be undone within 24 hours", 409);
  const to = row.to as MoveCrm;
  try {
    await postToCrm(to, "/lead-moves/take-back", { from, leadId: row.toLeadId, outcome: row.outcome, fromLeadId: row.fromLeadId });
  } catch (e) {
    const status = (e as { crmStatus?: number }).crmStatus;
    throw fail(`${CRM_NAME[to]} ${(e as Error).message}`, status === 409 ? 409 : 502);
  }
  row.undoneAt = new Date();
  row.undoneBy = byName;
  await row.save();
  return row.toObject();
}

/** Every move, newest first — Root's own page (part 3) and a CRM's look at what it sent and got. */
export async function listMoves(opts: { crm?: string; limit?: number } = {}): Promise<ICrmLeadMove[]> {
  const filter = opts.crm ? { $or: [{ from: opts.crm }, { to: opts.crm }] } : {};
  return CrmLeadMove.find(filter).sort({ createdAt: -1 }).limit(Math.min(Math.max(opts.limit ?? 100, 1), 500)).lean();
}

/* ── Root's own Lead moves page (2026-11-19) ──────────────────────────────── */
/*
 * A root admin (or someone with lead-traffic manage) finds a lead in any of the three CRMs by phone or name and moves
 * it to another — through the CRM it is in (its sheet door), so it is kept in that CRM's Moved leads with Undo, exactly
 * as when moved there. Undo from here asks that CRM to undo it.
 */

const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DONE = ["closed", "lost"];

export interface FoundLead {
  crm: MoveCrm; crmName: string; leadId: string; name: string; phone: string; status: string;
  ownerName: string; teamName: string; createdAt: string | null; movable: boolean;
}

/** Leads matching a phone (its last 9 digits) or a name, in each CRM; a CRM that can't be read is named. */
export async function findLeads(q: string): Promise<{ leads: FoundLead[]; unreadable: string[] }> {
  const query = String(q ?? "").trim();
  const digits = query.replace(/\D/g, "");
  let filter: Record<string, unknown>;
  // The digits with anything a phone is written with between them ("+971 50-123 4567"), at its end.
  if (digits.length >= 6) filter = { phone: { $regex: `${digits.slice(-9).split("").join("[\\s\\-.()]*")}\\s*$` } };
  else if (query.length >= 3) filter = { name: { $regex: escape(query), $options: "i" } };
  else throw fail("Type at least 6 digits of the phone, or 3 letters of the name", 400);
  const { sources, failures } = await getSources();
  const unreadable = failures.filter((f) => isCrm(f.code)).map((f) => CRM_NAME[f.code as MoveCrm]);
  const leads: FoundLead[] = [];
  await Promise.all(MOVE_CRMS.map(async (code) => {
    const src = sources.find((s) => s.org.code === code);
    if (!src) return;
    try {
      const found = await src.conn.collection("leads").find(filter, { projection: { name: 1, phone: 1, status: 1, assignedTo: 1, team: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(25).toArray();
      const ids = (k: "assignedTo" | "team") => [...new Set(found.map((l) => String(l[k] ?? "")).filter((i) => Types.ObjectId.isValid(i)))].map((i) => new Types.ObjectId(i));
      const users = new Map((await src.conn.collection("users").find({ _id: { $in: ids("assignedTo") } }, { projection: { name: 1 } }).toArray()).map((u) => [String(u._id), String(u.name ?? "")]));
      const teams = new Map((await src.conn.collection("teams").find({ _id: { $in: ids("team") } }, { projection: { name: 1 } }).toArray()).map((t) => [String(t._id), String(t.name ?? "")]));
      for (const l of found) leads.push({
        crm: code, crmName: CRM_NAME[code], leadId: String(l._id), name: String(l.name ?? ""), phone: String(l.phone ?? ""),
        status: String(l.status ?? ""), ownerName: users.get(String(l.assignedTo)) ?? "", teamName: teams.get(String(l.team)) ?? "",
        createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : null, movable: !DONE.includes(String(l.status ?? "")),
      });
    } catch {
      unreadable.push(CRM_NAME[code]);
    }
  }));
  leads.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { leads, unreadable };
}

/** Move leads out of the CRM they are in, from Root. The CRM answers what moved and what didn't (and why). */
export async function moveFromRoot(raw: { from?: unknown; leadIds?: unknown; to?: unknown; mode?: unknown; teamId?: unknown; userId?: unknown }, byName: string) {
  const from = String(raw.from ?? "");
  if (!isCrm(from)) throw fail("Pick the CRM the leads are in", 400);
  const leadIds = Array.isArray(raw.leadIds) ? raw.leadIds.map(String).filter((i) => Types.ObjectId.isValid(i)) : [];
  if (!leadIds.length) throw fail("Pick the leads to move", 400);
  if (leadIds.length > MAX_LEADS) throw fail(`At most ${MAX_LEADS} leads at a time`, 400);
  const to = String(raw.to ?? "");
  if (!isCrm(to) || to === from) throw fail("Pick another CRM to move them to", 400);
  const mode = String(raw.mode ?? "");
  if (!["person", "team", "split"].includes(mode)) throw fail("Pick who gets them", 400);
  try {
    return await postToCrm<{ moved: { leadId: string; name: string; moveId: string; holder: string; outcome: string }[]; refused: { leadId: string; name: string; reason: string }[] }>(
      from, "/lead-moves/send",
      { leadIds, to, mode, teamId: raw.teamId ? String(raw.teamId) : null, userId: raw.userId ? String(raw.userId) : null, byName },
      90_000,
    );
  } catch (e) {
    const status = (e as { crmStatus?: number }).crmStatus;
    throw fail(`${CRM_NAME[from]} ${(e as Error).message}`, status && status >= 400 && status < 500 && status !== 404 ? status : 502);
  }
}

/** Undo one move from Root: the CRM it left undoes it (the other CRM gives it back first). */
export async function undoFromRoot(moveId: string, byName: string) {
  if (!Types.ObjectId.isValid(moveId)) throw fail("No such move", 404);
  const row = await CrmLeadMove.findById(moveId).lean();
  if (!row) throw fail("No such move", 404);
  if (row.undoneAt) throw fail("Already undone", 409);
  if (Date.now() - row.createdAt.getTime() > UNDO_MS) throw fail("A move can only be undone within 24 hours", 409);
  const from = row.from as MoveCrm;
  try {
    await postToCrm(from, "/lead-moves/undo", { leadId: row.fromLeadId, byName }, 60_000);
  } catch (e) {
    const status = (e as { crmStatus?: number }).crmStatus;
    throw fail(`${CRM_NAME[from] ?? from} ${(e as Error).message}`, status && status >= 400 && status < 500 && status !== 404 ? status : 502);
  }
  return CrmLeadMove.findById(moveId).lean();
}

/** Every move, for the page: newest first, with whether Undo is still open. */
export async function movesView(limit = 200) {
  const rows = await listMoves({ limit });
  return rows.map((r) => ({
    ...r, id: String(r._id), fromName: CRM_NAME[r.from as MoveCrm] ?? r.from, toName: CRM_NAME[r.to as MoveCrm] ?? r.to,
    canUndo: !r.undoneAt && Date.now() - new Date(r.createdAt).getTime() <= UNDO_MS,
  }));
}
