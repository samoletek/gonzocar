import unittest

from app.api.routes.applications import _extract_driver_profile


class ApplicationHelperTests(unittest.TestCase):
    def test_extract_driver_profile_from_nested_names(self):
        profile = _extract_driver_profile(
            {
                "names": {"first_name": "Tom", "last_name": "Ford"},
                "email": "tom@example.com",
                "phone": "+13125550000",
                "billing_type": "weekly",
                "billing_rate": "250",
            }
        )
        self.assertEqual(profile["first_name"], "Tom")
        self.assertEqual(profile["last_name"], "Ford")
        self.assertEqual(profile["billing_type"], "weekly")
        self.assertEqual(profile["billing_rate"], 250.0)

    def test_extract_driver_profile_uses_email_fallback(self):
        profile = _extract_driver_profile(
            {
                "email": "fallback_user@example.com",
                "billing_type": "monthly",
                "billing_rate": "oops",
            }
        )
        self.assertEqual(profile["first_name"], "fallback_user")
        self.assertEqual(profile["last_name"], "Driver")
        self.assertEqual(profile["billing_type"], "daily")
        self.assertEqual(profile["billing_rate"], 0.0)


if __name__ == "__main__":
    unittest.main()
