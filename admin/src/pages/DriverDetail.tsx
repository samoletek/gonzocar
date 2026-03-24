import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import api from "../services/api";
import { getFieldLabel, HIDDEN_FIELDS, sortFormEntries } from "../utils/formFields";

interface Driver {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    billing_type: string;
    billing_rate: number;
    billing_active: boolean;
    billing_status: "active" | "paused" | "terminated";
    deposit_required: number;
    deposit_posted: number;
    deposit_updated_at: string | null;
    terminated_at: string | null;
    balance: number;
    created_at: string;
    portal_token?: string;
    application_info?: Record<string, unknown>;
}

interface LedgerEntry {
    id: string;
    type: "credit" | "debit";
    amount: number;
    description: string;
    entry_source?: string;
    reversal_of_id?: string | null;
    created_at: string;
}

interface Alias {
    id: string;
    alias_type: string;
    alias_value: string;
}

interface VehicleAssignment {
    id: string;
    driver_id: string;
    driver_name: string;
    license_plate: string;
    start_at: string;
    end_at: string | null;
    previous_assignment_id: string | null;
    created_at: string;
    updated_at: string;
}

interface PortalLink {
    token: string;
    path: string;
}

interface ProfileForm {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    billing_type: string;
    billing_rate: string;
    deposit_required: string;
    deposit_posted: string;
}

interface ManualEntryForm {
    entry_type: "charge" | "credit";
    amount: string;
    date: string;
    notes: string;
}

interface AssignmentForm {
    license_plate: string;
    start_at: string;
    end_at: string;
}

function isFileLikeField(key: string): boolean {
    const normalized = key.toLowerCase();
    return (
        normalized.includes("image-upload")
        || normalized.includes("upload")
        || normalized.includes("file")
        || normalized.includes("document")
        || normalized.includes("attachment")
        || normalized.includes("photo")
    );
}

function stringifyProfileValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function looksLikeHttpUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

function normalizeDisplayText(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";

    // Normalize comma-separated text that comes from form joins like "Uber,Uber eats,lyft".
    if (trimmed.includes(",") && !trimmed.includes(", ")) {
        const parts = trimmed
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
        if (parts.length > 1) {
            return parts.join(", ");
        }
    }

    return trimmed;
}

function getStringValue(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = normalizeDisplayText(value);
    return normalized || null;
}

function renderApplicationValue(value: unknown, depth = 0): React.ReactNode {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    if (typeof value === "boolean") {
        return value ? "Yes" : "No";
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value.toLocaleString() : String(value);
    }

    if (typeof value === "string") {
        const normalized = normalizeDisplayText(value);
        if (!normalized) return "-";

        // If a JSON string slipped into storage, render it as structured content.
        if ((normalized.startsWith("{") && normalized.endsWith("}")) || (normalized.startsWith("[") && normalized.endsWith("]"))) {
            try {
                const parsed = JSON.parse(normalized);
                return renderApplicationValue(parsed, depth + 1);
            } catch {
                // Keep raw text if this is not actually valid JSON.
            }
        }

        if (looksLikeHttpUrl(normalized)) {
            return (
                <a href={normalized} target="_blank" rel="noreferrer" style={{ color: "var(--primary-blue)" }}>
                    {normalized}
                </a>
            );
        }

        return normalized;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) return "-";

        return (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {value.map((item, index) => (
                    <div key={index} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: "8px", alignItems: "start" }}>
                        <span style={{ opacity: 0.55, fontSize: "0.75rem", lineHeight: 1.5 }}>{index + 1}.</span>
                        <div style={{ wordBreak: "break-word" }}>{renderApplicationValue(item, depth + 1)}</div>
                    </div>
                ))}
            </div>
        );
    }

    if (typeof value === "object") {
        const objectValue = value as Record<string, unknown>;
        const entries = Object.entries(objectValue);
        if (entries.length === 0) return "-";

        const firstName = getStringValue(objectValue.first_name ?? objectValue.firstname ?? objectValue.first);
        const lastName = getStringValue(objectValue.last_name ?? objectValue.lastname ?? objectValue.last);
        if (firstName || lastName) {
            const fullName = [firstName, lastName].filter(Boolean).join(" ");
            if (fullName) {
                return fullName;
            }
        }

        const addressLine1 = getStringValue(objectValue.address_line_1 ?? objectValue.address1 ?? objectValue.street);
        const addressLine2 = getStringValue(objectValue.address_line_2 ?? objectValue.address2);
        const city = getStringValue(objectValue.city);
        const state = getStringValue(objectValue.state);
        const zip = getStringValue(objectValue.zip ?? objectValue.zip_code ?? objectValue.postal_code);
        const cityStateZip = [city, state].filter(Boolean).join(", ") + ((city || state) && zip ? ` ${zip}` : zip ? `${zip}` : "");
        const hasAddressShape = Boolean(addressLine1 || addressLine2 || city || state || zip);
        if (hasAddressShape) {
            const lines = [addressLine1, addressLine2, cityStateZip].filter((line): line is string => Boolean(line));
            if (lines.length > 0) {
                return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        {lines.map((line, index) => (
                            <div key={`${line}-${index}`}>{line}</div>
                        ))}
                    </div>
                );
            }
        }

        if (depth >= 2) {
            return (
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: "0.8rem" }}>
                    {JSON.stringify(objectValue, null, 2)}
                </pre>
            );
        }

        return (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {entries.map(([childKey, childValue]) => (
                    <div key={childKey} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 160px) 1fr", gap: "8px" }}>
                        <div style={{ fontSize: "0.72rem", opacity: 0.6, textTransform: "uppercase" }}>
                            {getFieldLabel(childKey)}
                        </div>
                        <div style={{ wordBreak: "break-word" }}>{renderApplicationValue(childValue, depth + 1)}</div>
                    </div>
                ))}
            </div>
        );
    }

    return String(value);
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

