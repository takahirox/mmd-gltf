import Ammo from "ammojs-typed";
import { checkAmmo, type AmmoAPI } from "./ammo";
// The self-contained JavaScript artifact installs process handlers when instantiated. Keep one
// explicitly requested module per process; model worlds and native handles remain isolated.
let loaded:
  | Promise<{
      api: AmmoAPI;
    }>
  | undefined;
export function loadAmmoNode() {
  loaded ??= Ammo()
    .then((api) => ({ api: checkAmmo(api as AmmoAPI) }))
    .catch((error) => {
      loaded = undefined;
      throw error;
    });
  return loaded;
}
