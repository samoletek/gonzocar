from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


# Auth
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class StaffBase(BaseModel):
    email: EmailStr
    name: str


class StaffCreate(StaffBase):
    password: str


class StaffResponse(StaffBase):
    id: UUID
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


# Drivers
class DriverBase(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str
    billing_type: str = "daily"
    billing_rate: float
    weekly_due_day: Optional[str] = None
    billing_status: str = "active"
    deposit_required: float = 0.0
    deposit_posted: float = 0.0
    deposit_updated_at: Optional[datetime] = None


class DriverCreate(DriverBase):
    portal_token: Optional[str] = None


class DriverUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    billing_type: Optional[str] = None
    billing_rate: Optional[float] = None
    weekly_due_day: Optional[str] = None
    billing_active: Optional[bool] = None
    billing_status: Optional[str] = None
    deposit_required: Optional[float] = None
    deposit_posted: Optional[float] = None
    deposit_updated_at: Optional[datetime] = None
    terminated_at: Optional[datetime] = None
    application_info: Optional[dict] = None


class DriverDeleteRequest(BaseModel):
    confirmation_name: str


class DriverResponse(DriverBase):
    id: UUID
    billing_active: bool
    terminated_at: Optional[datetime] = None
    portal_token: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    balance: Optional[float] = None
    application_info: Optional[dict] = None

    class Config:
        from_attributes = True


class BillingStatusUpdate(BaseModel):
    status: Literal["active", "paused", "terminated"]


# Applications
class ApplicationCreate(BaseModel):
    form_data: dict


class ApplicationStatusUpdate(BaseModel):
    status: str
    message: Optional[str] = None


class CommentCreate(BaseModel):
    content: str


class CommentResponse(BaseModel):
    id: UUID
    content: str
    staff_id: UUID
    staff_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ApplicationResponse(BaseModel):
    id: UUID
    status: str
    form_data: dict
    driver_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    comments: list[CommentResponse] = []

    class Config:
        from_attributes = True


# Aliases
class AliasCreate(BaseModel):
    alias_type: str
    alias_value: str


class AliasResponse(BaseModel):
    id: UUID
    alias_type: str
    alias_value: str
    created_at: datetime

    class Config:
        from_attributes = True


# Payments
class PaymentAssign(BaseModel):
    driver_id: UUID
    create_alias: bool = True


class PaymentResponse(BaseModel):
    id: UUID
    source: str
    amount: float
    sender_name: Optional[str] = None
    sender_identifier: Optional[str] = None
    transaction_id: Optional[str] = None
    memo: Optional[str] = None
    received_at: Optional[datetime] = None
    matched: bool
    driver_id: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Ledger
class LedgerResponse(BaseModel):
    id: UUID
    type: str
    amount: float
    description: Optional[str] = None
    entry_source: Optional[str] = None
    reversal_of_id: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ManualLedgerCreate(BaseModel):
    entry_type: Literal["charge", "credit"]
    amount: float = Field(gt=0)
    date: Optional[datetime] = None
    notes: Optional[str] = None
    acknowledge_overlap: bool = False


class LedgerCancelRequest(BaseModel):
    reason: Optional[str] = None


# Vehicle assignments / ticket liability
class VehicleAssignmentCreate(BaseModel):
    driver_id: UUID
    license_plate: str
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    previous_assignment_id: Optional[UUID] = None
    acknowledge_overlap: bool = False


class VehicleAssignmentUpdate(BaseModel):
    license_plate: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    acknowledge_overlap: bool = False


class VehicleAssignmentResponse(BaseModel):
    id: UUID
    driver_id: UUID
    driver_name: str
    license_plate: str
    start_at: datetime
    end_at: Optional[datetime] = None
    previous_assignment_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime


class SwapVehicleRequest(BaseModel):
    new_license_plate: str
    start_at: Optional[datetime] = None
    acknowledge_overlap: bool = False
