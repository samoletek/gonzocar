from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
from uuid import uuid4

from app.api.deps import get_db, get_current_user
from app.models import Application, ApplicationComment, Driver, Staff, Ledger, BillingStatus
from app.schemas import (
    ApplicationCreate, ApplicationResponse, ApplicationStatusUpdate,
    CommentCreate, CommentResponse
)

router = APIRouter(prefix="/applications", tags=["applications"])


@router.get("", response_model=list[ApplicationResponse])
def list_applications(
    skip: int = 0,
    limit: int = 100,
    status_filter: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """List all applications with optional status filter."""
    query = db.query(Application)
    
    effective_status = status_filter or status
    if effective_status:
        query = query.filter(Application.status == effective_status)
    
    applications = query.order_by(
        Application.created_at.desc()
    ).offset(skip).limit(limit).all()
    
    result = []
    for app in applications:
        app_dict = _serialize_application(app, db)
        result.append(app_dict)
    
    return result


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
    
    old_status = application.status.value
    application.status = request.status
    
    # If approved and not already linked to driver, create driver
    if request.status == "approved" and not application.driver_id:
        form_data = application.form_data
        
        # Extract driver info from form data
        first_name = form_data.get("first_name", "")
        last_name = form_data.get("last_name", "")
        
        # Handle nested 'names' object (Fluent Forms compatibility)
        if not first_name and not last_name:
            # Try case-insensitive lookup for 'names'
            names_obj = None
            for key in form_data.keys():
                if "name" in key.lower() and isinstance(form_data[key], dict):
                    names_obj = form_data[key]
                    break
            
            if names_obj:
                first_name = names_obj.get("first_name") or names_obj.get("First_Name") or names_obj.get("first") or ""
                last_name = names_obj.get("last_name") or names_obj.get("Last_Name") or names_obj.get("last") or ""

        driver = Driver(
            first_name=first_name,
            last_name=last_name,
            email=form_data.get("email", ""),
            phone=form_data.get("phone", "") or form_data.get("phone_number", ""),
            billing_type=form_data.get("billing_type", "daily"),
            billing_rate=form_data.get("billing_rate", 0),
            billing_status=BillingStatus.active,
            billing_active=True,
            portal_token=uuid4().hex,
        )
        db.add(driver)
        db.flush()
        
        application.driver_id = driver.id
        
        # Create initial ledger entry if needed
        if form_data.get("initial_balance"):
            ledger_entry = Ledger(
                driver_id=driver.id,
                type="credit",
                amount=form_data.get("initial_balance"),
                description="Initial balance on approval"
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
