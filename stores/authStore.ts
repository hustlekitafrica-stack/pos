import { create } from 'zustand';
import { Staff, Role } from '@/types';
import { hasPermission, PERMISSIONS } from '@/constants/roles';

interface AuthState {
  currentStaff: Staff | null;
  isAuthenticated: boolean;
  currentShiftId: string | null;
  login: (staff: Staff, shiftId?: string | null) => void;
  logout: () => void;
  setShiftId: (shiftId: string | null) => void;
  can: (permission: keyof typeof PERMISSIONS) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentStaff: null,
  isAuthenticated: false,
  currentShiftId: null,

  login: (staff: Staff, shiftId?: string | null) => {
    set({ currentStaff: staff, isAuthenticated: true, currentShiftId: shiftId ?? null });
  },

  logout: () => {
    set({ currentStaff: null, isAuthenticated: false, currentShiftId: null });
  },

  setShiftId: (shiftId: string | null) => {
    set({ currentShiftId: shiftId });
  },

  can: (permission) => {
    const staff = get().currentStaff;
    if (!staff) return false;
    return hasPermission(staff.role, permission);
  },
}));
