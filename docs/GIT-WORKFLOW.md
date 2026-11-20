# Git workflow: keeping `main` current without losing code

Repository: <https://github.com/Parik-2006/ARTHASENSE-AI> . Work on the local branch `main`, which tracks `origin/main`.

**Branch note.** GitHub's *default* branch is still `master`, which still points at the original first commit. The
project lives on `main`. Changing the default branch is a separate decision made in GitHub's repository settings
(Settings, Branches); do not delete `master`.

**Never** use `git push --force`, `--force-with-lease`, `git reset --hard`, or history rewriting on a shared branch.
If a push is rejected, fetch and understand why; do not override it.

## Every time (PowerShell, from the repo root)

```powershell
# 1. Where am I, and has GitHub moved?
git fetch origin --prune
git status --short --branch              # expect: ## main...origin/main  (ahead/behind counts)

# 2. Bring in anything new from GitHub (safe: fast-forward only; stops if histories diverged)
git merge --ff-only origin/main

# 3. Review what changed
git status --short
git diff --stat
git diff --check

# 4. Run the checks (use the throwaway *_test database for the database-backed tests)
$t = (Get-Content .env | ? { $_ -like 'ARTHASENSE_TEST_DATABASE_URL=*' }); $env:ARTHASENSE_TEST_DATABASE_URL = $t.Substring($t.IndexOf('=')+1)
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check . ; .\.venv\Scripts\python.exe -m ruff format --check .
cd apps\web; npm test; npm run typecheck; npm run lint; npm run build; cd ..\..

# 5. Stage deliberately (name paths; avoid `git add .` / `git add -A`) and look at what is staged
git add -- <the paths you changed>
git diff --cached --name-status
git diff --cached --check
git grep --cached -I -n -E "postgres(ql)?://[^:/\s]+:[^@\s]{4,}@|ghp_|github_pat_|BEGIN (RSA |EC )?PRIVATE KEY"   # expect no output

# 6. Commit and push (a normal push)
git commit -m "type: short description"
git push origin main

# 7. Verify on GitHub, not just locally
git fetch origin
git rev-parse HEAD
git ls-remote --heads origin main        # the two SHAs must match
```

## Never commit

`.env` and any file with a real password or token (only `.env.example` with placeholders is tracked), `.venv/`,
`node_modules/`, `.next/`, database dumps, local PostgreSQL data, model weights, scratch scripts. `.gitignore`
already covers these. If a secret is ever committed, adding it to `.gitignore` is not enough: rotate the credential
first, then ask before cleaning history.

## If something goes wrong

* `git merge --ff-only` refuses: the histories diverged. Stop and compare with `git log --oneline --graph --all`; merge
  or rebase only when you understand both sides.
* Push rejected (`non-fast-forward`): someone pushed first. Fetch, review, integrate, then push again. Never force.
* Authentication fails: sign in through Git Credential Manager or a GitHub personal access token entered when prompted.
  Never put a token in the remote URL or in a file in this repository.
