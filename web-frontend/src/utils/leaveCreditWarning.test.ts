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

import {
  findUncreditedLeaveWarnings,
  resolveDates,
  resolvePeople,
  resolveShiftTypes,
  LeaveWarningInput,
} from '@/utils/leaveCreditWarning';
import {
  DateRange,
  Group,
  Preference,
  ShiftCountPreference,
  ShiftRequestPreference,
  SHIFT_COUNT,
  SHIFT_REQUEST,
} from '@/types/scheduling';
import { ALL, LEAVE, OFF } from '@/utils/keywords';

const ALL_PERSON_IDS = ['A', 'B', 'C'];
const ALL_WORKED_SHIFT_TYPE_IDS = ['D', 'N'];
// 2026-01-01 is a Thursday; 2026-01-31 is a Saturday.
const DATE_RANGE: DateRange = {
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
};

const PEOPLE_GROUPS: Group[] = [{ id: 'TEAM', members: ['A', 'B'], description: '' }];
const SHIFT_TYPE_GROUPS: Group[] = [
  { id: 'WORK', members: ['D', 'N'], description: '' },
  { id: 'WORK_WITH_LEAVE', members: ['D', 'N', LEAVE], description: '' },
];
const DATE_GROUPS: Group[] = [{ id: 'MIDJAN', members: ['2026-01-10', '2026-01-11'], description: '' }];

function shiftCount(overrides: Partial<ShiftCountPreference> = {}): ShiftCountPreference {
  return {
    type: SHIFT_COUNT,
    person: ['A'],
    countDates: [ALL],
    countShiftTypes: [ALL],
    hoursContract: { unit: 'half-hour', policy: 'exact' },
    expression: 'x = T',
    target: 288,
    weight: 1,
    ...overrides,
  };
}

function leaveRequest(overrides: Partial<ShiftRequestPreference> = {}): ShiftRequestPreference {
  return {
    type: SHIFT_REQUEST,
    person: ['A'],
    date: ['2026-01-15'],
    shiftType: [LEAVE],
    weight: 1,
    ...overrides,
  };
}

function makeInput(preferences: Preference[], overrides: Partial<LeaveWarningInput> = {}): LeaveWarningInput {
  return {
    preferences,
    allPersonIds: ALL_PERSON_IDS,
    allWorkedShiftTypeIds: ALL_WORKED_SHIFT_TYPE_IDS,
    peopleGroups: PEOPLE_GROUPS,
    dateGroups: DATE_GROUPS,
    shiftTypeGroups: SHIFT_TYPE_GROUPS,
    dateRange: DATE_RANGE,
    ...overrides,
  };
}

describe('resolvePeople', () => {
  it('expands ALL to the full person universe including ungrouped people', () => {
    expect(resolvePeople([ALL], ALL_PERSON_IDS, PEOPLE_GROUPS)).toEqual({
      known: new Set(['A', 'B', 'C']),
    });
  });

  it('expands groups and literals', () => {
    expect(resolvePeople(['TEAM', 'C'], ALL_PERSON_IDS, PEOPLE_GROUPS)).toEqual({
      known: new Set(['A', 'B', 'C']),
    });
  });

  it('returns unknown for an unrecognized id', () => {
    expect(resolvePeople(['Z'], ALL_PERSON_IDS, PEOPLE_GROUPS)).toBe('unknown');
  });
});

describe('resolveShiftTypes', () => {
  it('expands ALL to worked-only universe, omitting OFF and LEAVE', () => {
    const resolved = resolveShiftTypes([ALL], ALL_WORKED_SHIFT_TYPE_IDS, SHIFT_TYPE_GROUPS);
    expect(resolved).toEqual({ known: new Set(['D', 'N']) });
    expect((resolved as { known: Set<string> }).known.has(LEAVE)).toBe(false);
  });

  it('resolves OFF and LEAVE literals to themselves', () => {
    expect(resolveShiftTypes([OFF], ALL_WORKED_SHIFT_TYPE_IDS, SHIFT_TYPE_GROUPS)).toEqual({
      known: new Set([OFF]),
    });
    expect(resolveShiftTypes([LEAVE], ALL_WORKED_SHIFT_TYPE_IDS, SHIFT_TYPE_GROUPS)).toEqual({
      known: new Set([LEAVE]),
    });
  });

  it('reports LEAVE present when a group contains LEAVE', () => {
    const resolved = resolveShiftTypes(['WORK_WITH_LEAVE'], ALL_WORKED_SHIFT_TYPE_IDS, SHIFT_TYPE_GROUPS);
    expect((resolved as { known: Set<string> }).known.has(LEAVE)).toBe(true);
  });

  it('returns unknown for an unknown shift type', () => {
    expect(resolveShiftTypes(['X'], ALL_WORKED_SHIFT_TYPE_IDS, SHIFT_TYPE_GROUPS)).toBe('unknown');
  });
});

