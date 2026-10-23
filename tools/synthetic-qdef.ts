/** Original synthetic Issue #37 derivatives; no third-party model bytes. */
import { writeFile } from 'node:fs/promises';
import { syntheticPMX } from './synthetic-bdef';
for (const rig of ['box','wedge'] as const) await writeFile(`tests/fixtures/qdef-${rig}.pmx`,syntheticPMX('mixed-qdef','utf16le',false,rig,true));
