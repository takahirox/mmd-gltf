import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { validateBytes, validateString } from "gltf-validator";
import { solverExpected, solverVertex } from "../solver-oracle";
import { orientationError } from "../../tools/vmd-animation";
const preview = "http://127.0.0.1:43180/mmd-gltf/";
test("built Demo keeps IK and rig replacement locked during a delayed motion load", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${preview}rig.html`);
  await expect(page.locator("#rig-preset")).toBeEnabled();
  await page.locator("#rig-model").selectOption("solver-box-bdef");
  await expect(page.locator("#motion-load")).toBeEnabled();
  await page.locator("#motion-source").selectOption("glb");

  let releaseMotion!: () => void;
  const motionReady = new Promise<void>(resolve => { releaseMotion = resolve; });
  let delayedRequests = 0;
  await page.route("**/solver/box-bdef/a.glb", async route => {
    delayedRequests++;
    await motionReady;
    await route.continue();
  });
  try {
    await page.locator("#motion-load").click();
    // Hold the GLB response used by the independent Toon and PBR instances.
    await expect.poll(() => delayedRequests).toBeGreaterThan(0);
    await expect(page.locator("#ik-override")).toBeDisabled();
    await expect(page.locator("#rig-model")).toBeDisabled();
    const revision = await page.evaluate(() => (window as any).mmdRig.revision);
    // Even a programmatic event must not finish a nested guarded operation and
    // unlock the rig selector while the motion responses are still pending.
    await page.locator("#ik-override").dispatchEvent("change");
    await expect(page.locator("#rig-model")).toBeDisabled();
    await expect(page.locator("#motion-load")).toBeDisabled();
    await expect(page.locator("#status")).toHaveText("Working…");
    expect(await page.evaluate(() => (window as any).mmdRig.revision)).toBe(revision);
  } finally {
    releaseMotion();
  }

  await expect(page.locator("#status")).toContainText("VMD loaded");
  await expect(page.locator("#rig-model")).toBeEnabled();
  await page.locator("#rig-model").selectOption("solver-wedge-bdef");
  await expect(page.locator("#status")).toContainText("Rig loaded");
  await expect(page.locator("#ik-override")).toBeEnabled();
  await expect(page.locator("#ik-override")).toHaveValue("motion");
  await page.waitForFunction(() => {
    const state = (window as any).mmdRig;
    return state.rendered?.revision === state.revision && state.rendered.rig === "solver-wedge-bdef";
  });
  const state = await page.evaluate(() => (window as any).mmdRig);
  expect(state.rig).toBe("solver-wedge-bdef");
  expect(state.motion).toBe("");
  expect(state.disposedPlayers).toBe(2);
  // Wedge has a 0.2 m link offset and a 0.4 m tip; box has 0 and 0.2 m.
  for (const [index, translation] of [[1, [0, 0.2, 0]], [2, [0, 0.4, 0]]] as const) {
    const bone = state.bones.find((b: any) => b.index === index);
    bone.translation.forEach((v: number, c: number) =>
      expect(Math.abs(v - translation[c])).toBeLessThanOrEqual(2e-6),
    );
  }
  expect(state.error).toBe("");
  expect(errors).toEqual([]);
});

test('built extension-only solver skins validate and reload GLB/glTF exports without PMX extras', async ({ page }) => {
  await page.goto(`${preview}solver-conformance.html?extension-only`);
  await page.waitForFunction(() => (window as any).solverConformance || (window as any).solverConformanceError);
  expect(await page.evaluate(() => (window as any).solverConformanceError)).toBeUndefined();
  const result = await page.evaluate(() => (window as any).solverConformance);
  expect(result.maximumError).toBeLessThanOrEqual(2e-6);
  expect(result.records).toHaveLength(10);
  for (const record of result.records) {
    const report = record.format === 'glb'
      ? await validateBytes(new Uint8Array(record.bytes))
      : await validateString(record.json);
    expect(report.issues.numErrors, JSON.stringify({ shape: record.shape, state: record.state, format: record.format, issues: report.issues.messages })).toBe(0);
  }
  console.log('Extension-only solver export evidence:', JSON.stringify({ validatedAssets: result.records.length, maximumError: result.maximumError }));
});

for (const source of ["bytes", "glb", "gltf"])
  test(`built Demo resets IK override on ${source} player replacement`, async ({ page }) => {
    await page.goto(`${preview}rig.html`);
    await expect(page.locator("#rig-preset")).toBeEnabled();
    await page.locator("#rig-model").selectOption("solver-box-bdef");
    await expect(page.locator("#motion-load")).toBeEnabled();
    await page.locator("#motion-source").selectOption(source);
    await page.locator("#motion-load").click();
    await expect(page.locator("#status")).toContainText("VMD loaded");
    for (const [override, motion] of [["off", "b"], ["on", "a"]] as const) {
      await page.locator("#ik-override").selectOption(override);
      expect(await page.evaluate(() => (window as any).mmdRig.ik[3])).toBe(override === "on");
      await page.locator("#motion-sample").selectOption(`solver-${motion}`);
      await expect(page.locator("#motion-load")).toBeEnabled();
      await page.locator("#motion-load").click();
      await expect(page.locator("#status")).toContainText("VMD loaded");
      await expect(page.locator("#motion-load")).toBeEnabled();
      await expect(page.locator("#ik-override")).toHaveValue("motion");
      expect(await page.evaluate(() => (window as any).mmdRig.ik[3])).toBe(true);
      await page.locator("#motion-time").fill("0.5");
      await page.locator("#motion-time").dispatchEvent("input");
      await expect(page.locator("#motion-load")).toBeEnabled();
      const state = await page.evaluate(() => (window as any).mmdRig);
      expect(state.error).toBe("");
      expect(state.ik[3]).toBe(false);
      const expected = solverExpected("box", motion, false, 0.2, 0.5);
      for (const bone of state.bones)
        expect(orientationError(bone.rotation, expected[bone.index].rotation)).toBeLessThanOrEqual(1e-5);
    }
    await page.locator("#ik-override").selectOption("off");
    await page.locator("#rig-model").selectOption("solver-wedge-bdef");
    await expect(page.locator("#status")).toContainText("Rig loaded");
    await expect(page.locator("#motion-load")).toBeEnabled();
    await expect(page.locator("#ik-override")).toHaveValue("motion");
  });

for (const source of ["bytes", "glb", "gltf"])
  test(`built Demo marks retained ${source} IK controls inactive through VPD and resets`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const rendered = async () => {
      await page.waitForFunction(() => {
        const s = (window as any).mmdRig;
        return s.rendered?.revision === s.revision && !s.playing;
      });
      return page.evaluate(() => (window as any).mmdRig);
    };
    const checkBones = (state: any, expected: ReturnType<typeof solverExpected>) => {
      for (const bone of state.bones) {
        const predicted = expected.find(b => b.index === bone.index)!;
        expect(orientationError(bone.rotation, predicted.rotation)).toBeLessThanOrEqual(1e-5);
        bone.translation.forEach((v: number, c: number) =>
          expect(Math.abs(v - predicted.translation[c])).toBeLessThanOrEqual(2e-6),
        );
      }
    };
    await page.goto(`${preview}rig.html`);
    await expect(page.locator("#rig-preset")).toBeEnabled();
    await page.locator("#rig-model").selectOption("solver-box-bdef");
    await expect(page.locator("#motion-load")).toBeEnabled();
    const rest = (await rendered()).bones;
    // At rest, +X tip -> +Y goal requires an enabled +Z quarter turn.
    expect(orientationError(rest.find((b: any) => b.index === 1).rotation,
      [0, 0, Math.SQRT1_2, Math.SQRT1_2])).toBeLessThanOrEqual(1e-5);
    await page.locator("#motion-source").selectOption(source);
    await page.locator("#motion-load").click();
    await expect(page.locator("#status")).toContainText("VMD loaded");

    for (const action of ["motion-reset", "vpd-a", "vpd-b", "rig-reset"]) {
      await page.locator("#motion-time").fill("0.371");
      await page.locator("#motion-time").dispatchEvent("input");
      await page.locator("#ik-override").selectOption("off");
      checkBones(await rendered(), solverExpected("box", "a", false, 0.2, 0.371));
      if (action !== "motion-reset") {
        await page.locator("#rig-pose").selectOption(action === "vpd-a" ? "a" : "b");
        await page.locator("#rig-preset").click();
        await expect(page.locator("#status")).toContainText("Applied VPD");
      }
      if (action === "motion-reset" || action === "rig-reset") {
        await page.locator(`#${action}`).click();
        await expect(page.locator("#rig-state")).toHaveText("Rest state");
      }
      const inactive = await rendered();
      expect(inactive.ik).toEqual({});
      await expect(page.locator("#ik-override")).toHaveValue("off");
      await expect(page.locator("#ik-state")).toHaveText(
        "Motion IK controls inactive · override retained for resumed motion",
      );
      checkBones(inactive, action.startsWith("vpd-")
        ? solverExpected("box", action === "vpd-a" ? "a" : "b") : rest);

      // Playback reclaims the pose with the retained Disabled override.
      const before = inactive.time;
      await page.locator("#motion-play").click();
      await expect.poll(() => page.evaluate(() => (window as any).mmdRig.time)).toBeGreaterThan(before);
      await page.locator("#motion-pause").click();
      const resumed = await rendered();
      expect(resumed.ik[3]).toBe(false);
      expect(resumed.pose).toBe("motion");
      expect(resumed.error).toBe("");
      await expect(page.locator("#ik-state")).toHaveText("Controller 3: disabled");
      checkBones(resumed, solverExpected("box", "a", false, 0.2, resumed.time));
    }
    expect(errors).toEqual([]);
  });

