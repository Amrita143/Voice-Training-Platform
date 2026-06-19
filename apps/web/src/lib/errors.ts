// Map Firebase callable / auth errors to a friendly message.
export function humanizeError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const code = err?.code || "";
  if (code.includes("unauthenticated")) return "Invalid userid or password.";
  if (code.includes("resource-exhausted"))
    return "Too many failed attempts. Please try again later.";
  if (code.includes("permission-denied"))
    return err.message || "You don't have permission to do that.";
  if (code.includes("invalid-argument"))
    return err.message || "Please check the form and try again.";
  if (code.includes("already-exists"))
    return err.message || "That already exists.";
  return err?.message || "Something went wrong. Please try again.";
}
