import type { IconName } from "@/components/ui/icons";
import { invitations } from "@/strings/invitations";
import { members } from "@/strings/members";

// The organizer areas that exist; the landing and the left menu both list these.
export const ADMIN_AREAS: readonly {
  href: string;
  label: string;
  description: string;
  icon: IconName;
  activePrefixes?: readonly string[];
}[] = [
  {
    href: "/admin/invitations",
    label: invitations.title,
    description: invitations.description,
    icon: "mail",
  },
  {
    href: "/admin/members",
    label: members.title,
    description: members.description,
    icon: "users",
    activePrefixes: ["/admin/members"],
  },
];
