import NotFoundContent from "@/components/feedback/NotFoundContent";
import Shell from "@/components/shell/Shell";
import SignedOutHeader from "@/components/shell/SignedOutHeader";

export default function NotFound() {
  return (
    <Shell header={<SignedOutHeader />}>
      <NotFoundContent />
    </Shell>
  );
}
