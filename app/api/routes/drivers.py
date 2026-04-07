import math
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_db
from app.models import (
    Application,
    Alias,
    AliasType,
    BillingType,
    BillingStatus,
    Driver,
    DriverVehicleAssignment,
    Ledger,
    PaymentRaw,
    SmsLog,
    Staff,
    Vehicle,
)
from app.services.billing import default_weekly_due_day, normalize_weekly_due_day
from app.schemas import (
    AliasCreate,
    AliasResponse,
    BillingStatusUpdate,
    DriverCreate,
    DriverDeleteRequest,
    DriverResponse,
    DriverUpdate,
    LedgerCancelRequest,
    LedgerResponse,
    ManualLedgerCreate,
    SwapVehicleRequest,
    VehicleAssignmentCreate,
    VehicleAssignmentResponse,
    VehicleAssignmentUpdate,
)

router = APIRouter(prefix="/drivers", tags=["drivers"])


def _to_utc_naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _normalize_plate(plate: str) -> str:
    return "".join(ch for ch in plate.upper().strip() if ch.isalnum() or ch == "-")


def _normalize_human_name(name: str) -> str:
    return " ".join((name or "").strip().split()).lower()


def _ranges_overlap(
    start_a: datetime,
    end_a: datetime | None,
    start_b: datetime,
    end_b: datetime | None,
) -> bool:
    effective_end_a = end_a or datetime.max
    effective_end_b = end_b or datetime.max
    return start_a < effective_end_b and start_b < effective_end_a


def _calculate_balance(db: Session, driver_id: UUID) -> float:
    from sqlalchemy import case

    result = db.query(
        func.sum(
            case(
                (Ledger.type == "credit", Ledger.amount),
                else_=-Ledger.amount,
            )
        )
    ).filter(Ledger.driver_id == driver_id).scalar()

    return float(result) if result else 0.0


def _serialize_driver(driver: Driver, balance: float = 0.0, application_info=None) -> dict:
    result = {
        "id": driver.id,
        "first_name": driver.first_name,
        "last_name": driver.last_name,
        "email": driver.email,
        "phone": driver.phone,
        "billing_type": driver.billing_type.value if driver.billing_type else "daily",
        "billing_rate": float(driver.billing_rate) if driver.billing_rate is not None else 0.0,
        "weekly_due_day": driver.weekly_due_day,
        "billing_active": driver.billing_active if driver.billing_active is not None else True,
        "billing_status": driver.billing_status.value if driver.billing_status else "active",
        "deposit_required": float(driver.deposit_required or 0),
        "deposit_posted": float(driver.deposit_posted or 0),
        "deposit_updated_at": driver.deposit_updated_at,
        "terminated_at": driver.terminated_at,
        "portal_token": driver.portal_token,
        "created_at": driver.created_at,
        "updated_at": driver.updated_at,
        "balance": balance,
    }
    if application_info is not None:
        result["application_info"] = application_info
    return result


def _serialize_assignment(assignment: DriverVehicleAssignment) -> dict:
    return {
        "id": assignment.id,
        "driver_id": assignment.driver_id,
        "driver_name": f"{assignment.driver.first_name} {assignment.driver.last_name}".strip(),
        "license_plate": assignment.vehicle.license_plate,
        "start_at": assignment.start_at,
        "end_at": assignment.end_at,
        "previous_assignment_id": assignment.previous_assignment_id,
        "created_at": assignment.created_at,
        "updated_at": assignment.updated_at,
    }


def _get_or_create_vehicle(db: Session, license_plate: str) -> Vehicle:
    normalized = _normalize_plate(license_plate)
    if not normalized:
        raise HTTPException(status_code=400, detail="License plate is required")

    vehicle = db.query(Vehicle).filter(func.upper(Vehicle.license_plate) == normalized).first()
    if vehicle:
        return vehicle

    vehicle = Vehicle(license_plate=normalized)
    db.add(vehicle)
    db.flush()
    return vehicle


