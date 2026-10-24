import { expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";

/** Read inside the actual render callback, before WebGL discards its buffer. */
export async function readRigBitmap(page: Page) {
  const actual = await page.evaluate(() =>
    (window as any).captureMMDRigCanvas(),
  );
  expect(actual.revision).toBe(
    await page.evaluate(() => (window as any).mmdRig.rendered.revision),
  );
  const intrinsic = Buffer.from(actual.png.split(",")[1], "base64"),
    bitmap = PNG.sync.read(intrinsic);
  const size = await page
    .locator("#rig-viewport canvas")
    .evaluate((element) => ({
      width: (element as HTMLCanvasElement).width,
      height: (element as HTMLCanvasElement).height,
    }));
  expect({ width: bitmap.width, height: bitmap.height }).toEqual(size);
  expect(bitmap.data.some((v, i) => i % 4 === 3 && v !== 0)).toBe(true);
  expect(bitmap.data.some((v, i) => i % 4 < 3 && v < 180)).toBe(true);
  return intrinsic;
}
