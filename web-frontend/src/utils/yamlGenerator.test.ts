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

// This test is mostly AI generated.

import yaml from 'js-yaml';
import { generateYamlFromState, isLeafArray, replacer } from '@/utils/yamlGenerator';
import { ContractedHoursBoundaryError } from '@/utils/contractedHoursBoundary';

describe('yamlGenerator', () => {
  it('detects leaf arrays only', () => {
    expect(isLeafArray([1, 'a', true, null, undefined])).toBe(true);
    expect(isLeafArray([{ a: 1 }])).toBe(false);
    expect(isLeafArray('not-array')).toBe(false);
  });

  it('converts date values to YYYY-MM-DD through replacer', () => {
    const value = new Date(Date.UTC(2026, 1, 3, 12));
    expect(replacer('date', value)).toBe('2026-02-03');
  });

  it('emits flow style for leaf arrays in YAML output', () => {
    const yaml = generateYamlFromState({
      people: ['alice', 'bob'],
      meta: { enabled: true },
    });

    expect(yaml).toContain('people: [alice, bob]');
    expect(yaml).toContain('meta:\n  enabled: true');
    expect(yaml.endsWith('\n')).toBe(true);
  });

  it('round-trips shift-count hoursContract metadata through YAML', () => {
    const preference = {
      type: 'shift count',
      person: ['P1'],
      countDates: ['ALL'],
      countShiftTypes: ['D'],
      countShiftTypeCoefficients: [['D', 16]],
      expression: 'x = T',
      target: 320,
      weight: Number.POSITIVE_INFINITY,
      hoursContract: { unit: 'half-hour', policy: 'exact' },
    };

    const serialized = generateYamlFromState({
      shiftTypes: { items: [{ id: 'D', description: '' }], groups: [] },
      preferences: [preference],
    });
    const parsed = yaml.load(serialized) as { preferences: (typeof preference)[] };

    expect(parsed.preferences[0].hoursContract).toEqual({ unit: 'half-hour', policy: 'exact' });
  });

  it('round-trips all four shift-count wire variants losslessly (WT3 D8)', () => {
    const preferences = [
      // Generic scalar.
      { type: 'shift count', person: ['P1'], countDates: ['ALL'], countShiftTypes: ['D'], expression: 'x >= T', target: 1, weight: 1 },
      // Generic backend-valid array (never flattened).
      { type: 'shift count', person: ['P1'], countDates: ['ALL'], countShiftTypes: ['D'], expression: ['x >= T', 'x <= T'], target: [1, 3], weight: 1 },
      // Marked Exact: scalar expression + scalar target.
      { type: 'shift count', person: ['P1'], countDates: ['ALL'], countShiftTypes: ['D'], countShiftTypeCoefficients: [['D', 16]], hoursContract: { unit: 'half-hour', policy: 'exact' }, expression: 'x = T', target: 320, weight: Number.POSITIVE_INFINITY },
      // Marked Range: expression pair + ordered target pair.
      { type: 'shift count', person: ['P1'], countDates: ['ALL'], countShiftTypes: ['D'], countShiftTypeCoefficients: [['D', 16]], hoursContract: { unit: 'half-hour', policy: 'range' }, expression: ['x >= T', 'x <= T'], target: [300, 340], weight: Number.POSITIVE_INFINITY },
    ];

    const serialized = generateYamlFromState({
      shiftTypes: { items: [{ id: 'D', description: '' }], groups: [] },
      preferences,
    });
    const parsed = yaml.load(serialized) as { preferences: typeof preferences };

    expect(parsed.preferences[0]).toMatchObject({ expression: 'x >= T', target: 1 });
    expect(parsed.preferences[1]).toMatchObject({ expression: ['x >= T', 'x <= T'], target: [1, 3] });
    expect(parsed.preferences[2]).toMatchObject({ expression: 'x = T', target: 320, hoursContract: { unit: 'half-hour', policy: 'exact' } });
    expect(parsed.preferences[3]).toMatchObject({ expression: ['x >= T', 'x <= T'], target: [300, 340], hoursContract: { unit: 'half-hour', policy: 'range' } });
  });

  it('round-trips durable shift-type working-time fields through YAML', () => {
    const shiftType = {
      id: 'D',
      description: 'Day',
      startTime: '08:00',
      endTime: '20:30',
      restMinutes: 60,
      durationMinutes: 690,
    };

    const serialized = generateYamlFromState({ shiftTypes: { items: [shiftType], groups: [] } });
    const parsed = yaml.load(serialized) as { shiftTypes: { items: (typeof shiftType)[] } };

    expect(parsed.shiftTypes.items[0]).toEqual(shiftType);
  });

  it('blocks invalid direct scenario serialization but permits an explicit non-boundary preview', () => {
    const invalid = {
      shiftTypes: {
        items: [{ id: 'D', description: '' }, { id: 'E', description: '' }],
        groups: [],
      },
      preferences: [{
        type: 'shift count',
        description: 'Stale ALL coverage',
        person: ['P1'],
        countDates: ['ALL'],
        countShiftTypes: ['ALL'],
        countShiftTypeCoefficients: [['D', 16]],
        hoursContract: { unit: 'half-hour', policy: 'exact' },
        expression: 'x = T',
        target: 320,
        weight: Number.POSITIVE_INFINITY,
      }],
    };

    expect(() => generateYamlFromState(invalid)).toThrow(ContractedHoursBoundaryError);
    expect(generateYamlFromState(invalid, { validateContractedHours: false }))
      .toContain('description: Stale ALL coverage');
  });
});
