import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Building2,
  LogOut,
  ShieldCheck,
  Ticket,
} from 'lucide-react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { api, clearAccessToken, setAccessToken } from './lib/api'
import { AuthContext, useAuth } from './lib/authContext'
import Login from './pages/Login.jsx'
import StudentDashboard from './pages/StudentDashboard.jsx'
import StaffDashboard from './pages/StaffDashboard.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'

function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(() =>
    Boolean(sessionStorage.getItem('campus_queue_access_token')),
  )
  const [sessionError, setSessionError] = useState('')

  useEffect(() => {
    let active = true
    const token = sessionStorage.getItem('campus_queue_access_token')

    if (!token) {
      return () => {
        active = false
      }
    }

    api
      .get('/auth/me')
      .then(({ data }) => {
        if (active) {
          setUser(data.user)
          setSessionError('')
        }
      })
      .catch((error) => {
        if (!active) return
        if (error.response?.status === 401) {
          clearAccessToken()
          setUser(null)
        } else {
          setSessionError('Your saved session could not be checked. Please sign in again.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleUnauthorized = () => setUser(null)
    window.addEventListener('campus-queue:unauthorized', handleUnauthorized)
    return () =>
      window.removeEventListener('campus-queue:unauthorized', handleUnauthorized)
  }, [])

  async function signIn(credentials) {
    const { data } = await api.post('/auth/login', credentials)
    setAccessToken(data.access_token)
    setUser(data.user)
    setSessionError('')
    return data.user
  }

  async function signUp(details) {
    const { data } = await api.post('/auth/register', details)
    setAccessToken(data.access_token)
    setUser(data.user)
    setSessionError('')
    return data.user
  }

  async function signOut() {
    try {
      if (sessionStorage.getItem('campus_queue_access_token')) {
        await api.post('/auth/logout')
      }
    } finally {
      clearAccessToken()
      setUser(null)
    }
  }

  const value = useMemo(
    () => ({ user, loading, sessionError, signIn, signUp, signOut }),
    [user, loading, sessionError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function destinationFor(user) {
  if (user?.role === 'staff') return '/staff'
  if (user?.role === 'admin') return '/admin'
  return '/student'
}

function RouteGuard({ roles, children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <main className="screen-center">
        <span className="loading-ring" />
        <span>Checking your secure session…</span>
      </main>
    )
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={destinationFor(user)} replace />
  }
  return children
}

export function DashboardLayout({
  children,
  eyebrow,
  title,
  subtitle,
  dashboardClassName = '',
}) {
  const { user, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } catch (error) {
      window.alert(error.response?.data?.error || 'Could not end the session.')
    } finally {
      setSigningOut(false)
    }
  }

  const roleLabel = user?.role === 'admin' ? 'Administrator' : user?.role

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={destinationFor(user)}>
          <span className="brand-mark"><Ticket size={19} /></span>
          <span>campus<span className="brand-light">flow</span></span>
        </a>
        <div className="topbar-right">
          <div className="user-chip">
            <span className="avatar">{user?.full_name?.slice(0, 1).toUpperCase()}</span>
            <span className="user-details">
              <strong>{user?.full_name}</strong>
              <small>{roleLabel}</small>
            </span>
          </div>
          <button
            className="icon-button sign-out"
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <main className="page-wrap min-h-screen w-full max-w-7xl mx-auto px-4 py-8 overflow-y-auto">
        <div className="page-heading">
          <div>
            <div className="eyebrow"><Building2 size={14} /> {eyebrow}</div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {user?.role === 'admin' && (
            <span className="secure-badge"><ShieldCheck size={15} /> Admin access</span>
          )}
        </div>
        <div className={`dashboard-content w-full max-w-7xl mx-auto ${dashboardClassName}`}>
          {children}
        </div>
        <footer className="app-footer">
          <span>CampusFlow · Smart campus services</span>
          <span>Questions? Contact your campus service desk <ArrowRight size={13} /></span>
        </footer>
      </main>
    </div>
  )
}

function LandingRoute() {
  const { user, loading } = useAuth()
  if (loading) return <main className="screen-center"><span className="loading-ring" /></main>
  return <Navigate to={user ? destinationFor(user) : '/login'} replace />
}

function ApplicationRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/student"
        element={<RouteGuard roles={['student']}><StudentDashboard /></RouteGuard>}
      />
      <Route
        path="/staff"
        element={<RouteGuard roles={['staff']}><StaffDashboard /></RouteGuard>}
      />
      <Route
        path="/admin"
        element={<RouteGuard roles={['admin']}><AdminDashboard /></RouteGuard>}
      />
      <Route path="*" element={<LandingRoute />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ApplicationRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
