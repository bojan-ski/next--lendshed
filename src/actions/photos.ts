"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { deletePendingBlobs } from "@/data/blob-deletions";
import {
  attachItemPhoto,
  getUploadCounts,
  isOwnUploadTarget,
  reservePhotoUpload,
} from "@/data/photos";
import { requireViewer } from "@/lib/auth/guards";
import {
  addDays,
  communityMidnight,
  communityToday,
  firstOfMonth,
  firstOfNextMonth,
  formatDate,
} from "@/lib/dates/dates";
import { reportUnexpected } from "@/lib/feedback/report";
import { uploadCapRefusal } from "@/lib/photos/caps";
import { encodeItemPhoto } from "@/lib/photos/encode";
import { itemPhotoSchema } from "@/lib/schemas/photos";
import { newPhotoKey } from "@/lib/storage/keys";
import { getPhotoStorage } from "@/lib/storage/storage";
import type { ItemPhotoState } from "@/types/photo";

// The first refusal wins: parse → target → caps → decode → reserve → store →
// attach. No step holds a transaction across sharp or the storage call.
export async function uploadItemPhoto(
  _prev: ItemPhotoState,
  formData: FormData,
): Promise<ItemPhotoState> {
  const viewer = await requireViewer();

  const parsed = itemPhotoSchema.safeParse({
    id: formData.get("id"),
    photo: formData.get("photo"),
  });
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    if (fieldErrors.id) return { formError: "stale" };
    return { fieldErrors: { photo: fieldErrors.photo } };
  }
  const { id, photo } = parsed.data;
  const today = communityToday();

  try {
    if (!(await isOwnUploadTarget(viewer.id, id)))
      return { formError: "stale" };

    // The incoming file isn't counted: its stored size is unknown until encoded.
    const refusal = uploadCapRefusal(
      await getUploadCounts(viewer.id, {
        monthStart: communityMidnight(firstOfMonth(today)),
        dayStart: communityMidnight(today),
      }),
    );
    if (refusal === "storageFull") return { formError: refusal };
    if (refusal) {
      const reopensOn =
        refusal === "monthlyCap" ? firstOfNextMonth(today) : addDays(today, 1);
      return {
        formError: refusal,
        reopensOnLabel: formatDate(reopensOn, today),
      };
    }

    const encoded = await encodeItemPhoto(
      new Uint8Array(await photo.arrayBuffer()),
    );
    if (encoded.kind === "unreadable") return { formError: "unreadable" };

    const key = newPhotoKey();
    const bytes = encoded.bytes.byteLength;
    await reservePhotoUpload(viewer.id, key, bytes);

    let url: string;
    try {
      ({ url } = await getPhotoStorage().put(key, encoded.bytes, "image/webp"));
    } catch (error) {
      reportUnexpected("uploadItemPhoto", error);
      // The log row stays and counts towards the caps.
      await deletePendingBlobs([key]);
      return { formError: "unexpected" };
    }

    const result = await attachItemPhoto(viewer.id, id, {
      key,
      url,
      width: encoded.width,
      height: encoded.height,
      bytes,
    });
    if (result === "stale") return { formError: "stale" };
  } catch (error) {
    reportUnexpected("uploadItemPhoto", error);
    return { formError: "unexpected" };
  }

  refresh();
  return { flash: "photoSaved" };
}
