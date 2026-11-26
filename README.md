# HistoriMED

Plataforma web de centralização de histórico laboratorial e inteligência clínica que transforma laudos médicos (de diferentes laboratórios) em uma linha do tempo padronizada, com extração automatizada de biomarcadores, gráficos evolutivos e síntese executiva para consultas médicas.

## Autores

- **Arthur Henrique Quaresma Gomes** (`@arthurqu18`)
- **Lucas da Silva Santos** (`@lucsantslucas`)

## Sobre o sistema

Pacientes frequentemente acumulam exames laboratoriais espalhados em arquivos PDF de diferentes laboratórios, cada um com formatações e faixas de referência distintas, dificultando o acompanhamento ao longo do tempo e a comunicação durante consultas médicas.

O **HistoriMED** resolve esse problema oferecendo:

- **Cadastro e gestão de perfis clínicos:** Criação de dossiês individuais com idade e sexo biológico, utilizados para contextualizar as faixas de referência laboratoriais.
- **Upload e extração automatizada de laudos (PDF):** Leitura do texto de exames em PDF e extração estruturada de laboratório de origem, data de coleta, categoria, parâmetros, valores numéricos, unidades e status de normalidade.
- **Síntese clínica consolidada:** Geração automática de um parecer objetivo destacando apenas parâmetros alterados ou tendências relevantes, acompanhado de recomendação breve.
- **Linha do tempo e gráficos de evolução:** Visualização interativa por biomarcador com destaque da faixa de referência laboratorial e tabela pesquisável de todos os resultados históricos.
- **Preparo pré-consulta e relatório para impressão:** Formulário de anamnese prévia (sintomas, duração, medicamentos, alergias e dúvidas) com exportação em `.txt` e geração de relatório HTML formatado para impressão médica.
- **Exclusão definitiva de conta e dados:** Remoção completa do cadastro do paciente, arquivos PDF armazenados e registros associados no banco de dados.

## Tecnologias

- **Backend & API REST:** **Python 3.12**, **FastAPI** (`0.142.2`) e **Uvicorn** (`0.54.0`), responsáveis pelas rotas da API, processamento em segundo plano (`BackgroundTasks`), geração de relatórios HTML e entrega da interface web.
- **Banco de Dados & Validação:** **SQLite** com **SQLAlchemy** (`2.1.3`) para persistência relacional (`User`, `Exam`, `ExamResult` e `ExamSummary`) e **Pydantic** (`2.13.5`) para validação de esquemas de entrada/saída e JSON.
- **Processamento de PDF & Inteligência Artificial:** **pypdf** (`6.21.1`) para extração de texto dos laudos digitais e **Ollama** (`llama3.1:latest`) para estruturação dos biomarcadores e geração da síntese clínica.
- **Frontend:** **HTML5**, **CSS3** e **JavaScript (ES6+)** puro, utilizando as fontes **IBM Plex Sans** e **IBM Plex Mono**, gráficos em **SVG** e `localStorage` para persistência da ficha de anamnese pré-consulta.
- **Testes & CI/CD:** **Pytest** (`9.1.1`), **pytest-cov** (`7.1.0`), **pytest-mock** (`3.17.0`), **HTTPX** (`0.28.1`) e **Playwright** (`1.65.2`) integrados a um pipeline no **GitHub Actions** (`.github/workflows/ci.yml`) executado em Linux, macOS e Windows.

## Versão

Disponibilizamos uma versão demo (Static Site) nesse endereço: [HistoriMED - Inteligência Clínica & Histórico Unificado](https://historimed.onrender.com)

## Uso de IA

A inteligência artificial foi empregada de duas formas no **HistoriMED**:

1. **No funcionamento do sistema:**
   - **Ollama (`llama3.1:latest`):** Atua no pipeline `backend/services/ai_service.py` em duas etapas: (a) conversão do texto extraído dos laudos PDF em JSON estruturado validado por *Pydantic JSON Schema* (`ExtractedExamData`), normalizando valores decimais e classificando alterações conforme idade e sexo do paciente; e (b) síntese clínica consolidada (`generate_consolidated_summary`), filtrando pontos de atenção para o painel e o relatório médico.

2. **No apoio ao desenvolvimento:**
   - **GitHub Copilot:** Auxiliou na produtividade da escrita de rotas FastAPI, modelos SQLAlchemy, esquemas Pydantic e refatorações no backend.
   - **Gemini:** Utilizado como colaborador na arquitetura e na qualidade para projetar e refinar a interface web (`frontend/index.html` e `frontend/app.js`), estruturar casos de teste unitários (`tests/test_api.py` e `tests/test_exam.py`), implementar a suíte de 5 testes End-to-End com Playwright (`tests/test_e2e.py`) e configurar o workflow de CI/CD.

## Execução dos testes

Até o momento, o projeto conta com **41 testes automatizados**: **36 testes de unidade** (cobrindo API, modelos, regras de usuário, relatórios e pipeline de IA com *mocks*, sem depender de servidor Ollama ativo) e **5 testes End-to-End (E2E)** em navegador real via Playwright.

### 1. Pré-requisitos e instalação

Na raiz do repositório, crie e ative um ambiente virtual e instale as dependências:

    python -m venv .venv
    source .venv/bin/activate  # No Windows: .venv\Scripts\activate
    pip install --upgrade pip
    pip install -r requirements.txt

Para executar também os testes End-to-End no navegador, instale o Chromium do Playwright:

    python -m playwright install --with-deps chromium

### 2. Executar os testes de unidade e verificar cobertura

    PYTHONPATH=. python -m pytest --ignore=tests/test_e2e.py --cov=backend --cov-report=term-missing --cov-fail-under=80

### 3. Executar os testes End-to-End (Playwright)

    PYTHONPATH=. python -m pytest tests/test_e2e.py -v

### 4. Executar toda a suíte de testes (Unidade + E2E)

    PYTHONPATH=. python -m pytest --cov=backend --cov-report=term-missing
