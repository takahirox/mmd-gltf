# Direct MMD texture paths (Issues #73 and #78)

Historical record of the 2026-11-01 published 0.1.3 integration and earlier
0.1.2 incident. Package availability, validation and deployment plans below
describe that work at the time; the demo now uses published 0.1.4. See the
[0.1.4 upgrade record](three-mmd-0.1.4.md) for current package and validation evidence.

The pinned Uka PMX contains the exact texture entry `tex\hair_s01.png` at index
7. Eight of its nine raw entries use Windows separators; the inventory normalizes
them and therefore cannot establish the original spelling. The raw parser
assertion in [the Uka test](../tests/uka.test.ts) verifies the source entry as well
as the existing manifest hash checks. Original PMX, images, notices, source names
and conversion provenance remain unchanged.

## Published 0.1.3 integration (Issue #78)

The demo consumes the actual npm-published `@takahirox/three-mmd@0.1.3`, pinned
exactly in the manifest and lockfile. Direct PMX loading uses ordinary
`new MMDLoader(manager)`. The temporary 0.1.2 compatibility factory, duplicate
local resolver and candidate upstream patch have been removed. No vendor edits,
URL modifier or replacement path implementation is needed. The existing
LoadingManager still waits for image completion, reports canonical failed URLs,
and lets the public Retry action rebuild the comparison.

Verified against the [official registry distribution](https://registry.npmjs.org/@takahirox%2fthree-mmd/0.1.3):

- Version: `0.1.3`; published gitHead: `7b604fb1d76b26a2c46bced0cbeab2b8b5781c40`.
- Tarball: `https://registry.npmjs.org/@takahirox/three-mmd/-/three-mmd-0.1.3.tgz`.
- Integrity: `sha512-/7WB/Wq8ME6QYrY5PEYXkXPvkGZj/wNfCfCruHPLdvOqLzj3Sfrq7C5jcao+bD1FVWq++glE2zSytFNJW60vcQ==`.
- The tarball's SHA-512 matches registry metadata and all 63 installed files
  match the downloaded tarball byte for byte after clean `npm ci`.
- The packaged resolver exactly matches TypeScript-transpiled source at the
  published gitHead. The loader also matches except for a retained unused
  `Camera` import; detailed hashes and comparison are in the validation record.
- The public root and `./loaders/MMDLoader.js` exports expose MMDLoader. The
  installed loader imports its packaged resolver, resolves before cache/handler
  selection, classifies PMD sphere roles and TGA by canonical URL pathname, and
  retains complete URL queries/fragments for requests and cache keys. Tests
  import the public loader export, never the private resolver module.
- Registry signatures are present; no provenance attestations are advertised
  in this version's registry metadata. gitHead is publication metadata, not a
  separate provenance attestation.

## Original incident and upstream history

[Downstream #73](https://github.com/takahirox/mmd-gltf/issues/73) /
[PR #74](https://github.com/takahirox/mmd-gltf/pull/74) introduced the temporary
shim because published 0.1.2 (gitHead
`5ae203246ccffd86a3e8fb7be0e34b9559c33a46`) concatenated raw texture names.
At the 2026-10-31 validation, the corrected library source was merged but not yet
published. [Upstream #106](https://github.com/takahirox/three-mmd-loader/issues/106)
was completed by [PR #107](https://github.com/takahirox/three-mmd-loader/pull/107),
merged at `a05444db048c7329a56e34501193f0fe1845aa59`.
[PR #111](https://github.com/takahirox/three-mmd-loader/pull/111) prepared 0.1.3.
The maintainer subsequently published it; [downstream #78](https://github.com/takahirox/mmd-gltf/issues/78)
performs this migration. The original patch and shim remain available in Git
history for #73/#74 and must not be applied to this integration.

The [historical validation record](pmx-resource-path-validation.json) preserves
0.1.2 evidence as dated history. The [0.1.3 validation record](three-mmd-0.1.3-validation.json)
records the current package and downstream checks. These changes do not add the
separate public Physics feature requested in #77.

The resolver handles PMD base/sphere maps and PMX base/sphere/subtexture/custom
toon maps uniformly. It converts backslashes, collapses repeated separators and
safe dot segments, joins the base once, and encodes spaces, Unicode and filename
query/fragment delimiters without double encoding existing escapes. Equivalent
relative names share a cache key. Explicit absolute URLs (including custom
handler schemes), protocol-relative, root-relative, data and blob references are
supported; built-in default toon textures use the loader's original branch.
PMX base/sphere source names remain in material metadata; original PMD combined
filenames remain intact in parser records (the removed shim-specific
`sourceFileName` metadata is no longer synthesized).

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
all material texture families, escaped PMD sphere extensions, query/fragment-bearing
PMD sphere URLs, query-bearing TGA URLs, custom-handler precedence and original-name
retention. [Browser coverage](../tests/browser/mmd-resource-path.spec.ts)
inspects actual request URLs, response statuses, decoded image dimensions,
duplicate fetches and pre-fetch rejection, including actual TGA decoding with
query-bearing absolute request URLs and PMD base/sphere map assignment with
query/fragment-bearing URLs (fragments remain in loader URLs, but HTTP requests
omit them). It separately exercises a 404, a
200 response with invalid image bytes, and a browser request error.
[The Uka browser suite](../tests/browser/uka.spec.ts)
loads the real pinned PMX/glTF with cold and warm browser caches, requires both
panes to reach Ready, distinguishes the direct PMX ImageLoader request from glTF
fetches, and asserts the hair response is 200 at
`/mmd-gltf/uka/tex/hair_s01.png`. The existing deliberate missing-image/Retry test
remains in place. See [the 0.1.3 validation record](three-mmd-0.1.3-validation.json)
for actual command results. Public Retry coverage also distinguishes unsafe-path
errors from failed canonical requests and covers 404, corrupt HTTP-200 images
and aborted requests.

Desktop browser success does not establish Android compatibility. HTTP browser
URL parsers can already canonicalize a backslash even before this change; the
original error string alone never proved a 404 or the Android failure's cause.
Physical Android browser verification has not been performed, so
**real Android cold/warm loads and the original failure's cause are unverified**.
The Issue #78 run found no attached devices via `adb devices -l`. Earlier #73
continuation evidence detected a Pixel 7a, which established no Chrome request,
decode or rendering result. The required deployed checks remain pending under
the post-merge plan below.

## Required deployment and Android verification after merge

Confirm the merge-triggered build and Pages deployment succeeded for the exact
merged SHA with the 0.1.3 lockfile. On the deployed app, repeat the canonical PMX
hair request, HTTP-200/decode and both-Ready checks before recording deployment
acceptance. Local production-preview tests do not establish deployment success.

Then perform the physical-device steps below; desktop/mobile viewport emulation
is not Android evidence.

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
