/** Text logged at activation. Kept pure so it can be unit tested. */
export function activationMessage(version: string): string {
  return `Agent Session Keeper ${version} activated`;
}
