import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { useAuthStore } from '@/stores/authStore';
import { formatKES } from '@/utils/currency';
import { database } from '@/lib/db';
import {
  getAllCategories,
  getProductsByCategory,
  getAllTables,
  getActiveOrderForTable,
  createOrder,
  addItemToOrder,
  sendOrder,
  recalculateOrderTotal,
} from '@/lib/db/actions';
import {
  Category,
  Product,
  RestaurantTable,
  Order as OrderModel,
  OrderItem as OrderItemModel,
} from '@/lib/db/models';
import { routeOrderItems } from '@/lib/printer/routeOrder';
import { buildOrderSlip } from '@/lib/printer/templates';
import { sendToPrinter } from '@/lib/printer/connection';
import { Q } from '@nozbe/watermelondb';

const DEVICE_ID = Constants.sessionId ?? Constants.expoConfig?.extra?.deviceId ?? 'device-unknown';

interface CartItem {
  product: Product;
  qty: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getOrCreateCounterTable(): Promise<RestaurantTable> {
  return database.write(async () => {
    const existing = await database
      .get<RestaurantTable>('restaurant_tables')
      .query(Q.where('name', 'Counter'))
      .fetch();
    if (existing.length > 0) return existing[0];
    return database.get<RestaurantTable>('restaurant_tables').create((t) => {
      t.name = 'Counter';
      t.status = 'free';
    });
  });
}

async function findOrCreateTable(identifier: string): Promise<RestaurantTable> {
  const trimmed = identifier.trim() || 'Counter';
  const existing = await database
    .get<RestaurantTable>('restaurant_tables')
    .query(Q.where('name', trimmed))
    .fetch();
  if (existing.length > 0) return existing[0];

  return database.write(async () =>
    database.get<RestaurantTable>('restaurant_tables').create((t) => {
      t.name = trimmed;
      t.status = 'free';
    })
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function SellScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 700;

  const currentStaff = useAuthStore((s) => s.currentStaff);
  const currentShiftId = useAuthStore((s) => s.currentShiftId);

  // Menu state
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);

  // Table / identifier selection
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [customIdentifier, setCustomIdentifier] = useState('');
  const [showNewIdentifier, setShowNewIdentifier] = useState(false);
  const [newIdentifierInput, setNewIdentifierInput] = useState('');

  // Cart panel visibility (phone only)
  const [cartOpen, setCartOpen] = useState(false);

  // Sending state
  const [sending, setSending] = useState(false);

  // ── Load categories + tables on focus ──────────────────────────────────

  const loadMenu = useCallback(async () => {
    setMenuLoading(true);
    const cats = await getAllCategories();
    setCategories(cats);
    if (cats.length > 0) {
      const firstId = cats[0].id;
      setSelectedCatId((prev) => prev ?? firstId);
      const prods = await getProductsByCategory(cats[0].id);
      setProducts(prods);
    }
    setMenuLoading(false);
  }, []);

  const loadTables = useCallback(async () => {
    const data = await getAllTables();
    setTables(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMenu();
      loadTables();
    }, [loadMenu, loadTables])
  );

  const handleSelectCategory = async (catId: string) => {
    setSelectedCatId(catId);
    const prods = await getProductsByCategory(catId);
    setProducts(prods);
  };

  // ── Cart actions ────────────────────────────────────────────────────────

  const addToCart = (product: Product) => {
    if (product.isOutOfStock || product.stockQty <= 0) {
      Alert.alert('Out of Stock', `${product.name} is currently unavailable.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (existing) {
        return prev.map((c) =>
          c.product.id === product.id ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [...prev, { product, qty: 1 }];
    });
    if (!isTablet) setCartOpen(true);
  };

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((c) =>
          c.product.id === productId ? { ...c, qty: c.qty + delta } : c
        )
        .filter((c) => c.qty > 0);
    });
  };

  const clearCart = () => {
    setCart([]);
    setSelectedTable(null);
    setCustomIdentifier('');
  };

  const cartTotal = cart.reduce((s, c) => s + c.product.price * c.qty, 0);
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);

  // ── Table / identifier helpers ──────────────────────────────────────────

  const resolvedIdentifier = selectedTable?.name ?? customIdentifier.trim() ?? '';

  const handleSelectTable = (table: RestaurantTable) => {
    setSelectedTable(table);
    setCustomIdentifier('');
    setShowNewIdentifier(false);
  };

  const handleConfirmNewIdentifier = () => {
    const val = newIdentifierInput.trim();
    if (val) {
      setCustomIdentifier(val);
      setSelectedTable(null);
    }
    setNewIdentifierInput('');
    setShowNewIdentifier(false);
  };

  // ── Send Order ──────────────────────────────────────────────────────────

  const handleSendOrder = async () => {
    if (cart.length === 0) {
      Alert.alert('Empty Cart', 'Add items before sending an order.');
      return;
    }

    if (!currentShiftId) {
      Alert.alert('No Active Shift', 'Open a shift before taking orders.', [
        { text: 'Open Shift', onPress: () => router.push('/shift/open') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    setSending(true);
    try {
      // 1. Resolve table
      let table: RestaurantTable;
      const identifier = resolvedIdentifier || 'Counter';

      if (selectedTable) {
        // Tap existing occupied table → open existing order
        if (selectedTable.status !== 'free') {
          const existingOrder = await getActiveOrderForTable(selectedTable.id);
          if (existingOrder) {
            setSending(false);
            router.push(`/order/${existingOrder.id}`);
            return;
          }
        }
        table = selectedTable;
      } else {
        table = await findOrCreateTable(identifier);
      }

      // 2. Create order
      const order = await createOrder({
        tableId: table.id,
        staffId: currentStaff!.id,
        shiftId: currentShiftId,
        deviceId: DEVICE_ID,
        roomNumber: identifier !== table.name ? identifier : undefined,
      });

      // 3. Add all cart items
      for (const cartItem of cart) {
        await addItemToOrder({
          orderId: order.id,
          productId: cartItem.product.id,
          qty: cartItem.qty,
          unitPrice: cartItem.product.price,
        });
      }

      // 4. Send order (deducts stock + marks items as 'sent')
      await sendOrder(order.id);

      // 5. Route to printers
      try {
        const sentItems = await database
          .get<OrderItemModel>('order_items')
          .query(Q.where('order_id', order.id), Q.where('status', 'sent'))
          .fetch();

        const categoryCache: Record<string, Category | null> = {};
        for (const item of sentItems) {
          if (!(item.productId in categoryCache)) {
            try {
              const prod = await database.get<Product>('products').find(item.productId);
              const cat = await database.get<Category>('categories').find(prod.categoryId);
              categoryCache[item.productId] = cat;
            } catch {
              categoryCache[item.productId] = null;
            }
          }
        }

        const productNameMap: Record<string, string> = {};
        for (const ci of cart) productNameMap[ci.product.id] = ci.product.name;

        const routed = routeOrderItems(sentItems, (pid) => categoryCache[pid] ?? null);

        if (routed.bar.length > 0) {
          const slip = buildOrderSlip(
            table.name,
            routed.bar.map((i) => ({
              name: productNameMap[i.productId] ?? i.productId,
              qty: i.qty,
            })),
            'bar',
            identifier !== table.name ? identifier : undefined
          );
          sendToPrinter('bar', new TextEncoder().encode(slip)).catch(() => {});
        }

        if (routed.kitchen.length > 0) {
          const slip = buildOrderSlip(
            table.name,
            routed.kitchen.map((i) => ({
              name: productNameMap[i.productId] ?? i.productId,
              qty: i.qty,
            })),
            'kitchen',
            identifier !== table.name ? identifier : undefined
          );
          sendToPrinter('kitchen', new TextEncoder().encode(slip)).catch(() => {});
        }
      } catch {
        // Printer failure is non-fatal
      }

      // 6. Clear cart + navigate to orders
      clearCart();
      await loadTables();
      Alert.alert('Order Sent', `Order for "${identifier}" has been sent.`, [
        { text: 'New Order', style: 'cancel' },
        { text: 'View Orders', onPress: () => router.push('/(tabs)/orders') },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not place order. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────

  const numCols = isTablet ? 3 : width >= 400 ? 3 : 2;

  const tableStatusColor = (status: string) => {
    if (status === 'free') return '#16a34a';
    if (status === 'open' || status === 'sent') return '#d97706';
    return '#dc2626';
  };

  // ── Cart Panel ──────────────────────────────────────────────────────────

  const CartPanel = () => (
    <View
      style={{
        flex: isTablet ? 0.38 : 1,
        backgroundColor: '#0f172a',
        borderLeftWidth: isTablet ? 1 : 0,
        borderTopWidth: isTablet ? 0 : 1,
        borderColor: '#1e293b',
      }}
    >
      {/* Identifier selector */}
      <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
        <Text style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Customer / Table / Room
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {tables.slice(0, 8).map((t) => {
              const isSelected = selectedTable?.id === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => handleSelectTable(t)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                    backgroundColor: isSelected ? '#e94560' : '#1e293b',
                    borderWidth: 1,
                    borderColor: isSelected ? '#e94560' : tableStatusColor(t.status) + '55',
                  }}
                >
                  <Text style={{ color: isSelected ? '#fff' : tableStatusColor(t.status), fontSize: 12, fontWeight: '600' }}>
                    {t.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => { setShowNewIdentifier(true); setNewIdentifierInput(''); }}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: customIdentifier ? '#e94560' : '#1e293b',
                borderWidth: 1,
                borderColor: customIdentifier ? '#e94560' : '#334155',
              }}
            >
              <Text style={{ color: customIdentifier ? '#fff' : '#94a3b8', fontSize: 12, fontWeight: '600' }}>
                {customIdentifier || '+ New'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
        {(resolvedIdentifier) ? (
          <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
            Order for: <Text style={{ color: '#e2e8f0' }}>{resolvedIdentifier}</Text>
          </Text>
        ) : null}
      </View>

      {/* Cart items */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10 }}>
        {cart.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 32 }}>
            <Text style={{ fontSize: 32 }}>🛒</Text>
            <Text style={{ color: '#475569', fontSize: 13, marginTop: 8 }}>Cart is empty</Text>
            <Text style={{ color: '#334155', fontSize: 12, marginTop: 4 }}>Tap a product to add it</Text>
          </View>
        ) : (
          cart.map((ci) => (
            <View
              key={ci.product.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#1e293b',
                borderRadius: 10,
                padding: 10,
                marginBottom: 6,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#e2e8f0', fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                  {ci.product.name}
                </Text>
                <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 1 }}>
                  {formatKES(ci.product.price)} each
                </Text>
              </View>
              {/* Qty controls */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 8 }}>
                <TouchableOpacity
                  onPress={() => changeQty(ci.product.id, -1)}
                  style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#e2e8f0', fontSize: 16, fontWeight: '700' }}>−</Text>
                </TouchableOpacity>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', minWidth: 28, textAlign: 'center' }}>
                  {ci.qty}
                </Text>
                <TouchableOpacity
                  onPress={() => changeQty(ci.product.id, 1)}
                  style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#e2e8f0', fontSize: 16, fontWeight: '700' }}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ color: '#e94560', fontSize: 13, fontWeight: '700', minWidth: 60, textAlign: 'right' }}>
                {formatKES(ci.product.price * ci.qty)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Footer: total + send */}
      <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#1e293b' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ color: '#94a3b8', fontSize: 14 }}>{cartCount} item{cartCount !== 1 ? 's' : ''}</Text>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>{formatKES(cartTotal)}</Text>
        </View>
        {cart.length > 0 && (
          <TouchableOpacity
            onPress={() => { setCart([]); setSelectedTable(null); setCustomIdentifier(''); }}
            style={{ alignItems: 'center', marginBottom: 8 }}
          >
            <Text style={{ color: '#475569', fontSize: 12 }}>Clear cart</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={handleSendOrder}
          disabled={sending || cart.length === 0}
          style={{
            backgroundColor: sending || cart.length === 0 ? '#334155' : '#e94560',
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: 'center',
          }}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
              Send Order{cartCount > 0 ? ` (${cartCount})` : ''}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Product Grid ────────────────────────────────────────────────────────

  const ProductGrid = () => (
    <View style={{ flex: 1 }}>
      {/* Category tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', maxHeight: 52 }}
        contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8, flexDirection: 'row', gap: 6 }}
      >
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            onPress={() => handleSelectCategory(cat.id)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 20,
              backgroundColor: selectedCatId === cat.id ? '#e94560' : '#f1f5f9',
            }}
          >
            <Text style={{ color: selectedCatId === cat.id ? '#fff' : '#475569', fontWeight: '600', fontSize: 13 }}>
              {cat.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Products */}
      {menuLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#e94560" />
        </View>
      ) : (
        <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }} contentContainerStyle={{ padding: 8 }}>
          {products.length === 0 ? (
            <Text style={{ color: '#9ca3af', textAlign: 'center', marginTop: 32 }}>
              No products in this category
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {products.map((prod) => {
                const outOfStock = prod.isOutOfStock || prod.stockQty <= 0;
                const cartQty = cart.find((c) => c.product.id === prod.id)?.qty ?? 0;
                return (
                  <TouchableOpacity
                    key={prod.id}
                    onPress={() => addToCart(prod)}
                    disabled={outOfStock}
                    style={{ width: `${100 / numCols}%`, padding: 4 }}
                    activeOpacity={0.75}
                  >
                    <View
                      style={{
                        backgroundColor: outOfStock ? '#f1f5f9' : '#fff',
                        borderRadius: 14,
                        padding: 12,
                        borderWidth: 2,
                        borderColor: cartQty > 0 ? '#e94560' : outOfStock ? '#e2e8f0' : '#f1f5f9',
                        minHeight: 100,
                        justifyContent: 'space-between',
                        opacity: outOfStock ? 0.5 : 1,
                      }}
                    >
                      {cartQty > 0 && (
                        <View
                          style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            backgroundColor: '#e94560',
                            borderRadius: 10,
                            minWidth: 20,
                            height: 20,
                            alignItems: 'center',
                            justifyContent: 'center',
                            paddingHorizontal: 4,
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{cartQty}</Text>
                        </View>
                      )}
                      <Text style={{ fontSize: 24, marginBottom: 6 }}>
                        {prod.name.charAt(0).toUpperCase()}
                      </Text>
                      <View>
                        <Text
                          style={{ fontSize: 12, fontWeight: '700', color: '#1e293b' }}
                          numberOfLines={2}
                        >
                          {prod.name}
                        </Text>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#e94560', marginTop: 3 }}>
                          {formatKES(prod.price)}
                        </Text>
                        {outOfStock ? (
                          <Text style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>Out of stock</Text>
                        ) : (
                          <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                            {prod.stockQty} left
                          </Text>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 10,
          backgroundColor: '#0f172a',
        }}
      >
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: '#94a3b8', fontSize: 15 }}>← Home</Text>
        </TouchableOpacity>
        <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>New Order</Text>
        {/* Cart toggle button on phone */}
        {!isTablet && (
          <TouchableOpacity
            onPress={() => setCartOpen((v) => !v)}
            style={{
              backgroundColor: cart.length > 0 ? '#e94560' : '#1e293b',
              borderRadius: 20,
              paddingHorizontal: 12,
              paddingVertical: 6,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
              🛒 {cartCount > 0 ? cartCount : ''}
            </Text>
            {cartTotal > 0 && (
              <Text style={{ color: '#fff', fontSize: 12, marginLeft: 4 }}>{formatKES(cartTotal)}</Text>
            )}
          </TouchableOpacity>
        )}
        {isTablet && <View style={{ width: 60 }} />}
      </View>

      {/* Body */}
      {isTablet ? (
        // ── Tablet: side-by-side layout ──────────────────────────────────
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <ProductGrid />
          <CartPanel />
        </View>
      ) : (
        // ── Phone: cart is a bottom modal ────────────────────────────────
        <View style={{ flex: 1 }}>
          <ProductGrid />
          <Modal visible={cartOpen} animationType="slide" transparent>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={{ flex: 1, justifyContent: 'flex-end' }}
            >
              <View style={{ backgroundColor: '#0f172a', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Your Order</Text>
                  <TouchableOpacity onPress={() => setCartOpen(false)}>
                    <Text style={{ color: '#94a3b8', fontSize: 15 }}>Done</Text>
                  </TouchableOpacity>
                </View>
                <CartPanel />
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </View>
      )}

      {/* New Identifier Modal */}
      <Modal visible={showNewIdentifier} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 340 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1e293b', marginBottom: 4 }}>
              Customer / Table / Room
            </Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
              e.g. Table 7, Room 205, John, Bar Seat 3
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: '#e2e8f0',
                borderRadius: 12,
                padding: 12,
                fontSize: 15,
                color: '#1e293b',
                marginBottom: 16,
              }}
              value={newIdentifierInput}
              onChangeText={setNewIdentifierInput}
              placeholder="Enter identifier…"
              placeholderTextColor="#9ca3af"
              autoFocus
              autoCapitalize="words"
              onSubmitEditing={handleConfirmNewIdentifier}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <TouchableOpacity
                style={{ paddingHorizontal: 16, paddingVertical: 10, marginRight: 8 }}
                onPress={() => setShowNewIdentifier(false)}
              >
                <Text style={{ color: '#64748b' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: '#e94560', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 }}
                onPress={handleConfirmNewIdentifier}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
