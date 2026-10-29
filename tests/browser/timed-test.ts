import { test as base, expect } from '@playwright/test';
import { PhaseTiming } from '../phase-timing';
export { expect };
const matrix = process.env.BROWSER_CONFORMANCE_MATRIX ?? 'representative';
if (matrix !== 'full' && matrix !== 'representative') throw new Error(`Unknown browser conformance matrix: ${matrix}`);
export const fullConformance = matrix === 'full';
export function conformanceURL(url: string) {
  const result = new URL(url);
  result.searchParams.set('matrix', matrix);
  return result.href;
}

/** Include observations on failure too; waits overlap page-side phases. */
export const test = base.extend<{ phaseTiming: PhaseTiming }>({
  phaseTiming: [async ({ page }, use, info) => {
    const timing = new PhaseTiming();
    for (const name of ['goto', 'waitForFunction', 'waitForTimeout', 'screenshot'] as const) {
      const original = page[name].bind(page) as (...args: any[]) => Promise<any>;
      (page as any)[name] = (...args: any[]) => timing.async(name, () => original(...args));
    }
    try { await use(timing); } finally {
      const conformance = await page.evaluate(() => (window as any).conformanceTiming).catch(() => undefined);
      await info.attach('phase-timing.json', {
        body: JSON.stringify({ browserVersion: page.context().browser()?.version(), browser: timing.phases, conformance }), contentType: 'application/json',
      });
    }
  }, { auto: true }],
});
