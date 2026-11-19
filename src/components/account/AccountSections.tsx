import { signOut } from "@/actions/auth";
import AccountCard from "@/components/account/AccountCard";
import ChangePasswordForm from "@/components/account/ChangePasswordForm";
import ContactDetailsForm from "@/components/account/ContactDetailsForm";
import DeleteAccountButton from "@/components/account/DeleteAccountButton";
import ProfileForm from "@/components/account/ProfileForm";
import Button from "@/components/ui/Button";
import { getAccount } from "@/data/account";
import { requireViewer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { account } from "@/strings/account";
import type { AccountDTO } from "@/types/account";

const blockedText: Record<
  NonNullable<AccountDTO["deletion"]["reason"]>,
  string
> = {
  item_out: account.deleteBlockedItemOut,
  holding_item: account.deleteBlockedHolding,
  last_organizer: account.deleteBlockedLastOrganizer,
};

// Guards itself: the (app) layout doesn't re-run on a soft navigation.
export default async function AccountSections() {
  const viewer = await requireViewer();
  const details = await getAccount(viewer.id, requestToday());

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-7">
      <div className="flex min-w-0 flex-col gap-6">
        <AccountCard id="profile" heading={account.profileHeading}>
          <ProfileForm
            name={details.displayName}
            area={details.area}
            email={details.email}
          />
        </AccountCard>
        <AccountCard id="contact" heading={account.contactHeading}>
          <ContactDetailsForm
            contactDetails={details.contactDetails}
            locked={details.contactDetailsLocked}
          />
        </AccountCard>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <AccountCard id="password" heading={account.passwordHeading}>
          <ChangePasswordForm />
        </AccountCard>
        <AccountCard id="sign-out" heading={account.signOutHeading}>
          <form action={signOut}>
            <Button
              type="submit"
              variant="outline"
              className="w-full sm:w-auto"
            >
              {account.signOut}
            </Button>
          </form>
        </AccountCard>
        <AccountCard id="delete-account" heading={account.deleteHeading}>
          {details.deletion.reason ? (
            <p className="text-sm text-muted">
              {blockedText[details.deletion.reason]}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">{account.deleteBody}</p>
              <DeleteAccountButton isOrganizer={viewer.role === "organizer"} />
            </>
          )}
        </AccountCard>
      </div>
    </div>
  );
}
