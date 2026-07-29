import { Tabs } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function TabsLayout() {
  const can = useAuthStore((s) => s.can);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        tabBarStyle: { backgroundColor: '#1a1a2e', borderTopColor: '#16213e' },
        tabBarActiveTintColor: '#e94560',
        tabBarInactiveTintColor: '#9ca3af',
      }}
    >
      <Tabs.Screen
        name="tables"
        options={{ title: 'Tables', tabBarIcon: () => null }}
      />
      <Tabs.Screen
        name="menu"
        options={{ title: 'Menu', tabBarIcon: () => null }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: 'Orders', tabBarIcon: () => null }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: () => null,
          href: can('viewAllReports') ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: 'Expenses',
          tabBarIcon: () => null,
          href: can('manageExpenses') ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="debtors"
        options={{
          title: 'Debtors',
          tabBarIcon: () => null,
          href: can('viewDebtors') ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="stock"
        options={{
          title: 'Stock',
          tabBarIcon: () => null,
          href: can('adjustStock') ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: () => null,
          href: can('manageStaff') ? undefined : null,
        }}
      />
    </Tabs>
  );
}