describe('resolveDates', () => {
  it('expands ALL to the whole range', () => {
    const resolved = resolveDates([ALL], DATE_GROUPS, DATE_RANGE);
    expect((resolved as { known: Set<string> }).known.size).toBe(31);
    expect((resolved as { known: Set<string> }).known.has('2026-01-01')).toBe(true);
    expect((resolved as { known: Set<string> }).known.has('2026-01-31')).toBe(true);
  });

  it('expands WEEKEND to Saturdays and Sundays only', () => {
    const resolved = resolveDates(['WEEKEND'], DATE_GROUPS, DATE_RANGE);
    // Jan 2026 weekends: 3,4,10,11,17,18,24,25,31.
    expect((resolved as { known: Set<string> }).known).toEqual(
      new Set([
        '2026-01-03', '2026-01-04', '2026-01-10', '2026-01-11', '2026-01-17',
        '2026-01-18', '2026-01-24', '2026-01-25', '2026-01-31',
      ])
    );
  });

  it('expands MONDAY to Mondays only', () => {
    const resolved = resolveDates(['MONDAY'], DATE_GROUPS, DATE_RANGE);
    expect((resolved as { known: Set<string> }).known).toEqual(
      new Set(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'])
    );
  });

  it('expands a YYYY-MM-DD~YYYY-MM-DD range inclusively', () => {
    const resolved = resolveDates(['2026-01-05~2026-01-08'], DATE_GROUPS, DATE_RANGE);
    expect((resolved as { known: Set<string> }).known).toEqual(
      new Set(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'])
    );
  });

  it('expands date groups', () => {
    expect(resolveDates(['MIDJAN'], DATE_GROUPS, DATE_RANGE)).toEqual({
      known: new Set(['2026-01-10', '2026-01-11']),
    });
  });

  it('resolves single-month DD ids against the range month', () => {
    // DATE_RANGE is a single month (Jan 2026), so "10" means 2026-01-10.
    expect(resolveDates(['10'], DATE_GROUPS, DATE_RANGE)).toEqual({
      known: new Set(['2026-01-10']),
    });
    expect(resolveDates(['05'], DATE_GROUPS, DATE_RANGE)).toEqual({
      known: new Set(['2026-01-05']),
    });
  });

  it('resolves single-year MM-DD ids against the range year', () => {
    const sameYearRange: DateRange = {
      startDate: new Date('2026-01-15'),
      endDate: new Date('2026-03-15'),
    };
    expect(resolveDates(['02-10'], DATE_GROUPS, sameYearRange)).toEqual({
      known: new Set(['2026-02-10']),
    });
    // A DD id is not valid when the range spans multiple months.
    expect(resolveDates(['10'], DATE_GROUPS, sameYearRange)).toBe('unknown');
  });

  it('resolves YYYY-MM-DD ids in a multi-year range', () => {
    const multiYearRange: DateRange = {
      startDate: new Date('2025-12-20'),
      endDate: new Date('2026-01-10'),
    };
    expect(resolveDates(['2026-01-05'], DATE_GROUPS, multiYearRange)).toEqual({
      known: new Set(['2026-01-05']),
    });
    // MM-DD is not valid when the range spans multiple years.
    expect(resolveDates(['01-05'], DATE_GROUPS, multiYearRange)).toBe('unknown');
  });

  it('expands a DD start~end range inclusively in a single-month schedule', () => {
    expect(resolveDates(['05~08'], DATE_GROUPS, DATE_RANGE)).toEqual({
      known: new Set(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08']),
    });
  });

  it('returns unknown for a genuinely malformed date id', () => {
    expect(resolveDates(['2026/01/05'], DATE_GROUPS, DATE_RANGE)).toBe('unknown');
    expect(resolveDates(['nope'], DATE_GROUPS, DATE_RANGE)).toBe('unknown');
    expect(resolveDates(['05~nope'], DATE_GROUPS, DATE_RANGE)).toBe('unknown');
  });

  it('returns unknown for keywords when the date range is incomplete', () => {
    expect(resolveDates([ALL], DATE_GROUPS, {})).toBe('unknown');
  });
});

describe('resolveSelector group DAG policy', () => {
  it('suppresses (unknown) on a forward reference', () => {
    const groups: Group[] = [
      { id: 'G1', members: ['G2'], description: '' },
      { id: 'G2', members: ['D'], description: '' },
    ];
    expect(resolveShiftTypes(['G1'], ALL_WORKED_SHIFT_TYPE_IDS, groups)).toBe('unknown');
    // The canonical (backward) reference still resolves.
    expect(resolveShiftTypes(['G2'], ALL_WORKED_SHIFT_TYPE_IDS, groups)).toEqual({
      known: new Set(['D']),
    });
  });

  it('suppresses (unknown) on a cycle', () => {
    const groups: Group[] = [
      { id: 'G1', members: ['G2'], description: '' },
      { id: 'G2', members: ['G1'], description: '' },
    ];
    expect(resolveShiftTypes(['G1'], ALL_WORKED_SHIFT_TYPE_IDS, groups)).toBe('unknown');
    expect(resolveShiftTypes(['G2'], ALL_WORKED_SHIFT_TYPE_IDS, groups)).toBe('unknown');
  });

  it('resolves a canonical nested DAG (later group references earlier)', () => {
    const groups: Group[] = [
      { id: 'BASE', members: ['D'], description: '' },
      { id: 'NEST', members: ['BASE', 'N'], description: '' },
    ];
    expect(resolveShiftTypes(['NEST'], ALL_WORKED_SHIFT_TYPE_IDS, groups)).toEqual({
      known: new Set(['D', 'N']),
    });
  });
});

describe('findUncreditedLeaveWarnings — trigger', () => {
  it('warns for an ALL-only hours-contract count omitting LEAVE while a nurse is on leave', () => {
    const warnings = findUncreditedLeaveWarnings(makeInput([shiftCount(), leaveRequest()]));
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A'] }]);
  });

  it('warns for a worked-shift group count omitting LEAVE', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countShiftTypes: ['WORK'] }), leaveRequest()])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A'] }]);
  });

  it('warns for a soft |x - T|^2 hours contract (signal is metadata, not expression)', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ expression: '|x - T|^2' }), leaveRequest()])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A'] }]);
  });

  it('classifies a LEAVE request whose shiftType is a group containing LEAVE', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount(), leaveRequest({ shiftType: ['WORK_WITH_LEAVE'] })])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A'] }]);
  });
});

