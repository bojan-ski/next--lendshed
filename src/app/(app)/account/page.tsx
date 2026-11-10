import type { Metadata } from "next";
import { Suspense } from "react";
import AccountSections from "@/components/account/AccountSections";
import AccountSkeleton from "@/components/account/AccountSkeleton";
import { account } from "@/strings/account";

export const metadata: Metadata = { title: account.title };

export default function AccountPage() {
  return (
    <div className="flex max-w-160 flex-col gap-6">
      <h1 className="text-2xl font-bold">{account.title}</h1>
      <Suspense fallback={<AccountSkeleton />}>
        <AccountSections />
      </Suspense>
    </div>
  );
}
