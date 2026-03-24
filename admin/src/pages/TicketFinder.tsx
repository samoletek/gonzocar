import { useEffect, useState } from "react";

import api from "../services/api";

interface Driver {
    id: string;
    first_name: string;
    last_name: string;
}

interface Assignment {
    id: string;
    driver_id: string;
    driver_name: string;
    license_plate: string;
    start_at: string;
    end_at: string | null;
    previous_assignment_id: string | null;
}

interface MappingForm {
    driver_id: string;
    license_plate: string;
    start_at: string;
    end_at: string;
}

function toDateTimeLocal(value?: string | null): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function toIsoOrUndefined(value: string): string | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString();
}

export default function TicketFinder() {
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [results, setResults] = useState<Assignment[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);

    const [searchLicensePlate, setSearchLicensePlate] = useState("");
    const [searchDriverName, setSearchDriverName] = useState("");

    const [mappingForm, setMappingForm] = useState<MappingForm>({
        driver_id: "",
        license_plate: "",
        start_at: toDateTimeLocal(new Date().toISOString()),
        end_at: "",
    });

    useEffect(() => {
        loadDrivers();
    }, []);

    async function loadDrivers() {
        try {
            setLoading(true);
            const data = await api.getDrivers();
            setDrivers(data);
        } catch (error) {
            console.error("Failed to load drivers:", error);
        } finally {
            setLoading(false);
        }
    }

    async function runSearch(e?: React.FormEvent) {
        if (e) e.preventDefault();
        if (!searchLicensePlate.trim() && !searchDriverName.trim()) {
            setResults([]);
            return;
        }
        try {
            const data = await api.searchVehicleAssignments({
                license_plate: searchLicensePlate.trim() || undefined,
                driver_name: searchDriverName.trim() || undefined,
            });
            setResults(data);
        } catch (error) {
            console.error("Failed to search assignments:", error);
        }
    }

    async function saveMapping(e: React.FormEvent) {
        e.preventDefault();
        if (!mappingForm.driver_id || !mappingForm.license_plate || !mappingForm.start_at) return;
        setBusy(true);

        const payload = {
            license_plate: mappingForm.license_plate.trim(),
            start_at: toIsoOrUndefined(mappingForm.start_at),
            end_at: toIsoOrUndefined(mappingForm.end_at),
        };

        try {
            if (editingAssignmentId) {
                await api.updateVehicleAssignment(editingAssignmentId, payload);
            } else {
                await api.createVehicleAssignment({
                    driver_id: mappingForm.driver_id,
                    ...payload,
                });
            }
            setEditingAssignmentId(null);
            setMappingForm({
                driver_id: "",
                license_plate: "",
                start_at: toDateTimeLocal(new Date().toISOString()),
                end_at: "",
            });
            await runSearch();
        } catch (error) {
            const ext = error as Error & { status?: number; data?: any };
            if (ext.status === 409) {
                const proceed = window.confirm(
                    `${ext.data?.detail?.message || "Mapping overlaps existing record"}. Save anyway?`
                );
                if (proceed) {
                    try {
                        if (editingAssignmentId) {
                            await api.updateVehicleAssignment(editingAssignmentId, {
                                ...payload,
                                acknowledge_overlap: true,
                            });
                        } else {
                            await api.createVehicleAssignment({
                                driver_id: mappingForm.driver_id,
                                ...payload,
                                acknowledge_overlap: true,
                            });
                        }
                        setEditingAssignmentId(null);
                        setMappingForm({
                            driver_id: "",
                            license_plate: "",
                            start_at: toDateTimeLocal(new Date().toISOString()),
                            end_at: "",
                        });
                        await runSearch();
                    } catch (secondError) {
                        console.error("Failed to save mapping after confirmation:", secondError);
                    }
                }
            } else {
                console.error("Failed to save mapping:", error);
            }
        } finally {
            setBusy(false);
        }
    }

    function editAssignment(item: Assignment) {
        setEditingAssignmentId(item.id);
        setMappingForm({
            driver_id: item.driver_id,
            license_plate: item.license_plate,
            start_at: toDateTimeLocal(item.start_at),
            end_at: toDateTimeLocal(item.end_at),
        });
    }

    if (loading) {
        return <div style={{ padding: "var(--space-4)" }}>Loading ticket finder...</div>;
    }

    return (
        <div style={{ padding: "var(--space-4)" }}>
            <div style={{ marginBottom: "var(--space-4)" }}>
                <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "1.75rem", color: "var(--dark-gray)" }}>
                    Ticket Finder
                </h1>
                <p style={{ color: "var(--dark-gray)", opacity: 0.7 }}>
                    Manual driver-vehicle mapping and liability search
                </p>
            </div>

            <div
                style={{
                    background: "var(--white)",
                    borderRadius: "var(--radius-standard)",
                    padding: "var(--space-3)",
                    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                    marginBottom: "var(--space-4)",
                }}
            >
                <h3 style={{ fontFamily: "var(--font-heading)", marginBottom: "var(--space-2)" }}>
                    Manual Mapping
                </h3>
                <form
                    onSubmit={saveMapping}
                    style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: "8px" }}
                >
                    <select
                        value={mappingForm.driver_id}
                        onChange={(e) => setMappingForm((prev) => ({ ...prev, driver_id: e.target.value }))}
                    >
                        <option value="">Select driver...</option>
                        {drivers.map((driver) => (
                            <option key={driver.id} value={driver.id}>
                                {driver.first_name} {driver.last_name}
                            </option>
                        ))}
                    </select>
                    <input
                        placeholder="License plate"
                        value={mappingForm.license_plate}
                        onChange={(e) => setMappingForm((prev) => ({ ...prev, license_plate: e.target.value }))}
                    />
                    <input
                        type="datetime-local"
                        value={mappingForm.start_at}
                        onChange={(e) => setMappingForm((prev) => ({ ...prev, start_at: e.target.value }))}
                    />
                    <input
                        type="datetime-local"
                        value={mappingForm.end_at}
                        onChange={(e) => setMappingForm((prev) => ({ ...prev, end_at: e.target.value }))}
                    />
                    <button
                        disabled={busy}
                        style={{
                            padding: "8px 12px",
                            border: "none",
                            borderRadius: "var(--radius-small)",
                            background: "var(--primary-blue)",
                            color: "var(--white)",
                            cursor: busy ? "not-allowed" : "pointer",
                        }}
                    >
                        {editingAssignmentId ? "Update" : "Add"}
                    </button>
                </form>
            </div>

            <div
                style={{
                    background: "var(--white)",
                    borderRadius: "var(--radius-standard)",
                    padding: "var(--space-3)",
                    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                }}
            >
                <h3 style={{ fontFamily: "var(--font-heading)", marginBottom: "var(--space-2)" }}>
                    Search by Plate or Driver
                </h3>
                <form onSubmit={runSearch} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", marginBottom: "var(--space-3)" }}>
                    <input
                        placeholder="License plate"
                        value={searchLicensePlate}
                        onChange={(e) => setSearchLicensePlate(e.target.value)}
                    />
                    <input
                        placeholder="Driver name"
                        value={searchDriverName}
                        onChange={(e) => setSearchDriverName(e.target.value)}
                    />
                    <button
                        style={{
                            padding: "8px 12px",
                            border: "none",
                            borderRadius: "var(--radius-small)",
                            background: "var(--primary-blue)",
                            color: "var(--white)",
                            cursor: "pointer",
                        }}
                    >
                        Search
                    </button>
                </form>

                {results.length === 0 ? (
                    <p style={{ opacity: 0.6 }}>No records found</p>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ background: "var(--light-gray)" }}>
                                <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>Driver Name</th>
                                <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>License Plate</th>
                                <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>Start (Date & Time)</th>
                                <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>End (Date & Time)</th>
                                <th style={{ padding: "8px", textAlign: "right", fontSize: "0.75rem" }}>Edit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((item) => (
                                <tr key={item.id} style={{ borderTop: "1px solid var(--light-gray)" }}>
                                    <td style={{ padding: "8px" }}>{item.driver_name}</td>
                                    <td style={{ padding: "8px" }}>{item.license_plate}</td>
                                    <td style={{ padding: "8px" }}>{new Date(item.start_at).toLocaleString()}</td>
                                    <td style={{ padding: "8px" }}>{item.end_at ? new Date(item.end_at).toLocaleString() : "-"}</td>
                                    <td style={{ padding: "8px", textAlign: "right" }}>
                                        <button
                                            onClick={() => editAssignment(item)}
                                            style={{
                                                padding: "4px 8px",
                                                borderRadius: "var(--radius-small)",
                                                border: "1px solid var(--medium-gray)",
                                                background: "var(--white)",
                                                cursor: "pointer",
                                            }}
                                        >
                                            Edit
                                        </button>
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
