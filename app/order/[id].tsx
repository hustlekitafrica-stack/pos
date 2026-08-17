import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, SafeAreaView, Alert, Modal, TextInput, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { database } from '@/lib/db';
import { Order as OrderModel, OrderItem as OrderItemModel, Product as ProductModel, Category as CategoryModel, Customer as CustomerModel, RestaurantTable as TableModel } from '@/lib/db/models';
import { initiateSTKPush, checkSTKStatus } from '@/lib/mpesa';
import { Q } from '@nozbe/watermelondb';
import { routeOrderItems } from '@/lib/printer/routeOrder';
import { buildOrderSlip } from '@/lib/printer/templates';
import { sendToPrinter } from '@/lib/printer/connection';
import {
  getOrderItems,
  addItemToOrder,
  sendOrder,
  markOrderServed,
  voidOrderItem,
  recordPayment,
  getAllCategories,
  getProductsByCategory,
  recalculateOrderTotal,
} from '@/lib/db/actions';

export default function OrderScreen() {
  const { id: orderId } = useLocalSearchParams<{ id: string }>();
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const can = useAuthStore((s) => s.can);

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
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [showRefund, setShowRefund] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidingItem, setVoidingItem] = useState<OrderItemModel | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [categories, setCategories] = useState<CategoryModel[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductModel[]>([]);
  const [productNames, setProductNames] = useState<Record<string, string>>({});

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

  const loadCategories = async () => {
    const cats = await getAllCategories();
    setCategories(cats);
    if (cats.length > 0) {
      setSelectedCategoryId(cats[0].id);
      const prods = await getProductsByCategory(cats[0].id);
      setProducts(prods);
    }
  };

  const handleSelectCategory = async (catId: string) => {
    setSelectedCategoryId(catId);
    const prods = await getProductsByCategory(catId);
    setProducts(prods);
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

      if (routed.bar.length > 0) {
        const slip = buildOrderSlip(
          tName,
          routed.bar.map((i) => ({ name: productNames[i.productId] || i.productId, qty: i.qty, notes: i.notes ?? undefined })),
          'bar',
          clientLabel
        );
        const bytes = new TextEncoder().encode(slip);
        sendToPrinter('bar', bytes).catch(() => {});
      }

      if (routed.kitchen.length > 0) {
        const slip = buildOrderSlip(
          tName,
          routed.kitchen.map((i) => ({ name: productNames[i.productId] || i.productId, qty: i.qty, notes: i.notes ?? undefined })),
          'kitchen',
          clientLabel
        );
        const bytes = new TextEncoder().encode(slip);
        sendToPrinter('kitchen', bytes).catch(() => {});
      }
    } catch {
      // Printer failure is non-fatal
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

  const openCreditPicker = async () => {
    const customers = await database
      .get<CustomerModel>('customers')
      .query(Q.where('is_active', true))
      .fetch();
    setCreditCustomers(customers);
    setShowCreditPicker(true);
  };

  const handleApplyDiscount = async () => {
    if (!order) return;
    const cents = toCents(parseFloat(discountAmount) || 0);
    if (cents <= 0) return;
    await database.write(async () => {
      await order.update((o) => {
        o.discountAmount = cents;
        o.discountReason = discountReason.trim() || null;
      });
    });
    await recalculateOrderTotal(order.id);
    setShowDiscount(false);
    setDiscountAmount('');
    setDiscountReason('');
    await loadOrder();
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
    setShowClientInput(false);
    await loadOrder();
  };

  const openMenuModal = async () => {
    await loadCategories();
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
        {order.discountAmount > 0 && (
          <View className="flex-row justify-between mb-1">
            <Text className="text-sm text-gray-500">Discount</Text>
            <Text className="text-sm text-green-600">-{formatKES(order.discountAmount)}</Text>
          </View>
        )}
        <View className="flex-row justify-between mb-3">
          <Text className="text-lg font-bold text-primary">Total</Text>
          <Text className="text-lg font-bold text-primary">{formatKES(order.totalAmount)}</Text>
        </View>

        <View className="flex-row flex-wrap">
          <TouchableOpacity
            className="flex-1 bg-primary p-3 rounded-xl items-center mr-2 mb-2"
            onPress={openMenuModal}
          >
            <Text className="text-white font-bold">Add Items</Text>
          </TouchableOpacity>

          {can('applyDiscount') && order.status !== 'paid' && order.status !== 'voided' && (
            <TouchableOpacity
              className="bg-orange-500 p-3 rounded-xl items-center mr-2 mb-2 px-4"
              onPress={() => setShowDiscount(true)}
            >
              <Text className="text-white font-bold text-xs">Discount</Text>
            </TouchableOpacity>
          )}

          {can('processRefund') && (order.status === 'paid' || order.status === 'served') && (
            <TouchableOpacity
              className="bg-red-700 p-3 rounded-xl items-center mr-2 mb-2 px-4"
              onPress={() => setShowRefund(true)}
            >
              <Text className="text-white font-bold text-xs">Refund</Text>
            </TouchableOpacity>
          )}

          {hasPendingItems && (
            <TouchableOpacity
              className="flex-1 bg-yellow-500 p-3 rounded-xl items-center mr-2"
              onPress={handleSendOrder}
            >
              <Text className="text-white font-bold">
                Send Order{pendingCount > 0 ? ` (${pendingCount})` : ''}
              </Text>
            </TouchableOpacity>
          )}

          {hasSentItems && (
            <TouchableOpacity
              className="flex-1 bg-green-500 p-3 rounded-xl items-center mr-2"
              onPress={handleMarkServed}
            >
              <Text className="text-white font-bold">Mark Served</Text>
            </TouchableOpacity>
          )}

          {['sent', 'served', 'awaiting_payment'].includes(order.status) && order.totalAmount > 0 && (
            <TouchableOpacity
              className="flex-1 bg-accent p-3 rounded-xl items-center mb-2"
              onPress={() => setShowPayment(true)}
            >
              <Text className="text-white font-bold">Collect Payment</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Menu Modal */}
      <Modal visible={showMenu} animationType="slide">
        <SafeAreaView className="flex-1 bg-surface">
          <View className="flex-row items-center justify-between p-4 bg-primary">
            <Text className="text-white text-lg font-bold">Add Items</Text>
            <TouchableOpacity onPress={() => setShowMenu(false)}>
              <Text className="text-white text-lg">Done</Text>
            </TouchableOpacity>
          </View>

          {/* Category Tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="bg-white border-b border-gray-200">
            <View className="flex-row p-2">
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  className={`px-4 py-2 rounded-lg mr-2 ${selectedCategoryId === cat.id ? 'bg-primary' : 'bg-gray-100'}`}
                  onPress={() => handleSelectCategory(cat.id)}
                >
                  <Text className={`font-medium ${selectedCategoryId === cat.id ? 'text-white' : 'text-gray-700'}`}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Product Grid */}
          <ScrollView className="flex-1 p-2">
            {products.length === 0 && (
              <Text className="text-gray-400 text-center mt-8">No products in this category</Text>
            )}
            <View className="flex-row flex-wrap">
              {products.map((prod) => {
                const outOfStock = prod.isOutOfStock || prod.stockQty <= 0;
                return (
                  <TouchableOpacity
                    key={prod.id}
                    style={{ width: `${100 / numCols}%` }}
                    className={`p-2`}
                    onPress={() => handleAddItem(prod)}
                    disabled={outOfStock}
                  >
                    <View className={`bg-white rounded-2xl p-4 border-2 items-center justify-center min-h-[110px] ${
                      outOfStock ? 'border-gray-200 opacity-40' : 'border-gray-100 active:border-accent'
                    }`}>
                      <Text className="text-3xl mb-2">
                        {prod.name.charAt(0).toUpperCase()}
                      </Text>
                      <Text className="text-sm font-bold text-primary text-center" numberOfLines={2}>{prod.name}</Text>
                      <Text className="text-base font-bold text-accent mt-1">{formatKES(prod.price)}</Text>
                      {outOfStock ? (
                        <Text className="text-xs text-red-500 mt-1">Out of stock</Text>
                      ) : (
                        <Text className="text-xs text-gray-400 mt-1">Stock: {prod.stockQty}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
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
      {/* Discount Modal */}
      <Modal visible={showDiscount} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-2">Apply Discount</Text>
            <Text className="text-sm text-gray-500 mb-4">Current total: {formatKES(order.totalAmount)}</Text>

            <Text className="text-sm font-medium text-gray-600 mb-1">Discount Amount (KES)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={discountAmount}
              onChangeText={setDiscountAmount}
              placeholder="0.00"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
              autoFocus
            />

            <Text className="text-sm font-medium text-gray-600 mb-1">Reason (optional)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={discountReason}
              onChangeText={setDiscountReason}
              placeholder="e.g. Regular customer, promo"
              placeholderTextColor="#9ca3af"
            />

            <View className="flex-row justify-end">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowDiscount(false)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-orange-500 px-6 py-2 rounded-lg" onPress={handleApplyDiscount}>
                <Text className="text-white font-medium">Apply</Text>
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
