import Notice from "@/components/ui/Notice";
import { Icon } from "@/components/ui/icons";
import UsageMeterCard from "@/components/usage/UsageMeterCard";
import { getUsage } from "@/data/photos";
import { requireOrganizer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { USAGE_WARN_PERCENT, VERCEL_USAGE_URL } from "@/lib/photos/caps";
import { t } from "@/lib/text/interpolate";
import { formatCount, formatMegabytes } from "@/lib/text/numbers";
import { usage } from "@/strings/usage";

const megabytes = (bytes: number) =>
  t(usage.megabytes, { amount: formatMegabytes(bytes) });

// Guards itself: the admin layout doesn't re-run on a soft navigation.
export default async function UsageSection() {
  await requireOrganizer();
  const { monthLabel, uploads, storedBytes, listedItems } =
    await getUsage(requestToday());
  const capWarning = t(usage.capWarning, { percent: USAGE_WARN_PERCENT });
  return (
    <div className="flex flex-col gap-4">
      <p>
        <span className="font-bold">{monthLabel}</span>{" "}
        <span className="text-muted">{usage.monthLine}</span>
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <UsageMeterCard
          id="usage-uploads"
          title={usage.uploadsTitle}
          usedText={formatCount(uploads.used)}
          limitText={formatCount(uploads.cap)}
          percent={uploads.percent}
          used={uploads.used}
          max={uploads.cap}
          warn={uploads.warn}
          warnText={capWarning}
          fill="primary"
        />
        <UsageMeterCard
          id="usage-storage"
          title={usage.storageTitle}
          usedText={megabytes(storedBytes.used)}
          limitText={megabytes(storedBytes.cap)}
          percent={storedBytes.percent}
          used={storedBytes.used}
          max={storedBytes.cap}
          warn={storedBytes.warn}
          warnText={capWarning}
          fill="accent"
        />
        <UsageMeterCard
          id="usage-listed"
          title={usage.listedTitle}
          usedText={formatCount(listedItems.used)}
          limitText={formatCount(listedItems.warnAt)}
          percent={listedItems.percent}
          used={listedItems.used}
          max={listedItems.warnAt}
          warn={listedItems.warn}
          warnText={t(usage.listedWarning, {
            limit: formatCount(listedItems.warnAt),
          })}
          fill="sky"
        />
      </div>
      <Notice tone="info" className="p-6">
        <p>{usage.note}</p>
        <a
          href={VERCEL_USAGE_URL}
          className="inline-flex min-h-11 items-center gap-1 font-bold text-accent-ink underline underline-offset-4"
        >
          {usage.link}
          <Icon name="external-link" aria-hidden className="shrink-0" />
        </a>
      </Notice>
    </div>
  );
}
