import InvitationsTable from "@/components/invitations/InvitationsTable";
import EmptyState from "@/components/ui/EmptyState";
import { getOpenInvitations } from "@/data/invitations";
import { requireOrganizer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { invitations } from "@/strings/invitations";

// Guards itself: the admin layout doesn't re-run on a soft navigation.
export default async function InvitationsSection() {
  await requireOrganizer();
  const rows = await getOpenInvitations();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="mail"
        heading={invitations.emptyHeading}
        body={invitations.emptyBody}
      />
    );
  }
  return <InvitationsTable rows={rows} today={requestToday()} />;
}
