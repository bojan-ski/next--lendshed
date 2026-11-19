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
    <div className="flex flex-col items-center gap-4.5 px-6 pt-10 pb-8 text-center sm:px-8">
      <span className="flex size-22 items-center justify-center rounded-full bg-hue-tint text-hue-deep [--hue:80]">
        <Icon name="link-broken" size={44} aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-4xl font-extrabold tracking-display"
        >
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
