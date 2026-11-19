import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AUTH_BAND,
  AUTH_BODY,
  AUTH_CARD,
  AUTH_TITLE,
} from "@/components/auth/auth-card-styles";
import LoginForm from "@/components/auth/LoginForm";
import LoginFormSkeleton from "@/components/auth/LoginFormSkeleton";
import Card from "@/components/ui/Card";
import { env } from "@/lib/env/server";
import { t } from "@/lib/text/interpolate";
import { login } from "@/strings/login";

export const metadata: Metadata = { title: login.title };

// Reads no session and no database: only the form part waits for searchParams.
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Card className={AUTH_CARD}>
      <div className={AUTH_BAND}>
        <h1 className={AUTH_TITLE}>{login.title}</h1>
        <p className="type-subhead text-on-accent-highlight">
          {t(login.communityLine, { community: env.COMMUNITY_NAME })}
        </p>
      </div>
      <div className={AUTH_BODY}>
        <Suspense fallback={<LoginFormSkeleton />}>
          <LoginFormWithNext searchParams={searchParams} />
        </Suspense>
        <p className="text-sm text-muted">{login.forgotPassword}</p>
      </div>
    </Card>
  );
}

async function LoginFormWithNext({
  searchParams,
}: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} />;
}
