import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import api from "../services/api";

interface Application {
    id: string;
    status: string;
    driver_id?: string | null;
    form_data: {
        first_name?: string;
        last_name?: string;
        email?: string;
        phone?: string;
        [key: string]: unknown;
    };
    created_at: string;
}

interface ApplicationsPagePayload {
    items: Application[];
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    counts: Record<string, number>;
}

const EMPTY_COUNTS: Record<string, number> = {
    all: 0,
    pending: 0,
    approved: 0,
    declined: 0,
    hold: 0,
    onboarding: 0,
};

export default function Applications() {
    const [applications, setApplications] = useState<Application[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>(EMPTY_COUNTS);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [filter, setFilter] = useState<string>("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [error, setError] = useState("");
    const [syncMessage, setSyncMessage] = useState("");

    useEffect(() => {
        loadApplications();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter, page, pageSize]);

    async function loadApplications() {
        setLoading(true);
        setError("");
        try {
            const data = (await api.getApplicationsPage({
                statusFilter: filter || undefined,
                page,
                pageSize,
                excludeLinkedDrivers: true,
            })) as ApplicationsPagePayload;

            const nextTotalPages = Math.max(1, Number(data.total_pages || 1));
            if (page > nextTotalPages) {
                setPage(nextTotalPages);
                return;
            }

            setApplications(Array.isArray(data.items) ? data.items : []);
            setCounts({ ...EMPTY_COUNTS, ...(data.counts || {}) });
            setTotal(Number(data.total || 0));
            setTotalPages(nextTotalPages);
        } catch (loadError) {
            console.error("Failed to load applications:", loadError);
            setError(loadError instanceof Error ? loadError.message : "Failed to load applications");
        } finally {
            setLoading(false);
        }
    }

    async function handleBackfillDrivers() {
        setSyncing(true);
        setSyncMessage("");
        try {
            const result = await api.backfillApplicationDrivers();
            const processed = Number(result?.processed || 0);
            setSyncMessage(`Linked ${processed} application(s) to drivers.`);
            await loadApplications();
        } catch (backfillError) {
            console.error("Failed to backfill approved applications:", backfillError);
            setSyncMessage(backfillError instanceof Error ? backfillError.message : "Failed to reconcile applications");
        } finally {
            setSyncing(false);
        }
    }

    function changeFilter(nextFilter: string) {
        setFilter(nextFilter);
        setPage(1);
    }

    const statusColors: Record<string, { bg: string; text: string }> = {
        pending: { bg: "#FFF3CD", text: "#856404" },
        approved: { bg: "#D4EDDA", text: "#155724" },
        declined: { bg: "#F8D7DA", text: "#721C24" },
        hold: { bg: "#E2E3E5", text: "#383D41" },
        onboarding: { bg: "#CCE5FF", text: "#004085" },
    };

    const firstRowIndex = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const lastRowIndex = total === 0 ? 0 : Math.min(page * pageSize, total);

    return (
        <div style={{ padding: "var(--space-4)" }}>
            <div style={{ marginBottom: "var(--space-4)" }}>
                <h1
                    style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: "1.75rem",
                        color: "var(--dark-gray)",
                        marginBottom: "var(--space-1)",
                    }}
                >
                    Vetting Hub
                </h1>
                <p style={{ color: "var(--dark-gray)", opacity: 0.7 }}>Review and process driver applications</p>
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: "var(--space-2)",
                    marginBottom: "var(--space-3)",
                }}
            >
                {[
                    { key: "", label: "All", count: counts.all || 0 },
                    { key: "pending", label: "Pending", count: counts.pending || 0 },
                    { key: "approved", label: "Approved", count: counts.approved || 0 },
                    { key: "declined", label: "Declined", count: counts.declined || 0 },
                ].map((item) => (
                    <button
                        key={item.key}
                        onClick={() => changeFilter(item.key)}
                        style={{
                            padding: "var(--space-3)",
                            background: filter === item.key ? "var(--primary-blue)" : "var(--white)",
                            border: `1px solid ${filter === item.key ? "var(--primary-blue)" : "var(--medium-gray)"}`,
                            borderRadius: "var(--radius-standard)",
                            cursor: "pointer",
                            textAlign: "left",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "0.75rem",
                                color: filter === item.key ? "rgba(255,255,255,0.8)" : "var(--dark-gray)",
                                opacity: filter === item.key ? 1 : 0.6,
                                marginBottom: "4px",
                            }}
                        >
                            {item.label}
                        </div>
                        <div
                            style={{
                                fontSize: "1.5rem",
                                fontWeight: 700,
                                fontFamily: "var(--font-heading)",
                                color: filter === item.key ? "var(--white)" : "var(--dark-gray)",
                            }}
                        >
                            {item.count}
                        </div>
                    </button>
                ))}
            </div>

            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "var(--space-3)",
                    gap: "var(--space-2)",
                    flexWrap: "wrap",
                }}
            >
                <div style={{ color: "var(--dark-gray)", opacity: 0.8, fontSize: "0.875rem" }}>
                    {loading ? "Loading..." : `Showing ${firstRowIndex}-${lastRowIndex} of ${total}`}
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                    <label style={{ fontSize: "0.875rem", color: "var(--dark-gray)", opacity: 0.8 }}>
                        Rows:
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setPage(1);
                            }}
                            style={{
                                marginLeft: "8px",
                                padding: "6px 8px",
                                border: "1px solid var(--medium-gray)",
                                borderRadius: "var(--radius-small)",
                                background: "var(--white)",
                            }}
                        >
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                        </select>
                    </label>
                    <button
                        onClick={handleBackfillDrivers}
                        disabled={syncing}
                        style={{
                            padding: "8px 12px",
                            border: "1px solid var(--medium-gray)",
                            borderRadius: "var(--radius-small)",
                            background: "var(--light-gray)",
                            color: "var(--dark-gray)",
                            cursor: syncing ? "not-allowed" : "pointer",
                            opacity: syncing ? 0.7 : 1,
                            fontWeight: 600,
                        }}
                    >
                        {syncing ? "Syncing..." : "Sync Approved -> Drivers"}
                    </button>
                </div>
            </div>

            {syncMessage && (
                <div
                    style={{
                        marginBottom: "var(--space-3)",
                        padding: "10px 12px",
                        borderRadius: "var(--radius-small)",
                        background: "#E8F0FE",
                        border: "1px solid #bcd2ff",
                        color: "#1a4f9c",
                        fontSize: "0.875rem",
                    }}
                >
                    {syncMessage}
                </div>
            )}

            <div
                style={{
                    background: "var(--white)",
                    borderRadius: "var(--radius-standard)",
                    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                    overflow: "hidden",
                }}
            >
                {error ? (
                    <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--error-red)" }}>{error}</div>
                ) : loading ? (
                    <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--dark-gray)" }}>
                        Loading applications...
                    </div>
                ) : applications.length === 0 ? (
                    <div style={{ padding: "var(--space-4)", textAlign: "center", color: "var(--dark-gray)", opacity: 0.6 }}>
                        No applications found
                    </div>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ background: "var(--light-gray)" }}>
                                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--dark-gray)", fontWeight: 600, fontSize: "0.875rem" }}>
                                    Applicant
                                </th>
                                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--dark-gray)", fontWeight: 600, fontSize: "0.875rem" }}>
                                    Email
                                </th>
                                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--dark-gray)", fontWeight: 600, fontSize: "0.875rem" }}>
                                    Phone
                                </th>
                                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--dark-gray)", fontWeight: 600, fontSize: "0.875rem" }}>
                                    Submitted
                                </th>
                                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "left", color: "var(--dark-gray)", fontWeight: 600, fontSize: "0.875rem" }}>
                                    Status
                                </th>
                                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "right" }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {applications.map((app) => {
                                const statusStyle = statusColors[app.status] || statusColors.pending;
                                return (
                                    <tr key={app.id} style={{ borderTop: "1px solid var(--light-gray)" }}>
                                        <td style={{ padding: "var(--space-2) var(--space-3)", fontWeight: 500, color: "var(--dark-gray)" }}>
                                            {(() => {
                                                const fd = app.form_data || {};
                                                if (fd.first_name || fd.last_name) {
                                                    return `${fd.first_name || ""} ${fd.last_name || ""}`.trim();
                                                }

                                                let namesObj: any = null;
                                                for (const key of Object.keys(fd)) {
                                                    if (key.toLowerCase().includes("name") && typeof fd[key] === "object" && fd[key] !== null) {
                                                        namesObj = fd[key];
                                                        break;
                                                    }
                                                }
                                                if (namesObj) {
                                                    const f = namesObj.first_name || namesObj.First_Name || namesObj.first || "";
                                                    const l = namesObj.last_name || namesObj.Last_Name || namesObj.last || "";
                                                    if (f || l) return `${f} ${l}`.trim();
                                                }

                                                if (fd.email) return <span style={{ opacity: 0.5 }}>{String(fd.email)}</span>;
                                                return "Unknown Applicant";
                                            })()}
                                        </td>
                                        <td style={{ padding: "var(--space-2) var(--space-3)", color: "var(--dark-gray)" }}>{app.form_data?.email as string}</td>
                                        <td style={{ padding: "var(--space-2) var(--space-3)", color: "var(--dark-gray)" }}>{app.form_data?.phone as string}</td>
                                        <td style={{ padding: "var(--space-2) var(--space-3)", color: "var(--dark-gray)" }}>
                                            {new Date(app.created_at).toLocaleDateString()}
                                        </td>
                                        <td style={{ padding: "var(--space-2) var(--space-3)" }}>
                                            <span
                                                style={{
                                                    padding: "4px 8px",
                                                    background: statusStyle.bg,
                                                    color: statusStyle.text,
                                                    borderRadius: "var(--radius-small)",
                                                    fontWeight: 500,
                                                    fontSize: "0.75rem",
                                                    textTransform: "capitalize",
                                                }}
                                            >
                                                {app.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: "var(--space-2) var(--space-3)", textAlign: "right" }}>
                                            <Link
                                                to={`/applications/${app.id}`}
                                                style={{
                                                    padding: "6px 12px",
                                                    background: "var(--light-gray)",
                                                    border: "1px solid var(--medium-gray)",
                                                    borderRadius: "var(--radius-small)",
                                                    color: "var(--dark-gray)",
                                                    textDecoration: "none",
                                                    fontSize: "0.875rem",
                                                    fontWeight: 500,
                                                }}
                                            >
                                                Review
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            <div
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "var(--space-3)",
                }}
            >
                <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={loading || page <= 1}
                    style={{
                        padding: "6px 10px",
                        borderRadius: "var(--radius-small)",
                        border: "1px solid var(--medium-gray)",
                        background: "var(--white)",
                        cursor: loading || page <= 1 ? "not-allowed" : "pointer",
                        opacity: loading || page <= 1 ? 0.6 : 1,
                    }}
                >
                    Prev
                </button>
                <span style={{ fontSize: "0.875rem", color: "var(--dark-gray)" }}>
                    Page {page} / {totalPages}
                </span>
                <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={loading || page >= totalPages}
                    style={{
                        padding: "6px 10px",
                        borderRadius: "var(--radius-small)",
                        border: "1px solid var(--medium-gray)",
                        background: "var(--white)",
                        cursor: loading || page >= totalPages ? "not-allowed" : "pointer",
                        opacity: loading || page >= totalPages ? 0.6 : 1,
                    }}
                >
                    Next
                </button>
            </div>
        </div>
    );
}
