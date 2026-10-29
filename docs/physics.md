# Bounded rigid-body physics

## Source transport update (#58)

[Source transport and capabilities](source-transport.md) specifies physics version
2, free joint axes, preserved unexecuted records and configurable execution
budgets. Valid source conversion no longer depends on bounded simulation being
available. Version-1 and analytical runtime policies below remain unchanged;
original-MMD/MikuDanceStudio timing differences are documented separately.

Issue #45 introduces the opt-in [physics contract](../extensions/MMD_physics/README.md).
All mappings and lifecycle semantics are project policies; original-MMD fidelity
remains unmeasured. Existing conversion defaults preserve their previous behavior.

```sh
npm run convert -- model.pmx output.glb --mode bdef --physics rigid-body-v1 --vmd motion.vmd
npm run convert -- model.pmx pose.gltf --mode qdef --physics rigid-body-v1 --vpd pose.vpd --physics-settle 0.25
```

```ts
import { MMDPhysicsPlugin, PhysicsRig, loadAmmoBrowser } from '../packages/three-mmd-physics';
import { MMDSolverPlugin } from '../packages/three-mmd-solver';
import { MMDVMDPlugin } from '../packages/three-mmd-vmd';

const backend = await loadAmmoBrowser(`${baseURL}runtime/ammo.js`);
const asset = await new GLTFLoader()
  .register(p => new MMDSolverPlugin(p))
  .register(p => new MMDPhysicsPlugin(p))
  .register(p => new MMDVMDPlugin(p))
  .loadAsync(url);
const physics = new PhysicsRig(asset.scene, backend.api);
// Existing createVPDRig/bindVMD/createVMDPlayer and VPD apply/reset APIs
// discover this instance's explicit physics owner. Loading alone preserves core TRS.
physics.step(0.25); // settle current rest/VPD input
physics.reset();    // same raw input, zero velocities and forces
physics.dispose(); // release native handles before discarding scene
```

Use `loadAmmoNode` from `packages/three-mmd-physics/node.ts` for Node. The exact
npm artifact is locked and its SHA-256 is checked by tests and build. The build
copies the same self-contained JavaScript resource and license to `public/runtime`; the production
Demo uses a same-origin URL, with no runtime CDN or WASM sidecar. The retained
physics/solver extensions require no PMX extras. Existing converter identity
metadata remains necessary for binding external VMD/VPD names to PMX source IDs.

The built Demo's Physics box/wedge presets cover BDEF and mixed SDEF/QDEF,
both existing synthetic motions and VPD handoffs, bytes and retained GLB/glTF,
enable/reset/step controls, transport, materials, outline and applied export.
Explicit stepping pauses motion ownership. Export retains a snapshot and original
rest, and restarts rather than resumes simulation when explicitly enabled again.

Evidence categories are distinct: analytical finite-step free motion; independent
direct-Ammo contact/spring cases; adapter/import conformance; rendered deformation
from independently supplied resolved palettes; and original-MMD measurements
(unperformed). Saved numerical and browser reports state finite tested bounds,
controls, source/backend hashes, skipped checks and failures. There is no claim
of general PMX physics compatibility or original-MMD parity.

## Canvas restoration observation correction

Old assumption: element screenshot PNG bytes identify intrinsic canvas pixels
independently of CSS placement and scrolling. Corrected requirement: preserve
screen captures as display evidence, and apply exact restoration equality to the
intrinsic canvas bitmap. The [HTML canvas serialization contract](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-todataurl-dev)
serializes that bitmap; [Playwright element screenshots](https://playwright.dev/docs/api/class-locator#locator-screenshot)
capture the element in the composited page and scroll it into view.

Measured rationale on Chromium/SwiftShader: the initial complete browser attempt's
four group recovery cases failed screen-PNG equality. For box/A, 1,479 pixels
differed by at most six byte levels, with identical joint transforms and queried
vertices. A temporary entry using the baseline Demo UI code reproduced unequal
element screenshots. Canvas bounds moved from Y=137.1875 to Y=274.1875 after
scrolling, with identical intrinsic 1232×446 dimensions. An initial outside-frame
bitmap probe was blank because WebGL had cleared the drawing buffer; that probe
was rejected as evidence. The replacement capture (verified through the full box/A group recovery sequence) runs inside the render callback
before presentation, carries its rendered revision, and must contain nonempty
pixels. The temporary diagnostic entry was removed. Tests keep both screen and
intrinsic captures and require exact intrinsic PNG equality. No masks, crops,
numerical tolerances, scenarios, raster limits or timeouts were relaxed. This
corrects an observation assumption, not MMD deformation semantics.
