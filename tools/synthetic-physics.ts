/** Original synthetic Issue #45 variants of Issue #43 rigs. No third-party bytes.
 * Original fixtures remain byte-identical. Physics adds three shapes, all coupling
 * modes, an unbound group-15 body, asymmetric exclusions and a post-phase consumer. */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { solverPMX } from "./synthetic-solver";
export const physicsPMX = (
  rig: "box" | "wedge",
  mode: "bdef" | "sdef" | "qdef" = "bdef",
) => solverPMX(rig, mode, undefined, true);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  for (const rig of ["box", "wedge"] as const)
    for (const mode of ["bdef", "sdef", "qdef"] as const)
      await writeFile(
        `tests/fixtures/physics-${rig}-${mode}.pmx`,
        physicsPMX(rig, mode),
      );
