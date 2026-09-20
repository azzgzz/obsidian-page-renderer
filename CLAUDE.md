# CLAUDE.md

## Project Overview

Obsidian plugin for exporting notes, folders, and selected Markdown files to Markdown with rendered query results (`dataview`, `dataviewjs`, `tasks`). It is the only export format: PDF, Word, EPUB, HTML and the plain Markdown bundle were removed.

- Plugin ID: `azz-page-export`
- Current version: see `manifest.json`
- Min Obsidian version: `1.4.0`

## Tech Stack

- TypeScript + esbuild (bundled CJS output)
- Vitest for testing
- Obsidian API (`obsidian` module)

## Commands

```bash
npm run dev      # watch mode with esbuild
npm run build    # type check + production build
npm test         # vitest run
npm run test:watch  # vitest watch
```

## Architecture

```
src/
  main.ts              Plugin entry, command registration, modal → runExport → progress notice
  runExport.ts         Pipeline shared by UI and CLI: resolve source → build plan → validate → run
  types.ts             Shared types and default settings (ExportedNote, NoteFragment, ExportPlan, ...)
  settings/            Settings load/save and settings tab UI (settings declared once in settings-tab.ts)
  export/              Core pipeline modules
    ExportSourceResolver.ts  Resolve files from source (current-file, files, folder); vault walkers collectMarkdownFiles/collectFolders
    ExportPlan.ts            Build, validate and relocate plans; resolveEffectivePlan (timestamped folder when overwrite is off)
    ExportRunner.ts          Orchestrate the pipeline: preflight → per-note steps (exportNote) → attachments → report
    ExportOutcome.ts         ExportResult type and status resolution
    ExportReport.ts          export-report.md content and non-colliding report path
    DocumentAssembler.ts     Read one note, strip frontmatter, derive title → ExportedNote
    EmbedExpander.ts         Inline ![[Note]] embeds into source-aware fragments
    FragmentJoiner.ts        Join fragments, keeping block boundaries around inline transclusions
    AttachmentCollector.ts   Discover and deduplicate attachments (cross-file)
    LinkRewriter.ts          Rewrite wiki links, embeds, and image paths
    QueryBlockResolver.ts    Replace dataview/dataviewjs/tasks fenced blocks with rendered results
    native-renderer.ts       Render Markdown through Obsidian MarkdownRenderer into a hidden DOM and wait for post-processors (Dataview/Tasks)
    HtmlToMarkdown.ts        Convert the live DOM of query results to Markdown (tables, lists, tasks)
    composeOutput.ts         Pure text of one exported .md (optional properties block, title, optional source comment, body)
    OutputTarget.ts          OutputTarget interface with VaultTarget, FileSystemTarget (node:fs) and MemoryTarget; createOutputTarget picks one per export
    utils.ts                 Shared helpers (path stripping, relative paths, code block protection, isFile/isFolder/isMarkdown)
  cli/                 Obsidian CLI command
    CliExport.ts             `azz-export` handler: parse params, map vault paths, call runExport (stdout mode uses MemoryTarget)
  ui/                  Modal and progress UI
    ExportModal.ts           Two-step export configuration modal
    FilePickerModal.ts       Multi-select list of vault notes
    FolderPickerModal.ts     Fuzzy folder picker
    systemFolderPicker.ts    Native folder dialog (desktop)
    ProgressNotice.ts        Visual progress bar with cancel button
    exportProgress.ts        Maps runner callbacks onto the progress bar
    ExportResultMessage.ts   One-line summary of an ExportResult
  test-support/        In-memory vault and frozen clock for integration tests
```

## Conventions

- Use duck-typing (`"extension" in f`) instead of `instanceof TFile`/`TFolder` — enables Vitest without mocking obsidian module
- Tests live alongside source: `*.test.ts` in the same directory
- All module imports use `@/` path alias
- DOM-dependent tests (e.g. ProgressNotice) need `// @ts-nocheck` and `/** @vitest-environment jsdom */` at top; Obsidian HTMLElement methods (`empty`, `createDiv`, `createEl`, `createSpan`) must be polyfilled in the test mock

## Git

- Branch: `main` is protected (PR required, CI must pass, no force push)
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- No co-author or AI attribution in commits
- Plugin directory in vault (`~/obsidian/.obsidian/plugins/azz-page-export/`) is a regular directory, not a symlink: `npm run build` does not update it, copy `main.js`, `manifest.json`, `styles.css` there manually
- **Never place a backup copy of the plugin inside `~/.obsidian/plugins/`**: Obsidian loads plugins by `manifest.json` `id`, so a second dir with the same id (e.g. `document-exporter.backup-...`) collides and one silently shadows the other. Keep backups outside `plugins/`, or remove their `manifest.json`.

## Release

- CI has an automatic release workflow triggered by tags — do NOT manually run `gh release create` after pushing a tag, it will conflict
- Release steps: bump version in `manifest.json` + `versions.json` → PR → merge → `git tag -a X.Y.Z` → `git push origin X.Y.Z` → CI creates the release with `main.js`, `manifest.json`, `styles.css`
- Version consistency across `package.json`, `package-lock.json`, `manifest.json` and the `versions.json` → `minAppVersion` mapping is enforced by `npm run check:version`; its regression tests run via `node --test scripts/check-version.test.mjs` (CI and release workflow run both)
- Release notes: when `docs/releases/<tag>/release-notes.md` exists, CI publishes it verbatim; otherwise GitHub generates notes. Write the reviewed file for planned releases

## Key References

- Development plan (v0.1, archived): `docs/archives/2026-05-10-document-exporter-development-plan.md`
- Obsidian plugin docs: https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin
