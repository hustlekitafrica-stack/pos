import { useState, useCallback } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { database } from '@/lib/db';
import { AuditLog } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { useAuthStore } from '@/stores/authStore';

export default function AuditLogScreen() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const can = useAuthStore((s) => s.can);

  const loadLogs = useCallback(async () => {
    const data = await database.get<AuditLog>('audit_logs')
      .query(Q.sortBy('created_at', Q.desc), Q.take(100))
      .fetch();
    setLogs(data);

    const staff = await database.get('staff').query().fetch();
    const names: Record<string, string> = {};
    for (const s of staff as any[]) names[s.id] = s.name;
    setStaffNames(names);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!can('viewAuditLog')) {
        router.back();
        return;
      }
      loadLogs();
    }, [loadLogs, can])
  );

  const getActionColor = (action: string) => {
    if (action.includes('void') || action.includes('delete') || action.includes('refund')) return 'text-red-600';
    if (action.includes('create') || action.includes('add')) return 'text-green-600';
    if (action.includes('update') || action.includes('edit')) return 'text-blue-600';
    if (action.includes('payment') || action.includes('pay')) return 'text-purple-600';
    return 'text-gray-700';
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row items-center justify-between p-4 bg-primary">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-white text-lg">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-lg font-bold">Audit Log</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView className="flex-1 p-4">
        {logs.length === 0 ? (
          <Text className="text-gray-400 text-center mt-8">No audit log entries.</Text>
        ) : (
          logs.map((log) => (
            <View key={log.id} className="bg-white rounded-xl p-4 mb-2 border border-gray-100">
              <View className="flex-row justify-between items-start mb-1">
                <Text className={`text-sm font-medium ${getActionColor(log.action)}`}>
                  {log.action}
                </Text>
                <Text className="text-xs text-gray-400">
                  {log.createdAt ? new Date(log.createdAt).toLocaleString() : ''}
                </Text>
              </View>

              <Text className="text-xs text-gray-500">
                {log.entityType} {log.entityId ? `#${log.entityId.slice(0, 8)}` : ''}
              </Text>

              {log.details && (
                <Text className="text-xs text-gray-400 mt-1" numberOfLines={3}>
                  {typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}
                </Text>
              )}

              <Text className="text-xs text-gray-400 mt-1">
                By: {staffNames[log.staffId] || log.staffId?.slice(0, 8) || 'System'}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
