"use client";

import RouteError from "@/components/feedback/RouteError";

export default function AppError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return <RouteError retry={retry} />;
}
