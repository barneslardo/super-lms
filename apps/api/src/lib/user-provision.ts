import type { User } from "@prisma/client";
import type { UserRole } from "@lms/shared";
import { prisma } from "./prisma.js";

export async function upsertUserFromIdentity(opts: {
  email: string;
  oktaId?: string | null;
  role: UserRole;
  firstName?: string;
  lastName?: string;
}) {
  const byEmail = await prisma.user.findUnique({ where: { email: opts.email } });
  const byOktaId = opts.oktaId
    ? await prisma.user.findUnique({ where: { oktaId: opts.oktaId } })
    : null;

  let user: User;
  const nameData = {
    firstName: opts.firstName ?? "",
    lastName: opts.lastName ?? "",
  };

  if (byOktaId && byEmail && byOktaId.id !== byEmail.id) {
    user = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: byEmail.id },
        data: {
          email: `archived-${byEmail.id}@lms.local`,
          active: false,
          oktaId: null,
        },
      });
      return tx.user.update({
        where: { id: byOktaId.id },
        data: {
          email: opts.email,
          role: opts.role,
          active: true,
          ...nameData,
        },
      });
    });
  } else if (byOktaId) {
    user = await prisma.user.update({
      where: { id: byOktaId.id },
      data: {
        email: opts.email,
        role: opts.role,
        active: true,
        ...(opts.firstName ? { firstName: opts.firstName } : {}),
        ...(opts.lastName ? { lastName: opts.lastName } : {}),
      },
    });
  } else if (byEmail) {
    user = await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        oktaId: opts.oktaId ?? byEmail.oktaId,
        role: opts.role,
        active: true,
        ...(opts.firstName ? { firstName: opts.firstName } : {}),
        ...(opts.lastName ? { lastName: opts.lastName } : {}),
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        email: opts.email,
        oktaId: opts.oktaId ?? null,
        role: opts.role,
        firstName: opts.firstName ?? "",
        lastName: opts.lastName ?? "",
      },
    });
  }

  return user;
}
