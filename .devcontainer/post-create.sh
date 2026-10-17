#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Setting up Python venv"
python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -r backend/requirements.txt

echo "==> Installing frontend dependencies"
cd frontend
npm install
cd "$REPO_ROOT"

if [ ! -f backend/.env ]; then
  echo ""
  echo "WARNING: backend/.env not found."
  echo "Create backend/.env with at least:"
  echo "  SPACE_NAME=your-space.signalwire.com"
  echo "  PROJECT_ID=your-project-id"
  echo "  AUTH_TOKEN=your-auth-token"
  echo "  DIALER_API_KEY=some-random-value   # required, or /api/auth/token fails closed"
  echo "Optional: PORT, FRONTEND_URL"
  echo ""
fi
