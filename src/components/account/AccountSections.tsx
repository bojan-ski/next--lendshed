import { signOut } from "@/actions/auth";
import AccountCard from "@/components/account/AccountCard";
import ChangePasswordForm from "@/components/account/ChangePasswordForm";
import ContactDetailsForm from "@/components/account/ContactDetailsForm";
import ProfileForm from "@/components/account/ProfileForm";
import Button from "@/components/ui/Button";
import { getAccount } from "@/data/account";
import { requireViewer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { account } from "@/strings/account";

// Guards itself: the (app) layout doesn't re-run on a soft navigation.
export default async function AccountSections() {
  const viewer = await requireViewer();
  const details = await getAccount(viewer.id, requestToday());

  return (
    <>
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
      <AccountCard id="password" heading={account.passwordHeading}>
        <ChangePasswordForm />
      </AccountCard>
      <AccountCard id="sign-out" heading={account.signOutHeading}>
        <form action={signOut}>
          <Button type="submit" variant="outline" className="w-full sm:w-auto">
            {account.signOut}
          </Button>
        </form>
      </AccountCard>
    </>
  );
}
