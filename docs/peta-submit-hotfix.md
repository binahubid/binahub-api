# PETA empty-body submit regression

30 October 2026 — API0.46.1. No SQL, environment, source, scoring or answer
migration is required. Existing app0.49.0 is compatible with this API hotfix.

## Cause and observed boundary

The app calls `petaRequest('submit','POST',undefined,headers)`: answers have already
been saved separately, so the finalization request intentionally has no payload.
It carries CSRF, revision and idempotency headers, but no JSON Content-Type.

The old handler used `if(req.body)` to decide whether JSON validation was needed.
That tests the existence of a stream, not whether it contains any bytes. The
installed Next Node adapter wraps a POST's IncomingMessage as a body stream even
when the actual HTTP request contains zero bytes. Reverse proxies can preserve
that representation. The JSON parser then rejected the absent Content-Type, or
attempted to parse an empty string if JSON Content-Type was present. Both became
PETA_INVALID_REQUEST / HTTP400 / “Periksa kembali isian Anda.” before peta_submit.
The same conditional existed in program/resume.

The earlier unit helper created NextRequest directly with no body, producing
body=null and skipping this condition. It did not exercise the Node adapter,
which is why the successful earlier test did not cover the deployed boundary.

## Concrete correction

- Only submit and program/resume opt into `body(req,{allowEmpty:true})`.
- Read the bounded stream and accept an actual zero-byte payload as `{}`.
  Null-body requests and explicit JSON `{}` remain supported.
- Non-empty requests still require JSON, a strict empty object and the16KB limit.
  Content-Length is not used as proof that a body is empty.
- Authentication, program binding, CSRF, numeric revision, idempotency, immutable
  source validation,24-pair completeness and deterministic scoring remain intact.
  Validate revision before decrypting source, avoiding unnecessary source work
  for invalid requests. No participant records are rewritten or cleared.

## Verification and limits

Before the fix, three new regressions failed with400: zero-byte submit streams
with/without JSON Content-Type and zero-byte program resume. After the fix these
pass. Coverage also sends a real HTTP POST on127.0.0.1 through the installed
NodeNextRequest/NextRequestAdapter into the handler, confirming its body stream
exists even with zero bytes. Database/auth/source dependencies in that HTTP test
are synthetic mocks, not production participant sessions.

Further tests retain malformed/unexpected-body rejection, size/Content-Type
limits, CSRF/revision/idempotency checks, SQL completeness and idempotent scoring.
The screenshot's font-CSP and extension warnings are separate from this reproduced
request-parser failure; this patch does not loosen CSP or alter installed extensions.

No live participant response, secret, full production request or hosting log was
read or replayed. After API deployment succeeds, retry from the saved PETA session;
do not create a replacement session or erase answers as a workaround. Successful
Git push/build is not proof that deployment has completed or the live retry passed.
