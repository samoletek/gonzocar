import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import api from "../services/api";

interface PortalDriver {
    id: string;
    first_name: string;
    last_name: string;
    balance: number;
    deposit_required: number;
    deposit_posted: number;
    deposit_updated_at: string | null;
}

interface PortalLedgerEntry {
    id: string;
    type: "credit" | "debit";
    amount: number;
    description: string;
    entry_source: string;
    created_at: string;
}

interface PortalPayload {
    driver: PortalDriver;
    ledger: PortalLedgerEntry[];
}

export default function DriverPortal() {
    const { token } = useParams<{ token: string }>();
    const [data, setData] = useState<PortalPayload | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (token) loadPortal(token);
    }, [token]);

    async function loadPortal(portalToken: string) {
        try {
            setLoading(true);
            const payload = await api.getPublicDriverPortal(portalToken);
            setData(payload);
        } catch (error) {
            console.error("Failed to load driver portal:", error);
            setData(null);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div style={{ padding: "32px", textAlign: "center" }}>Loading portal...</div>;
    }

    if (!data) {
        return <div style={{ padding: "32px", textAlign: "center" }}>Portal not found</div>;
    }

    return (
        <div style={{ maxWidth: "980px", margin: "0 auto", padding: "24px" }}>
            <div
                style={{
                    background: "var(--white)",
                    borderRadius: "var(--radius-standard)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    padding: "24px",
                    marginBottom: "16px",
                }}
            >
                <h1 style={{ fontFamily: "var(--font-heading)", marginBottom: "8px" }}>
                    {data.driver.first_name} {data.driver.last_name}
                </h1>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                    <div>
                        <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>Current Balance</div>
                        <div
                            style={{
                                fontWeight: 700,
                                fontSize: "1.4rem",
                                color: data.driver.balance >= 0 ? "var(--success-green)" : "var(--error-red)",
                            }}
                        >
                            ${Number(data.driver.balance || 0).toFixed(2)}
                        </div>
                    </div>
                    <div>
                        <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>Deposit Required</div>
                        <div style={{ fontWeight: 600 }}>${Number(data.driver.deposit_required || 0).toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>Deposit Posted</div>
                        <div style={{ fontWeight: 600 }}>${Number(data.driver.deposit_posted || 0).toFixed(2)}</div>
                        <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>
                            Updated: {data.driver.deposit_updated_at ? new Date(data.driver.deposit_updated_at).toLocaleString() : "-"}
                        </div>
                    </div>
                </div>
            </div>

            <div
                style={{
                    background: "var(--white)",
                    borderRadius: "var(--radius-standard)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    padding: "16px",
                }}
            >
                <h3 style={{ fontFamily: "var(--font-heading)", marginBottom: "12px" }}>Payment History & Ledger</h3>
                {data.ledger.length === 0 ? (
                    <p style={{ opacity: 0.6 }}>No entries yet</p>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ background: "var(--light-gray)" }}>
                                <th style={{ textAlign: "left", padding: "8px", fontSize: "0.75rem" }}>Date</th>
                                <th style={{ textAlign: "left", padding: "8px", fontSize: "0.75rem" }}>Description</th>
                                <th style={{ textAlign: "left", padding: "8px", fontSize: "0.75rem" }}>Source</th>
                                <th style={{ textAlign: "right", padding: "8px", fontSize: "0.75rem" }}>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.ledger.map((entry) => (
                                <tr key={entry.id} style={{ borderTop: "1px solid var(--light-gray)" }}>
                                    <td style={{ padding: "8px" }}>{new Date(entry.created_at).toLocaleString()}</td>
                                    <td style={{ padding: "8px" }}>{entry.description || "-"}</td>
                                    <td style={{ padding: "8px", textTransform: "uppercase", fontSize: "0.75rem" }}>{entry.entry_source || "system"}</td>
                                    <td
                                        style={{
                                            padding: "8px",
                                            textAlign: "right",
                                            fontWeight: 600,
                                            color: entry.type === "credit" ? "var(--success-green)" : "var(--error-red)",
                                        }}
                                    >
                                        {entry.type === "credit" ? "+" : "-"}${Number(entry.amount).toFixed(2)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
