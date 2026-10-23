export const EXTENSION_NAME = 'MMD_skinning_sdef';
export interface SDEFPayload { selector: number; c: number; r0: number; r1: number }
export const fields = ['selector', 'c', 'r0', 'r1'] as const;
export const attributes = ['mmdSkinningType', 'mmdSdefC', 'mmdSdefR0', 'mmdSdefR1'] as const;
export function validatePayload(value: unknown): asserts value is SDEFPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(k => !fields.includes(k as keyof SDEFPayload)) ||
    fields.some(k => !Number.isSafeInteger((value as SDEFPayload)[k]) || (value as SDEFPayload)[k] < 0))
    throw new Error(`${EXTENSION_NAME}: four accessor indices required`);
}
