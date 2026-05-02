// Stub vacío de `server-only` para vitest. En tests no se aplica el
// marker porque no hay React Server Components siendo bundled, y el
// package real no está en node_modules en este worktree. Ver
// `vitest.config.ts > resolve.alias`.
export {}
