import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Building2,
  Check,
  Clock3,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Ticket,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
import { publicApi } from '../lib/api'

function homeFor(user) {
  if (user.role === 'admin') return '/admin'
  if (user.role === 'staff') return '/staff'
  return '/student'
}

function Field({ icon: Icon, label, ...inputProps }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="input-wrap">
        <Icon size={17} aria-hidden="true" />
        <input {...inputProps} />
      </span>
    </label>
  )
}

function SelectField({ icon: Icon, label, children, ...selectProps }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="select-wrap">
        <Icon size={17} aria-hidden="true" />
        <select {...selectProps}>{children}</select>
      </span>
    </label>
  )
}

export default function Login() {
  const { signIn, signUp, sessionError } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('student')
  const [departmentId, setDepartmentId] = useState('')
  const [departments, setDepartments] = useState([])
  const [departmentsLoading, setDepartmentsLoading] = useState(false)
  const [departmentLoadError, setDepartmentLoadError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isSignup = mode === 'signup'

  useEffect(() => {
    if (!isSignup || role !== 'staff') return undefined

    let active = true
    publicApi
      .get('/departments')
      .then(({ data }) => {
        if (!active) return
        setDepartments(data.departments)
        setDepartmentId((current) =>
          data.departments.some((department) => String(department.id) === current)
            ? current
            : '',
        )
      })
      .catch((requestError) => {
        if (!active) return
        setDepartmentLoadError(
          requestError.response?.data?.error ||
            'Departments could not be loaded. Please try again.',
        )
      })
      .finally(() => {
        if (active) setDepartmentsLoading(false)
      })

    return () => {
      active = false
    }
  }, [isSignup, role])

  function switchMode(nextMode) {
    if (nextMode === 'signup') {
      setDepartmentsLoading(true)
      setDepartmentLoadError('')
    }
    setMode(nextMode)
    setError('')
  }

  function handleRoleChange(event) {
    const nextRole = event.target.value
    setRole(nextRole)
    setError('')
    if (nextRole === 'staff') {
      setDepartmentsLoading(true)
      setDepartmentLoadError('')
    } else {
      setDepartmentsLoading(false)
      setDepartmentId('')
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (isSignup && password !== confirmPassword) {
      setError('Your passwords do not match.')
      return
    }
    if (isSignup && role === 'staff' && !departmentId) {
      setError('Select the department where you will be working.')
      return
    }

    setSubmitting(true)
    try {
      const user = isSignup
        ? await signUp({
            full_name: fullName,
            email,
            password,
            role,
            department_id: role === 'staff' ? Number(departmentId) : null,
          })
        : await signIn({ email, password })
      const requestedPath = location.state?.from?.pathname
      navigate(requestedPath || homeFor(user), { replace: true })
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          'We could not connect to CampusFlow. Check your connection and try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page min-h-screen w-full max-w-7xl mx-auto px-4 py-8 overflow-y-auto">
      <section className="auth-story">
        <Link className="brand brand-on-dark" to="/">
          <span className="brand-mark"><Ticket size={19} /></span>
          <span>campus<span className="brand-light">flow</span></span>
        </Link>
        <div className="story-content">
          <span className="story-kicker"><span /> SMARTER CAMPUS SERVICES</span>
          <h1>Your time<br />is yours again.</h1>
          <p>Join the queue from anywhere. See your place in real time. Get on with your day.</p>
          <div className="story-features">
            <div><span className="feature-icon"><Ticket size={17} /></span><span><strong>One token, zero lines</strong><small>Reserve your place before you arrive.</small></span></div>
            <div><span className="feature-icon"><Clock3 size={17} /></span><span><strong>Know when it’s your turn</strong><small>Live queue position and wait estimates.</small></span></div>
            <div><span className="feature-icon"><ShieldCheck size={17} /></span><span><strong>Built for campus</strong><small>Library, accounts, and more in one place.</small></span></div>
          </div>
        </div>
        <div className="story-bottom"><span>MADE FOR THE WAY CAMPUS WORKS</span><span>Secure · Simple · Live</span></div>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="mobile-brand brand">
            <span className="brand-mark"><Ticket size={19} /></span>
            <span>campus<span className="brand-light">flow</span></span>
          </div>
          <div className="form-heading">
            <span className="form-icon"><UsersRound size={18} /></span>
            <p className="eyebrow">{isSignup ? 'YOUR CAMPUS, CONNECTED' : 'WELCOME BACK'}</p>
            <h2>{isSignup ? 'Create your account' : 'Sign in to CampusFlow'}</h2>
            <p>{isSignup ? 'Choose your role and connect with a campus service.' : 'Your campus services are just a step away.'}</p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup ? 'active' : ''} onClick={() => switchMode('login')}>Sign in</button>
            <button type="button" role="tab" aria-selected={isSignup} className={isSignup ? 'active' : ''} onClick={() => switchMode('signup')}>Create account</button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isSignup && (
              <Field
                icon={UserRound}
                label="Full name"
                type="text"
                name="name"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Your name"
                maxLength={120}
                required
              />
            )}
            {isSignup && (
              <SelectField
                icon={UsersRound}
                label="Account role"
                name="role"
                value={role}
                onChange={handleRoleChange}
                required
              >
                <option value="student">Student</option>
                <option value="staff">Staff</option>
              </SelectField>
            )}
            {isSignup && role === 'staff' && (
              <SelectField
                icon={Building2}
                label="Service department"
                name="department"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                disabled={departmentsLoading || departments.length === 0}
                required
              >
                <option value="">
                  {departmentsLoading
                    ? 'Loading departments…'
                    : departments.length
                      ? 'Choose your department'
                      : 'No departments available'}
                </option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </SelectField>
            )}
            {isSignup && role === 'staff' && departmentLoadError && (
              <div className="form-error" role="alert">{departmentLoadError}</div>
            )}
            <Field
              icon={Mail}
              label="Campus email"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@campus.edu"
              maxLength={320}
              required
            />
            <Field
              icon={LockKeyhole}
              label="Password"
              type="password"
              name="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isSignup ? 'At least 10 characters' : 'Enter your password'}
              minLength={isSignup ? 10 : undefined}
              maxLength={256}
              required
            />
            {isSignup && (
              <Field
                icon={LockKeyhole}
                label="Confirm password"
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Enter your password again"
                minLength={10}
                maxLength={256}
                required
              />
            )}
            {(error || sessionError) && <div className="form-error" role="alert">{error || sessionError}</div>}
            <button className="button button-primary auth-submit" type="submit" disabled={submitting}>
              {submitting ? 'Please wait…' : isSignup ? `Create ${role} account` : 'Sign in'}
              {!submitting && <ArrowRight size={17} />}
            </button>
          </form>

          {isSignup ? (
            <p className="auth-note"><Check size={15} /> Staff accounts are linked to the selected service department.</p>
          ) : (
            <p className="auth-note"><LockKeyhole size={14} /> Your account is protected with secure sign-in.</p>
          )}
          <p className="auth-switch">
            {isSignup ? 'Already have an account?' : 'New to CampusFlow?'}{' '}
            <button type="button" onClick={() => switchMode(isSignup ? 'login' : 'signup')}>
              {isSignup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>
        <footer className="auth-footer"><span>© CampusFlow</span><span>Smart campus queue management</span></footer>
      </section>
    </main>
  )
}
