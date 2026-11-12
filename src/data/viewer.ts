import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { auth } from "@/lib/auth/auth";
import { initialsOf } from "@/lib/text/initials";
import type { ViewerDTO } from "@/types/viewer";

type SessionUser = { id: string; name: string; role: ViewerDTO["role"] };

function toViewerDTO(user: SessionUser): ViewerDTO {
  return {
    id: user.id,
    displayName: user.name,
    initials: initialsOf(user.name),
    role: user.role,
  };
}

// After an action writes cookies, Next re-renders with the new ones in
// cookies() but the old Cookie header in headers(): a rotated session (a
// password change) must be read from cookies().
async function sessionHeaders(): Promise<Headers> {
  const forwarded = new Headers(await headers());
  const cookieHeader = (await cookies())
    .getAll()
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
  if (cookieHeader) forwarded.set("cookie", cookieHeader);
  else forwarded.delete("cookie");
  return forwarded;
}

// One session read per request; never cached across requests.
export const getViewer = cache(async (): Promise<ViewerDTO | null> => {
  const session = await auth.api.getSession({
    headers: await sessionHeaders(),
  });
  if (!session || session.user.status === "suspended") return null;
  return toViewerDTO(session.user);
});
