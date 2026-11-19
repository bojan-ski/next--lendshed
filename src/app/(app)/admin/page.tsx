import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_AREAS } from "@/components/admin/admin-areas";
import { Icon } from "@/components/ui/icons";
import { hueStyle } from "@/lib/text/hue";
import { admin } from "@/strings/admin";

export const metadata: Metadata = { title: admin.title };

// A member gets notFound() from the layout gate, which stops dev-time instant
// validation and logs a console error (spec 27, W-05).
export const instant = false;

// Static links only: no organizer data, so the layout's guard is enough here.
export default function AdminPage() {
  return (
    <div className="flex flex-col gap-7">
      <h1 className="type-page-title">{admin.title}</h1>
      <ul className="grid gap-4 lg:grid-cols-2">
        {ADMIN_AREAS.map((area) => (
          <li key={area.href}>
            <Link
              href={area.href}
              className="flex h-full min-h-11 items-center gap-4.5 rounded-card bg-card p-5 sm:p-6"
            >
              <span
                style={hueStyle(area.hue)}
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-hue-tint text-hue-deep"
              >
                <Icon name={area.icon} size={26} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="type-subhead font-bold">{area.label}</span>
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
