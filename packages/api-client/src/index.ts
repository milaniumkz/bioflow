import type { ApiPage, InventoryMovementType, MaterialState, WaybillStatus } from "@bioflow/shared-types";

export interface PageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  status?: string;
  state?: string;
}

export interface DateRangeQuery {
  dateFrom?: string;
  dateTo?: string;
}

export interface LoginRequest {
  email?: string;
  phone?: string;
  password: string;
  platform?: string;
  deviceName?: string;
  pushToken?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface DashboardOverview {
  waybills: number;
  activeWaybills: number;
  balances: unknown[];
  recentMovements: unknown[];
  discrepancies: number;
}

export interface WaybillCreateRequest {
  counterpartyId: string;
  extractionSiteId: string;
  vehicleId: string;
  driverId: string;
  destinationWarehouseId: string;
  materialTypeId: string;
  declaredWeight: string;
}

export interface WaybillAcceptRequest {
  warehouseId: string;
  actualWeight: string;
  idempotencyKey: string;
  reason?: string;
}

export interface InventoryCorrectionRequest {
  warehouseId: string;
  materialTypeId?: string;
  productTypeId?: string;
  state: MaterialState;
  delta: string;
  reason: string;
}

export interface OperationRequest {
  warehouseId: string;
  productTypeId?: string;
  inputWeight: string;
  outputWeight: string;
  wasteWeight: string;
  lossWeight: string;
}

export interface ReportResponse<T = unknown> {
  type: string;
  generatedAt: string;
  userId: string;
  filters: Record<string, unknown>;
  rows: T[];
}

export class BioflowApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken?: () => string | undefined
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken?.();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  login(body: LoginRequest) {
    return this.request<AuthTokens>("/auth/login", post(body));
  }

  refresh(refreshToken: string) {
    return this.request<AuthTokens>("/auth/refresh", post({ refreshToken }));
  }

  me<T = unknown>() {
    return this.request<T>("/auth/me");
  }

  dashboard(query: DateRangeQuery = {}) {
    return this.request<DashboardOverview>(withQuery("/dashboard", query));
  }

  list<T = unknown>(resource: string, query: PageQuery = {}) {
    return this.request<ApiPage<T>>(withQuery(`/${resource.replace(/^\/+/, "")}`, query));
  }

  reference<T = unknown>(resource: string, query: PageQuery = {}) {
    return this.list<T>(resource, query);
  }

  createWaybill(body: WaybillCreateRequest) {
    return this.request<{ id: string; number: string; qrToken: string; status: WaybillStatus }>("/waybills", post(body));
  }

  resolveQr(token: string) {
    return this.request<unknown>("/qr/resolve", post({ token }));
  }

  acceptWaybill(id: string, body: WaybillAcceptRequest) {
    return this.request<unknown>(`/waybills/${id}/accept`, post(body));
  }

  updateWaybillStatus(id: string, status: WaybillStatus, reason?: string) {
    return this.request<unknown>(`/waybills/${id}/status`, post({ status, reason }));
  }

  inventoryMovements(query: PageQuery & { status?: InventoryMovementType } = {}) {
    return this.request<ApiPage<unknown>>(withQuery("/inventory/movements", query));
  }

  createInventoryCorrection(body: InventoryCorrectionRequest) {
    return this.request<unknown>("/inventory/corrections", post(body));
  }

  createWashingBatch(body: OperationRequest) {
    return this.request<unknown>("/washing-batches", post(body));
  }

  createProductionBatch(body: OperationRequest) {
    return this.request<unknown>("/production-batches", post(body));
  }

  report<T = unknown>(type: string, query: DateRangeQuery = {}) {
    return this.request<ReportResponse<T>>(withQuery("/reports", { type, ...query }));
  }

  exportReportUrl(type: string, format: "csv" | "xlsx" | "pdf", query: DateRangeQuery = {}) {
    return `${this.baseUrl}${withQuery("/reports/export", { type, format, ...query })}`;
  }
}

function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

function withQuery(path: string, query: object) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}