test("built Demo restores legacy pose and motion presets after solver rig replacement", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${preview}rig.html`);
  await expect(page.locator("#rig-preset")).toBeEnabled();
  for (const [rig, pose] of [["box", "a"], ["wedge", "b"]]) {
    await page.locator("#rig-model").selectOption(`solver-${rig}-bdef`);
    await expect(page.locator("#rig-preset")).toBeEnabled();
    await page.locator("#rig-pose").selectOption(pose);
    await expect(page.locator("#rig-encoding")).toHaveValue("utf-8");
    await expect(page.locator("#rig-map")).toHaveValue("{}");
    await expect(page.locator("#motion-sample")).toHaveValue("solver-a");
    await page.locator("#rig-model").selectOption(rig);
    await expect(page.locator("#rig-preset")).toBeEnabled();
    await expect(page.locator("#rig-encoding")).toHaveValue(pose === "a" ? "shift_jis" : "utf-8");
    expect(JSON.parse(await page.locator("#rig-map").inputValue())).toEqual(
      pose === "a" ? {"2": 0, "3": 259} : {"0": 259},
    );
    await expect(page.locator("#motion-sample")).toHaveValue("a");
    await expect(page.locator("#motion-morph-unmatched")).toHaveValue("ignore");
    const rest = await page.evaluate(() => (window as any).mmdRig.bones);
    await page.locator("#rig-preset").click();
    await expect(page.locator("#status")).toContainText("Applied VPD");
    expect(await page.evaluate(() => (window as any).mmdRig.bones)).not.toEqual(rest);
    // Load the restored motion selection directly, without triggering a selection change.
    for (const source of ["bytes", "glb", "gltf"]) {
      await page.locator("#motion-source").selectOption(source);
      await page.locator("#motion-load").click();
      await expect(page.locator("#status")).toContainText("VMD loaded");
      await page.locator("#motion-time").fill("0.371");
      await page.locator("#motion-time").dispatchEvent("input");
      await expect(page.locator("#motion-load")).toBeEnabled();
      const state = await page.evaluate(() => (window as any).mmdRig);
      expect(state.time).toBe(0.371);
      expect(state.error).toBe("");
      expect(state.bones).not.toEqual(rest);
    }
  }
  expect(errors).toEqual([]);
});

for (const mode of ["bdef", "sdef", "qdef"])
  for (const rig of ["box", "wedge"])
    for (const material of ["toon", "pbr"])
      test(`built solver ${mode}/${rig}/${material}: independent CPU/GPU and Toon/PBR/Outline, bytes/GLB/glTF and applied exports`, async ({
        page,
      }, info) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(
          `${preview}solver-conformance.html?mode=${mode}&rig=${rig}&material=${material}`,
        );
        await page.waitForFunction(
          () =>
            (window as any).solverConformance ||
            (window as any).solverConformanceError,
          undefined,
          { timeout: 180000 },
        );
        expect(
          await page.evaluate(() => (window as any).solverConformanceError),
        ).toBeUndefined();
        expect(errors).toEqual([]);
        const result = await page.evaluate(
          () => (window as any).solverConformance,
        );
        expect(result.passed).toBe(52);
        expect(result.maximumCPU).toBeLessThanOrEqual(2e-6);
        expect(result.maximumPosition).toBeLessThanOrEqual(1e-4);
        expect(result.maximumNormal).toBeLessThanOrEqual(5e-4);
        for (const exported of await page.evaluate(
          () => (window as any).solverExports,
        )) {
          const report =
            exported.format === "glb"
              ? await validateBytes(new Uint8Array(exported.bytes))
              : await validateString(exported.json);
          expect(
            report.issues.numErrors,
            JSON.stringify(report.issues.messages),
          ).toBe(0);
        }
        console.log(
          `Solver ${mode}/${rig}/${material} evidence:`,
          JSON.stringify({ ...result, evidence: undefined }),
        );
        await mkdir("docs/solver-captures", { recursive: true });
        await writeFile(
          `docs/solver-captures/${mode}-${rig}-${material}.json`,
          JSON.stringify(result, null, 2) + "\n",
        );
        await page.locator("canvas[data-pass=outline]").screenshot({
          path: `docs/solver-captures/${mode}-${rig}-${material}-outline.png`,
        });
        await page.locator("canvas[data-pass=surface]").screenshot({
          path: `docs/solver-captures/${mode}-${rig}-${material}.png`,
        });
        await info.attach(`solver-${mode}-${rig}-${material}.json`, {
          body: JSON.stringify(result),
          contentType: "application/json",
        });
      });

for (const rig of ["box", "wedge"] as const)
  for (const id of ["a", "b"] as const)
    test(`built solver Demo ${rig}/${id}: both poses, controls, transport, load recovery and disposal`, async ({
      page,
    }, info) => {
      await page.goto(`${preview}rig.html`);
      await expect(page.locator("#rig-preset")).toBeEnabled();
      await page.locator("#rig-model").selectOption(`solver-${rig}-bdef`);
      await expect(page.locator("#status")).toContainText("Rig loaded");
      await expect(page.locator("#rig-preset")).toBeEnabled();
      const evidence: any[] = [];
      const rendered = async () => {
        await page.waitForFunction(() => {
          const s = (window as any).mmdRig;
          return s.rendered?.revision === s.revision && !s.playing;
        });
        return page.evaluate(() => (window as any).mmdRig);
      };
      const seek = async (time: number) => {
        await page.locator("#motion-time").fill(String(time));
        await page.locator("#motion-time").dispatchEvent("input");
        return rendered();
      };
      for (const source of ["bytes", "glb", "gltf"]) {
        await page.locator("#motion-sample").selectOption(`solver-${id}`);
        await expect(page.locator("#motion-load")).toBeEnabled();
        await page.locator("#motion-source").selectOption(source);
        await page.locator("#motion-load").click();
        await expect(page.locator("#status")).toContainText("VMD loaded");
        await expect(page.locator("#motion-load")).toBeEnabled();
        for (const time of [0, 0.371, 0.5, 0.719, 1, 1.5, 0.371]) {
          const s = await seek(time),
            expected = solverExpected(
              rig,
              id,
              time < 0.5 || time >= 1,
              0.2,
              time,
            );
          for (const b of s.bones) {
            expect(
              orientationError(b.rotation, expected[b.index].rotation),
            ).toBeLessThanOrEqual(1e-5);
            b.translation.forEach((v: number, c: number) =>
              expect(
                Math.abs(v - expected[b.index].translation[c]),
              ).toBeLessThanOrEqual(2e-6),
            );
          }
          [0, 1, 2, 3, 9, 23].forEach((v, i) =>
            solverVertex(
              rig,
              id,
              time < 0.5 || time >= 1,
              v,
              "bdef",
              true,
              false,
              false,
              time,
            )
              .p.toArray()
              .forEach((n, c) =>
                expect(
                  Math.abs(n - s.rendered.vertices[i][c]),
                ).toBeLessThanOrEqual(2e-6),
              ),
          );
          expect(s.ik[3]).toBe(time < 0.5 || time >= 1);
          evidence.push({
            source,
            time,
            revision: s.revision,
            rendered: s.rendered,
            bones: s.bones,
          });
        }
        await page.locator("#ik-override").selectOption("off");
        expect((await rendered()).ik[3]).toBe(false);
        await page.locator("#ik-override").selectOption("motion");
        expect((await rendered()).ik[3]).toBe(true);
        await page.locator("#motion-play").click();
        await expect
          .poll(async () => page.evaluate(() => (window as any).mmdRig.time))
          .toBeGreaterThan(0.371);
        await page.locator("#motion-pause").click();
        await rendered();
        await page.locator("#motion-loop").check();
        await seek(1.49);
        await page.locator("#motion-play").click();
        await expect
          .poll(async () =>
            page.evaluate(
              () => (window as any).mmdRig.playback.crossing?.crossings ?? 0,
            ),
          )
          .toBeGreaterThan(0);
        await page.locator("#motion-pause").click();
        await page.locator("#motion-loop").uncheck();
        await seek(1.49);
        await page.locator("#motion-play").click();
        await expect
          .poll(async () => page.evaluate(() => (window as any).mmdRig.playing))
          .toBe(false);
        expect((await rendered()).time).toBe(1.5);
        for (const pose of ["a", "b"] as const) {
          await page.locator("#rig-pose").selectOption(pose);
          await page.locator("#rig-preset").click();
          await expect(page.locator("#status")).toContainText("Applied VPD");
          const s = await rendered(),
            expected = solverExpected(rig, pose);
          for (const b of s.bones)
            expect(
              orientationError(b.rotation, expected[b.index].rotation),
            ).toBeLessThanOrEqual(1e-5);
          await page.locator("#rig-preset").click();
          await rendered();
        }
        await page.locator("#rig-reset").click();
        await expect(page.locator("#rig-state")).toHaveText("Rest state");
        await seek(0.371);
        for (const format of ["glb", "gltf"]) {
          const download = page.waitForEvent("download", { timeout: 15000 });
          await page.locator(`#rig-export-${format}`).click();
          const file = await download;
          const path = await file.path();
          const bytes = await readFile(path!);
          const report =
            format === "glb"
              ? await validateBytes(bytes)
              : await validateString(bytes.toString());
          expect(
            report.issues.numErrors,
            JSON.stringify(report.issues.messages),
          ).toBe(0);
        }
        const before = (await rendered()).bones;
        await page.locator("#motion-file").setInputFiles({
          name: "broken.vmd",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("broken"),
        });
        await page.locator("#motion-load").click();
        await expect(page.locator("#status")).toContainText("VMD:");
        expect((await rendered()).bones).toEqual(before);
      }
      const captured = await rendered();
      evidence.push({
        capture: true,
        source: captured.source,
        time: captured.time,
        revision: captured.revision,
        rendered: captured.rendered,
        bones: captured.bones,
        predictedBones: solverExpected(
          rig,
          id,
          captured.time < 0.5 || captured.time >= 1,
          0.2,
          captured.time,
        ),
        predictedVertices: [0, 1, 2, 3, 9, 23].map((v) =>
          solverVertex(
            rig,
            id,
            captured.time < 0.5 || captured.time >= 1,
            v,
            "bdef",
            true,
            false,
            false,
            captured.time,
          ).p.toArray(),
        ),
      });
      await mkdir("docs/solver-captures", { recursive: true });
      await writeFile(
        `docs/solver-captures/demo-${rig}-${id}.json`,
        JSON.stringify(evidence, null, 2) + "\n",
      );
      await page
        .locator("canvas")
        .screenshot({ path: `docs/solver-captures/demo-${rig}-${id}.png` });
      await page.locator("#rig-model").selectOption("box");
      await expect(page.locator("#status")).toContainText("Rig loaded");
      expect((await rendered()).disposedPlayers).toBeGreaterThan(0);
      await info.attach("solver-demo.json", {
        body: JSON.stringify(evidence),
        contentType: "application/json",
      });
    });
