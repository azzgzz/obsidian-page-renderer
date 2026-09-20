# Page Renderer: CLI quick guide

## What it does

The `page-md-renderer` command exports **one Markdown note** from the terminal. Obsidian renders the note, so `dataview`, `dataviewjs` and `tasks` blocks are replaced by their results (tables, lists, task lists) as plain Markdown. Note embeds (`![[Note]]`) are inlined and links are rewritten, according to the plugin settings (**Settings → Page Renderer**).

Folders and selections of several notes are exported from the Obsidian UI only.

## Requirements

- Obsidian 1.12.2+ is running.
- **Settings → General → Command line interface** is enabled.
- The Page Renderer plugin is enabled.

## Usage

By default the command **writes files** to the output folder:

```bash
obsidian page-md-renderer file="<path to note>"
```

To print the Markdown to the terminal instead, pass `printToFile=false`:

```bash
obsidian page-md-renderer file="<path to note>" printToFile=false
```

To target a specific vault, put `vault=<name>` before the command:

```bash
obsidian vault=MyVault page-md-renderer file="folder/note.md"
```

Parameters are passed as `key=value`.

| Parameter | Meaning | Default |
|-----------|---------|---------|
| `file` | Note path: vault-relative or absolute inside the vault. Must end with `.md` (required) | — |
| `printToFile` | `true` writes files to the output folder; `false` prints the result to stdout instead | `true` |
| `output` | Output folder, vault-relative or absolute (only when files are written) | Output folder from the plugin settings (**Output folder**, `exports` by default) |
| `overwrite` | `false` writes into a new timestamped folder instead of overwriting the previous output (only when files are written) | `true` |

## Two modes

### 1. Write files (default, `printToFile=true`)

```bash
obsidian page-md-renderer file="Projects/report.md"
obsidian page-md-renderer file="Projects/report.md" output=exports/reports
obsidian page-md-renderer file="Projects/report.md" overwrite=false
```

**Where to find the result.** The output folder is:

- the `output` parameter, if it is given;
- otherwise the **Output folder** setting of the plugin (**Settings → Page Renderer**), `exports` by default.

A vault-relative folder (`exports`, `exports/reports`) is created **inside the vault**, at `<vault folder>/exports/`. It is visible in Obsidian's file explorer and, being part of the vault, may be picked up by sync and indexing. An absolute path (desktop only) is a folder on disk, outside the vault.

**What is created:**

| Path | Contents |
|------|----------|
| `<output>/<note name>.md` | The exported note. The file name is the source note's name: `Projects/report.md` → `exports/report.md` (the source folder is not recreated) |
| `<output>/assets/` | Copied images and other attachments (only if the note has any and **Copy attachments** is on) |
| `<output>/export-report.md` | Appears only when the export had warnings or errors (unrendered query block, unresolved link, missing attachment, ...). An existing report is never replaced: the next one is named `export-report-2.md`, `export-report-3.md`, ... |

**What the command prints.** A short summary with the output folder, followed by the paths of the created files, for example:

```
Export complete: 1/1 file(s) complete — exports
exports/report.md
```

If there is a report, its path is shown after `Details:`.

**Repeated exports.**

- With `overwrite=true` (default), a file with the same name in the output folder is overwritten.
- With `overwrite=false`, if the output folder already exists, the export goes into a new folder `<output>-<timestamp>` (for example `exports-2026-09-20T21-50-33`, UTC time), and earlier output is left untouched.

### 2. Print to stdout (`printToFile=false`)

```bash
obsidian page-md-renderer file="Projects/report.md" printToFile=false
obsidian page-md-renderer file="Projects/report.md" printToFile=false > report.md
```

- **Result**: the exported Markdown in the terminal; redirect it to a file with `>`.
- Nothing is created in the vault; `output` and `overwrite` are ignored.
- Attachments are not copied; links to images keep pointing at `assets/...`.
- Warnings are not shown in this mode. To see them, write files (the default).

## Errors

Errors are printed as a line starting with `Error:`, for example:

- `Error: Missing required parameter: file`
- `Error: File is outside the vault: ...`
- `Error: Not a Markdown note: ...`
- `Error: Note not found in the vault: ...`

## Notes

- Rendering of `dataview` and `tasks` blocks needs the Dataview / Tasks plugins enabled; otherwise the blocks stay as source (the reason is listed in `export-report.md` when files are written).
- The settings **Expand note embeds**, **Include properties**, **Include source path comments** and **Copy attachments** apply to the CLI as well.
- Do not forget to actuate page-renderer-user-instruction.md after code changes
