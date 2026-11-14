import "server-only";
import { runDailyJob } from "@/data/daily-job";
import { isCronAuthorized } from "@/lib/cron/cron-auth";
import { env } from "@/lib/env/server";

// Called once a day by Vercel Cron. The bearer check is the whole
// authorization: a refusal reads no database, takes no date and logs nothing.
export async function GET(request: Request): Promise<Response> {
  if (
    !isCronAuthorized(request.headers.get("authorization"), env.CRON_SECRET)
  ) {
    return new Response(null, { status: 401 });
  }
  const result = await runDailyJob(new Date());
  const ok = result.failed.length === 0;
  if (ok)
    console.info("dailyJob: done", { today: result.today, ...result.counts });
  return Response.json({ ok, ...result }, { status: ok ? 200 : 500 });
}
