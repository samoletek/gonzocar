#!/usr/bin/env python3
"""
Cron Job: Billing

Runs automatically to:
1. Create debit entries for active drivers based on their billing rate
2. Detect late payments (daily: >= 2 days, weekly: >= 48 hours)
3. Send SMS reminders for late payments
4. Log all SMS activity

Usage:
    python scripts/midnight_billing.py

Crontab (hourly + guarded in code):
    0 * * * * cd /path/to/gonzocar && python scripts/midnight_billing.py
"""

import sys
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from decimal import Decimal

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load env before imports
from dotenv import load_dotenv
load_dotenv('.env.local')

from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from app.core.database import SessionLocal
from app.models import Driver, Ledger, SmsLog, LedgerType, BillingType, BillingStatus
from app.services.openphone import openphone, SmsTemplates
from app.services.billing import (
    CHICAGO_TZ,
    default_weekly_due_day,
    is_charge_window,
    normalize_weekly_due_day,
)


def get_db() -> Session:
    """Get database session."""
    return SessionLocal()


def calculate_balance(db: Session, driver_id) -> Decimal:
    """Calculate driver's current balance (credits - debits)."""
    credits = db.query(func.sum(Ledger.amount)).filter(
        Ledger.driver_id == driver_id,
        Ledger.type == LedgerType.credit
    ).scalar() or Decimal('0')
    
    debits = db.query(func.sum(Ledger.amount)).filter(
        Ledger.driver_id == driver_id,
        Ledger.type == LedgerType.debit
    ).scalar() or Decimal('0')
    
    return credits - debits


def get_last_debit_date(db: Session, driver_id) -> datetime:
    """Get the date of the last debit entry for a driver."""
    last_debit = db.query(Ledger).filter(
        Ledger.driver_id == driver_id,
        Ledger.type == LedgerType.debit
    ).order_by(Ledger.created_at.desc()).first()
    
    return last_debit.created_at if last_debit else None


def _date_in_chicago(value: datetime) -> datetime.date:
    dt = value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(CHICAGO_TZ).date()


def create_daily_debits(db: Session, drivers: list[Driver], now_local: datetime) -> int:
    """Create daily debit entries for drivers with daily billing at 5 PM Chicago."""
    count = 0
    billing_date_local = now_local.date()
    
    for driver in drivers:
        if driver.billing_type != BillingType.daily:
            continue
        
        # Check if already charged today
        last_debit_date = get_last_debit_date(db, driver.id)
        if last_debit_date and _date_in_chicago(last_debit_date) == billing_date_local:
            continue
        
        # Create debit entry
        debit = Ledger(
            id=uuid4(),
            driver_id=driver.id,
            type=LedgerType.debit,
            amount=driver.billing_rate,
            description=f"Daily rental charge",
            created_at=datetime.utcnow()
        )
        db.add(debit)
        count += 1
        print(f"  Created daily debit: {driver.first_name} {driver.last_name} - ${driver.billing_rate}")
    
    return count


def create_weekly_debits(db: Session, drivers: list[Driver], now_local: datetime) -> int:
    """Create weekly debit entries for drivers with weekly billing at 5 PM Chicago."""
    count = 0
    billing_date_local = now_local.date()
    billing_weekday = now_local.strftime("%A").lower()
    
    for driver in drivers:
        if driver.billing_type != BillingType.weekly:
            continue

        due_day = normalize_weekly_due_day(getattr(driver, "weekly_due_day", None)) or default_weekly_due_day()
        if due_day != billing_weekday:
            continue
        
        # Check if already charged this week
        last_debit_date = get_last_debit_date(db, driver.id)
        if last_debit_date and _date_in_chicago(last_debit_date) == billing_date_local:
            continue
        
        # Create debit entry
        debit = Ledger(
            id=uuid4(),
            driver_id=driver.id,
            type=LedgerType.debit,
            amount=driver.billing_rate,
            description=f"Weekly rental charge ({due_day.title()})",
            created_at=datetime.utcnow()
        )
        db.add(debit)
        count += 1
        print(f"  Created weekly debit: {driver.first_name} {driver.last_name} - ${driver.billing_rate}")
    
    return count


def check_late_payments(db: Session, drivers: list[Driver]) -> list[tuple]:
    """
    Check for late payments based on billing type.
    
    Late criteria:
    - Daily billing: negative balance for >= 2 days
    - Weekly billing: negative balance for >= 48 hours
    
    Returns list of (driver, balance, days_late)
    """
    late_drivers = []
    now = datetime.utcnow()
    
    for driver in drivers:
        balance = calculate_balance(db, driver.id)
        
        if balance >= 0:
            continue
        
        # Find when balance became negative (simplified: use last debit date)
        last_debit = db.query(Ledger).filter(
            Ledger.driver_id == driver.id,
            Ledger.type == LedgerType.debit
        ).order_by(Ledger.created_at.desc()).first()
        
        if not last_debit:
            continue
        
        days_late = (now - last_debit.created_at).days
        
        # Check if late based on billing type
        if driver.billing_type == BillingType.daily and days_late >= 2:
            late_drivers.append((driver, balance, days_late))
        elif driver.billing_type == BillingType.weekly and days_late >= 2:  # 48 hours = 2 days
            late_drivers.append((driver, balance, days_late))
    
    return late_drivers


