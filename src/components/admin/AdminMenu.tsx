import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ADMIN_AREAS } from "@/components/admin/admin-areas";
import NavLink from "@/components/shell/NavLink";
import { navLinkClasses } from "@/components/shell/nav-styles";
import { Icon, type IconName } from "@/components/ui/icons";
import { admin } from "@/strings/admin";

function Label({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <Icon name={icon} aria-hidden />
      {children}
    </span>
  );
}

// From 768 px only; below that the /admin landing is the way into each area.
export default function AdminMenu() {
  return (
    <nav aria-label={admin.menuLabel} className="hidden md:block">
      <ul className="-mx-2 flex flex-col gap-1">
        {ADMIN_AREAS.map((area) => (
          <li key={area.href}>
            {/* usePathname suspends on routes with unknown dynamic params. */}
            <Suspense
              fallback={
                <Link href={area.href} className={navLinkClasses(false)}>
                  <Label icon={area.icon}>{area.label}</Label>
                </Link>
              }
            >
              <NavLink href={area.href}>
                <Label icon={area.icon}>{area.label}</Label>
              </NavLink>
            </Suspense>
          </li>
        ))}
      </ul>
    </nav>
  );
}
