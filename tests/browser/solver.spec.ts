import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { validateBytes, validateString } from "gltf-validator";
import { solverExpected, solverVertex } from "../solver-oracle";
import { orientationError } from "../../tools/vmd-animation";
const preview = "http://127.0.0.1:43180/mmd-gltf/";
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
