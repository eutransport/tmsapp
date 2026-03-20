/**
 * useLocationPermission hook — manages browser location permission state.
 * 
 * - Checks current permission via Permissions API
 * - Persists user's acknowledged choice in localStorage
 * - Detects platform (Android/iOS/Desktop) for help instructions
 * - Provides a requestPermission method that triggers the browser prompt
 */
import { useState, useEffect, useCallback } from 'react'

export type PermissionStatus = 'prompt' | 'granted' | 'denied' | 'unavailable' | 'unknown'
export type Platform = 'android' | 'ios' | 'desktop'

interface LocationPermissionState {
  /** Current browser permission status */
  status: PermissionStatus
  /** Whether we've shown the initial permission dialog to the user */
  hasAskedBefore: boolean
  /** Detected platform */
  platform: Platform
  /** Whether the Permissions API is supported */
  permissionsApiSupported: boolean
}

const STORAGE_KEY = 'tms_location_permission_asked'

function detectPlatform(): Platform {
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'android'
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'desktop'
}

export function useLocationPermission() {
  const [state, setState] = useState<LocationPermissionState>({
    status: 'unknown',
    hasAskedBefore: localStorage.getItem(STORAGE_KEY) === 'true',
    platform: detectPlatform(),
    permissionsApiSupported: 'permissions' in navigator,
  })

  // Check current permission status
  // Strategy: Use Permissions API if available, otherwise assume 'prompt'
  // NEVER block the UI based on an unreliable GPS probe at page load
  const checkPermission = useCallback(async () => {
    if (!navigator.geolocation) {
      setState(prev => ({ ...prev, status: 'unavailable' }))
      return
    }

    // Try Permissions API (fast, no popup, supported in Chrome/Edge/Firefox)
    if ('permissions' in navigator) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' })
        
        // Map browser state
        const mappedStatus = result.state as PermissionStatus
        setState(prev => ({ ...prev, status: mappedStatus }))

        // Listen for future changes (user changes in browser/OS settings)
        result.addEventListener('change', () => {
          setState(prev => ({ ...prev, status: result.state as PermissionStatus }))
        })
        return
      } catch {
        // Permissions API doesn't support geolocation query in this browser
      }
    }

    // Fallback: Permissions API not available (Samsung Internet, older Safari)
    // Default to 'prompt' — we'll find out the real status when user clicks Start
    setState(prev => ({ ...prev, status: 'prompt' }))
  }, [])

  useEffect(() => {
    checkPermission()
  }, [checkPermission])

  // Mark that we've asked the user before
  const markAsAsked = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true')
    setState(prev => ({ ...prev, hasAskedBefore: true }))
  }, [])

  // Request permission by triggering a one-shot geolocation request
  const requestPermission = useCallback(async (): Promise<PermissionStatus> => {
    markAsAsked()

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => {
          setState(prev => ({ ...prev, status: 'granted' }))
          resolve('granted')
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setState(prev => ({ ...prev, status: 'denied' }))
            resolve('denied')
          } else {
            // Position unavailable or timeout — permission might still be granted
            setState(prev => ({ ...prev, status: 'granted' }))
            resolve('granted')
          }
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
      )
    })
  }, [markAsAsked])

  // Reset the asked-before state (for testing)
  const resetPermissionState = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setState(prev => ({ ...prev, hasAskedBefore: false }))
  }, [])

  return {
    ...state,
    checkPermission,
    requestPermission,
    markAsAsked,
    resetPermissionState,
  }
}
