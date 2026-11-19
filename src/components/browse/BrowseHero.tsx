import type { ReactNode } from "react";
import { env } from "@/lib/env/server";
import { home } from "@/strings/home";

// The green band: the community's name, and the search beside it from 1024 px.
// Rendered by BrowseSection and by its skeleton, so the heading never waits.
export default function BrowseHero({ search }: { search: ReactNode }) {
  return (
    <div className="surface-accent grid gap-8 rounded-band px-6 py-9 sm:px-10 sm:py-11 lg:grid-cols-2 lg:items-end lg:gap-12 lg:px-14 lg:py-13">
      <div className="flex min-w-0 flex-col gap-2.5">
        <h1 className="type-hero">{env.COMMUNITY_NAME}</h1>
        <p className="type-subhead text-on-accent-highlight lg:text-3xl">
          {home.subheading}
        </p>
      </div>
      {search}
    </div>
  );
}
