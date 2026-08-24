import bcrypt from "bcryptjs";
import { getSources } from "./crmConnections.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import type { OrgCode, RepJwtPayload } from "../types/index.js";

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

/**
 * Sign a sales rep in against their own CRM's user record.
 *
 * Reps have no portal account — they live in the three CRM databases — so the
 * portal verifies the password they already use rather than minting a second
 * credential for them to forget.
 *
 * Read-only by construction: this reads the stored hash and compares in
 * process. It never writes to a CRM, and a failure here can never lock a rep
 * out of the CRM itself.
 */
export const repLogin = async (email: string, password: string, orgCode?: string) => {
  const { sources } = await getSources();
  const candidates = orgCode ? sources.filter((s) => s.org.code === orgCode) : sources;

  if (!candidates.length) {
    throw httpError("Unknown organisation", 404);
  }

  const matches: { org: (typeof sources)[number]["org"]; user: Record<string, unknown> }[] = [];

  for (const src of candidates) {
    const user = await src.conn
      .collection("users")
      .findOne(
        { email: email.toLowerCase().trim() },
        { projection: { name: 1, email: 1, password: 1, status: 1, role: 1 } }
      );
    if (user?.password) matches.push({ org: src.org, user });
  }

  // Same message whatever went wrong. Distinguishing "no such rep" from "wrong
  // password" would turn this endpoint into a directory of who works here.
  const invalid = () => httpError("Invalid email or password", 401);

  if (!matches.length) {
    // Still spend the time a real comparison would, so a missing account is
    // not detectable by how fast the answer comes back.
    await bcrypt.compare(password, "$2a$12$" + "x".repeat(53));
    throw invalid();
  }

  const verified: typeof matches = [];
  for (const m of matches) {
    if (await bcrypt.compare(password, String(m.user.password))) verified.push(m);
  }

  if (!verified.length) throw invalid();

  // One real person exists in two CRMs today, so this is reachable: make them
  // choose rather than guessing which desk they meant.
  if (verified.length > 1 && !orgCode) {
    throw Object.assign(
      new Error("This account exists in more than one organisation. Choose one to continue."),
      {
        statusCode: 409,
        orgs: verified.map((m) => ({ code: m.org.code, name: m.org.name })),
      }
    );
  }

  const { org, user } = verified[0];

  if (user.status === "inactive") {
    throw httpError("Your account has been deactivated", 403);
  }

  const payload: RepJwtPayload = {
    kind: "rep",
    repId: String(user._id),
    orgCode: org.code as OrgCode,
    email: String(user.email),
    name: String(user.name ?? ""),
  };

  return {
    accessToken: signAccessToken(payload as never),
    refreshToken: signRefreshToken(payload as never),
    rep: {
      repId: payload.repId,
      name: payload.name,
      email: payload.email,
      org: { code: org.code, name: org.name, timezone: org.timezone, currency: org.currency },
    },
  };
};

/** Re-checks the rep still exists and is active, not just that the token parses. */
export const repFromToken = async (payload: RepJwtPayload) => {
  const { sources } = await getSources();
  const src = sources.find((s) => s.org.code === payload.orgCode);
  if (!src) throw httpError("Organisation unavailable", 503);

  const { ObjectId } = await import("mongodb");
  let oid;
  try {
    oid = new ObjectId(payload.repId);
  } catch {
    throw httpError("Invalid session", 401);
  }

  const user = await src.conn
    .collection("users")
    .findOne({ _id: oid }, { projection: { name: 1, email: 1, status: 1 } });

  if (!user) throw httpError("Your account no longer exists", 401);
  if (user.status === "inactive") throw httpError("Your account has been deactivated", 403);

  return {
    repId: String(user._id),
    name: String(user.name ?? ""),
    email: String(user.email ?? ""),
    org: {
      code: src.org.code,
      name: src.org.name,
      timezone: src.org.timezone,
      currency: src.org.currency,
    },
  };
};

export const repRefresh = async (token: string) => {
  const decoded = verifyRefreshToken(token) as unknown as RepJwtPayload;
  if (decoded.kind !== "rep") throw httpError("Invalid refresh token", 401);

  const rep = await repFromToken(decoded);
  const payload: RepJwtPayload = {
    kind: "rep",
    repId: rep.repId,
    orgCode: rep.org.code as OrgCode,
    email: rep.email,
    name: rep.name,
  };
  return {
    accessToken: signAccessToken(payload as never),
    refreshToken: signRefreshToken(payload as never),
  };
};
