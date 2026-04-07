import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Boolean, Numeric, Text, DateTime,
    ForeignKey, Enum, LargeBinary, Index, func
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


# Enums
class BillingType(str, enum.Enum):
    daily = "daily"
    weekly = "weekly"


class BillingStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    terminated = "terminated"


class ApplicationStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    declined = "declined"
    hold = "hold"
    onboarding = "onboarding"


class AliasType(str, enum.Enum):
    email = "email"
    phone = "phone"
    venmo = "venmo"
    cashapp = "cashapp"
    zelle = "zelle"
    chime = "chime"


class PaymentSource(str, enum.Enum):
    zelle = "zelle"
    venmo = "venmo"
    cashapp = "cashapp"
    chime = "chime"
    stripe = "stripe"


class LedgerType(str, enum.Enum):
    credit = "credit"
    debit = "debit"


class StaffRole(str, enum.Enum):
    admin = "admin"
    staff = "staff"


# Models
class Driver(Base):
    __tablename__ = "drivers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(20), nullable=False)
    dob_encrypted = Column(LargeBinary, nullable=True)
    address_encrypted = Column(LargeBinary, nullable=True)
    billing_type = Column(Enum(BillingType), default=BillingType.daily)
    billing_rate = Column(Numeric(10, 2), nullable=False)
    weekly_due_day = Column(String(16), nullable=True)
    billing_active = Column(Boolean, default=True)
    billing_status = Column(Enum(BillingStatus), default=BillingStatus.active, nullable=False)
    deposit_required = Column(Numeric(10, 2), default=0)
    deposit_posted = Column(Numeric(10, 2), default=0)
    deposit_updated_at = Column(DateTime, nullable=True)
    terminated_at = Column(DateTime, nullable=True)
    portal_token = Column(String(64), unique=True, nullable=False, default=lambda: uuid.uuid4().hex)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    applications = relationship("Application", back_populates="driver")
    aliases = relationship("Alias", back_populates="driver", cascade="all, delete-orphan")
    payments = relationship("PaymentRaw", back_populates="driver")
    ledger_entries = relationship("Ledger", back_populates="driver")
    sms_logs = relationship("SmsLog", back_populates="driver")
    vehicle_assignments = relationship("DriverVehicleAssignment", back_populates="driver", cascade="all, delete-orphan")


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    license_plate = Column(String(20), unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    assignments = relationship("DriverVehicleAssignment", back_populates="vehicle", cascade="all, delete-orphan")


class DriverVehicleAssignment(Base):
    __tablename__ = "driver_vehicle_assignments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_id = Column(UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False)
    vehicle_id = Column(UUID(as_uuid=True), ForeignKey("vehicles.id"), nullable=False)
    start_at = Column(DateTime, nullable=False)
    end_at = Column(DateTime, nullable=True)
    previous_assignment_id = Column(UUID(as_uuid=True), ForeignKey("driver_vehicle_assignments.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    driver = relationship("Driver", back_populates="vehicle_assignments")
    vehicle = relationship("Vehicle", back_populates="assignments")
    previous_assignment = relationship("DriverVehicleAssignment", remote_side=[id], uselist=False)


class Application(Base):
    __tablename__ = "applications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status = Column(Enum(ApplicationStatus), default=ApplicationStatus.pending)
    form_data = Column(JSONB, nullable=False)
    driver_id = Column(UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    driver = relationship("Driver", back_populates="applications")
    comments = relationship("ApplicationComment", back_populates="application", cascade="all, delete-orphan")


class ApplicationComment(Base):
    __tablename__ = "application_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id = Column(UUID(as_uuid=True), ForeignKey("applications.id"), nullable=False)
    staff_id = Column(UUID(as_uuid=True), ForeignKey("staff.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    application = relationship("Application", back_populates="comments")
    staff = relationship("Staff", back_populates="comments")


class Alias(Base):
    __tablename__ = "aliases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_id = Column(UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False)
    alias_type = Column(Enum(AliasType), nullable=False)
    alias_value = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    driver = relationship("Driver", back_populates="aliases")

    __table_args__ = (
        # Enforce case-insensitive uniqueness for alias matching.
        Index("uq_aliases_type_lower_value", "alias_type", func.lower(alias_value), unique=True),
        {"sqlite_autoincrement": True},
    )


class PaymentRaw(Base):
    __tablename__ = "payments_raw"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source = Column(Enum(PaymentSource), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    sender_name = Column(String(255), nullable=True)
    sender_identifier = Column(String(255), nullable=True)
    transaction_id = Column(String(255), nullable=True)
    memo = Column(Text, nullable=True)
    gmail_id = Column(String(255), nullable=True)
    received_at = Column(DateTime, nullable=True)
    matched = Column(Boolean, default=False)
    driver_id = Column(UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    driver = relationship("Driver", back_populates="payments")


class Ledger(Base):
    __tablename__ = "ledger"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_id = Column(UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False)
    type = Column(Enum(LedgerType), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    description = Column(String(255), nullable=True)
    reference_id = Column(UUID(as_uuid=True), nullable=True)
    entry_source = Column(String(50), nullable=False, default="system")
    reversal_of_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    driver = relationship("Driver", back_populates="ledger_entries")


class Staff(Base):
    __tablename__ = "staff"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    role = Column(Enum(StaffRole), default=StaffRole.staff)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    comments = relationship("ApplicationComment", back_populates="staff")


class SmsLog(Base):
    __tablename__ = "sms_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_id = Column(UUID(as_uuid=True), ForeignKey("drivers.id"), nullable=False)
    phone = Column(String(20), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(50), nullable=True)
    openphone_response = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    driver = relationship("Driver", back_populates="sms_logs")
