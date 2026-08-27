# Publish checklist

Local commit and tag `v0.2.0` are ready. Complete these steps with your credentials.

## 1. GitHub

Create the repository if it does not exist:

```sh
# With GitHub CLI:
gh repo create openenvx/functhis --public --source=. --remote=origin --push

# Or manually create github.com/openenvx/functhis, then:
git push -u origin main
git push origin v0.2.0
```

## 2. npm

Run release checks first:

```sh
bun run verify-release
```

Add `NPM_TOKEN` to GitHub repository secrets (Automation or Publish token), then either:

**Option A — CI publish (recommended):** pushing tag `v0.2.0` triggers [.github/workflows/publish.yml](../.github/workflows/publish.yml).

**Option B — local publish:**

```sh
bun run check-types
bun run build
bun run test
npm login   # or export NPM_TOKEN=...
npm publish --access public
```

Verify:

```sh
npm view functhis version
npm install -g functhis
fn --version   # expect 0.2.0
```

## 3. Post-publish

Follow [LAUNCH.md](./LAUNCH.md): Skill marketplace install, five-minute demo post, track toward 20 external installs.

Do not start Cloud or HTTP work until [VALIDATION.md](./VALIDATION.md) gates pass.
