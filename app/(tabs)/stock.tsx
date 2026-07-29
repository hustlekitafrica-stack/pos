import { useState, useCallback } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { database } from '@/lib/db';
import { Product, StockAdjustment, Category } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { useAuthStore } from '@/stores/authStore';

type AdjustReason = 'restock' | 'wastage' | 'breakage' | 'correction';

export default function StockScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [catNames, setCatNames] = useState<Record<string, string>>({});
  const [showAdjust, setShowAdjust] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState<AdjustReason>('restock');
  const [loading, setLoading] = useState(false);
  const currentStaff = useAuthStore((s) => s.currentStaff);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    const data = await database.get<Product>('products').query(Q.where('is_active', true)).fetch();
    data.sort((a, b) => a.stockQty - b.stockQty);
    setProducts(data);

    const cats = await database.get<Category>('categories').query().fetch();
    const names: Record<string, string> = {};
    for (const c of cats) names[c.id] = c.name;
    setCatNames(names);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [loadProducts])
  );

  const handleAdjust = async () => {
    if (!showAdjust || !adjustQty.trim()) return;
    const qty = parseInt(adjustQty, 10);
    if (isNaN(qty) || qty === 0) return;

    const changeQty = adjustReason === 'restock' || adjustReason === 'correction' ? Math.abs(qty) : -Math.abs(qty);

    await database.write(async () => {
      // Record adjustment
      await database.get<StockAdjustment>('stock_adjustments').create((sa) => {
        sa.productId = showAdjust.id;
        sa.adjustedBy = currentStaff!.id;
        sa.changeQty = changeQty;
        sa.reason = adjustReason;
      });

      // Update product stock
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
    await loadProducts();
  };

  const getStockColor = (product: Product) => {
    if (product.isOutOfStock || product.stockQty <= 0) return 'border-red-500 bg-red-50';
    if (product.stockQty <= product.lowStockThreshold) return 'border-yellow-500 bg-yellow-50';
    return 'border-gray-200 bg-white';
  };

  const reasons: { key: AdjustReason; label: string }[] = [
    { key: 'restock', label: 'Restock (+)' },
    { key: 'wastage', label: 'Wastage (-)' },
    { key: 'breakage', label: 'Breakage (-)' },
    { key: 'correction', label: 'Correction (+/-)' },
  ];

  const lowStockCount = products.filter((p) => p.stockQty <= p.lowStockThreshold && p.stockQty > 0).length;
  const outOfStockCount = products.filter((p) => p.isOutOfStock || p.stockQty <= 0).length;

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="px-4 pt-2 pb-1">
        <Text className="text-xl font-bold text-primary">Stock Management</Text>
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
          {products.map((prod) => (
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
        ))}
        </ScrollView>
      )}

      {/* Adjust Stock Modal */}
      <Modal visible={!!showAdjust} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-1">Adjust Stock</Text>
            <Text className="text-sm text-gray-500 mb-4">{showAdjust?.name} (current: {showAdjust?.stockQty})</Text>

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
