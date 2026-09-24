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

// The Optimize and Export page for Tab "11. Optimize and Export"
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FiDownload, FiAlertCircle, FiAlertTriangle, FiCheckCircle, FiLoader, FiLock, FiRefreshCw, FiWifi, FiWifiOff, FiActivity } from 'react-icons/fi';
import OptimizationProgressChart, { OptimizationProgressPoint } from '@/components/OptimizationProgressChart';
import NumberInput from '@/components/NumberInput';
import BackendTokenField, { isValidBackendToken } from '@/components/BackendTokenField';
import PageDocumentationLink from '@/components/PageDocumentationLink';
import StarRepoNudge from '@/components/StarRepoNudge';
import ContractedHoursValidationNotice from '@/components/ContractedHoursValidationNotice';
import { useSchedulingData } from '@/hooks/useSchedulingData';
import { anonymizeSchedulingStateWithMapping } from '@/utils/anonymizeSchedulingState';
import { restorePeopleIdsInXlsx } from '@/utils/restorePeopleIdsInXlsx';
import { generateYamlFromState } from '@/utils/yamlGenerator';
import { DOCUMENTATION_URLS, GITHUB_PRIVACY_URL } from '@/constants/urls';
import {
  BACKEND_API_URL,
  buildAuthHeaders,
  EXPECTED_BACKEND_SERVICE_NAME,
  isOptimizationOptionsResponse,
  normalizeEndpoint,
  parseAuthRequirement,
  SUPPORTED_BACKEND_API_VERSION,
  type OptimizationOptionsResponse,
  type ServerInfoResponse,
} from '@/app/optimize-and-export/serverSelection';
import { CURRENT_APP_VERSION, parseVersionParts } from '@/utils/version';
import {
  ContractedHoursDiagnostic,
  isContractedHoursBoundaryError,
} from '@/utils/contractedHoursBoundary';

type ServerStatus = 'unchecked' | 'checking' | 'online' | 'offline' | 'incompatible' | 'degraded' | 'unauthorized';

type JsonFetchResult =
  | { kind: 'data'; data: unknown }
  | { kind: 'http-error'; status: number }
  | { kind: 'invalid-json' }
  | { kind: 'unavailable' };

type OptimizationOptionsResult =
  | { kind: 'options'; options: OptimizationOptionsResponse }
  | { kind: 'invalid' }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' };

interface ServerInfoProbeResult {
  status: 'online' | 'incompatible' | 'offline';
  health: ServerInfoResponse | null;
  // Missing on backends that predate optional authentication, which are always open.
  authRequired: boolean;
  error: string | null;
}

interface OptimizeJobResponse {
  id: string;
  state: 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
  terminal: boolean;
  queue_position: number | null;
  result: {
    outcome: 'optimal' | 'feasible' | 'infeasible';
    score: number | null;
    solver_status: string;
    termination_reason: string | null;
  } | null;
  error: { code: string; message: string } | null;
  controls: {
    cancellable: boolean;
    early_completion_available: boolean;
  };
  links: {
    self: string;
    events: string;
    cancellation: string;
    early_completion: string;
    schedule: string | null;
  };
}

interface SseEventLogEntry {
  type: string;
  data: unknown;
  receivedAt: Date;
}

interface OptimizeProgressEvent {
  source?: string;
  currentBestScore?: number;
  elapsedSeconds?: number;
  solutionIndex?: number | null;
  commentCount?: number | null;
}

interface OptimizePhaseEvent {
  message?: string;
}

interface OptimizeServerEntry {
  endpoint: string;
  // `token` is the credential used for this backend, kept out of storage unless remembered.
  token: string | null;
  rememberToken: boolean;
  authRequired: boolean;
  status: ServerStatus;
  health: ServerInfoResponse | null;
  options: OptimizationOptionsResponse | null;
  error: string | null;
  lastCheckedAt: Date | null;
  pingMs: number | null;
  healthProbeId: number;
}

interface StoredServerToken {
  endpoint: string;
  token: string;
}

const TERMINAL_JOB_STATES = new Set(['completed', 'cancelled', 'failed']);
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const INITIAL_HEALTH_CHECK_TIMEOUT_MS = 3000;
const SERVER_ACTIVITY_REFRESH_MS = 15000;
const SERVER_TOKEN_STORAGE_KEY = 'nurse-scheduling-backend-token';
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
// Keep the legacy /optimize request defaults and validation range for backward compatibility with backends that predate /optimize/options.
const BACKWARD_COMPATIBLE_OPTIMIZATION_OPTIONS: OptimizationOptionsResponse = {
  schema_version: 'alpha',
  solver: {
    default: 'ortools/cp-sat',
    choices: [
      {
        value: 'ortools/cp-sat',
        label: 'OR-Tools | CP-SAT',
        compute: 'cpu',
        timeout: {
          default: 300,
          minimum: 1,
          maximum: 3600,
        },
        controls: {
          cancel_running: true,
          finish_now: true,
        },
      },
    ],
  },
  prettify: {
    default: true,
  },
};

function createServerEntry(
  server: { endpoint: string; token?: string },
  status: ServerStatus = 'unchecked',
): OptimizeServerEntry {
  const storedToken = typeof server.token === 'string' ? server.token.trim() : '';
  return {
    endpoint: server.endpoint,
    token: isValidBackendToken(storedToken) ? storedToken : null,
    rememberToken: isValidBackendToken(storedToken),
    authRequired: false,
    status,
    health: null,
    options: null,
    error: null,
    lastCheckedAt: null,
    pingMs: null,
    healthProbeId: 0,
  };
}

// A remembered token is only reused for the backend it was saved for.
function loadStoredServerToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(SERVER_TOKEN_STORAGE_KEY) ?? 'null') as Partial<StoredServerToken> | null;
    const token = typeof stored?.token === 'string' ? stored.token.trim() : '';
    return stored?.endpoint === BACKEND_API_URL && isValidBackendToken(token) ? token : null;
  } catch {
    return null;
  }
}

function persistServerToken(token: string | null, rememberToken: boolean): void {
  if (rememberToken && token) {
    const stored: StoredServerToken = { endpoint: BACKEND_API_URL, token };
    window.localStorage.setItem(SERVER_TOKEN_STORAGE_KEY, JSON.stringify(stored));
  } else {
    window.localStorage.removeItem(SERVER_TOKEN_STORAGE_KEY);
  }
}

function isDirtyAppVersion(version: string): boolean {
  return parseVersionParts(version).dirty;
}

function hasAppVersionMismatch(frontendVersion: string, backendVersion: string): boolean {
  return frontendVersion !== backendVersion || isDirtyAppVersion(frontendVersion) || isDirtyAppVersion(backendVersion);
}

