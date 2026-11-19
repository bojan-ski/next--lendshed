import type { IconName } from "@/components/ui/icons";
import { categories } from "@/strings/categories";
import { invitations } from "@/strings/invitations";
import { members } from "@/strings/members";
import { usage } from "@/strings/usage";

// The organizer areas that exist; the landing and the left menu both list these.
export const ADMIN_AREAS: readonly {
  href: string;
  label: string;
  description: string;
  icon: IconName;
  // The landing card's icon tint (decorative).
  hue: number;
  activePrefixes?: readonly string[];
}[] = [
  {
    href: "/admin/invitations",
    label: invitations.title,
    description: invitations.description,
    icon: "mail",
    hue: 75,
  },
  {
    href: "/admin/members",
    label: members.title,
    description: members.description,
    icon: "users",
    hue: 155,
    activePrefixes: ["/admin/members"],
  },
  {
    href: "/admin/categories",
    label: categories.title,
    description: categories.description,
    icon: "tag",
    hue: 30,
    activePrefixes: ["/admin/categories"],
  },
  {
    href: "/admin/usage",
    label: usage.title,
    description: usage.description,
    icon: "gauge",
    hue: 230,
  },
];
