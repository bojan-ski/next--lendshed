import type { Ref } from "react";
import ButtonLink from "@/components/ui/ButtonLink";
import { Icon } from "@/components/ui/icons";
import { linkBroken } from "@/strings/linkBroken";

// One look for every unusable token link: unknown, used, revoked, expired or
// malformed. Renders no card of its own; the caller's card stays.
export default function LinkBroken({
  headingRef,
}: {
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <Icon name="link-broken" size={48} aria-hidden className="text-muted" />
      <div className="flex flex-col gap-1">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
          {linkBroken.heading}
        </h1>
        <p className="text-muted">{linkBroken.body}</p>
      </div>
      <ButtonLink href="/login" className="w-full">
        {linkBroken.action}
      </ButtonLink>
    </div>
  );
}
