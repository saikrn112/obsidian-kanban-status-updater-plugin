# Kanban Status Updater

Obsidian plugin that syncs kanban board columns to note frontmatter. Watches board files for changes and updates linked notes automatically.

## Features

- **Status sync** — dragging a card updates `status` frontmatter
- **Eisenhower quadrants** — four priority columns map to `status: backlog` with `urgent`/`important` flags
- **Auto-archive** — moves task notes to `tasks/archive/` when dragged to done/archive
- **Auto-unarchive** — moves notes back to `tasks/` when dragged out of done/archive

## Column Mapping

| Column | `status` | `urgent` | `important` |
|---|---|---|---|
| ⚪ Eliminate (NI & NU) | backlog | false | false |
| 🟠 Delegate (NI & U) | backlog | true | false |
| 🟡 Schedule (I & NU) | backlog | false | true |
| 🔴 Do First (I & U) | backlog | true | true |
| in-progress | in-progress | — | — |
| done | done | — | — |
| archive | archive | — | — |

## Install

```bash
cd /path/to/vault/.obsidian/plugins/
git clone git@github.com:saikrn112/obsidian-kanban-status-updater-plugin.git kanban-status-updater
cd kanban-status-updater
npm install && npm run build
```

Reload Obsidian, enable the plugin in Settings → Community Plugins.

## Settings

- **Status property name** — frontmatter key to update (default: `status`)
- **Show notifications** — toast on status change
- **Debug logging** — log to dev console
