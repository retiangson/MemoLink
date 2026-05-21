import pytest
from faker import Faker

from tests.helpers.test_environment import configure_test_environment

configure_test_environment()

from tests.helpers.database import create_in_memory_session  # noqa: E402
from tests.helpers.model_registry import register_models  # noqa: E402

register_models()


@pytest.fixture
def fake():
    return Faker()


@pytest.fixture
def db_session():
    yield from create_in_memory_session()
