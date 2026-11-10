import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_AREAS } from "@/components/admin/admin-areas";
import { Icon } from "@/components/ui/icons";
import { admin } from "@/strings/admin";

export const metadata: Metadata = { title: admin.title };

// Static links only: no organizer data, so the layout's guard is enough here.
export default function AdminPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{admin.title}</h1>
      <ul className="flex flex-col gap-3">
        {ADMIN_AREAS.map((area) => (
          <li key={area.href}>
            <Link
              href={area.href}
              className="flex min-h-11 items-center gap-4 rounded-card border border-line bg-card p-4"
            >
              <Icon name={area.icon} aria-hidden className="shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-bold">{area.label}</span>
                <span className="text-sm text-muted">{area.description}</span>
              </span>
              <Icon
                name="chevron-right"
                aria-hidden
                className="shrink-0 text-muted"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
