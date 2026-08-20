import { useState, useCallback } from 'react';
import { Feather } from '@expo/vector-icons';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, Alert, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { formatKES, toCents } from '@/utils/currency';
import { Category, Product } from '@/lib/db/models';
import {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getProductsByCategory,
  createProduct,
  updateProduct,
} from '@/lib/db/actions';

type Station = 'bar' | 'kitchen';

interface CategoryWithProducts {
  category: Category;
  products: Product[];
}

export default function MenuScreen() {
  const [activeStation, setActiveStation] = useState<Station>('bar');
  const [sections, setSections] = useState<CategoryWithProducts[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  // Category form
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [catName, setCatName] = useState('');
  const [catStation, setCatStation] = useState<Station>('bar');

  // Product form
  const [showProdModal, setShowProdModal] = useState(false);
  const [editProd, setEditProd] = useState<Product | null>(null);
  const [prodCategoryId, setProdCategoryId] = useState<string>('');
  const [prodName, setProdName] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodCostPrice, setProdCostPrice] = useState('');
  const [prodUnit, setProdUnit] = useState('bottle');
  const [prodStock, setProdStock] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    const cats = await getAllCategories();
    setAllCategories(cats);

    const stationCats = cats.filter((c) => c.prepStation === activeStation);
    const result: CategoryWithProducts[] = [];
    for (const cat of stationCats) {
      const prods = await getProductsByCategory(cat.id);
      result.push({ category: cat, products: prods });
    }
    setSections(result);
    setLoading(false);
  }, [activeStation]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // ── Category CRUD ──────────────────────────────────────────────────────────

  const openAddCategory = () => {
    setEditCat(null);
    setCatName('');
    setCatStation(activeStation);
    setShowCatModal(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditCat(cat);
    setCatName(cat.name);
    setCatStation(cat.prepStation as Station);
    setShowCatModal(true);
  };

  const handleSaveCategory = async () => {
    if (!catName.trim()) return;
    if (editCat) {
      await updateCategory(editCat.id, catName.trim(), catStation);
    } else {
      await createCategory(catName.trim(), catStation);
    }
    setShowCatModal(false);
    await loadData();
  };

  const handleDeleteCategory = (cat: Category, productCount: number) => {
    const msg = productCount > 0
      ? `Delete "${cat.name}" and its ${productCount} product(s)? This cannot be undone.`
      : `Delete "${cat.name}"? This cannot be undone.`;
    Alert.alert('Delete Category', msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCategory(cat.id);
            await loadData();
          } catch (e) {
            Alert.alert('Error', 'Could not delete category.');
          }
        },
      },
    ]);
  };

  // ── Product CRUD ───────────────────────────────────────────────────────────

  const openAddProduct = () => {
    const defaultCat = sections[0]?.category.id ?? '';
    setEditProd(null);
    setProdCategoryId(defaultCat);
    setProdName('');
    setProdPrice('');
    setProdCostPrice('');
    setProdUnit('bottle');
    setProdStock('0');
    setShowProdModal(true);
  };

  const openEditProduct = (prod: Product) => {
    setEditProd(prod);
    setProdCategoryId(prod.categoryId);
    setProdName(prod.name);
    setProdPrice(String(prod.price / 100));
    setProdCostPrice(String(prod.costPrice / 100));
    setProdUnit(prod.unit);
    setProdStock(String(prod.stockQty));
    setShowProdModal(true);
  };

  const handleSaveProduct = async () => {
    if (!prodName.trim() || !prodCategoryId) {
      Alert.alert('Error', 'Please fill in all required fields and select a category.');
      return;
    }
    const price = toCents(parseFloat(prodPrice) || 0);
    const costPrice = toCents(parseFloat(prodCostPrice) || 0);

    if (editProd) {
      await updateProduct(editProd.id, { name: prodName.trim(), price, costPrice, unit: prodUnit });
    } else {
      await createProduct({
        name: prodName.trim(),
        categoryId: prodCategoryId,
        price, costPrice,
        stockQty: parseInt(prodStock, 10) || 0,
        unit: prodUnit,
      });
    }
    setShowProdModal(false);
    await loadData();
  };

  const handleToggleProduct = async (prod: Product) => {
    await updateProduct(prod.id, { isActive: !prod.isActive });
    await loadData();
  };

  const stationCats = allCategories.filter((c) => c.prepStation === activeStation);

  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-3 pb-2">
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6 }}>
          <Feather name="arrow-left" size={22} color="#4338CA" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-primary">Menu</Text>
        <View className="flex-row">
          <TouchableOpacity className="bg-primary px-3 py-2 rounded-lg mr-2" onPress={openAddCategory}>
            <Text className="text-white text-sm font-medium">+ Category</Text>
          </TouchableOpacity>
          <TouchableOpacity className="bg-accent px-3 py-2 rounded-lg" onPress={openAddProduct}>
            <Text className="text-white text-sm font-medium">+ Product</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bar / Kitchen station tabs */}
      <View className="bg-white border-b border-gray-200 px-4 py-2">
        <View className="flex-row bg-gray-100 rounded-xl p-1">
          {(['bar', 'kitchen'] as Station[]).map((s) => (
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
      </View>

      {/* Product list grouped by category */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
          <Text className="text-gray-400 mt-2">Loading...</Text>
        </View>
      ) : sections.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-gray-400 text-center">
            No categories in {activeStation === 'bar' ? 'Bar' : 'Kitchen'} yet.{'\n'}Tap "+ Category" to add one.
          </Text>
        </View>
      ) : (
        <ScrollView className="flex-1 p-4">
          {sections.map(({ category, products }) => (
            <View key={category.id} className="mb-4">
              {/* Category header */}
              <View className="flex-row items-center mb-2">
                <TouchableOpacity
                  onLongPress={() => openEditCategory(category)}
                  className="flex-row items-center flex-1"
                  activeOpacity={0.7}
                >
                  <Text
                    className="text-sm font-bold text-gray-500 uppercase tracking-wide mr-2"
                    numberOfLines={1}
                  >
                    {category.name}
                  </Text>
                  <View className="flex-1 h-px bg-gray-200" />
                  <Text className="text-xs text-gray-300 ml-2 mr-2">hold to edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeleteCategory(category, products.length)}
                  className="p-1"
                >
                  <Feather name="trash-2" size={14} color="#dc2626" />
                </TouchableOpacity>
              </View>

              {products.length === 0 ? (
                <Text className="text-gray-400 text-xs ml-1">No products — tap "+ Product" to add one.</Text>
              ) : (
                products.map((prod) => (
                  <TouchableOpacity
                    key={prod.id}
                    className="bg-white rounded-xl p-4 mb-2 border border-gray-100 flex-row items-center justify-between"
                    onPress={() => openEditProduct(prod)}
                  >
                    <View className="flex-1">
                      <Text className={`text-base font-medium ${prod.isActive ? 'text-primary' : 'text-gray-400'}`}>
                        {prod.name}
                      </Text>
                      <Text className="text-xs text-gray-500">
                        Cost: {formatKES(prod.costPrice)} · Stock: {prod.stockQty} {prod.unit}s
                      </Text>
                    </View>
                    <Text className="text-base font-bold text-primary mr-3">{formatKES(prod.price)}</Text>
                    <Switch
                      value={prod.isActive}
                      onValueChange={() => handleToggleProduct(prod)}
                      trackColor={{ false: '#d1d5db', true: '#4338CA' }}
                      thumbColor="#fff"
                    />
                  </TouchableOpacity>
                ))
              )}
            </View>
          ))}
          <View className="h-8" />
        </ScrollView>
      )}

      {/* Category Modal */}
      <Modal visible={showCatModal} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-4">
              {editCat ? 'Edit Category' : 'Add Category'}
            </Text>

            <Text className="text-sm font-medium text-gray-600 mb-1">Name</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={catName}
              onChangeText={setCatName}
              placeholder="e.g. Beers"
              placeholderTextColor="#9ca3af"
              autoFocus
            />

            <Text className="text-sm font-medium text-gray-600 mb-2">Station</Text>
            <View className="flex-row mb-4">
              <TouchableOpacity
                className={`flex-1 p-3 rounded-lg mr-2 items-center ${catStation === 'bar' ? 'bg-primary' : 'bg-gray-100'}`}
                onPress={() => setCatStation('bar')}
              >
                <Text className={catStation === 'bar' ? 'text-white font-medium' : 'text-gray-700'}>Bar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 p-3 rounded-lg items-center ${catStation === 'kitchen' ? 'bg-primary' : 'bg-gray-100'}`}
                onPress={() => setCatStation('kitchen')}
              >
                <Text className={catStation === 'kitchen' ? 'text-white font-medium' : 'text-gray-700'}>Kitchen</Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row justify-end">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowCatModal(false)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-primary px-6 py-2 rounded-lg" onPress={handleSaveCategory}>
                <Text className="text-white font-medium">Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Product Modal */}
      <Modal visible={showProdModal} transparent animationType="fade">
        <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1 }}>
          <View className="flex-1 bg-black/50 justify-center items-center p-8">
            <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
              <Text className="text-lg font-bold text-primary mb-4">
                {editProd ? 'Edit Product' : 'Add Product'}
              </Text>

              {/* Category selector */}
              <Text className="text-sm font-medium text-gray-600 mb-2">Category</Text>
              <View className="flex-row flex-wrap mb-3">
                {stationCats.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setProdCategoryId(c.id)}
                    className={`px-3 py-2 rounded-lg mr-2 mb-2 ${prodCategoryId === c.id ? 'bg-primary' : 'bg-gray-100'}`}
                  >
                    <Text className={`text-sm ${prodCategoryId === c.id ? 'text-white' : 'text-gray-700'}`}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text className="text-sm font-medium text-gray-600 mb-1">Name</Text>
              <TextInput
                className="border border-gray-300 rounded-xl p-3 text-base mb-3"
                value={prodName}
                onChangeText={setProdName}
                placeholder="Product name"
                placeholderTextColor="#9ca3af"
              />

              <Text className="text-sm font-medium text-gray-600 mb-1">Selling Price (KES)</Text>
              <TextInput
                className="border border-gray-300 rounded-xl p-3 text-base mb-3"
                value={prodPrice}
                onChangeText={setProdPrice}
                placeholder="0.00"
                placeholderTextColor="#9ca3af"
                keyboardType="numeric"
              />

              <Text className="text-sm font-medium text-gray-600 mb-1">Cost Price (KES)</Text>
              <TextInput
                className="border border-gray-300 rounded-xl p-3 text-base mb-3"
                value={prodCostPrice}
                onChangeText={setProdCostPrice}
                placeholder="0.00"
                placeholderTextColor="#9ca3af"
                keyboardType="numeric"
              />

              <Text className="text-sm font-medium text-gray-600 mb-1">Unit</Text>
              <TextInput
                className="border border-gray-300 rounded-xl p-3 text-base mb-3"
                value={prodUnit}
                onChangeText={setProdUnit}
                placeholder="bottle, tot, plate, etc."
                placeholderTextColor="#9ca3af"
              />

              {!editProd && (
                <>
                  <Text className="text-sm font-medium text-gray-600 mb-1">Initial Stock</Text>
                  <TextInput
                    className="border border-gray-300 rounded-xl p-3 text-base mb-3"
                    value={prodStock}
                    onChangeText={setProdStock}
                    placeholder="0"
                    placeholderTextColor="#9ca3af"
                    keyboardType="numeric"
                  />
                </>
              )}

              <View className="flex-row justify-end">
                <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowProdModal(false)}>
                  <Text className="text-gray-500">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity className="bg-primary px-6 py-2 rounded-lg" onPress={handleSaveProduct}>
                  <Text className="text-white font-medium">Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </Modal>
    </SafeAreaView>
  );
}
