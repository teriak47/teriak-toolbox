"""Validate the collection's metadata and layout without running tool code."""

import re
import os
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath

import yaml

TAXONOMY = {
    "data": {"inspection", "conversion", "extraction", "validation", "comparison", "generation", "visualization"},
    "system": {"monitoring", "diagnostics", "management", "maintenance"},
    "network": {"diagnostics", "analysis", "monitoring", "testing"},
    "security": {"detection", "forensics", "auditing", "testing"},
    "development": {"debugging", "testing", "generation", "validation"},
    "automation": {"workflows", "scheduling", "integration", "batch-processing"},
    "media": {"conversion", "analysis", "processing", "generation", "rating"},
}
ID = re.compile(r"t47-[a-z0-9]+(?:-[a-z0-9]+)*\Z")
VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")
TITLE = re.compile(r"(?:feat|fix|docs|refactor|test|perf|style|build|ci|chore)\((?:repo|t47-[a-z0-9]+(?:-[a-z0-9]+)*)\)!?: \S(?:.*\S)?\Z")
MODES = {"browser", "cli", "desktop", "library", "other"}


class UniqueLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str) or key in result:
            raise ValueError("mapping keys must be unique strings")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def validate_tool(path, family, category):
    errors = []

    def error(message):
        errors.append(f"{path}: {message}")

    def mapping(value, required, allowed, label):
        if not isinstance(value, dict):
            error(f"{label} must be a mapping")
            return False
        for key in sorted(required - value.keys()):
            error(f"{label}: missing {key}")
        for key in sorted(value.keys() - allowed):
            error(f"{label}: unknown field {key}")
        return True

    def string(value, label):
        if not isinstance(value, str) or not value.strip():
            error(f"{label} must be a non-empty string")
            return False
        return True

    def values(value, label, lowercase=False):
        if not isinstance(value, list) or not value:
            error(f"{label} must be a non-empty list")
            return
        seen = set()
        for item in value:
            if not string(item, label):
                continue
            if item != item.strip() or (lowercase and item != item.lower()):
                error(f"{label} contains an invalid value: {item!r}")
            if item in seen:
                error(f"{label} contains a duplicate: {item!r}")
            seen.add(item)

    if not ID.fullmatch(path.name):
        error("directory name must be a t47- tool ID")
    if not (path / "README.md").is_file():
        error("README.md is missing")
    try:
        with (path / "tool.yaml").open(encoding="utf-8") as stream:
            doc = yaml.load(stream, Loader=UniqueLoader)
    except (OSError, UnicodeError, ValueError, yaml.YAMLError) as exc:
        error(f"cannot read tool.yaml: {exc}")
        return errors, None
    required = {"id", "name", "description", "version", "author", "classification", "technologies"}
    if not mapping(doc, required, required | {"formats", "execution"}, "root"):
        return errors, None
    for key in ("id", "name", "description", "version", "author"):
        if key in doc:
            string(doc[key], key)
    tool_id = doc.get("id")
    if isinstance(tool_id, str) and (not ID.fullmatch(tool_id) or tool_id != path.name):
        error("id must match the t47- directory name")
    version = doc.get("version")
    if isinstance(version, str) and not VERSION.fullmatch(version):
        error("version must be MAJOR.MINOR.PATCH without leading zeroes")
    classification = doc.get("classification")
    if mapping(classification, {"family", "category"}, {"family", "category", "domains"}, "classification"):
        if classification.get("family") != family or classification.get("category") != category:
            error("classification must match the tool's family and category directories")
        if "domains" in classification:
            values(classification["domains"], "classification.domains", True)
    for key in ("technologies", "formats"):
        if key in doc:
            values(doc[key], key, True)
    if "execution" in doc and mapping(doc["execution"], {"type"}, {"type", "entrypoint", "dependencies"}, "execution"):
        execution = doc["execution"]
        if not isinstance(execution.get("type"), str) or execution["type"] not in MODES:
            error("execution.type is not an approved mode")
        if "dependencies" in execution:
            values(execution["dependencies"], "execution.dependencies")
        if "entrypoint" in execution and string(execution["entrypoint"], "execution.entrypoint"):
            entry = execution["entrypoint"]
            posix, windows = PurePosixPath(entry), PureWindowsPath(entry)
            target = (path / entry).resolve()
            if (posix.is_absolute() or windows.is_absolute() or windows.drive or ".." in posix.parts
                    or ".." in windows.parts or not target.is_relative_to(path.resolve()) or not target.is_file()):
                error("execution.entrypoint must be an existing file inside the tool")
    return errors, tool_id if isinstance(tool_id, str) else None


def validate(root):
    errors, seen, tools = [], set(), []
    for family, categories in TAXONOMY.items():
        family_path = root / family
        if not family_path.exists():
            continue
        if not family_path.is_dir() or family_path.is_symlink():
            errors.append(f"{family_path}: family must be a real directory")
            continue
        for category_path in family_path.iterdir():
            if not category_path.is_dir() or category_path.is_symlink() or category_path.name not in categories:
                errors.append(f"{category_path}: unknown category or non-directory")
                continue
            for path in category_path.iterdir():
                if not path.is_dir() or path.is_symlink():
                    errors.append(f"{path}: tool must be a real directory")
                    continue
                tools.append(path)
                found, tool_id = validate_tool(path, family, category_path.name)
                errors.extend(found)
                if tool_id in seen:
                    errors.append(f"{path}: duplicate tool ID {tool_id}")
                if tool_id:
                    seen.add(tool_id)
    # Detect metadata or tool-shaped directories outside the approved layout.
    for directory, dirs, files in os.walk(root, followlinks=False):
        current = Path(directory)
        if current in tools:
            dirs[:] = []
            continue
        dirs[:] = [name for name in dirs if name not in {".git", ".venv", "node_modules", "__pycache__"}]
        if "tool.yaml" in files:
            errors.append(f"{current / 'tool.yaml'}: metadata outside an approved tool directory")
        for name in dirs:
            path = current / name
            if name.startswith("t47-") and path not in tools:
                errors.append(f"{path}: tool-like directory outside an approved location")
    return errors


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--title":
        if TITLE.fullmatch(sys.argv[2]):
            print("Pull request title: valid")
            return 0
        print("Pull request title must use type(scope): description", file=sys.stderr)
        return 1
    if len(sys.argv) != 1:
        print("Usage: validate_tools.py [--title TITLE]", file=sys.stderr)
        return 2
    errors = validate(Path(__file__).resolve().parent.parent)
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    print("Tool metadata and layout: valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
