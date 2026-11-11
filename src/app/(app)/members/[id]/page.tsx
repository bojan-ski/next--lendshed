import type { Metadata } from "next";
import { Suspense } from "react";
import MemberProfileSection from "@/components/profiles/MemberProfileSection";
import MemberProfileSkeleton from "@/components/profiles/MemberProfileSkeleton";
import { profile } from "@/strings/profile";

export const metadata: Metadata = { title: profile.title };

export default function MemberProfilePage({
  params,
}: PageProps<"/members/[id]">) {
  return (
    <Suspense fallback={<MemberProfileSkeleton />}>
      <MemberProfileSection params={params} />
    </Suspense>
  );
}
