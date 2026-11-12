import "server-only";
import { cache } from "react";
import { communityToday } from "@/lib/dates/dates";

// One community date per request, so the header badge and the page's section
// never count on different days across midnight. Call it only after a
// request-time read (the session), like communityToday() itself.
export const requestToday = cache((): string => communityToday());
