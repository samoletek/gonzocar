import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

interface SystemStatus {
    database: { status: string; message: string };
    openphone: { status: string; message: string };
    gmail: { status: string; message: string };
}

export default function Settings() {
    const { user } = useAuth();
    const [status, setStatus] = useState<SystemStatus | null>(null);
    const [initialLoading, setInitialLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        loadStatus(false);
    }, []);

    async function loadStatus(asRefresh: boolean) {
        if (asRefresh) {
            setRefreshing(true);
        } else {
            setInitialLoading(true);
        }
        try {
            const data = await api.getSystemStatus();
            setStatus(data);
        } catch (error) {
            console.error('Failed to load status:', error);
        } finally {
            if (asRefresh) {
                setRefreshing(false);
            } else {
                setInitialLoading(false);
            }
        }
    }

    const statusColors: Record<string, { bg: string; text: string }> = {
        ok: { bg: '#D4EDDA', text: '#155724' },
        warning: { bg: '#FFF3CD', text: '#856404' },
        error: { bg: '#F8D7DA', text: '#721C24' },
    };

    function getStatusBadge(s: { status: string; message: string } | undefined) {
        if (!s) {
            return (
                <span style={{
                    padding: '4px 8px',
                    background: '#E2E3E5',
                    color: '#383D41',
                    borderRadius: 'var(--radius-small)',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                }}>
                    Loading...
                </span>
            );
        }

        const statusStyle = statusColors[s.status] || statusColors.warning;
        return (
            <span style={{
                padding: '4px 8px',
                background: statusStyle.bg,
                color: statusStyle.text,
                borderRadius: 'var(--radius-small)',
                fontSize: '0.75rem',
                fontWeight: 500,
            }}>
                {s.message}
            </span>
        );
    }

    return (
        <div style={{ padding: 'var(--space-4)' }}>
            {/* Header */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
                <h1 style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: '1.75rem',
                    color: 'var(--dark-gray)',
                    marginBottom: 'var(--space-1)',
                }}>
                    Settings
                </h1>
                <p style={{ color: 'var(--dark-gray)', opacity: 0.7 }}>
                    System configuration and staff management
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                {/* Your Profile */}
                <div style={{
                    background: 'var(--white)',
                    borderRadius: 'var(--radius-standard)',
                    padding: 'var(--space-3)',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                }}>
                    <h3 style={{
                        fontFamily: 'var(--font-heading)',
                        fontSize: '1rem',
                        color: 'var(--dark-gray)',
                        marginBottom: 'var(--space-3)',
                    }}>
                        Your Profile
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        <div>
                            <div style={{ color: 'var(--dark-gray)', opacity: 0.6, fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px' }}>
                                Name
                            </div>
                            <div style={{ color: 'var(--dark-gray)', fontSize: '1.1rem', fontWeight: 500 }}>{user?.name}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--dark-gray)', opacity: 0.6, fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px' }}>
                                Email
                            </div>
                            <div style={{ color: 'var(--dark-gray)' }}>{user?.email}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--dark-gray)', opacity: 0.6, fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px' }}>
                                Role
                            </div>
                            <span style={{
                                padding: '4px 8px',
                                background: user?.role === 'admin' ? '#D4EDDA' : '#FFF3CD',
                                color: user?.role === 'admin' ? '#155724' : '#856404',
                                borderRadius: 'var(--radius-small)',
                                fontSize: '0.75rem',
                                fontWeight: 500,
                                textTransform: 'capitalize',
                            }}>
                                {user?.role}
                            </span>
                        </div>
                    </div>
                </div>

                {/* System Status */}
                <div style={{
                    background: 'var(--white)',
                    borderRadius: 'var(--radius-standard)',
                    padding: 'var(--space-3)',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                        <h3 style={{
                            fontFamily: 'var(--font-heading)',
                            fontSize: '1rem',
                            color: 'var(--dark-gray)',
                        }}>
                            System Status
                        </h3>
                        <button
                            onClick={() => loadStatus(true)}
                            disabled={refreshing}
                            style={{
                                marginLeft: 'var(--space-2)',
                                background: refreshing ? 'var(--medium-gray)' : 'var(--light-gray)',
                                border: '1px solid var(--medium-gray)',
                                borderRadius: 'var(--radius-small)',
                                padding: '4px 8px',
                                color: refreshing ? 'var(--dark-gray)' : 'var(--primary-blue)',
                                cursor: refreshing ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                opacity: refreshing ? 0.8 : 1,
                            }}
                        >
                            {refreshing ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>
                    {refreshing && (
                        <div style={{ marginBottom: 'var(--space-2)', fontSize: '0.75rem', color: 'var(--dark-gray)', opacity: 0.75 }}>
                            Updating all integration statuses...
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--dark-gray)' }}>Backend API</span>
                            <span style={{
                                padding: '4px 8px',
                                background: '#D4EDDA',
                                color: '#155724',
                                borderRadius: 'var(--radius-small)',
                                fontSize: '0.75rem',
                                fontWeight: 500,
                            }}>
                                Connected
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--dark-gray)' }}>Database</span>
                            {getStatusBadge(initialLoading ? undefined : status?.database)}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--dark-gray)' }}>Gmail API</span>
                            {getStatusBadge(initialLoading ? undefined : status?.gmail)}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--dark-gray)' }}>OpenPhone SMS</span>
                            {getStatusBadge(initialLoading ? undefined : status?.openphone)}
                        </div>
                    </div>
                </div>

                {/* Cron Jobs */}
                <div style={{
                    gridColumn: 'span 2',
                    background: 'var(--white)',
                    borderRadius: 'var(--radius-standard)',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                    overflow: 'hidden',
                }}>
                    <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--light-gray)' }}>
                        <h3 style={{
                            fontFamily: 'var(--font-heading)',
                            fontSize: '1rem',
                            color: 'var(--dark-gray)',
                        }}>
                            Cron Jobs
                        </h3>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'var(--light-gray)' }}>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--dark-gray)', fontWeight: 600, fontSize: '0.75rem' }}>Job</th>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--dark-gray)', fontWeight: 600, fontSize: '0.75rem' }}>Schedule</th>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--dark-gray)', fontWeight: 600, fontSize: '0.75rem' }}>Description</th>
                                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--dark-gray)', fontWeight: 600, fontSize: '0.75rem' }}>Command</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style={{ borderTop: '1px solid var(--light-gray)' }}>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 500, color: 'var(--dark-gray)' }}>Payment Parser</td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                    <code style={{ background: 'var(--light-gray)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--dark-gray)' }}>*/5 * * * *</code>
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--dark-gray)', fontSize: '0.875rem' }}>Parse payment emails from Gmail every 5 minutes</td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                    <code style={{ color: 'var(--primary-blue)', fontSize: '0.75rem' }}>python scripts/parse_payments.py</code>
                                </td>
                            </tr>
                            <tr style={{ borderTop: '1px solid var(--light-gray)' }}>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 500, color: 'var(--dark-gray)' }}>Midnight Billing</td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                    <code style={{ background: 'var(--light-gray)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--dark-gray)' }}>0 0 * * *</code>
                                </td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)', color: 'var(--dark-gray)', fontSize: '0.875rem' }}>Create daily debits, check late payments, send SMS</td>
                                <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                    <code style={{ color: 'var(--primary-blue)', fontSize: '0.75rem' }}>python scripts/midnight_billing.py</code>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
