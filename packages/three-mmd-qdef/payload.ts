export const EXTENSION_NAME = 'MMD_skinning_qdef';
export const QDEF_ATTRIBUTE = 'mmdQdefSelection';
export interface QDEFPayload { selector: number }
export function validatePayload(value: unknown): asserts value is QDEFPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Number.isSafeInteger((value as QDEFPayload).selector) || (value as QDEFPayload).selector < 0)
    throw new Error(`${EXTENSION_NAME}: exactly one nonnegative selector accessor index required`);
}
