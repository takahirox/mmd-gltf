import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { MMDSDEFPlugin } from '../three-mmd-sdef';
/** Opt-in combined QDEF/SDEF loader. Register this instead of MMDSDEFPlugin for
 * mixed geometry: one material hook and one morph-before-skinning dispatch. */
export class MMDQDEFPlugin extends MMDSDEFPlugin {
  constructor(parser: GLTFParser) { super(parser, true); }
}
export { EXTENSION_NAME } from './payload';
export { applyQDEF, evaluateQDEF } from './cpu';
export { MMDQDEFExporterPlugin } from './exporter';
