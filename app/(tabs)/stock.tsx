import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { database } from '@/lib/db';
import { Product, StockAdjustment, Category } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { useAuthStore } from '@/stores/authStore';
import { triggerAutoSync } from '@/lib/db/sync';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

type AdjustReason = 'restock' | 'wastage' | 'breakage' | 'correction';

export default function StockScreen() {
  const can = useAuthStore((s) => s.can);
  const currentStaff = useAuthStore((s) => s.currentStaff);

  const canSeeBar     = can('adjustBarStock');      // admin, manager, bartender
  const canSeeKitchen = can('adjustKitchenStock');  // admin, manager, stock_manager
  const isAddOnly     = !can('adjustStock');         // bartender & stock_manager → restock only

  const [activeStation, setActiveStation] = useState<'bar' | 'kitchen'>(
    canSeeBar ? 'bar' : 'kitchen'
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [catNames, setCatNames] = useState<Record<string, string>>({});
  const [showAdjust, setShowAdjust] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState<AdjustReason>('restock');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);

    // Load categories for this station
    const cats = await database
      .get<Category>('categories')
      .query(Q.where('prep_station', activeStation))
      .fetch();

    const catIds = cats.map((c) => c.id);
    const nameMap: Record<string, string> = {};
    for (const c of cats) nameMap[c.id] = c.name;
    setCatNames(nameMap);

    const data =
      catIds.length > 0
        ? await database
            .get<Product>('products')
            .query(Q.where('is_active', true), Q.where('category_id', Q.oneOf(catIds)))
            .fetch()
        : [];

    data.sort((a, b) => a.stockQty - b.stockQty);
    setProducts(data);
    setLoading(false);
  }, [activeStation]);

  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [loadProducts])
  );

  const handleAdjust = async () => {
    if (!showAdjust || !adjustQty.trim()) return;
    const qty = parseInt(adjustQty, 10);
    if (isNaN(qty) || qty === 0) return;

    // Add-only roles can only increase stock
    const changeQty = isAddOnly
      ? Math.abs(qty)
      : adjustReason === 'restock' || adjustReason === 'correction'
        ? Math.abs(qty)
        : -Math.abs(qty);

    await database.write(async () => {
      await database.get<StockAdjustment>('stock_adjustments').create((sa) => {
        sa.productId = showAdjust.id;
        sa.adjustedBy = currentStaff!.id;
        sa.changeQty = changeQty;
        sa.reason = adjustReason;
      });

      await showAdjust.update((p) => {
        p.stockQty = Math.max(0, p.stockQty + changeQty);
        p.isOutOfStock = p.stockQty <= 0;
        if (p.stockQty > p.lowStockThreshold) {
          p.lowStockAlertSent = false;
        }
      });
    });

    setAdjustQty('');
    setShowAdjust(null);
    Alert.alert('Stock Updated', `${changeQty > 0 ? '+' : ''}${changeQty} applied`);
    triggerAutoSync();
    await loadProducts();
  };

  const getStockColor = (product: Product) => {
    if (product.isOutOfStock || product.stockQty <= 0) return 'border-red-500 bg-red-50';
    if (product.stockQty <= product.lowStockThreshold) return 'border-yellow-500 bg-yellow-50';
    return 'border-gray-200 bg-white';
  };

  const reasons: { key: AdjustReason; label: string }[] = isAddOnly
    ? [{ key: 'restock', label: 'Restock (+)' }]
    : [
        { key: 'restock',    label: 'Restock (+)' },
        { key: 'wastage',    label: 'Wastage (-)' },
        { key: 'breakage',   label: 'Breakage (-)' },
        { key: 'correction', label: 'Correction (+/-)' },
      ];

  const lowStockCount  = products.filter((p) => p.stockQty <= p.lowStockThreshold && p.stockQty > 0).length;
  const outOfStockCount = products.filter((p) => p.isOutOfStock || p.stockQty <= 0).length;

  // ── CSV template download ────────────────────────────────────────────────
  const handleDownloadTemplate = async () => {
    const header = 'name,qty';
    const rows = products.map((p) => `${p.name.replace(/,/g, '')},${p.stockQty}`);
    const csv = [header, ...rows].join('\n');
    const path = FileSystem.cacheDirectory + 'stock_template.csv';
    await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Stock Template' });
  };

  // ── CSV import ───────────────────────────────────────────────────────────
  const handleImportCSV = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setImporting(true);
    try {
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) { Alert.alert('Error', 'CSV is empty or missing data rows.'); return; }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const nameIdx = headers.indexOf('name');
      const qtyIdx  = headers.indexOf('qty');
      if (nameIdx === -1 || qtyIdx === -1) {
        Alert.alert('Invalid CSV', 'CSV must have "name" and "qty" columns.');
        return;
      }
      let updated = 0;
      let skipped = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        const name = cols[nameIdx]?.toLowerCase();
        const qty  = parseInt(cols[qtyIdx] ?? '', 10);
        if (!name || isNaN(qty)) { skipped++; continue; }
        const allProds = await database.get<Product>('products').query().fetch();
        const prod = allProds.find((p) => p.name.toLowerCase() === name);
        if (!prod) { skipped++; continue; }
        const oldQty = prod.stockQty;
        await database.write(async () => {
          await prod.update((p) => {
            p.stockQty = qty;
            if (qty > 0) p.isOutOfStock = false;
          });
          await database.get<StockAdjustment>('stock_adjustments').create((sa: any) => {
            sa.productId   = prod.id;
            sa.qty         = qty - oldQty;
            sa.reason      = 'restock';
            sa.performedBy = currentStaff?.id ?? '';
          });
        });
        updated++;
      }
      Alert.alert('Import Complete', `Updated: ${updated}  ·  Skipped: ${skipped}`);
      triggerAutoSync();
      await loadProducts();
    } catch (e: any) {
      Alert.alert('Import Error', e?.message ?? 'Could not read file');
    } finally {
      setImporting(false);
    }
  };

  const title = canSeeBar && canSeeKitchen
    ? 'Inventory'
    : canSeeBar
      ? 'Bar Inventory'
      : 'Kitchen Inventory';

  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header */}
      <View className="px-4 pt-3 pb-1">
        <View className="flex-row items-center mb-1">
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 6, marginRight: 8 }}>
            <Feather name="arrow-left" size={22} color="#4338CA" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-primary flex-1">{title}</Text>
          <TouchableOpacity
            onPress={handleDownloadTemplate}
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8 }}
          >
            <Feather name="download" size={14} color="#4338CA" style={{ marginRight: 4 }} />
            <Text style={{ color: '#4338CA', fontSize: 12, fontWeight: '700' }}>Template</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleImportCSV}
            disabled={importing}
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#4338CA', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
          >
            {importing
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Feather name="upload" size={14} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Import CSV</Text>
                </>
            }
          </TouchableOpacity>
        </View>

        {/* Bar / Kitchen toggle — only for admin & manager */}
        {canSeeBar && canSeeKitchen && (
          <View className="flex-row bg-gray-100 rounded-xl p-1 mt-2 mb-1">
            {(['bar', 'kitchen'] as const).map((s) => (
              <TouchableOpacity
                key={s}
                className={`flex-1 py-2 rounded-lg items-center ${activeStation === s ? 'bg-primary' : ''}`}
                onPress={() => setActiveStation(s)}
              >
                <Text className={`text-sm font-semibold ${activeStation === s ? 'text-white' : 'text-gray-600'}`}>
                  {s === 'bar' ? 'Bar' : 'Kitchen'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View className="flex-row mt-1">
          {outOfStockCount > 0 && (
            <Text className="text-xs text-red-600 mr-3">{outOfStockCount} out of stock</Text>
          )}
          {lowStockCount > 0 && (
            <Text className="text-xs text-yellow-600">{lowStockCount} low stock</Text>
          )}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
          <Text className="text-gray-400 mt-2">Loading...</Text>
        </View>
      ) : (
        <ScrollView className="flex-1 p-4">
          {products.length === 0 ? (
            <Text className="text-gray-400 text-center mt-8">
              No products found for {activeStation === 'bar' ? 'bar' : 'kitchen'}.
            </Text>
          ) : (
            products.map((prod) => (
              <TouchableOpacity
                key={prod.id}
                className={`rounded-xl p-4 mb-2 border ${getStockColor(prod)} flex-row items-center justify-between`}
                onPress={() => {
                  setShowAdjust(prod);
                  setAdjustReason('restock');
                  setAdjustQty('');
                }}
              >
                <View className="flex-1">
                  <Text className="text-base font-medium text-primary">{prod.name}</Text>
                  <Text className="text-xs text-gray-500">{catNames[prod.categoryId] || ''} · {prod.unit}</Text>
                </View>
                <View className="items-end">
                  <Text className={`text-lg font-bold ${prod.stockQty <= 0 ? 'text-red-600' : prod.stockQty <= prod.lowStockThreshold ? 'text-yellow-600' : 'text-primary'}`}>
                    {prod.stockQty}
                  </Text>
                  <Text className="text-xs text-gray-400">threshold: {prod.lowStockThreshold}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* Adjust Stock Modal */}
      <Modal visible={!!showAdjust} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-1">Adjust Stock</Text>
            <Text className="text-sm text-gray-500 mb-4">
              {showAdjust?.name} (current: {showAdjust?.stockQty})
            </Text>

            <Text className="text-sm font-medium text-gray-600 mb-2">Reason</Text>
            <View className="flex-row flex-wrap mb-3">
              {reasons.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  className={`px-3 py-2 rounded-lg mr-2 mb-2 ${adjustReason === r.key ? 'bg-primary' : 'bg-gray-100'}`}
                  onPress={() => setAdjustReason(r.key)}
                >
                  <Text className={`text-sm ${adjustReason === r.key ? 'text-white' : 'text-gray-700'}`}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text className="text-sm font-medium text-gray-600 mb-1">Quantity</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={adjustQty}
              onChangeText={setAdjustQty}
              placeholder="e.g. 10"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
              autoFocus
            />

            <View className="flex-row justify-end">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowAdjust(null)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-primary px-6 py-2 rounded-lg" onPress={handleAdjust}>
                <Text className="text-white font-medium">Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
