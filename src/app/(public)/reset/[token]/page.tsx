import type { Metadata } from "next";
import { Suspense } from "react";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import ResetPasswordFormSkeleton from "@/components/auth/ResetPasswordFormSkeleton";
import Card from "@/components/ui/Card";
import { resetPassword } from "@/strings/resetPassword";

export const metadata: Metadata = {
  title: resetPassword.title,
  referrer: "no-referrer",
};

// No session and no database read on render: the token is checked on submit.
export default function ResetPage({ params }: PageProps<"/reset/[token]">) {
  return (
    <Card className="mx-auto max-w-104 p-6">
      <Suspense fallback={<ResetPasswordFormSkeleton />}>
        <ResetPasswordFormForToken params={params} />
      </Suspense>
    </Card>
  );
}

async function ResetPasswordFormForToken({
  params,
}: Pick<PageProps<"/reset/[token]">, "params">) {
  const { token } = await params;
  return <ResetPasswordForm token={token} />;
}
