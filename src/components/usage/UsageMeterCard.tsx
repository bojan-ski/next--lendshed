import Card from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
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
}: UsageMeterCardProps) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 id={id} className="text-base font-bold">
        {title}
      </h2>
      <p className="text-lg">
        {t(usage.usedOf, { used: usedText, limit: limitText })}{" "}
        <span className="text-muted">{t(usage.percent, { percent })}</span>
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
        className="h-2 overflow-hidden rounded-full bg-line"
      >
        {/* A computed width, not a theme value: no utility can express it. */}
        <div
          className="h-full rounded-full bg-accent"
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
