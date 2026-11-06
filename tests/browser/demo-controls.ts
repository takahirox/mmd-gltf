import { expect, type Page } from '@playwright/test';

/** Existing feature/oracle tests open the workflows they exercise in the unified UI. */
export async function openRigDemo(page: Page, preview: string) {
  await page.goto(`${preview}?demo=rig`);
  await expect(page.locator('#demo-model')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await page.locator('#rig-controls details').evaluateAll(details => {
    details.forEach(element => { (element as HTMLDetailsElement).open = true; });
  });
}

/** Open the existing footer disclosures only when inspecting diagnostics. */
export async function openComparisonDiagnostics(page: Page) {
  for (const id of ['about-demo', 'comparison-diagnostics']) {
    const details = page.locator(`#${id}`);
    if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) {
      await details.locator(':scope > summary').click();
    }
  }
  await expect(page.locator('#comparison-ik-diagnostics')).toBeVisible();
}
