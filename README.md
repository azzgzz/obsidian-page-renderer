# Page Renderer

Export single notes, entire folders, or hand-picked files to Markdown with rendered `dataview`, `dataviewjs` and `tasks` query results. Supports batch export with directory structure preservation.

## Features

- **Batch export** — export an entire folder or selected files at once, preserving directory structure
- **Embed expansion** — note embeds (`![[Note]]`, `![[Note#Heading]]`) are inlined into exports, with cycle detection and a depth limit
- **Rendered query results** — `dataview`, `dataviewjs` and `tasks` code blocks are replaced by their rendered results (tables, lists, task lists as Markdown); a query with an empty result becomes a single `-` line; a block that cannot be rendered stays as source and is listed in the export report
- **Properties kept** — the note's properties (YAML frontmatter) stay at the top of the file; notes without properties get no properties block
- **Clickable links** — links to notes that are not part of the export (including Tasks backlinks) become standard Markdown links with the path from the vault root, so they stay clickable
- **Attachments** — one `.md` file per source note plus a shared `assets/` directory, with attachments copied and links rewritten
- **Progress bar with cancel** — visual progress indicator for every export, with a cancel button that preserves already-exported files

## Usage

Multiple ways to start an export:

| Entry point | How |
|-------------|-----|
| Sidebar icon | Click the export icon in the left sidebar |
| Right-click a file | File explorer → right-click a Markdown file → "Export this file" |
| Right-click a folder | File explorer → right-click a folder → "Export this folder" |
| Right-click in editor | Right-click inside a note → "azz-export" |
| Command palette | `Cmd/Ctrl+P` → "Export documents" |

### Export dialog

1. Choose **source** — current file, folder, or selected files
2. Set **output folder** — type a path, click **Vault** to pick from vault folders, or **Choose folder** to select a system folder (desktop only)
3. Set **file name** (single file) or **folder name** (batch export) — defaults to the source file or folder name
4. Click **Next** → review the summary → click **Export**

A progress bar appears during export showing the current step or file. Click **Cancel** to stop; already-exported files are kept.

## Examples

### Export the current note

1. Open a note → right-click → **azz-export**
2. Click **Next** → **Export**
3. Result: `exports/<filename>.md` + `assets/` (if images exist)

### Export a folder

1. Right-click a folder → **Export this folder**
2. Click **Next** → **Export**
3. Result: `exports/<foldername>/<filename>.md` per note, keeping the directory structure, + `assets/` (if images exist)

### Export selected files

1. Start an export from sidebar icon or command palette
2. Source: **Selected files** → pick files
3. Click **Next** → **Export**
4. Result: one `.md` per file with a shared `assets/`

## CLI

With Obsidian 1.12.2+ and **Settings → General → Command line interface** enabled, a note can be exported from the terminal (Obsidian must be running):

```bash
obsidian azz-export file="$VAULT/note.md"
```

By default the command prints the exported Markdown to stdout and creates no files, so it can be redirected: `obsidian azz-export file="$VAULT/note.md" > note.md`. Attachments (images) are not copied in this mode; links to them keep pointing at `assets/...`.

With `printToFile=true` it writes the document (plus `assets/`) into the output folder from the plugin settings (`exports` by default), replaces previous output, and prints a short summary with the created paths.

Parameters are passed as `key=value` (`--file` is not supported). To target a specific vault, add `vault=<name>` before the command: `obsidian vault=MyVault azz-export file="..."`.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `file` | Markdown note: absolute path or path inside the vault (required) | — |
| `printToFile` | `true` writes files to the output folder; `false` prints the Markdown to stdout | `false` |
| `output` | Output folder, vault-relative or absolute (only with `printToFile=true`) | Output folder from the plugin settings |
| `overwrite` | `false` writes into a new timestamped folder instead of replacing output (only with `printToFile=true`) | `true` |

## Settings

Open **Settings → Page Renderer**. All settings are indexed and searchable from Obsidian's settings search (Obsidian 1.13+).

| Setting | Description | Default |
|---------|-------------|---------|
| Output folder | Where exported files are saved | `exports` |
| Expand note embeds | Inline `![[Note]]` embeds into exported documents | On |
| Include source path comments | Add an HTML comment with the source note's path under the title | Off |
| Include properties | Keep the note's properties (YAML frontmatter) at the top of the exported file; notes without properties get none | On |
| Copy attachments | Copy referenced images and files into the export | On |
| Overwrite existing exports | Replace existing export files when enabled. When disabled and the destination already exists, the export uses a new timestamped folder for its documents, attachments and report. "Destination" means the selected root for a single note and the batch leaf for folder/selected-file exports — including an existing empty destination. No source folder or previous export is moved or changed; only the new export's destination changes. | Off |

## Rendering

`dataview`, `dataviewjs` and `tasks` blocks are rendered by Obsidian and converted back to Markdown (tables, lists, task lists). Exact visual parity with Obsidian is not promised.

| | |
|---|---|
| Local images | Copied to `assets/`, links rewritten relative |
| Non-image attachments | Copied to `assets/`, links rewritten relative |
| Links between exported notes | Rewritten relative |
| Links to notes outside the export | Point to vault paths and only work where the exported file sits in that vault |
| Platforms | Desktop, mobile |

## Limitations

- Block-reference embeds (`![[Note#^block]]`) are not expanded
- Needs the Dataview / Tasks plugin enabled for their blocks to be rendered; otherwise the blocks stay as source and are listed in the export report
- Inline queries (`` `= expr` ``) are not evaluated
- Canvas files are not supported

## Privacy

All processing happens locally. The only network activity is fetching remote resources referenced by the note itself during export rendering (for example `http(s)` images); exported documents keep those references, so a browser or reader opening them may load the same resources. No telemetry is collected and no document content is sent to any external service.

## Installation

Search "Page Renderer" in **Settings → Community plugins → Browse** and click Install.

### Manual installation

Copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/page-md-renderer/` directory.

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm test         # run tests
```

## License

MIT
