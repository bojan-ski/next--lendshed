import { Suspense } from "react";
import OrganizerNavSlot from "@/components/admin/OrganizerNavSlot";
import AvatarMenuSkeleton from "@/components/auth/AvatarMenuSkeleton";
import AvatarMenuSlot from "@/components/auth/AvatarMenuSlot";
import ContentSkeleton from "@/components/auth/ContentSkeleton";
import ViewerGate from "@/components/auth/ViewerGate";
import NeedsActionBadge from "@/components/loans/NeedsActionBadge";
import MemberHeader from "@/components/shell/MemberHeader";
import Shell from "@/components/shell/Shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell
      header={
        <MemberHeader
          avatar={
            <Suspense fallback={<AvatarMenuSkeleton />}>
              <AvatarMenuSlot />
            </Suspense>
          }
          myLoansBadge={
            <Suspense fallback={null}>
              <NeedsActionBadge />
            </Suspense>
          }
          organizerEntry={
            <Suspense fallback={null}>
              <OrganizerNavSlot />
            </Suspense>
          }
        />
      }
    >
      <Suspense fallback={<ContentSkeleton />}>
        <ViewerGate>{children}</ViewerGate>
      </Suspense>
    </Shell>
  );
}
