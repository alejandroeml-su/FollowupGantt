// Wave P21-A · Barrel mobile helpers. Tree-shakeable: el web puede
// importar `isCapacitor` sin arrastrar el push-bridge.
export {
  isCapacitor,
  isNativeMobile,
  getPlatform,
  type MobilePlatform,
} from './capacitor-bridge'
export {
  registerCapacitorPush,
  ensureMobilePushIfAvailable,
  type CapacitorPushRegistration,
} from './push-bridge'
