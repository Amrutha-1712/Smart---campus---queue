import { useEffect, useState } from 'react'
import { API_BASE_URL, api } from './api'

export function useQueueStream() {
  const [queueState, setQueueState] = useState(null)
  const [streamError, setStreamError] = useState('')

  useEffect(() => {
    let stopped = false
    let source
    let reconnectTimer

    async function connect() {
      try {
        const { data: initialState } = await api.get('/queue/state')
        if (stopped) return
        setQueueState(initialState)

        const { data } = await api.post('/queue/stream-ticket')
        if (stopped) return

        source = new EventSource(
          `${API_BASE_URL}/queue/stream?ticket=${encodeURIComponent(data.ticket)}`,
        )
        source.onmessage = (event) => {
          try {
            setQueueState(JSON.parse(event.data))
            setStreamError('')
          } catch {
            setStreamError('The live queue update could not be read.')
          }
        }
        source.onerror = () => {
          source?.close()
          if (!stopped) {
            setStreamError('Reconnecting to live queue updates…')
            reconnectTimer = window.setTimeout(connect, 2500)
          }
        }
      } catch (error) {
        if (stopped) return
        setStreamError(
          error.response?.data?.error || 'Live queue updates are temporarily unavailable.',
        )
        reconnectTimer = window.setTimeout(connect, 5000)
      }
    }

    connect()
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      source?.close()
    }
  }, [])

  return { queueState, streamError }
}
