"""
System status endpoint for checking service health.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
import os
import httpx

from app.api.deps import get_db, get_current_user
from app.core.config import get_settings
from app.models import Staff
from app.services.gmail_service import GmailService
from scripts.parse_payments import (
    compute_backfill_hours,
    get_db as get_parser_db,
    get_last_payment_created_at,
    run_with_gmail,
)

router = APIRouter(prefix="/status", tags=["status"])


@router.get("")
def get_system_status(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(get_current_user)
):
    """Get system status for all integrations."""
    status = {
        "database": check_database(db),
        "openphone": check_openphone(),
        "gmail": check_gmail(),
    }
    return status


@router.post("/run-payment-parser")
def run_payment_parser(
    authorization: str | None = Header(default=None),
    x_cron_token: str | None = Header(default=None),
):
    """
    Trigger payment parser from Railway cron function.
    Protected by INTERNAL_CRON_TOKEN.
    """
    settings = get_settings()
    expected_token = (settings.internal_cron_token or "").strip()
    if not expected_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal cron token not configured",
        )

    provided_token = (x_cron_token or "").strip()
    if not provided_token and authorization:
        auth_value = authorization.strip()
        if auth_value.lower().startswith("bearer "):
            provided_token = auth_value[7:].strip()

    if provided_token != expected_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid cron token")

    parser_db = get_parser_db()
    last_created_at = None
    try:
        last_created_at = get_last_payment_created_at(parser_db)
    finally:
        parser_db.close()

    hours = 1
    max_results = 200
    if last_created_at:
        hours = compute_backfill_hours(last_created_at, min_hours=hours, safety_hours=1)
        max_results = 2000

    success = run_with_gmail(hours=hours, max_results=max_results)
    if not success:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Payment parser run failed")

    return {
        "ok": True,
        "executed_at": datetime.utcnow().isoformat(),
        "lookback_hours": hours,
        "max_results": max_results,
        "last_payment_created_at": last_created_at.isoformat() if last_created_at else None,
    }


def check_database(db: Session) -> dict:
    """Check database connection."""
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "message": "Connected"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def check_openphone() -> dict:
    """Check OpenPhone API reachability and credentials."""
    api_key = (os.getenv("OPENPHONE_API_KEY") or "").strip()
    phone = (os.getenv("OPENPHONE_PHONE_NUMBER") or "").strip()

    if len(api_key) <= 10:
        return {"status": "error", "message": "API key not set"}

    try:
        with httpx.Client(timeout=8.0) as client:
            response = client.get(
                "https://api.openphone.com/v1/phone-numbers",
                headers={"Authorization": api_key},
            )
    except Exception as exc:
        return {"status": "warning", "message": f"OpenPhone unreachable: {exc}"}

    if response.status_code in {401, 403}:
        return {"status": "error", "message": "Invalid OpenPhone API key"}
    if response.status_code >= 500:
        return {"status": "warning", "message": f"OpenPhone API unavailable ({response.status_code})"}
    if response.status_code != 200:
        return {"status": "warning", "message": f"OpenPhone API returned {response.status_code}"}

    if not phone:
        return {"status": "ok", "message": "Connected"}

    try:
        payload = response.json()
    except Exception:
        return {"status": "warning", "message": "Connected (phone validation skipped)"}

    records = payload.get("data") if isinstance(payload, dict) else []
    if not isinstance(records, list):
        return {"status": "warning", "message": "Connected (unexpected response format)"}

    target_digits = "".join(ch for ch in phone if ch.isdigit())
    phone_found = False
    for record in records:
        if not isinstance(record, dict):
            continue
        candidate = record.get("phoneNumber") or record.get("number") or ""
        candidate_digits = "".join(ch for ch in str(candidate) if ch.isdigit())
        if candidate_digits == target_digits:
            phone_found = True
            break

    if phone_found:
        return {"status": "ok", "message": "Connected"}
    return {"status": "warning", "message": "Connected (configured phone not found)"}


def check_gmail() -> dict:
    """Check Gmail API auth and mailbox connectivity."""
    # Check env variables first (production)
    creds_env = os.getenv("GMAIL_CREDENTIALS")
    token_env = os.getenv("GMAIL_TOKEN")

    # Check if credentials files exist (local)
    creds_exists = os.path.exists("credentials.json")
    token_exists = os.path.exists("token.json")

    if not ((creds_env and token_env) or (creds_exists and token_exists)):
        if creds_env or creds_exists:
            return {"status": "warning", "message": "Needs authorization"}
        return {"status": "error", "message": "Credentials not found"}

    try:
        gmail = GmailService()
        profile = gmail.service.users().getProfile(userId="me").execute()
        connected_as = profile.get("emailAddress")
        if connected_as:
            return {"status": "ok", "message": f"Connected ({connected_as})"}
        return {"status": "ok", "message": "Connected"}
    except Exception as exc:
        return {"status": "error", "message": f"Gmail auth failed: {str(exc)[:180]}"}
