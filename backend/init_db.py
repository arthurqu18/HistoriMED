from backend.database.connection import engine, Base
from backend.database.models import User, Exam, ExamResult, ExamSummary

def init_database():
    print("Criando tabelas no banco de dados SQLite...")
    Base.metadata.create_all(bind=engine)
    print("Banco de dados inicializado com sucesso!")

if __name__ == "__main__":
    init_database()