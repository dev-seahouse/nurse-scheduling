# Privacy and Data Handling

This document describes the Nurse Scheduling System's data-handling behavior. Use nicknames or other non-identifying people IDs if a schedule may be sensitive. Self-host when your organization requires full control over processing, logging, and retention.

## Anonymization and Its Limits

The hosted optimization workflow anonymizes individual people IDs and removes descriptions by default. This means names used as people IDs are normally replaced before the schedule reaches the optimization server. A schedule without direct identifiers may not identify anyone by itself, but people-group IDs, dates, shift types, histories, preferences, and export configuration can still reveal information in context. Anonymization is not a guarantee, especially for malformed or unsupported data.

## Browser Storage

Scheduling data and up to 50 undo-history entries are stored in browser `localStorage` until cleared or replaced.

## Analytics

The hosted frontend uses Google Analytics. Depending on the event, it may receive IP addresses, request headers, and interaction metadata.

Data received by Google Analytics is subject to its policies and retention settings.

## Optimization Backend

Clicking **Optimize** sends the current scheduling YAML to the backend shown in the API Endpoint field, which may be the hosted server at `https://api.nursescheduling.org` or a user-selected server.

- **Anonymize schedule data** is enabled by default but may be disabled. It replaces individual people IDs and removes descriptions, not all potentially sensitive scheduling information.
- Submitted YAML, XLSX results, and operational job metadata are retained in the hosted backend's Redis job store for up to 24 hours after completion unless capacity cleanup or an explicit deletion removes them earlier. The hosted frontend attempts deletion after a successful download. Minimal reporting telemetry is stored separately as described below.
- Operational logs may include job IDs, pseudonymous client IDs, filenames, statuses, timing, and errors.
- The backend sets a pseudonymous client UUID cookie for up to 7 days.
- Docker Redis deployments retain minimal per-job telemetry for weekly reports, including job and pseudonymous client IDs, solver, lifecycle timestamps and state, queue and runtime durations, outcome, failure code, solver status, termination reason, configured timeout, download count, people and shift type counts, and the schedule date range. Telemetry excludes the uploaded YAML, people and shift type identifiers, descriptions, filenames, IP addresses, and email addresses. Reporting does not remove telemetry. Rows expire 30 days after the end of their event week by default. Operators may send this telemetry through a configured reporting provider such as Mailgun.

## Experimental AI

The hosted beta AI service is separate from the main optimization backend and requires beta API-key access. Ordinary optimization never uses this route, so users outside the beta will not trigger its data handling.

Assume all AI chats, schedules, attachments, responses, and request metadata are logged and not anonymized. This data may be used to improve our product and the AI provider's product. Do not submit personal, confidential, regulated, or otherwise sensitive information.

Deployments configured with AI chat history additionally store each turn's user and assistant text, model, timestamps, attachment counts, token usage, and status in PostgreSQL, keyed by a chat session and the administrative credential ID when authentication is enabled. Raw attachments, extracted document text, schedule snapshots, tool arguments and results, and reasoning are excluded. Stored turns are deleted after the operator's configured retention window, 30 days by default. Operators configure their own backups and backup retention separately.

## Opting Out While Using Hosted Services

Ad blockers and privacy-focused browser extensions may block Google Analytics, depending on their configuration. They do not prevent scheduling data from being sent to the configured backend when you click **Optimize**.

## Self-Hosting

The project is open source so organizations can inspect its data handling and run the frontend and backend locally or on infrastructure they control:

- Disable the hosted optimization API with `NEXT_PUBLIC_DISABLE_HOSTED_OPTIMIZE_API=1`.
- Remove or disable Google Analytics before deploying a private frontend.

Self-hosters are responsible for securing their infrastructure and establishing appropriate logging and retention policies.
