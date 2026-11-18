# Git Push Guide

Push is currently blocked: the remote uses HTTPS but no credential helper is configured and the `gh` CLI is not available.

## Steps to push once credentials are available

1. **Configure a credential helper** (choose one):
   ```bash
   git config credential.helper store
   ```
   or, if you have the GitHub CLI installed:
   ```bash
   gh auth login
   ```

2. **Push to origin**:
   ```bash
   git push origin main
   ```

## Alternative: use a Personal Access Token (PAT)

1. Generate a PAT at <https://github.com/settings/tokens> with `repo` scope.
2. When prompted by git, enter your GitHub username and the PAT as the password.
3. Optionally store it permanently:
   ```bash
   git config credential.helper store
   git push origin main   # enter credentials once; they are stored after this
   ```

## Alternative: switch remote to SSH

```bash
git remote set-url origin git@github.com:<owner>/Fitness_Tracking_System.git
git push origin main
```
