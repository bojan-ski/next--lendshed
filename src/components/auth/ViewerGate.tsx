import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getViewer } from "@/data/viewer";
import { PATH_HEADER, safeNextPath } from "@/lib/auth/safe-next";

// A stale or forged cookie, or a suspended member, gets /login; guests never
// receive page content.
export default async function ViewerGate({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await getViewer();
  if (!viewer) {
    const path = (await headers()).get(PATH_HEADER);
    redirect(`/login?next=${encodeURIComponent(safeNextPath(path))}`);
  }
  return children;
}
