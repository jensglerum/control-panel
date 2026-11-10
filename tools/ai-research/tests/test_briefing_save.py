import unittest

from save_briefing import validate_text


class BriefingValidationTests(unittest.TestCase):
    def test_preserves_complete_cited_synthesis(self):
        body = "# AI briefing\n\n" + "A documented announcement remains a published claim. " * 6
        body += "[Original source](https://openai.com/news/)\nReceipt: test-receipt\n"
        self.assertEqual(validate_text(body, "test-receipt"), body)

    def test_rejects_literal_shell_placeholder(self):
        with self.assertRaises(ValueError):
            validate_text("${content}", "test-receipt")

    def test_rejects_unbound_evidence(self):
        with self.assertRaisesRegex(ValueError, "receipt"):
            validate_text("A substantive briefing. " * 20 + "[Source](https://openai.com/news/)", "missing-receipt")

    def test_rejects_uncited_claims(self):
        with self.assertRaisesRegex(ValueError, "citation"):
            validate_text("A substantive briefing. " * 20 + " Receipt: test-receipt", "test-receipt")


if __name__ == "__main__":
    unittest.main()
