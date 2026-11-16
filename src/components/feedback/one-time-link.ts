import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CreatedLinkDTO } from "@/types/links";

// Cache Components keeps a left page in a hidden <Activity> with its state,
// so a created link would show again on return. The layout cleanup runs when
// the page is hidden; the ref arms it only once a link exists, so StrictMode's
// mount-time cleanup never dismisses a fresh one.
export function useShownUntilHidden(
  link: CreatedLinkDTO | undefined,
): CreatedLinkDTO | undefined {
  const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);
  const armed = useRef<string | null>(null);

  useEffect(() => {
    armed.current = link?.url ?? null;
  }, [link]);

  useLayoutEffect(
    () => () => {
      if (armed.current) setDismissedUrl(armed.current);
    },
    [],
  );

  return link && link.url !== dismissedUrl ? link : undefined;
}
