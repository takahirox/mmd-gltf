# Direct MMD texture paths (Issue #73)

The pinned Uka PMX contains the exact texture entry `tex\hair_s01.png` at index
7. Eight of its nine raw entries use Windows separators; the inventory normalizes
them and therefore cannot establish the original spelling. The raw parser
assertion in [the Uka test](../tests/uka.test.ts) verifies the source entry as well
as the existing manifest hash checks. Original PMX, images, notices, source names
and conversion provenance remain unchanged.

## Upstream fix and temporary integration

This is a partial implementation of Issue #73 and does not close it. Submitting
the tested patch to the reusable upstream library remains required work; the
local patch and demo shim do not satisfy that requirement. Keep #73 open for
upstream submission, a corrected release and dependency migration. Physical
Android verification remains a separate, pending post-merge check below.

The latest published `@takahirox/three-mmd` was `0.1.2` when checked on
2026-10-31. Its MaterialBuilder concatenates `resourcePath + filePath` before
cache lookup, handler selection and image loading. A LoadingManager URL modifier
would run too late to fix all of those operations.

[The upstream source patch](../patches/three-mmd-loader-resource-path.patch)
targets `takahirox/three-mmd-loader` commit
`5ae203246ccffd86a3e8fb7be0e34b9559c33a46`. It adds a reusable resolver, calls it
at the original concatenation site, uses the resolved URL for TGA selection and
cached-failure diagnostics, and includes Node tests of the resolver and MaterialBuilder. The
patch was applied locally and tested against upstream source. It has **not** been
pushed, submitted or published; this task authorizes a worktree commit only.
From that upstream checkout it can be reviewed/applied with:

```sh
git apply --check --unidiff-zero /path/to/mmd-gltf/patches/three-mmd-loader-resource-path.patch
git apply --unidiff-zero /path/to/mmd-gltf/patches/three-mmd-loader-resource-path.patch
node --import tsx --test tests/resource-path.test.ts tests/subtexture.test.ts
```

The patch uses zero context to avoid embedding upstream blank-line/tab context
as whitespace errors in this repository; apply it only to the pinned base above.

Pending an upstream release, [the compatibility factory](../examples/mmd-loader-compat.ts)
wraps only each demo model loader's MaterialBuilder `_loadTexture` entry point.
It uses [the same resolver](../packages/mmd-resource-path.ts) as the patch, resolves
before cache/handler/loader selection, and restores the builder's base immediately
after the synchronous loader call. It changes no prototype, parser record or file
in `node_modules`. Animation-only loaders do not fetch model textures. The
dependency and lockfile intentionally remain pinned at `0.1.2`.

After a corrected upstream release, update the dependency and lockfile, replace
the factory call with ordinary `new MMDLoader(manager)`, and remove the shim,
local resolver and patch. Keep the behavior/network tests against the corrected
loader when doing so.

The resolver handles PMD base/sphere maps and PMX base/sphere/subtexture/custom
toon maps uniformly. It converts backslashes, collapses repeated separators and
safe dot segments, joins the base once, and encodes spaces, Unicode and filename
query/fragment delimiters without double encoding existing escapes. Equivalent
relative names share a cache key. Explicit absolute URLs (including custom
handler schemes), protocol-relative, root-relative, data and blob references are
supported; built-in default toon textures use the loader's original branch.
Source paths are retained separately in material metadata.

Relative traversal is checked after separator conversion and percent decoding.
An attempt to escape the model directory, encoded separators, nested encoded dot
traversal, malformed escapes, control characters, drive paths or UNC paths fails
before handler lookup or fetching. Safe `tex/../image.png` remains inside the
model root. An unsafe resource path produces a specific path error; a failed
canonical request remains a request/image-decode error rather than being labelled
as malformed data.

## Verification and limits

[Node coverage](../tests/mmd-resource-path.test.ts) checks paths, encoding,
traversal, handler/cache ordering, failed cache callbacks, TGA, built-in toon,
all material texture families and original-name retention. [Browser coverage](../tests/browser/mmd-resource-path.spec.ts)
inspects actual request URLs, response statuses, decoded image dimensions,
duplicate fetches and pre-fetch rejection. It separately exercises a 404, a
200 response with invalid image bytes, and a browser request error.
[The Uka browser suite](../tests/browser/uka.spec.ts)
loads the real pinned PMX/glTF with cold and warm browser caches, requires both
panes to reach Ready, distinguishes the direct PMX ImageLoader request from glTF
fetches, and asserts the hair response is 200 at
`/mmd-gltf/uka/tex/hair_s01.png`. The existing deliberate missing-image/Retry test
remains in place. See [the validation record](pmx-resource-path-validation.json)
for actual command results.

Desktop browser success does not establish Android compatibility. HTTP browser
URL parsers can already canonicalize a backslash even before this change; the
original error string alone never proved a 404 or the Android failure's cause.
No physical Android device was available (`adb devices -l` listed none), so
**real Android cold/warm loads and the original failure's cause are unverified**.

## Required Android verification after merge

1. Connect a physical Android device and enable Chrome USB debugging. Record the
   device model, Android version, Chrome version, and deployed commit. Open the
   deployed `/mmd-gltf/` comparison and inspect it from desktop
   `chrome://inspect/#devices` with Network logging and Preserve log enabled.
2. Clear site storage/cache and disable cache for a cold load. Record the exact
   hair request URL, status, transferred bytes, MIME type, request errors and
   timings. It must be `/mmd-gltf/uka/tex/hair_s01.png` on the deployment origin,
   with no backslashes or `%5C`. Distinguish image requests for the PMX pane from
   glTF fetches. Require both pane statuses to reach Ready; that follows image
   decode completion, not merely model parsing.
3. For a failed image, inspect its response and evaluate a separate
   `new Image()` with the same URL followed by `await image.decode()` in DevTools;
   record `naturalWidth`, `naturalHeight` and the exact rejection. Do not infer
   an HTTP failure from `LoadingManager.onError` alone. Save a HAR and relevant
   Chrome/device diagnostics without unrelated browsing data.
4. Re-enable the cache and reload for a warm load. Record status/cache source and
   both Ready states. Exercise all three motions, shared seek/play/pause, Uka/Gene
   IK, Toon/PBR, Outline, model replacement and portrait/landscape layout.
5. Block `uka/tex/face.png` in DevTools, reload and require the visible failure.
   Unblock it and use Retry; both panes must recover.
6. If the hair URL is canonical and its response succeeds but image decoding or
   rendering still fails, keep Android acceptance open. Investigate decoded-image
   memory, dimensions and allocation pressure separately: `hair_s01.png` alone is
   about 12.3 MB compressed, and preview resizing happens after initial decode.
   Record that remaining cause as a follow-up; do not claim path normalization
   alone fixed Android loading or modify the pinned original images.
