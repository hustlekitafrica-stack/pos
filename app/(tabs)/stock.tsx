import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { database } from '@/lib/db';
import { Product, StockAdjustment, Category, Staff } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { useAuthStore } from '@/stores/authStore';
import { triggerAutoSync } from '@/lib/db/sync';
import { verifyPin } from '@/lib/auth/pin';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

type AdjustReason = 'restock' | 'wastage' | 'breakage' | 'correction';
type TakeStep = 'count' | 'review';

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

  // ── Stock Take state ──────────────────────────────────────────────────────
  const [showTake, setShowTake]           = useState(false);
  const [takeStep, setTakeStep]           = useState<TakeStep>('count');
  const [takeCounts, setTakeCounts]       = useState<Record<string, string>>({});
  const [showPinApproval, setShowPinApproval] = useState(false);
  const [pinInput, setPinInput]           = useState('');
  const [pinError, setPinError]           = useState('');
  const [applying, setApplying]           = useState(false);
  const [approver, setApprover]           = useState<{ id: string; name: string } | null>(null);

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

  // ── CSV template download (station-specific, new-product fields) ─────────
  const handleDownloadCSV = async (station: 'bar' | 'kitchen') => {
    const cats = await database
      .get<Category>('categories')
      .query(Q.where('prep_station', station))
      .fetch();
    const header = 'name,category,selling price,cost price,unit,initial stock';
    // One realistic example row so the user can see the expected format
    const exampleCat = cats[0]?.name.replace(/,/g, '') ?? (station === 'bar' ? 'Beers' : 'Mains');
    const exampleRow = station === 'bar'
      ? `Tusker Lager,${exampleCat},200,140,bottle,24`
      : `Chips,${exampleCat},150,60,portion,20`;
    // One placeholder row per category showing valid category names
    const categoryRows = cats.map((c) => `,${c.name.replace(/,/g, '')},,,,`);
    const csv = [header, exampleRow, ...categoryRows].join('\n');
    const filename = `${station}_products_template.csv`;
    const path = FileSystem.cacheDirectory + filename;
    await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: `${station === 'bar' ? 'Bar' : 'Kitchen'} Products Template`,
    });
  };

  // ── CSV import — creates new products ──────────────────────────────────
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
      const rawHeaders = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const col = (name: string) => rawHeaders.indexOf(name);
      const nameIdx  = col('name');
      const catIdx   = col('category');
      const priceIdx = col('selling price');
      const costIdx  = col('cost price');
      const unitIdx  = col('unit');
      const stockIdx = col('initial stock');
      if ([nameIdx, catIdx, priceIdx, costIdx, unitIdx, stockIdx].includes(-1)) {
        Alert.alert('Invalid CSV', 'Required columns: name, category, selling price, cost price, unit, initial stock');
        return;
      }
      // Auto-detect station from filename (bar_products_template.csv / kitchen_products_template.csv)
      // Falls back to the currently active station toggle if the filename gives no hint.
      const fileName = (result.assets[0].name ?? '').toLowerCase();
      const detectedStation: 'bar' | 'kitchen' =
        fileName.includes('kitchen') ? 'kitchen' :
        fileName.includes('bar')     ? 'bar'     :
        activeStation;
      const stationCats = await database
        .get<Category>('categories')
        .query(Q.where('prep_station', detectedStation))
        .fetch();
      const catMap: Record<string, string> = {};
      for (const c of stationCats) catMap[c.name.toLowerCase()] = c.id;

      const existingProds = await database.get<Product>('products').query().fetch();
      const existingNames = new Set(existingProds.map((p) => p.name.toLowerCase()));

      let created = 0;
      let skipped = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        const name      = cols[nameIdx]?.trim();
        const catName   = cols[catIdx]?.trim().toLowerCase() ?? '';
        const price     = parseFloat(cols[priceIdx] ?? '');
        const costPrice = parseFloat(cols[costIdx] ?? '');
        const unit      = cols[unitIdx]?.trim() || '';
        const initStock = parseInt(cols[stockIdx] ?? '', 10);
        if (!name) { skipped++; continue; }
        if (existingNames.has(name.toLowerCase())) { skipped++; continue; }
        const categoryId = catMap[catName];
        if (!categoryId) { skipped++; continue; }
        if (isNaN(price) || isNaN(costPrice) || isNaN(initStock)) { skipped++; continue; }
        await database.write(async () => {
          const prod = await database.get<Product>('products').create((p) => {
            p.name              = name;
            p.categoryId        = categoryId;
            p.price             = price;
            p.costPrice         = costPrice;
            p.unit              = unit;
            p.stockQty          = initStock;
            p.lowStockThreshold = 0;
            p.isOutOfStock      = initStock <= 0;
            p.isActive          = true;
            p.lowStockAlertSent = false;
          });
          await database.get<StockAdjustment>('stock_adjustments').create((sa) => {
            sa.productId  = prod.id;
            sa.changeQty  = initStock;
            sa.reason     = 'restock';
            sa.adjustedBy = currentStaff?.id ?? '';
          });
        });
        existingNames.add(name.toLowerCase());
        created++;
      }
      const stationLabel = detectedStation === 'bar' ? 'Bar' : 'Kitchen';
      Alert.alert('Import Complete', `Station: ${stationLabel}\nCreated: ${created}  ·  Skipped: ${skipped}`);
      triggerAutoSync();
      await loadProducts();
    } catch (e: any) {
      Alert.alert('Import Error', e?.message ?? 'Could not read file');
    } finally {
      setImporting(false);
    }
  };

  // ── Stock Take helpers ───────────────────────────────────────────────────

  const openStockTake = () => {
    setTakeCounts({});
    setTakeStep('count');
    setApprover(null);
    setShowTake(true);
  };

  const closeTakeSafe = () => {
    const hasCounts = Object.values(takeCounts).some((v) => v !== '');
    if (hasCounts) {
      Alert.alert(
        'Discard Stock Take?',
        'All entered counts will be lost.',
        [
          { text: 'Keep Counting', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => setShowTake(false) },
        ]
      );
    } else {
      setShowTake(false);
    }
  };

  const getVarianceItems = () =>
    products
      .filter((p) => takeCounts[p.id] !== undefined && takeCounts[p.id] !== '')
      .map((p) => {
        const physical = parseInt(takeCounts[p.id], 10);
        return { product: p, physical: isNaN(physical) ? 0 : physical, variance: (isNaN(physical) ? 0 : physical) - p.stockQty };
      });

  const applyCorrections = async (approverId: string, approverName: string) => {
    setApplying(true);
    try {
      const items = getVarianceItems().filter((v) => v.variance !== 0);
      if (items.length > 0) {
        await database.write(async () => {
          for (const { product, physical, variance } of items) {
            await database.get<StockAdjustment>('stock_adjustments').create((sa) => {
              sa.productId = product.id;
              sa.adjustedBy = approverId;
              sa.changeQty = variance;
              sa.reason = 'stock_take';
            });
            await product.update((p) => {
              p.stockQty = physical;
              p.isOutOfStock = physical <= 0;
              if (physical > p.lowStockThreshold) p.lowStockAlertSent = false;
            });
          }
        });
        triggerAutoSync();
      }
      setApprover({ id: approverId, name: approverName });
      setShowTake(false);
      setTakeCounts({});
      Alert.alert('Done', `${items.length} correction${items.length !== 1 ? 's' : ''} applied.`);
      await loadProducts();
    } finally {
      setApplying(false);
    }
  };

  const handleManagerPin = async () => {
    if (pinInput.length !== 4) { setPinError('Enter a 4-digit PIN'); return; }
    setPinError('');
    try {
      const allStaff = await database.get<Staff>('staff').query(Q.where('is_active', true)).fetch();
      const managers = allStaff.filter((s) => s.role === 'admin' || s.role === 'manager');
      for (const m of managers) {
        if (await verifyPin(pinInput, m.pin)) {
          setPinInput('');
          setShowPinApproval(false);
          await applyCorrections(m.id, m.name);
          return;
        }
      }
      setPinError('Incorrect PIN — ask a manager/admin to try.');
      setPinInput('');
    } catch {
      setPinError('Verification failed. Try again.');
      setPinInput('');
    }
  };

  const printStockTakeReport = async (approverName: string) => {
    const varianceItems = getVarianceItems();
    const today = new Date().toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
    const stationLabel = activeStation === 'bar' ? 'BAR' : 'KITCHEN';
    const SEP = '================================';
    const DIV = '--------------------------------';
    const lines: string[] = [
      '\x1b\x61\x01',
      'STOCK TAKE REPORT\n',
      `${SEP}\n`,
      '\x1b\x61\x00',
      `${stationLabel.padEnd(16)}${today}\n`,
      `Approved by: ${approverName}\n`,
      `${DIV}\n`,
      'ITEM            SYS PHYS  VAR\n',
      `${DIV}\n`,
    ];
    for (const { product, physical, variance } of varianceItems) {
      const name = product.name.slice(0, 14).padEnd(14);
      const sys = String(product.stockQty).padStart(4);
      const phys = String(physical).padStart(5);
      const varStr = (variance > 0 ? '+' : '') + String(variance);
      lines.push(`${name}${sys}${phys}${varStr.padStart(5)}\n`);
    }
    lines.push(`${SEP}\n`);
    const withVar = varianceItems.filter((v) => v.variance !== 0).length;
    lines.push(`VARIANCES: ${withVar} item${withVar !== 1 ? 's' : ''}\n`);
    lines.push('\n\n\n');
    const { sendToPrinter } = require('@/lib/printer/connection');
    await sendToPrinter(activeStation, new TextEncoder().encode(lines.join(''))).catch(() => {});
  };

  // ─────────────────────────────────────────────────────────────────────────

  const title = canSeeBar && canSeeKitchen
    ? 'Inventory'
    : canSeeBar
      ? 'Bar Inventory'
      : 'Kitchen Inventory';

  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header */}
      <View className="px-4 pt-3 pb-1">
        {/* Row 1: back arrow + title */}
        <View className="flex-row items-center mb-2">
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 6, marginRight: 8 }}>
            <Feather name="arrow-left" size={22} color="#4338CA" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-primary">{title}</Text>
        </View>

        {/* Row 2: action buttons */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <TouchableOpacity
            onPress={openStockTake}
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EDE9FE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
          >
            <Feather name="clipboard" size={14} color="#4338CA" style={{ marginRight: 4 }} />
            <Text style={{ color: '#4338CA', fontSize: 12, fontWeight: '700' }}>Stock Take</Text>
          </TouchableOpacity>
          {canSeeBar && (
            <TouchableOpacity
              onPress={() => handleDownloadCSV('bar')}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <Feather name="download" size={14} color="#4338CA" style={{ marginRight: 4 }} />
              <Text style={{ color: '#4338CA', fontSize: 12, fontWeight: '700' }}>Bar CSV</Text>
            </TouchableOpacity>
          )}
          {canSeeKitchen && (
            <TouchableOpacity
              onPress={() => handleDownloadCSV('kitchen')}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <Feather name="download" size={14} color="#4338CA" style={{ marginRight: 4 }} />
              <Text style={{ color: '#4338CA', fontSize: 12, fontWeight: '700' }}>Kitchen CSV</Text>
            </TouchableOpacity>
          )}
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
          <View className="flex-row bg-gray-100 rounded-xl p-1 mb-1">
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

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* STOCK TAKE MODAL                                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Modal visible={showTake} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }}>

          {/* ── Header ─────────────────────────────────────────────────── */}
          <View style={{ backgroundColor: '#1E1B4B', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {takeStep === 'review' && (
                <TouchableOpacity onPress={() => setTakeStep('count')} style={{ marginRight: 12 }}>
                  <Feather name="arrow-left" size={20} color="#fff" />
                </TouchableOpacity>
              )}
              <View>
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>
                  Stock Take — {activeStation === 'bar' ? 'Bar' : 'Kitchen'}
                </Text>
                {takeStep === 'count' && (
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 1 }}>
                    {Object.values(takeCounts).filter((v) => v !== '').length} / {products.length} counted
                  </Text>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={closeTakeSafe}>
              <Feather name="x" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* PHASE 1 — COUNT ENTRY                                       */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {takeStep === 'count' && (
            <>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
                <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 10, marginTop: 2 }}>
                  Enter the physical count for each item. Leave blank to skip.
                </Text>
                {products.map((prod) => {
                  const raw = takeCounts[prod.id] ?? '';
                  const physical = raw !== '' ? parseInt(raw, 10) : null;
                  const variance = physical !== null && !isNaN(physical) ? physical - prod.stockQty : null;
                  return (
                    <View
                      key={prod.id}
                      style={{ backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#1E1B4B' }} numberOfLines={1}>{prod.name}</Text>
                        <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                          {catNames[prod.categoryId] || ''}{prod.unit ? ` · ${prod.unit}` : ''}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>System: {prod.stockQty}</Text>
                      </View>

                      <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                        {variance !== null && (
                          <View style={{
                            paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginBottom: 4,
                            backgroundColor: variance === 0 ? '#DCFCE7' : variance > 0 ? '#FEF3C7' : '#FEE2E2',
                          }}>
                            <Text style={{
                              fontSize: 11, fontWeight: '700',
                              color: variance === 0 ? '#16A34A' : variance > 0 ? '#D97706' : '#DC2626',
                            }}>
                              {variance > 0 ? `+${variance}` : String(variance)}
                            </Text>
                          </View>
                        )}
                        <TextInput
                          style={{ borderWidth: 1.5, borderColor: raw !== '' ? '#4338CA' : '#E2E8F0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, fontSize: 16, fontWeight: '700', color: '#1E1B4B', textAlign: 'center', width: 72, backgroundColor: '#F8FAFC' }}
                          value={raw}
                          onChangeText={(v) => setTakeCounts((prev) => ({ ...prev, [prod.id]: v.replace(/[^0-9]/g, '') }))}
                          keyboardType="numeric"
                          placeholder="—"
                          placeholderTextColor="#CBD5E1"
                          returnKeyType="next"
                        />
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              <View style={{ backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
                <TouchableOpacity
                  onPress={() => setTakeStep('review')}
                  disabled={Object.values(takeCounts).filter((v) => v !== '').length === 0}
                  style={{
                    backgroundColor: Object.values(takeCounts).filter((v) => v !== '').length > 0 ? '#4338CA' : '#CBD5E1',
                    borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginRight: 6 }}>Review Variances</Text>
                  <Feather name="arrow-right" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* PHASE 2 — VARIANCE REVIEW                                   */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {takeStep === 'review' && (() => {
            const varItems = getVarianceItems();
            const withVar = varItems.filter((v) => v.variance !== 0);
            const over = withVar.filter((v) => v.variance > 0).length;
            const under = withVar.filter((v) => v.variance < 0).length;
            const canApplyDirect = currentStaff?.role === 'admin' || currentStaff?.role === 'manager';
            return (
              <>
                {/* Summary banner */}
                <View style={{ backgroundColor: withVar.length > 0 ? '#FEF3C7' : '#DCFCE7', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' }}>
                  <Feather name={withVar.length > 0 ? 'alert-triangle' : 'check-circle'} size={16} color={withVar.length > 0 ? '#D97706' : '#16A34A'} style={{ marginRight: 8 }} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: withVar.length > 0 ? '#92400E' : '#166534' }}>
                    {withVar.length === 0
                      ? `All ${varItems.length} counted items match system stock`
                      : `${withVar.length} variance${withVar.length !== 1 ? 's' : ''} found — ${over} over, ${under} short`}
                  </Text>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 16 }}>
                  {/* Column header */}
                  <View style={{ flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', marginBottom: 6 }}>
                    <Text style={{ flex: 1, fontSize: 11, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 }}>Item</Text>
                    <Text style={{ width: 44, fontSize: 11, fontWeight: '700', color: '#64748B', textAlign: 'center', textTransform: 'uppercase' }}>Sys</Text>
                    <Text style={{ width: 44, fontSize: 11, fontWeight: '700', color: '#64748B', textAlign: 'center', textTransform: 'uppercase' }}>Phys</Text>
                    <Text style={{ width: 44, fontSize: 11, fontWeight: '700', color: '#64748B', textAlign: 'center', textTransform: 'uppercase' }}>Var</Text>
                  </View>

                  {varItems.map(({ product, physical, variance }) => (
                    <View
                      key={product.id}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', backgroundColor: variance !== 0 ? (variance < 0 ? '#FFF5F5' : '#FFFBEB') : '#fff', borderRadius: 8, marginBottom: 2 }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E1B4B' }} numberOfLines={1}>{product.name}</Text>
                        <Text style={{ fontSize: 10, color: '#94A3B8' }}>{product.unit}</Text>
                      </View>
                      <Text style={{ width: 44, fontSize: 13, color: '#64748B', textAlign: 'center' }}>{product.stockQty}</Text>
                      <Text style={{ width: 44, fontSize: 13, fontWeight: '700', color: '#1E1B4B', textAlign: 'center' }}>{physical}</Text>
                      <View style={{ width: 44, alignItems: 'center' }}>
                        <Text style={{
                          fontSize: 13, fontWeight: '800',
                          color: variance === 0 ? '#16A34A' : variance > 0 ? '#D97706' : '#DC2626',
                        }}>
                          {variance > 0 ? `+${variance}` : String(variance)}
                        </Text>
                      </View>
                    </View>
                  ))}

                  {varItems.length < products.length && (
                    <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
                      {products.length - varItems.length} item{products.length - varItems.length !== 1 ? 's' : ''} not counted (skipped)
                    </Text>
                  )}
                </ScrollView>

                {/* Action footer */}
                <View style={{ backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, borderTopWidth: 1, borderTopColor: '#E2E8F0', gap: 10 }}>
                  {/* Print */}
                  <TouchableOpacity
                    onPress={() => printStockTakeReport(currentStaff?.name ?? 'Staff')}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#4338CA', borderRadius: 12, paddingVertical: 11 }}
                  >
                    <Feather name="printer" size={16} color="#4338CA" style={{ marginRight: 6 }} />
                    <Text style={{ color: '#4338CA', fontWeight: '700', fontSize: 14 }}>Print Report</Text>
                  </TouchableOpacity>

                  {/* Apply / Request Approval */}
                  {canApplyDirect ? (
                    <TouchableOpacity
                      onPress={() => applyCorrections(currentStaff!.id, currentStaff!.name)}
                      disabled={applying || withVar.length === 0}
                      style={{ backgroundColor: applying || withVar.length === 0 ? '#CBD5E1' : '#4338CA', borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}
                    >
                      {applying
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
                            {withVar.length === 0 ? 'No Corrections Needed' : `Apply ${withVar.length} Correction${withVar.length !== 1 ? 's' : ''}`}
                          </Text>
                      }
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => { setPinInput(''); setPinError(''); setShowPinApproval(true); }}
                      disabled={withVar.length === 0}
                      style={{ backgroundColor: withVar.length === 0 ? '#CBD5E1' : '#1E1B4B', borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' }}
                    >
                      <Feather name="shield" size={16} color="#fff" style={{ marginRight: 8 }} />
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Request Manager Approval</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            );
          })()}

          {/* ── Manager PIN Approval Sheet ──────────────────────────── */}
          <Modal visible={showPinApproval} transparent animationType="slide">
            <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Feather name="shield" size={20} color="#4338CA" style={{ marginRight: 8 }} />
                  <Text style={{ fontSize: 17, fontWeight: '800', color: '#1E1B4B' }}>Manager Approval</Text>
                </View>
                <Text style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>
                  A manager or admin must enter their PIN to apply corrections.
                </Text>

                <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 }}>Manager PIN</Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: pinError ? '#EF4444' : '#E2E8F0', borderRadius: 12, padding: 14, fontSize: 24, fontWeight: '700', color: '#1E1B4B', textAlign: 'center', letterSpacing: 8, marginBottom: 6 }}
                  value={pinInput}
                  onChangeText={(v) => { setPinInput(v.replace(/[^0-9]/g, '').slice(0, 4)); setPinError(''); }}
                  keyboardType="numeric"
                  secureTextEntry
                  maxLength={4}
                  placeholder="••••"
                  placeholderTextColor="#CBD5E1"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleManagerPin}
                />
                {pinError ? <Text style={{ fontSize: 12, color: '#EF4444', marginBottom: 12, textAlign: 'center' }}>{pinError}</Text> : <View style={{ height: 18 }} />}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <TouchableOpacity onPress={() => setShowPinApproval(false)} style={{ flex: 1, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
                    <Text style={{ color: '#64748B', fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleManagerPin}
                    disabled={applying || pinInput.length !== 4}
                    style={{ flex: 2, backgroundColor: pinInput.length === 4 ? '#4338CA' : '#CBD5E1', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                  >
                    {applying
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Confirm & Apply</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}
