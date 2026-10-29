import { openRigDemo } from './demo-controls';
import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { validateBytes, validateString } from "gltf-validator";
const preview = "http://127.0.0.1:43180/mmd-gltf/";
const near = (actual: number[], expected: number[], bound = 3e-6) =>
  actual.forEach((v, i) =>
    expect(Math.abs(v - expected[i])).toBeLessThan(bound),
  );
for (const mode of ["bdef", "sdef", "qdef"])
  test(`physics GPU ${mode}: independent resolved palettes, normals, Toon/PBR, outline and snapshot export`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${preview}physics-conformance.html?mode=${mode}`);
    await page.waitForFunction(
      () => !!((window as any).physicsResult || (window as any).physicsError),
      {},
      { timeout: 180000 },
    );
    expect(
      await page.evaluate(() => (window as any).physicsError),
    ).toBeUndefined();
    const result = await page.evaluate(() => (window as any).physicsResult);
    expect(result.maximumPosition).toBeLessThanOrEqual(1e-4);
    expect(result.maximumNormal).toBeLessThanOrEqual(5e-4);
    expect(result.maximumCPU).toBeLessThanOrEqual(2e-6);
    expect(result.maximumRaster).toBeLessThanOrEqual(128);
    await mkdir("docs/physics-canvas", { recursive: true });
    for (const image of await page.evaluate(
      () => (window as any).physicsImages,
    ))
      await writeFile(
        `docs/physics-canvas/${image.name}.png`,
        Buffer.from(image.data.split(",")[1], "base64"),
      );
    for (const artifact of await page.evaluate(
      () => (window as any).physicsExports,
    )) {
      const validation =
        artifact.format === "glb"
          ? await validateBytes(new Uint8Array(artifact.bytes))
          : await validateString(artifact.json);
      expect(validation.issues.numErrors).toBe(0);
    }
    await writeFile(
      `docs/physics-${mode}-browser-validation.json`,
      JSON.stringify(
        {
          environment:
            "Chromium SwiftShader WebGL fallback; built production Demo resources",
          ...result,
          errors,
        },
        null,
        2,
      ) + "\n",
    );
    expect(errors).toEqual([]);
  });
test("built Demo physics: two rigs, motions, bytes/GLB/glTF, VPD handoffs, transport, controls and recovery", async ({
  page,
}) => {
  // Retain all 12 independent state-oracle paths; display captures are opt-in.
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const reference = JSON.parse(
      await readFile("public/physics/reference.json", "utf8"),
    ).poses,
    evidence: object[] = [];
  await openRigDemo(page, preview);
  await expect(page.locator("#rig-model")).toBeEnabled();
  const ready = async () => {
    await expect(page.locator("#motion-load")).toBeEnabled();
    expect(await page.evaluate(() => (window as any).mmdRig.error)).toBe("");
  };
  const capture = async (name: string) => {
    await page.waitForFunction(() => {
      const x = (window as any).mmdRig;
      return x.rendered?.revision === x.revision;
    });
    const info = await page.evaluate(() => (window as any).mmdRig);
    expect(info.rendered.bones).toEqual(info.bones);
    expect(info.rendered.vertices).toEqual(info.vertices);
    if (process.env.UPDATE_SYNTHETIC_EVIDENCE === '1') {
      await mkdir("docs/physics-demo-canvas", { recursive: true });
      await page.locator("#rig-viewport canvas").screenshot({path:`docs/physics-demo-canvas/${name}.png`});
    }
    return info;
  };
  for (const rig of ["box", "wedge"])
    for (const motion of ["a", "b"])
      for (const source of ["bytes", "glb", "gltf"]) {
        await page.locator("#rig-model").selectOption(`physics-${rig}-bdef`);
        await ready();
        await page.locator("#motion-sample").selectOption(`solver-${motion}`);
        await page.locator("#motion-source").selectOption(source);
        await page.locator("#motion-load").click();
        await ready();
        await page.locator("#motion-time").fill("0.5");
        await page.locator("#motion-time").dispatchEvent("change");
        await ready();
        const info = await capture(`${rig}-${motion}-${source}`);
        for (const bone of info.bones)
          near(
            bone.translation,
            reference[`${rig}-${motion}`][bone.index].translation,
          );
        expect(info.physics.enabled).toBe(true);
        evidence.push({
          rig,
          motion,
          source,
          revision: info.revision,
          bones: info.bones,
          vertices: info.vertices,
        });
        await page.locator("#physics-enabled").uncheck();
        await ready();
        const disabled = await page.evaluate(
          () => (window as any).mmdRig.bones,
        );
        expect(
          Math.abs(
            disabled.find((b: any) => b.index === 4).translation[1] -
              info.bones.find((b: any) => b.index === 4).translation[1],
          ),
        ).toBeGreaterThan(0.001);
        await page.locator("#physics-enabled").check();
        await ready();
        for (const pose of ["a", "b"]) {
          await page.locator("#rig-pose").selectOption(pose);
          await page.locator("#rig-preset").click();
          await ready();
          await page.locator("#physics-step").click();
          await ready();
          const applied = await capture(
            `${rig}-${motion}-${source}-VPD-${pose}`,
          );
          expect(applied.playing).toBe(false);
          for (const bone of applied.bones)
            near(
              bone.translation,
              reference[`${rig}-pose-${pose}`][bone.index].translation,
            );
          await page.locator("#physics-reset").click();
          await ready();
          expect(
            await page.evaluate(() => (window as any).mmdRig.physics.time),
          ).toBe(0);
        }
        // Seek after VPD reacquires raw motion ownership; backward replay remains deterministic.
        for (const time of ["1.1", "0.2", "0.5"]) {
          await page.locator("#motion-time").fill(time);
          await page.locator("#motion-time").dispatchEvent("change");
          await ready();
        }
        const replay = await capture(`${rig}-${motion}-${source}-replay`);
        for (const bone of replay.bones)
          near(
            bone.translation,
            reference[`${rig}-${motion}`][bone.index].translation,
          );
      }
  for (const mode of ["sdef", "qdef"])
    for (const rig of ["box", "wedge"]) {
      await page.locator("#rig-model").selectOption(`physics-${rig}-${mode}`);
      await ready();
      await page.locator("#motion-source").selectOption("bytes");
      await page.locator("#motion-load").click();
      await ready();
      await page.locator("#motion-time").fill("0.5");
      await page.locator("#motion-time").dispatchEvent("change");
      await ready();
      for (const material of ["toon", "pbr"])
        for (const outline of ["on", "off"]) {
          await page.locator("#rig-material").selectOption(material);
          await page.locator("#rig-outlines").selectOption(outline);
          await capture(`${rig}-${mode}-${material}-${outline}`);
        }
    }
  // Invalid stepping preserves the resolved nodes and allows subsequent recovery.
  const before = await page.evaluate(() => (window as any).mmdRig.bones);
  await page.locator("#physics-seconds").fill("2.1");
  await page.locator("#physics-step").click();
  await expect(page.locator("#physics-step")).toBeEnabled();
  expect(await page.evaluate(() => (window as any).mmdRig.bones)).toEqual(
    before,
  );
  expect(await page.evaluate(() => (window as any).mmdRig.error)).toContain(
    "budget",
  );
  await page.locator("#physics-seconds").fill(".25");
  await page.locator("#rig-reset").click();
  await ready();
  await page.locator("#physics-step").click();
  await ready();
  for (const format of ["glb", "gltf"]) {
    const pendingDownload = page.waitForEvent("download");
    await page.locator(`#rig-export-${format}`).click();
    const download = await pendingDownload;
    await ready();
    const bytes = await readFile((await download.path())!);
    const validation =
      format === "glb"
        ? await validateBytes(bytes)
        : await validateString(bytes.toString());
    expect(validation.issues.numErrors).toBe(0);
    const json = JSON.parse(
      format === "glb"
        ? bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()
        : bytes.toString(),
    );
    expect(json.extensions.MMD_physics.version).toBe(1);
    expect(json.extensions.MMD_skeleton_solver.version).toBe(2);
  }
  await page.locator("#rig-model").selectOption("box");
  await ready();
  expect(await page.evaluate(() => (window as any).mmdRig.physics)).toBeNull();
  await writeFile(
    "docs/physics-demo-validation.json",
    JSON.stringify({ evidence, errors }, null, 2) + "\n",
  );
  expect(errors).toEqual([]);
});
