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

// Pure, UI-free detection core for the uncredited-leave guard (guard-tech-plan
// "New module", "Deterministic trigger", "Typed selector resolvers"; decision
// log D2/D7). It flags a shift count explicitly marked as an hours contract that
// omits LEAVE while a nurse it covers is pinned on paid leave. No React, no state
// wiring, no fix action here.

import {
  DateRange,
  Group,
  Preference,
  ShiftCountPreference,
  ShiftRequestPreference,
  SHIFT_COUNT,
  SHIFT_REQUEST,
} from '@/types/scheduling';
import {
  ALL,
  FRIDAY,
  LEAVE,
  MONDAY,
  OFF,
  SATURDAY,
  SUNDAY,
  THURSDAY,
  TUESDAY,
  WEDNESDAY,
  WEEKDAY,
  WEEKEND,
} from '@/utils/keywords';

// Tri-state resolution: a concrete set of ids, or `"unknown"` when any member is
// an unsupported shape, an unknown id, or a forward-ref/cycle. An `"unknown"` on
// either side of an intersection SUPPRESSES the warning — the guard never
// manufactures a false positive from an unresolved selector (guard-tech-plan
// "Typed selector resolvers"; critique S2-H2).
export type SelectorResolution = { known: Set<string> } | 'unknown';

export interface LeaveWarningInput {
  preferences: Preference[];
  // Item universes are REQUIRED so `ALL` can expand. The backend defines `ALL`
  // as the full person index universe and the full custom worked-shift universe
  // (scheduler.py:85-108); groups alone cannot expand `ALL`, and ungrouped items
  // would be lost (critique S2-B2).
  allPersonIds: string[];
  allWorkedShiftTypeIds: string[]; // custom shift types only; excludes OFF/LEAVE
  peopleGroups: Group[];
  dateGroups: Group[];
  shiftTypeGroups: Group[];
  dateRange: DateRange; // for weekday/ALL/range date expansion
}

export interface LeaveCreditWarning {
  // Position within the shift-count preference sublist (not the full preference
  // array), so a caller iterating shift counts can line warnings up by index.
  shiftCountListIndex: number;
  affectedPeople: string[];
}

// The date keywords the resolver supports, mirroring the backend canonical set
// (constants.MAP_DATE_KEYWORD_TO_FILTER + MAP_WEEKDAY_TO_STR). Weekday membership
// uses getUTCDay to match the existing frontend generators in keywords.ts.
const WEEKDAY_TO_UTC_DAY = new Map<string, number>([
  [SUNDAY, 0],
  [MONDAY, 1],
  [TUESDAY, 2],
  [WEDNESDAY, 3],
  [THURSDAY, 4],
  [FRIDAY, 5],
  [SATURDAY, 6],
]);

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const MM_DD = /^(\d{2})-(\d{2})$/;
const DD = /^\d{1,2}$/;

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

// Maps one of the frontend's scope-dependent concrete date ids to a canonical
// YYYY-MM-DD string, mirroring `_generateDateItems` / backend `_parse_single_date`:
// `DD` is valid only within a single month, `MM-DD` only within a single year,
// and `YYYY-MM-DD` is always valid. Returns undefined for any other shape (so the
// caller falls through to group lookup / "unknown"), keeping the tri-state contract.
function parseScopeDate(token: string, dateRange: DateRange): string | undefined {
  if (YYYY_MM_DD.test(token)) {
    return token;
  }
  const { startDate, endDate } = dateRange;
  if (!startDate || !endDate) {
    return undefined;
  }
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const sameMonth = sameYear && startDate.getUTCMonth() === endDate.getUTCMonth();
  const year = pad(startDate.getUTCFullYear(), 4);

  const monthDay = MM_DD.exec(token);
  if (sameYear && monthDay) {
    return `${year}-${monthDay[1]}-${monthDay[2]}`;
  }
  if (sameMonth && DD.test(token)) {
    return `${year}-${pad(startDate.getUTCMonth() + 1, 2)}-${pad(Number(token), 2)}`;
  }
  return undefined;
}

