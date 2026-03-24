import re
import unittest
from datetime import datetime, timezone

from app.services.gmail_service import GmailService, PAYMENT_INBOXES, PAYMENT_SENDERS


class GmailServiceQueryTests(unittest.TestCase):
    def test_build_query_uses_unix_timestamp(self):
        service = object.__new__(GmailService)
        query = GmailService._build_query(service, since_hours=3)

        match = re.search(r"after:(\d+)", query)
        self.assertIsNotNone(match)
        ts = int(match.group(1))

        now_ts = int(datetime.now(timezone.utc).timestamp())
        self.assertLessEqual(ts, now_ts)
        self.assertGreaterEqual(ts, now_ts - (4 * 3600))

    def test_build_query_keeps_sender_and_inbox_filters(self):
        service = object.__new__(GmailService)
        query = GmailService._build_query(service, since_hours=1)

        self.assertIn(f"from:{PAYMENT_SENDERS[0]}", query)
        self.assertIn(f"to:{PAYMENT_INBOXES[0]}", query)
        self.assertIn(f"deliveredto:{PAYMENT_INBOXES[0]}", query)


if __name__ == "__main__":
    unittest.main()
