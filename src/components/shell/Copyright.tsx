import { connection } from "next/server";
import { requestToday } from "@/lib/dates/request-today";
import { publicEnv } from "@/lib/env/public";
import { t } from "@/lib/text/interpolate";
import { footer } from "@/strings/footer";

export default async function Copyright() {
  await connection();
  return (
    <p className="text-sm text-muted">
      {t(footer.copyright, {
        year: requestToday().slice(0, 4),
        appName: publicEnv.NEXT_PUBLIC_APP_NAME,
      })}
    </p>
  );
}
