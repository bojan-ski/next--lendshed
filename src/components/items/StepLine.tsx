import { cn } from "@/lib/text/cn";

// "Step N of 2: …" with a two-segment bar; the words carry the meaning.
export default function StepLine({
  step,
  text,
}: {
  step: 1 | 2;
  text: string;
}) {
  return (
    <p className="flex items-center gap-2.5 font-bold text-accent-ink">
      <span aria-hidden className="flex gap-1">
        <span className="h-1.5 w-7 rounded-full bg-accent" />
        <span
          className={cn(
            "h-1.5 w-7 rounded-full",
            step === 2 ? "bg-accent" : "bg-line",
          )}
        />
      </span>
      {text}
    </p>
  );
}
