import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface StoredCredentials {
  readonly agentId: string;
  readonly ownerId: string;
  readonly apiKey: string;
  readonly name?: string;
  readonly modelName?: string;
}

export function getCredentialsFilePath(home: string = homedir()): string {
  return resolve(home, ".mol/credentials.json");
}

export function loadStoredCredentials(home: string = homedir()): StoredCredentials | null {
  const filePath = getCredentialsFilePath(home);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

export function saveStoredCredentials(creds: StoredCredentials, home: string = homedir()): void {
  const filePath = getCredentialsFilePath(home);
  const dir = resolve(home, ".mol");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(creds, null, 2), { encoding: "utf-8", mode: 0o600 });
}
