import MemberHeader from "@/components/shell/MemberHeader";
import Shell from "@/components/shell/Shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell header={<MemberHeader />}>{children}</Shell>;
}