// A literal resolver returns the concrete ids a token expands to, `"unknown"`
// when the token is a recognized-but-unresolvable shape, or `"not-literal"` when
// the token is not a literal at all (so the engine should try it as a group).
type LiteralResult = Set<string> | 'unknown' | 'not-literal';

function toToken(raw: unknown): string {
  // Group members are typed string[], but imported YAML can leave numbers or
  // Date objects in place. Normalize a Date to YYYY-MM-DD; anything else via
  // String(), which lands on a non-canonical form and resolves to "unknown".
  if (raw instanceof Date) {
    return raw.toISOString().slice(0, 10);
  }
  return String(raw);
}

// Shared group-DAG traversal for people and shift types (and reused structurally
// by resolveDates). Accepts only canonical frontend DAGs: a group member that is
// itself a group must be defined EARLIER in the array. A forward reference or
// cycle yields `"unknown"` — the resolver does not replicate the backend's
// ordered sequential construction, so it can never expand a reference the backend
// would reject (guard-tech-plan "Group recursion policy").
function resolveSelector(
  ids: string[],
  groups: Group[],
  resolveLiteral: (token: string) => LiteralResult
): SelectorResolution {
  const groupIndexById = new Map<string, number>();
  groups.forEach((group, index) => {
    if (!groupIndexById.has(group.id)) {
      groupIndexById.set(group.id, index);
    }
  });

  const memo = new Map<number, SelectorResolution>();

  const expandGroup = (groupIndex: number): SelectorResolution => {
    const cached = memo.get(groupIndex);
    if (cached) {
      return cached;
    }
    const accumulated = new Set<string>();
    for (const rawMember of groups[groupIndex].members) {
      const member = toToken(rawMember);
      const literal = resolveLiteral(member);
      if (literal === 'unknown') {
        memo.set(groupIndex, 'unknown');
        return 'unknown';
      }
      if (literal !== 'not-literal') {
        literal.forEach(id => accumulated.add(id));
        continue;
      }
      const memberIndex = groupIndexById.get(member);
      // Unknown id, forward reference, or self/cycle (index not strictly earlier).
      if (memberIndex === undefined || memberIndex >= groupIndex) {
        memo.set(groupIndex, 'unknown');
        return 'unknown';
      }
      const sub = expandGroup(memberIndex);
      if (sub === 'unknown') {
        memo.set(groupIndex, 'unknown');
        return 'unknown';
      }
      sub.known.forEach(id => accumulated.add(id));
    }
    const resolved: SelectorResolution = { known: accumulated };
    memo.set(groupIndex, resolved);
    return resolved;
  };

  const accumulated = new Set<string>();
  for (const rawId of ids) {
    const id = toToken(rawId);
    const literal = resolveLiteral(id);
    if (literal === 'unknown') {
      return 'unknown';
    }
    if (literal !== 'not-literal') {
      literal.forEach(item => accumulated.add(item));
      continue;
    }
    // A top-level selector may reference any group regardless of array order —
    // only a group's own members are constrained to earlier definitions.
    const groupIndex = groupIndexById.get(id);
    if (groupIndex === undefined) {
      return 'unknown';
    }
    const sub = expandGroup(groupIndex);
    if (sub === 'unknown') {
      return 'unknown';
    }
    sub.known.forEach(item => accumulated.add(item));
  }
  return { known: accumulated };
}

export function resolvePeople(
  ids: string[],
  allPersonIds: string[],
  peopleGroups: Group[]
): SelectorResolution {
  const personIdSet = new Set(allPersonIds);
  return resolveSelector(ids, peopleGroups, (token): LiteralResult => {
    if (token === ALL) {
      return new Set(allPersonIds);
    }
    if (personIdSet.has(token)) {
      return new Set([token]);
    }
    return 'not-literal';
  });
}

