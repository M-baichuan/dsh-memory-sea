export type ScopeKind = "user" | "group" | "relation";

export interface UserScope {
  kind: "user";
  userId: string;
}

export interface GroupScope {
  kind: "group";
  groupId: string;
}

export interface RelationScope {
  kind: "relation";
  userId: string;
  groupId: string;
}

export type MemoryScope = UserScope | GroupScope | RelationScope;

export function scopeKey(scope: MemoryScope): string {
  switch (scope.kind) {
    case "user":
      return `user:${scope.userId}`;
    case "group":
      return `group:${scope.groupId}`;
    case "relation":
      return `relation:${scope.userId}@${scope.groupId}`;
  }
}

export function parseScopeKey(key: string): MemoryScope {
  if (key.startsWith("user:")) {
    return { kind: "user", userId: key.slice("user:".length) };
  }
  if (key.startsWith("group:")) {
    return { kind: "group", groupId: key.slice("group:".length) };
  }
  if (key.startsWith("relation:")) {
    const body = key.slice("relation:".length);
    const at = body.indexOf("@");
    if (at <= 0 || at === body.length - 1) {
      throw new Error(`invalid relation scope key: ${key}`);
    }
    return {
      kind: "relation",
      userId: body.slice(0, at),
      groupId: body.slice(at + 1),
    };
  }
  throw new Error(`unknown scope key: ${key}`);
}

/** Scopes that may be searched when answering in a private chat. */
export function scopesForPrivate(userId: string): MemoryScope[] {
  return [{ kind: "user", userId }];
}

/** Scopes that may be searched when answering in a group. */
export function scopesForGroup(userId: string, groupId: string): MemoryScope[] {
  return [
    { kind: "user", userId },
    { kind: "group", groupId },
    { kind: "relation", userId, groupId },
  ];
}
