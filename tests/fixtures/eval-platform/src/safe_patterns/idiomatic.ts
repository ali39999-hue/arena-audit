// INTENTIONAL SAFE PATTERN: Pure, clean, idiomatic TypeScript
// Must produce ZERO findings across all lenses and detectors.
export interface CalculationResult {
  value: number;
  valid: boolean;
}

export function computeDiscount(basePrice: number, discountPercentage: number): CalculationResult {
  if (basePrice < 0 || discountPercentage < 0 || discountPercentage > 100) {
    return { value: 0, valid: false };
  }
  const discount = (basePrice * discountPercentage) / 100;
  return {
    value: Math.max(0, basePrice - discount),
    valid: true,
  };
}
