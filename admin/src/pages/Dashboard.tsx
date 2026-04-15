import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import api from "../services/api";

interface PaymentStats {
    total_payments: number;
    matched_payments: number;
    unmatched_payments: number;
    total_amount: number;
    matched_amount?: number;
}

interface PaymentRecord {
    id: string;
    source: string;
    amount: number;
    sender_name: string | null;
    memo: string | null;
    received_at: string;
    matched: boolean;
    driver_id: string | null;
}

interface ApplicationRecord {
    id: string;
    status: string;
    form_data: Record<string, unknown>;
    created_at: string;
}

interface ApplicationsPagePayload {
    items: ApplicationRecord[];
    counts: Record<string, number>;
}

interface DriverRecord {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    balance: number;
    billing_type?: string;
    billing_rate?: number;
    billing_status?: string;
    billing_active?: boolean;
    weekly_due_day?: string | null;
}

interface DriversPagePayload {
    items: DriverRecord[];
    total: number;
    total_pages?: number;
    active_count: number;
    balance_total: number;
}

interface SystemStatusItem {
    status: "ok" | "warning" | "error";
    message: string;
}

interface SystemStatus {
    database: SystemStatusItem;
    gmail: SystemStatusItem;
    openphone: SystemStatusItem;
}

const DEFAULT_COUNTS: Record<string, number> = {
    all: 0,
    pending: 0,
    approved: 0,
    declined: 0,
    hold: 0,
    onboarding: 0,
};

const SOURCE_ACCENTS: Record<string, string> = {
    zelle: "#315FB9",
    cashapp: "#1C8F49",
    venmo: "#1D5CB6",
    chime: "#1A8D7D",
    stripe: "#6A4ACF",
    unknown: "#667A99",
};

const WEEKDAY_ORDER = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
] as const;

const CHICAGO_TIMEZONE = "America/Chicago";
const METRIC_VALUE_STYLE: CSSProperties = {
    fontFamily: "var(--font-heading)",
    fontVariantNumeric: "tabular-nums",
    fontFeatureSettings: '"tnum" 1',
    letterSpacing: "0.01em",
};

function toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number): string {
    return `$${value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function formatPercent(value: number): string {
    return `${Math.round(value)}%`;
}

function getStatus(status?: string, active?: boolean): "active" | "paused" | "terminated" {
    const normalized = (status || "").toLowerCase();
    if (normalized === "active" || normalized === "paused" || normalized === "terminated") {
        return normalized;
    }
    return active === false ? "paused" : "active";
}

function getTzDayKey(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value || "0000";
    const month = parts.find((part) => part.type === "month")?.value || "01";
    const day = parts.find((part) => part.type === "day")?.value || "01";

    return `${year}-${month}-${day}`;
}

function getApplicantName(application: ApplicationRecord): string {
    const form = application.form_data || {};
    const first = typeof form.first_name === "string" ? form.first_name : "";
    const last = typeof form.last_name === "string" ? form.last_name : "";
    const direct = `${first} ${last}`.trim();
    if (direct) return direct;

    for (const [key, value] of Object.entries(form)) {
        if (!key.toLowerCase().includes("name") || typeof value !== "object" || value === null) continue;
        const nested = value as Record<string, unknown>;
        const nestedFirst =
            (typeof nested.first_name === "string" && nested.first_name) ||
            (typeof nested.First_Name === "string" && nested.First_Name) ||
            (typeof nested.first === "string" && nested.first) ||
            "";
        const nestedLast =
            (typeof nested.last_name === "string" && nested.last_name) ||
            (typeof nested.Last_Name === "string" && nested.Last_Name) ||
            (typeof nested.last === "string" && nested.last) ||
            "";
        const nestedName = `${nestedFirst} ${nestedLast}`.trim();
        if (nestedName) return nestedName;
    }

    if (typeof form.email === "string" && form.email.trim()) return form.email;
    return "Unknown Applicant";
}

function getDriverName(driver: DriverRecord): string {
    const fullName = `${driver.first_name || ""} ${driver.last_name || ""}`.trim();
    return fullName || driver.email || "Unknown Driver";
}

async function fetchAllPayments(): Promise<PaymentRecord[]> {
    const pageSize = 500;
    const maxPages = 12;
    const allPayments: PaymentRecord[] = [];

    for (let page = 0; page < maxPages; page += 1) {
        const batch = await api.getAllPayments(page * pageSize, pageSize);
        if (!Array.isArray(batch) || batch.length === 0) {
            break;
        }
        allPayments.push(...(batch as PaymentRecord[]));
        if (batch.length < pageSize) {
            break;
        }
    }

    return allPayments;
}

async function fetchAllDrivers(): Promise<{ snapshot: DriversPagePayload; items: DriverRecord[] }> {
    const firstPage = (await api.getDriversPage({ page: 1, pageSize: 50 })) as DriversPagePayload;
    const totalPages = Math.max(1, toNumber(firstPage.total_pages || 1));
    const allDrivers: DriverRecord[] = [...(firstPage.items || [])];

    if (totalPages > 1) {
        const jobs: Promise<unknown>[] = [];
        for (let page = 2; page <= totalPages; page += 1) {
            jobs.push(api.getDriversPage({ page, pageSize: 50 }));
        }
        const pages = await Promise.all(jobs);
        for (const payload of pages as DriversPagePayload[]) {
            if (Array.isArray(payload.items)) {
                allDrivers.push(...payload.items);
            }
        }
    }

    return { snapshot: firstPage, items: allDrivers };
}

function StatusPill({ item }: { item: SystemStatusItem | undefined }) {
    if (!item) {
        return (
            <span style={{ fontSize: "0.72rem", color: "#7B8AA0", fontWeight: 600, fontFamily: "var(--font-body)" }}>
                N/A
            </span>
        );
    }

    const tone =
        item.status === "ok"
            ? { bg: "#E8F6EE", color: "#1D7A46" }
            : item.status === "warning"
              ? { bg: "#FEF6E4", color: "#9B6900" }
              : { bg: "#FDEDEE", color: "#A42C36" };

    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                borderRadius: "999px",
                background: tone.bg,
                color: tone.color,
                fontSize: "0.72rem",
                fontWeight: 700,
                textTransform: "capitalize",
                fontFamily: "var(--font-body)",
            }}
        >
            <span style={{ width: "6px", height: "6px", borderRadius: "999px", background: tone.color }} />
            {item.status}
        </span>
    );
}

function Panel({
    title,
    subtitle,
    action,
    children,
}: {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section
            style={{
                background: "linear-gradient(180deg, #FFFFFF 0%, #FBFCFF 100%)",
                border: "1px solid #E1E8F2",
                borderRadius: "20px",
                boxShadow: "0 14px 30px rgba(21, 37, 58, 0.06)",
                padding: "16px",
                minWidth: 0,
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "12px" }}>
                <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1.05rem", color: "#1D2734", lineHeight: 1.1 }}>{title}</h3>
                    {subtitle && (
                        <p style={{ marginTop: "5px", fontFamily: "var(--font-body)", fontSize: "0.8rem", color: "#6E7E95" }}>{subtitle}</p>
                    )}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

function KpiTile({
    label,
    value,
    hint,
    accent,
}: {
    label: string;
    value: string;
    hint?: string;
    accent?: string;
}) {
    return (
        <div
            style={{
                background: "#FFFFFF",
                border: "1px solid #E4EAF3",
                borderRadius: "16px",
                padding: "14px",
                position: "relative",
                overflow: "hidden",
                minWidth: 0,
            }}
        >
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: accent || "#274B7A" }} />
            <div style={{ fontFamily: "var(--font-body)", fontSize: "0.72rem", color: "#6D7D95", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {label}
            </div>
            <div
                style={{
                    ...METRIC_VALUE_STYLE,
                    marginTop: "6px",
                    fontSize: "1.65rem",
                    color: "#1D2735",
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                {value}
            </div>
            {hint && <div style={{ marginTop: "5px", fontFamily: "var(--font-body)", fontSize: "0.78rem", color: "#75859B" }}>{hint}</div>}
        </div>
    );
}

export default function Dashboard() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [paymentStats, setPaymentStats] = useState<PaymentStats | null>(null);
    const [weeklyPaymentStats, setWeeklyPaymentStats] = useState<PaymentStats | null>(null);
    const [payments, setPayments] = useState<PaymentRecord[]>([]);

    const [driversPage, setDriversPage] = useState<DriversPagePayload | null>(null);
    const [drivers, setDrivers] = useState<DriverRecord[]>([]);

    const [pendingApplications, setPendingApplications] = useState<ApplicationRecord[]>([]);
    const [applicationCounts, setApplicationCounts] = useState<Record<string, number>>(DEFAULT_COUNTS);

    const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        setError("");

        const [
            paymentStatsRes,
            weeklyPaymentStatsRes,
            paymentsRes,
            driversRes,
            applicationsRes,
            statusRes,
        ] = await Promise.allSettled([
            api.getPaymentStats(),
            api.getPaymentStats("weekly"),
            fetchAllPayments(),
            fetchAllDrivers(),
            api.getApplicationsPage({
                statusFilter: "pending",
                page: 1,
                pageSize: 20,
                excludeLinkedDrivers: true,
            }),
            api.getSystemStatus(),
        ]);

        const hardFailures: string[] = [];

        if (paymentStatsRes.status === "fulfilled") setPaymentStats(paymentStatsRes.value as PaymentStats);
        else hardFailures.push("payments stats");

        if (weeklyPaymentStatsRes.status === "fulfilled") setWeeklyPaymentStats(weeklyPaymentStatsRes.value as PaymentStats);
        else hardFailures.push("weekly payments stats");

        if (paymentsRes.status === "fulfilled") setPayments(Array.isArray(paymentsRes.value) ? (paymentsRes.value as PaymentRecord[]) : []);
        else hardFailures.push("payments list");

        if (driversRes.status === "fulfilled") {
            setDriversPage(driversRes.value.snapshot);
            setDrivers(Array.isArray(driversRes.value.items) ? driversRes.value.items : []);
        } else {
            hardFailures.push("drivers list");
        }

        if (applicationsRes.status === "fulfilled") {
            const payload = applicationsRes.value as ApplicationsPagePayload;
            setPendingApplications(Array.isArray(payload.items) ? payload.items.slice(0, 8) : []);
            setApplicationCounts({ ...DEFAULT_COUNTS, ...(payload.counts || {}) });
        } else {
            hardFailures.push("applications");
        }

        if (statusRes.status === "fulfilled") setSystemStatus(statusRes.value as SystemStatus);

        if (hardFailures.length > 0) {
            setError(`Some dashboard sources failed: ${hardFailures.join(", ")}`);
        }

        setLoading(false);
    }

    const chicagoDayName = useMemo(() => {
        return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: CHICAGO_TIMEZONE }).format(new Date()).toLowerCase();
    }, []);

    const chicagoNow = useMemo(() => {
        return new Intl.DateTimeFormat("en-US", {
            timeZone: CHICAGO_TIMEZONE,
            dateStyle: "medium",
            timeStyle: "short",
        }).format(new Date());
    }, []);

    const driverSummary = useMemo(() => {
        const summary = {
            total: 0,
            active: 0,
            paused: 0,
            terminated: 0,
            daily: 0,
            weekly: 0,
            weeklyDueToday: 0,
        };

        for (const driver of drivers) {
            summary.total += 1;
            const status = getStatus(driver.billing_status, driver.billing_active);
            if (status === "active") summary.active += 1;
            if (status === "paused") summary.paused += 1;
            if (status === "terminated") summary.terminated += 1;

            const billingType = (driver.billing_type || "daily").toLowerCase();
            if (billingType === "weekly") {
                summary.weekly += 1;
                if (status === "active" && (driver.weekly_due_day || "") === chicagoDayName) {
                    summary.weeklyDueToday += 1;
                }
            } else {
                summary.daily += 1;
            }
        }

        return summary;
    }, [drivers, chicagoDayName]);

    const sourceBreakdown = useMemo(() => {
        const map = new Map<string, { source: string; amount: number; count: number; unmatched: number }>();

        for (const payment of payments) {
            const source = String(payment.source || "unknown").toLowerCase();
            const current = map.get(source) || { source, amount: 0, count: 0, unmatched: 0 };
            current.amount += toNumber(payment.amount);
            current.count += 1;
            if (!payment.matched) current.unmatched += 1;
            map.set(source, current);
        }

        return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
    }, [payments]);

    const trendPoints = useMemo(() => {
        const days = 21;

        const points: { key: string; label: string; amount: number }[] = [];
        const amountMap = new Map<string, number>();

        for (const payment of payments) {
            const date = payment.received_at ? new Date(payment.received_at) : null;
            if (!date || Number.isNaN(date.getTime())) continue;
            const key = getTzDayKey(date, CHICAGO_TIMEZONE);
            amountMap.set(key, (amountMap.get(key) || 0) + toNumber(payment.amount));
        }

        for (let i = days - 1; i >= 0; i -= 1) {
            const dayDate = new Date();
            dayDate.setDate(dayDate.getDate() - i);
            const key = getTzDayKey(dayDate, CHICAGO_TIMEZONE);
            const label = new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO_TIMEZONE, month: "short", day: "numeric" }).format(dayDate);
            points.push({ key, label, amount: amountMap.get(key) || 0 });
        }

        return points;
    }, [payments]);

    const paymentWindows = useMemo(() => {
        const amountByDay = new Map<string, number>();
        let largest = 0;

        for (const payment of payments) {
            const amount = toNumber(payment.amount);
            const date = payment.received_at ? new Date(payment.received_at) : null;
            if (!date || Number.isNaN(date.getTime())) continue;
            const key = getTzDayKey(date, CHICAGO_TIMEZONE);
            amountByDay.set(key, (amountByDay.get(key) || 0) + amount);
            if (amount > largest) largest = amount;
        }

        const sumDays = (days: number) => {
            let sum = 0;
            for (let i = 0; i < days; i += 1) {
                const day = new Date();
                day.setDate(day.getDate() - i);
                const key = getTzDayKey(day, CHICAGO_TIMEZONE);
                sum += amountByDay.get(key) || 0;
            }
            return sum;
        };

        return {
            today: sumDays(1),
            sevenDays: sumDays(7),
            thirtyDays: sumDays(30),
            largest,
        };
    }, [payments]);

    const unmatchedQueue = useMemo(() => {
        return payments
            .filter((payment) => !payment.matched)
            .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
            .slice(0, 8);
    }, [payments]);

    const atRiskDrivers = useMemo(() => {
        return [...drivers].sort((a, b) => toNumber(a.balance) - toNumber(b.balance)).slice(0, 8);
    }, [drivers]);

    const billingExposure = useMemo(() => {
        const summary = {
            activeDailyCharge: 0,
            activeWeeklyDueTodayCharge: 0,
            activeWeeklyLaterCharge: 0,
            pausedCharge: 0,
            terminatedCharge: 0,
        };

        for (const driver of drivers) {
            const rate = toNumber(driver.billing_rate);
            const status = getStatus(driver.billing_status, driver.billing_active);
            const billingType = (driver.billing_type || "daily").toLowerCase();

            if (status === "active") {
                if (billingType === "weekly") {
                    if ((driver.weekly_due_day || "") === chicagoDayName) {
                        summary.activeWeeklyDueTodayCharge += rate;
                    } else {
                        summary.activeWeeklyLaterCharge += rate;
                    }
                } else {
                    summary.activeDailyCharge += rate;
                }
            } else if (status === "paused") {
                summary.pausedCharge += rate;
            } else {
                summary.terminatedCharge += rate;
            }
        }

        return summary;
    }, [drivers, chicagoDayName]);

    const weeklyDueBreakdown = useMemo(() => {
        const map = new Map<string, { day: string; total: number; active: number; charge: number }>();
        for (const day of WEEKDAY_ORDER) {
            map.set(day, { day, total: 0, active: 0, charge: 0 });
        }

        for (const driver of drivers) {
            if ((driver.billing_type || "daily").toLowerCase() !== "weekly") continue;
            const day = (driver.weekly_due_day || "").toLowerCase();
            if (!map.has(day)) continue;

            const bucket = map.get(day)!;
            bucket.total += 1;
            if (getStatus(driver.billing_status, driver.billing_active) === "active") {
                bucket.active += 1;
                bucket.charge += toNumber(driver.billing_rate);
            }
        }

        return WEEKDAY_ORDER.map((day) => map.get(day)!);
    }, [drivers]);

    const balanceBreakdown = useMemo(() => {
        const result = {
            positive: 0,
            zero: 0,
            negative: 0,
            positiveAmount: 0,
            negativeAmount: 0,
        };

        for (const driver of drivers) {
            const balance = toNumber(driver.balance);
            if (balance > 0) {
                result.positive += 1;
                result.positiveAmount += balance;
            } else if (balance < 0) {
                result.negative += 1;
                result.negativeAmount += Math.abs(balance);
            } else {
                result.zero += 1;
            }
        }

        return result;
    }, [drivers]);

    const totalPayments = toNumber(paymentStats?.total_payments);
    const matchedPayments = toNumber(paymentStats?.matched_payments);
    const unmatchedPayments = toNumber(paymentStats?.unmatched_payments);
    const grossAmount = toNumber(paymentStats?.total_amount);
    const matchedAmount = toNumber(paymentStats?.matched_amount ?? 0);
    const weeklyCycleAmount = toNumber(weeklyPaymentStats?.total_amount ?? 0);
    const weeklyCycleCount = toNumber(weeklyPaymentStats?.total_payments ?? 0);

    const unmatchedAmount = unmatchedQueue.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    const matchRate = totalPayments > 0 ? (matchedPayments / totalPayments) * 100 : 0;
    const unmatchedRate = totalPayments > 0 ? (unmatchedPayments / totalPayments) * 100 : 0;
    const avgPaymentAmount = totalPayments > 0 ? grossAmount / totalPayments : 0;

    const trendMax = Math.max(1, ...trendPoints.map((point) => point.amount));
    const sourceMax = Math.max(1, ...sourceBreakdown.map((source) => source.amount));

    const fleetBalance = toNumber(driversPage?.balance_total ?? 0);

    const billingMixTotal = driverSummary.daily + driverSummary.weekly;
    const dailyPct = billingMixTotal > 0 ? Math.round((driverSummary.daily / billingMixTotal) * 100) : 0;
    const weeklyPct = billingMixTotal > 0 ? 100 - dailyPct : 0;

    const dueTodayExpected = billingExposure.activeDailyCharge + billingExposure.activeWeeklyDueTodayCharge;
    const allExposure =
        billingExposure.activeDailyCharge +
        billingExposure.activeWeeklyDueTodayCharge +
        billingExposure.activeWeeklyLaterCharge +
        billingExposure.pausedCharge +
        billingExposure.terminatedCharge;

    const sourceTotal = sourceBreakdown.reduce((sum, item) => sum + item.amount, 0);
    const donutGradient = useMemo(() => {
        if (sourceTotal <= 0) return "#E8EEF8";
        let cursor = 0;
        const segments: string[] = [];

        for (const source of sourceBreakdown) {
            const share = (source.amount / sourceTotal) * 100;
            const nextCursor = cursor + share;
            const accent = SOURCE_ACCENTS[source.source] || SOURCE_ACCENTS.unknown;
            segments.push(`${accent} ${cursor}% ${nextCursor}%`);
            cursor = nextCursor;
        }

        return `conic-gradient(${segments.join(", ")})`;
    }, [sourceBreakdown, sourceTotal]);

    const vettingReviewed = toNumber(applicationCounts.approved) + toNumber(applicationCounts.declined) + toNumber(applicationCounts.hold);
    const vettingAll = Math.max(1, toNumber(applicationCounts.all));
    const vettingApprovalRate = vettingReviewed > 0 ? (toNumber(applicationCounts.approved) / vettingReviewed) * 100 : 0;

    if (loading) {
        return <div style={{ padding: "var(--space-4)", color: "var(--dark-gray)", fontFamily: "var(--font-body)" }}>Loading dashboard...</div>;
    }

    return (
        <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)", fontFamily: "var(--font-body)" }}>
            <section
                style={{
                    borderRadius: "24px",
                    border: "1px solid #D8E0EB",
                    background: "linear-gradient(135deg, #F8FBFF 0%, #EAF2FF 100%)",
                    boxShadow: "0 16px 36px rgba(29, 49, 79, 0.09)",
                    padding: "20px 22px",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div>
                        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "2rem", lineHeight: 1.05, color: "#1D2634" }}>Operations Dashboard</h1>
                        <p style={{ marginTop: "8px", color: "#60718A", fontSize: "0.9rem" }}>
                            Chicago snapshot {chicagoNow} · Billing due day <strong style={{ color: "#243A5A", textTransform: "capitalize" }}>{chicagoDayName}</strong>
                        </p>
                    </div>
                    <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", flex: "1 1 560px" }}>
                        <KpiTile label="Gross Processed" value={formatCurrency(grossAmount)} hint={`${totalPayments} total payments`} accent="#274B7A" />
                        <KpiTile label="Matched Value" value={formatCurrency(matchedAmount)} hint={`${formatPercent(matchRate)} auto/manual matched`} accent="#1D7A46" />
                        <KpiTile label="Queue Value" value={formatCurrency(unmatchedAmount)} hint={`${unmatchedPayments} pending (${formatPercent(unmatchedRate)})`} accent="#B96E00" />
                        <KpiTile label="Fleet Balance" value={formatCurrency(fleetBalance)} hint="credits minus debits" accent={fleetBalance >= 0 ? "#1D7A46" : "#A42C36"} />
                    </div>
                </div>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                <KpiTile label="Collected Today" value={formatCurrency(paymentWindows.today)} hint="Chicago day" accent="#1E4D8C" />
                <KpiTile label="7-Day Collection" value={formatCurrency(paymentWindows.sevenDays)} hint="rolling window" accent="#355C9A" />
                <KpiTile label="30-Day Collection" value={formatCurrency(paymentWindows.thirtyDays)} hint="rolling window" accent="#4B70B0" />
                <KpiTile label="Avg Payment" value={formatCurrency(avgPaymentAmount)} hint="across all transactions" accent="#245B7D" />
                <KpiTile label="Largest Payment" value={formatCurrency(paymentWindows.largest)} hint="single transaction" accent="#2E7A63" />
                <KpiTile label="Weekly Cycle" value={formatCurrency(weeklyCycleAmount)} hint={`${weeklyCycleCount} tx since Mon 9AM NY`} accent="#5B6FD3" />
                <KpiTile label="Drivers Active" value={String(driverSummary.active)} hint={`${dailyPct}% daily · ${weeklyPct}% weekly`} accent="#1D7A46" />
                <KpiTile label="Weekly Due Today" value={String(driverSummary.weeklyDueToday)} hint={`${driverSummary.weekly} weekly drivers`} accent="#7B5ED8" />
                <KpiTile label="Billing Due Today" value={formatCurrency(dueTodayExpected)} hint="active daily + weekly due today" accent="#1D7A46" />
                <KpiTile label="Vetting Pending" value={String(toNumber(applicationCounts.pending))} hint={`${toNumber(applicationCounts.approved)} approved total`} accent="#9B6900" />
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "12px" }}>
                <Panel
                    title="Revenue Trend (Last 21 Days)"
                    subtitle="Total incoming payments per Chicago day"
                    action={<Link to="/payments" style={{ fontSize: "0.8rem", color: "var(--primary-blue)", textDecoration: "none", fontWeight: 700 }}>Payments</Link>}
                >
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "182px", paddingTop: "6px" }}>
                        {trendPoints.map((point, index) => {
                            const heightPct = Math.max(4, Math.round((point.amount / trendMax) * 100));
                            return (
                                <div key={point.key} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                                    <div
                                        title={`${point.label}: ${formatCurrency(point.amount)}`}
                                        style={{
                                            width: "100%",
                                            height: `${heightPct}%`,
                                            borderRadius: "8px 8px 3px 3px",
                                            background: "linear-gradient(180deg, #3F6FB5 0%, #274B7A 100%)",
                                            boxShadow: "0 6px 12px rgba(39, 75, 122, 0.22)",
                                        }}
                                    />
                                    <span style={{ fontSize: "0.66rem", color: "#78879D" }}>{index % 3 === 0 ? point.label : ""}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ marginTop: "10px", display: "flex", justifyContent: "space-between", color: "#6F8098", fontSize: "0.78rem" }}>
                        <span>Peak day {formatCurrency(trendMax)}</span>
                        <span style={METRIC_VALUE_STYLE}>Window total {formatCurrency(trendPoints.reduce((sum, point) => sum + point.amount, 0))}</span>
                    </div>
                </Panel>

                <Panel title="Payment Source Split" subtitle="Amount distribution + queue pressure per source">
                    <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
                        <div
                            style={{
                                width: "90px",
                                height: "90px",
                                borderRadius: "999px",
                                background: donutGradient,
                                display: "grid",
                                placeItems: "center",
                                border: "1px solid #DEE6F2",
                                flexShrink: 0,
                            }}
                        >
                            <div style={{ width: "56px", height: "56px", borderRadius: "999px", background: "#FFFFFF", border: "1px solid #E8EEF8", display: "grid", placeItems: "center" }}>
                                <span style={{ ...METRIC_VALUE_STYLE, fontSize: "0.78rem", color: "#2B3749" }}>{sourceBreakdown.length}</span>
                            </div>
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "0.75rem", color: "#6D7D94", textTransform: "uppercase", letterSpacing: "0.06em" }}>Sources</div>
                            <div style={{ ...METRIC_VALUE_STYLE, marginTop: "2px", fontSize: "1.35rem", color: "#1E2A3A" }}>{formatCurrency(sourceTotal)}</div>
                            <div style={{ marginTop: "2px", fontSize: "0.76rem", color: "#74849A" }}>Total processed across all sources</div>
                        </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {sourceBreakdown.slice(0, 6).map((source) => {
                            const widthPct = Math.max(4, Math.round((source.amount / sourceMax) * 100));
                            const sourceShare = sourceTotal > 0 ? (source.amount / sourceTotal) * 100 : 0;
                            const accent = SOURCE_ACCENTS[source.source] || SOURCE_ACCENTS.unknown;
                            return (
                                <div key={source.source}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                                        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#2A3648", textTransform: "uppercase" }}>{source.source}</span>
                                        <span style={{ ...METRIC_VALUE_STYLE, fontSize: "0.82rem", color: "#1E293A" }}>{formatCurrency(source.amount)}</span>
                                    </div>
                                    <div style={{ width: "100%", height: "8px", background: "#EEF3FA", borderRadius: "999px", overflow: "hidden" }}>
                                        <div style={{ width: `${widthPct}%`, height: "100%", background: accent }} />
                                    </div>
                                    <div style={{ marginTop: "4px", fontSize: "0.72rem", color: "#74849A" }}>
                                        {source.count} tx · {source.unmatched} unmatched · {formatPercent(sourceShare)} share
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Panel>

                <Panel title="Billing Load Forecast" subtitle="Expected charges by billing mode and status">
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        <div style={{ padding: "10px", borderRadius: "12px", border: "1px solid #E2EAF4", background: "#F8FBFF" }}>
                            <div style={{ fontSize: "0.72rem", color: "#6E7D94", textTransform: "uppercase", letterSpacing: "0.05em" }}>Expected Charge Right Now</div>
                            <div style={{ ...METRIC_VALUE_STYLE, marginTop: "4px", fontSize: "1.6rem", color: "#1D7A46" }}>{formatCurrency(dueTodayExpected)}</div>
                            <div style={{ marginTop: "2px", fontSize: "0.74rem", color: "#7A89A1" }}>Daily active + weekly drivers due today ({chicagoDayName})</div>
                        </div>

                        <div style={{ width: "100%", height: "12px", background: "#EAF0F8", borderRadius: "999px", overflow: "hidden", display: "flex" }}>
                            <div style={{ width: `${allExposure > 0 ? (billingExposure.activeDailyCharge / allExposure) * 100 : 0}%`, background: "#2E5B93" }} title="Active daily" />
                            <div style={{ width: `${allExposure > 0 ? (billingExposure.activeWeeklyDueTodayCharge / allExposure) * 100 : 0}%`, background: "#4A77C4" }} title="Active weekly due today" />
                            <div style={{ width: `${allExposure > 0 ? (billingExposure.activeWeeklyLaterCharge / allExposure) * 100 : 0}%`, background: "#8CA6DB" }} title="Active weekly future day" />
                            <div style={{ width: `${allExposure > 0 ? (billingExposure.pausedCharge / allExposure) * 100 : 0}%`, background: "#B5C3DA" }} title="Paused" />
                            <div style={{ width: `${allExposure > 0 ? (billingExposure.terminatedCharge / allExposure) * 100 : 0}%`, background: "#E0AEB3" }} title="Terminated" />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "0.75rem" }}>
                            <div style={{ border: "1px solid #E4EAF3", borderRadius: "10px", padding: "8px", background: "#FBFDFF" }}>
                                <div style={{ color: "#6D7D95" }}>Active Daily</div>
                                <div style={{ ...METRIC_VALUE_STYLE, color: "#2E5B93" }}>{formatCurrency(billingExposure.activeDailyCharge)}</div>
                            </div>
                            <div style={{ border: "1px solid #E4EAF3", borderRadius: "10px", padding: "8px", background: "#FBFDFF" }}>
                                <div style={{ color: "#6D7D95" }}>Weekly Due Today</div>
                                <div style={{ ...METRIC_VALUE_STYLE, color: "#4A77C4" }}>{formatCurrency(billingExposure.activeWeeklyDueTodayCharge)}</div>
                            </div>
                            <div style={{ border: "1px solid #E4EAF3", borderRadius: "10px", padding: "8px", background: "#FBFDFF" }}>
                                <div style={{ color: "#6D7D95" }}>Paused Exposure</div>
                                <div style={{ ...METRIC_VALUE_STYLE, color: "#7688A3" }}>{formatCurrency(billingExposure.pausedCharge)}</div>
                            </div>
                            <div style={{ border: "1px solid #E4EAF3", borderRadius: "10px", padding: "8px", background: "#FBFDFF" }}>
                                <div style={{ color: "#6D7D95" }}>Terminated Exposure</div>
                                <div style={{ ...METRIC_VALUE_STYLE, color: "#A05E69" }}>{formatCurrency(billingExposure.terminatedCharge)}</div>
                            </div>
                        </div>
                    </div>
                </Panel>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "12px" }}>
                <Panel title="Weekly Due-Day Distribution" subtitle="How weekly drivers are spread across weekdays">
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {weeklyDueBreakdown.map((item) => {
                            const maxDueCount = Math.max(1, ...weeklyDueBreakdown.map((entry) => entry.total));
                            const widthPct = Math.max(item.total > 0 ? 8 : 0, Math.round((item.total / maxDueCount) * 100));
                            const isToday = item.day === chicagoDayName;
                            return (
                                <div key={item.day}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem", marginBottom: "4px" }}>
                                        <span style={{ color: isToday ? "#1E4D8C" : "#5F728D", fontWeight: isToday ? 700 : 600, textTransform: "capitalize" }}>{item.day}</span>
                                        <span style={{ ...METRIC_VALUE_STYLE, color: "#2B3749" }}>{item.total} drivers</span>
                                    </div>
                                    <div style={{ width: "100%", height: "8px", borderRadius: "999px", background: "#EDF3FA", overflow: "hidden" }}>
                                        <div style={{ width: `${widthPct}%`, height: "100%", background: isToday ? "#3F6FB5" : "#88A2CC" }} />
                                    </div>
                                    <div style={{ marginTop: "3px", fontSize: "0.7rem", color: "#74849A" }}>
                                        Active {item.active} · Expected {formatCurrency(item.charge)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Panel>

                <Panel title="Vetting Funnel" subtitle="Current intake and processing conversion" action={<Link to="/applications" style={{ fontSize: "0.8rem", color: "var(--primary-blue)", textDecoration: "none", fontWeight: 700 }}>Vetting Hub</Link>}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                        <div style={{ border: "1px solid #E4EAF3", borderRadius: "10px", padding: "8px", background: "#FBFDFF" }}>
                            <div style={{ fontSize: "0.72rem", color: "#6D7D95", textTransform: "uppercase" }}>Total Applications</div>
                            <div style={{ ...METRIC_VALUE_STYLE, marginTop: "2px", fontSize: "1.3rem", color: "#1F2C3D" }}>{toNumber(applicationCounts.all)}</div>
                        </div>
                        <div style={{ border: "1px solid #E4EAF3", borderRadius: "10px", padding: "8px", background: "#FBFDFF" }}>
                            <div style={{ fontSize: "0.72rem", color: "#6D7D95", textTransform: "uppercase" }}>Approval Rate</div>
                            <div style={{ ...METRIC_VALUE_STYLE, marginTop: "2px", fontSize: "1.3rem", color: "#1D7A46" }}>{formatPercent(vettingApprovalRate)}</div>
                        </div>
                    </div>

                    {[
                        { key: "pending", label: "Pending", color: "#B07D16" },
                        { key: "approved", label: "Approved", color: "#1D7A46" },
                        { key: "declined", label: "Declined", color: "#A42C36" },
                        { key: "hold", label: "Hold", color: "#3A5E8C" },
                        { key: "onboarding", label: "Onboarding", color: "#5B6FD3" },
                    ].map((item) => {
                        const value = toNumber(applicationCounts[item.key]);
                        const widthPct = Math.max(value > 0 ? 6 : 0, Math.round((value / vettingAll) * 100));
                        return (
                            <div key={item.key} style={{ marginBottom: "8px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem", marginBottom: "4px" }}>
                                    <span style={{ color: "#5F728D", fontWeight: 700 }}>{item.label}</span>
                                    <span style={{ ...METRIC_VALUE_STYLE, color: "#2B3749" }}>{value}</span>
                                </div>
                                <div style={{ width: "100%", height: "8px", borderRadius: "999px", background: "#EDF3FA", overflow: "hidden" }}>
                                    <div style={{ width: `${widthPct}%`, height: "100%", background: item.color }} />
                                </div>
                            </div>
                        );
                    })}
                </Panel>

                <Panel title="Driver Balance Distribution" subtitle="How balances are split across the fleet" action={<Link to="/drivers" style={{ fontSize: "0.8rem", color: "var(--primary-blue)", textDecoration: "none", fontWeight: 700 }}>Drivers</Link>}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                        <div style={{ border: "1px solid #E4EAF3", borderRadius: "10px", padding: "8px", background: "#F3FBF5" }}>
                            <div style={{ fontSize: "0.7rem", color: "#4B7D5D", textTransform: "uppercase" }}>Positive</div>
                            <div style={{ ...METRIC_VALUE_STYLE, marginTop: "2px", color: "#1D7A46" }}>{balanceBreakdown.positive}</div>
                        </div>
                        <div style={{ border: "1px solid #E4EAF3", borderRadius: "10px", padding: "8px", background: "#FBFDFF" }}>
                            <div style={{ fontSize: "0.7rem", color: "#6D7D95", textTransform: "uppercase" }}>Zero</div>
                            <div style={{ ...METRIC_VALUE_STYLE, marginTop: "2px", color: "#60718A" }}>{balanceBreakdown.zero}</div>
                        </div>
                        <div style={{ border: "1px solid #E4EAF3", borderRadius: "10px", padding: "8px", background: "#FFF5F5" }}>
                            <div style={{ fontSize: "0.7rem", color: "#A05E69", textTransform: "uppercase" }}>Negative</div>
                            <div style={{ ...METRIC_VALUE_STYLE, marginTop: "2px", color: "#A42C36" }}>{balanceBreakdown.negative}</div>
                        </div>
                    </div>

                    <div style={{ width: "100%", height: "12px", borderRadius: "999px", background: "#EEF3FA", overflow: "hidden", display: "flex", marginBottom: "10px" }}>
                        <div style={{ width: `${driverSummary.total > 0 ? (balanceBreakdown.positive / driverSummary.total) * 100 : 0}%`, background: "#1D7A46" }} />
                        <div style={{ width: `${driverSummary.total > 0 ? (balanceBreakdown.zero / driverSummary.total) * 100 : 0}%`, background: "#A8B5C9" }} />
                        <div style={{ width: `${driverSummary.total > 0 ? (balanceBreakdown.negative / driverSummary.total) * 100 : 0}%`, background: "#B9505B" }} />
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", color: "#6D7D95" }}>
                        <span>Positive total {formatCurrency(balanceBreakdown.positiveAmount)}</span>
                        <span>Negative total {formatCurrency(balanceBreakdown.negativeAmount)}</span>
                    </div>
                </Panel>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "12px" }}>
                <Panel title="Pending Vetting Queue" subtitle="Newest applications waiting for review" action={<Link to="/applications" style={{ fontSize: "0.8rem", color: "var(--primary-blue)", textDecoration: "none", fontWeight: 700 }}>Review</Link>}>
                    {pendingApplications.length === 0 ? (
                        <div style={{ fontSize: "0.86rem", color: "#73839A" }}>No pending applications.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            {pendingApplications.map((application) => (
                                <Link
                                    key={application.id}
                                    to={`/applications/${application.id}`}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "1fr auto",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "8px 10px",
                                        borderRadius: "10px",
                                        border: "1px solid #E4EAF3",
                                        background: "#F9FBFE",
                                        textDecoration: "none",
                                        color: "#2A3648",
                                    }}
                                >
                                    <span style={{ fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {getApplicantName(application)}
                                    </span>
                                    <span style={{ ...METRIC_VALUE_STYLE, fontSize: "0.72rem", color: "#7B8BA0" }}>{new Date(application.created_at).toLocaleDateString()}</span>
                                </Link>
                            ))}
                        </div>
                    )}
                </Panel>

                <Panel title="Unmatched Queue" subtitle="Payments that need driver assignment" action={<Link to="/payments" style={{ fontSize: "0.8rem", color: "var(--primary-blue)", textDecoration: "none", fontWeight: 700 }}>Resolve</Link>}>
                    {unmatchedQueue.length === 0 ? (
                        <div style={{ fontSize: "0.86rem", color: "#73839A" }}>Queue is clear.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            {unmatchedQueue.map((payment) => {
                                const source = String(payment.source || "unknown").toLowerCase();
                                const accent = SOURCE_ACCENTS[source] || SOURCE_ACCENTS.unknown;
                                return (
                                    <div key={payment.id} style={{ display: "grid", gridTemplateColumns: "86px 1fr auto", gap: "8px", alignItems: "center", border: "1px solid #E4EAF3", borderRadius: "11px", padding: "8px 10px", background: "#FAFCFF" }}>
                                        <span style={{ display: "inline-block", textAlign: "center", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: accent }}>
                                            {source}
                                        </span>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#2A3648", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {payment.sender_name || "Unknown Sender"}
                                            </div>
                                            <div style={{ fontSize: "0.72rem", color: "#7888A0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {payment.memo || "No memo"}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <div style={{ ...METRIC_VALUE_STYLE, fontSize: "0.88rem", color: "#9B6900" }}>{formatCurrency(toNumber(payment.amount))}</div>
                                            <div style={{ ...METRIC_VALUE_STYLE, fontSize: "0.7rem", color: "#7B8BA0" }}>{new Date(payment.received_at).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Panel>

                <Panel title="Balance Watchlist" subtitle="Lowest balances across drivers" action={<Link to="/drivers" style={{ fontSize: "0.8rem", color: "var(--primary-blue)", textDecoration: "none", fontWeight: 700 }}>Open Drivers</Link>}>
                    {atRiskDrivers.length === 0 ? (
                        <div style={{ fontSize: "0.86rem", color: "#73839A" }}>No drivers found.</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            {atRiskDrivers.map((driver) => {
                                const balance = toNumber(driver.balance);
                                return (
                                    <Link
                                        key={driver.id}
                                        to={`/drivers/${driver.id}`}
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr auto",
                                            gap: "8px",
                                            alignItems: "center",
                                            border: "1px solid #E4EAF3",
                                            borderRadius: "11px",
                                            padding: "8px 10px",
                                            background: "#FAFCFF",
                                            textDecoration: "none",
                                        }}
                                    >
                                        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#2A3648", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {getDriverName(driver)}
                                        </span>
                                        <span style={{ ...METRIC_VALUE_STYLE, fontSize: "0.9rem", color: balance >= 0 ? "#1D7A46" : "#A42C36" }}>
                                            {formatCurrency(balance)}
                                        </span>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </Panel>
            </section>

            <Panel title="System Status" subtitle="Current health of external integrations and database">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
                    {[
                        { label: "Database", item: systemStatus?.database },
                        { label: "Gmail", item: systemStatus?.gmail },
                        { label: "OpenPhone", item: systemStatus?.openphone },
                    ].map(({ label, item }) => (
                        <div key={label} style={{ border: "1px solid #E4EAF3", borderRadius: "12px", padding: "10px", background: "#FAFCFF" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#2A3648" }}>{label}</span>
                                <StatusPill item={item} />
                            </div>
                            <div style={{ fontSize: "0.74rem", color: "#74849A" }}>{item?.message || "No data"}</div>
                        </div>
                    ))}
                </div>
            </Panel>

            {error && (
                <div style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #F2C6CA", background: "#FDEFF1", color: "#A42C36", fontSize: "0.8rem" }}>
                    {error}
                </div>
            )}

        </div>
    );
}
