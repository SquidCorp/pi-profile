# pi-profile

Pi package for independent agent profiles. Default setup stays in `~/.pi/agent`. Each directory under `~/.pi/agent/profiles/<id>/` is a separate overlay.

Runtime matches Rune’s profile extension (directory overlay, `--profile`, `/profile`, SYSTEM.md replace) without graphs, glyphs, or per-profile extensions.

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
  settings.json     on disk only; this package does not load it
  models.json       on disk only; this package does not load it
  mcp.json          on disk only; this package does not load it
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
| `description` | Optional blurb; stored only, not injected into the prompt |
| `model` | `provider/id`, or a unique model id that contains `/` (OpenRouter-style) |
| `thinkingLevel` | `off` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max` |

Missing fields keep Default Pi values.

### `SYSTEM.md`

If present and non-empty, its contents **replace** the system prompt for every turn. Edit the file to tweak; the next turn (or `/reload`) picks it up.

## Limits

Pi loads `~/.pi/agent/settings.json` and `models.json` before extensions. This package does not replace those files. Profile `extensions/` are not loaded. Sessions stay shared with Default.

## License

MIT
