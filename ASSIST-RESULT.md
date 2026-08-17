# Workspace Error Forwarding Assist Result

This branch is an isolated handoff for the primary WhaleMaid session. It does not modify the primary worktree.

## DSH Source Commit

- DSH worktree: `.dsh-source`
- DSH branch: `assist/workspace-error-forwarding`
- DSH commit: `013bdb0 fix(web): surface workspace selection failures`
- Portable patch: `patches/deepseek-harness-workspace-error-forwarding.patch`

Apply the patch to the intended DeepSeek Harness checkout with:

```sh
git am /path/to/deepseek-harness-workspace-error-forwarding.patch
```

## Behavior

- Existing Workspace selection waits for its blank Session to become ready.
- Host failures such as protected Windows directories, POSIX `EPERM`, read-only storage, or Workspace attachment failures remain visible as the original Host message.
- The Workspace picker shows `无法进入工作区` / `Couldn’t enter workspace` and retries the same Workspace id.
- Directory picking and path adoption keep their separate `无法打开文件夹` / `Choose again` flow.
- Workspace actions stay disabled while selection or adoption is in progress.
- `WorkspaceRuntime.startSession()` returns a Promise instead of swallowing rejection; existing UI callers without an error surface explicitly retain their previous console diagnostic, avoiding unhandled rejections.

## Verification

Passed in the isolated checkout:

- 86 focused tests across runtime, conversation, workspace, sidebar, and agent-preset packages.
- 937 bilingual documentation pairs.
- 542 Agent Note format checks.
- Staged pre-commit lint, translation pairing, whitespace, and vendor guard.
- `git diff --check`.

Before isolation, the same source changes passed focused package typechecks and 66 focused tests in the existing source checkout. In the clean isolated worktree, aggregate typecheck is blocked by a baseline-generated Typert merge missing `commands`; this is unrelated to the patch and is not claimed green.

## Integration Context

The bug was observed through WhaleMaid Android against the real DSH profile: the Host returned `workspace-attach-failed` with an underlying `EPERM`, while `ConversationRoot` silently rolled back the optimistic Workspace label. The patch changes only DSH client runtime/presentation behavior; it does not change WhaleMaid transport, Host filesystem policy, wire methods, or durable formats.
