import axios from 'axios'

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000/api'
).replace(/\/+$/, '')

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

export const publicApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

export function setAccessToken(token) {
  sessionStorage.setItem('campus_queue_access_token', token)
}

export function clearAccessToken() {
  sessionStorage.removeItem('campus_queue_access_token')
}

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('campus_queue_access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearAccessToken()
      window.dispatchEvent(new Event('campus-queue:unauthorized'))
    }
    return Promise.reject(error)
  },
)