function parseClaimedPerformance(value: unknown): ServerInfoResponse['claimed_performance'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.score !== 'number' || !Number.isFinite(candidate.score) || candidate.score <= 0 ||
    typeof candidate.app_version !== 'string' || candidate.app_version.length === 0 ||
    typeof candidate.measured_at !== 'string' || !Number.isFinite(Date.parse(candidate.measured_at))
  ) {
    return null;
  }
  return {
    score: candidate.score,
    app_version: candidate.app_version,
    measured_at: candidate.measured_at,
  };
}

function buildApiUrl(endpoint: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return `${normalizeEndpoint(endpoint)}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchServerInfo(
  endpoint: string,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<ServerInfoProbeResult> {
  const result = await fetchJsonWithTimeout(`${endpoint}/info`, timeoutMs, signal);
  if (result.kind === 'http-error') {
    return {
      status: 'offline',
      health: null,
      authRequired: false,
      error: `Backend info request failed with status ${result.status}.`,
    };
  }
  if (result.kind === 'unavailable') {
    return {
      status: 'offline',
      health: null,
      authRequired: false,
      error: 'Backend is not responding.',
    };
  }
  if (result.kind === 'invalid-json' || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    return {
      status: 'incompatible',
      health: null,
      authRequired: false,
      error: 'Backend returned invalid server information.',
    };
  }

  const info = result.data as Partial<ServerInfoResponse>;
  const incompatibilities: string[] = [];
  if (info.status !== 'ready') {
    incompatibilities.push(
      typeof info.status === 'string'
        ? `Backend reports status "${info.status}". Expected "ready".`
        : 'Backend readiness status is missing.'
    );
  }
  if (info.service_name !== EXPECTED_BACKEND_SERVICE_NAME) {
    incompatibilities.push(
      typeof info.service_name === 'string'
        ? `Unexpected service "${info.service_name}". Expected "${EXPECTED_BACKEND_SERVICE_NAME}".`
        : 'Backend service name is missing.'
    );
  }
  if (info.api_version !== SUPPORTED_BACKEND_API_VERSION) {
    incompatibilities.push(
      typeof info.api_version === 'string'
        ? `Unsupported API version "${info.api_version}". Expected "${SUPPORTED_BACKEND_API_VERSION}".`
        : 'Backend API version is missing.'
    );
  }
  if (typeof info.app_version !== 'string') {
    incompatibilities.push('Backend app version is missing.');
  }

  const auth = parseAuthRequirement(info.auth);
  const health: ServerInfoResponse = {
    status: typeof info.status === 'string' ? info.status : 'missing',
    service_name: typeof info.service_name === 'string' ? info.service_name : 'missing',
    api_version: typeof info.api_version === 'string' ? info.api_version : 'missing',
    app_version: typeof info.app_version === 'string' ? info.app_version : 'missing',
    auth,
    claimed_performance: parseClaimedPerformance(info.claimed_performance),
    jobs: info.jobs,
    workers: info.workers,
  };
  const authRequired = auth?.required ?? false;
  return incompatibilities.length > 0
    ? {
        status: 'incompatible',
        health,
        authRequired,
        error: incompatibilities.join(' '),
      }
    : {
        status: 'online',
        health,
        authRequired,
        error: null,
      };
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<JsonFetchResult> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const abortController = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abortController);
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { kind: 'http-error', status: response.status };
    }

    try {
      return { kind: 'data', data: await response.json() as unknown };
    } catch {
      return { kind: 'invalid-json' };
    }
  } catch {
    return { kind: 'unavailable' };
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortController);
  }
}

async function fetchOptimizationOptions(
  endpoint: string,
  token: string | null,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<OptimizationOptionsResult> {
  const result = await fetchJsonWithTimeout(
    `${endpoint}/optimize/options`,
    timeoutMs,
    signal,
    buildAuthHeaders(token),
  );
  if (result.kind === 'http-error') {
    if (result.status === 401) {
      return { kind: 'unauthorized' };
    }
    return result.status === 404
      ? { kind: 'options', options: BACKWARD_COMPATIBLE_OPTIMIZATION_OPTIONS }
      : { kind: 'unavailable' };
  }
  if (result.kind === 'unavailable') {
    return result;
  }
  if (result.kind === 'invalid-json' || !isOptimizationOptionsResponse(result.data)) {
    return { kind: 'invalid' };
  }
  return { kind: 'options', options: result.data };
}

function getFilenameFromContentDisposition(contentDisposition: string | null): string {
  if (!contentDisposition) {
    return 'output.xlsx';
  }

  const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
  return filenameMatch ? filenameMatch[1] : 'output.xlsx';
}

function downloadFileFromUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function getErrorDetail(response: Response): Promise<string> {
  const errorText = await response.text();
  try {
    const errorJson = JSON.parse(errorText);
    if (typeof errorJson.error?.message === 'string') {
      return errorJson.error.message;
    }
    if (typeof errorJson.detail === 'string') {
      return errorJson.detail;
    }
    if (errorJson.detail !== undefined) {
      return JSON.stringify(errorJson.detail);
    }
  } catch {
    return errorText;
  }
  return errorText;
}

const CREDENTIALS_REJECTED_MESSAGE = 'Backend credentials are missing or invalid. Enter the backend token and try again.';

async function getServerErrorMessage(response: Response): Promise<string> {
  if (response.status === 401) {
    return CREDENTIALS_REJECTED_MESSAGE;
  }
  return `Server error (${response.status}): ${await getErrorDetail(response)}`;
}

function formatCheckedTime(date: Date | null): string {
  if (!date) {
    return 'Never';
  }
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function parseSseEventData(event: MessageEvent): unknown {
  if (!event.data) {
    return null;
  }

  try {
    return JSON.parse(event.data);
  } catch {
    return event.data;
  }
}

function formatSseEventData(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  return JSON.stringify(data);
}

function isProgressEventData(data: unknown): data is OptimizeProgressEvent {
  return typeof data === 'object' && data !== null && 'currentBestScore' in data;
}

function isPhaseEventData(data: unknown): data is OptimizePhaseEvent {
  return typeof data === 'object' && data !== null && 'message' in data;
}

function formatScore(score: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(score);
}

function formatElapsedSeconds(value: number): string {
  if (value < 60) {
    return `${Math.round(value)}s`;
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatRunStatus(status: string | null, queuePosition?: number | null): string {
  if (!status) {
    return 'Idle';
  }
  if (status.toLowerCase() === 'queued' && queuePosition !== undefined && queuePosition !== null) {
    return `Queued, position ${queuePosition}`;
  }
  return status;
}

function formatProgressSummary(data: OptimizeProgressEvent): string {
  const parts = [`Score: ${typeof data.currentBestScore === 'number' ? formatScore(data.currentBestScore) : 'N/A'}`];
  if (data.commentCount !== undefined && data.commentCount !== null) {
    parts.push(`Comments: ${data.commentCount}`);
  }
  if (data.elapsedSeconds !== undefined) {
    parts.push(`Elapsed: ${data.elapsedSeconds}s`);
  }
  if (data.solutionIndex !== undefined && data.solutionIndex !== null) {
    parts.push(`Solution: #${data.solutionIndex}`);
  }
  if (data.source) {
    parts.push(`Source: ${data.source}`);
  }
  return parts.join(' · ');
}

