import { Suspense } from "react";
import AvatarMenuSkeleton from "@/components/auth/AvatarMenuSkeleton";
import AvatarMenuSlot from "@/components/auth/AvatarMenuSlot";
import ContentSkeleton from "@/components/auth/ContentSkeleton";
import ViewerGate from "@/components/auth/ViewerGate";
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
        />
      }
    >
      <Suspense fallback={<ContentSkeleton />}>
        <ViewerGate>{children}</ViewerGate>
      </Suspense>
    </Shell>
  );
}
