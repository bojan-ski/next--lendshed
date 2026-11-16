import type { Metadata } from "next";
import { Suspense } from "react";
import { MEMBERS_HEADING_ID } from "@/components/members/ids";
import MembersSection from "@/components/members/MembersSection";
import MembersTableSkeleton from "@/components/members/MembersTableSkeleton";
import { members } from "@/strings/members";

export const metadata: Metadata = { title: members.title };

// A member gets notFound() from the layout gate, which stops dev-time instant
// validation and logs a console error (spec 27, W-05).
export const instant = false;

export default function MembersPage({
  searchParams,
}: PageProps<"/admin/members">) {
  return (
    <div className="flex flex-col gap-6">
      <h1 id={MEMBERS_HEADING_ID} className="text-2xl font-bold">
        {members.title}
      </h1>
      <Suspense fallback={<MembersTableSkeleton />}>
        <MembersSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
