import os
from fastapi import FastAPI
from sqlalchemy import create_engine
from dotenv import load_dotenv

# Pehle .env load karo (Local ke liye zaroori hai)
load_dotenv()

app = FastAPI(title="AuraCRM School API")

# Database URL lo
DATABASE_URL = os.getenv("DATABASE_URL")

# Database Engine banao
if DATABASE_URL:
    # Render/Production me SSL chahiye hota hai, isliye check kar rahe hain
    if "render.com" in DATABASE_URL or "neon.tech" in DATABASE_URL:
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
        
    engine = create_engine(DATABASE_URL)
    print("✅ Database Engine Created Successfully!")
else:
    print("⚠️ DATABASE_URL not found. Please check .env file.")

# Basic Routes
@app.get("/")
def root():
    return {"message": "AuraCRM Server is Live!"}

@app.get("/check-db")
def check_database():
    try:
        with engine.connect() as conn:
            conn.execute("SELECT 1")
            return {"status": "success", "message": "Database connected perfectly!"}
    except Exception as e:
        return {"status": "error", "message": str(e)}