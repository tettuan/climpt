/**
 * Countdown timer with safe-stop message.
 *
 * Writes a countdown to stderr so the operator can see a clear
 * break-point between agent cycles and safely Ctrl+C.
 */

const encoder = new TextEncoder();

/**
 * Display a countdown timer on stderr with a safe-stop message.
 * Overwrites the same line each second, then clears when done.
 *
 * @param delayMs Total delay in milliseconds. Countdown rounds up to whole seconds.
 * @param label Context label shown in the message (e.g. "Next cycle", "Next issue").
 */
export async function countdownDelay(
  delayMs: number,
  label = "Next cycle",
): Promise<void> {
  if (delayMs <= 0) return;

  const totalSeconds = Math.ceil(delayMs / 1000);

  for (let remaining = totalSeconds; remaining > 0; remaining--) {
    const msg =
      `\r--- You can safely stop here (Ctrl+C). ${label} in ${remaining}s ---`;
    Deno.stderr.writeSync(encoder.encode(msg));
    // deno-lint-ignore no-await-in-loop
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }

  // Clear the countdown line
  const clearLine = `\r${" ".repeat(80)}\r`;
  Deno.stderr.writeSync(encoder.encode(clearLine));
}
