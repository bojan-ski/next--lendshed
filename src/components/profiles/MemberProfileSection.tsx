import { notFound } from "next/navigation";
import ItemGrid from "@/components/items/ItemGrid";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import { getMemberProfile } from "@/data/browse";
import { getCategories } from "@/data/categories";
import { requireViewer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { categoryHues, hueFor } from "@/lib/text/hue";
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
    <div className="flex flex-col gap-8">
      <header className="surface-accent flex min-w-0 items-center gap-4 rounded-band p-6 sm:gap-6 sm:px-12 sm:py-10">
        <Avatar
          initials={initialsOf(member.displayName)}
          hue={hueFor(member.id)}
          aria-hidden
          className="size-16 font-display text-2xl font-extrabold sm:size-24 sm:text-4xl"
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="truncate pb-1 type-page-title">
            {member.displayName}
          </h1>
          {member.area && (
            <p className="truncate type-subhead text-on-accent-highlight">
              {member.area}
            </p>
          )}
        </div>
      </header>
      <section
        aria-labelledby="listed-heading"
        className="flex flex-col gap-4.5"
      >
        <h2 id="listed-heading" className="type-section-title">
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
          <ItemGrid
            items={member.items}
            categoryHues={categoryHues(await getCategories())}
            headingLevel="h3"
          />
        )}
      </section>
    </div>
  );
}