describe('findUncreditedLeaveWarnings — people expansion', () => {
  it('warns for ungrouped people reached only through ALL (ALL ∩ literal)', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ person: [ALL] }), leaveRequest({ person: ['C'] })])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['C'] }]);
  });

  it('warns for ALL ∩ group', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ person: [ALL] }), leaveRequest({ person: ['TEAM'] })])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A', 'B'] }]);
  });

  it('warns for ALL ∩ ALL over the full universe', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ person: [ALL] }), leaveRequest({ person: [ALL] })])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A', 'B', 'C'] }]);
  });

  it('does not warn when the count covers a different person than the leave', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ person: ['B'] }), leaveRequest({ person: ['A'] })])
    );
    expect(warnings).toEqual([]);
  });
});

describe('findUncreditedLeaveWarnings — no warning cases', () => {
  it('does not warn when the count is not marked as an hours contract', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ hoursContract: undefined }), leaveRequest()])
    );
    expect(warnings).toEqual([]);
  });

  it('does not warn for an exact target:0 quota that is not an hours contract', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([
        shiftCount({ hoursContract: undefined, target: 0, countShiftTypes: ['D'] }),
        leaveRequest(),
      ])
    );
    expect(warnings).toEqual([]);
  });

  it('does not warn when LEAVE is already present via a group containing LEAVE', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countShiftTypes: ['WORK_WITH_LEAVE'] }), leaveRequest()])
    );
    expect(warnings).toEqual([]);
  });

  it('does not warn when LEAVE is explicitly counted', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countShiftTypes: ['D', 'N', LEAVE] }), leaveRequest()])
    );
    expect(warnings).toEqual([]);
  });

  it('does not warn when no leave is pinned', () => {
    const warnings = findUncreditedLeaveWarnings(makeInput([shiftCount()]));
    expect(warnings).toEqual([]);
  });

  it('does not treat an ALL shift request as leave (ALL excludes LEAVE)', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount(), leaveRequest({ shiftType: [ALL] })])
    );
    expect(warnings).toEqual([]);
  });
});

