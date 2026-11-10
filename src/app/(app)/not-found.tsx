import type { Metadata } from "next";
import NotFoundContent from "@/components/feedback/NotFoundContent";
import { errors } from "@/strings/errors";

export const metadata: Metadata = { title: errors.notFoundTitle };

export default function AppNotFound() {
  return <NotFoundContent />;
}
