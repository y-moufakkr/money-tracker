import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';

/** A readable name for this device in backup history ("Galaxy S22"), never an identifier. */
export function deviceName(): string {
  if (Platform.OS === 'web') return 'Web browser';
  return Device.modelName ?? Device.deviceName ?? 'Android device';
}
