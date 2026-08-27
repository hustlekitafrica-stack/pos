import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { database } from '@/lib/db';
import { Settings } from '@/lib/db/models';
import { supabase } from '@/lib/supabase';

// Legacy SecureStore keys — read once on first load to migrate, then cleared.
const LEGACY_KEYS = {
  logo: 'bar_logo_uri',
  alertEmail: 'bar_alert_email',
};

const SETTINGS_ID = 'global';

interface SettingsState {
  logoUri: string | null;
  alertEmail: string;
  venueName: string;
  venuePhone: string;
  venueAddress: string;
  mpesaPaybill: string;
  loaded: boolean;
  loadSettings: () => Promise<void>;
  setLogoUri: (uri: string | null) => Promise<void>;
  setAlertEmail: (email: string) => Promise<void>;
  setVenueName: (name: string) => Promise<void>;
  setVenuePhone: (phone: string) => Promise<void>;
  setVenueAddress: (address: string) => Promise<void>;
  setMpesaPaybill: (paybill: string) => Promise<void>;
}

// ── Helper: find or create the global settings row ───────────────────────────

async function getOrCreateSettings(): Promise<Settings> {
  try {
    return await database.get<Settings>('settings').find(SETTINGS_ID);
  } catch {
    // Row doesn't exist yet — create it
    return database.write(async () => {
      return database.get<Settings>('settings').create((s) => {
        (s as any)._raw.id = SETTINGS_ID;
        s.alertEmail = '';
        s.logoUrl = null;
        s.barPrinterAddress = null;
        s.kitchenPrinterAddress = null;
        s.venueName = 'Bar POS';
      });
    });
  }
}

// ── Helper: update the global settings row ───────────────────────────────────

async function updateSettings(updater: (s: Settings) => void): Promise<void> {
  const row = await getOrCreateSettings();
  await database.write(async () => {
    await row.update(updater);
  });
}

// ── Supabase Storage upload ───────────────────────────────────────────────────

async function uploadLogoToStorage(localUri: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    // Read file as blob via fetch (works in Expo)
    const response = await fetch(localUri);
    const blob = await response.blob();
    const ext = localUri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `venue-logo.${ext}`;

    const { error } = await supabase.storage
      .from('logos')
      .upload(path, blob, { upsert: true, contentType: `image/${ext}` });

    if (error) {
      console.warn('Logo upload failed:', error.message);
      return null;
    }

    const { data } = supabase.storage.from('logos').getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (e) {
    console.warn('Logo upload error:', e);
    return null;
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>((set) => ({
  logoUri: null,
  alertEmail: '',
  venueName: 'Bar POS',
  venuePhone: '',
  venueAddress: '',
  mpesaPaybill: '',
  loaded: false,

  loadSettings: async () => {
    try {
      const row = await getOrCreateSettings();

      let alertEmail = row.alertEmail;
      let logoUri: string | null = row.logoUrl;
      let venueName = row.venueName || 'Bar POS';
      const venuePhone   = row.venuePhone   ?? '';
      const venueAddress = row.venueAddress ?? '';
      const mpesaPaybill = row.mpesaPaybill ?? '';

      // ── Migrate from legacy SecureStore on first run ──────────────────────
      if (!alertEmail) {
        const legacyEmail = await SecureStore.getItemAsync(LEGACY_KEYS.alertEmail).catch(() => null);
        if (legacyEmail) {
          alertEmail = legacyEmail;
          await updateSettings((s) => { s.alertEmail = legacyEmail; });
          await SecureStore.deleteItemAsync(LEGACY_KEYS.alertEmail).catch(() => {});
        }
      }

      if (!logoUri) {
        const legacyLogo = await SecureStore.getItemAsync(LEGACY_KEYS.logo).catch(() => null);
        if (legacyLogo) {
          // Try to upload the existing local logo to Supabase Storage
          const remoteUrl = await uploadLogoToStorage(legacyLogo);
          logoUri = remoteUrl ?? legacyLogo; // fall back to local path if upload fails
          await updateSettings((s) => { s.logoUrl = logoUri; });
          await SecureStore.deleteItemAsync(LEGACY_KEYS.logo).catch(() => {});
        }
      }

      set({ alertEmail, logoUri, venueName, venuePhone, venueAddress, mpesaPaybill, loaded: true });
    } catch (e) {
      console.warn('loadSettings error:', e);
      set({ loaded: true });
    }
  },

  setAlertEmail: async (email) => {
    set({ alertEmail: email });
    await updateSettings((s) => { s.alertEmail = email; });
  },

  setLogoUri: async (uri) => {
    if (!uri) {
      set({ logoUri: null });
      await updateSettings((s) => { s.logoUrl = null; });
      return;
    }

    // Optimistic local update
    set({ logoUri: uri });

    // Upload to Supabase Storage and save the remote URL
    const remoteUrl = await uploadLogoToStorage(uri);
    const finalUri = remoteUrl ?? uri; // keep local URI if upload failed (offline)
    set({ logoUri: finalUri });
    await updateSettings((s) => { s.logoUrl = finalUri; });
  },

  setVenueName: async (name) => {
    set({ venueName: name });
    await updateSettings((s) => { s.venueName = name; });
  },

  setVenuePhone: async (phone) => {
    set({ venuePhone: phone });
    await updateSettings((s) => { s.venuePhone = phone; });
  },

  setVenueAddress: async (address) => {
    set({ venueAddress: address });
    await updateSettings((s) => { s.venueAddress = address; });
  },

  setMpesaPaybill: async (paybill) => {
    set({ mpesaPaybill: paybill });
    await updateSettings((s) => { s.mpesaPaybill = paybill; });
  },
}));
