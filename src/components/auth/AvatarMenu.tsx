import { signOut } from "@/actions/auth";
import Avatar from "@/components/ui/Avatar";
import Card from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { t } from "@/lib/text/interpolate";
import { avatarMenu } from "@/strings/avatarMenu";
import type { ViewerDTO } from "@/types/viewer";

type AvatarMenuProps = {
  viewer: Pick<ViewerDTO, "displayName" | "initials">;
};

// A native disclosure: no client island, works before hydration.
export default function AvatarMenu({ viewer }: AvatarMenuProps) {
  return (
    <details className="group relative">
      <summary
        aria-label={t(avatarMenu.label, { name: viewer.displayName })}
        className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-control [&::-webkit-details-marker]:hidden"
      >
        <Avatar initials={viewer.initials} aria-hidden />
        <Icon
          name="chevron-down"
          aria-hidden
          className="text-ink group-open:rotate-180"
        />
      </summary>
      <Card className="absolute top-full right-0 z-10 mt-2 w-48 p-1">
        {/* A plain link: the full load closes this disclosure, which a soft
            navigation would leave open over the next page. */}
        <a
          href="/account"
          className="flex h-11 w-full items-center rounded-control px-3 text-ink"
        >
          {avatarMenu.account}
        </a>
        <form action={signOut}>
          <button
            type="submit"
            className="flex h-11 w-full items-center rounded-control px-3 text-left text-ink"
          >
            {avatarMenu.signOut}
          </button>
        </form>
      </Card>
    </details>
  );
}
