import { useAuthStore } from '@/stores/authStore';
import { PERMISSIONS } from '@/constants/roles';

/**
 * Returns true if the currently logged-in staff member has the given permission.
 */
export function usePermission(permission: keyof typeof PERMISSIONS): boolean {
  return useAuthStore((s) => s.can(permission));
}