def _get_assignment_overlaps(
    db: Session,
    driver_id: UUID,
    vehicle_id: UUID,
    start_at: datetime,
    end_at: datetime | None,
    exclude_assignment_id: UUID | None = None,
) -> list[str]:
    overlaps: list[str] = []
    candidates = db.query(DriverVehicleAssignment).options(
        joinedload(DriverVehicleAssignment.vehicle),
        joinedload(DriverVehicleAssignment.driver),
    ).filter(
        or_(
            DriverVehicleAssignment.driver_id == driver_id,
            DriverVehicleAssignment.vehicle_id == vehicle_id,
        )
    ).all()

    for candidate in candidates:
        if exclude_assignment_id and candidate.id == exclude_assignment_id:
            continue
        if _ranges_overlap(start_at, end_at, candidate.start_at, candidate.end_at):
            overlaps.append(
                f"{candidate.driver.first_name} {candidate.driver.last_name} - "
                f"{candidate.vehicle.license_plate} ({candidate.start_at} -> {candidate.end_at or 'open'})"
            )
    return overlaps


def _close_active_assignments(db: Session, driver_id: UUID, end_time: datetime) -> None:
    active_assignments = db.query(DriverVehicleAssignment).filter(
        DriverVehicleAssignment.driver_id == driver_id,
        DriverVehicleAssignment.end_at.is_(None),
    ).all()
    for assignment in active_assignments:
        assignment.end_at = end_time if end_time >= assignment.start_at else assignment.start_at


def _validate_billing_type(value: str | BillingType | None) -> BillingType:
    if isinstance(value, BillingType):
        return value
    normalized = str(value or "daily").strip().lower()
    if normalized not in {"daily", "weekly"}:
        raise HTTPException(status_code=400, detail="Invalid billing_type")
    return BillingType(normalized)


