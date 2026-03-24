"""
Payment Email Parser Service

Parses payment notification emails from:
- Zelle (via Chase)
- CashApp (Square)
- Venmo
- Chime
- Stripe
"""

import re
import email
from email import policy
from email.parser import BytesParser
from datetime import datetime
from typing import Optional
from dataclasses import dataclass


@dataclass
class ParsedPayment:
    """Parsed payment data from email."""
    source: str  # zelle, cashapp, venmo, chime, stripe
    amount: float
    sender_name: str
    sender_identifier: Optional[str]  # email, phone, or username
    transaction_id: Optional[str]
    memo: Optional[str]
    received_at: datetime
    raw_email_id: Optional[str] = None


def decode_email_content(msg: email.message.Message) -> str:
    """Extract and decode email body (HTML preferred, then plain text)."""
    body = ""
    
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or 'utf-8'
                    body = payload.decode(charset, errors='replace')
                    break
            elif content_type == "text/plain" and not body:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or 'utf-8'
                    body = payload.decode(charset, errors='replace')
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or 'utf-8'
            body = payload.decode(charset, errors='replace')
    
    # Decode quoted-printable artifacts
    body = body.replace('=\r\n', '').replace('=\n', '')
    body = re.sub(r'=([0-9A-Fa-f]{2})', lambda m: chr(int(m.group(1), 16)), body)
    
    return body


def parse_email_date(msg: email.message.Message) -> datetime:
    """Parse email date header."""
    date_str = msg.get('Date', '')
    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(date_str)
    except Exception:
        return datetime.utcnow()


class ZelleParser:
    """Parse Zelle payment emails from Chase."""
    
    @staticmethod
    def can_parse(from_addr: str, subject: str) -> bool:
        return 'zelle' in subject.lower()
    
    @staticmethod
    def parse(msg: email.message.Message, body: str) -> Optional[ParsedPayment]:
        try:
            # 1. Sender name
            # Pattern A: "<h1>NAME sent you money"
            sender_match = re.search(r'<h1[^>]*>\s*([A-Za-z\s]+)\s+sent you money', body, re.IGNORECASE)
            
            # Pattern B: "You received $X from NAME"
            if not sender_match:
                sender_match = re.search(r'You received \$[\d,]+\.?\d* from ([A-Za-z\s]+)', body, re.IGNORECASE)
                
            sender_name = sender_match.group(1).strip().title() if sender_match else "Unknown"
            
            # 2. Amount
            # Pattern A: ">$XXX.XX</td>" in table
            amount_match = re.search(r'>\s*\$?([\d,]+\.?\d*)\s*</td>', body)
            
            # Pattern B: Plain text "$XXX.XX"
            if not amount_match:
                amount_match = re.search(r'Amount:?\s*\$?([\d,]+\.?\d*)', body, re.IGNORECASE)
                
            amount = float(amount_match.group(1).replace(',', '')) if amount_match else 0.0
            
            # 3. Transaction number
            tx_match = re.search(r'Transaction number</td>.*?>\s*(\d+)\s*</td>', body, re.DOTALL | re.IGNORECASE)
            if not tx_match:
                tx_match = re.search(r'Transaction number:?\s*(\d+)', body, re.IGNORECASE)
            transaction_id = tx_match.group(1) if tx_match else None
            
            # 4. Memo
            memo_match = re.search(r'Memo</td>.*?>\s*([^<]+)\s*</td>', body, re.DOTALL | re.IGNORECASE)
            if not memo_match:
                memo_match = re.search(r'Memo:?\s*([^\n<]+)', body, re.IGNORECASE)
                
            memo = memo_match.group(1).strip() if memo_match else None
            if memo and memo.lower() == 'n/a':
                memo = None
            
            # Validate
            if amount == 0.0 or sender_name == "Unknown":
                return None

            return ParsedPayment(
                source='zelle',
                amount=amount,
                sender_name=sender_name,
                sender_identifier=None,
                transaction_id=transaction_id,
                memo=memo,
                received_at=parse_email_date(msg)
            )
        except Exception as e:
            print(f"Zelle parse error: {e}")
            return None


