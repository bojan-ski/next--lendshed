import Shell from "@/components/shell/Shell";
import SignedOutHeader from "@/components/shell/SignedOutHeader";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Shell header={<SignedOutHeader />}>{children}</Shell>;
}
