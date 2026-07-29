import { View, Text, ScrollView, SafeAreaView } from 'react-native';

export default function OrdersScreen() {
  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView className="flex-1 p-4">
        <Text className="text-2xl font-bold text-primary mb-4">Active Orders</Text>
        <Text className="text-gray-500">All open orders across tables will appear here, sorted by time.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
