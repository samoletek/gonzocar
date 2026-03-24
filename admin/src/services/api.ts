const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

interface LoginCredentials {
    email: string;
    password: string;
}

interface TokenResponse {
    access_token: string;
    token_type: string;
}

class ApiService {
    private token: string | null = null;

    constructor() {
        this.token = localStorage.getItem("token");
    }

    private headers(includeAuth: boolean = true): HeadersInit {
        const headers: HeadersInit = {
            "Content-Type": "application/json",
        };
        if (includeAuth && this.token) {
            headers["Authorization"] = `Bearer ${this.token}`;
        }
        return headers;
    }

    setToken(token: string | null) {
        this.token = token;
        if (token) {
            localStorage.setItem("token", token);
        } else {
            localStorage.removeItem("token");
        }
    }

    getToken(): string | null {
        return this.token;
    }

    private async parseError(response: Response, fallback: string): Promise<Error> {
        let message = fallback;
        try {
            const data = await response.json();
            if (typeof data?.detail === "string") {
                message = data.detail;
            } else if (typeof data?.message === "string") {
                message = data.message;
            } else if (typeof data?.error === "string") {
                message = data.error;
            }
        } catch {
            // keep fallback
        }
        return new Error(message);
    }

    async login(credentials: LoginCredentials): Promise<TokenResponse> {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
        });
        if (!response.ok) throw new Error("Login failed");
        const data = await response.json();
        this.setToken(data.access_token);
        return data;
    }

    logout() {
        this.setToken(null);
    }

    async me() {
        const response = await fetch(`${API_URL}/auth/me`, { headers: this.headers() });
        if (!response.ok) throw new Error("Not authenticated");
        return response.json();
    }

    // Drivers
    async getDrivers() {
        const response = await fetch(`${API_URL}/drivers`, { headers: this.headers() });
        if (!response.ok) throw await this.parseError(response, "Failed to fetch drivers");
        return response.json();
    }

    async createDriver(data: {
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        billing_type: string;
        billing_rate: number;
        billing_status?: string;
        deposit_required?: number;
        deposit_posted?: number;
        deposit_updated_at?: string | null;
    }) {
        const response = await fetch(`${API_URL}/drivers`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(data),
        });
        if (!response.ok) throw await this.parseError(response, "Failed to create driver");
        return response.json();
    }

    async getDriver(id: string) {
        const response = await fetch(`${API_URL}/drivers/${id}`, { headers: this.headers() });
        if (!response.ok) throw new Error("Failed to fetch driver");
        return response.json();
    }

    async updateDriver(id: string, data: Record<string, unknown>) {
        const response = await fetch(`${API_URL}/drivers/${id}`, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error("Failed to update driver");
        return response.json();
    }

    async getDriverLedger(id: string) {
        const response = await fetch(`${API_URL}/drivers/${id}/ledger`, { headers: this.headers() });
        if (!response.ok) throw new Error("Failed to fetch ledger");
        return response.json();
    }

    async createManualLedgerEntry(
        driverId: string,
        data: {
            entry_type: "charge" | "credit";
            amount: number;
            date?: string;
            notes?: string;
            acknowledge_overlap?: boolean;
        }
    ) {
        const response = await fetch(`${API_URL}/drivers/${driverId}/ledger/manual`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const err = new Error("Failed to create manual ledger entry");
            (err as Error & { status?: number; data?: unknown }).status = response.status;
            (err as Error & { status?: number; data?: unknown }).data = errorData;
            throw err;
        }
        return response.json();
    }

    async cancelLedgerEntry(driverId: string, ledgerId: string, reason?: string) {
        const response = await fetch(`${API_URL}/drivers/${driverId}/ledger/${ledgerId}/cancel`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ reason }),
        });
        if (!response.ok) throw new Error("Failed to cancel ledger entry");
        return response.json();
    }

    async getDriverAliases(id: string) {
        const response = await fetch(`${API_URL}/drivers/${id}/aliases`, { headers: this.headers() });
        if (!response.ok) throw new Error("Failed to fetch aliases");
        return response.json();
    }

    async createDriverAlias(
        driverId: string,
        data: {
            alias_type: string;
            alias_value: string;
        }
    ) {
        const response = await fetch(`${API_URL}/drivers/${driverId}/aliases`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error("Failed to create alias");
        return response.json();
    }

    async deleteDriverAlias(driverId: string, aliasId: string) {
        const response = await fetch(`${API_URL}/drivers/${driverId}/aliases/${aliasId}`, {
            method: "DELETE",
            headers: this.headers(),
        });
        if (!response.ok) throw new Error("Failed to delete alias");
    }

    async updateDriverBilling(id: string, active: boolean) {
        const response = await fetch(`${API_URL}/drivers/${id}/billing`, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify({ billing_active: active }),
        });
        if (!response.ok) throw new Error("Failed to update billing");
        return response.json();
    }

    async updateDriverBillingStatus(id: string, status: "active" | "paused" | "terminated") {
        const response = await fetch(`${API_URL}/drivers/${id}/billing-status`, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify({ status }),
        });
        if (!response.ok) throw new Error("Failed to update billing status");
        return response.json();
    }

    async getDriverPortalLink(id: string) {
        const response = await fetch(`${API_URL}/drivers/${id}/portal-link`, { headers: this.headers() });
        if (!response.ok) throw new Error("Failed to fetch portal link");
        return response.json();
    }

    async getPublicDriverPortal(token: string) {
        const response = await fetch(`${API_URL}/drivers/public/${token}`, {
            headers: this.headers(false),
        });
        if (!response.ok) throw new Error("Failed to fetch driver portal");
        return response.json();
    }

    async getDriverVehicleAssignments(driverId: string) {
        const response = await fetch(`${API_URL}/drivers/${driverId}/vehicle-assignments`, {
            headers: this.headers(),
        });
        if (!response.ok) throw new Error("Failed to fetch vehicle assignments");
        return response.json();
    }

    async createVehicleAssignment(data: {
        driver_id: string;
        license_plate: string;
        start_at?: string;
        end_at?: string;
        previous_assignment_id?: string;
        acknowledge_overlap?: boolean;
    }) {
        const response = await fetch(`${API_URL}/drivers/vehicle-assignments`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const err = new Error("Failed to create vehicle assignment");
            (err as Error & { status?: number; data?: unknown }).status = response.status;
            (err as Error & { status?: number; data?: unknown }).data = errorData;
            throw err;
        }
        return response.json();
    }

    async updateVehicleAssignment(
        assignmentId: string,
        data: {
            license_plate?: string;
            start_at?: string;
            end_at?: string;
            acknowledge_overlap?: boolean;
        }
    ) {
        const response = await fetch(`${API_URL}/drivers/vehicle-assignments/${assignmentId}`, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const err = new Error("Failed to update vehicle assignment");
            (err as Error & { status?: number; data?: unknown }).status = response.status;
            (err as Error & { status?: number; data?: unknown }).data = errorData;
            throw err;
        }
        return response.json();
    }

    async searchVehicleAssignments(params: { license_plate?: string; driver_name?: string }) {
        const query = new URLSearchParams();
        if (params.license_plate) query.set("license_plate", params.license_plate);
        if (params.driver_name) query.set("driver_name", params.driver_name);

        const response = await fetch(`${API_URL}/drivers/vehicle-assignments/search?${query.toString()}`, {
            headers: this.headers(),
        });
        if (!response.ok) throw new Error("Failed to search assignments");
        return response.json();
    }

    async swapVehicle(
        driverId: string,
        data: {
            new_license_plate: string;
            start_at?: string;
            acknowledge_overlap?: boolean;
        }
    ) {
        const response = await fetch(`${API_URL}/drivers/${driverId}/swap-vehicle`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const err = new Error("Failed to swap vehicle");
            (err as Error & { status?: number; data?: unknown }).status = response.status;
            (err as Error & { status?: number; data?: unknown }).data = errorData;
            throw err;
        }
        return response.json();
    }

    // Applications
    async getApplications(statusFilter?: string) {
        const url = statusFilter
            ? `${API_URL}/applications?status_filter=${encodeURIComponent(statusFilter)}`
            : `${API_URL}/applications`;
        const response = await fetch(url, { headers: this.headers() });
        if (!response.ok) throw await this.parseError(response, "Failed to fetch applications");
        return response.json();
    }

    async getApplicationsPage(options?: {
        statusFilter?: string;
        page?: number;
        pageSize?: number;
        excludeLinkedDrivers?: boolean;
    }) {
        const params = new URLSearchParams();
        params.set("include_meta", "true");
        params.set("page", String(options?.page ?? 1));
        params.set("page_size", String(options?.pageSize ?? 20));
        if (options?.statusFilter) {
            params.set("status_filter", options.statusFilter);
        }
        if (options?.excludeLinkedDrivers) {
            params.set("exclude_linked_drivers", "true");
        }

        const response = await fetch(`${API_URL}/applications?${params.toString()}`, {
            headers: this.headers(),
        });
        if (!response.ok) throw await this.parseError(response, "Failed to fetch applications");
        return response.json();
    }

    async backfillApplicationDrivers(limit: number = 200) {
        const response = await fetch(`${API_URL}/applications/reconcile/drivers?limit=${limit}`, {
            method: "POST",
            headers: this.headers(),
        });
        if (!response.ok) throw await this.parseError(response, "Failed to reconcile approved applications");
        return response.json();
    }

    async getApplication(id: string) {
        const response = await fetch(`${API_URL}/applications/${id}`, { headers: this.headers() });
        if (!response.ok) throw await this.parseError(response, "Failed to fetch application");
        return response.json();
    }

    async updateApplicationStatus(id: string, status: string, message?: string) {
        const response = await fetch(`${API_URL}/applications/${id}/status`, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify({ status, message }),
        });
        if (!response.ok) throw await this.parseError(response, "Failed to update status");
        return response.json();
    }

    async addComment(applicationId: string, content: string) {
        const response = await fetch(`${API_URL}/applications/${applicationId}/comment`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ content }),
        });
        if (!response.ok) throw await this.parseError(response, "Failed to add comment");
        return response.json();
    }

    // Payments
    async getUnrecognizedPayments() {
        const response = await fetch(`${API_URL}/payments/unrecognized`, { headers: this.headers() });
        if (!response.ok) throw new Error("Failed to fetch payments");
        return response.json();
    }

    async getPaymentStats(period?: string) {
        const url = period ? `${API_URL}/payments/stats?period=${period}` : `${API_URL}/payments/stats`;
        const response = await fetch(url, { headers: this.headers() });
        if (!response.ok) throw new Error("Failed to fetch stats");
        return response.json();
    }

    async assignPayment(paymentId: string, driverId: string, createAlias: boolean = true) {
        const response = await fetch(`${API_URL}/payments/${paymentId}/assign`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ driver_id: driverId, create_alias: createAlias }),
        });
        if (!response.ok) throw new Error("Failed to assign payment");
        return response.json();
    }

    // System Status
    async getSystemStatus() {
        const response = await fetch(`${API_URL}/status`, { headers: this.headers() });
        if (!response.ok) throw new Error("Failed to fetch status");
        return response.json();
    }

    // SMS
    async sendSms(phone: string, message: string) {
        const response = await fetch(`${API_URL}/sms/send`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ phone, message }),
        });
        if (!response.ok) throw new Error("Failed to send SMS");
        return response.json();
    }
}

export const api = new ApiService();
export default api;
