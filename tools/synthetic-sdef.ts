/** Original Issue #33 derivatives of both distinct Issues #25/#27/#31 rigs.
 * No third-party model bytes. Mixed BDEF1/SDEF, ordered [259,2], .25/0/1 weights,
 * zero and nonzero centers, two materials, 260 joints and additive vertex morphs. */
import { writeFile } from 'node:fs/promises';
import { syntheticPMX } from './synthetic-bdef';
for (const rig of ['box', 'wedge'] as const) await writeFile(`tests/fixtures/sdef-${rig}.pmx`, syntheticPMX('mixed-sdef', 'utf16le', false, rig, true));
