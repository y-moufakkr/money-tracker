import { Alert, Platform } from 'react-native';

/**
 * Confirmation and notices that also work on web, where react-native-web's
 * Alert is a no-op (the web build is used for smoke tests only).
 */
export function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void, destructive = false) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export type Choice = { label: string; onPress: () => void; destructive?: boolean };

/**
 * An explicit choice between several actions (plus Cancel). On web each action is offered in turn
 * with `window.confirm`, in the order given; dismissing all of them cancels.
 */
export function chooseAction(title: string, message: string, choices: Choice[]) {
  if (Platform.OS === 'web') {
    for (const ch of choices) {
      if (window.confirm(`${title}\n\n${message}\n\nOK = ${ch.label}\nCancel = other options`)) {
        ch.onPress();
        return;
      }
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    ...choices.map((ch) => ({ text: ch.label, style: ch.destructive ? ('destructive' as const) : ('default' as const), onPress: ch.onPress })),
  ]);
}
