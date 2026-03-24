import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import SendModal, { getMessageTemplate } from '../components/SendModal';
import { getFieldLabel, sortFormEntries, HIDDEN_FIELDS } from '../utils/formFields';

interface Comment {
    id: string;
    content: string;
    staff_name: string;
    created_at: string;
}

interface Application {
    id: string;
    status: string;
    driver_id?: string | null;
    form_data: Record<string, unknown>;
    comments: Comment[];
    created_at: string;
    updated_at: string;
}

export default function ApplicationDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [application, setApplication] = useState<Application | null>(null);
    const [loading, setLoading] = useState(true);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [modalAction, setModalAction] = useState<string>('');
    const [modalTitle, setModalTitle] = useState('');

    useEffect(() => {
        if (id) loadApplication();
    }, [id]);

    async function loadApplication() {
        try {
            const data = await api.getApplication(id!);
            setApplication(data);
        } catch (error) {
            console.error('Failed to load application:', error);
        } finally {
            setLoading(false);
        }
    }

    function openActionModal(action: string) {
        const titles: Record<string, string> = {
            approved: 'Approve Application',
            hold: 'Put on Hold',
            declined: 'Decline Application',
            onboarding: 'Onboard Driver',
        };
        setModalAction(action);
        setModalTitle(titles[action] || 'Confirm Action');
        setModalOpen(true);
    }

    async function handleConfirmAction(message: string) {
        if (!application) return;
        setSubmitting(true);
        try {
            // Update status
            await api.updateApplicationStatus(application.id, modalAction);

            // Send SMS if there's a message and phone number
            const formData = application.form_data as Record<string, any>;
            const phone = formData.phone || formData.phone_number;
            if (message.trim() && phone) {
                try {
                    await api.sendSms(phone, message);
                } catch (smsError) {
                    console.error('Failed to send SMS:', smsError);
                    // Continue anyway - status was updated
                }
            }

            setModalOpen(false);
            loadApplication();
        } catch (error) {
            console.error('Failed to update status:', error);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleAddComment(e: React.FormEvent) {
        e.preventDefault();
        if (!comment.trim() || !application) return;
        setSubmitting(true);
        try {
            await api.addComment(application.id, comment);
            setComment('');
            loadApplication();
        } catch (error) {
            console.error('Failed to add comment:', error);
        } finally {
            setSubmitting(false);
        }
    }

    if (loading) {
        return <div style={{ padding: 'var(--space-4)', color: 'var(--dark-gray)' }}>Loading application...</div>;
    }

    if (!application) {
        return <div style={{ padding: 'var(--space-4)', color: 'var(--dark-gray)' }}>Application not found</div>;
    }

    const formData = application.form_data as Record<string, any>;

    const statusColors: Record<string, { bg: string; text: string }> = {
        pending: { bg: '#FFF3CD', text: '#856404' },
        approved: { bg: '#D4EDDA', text: '#155724' },
        declined: { bg: '#F8D7DA', text: '#721C24' },
        hold: { bg: '#E2E3E5', text: '#383D41' },
        onboarding: { bg: '#CCE5FF', text: '#004085' },
    };

    const statusStyle = statusColors[application.status] || statusColors.pending;

    return (
        <div style={{ padding: 'var(--space-4)' }}>
            {/* Header */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
                <button
                    onClick={() => navigate('/applications')}
                    style={{
                        padding: 'var(--space-1) var(--space-2)',
                        background: 'var(--light-gray)',
                        border: '1px solid var(--medium-gray)',
                        borderRadius: 'var(--radius-small)',
                        color: 'var(--dark-gray)',
                        marginBottom: 'var(--space-2)',
                        cursor: 'pointer',
                    }}
                >
                    Back to Applications
                </button>
                {application.driver_id && (
                    <button
                        onClick={() => navigate(`/drivers/${application.driver_id}`)}
                        style={{
                            padding: 'var(--space-1) var(--space-2)',
                            background: '#D4EDDA',
                            border: '1px solid #9ad7a0',
                            borderRadius: 'var(--radius-small)',
                            color: '#155724',
                            marginBottom: 'var(--space-2)',
                            marginLeft: '8px',
                            cursor: 'pointer',
                            fontWeight: 600,
                        }}
                    >
                        Open Driver Profile
                    </button>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h1 style={{
                            fontFamily: 'var(--font-heading)',
                            fontSize: '1.75rem',
                            color: 'var(--dark-gray)',
                            marginBottom: 'var(--space-1)',
                        }}>
                            {(() => {
                                const fName = formData.first_name || formData.names; // Fallback to 'names' field if first_name is empty
                                const lName = formData.last_name || '';

                                // Helper to stringify if object
                                const renderPart = (v: unknown) => {
                                    if (typeof v === 'object' && v !== null) {
                                        const obj = v as Record<string, string>;
                                        return `${obj.first_name || ''} ${obj.last_name || ''}`.trim() || JSON.stringify(v);
                                    }
                                    return String(v || '');
                                };

                                return `${renderPart(fName)} ${renderPart(lName)}`.trim() || 'Unknown Applicant';
                            })()}
                        </h1>
                        <p style={{ color: 'var(--dark-gray)', opacity: 0.7 }}>
                            Submitted on {new Date(application.created_at).toLocaleDateString()}
                        </p>
                    </div>
                    <span style={{
                        padding: 'var(--space-1) var(--space-2)',
                        background: statusStyle.bg,
                        color: statusStyle.text,
                        borderRadius: 'var(--radius-small)',
                        fontWeight: 600,
                        textTransform: 'capitalize',
                    }}>
                        {application.status}
                    </span>
                </div>
            </div>

            {/* Main Grid - Application Details left, Actions + Comments right */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)' }}>
                {/* Left Column - Application Details */}
                <div style={{
                    background: 'var(--white)',
                    borderRadius: 'var(--radius-standard)',
                    padding: 'var(--space-4)',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                }}>
                    <h3 style={{
                        fontFamily: 'var(--font-heading)',
                        fontSize: '1.125rem',
                        color: 'var(--dark-gray)',
                        marginBottom: 'var(--space-3)',
                    }}>
                        Application Details
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                        {sortFormEntries(Object.entries(formData).filter(([key]) => !HIDDEN_FIELDS.has(key))).map(([key, value]) => {
                            // Smart Value Formatting
                            let displayValue: React.ReactNode = '-';
                            let stringValue = '';
                            let isSpecialObject = false;

                            if (value === null || value === undefined || value === '') {
                                displayValue = '-';
                                isSpecialObject = true;
                            } else if (typeof value === 'object') {
                                const obj = value as Record<string, unknown>;

                                if (Array.isArray(value)) {
                                    stringValue = value.map(String).join(', ');
                                }
                                else if ((obj.first_name || obj.last_name || obj.First_Name || obj.Last_Name)) {
                                    const first = (obj.first_name || obj.First_Name || obj.first || '') as string;
                                    const last = (obj.last_name || obj.Last_Name || obj.last || '') as string;
                                    displayValue = `${first} ${last}`.trim();
                                    isSpecialObject = true;
                                }
                                else if (obj.address_line_1 || obj.city || obj.state || obj.zip) {
                                    const addr1 = (obj.address_line_1 || '') as string;
                                    const addr2 = (obj.address_line_2 || '') as string;
                                    const city = (obj.city || '') as string;
                                    const state = (obj.state || '') as string;
                                    const zip = (obj.zip || '') as string;
                                    displayValue = [addr1, addr2, city, state, zip].filter(Boolean).join(', ');
                                    isSpecialObject = true;
                                }
                                else {
                                    const values = Object.values(obj).filter(v => typeof v === 'string' || typeof v === 'number');
                                    if (values.length > 0 && values.length < 5) {
                                        stringValue = values.join(', ');
                                    } else {
                                        stringValue = JSON.stringify(value);
                                    }
                                }
                            } else {
                                stringValue = String(value);
                            }

                            if (!isSpecialObject) {
                                if (stringValue.includes('http')) {
                                    const urls = stringValue.split(/[\n,\s]+/).map(u => u.trim()).filter(u => u.startsWith('http'));
                                    if (urls.length > 0) {
                                        displayValue = (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {urls.map((url, idx) => (
                                                    <a
                                                        key={idx}
                                                        href={url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{
                                                            color: 'var(--primary-blue)',
                                                            textDecoration: 'underline',
                                                            wordBreak: 'break-all'
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        View Document {urls.length > 1 ? idx + 1 : ''}
                                                    </a>
                                                ))}
                                            </div>
                                        );
                                    } else {
                                        displayValue = stringValue;
                                    }
                                } else {
                                    displayValue = stringValue;
                                }
                            }

                            return (
                                <div key={key}>
                                    <div style={{
                                        color: 'var(--dark-gray)',
                                        opacity: 0.6,
                                        fontSize: '0.75rem',
                                        textTransform: 'uppercase',
                                        marginBottom: '4px',
                                    }}>
                                        {getFieldLabel(key)}
                                    </div>
                                    <div style={{ color: 'var(--dark-gray)', fontWeight: 500 }}>
                                        {displayValue}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Column - Actions + Comments */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {/* Actions Card */}
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
                            marginBottom: 'var(--space-2)',
                        }}>
                            Actions
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            {application.status === 'pending' && (
                                <>
                                    <button
                                        onClick={() => openActionModal('approved')}
                                        style={{
                                            padding: 'var(--space-2)',
                                            background: 'var(--success-green)',
                                            border: 'none',
                                            borderRadius: 'var(--radius-small)',
                                            color: 'var(--white)',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Approve
                                    </button>
                                    <button
                                        onClick={() => openActionModal('hold')}
                                        style={{
                                            padding: 'var(--space-2)',
                                            background: 'var(--light-gray)',
                                            border: '1px solid var(--medium-gray)',
                                            borderRadius: 'var(--radius-small)',
                                            color: 'var(--dark-gray)',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Put on Hold
                                    </button>
                                    <button
                                        onClick={() => openActionModal('declined')}
                                        style={{
                                            padding: 'var(--space-2)',
                                            background: 'var(--error-red)',
                                            border: 'none',
                                            borderRadius: 'var(--radius-small)',
                                            color: 'var(--white)',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Decline
                                    </button>
                                </>
                            )}
                            {application.status === 'hold' && (
                                <>
                                    <button
                                        onClick={() => openActionModal('approved')}
                                        style={{
                                            padding: 'var(--space-2)',
                                            background: 'var(--success-green)',
                                            border: 'none',
                                            borderRadius: 'var(--radius-small)',
                                            color: 'var(--white)',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Approve
                                    </button>
                                    <button
                                        onClick={() => openActionModal('declined')}
                                        style={{
                                            padding: 'var(--space-2)',
                                            background: 'var(--error-red)',
                                            border: 'none',
                                            borderRadius: 'var(--radius-small)',
                                            color: 'var(--white)',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Decline
                                    </button>
                                </>
                            )}
                            {application.status === 'approved' && (
                                <button
                                    onClick={() => openActionModal('onboarding')}
                                    style={{
                                        padding: 'var(--space-2)',
                                        background: 'var(--primary-blue)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-small)',
                                        color: 'var(--white)',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Onboard Driver
                                </button>
                            )}
                            {(application.status === 'declined' || application.status === 'onboarding') && (
                                <p style={{ color: 'var(--dark-gray)', opacity: 0.6, textAlign: 'center', padding: 'var(--space-2)' }}>
                                    Application has been {application.status === 'onboarding' ? 'onboarded' : application.status}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Comments Card */}
                    <div style={{
                        background: 'var(--white)',
                        borderRadius: 'var(--radius-standard)',
                        padding: 'var(--space-3)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                        flex: 1,
                    }}>
                        <h3 style={{
                            fontFamily: 'var(--font-heading)',
                            fontSize: '1rem',
                            color: 'var(--dark-gray)',
                            marginBottom: 'var(--space-2)',
                        }}>
                            Staff Comments
                        </h3>

                        <form onSubmit={handleAddComment} style={{ marginBottom: 'var(--space-3)' }}>
                            <textarea
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="Add a comment..."
                                style={{
                                    width: '100%',
                                    padding: 'var(--space-2)',
                                    border: '1px solid var(--medium-gray)',
                                    borderRadius: 'var(--radius-small)',
                                    color: 'var(--dark-gray)',
                                    resize: 'vertical',
                                    minHeight: '80px',
                                    marginBottom: 'var(--space-2)',
                                    boxSizing: 'border-box',
                                    fontSize: '0.875rem',
                                }}
                            />
                            <button
                                type="submit"
                                disabled={submitting || !comment.trim()}
                                style={{
                                    padding: 'var(--space-1) var(--space-2)',
                                    background: 'var(--primary-blue)',
                                    border: 'none',
                                    borderRadius: 'var(--radius-small)',
                                    color: 'var(--white)',
                                    fontWeight: 500,
                                    cursor: submitting || !comment.trim() ? 'not-allowed' : 'pointer',
                                    opacity: submitting || !comment.trim() ? 0.6 : 1,
                                }}
                            >
                                Add Comment
                            </button>
                        </form>

                        {application.comments.length === 0 ? (
                            <p style={{ color: 'var(--dark-gray)', opacity: 0.5, fontSize: '0.875rem' }}>
                                No comments yet
                            </p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                {application.comments.map((c) => (
                                    <div key={c.id} style={{
                                        padding: 'var(--space-2)',
                                        background: 'var(--light-gray)',
                                        borderRadius: 'var(--radius-small)',
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span style={{ fontWeight: 600, color: 'var(--primary-blue)', fontSize: '0.875rem' }}>
                                                {c.staff_name || 'Staff'}
                                            </span>
                                            <span style={{ color: 'var(--dark-gray)', opacity: 0.5, fontSize: '0.75rem' }}>
                                                {new Date(c.created_at).toLocaleString()}
                                            </span>
                                        </div>
                                        <p style={{ margin: 0, color: 'var(--dark-gray)', fontSize: '0.875rem' }}>
                                            {c.content}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Send Modal */}
            <SendModal
                isOpen={modalOpen}
                title={modalTitle}
                defaultMessage={getMessageTemplate(modalAction)}
                onCancel={() => setModalOpen(false)}
                onConfirm={handleConfirmAction}
                loading={submitting}
            />
        </div>
    );
}
