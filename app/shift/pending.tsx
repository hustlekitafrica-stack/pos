import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { getPendingShifts, approveShiftClosure, getShiftSummary } from '@/lib/db/actions';
import { Shift } from '@/lib/db/models';

interface PendingEntry {
  shift: Shift;
  staffName: string;
  summary: {
    cashTotal: number; mpesaTotal: number; cardTotal: number;
    creditTotal: number; totalRevenue: number; orderCount: number;
  };
}

export default function PendingShiftsScreen() {
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const can = useAuthStore((s) => s.can);

  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Approval modal state
  const [selected, setSelected] = useState<PendingEntry | null>(null);
  const [actualCash, setActualCash] = useState('');
  const [notes, setNotes] = useState('');
  const [approving, setApproving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!can('approveShiftClosure')) {
        Alert.alert('Access Denied', 'You do not have permission to approve shifts.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }
      loadPending();
    }, [])
  );

  const loadPending = async () => {
    setLoading(true);
    try {
      const raw = await getPendingShifts();
      const enriched: PendingEntry[] = [];
      for (const { shift, staffName } of raw) {
        const summary = await getShiftSummary(shift.id);
        enriched.push({ shift, staffName, summary });
      }
      setEntries(enriched);
    } finally {
      setLoading(false);
    }
  };

  const openApproval = (entry: PendingEntry) => {
    setSelected(entry);
    setActualCash('');
    setNotes('');
  };

  const handleApprove = async () => {
    if (!selected || !currentStaff) return;
    setApproving(true);
    try {
      const actualCents = toCents(parseFloat(actualCash) || 0);
      await approveShiftClosure(selected.shift.id, currentStaff.id, actualCents, notes.trim() || undefined);
      setSelected(null);
      Alert.alert('Approved', `${selected.staffName}'s shift has been closed and reconciled.`);
      await loadPending();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not approve shift.');
    } finally {
      setApproving(false);
    }
  };

  const variance = selected
    ? toCents(parseFloat(actualCash) || 0) - (selected.summary.cashTotal + selected.shift.openingCash)
    : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f0f2f5' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6, marginRight: 12 }}>
          <Feather name="arrow-left" size={22} color="#4338CA" />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1e1b4b', flex: 1 }}>Pending Shift Approvals</Text>
        {entries.length > 0 && (
          <View style={{ backgroundColor: '#dc2626', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{entries.length}</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#4338CA" />
        </View>
      ) : entries.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="check-circle" size={48} color="#86efac" />
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#64748b', marginTop: 16 }}>No pending shift approvals</Text>
          <Text style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>All shifts are up to date</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          {entries.map((entry) => (
            <TouchableOpacity
              key={entry.shift.id}
              onPress={() => openApproval(entry)}
              style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#fca5a5', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#4338CA' }}>{entry.staffName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#1e1b4b' }}>{entry.staffName}</Text>
                    <Text style={{ fontSize: 11, color: '#94a3b8' }}>
                      Started {new Date(entry.shift.openedAt).toLocaleString()}
                    </Text>
                  </View>
                </View>
                <View style={{ backgroundColor: '#fef3c7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400e' }}>Pending</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f8fafc', borderRadius: 10, padding: 10 }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>ORDERS</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1e1b4b' }}>{entry.summary.orderCount}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>CASH</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1e1b4b' }}>{formatKES(entry.summary.cashTotal)}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>M-PESA</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1e1b4b' }}>{formatKES(entry.summary.mpesaTotal)}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>TOTAL</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#4338CA' }}>{formatKES(entry.summary.totalRevenue)}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, justifyContent: 'flex-end' }}>
                <Feather name="check-square" size={13} color="#4338CA" style={{ marginRight: 4 }} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#4338CA' }}>Tap to Approve</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Approval Modal */}
      <Modal visible={!!selected} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#1e1b4b' }}>
                  Approve — {selected?.staffName}
                </Text>
                <TouchableOpacity onPress={() => setSelected(null)}>
                  <Feather name="x" size={22} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              {/* Summary */}
              {selected && (
                <View style={{ backgroundColor: '#f8fafc', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', marginBottom: 8 }}>SHIFT SUMMARY</Text>
                  {[
                    ['Orders completed', String(selected.summary.orderCount)],
                    ['Cash sales', formatKES(selected.summary.cashTotal)],
                    ['M-Pesa', formatKES(selected.summary.mpesaTotal)],
                    ['Card', formatKES(selected.summary.cardTotal)],
                    ...(selected.summary.creditTotal > 0 ? [['Credit', formatKES(selected.summary.creditTotal)]] : []),
                    ['Opening float', formatKES(selected.shift.openingCash)],
                    ['Expected cash in till', formatKES(selected.summary.cashTotal + selected.shift.openingCash)],
                  ].map(([label, value]) => (
                    <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ fontSize: 13, color: '#64748b' }}>{label}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#1e1b4b' }}>{value}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Actual cash input */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>Actual Cash Counted (KES)</Text>
              <TextInput
                style={{ backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '700', color: '#1e1b4b', marginBottom: 6 }}
                value={actualCash}
                onChangeText={setActualCash}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#94a3b8"
              />
              {actualCash.length > 0 && selected && (
                <Text style={{ fontSize: 12, fontWeight: '700', marginBottom: 14, color: variance >= 0 ? '#16a34a' : '#dc2626' }}>
                  Variance: {formatKES(variance)} {variance >= 0 ? '(surplus)' : '(short)'}
                </Text>
              )}
              {!actualCash.length && <View style={{ marginBottom: 14 }} />}

              {/* Notes */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>Notes (optional)</Text>
              <TextInput
                style={{ backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 12, fontSize: 14, color: '#1e1b4b', marginBottom: 20, minHeight: 70, textAlignVertical: 'top' }}
                value={notes}
                onChangeText={setNotes}
                placeholder="Any discrepancies, remarks..."
                placeholderTextColor="#94a3b8"
                multiline
              />

              <TouchableOpacity
                onPress={handleApprove}
                disabled={approving}
                style={{ backgroundColor: approving ? '#9ca3af' : '#16a34a', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10 }}
              >
                {approving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Approve & Close Shift</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setSelected(null)} style={{ alignItems: 'center', padding: 10 }}>
                <Text style={{ color: '#94a3b8', fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