def _resolve_weekly_due_day(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = normalize_weekly_due_day(value)
    if normalized is None:
        raise HTTPException(status_code=400, detail="weekly_due_day must be a valid weekday")
    return normalized


@router.get("", response_model=list[DriverResponse])
def list_drivers(
    skip: int = 0,
    limit: int = 100,
    billing_active: bool | None = None,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    query = db.query(Driver)
    if billing_active is not None:
        query = query.filter(Driver.billing_active == billing_active)

    drivers = query.order_by(Driver.created_at.desc(), Driver.updated_at.desc()).offset(skip).limit(limit).all()
    return [_serialize_driver(driver, balance=_calculate_balance(db, driver.id)) for driver in drivers]


@router.get("/page")
def list_drivers_page(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20),
    search: str | None = Query(default=None),
    billing_active: bool | None = None,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    if page_size not in {20, 50}:
        page_size = 20

    base_query = db.query(Driver)
    if billing_active is not None:
        base_query = base_query.filter(Driver.billing_active == billing_active)

    if search:
        term = f"%{search.strip()}%"
        base_query = base_query.filter(
            or_(
                Driver.first_name.ilike(term),
                Driver.last_name.ilike(term),
                Driver.email.ilike(term),
                Driver.phone.ilike(term),
                func.concat(Driver.first_name, " ", Driver.last_name).ilike(term),
            )
        )

    total = base_query.count()
    total_pages = max(1, math.ceil(total / page_size)) if page_size else 1
    if page > total_pages:
        page = total_pages
    offset = (page - 1) * page_size

    drivers = (
        base_query.order_by(Driver.created_at.desc(), Driver.updated_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    items = [_serialize_driver(driver, balance=_calculate_balance(db, driver.id)) for driver in drivers]

    total_count = total
    active_count = base_query.filter(Driver.billing_active.is_(True)).count()
    driver_ids_subquery = base_query.with_entities(Driver.id).subquery()
    total_balance = db.query(
        func.coalesce(
            func.sum(
                case(
                    (Ledger.type == "credit", Ledger.amount),
                    else_=-Ledger.amount,
                )
            ),
            0,
        )
    ).filter(
        Ledger.driver_id.in_(select(driver_ids_subquery.c.id))
    ).scalar()

    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": int(total_count or 0),
        "total_pages": total_pages,
        "active_count": int(active_count or 0),
        "balance_total": float(total_balance or 0),
    }


@router.post("", response_model=DriverResponse, status_code=status.HTTP_201_CREATED)
def create_driver(
    request: DriverCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    requested_status = request.billing_status or "active"
    if requested_status not in {"active", "paused", "terminated"}:
        raise HTTPException(status_code=400, detail="Invalid billing_status")
    billing_type = _validate_billing_type(request.billing_type)
    weekly_due_day = _resolve_weekly_due_day(request.weekly_due_day)
    if billing_type == BillingType.weekly and not weekly_due_day:
        weekly_due_day = default_weekly_due_day()

    driver = Driver(
        first_name=request.first_name,
        last_name=request.last_name,
        email=request.email,
        phone=request.phone,
        billing_type=billing_type,
        billing_rate=request.billing_rate,
        weekly_due_day=weekly_due_day if billing_type == BillingType.weekly else None,
        billing_active=requested_status == "active",
        billing_status=BillingStatus(requested_status),
        deposit_required=request.deposit_required,
        deposit_posted=request.deposit_posted,
        deposit_updated_at=_to_utc_naive(request.deposit_updated_at),
        terminated_at=datetime.utcnow() if requested_status == "terminated" else None,
        portal_token=request.portal_token or uuid4().hex,
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return _serialize_driver(driver, balance=0.0)


@router.get("/vehicle-assignments/search", response_model=list[VehicleAssignmentResponse])
def search_vehicle_assignments(
    license_plate: str | None = Query(default=None),
    driver_name: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    if not license_plate and not driver_name:
        raise HTTPException(status_code=400, detail="Pass license_plate or driver_name")

    query = db.query(DriverVehicleAssignment).options(
        joinedload(DriverVehicleAssignment.driver),
        joinedload(DriverVehicleAssignment.vehicle),
    )

    if license_plate:
        normalized = _normalize_plate(license_plate)
        query = query.join(DriverVehicleAssignment.vehicle).filter(
            func.upper(Vehicle.license_plate) == normalized
        )

    if driver_name:
        search = f"%{driver_name.strip()}%"
        query = query.join(DriverVehicleAssignment.driver).filter(
            or_(
                Driver.first_name.ilike(search),
                Driver.last_name.ilike(search),
                func.concat(Driver.first_name, " ", Driver.last_name).ilike(search),
            )
        )

    assignments = query.order_by(DriverVehicleAssignment.start_at.asc()).all()
    return [_serialize_assignment(assignment) for assignment in assignments]


@router.post("/vehicle-assignments", response_model=VehicleAssignmentResponse, status_code=status.HTTP_201_CREATED)
def create_vehicle_assignment(
    request: VehicleAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == request.driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    start_at = _to_utc_naive(request.start_at) or datetime.utcnow()
    end_at = _to_utc_naive(request.end_at)
    if end_at and end_at < start_at:
        raise HTTPException(status_code=400, detail="End datetime cannot be before start datetime")

    vehicle = _get_or_create_vehicle(db, request.license_plate)
    overlaps = _get_assignment_overlaps(db, driver.id, vehicle.id, start_at, end_at)
    if overlaps and not request.acknowledge_overlap:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Assignment overlaps with existing records",
                "overlaps": overlaps,
            },
        )

    assignment = DriverVehicleAssignment(
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        start_at=start_at,
        end_at=end_at,
        previous_assignment_id=request.previous_assignment_id,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    assignment = db.query(DriverVehicleAssignment).options(
        joinedload(DriverVehicleAssignment.driver),
        joinedload(DriverVehicleAssignment.vehicle),
    ).filter(DriverVehicleAssignment.id == assignment.id).first()
    return _serialize_assignment(assignment)


@router.patch("/vehicle-assignments/{assignment_id}", response_model=VehicleAssignmentResponse)
def update_vehicle_assignment(
    assignment_id: UUID,
    request: VehicleAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    assignment = db.query(DriverVehicleAssignment).options(
        joinedload(DriverVehicleAssignment.driver),
        joinedload(DriverVehicleAssignment.vehicle),
    ).filter(DriverVehicleAssignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if request.license_plate:
        vehicle = _get_or_create_vehicle(db, request.license_plate)
        assignment.vehicle_id = vehicle.id

    provided_fields = request.model_fields_set
    if "start_at" in provided_fields:
        if request.start_at is None:
            raise HTTPException(status_code=400, detail="start_at cannot be null")
        assignment.start_at = _to_utc_naive(request.start_at)
    if "end_at" in provided_fields:
        assignment.end_at = _to_utc_naive(request.end_at)

    if assignment.end_at and assignment.end_at < assignment.start_at:
        raise HTTPException(status_code=400, detail="End datetime cannot be before start datetime")

    overlaps = _get_assignment_overlaps(
        db,
        assignment.driver_id,
        assignment.vehicle_id,
        assignment.start_at,
        assignment.end_at,
        exclude_assignment_id=assignment.id,
    )
    if overlaps and not request.acknowledge_overlap:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Assignment overlaps with existing records",
                "overlaps": overlaps,
            },
        )

    db.commit()
    db.refresh(assignment)
    assignment = db.query(DriverVehicleAssignment).options(
        joinedload(DriverVehicleAssignment.driver),
        joinedload(DriverVehicleAssignment.vehicle),
    ).filter(DriverVehicleAssignment.id == assignment.id).first()
    return _serialize_assignment(assignment)


@router.get("/public/{portal_token}")
def get_driver_public_portal(
    portal_token: str,
    db: Session = Depends(get_db),
):
    driver = db.query(Driver).filter(Driver.portal_token == portal_token).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    entries = db.query(Ledger).filter(Ledger.driver_id == driver.id).order_by(Ledger.created_at.desc()).all()
    return {
        "driver": {
            "id": driver.id,
            "first_name": driver.first_name,
            "last_name": driver.last_name,
            "balance": _calculate_balance(db, driver.id),
            "deposit_required": float(driver.deposit_required or 0),
            "deposit_posted": float(driver.deposit_posted or 0),
            "deposit_updated_at": driver.deposit_updated_at,
        },
        "ledger": [
            {
                "id": entry.id,
                "type": entry.type.value if hasattr(entry.type, "value") else entry.type,
                "amount": float(entry.amount),
                "description": entry.description,
                "entry_source": entry.entry_source,
                "reversal_of_id": entry.reversal_of_id,
                "created_at": entry.created_at,
            }
            for entry in entries
        ],
    }


@router.get("/{driver_id}", response_model=DriverResponse)
def get_driver(
    driver_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    application = db.query(Application).filter(
        Application.driver_id == driver_id
    ).order_by(Application.created_at.desc()).first()
    application_info = application.form_data if application else None

    return _serialize_driver(driver, balance=_calculate_balance(db, driver.id), application_info=application_info)


@router.delete("/{driver_id}")
def delete_driver(
    driver_id: UUID,
    request: DriverDeleteRequest,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    expected_name = _normalize_human_name(f"{driver.first_name} {driver.last_name}")
    provided_name = _normalize_human_name(request.confirmation_name)
    if not provided_name or provided_name != expected_name:
        raise HTTPException(status_code=400, detail="Confirmation name does not match driver full name")

    # Break references first to satisfy foreign keys.
    db.query(Application).filter(Application.driver_id == driver.id).update(
        {Application.driver_id: None},
        synchronize_session=False,
    )
    db.query(PaymentRaw).filter(PaymentRaw.driver_id == driver.id).update(
        {
            PaymentRaw.driver_id: None,
            PaymentRaw.matched: False,
        },
        synchronize_session=False,
    )

    # Remove dependent records owned by the driver.
    db.query(Ledger).filter(Ledger.driver_id == driver.id).delete(synchronize_session=False)
    db.query(SmsLog).filter(SmsLog.driver_id == driver.id).delete(synchronize_session=False)
    db.query(Alias).filter(Alias.driver_id == driver.id).delete(synchronize_session=False)
    db.query(DriverVehicleAssignment).filter(DriverVehicleAssignment.driver_id == driver.id).delete(
        synchronize_session=False
    )

    db.delete(driver)
    db.commit()
    return {
        "deleted": True,
        "driver_id": driver_id,
    }


@router.patch("/{driver_id}", response_model=DriverResponse)
def update_driver(
    driver_id: UUID,
    request: DriverUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    update_data = request.model_dump(exclude_unset=True)
    application_info_update = update_data.pop("application_info", None) if "application_info" in update_data else None

    if "billing_type" in update_data:
        driver.billing_type = _validate_billing_type(update_data.pop("billing_type"))

    if "weekly_due_day" in update_data:
        driver.weekly_due_day = _resolve_weekly_due_day(update_data.pop("weekly_due_day"))

    if "billing_status" in update_data:
        requested_status = update_data["billing_status"]
        if requested_status not in {"active", "paused", "terminated"}:
            raise HTTPException(status_code=400, detail="Invalid billing_status")
        driver.billing_status = BillingStatus(requested_status)
        driver.billing_active = requested_status == "active"
        driver.terminated_at = datetime.utcnow() if requested_status == "terminated" else None
        if requested_status == "terminated":
            _close_active_assignments(db, driver.id, datetime.utcnow())
        del update_data["billing_status"]

    if "billing_active" in update_data:
        billing_active = bool(update_data["billing_active"])
        driver.billing_active = billing_active
        if billing_active:
            driver.billing_status = BillingStatus.active
            driver.terminated_at = None
        elif driver.billing_status == BillingStatus.active:
            driver.billing_status = BillingStatus.paused
        del update_data["billing_active"]

    deposit_fields = {"deposit_required", "deposit_posted"}
    if any(field in update_data for field in deposit_fields) and "deposit_updated_at" not in update_data:
        driver.deposit_updated_at = datetime.utcnow()

    for field, value in update_data.items():
        if field in {"deposit_updated_at", "terminated_at"}:
            setattr(driver, field, _to_utc_naive(value))
        else:
            setattr(driver, field, value)

    if driver.billing_type == BillingType.weekly:
        if not driver.weekly_due_day:
            driver.weekly_due_day = default_weekly_due_day()
    else:
        driver.weekly_due_day = None

    if application_info_update is not None:
        if not isinstance(application_info_update, dict):
            raise HTTPException(status_code=400, detail="application_info must be an object")
        application = db.query(Application).filter(
            Application.driver_id == driver_id
        ).order_by(Application.created_at.desc()).first()
        if application:
            application.form_data = application_info_update

    db.commit()
    db.refresh(driver)
    return _serialize_driver(driver, balance=_calculate_balance(db, driver.id))


@router.patch("/{driver_id}/billing", response_model=DriverResponse)
def toggle_billing(
    driver_id: UUID,
    payload: dict | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    if payload is not None and "billing_active" in payload:
        driver.billing_active = bool(payload["billing_active"])
    else:
        driver.billing_active = not driver.billing_active

    if driver.billing_active:
        driver.billing_status = BillingStatus.active
        driver.terminated_at = None
    elif driver.billing_status == BillingStatus.active:
        driver.billing_status = BillingStatus.paused

    db.commit()
    db.refresh(driver)
    return _serialize_driver(driver, balance=_calculate_balance(db, driver.id))


@router.patch("/{driver_id}/billing-status", response_model=DriverResponse)
def update_billing_status(
    driver_id: UUID,
    request: BillingStatusUpdate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    now = datetime.utcnow()
    driver.billing_status = BillingStatus(request.status)
    driver.billing_active = request.status == "active"
    if request.status == "terminated":
        driver.terminated_at = now
        _close_active_assignments(db, driver.id, now)
    else:
        driver.terminated_at = None

    db.commit()
    db.refresh(driver)
    return _serialize_driver(driver, balance=_calculate_balance(db, driver.id))


@router.get("/{driver_id}/portal-link")
def get_driver_portal_link(
    driver_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {
        "token": driver.portal_token,
        "path": f"/portal/{driver.portal_token}",
    }


@router.get("/{driver_id}/aliases", response_model=list[AliasResponse])
def list_aliases(
    driver_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    return driver.aliases


@router.post("/{driver_id}/aliases", response_model=AliasResponse, status_code=status.HTTP_201_CREATED)
def create_alias(
    driver_id: UUID,
    request: AliasCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    alias_type = request.alias_type.strip().lower()
    if alias_type not in {"email", "phone", "venmo", "cashapp", "zelle", "chime"}:
        raise HTTPException(status_code=400, detail="Invalid alias_type")

    alias_value = request.alias_value.strip()
    existing = db.query(Alias).filter(
        Alias.alias_type == AliasType(alias_type),
        func.lower(Alias.alias_value) == alias_value.lower(),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Alias already exists")

    alias = Alias(
        driver_id=driver_id,
        alias_type=AliasType(alias_type),
        alias_value=alias_value,
    )
    db.add(alias)
    db.commit()
    db.refresh(alias)
    return alias


@router.delete("/{driver_id}/aliases/{alias_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alias(
    driver_id: UUID,
    alias_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    alias = db.query(Alias).filter(
        Alias.id == alias_id,
        Alias.driver_id == driver_id,
    ).first()
    if not alias:
        raise HTTPException(status_code=404, detail="Alias not found")
    db.delete(alias)
    db.commit()


@router.get("/{driver_id}/ledger", response_model=list[LedgerResponse])
def get_ledger(
    driver_id: UUID,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    return db.query(Ledger).filter(
        Ledger.driver_id == driver_id
    ).order_by(Ledger.created_at.desc()).offset(skip).limit(limit).all()


@router.post("/{driver_id}/ledger/manual", response_model=LedgerResponse, status_code=status.HTTP_201_CREATED)
def create_manual_ledger_entry(
    driver_id: UUID,
    request: ManualLedgerCreate,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    entry_time = _to_utc_naive(request.date) or datetime.utcnow()
    window_start = entry_time - timedelta(minutes=1)
    window_end = entry_time + timedelta(minutes=1)
    overlap_count = db.query(Ledger).filter(
        Ledger.driver_id == driver_id,
        Ledger.created_at >= window_start,
        Ledger.created_at <= window_end,
    ).count()
    if overlap_count > 0 and not request.acknowledge_overlap:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Manual ledger entry overlaps with existing record",
                "overlap_count": overlap_count,
            },
        )

    ledger_entry = Ledger(
        driver_id=driver.id,
        type="debit" if request.entry_type == "charge" else "credit",
        amount=request.amount,
        description=request.notes or ("Manual charge" if request.entry_type == "charge" else "Manual credit"),
        entry_source="manual",
        created_at=entry_time,
    )
    db.add(ledger_entry)
    db.commit()
    db.refresh(ledger_entry)
    return ledger_entry


@router.post("/{driver_id}/ledger/{ledger_id}/cancel", response_model=LedgerResponse)
def cancel_ledger_entry(
    driver_id: UUID,
    ledger_id: UUID,
    request: LedgerCancelRequest | None = None,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    entry = db.query(Ledger).filter(
        Ledger.id == ledger_id,
        Ledger.driver_id == driver_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Ledger entry not found")

    if entry.entry_source == "reversal":
        raise HTTPException(status_code=400, detail="Reversal entries cannot be canceled")

    existing_reversal = db.query(Ledger).filter(
        Ledger.driver_id == driver_id,
        Ledger.reversal_of_id == entry.id,
    ).first()
    if existing_reversal:
        raise HTTPException(status_code=400, detail="This entry is already canceled")

    reversal_type = "debit" if (entry.type.value if hasattr(entry.type, "value") else entry.type) == "credit" else "credit"
    reason = request.reason.strip() if request and request.reason else "Canceled from driver profile"
    reversal_entry = Ledger(
        driver_id=entry.driver_id,
        type=reversal_type,
        amount=entry.amount,
        description=f"Reversal of entry {entry.id}: {entry.description or ''} ({reason})".strip(),
        entry_source="reversal",
        reversal_of_id=entry.id,
        created_at=datetime.utcnow(),
    )
    db.add(reversal_entry)
    db.commit()
    db.refresh(reversal_entry)
    return reversal_entry


@router.get("/{driver_id}/vehicle-assignments", response_model=list[VehicleAssignmentResponse])
def list_driver_vehicle_assignments(
    driver_id: UUID,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    assignments = db.query(DriverVehicleAssignment).options(
        joinedload(DriverVehicleAssignment.driver),
        joinedload(DriverVehicleAssignment.vehicle),
    ).filter(
        DriverVehicleAssignment.driver_id == driver_id
    ).order_by(DriverVehicleAssignment.start_at.desc()).all()
    return [_serialize_assignment(assignment) for assignment in assignments]


@router.post("/{driver_id}/swap-vehicle")
def swap_vehicle(
    driver_id: UUID,
    request: SwapVehicleRequest,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user),
):
    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    now = datetime.utcnow()
    swap_time = _to_utc_naive(request.start_at) or now

    active_assignment = db.query(DriverVehicleAssignment).options(
        joinedload(DriverVehicleAssignment.driver),
        joinedload(DriverVehicleAssignment.vehicle),
    ).filter(
        DriverVehicleAssignment.driver_id == driver_id,
        DriverVehicleAssignment.end_at.is_(None),
    ).order_by(DriverVehicleAssignment.start_at.desc()).first()

    if active_assignment:
        active_assignment.end_at = swap_time if swap_time >= active_assignment.start_at else active_assignment.start_at

    vehicle = _get_or_create_vehicle(db, request.new_license_plate)
    overlaps = _get_assignment_overlaps(
        db,
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        start_at=swap_time,
        end_at=None,
    )
    if overlaps and not request.acknowledge_overlap:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Swap overlaps with existing records",
                "overlaps": overlaps,
            },
        )

    new_assignment = DriverVehicleAssignment(
        driver_id=driver.id,
        vehicle_id=vehicle.id,
        start_at=swap_time,
        end_at=None,
        previous_assignment_id=active_assignment.id if active_assignment else None,
    )
    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)

    if active_assignment:
        db.refresh(active_assignment)
        active_assignment = db.query(DriverVehicleAssignment).options(
            joinedload(DriverVehicleAssignment.driver),
            joinedload(DriverVehicleAssignment.vehicle),
        ).filter(DriverVehicleAssignment.id == active_assignment.id).first()

    new_assignment = db.query(DriverVehicleAssignment).options(
        joinedload(DriverVehicleAssignment.driver),
        joinedload(DriverVehicleAssignment.vehicle),
    ).filter(DriverVehicleAssignment.id == new_assignment.id).first()

    return {
        "ended_assignment": _serialize_assignment(active_assignment) if active_assignment else None,
        "new_assignment": _serialize_assignment(new_assignment),
    }
