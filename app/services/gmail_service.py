"""
Gmail API Service

Connects to Gmail API to fetch payment notification emails.
Requires OAuth credentials from Google Cloud Console.

For production (Railway):
    Set GMAIL_CREDENTIALS and GMAIL_TOKEN env variables as base64-encoded JSON.

For local development:
    Place credentials.json and token.json in project root.
"""

import os
import json
import base64
from datetime import datetime, timedelta
from typing import Optional, List
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# Gmail API scopes
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

# Payment provider senders
PAYMENT_SENDERS = [
    'no.reply.alerts@chase.com',  # Zelle
    'cash@square.com',             # CashApp
    'venmo@venmo.com',             # Venmo
    'alerts@account.chime.com',    # Chime
    'notifications@stripe.com',    # Stripe
]

# Recipient inboxes used for incoming payments
PAYMENT_INBOXES = [
    'payashwood@gonzocar.com',
    'paysilver@gonzocar.com',
    'payevergreen@gonzocar.com',
    'gonzopay@gonzocar.com',
]


def get_credentials_from_env():
    """Load credentials from environment variables (for production)."""
    creds_b64 = os.getenv('GMAIL_CREDENTIALS')
    token_b64 = os.getenv('GMAIL_TOKEN')
    
    if not creds_b64 or not token_b64:
        return None, None
    
    try:
        creds_json = base64.b64decode(creds_b64).decode('utf-8')
        token_json = base64.b64decode(token_b64).decode('utf-8')
        return json.loads(creds_json), json.loads(token_json)
    except Exception as e:
        print(f"Error decoding credentials from env: {e}")
        return None, None


class GmailService:
    """Gmail API wrapper for fetching payment emails."""
    
    def __init__(self, credentials_path: str = 'credentials.json', token_path: str = 'token.json'):
        self.credentials_path = credentials_path
        self.token_path = token_path
        self.service = None
        self._authenticate()
    
    def _authenticate(self):
        """Authenticate with Gmail API using OAuth."""
        creds = None
        
        # Try environment variables first (production)
        creds_data, token_data = get_credentials_from_env()
        
        if token_data:
            # Use credentials from env
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
        elif os.path.exists(self.token_path):
            # Fall back to file-based token (local development)
            creds = Credentials.from_authorized_user_file(self.token_path, SCOPES)
        
        # Refresh or get new credentials
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
                # Update token in env if using env-based auth
                if token_data:
                    print("Token refreshed. Update GMAIL_TOKEN env variable with new token.")
                    print(f"New token (base64): {base64.b64encode(creds.to_json().encode()).decode()}")
                else:
                    # Save refreshed token to file
                    with open(self.token_path, 'w') as token:
                        token.write(creds.to_json())
            else:
                # Need new credentials - only works locally
                if creds_data:
                    raise RuntimeError(
                        "Token expired and cannot refresh. "
                        "Run setup locally and update GMAIL_TOKEN env variable."
                    )
                
                if not os.path.exists(self.credentials_path):
                    raise FileNotFoundError(
                        f"credentials.json not found at {self.credentials_path}. "
                        "Download from Google Cloud Console."
                    )
                flow = InstalledAppFlow.from_client_secrets_file(
                    self.credentials_path, SCOPES
                )
                creds = flow.run_local_server(port=0)
            
                # Save token for next run
                with open(self.token_path, 'w') as token:
                    token.write(creds.to_json())
        
        self.service = build('gmail', 'v1', credentials=creds)
    
    def _build_query(self, since_hours: int = 1) -> str:
        """Build Gmail search query for payment emails."""
        # Time filter
        since = datetime.utcnow() - timedelta(hours=since_hours)
        date_str = since.strftime('%Y/%m/%d')
        
        # Build sender filter (OR between known payment providers)
        sender_queries = [f'from:{sender}' for sender in PAYMENT_SENDERS]
        recipient_queries = [f'to:{addr}' for addr in PAYMENT_INBOXES]
        delivered_queries = [f'deliveredto:{addr}' for addr in PAYMENT_INBOXES]
        address_filter = ' OR '.join(sender_queries + recipient_queries + delivered_queries)
        
        return f'({address_filter}) after:{date_str}'
    
    def fetch_emails(self, since_hours: int = 1, max_results: int = 50) -> List[dict]:
        """
        Fetch payment emails from the last N hours.
        
        Args:
            since_hours: Look back this many hours
            max_results: Maximum emails to fetch
        
        Returns:
            List of email data dicts with id, raw content, and metadata
        """
        if not self.service:
            raise RuntimeError("Gmail service not authenticated")
        
        query = self._build_query(since_hours)
        
        try:
            # Search for emails
            results = self.service.users().messages().list(
                userId='me',
                q=query,
                maxResults=max_results
            ).execute()
            
            messages = results.get('messages', [])
            emails = []
            
            for msg in messages:
                email_data = self._get_email_content(msg['id'])
                if email_data:
                    emails.append(email_data)
            
            return emails
            
        except Exception as e:
            print(f"Error fetching emails: {e}")
            return []
    
    def _get_email_content(self, message_id: str) -> Optional[dict]:
        """Fetch full email content by message ID."""
        try:
            message = self.service.users().messages().get(
                userId='me',
                id=message_id,
                format='raw'
            ).execute()
            
            # Decode raw email
            raw_email = base64.urlsafe_b64decode(message['raw'].encode('ASCII'))
            
            return {
                'gmail_id': message_id,
                'raw': raw_email,
                'internal_date': message.get('internalDate'),
            }
            
        except Exception as e:
            print(f"Error fetching email {message_id}: {e}")
            return None
    
    def get_email_by_id(self, message_id: str) -> Optional[bytes]:
        """Get raw email bytes by Gmail message ID."""
        data = self._get_email_content(message_id)
        return data['raw'] if data else None


def setup_oauth():
    """
    Interactive setup for Gmail OAuth.
    Run this once to authorize and generate token.json.
    """
    print("Gmail OAuth Setup")
    print("=" * 40)
    print()
    print("Prerequisites:")
    print("1. Create a project in Google Cloud Console")
    print("2. Enable the Gmail API")
    print("3. Create OAuth 2.0 credentials (Desktop app)")
    print("4. Download credentials.json to project root")
    print()
    
    credentials_path = input("Path to credentials.json [credentials.json]: ").strip()
    if not credentials_path:
        credentials_path = 'credentials.json'
    
    if not os.path.exists(credentials_path):
        print(f"Error: {credentials_path} not found")
        return
    
    try:
        service = GmailService(credentials_path=credentials_path)
        print()
        print("Success! OAuth token saved to token.json")
        print("You can now use the Gmail service to fetch emails.")
        
        # Test connection
        profile = service.service.users().getProfile(userId='me').execute()
        print(f"Connected to: {profile.get('emailAddress')}")
        
        # Show base64 for Railway
        print()
        print("For Railway deployment, set these env variables:")
        with open(credentials_path, 'r') as f:
            print(f"GMAIL_CREDENTIALS={base64.b64encode(f.read().encode()).decode()}")
        with open('token.json', 'r') as f:
            print(f"GMAIL_TOKEN={base64.b64encode(f.read().encode()).decode()}")
        
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    setup_oauth()
