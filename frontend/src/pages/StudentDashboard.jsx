import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MapPin,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Ticket,
  X,
  XCircle,
} from 'lucide-react'
import { DashboardLayout } from '../App'
import { api } from '../lib/api'
import { useQueueStream } from '../lib/useQueueStream'

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function tokenPosition(token, queueState) {
  const department = queueState?.departments?.find(
    (item) => item.id === token.department_id,
  )
  if (!department) {
    return {
      position: token.position,
      eta: token.estimated_wait_minutes,
      status: token.status,
    }
  }
  const positionInQueue = department.tokens.findIndex((item) => item.id === token.id)
  if (positionInQueue < 0) {
    return { position: null, eta: null, status: token.status }
  }
  const liveToken = department.tokens[positionInQueue]
  if (liveToken.status === 'in_progress') {
    return { position: 0, eta: 0, status: liveToken.status }
  }
  const ahead = department.tokens.slice(0, positionInQueue)
  const waitingAhead = ahead.filter((item) => item.status === 'waiting').length
  const inProgressAhead = ahead.filter((item) => item.status === 'in_progress').length
  return {
    position: waitingAhead + 1,
    eta: (waitingAhead + inProgressAhead) * department.estimated_service_minutes,
    status: liveToken.status,
  }
}

function StatusBadge({ status }) {
  const label = {
    waiting: 'Waiting',
    in_progress: 'In progress',
    resolved: 'Resolved',
    no_show: 'No-show',
    cancelled: 'Cancelled',
  }[status] || status
  return <span className={`status-badge status-${status}`}>{label}</span>
}

