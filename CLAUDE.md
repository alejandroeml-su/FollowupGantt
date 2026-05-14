@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project · Sync (FollowupGantt)

Internal PMI + Agile + ITIL project-management platform for the **Unidad de Transformación Digital de Inversiones Avante**. Internal product code name: `followup-gantt`; UI branded as **Sync**. Production at `followup-gantt-beta.vercel.app`.

Stack: **Next.js 16.2 (App Router)** · **React 19** · **TypeScript** · **Prisma 7 + PostgreSQL (Supabase)** · **Tailwind 4** · **Vitest + Playwright**.

> See `AGENTS.md` — Next.js 16 has breaking changes vs training data. Read `node_modules/next/dist/docs/` before writing Next.js code.

## Commands

```bash
npm run dev            # local dev server (next dev)
npm run build          # prisma generate && next build (also runs in CI)
npm run lint           # ESLint — must pass; vitest is flaky and routinely bypassed
npm run test           # vitest run (one specific test is known flaky)
npm run test:watch     # vitest interactive
npm run test:coverage  # vitest with coverage
npm run test:e2e       # playwright test
npx prisma generate    # regenerate Prisma client after schema changes
```

**Single test**: `npx vitest run path/to/file.test.ts` or `npx vitest -t "test name fragment"`.

**Type check**: `npx tsc --noEmit` (silent on success). Always run after schema changes.

## Database migrations

Migrations are applied to the Supabase production DB **via the Supabase MCP tool** (`mcp__claude_ai_Supabase__apply_migration`), not local `prisma migrate`. The local schema in `prisma/schema.prisma` is the source of truth — keep it in sync with what was applied via MCP. Project ID: `bpiugqsjnlwqfhbnkirh`. Each migration to prod requires explicit user authorization (the harness blocks otherwise).

## Architecture

### Layout & routes

- `src/app/` — App Router routes. The single root layout (`src/app/layout.tsx`) wraps everything with `ThemeProvider` (next-themes, class mode), `Sidebar` + `MobileHeader`, and global PWA bits. `/login` and similar hide the chrome.
- Top-level domain routes: `/list`, `/gantt`, `/timeline`, `/kanban`, `/calendar`, `/table`, `/dashboards`, `/portfolio`, `/agile/*`, `/brain` (AI), plus admin/settings.
- `src/app/api/` — Route handlers grouped by domain (`brain`, `cron`, `import`, `v1`, `v2`, etc.). Webhook v2 dispatcher lives in `src/lib/webhooks-out/`.

### Server actions

The lion's share of mutations are **server actions** in `src/lib/actions.ts` (legacy monolith — `createTask`, `updateTask`, `deleteTask`, etc.) plus per-domain modules under `src/lib/actions/` (`collaborators.ts`, `schedule.ts`, `tasks.ts`, `task-refinement.ts`, `risks.ts`, `automation.ts`, …). Pattern:

- Errors are thrown as `Error('[CODE] human message')` so the client can pattern-match (`INVALID_TRANSITION`, `FORBIDDEN`, `NOT_FOUND`, etc.).
- After mutating, call `revalidatePath()` for every affected route. Server actions also trigger best-effort audit logging (`recordAuditEventSafe`), webhook v2 (`dispatchV2Event`), and automation engine (`dispatchAutomationEvent`).

### RBAC visibility model (critical)

All listing pages run `resolveProjectVisibility(sessionUser)` from `src/lib/auth/visibility.ts` and spread `visibility.taskWhere` / `visibility.projectWhere` into their Prisma queries. Roles in `permissions.ts`. The user's project visibility includes (per role) gerencia membership, `ProjectAssignment`, `TeamProject`, **plus** any project where the user has a `Task.assigneeId` or `TaskCollaborator` entry (PR #250 expanded this — Edwin reported that having only task assignments was not enough).

**Whenever you add a new listing/query, route it through `resolveProjectVisibility` or `getProjectAccessFilter` — never query `prisma.project`/`prisma.task` unscoped.**

### Task model · the three methodologies

`Task.type ∈ {AGILE_STORY, PMI_TASK, ITIL_TICKET}` drives **conditional UI and persistence**. Common fields live on `Task` directly; type-specific extension is stored as JSON columns:

- `Task.userStory` (Wave P9) — Agile user story + acceptance criteria.
- `Task.scrumAttributes` (Fase 1.5) — taskKind, boardStatus, hours*, DoD checklist, blockers, commits, PRs.
- `Task.pmiAttributes` (Fase 1.5) — wbsCode, deliverable, qualityCriteria, RACI, schedule constraint, PERT durations.
- `Task.itilAttributes` (Fase 1) — recordType, impact, urgency, symptom, diagnosis, resolution, rootCause, change-mgmt fields.
- `Task.definitionComplete` (Fase 4) — boolean recomputed by validation engine in every create/update.