function normalizeNameForCompare(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export default function DriverDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [driver, setDriver] = useState<Driver | null>(null);
    const [ledger, setLedger] = useState<LedgerEntry[]>([]);
    const [aliases, setAliases] = useState<Alias[]>([]);
    const [assignments, setAssignments] = useState<VehicleAssignment[]>([]);
    const [portalLink, setPortalLink] = useState<PortalLink | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteConfirmName, setDeleteConfirmName] = useState("");
    const [deleteError, setDeleteError] = useState("");

    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [profileForm, setProfileForm] = useState<ProfileForm>({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        billing_type: "daily",
        billing_rate: "",
        deposit_required: "0",
        deposit_posted: "0",
    });

    const [manualForm, setManualForm] = useState<ManualEntryForm>({
        entry_type: "charge",
        amount: "",
        date: "",
        notes: "",
    });

    const [newAliasType, setNewAliasType] = useState("zelle");
    const [newAliasValue, setNewAliasValue] = useState("");

    const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>({
        license_plate: "",
        start_at: toDateTimeLocal(new Date().toISOString()),
        end_at: "",
    });
    const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);

    const [swapPlate, setSwapPlate] = useState("");
    const [swapStartAt, setSwapStartAt] = useState(toDateTimeLocal(new Date().toISOString()));
    const [isEditingApplicationInfo, setIsEditingApplicationInfo] = useState(false);
    const [applicationInfoDraft, setApplicationInfoDraft] = useState<Record<string, string>>({});
    const [applicationInfoError, setApplicationInfoError] = useState("");

    useEffect(() => {
        if (id) loadData({ showSpinner: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    async function loadData(options?: { showSpinner?: boolean }) {
        if (!id) return;
        const showSpinner = options?.showSpinner ?? false;
        try {
            if (showSpinner) {
                setLoading(true);
            }
            const [driverData, ledgerData, aliasData, assignmentData, portalData] = await Promise.all([
                api.getDriver(id),
                api.getDriverLedger(id),
                api.getDriverAliases(id),
                api.getDriverVehicleAssignments(id),
                api.getDriverPortalLink(id),
            ]);

            setDriver(driverData);
            setLedger(ledgerData);
            setAliases(aliasData);
            setAssignments(assignmentData);
            setPortalLink(portalData);
            setIsEditingApplicationInfo(false);
            setApplicationInfoError("");

            const draft: Record<string, string> = {};
            const rawInfo = (driverData.application_info ?? {}) as Record<string, unknown>;
            Object.entries(rawInfo).forEach(([key, value]) => {
                draft[key] = stringifyProfileValue(value);
            });
            setApplicationInfoDraft(draft);

            setProfileForm({
                first_name: driverData.first_name ?? "",
                last_name: driverData.last_name ?? "",
                email: driverData.email ?? "",
                phone: driverData.phone ?? "",
                billing_type: driverData.billing_type ?? "daily",
                billing_rate: String(driverData.billing_rate ?? ""),
                deposit_required: String(driverData.deposit_required ?? 0),
                deposit_posted: String(driverData.deposit_posted ?? 0),
            });
        } catch (error) {
            console.error("Failed to load driver details:", error);
        } finally {
            if (showSpinner) {
                setLoading(false);
            }
        }
    }

    const portalUrl = useMemo(() => {
        if (!portalLink?.path) return "";
        return `${window.location.origin}${portalLink.path}`;
    }, [portalLink]);

    async function handleProfileSave() {
        if (!driver || !id) return;
        setBusy(true);
        try {
            await api.updateDriver(id, {
                first_name: profileForm.first_name.trim(),
                last_name: profileForm.last_name.trim(),
                email: profileForm.email.trim(),
                phone: profileForm.phone.trim(),
                billing_type: profileForm.billing_type,
                billing_rate: Number(profileForm.billing_rate || 0),
                deposit_required: Number(profileForm.deposit_required || 0),
                deposit_posted: Number(profileForm.deposit_posted || 0),
                deposit_updated_at: new Date().toISOString(),
            });
            setIsEditingProfile(false);
            await loadData();
        } catch (error) {
            console.error("Failed to update driver profile:", error);
        } finally {
            setBusy(false);
        }
    }

    async function handleBillingStatusChange(status: "active" | "paused" | "terminated") {
        if (!id) return;
        setBusy(true);
        try {
            await api.updateDriverBillingStatus(id, status);
            await loadData();
        } catch (error) {
            console.error("Failed to update billing status:", error);
        } finally {
            setBusy(false);
        }
    }

    async function handleManualLedgerSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!id || !manualForm.amount) return;
        setBusy(true);
        try {
            await api.createManualLedgerEntry(id, {
                entry_type: manualForm.entry_type,
                amount: Number(manualForm.amount),
                date: toIsoOrUndefined(manualForm.date),
                notes: manualForm.notes.trim() || undefined,
            });
            setManualForm({
                entry_type: "charge",
                amount: "",
                date: "",
                notes: "",
            });
            await loadData();
        } catch (error) {
            const ext = error as Error & { status?: number; data?: any };
            if (ext.status === 409) {
                const proceed = window.confirm(
                    `${ext.data?.detail?.message || "Entry overlaps existing record"}. Save anyway?`
                );
                if (proceed) {
                    try {
                        await api.createManualLedgerEntry(id, {
                            entry_type: manualForm.entry_type,
                            amount: Number(manualForm.amount),
                            date: toIsoOrUndefined(manualForm.date),
                            notes: manualForm.notes.trim() || undefined,
                            acknowledge_overlap: true,
                        });
                        setManualForm({
                            entry_type: "charge",
                            amount: "",
                            date: "",
                            notes: "",
                        });
                        await loadData();
                    } catch (secondError) {
                        console.error("Failed to save manual ledger entry after confirmation:", secondError);
                    }
                }
            } else {
                console.error("Failed to create manual ledger entry:", error);
            }
        } finally {
            setBusy(false);
        }
    }

    async function handleCancelLedgerEntry(entryId: string) {
        if (!id) return;
        const proceed = window.confirm("Cancel this ledger entry by creating a reversal?");
        if (!proceed) return;
        setBusy(true);
        try {
            await api.cancelLedgerEntry(id, entryId, "Canceled by staff");
            await loadData();
        } catch (error) {
            console.error("Failed to cancel ledger entry:", error);
        } finally {
            setBusy(false);
        }
    }

    async function handleAddAlias(e: React.FormEvent) {
        e.preventDefault();
        if (!id || !newAliasValue.trim()) return;
        setBusy(true);
        try {
            await api.createDriverAlias(id, {
                alias_type: newAliasType,
                alias_value: newAliasValue.trim(),
            });
            setNewAliasValue("");
            await loadData();
        } catch (error) {
            console.error("Failed to create alias:", error);
        } finally {
            setBusy(false);
        }
    }

    async function handleDeleteAlias(aliasId: string) {
        if (!id) return;
        setBusy(true);
        try {
            await api.deleteDriverAlias(id, aliasId);
            await loadData();
        } catch (error) {
            console.error("Failed to delete alias:", error);
        } finally {
            setBusy(false);
        }
    }

    function openDeleteDriverModal() {
        setDeleteError("");
        setDeleteConfirmName("");
        setDeleteModalOpen(true);
    }

    function closeDeleteDriverModal() {
        if (busy) return;
        setDeleteModalOpen(false);
        setDeleteConfirmName("");
        setDeleteError("");
    }

    async function handleDeleteDriver() {
        if (!id || !driver) return;
        const expectedFullName = `${driver.first_name} ${driver.last_name}`.trim();
        const matches = normalizeNameForCompare(deleteConfirmName) === normalizeNameForCompare(expectedFullName);
        if (!matches) return;

        setBusy(true);
        setDeleteError("");
        try {
            await api.deleteDriver(id, deleteConfirmName);
            setDeleteModalOpen(false);
            navigate("/drivers");
        } catch (error) {
            setDeleteError(error instanceof Error ? error.message : "Failed to delete driver");
        } finally {
            setBusy(false);
        }
    }

    async function handleAssignmentSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!id || !assignmentForm.license_plate || !assignmentForm.start_at) return;
        setBusy(true);

        const normalizedEndAt = assignmentForm.end_at
            ? toIsoOrUndefined(assignmentForm.end_at)
            : editingAssignmentId
              ? null
              : undefined;

        const payload = {
            license_plate: assignmentForm.license_plate.trim(),
            start_at: toIsoOrUndefined(assignmentForm.start_at),
            end_at: normalizedEndAt,
        };

        try {
            if (editingAssignmentId) {
                await api.updateVehicleAssignment(editingAssignmentId, payload);
            } else {
                await api.createVehicleAssignment({
                    driver_id: id,
                    ...payload,
                });
            }
            setAssignmentForm({
                license_plate: "",
                start_at: toDateTimeLocal(new Date().toISOString()),
                end_at: "",
            });
            setEditingAssignmentId(null);
            await loadData();
        } catch (error) {
            const ext = error as Error & { status?: number; data?: any };
            if (ext.status === 409) {
                const proceed = window.confirm(
                    `${ext.data?.detail?.message || "Assignment overlaps existing record"}. Save anyway?`
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
                                driver_id: id,
                                ...payload,
                                acknowledge_overlap: true,
                            });
                        }
                        setAssignmentForm({
                            license_plate: "",
                            start_at: toDateTimeLocal(new Date().toISOString()),
                            end_at: "",
                        });
                        setEditingAssignmentId(null);
                        await loadData();
                    } catch (secondError) {
                        console.error("Failed to save assignment after confirmation:", secondError);
                    }
                }
            } else {
                console.error("Failed to save assignment:", error);
            }
        } finally {
            setBusy(false);
        }
    }

    function startEditingAssignment(item: VehicleAssignment) {
        setEditingAssignmentId(item.id);
        setAssignmentForm({
            license_plate: item.license_plate,
            start_at: toDateTimeLocal(item.start_at),
            end_at: toDateTimeLocal(item.end_at),
        });
    }

    async function handleSwapVehicle(e: React.FormEvent) {
        e.preventDefault();
        if (!id || !swapPlate.trim()) return;
        setBusy(true);
        try {
            await api.swapVehicle(id, {
                new_license_plate: swapPlate.trim(),
                start_at: toIsoOrUndefined(swapStartAt),
            });
            setSwapPlate("");
            setSwapStartAt(toDateTimeLocal(new Date().toISOString()));
            await loadData();
        } catch (error) {
            const ext = error as Error & { status?: number; data?: any };
            if (ext.status === 409) {
                const proceed = window.confirm(
                    `${ext.data?.detail?.message || "Swap overlaps existing record"}. Save anyway?`
                );
                if (proceed) {
                    try {
                        await api.swapVehicle(id, {
                            new_license_plate: swapPlate.trim(),
                            start_at: toIsoOrUndefined(swapStartAt),
                            acknowledge_overlap: true,
                        });
                        setSwapPlate("");
                        setSwapStartAt(toDateTimeLocal(new Date().toISOString()));
                        await loadData();
                    } catch (secondError) {
                        console.error("Failed to swap vehicle after confirmation:", secondError);
                    }
                }
            } else {
                console.error("Failed to swap vehicle:", error);
            }
        } finally {
            setBusy(false);
        }
    }

    async function handleSaveApplicationInfo() {
        if (!id || !driver?.application_info) return;
        setBusy(true);
        setApplicationInfoError("");
        try {
            const nextInfo: Record<string, unknown> = { ...(driver.application_info as Record<string, unknown>) };
            for (const [key, originalValue] of Object.entries(nextInfo)) {
                if (HIDDEN_FIELDS.has(key) || isFileLikeField(key)) {
                    continue;
                }

                const rawValue = applicationInfoDraft[key] ?? stringifyProfileValue(originalValue);
                if (typeof originalValue === "number") {
                    const parsed = Number(rawValue);
                    if (Number.isNaN(parsed)) {
                        setApplicationInfoError(`Field "${getFieldLabel(key)}" must be a number.`);
                        setBusy(false);
                        return;
                    }
                    nextInfo[key] = parsed;
                } else if (typeof originalValue === "boolean") {
                    const normalized = rawValue.trim().toLowerCase();
                    nextInfo[key] = normalized === "true" || normalized === "1" || normalized === "yes";
                } else if (typeof originalValue === "object" && originalValue !== null) {
                    if (!rawValue.trim()) {
                        nextInfo[key] = null;
                    } else {
                        try {
                            nextInfo[key] = JSON.parse(rawValue);
                        } catch {
                            setApplicationInfoError(`Field "${getFieldLabel(key)}" must contain valid JSON.`);
                            setBusy(false);
                            return;
                        }
                    }
                } else {
                    nextInfo[key] = rawValue;
                }
            }

            await api.updateDriver(id, { application_info: nextInfo });
            await loadData();
            setIsEditingApplicationInfo(false);
        } catch (error) {
            console.error("Failed to update application info:", error);
        } finally {
            setBusy(false);
        }
    }

    if (loading) {
        return <div style={{ padding: "var(--space-4)", color: "var(--dark-gray)" }}>Loading driver...</div>;
    }

    if (!driver) {
        return <div style={{ padding: "var(--space-4)", color: "var(--dark-gray)" }}>Driver not found</div>;
    }

    const expectedDeleteName = `${driver.first_name} ${driver.last_name}`.trim();
    const deleteNameMatches =
        normalizeNameForCompare(deleteConfirmName) === normalizeNameForCompare(expectedDeleteName);

    const renderBillingBadge = (statusValue: Driver["billing_status"]) => {
        const map: Record<Driver["billing_status"], { bg: string; color: string; label: string }> = {
            active: { bg: "#D4EDDA", color: "#155724", label: "Active" },
            paused: { bg: "#FFF3CD", color: "#856404", label: "Paused" },
            terminated: { bg: "#F8D7DA", color: "#721C24", label: "Terminated" },
        };
        const style = map[statusValue];
        return (
            <span
                style={{
                    padding: "4px 8px",
                    background: style.bg,
                    color: style.color,
                    borderRadius: "var(--radius-small)",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                }}
            >
                {style.label}
            </span>
        );
    };

    const billingControlButtons: Array<{
        status: Driver["billing_status"];
        label: string;
        activeBg: string;
        activeBorder: string;
        activeText: string;
        activeRing: string;
    }> = [
        {
            status: "active",
            label: "Active",
            activeBg: "#D4EDDA",
            activeBorder: "#58b56a",
            activeText: "#155724",
            activeRing: "rgba(88, 181, 106, 0.28)",
        },
        {
            status: "paused",
            label: "Pause",
            activeBg: "#FFF3CD",
            activeBorder: "#d0b047",
            activeText: "#856404",
            activeRing: "rgba(208, 176, 71, 0.28)",
        },
        {
            status: "terminated",
            label: "Terminate",
            activeBg: "#F8D7DA",
            activeBorder: "#ca5f6b",
            activeText: "#721C24",
            activeRing: "rgba(202, 95, 107, 0.24)",
        },
    ];

    const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "8px 10px",
        border: "1px solid var(--medium-gray)",
        borderRadius: "var(--radius-small)",
        fontSize: "0.875rem",
        color: "var(--dark-gray)",
    };

    return (
        <div style={{ padding: "var(--space-4)" }}>
            <div style={{ marginBottom: "var(--space-4)" }}>
                <button
                    onClick={() => navigate("/drivers")}
                    style={{
                        padding: "var(--space-1) var(--space-2)",
                        background: "var(--light-gray)",
                        border: "1px solid var(--medium-gray)",
                        borderRadius: "var(--radius-small)",
                        color: "var(--dark-gray)",
                        marginBottom: "var(--space-2)",
                        cursor: "pointer",
                    }}
                >
                    Back to Drivers
                </button>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-3)" }}>
                    <div>
                        <h1
                            style={{
                                fontFamily: "var(--font-heading)",
                                fontSize: "1.75rem",
                                color: "var(--dark-gray)",
                                marginBottom: "var(--space-1)",
                            }}
                        >
                            {driver.first_name} {driver.last_name}
                        </h1>
                        <p style={{ color: "var(--dark-gray)", opacity: 0.7 }}>
                            Driver since {new Date(driver.created_at).toLocaleDateString()}
                        </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                        <div
                            style={{
                                fontSize: "2rem",
                                fontWeight: 700,
                                fontFamily: "var(--font-heading)",
                                color: (driver.balance || 0) >= 0 ? "var(--success-green)" : "var(--error-red)",
                            }}
                        >
                            ${driver.balance?.toFixed(2) || "0.00"}
                        </div>
                        <div style={{ color: "var(--dark-gray)", opacity: 0.6, fontSize: "0.875rem" }}>Current Balance</div>
                    </div>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
                <div
                    style={{
                        background: "var(--white)",
                        borderRadius: "var(--radius-standard)",
                        padding: "var(--space-3)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", color: "var(--dark-gray)" }}>Driver Profile</h3>
                        <button
                            onClick={() => setIsEditingProfile((v) => !v)}
                            style={{
                                padding: "4px 10px",
                                border: "1px solid var(--medium-gray)",
                                borderRadius: "var(--radius-small)",
                                background: "var(--light-gray)",
                                color: "var(--dark-gray)",
                                cursor: "pointer",
                            }}
                        >
                            {isEditingProfile ? "Cancel" : "Edit"}
                        </button>
                    </div>

                    {isEditingProfile ? (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                            <div>
                                <div style={{ fontSize: "0.75rem", marginBottom: "4px" }}>First Name</div>
                                <input
                                    style={inputStyle}
                                    value={profileForm.first_name}
                                    onChange={(e) => setProfileForm((prev) => ({ ...prev, first_name: e.target.value }))}
                                />
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", marginBottom: "4px" }}>Last Name</div>
                                <input
                                    style={inputStyle}
                                    value={profileForm.last_name}
                                    onChange={(e) => setProfileForm((prev) => ({ ...prev, last_name: e.target.value }))}
                                />
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", marginBottom: "4px" }}>Email</div>
                                <input
                                    style={inputStyle}
                                    value={profileForm.email}
                                    onChange={(e) => setProfileForm((prev) => ({ ...prev, email: e.target.value }))}
                                />
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", marginBottom: "4px" }}>Phone</div>
                                <input
                                    style={inputStyle}
                                    value={profileForm.phone}
                                    onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                                />
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", marginBottom: "4px" }}>Billing Type</div>
                                <select
                                    style={inputStyle}
                                    value={profileForm.billing_type}
                                    onChange={(e) => setProfileForm((prev) => ({ ...prev, billing_type: e.target.value }))}
                                >
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                </select>
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", marginBottom: "4px" }}>Billing Rate</div>
                                <input
                                    type="number"
                                    step="0.01"
                                    style={inputStyle}
                                    value={profileForm.billing_rate}
                                    onChange={(e) => setProfileForm((prev) => ({ ...prev, billing_rate: e.target.value }))}
                                />
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", marginBottom: "4px" }}>Deposit Required</div>
                                <input
                                    type="number"
                                    step="0.01"
                                    style={inputStyle}
                                    value={profileForm.deposit_required}
                                    onChange={(e) => setProfileForm((prev) => ({ ...prev, deposit_required: e.target.value }))}
                                />
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", marginBottom: "4px" }}>Deposit Posted</div>
                                <input
                                    type="number"
                                    step="0.01"
                                    style={inputStyle}
                                    value={profileForm.deposit_posted}
                                    onChange={(e) => setProfileForm((prev) => ({ ...prev, deposit_posted: e.target.value }))}
                                />
                            </div>
                            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
                                <button
                                    disabled={busy}
                                    onClick={handleProfileSave}
                                    style={{
                                        padding: "8px 14px",
                                        background: "var(--primary-blue)",
                                        border: "none",
                                        borderRadius: "var(--radius-small)",
                                        color: "var(--white)",
                                        fontWeight: 600,
                                        cursor: busy ? "not-allowed" : "pointer",
                                        opacity: busy ? 0.7 : 1,
                                    }}
                                >
                                    Save Profile
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                            <div>
                                <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Contact</div>
                                <div>{driver.email}</div>
                                <div>{driver.phone}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Billing</div>
                                <div>
                                    ${driver.billing_rate} / {driver.billing_type}
                                </div>
                                <div style={{ marginTop: "4px" }}>{renderBillingBadge(driver.billing_status)}</div>
                                {driver.terminated_at && (
                                    <div style={{ fontSize: "0.75rem", color: "var(--error-red)", marginTop: "4px" }}>
                                        Terminated: {new Date(driver.terminated_at).toLocaleString()}
                                    </div>
                                )}
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Deposit Required</div>
                                <div>${Number(driver.deposit_required || 0).toFixed(2)}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Deposit Posted</div>
                                <div>${Number(driver.deposit_posted || 0).toFixed(2)}</div>
                                <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>
                                    Updated: {driver.deposit_updated_at ? new Date(driver.deposit_updated_at).toLocaleString() : "-"}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div
                    style={{
                        background: "var(--white)",
                        borderRadius: "var(--radius-standard)",
                        padding: "var(--space-3)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--space-2)",
                    }}
                >
                    <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", color: "var(--dark-gray)" }}>Billing Controls</h3>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Current Status</div>
                        {renderBillingBadge(driver.billing_status)}
                    </div>
                    {billingControlButtons.map((item) => {
                        const isCurrent = driver.billing_status === item.status;
                        return (
                            <button
                                key={item.status}
                                disabled={busy}
                                onClick={() => handleBillingStatusChange(item.status)}
                                style={{
                                    padding: "8px 12px",
                                    background: isCurrent ? item.activeBg : "var(--white)",
                                    border: `${isCurrent ? 2 : 1}px solid ${isCurrent ? item.activeBorder : "var(--medium-gray)"}`,
                                    borderRadius: "var(--radius-small)",
                                    color: isCurrent ? item.activeText : "var(--dark-gray)",
                                    fontWeight: isCurrent ? 700 : 600,
                                    boxShadow: isCurrent ? `0 0 0 2px ${item.activeRing}` : "none",
                                    cursor: busy ? "not-allowed" : "pointer",
                                    opacity: busy ? 0.75 : 1,
                                }}
                            >
                                {item.label}
                            </button>
                        );
                    })}

                    <hr style={{ border: "none", borderTop: "1px solid var(--light-gray)" }} />
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Driver Portal</div>
                    <div style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{portalUrl || "No link"}</div>
                    {portalUrl && (
                        <a
                            href={portalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: "inline-block",
                                marginTop: "4px",
                                color: "var(--primary-blue)",
                                fontWeight: 600,
                                textDecoration: "none",
                            }}
                        >
                            Open Live Portal
                        </a>
                    )}
                </div>
            </div>

            {driver.application_info && Object.keys(driver.application_info).length > 0 && (
                <div
                    style={{
                        background: "var(--white)",
                        borderRadius: "var(--radius-standard)",
                        padding: "var(--space-4)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                        marginBottom: "var(--space-4)",
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", color: "var(--dark-gray)" }}>
                            Full Profile (Application Data)
                        </h3>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <button
                                disabled={busy}
                                onClick={openDeleteDriverModal}
                                style={{
                                    padding: "4px 10px",
                                    border: "1px solid #ca5f6b",
                                    borderRadius: "var(--radius-small)",
                                    background: "#F8D7DA",
                                    color: "#721C24",
                                    cursor: busy ? "not-allowed" : "pointer",
                                    opacity: busy ? 0.75 : 1,
                                }}
                            >
                                Delete
                            </button>
                            <button
                                onClick={() => {
                                    setIsEditingApplicationInfo((current) => !current);
                                    setApplicationInfoError("");
                                }}
                                style={{
                                    padding: "4px 10px",
                                    border: "1px solid var(--medium-gray)",
                                    borderRadius: "var(--radius-small)",
                                    background: "var(--light-gray)",
                                    color: "var(--dark-gray)",
                                    cursor: "pointer",
                                }}
                            >
                                {isEditingApplicationInfo ? "Cancel" : "Edit"}
                            </button>
                        </div>
                    </div>

                    {applicationInfoError && (
                        <div
                            style={{
                                marginBottom: "var(--space-2)",
                                color: "var(--error-red)",
                                fontSize: "0.875rem",
                            }}
                        >
                            {applicationInfoError}
                        </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                        {sortFormEntries(Object.entries(driver.application_info).filter(([key]) => !HIDDEN_FIELDS.has(key))).map(([key, value]) => {
                            const isFileField = isFileLikeField(key);
                            const draftValue = applicationInfoDraft[key] ?? stringifyProfileValue(value);
                            const useTextarea = typeof value === "object" || draftValue.length > 120 || draftValue.includes("\n");

                            return (
                                <div key={key}>
                                    <div style={{ fontSize: "0.75rem", opacity: 0.6, textTransform: "uppercase", marginBottom: "4px" }}>
                                        {getFieldLabel(key)}
                                    </div>
                                    {isEditingApplicationInfo && !isFileField ? (
                                        useTextarea ? (
                                            <textarea
                                                style={{ ...inputStyle, minHeight: "84px", fontFamily: typeof value === "object" ? "monospace" : "inherit" }}
                                                value={draftValue}
                                                onChange={(e) =>
                                                    setApplicationInfoDraft((prev) => ({
                                                        ...prev,
                                                        [key]: e.target.value,
                                                    }))
                                                }
                                            />
                                        ) : (
                                            <input
                                                style={inputStyle}
                                                value={draftValue}
                                                onChange={(e) =>
                                                    setApplicationInfoDraft((prev) => ({
                                                        ...prev,
                                                        [key]: e.target.value,
                                                    }))
                                                }
                                            />
                                        )
                                    ) : (
                                        <div style={{ fontWeight: 500, wordBreak: "break-word" }}>
                                            {renderApplicationValue(value)}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {isEditingApplicationInfo && (
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
                            <button
                                disabled={busy}
                                onClick={handleSaveApplicationInfo}
                                style={{
                                    padding: "8px 14px",
                                    background: "var(--primary-blue)",
                                    border: "none",
                                    borderRadius: "var(--radius-small)",
                                    color: "var(--white)",
                                    fontWeight: 600,
                                    cursor: busy ? "not-allowed" : "pointer",
                                    opacity: busy ? 0.7 : 1,
                                }}
                            >
                                Save Application Data
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
                <div
                    style={{
                        background: "var(--white)",
                        borderRadius: "var(--radius-standard)",
                        padding: "var(--space-3)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", color: "var(--dark-gray)" }}>Ledger History</h3>
                    </div>
                    {ledger.length === 0 ? (
                        <p style={{ color: "var(--dark-gray)", opacity: 0.6 }}>No transactions yet</p>
                    ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr style={{ background: "var(--light-gray)" }}>
                                    <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>Date</th>
                                    <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>Description</th>
                                    <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>Source</th>
                                    <th style={{ padding: "8px", textAlign: "right", fontSize: "0.75rem" }}>Amount</th>
                                    <th style={{ padding: "8px", textAlign: "right", fontSize: "0.75rem" }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ledger.map((entry) => (
                                    <tr key={entry.id} style={{ borderTop: "1px solid var(--light-gray)" }}>
                                        <td style={{ padding: "8px", fontSize: "0.875rem" }}>{new Date(entry.created_at).toLocaleString()}</td>
                                        <td style={{ padding: "8px", fontSize: "0.875rem" }}>{entry.description || "-"}</td>
                                        <td style={{ padding: "8px", fontSize: "0.75rem", textTransform: "uppercase" }}>{entry.entry_source || "system"}</td>
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
                                        <td style={{ padding: "8px", textAlign: "right" }}>
                                            {entry.entry_source !== "reversal" && !entry.reversal_of_id ? (
                                                <button
                                                    disabled={busy}
                                                    onClick={() => handleCancelLedgerEntry(entry.id)}
                                                    style={{
                                                        padding: "4px 8px",
                                                        borderRadius: "var(--radius-small)",
                                                        border: "1px solid var(--medium-gray)",
                                                        background: "var(--light-gray)",
                                                        cursor: busy ? "not-allowed" : "pointer",
                                                        fontSize: "0.75rem",
                                                    }}
                                                >
                                                    Cancel Entry
                                                </button>
                                            ) : (
                                                <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div
                    style={{
                        background: "var(--white)",
                        borderRadius: "var(--radius-standard)",
                        padding: "var(--space-3)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                    }}
                >
                    <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", color: "var(--dark-gray)", marginBottom: "var(--space-2)" }}>
                        Manual Entry
                    </h3>
                    <form onSubmit={handleManualLedgerSubmit} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <select
                            style={inputStyle}
                            value={manualForm.entry_type}
                            onChange={(e) =>
                                setManualForm((prev) => ({ ...prev, entry_type: e.target.value as "charge" | "credit" }))
                            }
                        >
                            <option value="charge">Manual Charge (+debit)</option>
                            <option value="credit">Manual Credit (-debt)</option>
                        </select>
                        <input
                            style={inputStyle}
                            type="number"
                            step="0.01"
                            min="0.01"
                            placeholder="Amount"
                            value={manualForm.amount}
                            onChange={(e) => setManualForm((prev) => ({ ...prev, amount: e.target.value }))}
                        />
                        <input
                            style={inputStyle}
                            type="datetime-local"
                            value={manualForm.date}
                            onChange={(e) => setManualForm((prev) => ({ ...prev, date: e.target.value }))}
                        />
                        <textarea
                            style={{ ...inputStyle, minHeight: "80px" }}
                            placeholder="Notes / explanation"
                            value={manualForm.notes}
                            onChange={(e) => setManualForm((prev) => ({ ...prev, notes: e.target.value }))}
                        />
                        <button
                            type="submit"
                            disabled={busy}
                            style={{
                                padding: "8px 12px",
                                background: "var(--primary-blue)",
                                color: "var(--white)",
                                border: "none",
                                borderRadius: "var(--radius-small)",
                                fontWeight: 600,
                                cursor: busy ? "not-allowed" : "pointer",
                            }}
                        >
                            Add Manual Entry
                        </button>
                    </form>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
                <div
                    style={{
                        background: "var(--white)",
                        borderRadius: "var(--radius-standard)",
                        padding: "var(--space-3)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                    }}
                >
                    <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", color: "var(--dark-gray)", marginBottom: "var(--space-2)" }}>
                        Payment Aliases
                    </h3>
                    <form onSubmit={handleAddAlias} style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: "8px", marginBottom: "var(--space-2)" }}>
                        <select style={inputStyle} value={newAliasType} onChange={(e) => setNewAliasType(e.target.value)}>
                            <option value="zelle">zelle</option>
                            <option value="venmo">venmo</option>
                            <option value="cashapp">cashapp</option>
                            <option value="chime">chime</option>
                            <option value="email">email</option>
                            <option value="phone">phone</option>
                        </select>
                        <input
                            style={inputStyle}
                            placeholder="Alias value (e.g. Rebecca handle)"
                            value={newAliasValue}
                            onChange={(e) => setNewAliasValue(e.target.value)}
                        />
                        <button
                            type="submit"
                            disabled={busy}
                            style={{
                                padding: "8px 10px",
                                border: "none",
                                borderRadius: "var(--radius-small)",
                                background: "var(--primary-blue)",
                                color: "var(--white)",
                                cursor: busy ? "not-allowed" : "pointer",
                            }}
                        >
                            Add
                        </button>
                    </form>
                    {aliases.length === 0 ? (
                        <p style={{ fontSize: "0.875rem", opacity: 0.6 }}>No aliases configured</p>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            {aliases.map((alias) => (
                                <div
                                    key={alias.id}
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        background: "var(--light-gray)",
                                        borderRadius: "var(--radius-small)",
                                        padding: "8px 10px",
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: "0.65rem", textTransform: "uppercase", opacity: 0.6 }}>{alias.alias_type}</div>
                                        <div>{alias.alias_value}</div>
                                    </div>
                                    <button
                                        disabled={busy}
                                        onClick={() => handleDeleteAlias(alias.id)}
                                        style={{
                                            padding: "4px 8px",
                                            border: "1px solid var(--medium-gray)",
                                            borderRadius: "var(--radius-small)",
                                            background: "var(--white)",
                                            cursor: busy ? "not-allowed" : "pointer",
                                        }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div
                    style={{
                        background: "var(--white)",
                        borderRadius: "var(--radius-standard)",
                        padding: "var(--space-3)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                    }}
                >
                    <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", color: "var(--dark-gray)", marginBottom: "var(--space-2)" }}>
                        Swap Vehicle
                    </h3>
                    <form onSubmit={handleSwapVehicle} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--dark-gray)", opacity: 0.7, textTransform: "uppercase" }}>
                                New License Plate
                            </span>
                            <input
                                style={inputStyle}
                                placeholder="New license plate"
                                value={swapPlate}
                                onChange={(e) => setSwapPlate(e.target.value)}
                            />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--dark-gray)", opacity: 0.7, textTransform: "uppercase" }}>
                                Start Date/Time
                            </span>
                            <input
                                style={inputStyle}
                                type="datetime-local"
                                value={swapStartAt}
                                onChange={(e) => setSwapStartAt(e.target.value)}
                            />
                        </label>
                        <button
                            type="submit"
                            disabled={busy}
                            style={{
                                padding: "8px 12px",
                                border: "none",
                                borderRadius: "var(--radius-small)",
                                background: "var(--primary-blue)",
                                color: "var(--white)",
                                fontWeight: 600,
                                cursor: busy ? "not-allowed" : "pointer",
                            }}
                        >
                            Swap Vehicle
                        </button>
                    </form>
                </div>
            </div>

            <div
                style={{
                    background: "var(--white)",
                    borderRadius: "var(--radius-standard)",
                    padding: "var(--space-3)",
                    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                }}
            >
                <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1rem", color: "var(--dark-gray)", marginBottom: "var(--space-2)" }}>
                    Vehicle Assignments
                </h3>
                <form onSubmit={handleAssignmentSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "8px", marginBottom: "var(--space-3)" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--dark-gray)", opacity: 0.7, textTransform: "uppercase" }}>
                            License Plate
                        </span>
                        <input
                            style={inputStyle}
                            placeholder="License plate"
                            value={assignmentForm.license_plate}
                            onChange={(e) => setAssignmentForm((prev) => ({ ...prev, license_plate: e.target.value }))}
                        />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--dark-gray)", opacity: 0.7, textTransform: "uppercase" }}>
                            Start Date/Time
                        </span>
                        <input
                            style={inputStyle}
                            type="datetime-local"
                            value={assignmentForm.start_at}
                            onChange={(e) => setAssignmentForm((prev) => ({ ...prev, start_at: e.target.value }))}
                        />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--dark-gray)", opacity: 0.7, textTransform: "uppercase" }}>
                            End Date/Time
                        </span>
                        <input
                            style={inputStyle}
                            type="datetime-local"
                            value={assignmentForm.end_at}
                            onChange={(e) => setAssignmentForm((prev) => ({ ...prev, end_at: e.target.value }))}
                        />
                    </label>
                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                        <button
                            type="submit"
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
                    </div>
                </form>

                {assignments.length === 0 ? (
                    <p style={{ opacity: 0.6 }}>No vehicle assignments yet</p>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ background: "var(--light-gray)" }}>
                                <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>Plate</th>
                                <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>Start Date/Time</th>
                                <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>End Date/Time</th>
                                <th style={{ padding: "8px", textAlign: "left", fontSize: "0.75rem" }}>Chain</th>
                                <th style={{ padding: "8px", textAlign: "right", fontSize: "0.75rem" }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {assignments.map((item) => (
                                <tr key={item.id} style={{ borderTop: "1px solid var(--light-gray)" }}>
                                    <td style={{ padding: "8px" }}>{item.license_plate}</td>
                                    <td style={{ padding: "8px" }}>{new Date(item.start_at).toLocaleString()}</td>
                                    <td style={{ padding: "8px" }}>{item.end_at ? new Date(item.end_at).toLocaleString() : "-"}</td>
                                    <td style={{ padding: "8px", fontSize: "0.75rem" }}>{item.previous_assignment_id || "-"}</td>
                                    <td style={{ padding: "8px", textAlign: "right" }}>
                                        <button
                                            onClick={() => startEditingAssignment(item)}
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

            {deleteModalOpen && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0, 0, 0, 0.5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1200,
                        padding: "16px",
                    }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            closeDeleteDriverModal();
                        }
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            maxWidth: "520px",
                            background: "var(--white)",
                            borderRadius: "var(--radius-standard)",
                            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
                            padding: "var(--space-4)",
                        }}
                    >
                        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: "1.125rem", color: "#721C24", marginBottom: "8px" }}>
                            Delete Driver
                        </h3>
                        <p style={{ color: "var(--dark-gray)", marginBottom: "8px" }}>
                            This will permanently delete this driver and related data.
                        </p>
                        <p style={{ color: "var(--dark-gray)", marginBottom: "var(--space-2)" }}>
                            Type exactly: <strong>{expectedDeleteName}</strong>
                        </p>
                        <input
                            style={inputStyle}
                            value={deleteConfirmName}
                            onChange={(e) => setDeleteConfirmName(e.target.value)}
                            placeholder="First Name Last Name"
                        />
                        {deleteError && (
                            <div style={{ marginTop: "8px", color: "var(--error-red)", fontSize: "0.875rem" }}>
                                {deleteError}
                            </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "var(--space-3)" }}>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={closeDeleteDriverModal}
                                style={{
                                    padding: "8px 12px",
                                    borderRadius: "var(--radius-small)",
                                    border: "1px solid var(--medium-gray)",
                                    background: "var(--light-gray)",
                                    color: "var(--dark-gray)",
                                    cursor: busy ? "not-allowed" : "pointer",
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={busy || !deleteNameMatches}
                                onClick={handleDeleteDriver}
                                style={{
                                    padding: "8px 12px",
                                    borderRadius: "var(--radius-small)",
                                    border: "none",
                                    background: busy || !deleteNameMatches ? "var(--medium-gray)" : "var(--error-red)",
                                    color: "var(--white)",
                                    fontWeight: 700,
                                    cursor: busy || !deleteNameMatches ? "not-allowed" : "pointer",
                                }}
                            >
                                {busy ? "Deleting..." : "Delete Driver"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
