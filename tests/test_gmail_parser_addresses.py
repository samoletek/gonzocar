import unittest
from email.message import EmailMessage

from app.services.gmail_parser import ZelleParser, parse_email


class GmailParserAddressTests(unittest.TestCase):
    @staticmethod
    def _raw_email(from_addr: str, subject: str, body: str) -> bytes:
        msg = EmailMessage()
        msg["From"] = from_addr
        msg["To"] = "gonzobilling@gmail.com"
        msg["Subject"] = subject
        msg.set_content(body)
        return msg.as_bytes()

    def test_zelle_can_parse_direct_chase_sender(self):
        self.assertTrue(
            ZelleParser.can_parse(
                "Chase <no.reply.alerts@chase.com>",
                "You received money with Zelle®",
            )
        )

    def test_zelle_can_parse_forwarded_gonzocar_sender(self):
        self.assertTrue(
            ZelleParser.can_parse(
                "Ashwood Holdings <payashwood@gonzocar.com>",
                "Fwd: You received money with Zelle®",
            )
        )

    def test_zelle_ignores_non_zelle_subject(self):
        self.assertFalse(
            ZelleParser.can_parse(
                "Ashwood Holdings <payashwood@gonzocar.com>",
                "Monthly report",
            )
        )

    def test_forwarded_non_zelle_sender_can_parse_venmo_subject(self):
        raw = self._raw_email(
            from_addr="Gonzo Pay <gonzopay@gonzocar.com>",
            subject="Jonathan Johnson paid you $600.00",
            body="Payment notification",
        )
        parsed = parse_email(raw)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.source, "venmo")
        self.assertEqual(parsed.sender_name, "Jonathan Johnson")
        self.assertEqual(parsed.amount, 600.0)

    def test_cashapp_payment_received_ignores_placeholder_transaction_id(self):
        raw = self._raw_email(
            from_addr="Cash App <cash@square.com>",
            subject="Payment received",
            body="You were sent $120 by Riva D Brewer. Memo: car payment #000000",
        )
        parsed = parse_email(raw)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.source, "cashapp")
        self.assertEqual(parsed.amount, 120.0)
        self.assertEqual(parsed.sender_name, "Riva D Brewer")
        self.assertIsNone(parsed.transaction_id)


if __name__ == "__main__":
    unittest.main()
