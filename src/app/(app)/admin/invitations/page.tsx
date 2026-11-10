import type { Metadata } from "next";
import { Suspense } from "react";
import { OPEN_INVITATIONS_HEADING_ID } from "@/components/invitations/ids";
import InvitationsSection from "@/components/invitations/InvitationsSection";
import InvitationsTableSkeleton from "@/components/invitations/InvitationsTableSkeleton";
import NewInvitationForm from "@/components/invitations/NewInvitationForm";
import { invitations } from "@/strings/invitations";

export const metadata: Metadata = { title: invitations.title };

export default function InvitationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{invitations.title}</h1>
      <NewInvitationForm />
      <section
        aria-labelledby={OPEN_INVITATIONS_HEADING_ID}
        className="flex flex-col gap-4"
      >
        <h2
          id={OPEN_INVITATIONS_HEADING_ID}
          tabIndex={-1}
          className="text-xl font-bold"
        >
          {invitations.openHeading}
        </h2>
        <Suspense fallback={<InvitationsTableSkeleton />}>
          <InvitationsSection />
        </Suspense>
      </section>
    </div>
  );
}
