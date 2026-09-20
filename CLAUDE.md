# CLAUDE.md

## Project Overview

Page Renderer: Obsidian plugin for exporting notes, folders, and selected Markdown files to Markdown with rendered query results (`dataview`, `dataviewjs`, `tasks`). It is the only export format: PDF, Word, EPUB, HTML and the plain Markdown bundle were removed.

- Plugin ID: `page-md-renderer` (also the name of the CLI command)
- Current version: see `manifest.json`
- Min Obsidian version: `1.4.0`

## Tech Stack

- TypeScript (strict) + esbuild (bundled CJS output)
- Vitest for testing
- Obsidian API (`obsidian` module)

## Commands

```bash
npm run dev      # watch mode with esbuild
npm run build    # type check + production build
npm test         # vitest run
npm run test:watch  # vitest watch
npm run lint:obsidian-warnings  # eslint with eslint-plugin-obsidianmd
npm run check:version           # version metadata consistency (see Release)
npx tsc -noEmit -skipLibCheck   # type check only
```

CI (`.github/workflows/ci.yml`) runs the version script tests, `check:version`, lint, type check, build and tests on every PR and push to `main`.

## Architecture

```
src/
  main.ts              Plugin entry (PageRendererPlugin): ribbon icon, command, file/editor menus, Notebook Navigator menus, CLI registration, modal → runExport → progress notice
  runExport.ts         Pipeline shared by UI and CLI: resolve source → build plan → validate → run
  types.ts             Shared types and default settings (ExportedNote, NoteFragment, ExportPlan, ...)
  settings/            Settings load/save and settings tab UI (settings declared once in settings-tab.ts)
  export/              Core pipeline modules
    ExportSourceResolver.ts  Resolve files from source (current-file, files, folder); vault walkers collectMarkdownFiles/collectFolders
    ExportPlan.ts            Build, validate and relocate plans; resolveEffectivePlan (timestamped folder when overwrite is off)
    ExportRunner.ts          Orchestrate the pipeline: preflight → per-note steps (exportNote) → attachments → report
    ExportOutcome.ts         ExportResult type and status resolution
    ExportReport.ts          export-report.md: written only when the run has warnings or errors and reached the output stage; never replaces a file (export-report-N.md next to the outputs); sections Completed / Possibly incomplete / Warnings / Errors
    DocumentAssembler.ts     Read one note, strip frontmatter, derive title → ExportedNote
    EmbedExpander.ts         Inline ![[Note]] and ![[Note#Heading]] embeds into source-aware fragments; cycle detection, depth limit MAX_EMBED_DEPTH = 5; block-reference embeds stay as is with a warning
    FragmentJoiner.ts        Join fragments, keeping block boundaries around inline transclusions
    AttachmentCollector.ts   Discover and deduplicate attachments (cross-file)
    LinkRewriter.ts          Rewrite wiki links, embeds, and image paths; links to notes outside the export become vault-root Markdown links
    QueryBlockResolver.ts    Replace dataview/dataviewjs/tasks fenced blocks with rendered results (empty result → `-`; unrenderable block stays as source with a warning)
    native-renderer.ts       Render Markdown through Obsidian MarkdownRenderer into a hidden DOM and wait for post-processors (Dataview/Tasks)
    HtmlToMarkdown.ts        Convert the live DOM of query results to Markdown (tables, lists, tasks)
    composeOutput.ts         Pure text of one exported .md (optional properties block, title, optional source comment, body)
    OutputTarget.ts          OutputTarget interface with VaultTarget, FileSystemTarget (Node `fs` via `window.require`, desktop only, absolute output paths) and MemoryTarget; createOutputTarget picks one per export
    utils.ts                 Shared helpers (path stripping, relative paths, code block protection, isFile/isFolder/isMarkdown)
  cli/                 Obsidian CLI command
    CliExport.ts             `page-md-renderer` handler: parse params, map vault paths, call runExport (stdout mode uses MemoryTarget). Registered only when the running Obsidian has `registerCliHandler` (1.12.2+), so minAppVersion stays 1.4.0
  ui/                  Modal and progress UI
    ExportModal.ts           Two-step export configuration modal
    FilePickerModal.ts       Multi-select list of vault notes
    FolderPickerModal.ts     Fuzzy folder picker
    systemFolderPicker.ts    Native folder dialog (desktop)
    ProgressNotice.ts        Visual progress bar with cancel button
    exportProgress.ts        Maps runner callbacks onto the progress bar
    ExportResultMessage.ts   One-line summary of an ExportResult
  test-support/        In-memory vault and frozen clock for integration tests
  __mocks__/obsidian.ts  Minimal stand-in for the `obsidian` module (vitest.config.ts aliases `obsidian` to it)
scripts/
  check-version.mjs          Version consistency gate behind `npm run check:version` (+ check-version.test.mjs)
  create-release-fixtures.mjs  Generates synthetic vault fixtures mirroring the notes used in ReleaseArtifacts.test.ts
.github/workflows/     ci.yml (verify on PR/push) and release.yml (tag → release)
```

