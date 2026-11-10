import { useEffect, useId, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import TextInput from "@/components/ui/TextInput";
import { t } from "@/lib/text/interpolate";
import { oneTimeLink } from "@/strings/oneTimeLink";
import type { CreatedLinkDTO } from "@/types/links";

const COPIED_MS = 2000;

type CopyStatus = "idle" | "copied" | "failed";

// Rendered only inside client islands (it uses hooks). Key it by the URL so a
// new link remounts it and takes focus again. Inside a card that has its own
// h2, pass headingLevel 3.
export default function OneTimeLinkPanel({
  link,
  headingLevel = 2,
}: {
  link: CreatedLinkDTO;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const [status, setStatus] = useState<CopyStatus>("idle");
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const warningId = useId();
  const statusId = useId();

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // The clipboard needs a secure context and may refuse: then select the text
  // so it can be copied by hand.
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("No clipboard");
      await navigator.clipboard.writeText(link.url);
      setStatus("copied");
    } catch {
      setStatus("failed");
      field.current?.focus();
      field.current?.select();
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card bg-accent-soft p-4">
      <Heading ref={heading} tabIndex={-1} className="text-lg font-bold">
        {link.note
          ? t(oneTimeLink.headingFor, { note: link.note })
          : oneTimeLink.heading}
      </Heading>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="font-bold">
          {oneTimeLink.fieldLabel}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            ref={field}
            id={fieldId}
            readOnly
            value={link.url}
            // Focus lands here on a failed copy: the field itself says why.
            aria-describedby={
              status === "failed" ? `${statusId} ${warningId}` : warningId
            }
            // flex-1 only in the row: in the stacked column it would override h-12.
            className="min-w-0 sm:flex-1"
          />
          <Button variant="outline" onClick={copy} className="shrink-0">
            <Icon name={status === "copied" ? "check" : "copy"} aria-hidden />
            {status === "copied" ? oneTimeLink.copied : oneTimeLink.copy}
          </Button>
        </div>
      </div>
      <p
        id={statusId}
        role="status"
        className={status === "failed" ? "text-sm" : "sr-only"}
      >
        {status === "copied" && oneTimeLink.copiedAnnouncement}
        {status === "failed" && oneTimeLink.copyFailed}
      </p>
      <p id={warningId} className="text-sm">
        {oneTimeLink.warning}
      </p>
    </section>
  );
}
