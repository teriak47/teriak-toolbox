# Zircolite SQL Generator

🌐 **Language:** English | [Français](README.fr.md)

Prepare SQL queries for investigating events in Zircolite Viewer. The interface is in French. The page runs locally without installation, an input file, a server, or automatic network access.

## Use

1. Open `index.html` in a modern browser.
2. Choose a query template and fill in its visible criteria. The included example uses fictional values.
3. Read the explanation and scope, then copy the SQL into **Zircolite Viewer → SQL** and run it there.
4. For event queries, open an `_zl_uid` link in the Viewer to inspect the associated JSON.

Templates cover Security 5145 share access, rule summaries and events, Sysmon process creation and related activity, Security 4624/4625 logons, and individual events. Times are entered in UTC: the start is inclusive and the end is exclusive. A row limit applies and does not guarantee exhaustive results.

## Scope and limitations

The tool generates SELECT queries for the Viewer's `events`, `hits`, and `rules` tables. It does not read log files, execute SQL, save input, or operate on the CLI engine's `logs` table. A template requires its fields to be present in the loaded package; check **SQL → Tables** in the Viewer if a column is unavailable. No results means no match in the selected data and scope, not proof of absence.

See the [official Zircolite Viewer documentation](https://github.com/wagga40/Zircolite/blob/master/docs/Viewer.md).

## Licence

This tool is part of Teriak Toolbox and is distributed under the repository's GPL v3 licence.
