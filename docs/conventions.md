# Project conventions

These conventions describe the agreed initial framework. Repository validation is prepared locally; GitHub checks only run after publication. Targeted tool tests, branch protection, and release automation remain to be configured.

## Identity and structure

The project is a personal collection maintained by Teriak47. Each tool has a unique ID and directory name: `t47-` followed by descriptive English words in lowercase kebab-case. IDs describe the tool's function rather than the course, placement, or project that inspired it. Display names are readable and need not use the prefix. Do not put versions in directory names.

Store each tool once, at `<family>/<category>/<tool-id>/`. Select the family by the tool's main purpose, then the category by its main operation. Use metadata for additional domains, technologies, and formats. Add a family or category only when existing choices do not fit, after defining its scope and avoiding duplication. Do not create empty category directories or fictitious tools.

Initial taxonomy:

| Family | Initial categories |
| --- | --- |
| `data` | `inspection`, `conversion`, `extraction`, `validation`, `comparison`, `generation` |
| `system` | `monitoring`, `diagnostics`, `management`, `maintenance` |
| `network` | `diagnostics`, `analysis`, `monitoring`, `testing` |
| `security` | `detection`, `forensics`, `auditing`, `testing` |
| `development` | `debugging`, `testing`, `generation`, `validation` |
| `automation` | `workflows`, `scheduling`, `integration`, `batch-processing` |
| `media` | `conversion`, `analysis`, `processing`, `generation` |

`data` covers generic manipulation or understanding of data; `system` covers system operation, state, or administration; `network` covers communications; and `security` covers a primary security purpose such as detection, auditing, or investigation. For example, a generic log analyser belongs in `data`, whereas a log-based indicator-of-compromise detector belongs in `security`.

For overlapping operations, use these distinctions:

- `inspection`: examine or explore content or structure.
- `analysis`: interpret data to derive patterns, relationships, or results.
- `diagnostics`: investigate the cause or state of a particular problem.
- `monitoring`: observe state or measurements over time.
- `testing`: actively check behaviour against a defined objective.
- `validation`: check conformity to rules or an expected format.

## Tool contents and metadata

Every tool has a `tool.yaml` and an English `README.md` at its root. Its internal structure is otherwise determined by its needs. The README explains the tool, features, and use; a French `README.fr.md` is optional. Keep existing translations up to date.

The agreed metadata fields are:

| Field | Requirement |
| --- | --- |
| `id` | Required; unique tool ID, matching the directory name. |
| `name` | Required; non-empty display name. |
| `description` | Required; short English description. |
| `version` | Required; independent `MAJOR.MINOR.PATCH` version. |
| `author` | Required; non-empty principal attribution. |
| `classification.family` | Required; matches the family directory. |
| `classification.category` | Required; matches the category directory. |
| `classification.domains` | Optional list of additional usage domains. |
| `technologies` | Required non-empty list of principal technologies. |
| `formats` | Optional list of supported data formats. |
| `execution` | Optional execution information; if present, `type` is required. |
| `execution.type` | One principal mode: `browser`, `cli`, `desktop`, `library`, or `other`. |
| `execution.entrypoint` | Optional relative path to an existing file inside the tool. |
| `execution.dependencies` | Optional list of relevant runtime dependencies; detailed instructions belong in the README. |

Use lowercase English values for domains, technologies, and formats; these vocabularies remain open. Omit optional fields when they do not apply. Avoid duplicate list entries. Unknown fields require an approved schema change. Creation provenance is optional and should only be documented when useful and publishable.

Execution types describe the main way a person uses or runs a tool, not its programming language:

- `browser`: used in a browser, including a local web interface.
- `cli`: primarily run as a terminal command.
- `desktop`: a native graphical or desktop application.
- `library`: primarily imported or called by another program.
- `other`: none of the above fits; explain it in the README.

Document additional modes in the README. For a local web interface, `browser` remains the primary mode even if a command starts a server first; document both steps. An entrypoint may identify that server's launch file.

The validator in `scripts/validate_tools.py` checks YAML and field types, required fields, version and ID format, unique IDs, directory consistency, mandatory files, duplicate list entries, and safe existing entrypoints inside the tool directory. Install `requirements-ci.txt`, then run `python scripts/validate_tools.py` and `python -m unittest discover -s tests -v`. Human review remains necessary for classification, descriptions, licensing, and sensitive information.

## Language and documentation

Use English for identifiers, directories, commits, pull requests, metadata, code, comments, and reference documentation. Issues and discussions may be in English or French. Maintain both root `README.md` and `README.fr.md`, each linking to the other, and keep them aligned.

## Git workflow

Use GitHub Flow: `main` is stable and protected; do not push directly to it. Create a temporary branch per coherent change, commit on that branch, and open a pull request for every change. Review the relevant checks and merge using squash and merge, then delete the temporary branch. There is no permanent `develop` branch.

Use Conventional Commits for working commits and pull request titles. Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `style`, `build`, `ci`, and `chore`. Use the complete tool ID as the scope, or `repo` for cross-project changes. Use `!` for a breaking change. Examples:

```text
feat(t47-json-inspector): add tree view
fix(t47-json-inspector): handle invalid JSON
ci(repo): add YAML validation workflow
```

Issues can be bugs, features, tasks, or proposals. An issue is useful for tracking or discussion but is not mandatory for each pull request.

## Versions and releases

Each tool has its own version; the repository has no global version. Start development at `0.1.0` and use `1.0.0` for a deliberately stable interface. Stable releases follow MAJOR / MINOR / PATCH semantics. A merge does not automatically create a release. Version changes go through a pull request; a human deliberately triggers the release and creates the tag on a `main` commit containing the published version. Tag format: `<tool-id>/v<version>`. Keep release notes concise; no per-tool changelog is mandatory. Archive format and automation remain to be decided.

## Safety and licensing

The project uses GPL v3. Review third-party licence compatibility and obligations before incorporating material. Never publish secrets, private placement logs, or third-party content without the necessary rights. Automated secret detection complements human review; it does not replace it.
