# Page Renderer: CLI quick guide

## What it does

The `page-md-renderer` command exports **one Markdown note** from the terminal. Obsidian renders the note, so `dataview`, `dataviewjs` and `tasks` blocks are replaced by their results (tables, lists, task lists) as plain Markdown. Note embeds (`![[Note]]`) are inlined and links are rewritten, according to the plugin settings (**Settings → Page Renderer**).

Folders and selections of several notes are exported from the Obsidian UI only.

## Requirements

- Obsidian 1.12.2+ is running.
- **Settings → General → Command line interface** is enabled.
- The Page Renderer plugin is enabled.

## Usage

```bash
obsidian page-md-renderer file="<path to note>"
```

To target a specific vault, put `vault=<name>` before the command:

```bash
obsidian vault=MyVault page-md-renderer file="folder/note.md"
```

Parameters are passed as `key=value`.

| Parameter | Meaning | Default |
|-----------|---------|---------|
| `file` | Note path: vault-relative or absolute inside the vault. Must end with `.md` (required) | — |
| `printToFile` | `true` writes files to the output folder; otherwise the result is printed to stdout | `false` |
| `output` | Output folder, vault-relative or absolute (only with `printToFile=true`) | Output folder from the plugin settings |
| `overwrite` | `false` writes into a new timestamped folder instead of replacing the previous output (only with `printToFile=true`) | `true` |

## Two modes

### 1. Print to stdout (default)

```bash
obsidian page-md-renderer file="Projects/report.md"
obsidian page-md-renderer file="Projects/report.md" > report.md
```

- **Result**: the exported Markdown in the terminal; redirect it to a file with `>`.
- Nothing is created in the vault.
- Attachments are not copied; links to images keep pointing at `assets/...`.
- Warnings are not shown in this mode. To see them, use `printToFile=true`.

### 2. Write files (`printToFile=true`)

```bash
obsidian page-md-renderer file="Projects/report.md" printToFile=true
obsidian page-md-renderer file="Projects/report.md" printToFile=true output=exports/reports
obsidian page-md-renderer file="Projects/report.md" printToFile=true overwrite=false
```

- **Result**: files in the output folder (vault-relative `output` is inside your vault, an absolute path is a folder on disk):
  - `<output>/<note name>.md` — the exported note;
  - `<output>/assets/` — copied images and other attachments (if the note has any);
  - `<output>/export-report.md` — appears only when the export had warnings or errors (unrendered query block, unresolved link, missing attachment, ...).
- The command prints a short summary, for example `Export complete: 1/1 file(s) complete — <output folder>`, followed by the paths of the created files. If there is a report, its path is shown after `Details:`.
- With `overwrite=true` (default) the previous output is replaced. With `overwrite=false`, if the destination already exists, the export goes into a new folder `<output>-<timestamp>` and earlier output is left untouched.

## Errors

Errors are printed as a line starting with `Error:`, for example:

- `Error: Missing required parameter: file`
- `Error: File is outside the vault: ...`
- `Error: Not a Markdown note: ...`
- `Error: Note not found in the vault: ...`

## Notes

- Rendering of `dataview` and `tasks` blocks needs the Dataview / Tasks plugins enabled; otherwise the blocks stay as source (the reason is listed in `export-report.md` with `printToFile=true`).
- The settings **Expand note embeds**, **Include properties**, **Include source path comments** and **Copy attachments** apply to the CLI as well.
- Do not forget to actuate page-renderer-user-instruction.md after code changes
