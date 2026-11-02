import tempfile
import unittest
from pathlib import Path

from scripts.validate_tools import TITLE, validate


VALID = """\
id: t47-example
name: Example
description: Inspect data.
version: 0.1.0
author: Teriak47
classification:
  family: data
  category: inspection
technologies: [html, javascript]
execution:
  type: browser
  entrypoint: index.html
"""


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def tool(self, metadata=VALID, category="inspection", name="t47-example"):
        tool = self.root / "data" / category / name
        tool.mkdir(parents=True)
        (tool / "README.md").write_text("Example", encoding="utf-8")
        (tool / "index.html").write_text("Example", encoding="utf-8")
        (tool / "tool.yaml").write_text(metadata, encoding="utf-8")
        return tool

    def test_empty_collection_is_valid(self):
        self.assertEqual(validate(self.root), [])

    def test_valid_tool(self):
        self.tool()
        self.assertEqual(validate(self.root), [])

    def test_missing_readme_and_invalid_name(self):
        tool = self.tool(name="example")
        (tool / "README.md").unlink()
        errors = "\n".join(validate(self.root))
        self.assertIn("README.md is missing", errors)
        self.assertIn("directory name", errors)

    def test_unknown_fields_invalid_modes_and_duplicate_values(self):
        self.tool(VALID.replace("technologies: [html, javascript]", "technologies: [html, html]\nunknown: true").replace("type: browser", "type: remote"))
        errors = "\n".join(validate(self.root))
        self.assertIn("unknown field", errors)
        self.assertIn("duplicate", errors)
        self.assertIn("approved mode", errors)

    def test_yaml_duplicate_keys_are_rejected(self):
        self.tool(VALID + "name: Duplicate\n")
        self.assertIn("unique strings", "\n".join(validate(self.root)))

    def test_entrypoint_cannot_escape(self):
        self.tool(VALID.replace("entrypoint: index.html", "entrypoint: ../../outside"))
        self.assertIn("inside the tool", "\n".join(validate(self.root)))

    def test_invalid_location_version_and_metadata(self):
        self.tool(VALID.replace("version: 0.1.0", "version: 01.1.0"), category="analysis")
        errors = "\n".join(validate(self.root))
        self.assertIn("unknown category", errors)
        self.assertIn("outside an approved", errors)

    def test_version_and_classification_mismatch(self):
        self.tool(VALID.replace("version: 0.1.0", "version: 01.1.0").replace("family: data", "family: network"))
        errors = "\n".join(validate(self.root))
        self.assertIn("version must", errors)
        self.assertIn("classification must match", errors)

    def test_duplicate_id_across_categories(self):
        self.tool()
        self.tool(VALID.replace("category: inspection", "category: validation"), category="validation")
        self.assertIn("duplicate tool ID", "\n".join(validate(self.root)))

    def test_title(self):
        self.assertTrue(TITLE.fullmatch("feat(t47-example): add search"))
        self.assertTrue(TITLE.fullmatch("fix(repo)!: remove legacy support"))
        for title in ("feat: add search", "Fix(repo): search", "feat(foo): search", "feat(repo): "):
            self.assertFalse(TITLE.fullmatch(title), title)


if __name__ == "__main__":
    unittest.main()
