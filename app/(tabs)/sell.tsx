import { useState, useCallback } from 'react';
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
  StatusBar,
  KeyboardAvoidingView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { useAuthStore } from '@/stores/authStore';
import { formatKES } from '@/utils/currency';
import { database } from '@/lib/db';
import {
  getProductsByStation,
  getAllActiveProducts,
  getActiveOrderForTable,
  createOrder,
  addItemToOrder,
  sendOrder,
} from '@/lib/db/actions';
import {
  Category,
  Product,
  RestaurantTable,
  OrderItem as OrderItemModel,
} from '@/lib/db/models';
import { routeOrderItems } from '@/lib/printer/routeOrder';
import { buildOrderSlip } from '@/lib/printer/templates';
import { sendToPrinter } from '@/lib/printer/connection';
import { Q } from '@nozbe/watermelondb';

const DEVICE_ID = Constants.sessionId ?? Constants.expoConfig?.extra?.deviceId ?? 'device-unknown';

// Android status bar height so the header doesn't hide under the notification bar
const STATUSBAR_HEIGHT = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

interface CartItem {
  product: Product;
  qty: number;
}

// ─── Station tabs ─────────────────────────────────────────────────────────────
const STATIONS: { label: string; station: string }[] = [
  { label: 'Bar', station: 'bar' },
  { label: 'Food', station: 'kitchen' },
];