function getEventBadgeClasses(type: string): string {
  if (type === 'job.result_available') {
    return 'bg-green-50 text-green-700 ring-green-200';
  }
  if (type === 'error') {
    return 'bg-red-50 text-red-700 ring-red-200';
  }
  if (type === 'job.progressed') {
    return 'bg-blue-50 text-blue-700 ring-blue-200';
  }
  if (type === 'job.phase_changed') {
    return 'bg-amber-50 text-amber-700 ring-amber-200';
  }
  return 'bg-gray-100 text-gray-700 ring-gray-200';
}

function isCredentialRejection(server: OptimizeServerEntry | null): boolean {
  return server?.status === 'unauthorized' && server.token !== null;
}

function formatCredentialStatus(rejected: boolean): string {
  return rejected ? 'Credentials rejected' : 'Credentials required';
}

function describeCredentialStatus(rejected: boolean): string {
  return rejected ? 'Select Change to enter the current token.' : 'Select Enter token to continue.';
}

// Every status detail belongs in the Status icon's hover text. Putting it in the server
// cell instead lengthens that cell, which widens the table and hides the trailing columns.
function describeServerStatus(status: ServerStatus, server: OptimizeServerEntry | null): string {
  const statusText = status === 'unauthorized'
    ? formatCredentialStatus(isCredentialRejection(server))
    : formatServerStatus(status);
  const detail = status === 'unauthorized'
    ? describeCredentialStatus(isCredentialRejection(server))
    : server?.error ?? null;
  return detail ? `${statusText}. ${detail}` : statusText;
}

function formatServerStatus(status: ServerStatus): string {
  if (status === 'checking') {
    return 'Checking';
  }
  if (status === 'online') {
    return 'Online';
  }
  if (status === 'incompatible') {
    return 'Incompatible';
  }
  if (status === 'offline') {
    return 'Offline';
  }
  if (status === 'degraded') {
    return 'Options unavailable';
  }
  if (status === 'unauthorized') {
    return 'Credentials required';
  }
  return 'Unchecked';
}

