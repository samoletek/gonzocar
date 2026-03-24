import math
from typing import Any, Optional
from uuid import UUID
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user
from app.models import (
    Application,
    ApplicationComment,
    ApplicationStatus,
    BillingStatus,
    Driver,
    Ledger,
    Staff,
)
from app.schemas import (
    ApplicationCreate, ApplicationResponse, ApplicationStatusUpdate,
    CommentCreate, CommentResponse
)

router = APIRouter(prefix="/applications", tags=["applications"])


def _extract_driver_profile(form_data: dict[str, Any]) -> dict[str, Any]:
    first_name = (form_data.get("first_name") or "").strip()
    last_name = (form_data.get("last_name") or "").strip()

    if not first_name and not last_name:
        names_obj = None
        for key in form_data.keys():
            if "name" in key.lower() and isinstance(form_data[key], dict):
                names_obj = form_data[key]
                break

        if names_obj:
            first_name = (
                names_obj.get("first_name")
                or names_obj.get("First_Name")
                or names_obj.get("first")
                or ""
            ).strip()
            last_name = (
                names_obj.get("last_name")
                or names_obj.get("Last_Name")
                or names_obj.get("last")
                or ""
            ).strip()

    if not first_name and isinstance(form_data.get("names"), str):
        full_name = form_data.get("names", "").strip()
        if full_name:
            parts = full_name.split()
            first_name = parts[0]
            if len(parts) > 1:
                last_name = " ".join(parts[1:])

    email = str(form_data.get("email") or "").strip()
    phone = str(form_data.get("phone") or form_data.get("phone_number") or "").strip()

    if not first_name and email:
        first_name = email.split("@", 1)[0]
    if not first_name:
        first_name = "Unknown"
    if not last_name:
        last_name = "Driver"

    billing_type_raw = str(form_data.get("billing_type") or "daily").strip().lower()
    billing_type = billing_type_raw if billing_type_raw in {"daily", "weekly"} else "daily"

    try:
        billing_rate = float(form_data.get("billing_rate") or 0)
    except (TypeError, ValueError):
        billing_rate = 0.0
    if billing_rate < 0:
        billing_rate = 0.0

    return {
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone": phone,
        "billing_type": billing_type,
        "billing_rate": billing_rate,
    }


def _ensure_driver_for_application(application: Application, db: Session) -> Driver:
    if application.driver_id:
        existing_driver = db.query(Driver).filter(Driver.id == application.driver_id).first()
        if existing_driver:
            return existing_driver
        application.driver_id = None

    form_data = application.form_data or {}
    profile = _extract_driver_profile(form_data)

    driver = Driver(
        first_name=profile["first_name"],
        last_name=profile["last_name"],
        email=profile["email"],
        phone=profile["phone"],
        billing_type=profile["billing_type"],
        billing_rate=profile["billing_rate"],
        billing_status=BillingStatus.active,
        billing_active=True,
        portal_token=uuid4().hex,
    )
    db.add(driver)
    db.flush()

    application.driver_id = driver.id
    return driver


def _base_applications_query(db: Session, exclude_linked_drivers: bool):
    query = db.query(Application)
    if exclude_linked_drivers:
        query = query.filter(Application.driver_id.is_(None))
    return query


def _build_counts(query) -> dict[str, int]:
    counts = {
        "pending": 0,
        "approved": 0,
        "declined": 0,
        "hold": 0,
        "onboarding": 0,
        "all": 0,
    }
    rows = query.with_entities(Application.status, func.count(Application.id)).group_by(Application.status).all()
    total = 0
    for status_value, count_value in rows:
        key = status_value.value if hasattr(status_value, "value") else str(status_value)
        counts[key] = int(count_value)
        total += int(count_value)
    counts["all"] = total
    return counts


