import pytest

from pipeline.ingest import history, runner
from pipeline.ingest.safety import RemoteTargetRefused, require_allowed_host

REMOTE = "postgresql://u:secretpw@aws-0-x.pooler.supabase.com:5432/postgres"
LOCAL = "postgresql://u:pw@127.0.0.1:5432/db"


def test_local_hosts_allowed():
    assert require_allowed_host(LOCAL) == "127.0.0.1"
    assert require_allowed_host("postgresql://u:pw@localhost/db") == "localhost"


def test_remote_refused_and_secret_not_leaked():
    with pytest.raises(RemoteTargetRefused) as e:
        require_allowed_host(REMOTE)
    assert "secretpw" not in str(e.value) and "supabase" in str(e.value)


def test_explicit_allow_host_permits():
    assert require_allowed_host(REMOTE, "aws-0-x.pooler.supabase.com")


@pytest.mark.parametrize("cmd", ["history", "runner"])
def test_write_commands_refuse_remote(monkeypatch, capsys, cmd):
    monkeypatch.setenv("ARTHASENSE_DATABASE_URL", REMOTE)
    if cmd == "history":
        rc = history.run(["wpi", "--start-year", "2025", "--end-year", "2025"], client=object())
    else:
        from pipeline.ingest import wpi

        rc = runner.run_cli(wpi.INGESTER, ["--year", "2025"], client=object())
    err = capsys.readouterr().err
    assert rc == 2 and "not local" in err and "secretpw" not in err