export default function StudentDashboard() {
  const { queueState, streamError } = useQueueStream()
  const [departments, setDepartments] = useState([])
  const [tokens, setTokens] = useState([])
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(false)
  const [busyToken, setBusyToken] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshTokens = useCallback(async () => {
    const { data } = await api.get('/tokens/mine')
    setTokens(data.tokens)
  }, [])

  const refreshInitialData = useCallback(async () => {
    setError('')
    try {
      const [{ data: departmentData }, { data: tokenData }] = await Promise.all([
        api.get('/departments'),
        api.get('/tokens/mine'),
      ])
      setDepartments(departmentData.departments)
      setTokens(tokenData.tokens)
      setSelectedDepartment((current) =>
        current && departmentData.departments.some((item) => String(item.id) === current)
          ? current
          : String(departmentData.departments[0]?.id || ''),
      )
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load campus queue data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => refreshInitialData(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshInitialData])

  useEffect(() => {
    if (!queueState) return
    const timer = window.setTimeout(() => {
      refreshTokens().catch((requestError) => {
        setError(requestError.response?.data?.error || 'Could not refresh your token history.')
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [queueState, refreshTokens])

  const activeTokens = useMemo(
    () => tokens.filter((token) => ['waiting', 'in_progress'].includes(token.status)),
    [tokens],
  )
  const resolvedCount = useMemo(
    () => tokens.filter((token) => token.status === 'resolved').length,
    [tokens],
  )

  async function bookToken(event) {
    event.preventDefault()
    if (!selectedDepartment) {
      setError('There are no available departments to join.')
      return
    }
    setBooking(true)
    setError('')
    setNotice('')
    try {
      const { data } = await api.post('/tokens', {
        department_id: Number(selectedDepartment),
      })
      setTokens((current) => [data.token, ...current])
      setNotice(`You’re in the queue. Your token is ${data.token.token_number}.`)
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Your token could not be booked.')
    } finally {
      setBooking(false)
    }
  }

  async function cancelToken(token) {
    setBusyToken(token.id)
    setError('')
    setNotice('')
    try {
      const { data } = await api.delete(`/tokens/${token.id}`)
      setTokens((current) => current.map((item) => item.id === token.id ? data.token : item))
      setNotice(`${token.token_number} has been cancelled.`)
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'This token could not be cancelled.')
    } finally {
      setBusyToken(null)
    }
  }

  return (
    <DashboardLayout
      eyebrow="STUDENT PORTAL"
      title="Your campus, without the wait."
      subtitle="Book a place, keep an eye on your queue, and spend your time where you want."
      dashboardClassName="student-dashboard-content"
    >
      {error && <div className="alert alert-error" role="alert"><XCircle size={17} />{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss"><X size={16} /></button></div>}
      {notice && <div className="alert alert-success" role="status"><CheckCircle2 size={17} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}

      <section className="metric-grid student-metrics">
        <article className="metric-card"><span className="metric-icon icon-violet"><Ticket size={19} /></span><div><small>Active tokens</small><strong>{loading ? '—' : activeTokens.length}</strong></div><span className="metric-aside">In your name</span></article>
        <article className="metric-card"><span className="metric-icon icon-green"><CheckCircle2 size={19} /></span><div><small>Resolved visits</small><strong>{loading ? '—' : resolvedCount}</strong></div><span className="metric-aside">All time</span></article>
        <article className="metric-card"><span className="metric-icon icon-blue"><Radio size={19} /></span><div><small>Live departments</small><strong>{queueState ? queueState.departments.length : '—'}</strong></div><span className="metric-aside">{streamError ? 'Reconnecting' : 'Connected live'}</span></article>
      </section>

      <div className="student-grid">
        <section className="panel booking-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">SKIP THE LINE</span><h2>Get a queue token</h2><p>Choose a service desk to reserve your place.</p></div>
            <span className="panel-symbol"><Plus size={20} /></span>
          </div>
          <form onSubmit={bookToken} className="booking-form">
            <label className="field">
              <span className="field-label">Campus service</span>
              <span className="select-wrap"><MapPin size={17} /><select value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)} disabled={loading || !departments.length} required>
                {departments.length === 0 && <option value="">No departments available</option>}
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name} · {department.prefix}</option>)}
              </select></span>
            </label>
            {selectedDepartment && departments.length > 0 && (
              <div className="service-estimate">
                <Clock3 size={15} />
                <span>About {departments.find((item) => String(item.id) === selectedDepartment)?.estimated_service_minutes} min per visit</span>
                <span className="live-dot" />
                <span>Live queue</span>
              </div>
            )}
            <button className="button button-primary full-width" type="submit" disabled={booking || loading || !departments.length}>
              {booking ? <><LoaderCircle size={17} className="spin" /> Booking your place…</> : <>Join this queue <ArrowUpRight size={17} /></>}
            </button>
          </form>
          <div className="booking-note"><ShieldCheck size={15} /> Your token is linked to your account and can be cancelled while waiting.</div>
        </section>

        <section className="panel live-panel">
          <div className="panel-heading compact-heading">
            <div><span className="panel-kicker">CAMPUS RIGHT NOW</span><h2>Live queues</h2></div>
            <span className="live-indicator"><span /> LIVE</span>
          </div>
          {!queueState ? (
            <div className="empty-compact"><span className="loading-ring small" /> Connecting to campus queues…</div>
          ) : queueState.departments.length === 0 ? (
            <div className="empty-compact">No service departments are available yet.</div>
          ) : (
            <div className="queue-overview">
              {queueState.departments.map((department) => {
                const serving = department.tokens.find((token) => token.status === 'in_progress')
                return <div className="queue-overview-row" key={department.id}>
                  <span className="queue-avatar">{department.prefix.slice(0, 2)}</span>
                  <span className="queue-overview-name"><strong>{department.name}</strong><small>{department.waiting_count} waiting</small></span>
                  <span className="queue-overview-serving">{serving ? <><small>NOW SERVING</small><strong>{serving.token_number}</strong></> : <small>No one being served</small>}</span>
                </div>
              })}
            </div>
          )}
          {streamError && <div className="stream-notice"><RefreshCw size={13} /> {streamError}</div>}
        </section>
      </div>

      <section className="panel history-panel">
        <div className="panel-heading history-heading">
          <div><span className="panel-kicker">YOUR SERVICE ACTIVITY</span><h2>My tokens</h2><p>Your active place in line and recent visits.</p></div>
          <span className="history-total"><Ticket size={15} /> {tokens.length} total</span>
        </div>
        {loading ? (
          <div className="empty-state"><span className="loading-ring small" /> Loading your tokens…</div>
        ) : tokens.length === 0 ? (
          <div className="empty-state"><span className="empty-icon"><Ticket size={20} /></span><strong>No tokens yet</strong><span>When you join a campus queue, your token will show up here.</span></div>
        ) : (
          <div className="token-list">
            {tokens.map((token) => {
              const live = tokenPosition(token, queueState)
              return <article className={`token-row ${['waiting', 'in_progress'].includes(token.status) ? 'token-row-active' : ''}`} key={token.id}>
                <span className={`token-symbol ${token.status === 'in_progress' ? 'token-symbol-serving' : ''}`}><Ticket size={18} /></span>
                <div className="token-main"><strong>{token.token_number}</strong><span>{token.department_name}</span></div>
                <div className="token-position">
                  {token.status === 'in_progress' ? <><strong className="serving-text">You’re being served</strong><span>Head to the service desk</span></> : token.status === 'waiting' ? <><strong>{live.position === null ? 'Queue update pending' : `#${live.position} in line`}</strong><span>{live.eta === null ? 'Calculating wait time…' : live.eta === 0 ? 'You’re next up' : `About ${live.eta} min wait`}</span></> : <><strong>Visit complete</strong><span><CalendarDays size={12} /> {formatTime(token.resolved_at || token.created_at)}</span></>}
                </div>
                <StatusBadge status={live.status} />
                {token.status === 'waiting' && <button className="text-button cancel-button" type="button" onClick={() => cancelToken(token)} disabled={busyToken === token.id}>{busyToken === token.id ? <LoaderCircle size={15} className="spin" /> : 'Cancel'}</button>}
              </article>
            })}
          </div>
        )}
      </section>
    </DashboardLayout>
  )
}
