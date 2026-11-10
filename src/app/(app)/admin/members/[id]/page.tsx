import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import MemberDetailSection from "@/components/members/MemberDetailSection";
import MemberDetailSkeleton from "@/components/members/MemberDetailSkeleton";
import { Icon } from "@/components/ui/icons";
import { members } from "@/strings/members";

export const metadata: Metadata = { title: members.detailTitle };

export default function MemberPage({
  params,
}: PageProps<"/admin/members/[id]">) {
  return (
    <div className="flex max-w-160 flex-col gap-6">
      <Link
        href="/admin/members"
        aria-label={members.backLabel}
        className="inline-flex min-h-11 items-center gap-2 self-start font-bold text-accent"
      >
        <Icon name="arrow-left" aria-hidden />
        {members.back}
      </Link>
      <Suspense fallback={<MemberDetailSkeleton />}>
        <MemberDetailSection params={params} />
      </Suspense>
    </div>
  );
}
