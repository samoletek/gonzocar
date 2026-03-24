#!/usr/bin/env python3
"""
Cron Job: Parse Payment Emails

Runs every 5 minutes to:
1. Fetch new payment emails from Gmail
2. Parse payment details (amount, sender, etc.)
3. Store in payments_raw table
4. Attempt to match with drivers via aliases
5. Create ledger entries for matched payments

Usage:
    python scripts/parse_payments.py

Crontab (every 5 min):
    */5 * * * * cd /path/to/gonzocar && python scripts/parse_payments.py
"""

import sys
import os
from datetime import datetime
from uuid import uuid4

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func
from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.models.models import PaymentRaw, Alias, Ledger, Driver
from app.services.gmail_parser import parse_email, ParsedPayment


def get_db() -> Session:
    """Get database session."""
    return SessionLocal()


def is_duplicate(db: Session, source: str, transaction_id: str, gmail_id: str = None) -> bool:
    """Check if payment already exists in database."""
    # 1. Check by Transaction ID (if present)
    if transaction_id:
        existing = db.query(PaymentRaw).filter(
            PaymentRaw.source == source,
            PaymentRaw.transaction_id == transaction_id
        ).first()
        if existing:
            return True

    # 2. Check by Gmail ID (if present) - Robust fallback for same email
    if gmail_id:
        existing_by_gmail = db.query(PaymentRaw).filter(
            PaymentRaw.gmail_id == gmail_id
        ).first()
        if existing_by_gmail:
            return True
            
    return False


def find_driver_by_alias(db: Session, sender_name: str, sender_identifier: str) -> Driver:
    """Try to match sender to a driver via aliases."""
    candidates = []
    if sender_name:
        candidates.append(sender_name.strip())
    if sender_identifier:
        candidates.append(sender_identifier.strip())

    for candidate in candidates:
        alias = db.query(Alias).filter(
            func.lower(Alias.alias_value) == candidate.lower()
        ).first()
        if alias:
            return db.query(Driver).filter(Driver.id == alias.driver_id).first()
    
    return None


def store_payment(db: Session, payment: ParsedPayment, gmail_id: str = None) -> PaymentRaw:
    """Store parsed payment in database."""
    # Check for duplicate
    # Check for duplicate
    if is_duplicate(db, payment.source, payment.transaction_id, gmail_id):
        print(f"  Skipping duplicate: {payment.source} {payment.transaction_id or gmail_id}")
        return None
    
    # Try to match with driver
    driver = find_driver_by_alias(db, payment.sender_name, payment.sender_identifier)
    
    # Create payment record
    payment_raw = PaymentRaw(
        id=uuid4(),
        source=payment.source,
        sender_name=payment.sender_name,
        sender_identifier=payment.sender_identifier,
        amount=payment.amount,
        transaction_id=payment.transaction_id,
        memo=payment.memo,
        received_at=payment.received_at,
        gmail_id=gmail_id,
        driver_id=driver.id if driver else None,
        matched=driver is not None
    )
    
    db.add(payment_raw)
    db.flush()  # Ensure it's visible to subsequent is_duplicate checks within the same transaction
    
    # If matched, create ledger entry
    if driver:
        ledger_entry = Ledger(
            id=uuid4(),
            driver_id=driver.id,
            type='credit',
            amount=payment.amount,
            description=f"{payment.source.upper()} payment from {payment.sender_name}",
            reference_id=str(payment_raw.id),
            created_at=datetime.utcnow()
        )
        db.add(ledger_entry)
        print(f"  Matched to driver: {driver.first_name} {driver.last_name}")
    
    return payment_raw


def process_email(db: Session, raw_email: bytes, gmail_id: str = None) -> bool:
    """Process a single email."""
    payment = parse_email(raw_email)
    
    if not payment:
        return False
    
    print(f"  Parsed: {payment.source} ${payment.amount:.2f} from {payment.sender_name}")
    
    result = store_payment(db, payment, gmail_id)
    return result is not None


def run_with_gmail(hours: int = 1):
    """Fetch and process emails from Gmail API."""
    try:
        from app.services.gmail_service import GmailService
    except ImportError as e:
        print(f"Gmail service import error: {e}")
        print("Install with: pip install google-auth-oauthlib google-api-python-client")
        return
    
    # Check for credentials
    if not os.path.exists('credentials.json'):
        print("Error: credentials.json not found")
        print("Download from Google Cloud Console")
        return
    
    if not os.path.exists('token.json'):
        print("Error: token.json not found")
        print("Run: python app/services/gmail_service.py")
        return
    
    print(f"[{datetime.now()}] Starting payment email parser (looking back {hours} hours)")
    print("Connecting to Gmail API...")
    
    try:
        gmail = GmailService()
        emails = gmail.fetch_emails(since_hours=hours, max_results=50)
        
        print(f"Found {len(emails)} payment emails")
        
        if not emails:
            return
        
        db = get_db()
        processed = 0
        
        try:
            for email_data in emails:
                print(f"\nProcessing email {email_data['gmail_id']}...")
                if process_email(db, email_data['raw'], email_data['gmail_id']):
                    processed += 1
            
            db.commit()
            print(f"\nDone! Processed {processed} new payments")
            
        finally:
            db.close()
            
    except Exception as e:
        print(f"Error: {e}")


def run_with_local_files(directory: str):
    """Process .eml files from a local directory (for testing)."""
    from pathlib import Path
    
    print(f"[{datetime.now()}] Processing local .eml files from {directory}")
    
    eml_files = list(Path(directory).rglob('*.eml'))
    print(f"Found {len(eml_files)} .eml files")
    
    if not eml_files:
        return
    
    db = get_db()
    processed = 0
    
    try:
        for eml_path in eml_files:
            print(f"\nProcessing {eml_path.name}...")
            with open(eml_path, 'rb') as f:
                if process_email(db, f.read()):
                    processed += 1
        
        db.commit()
        print(f"\nDone! Processed {processed} new payments")
        
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].endswith('.eml'):
        # Process local directory/files (legacy support)
        run_with_local_files(sys.argv[1])
    else:
        # Check for --hours argument
        hours = 1
        if '--hours' in sys.argv:
            try:
                idx = sys.argv.index('--hours')
                hours = int(sys.argv[idx + 1])
            except (ValueError, IndexError):
                print("Invalid --hours argument, defaulting to 1 hour")
        
        # Production mode: fetch from Gmail
        run_with_gmail(hours=hours)
