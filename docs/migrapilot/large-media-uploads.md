# Large media uploads — why 256 MB is the end of this road

## The current path, and what it is for

Chat attachments travel as an ordinary multipart POST:

    browser → pve 138.201.255.55:443 (DNAT, L4, no body limit)
            → nginx VM102  chat.migrateck.com   client_max_body_size 256M
            → consumer 10.10.0.13:3000  POST /api/files
            → storage MAX_FILE_BYTES (= MAX_UPLOAD_BYTES, 256 MB)
            → extractor MAX_EXTRACT_BYTES (25 MB)

One constant governs the whole transport: `MAX_UPLOAD_BYTES` in
`apps/migrapilot-consumer/src/features/attachments/capability.ts`. The picker,
the client pre-check, the API's advertised limits, and the storage validator all
derive from it, so no layer can advertise a ceiling the transport will not carry.
That was the original defect: the app promised 1024 MB while nginx cut every
request off at 32 MB, and the failure surfaced as "the upload could not reach the
server."

256 MB comfortably covers what Chat is for — documents, scans, decks, datasets,
photographs, recordings.

## Why this path must not be stretched to gigabytes

Raising `client_max_body_size` toward 1 GB+ would technically work and would be
the wrong answer, for four reasons that get worse with size:

1. **A buffered body occupies proxy disk.** With `proxy_request_buffering on`
   (the default) nginx writes the whole request to `/var/lib/nginx/body` before
   forwarding a byte. VM102 has ~9 GB free on `/`. Ten concurrent 1 GB uploads
   is not a capacity plan; it is an outage.
2. **There is no resume.** A single POST that dies at 94% starts again at zero.
   Over a home uplink a multi-gigabyte video will routinely not survive one
   attempt, and "try again" is not a feature.
3. **Progress cannot be trusted.** The browser reports bytes handed to the
   socket, not bytes durably stored. The longer the transfer, the wider the gap
   between the bar the user is watching and what actually landed.
4. **Every byte crosses hops that gain nothing from carrying it.** The proxy and
   the Next.js process are on the path purely as a conveyor. For large media
   they add latency, memory pressure, and failure modes without adding value.

## The shape large media should take instead

Direct, resumable upload to object storage, with the app on the control path and
off the data path:

1. The browser asks the app to start an upload, naming size and type.
2. The app authorizes it — checking quota, ownership and scope — and returns a
   short-lived credential for **one** object, scoped to the caller's own prefix.
   Ownership and tenancy are decided here, exactly as they are for `/api/files`
   today; the storage bucket never becomes a place where scope is optional.
3. The browser uploads **directly** to storage in parts, resuming after a drop
   instead of restarting. Neither nginx nor the consumer sees the bytes.
4. Storage notifies the app on completion; the app verifies size and checksum
   against what it authorized, then records the file.
5. Extraction/indexing happens asynchronously from object storage, which is where
   the extraction ceiling stops being a per-request memory problem.

`migra-storage-primary` (MinIO on cloud-core) already speaks the S3 multipart and
presigned-URL API this needs, so this is owned infrastructure rather than a new
paid dependency.

## What would have to be true before building it

- Upload sessions are authorized, quota-checked, and expire.
- A presigned credential grants exactly one object under the caller's own prefix,
  never a bucket, and never another tenant's path.
- Completion is verified by the app against the size and checksum it authorized —
  a client-reported success is a claim, not evidence.
- An abandoned multipart upload is reclaimed rather than billed forever.
- Extraction reads from object storage in a worker, not in the request path.

## The other ceiling, deliberately kept separate

`MAX_EXTRACT_BYTES` (25 MB) is **not** a transport limit and does not track
`MAX_UPLOAD_BYTES`. Extraction is synchronous and in-memory inside the Brain, so
one enormous document could exhaust the process and end chat for every user.
Above that ceiling a file is stored and honestly reported as unreadable —
`tooLargeToProcess` travels from the index route to the chip so the user is told
the file is too large to read, not that it contained nothing readable.

That gap is currently 25 MB → 256 MB, which is wide. Closing it is a separate
slice: streaming or chunked parsing, or extraction in an isolated worker. Until
then the state is truthful rather than hidden, which is the requirement — but it
is a known limit, not a finished capability.
