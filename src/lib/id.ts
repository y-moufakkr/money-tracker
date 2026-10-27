import { randomUUID } from 'expo-crypto';

export function newId(): string {
  return randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}
