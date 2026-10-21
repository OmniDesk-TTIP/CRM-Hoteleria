export function percentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
