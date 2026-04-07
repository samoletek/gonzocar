import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.billing import is_charge_window, normalize_weekly_due_day, weekday_name_in_chicago


class BillingHelperTests(unittest.TestCase):
    def test_normalize_weekly_due_day(self):
        self.assertEqual(normalize_weekly_due_day(" Monday "), "monday")
        self.assertEqual(normalize_weekly_due_day("SUNDAY"), "sunday")
        self.assertIsNone(normalize_weekly_due_day("funday"))

    def test_is_charge_window(self):
        tz = ZoneInfo("America/Chicago")
        self.assertTrue(is_charge_window(datetime(2026, 4, 7, 17, 0, tzinfo=tz), target_hour=17))
        self.assertFalse(is_charge_window(datetime(2026, 4, 7, 16, 59, tzinfo=tz), target_hour=17))

    def test_weekday_name_in_chicago_from_utc_naive(self):
        # 2026-04-08 00:30 UTC == 2026-04-07 19:30 Chicago (Tuesday)
        self.assertEqual(weekday_name_in_chicago(datetime(2026, 4, 8, 0, 30, 0)), "tuesday")


if __name__ == "__main__":
    unittest.main()
