import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

type AndroidSymbol = Extract<ComponentProps<typeof SymbolView>['name'], { android?: unknown }>['android'];

/** Material Symbols icon (Android/web). `name` is a Material Symbols identifier, e.g. "payments". */
export function Icon({
  name,
  size = 22,
  color,
  style,
}: {
  name: string;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
}) {
  const symbol = name as AndroidSymbol;
  return <SymbolView name={{ android: symbol, web: symbol }} size={size} tintColor={color} style={style} />;
}
