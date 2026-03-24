import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.models import Driver

def check_driver_phones():
    db = SessionLocal()
    try:
        drivers = db.query(Driver).all()
        print(f"Found {len(drivers)} drivers:")
        print("-" * 50)
        print(f"{'Name':<30} | {'Phone':<15} | {'Active'}")
        print("-" * 50)
        for d in drivers:
            print(f"{d.first_name} {d.last_name:<20} | {d.phone:<15} | {d.billing_active}")
        print("-" * 50)
    finally:
        db.close()

if __name__ == "__main__":
    check_driver_phones()
