"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ChangeEvent,
} from "react";
import { uploadItemPhoto } from "@/actions/photos";
import ItemPhotoPreview from "@/components/items/ItemPhotoPreview";
import ItemPhotoRefusal from "@/components/items/ItemPhotoRefusal";
import { buttonClasses } from "@/components/ui/button-styles";
import Notice from "@/components/ui/Notice";
import { showToast } from "@/lib/feedback/toast";
import { preparePhotoForUpload } from "@/lib/photos/prepare";
import { cn } from "@/lib/text/cn";
import { t } from "@/lib/text/interpolate";
import { photos } from "@/strings/photos";
import type { PhotoDTO } from "@/types/item";
import type { ItemPhotoState } from "@/types/photo";

type ItemPhotoFormProps = {
  itemId: string;
  title: string;
  photo: PhotoDTO | null;
};

const initialState: ItemPhotoState = {};
const INPUT_ID = "item-photo-input";
const ERROR_ID = "item-photo-error";

async function uploadAndAnnounce(
  prev: ItemPhotoState,
  formData: FormData,
): Promise<ItemPhotoState> {
  const next = await uploadItemPhoto(prev, formData);
  if (next.flash) showToast(next.flash);
  return next;
}

// True only once hydrated: before that the control can't prepare a photo.
const noSubscription = () => () => {};

// Picks, prepares and saves in one go: no Save button and no progress bar (a
// plain action upload has no progress events), status lines only.
export default function ItemPhotoForm({
  itemId,
  title,
  photo,
}: ItemPhotoFormProps) {
  const [state, dispatch, saving] = useActionState(
    uploadAndAnnounce,
    initialState,
  );
  const [, startTransition] = useTransition();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [preparing, setPreparing] = useState(false);
  const [clientFailed, setClientFailed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const busy = preparing || saving;
  const fieldError = busy ? undefined : state.fieldErrors?.photo?.[0];
  const formError = busy || clientFailed ? undefined : state.formError;
  const alt = t(photos.previewAlt, { title });

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // The disabled control dropped focus while working: move it to the outcome,
  // or back to the control after a save.
  useEffect(() => {
    if (state.formError) notice.current?.focus();
    else if (state.fieldErrors?.photo || state.flash) input.current?.focus();
  }, [state]);

  useEffect(() => {
    if (clientFailed) notice.current?.focus();
  }, [clientFailed]);

  async function prepareAndSave(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setClientFailed(false);
    setPreparing(true);
    const prepared = await preparePhotoForUpload(file);
    setPreparing(false);
    if (prepared.kind === "failed") {
      setClientFailed(true);
      return;
    }
    setPreviewUrl(URL.createObjectURL(prepared.blob));
    const formData = new FormData();
    formData.set("id", itemId);
    formData.set(
      "photo",
      new File([prepared.blob], "photo.jpg", { type: "image/jpeg" }),
    );
    startTransition(() => dispatch(formData));
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <ItemPhotoPreview
        photo={photo}
        pendingUrl={saving ? previewUrl : null}
        alt={alt}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="text-sm text-muted">{photos.guidance}</p>
        {(clientFailed || formError) && (
          <div ref={notice} tabIndex={-1}>
            <Notice tone="error" alert={false}>
              {clientFailed ? (
                photos.clientFailed
              ) : (
                <ItemPhotoRefusal state={state} />
              )}
            </Notice>
          </div>
        )}
        <label
          htmlFor={INPUT_ID}
          className={buttonClasses(
            photo ? "outline" : "primary",
            cn(
              "w-full cursor-pointer sm:w-auto sm:self-start",
              "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
              "has-disabled:cursor-not-allowed has-disabled:opacity-60",
            ),
          )}
        >
          <input
            ref={input}
            id={INPUT_ID}
            type="file"
            accept="image/*"
            disabled={!hydrated || busy}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? ERROR_ID : undefined}
            onChange={prepareAndSave}
            className="sr-only"
          />
          {photo ? photos.chooseAnother : photos.choose}
        </label>
        {fieldError && (
          <p id={ERROR_ID} className="text-base">
            {fieldError}
          </p>
        )}
        {!hydrated && (
          <p className="text-sm text-muted">{photos.needsJavaScript}</p>
        )}
        <p role="status" className="text-sm text-muted">
          {preparing ? photos.preparing : saving ? photos.saving : null}
        </p>
      </div>
    </div>
  );
}
