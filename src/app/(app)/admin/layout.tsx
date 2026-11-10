import AdminMenu from "@/components/admin/AdminMenu";
import { requireOrganizer } from "@/lib/auth/guards";

// Guards the first render only: layouts don't re-render on navigation, so
// every admin page and data section calls requireOrganizer() itself too.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOrganizer();
  return (
    <div className="md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8">
      <AdminMenu />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
