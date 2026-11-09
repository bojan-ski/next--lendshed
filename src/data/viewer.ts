import "server-only";
import { headers } from "next/headers";
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
    needsActionCount: 0,
  };
}

// One session read per request; never cached across requests.
export const getViewer = cache(async (): Promise<ViewerDTO | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status === "suspended") return null;
  return toViewerDTO(session.user);
});
