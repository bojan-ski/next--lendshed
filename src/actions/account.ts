"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { updateOwnContactDetails, updateOwnProfile } from "@/data/account";
import { requireViewer } from "@/lib/auth/guards";
import { forwardChangePassword } from "@/lib/auth/sign-in";
import {
  changePasswordSchema,
  contactDetailsSchema,
  profileSchema,
} from "@/lib/schemas/account";
import { account } from "@/strings/account";
import type {
  ChangePasswordState,
  ContactDetailsFormState,
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
  } catch {
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
    );
  } catch {
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
