import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

interface Driver {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    billing_type: string;
    billing_rate: number;
    weekly_due_day?: string | null;
    billing_active: boolean;
    balance: number;
    created_at: string | null;
}

interface DriversPagePayload {
    items: Driver[];
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    active_count: number;
    balance_total: number;
}

interface NewDriverForm {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    billing_type: string;
    billing_rate: string;
    weekly_due_day: string;
}

const WEEKDAY_OPTIONS = [
    { value: "monday", label: "Monday" },
    { value: "tuesday", label: "Tuesday" },
    { value: "wednesday", label: "Wednesday" },
    { value: "thursday", label: "Thursday" },
    { value: "friday", label: "Friday" },
    { value: "saturday", label: "Saturday" },
    { value: "sunday", label: "Sunday" },
];

const emptyForm: NewDriverForm = {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    billing_type: 'daily',
    billing_rate: '',
    weekly_due_day: 'monday',
};

export default function Drivers() {
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState<NewDriverForm>(emptyForm);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [activeDrivers, setActiveDrivers] = useState(0);
    const [totalBalance, setTotalBalance] = useState(0);

    useEffect(() => {
        loadDrivers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, pageSize, search]);

    async function loadDrivers() {
        setLoading(true);
        try {
            setLoadError('');
            const data = (await api.getDriversPage({
                page,
                pageSize,
                search,
            })) as DriversPagePayload;

            const nextTotalPages = Math.max(1, Number(data.total_pages || 1));
            if (page > nextTotalPages) {
                setPage(nextTotalPages);
                return;
            }

            setDrivers(Array.isArray(data.items) ? data.items : []);
            setTotal(Number(data.total || 0));
            setTotalPages(nextTotalPages);
            setActiveDrivers(Number(data.active_count || 0));
            setTotalBalance(Number(data.balance_total || 0));
        } catch (loadErr: unknown) {
            console.error('Failed to load drivers:', loadErr);
            if (loadErr instanceof Error && loadErr.message) {
                setLoadError(loadErr.message);
            } else {
                setLoadError('Failed to load drivers. Please refresh the page.');
            }
        } finally {
            setLoading(false);
        }
    }

    function openModal() {
        setForm(emptyForm);
        setError('');
        setShowModal(true);
    }

    function closeModal() {
        setShowModal(false);
        setForm(emptyForm);
        setError('');
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');

        if (!form.first_name.trim() || !form.last_name.trim()) {
            setError('First name and last name are required');
            return;
        }
        if (!form.email.trim()) {
            setError('Email is required');
            return;
        }
        if (!form.phone.trim()) {
            setError('Phone is required');
            return;
        }
        if (!form.billing_rate || isNaN(Number(form.billing_rate)) || Number(form.billing_rate) <= 0) {
            setError('Billing rate must be a positive number');
            return;
        }
        if (form.billing_type === 'weekly' && !form.weekly_due_day) {
            setError('Weekly payment due day is required for weekly billing');
            return;
        }

        setSubmitting(true);
        try {
            await api.createDriver({
                first_name: form.first_name.trim(),
                last_name: form.last_name.trim(),
                email: form.email.trim(),
                phone: form.phone.trim(),
                billing_type: form.billing_type,
                billing_rate: Number(form.billing_rate),
                weekly_due_day: form.billing_type === 'weekly' ? form.weekly_due_day : null,
            });
            closeModal();
            setPage(1);
            await loadDrivers();
        } catch (err: unknown) {
            if (err instanceof Error && err.message) {
                setError(err.message);
            } else {
                setError('Failed to create driver. Please check the data and try again.');
            }
        } finally {
            setSubmitting(false);
        }
    }

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: 'var(--space-1) var(--space-2)',
        border: '1px solid var(--medium-gray)',
        borderRadius: 'var(--radius-small)',
        fontSize: '0.875rem',
        color: 'var(--dark-gray)',
        background: 'var(--white)',
        outline: 'none',
        transition: 'border-color 0.2s',
    };

    const labelStyle: React.CSSProperties = {
        display: 'block',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'var(--dark-gray)',
        marginBottom: '4px',
    };

    const firstRowIndex = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const lastRowIndex = total === 0 ? 0 : Math.min(page * pageSize, total);

    return (
        <div style={{ padding: 'var(--space-4)' }}>
            <div style={{ marginBottom: 'var(--space-4)' }}>
                <h1 style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: '1.75rem',
                    color: 'var(--dark-gray)',
                    marginBottom: 'var(--space-1)',
                }}>
                    Drivers
                </h1>
                <p style={{ color: 'var(--dark-gray)', opacity: 0.7 }}>
                    Manage your fleet drivers
                </p>
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-2)',
                marginBottom: 'var(--space-4)',
            }}>
                <div style={{
                    padding: 'var(--space-3)',
                    background: 'var(--white)',
                    border: '1px solid var(--medium-gray)',
                    borderRadius: 'var(--radius-standard)',
                }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--dark-gray)', opacity: 0.6, marginBottom: '4px' }}>
                        Total Drivers
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--dark-gray)' }}>
                        {total}
                    </div>
                </div>
                <div style={{
                    padding: 'var(--space-3)',
                    background: 'var(--white)',
                    border: '1px solid var(--medium-gray)',
                    borderRadius: 'var(--radius-standard)',
                }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--dark-gray)', opacity: 0.6, marginBottom: '4px' }}>
                        Active Billing
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--success-green)' }}>
                        {activeDrivers}
                    </div>
                </div>
                <div style={{
                    padding: 'var(--space-3)',
                    background: 'var(--white)',
                    border: '1px solid var(--medium-gray)',
                    borderRadius: 'var(--radius-standard)',
                }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--dark-gray)', opacity: 0.6, marginBottom: '4px' }}>
                        Total Balance
                    </div>
                    <div style={{
                        fontSize: '1.5rem',
                        fontWeight: 700,
                        fontFamily: 'var(--font-heading)',
                        color: totalBalance >= 0 ? 'var(--success-green)' : 'var(--error-red)',
                    }}>
                        ${totalBalance.toFixed(2)}
                    </div>
                </div>
            </div>

            <div style={{
                background: 'var(--white)',
                borderRadius: 'var(--radius-standard)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                overflow: 'hidden',
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-3)',
                    borderBottom: '1px solid var(--light-gray)',
                    gap: 'var(--space-2)',
                    flexWrap: 'wrap',
                }}>
                    <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1rem', color: 'var(--dark-gray)' }}>
                        All Drivers
                    </h3>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                            type="text"
                            placeholder="Search drivers..."
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                            style={{
                                padding: 'var(--space-1) var(--space-2)',
                                border: '1px solid var(--medium-gray)',
                                borderRadius: 'var(--radius-small)',
                                color: 'var(--dark-gray)',
                                width: '240px',
                                fontSize: '0.875rem',
                            }}
                        />
                        <button
                            onClick={openModal}
                            style={{
                                padding: '8px 16px',
                                background: 'var(--primary-blue)',
                                color: 'var(--white)',
                                border: 'none',
                                borderRadius: 'var(--radius-small)',
                                fontWeight: 600,
                                fontSize: '0.875rem',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            + Add Driver
                        </button>
                    </div>
                </div>

                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px var(--space-3)',
                    borderBottom: '1px solid var(--light-gray)',
                    color: 'var(--dark-gray)',
                    opacity: 0.8,
                    fontSize: '0.875rem',
                }}>
                    <span>{loading ? 'Loading...' : `Showing ${firstRowIndex}-${lastRowIndex} of ${total}`}</span>
                    <span>Page {page} / {totalPages}</span>
                </div>

                {loadError ? (
                    <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--error-red)' }}>
                        {loadError}
                    </div>
                ) : loading ? (
                    <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--dark-gray)' }}>
                        Loading drivers...
                    </div>
                ) : drivers.length === 0 ? (
                    <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--dark-gray)', opacity: 0.6 }}>
                        No drivers found
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'var(--light-gray)' }}>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--dark-gray)', fontWeight: 600, fontSize: '0.875rem' }}>Name</th>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--dark-gray)', fontWeight: 600, fontSize: '0.875rem' }}>Contact</th>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--dark-gray)', fontWeight: 600, fontSize: '0.875rem' }}>Billing</th>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--dark-gray)', fontWeight: 600, fontSize: '0.875rem' }}>Status</th>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', color: 'var(--dark-gray)', fontWeight: 600, fontSize: '0.875rem' }}>Balance</th>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {drivers.map((driver) => (
                                <tr key={driver.id} style={{ borderTop: '1px solid var(--light-gray)' }}>
                                    <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 500, color: 'var(--dark-gray)' }}>
                                        {driver.first_name || driver.last_name
                                            ? `${driver.first_name} ${driver.last_name}`.trim()
                                            : <span style={{ opacity: 0.6, fontStyle: 'italic' }}>{driver.email?.split('@')[0] || 'Unknown'}</span>
                                        }
                                    </td>
                                    <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                        <div style={{ color: 'var(--dark-gray)' }}>{driver.email}</div>
                                        <div style={{ color: 'var(--dark-gray)', opacity: 0.6, fontSize: '0.75rem' }}>{driver.phone}</div>
                                    </td>
                                    <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--dark-gray)' }}>
                                        ${driver.billing_rate}/{driver.billing_type}
                                    </td>
                                    <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                        <span style={{
                                            padding: '4px 8px',
                                            background: driver.billing_active ? '#D4EDDA' : '#E2E3E5',
                                            color: driver.billing_active ? '#155724' : '#383D41',
                                            borderRadius: 'var(--radius-small)',
                                            fontWeight: 500,
                                            fontSize: '0.75rem',
                                        }}>
                                            {driver.billing_active ? 'Active' : 'Paused'}
                                        </span>
                                    </td>
                                    <td style={{
                                        padding: 'var(--space-2) var(--space-3)',
                                        textAlign: 'right',
                                        fontWeight: 600,
                                        color: (driver.balance || 0) >= 0 ? 'var(--success-green)' : 'var(--error-red)',
                                    }}>
                                        ${driver.balance?.toFixed(2) || '0.00'}
                                    </td>
                                    <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}>
                                        <Link
                                            to={`/drivers/${driver.id}`}
                                            style={{
                                                padding: '6px 12px',
                                                background: 'var(--light-gray)',
                                                border: '1px solid var(--medium-gray)',
                                                borderRadius: 'var(--radius-small)',
                                                color: 'var(--dark-gray)',
                                                textDecoration: 'none',
                                                fontSize: '0.875rem',
                                                fontWeight: 500,
                                            }}
                                        >
                                            View
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginTop: 'var(--space-3)',
                flexWrap: 'wrap',
            }}>
                <label style={{ fontSize: '0.8125rem', color: 'var(--dark-gray)', opacity: 0.8 }}>
                    Rows
                    <select
                        value={pageSize}
                        onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                        }}
                        style={{
                            marginLeft: '6px',
                            padding: '7px 10px',
                            border: '1px solid var(--medium-gray)',
                            borderRadius: 'var(--radius-small)',
                            background: 'var(--white)',
                            color: 'var(--dark-gray)',
                            fontWeight: 500,
                        }}
                    >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                    </select>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={loading || page <= 1}
                    style={{
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-small)',
                        border: '1px solid var(--medium-gray)',
                        background: 'var(--white)',
                        cursor: loading || page <= 1 ? 'not-allowed' : 'pointer',
                        opacity: loading || page <= 1 ? 0.6 : 1,
                    }}
                >
                    Prev
                </button>
                <span style={{ fontSize: '0.875rem', color: 'var(--dark-gray)' }}>
                    Page {page} / {totalPages}
                </span>
                <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={loading || page >= totalPages}
                    style={{
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-small)',
                        border: '1px solid var(--medium-gray)',
                        background: 'var(--white)',
                        cursor: loading || page >= totalPages ? 'not-allowed' : 'pointer',
                        opacity: loading || page >= totalPages ? 0.6 : 1,
                    }}
                >
                    Next
                </button>
                </div>
            </div>

            {showModal && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                    }}
                    onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
                >
                    <div style={{
                        background: 'var(--white)',
                        borderRadius: 'var(--radius-standard)',
                        width: '100%',
                        maxWidth: '480px',
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
                        overflow: 'hidden',
                    }}>
                        <div style={{
                            padding: 'var(--space-3) var(--space-4)',
                            borderBottom: '1px solid var(--light-gray)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                        }}>
                            <h2 style={{
                                fontFamily: 'var(--font-heading)',
                                fontSize: '1.25rem',
                                color: 'var(--dark-gray)',
                            }}>
                                Add Driver
                            </h2>
                            <button
                                onClick={closeModal}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    fontSize: '1.25rem',
                                    color: 'var(--dark-gray)',
                                    opacity: 0.5,
                                    cursor: 'pointer',
                                    padding: '4px',
                                    lineHeight: 1,
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} style={{ padding: 'var(--space-4)' }}>
                            {error && (
                                <div style={{
                                    padding: 'var(--space-2)',
                                    background: '#FDECEA',
                                    color: 'var(--error-red)',
                                    borderRadius: 'var(--radius-small)',
                                    fontSize: '0.8125rem',
                                    marginBottom: 'var(--space-3)',
                                }}>
                                    {error}
                                </div>
                            )}

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                                <div>
                                    <label style={labelStyle}>First Name *</label>
                                    <input
                                        style={inputStyle}
                                        value={form.first_name}
                                        onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                                        placeholder="John"
                                    />
                                </div>
                                <div>
                                    <label style={labelStyle}>Last Name *</label>
                                    <input
                                        style={inputStyle}
                                        value={form.last_name}
                                        onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                                        placeholder="Doe"
                                    />
                                </div>
                            </div>

                            <div style={{ marginBottom: 'var(--space-2)' }}>
                                <label style={labelStyle}>Email *</label>
                                <input
                                    style={inputStyle}
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    placeholder="driver@example.com"
                                />
                            </div>

                            <div style={{ marginBottom: 'var(--space-2)' }}>
                                <label style={labelStyle}>Phone *</label>
                                <input
                                    style={inputStyle}
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    placeholder="+1 (555) 123-4567"
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                                <div>
                                    <label style={labelStyle}>Billing Type</label>
                                    <select
                                        style={inputStyle}
                                        value={form.billing_type}
                                        onChange={(e) =>
                                            setForm({
                                                ...form,
                                                billing_type: e.target.value,
                                                weekly_due_day: e.target.value === 'weekly' ? form.weekly_due_day || 'monday' : form.weekly_due_day,
                                            })
                                        }
                                    >
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={labelStyle}>Billing Rate ($) *</label>
                                    <input
                                        style={inputStyle}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={form.billing_rate}
                                        onChange={(e) => setForm({ ...form, billing_rate: e.target.value })}
                                        placeholder="150.00"
                                    />
                                </div>
                                {form.billing_type === 'weekly' && (
                                    <div>
                                        <label style={labelStyle}>Weekly Payment Due Day *</label>
                                        <select
                                            style={inputStyle}
                                            value={form.weekly_due_day}
                                            onChange={(e) => setForm({ ...form, weekly_due_day: e.target.value })}
                                        >
                                            {WEEKDAY_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    style={{
                                        padding: '8px 20px',
                                        background: 'var(--light-gray)',
                                        border: '1px solid var(--medium-gray)',
                                        borderRadius: 'var(--radius-small)',
                                        color: 'var(--dark-gray)',
                                        fontWeight: 500,
                                        fontSize: '0.875rem',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    style={{
                                        padding: '8px 20px',
                                        background: submitting ? 'var(--medium-gray)' : 'var(--primary-blue)',
                                        color: 'var(--white)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-small)',
                                        fontWeight: 600,
                                        fontSize: '0.875rem',
                                        cursor: submitting ? 'not-allowed' : 'pointer',
                                        transition: 'background 0.2s',
                                    }}
                                >
                                    {submitting ? 'Creating...' : 'Add Driver'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
