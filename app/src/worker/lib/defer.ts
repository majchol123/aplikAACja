import type { Context } from 'hono';

/** Runs `task` after the response is sent; a failure is logged, never thrown. */
export function defer(c: Context): (task: Promise<unknown>) => void {
  return (task) => {
    const guarded = task.catch((err: unknown) =>
      console.error(JSON.stringify({ msg: 'deferred task failed', err: String(err) })),
    );
    try {
      c.executionCtx.waitUntil(guarded);
    } catch {
      // No ExecutionContext (unit tests calling app.request without one).
    }
  };
}