// Resolves shift-type selectors and, via the known set, reports LEAVE presence:
// callers check `known.has(LEAVE)`. `ALL` expands to the worked-only universe
// (scheduler.py:91 — ALL excludes OFF/LEAVE), so a count scoped to `ALL` omits
// LEAVE. OFF/LEAVE resolve to themselves; a custom group whose members include
// LEAVE surfaces LEAVE in the known set (backend parse_sids).
export function resolveShiftTypes(
  ids: string[],
  allWorkedShiftTypeIds: string[],
  shiftTypeGroups: Group[]
): SelectorResolution {
  const workedIdSet = new Set(allWorkedShiftTypeIds);
  return resolveSelector(ids, shiftTypeGroups, (token): LiteralResult => {
    if (token === ALL) {
      return new Set(allWorkedShiftTypeIds); // worked-only; omits OFF/LEAVE
    }
    if (token === OFF || token === LEAVE) {
      return new Set([token]);
    }
    if (workedIdSet.has(token)) {
      return new Set([token]);
    }
    return 'not-literal';
  });
}

function buildDateUniverse(
  dateRange: DateRange
): { all: string[]; byWeekday: Map<number, string[]> } | undefined {
  const { startDate, endDate } = dateRange;
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return undefined;
  }
  const all: string[] = [];
  const byWeekday = new Map<number, string[]>();
  const cursor = new Date(startDate.getTime());
  while (cursor.getTime() <= endDate.getTime()) {
    const dateStr = cursor.toISOString().slice(0, 10);
    all.push(dateStr);
    const day = cursor.getUTCDay();
    (byWeekday.get(day) ?? byWeekday.set(day, []).get(day)!).push(dateStr);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { all, byWeekday };
}

function expandDateRangeLiteral(start: string, end: string): Set<string> {
  const result = new Set<string>();
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor.getTime() <= last.getTime()) {
    result.add(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

// Supports the backend canonical set (utils.parse_dates + the ALL/weekday
// keywords): concrete dates in the frontend's scope-dependent form (DD in a
// single-month range, MM-DD in a single-year range, YYYY-MM-DD otherwise — see
// parseScopeDate / _generateDateItems), date groups, ALL, WEEKDAY, WEEKEND,
// MONDAY–SUNDAY, and start~end ranges over those same date forms. Any other shape
// resolves to `"unknown"` so the pairing is suppressed rather than turned into a
// false positive.
export function resolveDates(
  ids: string[],
  dateGroups: Group[],
  dateRange: DateRange
): SelectorResolution {
  const universe = buildDateUniverse(dateRange);
  return resolveSelector(ids, dateGroups, (token): LiteralResult => {
    if (token === ALL) {
      return universe ? new Set(universe.all) : 'unknown';
    }
    const weekdayIndex = WEEKDAY_TO_UTC_DAY.get(token);
    if (weekdayIndex !== undefined) {
      return universe ? new Set(universe.byWeekday.get(weekdayIndex) ?? []) : 'unknown';
    }
    if (token === WEEKDAY) {
      return universe
        ? new Set([1, 2, 3, 4, 5].flatMap(day => universe.byWeekday.get(day) ?? []))
        : 'unknown';
    }
    if (token === WEEKEND) {
      return universe
        ? new Set([0, 6].flatMap(day => universe.byWeekday.get(day) ?? []))
        : 'unknown';
    }
    const tildeIndex = token.indexOf('~');
    if (tildeIndex !== -1) {
      // start~end range whose endpoints use the scope-dependent forms.
      const start = parseScopeDate(token.slice(0, tildeIndex), dateRange);
      const end = parseScopeDate(token.slice(tildeIndex + 1), dateRange);
      return start && end ? expandDateRangeLiteral(start, end) : 'unknown';
    }
    const concrete = parseScopeDate(token, dateRange);
    if (concrete) {
      return new Set([concrete]);
    }
    return 'not-literal';
  });
}

function isNonEmptyIntersection(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) {
      return true;
    }
  }
  return false;
}

function intersect(a: Set<string>, b: Set<string>): string[] {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const result: string[] = [];
  for (const value of small) {
    if (large.has(value)) {
      result.push(value);
    }
  }
  return result;
}

