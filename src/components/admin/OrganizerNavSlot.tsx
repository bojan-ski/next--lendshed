import Link from "next/link";
import { Suspense } from "react";
import NavLink from "@/components/shell/NavLink";
import { navLinkClasses } from "@/components/shell/nav-styles";
import { getViewer } from "@/data/viewer";
import { nav } from "@/strings/nav";

// The header's Organizer entry: a whole <li>, or nothing for members and guests.
export default async function OrganizerNavSlot() {
  const viewer = await getViewer();
  if (viewer?.role !== "organizer") return null;

  return (
    <li>
      {/* usePathname suspends on routes with unknown dynamic params. */}
      <Suspense
        fallback={
          <Link href="/admin" className={navLinkClasses(false)}>
            {nav.organizer}
          </Link>
        }
      >
        <NavLink href="/admin" activePrefixes={["/admin"]}>
          {nav.organizer}
        </NavLink>
      </Suspense>
    </li>
  );
}
