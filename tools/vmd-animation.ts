import {
  Extension,
  type Document,
  type Buffer,
  type Node,
  type Animation,
  type WriterContext,
} from '@gltf-transform/core';
import { evaluateTrack, slerp, type MotionBinding, type MotionTrack } from '../packages/mmd-vmd';
import { EXTENSION_NAME, validatePayload, type VMDPayload } from '../packages/mmd-vmd/payload';
import type { Quat } from '../packages/mmd-vpd';
export interface SamplingOptions {
  translationTolerance?: number;
  rotationTolerance?: number;
  maxSamples?: number;
}
export function orientationError(a: Quat, b: Quat) {
  const dot = Math.abs(a.reduce((n, v, i) => n + v * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b)));
  return 2 * Math.acos(Math.min(1, dot));
}
export class VMDWriter extends Extension {
  static EXTENSION_NAME = EXTENSION_NAME;
  readonly extensionName = EXTENSION_NAME;
  records = new Map<Animation, { motion: MotionBinding; nodes: Node[] }>();
  read(): this {
    throw new Error('VMDWriter is converter-only');
  }
  write(context: WriterContext): this {
    for (const [animation, { motion, nodes }] of this.records) {
      const payload: VMDPayload = {
        version: 1,
        rest: motion.rest.map((b) => ({
          node: context.nodeIndexMap.get(nodes[b.index])!,
          translation: b.translation,
          rotation: b.rotation,
        })),
        tracks: motion.tracks.map((t) => ({
          node: context.nodeIndexMap.get(nodes[t.index])!,
          keys: structuredClone(t.keys),
        })),
      };
      validatePayload(payload, context.jsonDoc.json.nodes!.length);
      const def = context.jsonDoc.json.animations![context.animationIndexMap.get(animation)!];
      def.extensions = { ...def.extensions, [EXTENSION_NAME]: payload };
    }
    return this;
  }
}
/** Finite adaptive probes, not a continuous error certificate. Includes FLOAT quantization. */
export function sampleTrack(
  track: MotionTrack,
  options: SamplingOptions = {},
  budget = { remaining: 200_000 },
) {
  const translationTolerance = options.translationTolerance ?? 2e-6,
    rotationTolerance = options.rotationTolerance ?? 2e-5,
    maxSamples = options.maxSamples ?? 200_000;
  if (
    !Number.isFinite(translationTolerance) ||
    translationTolerance <= 0 ||
    !Number.isFinite(rotationTolerance) ||
    rotationTolerance <= 0 ||
    !Number.isInteger(maxSamples) ||
    maxSamples < 1 ||
    maxSamples > 200_000
  )
    throw new Error('VMD: invalid fallback sampling limits (maximum 200000 samples)');
  const at = (time: number) => {
    const v = evaluateTrack(track, time);
    return {
      time,
      translation: v.translation.map(Math.fround),
      rotation: v.rotation.map(Math.fround) as Quat,
    };
  };
  type Sample = ReturnType<typeof at>;
  const samples: Sample[] = [];
  const add = (s: Sample) => {
    if (samples.length >= maxSamples || --budget.remaining < 0)
      throw new Error('VMD: excessive fallback sampling; accuracy cannot be met within sample budget');
    if (samples.length && s.time <= samples.at(-1)!.time)
      throw new Error('VMD: strictly increasing FLOAT timestamps cannot be represented');
    samples.push(s);
  };
  const fits = (a: Sample, b: Sample, time: number) => {
    const exact = evaluateTrack(track, time),
      t = b.time === a.time ? 0 : Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
    const translation = a.translation.map((v, i) => v + (b.translation[i] - v) * t),
      rotation = slerp(a.rotation, b.rotation, t);
    return (
      Math.hypot(...translation.map((v, i) => v - exact.translation[i])) <= translationTolerance &&
      orientationError(rotation, exact.rotation) <= rotationTolerance
    );
  };
  const split = (a: Sample, b: Sample, depth: number) => {
    if ([0, 0.25, 0.5, 0.75, 1].every((t) => fits(a, b, a.time + (b.time - a.time) * t))) {
      add(b);
      return;
    }
    const middle = Math.fround((a.time + b.time) / 2);
    if (depth >= 24 || middle <= a.time || middle >= b.time)
      throw new Error(
        'VMD: requested fallback accuracy cannot be represented with strictly increasing FLOAT timestamps',
      );
    const m = at(middle);
    split(a, m, depth + 1);
    split(m, b, depth + 1);
  };
  const times = [...new Set([0, ...track.keys.map((k) => k.frame / 30)])];
  let previous = -1;
  for (const time of times) {
    const f = Math.fround(time);
    if (!Number.isFinite(f) || f <= previous)
      throw new Error('VMD: source keys cannot have strictly increasing FLOAT timestamps');
    previous = f;
    const sample = at(f);
    if (!fits(sample, sample, time))
      throw new Error('VMD: requested fallback accuracy cannot represent a source key in FLOAT');
    if (samples.length) split(samples.at(-1)!, sample, 0);
    else add(sample);
  }
  return samples;
}
export function addVMDAnimation(
  doc: Document,
  buffer: Buffer,
  motion: MotionBinding,
  nodes: Node[],
  options: SamplingOptions = {},
) {
  if (!motion.tracks.length) throw new Error('VMD: no bound bone tracks to convert');
  const animation = doc
    .createAnimation('VMD bone motion')
    .setExtras({
      vmd: {
        unmatched: motion.unmatched,
        omitted: motion.omitted,
        profile: 'continuous-curve-v1',
        fallback: 'Approximate LINEAR TRS, adaptive quarter probes; no continuous error proof',
        sampling: {
          translationTolerance: options.translationTolerance ?? 2e-6,
          rotationTolerance: options.rotationTolerance ?? 2e-5,
          maxSamples: options.maxSamples ?? 200000,
        },
      },
    });
  const budget = { remaining: options.maxSamples ?? 200_000 };
  let count = 0;
  for (const track of motion.tracks) {
    const samples = sampleTrack(track, options, budget);
    count += samples.length;
    const input = doc
      .createAccessor('VMD seconds')
      .setBuffer(buffer)
      .setType('SCALAR')
      .setArray(new Float32Array(samples.map((s) => s.time)));
    for (const path of ['translation', 'rotation'] as const) {
      const values = samples.flatMap((s) => s[path]);
      const output = doc
        .createAccessor(`VMD ${path}`)
        .setBuffer(buffer)
        .setType(path === 'translation' ? 'VEC3' : 'VEC4')
        .setArray(new Float32Array(values));
      const sampler = doc
        .createAnimationSampler()
        .setInterpolation('LINEAR')
        .setInput(input)
        .setOutput(output);
      animation
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(nodes[track.index])
            .setTargetPath(path)
            .setSampler(sampler),
        );
    }
  }
  doc.createExtension(VMDWriter).records.set(animation, { motion, nodes });
  return count;
}
