import unittest
from datetime import datetime, timezone

from app.api.routes.drivers import _normalize_plate, _ranges_overlap, _to_utc_naive


class DriverHelperTests(unittest.TestCase):
    def test_normalize_plate(self):
        self.assertEqual(_normalize_plate(" il 123 ab "), "IL123AB")
        self.assertEqual(_normalize_plate(" ca-777 "), "CA-777")

    def test_ranges_overlap(self):
        start_a = datetime(2026, 3, 10, 10, 0, 0)
        end_a = datetime(2026, 3, 10, 14, 0, 0)
        start_b = datetime(2026, 3, 10, 13, 0, 0)
        end_b = datetime(2026, 3, 10, 15, 0, 0)
        self.assertTrue(_ranges_overlap(start_a, end_a, start_b, end_b))

    def test_ranges_no_overlap(self):
        start_a = datetime(2026, 3, 10, 10, 0, 0)
        end_a = datetime(2026, 3, 10, 11, 0, 0)
        start_b = datetime(2026, 3, 10, 11, 0, 0)
        end_b = datetime(2026, 3, 10, 12, 0, 0)
        self.assertFalse(_ranges_overlap(start_a, end_a, start_b, end_b))

    def test_to_utc_naive(self):
        aware = datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc)
        naive = _to_utc_naive(aware)
        self.assertIsNotNone(naive)
        self.assertEqual(naive.tzinfo, None)
        self.assertEqual(naive.hour, 12)


if __name__ == "__main__":
    unittest.main()
