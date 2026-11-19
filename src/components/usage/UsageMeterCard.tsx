import Card from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/text/cn";
import { t } from "@/lib/text/interpolate";
import { usage } from "@/strings/usage";

type UsageMeterCardProps = {
  id: string;
  title: string;
  usedText: string;
  limitText: string;
  percent: number;
  used: number;
  max: number;
  warn: boolean;
  warnText: string;
  fill: "primary" | "accent" | "sky";
};

const FILL = {
  primary: "bg-primary",
  accent: "bg-accent",
  sky: "bg-hue-strong [--hue:230]",
};

export default function UsageMeterCard({
  id,
  title,
  usedText,
  limitText,
  percent,
  used,
  max,
  warn,
  warnText,
  fill,
}: UsageMeterCardProps) {
  return (
    <Card className="flex flex-col gap-3.5 p-6 sm:px-6.5 sm:pt-6.5 sm:pb-7">
      <h2 id={id} className="text-base font-bold">
        {title}
      </h2>
      <p className="font-display text-4xl font-extrabold">
        {t(usage.usedOf, { used: usedText, limit: limitText })}{" "}
        <span className="block font-sans text-md font-normal text-muted">
          {t(usage.percent, { percent })}
        </span>
      </p>
      <div
        role="meter"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(used, max)}
        aria-valuetext={t(usage.valueText, {
          used: usedText,
          limit: limitText,
          percent,
        })}
        className="h-3 overflow-hidden rounded-full bg-neutral-soft"
      >
        {/* A computed width, not a theme value: no utility can express it. */}
        <div
          className={cn("h-full rounded-full", FILL[fill])}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {warn && (
        <p className="flex items-start gap-2 text-sm font-bold text-ink">
          <Icon name="alert" aria-hidden className="shrink-0" />
          {warnText}
        </p>
      )}
    </Card>
  );
}
