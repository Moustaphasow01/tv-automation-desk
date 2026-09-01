# Live Focus SSE certification

## Contract

- first connection without cursor: current `front_snapshot_checkpoint`, then future durable events;
- valid cursor: resume strictly after cursor;
- unknown or too-old cursor: `desk.resync_required`, canonical projection refetch, new checkpoint;
- duplicate event IDs: ignored by the frontend envelope registry;
- context/brief publication and invalidation: invalidate `live-focus` query data;
- heartbeat: SSE comment only.

## Automated proof

- `domain_event_outbox_realtime.test.js`: fresh browser checkpoint, first event after empty checkpoint, unknown cursor resync;
- `front_control_plane_api.test.js`: durable order and cursor recovery;
- `realtimeRuntime.test.ts`: context/brief event invalidation registry.

Runtime VPS proof is appended to the final certification after deployment.
