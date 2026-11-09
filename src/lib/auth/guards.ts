import "server-only";
import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/data/viewer";
import type { ViewerDTO } from "@/types/viewer";

export async function requireViewer(): Promise<ViewerDTO> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

// Members get the not-found page: they never learn the area exists.
export async function requireOrganizer(): Promise<ViewerDTO> {
  const viewer = await requireViewer();
  if (viewer.role !== "organizer") notFound();
  return viewer;
}
