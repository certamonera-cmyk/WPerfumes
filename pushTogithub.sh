set -euo pipefail

# ----- CONFIG -----
OWNER_REPO="certamonera-cmyk/WPerfumes"   # <owner>/<repo>
ORIGIN_URL="https://github.com/${OWNER_REPO}.git"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo master)}"
FORCE_PUSH="${FORCE_PUSH:-false}"   # set to "true" to force push (dangerous)
# ------------------

# Optional commit message provided as first arg
if [ $# -ge 1 ]; then
  USER_MSG="$1"
else
  USER_MSG=""
fi

# Ensure we are in a git repo
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: Not inside a git repository. cd to your repo root and retry."
  exit 1
fi

# Change to repo root (safe)
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "Repository root: $REPO_ROOT"

# Ensure origin is set to the target repo (replace if different)
if git remote | grep -q '^origin$'; then
  CURRENT_ORIGIN_URL="$(git remote get-url origin)"
  if [ "$CURRENT_ORIGIN_URL" != "$ORIGIN_URL" ]; then
    echo "Updating origin URL to: $ORIGIN_URL"
    git remote set-url origin "$ORIGIN_URL"
  else
    echo "Origin already points to $ORIGIN_URL"
  fi
else
  echo "Adding origin: $ORIGIN_URL"
  git remote add origin "$ORIGIN_URL"
fi

# Refresh branch name (in case BRANCH was derived earlier)
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Current branch: $BRANCH"

# Fetch remote and rebase locally to keep history linear
echo "Fetching origin..."
git fetch origin --prune

echo "Rebasing local ${BRANCH} onto origin/${BRANCH} (if exists)..."
# If remote branch doesn't exist yet, git pull will fail; guard with remote check
if git ls-remote --exit-code --heads origin "${BRANCH}" >/dev/null 2>&1; then
  # Use pull --rebase --autostash for non-interactive rebasing of local changes
  git pull --rebase --autostash origin "$BRANCH"
else
  echo "Remote branch origin/${BRANCH} does not exist yet. Continuing without rebase."
fi

# Stage all changes (new/modified/deleted)
git add -A

# Commit if there are staged changes
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  # Use provided message or timestamped message
  if [ -n "$USER_MSG" ]; then
    COMMIT_MSG="$USER_MSG"
  else
    COMMIT_MSG="Update: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  fi
  echo "Committing changes: $COMMIT_MSG"
  git commit -m "$COMMIT_MSG" --no-verify
fi

# Determine local HEAD
LOCAL_SHA="$(git rev-parse HEAD)"
echo "Local HEAD: $LOCAL_SHA"

# Push to origin:
# - If GITHUB_TOKEN is set, use token in push URL for non-interactive push
# - Otherwise attempt a normal git push (may prompt for credentials)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "Performing non-interactive push using GITHUB_TOKEN..."
  # Construct temporary push URL - will not change origin permanently
  PUSH_URL="https://${GITHUB_TOKEN}@github.com/${OWNER_REPO}.git"

  if git push "$PUSH_URL" "$BRANCH:$BRANCH"; then
    echo "Push succeeded via token."
  else
    echo "Push failed via token."
    if [ "$FORCE_PUSH" = "true" ]; then
      echo "Attempting force push (FORCE_PUSH=true) via token..."
      git push --force "$PUSH_URL" "$BRANCH:$BRANCH"
      echo "Force push completed."
    else
      echo "Remote rejected non-fast-forward. If you really want to overwrite remote history set FORCE_PUSH=true."
      exit 1
    fi
  fi
else
  echo "No GITHUB_TOKEN set. Attempting interactive push to origin (may prompt for credentials)..."
  if git push origin "$BRANCH"; then
    echo "Push succeeded to origin."
  else
    echo "Push failed. To push non-interactively, export a GITHUB_TOKEN (PAT) in your shell and re-run this script."
    exit 1
  fi
fi

# Verify remote now contains the commit
REMOTE_SHA="$(git ls-remote --refs "https://github.com/${OWNER_REPO}.git" "refs/heads/${BRANCH}" 2>/dev/null | awk '{print $1}')"
if [ -z "$REMOTE_SHA" ]; then
  # fallback to origin
  REMOTE_SHA="$(git ls-remote --refs origin "refs/heads/${BRANCH}" | awk '{print $1}')"
fi

echo "Remote HEAD: $REMOTE_SHA"

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "ERROR: push did not update remote correctly (local != remote)."
  echo "Local:  $LOCAL_SHA"
  echo "Remote: $REMOTE_SHA"
  exit 1
fi

echo "Push verified: commit $LOCAL_SHA is on origin/${BRANCH} (owner: certamonera-cmyk)."

# Optionally unset token for safety
if [ -n "${GITHUB_TOKEN:-}" ]; then
  unset GITHUB_TOKEN
  echo "Cleared GITHUB_TOKEN from environment for safety."
fi

echo "All done. GitHub has been updated and Render (if configured with webhook) should start an automatic deploy."