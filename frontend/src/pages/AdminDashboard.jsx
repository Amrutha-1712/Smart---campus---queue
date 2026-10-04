import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Ticket,
  Trash2,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react'
import { DashboardLayout } from '../App'
import { useAuth } from '../lib/authContext'
import { api } from '../lib/api'
import { useQueueStream } from '../lib/useQueueStream'

function roleLabel(role) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export default function AdminDashboard() {
  const { user: currentUser } = useAuth()
  const { queueState, streamError } = useQueueStream()
  const [metrics, setMetrics] = useState(null)
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalUsers, setTotalUsers] = useState(0)
  const [departmentName, setDepartmentName] = useState('')
  const [departmentPrefix, setDepartmentPrefix] = useState('')
  const [serviceMinutes, setServiceMinutes] = useState('5')
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingDepartment, setSavingDepartment] = useState(false)
  const [savingUser, setSavingUser] = useState(null)
  const [removingDepartment, setRemovingDepartment] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const activeDepartments = useMemo(
    () => departments.filter((department) => department.is_active),
    [departments],
  )

  const loadOverview = useCallback(async () => {
    try {
      const [{ data: metricsData }, { data: departmentData }] = await Promise.all([
        api.get('/admin/metrics'),
        api.get('/admin/departments'),
      ])
      setMetrics(metricsData)
      setDepartments(departmentData.departments)
      setError('')
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load system metrics.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUsers = useCallback(async (requestedPage) => {
    try {
      const { data } = await api.get('/admin/users', {
        params: { page: requestedPage, per_page: 10 },
      })
      setUsers(data.users)
      setPage(data.page)
      setTotalPages(Math.max(1, data.pages))
      setTotalUsers(data.total)
      setDrafts((current) => {
        const next = { ...current }
        for (const item of data.users) {
          if (!next[item.id]) {
            next[item.id] = {
              role: item.role,
              department_id: item.department_id ? String(item.department_id) : '',
            }
          }
        }
        return next
      })
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load campus users.')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadOverview()
      loadUsers(1)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadOverview, loadUsers])

  useEffect(() => {
    if (!queueState) return
    const timer = window.setTimeout(() => loadOverview(), 0)
    return () => window.clearTimeout(timer)
  }, [queueState, loadOverview])

  async function addDepartment(event) {
    event.preventDefault()
    setSavingDepartment(true)
    setError('')
    setNotice('')
    try {
      const { data } = await api.post('/admin/departments', {
        name: departmentName,
        prefix: departmentPrefix,
        estimated_service_minutes: Number(serviceMinutes),
      })
      setDepartments((current) => [...current, data.department].sort((a, b) => a.name.localeCompare(b.name)))
      setDepartmentName('')
      setDepartmentPrefix('')
      setServiceMinutes('5')
      setNotice(`${data.department.name} is now available to students.`)
      loadOverview()
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'The department could not be created.')
    } finally {
      setSavingDepartment(false)
    }
  }

  async function removeDepartment(department) {
    if (!window.confirm(`Remove ${department.name} from the active campus services?`)) return
    setRemovingDepartment(department.id)
    setError('')
    setNotice('')
    try {
      const { data } = await api.delete(`/admin/departments/${department.id}`)
      setDepartments((current) => current.map((item) => item.id === department.id ? data.department : item))
      setNotice(`${department.name} has been removed. Its token history is preserved.`)
      loadOverview()
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'The department could not be removed.')
    } finally {
      setRemovingDepartment(null)
    }
  }

  async function saveUserRole(target) {
    const draft = drafts[target.id]
    if (!draft) return
    setSavingUser(target.id)
    setError('')
    setNotice('')
    try {
      const payload = { role: draft.role }
      if (draft.role === 'staff') payload.department_id = Number(draft.department_id)
      const { data } = await api.patch(`/admin/users/${target.id}`, payload)
      setUsers((current) => current.map((item) => item.id === target.id ? data.user : item))
      setDrafts((current) => ({
        ...current,
        [target.id]: {
          role: data.user.role,
          department_id: data.user.department_id ? String(data.user.department_id) : '',
        },
      }))
      setNotice(`${data.user.full_name} is now ${roleLabel(data.user.role).toLowerCase()}.`)
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'The user role could not be updated.')
    } finally {
      setSavingUser(null)
    }
  }

  function changeDraft(userId, field, value) {
    setDrafts((current) => ({
      ...current,
      [userId]: { ...current[userId], [field]: value },
    }))
  }

  const activeQueueCount = queueState
    ? queueState.departments.filter((department) => department.tokens.length > 0).length
    : metrics?.active_queues
  return (
    <DashboardLayout
      eyebrow="CAMPUS ADMINISTRATION"
      title="The campus at a glance."
      subtitle="Monitor service health, manage departments, and keep access up to date."
    >
      {error && <div className="alert alert-error" role="alert"><XCircle size={17} />{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss"><X size={16} /></button></div>}
      {notice && <div className="alert alert-success" role="status"><CheckCircle2 size={17} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}

      <section className="metric-grid admin-metrics">
        <article className="metric-card"><span className="metric-icon icon-violet"><Ticket size={19} /></span><div><small>Tokens issued today</small><strong>{metrics ? metrics.total_tokens_today : '—'}</strong></div><span className="metric-aside"><CalendarDays size={13} /> Today</span></article>
        <article className="metric-card"><span className="metric-icon icon-green"><Radio size={19} /></span><div><small>Active queues</small><strong>{activeQueueCount ?? '—'}</strong></div><span className="metric-aside">{streamError ? 'Reconnecting' : 'Live right now'}</span></article>
        <article className="metric-card"><span className="metric-icon icon-amber"><Clock3 size={19} /></span><div><small>Average wait</small><strong>{metrics ? `${metrics.average_wait_minutes} min` : '—'}</strong></div><span className="metric-aside"><ArrowDownRight size={13} /> Today</span></article>
        <article className="metric-card"><span className="metric-icon icon-blue"><Building2 size={19} /></span><div><small>Active departments</small><strong>{metrics ? metrics.departments : '—'}</strong></div><span className="metric-aside">Service desks</span></article>
      </section>

      <section className="panel department-panel">
        <div className="panel-heading department-heading">
          <div><span className="panel-kicker">CAMPUS SERVICES</span><h2>Departments</h2><p>Manage the queues students can join.</p></div>
          <span className="history-total"><Building2 size={15} /> {activeDepartments.length} active</span>
        </div>
        <form className="department-form" onSubmit={addDepartment}>
          <label className="field"><span className="field-label">Department name</span><input className="plain-input" value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} maxLength={100} placeholder="e.g. Library Services" required /></label>
          <label className="field prefix-field"><span className="field-label">Token prefix</span><input className="plain-input prefix-input" value={departmentPrefix} onChange={(event) => setDepartmentPrefix(event.target.value.toUpperCase())} pattern="[A-Za-z0-9]{2,8}" maxLength={8} placeholder="LIB" required /><small>2–8 letters or numbers</small></label>
          <label className="field minutes-field"><span className="field-label">Minutes per visit</span><span className="minutes-input"><input className="plain-input" type="number" min="1" max="240" step="1" value={serviceMinutes} onChange={(event) => setServiceMinutes(event.target.value)} required /><span>min</span></span></label>
          <button className="button button-primary add-department-button" type="submit" disabled={savingDepartment}>{savingDepartment ? <LoaderCircle size={16} className="spin" /> : <Plus size={17} />} Add department</button>
        </form>
        {departments.length === 0 ? (
          <div className="empty-state compact-empty"><span className="empty-icon"><Building2 size={19} /></span><strong>No departments yet</strong><span>Add a service department to make the first queue available.</span></div>
        ) : (
          <div className="department-list">
            {departments.map((department) => <article className={`department-row ${!department.is_active ? 'department-inactive' : ''}`} key={department.id}>
              <span className="department-monogram">{department.prefix.slice(0, 2)}</span>
              <span className="department-detail"><strong>{department.name}</strong><small>{department.prefix} · about {department.estimated_service_minutes} min per visit</small></span>
              <span className={`department-state ${department.is_active ? 'department-state-active' : ''}`}><span />{department.is_active ? 'Active' : 'Removed'}</span>
              {department.is_active && <button className="icon-button remove-button" type="button" onClick={() => removeDepartment(department)} disabled={removingDepartment === department.id} aria-label={`Remove ${department.name}`} title="Remove department">{removingDepartment === department.id ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}</button>}
            </article>)}
          </div>
        )}
      </section>

      <section className="panel users-panel">
        <div className="panel-heading users-heading">
          <div><span className="panel-kicker">ACCESS CONTROL</span><h2>People &amp; roles</h2><p>Assign staff to a service desk or manage campus access.</p></div>
          <span className="history-total"><ShieldCheck size={15} /> Admin managed</span>
        </div>
        {users.length === 0 && loading ? <div className="empty-state"><span className="loading-ring small" /> Loading campus users…</div> : users.length === 0 ? <div className="empty-state"><span className="empty-icon"><UsersRound size={19} /></span><strong>No accounts found</strong><span>Registered accounts will appear here.</span></div> : (
          <>
            <div className="user-table-wrap">
              <table className="user-table">
                <thead><tr><th>Campus member</th><th>Role</th><th>Department</th><th>Access</th><th /></tr></thead>
                <tbody>
                  {users.map((item) => {
                    const draft = drafts[item.id] || { role: item.role, department_id: '' }
                    const changed = draft.role !== item.role || (draft.role === 'staff' && String(item.department_id || '') !== draft.department_id)
                    return <tr key={item.id}>
                      <td><span className="table-person"><span className="avatar">{item.full_name.slice(0, 1).toUpperCase()}</span><span><strong>{item.full_name}</strong><small>{item.email}</small></span></span></td>
                      <td><select className="table-select" value={draft.role} onChange={(event) => changeDraft(item.id, 'role', event.target.value)} disabled={item.id === currentUser.id} aria-label={`Role for ${item.full_name}`}><option value="student">Student</option><option value="staff">Staff</option><option value="admin">Admin</option></select></td>
                      <td>{draft.role === 'staff' ? <select className="table-select department-select" value={draft.department_id} onChange={(event) => changeDraft(item.id, 'department_id', event.target.value)} aria-label={`Department for ${item.full_name}`}><option value="">Choose desk</option>{activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select> : <span className="muted-cell">{item.department_name || '—'}</span>}</td>
                      <td><span className={`role-pill role-${item.role}`}>{roleLabel(item.role)}</span></td>
                      <td><button className="icon-button save-role-button" type="button" onClick={() => saveUserRole(item)} disabled={!changed || savingUser === item.id || (draft.role === 'staff' && !draft.department_id)} aria-label={`Save role for ${item.full_name}`} title="Save role">{savingUser === item.id ? <LoaderCircle size={16} className="spin" /> : <Check size={17} />}</button></td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>Showing {users.length} of {totalUsers} people</span>
              <div><button className="icon-button" type="button" onClick={() => loadUsers(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={17} /></button><span>Page {page} of {totalPages}</span><button className="icon-button" type="button" onClick={() => loadUsers(page + 1)} disabled={page >= totalPages} aria-label="Next page"><ChevronRight size={17} /></button></div>
            </div>
          </>
        )}
      </section>

      <div className="admin-live-note"><Activity size={16} /><span>Metrics refresh automatically when queue activity changes.</span>{queueState && <span className="live-indicator"><span /> LIVE</span>}<button className="text-button" type="button" onClick={() => { loadOverview(); loadUsers(page) }}><RefreshCw size={14} /> Refresh</button><ArrowUpRight className="admin-note-arrow" size={15} /></div>
    </DashboardLayout>
  )
}
