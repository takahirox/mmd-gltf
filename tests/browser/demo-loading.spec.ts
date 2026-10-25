import { test, expect } from '@playwright/test';
import { openRigDemo } from './demo-controls';
const preview = 'http://127.0.0.1:43180/mmd-gltf/';

test('binding map failure after rig replacement keeps asset, controls and diagnostics consistent', async ({ page }) => {
  await openRigDemo(page, preview);
  await page.route('**/vmd/motion-a-map.json', route => route.fulfill({ status: 404, body: 'Missing test map' }));
  await page.locator('#rig-model').selectOption('wedge');
  await expect(page.locator('#rig-status')).toContainText('Motion binding map failed: 404');
  await expect(page.locator('#rig-model')).toHaveValue('wedge');
  await expect(page.locator('#motion-map')).toHaveValue('{}');
  await page.waitForFunction(() => {
    const state = (window as any).mmdRig;
    return state.rig === 'wedge' && state.rendered?.rig === 'wedge' && state.rendered.revision === state.revision;
  });
  expect(await page.evaluate(() => (window as any).mmdRig.pose)).toBe('rest');
  await page.unroute('**/vmd/motion-a-map.json');
  await page.locator('#motion-sample').selectOption('b');
  await expect(page.locator('#motion-load')).toBeEnabled();
  await page.locator('#motion-load').click();
  await expect(page.locator('#rig-status')).toContainText('VMD loaded');
  expect(await page.evaluate(() => ({ rig: (window as any).mmdRig.rig, error: (window as any).mmdRig.error }))).toEqual({ rig: 'wedge', error: '' });
});
