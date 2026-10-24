export const registry: { mounts: number; current: { type: (b: unknown[]) => void; get: () => unknown[] } | null } = { mounts: 0, current: null }
