import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app_historimed.db")

# connect_args={"check_same_thread": False} é necessário apenas para SQLite no FastAPI/Flask
engine = create_engine(
    DATABASE_URL, 
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """Dependency para injeção da sessão de banco no backend."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()