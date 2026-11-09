import type { Metadata } from "next";
import EmptyState from "@/components/ui/EmptyState";
import { env } from "@/lib/env";
import { home } from "@/strings/home";

export const metadata: Metadata = { title: home.title };

export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold">{env.COMMUNITY_NAME}</h1>
        <p className="text-muted">{home.subheading}</p>
      </div>
      <EmptyState
        icon="toolbox"
        heading={home.emptyHeading}
        body={home.emptyBody}
      />
    </div>
  );
}