Notebook Navigator integration: its menus are found at `app.plugins.plugins["notebook-navigator"].api.menus` and used only when present, adding "Export this file" / "Export this folder" (`registerNotebookNavigatorMenus` in `main.ts`).

## Conventions

- Use the duck-typing helpers `isFile` / `isFolder` / `isMarkdown` from `@/export/utils` (`"extension" in f`, `"children" in f`) instead of `instanceof TFile`/`TFolder`; values coming from third-party plugin APIs are narrowed to objects first (`asAbstractFile` in `main.ts`)
- Vitest resolves `obsidian` to the minimal mock in `src/__mocks__/obsidian.ts`; extend the mock only when a test needs more
- Tests live alongside source: `*.test.ts` in the same directory
- All module imports use `@/` path alias
- DOM-dependent tests (e.g. ProgressNotice) need `// @ts-nocheck` and `/** @vitest-environment jsdom */` at top; Obsidian HTMLElement methods (`empty`, `createDiv`, `createEl`, `createSpan`) must be polyfilled in the test mock

## Git

- Branch: `main` is protected (PR required, CI must pass, no force push)
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- No co-author or AI attribution in commits
- Plugin directory in vault (`~/obsidian/.obsidian/plugins/page-md-renderer/`) is a regular directory, not a symlink: `npm run build` does not update it, copy `main.js`, `manifest.json`, `styles.css` there manually
- **Never place a backup copy of the plugin inside `~/.obsidian/plugins/`**: Obsidian loads plugins by `manifest.json` `id`, so a second dir with the same id (e.g. `page-md-renderer.backup-...`) collides and one silently shadows the other. Keep backups outside `plugins/`, or remove their `manifest.json`.

## Release

- CI has an automatic release workflow triggered by tags — do NOT manually run `gh release create` after pushing a tag, it will conflict
- Release steps: `npm version X.Y.Z --no-git-tag-version` (updates `package.json`, `package-lock.json`, and via `version-bump.mjs` `manifest.json` + `versions.json`) → commit → PR → merge → `git tag -a X.Y.Z` → `git push origin X.Y.Z` → CI creates the release with `main.js`, `manifest.json`, `styles.css`
- Version consistency across `package.json`, `package-lock.json`, `manifest.json` and the `versions.json` → `minAppVersion` mapping is enforced by `npm run check:version`; its regression tests run via `node --test scripts/check-version.test.mjs` (CI and release workflow run both)
- Release notes: when `docs/releases/<tag>/release-notes.md` exists, CI publishes it verbatim; otherwise GitHub generates notes. Write the reviewed file for planned releases

## Key References

- `docs/archives/` — history only: old plans, specs, code review and the 1.0.0 readiness record. They describe the removed multi-format exporter, not current behavior
- `docs/releases/<tag>/release-notes.md` — release notes read by CI (see Release)
- Development plan (v0.1, archived): `docs/archives/2026-05-10-document-exporter-development-plan.md`
- Obsidian plugin docs: https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin
