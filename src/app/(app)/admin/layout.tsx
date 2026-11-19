import { Suspense } from "react";
import AdminMenu from "@/components/admin/AdminMenu";
import OrganizerGate from "@/components/admin/OrganizerGate";
import ContentSkeleton from "@/components/auth/ContentSkeleton";

// Guards the first render only: layouts don't re-render on navigation, so
// every admin page and data section calls requireOrganizer() itself too. The
// menu sits inside the gate, so a member never receives it.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <OrganizerGate>
        <div className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:items-start md:gap-10">
          <AdminMenu />
          <div className="min-w-0">{children}</div>
        </div>
      </OrganizerGate>
    </Suspense>
  );
}