// ─── Table auto-create helper ─────────────────────────────────────────────────
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function SellScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 700;
  const numCols = isTablet ? 3 : width >= 420 ? 3 : 2;

  const currentStaff = useAuthStore((s) => s.currentStaff);
  const currentShiftId = useAuthStore((s) => s.currentShiftId);

  // Station / product state
  const [activeStation, setActiveStation] = useState<string>('bar');
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartDetailOpen, setCartDetailOpen] = useState(false);

  // Client identifier (free text)
  const [clientIdentifier, setClientIdentifier] = useState('');

  // Sending
  const [sending, setSending] = useState(false);

  // ── Load products for the active station ─────────────────────────────────

  const loadProducts = useCallback(async (station: string) => {
    setMenuLoading(true);
    setSearchQuery('');
    const [stationProds, all] = await Promise.all([
      getProductsByStation(station),
      getAllActiveProducts(),
    ]);
    setProducts(stationProds);
    setAllProducts(all);
    setMenuLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProducts(activeStation);
    }, [loadProducts, activeStation])
  );

  const handleSelectStation = (station: string) => {
    setActiveStation(station);
    loadProducts(station);
  };

  // ── Cart helpers ─────────────────────────────────────────────────────────

  const addToCart = (product: Product) => {
    if (product.isOutOfStock || product.stockQty <= 0) {
      Alert.alert('Out of Stock', `${product.name} is currently unavailable.`);
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.product.id === productId ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0)
    );
  };

  const clearCart = () => {
    setCart([]);
    setClientIdentifier('');
  };

  const cartTotal = cart.reduce((s, c) => s + c.product.price * c.qty, 0);
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);

  // Filtered products for display
  // When searching, look across ALL stations so no item is missed
  const visibleProducts = searchQuery.trim()
    ? allProducts.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : products;

  // ── Send Order ────────────────────────────────────────────────────────────

  const handleSendOrder = async () => {
    if (cart.length === 0) {
      Alert.alert('Empty Cart', 'Add items before sending an order.');
      return;
    }
    if (!currentShiftId) {
      Alert.alert('No Active Shift', 'You need an open shift to take orders.', [
        { text: 'Open Shift', onPress: () => router.push('/shift/open') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    setSending(true);
    try {
      const identifier = clientIdentifier.trim() || 'Counter';
      const table = await findOrCreateTable(identifier);

      // Re-use an existing active order for this table (append) or create a fresh one
      const existingOrder = await getActiveOrderForTable(table.id);
      const order = existingOrder ?? await createOrder({
        tableId: table.id,
        staffId: currentStaff!.id,
        shiftId: currentShiftId,
        deviceId: DEVICE_ID,
        roomNumber: identifier !== 'Counter' ? identifier : undefined,
      });

      for (const ci of cart) {
        await addItemToOrder({
          orderId: order.id,
          productId: ci.product.id,
          qty: ci.qty,
          unitPrice: ci.product.price,
        });
      }

      await sendOrder(order.id);

      // Route to printers
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
            routed.bar.map((i) => ({ name: productNameMap[i.productId] ?? i.productId, qty: i.qty })),
            'bar',
            identifier !== 'Counter' ? identifier : undefined
          );
          sendToPrinter('bar', new TextEncoder().encode(slip)).catch(() => {});
        }
        if (routed.kitchen.length > 0) {
          const slip = buildOrderSlip(
            table.name,
            routed.kitchen.map((i) => ({ name: productNameMap[i.productId] ?? i.productId, qty: i.qty })),
            'kitchen',
            identifier !== 'Counter' ? identifier : undefined
          );
          sendToPrinter('kitchen', new TextEncoder().encode(slip)).catch(() => {});
        }
      } catch {
        // Printer failure is non-fatal
      }

      clearCart();
      setCartDetailOpen(false);
      Alert.alert(
        'Order Sent ✓',
        `Order for "${identifier}" has been sent.`,
        [
          { text: 'New Order', style: 'cancel' },
          { text: 'View Orders', onPress: () => router.push('/(tabs)/orders') },
        ]
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not place order. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Product Grid
  // ─────────────────────────────────────────────────────────────────────────

  const ProductArea = () => (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      {/* Station tabs */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: '#fff',
          borderBottomWidth: 1,
          borderBottomColor: '#e2e8f0',
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: 0,
        }}
      >
        {STATIONS.map(({ label, station }) => {
          const active = station === activeStation;
          // Count items in cart from this station
          const stationCount = cart
            .filter((ci) => {
              // We'll mark products with the station via a lookup at render time
              return ci.product && true; // all shown; simplified for now
            })
            .reduce((_, __) => _, 0); // placeholder — badge per station omitted for clarity
          return (
            <TouchableOpacity
              key={station}
              onPress={() => handleSelectStation(station)}
              style={{
                paddingHorizontal: 20,
                paddingVertical: 10,
                marginRight: 4,
                borderBottomWidth: 3,
                borderBottomColor: active ? '#e94560' : 'transparent',
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: active ? '700' : '500',
                  color: active ? '#e94560' : '#64748b',
                }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Search */}
      <View
        style={{
          backgroundColor: '#fff',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: '#e2e8f0',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#f1f5f9',
            borderRadius: 10,
            paddingHorizontal: 12,
            height: 38,
          }}
        >
          <Text style={{ color: '#94a3b8', fontSize: 15, marginRight: 6 }}>🔍</Text>
          <TextInput
            style={{ flex: 1, fontSize: 14, color: '#1e293b', paddingVertical: 0 }}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search items…"
            placeholderTextColor="#94a3b8"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && Platform.OS !== 'ios' && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={{ color: '#94a3b8', fontSize: 16, paddingLeft: 8 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Products */}
      {menuLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#e94560" />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 8, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {visibleProducts.length === 0 ? (
            <Text style={{ color: '#9ca3af', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
              {searchQuery ? `No items matching "${searchQuery}"` : 'No items in this section'}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {visibleProducts.map((prod) => {
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
                        minHeight: 110,
                        justifyContent: 'space-between',
                        opacity: outOfStock ? 0.55 : 1,
                      }}
                    >
                      {cartQty > 0 && (
                        <View
                          style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            backgroundColor: '#e94560',
                            borderRadius: 11,
                            minWidth: 22,
                            height: 22,
                            alignItems: 'center',
                            justifyContent: 'center',
                            paddingHorizontal: 4,
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                            {cartQty}
                          </Text>
                        </View>
                      )}
                      <Text style={{ fontSize: 26, marginBottom: 6 }}>
                        {prod.name.charAt(0).toUpperCase()}
                      </Text>
                      <View>
                        <Text
                          style={{ fontSize: 12, fontWeight: '700', color: '#1e293b' }}
                          numberOfLines={2}
                        >
                          {prod.name}
                        </Text>
                        <Text
                          style={{ fontSize: 13, fontWeight: '800', color: '#e94560', marginTop: 2 }}
                        >
                          {formatKES(prod.price)}
                        </Text>
                        {outOfStock ? (
                          <Text style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>
                            Out of stock
                          </Text>
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

  // ─────────────────────────────────────────────────────────────────────────
  // Cart detail sheet (modal, appears over products when tapped)
  // ─────────────────────────────────────────────────────────────────────────

  const CartDetailSheet = () => (
    <Modal visible={cartDetailOpen} transparent animationType="slide">
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
        activeOpacity={1}
        onPress={() => setCartDetailOpen(false)}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
      >
        <View
          style={{
            backgroundColor: '#0f172a',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: 420,
          }}
        >
          {/* Sheet header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: '#1e293b',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              Order ({cartCount} item{cartCount !== 1 ? 's' : ''})
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {cart.length > 0 && (
                <TouchableOpacity
                  onPress={() => { clearCart(); setCartDetailOpen(false); }}
                  style={{ marginRight: 16 }}
                >
                  <Text style={{ color: '#ef4444', fontSize: 13 }}>Clear all</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setCartDetailOpen(false)}>
                <Text style={{ color: '#94a3b8', fontSize: 15 }}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Cart items */}
          <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ padding: 12 }}>
            {cart.length === 0 ? (
              <Text style={{ color: '#475569', textAlign: 'center', marginTop: 16 }}>
                No items yet — tap products to add them
              </Text>
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
                    <Text
                      style={{ color: '#e2e8f0', fontSize: 13, fontWeight: '600' }}
                      numberOfLines={1}
                    >
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
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        backgroundColor: '#334155',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: '#e2e8f0', fontSize: 18, lineHeight: 22 }}>−</Text>
                    </TouchableOpacity>
                    <Text
                      style={{
                        color: '#fff',
                        fontSize: 15,
                        fontWeight: '700',
                        minWidth: 30,
                        textAlign: 'center',
                      }}
                    >
                      {ci.qty}
                    </Text>
                    <TouchableOpacity
                      onPress={() => changeQty(ci.product.id, 1)}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        backgroundColor: '#334155',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: '#e2e8f0', fontSize: 18, lineHeight: 22 }}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <Text
                    style={{
                      color: '#e94560',
                      fontSize: 13,
                      fontWeight: '700',
                      minWidth: 64,
                      textAlign: 'right',
                    }}
                  >
                    {formatKES(ci.product.price * ci.qty)}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Persistent bottom bar (always visible on phone — this is key)
  // ─────────────────────────────────────────────────────────────────────────

  const BottomBar = () => (
    <View
      style={{
        backgroundColor: '#0f172a',
        borderTopWidth: 1,
        borderTopColor: '#1e293b',
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: Platform.OS === 'ios' ? 24 : 12,
      }}
    >
      {/* Client identifier input */}
      <TextInput
        style={{
          backgroundColor: '#1e293b',
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          color: '#e2e8f0',
          fontSize: 14,
          marginBottom: 10,
        }}
        value={clientIdentifier}
        onChangeText={setClientIdentifier}
        placeholder="Customer / Table / Room (e.g. Table 3, Room 205, John)"
        placeholderTextColor="#475569"
        returnKeyType="done"
      />

      {/* Row: cart summary + send button */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* Cart summary — tap to expand detail */}
        <TouchableOpacity
          onPress={() => setCartDetailOpen(true)}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            marginRight: 10,
          }}
        >
          <View
            style={{
              backgroundColor: cartCount > 0 ? '#e94560' : '#334155',
              borderRadius: 14,
              paddingHorizontal: 10,
              paddingVertical: 4,
              marginRight: 8,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>
              {cartCount}
            </Text>
          </View>
          <View>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
              {cartCount === 0 ? 'No items yet' : formatKES(cartTotal)}
            </Text>
            {cartCount > 0 && (
              <Text style={{ color: '#64748b', fontSize: 11 }}>
                Tap to edit order
              </Text>
            )}
          </View>
        </TouchableOpacity>

        {/* Send Order */}
        <TouchableOpacity
          onPress={handleSendOrder}
          disabled={sending || cartCount === 0}
          style={{
            backgroundColor: sending || cartCount === 0 ? '#334155' : '#e94560',
            borderRadius: 12,
            paddingVertical: 12,
            paddingHorizontal: 20,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
              Send Order
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tablet right panel — cart + identifier
  // ─────────────────────────────────────────────────────────────────────────

  const TabletCartPanel = () => (
    <View
      style={{
        width: 300,
        backgroundColor: '#0f172a',
        borderLeftWidth: 1,
        borderLeftColor: '#1e293b',
      }}
    >
      {/* Identifier */}
      <View
        style={{
          padding: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#1e293b',
        }}
      >
        <Text
          style={{
            color: '#94a3b8',
            fontSize: 11,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 6,
          }}
        >
          Customer / Table / Room
        </Text>
        <TextInput
          style={{
            backgroundColor: '#1e293b',
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            color: '#e2e8f0',
            fontSize: 14,
          }}
          value={clientIdentifier}
          onChangeText={setClientIdentifier}
          placeholder="Table 3, Room 205, John…"
          placeholderTextColor="#475569"
          returnKeyType="done"
        />
      </View>

      {/* Cart items */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10 }}>
        {cart.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 32 }}>
            <Text style={{ fontSize: 32 }}>🛒</Text>
            <Text style={{ color: '#475569', fontSize: 13, marginTop: 8 }}>Cart is empty</Text>
            <Text style={{ color: '#334155', fontSize: 12, marginTop: 4 }}>
              Tap any item to add it
            </Text>
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
                <Text
                  style={{ color: '#e2e8f0', fontSize: 13, fontWeight: '600' }}
                  numberOfLines={1}
                >
                  {ci.product.name}
                </Text>
                <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 1 }}>
                  {formatKES(ci.product.price)} each
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 6 }}>
                <TouchableOpacity
                  onPress={() => changeQty(ci.product.id, -1)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: '#334155',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#e2e8f0', fontSize: 16 }}>−</Text>
                </TouchableOpacity>
                <Text
                  style={{
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: '700',
                    minWidth: 28,
                    textAlign: 'center',
                  }}
                >
                  {ci.qty}
                </Text>
                <TouchableOpacity
                  onPress={() => changeQty(ci.product.id, 1)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: '#334155',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#e2e8f0', fontSize: 16 }}>+</Text>
                </TouchableOpacity>
              </View>
              <Text
                style={{
                  color: '#e94560',
                  fontSize: 13,
                  fontWeight: '700',
                  minWidth: 58,
                  textAlign: 'right',
                }}
              >
                {formatKES(ci.product.price * ci.qty)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Footer */}
      <View
        style={{
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: '#1e293b',
        }}
      >
        {cart.length > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ color: '#94a3b8', fontSize: 13 }}>
              {cartCount} item{cartCount !== 1 ? 's' : ''}
            </Text>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>
              {formatKES(cartTotal)}
            </Text>
          </View>
        )}
        {cart.length > 0 && (
          <TouchableOpacity
            onPress={() => clearCart()}
            style={{ alignItems: 'center', marginBottom: 8 }}
          >
            <Text style={{ color: '#475569', fontSize: 12 }}>Clear cart</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={handleSendOrder}
          disabled={sending || cartCount === 0}
          style={{
            backgroundColor: sending || cartCount === 0 ? '#334155' : '#e94560',
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

  // ─────────────────────────────────────────────────────────────────────────
  // Root render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
      {/* Header — padded for Android status bar */}
      <View
        style={{
          paddingTop: STATUSBAR_HEIGHT,
          backgroundColor: '#0f172a',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: '#94a3b8', fontSize: 15 }}>← Home</Text>
        </TouchableOpacity>
        <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>New Order</Text>
        {/* Cart badge (always visible) */}
        <TouchableOpacity
          onPress={() => setCartDetailOpen(true)}
          style={{
            backgroundColor: cartCount > 0 ? '#e94560' : '#1e293b',
            borderRadius: 20,
            paddingHorizontal: 14,
            paddingVertical: 6,
            flexDirection: 'row',
            alignItems: 'center',
            minWidth: 48,
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
            🛒{cartCount > 0 ? ` ${cartCount}` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      {isTablet ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {ProductArea()}
          {TabletCartPanel()}
        </View>
      ) : (
        <View style={{ flex: 1, flexDirection: 'column' }}>
          {ProductArea()}
          {BottomBar()}
        </View>
      )}

      {/* Cart detail sheet (phone only) */}
      {!isTablet && CartDetailSheet()}
    </SafeAreaView>
  );
}
