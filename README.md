# pi-profile

Pi package for independent agent profiles. Default setup stays in `~/.pi/agent`. Each directory under `~/.pi/agent/profiles/<id>/` is a separate overlay.

Runtime matches Rune’s profile extension (directory overlay, `--profile`, `/profile`, SYSTEM.md replace) without graphs or glyphs. Profile `extensions/` are **unioned** with `~/.pi/agent/extensions/`.

This repo is the **overlay runtime only**. Profile data (`SYSTEM.md`, `profile.json`, extra skills) lives on each machine under `~/.pi/agent/profiles/` and is not distributed here.

## Install

On each machine with Pi:

```bash
pi install git:github.com/SquidCorp/pi-profile
```

From a local checkout (no copy):

```bash
pi install /absolute/path/to/pi-profile
```

Restart Pi or run `/reload`. Then:

```bash
pi --profile researcher
```

Update a git install with `pi update --extensions`.

## Usage

Inside Pi:

- `/profile` — print the current profile
- `/profile researcher` — new session, then apply that profile
- `/profile default` — new session, back to Default

No `--profile` means Default. The last used profile is not remembered across process restarts. Footer always shows `Profile: <display name>` (including Default). `default` is reserved.

## Profile layout

Same shape as default Pi. Missing files fall back to Default. Resource directories are **unioned** with Default.

```text
~/.pi/agent/profiles/researcher/
  profile.json      optional metadata (applied at runtime)
  SYSTEM.md         optional; replaces the system prompt when present
  skills/           extra skills
  prompts/          extra prompt templates
  themes/           extra themes
  extensions/       extra extensions (union with ~/.pi/agent/extensions)
  mcp.json          extra MCP servers (union with ~/.pi/agent/mcp.json)
  settings.json     on disk only; this package does not load it
  models.json       on disk only; this package does not load it
```

### `profile.json`

```json
{
  "name": "Researcher",
  "description": "Literature review and synthesis.",
  "model": "anthropic/claude-sonnet-4-5",
  "thinkingLevel": "high"
}
```

| Field | Meaning |
| --- | --- |
| `name` | Display name in footer and `/profile` |
| `description` | Optional blurb; shown in `/profile` completions, not injected into the prompt |
| `model` | `provider/id`, or a unique model id that contains `/` (OpenRouter-style) |
| `thinkingLevel` | `off` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max` |

Missing fields keep Default Pi values.

### `SYSTEM.md`

If present and non-empty, its contents **replace** the system prompt for every turn. Edit the file to tweak; the next turn (or `/reload`) picks it up.

### `extensions/`

Discovered the same way as Pi’s user extensions folder: `*.ts` / `*.js` files, plus one-level subdirectories with `index.ts` / `index.js` or a `package.json` `pi.extensions` list.

They register on the current session **in addition to** `~/.pi/agent/extensions/` and installed packages. Switching profile starts a new session, which reloads the extension runtime, so the previous profile’s extras go away. Default has no profile folder, so only the usual Pi extensions load.

### `mcp.json`

Same shape as `~/.pi/agent/mcp.json`. Servers are **merged** with the user and project files for that session: default servers stay connected, profile servers are registered on top.

If a profile repeats a name already in `~/.pi/agent/mcp.json` or `.pi/mcp.json` (including `-` vs `_`), the default entry is kept and Pi cannot override it from an extension. Use a new name for a profile-only server. `/profile` new-session drops the extras again.

## Limits

Pi loads `~/.pi/agent/settings.json` and `models.json` before extensions. This package does not replace those files. Sessions stay shared with Default.

## License

MIT
