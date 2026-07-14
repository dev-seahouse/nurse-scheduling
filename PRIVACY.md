# Privacy and Data Handling

This document describes the Nurse Scheduling System's current data-handling behavior. Do not enter confidential, regulated, or personally identifiable information unless you understand and accept how it may be processed.

## Project Status and Privacy Limitations

This project is in early development. Its basic privacy protections primarily anonymize individual people IDs and remove descriptions where possible. Other information, including people-group IDs, dates, shift types, histories, preferences, and export configuration, may remain identifiable or sensitive. Anonymization may fail for malformed or unsupported data. We plan to improve these protections as the project matures.

## Browser Storage

Scheduling data and up to 50 undo-history entries are stored in browser `localStorage` until cleared or replaced.

## Analytics

The hosted frontend uses Google Analytics. Depending on the event, it may receive IP addresses, request headers, and interaction metadata.

Data received by Google Analytics is subject to its policies and retention settings.

## Optimization Backend

Clicking **Optimize** sends the current scheduling YAML to the backend shown in the API Endpoint field, which may be the hosted server at `https://api.nursescheduling.org` or a user-selected server.

- **Anonymize schedule data** is enabled by default but may be disabled. It replaces individual people IDs and removes descriptions, not all potentially sensitive scheduling information.
- Submitted YAML is processed in memory. Results and job metadata become eligible for automatic removal 30 minutes after completion, but may remain longer until a later job operation triggers cleanup. The hosted frontend attempts deletion after a successful download.
- Operational logs may include job IDs, pseudonymous client IDs, filenames, statuses, timing, and errors.
- The backend sets a pseudonymous client UUID cookie for up to 30 days.

## Opting Out While Using Hosted Services

Ad blockers and privacy-focused browser extensions may block Google Analytics, depending on their configuration. They do not prevent scheduling data from being sent to the configured backend when you click **Optimize**.

## Self-Hosting

For stronger control, run the frontend and backend locally or on infrastructure you control:

- Disable the hosted optimization API with `NEXT_PUBLIC_DISABLE_HOSTED_OPTIMIZE_API=1`.
- Remove or disable Google Analytics before deploying a private frontend.

Self-hosters are responsible for securing their infrastructure and establishing appropriate logging and retention policies.
