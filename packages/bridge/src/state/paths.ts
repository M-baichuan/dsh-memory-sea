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
    voiceActive: path.join(root, "data/state/voice-active.json"),
    qzoneDraft: path.join(root, "data/state/qzone-draft.json"),
    promises: path.join(root, "data/state/promises.json"),
    tasteMap: path.join(root, "data/state/taste-map.json"),
    eyeVault: path.join(root, "data/state/eye-vault"),
    stickers: path.join(root, "data/stickers"),
    lock: path.join(root, "data/state/bridge.lock"),
    log: path.join(root, "data/state/bridge.log"),
  };
}
