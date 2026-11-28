import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

// Until React attaches the submit handler, the browser would submit the HTML form itself.
export function useAuthFormReady() {
  return useSyncExternalStore(subscribe, clientReady, serverReady)
}
