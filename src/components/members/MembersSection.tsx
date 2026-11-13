import MemberSearchForm from "@/components/members/MemberSearchForm";
import MembersTable from "@/components/members/MembersTable";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import { getAdminMembers } from "@/data/members";
import { requireOrganizer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { memberSearchSchema } from "@/lib/schemas/members";
import { t } from "@/lib/text/interpolate";
import { members } from "@/strings/members";

function countLine(count: number, q: string): string {
  if (q) {
    return t(count === 1 ? members.matchesOne : members.matchesOther, {
      count,
      q,
    });
  }
  return t(count === 1 ? members.countOne : members.countOther, { count });
}

// Guards itself: the admin layout doesn't re-run on a soft navigation, and a
// search is one.
export default async function MembersSection({
  searchParams,
}: Pick<PageProps<"/admin/members">, "searchParams">) {
  await requireOrganizer();
  const today = requestToday();
  const { q } = memberSearchSchema.parse(await searchParams);
  const rows = await getAdminMembers(q, today);

  return (
    <div className="flex flex-col gap-4">
      <MemberSearchForm q={q} />
      {/* The search doesn't move focus, so its outcome is announced (WCAG
          4.1.3): one short line, always present, never the whole card. */}
      <p role="status" className="text-sm text-muted">
        {countLine(rows.length, q)}
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon="search"
          heading={t(members.emptyHeading, { q })}
          body={members.emptyBody}
          action={
            <ButtonLink href="/admin/members" variant="outline">
              {members.showEveryone}
            </ButtonLink>
          }
        />
      ) : (
        <MembersTable rows={rows} />
      )}
    </div>
  );
}
