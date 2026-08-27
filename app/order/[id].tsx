import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Modal, TextInput, Platform, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { database } from '@/lib/db';
import { Order as OrderModel, OrderItem as OrderItemModel, Product as ProductModel, Category as CategoryModel, Customer as CustomerModel, RestaurantTable as TableModel } from '@/lib/db/models';
import { initiateSTKPush, checkSTKStatus } from '@/lib/mpesa';
import { Q } from '@nozbe/watermelondb';
import { routeOrderItems } from '@/lib/printer/routeOrder';
import { buildOrderSlip, buildCustomerReceipt } from '@/lib/printer/templates';
import { sendToPrinter } from '@/lib/printer/connection';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  getOrderItems,
  addItemToOrder,
  reduceOrderItem,
  sendOrder,
  markOrderServed,
  voidOrderItem,
  recordPayment,
  getAllCategories,
  getProductsByCategory,
  recalculateOrderTotal,
  splitOrder,
  mergeOrders,
} from '@/lib/db/actions';
import { triggerAutoSync } from '@/lib/db/sync';

export default function OrderScreen() {
  const { id: orderId } = useLocalSearchParams<{ id: string }>();
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const can = useAuthStore((s) => s.can);
  const { venueName, venuePhone, venueAddress, mpesaPaybill } = useSettingsStore();

  const { width } = useWindowDimensions();
  const numCols = width >= 600 ? 3 : 2;

  const [order, setOrder] = useState<OrderModel | null>(null);
  const [items, setItems] = useState<OrderItemModel[]>([]);
  const [tableName, setTableName] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showMpesa, setShowMpesa] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [showCreditPicker, setShowCreditPicker] = useState(false);
  const [showClientInput, setShowClientInput] = useState(false);
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [mpesaLoading, setMpesaLoading] = useState(false);
  const [splitCashAmount, setSplitCashAmount] = useState('');
  const [splitMpesaAmount, setSplitMpesaAmount] = useState('');
  const [creditCustomers, setCreditCustomers] = useState<CustomerModel[]>([]);
  const [clientId, setClientId] = useState('');

  const [showRefund, setShowRefund] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidingItem, setVoidingItem] = useState<OrderItemModel | null>(null);
  const [voidReason, setVoidReason] = useState('');
  // Split bill
  const [showSplitBill, setShowSplitBill] = useState(false);
  const [splitSelectedIds, setSplitSelectedIds] = useState<Set<string>>(new Set());
  // Merge bills
  const [showMergeBills, setShowMergeBills] = useState(false);
  const [mergeableOrders, setMergeableOrders] = useState<{ order: OrderModel; tableName: string; itemCount: number }[]>([]);
  const [printingSlip, setPrintingSlip] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [lastMpesaRef, setLastMpesaRef] = useState<string | undefined>();
  const [categories, setCategories] = useState<CategoryModel[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductModel[]>([]);
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const [menuStation, setMenuStation] = useState<'bar' | 'kitchen'>(
    can('adjustBarStock') ? 'bar' : 'kitchen'
  );
  const [cartExpanded, setCartExpanded] = useState(true);
  const canSeeMenuBar     = can('adjustBarStock');
  const canSeeMenuKitchen = can('adjustKitchenStock');

  const loadOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      const o = await database.get<OrderModel>('orders').find(orderId);
      setOrder(o);
      setClientId(o.roomNumber || '');
      try {
        const tbl = await database.get<TableModel>('restaurant_tables').find(o.tableId);
        setTableName(tbl.name);
      } catch {
        setTableName('Table');
      }
      const orderItems = await getOrderItems(orderId);
      setItems(orderItems);

      // Load product names for display
      const names: Record<string, string> = {};
      for (const item of orderItems) {
        if (!names[item.productId]) {
          try {
            const prod = await database.get<ProductModel>('products').find(item.productId);
            names[item.productId] = prod.name;
          } catch {
            names[item.productId] = 'Unknown';
          }
        }
      }
      setProductNames(names);
    } catch (e) {
      Alert.alert('Error', 'Order not found');
      router.back();
    }
  }, [orderId]);

  useFocusEffect(
    useCallback(() => {
      loadOrder();
    }, [loadOrder])
  );

  const loadCategories = async (station?: 'bar' | 'kitchen') => {
    const all = await getAllCategories();
    const targetStation = station ?? menuStation;
    const filtered = all.filter((c) => c.prepStation === targetStation);
    setCategories(filtered);
    if (filtered.length > 0) {
      setSelectedCategoryId(filtered[0].id);
      const prods = await getProductsByCategory(filtered[0].id);
      setProducts(prods);
    } else {
      setSelectedCategoryId(null);
      setProducts([]);
    }
  };

  const handleSelectCategory = async (catId: string) => {
    setSelectedCategoryId(catId);
    const prods = await getProductsByCategory(catId);
    setProducts(prods);
  };

  const handleMenuStation = async (station: 'bar' | 'kitchen') => {
    setMenuStation(station);
    await loadCategories(station);
  };

  const handleAddItem = async (product: ProductModel) => {
    if (!orderId) return;
    if (product.isOutOfStock || product.stockQty <= 0) {
      Alert.alert('Out of Stock', `${product.name} is out of stock`);
      return;
    }
    await addItemToOrder({
      orderId,
      productId: product.id,
      qty: 1,
      unitPrice: product.price,
    });
    await loadOrder();
  };

  const handleSendOrder = async () => {
    if (!orderId) return;
    const pendingItems = items.filter((i) => i.status === 'pending' && !i.voided);
    if (pendingItems.length === 0) {
      Alert.alert('Nothing to Send', 'No pending items to send.');
      return;
    }
    await sendOrder(orderId);

    // Route items to bar/kitchen printers
    try {
      setPrintingSlip(true);
      const categoryCache: Record<string, CategoryModel | null> = {};
      const getCat = (productId: string) => categoryCache[productId] ?? null;

      // Pre-load categories for pending items
      for (const item of pendingItems) {
        if (!(item.productId in categoryCache)) {
          try {
            const prod = await database.get<ProductModel>('products').find(item.productId);
            const cat = await database.get<CategoryModel>('categories').find(prod.categoryId);
            categoryCache[item.productId] = cat;
          } catch {
            categoryCache[item.productId] = null;
          }
        }
      }

      const routed = routeOrderItems(pendingItems, getCat);
      const tName = tableName || 'Table';
      const clientLabel = clientId || undefined;
      const printJobs: Promise<boolean>[] = [];

      if (routed.kitchen.length > 0) {
        const slip = buildOrderSlip(
          tName,
          routed.kitchen.map((i) => ({ name: productNames[i.productId] || i.productId, qty: i.qty, notes: i.notes ?? undefined })),
          'kitchen',
          clientLabel,
          currentStaff?.name ?? '',
          venueName,
          venuePhone || undefined,
          venueAddress || undefined,
        );
        printJobs.push(sendToPrinter('kitchen', new TextEncoder().encode(slip)));
      }

      if (printJobs.length > 0) {
        const results = await Promise.all(printJobs);
        if (results.some((ok) => !ok)) {
          Alert.alert('Printer', 'Order saved but slips did not print. Check printer in Settings → Printers.');
        }
      }
    } catch {
      // Printer failure is non-fatal
    } finally {
      setPrintingSlip(false);
    }

    router.replace('/(tabs)/orders');
  };

  const handleMarkServed = async () => {
    if (!orderId) return;
    await markOrderServed(orderId);
    await loadOrder();
  };

  const handleVoidItem = (item: OrderItemModel) => {
    setVoidingItem(item);
    setVoidReason('');
    setShowVoidModal(true);
  };

  const confirmVoidItem = async () => {
    if (!voidingItem) return;
    await voidOrderItem(voidingItem.id, voidReason.trim() || 'Voided by staff', currentStaff!.id);
    setShowVoidModal(false);
    setVoidingItem(null);
    setVoidReason('');
    await loadOrder();
  };

  const handleCashPayment = async () => {
    if (!order) return;
    await recordPayment({
      orderId: order.id,
      method: 'cash',
      amount: order.totalAmount,
    });
    setShowPayment(false);
    handlePrintReceipt(true).catch(() => {});
    Alert.alert('Payment Recorded', 'Cash payment successful');
    router.back();
  };

  const handleMpesaPayment = async () => {
    if (!order || !mpesaPhone.trim()) return;
    setMpesaLoading(true);
    try {
      const result = await initiateSTKPush(mpesaPhone, order.totalAmount, order.id);
      if (!result.success) {
        Alert.alert('M-Pesa Error', result.errorMessage || 'Could not initiate payment');
        setMpesaLoading(false);
        return;
      }

      // Poll for confirmation (max 30 seconds)
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        if (attempts > 10) {
          clearInterval(pollInterval);
          setMpesaLoading(false);
          Alert.alert('Timeout', 'M-Pesa confirmation timed out. Check manually.');
          return;
        }

        const status = await checkSTKStatus(result.checkoutRequestId!);
        if (status && status.resultCode === 0) {
          clearInterval(pollInterval);
          await recordPayment({
            orderId: order.id,
            method: 'mpesa',
            amount: order.totalAmount,
            mpesaRef: status.mpesaReceiptNumber,
          });
          setLastMpesaRef(status.mpesaReceiptNumber);
          setMpesaLoading(false);
          setShowMpesa(false);
          setShowPayment(false);
          Alert.alert('Payment Successful', `M-Pesa Ref: ${status.mpesaReceiptNumber}`);
          router.back();
        } else if (status && status.resultCode !== 0) {
          clearInterval(pollInterval);
          setMpesaLoading(false);
          Alert.alert('Payment Failed', status.resultDesc);
        }
      }, 3000);
    } catch (e) {
      setMpesaLoading(false);
      Alert.alert('Error', 'M-Pesa payment failed');
    }
  };

  const handleCardPayment = async () => {
    if (!order) return;
    await recordPayment({
      orderId: order.id,
      method: 'card',
      amount: order.totalAmount,
    });
    setShowPayment(false);
    handlePrintReceipt(true).catch(() => {});
    Alert.alert('Payment Recorded', 'Card payment recorded');
    router.back();
  };

  const handleCreditPayment = async (customer: CustomerModel) => {
    if (!order) return;

    // Check credit limit
    if (customer.creditLimit > 0) {
      const txns = await database
        .get('credit_transactions')
        .query(Q.where('customer_id', customer.id))
        .fetch();
      let balance = 0;
      for (const t of txns as any[]) {
        balance += t.type === 'credit_sale' ? t.amount : -t.amount;
      }
      if (balance + order.totalAmount > customer.creditLimit) {
        Alert.alert('Credit Limit', `This sale would exceed ${customer.name}'s credit limit`);
        return;
      }
    }

    await database.write(async () => {
      // Mark order as credit
      await order.update((o) => {
        o.isCredit = true;
        o.customerId = customer.id;
        o.status = 'paid';
        o.closedAt = new Date();
      });

      // Record payment as credit
      await database.get('payments').create((p: any) => {
        p.orderId = order.id;
        p.method = 'credit';
        p.amount = order.totalAmount;
        p.paidAt = new Date();
      });

      // Create credit transaction
      await database.get('credit_transactions').create((ct: any) => {
        ct.customerId = customer.id;
        ct.orderId = order.id;
        ct.type = 'credit_sale';
        ct.amount = order.totalAmount;
        ct.recordedBy = currentStaff!.id;
      });

      // Free table
      const tbl = await database.get('restaurant_tables').find(order.tableId);
      await tbl.update((t: any) => { t.status = 'free'; });
    });

    triggerAutoSync();
    setShowCreditPicker(false);
    setShowPayment(false);
    Alert.alert('Credit Sale', `Charged to ${customer.name}'s account`);
    router.back();
  };

  const handleSplitPayment = async () => {
    if (!order) return;
    const cashCents = toCents(parseFloat(splitCashAmount) || 0);
    const mpesaCents = toCents(parseFloat(splitMpesaAmount) || 0);
    const total = cashCents + mpesaCents;

    if (total < order.totalAmount) {
      Alert.alert('Insufficient', `Split amounts (${formatKES(total)}) don't cover the total (${formatKES(order.totalAmount)})`);
      return;
    }

    if (cashCents > 0) {
      await recordPayment({ orderId: order.id, method: 'cash', amount: cashCents });
    }
    if (mpesaCents > 0) {
      await recordPayment({ orderId: order.id, method: 'mpesa', amount: mpesaCents });
    }

    setShowSplit(false);
    setShowPayment(false);
    Alert.alert('Split Payment', 'Payments recorded');
    router.back();
  };

  // silent=true suppresses alerts (used for auto-print after payment)
  const handlePrintReceipt = async (silent = false) => {
    if (!order) return;

    const receipt = buildCustomerReceipt({
      orderNumber: order.id.slice(-6).toUpperCase(),
      tableName,
      staffName: currentStaff?.name ?? '',
      clientName: clientId || undefined,
      items: activeItems.map((item) => ({
        name: productNames[item.productId] || item.productId,
        qty: item.qty,
        unitPrice: item.unitPrice,
        isComplimentary: item.isComplimentary ?? false,
      })),
      total: order.totalAmount,
      mpesaRef: lastMpesaRef,
      timestamp: new Date().toISOString(),
      venueName,
      venuePhone:   venuePhone   || undefined,
      venueAddress: venueAddress || undefined,
      mpesaPaybill: mpesaPaybill || undefined,
    });

    setPrintingReceipt(true);
    const ok = await sendToPrinter('bar', new TextEncoder().encode(receipt));
    setPrintingReceipt(false);
    if (!silent) {
      if (ok) {
        Alert.alert('Sent', 'Receipt sent to printer.');
      } else {
        Alert.alert('Printer Error', 'Could not reach printer. Connect in Settings → Printers.');
      }
    }
  };

  const openCreditPicker = async () => {
    const customers = await database
      .get<CustomerModel>('customers')
      .query(Q.where('is_active', true))
      .fetch();
    setCreditCustomers(customers);
    setShowCreditPicker(true);
  };



  const handleToggleComp = async (item: OrderItemModel) => {
    await database.write(async () => {
      await item.update((i) => {
        i.isComplimentary = !i.isComplimentary;
        if (!i.isComplimentary) {
          i.compReason = null;
          i.compAuthorizedBy = null;
        } else {
          i.compReason = 'Complimentary';
          i.compAuthorizedBy = currentStaff!.id;
        }
      });
    });
    await recalculateOrderTotal(item.orderId);
    triggerAutoSync();
    await loadOrder();
  };

  const handleRefundOrder = async () => {
    if (!order) return;
    if (!refundReason.trim()) {
      Alert.alert('Required', 'Enter a reason for the refund');
      return;
    }
    await database.write(async () => {
      // Create refund record
      await database.get('refunds').create((r: any) => {
        r.amount = order.totalAmount;
        r.reason = refundReason.trim();
        r.authorizedBy = currentStaff!.id;
      });

      // Restore stock for all non-voided sent items
      const orderItems = await getOrderItems(order.id);
      for (const item of orderItems) {
        if (!item.voided && (item.status === 'sent' || item.status === 'served')) {
          const product = await database.get<ProductModel>('products').find(item.productId);
          await product.update((p) => {
            p.stockQty += item.qty;
            if (p.stockQty > 0) p.isOutOfStock = false;
          });
        }
      }

      // Update order
      await order.update((o) => {
        o.status = 'voided';
      });

      // Free table
      const tbl = await database.get('restaurant_tables').find(order.tableId);
      await tbl.update((t: any) => { t.status = 'free'; });
    });

    triggerAutoSync();
    setShowRefund(false);
    setRefundReason('');
    Alert.alert('Refund Processed', 'Order voided and stock restored');
    router.back();
  };

  const handleSaveClientId = async () => {
    if (!order) return;
    await database.write(async () => {
      await order.update((o) => {
        o.roomNumber = clientId.trim() || null;
      });
    });
    triggerAutoSync();
    setShowClientInput(false);
    await loadOrder();
  };

  // ── Split Bill ──────────────────────────────────────────────────────────────
  const openSplitBill = () => {
    setSplitSelectedIds(new Set());
    setShowSplitBill(true);
  };

  const toggleSplitItem = (itemId: string) => {
    setSplitSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleConfirmSplit = async () => {
    if (!order) return;
    if (splitSelectedIds.size === 0) {
      Alert.alert('Select Items', 'Select at least one item to move to a new bill.');
      return;
    }
    if (splitSelectedIds.size >= activeItems.length) {
      Alert.alert('Invalid Split', 'At least one item must remain in the current bill.');
      return;
    }
    const newOrder = await splitOrder(order.id, Array.from(splitSelectedIds));
    setShowSplitBill(false);
    Alert.alert('Bill Split', 'Items have been moved to a new bill.', [
      { text: 'View New Bill', onPress: () => router.replace(`/order/${newOrder.id}` as any) },
      { text: 'Stay Here', onPress: () => loadOrder() },
    ]);
  };

  // ── Merge Bills ─────────────────────────────────────────────────────────────
  const openMergeBills = async () => {
    if (!order) return;
    const all = await database
      .get<OrderModel>('orders')
      .query(Q.where('status', Q.notIn(['paid', 'closed', 'voided'])))
      .fetch();
    const others = all.filter((o) => o.id !== order.id);
    const cards: { order: OrderModel; tableName: string; itemCount: number }[] = [];
    for (const o of others) {
      let tName = 'Table';
      try {
        const tbl = await database.get<TableModel>('restaurant_tables').find(o.tableId);
        tName = tbl.name;
      } catch {}
      const oi = await database
        .get('order_items')
        .query(Q.where('order_id', o.id), Q.where('voided', false))
        .fetch();
      cards.push({ order: o, tableName: tName, itemCount: oi.length });
    }
    setMergeableOrders(cards);
    setShowMergeBills(true);
  };

  const handleMergeInto = (sourceOrder: OrderModel, sourceName: string) => {
    if (!order) return;
    Alert.alert(
      'Merge Bills',
      `Move all items from "${sourceName}" into this bill?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          style: 'destructive',
          onPress: async () => {
            await mergeOrders(sourceOrder.id, order.id);
            setShowMergeBills(false);
            await loadOrder();
            Alert.alert('Merged', 'Bills have been merged successfully.');
          },
        },
      ]
    );
  };

  const openMenuModal = async () => {
    const initStation = can('adjustBarStock') ? 'bar' : 'kitchen';
    setMenuStation(initStation);
    setCartExpanded(true);
    await loadCategories(initStation);
    setShowMenu(true);
  };

  const activeItems = items.filter((i) => !i.voided);
  const pendingCount = activeItems.filter((i) => i.status === 'pending').length;
  const hasPendingItems = activeItems.some((i) => i.status === 'pending');
  const hasSentItems = activeItems.some((i) => i.status === 'sent');

  const getItemStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-gray-200 text-gray-700';
      case 'sent': return 'bg-yellow-200 text-yellow-800';
      case 'preparing': return 'bg-blue-200 text-blue-800';
      case 'served': return 'bg-green-200 text-green-800';
      case 'voided': return 'bg-red-200 text-red-800';
      default: return 'bg-gray-200 text-gray-700';
    }
  };

  if (!order) return null;

  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header */}
      <View className="flex-row items-center justify-between p-4 bg-primary">
        <TouchableOpacity onPress={() => router.back()} className="w-16">
          <Text className="text-white text-lg">← Back</Text>
        </TouchableOpacity>
        <View className="items-center flex-1">
          <Text className="text-white text-lg font-bold">{tableName}</Text>
          <Text className="text-gray-300 text-xs">{order.status.toUpperCase()}</Text>
        </View>
        <TouchableOpacity onPress={() => setShowClientInput(true)} className="w-24 items-end">
          <Text className="text-gray-300 text-sm" numberOfLines={1}>
            {clientId ? clientId : '+ Client'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Order Items */}
      <ScrollView className="flex-1 p-4">
        {activeItems.length === 0 ? (
          <Text className="text-gray-400 text-center mt-8">No items yet. Tap "Add Items" to start.</Text>
        ) : (
          activeItems.map((item) => (
            <View key={item.id} className="bg-white rounded-xl p-3 mb-2 flex-row items-center justify-between border border-gray-100">
              <View className="flex-1">
                <Text className="text-base font-medium text-primary">
                  {item.qty}x {productNames[item.productId] || '...'}
                </Text>
                {item.notes ? <Text className="text-xs text-gray-500 mt-0.5">{item.notes}</Text> : null}
                {item.isComplimentary ? <Text className="text-xs text-blue-600">COMP</Text> : null}
              </View>
              <View className="flex-row items-center">
                <View className={`px-2 py-0.5 rounded mr-2 ${getItemStatusBadge(item.status)}`}>
                  <Text className="text-xs font-medium">{item.status}</Text>
                </View>
                <Text className="text-sm font-medium text-primary mr-2">
                  {item.isComplimentary ? 'FREE' : formatKES(item.unitPrice * item.qty)}
                </Text>
                {!item.voided && item.status !== 'voided' && can('applyDiscount') && (
                  <TouchableOpacity onPress={() => handleToggleComp(item)} className="mr-2">
                    <Text className="text-blue-500 text-xs">{item.isComplimentary ? 'UNDO' : 'COMP'}</Text>
                  </TouchableOpacity>
                )}
                {!item.voided && item.status !== 'voided' && (
                  <TouchableOpacity onPress={() => handleVoidItem(item)}>
                    <Text className="text-red-500 text-xs">✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Footer */}
      <View className="p-4 bg-white border-t border-gray-200">

        <View className="flex-row justify-between mb-3">
          <Text className="text-lg font-bold text-primary">Total</Text>
          <Text className="text-lg font-bold text-primary">{formatKES(order.totalAmount)}</Text>
        </View>

        <View className="flex-row flex-wrap">
          <TouchableOpacity
            className="flex-1 bg-primary p-3 rounded-xl items-center mr-2 mb-2"
            onPress={openMenuModal}
          >
            <Feather name="plus" size={20} color="#fff" />
          </TouchableOpacity>



          {can('processRefund') && (order.status === 'paid' || order.status === 'served') && (
            <TouchableOpacity
              className="bg-red-700 p-3 rounded-xl items-center mr-2 mb-2 px-4"
              onPress={() => setShowRefund(true)}
            >
              <Feather name="rotate-ccw" size={20} color="#fff" />
            </TouchableOpacity>
          )}

          {!['paid', 'closed', 'voided'].includes(order.status) && activeItems.length >= 2 && (
            <TouchableOpacity
              className="bg-indigo-500 p-3 rounded-xl items-center mr-2 mb-2 px-4"
              onPress={openSplitBill}
            >
              <Feather name="scissors" size={20} color="#fff" />
            </TouchableOpacity>
          )}

          {!['paid', 'closed', 'voided'].includes(order.status) && (
            <TouchableOpacity
              className="bg-teal-600 p-3 rounded-xl items-center mr-2 mb-2 px-4"
              onPress={openMergeBills}
            >
              <Feather name="git-merge" size={20} color="#fff" />
            </TouchableOpacity>
          )}

          {hasPendingItems && (
            <TouchableOpacity
              className="flex-1 bg-yellow-500 p-3 rounded-xl items-center mr-2"
              onPress={handleSendOrder}
              disabled={printingSlip}
            >
              {printingSlip ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="send" size={20} color="#fff" />
                  {pendingCount > 0 && (
                    <View style={{ position: 'absolute', top: -8, right: -12, backgroundColor: '#dc2626', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{pendingCount}</Text>
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          )}


          {/* Print Receipt — available anytime there are items */}
          {activeItems.length > 0 && (
            <TouchableOpacity
              className="bg-indigo-500 p-3 rounded-xl items-center mr-2 mb-2 px-4"
              onPress={() => handlePrintReceipt()}
              disabled={printingReceipt}
            >
              {printingReceipt
                ? <ActivityIndicator color="#fff" size="small" />
                : <Feather name="printer" size={20} color="#fff" />
              }
            </TouchableOpacity>
          )}

          {['sent', 'served', 'awaiting_payment'].includes(order.status) && order.totalAmount > 0 && (
            <TouchableOpacity
              className="flex-1 bg-accent p-3 rounded-xl items-center mb-2"
              onPress={() => setShowPayment(true)}
            >
              <Feather name="check-circle" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Menu Modal */}
      <Modal visible={showMenu} animationType="slide" onShow={() => setMenuSearchQuery('')}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>

          {/* Header */}
          <View style={{ backgroundColor: '#1e1b4b', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Add Items</Text>
            <TouchableOpacity onPress={() => setShowMenu(false)} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Station tabs — only shown when user can see both */}
          {canSeeMenuBar && canSeeMenuKitchen && (
            <View style={{ flexDirection: 'row', backgroundColor: '#1e1b4b', paddingHorizontal: 16, paddingBottom: 10, gap: 8 }}>
              {(['bar', 'kitchen'] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => handleMenuStation(s)}
                  style={{ flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: 'center', backgroundColor: menuStation === s ? '#4338CA' : 'rgba(255,255,255,0.12)' }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{s === 'bar' ? 'Bar' : 'Kitchen'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Category pills + inline search */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center' }} style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => handleSelectCategory(cat.id)}
                  style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: selectedCategoryId === cat.id ? '#4338CA' : '#e2e8f0', marginRight: 8 }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: selectedCategoryId === cat.id ? '#fff' : '#64748b' }}>{cat.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {/* Inline search */}
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 10, height: 36, marginLeft: 8, minWidth: 90 }}>
              <Feather name="search" size={14} color="#94a3b8" style={{ marginRight: 6 }} />
              <TextInput
                style={{ flex: 1, fontSize: 13, color: '#1e1b4b', paddingVertical: 0 }}
                value={menuSearchQuery}
                onChangeText={setMenuSearchQuery}
                placeholder="Search…"
                placeholderTextColor="#94a3b8"
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {menuSearchQuery.length > 0 && Platform.OS !== 'ios' && (
                <TouchableOpacity onPress={() => setMenuSearchQuery('')}>
                  <Feather name="x" size={14} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Product Grid */}
          {(() => {
            const pendingByProduct: Record<string, number> = {};
            for (const item of items) {
              if (!item.voided && item.status === 'pending') {
                pendingByProduct[item.productId] = (pendingByProduct[item.productId] || 0) + item.qty;
              }
            }
            const q = menuSearchQuery.trim().toLowerCase();
            const visible = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
            return (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 8, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                {visible.length === 0 ? (
                  <Text style={{ color: '#9ca3af', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
                    {q ? `No items matching "${menuSearchQuery}"` : 'No items in this category'}
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {visible.map((prod) => {
                      const outOfStock = prod.isOutOfStock || prod.stockQty <= 0;
                      const qtyInOrder = pendingByProduct[prod.id] || 0;
                      return (
                        <TouchableOpacity
                          key={prod.id}
                          onPress={() => handleAddItem(prod)}
                          disabled={outOfStock}
                          style={{ width: `${100 / numCols}%`, padding: 4 }}
                          activeOpacity={0.75}
                        >
                          <View style={{ backgroundColor: outOfStock ? '#f1f5f9' : '#fff', borderRadius: 14, padding: 12, borderWidth: 2, borderColor: qtyInOrder > 0 ? '#4338CA' : (outOfStock ? '#e2e8f0' : '#f1f5f9'), minHeight: 110, justifyContent: 'space-between', opacity: outOfStock ? 0.55 : 1 }}>
                            {/* Qty badge */}
                            {qtyInOrder > 0 && (
                              <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: '#4338CA', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{qtyInOrder}×</Text>
                              </View>
                            )}
                            <Text style={{ fontSize: 26, marginBottom: 6 }}>{prod.name.charAt(0).toUpperCase()}</Text>
                            <View>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e1b4b' }} numberOfLines={2}>{prod.name}</Text>
                              <Text style={{ fontSize: 13, fontWeight: '800', color: '#4338CA', marginTop: 2 }}>{formatKES(prod.price)}</Text>
                              {outOfStock ? (
                                <Text style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>Out of stock</Text>
                              ) : (
                                <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{prod.stockQty} left</Text>
                              )}
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </ScrollView>
            );
          })()}

          {/* ── Mini Cart Strip ───────────────────────────────────────────── */}
          {(() => {
            const pendingItems = items.filter((i) => !i.voided && i.status === 'pending');
            if (pendingItems.length === 0) return null;

            const grouped: Record<string, { name: string; qty: number; unitPrice: number }> = {};
            for (const item of pendingItems) {
              if (!grouped[item.productId]) {
                grouped[item.productId] = {
                  name: productNames[item.productId] || '…',
                  qty: 0,
                  unitPrice: item.unitPrice,
                };
              }
              grouped[item.productId].qty += item.qty;
            }
            const groupedList = Object.entries(grouped);
            const cartTotal = groupedList.reduce((s, [, g]) => s + g.qty * g.unitPrice, 0);
            const totalQty = groupedList.reduce((s, [, g]) => s + g.qty, 0);

            return (
              <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
                {/* Summary row — tap to expand/collapse */}
                <TouchableOpacity
                  onPress={() => setCartExpanded((v) => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}
                >
                  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#4338CA', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{totalQty}</Text>
                  </View>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: '#1e1b4b' }}>{totalQty} item{totalQty !== 1 ? 's' : ''} in order</Text>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#4338CA', marginRight: 8 }}>{formatKES(cartTotal)}</Text>
                  <Feather name={cartExpanded ? 'chevron-down' : 'chevron-up'} size={16} color="#64748b" />
                </TouchableOpacity>

                {/* Expanded item list */}
                {cartExpanded && (
                  <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
                    {groupedList.map(([productId, g]) => (
                      <View key={productId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
                        <Text style={{ flex: 1, fontSize: 13, color: '#1e1b4b', fontWeight: '500' }} numberOfLines={1}>{g.name}</Text>
                        <Text style={{ fontSize: 12, color: '#64748b', marginRight: 12, width: 60, textAlign: 'right' }}>{formatKES(g.qty * g.unitPrice)}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 2 }}>
                          <TouchableOpacity
                            onPress={async () => {
                              if (!orderId || !currentStaff) return;
                              await reduceOrderItem(orderId, productId, currentStaff.id);
                              await loadOrder();
                            }}
                            style={{ padding: 6 }}
                          >
                            <Feather name="minus" size={14} color="#4338CA" />
                          </TouchableOpacity>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: '#1e1b4b', minWidth: 20, textAlign: 'center' }}>{g.qty}</Text>
                          <TouchableOpacity
                            onPress={async () => {
                              try {
                                const prod = await database.get<ProductModel>('products').find(productId);
                                await handleAddItem(prod);
                              } catch {}
                            }}
                            style={{ padding: 6 }}
                          >
                            <Feather name="plus" size={14} color="#4338CA" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })()}

        </SafeAreaView>
      </Modal>

      {/* Payment Modal */}
      <Modal visible={showPayment} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-xl font-bold text-primary mb-2">Payment</Text>
            <Text className="text-2xl font-bold text-primary mb-6">{formatKES(order.totalAmount)}</Text>

            <TouchableOpacity
              className="bg-green-600 p-4 rounded-xl items-center mb-3"
              onPress={handleCashPayment}
            >
              <Text className="text-white font-bold text-lg">Cash</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="bg-green-700 p-4 rounded-xl items-center mb-3"
              onPress={() => { setShowPayment(false); setShowMpesa(true); }}
            >
              <Text className="text-white font-bold text-lg">M-Pesa</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="bg-blue-600 p-4 rounded-xl items-center mb-3"
              onPress={handleCardPayment}
            >
              <Text className="text-white font-bold text-lg">Card</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="bg-yellow-600 p-4 rounded-xl items-center mb-3"
              onPress={openCreditPicker}
            >
              <Text className="text-white font-bold text-lg">Credit (Account)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="bg-purple-600 p-4 rounded-xl items-center mb-4"
              onPress={() => { setShowPayment(false); setShowSplit(true); }}
            >
              <Text className="text-white font-bold text-lg">Split Payment</Text>
            </TouchableOpacity>

            <TouchableOpacity className="items-center" onPress={() => setShowPayment(false)}>
              <Text className="text-gray-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* M-Pesa Modal */}
      <Modal visible={showMpesa} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-2">M-Pesa Payment</Text>
            <Text className="text-xl font-bold text-primary mb-4">{formatKES(order.totalAmount)}</Text>
            <Text className="text-sm text-gray-500 mb-2">Customer Phone Number</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={mpesaPhone}
              onChangeText={setMpesaPhone}
              placeholder="0712345678"
              placeholderTextColor="#9ca3af"
              keyboardType="phone-pad"
              autoFocus
              editable={!mpesaLoading}
            />
            <TouchableOpacity
              className={`p-4 rounded-xl items-center mb-3 ${mpesaLoading ? 'bg-gray-400' : 'bg-green-700'}`}
              onPress={handleMpesaPayment}
              disabled={mpesaLoading}
            >
              <Text className="text-white font-bold text-lg">
                {mpesaLoading ? 'Waiting for payment...' : 'Send STK Push'}
              </Text>
            </TouchableOpacity>
            {!mpesaLoading && (
              <TouchableOpacity className="items-center" onPress={() => setShowMpesa(false)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Split Payment Modal */}
      <Modal visible={showSplit} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-2">Split Payment</Text>
            <Text className="text-xl font-bold text-primary mb-4">Total: {formatKES(order.totalAmount)}</Text>

            <Text className="text-sm font-medium text-gray-600 mb-1">Cash Amount (KES)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={splitCashAmount}
              onChangeText={setSplitCashAmount}
              placeholder="0.00"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
            />

            <Text className="text-sm font-medium text-gray-600 mb-1">M-Pesa / Card Amount (KES)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={splitMpesaAmount}
              onChangeText={setSplitMpesaAmount}
              placeholder="0.00"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
            />

            <TouchableOpacity
              className="bg-purple-600 p-4 rounded-xl items-center mb-3"
              onPress={handleSplitPayment}
            >
              <Text className="text-white font-bold text-lg">Confirm Split</Text>
            </TouchableOpacity>
            <TouchableOpacity className="items-center" onPress={() => setShowSplit(false)}>
              <Text className="text-gray-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Credit Customer Picker Modal */}
      <Modal visible={showCreditPicker} animationType="slide">
        <SafeAreaView className="flex-1 bg-surface">
          <View className="flex-row items-center justify-between p-4 bg-primary">
            <Text className="text-white text-lg font-bold">Select Credit Customer</Text>
            <TouchableOpacity onPress={() => setShowCreditPicker(false)}>
              <Text className="text-white text-lg">Cancel</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 p-4">
            {creditCustomers.length === 0 ? (
              <Text className="text-gray-400 text-center mt-8">No credit customers registered. Admin must add them in the Debtors tab.</Text>
            ) : (
              creditCustomers.map((cust) => (
                <TouchableOpacity
                  key={cust.id}
                  className="bg-white rounded-xl p-4 mb-2 border border-gray-100"
                  onPress={() => handleCreditPayment(cust)}
                >
                  <Text className="text-base font-medium text-primary">{cust.name}</Text>
                  {cust.phone ? <Text className="text-xs text-gray-500">{cust.phone}</Text> : null}
                  {cust.creditLimit > 0 && (
                    <Text className="text-xs text-gray-500">Limit: {formatKES(cust.creditLimit)}</Text>
                  )}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Client Identifier Modal */}
      <Modal visible={showClientInput} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-1">Customer / Table / Room</Text>
            <Text className="text-xs text-gray-500 mb-4">e.g. Room 205, Table 7, John, Bar Seat 3</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={clientId}
              onChangeText={setClientId}
              placeholder="Room 205, Table 7, John..."
              placeholderTextColor="#9ca3af"
              autoFocus
              autoCapitalize="words"
            />
            <View className="flex-row justify-end">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowClientInput(false)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-primary px-6 py-2 rounded-lg" onPress={handleSaveClientId}>
                <Text className="text-white font-medium">Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      {/* Void Item Modal */}
      <Modal visible={showVoidModal} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-red-600 mb-1">Void Item</Text>
            <Text className="text-sm text-gray-500 mb-4">
              {voidingItem ? `${voidingItem.qty}x item` : ''}
            </Text>
            <Text className="text-sm font-medium text-gray-600 mb-1">Reason (optional)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={voidReason}
              onChangeText={setVoidReason}
              placeholder="e.g. Wrong order, customer changed mind"
              placeholderTextColor="#9ca3af"
              autoFocus
            />
            <View className="flex-row justify-end">
              <TouchableOpacity
                className="px-4 py-2 mr-2"
                onPress={() => { setShowVoidModal(false); setVoidingItem(null); }}
              >
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-red-600 px-6 py-2 rounded-lg" onPress={confirmVoidItem}>
                <Text className="text-white font-medium">Void</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Split Bill Modal */}
      <Modal visible={showSplitBill} animationType="slide">
        <SafeAreaView className="flex-1 bg-surface">
          <View className="flex-row items-center justify-between p-4 bg-primary">
            <TouchableOpacity onPress={() => setShowSplitBill(false)}>
              <Text className="text-white text-lg">Cancel</Text>
            </TouchableOpacity>
            <Text className="text-white text-lg font-bold">Split Bill</Text>
            <TouchableOpacity onPress={handleConfirmSplit}>
              <Text className="text-white text-lg font-semibold">Create</Text>
            </TouchableOpacity>
          </View>
          <Text className="text-sm text-gray-500 px-4 py-2">
            Tick items to move to a new bill:
          </Text>
          <ScrollView className="flex-1 px-4">
            {activeItems.map((item) => {
              const selected = splitSelectedIds.has(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  className={`flex-row items-center p-3 mb-2 rounded-xl border ${selected ? 'border-indigo-400 bg-indigo-50' : 'border-gray-100 bg-white'}`}
                  onPress={() => toggleSplitItem(item.id)}
                >
                  <Text className={`text-xl mr-3 ${selected ? 'text-indigo-600' : 'text-gray-300'}`}>
                    {selected ? '☑' : '☐'}
                  </Text>
                  <View className="flex-1">
                    <Text className="text-base font-medium text-primary">
                      {item.qty}x {productNames[item.productId] || '...'}
                    </Text>
                  </View>
                  <Text className="text-sm font-medium text-primary">
                    {item.isComplimentary ? 'FREE' : formatKES(item.unitPrice * item.qty)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View className="p-4 bg-white border-t border-gray-200">
            <Text className="text-sm text-gray-500 text-center mb-3">
              {splitSelectedIds.size} item{splitSelectedIds.size !== 1 ? 's' : ''} selected for new bill
            </Text>
            <TouchableOpacity
              className="bg-indigo-500 p-4 rounded-xl items-center"
              onPress={handleConfirmSplit}
            >
              <Text className="text-white font-bold text-lg">Create New Bill</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Merge Bills Modal */}
      <Modal visible={showMergeBills} animationType="slide">
        <SafeAreaView className="flex-1 bg-surface">
          <View className="flex-row items-center justify-between p-4 bg-primary">
            <TouchableOpacity onPress={() => setShowMergeBills(false)}>
              <Text className="text-white text-lg">Cancel</Text>
            </TouchableOpacity>
            <Text className="text-white text-lg font-bold">Merge Bills</Text>
            <View className="w-16" />
          </View>
          <Text className="text-sm text-gray-500 px-4 py-2">
            Select a bill to merge INTO this one ({tableName}):
          </Text>
          <ScrollView className="flex-1 px-4">
            {mergeableOrders.length === 0 ? (
              <Text className="text-gray-400 text-center mt-12">No other active bills to merge.</Text>
            ) : (
              mergeableOrders.map(({ order: o, tableName: tName, itemCount }) => (
                <TouchableOpacity
                  key={o.id}
                  className="bg-white rounded-xl p-4 mb-2 border border-gray-100"
                  onPress={() => handleMergeInto(o, tName)}
                >
                  <View className="flex-row justify-between items-center">
                    <View>
                      <Text className="text-base font-bold text-primary">{tName}</Text>
                      {o.roomNumber ? <Text className="text-xs text-gray-500">{o.roomNumber}</Text> : null}
                      <Text className="text-xs text-gray-400 mt-0.5">
                        {itemCount} item{itemCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <Text className="text-base font-bold text-primary">{formatKES(o.totalAmount)}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Refund Modal */}
      <Modal visible={showRefund} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-red-600 mb-2">Process Refund</Text>
            <Text className="text-sm text-gray-500 mb-4">
              This will void the order, restore stock, and record a refund of {formatKES(order.totalAmount)}.
            </Text>

            <Text className="text-sm font-medium text-gray-600 mb-1">Reason *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={refundReason}
              onChangeText={setRefundReason}
              placeholder="e.g. Customer complaint, wrong order"
              placeholderTextColor="#9ca3af"
              autoFocus
            />

            <View className="flex-row justify-end">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowRefund(false)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-red-700 px-6 py-2 rounded-lg" onPress={handleRefundOrder}>
                <Text className="text-white font-medium">Refund</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
