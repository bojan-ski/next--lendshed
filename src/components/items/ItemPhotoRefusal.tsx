import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { photos } from "@/strings/photos";
import type { ItemPhotoState } from "@/types/photo";

// The notice body for a refused upload; the paused ones lead with a heading line.
export default function ItemPhotoRefusal({ state }: { state: ItemPhotoState }) {
  const { formError, reopensOnLabel = "" } = state;
  if (formError === "monthlyCap" || formError === "dailyCap") {
    return (
      <>
        <p className="font-bold">{photos.pausedHeading}</p>
        <p>{t(photos[formError], { date: reopensOnLabel })}</p>
      </>
    );
  }
  if (formError === "storageFull") {
    return (
      <>
        <p className="font-bold">{photos.pausedHeading}</p>
        <p>{photos.storageFull}</p>
      </>
    );
  }
  if (formError === "unreadable") return photos.unreadable;
  return formError === "stale" ? errors.stale : errors.actionFailed;
}
