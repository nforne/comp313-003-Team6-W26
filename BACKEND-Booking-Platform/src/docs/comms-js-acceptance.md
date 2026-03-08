# comms-js-acceptance.md

## Overview
Acceptance criteria and test plan for **comms-js** delivery engine, providers, workers, and client integration. Covers functional behavior, persistence guarantees, error handling, observability, and performance targets required for release.

---

## Scope
- **Components tested**: engine, batch.worker, providers (email, notification), utils (backoff, recipients), WS client.
- **Channels**: in‑app/websocket, email.
- **Flows**: single recipient realtime, small-list sequential, batched limited lists, broadcast (async enqueue and synchronous), offline fallback persistence, retries and backoff, per‑recipient delivery metadata persistence.
- **Environments**: unit tests (jest), staging integration with mocked external providers, end‑to‑end acceptance in staging with real SMTP and a test WS publisher.

---

## Acceptance Criteria
1. **Message orchestration**
   - **Engine** accepts a valid message document and routes to correct flow: realtime for small lists, batched for larger lists, async enqueue for broadcast when `asyncBroadcast=true`.
   - **Return values**: synchronous flows return `deliveryInfo` with per‑recipient results and summary; async broadcast returns `{ ok: true, asyncEnqueued: true }`.

2. **Per‑recipient persistence**
   - For every attempted channel, **`message.metadata.deliveryInfo.<userId>.<channel>`** is written with `{ ok, attempts, providerId?, error?, lastAttemptAt }`.
   - For offline in‑app fallback, **`message.metadata.deliveryInfo.<userId>.in_app`** is persisted so `listForUser` surfaces the message.

3. **Providers and retries**
   - **Email provider** uses SES when configured and falls back to nodemailer; returns `{ ok, providerId }` or `{ ok: false, error }`.
   - **Notification provider** attempts WS publish; on failure persists in‑app marker.
   - **Retry/backoff**: transient failures are retried up to configured `maxRetries` with exponential backoff; final failure is recorded.

4. **WS client behavior**
   - Client auto‑connects when token provided, auto‑reconnects with exponential backoff, supports subscribe/unsubscribe, heartbeat ping/pong, and emits `message` events for server notifications.

5. **Idempotency and duplicate avoidance**
   - Reprocessing the same batch or re‑publishing a message does not create duplicate inbox entries for the same `messageId` and `userId` when delivery markers exist.

6. **Observability**
   - Key events are logged: `engine.process.start`, `engine.enqueue.broadcast_batches_done`, `batch.process.start`, `batch.process.completed`, provider errors, and audit events are emitted (best‑effort).
   - Metrics available: per‑template send rate, batch success/failure counts, retry counts, average latency.

7. **Performance**
   - **Limited list**: sequential realtime path latency per recipient < 500ms under test conditions.
   - **Batch worker**: processes batches of size `broadcastBatchSize` with configured concurrency without unbounded memory growth.
   - **Broadcast enqueue**: enqueuing broadcast batches is non‑blocking and returns quickly when `asyncBroadcast=true`.

8. **Security and safety**
   - Template rendering sanitizes variables to prevent injection.
   - Email attachments respect `maxAttachmentSizeBytes`.
   - Sensitive fields are not logged.

---

## Test Scenarios
| ID | Scenario | Steps | Expected result |
|---:|---|---|---|
| A1 | Single recipient realtime | Create message with one recipient; call `engine.processMessage` | `batchWorker.processBatch` called once; `deliveryInfo.perRecipient` shows success |
| A2 | Small list sequential | Message with 1 < N < `limitedBatchSize` recipients | Each recipient processed sequentially; aggregated summary returned |
| A3 | Limited list batching | Message with recipients >= `limitedBatchSize` | Engine paginates; `processBatch` called per batch; summary accurate |
| A4 | Broadcast async enqueue | Message `recipientsAll=true`, `asyncBroadcast=true` | `enqueueBroadcastBatches` returns immediately with `asyncEnqueued: true`; batches dispatched async |
| A5 | Broadcast synchronous | Message `recipientsAll=true`, `asyncBroadcast=false` | Engine streams user ids, processes batches synchronously, returns summary |
| A6 | Online + offline mix | Two recipients: one with WS connected, one offline | Online user receives WS publish and `metadata.deliveryInfo.<user>.in_app.ok=true`; offline user has persisted in_app marker |
| A7 | Email success | Email channel with valid user email and SES/nodemailer configured | `emailProvider.sendEmail` returns ok; `metadata.deliveryInfo.<user>.email.ok=true` |
| A8 | Email transient failure and retry | Email provider throws transient errors then succeeds or exhausts retries | Retries occur; on success providerId recorded; on final failure error recorded |
| A9 | WS publish failure fallback | WS publish throws or returns ok:false | Worker persists in_app marker and returns channel result reflecting fallback |
| A10 | Missing message | Call deliver with non‑existent messageId | 404 thrown and audit event logged |
| A11 | No recipients | Message with empty recipients array | Engine returns `{ ok: true, deliveryInfo: { note: 'no_recipients' } }` |
| A12 | Idempotency | Re-run batch for same messageId/userId | No duplicate inbox entries; deliveryInfo remains consistent |

---

## Test Data and Setup
- **Test users**: create users with `userId` and fields: `emails`, `wsChannelId`, `connections`.
- **Message fixtures**: minimal message documents with `_id`, `type`, `subject`, `details`, `attachments`, `metadata`.
- **Provider stubs**: controllable mocks for SES/nodemailer and WS publisher to simulate success, transient errors, and permanent failures.
- **DB**: staging message collection with ability to inspect `metadata.deliveryInfo` and `metadata.batchHistory`.
- **WS test harness**: a test WS server that accepts connections, records subscriptions, and returns providerIds.

---

## Test Execution Steps
1. **Unit tests**: run `npm test` (jest) to validate module behavior and mocks.
2. **Integration tests**: run staged flows with mocked providers to validate persistence and audit calls.
3. **End‑to‑end**: deploy to staging with real SMTP and test WS publisher; execute scenarios A1–A12.
4. **Load test**: simulate broadcast enqueue with realistic user count to validate memory and enqueue latency.
5. **Security checks**: run template rendering fuzz tests to ensure sanitization.

---

## Pass/Fail Criteria
- **Pass**: all acceptance criteria met and all test scenarios A1–A12 pass in staging. No data loss observed. Observability metrics present and within thresholds.
- **Fail**: any critical criteria not met: missing persistence for offline users, duplicate inbox entries, unbounded memory growth during broadcast, or provider retry logic not functioning.

---

## Monitoring and Rollback
- **Monitor**: batch failure rate, retry counts, enqueue latency, message processing throughput, and `metadata.deliveryInfo` write errors.
- **Alert thresholds**: batch failure rate > 5% over 5 minutes; enqueue latency > 5s for broadcast; retry exhaustion rate > 1% for transactional messages.
- **Rollback plan**: disable async broadcast enqueue, revert to synchronous processing, or pause message processing queue until root cause fixed.

---