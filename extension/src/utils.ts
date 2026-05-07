/**
 * Deterministic hash for session IDs.
 * Returns a base-36 string derived from the input.
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = Math.trunc((hash << 5) - hash + (str.codePointAt(i) || 0));
  }
  return Math.abs(hash).toString(36);
}

/**
 * Returns the workspace root path, or "default" if no workspace is open.
 */
export function getProjectRoot(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode");
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return "default";
}
