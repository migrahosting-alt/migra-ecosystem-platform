import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireSession, parseJson } from "../../../lib/api-helpers";
import { panelQuery, panelExec } from "../../../lib/db";
import { resolveStaffIdentity, STAFF_ROLES, type StaffRole } from "../../../lib/mail-identity";

/**
 * Super-Admin management of staff identities (mail_staff_user) — the people who
 * can be granted mailbox access. Console-owned; lives in the migrapanel DB.
 */

export const dynamic = "force-dynamic";

const requireSuperAdmin = async () => {
  const auth = await requireSession();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const identity = await resolveStaffIdentity(auth.session.email);
  if (!identity || identity.role !== "super_admin") {
    return { ok: false as const, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, identity };
};

const hashPassword = (plain: string): string => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
};

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  const rows = await panelQuery<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    department: string | null;
    status: string;
    created_at: string;
  }>(
    "SELECT id, email, name, role, department, status, created_at FROM mail_staff_user ORDER BY email",
  );
  return NextResponse.json({ staff: rows, roles: STAFF_ROLES });
}

type StaffBody = {
  email?: string;
  name?: string;
  role?: string;
  department?: string;
  password?: string;
  status?: string;
};

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const body = await parseJson<StaffBody>(req);
  if (!body?.email || !body.email.includes("@")) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase();
  const role: StaffRole = (STAFF_ROLES as string[]).includes(body.role || "")
    ? (body.role as StaffRole)
    : "readonly";
  const name = body.name?.trim() || null;
  const department = body.department?.trim() || null;
  const status = body.status === "suspended" ? "suspended" : "active";

  try {
    if (body.password) {
      const passwordHash = hashPassword(body.password);
      await panelExec(
        `INSERT INTO mail_staff_user (email, name, role, department, password_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name, role = EXCLUDED.role, department = EXCLUDED.department,
           password_hash = EXCLUDED.password_hash, status = EXCLUDED.status, updated_at = now()`,
        [email, name, role, department, passwordHash, status],
      );
    } else {
      // Update without touching the password.
      await panelExec(
        `INSERT INTO mail_staff_user (email, name, role, department, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name, role = EXCLUDED.role, department = EXCLUDED.department,
           status = EXCLUDED.status, updated_at = now()`,
        [email, name, role, department, status],
      );
    }
  } catch (err) {
    console.error("[console.mail] staff upsert failed", err);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, email });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  try {
    await panelExec("DELETE FROM mail_staff_user WHERE lower(email) = lower($1)", [email]);
  } catch (err) {
    console.error("[console.mail] staff delete failed", err);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
