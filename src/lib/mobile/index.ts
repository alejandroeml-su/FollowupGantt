// Wave P21-A + R4-B · Barrel mobile helpers. Tree-shakeable: el web puede
// importar `isCapacitor` sin arrastrar el push-bridge.
export {
  isCapacitor,
  isNativeMobile,
  getPlatform,
  type MobilePlatform,
} from './capacitor-bridge'
export {
  registerMobilePush,
  isCapacitorAvailable,
  detectMobileKind,
  type PushBridgeRegisterResult,
} from './push-bridge'
