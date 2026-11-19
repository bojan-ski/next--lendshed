import type { Metadata } from "next";
import { Suspense } from "react";
import JoinForm from "@/components/auth/JoinForm";
import JoinFormSkeleton from "@/components/auth/JoinFormSkeleton";
import { AUTH_CARD } from "@/components/auth/auth-card-styles";
import Card from "@/components/ui/Card";
import { env } from "@/lib/env/server";
import { join } from "@/strings/join";

export const metadata: Metadata = {
  title: join.title,
  referrer: "no-referrer",
};

// No session and no database read on render: the token is checked on submit.
export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <Card className={AUTH_CARD}>
      <Suspense fallback={<JoinFormSkeleton />}>
        <JoinFormForToken params={params} />
      </Suspense>
    </Card>
  );
}

async function JoinFormForToken({
  params,
}: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  return <JoinForm token={token} community={env.COMMUNITY_NAME} />;
}