def send_late_payment_sms(db: Session, driver: Driver, balance: Decimal, days_late: int) -> bool:
    """Send late payment SMS and log it."""
    # Check if we already sent SMS today
    today = datetime.utcnow().date()
    existing_sms = db.query(SmsLog).filter(
        SmsLog.driver_id == driver.id,
        func.date(SmsLog.created_at) == today
    ).first()
    
    if existing_sms:
        print(f"  Already sent SMS today to {driver.first_name} {driver.last_name}")
        return False
    
    # Prepare message
    message = SmsTemplates.late_payment(
        driver_name=driver.first_name,
        amount=abs(float(balance)),
        days_late=days_late
    )
    
    # Send SMS
    result = openphone.send_sms_sync(driver.phone, message)
    
    # Log SMS
    sms_log = SmsLog(
        id=uuid4(),
        driver_id=driver.id,
        phone=driver.phone,
        message=message,
        status='sent' if result.success else 'failed',
        openphone_response={'message_id': result.message_id, 'error': result.error},
        created_at=datetime.utcnow()
    )
    db.add(sms_log)
    
    if result.success:
        print(f"  Sent late payment SMS to {driver.first_name} {driver.last_name}")
    else:
        print(f"  Failed to send SMS to {driver.first_name} {driver.last_name}: {result.error}")
    
    return result.success


def run_billing():
    """Main billing job."""
    print(f"[{datetime.now()}] Starting billing job")
    now_local = datetime.now(CHICAGO_TZ)
    print(f"Chicago local time: {now_local.isoformat()}")
    if not is_charge_window(now_local, target_hour=17):
        print("Outside 5 PM Chicago charge window. Skipping billing run.")
        return
    
    db = get_db()
    
    try:
        # Get active drivers
        drivers = db.query(Driver).filter(
            or_(
                Driver.billing_status == BillingStatus.active,
                (Driver.billing_status.is_(None) & (Driver.billing_active == True)),
            )
        ).all()
        print(f"Found {len(drivers)} active drivers")
        
        if not drivers:
            print("No active drivers, exiting")
            return
        
        # Create debit entries
        print("\n--- Creating Debit Entries ---")
        daily_count = create_daily_debits(db, drivers, now_local)
        weekly_count = create_weekly_debits(db, drivers, now_local)
        print(f"Created {daily_count} daily debits, {weekly_count} weekly debits")
        
        # Check for late payments
        print("\n--- Checking Late Payments ---")
        late_drivers = check_late_payments(db, drivers)
        print(f"Found {len(late_drivers)} late drivers")
        
        # Send SMS reminders
        if late_drivers:
            print("\n--- Sending SMS Reminders ---")
            for driver, balance, days_late in late_drivers:
                print(f"  {driver.first_name} {driver.last_name}: ${balance:.2f} ({days_late} days late)")
                send_late_payment_sms(db, driver, balance, days_late)
        
        # Commit all changes
        db.commit()
        print(f"\n[{datetime.now()}] Billing job completed successfully")
        
    except Exception as e:
        db.rollback()
        print(f"Error during billing: {e}")
        raise
    finally:
        db.close()


def run_with_dry_run():
    """Dry run mode - show what would happen without making changes."""
    print(f"[{datetime.now()}] DRY RUN - Billing preview")
    
    db = get_db()
    
    try:
        drivers = db.query(Driver).filter(
            or_(
                Driver.billing_status == BillingStatus.active,
                (Driver.billing_status.is_(None) & (Driver.billing_active == True)),
            )
        ).all()
        print(f"Found {len(drivers)} active drivers")
        
        print("\n--- Would Create Debits For ---")
        for driver in drivers:
            balance = calculate_balance(db, driver.id)
            print(f"  {driver.first_name} {driver.last_name}")
            print(f"    Type: {driver.billing_type.value}, Rate: ${driver.billing_rate}")
            print(f"    Current Balance: ${balance:.2f}")
        
        print("\n--- Late Payments ---")
        late_drivers = check_late_payments(db, drivers)
        for driver, balance, days_late in late_drivers:
            print(f"  {driver.first_name} {driver.last_name}")
            print(f"    Balance: ${balance:.2f}, Days Late: {days_late}")
            print(f"    Would send SMS to: {driver.phone}")
        
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--dry-run":
        run_with_dry_run()
    else:
        run_billing()
