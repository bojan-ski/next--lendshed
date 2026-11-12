"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  deleteOwnItem,
  hideOwnItem,
  insertItem,
  listOwnItem,
  retireItemByOwner,
  updateOwnItem,
} from "@/data/items";
import { requireViewer } from "@/lib/auth/guards";
import { communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import { reportUnexpected } from "@/lib/feedback/report";
import {
  itemDetailsSchema,
  itemIdSchema,
  updateItemSchema,
} from "@/lib/schemas/items";
import { items } from "@/strings/items";
import type {
  DeleteItemState,
  ItemDetailsField,
  ItemDetailsFormState,
  ItemVisibilityState,
  RetireItemState,
} from "@/types/item";

const DETAIL_FIELDS = [
  "title",
  "description",
  "categoryId",
  "condition",
  "maxLoanDays",
  "pickupNotes",
] as const satisfies readonly ItemDetailsField[];

// The raw text of the six fields: React resets the form after every submit.
function echoDetails(formData: FormData): Record<ItemDetailsField, string> {
  const values = {} as Record<ItemDetailsField, string>;
  for (const field of DETAIL_FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === "string" ? value : "";
  }
  return values;
}

// Only the six field keys: never `id`, which is reported as stale instead.
function detailErrors(
  fieldErrors: Partial<Record<string, string[]>>,
): ItemDetailsFormState["fieldErrors"] {
  return Object.fromEntries(
    DETAIL_FIELDS.flatMap((field) =>
      fieldErrors[field] ? [[field, fieldErrors[field]]] : [],
    ),
  );
}

const categoryMissing = (values: Record<ItemDetailsField, string>) => ({
  fieldErrors: { categoryId: [items.categoryMissing] },
  values,
});

export async function createItem(
  _prev: ItemDetailsFormState,
  formData: FormData,
): Promise<ItemDetailsFormState> {
  const viewer = await requireViewer();
  const values = echoDetails(formData);

  const parsed = itemDetailsSchema.safeParse(values);
  if (!parsed.success) {
    return {
      fieldErrors: detailErrors(z.flattenError(parsed.error).fieldErrors),
      values,
    };
  }

  let outcome: Awaited<ReturnType<typeof insertItem>>;
  try {
    outcome = await insertItem(viewer.id, parsed.data);
  } catch (error) {
    reportUnexpected("createItem", error);
    return { formError: "unexpected", values };
  }
  if (outcome.kind === "capReached") return { formError: "capReached", values };
  if (outcome.kind === "categoryMissing") return categoryMissing(values);

  await setFlash("itemSaved");
  redirect(`/my/items/${outcome.id}/edit`);
}

// A bad id is a stale screen, reported before any field error.
export async function updateItem(
  _prev: ItemDetailsFormState,
  formData: FormData,
): Promise<ItemDetailsFormState> {
  const viewer = await requireViewer();
  const values = echoDetails(formData);

  const id = itemIdSchema.safeParse({ id: formData.get("id") });
  if (!id.success) return { formError: "stale" };
  const parsed = updateItemSchema.safeParse({ ...values, id: id.data.id });
  if (!parsed.success) {
    return {
      fieldErrors: detailErrors(z.flattenError(parsed.error).fieldErrors),
      values,
    };
  }

  let result: Awaited<ReturnType<typeof updateOwnItem>>;
  try {
    result = await updateOwnItem(viewer.id, parsed.data.id, parsed.data);
  } catch (error) {
    reportUnexpected("updateItem", error);
    return { formError: "unexpected", values };
  }
  if (result === "stale") return { formError: "stale" };
  if (result === "categoryMissing") return categoryMissing(values);

  refresh();
  return { flash: "itemSaved" };
}

export async function listItem(
  _prev: ItemVisibilityState,
  formData: FormData,
): Promise<ItemVisibilityState> {
  const viewer = await requireViewer();

  const parsed = itemIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };

  let result: Awaited<ReturnType<typeof listOwnItem>>;
  try {
    result = await listOwnItem(viewer.id, parsed.data.id);
  } catch (error) {
    reportUnexpected("listItem", error);
    return { formError: "unexpected" };
  }
  if (result !== "listed") return { formError: result };

  refresh();
  return { flash: "itemListed" };
}

export async function hideItem(
  _prev: ItemVisibilityState,
  formData: FormData,
): Promise<ItemVisibilityState> {
  const viewer = await requireViewer();

  const parsed = itemIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };

  let result: Awaited<ReturnType<typeof hideOwnItem>>;
  try {
    result = await hideOwnItem(viewer.id, parsed.data.id, communityToday());
  } catch (error) {
    reportUnexpected("hideItem", error);
    return { formError: "unexpected" };
  }
  if (result === "stale") return { formError: "stale" };

  refresh();
  return { flash: "itemHidden" };
}

export async function retireOwnItem(
  _prev: RetireItemState,
  formData: FormData,
): Promise<RetireItemState> {
  const viewer = await requireViewer();

  const parsed = itemIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };

  let result: Awaited<ReturnType<typeof retireItemByOwner>>;
  try {
    result = await retireItemByOwner(
      viewer.id,
      parsed.data.id,
      communityToday(),
    );
  } catch (error) {
    reportUnexpected("retireOwnItem", error);
    return { formError: "unexpected" };
  }
  if (result !== "retired") return { formError: result };

  refresh();
  return { flash: "itemRetired" };
}

export async function deleteItem(
  _prev: DeleteItemState,
  formData: FormData,
): Promise<DeleteItemState> {
  const viewer = await requireViewer();

  const parsed = itemIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };

  let result: Awaited<ReturnType<typeof deleteOwnItem>>;
  try {
    result = await deleteOwnItem(viewer.id, parsed.data.id);
  } catch (error) {
    reportUnexpected("deleteItem", error);
    return { formError: "unexpected" };
  }
  if (result !== "deleted") return { formError: result };

  await setFlash("itemDeleted");
  redirect("/my/items");
}
