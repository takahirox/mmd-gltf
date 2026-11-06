// Issue #91: matched published-package captures, using the existing read-only
// diagnostics. Run against production preview after building each locked version.
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [mode, directory, otherDirectory, destination] = process.argv.slice(2);
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const crop = (source, half) => {
  const out = new PNG({width: source.width / 2, height: source.height});
  PNG.bitblt(source, out, half * out.width, 0, out.width, out.height, 0, 0);
  return out;
};
if (mode === 'capture') {
  await mkdir(directory, {recursive: true});
  const pkg = await readJSON('node_modules/@takahirox/three-mmd/package.json');
  const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || 'chrome',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1000, height: 800}, deviceScaleFactor: 1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = {version: pkg.version, browser: browser.version(), viewport: {width: 1000, height: 800},
    renderer: 'ANGLE SwiftShader', states: []};
  try {
    for (const model of ['uka', 'gene']) {
      await page.goto(`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/?demo=${model}`);
      await page.locator('#gene-status').filter({hasText: 'Ready'}).waitFor({timeout: 90000});
      for (const motion of ['rest', '22_apology']) {
        await page.locator('#comparison-motion').selectOption(motion);
        if (motion !== 'rest') await page.locator('#comparison-time').evaluate(element => {
          element.valueAsNumber = 1; element.dispatchEvent(new Event('input', {bubbles: true}));
        });
        for (const material of ['toon', 'pbr']) for (const outline of [false, true]) {
          await page.locator('#material').selectOption(material);
          await page.locator('#outlines').setChecked(outline);
          const name = `${model}-${motion}-${material}-${outline ? 'outline' : 'surface'}`;
          const capture = () => page.evaluate(() => window.captureMMDComparisonCanvas());
          const first = await capture(), second = await capture();
          const bytes = Buffer.from(first.png.split(',')[1], 'base64');
          assert.equal(first.png, second.png, `${name}: paused rendering must repeat exactly`);
          await writeFile(`${directory}/${name}.png`, bytes);
          const state = await page.evaluate(() => ({
            time: window.mmdExample.time, referenceTime: window.mmdExample.referenceTime,
            gltfTimes: window.mmdExample.gltfTimes, cameras: window.mmdExample.cameras,
            execution: window.mmdExample.execution, pose: window.readMMDComparisonPose(),
            resources: window.readMMDComparisonResources(),
          }));
          assert.equal(state.execution.physics, false);
          assert.equal(state.referenceTime, state.time);
          assert.deepEqual(state.gltfTimes, [state.time, state.time]);
          assert.ok(state.resources.referenceTextures.every(t => t.width > 0 && t.height > 0));
          // Allocation IDs/heap are process-specific; retain authored texture and
          // pose evidence separately from those diagnostic counters.
          result.states.push({name, model, motion, material, outline, sha256: hash(bytes),
            width: first.width, height: first.height, time: state.time, cameras: state.cameras,
            poseSHA256: hash(JSON.stringify(state.pose)),
            executionSHA256: hash(JSON.stringify(state.execution)),
            textures: state.resources.referenceTextures});
        }
      }
    }
    assert.deepEqual(errors, []);
    await writeFile(`${directory}/captures.json`, JSON.stringify(result, null, 2) + '\n');
    console.log(`Captured ${result.states.length} deterministic states with ${pkg.version}`);
  } finally { await browser.close(); }
} else if (mode === 'compare') {
  const before = await readJSON(`${directory}/captures.json`), after = await readJSON(`${otherDirectory}/captures.json`);
  assert.equal(before.browser, after.browser);
  assert.deepEqual(before.viewport, after.viewport);
  const rows = [];
  await mkdir(destination, {recursive: true});
  for (const model of ['uka', 'gene']) {
    let sheet;
    const states = before.states.filter(s => s.model === model);
    for (const [index, state] of states.entries()) {
      const updated = after.states.find(s => s.name === state.name);
      for (const key of ['time', 'cameras', 'poseSHA256', 'executionSHA256', 'textures'])
        assert.deepEqual(updated[key], state[key], `${state.name}: ${key}`);
      const a = PNG.sync.read(await readFile(`${directory}/${state.name}.png`));
      const b = PNG.sync.read(await readFile(`${otherDirectory}/${state.name}.png`));
      assert.equal(a.width, b.width); assert.equal(a.height, b.height);
      const leftA = crop(a, 0), leftB = crop(b, 0);
      assert.deepEqual(crop(a, 1).data, crop(b, 1).data, `${state.name}: glTF pixels`);
      let changed = 0, foreground = 0, sumA = 0, sumB = 0, clippedA = 0, clippedB = 0;
      const backgroundOffset = (leftA.width * 4 + 4) * 4;
      const backgroundA = leftA.data.subarray(backgroundOffset, backgroundOffset + 3);
      const backgroundB = leftB.data.subarray(backgroundOffset, backgroundOffset + 3);
      for (let i = 0; i < leftA.data.length; i += 4) {
        const x = leftA.data.subarray(i, i + 3), y = leftB.data.subarray(i, i + 3);
        if (!x.equals(y)) changed++;
        // Sample inside the fixed scene background, excluding the scissor border
        // from the union foreground mask. These are encoded display RGB values.
        const column = (i / 4) % leftA.width, row = Math.floor(i / 4 / leftA.width);
        if (column > 1 && column < leftA.width - 2 && row > 1 && row < leftA.height - 2
          && (!x.equals(backgroundA) || !y.equals(backgroundB))) {
          foreground++; sumA += x[0] + x[1] + x[2]; sumB += y[0] + y[1] + y[2];
          if (x.includes(255)) clippedA++; if (y.includes(255)) clippedB++;
        }
      }
      rows.push({name: state.name, changedReferencePixels: changed, foregroundPixels: foreground,
        meanForegroundRGB: [sumA / (foreground * 3), sumB / (foreground * 3)],
        foregroundPixelsWith255: [clippedA, clippedB], gltfChangedPixels: 0,
        poseSHA256: state.poseSHA256, cameraSHA256: hash(JSON.stringify(state.cameras)),
        executionSHA256: state.executionSHA256, textureInventorySHA256: hash(JSON.stringify(state.textures)),
        beforeSHA256: state.sha256, afterSHA256: updated.sha256});
      sheet ??= new PNG({width: leftA.width * 4, height: leftA.height * 4});
      const x = (index % 4) * leftA.width, y = Math.floor(index / 4) * leftA.height * 2;
      PNG.bitblt(leftA, sheet, 0, 0, leftA.width, leftA.height, x, y);
      PNG.bitblt(leftB, sheet, 0, 0, leftB.width, leftB.height, x, y + leftA.height);
    }
    await writeFile(`${destination}/${model}.png`, PNG.sync.write(sheet));
  }
  await writeFile(`${destination}/comparison.json`, JSON.stringify({beforeVersion: before.version,
    afterVersion: after.version, browser: before.browser, viewport: before.viewport,
    renderer: before.renderer, rows}, null, 2) + '\n');
  console.log(`Compared ${rows.length} states: identical poses/cameras/textures and glTF pixels`);
} else throw new Error('Usage: capture-three-mmd-upgrade.mjs capture DIRECTORY | compare BEFORE AFTER DESTINATION');