Helpers in `src/lib/{scrum,pmi,itil,user-story}/types.ts` export `normalize*Attributes()` and `empty*Attributes()` — use them; the BD is `Json` without schema and the columns may hold legacy or partial data.

### Validation engine + state machines

`src/lib/task-validation/rules.ts` implements rules G/I/P/S from the "Definición Extendida de Tareas" spec (e.g., I-06: Problem→Closed requires rootCause; P-06: RACI needs exactly one Accountable; S-06: cannot move to Done with unchecked DoD items). `isDefinitionComplete(violations)` ignores warnings — only errors block.

`src/lib/task-validation/state-machines.ts` provides `canTransition(type, from, to)` returning `{ok:false, code:'INVALID_TRANSITION'}` if the status change is not in the allowed graph for the task type. `updateTask` throws when transition is invalid — the client catches `[INVALID_TRANSITION]`.

### Task form

`src/components/interactions/task-form/TaskForm.tsx` is the single source of truth, used in both modal (create) and drawer (edit) via `layout` prop. The body is **strictly ordered**: validation banner → mnemonic chip → toggle/parent → **Título → Metodología (+conditional ITIL/Scrum/PMI section) → Prioridad** → Descripción → Etiquetas → URL → UserStory (if AGILE) → Tiempos/Indicadores (if not ITIL) → TaskMetaSidebar (if drawer). The methodology selector drives which extension sections render. Auto-save patterns:

- `mode='create'`: parent controls value via `onChange`, serializes to FormData (`itilAttributes`/`scrumAttributes`/`pmiAttributes` keys).
- `mode='edit'`: `onAutosave` fires onBlur and posts a `FormData` to `updateTask` with the JSON.

`TaskDrawerContent` passes `key={task.updatedAt}` to force a remount after the AI menu applies refinements — `useState(() => task.field)` only runs once, so the prop change alone wouldn't refresh local form state.

### Dark mode (gotcha)

Tailwind 4 by default emits `dark:` variants inside `@media (prefers-color-scheme:dark)`. The app uses `next-themes` with the class strategy → `@custom-variant dark (&:where(.dark, .dark *));` in `src/app/globals.css` is **required** for dark variants to apply when the OS theme differs from the app theme. Don't remove it. Prefer `text-foreground` (CSS variable, toggles via `.dark` class) over `dark:text-slate-200` patterns; the CSS variable approach is robust regardless of how `dark:` variants are compiled.

### AI · Brain

`/brain` is the AI surface with five tabs (Knowledge Manager, Project Manager AI, Project Insights AI, Strategist AI, Writer AI). Uses `@ai-sdk/react` (`useChat`) + Anthropic provider. **Memoize the `DefaultChatTransport` instance** with `useMemo([], [])` — inline construction in the body of a render has caused React error #482 in production. `src/app/brain/error.tsx` catches segment errors locally so the rest of the app stays navigable.

### Service worker

`public/service-worker.js` — bump the `VERSION` constant on every release that changes Next bundles or server-action surface. The `activate` handler purges any cache named with a prior VERSION. Don't ship CSS chunk changes without bumping VERSION or the SW will keep serving stale assets and users see "ghost" bugs from prior deploys.

## Working conventions

### Two GitHub accounts

The repo lives at `alejandroeml-su/FollowupGantt`. Local git is configured as `edwinaml-su` (cannot push). Before any `git push`, switch with `gh auth switch -u alejandroeml-su`.

### Merge protocol

Edwin (project lead) authorizes every merge individually via `si procede` / `si autorizado`. CI has one flaky unit test (`tests/component/AITaskRefineMenu.test.tsx`) that fails on master and every PR for an unrelated mock signature issue — admin-merging through this is routine **only with explicit per-PR authorization**. Lint+Typecheck, Vercel build, and axe must pass.

### PR descriptions

Spanish, structured with `## Problema`, `## Fix`, `## Test plan`, and an optional `## Deuda registrada` block listing what's deferred. Match existing tone; users see the body in GitHub.

### Comments in code

Inline comments preserve the *why* — incidents, business rules, regression context, dates ("Edwin reportó 2026-MM-DD: …"). Don't strip them when refactoring. Cite the PR number or wave (`Wave P9 · Agile Maturity`, `Fase 1.5`, etc.) when adding new ones.

### Sentry / observability

Server actions wrap their bodies in `withMetrics('action.name', async () => …)` for metrics. Use the same wrapper when adding new actions. Audit events via `recordAuditEventSafe` (best-effort, never throws).
