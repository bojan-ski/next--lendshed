import type { ReactNode } from "react";
import { requireOrganizer } from "@/lib/auth/guards";

// The admin layout's guard, behind its Suspense boundary: a session read at a
// layout's top level holds the whole segment and blocks instant navigation.
// Members get not-found and never see the admin menu.
export default async function OrganizerGate({
  children,
}: {
  children: ReactNode;
}) {
  await requireOrganizer();
  return children;
}
