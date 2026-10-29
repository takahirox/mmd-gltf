/** Wall-clock observations. Render submission is not isolated shader compilation;
 * asynchronous driver work can instead be charged to a later readback. */
export class PhaseTiming {
  readonly phases: Record<string, { count: number; totalMs: number; maximumMs: number }> = {};
  start(name: string) {
    const start = performance.now();
    return () => {
      const ms = performance.now() - start;
      const phase = this.phases[name] ??= { count: 0, totalMs: 0, maximumMs: 0 };
      phase.count++;
      phase.totalMs += ms;
      phase.maximumMs = Math.max(phase.maximumMs, ms);
    };
  }
  sync<T>(name: string, action: () => T): T {
    const end = this.start(name);
    try { return action(); } finally { end(); }
  }
  async async<T>(name: string, action: () => Promise<T>): Promise<T> {
    const end = this.start(name);
    try { return await action(); } finally { end(); }
  }
}
