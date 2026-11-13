import type { ReactNode } from "react";
import { prerender } from "react-dom/static";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
};

// An async Server Component tree as HTML text, entities decoded and React's
// text separators dropped, so assertions can read strings-module values.
export async function html(tree: unknown): Promise<string> {
  const { prelude } = await prerender(tree as ReactNode);
  return (await new Response(prelude).text())
    .replace(/<!-- -->/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
}