class CashAppParser:
    """Parse CashApp payment emails from Square."""
    
    @staticmethod
    def can_parse(from_addr: str, subject: str) -> bool:
        return 'square.com' in from_addr.lower() or 'cash app' in from_addr.lower()
    
    @staticmethod
    def parse(msg: email.message.Message, body: str) -> Optional[ParsedPayment]:
        try:
            subject = msg.get('Subject', '')
            
            # Explicit Ignore Patterns
            if subject.lower().startswith("you sent"):
                return None
            if "privacy notice" in subject.lower():
                return None

            sender_name = "Unknown"
            amount = 0.0
            memo = None
            
            # 1. Parse Subject
            # Pattern A: "Name sent you $XX for note"
            match_a = re.search(r'(.+?)\s+sent you \$?([\d,]+\.?\d*)', subject, re.IGNORECASE)
            # Pattern B: "Cash App: You received $XX from Name"
            match_b = re.search(r'received \$?([\d,]+\.?\d*)\s+from\s+(.+)', subject, re.IGNORECASE)
            
            if match_a:
                sender_name = match_a.group(1).strip()
                amount = float(match_a.group(2).replace(',', ''))
                # Extract memo if present
                memo_match = re.search(r'sent you \$[\d,]+\.?\d*\s+for\s+(.+)$', subject, re.IGNORECASE)
                memo = memo_match.group(1).strip() if memo_match else None
            elif match_b:
                amount = float(match_b.group(1).replace(',', ''))
                # Name might have "for Note" at the end
                name_part = match_b.group(2).strip()
                if ' for ' in name_part:
                    name_parts = name_part.split(' for ', 1)
                    sender_name = name_parts[0].strip()
                    memo = name_parts[1].strip()
                else:
                    sender_name = name_part
            
            # 2. Parse Body (Fallback or "Payment received" subject)
            if amount == 0.0 or sender_name == "Unknown":
                # Pattern 1: "You were sent $120 by Riva D Brewer"
                body_match = re.search(r'You were sent \$([\d,]+\.?\d*) by ([^\.\n<]+)', body, re.IGNORECASE)
                
                # Pattern 2: "Riva D Brewer paid you $120"
                if not body_match:
                    body_match = re.search(r'([^\.\n<]+) paid you \$([\d,]+\.?\d*)', body, re.IGNORECASE)
                    if body_match:
                        # Swap groups for this pattern
                        amount = float(body_match.group(2).replace(',', ''))
                        sender_name = body_match.group(1).strip()
                
                if body_match and amount == 0.0:
                    amount = float(body_match.group(1).replace(',', ''))
                    sender_name = body_match.group(2).strip()

            # Clean up sender name if it captured "Cash App: " prefix
            if sender_name.lower().startswith('cash app:'):
                sender_name = sender_name[9:].strip()
            
            # 2.1 Extract Memo from Body if not found yet
            if not memo:
                # Look for "For car payment" in HTML or text
                # HTML often has: class="text-subtle profile-description"...>For car payment</td>
                memo_match = re.search(r'profile-description"[^>]*>\s*For\s+([^<]+)', body, re.IGNORECASE)
                if memo_match:
                    memo = memo_match.group(1).strip()
                else:
                    pass

            # 3. Transaction ID
            # Look for #D-XXXXXXXX
            tx_match = re.search(r'#([A-Z0-9-]{4,})', body)
            transaction_id = tx_match.group(1) if tx_match else None
            
            # Validate
            if amount == 0.0 or sender_name == "Unknown":
                return None
            
            return ParsedPayment(
                source='cashapp',
                amount=amount,
                sender_name=sender_name,
                sender_identifier=None,
                transaction_id=transaction_id,
                memo=memo,
                received_at=parse_email_date(msg)
            )
        except Exception as e:
            print(f"CashApp parse error: {e}")
            return None


