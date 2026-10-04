import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Radio,
  RefreshCw,
  Ticket,
  UserRound,
  UserX,
  XCircle,
} from 'lucide-react'
import { DashboardLayout } from '../App'
import { api } from '../lib/api'
import { useQueueStream } from '../lib/useQueueStream'

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function StaffDashboard() {
  const { queueState, streamError } = useQueueStream()
  const [department, setDepartment] = useState(null)
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshQueue = useCallback(async () => {
    try {
      const { data } = await api.get('/staff/queue')
      setDepartment(data.department)
      setTokens(data.tokens)
      setError('')
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load the department queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => refreshQueue(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshQueue])

  useEffect(() => {
    if (!queueState) return
    const timer = window.setTimeout(() => refreshQueue(), 0)
    return () => window.clearTimeout(timer)
  }, [queueState, refreshQueue])

  const activeToken = useMemo(
    () => tokens.find((token) => token.status === 'in_progress') || null,
    [tokens],
  )
  const waitingTokens = useMemo(
    () => tokens.filter((token) => token.status === 'waiting'),
    [tokens],
  )

  async function callNext() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data } = await api.post('/staff/queue/next')
      setNotice(`${data.token.token_number} is now being served.`)
      await refreshQueue()
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'The next token could not be called.')
    } finally {
      setBusy(false)
    }
  }

  async function updateToken(token, status) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data } = await api.patch(`/staff/tokens/${token.id}`, { status })
      setNotice(
        status === 'resolved'
          ? `${data.token.token_number} has been marked resolved.`
          : `${data.token.token_number} has been marked as a no-show.`,
      )
      await refreshQueue()
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'The token status could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardLayout
      eyebrow="SERVICE DESK"
      title={department?.name || 'Your department queue'}
      subtitle="Call the next student, manage the active visit, and keep the line moving."
      dashboardClassName="staff-dashboard-content"
    >
      {error && <div className="alert alert-error" role="alert"><XCircle size={17} />{error}</div>}
      {notice && <div className="alert alert-success" role="status"><CheckCircle2 size={17} />{notice}</div>}

      <section className="metric-grid staff-metrics">
        <article className="metric-card"><span className="metric-icon icon-amber"><Clock3 size={19} /></span><div><small>Waiting</small><strong>{loading ? '—' : waitingTokens.length}</strong></div><span className="metric-aside">In this queue</span></article>
        <article className="metric-card"><span className="metric-icon icon-violet"><Radio size={19} /></span><div><small>Now serving</small><strong className="metric-token">{activeToken?.token_number || '—'}</strong></div><span className="metric-aside">Active token</span></article>
        <article className="metric-card"><span className="metric-icon icon-blue"><Ticket size={19} /></span><div><small>Service pace</small><strong>{department ? `${department.estimated_service_minutes}m` : '—'}</strong></div><span className="metric-aside">Estimated per visit</span></article>
      </section>

      <div className="staff-grid">
        <section className="panel service-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">SERVICE DESK</span><h2>Now serving</h2><p>Manage the student currently at your desk.</p></div>
            <span className="live-indicator"><span /> LIVE</span>
          </div>
          {activeToken ? (
            <div className="current-token-card">
              <div className="current-token-top"><span>ACTIVE TOKEN</span><span className="status-badge status-in_progress">In progress</span></div>
              <div className="current-token-number">{activeToken.token_number}</div>
              <div className="current-token-student"><span className="avatar avatar-large"><UserRound size={19} /></span><span><strong>{activeToken.student_name}</strong><small>Arrived at {formatTime(activeToken.created_at)}</small></span></div>
              <div className="service-actions">
                <button className="button button-primary" type="button" onClick={() => updateToken(activeToken, 'resolved')} disabled={busy}><Check size={17} /> Resolve visit</button>
                <button className="button button-secondary" type="button" onClick={() => updateToken(activeToken, 'no_show')} disabled={busy}><UserX size={17} /> No-show</button>
              </div>
            </div>
          ) : (
            <div className="service-idle">
              <span className="idle-icon"><Ticket size={25} /></span>
              <strong>{loading ? 'Loading your queue…' : 'Ready for the next student'}</strong>
              <span>{loading ? 'Connecting to your department.' : 'When you’re ready, call the next token in line.'}</span>
              <button className="button button-primary call-next-button" type="button" onClick={callNext} disabled={busy || loading || waitingTokens.length === 0}>
                {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}
                {busy ? 'Updating queue…' : waitingTokens.length ? 'Call next token' : 'Queue is clear'}
              </button>
            </div>
          )}
        </section>

        <section className="panel staff-queue-panel">
          <div className="panel-heading compact-heading">
            <div><span className="panel-kicker">UP NEXT</span><h2>Waiting list</h2></div>
            <span className="count-pill">{waitingTokens.length}</span>
          </div>
          {loading ? (
            <div className="empty-compact"><span className="loading-ring small" /> Loading waiting list…</div>
          ) : waitingTokens.length === 0 ? (
            <div className="empty-compact"><span className="empty-icon"><CheckCircle2 size={20} /></span><strong>No one waiting</strong><span>New tokens appear here automatically.</span></div>
          ) : (
            <div className="staff-token-list">
              {waitingTokens.map((token, index) => <article className="staff-token-row" key={token.id}>
                <span className="queue-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="queue-avatar"><UserRound size={16} /></span>
                <span className="staff-token-person"><strong>{token.student_name}</strong><small>{token.token_number}</small></span>
                <span className="staff-token-time"><Clock3 size={13} /> {formatTime(token.created_at)}</span>
              </article>)}
            </div>
          )}
          {streamError && <div className="stream-notice"><RefreshCw size={13} /> {streamError}</div>}
        </section>
      </div>

      <div className="staff-tip"><CircleAlert size={17} /><span><strong>Queue tip</strong> Resolve or mark the current visit as a no-show before calling the next token. Students see queue changes as they happen.</span></div>
    </DashboardLayout>
  )
}
