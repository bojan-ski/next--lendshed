import { z } from "zod";
import { PHOTO_UPLOAD_MAX_BYTES } from "@/lib/photos/limits";
import { photos } from "@/strings/photos";

// An `id` issue is a stale screen, never a field error. The type check is UX:
// the action's decode is the real one.
export const itemPhotoSchema = z.object({
  id: z.string().min(1),
  photo: z
    .file({ error: photos.photoRequired })
    .min(1, { error: photos.photoRequired, abort: true })
    .max(PHOTO_UPLOAD_MAX_BYTES, { error: photos.photoTooLarge, abort: true })
    .refine((file) => file.type.startsWith("image/"), {
      error: photos.photoNotImage,
    }),
});
