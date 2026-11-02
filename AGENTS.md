# Agent instructions

- Read and follow [project conventions](docs/conventions.md) before making changes. Raise conflicts or unclear requirements instead of silently changing a convention.
- This is Teriak47's personal collection. External contributors may improve existing tools; initial implementations of new tools are reserved for the maintainer.
- Classify each tool by its main purpose and operation. Keep one physical location per tool and use metadata for additional classifications.
- Each tool has a `tool.yaml` and an English `README.md`. Keep existing translations and metadata current with related changes.
- Do not create placeholder tools or empty category directories. Review source material, third-party licences, sensitive data, and local paths before integrating an existing tool.
- Use English for technical identifiers, code, comments, documentation, commits, and pull requests. Root English and French READMEs must remain in sync.
- Work on a short-lived branch and use pull requests, Conventional Commits, and the complete tool ID as the scope; use `repo` for cross-project changes. Never push directly to `main`.
- Keep each tool's version independent. Releases are deliberate and require human approval; a merge does not automatically create a release.
- Choose checks appropriate to the changes and report what was and was not verified. Do not publish, create a remote repository, or change remote settings without authorization.
