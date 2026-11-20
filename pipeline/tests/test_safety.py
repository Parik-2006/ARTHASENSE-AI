import pytest

from conftest import reset_test_database


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@127.0.0.1:5432/arthasense",
        "postgresql://u:p@127.0.0.1:5432/postgres",
        "postgresql://u:p@127.0.0.1:5432/production",
    ],
)
def test_destructive_reset_refuses_non_test_databases(url):
    # Raises before any connection is attempted, so the check itself cannot touch a database.
    with pytest.raises(RuntimeError, match="refusing to wipe"):
        reset_test_database(url)
