import os
import sys
from pathlib import Path


def configure_test_environment() -> None:
    _add_project_root_to_path()
    _set_test_environment_variables()


def _add_project_root_to_path() -> None:
    project_root = Path(__file__).resolve().parents[2]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))


def _set_test_environment_variables() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-with-at-least-32-bytes")
    os.environ.setdefault("MEMOLINK_SKIP_DB_BOOTSTRAP", "1")
