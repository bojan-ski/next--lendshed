import { countNeedsAction } from "@/data/my-loans";
import { getViewer } from "@/data/viewer";
import { requestToday } from "@/lib/dates/request-today";
import { t } from "@/lib/text/interpolate";
import { nav } from "@/strings/nav";

// The header's needs-action count, inside the My loans link: nothing for a
// guest or at zero. Computed per full render; soft navigations keep the last one.
// The bare space keeps the link's name "My loans 2 loans need you"; the flex
// link renders no box for it.
export default async function NeedsActionBadge() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const count = await countNeedsAction(viewer.id, requestToday());
  if (count === 0) return null;

  return (
    <>
      <span
        aria-hidden
        className="ml-2 inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-ink"
      >
        {count}
      </span>{" "}
      <span className="sr-only">
        {count === 1 ? nav.needsYouOne : t(nav.needsYouOther, { count })}
      </span>
    </>
  );
}
