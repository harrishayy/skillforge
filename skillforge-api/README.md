# SkillForge API

FastAPI backend for SkillForge — pipelines, detection, storage, and copilot.

## Quick Start

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add your ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000 --ws wsproto
```

See **[API Server Setup](../docs/api-server-setup.md)** for full details on endpoints, database, ML services, and architecture.
