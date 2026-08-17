# Error Boundary Audit

Read-only assist audit for the primary WhaleMaid session. Findings are ordered by severity and refer to the assist branch baseline.

## Findings

### High: Web controller HTTPS pinning is skipped on a reused socket

`apps/controller/web/server.mjs:44-66` installs certificate verification only from the socket's `secureConnect` event. When Node's default agent gives `https.request()` an already-connected socket, that event has already fired and this request reaches its response callback without any pin comparison. A fresh resumed TLS session can also yield an empty `getPeerCertificate(true).raw`; the current code hashes an empty buffer and may persist that value on first use. This is the same failure class fixed for the controlled plugin in `d613f9a`, but the Web/Electron controller path still has it. `assertWssFingerprint()` at lines 33-38 likewise treats missing certificate bytes as an ordinary empty fingerprint rather than a distinct fail-closed condition.

Pass rule: every HTTPS/WSS authorization connection must obtain non-empty certificate DER and compare it with the normalized stored identity before accepting any response bytes. Reused sockets and TLS session resumption must either retain a previously verified connection identity or be disabled. Add two sequential forced-close requests, a reused-connection case, empty-certificate failure, and wrong-pin failure.

### Medium: Android maps relay throttling and server errors to “server unreachable”

`apps/controller/android/android/app/src/main/java/com/whalemaid/controller/ProxyCore.kt:192-196` converts every non-200 status probe response, including 429, into a synthetic 502 `RELAY_UNREACHABLE`. The management status route repeats the mapping at lines 365-368. The status budget fix in `c7921f2` reduces one trigger, but actual relay throttling, authorization policy, and 5xx responses still lose their code and retry semantics.

Pass rule: transport exceptions map to unreachable; an HTTP response preserves recognized relay errors (`RATE_LIMITED`, lockout, unavailable) and status. The UI must distinguish “retry later” from “network unavailable”. Tests should assert 429 never becomes 502.

### Medium: DSH permission preset failure is invisible

`.dsh-source/packages/client/ui-conversation/src/client/skeleton/PermissionSelect.tsx:98-103` catches `/permission` failure as `false`, discards it, and only clears the busy state. A remote Android user sees the menu close and has no evidence that the requested preset did not apply. This is especially misleading around protected directories and remote approval policy.

Pass rule: preserve the command error in a visible alert tied to the permission control, retain the authoritative current preset, and provide retry. A rejected switch must not display the requested preset as current.

### Medium: Approval answer transport failure has no explanation

`.dsh-source/packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx:57-64` correctly re-arms Allow/Reject after `pending.answer()` rejects, but drops the reason. On an unstable remote link the user can press the same action repeatedly without knowing whether the request was rejected, expired, or the connection failed.

Pass rule: answer failure re-arms controls and displays the original safe error message; a resolved/expired approval removes the panel. Repeated clicks remain single-flight.

### Medium: Oversized Android request bodies become malformed downstream calls

`ProxyCore.kt:422-429` returns `null` both when there is no body and when `Content-Length` exceeds `MAX_BODY`. Callers then parse an empty JSON object or tunnel the request without a body, usually producing 400/502 unrelated to the actual limit. The unread body also remains on the local connection until NanoHTTPD closes it.

Pass rule: distinguish absent, valid, invalid length, and oversized body. Reject oversized requests locally with 413 before routing; reject truncated bodies with 400; never tunnel a declared non-empty body as empty.

### Low: Session archive failure remains console-only

`.dsh-source/packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx:932-939` leaves a rejected archive action only in `console.warn`. The row stays present, which is safe, but packaged clients expose no recovery explanation.

Pass rule: keep the row and display a retryable action error near the initiating menu or a shared browser error surface.

## Additional Observations

- Cleanup catches in native asset release and recording cancellation intentionally suppress best-effort disposal errors; they should remain telemetry-only unless resource leakage becomes persistent.
- Search fallback errors already have a visible degraded-state warning and are not silent.
- The DSH workspace selection patch on this assist branch closes the observed `workspace-attach-failed` swallow without changing Host filesystem policy.
- A real LAN address change showed that saved devices remain bound to their original relay address. Automatic migration is safe only when old and new pinned relay identities match; a different certificate must require explicit re-verification and must not receive saved passwords automatically. The primary session was already implementing this area when the assist worktree split.
