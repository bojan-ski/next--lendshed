import { notFound } from "next/navigation";
import ItemGrid from "@/components/items/ItemGrid";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import { getMemberProfile } from "@/data/browse";
import { requireViewer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { initialsOf } from "@/lib/text/initials";
import { profile } from "@/strings/profile";

// Guards itself: soft navigations don't re-run the layout. A suspended,
// deleted or unknown member is not-found. Never email, contact, role or status.
export default async function MemberProfileSection({
  params,
}: Pick<PageProps<"/members/[id]">, "params">) {
  await requireViewer();
  const today = requestToday();
  const { id } = await params;
  const member = await getMemberProfile(id, today);
  if (!member) notFound();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex min-w-0 items-center gap-4">
        <Avatar
          initials={initialsOf(member.displayName)}
          aria-hidden
          className="size-12 text-lg"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-2xl font-bold">{member.displayName}</h1>
          {member.area && (
            <p className="truncate text-sm text-muted">{member.area}</p>
          )}
        </div>
      </header>
      <section aria-labelledby="listed-heading" className="flex flex-col gap-4">
        <h2 id="listed-heading" className="text-xl font-bold">
          {profile.listedHeading}
        </h2>
        {member.items.length === 0 ? (
          <EmptyState
            icon="box-open"
            heading={profile.emptyHeading}
            body={profile.emptyBody}
            headingLevel="h3"
          />
        ) : (
          <ItemGrid items={member.items} headingLevel="h3" />
        )}
      </section>
    </div>
  );
}
