/*
 * This file is part of Nurse Scheduling Project, see <https://github.com/j3soon/nurse-scheduling>.
 *
 * Copyright (C) 2023-2026 Johnson Sun
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const MINUTES_PER_DAY = 24 * 60;

// Human-readable duration, e.g. 510 → "8h 30m", 480 → "8h", 30 → "30m".
export function formatWorkingMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${mins}m`;
}

// ---------------------------------------------------------------------------
// Whole-Shift-Type working-time codec (WT3, DL09 D7 / C1 CON-YAML-26).
//
// One shared owner for interpreting, converting, and serializing a Shift Type's
// four working-time fields as a single whole shape. YAML import and the WT4
// editor form both call this so their accepted shapes and canonicalization can
// never drift apart, and it mirrors the backend `ShiftType._validate_working_time`
// (models.py). The 30-minute grid is an input invariant: exactly two shapes are
// valid — bare positive grid `durationMinutes`, or paired `HH:00`/`HH:30`
// start/end with optional positive grid rest and a matching derived duration.
// `restMinutes: 0` is accepted at the input boundary but canonicalized to
// omission; absence is the only persisted zero-rest form.
// ---------------------------------------------------------------------------

// The raw, persisted working-time fields of a Shift Type.
export interface WorkingTimeFields {
  durationMinutes?: number;
  startTime?: string;
  endTime?: string;
  restMinutes?: number;
}

// Structured reasons a shape is rejected; `path` is the offending field.
export type WorkingTimeErrorCode =
  | 'start_end_paired'    // exactly one of startTime/endTime supplied
  | 'clock_format'        // startTime/endTime not an HH:00 / HH:30 grid time
  | 'equal_times'         // startTime === endTime
  | 'rest_grid'           // restMinutes not a non-negative multiple of 30
  | 'rest_too_large'      // restMinutes >= clock span
  | 'rest_without_clock'  // restMinutes present without clock times
  | 'duration_required'   // clock shape missing durationMinutes
  | 'duration_mismatch'   // durationMinutes !== derived paid minutes
  | 'duration_integer'    // durationMinutes not an integer
  | 'duration_positive'   // bare durationMinutes <= 0
  | 'duration_grid'       // bare durationMinutes not a multiple of 30
  | 'rest_integer';       // restMinutes not an integer

export type WorkingTimeShape =
  | { kind: 'cleared' }
  | { kind: 'bare'; durationMinutes: number }
  | { kind: 'clock'; startTime: string; endTime: string; durationMinutes: number; restMinutes?: number }
  | { kind: 'invalid'; path: string; code: WorkingTimeErrorCode };

// A valid (serializable) shape — everything except `invalid`.
export type ValidWorkingTimeShape = Exclude<WorkingTimeShape, { kind: 'invalid' }>;

// 30-minute-grid clock: "HH:00" or "HH:30", 24-hour. Matches the backend
// regex `^([01]\d|2[0-3]):(00|30)$`. No trimming — a value
// the backend would reject must not be silently accepted here.
const GRID_CLOCK_PATTERN = /^([01]\d|2[0-3]):(00|30)$/;

function parseGridClockMinutes(value: string): number | null {
  const match = GRID_CLOCK_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

function invalid(path: string, code: WorkingTimeErrorCode): WorkingTimeShape & { kind: 'invalid' } {
  return { kind: 'invalid', path, code };
}

// `restMinutes: 0` is accepted but canonicalized to omission (absence is the
// only persisted zero-rest form). Non-zero rest is validated by the caller.
function canonicalRest(restMinutes: number | undefined): number | undefined {
  return restMinutes === 0 ? undefined : restMinutes;
}

// Derive the paid minutes of a clock shape (overnight when end <= start). Rest
// is optional; explicit zero is treated as absent. Returns the paid duration or
// a structured invalid shape.
function deriveClockPaid(
  startTime: string,
  endTime: string,
  restMinutes: number | undefined
): { paid: number; rest: number | undefined } | (WorkingTimeShape & { kind: 'invalid' }) {
  const start = parseGridClockMinutes(startTime);
  if (start === null) {
    return invalid('startTime', 'clock_format');
  }
  const end = parseGridClockMinutes(endTime);
  if (end === null) {
    return invalid('endTime', 'clock_format');
  }
  if (end === start) {
    return invalid('endTime', 'equal_times');
  }
  const span = end < start ? end - start + MINUTES_PER_DAY : end - start;

  const rest = canonicalRest(restMinutes);
  if (rest !== undefined) {
    if (!Number.isInteger(rest)) {
      return invalid('restMinutes', 'rest_integer');
    }
    if (rest < 0 || rest % 30 !== 0) {
      return invalid('restMinutes', 'rest_grid');
    }
    if (rest >= span) {
      return invalid('restMinutes', 'rest_too_large');
    }
  }
  return { paid: span - (rest ?? 0), rest };
}

// Interpret a whole Shift Type's four working-time fields as one shape. Mirrors
// the backend validator exactly, canonicalizing zero rest to omission. Only
// `null`/`undefined` mean absent (like the backend's Optional fields); a present
// empty clock string is NOT absence — it is an invalid clock value, matching the
// backend regex which rejects `""`.
export function parseWorkingTime(fields: WorkingTimeFields): WorkingTimeShape {
  const durationMinutes = fields.durationMinutes ?? undefined;
  const startTime = fields.startTime ?? undefined;
  const endTime = fields.endTime ?? undefined;
  const rest = canonicalRest(fields.restMinutes ?? undefined);
  const hasStart = startTime !== undefined;
  const hasEnd = endTime !== undefined;
  const hasRest = rest !== undefined;
  const hasDuration = durationMinutes !== undefined;

  if (hasStart !== hasEnd) {
    return invalid(hasStart ? 'endTime' : 'startTime', 'start_end_paired');
  }

  if (hasStart && hasEnd) {
    const derived = deriveClockPaid(startTime as string, endTime as string, rest);
    if ('kind' in derived) {
      return derived;
    }
    if (!hasDuration) {
      return invalid('durationMinutes', 'duration_required');
    }
    if (!Number.isInteger(durationMinutes)) {
      return invalid('durationMinutes', 'duration_integer');
    }
    if (durationMinutes !== derived.paid) {
      return invalid('durationMinutes', 'duration_mismatch');
    }
    return {
      kind: 'clock',
      startTime: startTime as string,
      endTime: endTime as string,
      durationMinutes: derived.paid,
      ...(derived.rest !== undefined ? { restMinutes: derived.rest } : {}),
    };
  }

  // No clock times.
  if (hasRest) {
    return invalid('restMinutes', 'rest_without_clock');
  }
  if (hasDuration) {
    if (!Number.isInteger(durationMinutes)) {
      return invalid('durationMinutes', 'duration_integer');
    }
    if ((durationMinutes as number) <= 0) {
      return invalid('durationMinutes', 'duration_positive');
    }
    if ((durationMinutes as number) % 30 !== 0) {
      return invalid('durationMinutes', 'duration_grid');
    }
    return { kind: 'bare', durationMinutes: durationMinutes as number };
  }
  return { kind: 'cleared' };
}

// Serialize a valid shape to its canonical persisted fields. Zero/absent rest is
// omitted; only defined fields appear so the emitter never writes null keys.
export function serializeWorkingTime(shape: ValidWorkingTimeShape): WorkingTimeFields {
  switch (shape.kind) {
    case 'cleared':
      return {};
    case 'bare':
      return { durationMinutes: shape.durationMinutes };
    case 'clock':
      return {
        startTime: shape.startTime,
        endTime: shape.endTime,
        durationMinutes: shape.durationMinutes,
        ...(shape.restMinutes !== undefined && shape.restMinutes !== 0
          ? { restMinutes: shape.restMinutes }
          : {}),
      };
  }
}

// bare → clock: propose a clock shape from user-authored start/end plus optional
// positive rest, deriving the paid duration. The caller keeps the persisted bare
// bytes untouched until this validates and the author confirms (DL09 D7).
export function proposeBareToClock(
  startTime: string,
  endTime: string,
  restMinutes?: number
): WorkingTimeShape {
  const derived = deriveClockPaid(startTime, endTime, restMinutes);
  if ('kind' in derived) {
    return derived;
  }
  return {
    kind: 'clock',
    startTime,
    endTime,
    durationMinutes: derived.paid,
    ...(derived.rest !== undefined ? { restMinutes: derived.rest } : {}),
  };
}

// clock → bare: retain the paid duration and drop the clock/rest fields. Only a
// valid clock shape can convert; anything else stays as-is (returned unchanged).
export function proposeClockToBare(shape: WorkingTimeShape): WorkingTimeShape {
  if (shape.kind !== 'clock') {
    return shape;
  }
  return { kind: 'bare', durationMinutes: shape.durationMinutes };
}

// Clear removes all four working-time fields from either shape.
export function clearWorkingTime(): WorkingTimeShape {
  return { kind: 'cleared' };
}
