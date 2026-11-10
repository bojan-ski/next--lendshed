import type { Metadata } from "next";
import NotFoundContent from "@/components/feedback/NotFoundContent";
import Shell from "@/components/shell/Shell";
import SignedOutHeader from "@/components/shell/SignedOutHeader";
import { errors } from "@/strings/errors";

export const metadata: Metadata = { title: errors.notFoundTitle };

export default function NotFound() {
  return (
    <Shell header={<SignedOutHeader />}>
      <NotFoundContent />
    </Shell>
  );
}
