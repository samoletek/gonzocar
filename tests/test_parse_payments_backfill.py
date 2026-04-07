from datetime import datetime, timedelta, timezone
import unittest

from scripts.parse_payments import _is_reliable_transaction_id, compute_backfill_hours


class ParsePaymentsBackfillTests(unittest.TestCase):
    def test_backfill_hours_respects_minimum(self):
        recent = datetime.utcnow() - timedelta(minutes=10)
        self.assertGreaterEqual(compute_backfill_hours(recent, min_hours=1, safety_hours=1), 1)

    def test_backfill_hours_grows_with_gap(self):
        older = datetime.utcnow() - timedelta(hours=23, minutes=5)
        hours = compute_backfill_hours(older, min_hours=1, safety_hours=1)
        self.assertGreaterEqual(hours, 24)

    def test_backfill_hours_handles_tz_aware_datetime(self):
        aware = datetime.now(timezone.utc) - timedelta(hours=2, minutes=1)
        hours = compute_backfill_hours(aware, min_hours=1, safety_hours=1)
        self.assertGreaterEqual(hours, 3)

    def test_transaction_id_reliability_filters_placeholders(self):
        self.assertFalse(_is_reliable_transaction_id(None))
        self.assertFalse(_is_reliable_transaction_id(""))
        self.assertFalse(_is_reliable_transaction_id("000000"))
        self.assertFalse(_is_reliable_transaction_id("0"))
        self.assertTrue(_is_reliable_transaction_id("pi_123abc"))


if __name__ == "__main__":
    unittest.main()