class VenmoParser:
    """Parse Venmo payment emails."""
    
    @staticmethod
    def can_parse(from_addr: str, subject: str) -> bool:
        return 'venmo.com' in from_addr.lower()
    
    @staticmethod
    def can_parse_body(body: str) -> bool:
        return 'venmo' in body.lower()

    @staticmethod
    def parse(msg: email.message.Message, body: str) -> Optional[ParsedPayment]:
        try:
            subject = msg.get('Subject', '')
            
            # Explicit ignore
            if subject.lower().startswith("you paid"):
                return None

            sender_name = "Unknown"
            amount = 0.0
            
            # Pattern A: "Name paid you $XX.XX" (Subject)
            subj_match = re.search(r'(.+?)\s+paid you \$?([\d,]+\.?\d*)', subject, re.IGNORECASE)
            
            if subj_match:
                sender_name = subj_match.group(1).strip()
                amount = float(subj_match.group(2).replace(',', ''))
            
            # Transaction ID
            tx_match = re.search(r'Transaction ID[:\s<]+(\d+)', body, re.IGNORECASE)
            transaction_id = tx_match.group(1) if tx_match else None
            
            # Note/Memo
            memo = None
            
            # 1. HTML extraction (Priority)
            # Look for class="transaction-note"
            note_html = re.search(r'class="[^"]*transaction-note[^"]*"[^>]*>\s*([^<]+)', body)
            if note_html:
                memo = note_html.group(1).strip()
            
            # 2. Text/Subject Fallback
            if not memo:
                # Require "Note:" to be at separate line or start of text, not inside a word like "transaction-note"
                note_match = re.search(r'(?:^|[\n>])Note:\s*([^<]+)', body, re.IGNORECASE)
                if note_match:
                    memo = note_match.group(1).strip()

            # Validate
            if amount == 0.0 or sender_name == "Unknown":
                return None

            return ParsedPayment(
                source='venmo',
                amount=amount,
                sender_name=sender_name,
                sender_identifier=None,
                transaction_id=transaction_id,
                memo=memo,
                received_at=parse_email_date(msg)
            )
        except Exception as e:
            print(f"Venmo parse error: {e}")
            return None


class ChimeParser:
    """Parse Chime payment emails."""
    
    @staticmethod
    def can_parse(from_addr: str, subject: str) -> bool:
        return 'chime.com' in from_addr.lower()
    
    @staticmethod
    def parse(msg: email.message.Message, body: str) -> Optional[ParsedPayment]:
        try:
            subject = msg.get('Subject', '')
            sender_name = "Unknown"
            amount = 0.0
            memo = None
            
            # Subject: "Name just sent you money"
            subj_match = re.search(r'(.+?)\s+just sent you money', subject, re.IGNORECASE)
            if subj_match:
                sender_name = subj_match.group(1).strip()
            
            # Body: "received $XX.XX from Name"
            # Try to find amount first
            amount_match = re.search(r'received\s+\$?([\d,]+\.?\d*)', body, re.IGNORECASE)
            if amount_match:
                amount = float(amount_match.group(1).replace(',', ''))

            # Refine sender if unknown
            if sender_name == "Unknown":
                from_match = re.search(r'from\s+([A-Za-z\s]+)', body, re.IGNORECASE)
                if from_match:
                     clean_name = from_match.group(1).replace('through', '').strip()
                     sender_name = clean_name
            
            # Memo
            # Try HTML strong tag first: "for <strong>Car payment</strong>"
            memo_match = re.search(r'for\s+<strong[^>]*>([^<]+)</strong>', body, re.IGNORECASE)
            if memo_match:
                memo = memo_match.group(1).strip()
            else:
                # Fallback to text, but avoid HTML comments or long strings
                memo_match = re.search(r'for\s+([^<.\n]+)', body, re.IGNORECASE)
                if memo_match:
                    candidate = memo_match.group(1).strip()
                    if len(candidate) < 50 and 'transaction' not in candidate.lower() and '-->' not in candidate and 'most cases' not in candidate.lower():
                        memo = candidate
            
            # Validate
            if amount == 0.0 or sender_name == "Unknown":
                return None


            # Transaction ID - Fallback to Email Message-ID since Chime doesn't consistently provide one in body
            transaction_id = None
            msg_id = msg.get('Message-ID')
            if msg_id:
                # Clean up ID: <12345@domain> -> 12345@domain
                transaction_id = msg_id.strip('<>')

            return ParsedPayment(
                source='chime',
                amount=amount,
                sender_name=sender_name,
                sender_identifier=None,
                transaction_id=transaction_id,
                memo=memo,
                received_at=parse_email_date(msg)
            )
        except Exception as e:
            print(f"Chime parse error: {e}")
            return None


