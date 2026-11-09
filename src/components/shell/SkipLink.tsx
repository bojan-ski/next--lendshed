import { app } from "@/strings/app";

export default function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-control border border-field bg-card px-4 py-3 font-bold text-accent focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:z-50"
    >
      {app.skipLink}
    </a>
  );
}
