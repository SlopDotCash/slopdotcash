export function verificationTransition(
  model: string,
  source: string,
): {
  step: "verificationStep";
  kind: "forward-safety-simulation-delayed-inputs";
  sourceSha256: string;
  concreteStep: "step";
} | null;
