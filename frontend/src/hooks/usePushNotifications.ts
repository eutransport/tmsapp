/**
 * Push Notifications Hook
 * Handles subscription management and permission requests
 */
import { useState, useEffect, useCallback } from 'react'
import { 
  pushApi, 
  urlBase64ToUint8Array, 
  isPushSupported, 
  getNotificationPermission,
  requestNotificationPermission,
  type PushConfig 
} from '@/api/push'

interface UsePushNotificationsResult {
  // State
  isSupported: boolean
  permission: NotificationPermission
  isSubscribed: boolean
  isLoading: boolean
  error: string | null
  pushConfig: PushConfig | null
  
  // Actions
  subscribe: (deviceName?: string) => Promise<boolean>
  unsubscribe: () => Promise<boolean>
  requestPermission: () => Promise<NotificationPermission>
  checkSubscription: () => Promise<void>
}

/** Herkenbare apparaatnaam voor in het abonnementenoverzicht. */
export function getDeviceName(): string {
  const ua = navigator.userAgent

  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android Telefoon' : 'Android Tablet'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Linux/.test(ua)) return 'Linux'

  return 'Onbekend apparaat'
}

export function usePushNotifications(): UsePushNotificationsResult {
  const [isSupported] = useState(() => isPushSupported())
  const [permission, setPermission] = useState<NotificationPermission>(() => getNotificationPermission())
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pushConfig, setPushConfig] = useState<PushConfig | null>(null)

  // Load initial state
  useEffect(() => {
    if (!isSupported) {
      setIsLoading(false)
      return
    }

    const init = async () => {
      try {
        // Get push configuration
        const config = await pushApi.getConfig()
        setPushConfig(config)

        // Check if already subscribed
        if (config.is_configured) {
          await checkSubscription()
        }
      } catch (err) {
        console.error('Failed to initialize push notifications:', err)
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [isSupported])

  // Check current subscription status
  const checkSubscription = useCallback(async () => {
    if (!isSupported || !('serviceWorker' in navigator)) {
      return
    }

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      setIsSubscribed(!!subscription)

      // De server kan het abonnement hebben gedeactiveerd (410 Gone) terwijl de
      // browser het nog kent; opnieuw aanmelden herstelt dat stilzwijgend.
      if (subscription) {
        try {
          await pushApi.subscribe(subscription.toJSON(), getDeviceName())
        } catch {
          // Een mislukte hersynchronisatie mag de app niet blokkeren.
        }
      }
    } catch (err) {
      console.error('Failed to check subscription:', err)
      setIsSubscribed(false)
    }
  }, [isSupported])

  // Request notification permission
  const handleRequestPermission = useCallback(async (): Promise<NotificationPermission> => {
    const result = await requestNotificationPermission()
    setPermission(result)
    return result
  }, [])

  // Subscribe to push notifications
  const subscribe = useCallback(async (deviceName?: string): Promise<boolean> => {
    setError(null)

    if (!isSupported) {
      setError('Push notificaties worden niet ondersteund op dit apparaat')
      return false
    }

    if (!pushConfig?.is_configured) {
      setError('Push notificaties zijn niet geconfigureerd')
      return false
    }

    try {
      setIsLoading(true)

      // Request permission if needed
      if (permission !== 'granted') {
        const newPermission = await handleRequestPermission()
        if (newPermission !== 'granted') {
          setError('Notificatie permissie is geweigerd')
          return false
        }
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready

      // Get or create subscription
      let subscription = await registration.pushManager.getSubscription()
      
      if (!subscription && pushConfig.public_key) {
        // Create new subscription with VAPID public key
        const applicationServerKey = urlBase64ToUint8Array(pushConfig.public_key)
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as BufferSource,
        })
      }

      if (!subscription) {
        setError('Kon geen push subscription aanmaken')
        return false
      }

      // Send subscription to backend
      const subscriptionJson = subscription.toJSON()
      await pushApi.subscribe(subscriptionJson, deviceName)

      setIsSubscribed(true)
      return true

    } catch (err: any) {
      console.error('Failed to subscribe:', err)
      setError(err.message || 'Kon niet abonneren op push notificaties')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [isSupported, pushConfig, permission, handleRequestPermission])

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setError(null)

    try {
      setIsLoading(true)

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        // Unsubscribe from browser
        await subscription.unsubscribe()

        // Remove from backend
        await pushApi.unsubscribe(subscription.endpoint)
      }

      setIsSubscribed(false)
      return true

    } catch (err: any) {
      console.error('Failed to unsubscribe:', err)
      setError(err.message || 'Kon niet uitschrijven van push notificaties')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    error,
    pushConfig,
    subscribe,
    unsubscribe,
    requestPermission: handleRequestPermission,
    checkSubscription,
  }
}
