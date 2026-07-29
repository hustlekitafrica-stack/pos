import * as Crypto from 'expo-crypto';

/**
 * Hash a PIN using SHA-256. 
 * Note: For production, use bcrypt via a Supabase Edge Function for PIN verification.
 * Local hash is used for offline PIN verification only.
 */
export async function hashPin(pin: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    pin
  );
  return digest;
}

/**
 * Verify a PIN against a stored hash.
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const hash = await hashPin(pin);
  return hash === storedHash;
}
