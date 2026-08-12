import { formatDisplayName, resolvePersonaLabel, type AuthUser } from "@lms/shared";
import { prisma } from "./prisma.js";

export type SessionUser = Omit<AuthUser, "displayName" | "persona"> & {
  displayName?: string;
  persona?: string;
};

export async function enrichAuthUser(user: SessionUser): Promise<AuthUser> {
  const groups = user.groups ?? [];
  const persona = user.persona ?? resolvePersonaLabel(user.email, groups);

  let displayName = user.displayName;
  if (!displayName) {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { firstName: true, lastName: true },
    });
    displayName = formatDisplayName({
      email: user.email,
      firstName: dbUser?.firstName,
      lastName: dbUser?.lastName,
    });
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    oktaId: user.oktaId,
    displayName,
    groups,
    persona,
  };
}

export function sessionUserFromIdentity(opts: {
  id: string;
  email: string;
  role: AuthUser["role"];
  oktaId: string | null;
  name?: string;
  firstName?: string;
  lastName?: string;
  groups?: string[];
}): AuthUser {
  const groups = opts.groups ?? [];
  return {
    id: opts.id,
    email: opts.email,
    role: opts.role,
    oktaId: opts.oktaId,
    displayName: formatDisplayName({
      email: opts.email,
      name: opts.name,
      firstName: opts.firstName,
      lastName: opts.lastName,
    }),
    groups,
    persona: resolvePersonaLabel(opts.email, groups),
  };
}
