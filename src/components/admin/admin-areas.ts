import type { IconName } from "@/components/ui/icons";
import { invitations } from "@/strings/invitations";

// The organizer areas that exist; the landing and the left menu both list these.
export const ADMIN_AREAS: readonly {
  href: string;
  label: string;
  description: string;
  icon: IconName;
}[] = [
  {
    href: "/admin/invitations",
    label: invitations.title,
    description: invitations.description,
    icon: "mail",
  },
];
