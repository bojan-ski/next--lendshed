import type { Metadata } from "next";
import { Suspense } from "react";
import AccountSections from "@/components/account/AccountSections";
import AccountSkeleton from "@/components/account/AccountSkeleton";
import { account } from "@/strings/account";

export const metadata: Metadata = { title: account.title };

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-7">
      <h1 className="type-page-title">{account.title}</h1>
      <Suspense fallback={<AccountSkeleton />}>
        <AccountSections />
      </Suspense>
    </div>
  );
}