export default function OptimizeAndExportPage() {
  const {
    apiVersionData,
    descriptionData,
    dateData,
    peopleData,
    shiftTypeData,
    preferences,
    effectiveExportData,
    filterAutoGeneratedState
  } = useSchedulingData();

  const [server, setServer] = useState<OptimizeServerEntry>(() => createServerEntry({ endpoint: BACKEND_API_URL }));
  const [editingToken, setEditingToken] = useState(false);
  const [prettifyArg, setPrettifyArg] = useState(true);
  const [anonymizeScheduleData, setAnonymizeScheduleData] = useState(true);
  const [solverArg, setSolverArg] = useState('ortools/cp-sat');
  const [timeoutArg, setTimeoutArg] = useState<number | string>(300);
  const [timeoutError, setTimeoutError] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contractedHoursDiagnostic, setContractedHoursDiagnostic] = useState<ContractedHoursDiagnostic | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [scheduleScore, setScheduleScore] = useState<number | null>(null);
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentJob, setCurrentJob] = useState<OptimizeJobResponse | null>(null);
  const [incumbentResult, setIncumbentResult] = useState<OptimizeProgressEvent | null>(null);
  const [progressPoints, setProgressPoints] = useState<OptimizationProgressPoint[]>([]);
  const [savedDownload, setSavedDownload] = useState<{ url: string; filename: string } | null>(null);
  const [sseEvents, setSseEvents] = useState<SseEventLogEntry[]>([]);
  const eventLogRef = useRef<HTMLDivElement | null>(null);
  const savedDownloadUrlRef = useRef<string | null>(null);
  const shouldScrollEventLogToBottomRef = useRef(true);
  // pageMountId invalidates async work from earlier page visits; healthProbeId
  // orders repeated probes within the current visit.
  const pageMountIdRef = useRef(0);
  const latestHealthProbeIdRef = useRef(0);
  const serverProbeControllerRef = useRef<AbortController | null>(null);
  const serverRef = useRef(server);
  const runOptionsLoadedRef = useRef(false);
  const resolvedOptimizeEndpoint = BACKEND_API_URL;
  const activeServerStatus = server.status;
  const activeServerHealth = server.health;
  const activeOptimizationOptions = server.options;
  const selectedSolverChoice = activeOptimizationOptions?.solver.choices.find(
    choice => choice.value === solverArg
  ) ?? null;
  const hasVersionMismatch = Boolean(activeServerHealth && hasAppVersionMismatch(CURRENT_APP_VERSION, activeServerHealth.app_version));
  const activeClaimedPerformance = activeServerHealth?.claimed_performance ?? null;
  // The configured backend is an explicit choice, so an incompatible one can still be used.
  const isIncompatibleServer = activeServerStatus === 'incompatible';
  const canUseActiveServer = activeServerStatus === 'online' || isIncompatibleServer;
  const isDateDataMissing = !dateData.range?.startDate || !dateData.range?.endDate || dateData.items.length === 0;
  const isPeopleDataMissing = peopleData.items.length === 0;
  const isShiftTypeDataMissing = shiftTypeData.items.length === 0 && shiftTypeData.groups.length === 0;
  const isRequiredDataMissing = isDateDataMissing || isPeopleDataMissing || isShiftTypeDataMissing;
  const isJobActive = Boolean(
    currentJobId &&
    isOptimizing &&
    currentJob &&
    !currentJob.terminal
  );
  const isCancelling = scheduleStatus === 'cancelling';
  const isOptimizeDisabled = isOptimizing || isRequiredDataMissing || !canUseActiveServer || !activeOptimizationOptions;
  const optimizeDisabledReason = isRequiredDataMissing
    ? 'Complete the missing schedule configuration before optimizing.'
    : activeServerStatus === 'unauthorized'
      ? 'This backend requires credentials. Enter its token to continue.'
    : activeServerStatus === 'degraded'
      ? 'Optimization options are unavailable. Check the backend and try again.'
    : !canUseActiveServer
      ? 'Backend unavailable. Check that the configured backend is running.'
      : !activeOptimizationOptions
        ? 'Backend optimization options are unavailable.'
      : null;

  // Create the current state object for YAML export (filtering out autogenerated items)
  const filteredState = filterAutoGeneratedState({
    apiVersion: apiVersionData,
    description: descriptionData,
    dates: dateData,
    people: peopleData,
    shiftTypes: shiftTypeData,
    preferences,
    export: effectiveExportData
  });

  const clearSavedDownload = useCallback(() => {
    if (savedDownloadUrlRef.current) {
      URL.revokeObjectURL(savedDownloadUrlRef.current);
      savedDownloadUrlRef.current = null;
    }
    setSavedDownload(null);
  }, []);

  const appendSseEvent = useCallback((type: string, data: unknown) => {
    const eventLog = eventLogRef.current;
    shouldScrollEventLogToBottomRef.current = eventLog
      ? eventLog.scrollHeight - eventLog.scrollTop - eventLog.clientHeight <= 4
      : true;
    setSseEvents(currentEvents => [
      ...currentEvents,
      {
        type,
        data,
        receivedAt: new Date(),
      },
    ]);
  }, []);

  useEffect(() => {
    return () => {
      if (savedDownloadUrlRef.current) {
        URL.revokeObjectURL(savedDownloadUrlRef.current);
        savedDownloadUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!shouldScrollEventLogToBottomRef.current) {
      return;
    }
    const eventLog = eventLogRef.current;
    if (eventLog) {
      eventLog.scrollTop = eventLog.scrollHeight;
    }
  }, [sseEvents.length]);

  useIsomorphicLayoutEffect(() => {
    if (!activeOptimizationOptions) {
      return;
    }

    const firstLoad = !runOptionsLoadedRef.current;
    runOptionsLoadedRef.current = true;
    const solverValues = new Set(activeOptimizationOptions.solver.choices.map(choice => choice.value));
    if (firstLoad || !solverValues.has(solverArg)) {
      const defaultSolver = activeOptimizationOptions.solver.default;
      const defaultChoice = activeOptimizationOptions.solver.choices.find(
        choice => choice.value === defaultSolver
      );
      if (!defaultChoice) {
        return;
      }
      setSolverArg(defaultSolver);
      setTimeoutArg(defaultChoice.timeout.default);
      setTimeoutError(null);
    }
    if (firstLoad) {
      setPrettifyArg(activeOptimizationOptions.prettify.default);
    }
  }, [activeOptimizationOptions, solverArg]);

  useEffect(() => {
    serverRef.current = server;
  }, [server]);

  // Health-check the single configured backend. A new check supersedes (aborts) any in-flight one.
  const startServerCheck = useCallback((token: string | null, silent = false) => {
    const endpoint = BACKEND_API_URL;
    const pageMountId = pageMountIdRef.current;
    const healthProbeId = latestHealthProbeIdRef.current + 1;
    latestHealthProbeIdRef.current = healthProbeId;
    const startedAt = performance.now();

    serverProbeControllerRef.current?.abort();
    const controller = new AbortController();
    serverProbeControllerRef.current = controller;

    setServer(currentServer => ({
      ...currentServer,
      status: silent && currentServer.status !== 'unchecked' ? currentServer.status : 'checking',
      error: null,
      healthProbeId,
    }));

    void Promise.all([
      fetchServerInfo(endpoint, INITIAL_HEALTH_CHECK_TIMEOUT_MS, controller.signal),
      fetchOptimizationOptions(endpoint, token, INITIAL_HEALTH_CHECK_TIMEOUT_MS, controller.signal),
    ]).then(([result, options]) => {
      const pingMs = Math.round(performance.now() - startedAt);
      setServer(currentServer => {
        if (
          pageMountId !== pageMountIdRef.current ||
          currentServer.healthProbeId !== healthProbeId
        ) {
          return currentServer;
        }

        const hasUsableOptions = options.kind === 'options'
          || (options.kind === 'unavailable' && currentServer.options !== null);
        const status: ServerStatus = result.status === 'offline'
          ? 'offline'
          : result.status === 'incompatible'
            ? 'incompatible'
            : options.kind === 'unauthorized'
              ? 'unauthorized'
              : hasUsableOptions
                ? 'online'
                : 'degraded';

        return {
          ...currentServer,
          status,
          // A rejected token still means the backend requires one, even if `/info` predates
          // the descriptor.
          authRequired: result.authRequired || options.kind === 'unauthorized',
          health: result.health,
          options: result.status === 'offline'
            ? null
            : options.kind === 'options'
              ? options.options
              : options.kind === 'unavailable'
                ? currentServer.options
                : null,
          error: result.error
            ? result.error
            : options.kind === 'options' || options.kind === 'unauthorized'
              ? null
              : options.kind === 'invalid'
                ? 'Backend returned invalid optimization options.'
                : 'Optimization options are temporarily unavailable.',
          lastCheckedAt: new Date(),
          pingMs,
        };
      });
    }).finally(() => {
      if (serverProbeControllerRef.current === controller) {
        serverProbeControllerRef.current = null;
      }
    });
  }, []);

  const recheckServer = useCallback(() => {
    startServerCheck(serverRef.current.token);
  }, [startServerCheck]);

  useIsomorphicLayoutEffect(() => {
    pageMountIdRef.current += 1;
    const pageMountId = pageMountIdRef.current;
    const storedToken = loadStoredServerToken();
    setServer(currentServer => ({
      ...currentServer,
      token: storedToken,
      rememberToken: storedToken !== null,
    }));
    startServerCheck(storedToken);

    return () => {
      serverProbeControllerRef.current?.abort();
      serverProbeControllerRef.current = null;
      if (pageMountIdRef.current === pageMountId) {
        pageMountIdRef.current += 1;
      }
    };
  }, [startServerCheck]);

  useEffect(() => {
    const refreshActivity = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      startServerCheck(serverRef.current.token, true);
    };
    const intervalId = window.setInterval(refreshActivity, SERVER_ACTIVITY_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshActivity);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshActivity);
    };
  }, [startServerCheck]);

  const authorizedFetch = useCallback((endpoint: string, path: string, init: RequestInit = {}): Promise<Response> => {
    return fetch(buildApiUrl(endpoint, path), {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...buildAuthHeaders(serverRef.current.token),
      },
    });
  }, []);

  const getOptimizeJobStatus = useCallback(async (job: OptimizeJobResponse): Promise<OptimizeJobResponse> => {
    const response = await authorizedFetch(resolvedOptimizeEndpoint, job.links.self, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(await getServerErrorMessage(response));
    }

    return await response.json() as OptimizeJobResponse;
  }, [authorizedFetch, resolvedOptimizeEndpoint]);

  const pollOptimizeJob = useCallback((job: OptimizeJobResponse): Promise<OptimizeJobResponse> => {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const updatedJob = await getOptimizeJobStatus(job);
          setCurrentJob(updatedJob);
          setScheduleStatus(updatedJob.state);

          if (updatedJob.terminal) {
            resolve(updatedJob);
            return;
          }

          window.setTimeout(() => void poll(), 1000);
        } catch (error) {
          reject(error);
        }
      };

      void poll();
    });
  }, [getOptimizeJobStatus]);

  const waitForOptimizeJob = useCallback((job: OptimizeJobResponse): Promise<OptimizeJobResponse> => {
    if (job.terminal) {
      return Promise.resolve(job);
    }

    if (typeof EventSource !== 'undefined') {
      return new Promise((resolve, reject) => {
        const eventSource = new EventSource(buildApiUrl(resolvedOptimizeEndpoint, job.links.events));
        let completionStarted = false;

        const finalizeJob = () => {
          if (completionStarted) {
            return;
          }
          completionStarted = true;
          eventSource.close();
          void getOptimizeJobStatus(job).then(completedJob => {
            setCurrentJob(completedJob);
            resolve(completedJob);
          }).catch(reject);
        };

        eventSource.addEventListener('job.state_changed', (event) => {
          const parsedData = parseSseEventData(event);
          appendSseEvent('job.state_changed', parsedData);
          const updatedJob = parsedData as Partial<OptimizeJobResponse>;
          if (updatedJob.state) {
            setScheduleStatus(updatedJob.state);
          }
          setCurrentJob(currentJob => currentJob ? { ...currentJob, ...updatedJob } : currentJob);
          if (updatedJob.state && TERMINAL_JOB_STATES.has(updatedJob.state)) {
            finalizeJob();
          }
        });

        eventSource.addEventListener('job.progressed', (event) => {
          const parsedData = parseSseEventData(event);
          appendSseEvent('job.progressed', parsedData);
          if (isProgressEventData(parsedData)) {
            setIncumbentResult(parsedData);
            if (typeof parsedData.currentBestScore === 'number') {
              setScheduleScore(parsedData.currentBestScore);
            }
            if (typeof parsedData.currentBestScore === 'number' && typeof parsedData.elapsedSeconds === 'number') {
              setProgressPoints(currentPoints => [...currentPoints, {
                currentBestScore: parsedData.currentBestScore as number,
                elapsedSeconds: parsedData.elapsedSeconds as number,
                commentCount: parsedData.commentCount,
                solutionIndex: parsedData.solutionIndex,
                source: parsedData.source,
              }]);
            }
          }
        });

        eventSource.addEventListener('job.phase_changed', (event) => {
          const parsedData = parseSseEventData(event);
          appendSseEvent('job.phase_changed', parsedData);
        });

        eventSource.addEventListener('job.result_available', (event) => {
          const parsedData = parseSseEventData(event);
          appendSseEvent('job.result_available', parsedData);
          finalizeJob();
        });

        eventSource.addEventListener('error', (event) => {
          if ('data' in event && typeof event.data === 'string' && event.data) {
            if (completionStarted) {
              return;
            }
            completionStarted = true;
            eventSource.close();
            const parsedData = parseSseEventData(event as MessageEvent);
            appendSseEvent('error', parsedData);
            reject(new Error('Optimization event stream failed'));
          } else {
            if (completionStarted) {
              return;
            }
            completionStarted = true;
            eventSource.close();
            appendSseEvent('error', 'Optimization event stream disconnected; falling back to polling');
            void pollOptimizeJob(job).then(resolve).catch(reject);
          }
        });
      });
    }

    return pollOptimizeJob(job);
  }, [appendSseEvent, getOptimizeJobStatus, pollOptimizeJob, resolvedOptimizeEndpoint]);

  const handleOptimizeAndDownload = async () => {
    if (isRequiredDataMissing) {
      setErrorMessage(null);
      setSuccessMessage(null);
      setScheduleScore(null);
      setScheduleStatus(null);
      setCurrentJobId(null);
      setCurrentJob(null);
      setIncumbentResult(null);
      setProgressPoints([]);
      clearSavedDownload();
      setSseEvents([]);
      return;
    }

    if (!activeOptimizationOptions) {
      setErrorMessage('Backend optimization options are unavailable.');
      setSuccessMessage(null);
      return;
    }

    const solverChoice = activeOptimizationOptions.solver.choices.find(choice => choice.value === solverArg);
    if (!solverChoice) {
      setErrorMessage('Select a solver supported by the active backend.');
      setSuccessMessage(null);
      return;
    }

    const timeoutOptions = solverChoice.timeout;
    if (
      timeoutArg === '' ||
      typeof timeoutArg !== 'number' ||
      !Number.isInteger(timeoutArg) ||
      timeoutArg < timeoutOptions.minimum ||
      timeoutArg > timeoutOptions.maximum
    ) {
      setTimeoutError(
        `Solver timeout must be an integer between ${timeoutOptions.minimum} and ${timeoutOptions.maximum} seconds.`
      );
      setErrorMessage(null);
      return;
    }

    if (!canUseActiveServer || !resolvedOptimizeEndpoint) {
      setErrorMessage('Backend unavailable. Check that the configured backend is running.');
      setSuccessMessage(null);
      return;
    }

    const runEndpoint = resolvedOptimizeEndpoint;
    const runSolver = solverArg;
    const runTimeoutSeconds = timeoutArg;
    const runAnonymized = anonymizeScheduleData;

    let anonymizationResult: ReturnType<typeof anonymizeSchedulingStateWithMapping> | null;
    let yamlContent: string;
    try {
      anonymizationResult = runAnonymized
        ? anonymizeSchedulingStateWithMapping(filteredState, {
            anonymizePeopleItems: true,
            anonymizePeopleGroups: false,
            removeDescriptions: true,
          })
        : null;
      yamlContent = generateYamlFromState(
        anonymizationResult?.state ?? filteredState,
        {
          contractedHoursBoundary: runAnonymized
            ? 'anonymized-optimize'
            : 'optimize',
        },
      );
      setContractedHoursDiagnostic(null);
    } catch (error) {
      if (isContractedHoursBoundaryError(error)) {
        setContractedHoursDiagnostic(error.diagnostic);
        setErrorMessage(null);
        return;
      }
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to prepare scheduling data for optimization'
      );
      return;
    }

    setIsOptimizing(true);
    setTimeoutError(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setScheduleScore(null);
    setScheduleStatus(null);
    setCurrentJobId(null);
    setCurrentJob(null);
    setIncumbentResult(null);
    setProgressPoints([]);
    clearSavedDownload();
    setSseEvents([]);

    try {
      // Prepare form data
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([yamlContent], { type: 'application/x-yaml' }),
        'schedule.yaml',
      );

      if (prettifyArg !== null && prettifyArg !== undefined) {
        formData.append('prettify', String(prettifyArg));
      }

      formData.append('timeout', String(runTimeoutSeconds));
      formData.append('solver', runSolver);

      const createResponse = await authorizedFetch(runEndpoint, '/optimize', {
        method: 'POST',
        body: formData,
      });

      if (!createResponse.ok) {
        throw new Error(await getServerErrorMessage(createResponse));
      }

      const createdJob = await createResponse.json() as OptimizeJobResponse;
      setCurrentJobId(createdJob.id);
      setCurrentJob(createdJob);
      setScheduleStatus(createdJob.state);

      const completedJob = await waitForOptimizeJob(createdJob);
      setCurrentJob(completedJob);
      setScheduleStatus(completedJob.state);

      if (completedJob.result?.score !== null && completedJob.result?.score !== undefined) {
        setScheduleScore(completedJob.result.score);
      }
      if (completedJob.result?.solver_status) {
        setScheduleStatus(completedJob.result.solver_status);
      }

      if (completedJob.error) {
        throw new Error(completedJob.error.message);
      }
      if (!completedJob.links.schedule) {
        throw new Error(`No downloadable schedule is available. Job outcome: ${completedJob.result?.outcome ?? completedJob.state}`);
      }

      const xlsxResponse = await authorizedFetch(runEndpoint, completedJob.links.schedule, {
        method: 'GET',
      });

      if (!xlsxResponse.ok) {
        throw new Error(await getServerErrorMessage(xlsxResponse));
      }

      // Get the blob data (XLSX file)
      const downloadedBlob = await xlsxResponse.blob();
      const blob = anonymizationResult
        ? await restorePeopleIdsInXlsx(
            downloadedBlob,
            anonymizationResult.originalIdByAnonymizedId,
            anonymizationResult.state.people.items.length
          )
        : downloadedBlob;

      const url = URL.createObjectURL(blob);
      const filename = getFilenameFromContentDisposition(xlsxResponse.headers.get('Content-Disposition'));
      savedDownloadUrlRef.current = url;
      setSavedDownload({ url, filename });
      downloadFileFromUrl(url, filename);

      void authorizedFetch(runEndpoint, completedJob.links.self, {
        method: 'DELETE',
      }).catch(() => undefined);

      setSuccessMessage('Schedule optimized and downloaded successfully!');
    } catch (error) {
      console.error('Error during optimization:', error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred during optimization'
      );
    } finally {
      setIsOptimizing(false);
    }
  };

  const requestJobControl = async (action: 'cancel' | 'finish-now') => {
    if (!currentJobId) {
      return;
    }

    try {
      const actionPath = action === 'cancel'
        ? currentJob?.links.cancellation ?? `/optimize/${currentJobId}/cancel`
        : currentJob?.links.early_completion ?? `/optimize/${currentJobId}/finish-now`;
      const response = await authorizedFetch(resolvedOptimizeEndpoint, actionPath, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(await getServerErrorMessage(response));
      }

      const updatedJob = await response.json() as OptimizeJobResponse;
      setCurrentJob(updatedJob);
      setScheduleStatus(updatedJob.state);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : `Unable to ${action === 'cancel' ? 'cancel optimization' : 'request current results'}`
      );
    }
  };

  const handleDownloadAgain = () => {
    if (!savedDownload) {
      return;
    }
    downloadFileFromUrl(savedDownload.url, savedDownload.filename);
  };

  const applyServerToken = (token: string | null, rememberToken: boolean) => {
    setServer(currentServer => ({ ...currentServer, token, rememberToken, status: 'unchecked', error: null }));
    persistServerToken(token, rememberToken);
    setEditingToken(false);
    startServerCheck(token);
  };

  const activeJobs = activeServerHealth?.jobs
    ? activeServerHealth.jobs.running + activeServerHealth.jobs.cancelling
    : null;
  const onlineWorkers = activeServerHealth?.workers?.online ?? null;
  const showCredentials = server.authRequired || server.token !== null;
  const serverStatusHoverText = describeServerStatus(activeServerStatus, server);
  const serverStatusText = activeServerStatus === 'unauthorized'
    ? formatCredentialStatus(isCredentialRejection(server))
    : formatServerStatus(activeServerStatus);

  const serverStatusClasses = activeServerStatus === 'online'
    ? 'border-green-200 bg-green-50 text-green-700'
    : activeServerStatus === 'offline'
      ? 'border-red-200 bg-red-50 text-red-700'
      : activeServerStatus === 'incompatible' || activeServerStatus === 'degraded' || activeServerStatus === 'unauthorized'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-gray-200 bg-gray-50 text-gray-600';
  const serverStatusLabel = formatServerStatus(activeServerStatus);

  const runStatus = scheduleStatus
    ? formatRunStatus(scheduleStatus, currentJob?.queue_position)
    : isOptimizing
      ? 'Starting'
      : 'Idle';
  const runStatusClasses = isOptimizing
    ? 'bg-blue-50 text-blue-700 ring-blue-200'
    : errorMessage
      ? 'bg-red-50 text-red-700 ring-red-200'
      : successMessage
        ? 'bg-green-50 text-green-700 ring-green-200'
        : 'bg-gray-50 text-gray-700 ring-gray-200';

  return (
    <div className="container mx-auto px-4 py-6 lg:py-8">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">Optimize and Export</h1>
            <PageDocumentationLink
              href={DOCUMENTATION_URLS.optimizeAndExport}
              label="Optimize and Export"
            />
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Send the current schedule configuration to the backend and download the generated XLSX result.
          </p>
        </div>

        <div className="flex items-center gap-2">
        <div
          aria-label={`${resolvedOptimizeEndpoint} status: ${serverStatusText}`}
          title={serverStatusHoverText}
          className={`inline-flex items-center gap-2.5 rounded-md border px-3 py-2 ${serverStatusClasses}`}
        >
          <span className="shrink-0">
            {activeServerStatus === 'offline' ? (
              <FiWifiOff className="h-4 w-4" />
            ) : activeServerStatus === 'unauthorized' ? (
              <FiLock className="h-4 w-4" />
            ) : activeServerStatus === 'degraded' ? (
              <FiAlertCircle className="h-4 w-4" />
            ) : activeServerStatus === 'checking' ? (
              <FiLoader className="h-4 w-4 animate-spin" />
            ) : activeServerStatus === 'incompatible' ? (
              <FiAlertTriangle className="h-4 w-4" />
            ) : (
              <FiWifi className="h-4 w-4" />
            )}
          </span>
          <span>
            <span className="block text-sm font-medium">
              Server: {serverStatusLabel}
            </span>
            <span className="mt-0.5 block max-w-72 truncate text-xs opacity-75">
              {resolvedOptimizeEndpoint || 'No backend'}
            </span>
          </span>
        </div>
          <button
            type="button"
            onClick={recheckServer}
            disabled={isOptimizing}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            title="Re-check backend status"
            aria-label="Re-check backend status"
          >
            <FiRefreshCw className={`h-3.5 w-3.5 ${activeServerStatus === 'checking' ? 'animate-spin' : ''}`} />
            Re-check
          </button>
        </div>
      </div>

      {isRequiredDataMissing && (
        <div className="mb-5">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {isDateDataMissing ? (
              <>
                Please set up your dates first by visiting the{' '}
                <Link href="/dates" className="text-blue-600 underline hover:text-blue-800">
                  Dates
                </Link>{' '}
                tab.
              </>
            ) : isPeopleDataMissing ? (
              <>
                Please set up your people first by visiting the{' '}
                <Link href="/people" className="text-blue-600 underline hover:text-blue-800">
                  People
                </Link>{' '}
                tab.
              </>
            ) : (
              <>
                Please set up your shift types first by visiting the{' '}
                <Link href="/shift-types" className="text-blue-600 underline hover:text-blue-800">
                  Shift Types
                </Link>{' '}
                tab.
              </>
            )}
          </div>
        </div>
      )}

      {contractedHoursDiagnostic && (
        <div className="mb-5">
          <ContractedHoursValidationNotice diagnostic={contractedHoursDiagnostic} />
        </div>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(380px,1.05fr)]">
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">Setup and Run</h2>
            <p className="mt-0.5 text-sm text-gray-600">Set run options, then optimize.</p>
          </div>
          <div className="space-y-5 p-5">
            <div className="space-y-3">
              <div className="rounded-md border border-gray-200 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">Backend</p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      Last checked: {formatCheckedTime(server.lastCheckedAt)}
                      {server.pingMs !== null ? ` · ${server.pingMs} ms` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm font-normal">
                    {activeServerStatus === 'offline' ? (
                      <span className="text-red-600">Not responding</span>
                    ) : activeServerStatus === 'checking' && !activeServerHealth ? (
                      <span className="text-gray-500">Checking...</span>
                    ) : activeJobs === null || onlineWorkers === null ? (
                      <span className="text-gray-500">
                        {activeServerStatus === 'unchecked' ? 'Not checked' : 'Activity unavailable'}
                      </span>
                    ) : (
                      <>
                        <span className="block text-gray-800">
                          {activeJobs} active · {activeServerHealth?.jobs?.queued} queued
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          {onlineWorkers} {onlineWorkers === 1 ? 'worker' : 'workers'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {showCredentials && (
                  <div className="mt-2">
                    <BackendTokenField
                      endpoint={server.endpoint}
                      token={server.token}
                      rememberToken={server.rememberToken}
                      isEditing={editingToken}
                      disabled={isOptimizing}
                      onEdit={() => setEditingToken(true)}
                      onCancel={() => setEditingToken(false)}
                      onSave={(token, rememberToken) => applyServerToken(token, rememberToken)}
                      onClear={() => applyServerToken(null, false)}
                    />
                  </div>
                )}
              </div>

              {(activeServerHealth || activeServerStatus === 'incompatible') && (
                <div className="space-y-2">
                  <div className={`rounded-md border px-3 py-2 text-xs ${activeServerStatus === 'incompatible' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                    {activeServerHealth && (
                      <p>
                        API version: {activeServerHealth.api_version}
                        {activeServerStatus === 'incompatible' && activeServerHealth.api_version !== SUPPORTED_BACKEND_API_VERSION
                          ? ` (expected ${SUPPORTED_BACKEND_API_VERSION})`
                          : ''}
                        {' · '}Frontend version: {CURRENT_APP_VERSION} · Backend version: {activeServerHealth.app_version}
                      </p>
                    )}
                    {activeClaimedPerformance && (
                      <p className="mt-1">
                        Claimed performance: {formatScore(activeClaimedPerformance.score)}
                      </p>
                    )}
                    {activeServerStatus === 'incompatible' ? (
                        <>
                          {!activeServerHealth && <p>Server information: invalid</p>}
                          {activeServerHealth?.service_name !== EXPECTED_BACKEND_SERVICE_NAME && (
                            <p className="mt-1">
                              Service: {activeServerHealth?.service_name ?? 'missing'} (expected {EXPECTED_BACKEND_SERVICE_NAME})
                            </p>
                          )}
                          {activeServerHealth?.status !== 'ready' && (
                            <p className="mt-1">
                              Status: {activeServerHealth?.status ?? 'missing'} (expected ready)
                            </p>
                          )}
                          <p className="mt-1 font-medium">Incompatible backend. The request may fail.</p>
                        </>
                    ) : hasVersionMismatch && (
                      <p className="mt-1 font-medium text-amber-700">
                        Frontend and backend versions do not match. If nothing breaks, you can continue.
                      </p>
                    )}
                  </div>
                </div>
              )}
              {activeServerStatus === 'degraded' && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <div className="flex gap-2">
                    <FiAlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{server.error ?? 'Optimization options are unavailable.'}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-gray-200 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Run options</h3>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex min-h-20 cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                  <input
                    type="checkbox"
                    checked={prettifyArg}
                    onChange={(e) => setPrettifyArg(e.target.checked)}
                    disabled={!activeOptimizationOptions}
                    className="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-800">Prettify XLSX</span>
                    <span className="mt-1 block text-xs text-gray-500">Apply formatting to the generated workbook.</span>
                  </span>
                </label>

                <label className="flex min-h-20 cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                  <input
                    type="checkbox"
                    checked={anonymizeScheduleData}
                    onChange={(e) => setAnonymizeScheduleData(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-800">Anonymize schedule data</span>
                    <span className="mt-1 block text-xs text-gray-500">Anonymize people IDs and remove descriptions before sending to the backend.</span>
                  </span>
                </label>

                <div>
                  <label htmlFor="solver-select" className="block text-sm font-medium text-gray-700 mb-2">
                    Solver
                  </label>
                  <select
                    id="solver-select"
                    value={activeOptimizationOptions ? solverArg : ''}
                    onChange={(event) => {
                      const nextSolver = event.target.value;
                      const timeout = activeOptimizationOptions?.solver.choices.find(
                        choice => choice.value === nextSolver
                      )?.timeout;
                      setSolverArg(nextSolver);
                      setTimeoutError(null);
                      if (timeout) {
                        setTimeoutArg(current => (
                          typeof current === 'number' &&
                          current >= timeout.minimum &&
                          current <= timeout.maximum
                            ? current
                            : timeout.default
                        ));
                      }
                    }}
                    disabled={!activeOptimizationOptions}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    {!activeOptimizationOptions && <option value="">Waiting for backend options</option>}
                    {activeOptimizationOptions?.solver.choices.map(choice => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label} ({choice.compute.toUpperCase()})
                      </option>
                    ))}
                  </select>
                  {selectedSolverChoice && (
                    <p className="mt-2 text-xs text-gray-500">
                      Running controls: {[
                        selectedSolverChoice.controls.cancel_running ? 'Cancel' : null,
                        selectedSolverChoice.controls.finish_now ? 'Finish now' : null,
                      ].filter(Boolean).join(', ') || 'None'}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="solver-timeout" className="block text-sm font-medium text-gray-700 mb-2">
                    Solver Timeout
                  </label>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      id="solver-timeout"
                      value={timeoutArg}
                      onChange={(e) => {
                        const value = e.target.value;
                        setTimeoutError(null);
                        setTimeoutArg(value === '' ? '' : (Number.isInteger(Number(value)) ? Number(value) : value));
                      }}
                      min={selectedSolverChoice?.timeout.minimum}
                      max={selectedSolverChoice?.timeout.maximum}
                      disabled={!selectedSolverChoice}
                      className={`block w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                        timeoutError
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                          : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'
                      }`}
                      placeholder={selectedSolverChoice ? String(selectedSolverChoice.timeout.default) : ''}
                    />
                    <span className="text-sm text-gray-500">sec</span>
                  </div>
                  {timeoutError && (
                    <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                      <FiAlertCircle className="h-4 w-4" />
                      {timeoutError}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-5">
              <button
                onClick={handleOptimizeAndDownload}
                disabled={isOptimizeDisabled}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  isOptimizeDisabled
                    ? 'cursor-not-allowed bg-gray-400 text-white'
                    : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
                }`}
              >
                {isOptimizing ? (
                  <>
                    <FiLoader className="h-5 w-5 animate-spin" />
                    Optimizing...
                  </>
                ) : (
                  <>
                    <FiDownload className="h-5 w-5" />
                    {isIncompatibleServer ? 'Optimize Anyway and Download' : 'Optimize and Download'}
                  </>
                )}
              </button>
              {optimizeDisabledReason && (
                <p className="mt-2 text-sm text-amber-700">{optimizeDisabledReason}</p>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Submitting sends scheduling data to the configured backend.{' '}
                <a
                  href={GITHUB_PRIVACY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline hover:text-blue-800"
                >
                  Privacy Policy
                </a>.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">Live Result</h2>
            <p className="mt-0.5 text-sm text-gray-600">Current job, incumbent score, and downloadable file.</p>
          </div>
          <div className="space-y-4 p-5">
            <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">
                  {isOptimizing ? 'Live Incumbent Score' : scheduleScore !== null ? 'Final Score' : 'Score'}
                </p>
                <p className="mt-1 text-4xl font-bold text-gray-900">
                  {scheduleScore !== null ? formatScore(scheduleScore) : 'No incumbent yet'}
                </p>
                <p className="mt-1 text-xs text-gray-500">Higher scores are better.</p>
              </div>
              <span className={`inline-flex w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ring-1 ${runStatusClasses}`}>
                {isOptimizing ? <FiLoader className="h-4 w-4 animate-spin" /> : successMessage ? <FiCheckCircle className="h-4 w-4" /> : errorMessage ? <FiAlertCircle className="h-4 w-4" /> : <FiActivity className="h-4 w-4" />}
                {runStatus}
              </span>
            </div>

            <div className="text-sm text-gray-600">
              {!currentJobId ? (
                <p>No optimization has been started.</p>
              ) : isOptimizing && scheduleStatus === 'queued' ? (
                <p>
                  {currentJob?.queue_position
                    ? `Waiting in optimization queue at position ${currentJob.queue_position}.`
                    : 'Waiting in optimization queue.'}
                </p>
              ) : isOptimizing && !incumbentResult ? (
                <p>Waiting for first feasible solution...</p>
              ) : incumbentResult ? (
                <p>
                  {incumbentResult.solutionIndex !== undefined && incumbentResult.solutionIndex !== null ? `Solution #${incumbentResult.solutionIndex}` : 'Incumbent'}
                  {' · '}
                  {incumbentResult.elapsedSeconds !== undefined ? formatElapsedSeconds(incumbentResult.elapsedSeconds) : 'time unavailable'}
                  {' · '}
                  {incumbentResult.commentCount !== undefined && incumbentResult.commentCount !== null ? `${incumbentResult.commentCount} comments` : 'comments unavailable'}
                  {incumbentResult.source ? ` · ${incumbentResult.source}` : ''}
                </p>
              ) : (
                <p>Job {currentJobId}</p>
              )}
              {currentJobId && <p className="mt-1 break-all text-xs text-gray-400">Job ID: {currentJobId}</p>}
            </div>

            {progressPoints.length >= 2 && (
              <OptimizationProgressChart points={progressPoints} isActive={isJobActive} />
            )}

            {(savedDownload || isJobActive) && (
              <div className={`flex flex-col gap-2 sm:flex-row ${isJobActive ? 'sticky bottom-3 z-10 rounded-lg border border-blue-100 bg-white/95 p-2 shadow-lg backdrop-blur-sm' : ''}`}>
                {savedDownload && (
                  <button
                    type="button"
                    onClick={handleDownloadAgain}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                  >
                    <FiDownload className="h-4 w-4" />
                    Download Again
                    <span className="truncate text-xs font-normal text-green-600">{savedDownload.filename}</span>
                  </button>
                )}

                {isJobActive && (
                  <>
                    <button
                      type="button"
                      onClick={() => void requestJobControl('finish-now')}
                      disabled={!currentJob?.controls.early_completion_available || isCancelling}
                      title="Finish with the current incumbent result"
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                    >
                      <FiDownload className="h-4 w-4" />
                      Get Results Now
                    </button>
                    <button
                      type="button"
                      onClick={() => void requestJobControl('cancel')}
                      disabled={!currentJob?.controls.cancellable || isCancelling}
                      title="Stop the active optimization job"
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                    >
                      <FiAlertCircle className="h-4 w-4" />
                      {isCancelling ? 'Cancelling...' : 'Cancel'}
                    </button>
                  </>
                )}
              </div>
            )}

            {successMessage && (
              <div className="space-y-2">
                <div className="flex gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                  <FiCheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{successMessage}</span>
                </div>
                <StarRepoNudge />
              </div>
            )}

            {errorMessage && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <div className="flex gap-2">
                  <FiAlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{errorMessage}</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <details open={isOptimizing || Boolean(errorMessage) || !successMessage} className="rounded-lg border border-gray-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-gray-200 px-5 py-4">
          <FiActivity className="h-4 w-4 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-900">Optimization Events</h2>
          <span className="ml-auto text-xs text-gray-500">{sseEvents.length} events</span>
        </summary>
        <div ref={eventLogRef} data-testid="optimization-events-log" className="max-h-[28rem] overflow-auto bg-gray-50">
          {sseEvents.length === 0 ? (
            <div className="px-5 py-6 text-sm text-gray-500">
              <p>{isOptimizing ? 'Waiting for optimization events...' : 'No optimization events yet.'}</p>
            </div>
          ) : (
            <ul className="space-y-0 p-5">
              {sseEvents.map((event, index) => (
                <li key={`${event.type}-${index}`} className="relative grid gap-3 border-l border-gray-200 pb-5 pl-5 last:pb-0 lg:grid-cols-[10rem_minmax(0,1fr)]">
                  <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-white ring-4 ring-gray-200" />
                  <div className="flex flex-row items-baseline gap-3 lg:flex-col lg:gap-1">
                    <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold uppercase ring-1 ${getEventBadgeClasses(event.type)}`}>{event.type}</span>
                    <span className="text-xs text-gray-500">{formatCheckedTime(event.receivedAt)}</span>
                  </div>
                  <div className="min-w-0 rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
                    {isProgressEventData(event.data) && (
                      <p className="font-semibold text-gray-900">{formatProgressSummary(event.data)}</p>
                    )}
                    {event.type === 'job.phase_changed' && isPhaseEventData(event.data) && event.data.message && (
                      <p className="font-semibold text-gray-900">{event.data.message}</p>
                    )}
                    <details className={isProgressEventData(event.data) || event.type === 'job.phase_changed' ? 'mt-2' : ''}>
                      <summary className="cursor-pointer text-gray-500">Raw event data</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words">{formatSseEventData(event.data)}</pre>
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

    </div>
  );
}
