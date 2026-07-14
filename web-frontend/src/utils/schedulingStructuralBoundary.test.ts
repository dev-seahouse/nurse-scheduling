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

import { canonicalizeWorkingTime } from "@/utils/schedulingStructuralBoundary";

describe("canonicalizeWorkingTime", () => {
  it("removes permitted omissions without rebuilding or reordering valid fields", () => {
    const item = {
      id: "D",
      startTime: "09:00",
      restMinutes: 0,
      description: "Day",
      endTime: "17:00",
      durationMinutes: 480,
      optionalNote: null,
    };

    canonicalizeWorkingTime([item]);

    expect(Object.keys(item)).toEqual([
      "id",
      "startTime",
      "description",
      "endTime",
      "durationMinutes",
      "optionalNote",
    ]);
    expect(item).not.toHaveProperty("restMinutes");
  });

  it("turns an all-null working-time object into full omission", () => {
    const item = {
      id: "D",
      durationMinutes: null,
      startTime: undefined,
      endTime: null,
      restMinutes: undefined,
    };

    canonicalizeWorkingTime([item]);

    expect(item).toEqual({ id: "D" });
  });
});
