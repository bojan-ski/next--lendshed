import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "@/components/auth/LoginForm";
import LoginFormSkeleton from "@/components/auth/LoginFormSkeleton";
import Card from "@/components/ui/Card";
import { env } from "@/lib/env";
import { t } from "@/lib/interpolate";
import { login } from "@/strings/login";

export const metadata: Metadata = { title: login.title };

// Reads no session and no database: only the form part waits for searchParams.
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Card className="mx-auto flex max-w-104 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{login.title}</h1>
        <p className="text-muted">
          {t(login.communityLine, { community: env.COMMUNITY_NAME })}
        </p>
      </div>
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginFormWithNext searchParams={searchParams} />
      </Suspense>
      <p className="text-sm text-muted">{login.forgotPassword}</p>
    </Card>
  );
}

async function LoginFormWithNext({
  searchParams,
}: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} />;
}
