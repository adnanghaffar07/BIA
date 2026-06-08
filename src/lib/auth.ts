import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import sql from './neon';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'bia-crm-secret-change-in-production-2026'
);
const SESSION_DURATION_DAYS = 7;

export type UserRole = 'superadmin' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

// ─── Password ─────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── JWT Session ──────────────────────────────────────────────────────────────

export async function createSessionToken(user: AuthUser): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

  const token = await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_DAYS}d`)
    .sign(JWT_SECRET);

  // Persist session to DB for revocation support
  await sql`
    INSERT INTO "Session" ("id", "userId", "token", "expiresAt")
    VALUES (${crypto.randomUUID()}, ${user.id}, ${token}, ${expiresAt.toISOString()})
  `;

  return token;
}

export async function verifySessionToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    // Check session is still in DB (not revoked)
    const sessions = await sql`
      SELECT s."id", u."id" AS "userId", u."email", u."name", u."role", u."isActive"
      FROM "Session" s
      JOIN "User" u ON u."id" = s."userId"
      WHERE s."token" = ${token}
        AND s."expiresAt" > NOW()
        AND u."isActive" = true
    `;

    if (sessions.length === 0) return null;

    const row = sessions[0] as any;
    return {
      id: payload.sub as string,
      email: row.email,
      name: row.name,
      role: row.role as UserRole,
      isActive: row.isActive,
    };
  } catch {
    return null;
  }
}

export async function revokeSession(token: string): Promise<void> {
  await sql`DELETE FROM "Session" WHERE "token" = ${token}`;
}

// ─── User management ──────────────────────────────────────────────────────────

export async function getUserByEmail(email: string): Promise<any | null> {
  const rows = await sql`
    SELECT "id", "email", "passwordHash", "name", "role", "isActive"
    FROM "User"
    WHERE "email" = ${email.toLowerCase().trim()}
  `;
  return rows[0] ?? null;
}

export async function getAllUsers(): Promise<any[]> {
  return sql`
    SELECT "id", "email", "name", "role", "isActive", "createdAt", "createdBy"
    FROM "User"
    ORDER BY "createdAt" DESC
  `;
}

export async function createUser(data: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  createdBy: string;
}): Promise<AuthUser> {
  const passwordHash = await hashPassword(data.password);
  const id = crypto.randomUUID();

  await sql`
    INSERT INTO "User" ("id", "email", "passwordHash", "name", "role", "createdBy")
    VALUES (
      ${id},
      ${data.email.toLowerCase().trim()},
      ${passwordHash},
      ${data.name},
      ${data.role},
      ${data.createdBy}
    )
  `;

  return { id, email: data.email, name: data.name, role: data.role, isActive: true };
}

export async function updateUserStatus(userId: string, isActive: boolean): Promise<void> {
  await sql`
    UPDATE "User"
    SET "isActive" = ${isActive}, "updatedAt" = NOW()
    WHERE "id" = ${userId}
  `;
  if (!isActive) {
    // Revoke all sessions for deactivated users
    await sql`DELETE FROM "Session" WHERE "userId" = ${userId}`;
  }
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await sql`
    UPDATE "User"
    SET "passwordHash" = ${passwordHash}, "updatedAt" = NOW()
    WHERE "id" = ${userId}
  `;
}