@router.get("")
def list_applications(
    skip: int = 0,
    limit: int = 100,
    status_filter: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    include_meta: bool = False,
    exclude_linked_drivers: bool = False,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """List all applications with optional status filter."""
    query = _base_applications_query(db, exclude_linked_drivers)

    effective_status = status_filter or status
    if effective_status:
        query = query.filter(Application.status == effective_status)

    if include_meta:
        page = max(1, page)
        if page_size not in {20, 50}:
            page_size = 20

        total = query.count()
        offset = (page - 1) * page_size
        applications = query.order_by(Application.created_at.desc()).offset(offset).limit(page_size).all()
        result = [_serialize_application(app, db) for app in applications]

        # Stats cards should reflect full application funnel, including approved
        # records already linked to drivers.
        counts_query = _base_applications_query(db, False)
        counts = _build_counts(counts_query)

        return {
            "items": result,
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": max(1, math.ceil(total / page_size)) if page_size else 1,
            "counts": counts,
        }

    applications = query.order_by(Application.created_at.desc()).offset(skip).limit(limit).all()
    return [_serialize_application(app, db) for app in applications]


@router.get("/{application_id}", response_model=ApplicationResponse)
def get_application(
    application_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get a single application with comments."""
    application = db.query(Application).filter(
        Application.id == application_id
    ).first()
    
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    
    return _serialize_application(application, db)


@router.patch("/{application_id}/status", response_model=ApplicationResponse)
def update_status(
    application_id: UUID,
    request: ApplicationStatusUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Update application status. If approved, creates driver and ledger."""
    application = db.query(Application).filter(
        Application.id == application_id
    ).first()
    
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    
    old_status = application.status.value if hasattr(application.status, "value") else str(application.status)
    application.status = request.status

    if request.status in {"approved", "onboarding"}:
        driver = _ensure_driver_for_application(application, db)
        form_data = application.form_data or {}

        if request.status == "approved" and old_status != "approved":
            try:
                initial_balance = float(form_data.get("initial_balance") or 0)
            except (TypeError, ValueError):
                initial_balance = 0.0

            if initial_balance > 0:
                ledger_entry = Ledger(
                    driver_id=driver.id,
                    type="credit",
                    amount=initial_balance,
                    description="Initial balance on approval",
                )
                db.add(ledger_entry)
    
    # Add comment with status change message
    if request.message:
        comment = ApplicationComment(
            application_id=application_id,
            staff_id=current_user.id,
            content=f"[Status: {old_status} -> {request.status}] {request.message}"
        )
        db.add(comment)
    
    db.commit()
    db.refresh(application)
    
    return _serialize_application(application, db)


@router.post("/reconcile/drivers")
def backfill_drivers_for_approved(
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    limit = max(1, min(limit, 1000))
    applications = (
        db.query(Application)
        .filter(
            Application.status.in_([ApplicationStatus.approved, ApplicationStatus.onboarding]),
            Application.driver_id.is_(None),
        )
        .order_by(Application.created_at.asc())
        .limit(limit)
        .all()
    )

    processed_ids: list[str] = []
    for application in applications:
        _ensure_driver_for_application(application, db)
        processed_ids.append(str(application.id))

    db.commit()
    return {
        "processed": len(processed_ids),
        "application_ids": processed_ids,
    }


@router.post("/{application_id}/comment", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def add_comment(
    application_id: UUID,
    request: CommentCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Add a comment to an application."""
    application = db.query(Application).filter(
        Application.id == application_id
    ).first()
    
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    
    comment = ApplicationComment(
        application_id=application_id,
        staff_id=current_user.id,
        content=request.content
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    
    return {
        "id": comment.id,
        "content": comment.content,
        "staff_id": comment.staff_id,
        "staff_name": current_user.name,
        "created_at": comment.created_at
    }


def _serialize_application(app: Application, db: Session) -> dict:
    """Serialize application with comments and staff names."""
    comments = []
    for c in app.comments:
        staff = db.query(Staff).filter(Staff.id == c.staff_id).first()
        comments.append({
            "id": c.id,
            "content": c.content,
            "staff_id": c.staff_id,
            "staff_name": staff.name if staff else None,
            "created_at": c.created_at
        })
    
    return {
        "id": app.id,
        "status": app.status.value,
        "form_data": app.form_data,
        "driver_id": app.driver_id,
        "created_at": app.created_at,
        "updated_at": app.updated_at,
        "comments": comments
    }