class StripeParser:
    """Parse Stripe payment emails."""
    
    @staticmethod
    def can_parse(from_addr: str, subject: str) -> bool:
        return 'stripe.com' in from_addr.lower()
    
    @staticmethod
    def parse(msg: email.message.Message, body: str) -> Optional[ParsedPayment]:
        try:
            subject = msg.get('Subject', '')
            sender_name = "Unknown"
            amount = 0.0
            
            # Subject: "Payment of $XXX.XX from Name"
            subj_match = re.search(r'Payment of \$?([\d,]+\.?\d*)\s+from\s+(.+)', subject, re.IGNORECASE)
            
            if subj_match:
                amount = float(subj_match.group(1).replace(',', ''))
                # Name might have "for Account"
                name_part = subj_match.group(2)
                if ' for ' in name_part:
                    sender_name = name_part.split(' for ', 1)[0].strip()
                else:
                    sender_name = name_part.strip()
            else:
                # Fallback to body scan
                amount_match = re.search(r'\$?([\d,]+\.?\d*)\s*USD', body)
                if amount_match:
                    amount = float(amount_match.group(1).replace(',', ''))

            # Transaction ID: pi_XXXX
            tx_match = re.search(r'(pi_[A-Za-z0-9]+)', body)
            transaction_id = tx_match.group(1) if tx_match else None
            
            # Validate
            if amount == 0.0 or sender_name == "Unknown":
                return None

            return ParsedPayment(
                source='stripe',
                amount=amount,
                sender_name=sender_name,
                sender_identifier=None,
                transaction_id=transaction_id,
                memo=None,
                received_at=parse_email_date(msg)
            )
        except Exception as e:
            print(f"Stripe parse error: {e}")
            return None


# Parser registry
PARSERS = [
    ZelleParser,
    CashAppParser,
    VenmoParser,
    ChimeParser,
    StripeParser,
]


def parse_email(raw_email: bytes) -> Optional[ParsedPayment]:
    """
    Parse a raw email (.eml) and extract payment information.
    
    Args:
        raw_email: Raw email bytes (from .eml file or Gmail API)
    
    Returns:
        ParsedPayment if successfully parsed, None otherwise
    """
    try:
        msg = BytesParser(policy=policy.default).parsebytes(raw_email)
        
        from_addr = msg.get('From', '')
        subject = msg.get('Subject', '')
        body = decode_email_content(msg)
        
        # Prefer parser selected by declared sender/subject first.
        attempted = set()
        for parser_class in PARSERS:
            if parser_class.can_parse(from_addr, subject):
                attempted.add(parser_class)
                parsed = parser_class.parse(msg, body)
                if parsed:
                    return parsed
        
        # Fallback for forwarded/rewritten emails where "From" changed.
        for parser_class in PARSERS:
            if parser_class in attempted:
                continue
            parsed = parser_class.parse(msg, body)
            if parsed:
                return parsed
        
        return None  # No parser matched
        
    except Exception as e:
        print(f"Email parse error: {e}")
        return None


def parse_eml_file(file_path: str) -> Optional[ParsedPayment]:
    """Parse a .eml file and extract payment information."""
    with open(file_path, 'rb') as f:
        return parse_email(f.read())


# For testing
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
        result = parse_eml_file(file_path)
        if result:
            print(f"Source: {result.source}")
            print(f"Amount: ${result.amount:.2f}")
            print(f"Sender: {result.sender_name}")
            print(f"Transaction ID: {result.transaction_id}")
            print(f"Memo: {result.memo}")
            print(f"Date: {result.received_at}")
        else:
            print("Failed to parse email")
    else:
        print("Usage: python gmail_parser.py <path-to-eml-file>")
