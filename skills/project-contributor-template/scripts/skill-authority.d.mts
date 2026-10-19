export const SKILL_AUTHORITY_PYTHON: string;
export function pythonRuntimeProbe(requiresHttpsTrust: boolean): string;
export function createSkillAuthorizationProgram(testAuthority?: {
  apiOrigin: string;
  rawOrigin: string;
}): string;
