import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="sell" />
      <Tabs.Screen name="tables" />
      <Tabs.Screen name="orders" />
      <Tabs.Screen name="menu" />
      <Tabs.Screen name="reports" />
      <Tabs.Screen name="expenses" />
      <Tabs.Screen name="debtors" />
      <Tabs.Screen name="stock" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
