"""
Payments API Routes

Endpoints for managing payment records:
- List unrecognized (unmatched) payments
- Assign payment to driver (creates alias + ledger entry)
- Payment stats
"""

from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.api.deps import get_db, get_current_user
from app.models import Staff, PaymentRaw, Driver, Alias, Ledger, AliasType
from app.schemas import PaymentResponse, PaymentAssign

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("/unrecognized", response_model=list[PaymentResponse])
def list_unrecognized(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """List all unrecognized (unmatched) payments."""
    payments = db.query(PaymentRaw).filter(
        PaymentRaw.matched == False
    ).order_by(PaymentRaw.received_at.desc()).all()
    
    return payments


@router.get("/all", response_model=list[PaymentResponse])
def list_all_payments(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """List all payments with pagination."""
    payments = db.query(PaymentRaw).order_by(
        PaymentRaw.received_at.desc()
    ).offset(skip).limit(limit).all()
    
    return payments


@router.get("/stats")
def payment_stats(
    period: str = "all",
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Get payment statistics.
    Optional 'period' query param: 'all' (default) or 'weekly'.
    'weekly' = Monday 9:00 AM NY time (current week) to next Monday.
    """
    query = db.query(PaymentRaw)
    matched_query = db.query(PaymentRaw).filter(PaymentRaw.matched == True)
    unmatched_query = db.query(PaymentRaw).filter(PaymentRaw.matched == False)
    
    # Weekly Filter Logic
    if period == "weekly":
        try:
            from zoneinfo import ZoneInfo
            from datetime import timedelta
        except ImportError:
            # Fallback for older python if needed, though 3.9+ has zoneinfo
            import pytz
            ZoneInfo = lambda x: pytz.timezone(x)
            
        ny_tz = ZoneInfo("America/New_York")
        utc_tz = ZoneInfo("UTC")
        now_ny = datetime.now(ny_tz)
        
        # Calculate most recent Monday 9:00 AM NY
        # Monday is 0 in weekday()
        days_since_monday = now_ny.weekday()
        monday_date = now_ny.date() - timedelta(days=days_since_monday)
        
        # Construct Monday 9:00 AM
        # Note: replace with fold=0 to handle DST ambiguity if needed, usually fine
        monday_9am = datetime.combine(monday_date, datetime.min.time()).replace(hour=9, tzinfo=ny_tz)
        
        # If current time is before Monday 9AM, we are in the "previous" week's cycle
        if now_ny < monday_9am:
            monday_9am -= timedelta(weeks=1)
            
        start_time_utc = monday_9am.astimezone(utc_tz).replace(tzinfo=None) # Naive UTC for DB
        
        query = query.filter(PaymentRaw.received_at >= start_time_utc)
        matched_query = matched_query.filter(PaymentRaw.received_at >= start_time_utc)
        unmatched_query = unmatched_query.filter(PaymentRaw.received_at >= start_time_utc)

    total_count = query.count()
    matched_count = matched_query.count()
    unmatched_count = unmatched_query.count()
    
    total_amount = db.query(func.sum(PaymentRaw.amount)).filter(
        PaymentRaw.id.in_(query.with_entities(PaymentRaw.id))
    ).scalar() or 0
    
    matched_amount = db.query(func.sum(PaymentRaw.amount)).filter(
        PaymentRaw.id.in_(matched_query.with_entities(PaymentRaw.id))
    ).scalar() or 0
    
    return {
        "total_payments": total_count,
        "matched_payments": matched_count,
        "unmatched_payments": unmatched_count,
        "total_amount": float(total_amount),
        "matched_amount": float(matched_amount),
    }


@router.post("/{payment_id}/assign", response_model=PaymentResponse)
def assign_payment(
    payment_id: UUID,
    data: PaymentAssign,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """
    Assign or reassign a payment to a driver.

    This will:
    1. Update payment.driver_id (and mark matched=true)
    2. Create or move the linked ledger credit entry
    3. Optionally create/update alias for future matching
    """
    # Get payment
    payment = db.query(PaymentRaw).filter(PaymentRaw.id == payment_id).first()
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found"
        )
    
    # Get driver
    driver = db.query(Driver).filter(Driver.id == data.driver_id).first()
    if not driver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Driver not found"
        )

    source_value = payment.source.value if hasattr(payment.source, "value") else str(payment.source)
    payment_description = f"{source_value.upper()} payment from {payment.sender_name}"

    # Update payment driver (reassignment allowed for already matched entries)
    payment.driver_id = driver.id
    payment.matched = True

    # Keep a single source-of-truth ledger credit per payment reference.
    linked_ledger_entries = db.query(Ledger).filter(
        Ledger.reference_id == payment.id,
        Ledger.type == "credit",
    ).all()

    if linked_ledger_entries:
        for entry in linked_ledger_entries:
            entry.driver_id = driver.id
            entry.description = payment_description
    else:
        ledger_entry = Ledger(
            driver_id=driver.id,
            type="credit",
            amount=payment.amount,
            description=payment_description,
            reference_id=payment.id,
            created_at=datetime.utcnow(),
        )
        db.add(ledger_entry)

    # Create or move alias for future matching
    if data.create_alias and (payment.sender_name or payment.sender_identifier):
        # Determine alias type based on payment source
        alias_type_map = {
            "zelle": AliasType.zelle,
            "venmo": AliasType.venmo,
            "cashapp": AliasType.cashapp,
            "chime": AliasType.chime,
        }
        alias_type = alias_type_map.get(source_value, AliasType.zelle)

        alias_candidates = []
        if payment.sender_name:
            alias_candidates.append(payment.sender_name.strip())
        if payment.sender_identifier:
            alias_candidates.append(payment.sender_identifier.strip())

        for candidate in alias_candidates:
            if not candidate:
                continue
            existing_alias = db.query(Alias).filter(
                func.lower(Alias.alias_value) == candidate.lower()
            ).first()
            if existing_alias:
                if existing_alias.driver_id != driver.id:
                    existing_alias.driver_id = driver.id
                    existing_alias.alias_type = alias_type
                continue
            new_alias = Alias(
                driver_id=driver.id,
                alias_type=alias_type,
                alias_value=candidate,
                created_at=datetime.utcnow()
            )
            db.add(new_alias)
    
    db.commit()
    db.refresh(payment)
    
    return payment


@router.get("/{payment_id}", response_model=PaymentResponse)
def get_payment(
    payment_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get a single payment by ID."""
    payment = db.query(PaymentRaw).filter(PaymentRaw.id == payment_id).first()
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found"
        )
    return payment
