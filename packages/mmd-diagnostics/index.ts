/** Transport validity, playback support and approximation quality are separate results. */
export type DiagnosticCategory = 'malformed-data' | 'unsupported-capability' | 'fallback-limit' | 'resource-exhaustion';
export interface Diagnostic {
  category: DiagnosticCategory;
  code: string;
  path: string;
  message: string;
}
export class MMDDiagnosticError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(`${diagnostic.path}: ${diagnostic.message}`);
    this.name = 'MMDDiagnosticError';
  }
}
export function diagnosticError(category: DiagnosticCategory, code: string, path: string, message: string): never {
  throw new MMDDiagnosticError({ category, code, path, message });
}
export function validateBudget(value: number, path: string) {
  if (!Number.isSafeInteger(value) || value < 1)
    diagnosticError('resource-exhaustion', 'invalid-budget', path, 'execution budget must be a positive safe integer');
}