// Detects hours-contract shift counts that omit LEAVE while covering a
// leave-pinned nurse. Per shift-count `sc` (guard-tech-plan "Deterministic
// trigger"):
//   1. `sc.hoursContract` present (the explicit signal).
//   2. Expanded `countShiftTypes` omits LEAVE (ALL ⇒ worked-only ⇒ omits; a group
//      containing LEAVE ⇒ present ⇒ no warning). Unresolved ⇒ suppress.
//   3. `sc.person` ∩ people pinned by a LEAVE request is non-empty. A LEAVE
//      request is any shift request whose `shiftType` resolves — through
//      resolveShiftTypes — to a set containing LEAVE (a group containing LEAVE
//      pins leave too). Unresolved on either side ⇒ suppress that pairing.
//   4. `sc.countDates` overlaps the request's dates. Unresolved ⇒ suppress.
export function findUncreditedLeaveWarnings(input: LeaveWarningInput): LeaveCreditWarning[] {
  const {
    preferences,
    allPersonIds,
    allWorkedShiftTypeIds,
    peopleGroups,
    dateGroups,
    shiftTypeGroups,
    dateRange,
  } = input;

  // Pre-resolve every LEAVE-pinning shift request once (person set + date set).
  // A request contributes only when both resolve; an unresolved side means we
  // cannot prove overlap and drop that request from consideration.
  const leaveRequests = preferences
    .filter((pref): pref is ShiftRequestPreference => pref.type === SHIFT_REQUEST)
    .map(request => {
      const shiftTypes = resolveShiftTypes(request.shiftType, allWorkedShiftTypeIds, shiftTypeGroups);
      if (shiftTypes === 'unknown' || !shiftTypes.known.has(LEAVE)) {
        return undefined;
      }
      const people = resolvePeople(request.person, allPersonIds, peopleGroups);
      if (people === 'unknown') {
        return undefined;
      }
      const dates = resolveDates(request.date, dateGroups, dateRange);
      if (dates === 'unknown') {
        return undefined;
      }
      return { people: people.known, dates: dates.known };
    })
    .filter((request): request is { people: Set<string>; dates: Set<string> } => request !== undefined);

  const warnings: LeaveCreditWarning[] = [];
  let shiftCountListIndex = -1;

  for (const pref of preferences) {
    if (pref.type !== SHIFT_COUNT) {
      continue;
    }
    shiftCountListIndex += 1;
    const shiftCount = pref as ShiftCountPreference;

    // 1. Signal: only explicitly-marked hours contracts are checked (D2/D7).
    if (!shiftCount.hoursContract) {
      continue;
    }

    // 2. LEAVE must be absent from the (expanded) counted shift types.
    const countedShiftTypes = resolveShiftTypes(
      shiftCount.countShiftTypes,
      allWorkedShiftTypeIds,
      shiftTypeGroups
    );
    if (countedShiftTypes === 'unknown' || countedShiftTypes.known.has(LEAVE)) {
      continue;
    }

    // 3. The count must cover at least one person (unresolved ⇒ suppress).
    const countPeople = resolvePeople(shiftCount.person, allPersonIds, peopleGroups);
    if (countPeople === 'unknown') {
      continue;
    }

    // 4. Intersect people AND dates with each LEAVE request.
    const countDates = resolveDates(shiftCount.countDates, dateGroups, dateRange);
    if (countDates === 'unknown') {
      continue;
    }

    const affected = new Set<string>();
    for (const request of leaveRequests) {
      if (!isNonEmptyIntersection(countPeople.known, request.people)) {
        continue;
      }
      if (!isNonEmptyIntersection(countDates.known, request.dates)) {
        continue;
      }
      for (const person of intersect(countPeople.known, request.people)) {
        affected.add(person);
      }
    }

    if (affected.size > 0) {
      warnings.push({
        shiftCountListIndex,
        affectedPeople: [...affected].sort(),
      });
    }
  }

  return warnings;
}
