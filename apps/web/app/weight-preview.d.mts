export function weightPreview(
  input: number,
  values: string[],
): { output: number; loss: number; percent: number } | null;
export function decimalError(
  value: string,
  options?: { min?: number; max?: number; step?: string },
): string;
