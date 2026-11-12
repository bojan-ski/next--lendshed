import "server-only";

const MESSAGE_LIMIT = 200;

// The operator's trace of an action's `unexpected` result: the error's name,
// code, first message line (capped) and stack frames only. Prisma's later
// message lines echo the query's arguments, so they never reach the log, and a
// thrown non-Error is logged by type alone.
export function reportUnexpected(action: string, error: unknown): void {
  if (!(error instanceof Error)) {
    console.error(`${action}: unexpected`, { name: typeof error });
    return;
  }
  const { name, message, stack = "" } = error;
  const code = "code" in error ? String(error.code) : undefined;
  // Frames come after the whole (possibly multi-line) message in the stack.
  const at = stack.indexOf(message);
  const frames = at === -1 ? "" : stack.slice(at + message.length);
  console.error(`${action}: unexpected`, {
    name,
    code,
    message: message.split("\n")[0].slice(0, MESSAGE_LIMIT),
    frames: frames
      .split("\n")
      .filter((line) => line.trimStart().startsWith("at ")),
  });
}
