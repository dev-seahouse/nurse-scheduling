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

export interface ServerInfoResponse {
  status: string;
  api_version: string;
  app_version: string;
}

// Default backend used when NEXT_PUBLIC_BACKEND_API_URL is not set at build time.
export const DEFAULT_BACKEND_API_URL = 'http://localhost:8000';

// The single backend URL the app talks to, resolved at build time from
// NEXT_PUBLIC_BACKEND_API_URL (falling back to the local default). Trailing
// slashes are trimmed so request paths join cleanly.
export const BACKEND_API_URL = (process.env.NEXT_PUBLIC_BACKEND_API_URL || DEFAULT_BACKEND_API_URL)
  .trim()
  .replace(/\/+$/, '');
