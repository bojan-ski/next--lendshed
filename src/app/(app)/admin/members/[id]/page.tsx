import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import MemberDetailSection from "@/components/members/MemberDetailSection";
import MemberDetailSkeleton from "@/components/members/MemberDetailSkeleton";
import { Icon } from "@/components/ui/icons";
import { backLinkClasses } from "@/components/ui/link-styles";
import { app } from "@/strings/app";
import { members } from "@/strings/members";

export const metadata: Metadata = { title: members.detailTitle };

// A member gets notFound() from the layout gate, which stops dev-time instant
// validation and logs a console error (spec 27, W-05).
export const instant = false;

export default function MemberPage({
  params,
}: PageProps<"/admin/members/[id]">) {
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admin/members"
        aria-label={members.backLabel}
        className={backLinkClasses}
      >
        <Icon name="arrow-left" aria-hidden />
        {app.back}
      </Link>
      <Suspense fallback={<MemberDetailSkeleton />}>
        <MemberDetailSection params={params} />
      </Suspense>
    </div>
  );
}
