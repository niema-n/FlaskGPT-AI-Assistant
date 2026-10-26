# FlaskGPT-AI-Assistant
# FlaskGPT — AI-Powered Assistant & Data Analytics Platform

**An intelligent web application combining generative AI, conversational assistance, data quality analysis, and performance monitoring.**

FlaskGPT is a Flask-based AI assistant designed to provide domain-specific conversations, persistent chat history, document processing, data quality assessment, and analytics through a centralized web interface.

The project demonstrates the integration of Large Language Models (LLMs) into a full-stack Python application, with an emphasis on usability, data management, reliability, and performance evaluation.

## Key Features

### 1. AI-Powered Conversational Assistant
- Interactive chatbot powered by the Groq API.
- Domain-specific conversations with contextual responses.
- Conversation history stored in SQLite.
- Support for new conversations and previous chat retrieval.
- Response generation feedback and error recovery.
- Handling of API authentication errors, rate limits, connection failures, and timeouts.

### 2. Data Quality & Governance
- Dataset import and automated quality assessment.
- Detection of missing values and duplicate records.
- Identification of inconsistent data and potential anomalies.
- Generation of data quality indicators and analysis reports.
- Centralized access to recorded data quality results.

### 3. Document Management & Export
- Management of supported document and data sources.
- Conversation export to supported formats, including PDF, TXT, and JSON.
- PDF conversation summaries.
- Document-based workflows integrated into the application.

### 4. Analytics Dashboard
- Overview of conversations and completed requests.
- Response time monitoring.
- Performance analysis by conversation domain.
- Request status tracking, including failures and interrupted responses.
- Token usage reporting when usage metrics are provided by the API.
- Recent conversation activity and user feedback.
- Data quality reporting overview.

### 5. User Experience
- Responsive web interface.
- Dark mode support.
- Sidebar navigation between application sections.
- Loading indicators and request retry functionality.
- Dedicated dashboard and data analysis views.

## Technology Stack

| Category | Technologies |
|---|---|
| Backend | Python, Flask |
| AI Integration | Groq API, Large Language Models |
| Database | SQLite |
| Frontend | HTML, JavaScript, Tailwind CSS |
| Data Processing | Python-based data validation and analysis |
| Document Generation | ReportLab, PDF processing tools |
| Dependency Management | Poetry, npm |
| Testing | Python unittest, JavaScript validation |

## Project Structure

```text
FlaskGPT-AI-Assistant/
├── app.py
├── pyproject.toml
├── package.json
├── templates/
│   └── index.html
├── static/
│   └── dist/
│       ├── css/
│       │   └── style.css
│       └── js/
│           └── script.js
├── tests/
│   └── test_app.py
├── instance/
│   └── flaskgpt.sqlite3
├── .env
└── README.md
```

*This structure highlights the main application files. Additional configuration files and directories may be present.*

## Installation and Setup

### Prerequisites

Before running the application, ensure you have:

- Python compatible with the project's `pyproject.toml`.
- Poetry for Python dependency management.
- Node.js and npm for frontend dependencies.
- A Groq API key for AI-powered responses.

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/FlaskGPT-AI-Assistant.git
cd FlaskGPT-AI-Assistant
```

Replace `YOUR_USERNAME` with your GitHub username.

### 2. Install Python Dependencies

```bash
poetry install --no-root
```

### 3. Install Frontend Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the project root and add your API key:

```env
GROQ_API_KEY=your_groq_api_key_here
```

Never commit your actual API key or `.env` file to GitHub.

### 5. Build Tailwind CSS

```bash
npm run build:css
```

For frontend development, use the CSS watch script if available:

```bash
npm run watch:css
```

### 6. Run the Application

```bash
poetry run python app.py
```

Open your browser and navigate to:

`http://127.0.0.1:5000`

## Testing & Quality Assurance

FlaskGPT includes automated tests covering key backend functionalities and error-handling scenarios.

Run the test suite with:

```bash
poetry run python -m unittest discover -s tests -v
```

**Latest reported validation: 29 tests passed, 0 failures.**

The automated checks cover:

- Conversation management and domain persistence.
- Database operations and migrations.
- Simulated Groq API failures.
- Interrupted response
