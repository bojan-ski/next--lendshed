import Link from "next/link";
import { notFound } from "next/navigation";
import { ROLE_HEADING_ID } from "@/components/members/ids";
import MemberCard from "@/components/members/MemberCard";
import ResetLinkForm from "@/components/members/ResetLinkForm";
import RoleChangeButton from "@/components/members/RoleChangeButton";
import Avatar from "@/components/ui/Avatar";
import StatusLabel from "@/components/ui/StatusLabel";
import { getAdminMemberDetail } from "@/data/members";
import { requireOrganizer } from "@/lib/auth/guards";
import { communityToday, formatDate } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { memberStatus } from "@/lib/text/status";
import { members } from "@/strings/members";
import type { AdminMemberDetailDTO } from "@/types/members";

function RoleControl({ member }: { member: AdminMemberDetailDTO }) {
  if (member.status !== "active") {
    return <p className="text-sm text-muted">{members.roleNeedsActive}</p>;
  }
  if (member.role === "member") {
    return (
      <RoleChangeButton key="promote" memberId={member.id} change="promote" />
    );
  }
  if (member.isLastActiveOrganizer) {
    return <p className="text-sm text-muted">{members.lastOrganizer}</p>;
  }
  return <RoleChangeButton key="demote" memberId={member.id} change="demote" />;
}

// Guards itself: the admin layout doesn't re-run on a soft navigation.
// Suspended members are shown; only a missing row is not-found.
export default async function MemberDetailSection({
  params,
}: Pick<PageProps<"/admin/members/[id]">, "params">) {
  const viewer = await requireOrganizer();
  const { id } = await params;
  const member = await getAdminMemberDetail(viewer.id, id);
  if (!member) notFound();
  const today = communityToday();

  return (
    <>
      <header className="flex items-center gap-4">
        <Avatar
          initials={member.initials}
          aria-hidden
          className="size-12 text-lg"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold wrap-break-word">
            {member.displayName}
          </h1>
          {/* A list, so the facts aren't read as one run-on sentence. */}
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <li>{members.role[member.role]}</li>
            <li>
              <StatusLabel status={memberStatus[member.status]} />
            </li>
            <li>
              {t(members.memberSince, {
                date: formatDate(member.memberSince, today),
              })}
            </li>
            {member.area && <li>{member.area}</li>}
          </ul>
        </div>
      </header>

      {/* Spec 18 lists the member's open loans here. */}
      <MemberCard id="loans-heading" heading={members.loansHeading}>
        <p className="text-muted">{members.noOpenLoans}</p>
      </MemberCard>

      {member.isSelf ? (
        <p className="text-sm text-muted">
          {members.ownRecordBefore}
          <Link href="/account" className="text-accent underline">
            {members.ownRecordLink}
          </Link>
          {members.ownRecordAfter}
        </p>
      ) : (
        <>
          <MemberCard id={ROLE_HEADING_ID} heading={members.roleHeading}>
            <RoleControl member={member} />
          </MemberCard>
          <MemberCard id="reset-heading" heading={members.resetHeading}>
            <p className="text-sm text-muted">{members.resetBody}</p>
            <ResetLinkForm memberId={member.id} />
          </MemberCard>
        </>
      )}
    </>
  );
}