describe('findUncreditedLeaveWarnings — date overlap', () => {
  it('warns for a single-month schedule where leave is pinned on a DD id (T7 regression)', () => {
    // The frontend emits DD date ids in single-month schedules; the count spans
    // ALL dates and omits LEAVE, so the DD-pinned leave day must still overlap.
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countDates: [ALL] }), leaveRequest({ date: ['10'] })])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A'] }]);
  });

  it('warns when a DD start~end range overlaps a DD-pinned leave day', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countDates: ['05~15'] }), leaveRequest({ date: ['10'] })])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A'] }]);
  });

  it('does not warn when a DD start~end range does not overlap the DD leave day', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countDates: ['05~08'] }), leaveRequest({ date: ['20'] })])
    );
    expect(warnings).toEqual([]);
  });

  it('warns when a date group overlaps the leave date', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countDates: ['MIDJAN'] }), leaveRequest({ date: ['2026-01-10'] })])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A'] }]);
  });

  it('does not warn when a date group does not overlap the leave date', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countDates: ['MIDJAN'] }), leaveRequest({ date: ['2026-01-20'] })])
    );
    expect(warnings).toEqual([]);
  });

  it('warns when a start~end range overlaps the leave date', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([
        shiftCount({ countDates: ['2026-01-05~2026-01-15'] }),
        leaveRequest({ date: ['2026-01-10'] }),
      ])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A'] }]);
  });

  it('does not warn when a start~end range does not overlap the leave date', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([
        shiftCount({ countDates: ['2026-01-05~2026-01-08'] }),
        leaveRequest({ date: ['2026-01-20'] }),
      ])
    );
    expect(warnings).toEqual([]);
  });
});

describe('findUncreditedLeaveWarnings — suppression on unresolved selectors', () => {
  it('suppresses when the count date syntax is malformed', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countDates: ['2026/01/15'] }), leaveRequest({ date: ['2026-01-15'] })])
    );
    expect(warnings).toEqual([]);
  });

  it('suppresses when the leave-request date syntax is malformed', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount(), leaveRequest({ date: ['nope'] })])
    );
    expect(warnings).toEqual([]);
  });

  it('suppresses when countShiftTypes references a forward-ref group', () => {
    const groups: Group[] = [
      { id: 'FWD', members: ['LATER'], description: '' },
      { id: 'LATER', members: ['D'], description: '' },
    ];
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ countShiftTypes: ['FWD'] }), leaveRequest()], {
        shiftTypeGroups: groups,
      })
    );
    expect(warnings).toEqual([]);
  });

  it('suppresses when the count person references a cyclic group', () => {
    const groups: Group[] = [
      { id: 'P1', members: ['P2'], description: '' },
      { id: 'P2', members: ['P1'], description: '' },
    ];
    const warnings = findUncreditedLeaveWarnings(
      makeInput([shiftCount({ person: ['P1'] }), leaveRequest()], { peopleGroups: groups })
    );
    expect(warnings).toEqual([]);
  });
});

describe('findUncreditedLeaveWarnings — index correctness', () => {
  it('reports the shift-count sublist index, not the preference array index', () => {
    // A leave request precedes the counts, so array indices differ from sublist indices.
    const warnings = findUncreditedLeaveWarnings(
      makeInput([leaveRequest(), shiftCount(), shiftCount()])
    );
    expect(warnings).toEqual([
      { shiftCountListIndex: 0, affectedPeople: ['A'] },
      { shiftCountListIndex: 1, affectedPeople: ['A'] },
    ]);
  });

  it('keeps indices aligned when only some counts warn', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([
        shiftCount({ hoursContract: undefined }), // index 0: unmarked, no warn
        shiftCount(), // index 1: warns
        leaveRequest(),
      ])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 1, affectedPeople: ['A'] }]);
  });

  it('unions affected people across multiple leave requests for one count', () => {
    const warnings = findUncreditedLeaveWarnings(
      makeInput([
        shiftCount({ person: [ALL] }),
        leaveRequest({ person: ['A'] }),
        leaveRequest({ person: ['C'] }),
      ])
    );
    expect(warnings).toEqual([{ shiftCountListIndex: 0, affectedPeople: ['A', 'C'] }]);
  });
});
