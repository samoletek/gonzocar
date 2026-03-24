import base64
import json
import os
import unittest
from unittest.mock import patch

from app.services.gmail_service import get_credentials_from_env


class GmailServiceEnvTests(unittest.TestCase):
    def test_accepts_base64_encoded_env(self):
        creds = {"installed": {"client_id": "client-123"}}
        token = {"refresh_token": "refresh-123", "client_id": "client-123"}

        with patch.dict(
            os.environ,
            {
                "GMAIL_CREDENTIALS": base64.b64encode(json.dumps(creds).encode()).decode(),
                "GMAIL_TOKEN": base64.b64encode(json.dumps(token).encode()).decode(),
            },
            clear=False,
        ):
            parsed_creds, parsed_token = get_credentials_from_env()

        self.assertEqual(parsed_creds, creds)
        self.assertEqual(parsed_token, token)

    def test_accepts_raw_json_env(self):
        creds = {"installed": {"client_id": "client-raw"}}
        token = {"refresh_token": "refresh-raw", "client_id": "client-raw"}

        with patch.dict(
            os.environ,
            {
                "GMAIL_CREDENTIALS": json.dumps(creds),
                "GMAIL_TOKEN": json.dumps(token),
            },
            clear=False,
        ):
            parsed_creds, parsed_token = get_credentials_from_env()

        self.assertEqual(parsed_creds, creds)
        self.assertEqual(parsed_token, token)

    def test_invalid_env_returns_none(self):
        with patch("builtins.print"):
            with patch.dict(
                os.environ,
                {
                    "GMAIL_CREDENTIALS": "not-valid",
                    "GMAIL_TOKEN": "still-not-valid",
                },
                clear=False,
            ):
                parsed_creds, parsed_token = get_credentials_from_env()

        self.assertIsNone(parsed_creds)
        self.assertIsNone(parsed_token)


if __name__ == "__main__":
    unittest.main()
