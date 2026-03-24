## python scripts/clean_payments.py

import asyncio
import os
import sys

# Add parent directory to path to allow imports from app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.core.database import SessionLocal

def clean_payments():
    """
    Cleans all entries from the payments_raw table.
    Use this to reset the dashboard before a demo.
    """
    db = SessionLocal()
    try:
        print("Cleaning 'payments_raw' table...")
        
        # Count before
        count = db.execute(text("SELECT COUNT(*) FROM payments_raw")).scalar()
        print(f"   Found {count} existing records.")
        
        # Delete all
        db.execute(text("DELETE FROM payments_raw"))
        db.commit()
        
        print("Successfully deleted all records from payments_raw.")
        print("   The Admin Dashboard > Payments page should now be empty.")
        
    except Exception as e:
        print(f"Error cleaning database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    # check for confirmation
    confirm = input("This will DELETE ALL PAYMENT HISTORY from the database. Are you sure? (y/n): ")
    if confirm.lower() == 'y':
        clean_payments()
    else:
        print("Operation cancelled.")
