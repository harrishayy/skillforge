#!/bin/bash
# Start the SkillForge API server
# Usage: ./start.sh

cd "$(dirname "$0")"
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --ws wsproto --reload
