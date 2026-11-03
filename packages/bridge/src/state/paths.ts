import path from "node:path";

export function resolveRepoRoot(cwd = process.cwd()): string {
  return cwd;
}

export function statePaths(root: string) {
  return {
    config: path.join(root, "config.json"),
    sessions: path.join(root, "data/state/sessions.json"),
    presence: path.join(root, "data/state/presence.json"),
    personaCards: path.join(root, "data/state/persona-cards.json"),
    personaActive: path.join(root, "data/state/persona-active.json"),
    stickers: path.join(root, "data/stickers"),
    lock: path.join(root, "data/state/bridge.lock"),
    log: path.join(root, "data/state/bridge.log"),
  };
}
