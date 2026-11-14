"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { updateOwnContactDetails, updateOwnProfile } from "@/data/account";
import { deleteOwnUser } from "@/data/members";
import { auth } from "@/lib/auth/auth";
import { requireViewer } from "@/lib/auth/guards";
import { copySetCookies, forwardChangePassword } from "@/lib/auth/sign-in";
import { communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import { reportUnexpected } from "@/lib/feedback/report";
import {
  changePasswordSchema,
  confirmDeleteSchema,
  contactDetailsSchema,
  profileSchema,
} from "@/lib/schemas/account";
import { account } from "@/strings/account";
import type {
  ChangePasswordState,
  ContactDetailsFormState,
  DeleteAccountOutcome,
  DeleteAccountState,
  ProfileFormState,
} from "@/types/account";

function text(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function updateProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const viewer = await requireViewer();
  const echo = {
    name: text(formData.get("name")),
    area: text(formData.get("area")),
  };

  const parsed = profileSchema.safeParse(echo);
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      fieldErrors: { name: fieldErrors.name, area: fieldErrors.area },
      ...echo,
    };
  }

  try {
    await updateOwnProfile(viewer.id, parsed.data);
  } catch (error) {
    reportUnexpected("updateProfile", error);
    return { formError: "unexpected", ...echo };
  }

  refresh();
  return { flash: "profileSaved" };
}

export async function updateContactDetails(
  _prev: ContactDetailsFormState,
  formData: FormData,
): Promise<ContactDetailsFormState> {
  const viewer = await requireViewer();
  const echo = { contactDetails: text(formData.get("contactDetails")) };

  const parsed = contactDetailsSchema.safeParse(echo);
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      fieldErrors: { contactDetails: fieldErrors.contactDetails },
      ...echo,
    };
  }

  let result: Awaited<ReturnType<typeof updateOwnContactDetails>>;
  try {
    result = await updateOwnContactDetails(
      viewer.id,
      parsed.data.contactDetails,
      communityToday(),
    );
  } catch (error) {
    reportUnexpected("updateContactDetails", error);
    return { formError: "unexpected", ...echo };
  }
  // A refused clear shows the saved details again, so nothing is echoed.
  if (result === "locked") return { formError: "contactDetailsLocked" };

  refresh();
  return { flash: "contactDetailsSaved" };
}

// Passwords are never echoed. No refresh(): the library's new session cookie
// already re-renders the page.
export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  await requireViewer();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      fieldErrors: {
        currentPassword: fieldErrors.currentPassword,
        newPassword: fieldErrors.newPassword,
      },
    };
  }

  const { currentPassword, newPassword } = parsed.data;
  const failure = await forwardChangePassword(currentPassword, newPassword);
  if (failure === "invalidCurrentPassword") {
    return { fieldErrors: { currentPassword: [account.currentPasswordWrong] } };
  }
  if (failure) return { formError: failure };
  return { flash: "passwordChanged" };
}

// A refusal stays in place without refresh(): the page was out of date, and
// its notice replaces the control until a reload.
export async function deleteOwnAccount(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const viewer = await requireViewer();
  const parsed = confirmDeleteSchema.safeParse({
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { formError: "stale" };

  let outcome: DeleteAccountOutcome;
  try {
    outcome = await deleteOwnUser(viewer.id, communityToday());
  } catch (error) {
    reportUnexpected("deleteOwnAccount", error);
    return { formError: "unexpected" };
  }
  if (outcome !== "deleted") return { formError: outcome };

  // The session row is gone with the user; this clears this browser's cookie.
  // A failure here still redirects: the cookie no longer resolves.
  try {
    const { headers: responseHeaders } = await auth.api.signOut({
      headers: await headers(),
      returnHeaders: true,
    });
    await copySetCookies(responseHeaders);
  } catch (error) {
    reportUnexpected("deleteOwnAccount", error);
  }
  await setFlash("accountDeleted");
  redirect("/login");
}
