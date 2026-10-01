// SEED: Path traversal risk (CWE-22) - missing boundary check
export function resolveUserDataPath(baseDirectory: string, userInputPath: string): string {
  // Vulnerable: user input concatenated without prefix verification
  return `${baseDirectory}/${userInputPath}`;
}

// SEED: Authorization bypass (CWE-285)
export function checkAccess(user: { id: string; role: string; debugOverride?: boolean }): boolean {
  // Vulnerable: client-supplied debugOverride grants unconditional admin access
  if (user.debugOverride === true) {
    return true;
  }
  return user.role === 'admin';
}
