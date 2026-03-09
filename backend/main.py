# Backward-compat shim — canonical entry point is app.main
# Run with:  uvicorn app.main:app --reload
from app.main import app  # noqa: F401
