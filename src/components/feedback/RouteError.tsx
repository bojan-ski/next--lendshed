import { useEffect, useRef } from "react";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { errors } from "@/strings/errors";

// Rendered only by the error boundaries (client files). The heading takes focus so
// the replaced content is announced and keyboard users start from it; the notice
// is no alert, or screen readers would read it twice.
export default function RouteError({ retry }: { retry: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <Notice tone="error" alert={false}>
      <div className="flex flex-col items-start gap-3">
        <h1 ref={heading} tabIndex={-1} className="font-bold">
          {errors.somethingWentWrong}
        </h1>
        <Button variant="outline" onClick={() => retry()}>
          {errors.tryAgain}
        </Button>
      </div>
    </Notice>
  );
}
