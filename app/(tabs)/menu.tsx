import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, SafeAreaView, Modal, TextInput, Alert, Switch, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { formatKES, toCents } from '@/utils/currency';
import { database } from '@/lib/db';
import { Category, Product } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import {
  getAllCategories,
  createCategory,
  updateCategory,
  getProductsByCategory,
  createProduct,
  updateProduct,
} from '@/lib/db/actions';

export default function MenuScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  // Category form
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [catName, setCatName] = useState('');
  const [catStation, setCatStation] = useState<'bar' | 'kitchen'>('bar');

  // Product form
  const [showProdModal, setShowProdModal] = useState(false);
  const [editProd, setEditProd] = useState<Product | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodCostPrice, setProdCostPrice] = useState('');
  const [prodUnit, setProdUnit] = useState('bottle');
  const [prodStock, setProdStock] = useState('');

  const loadCategories = useCallback(async () => {
    setLoading(true);
    const cats = await getAllCategories();
    setCategories(cats);
    if (cats.length > 0 && !selectedCatId) {
      setSelectedCatId(cats[0].id);
      const prods = await getProductsByCategory(cats[0].id);
      setProducts(prods);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCategories();
    }, [loadCategories])
  );

  const handleSelectCategory = async (catId: string) => {
    setLoading(true);
    setSelectedCatId(catId);
    const prods = await getProductsByCategory(catId);
    setProducts(prods);
    setLoading(false);
  };

  const openAddCategory = () => {
    setEditCat(null);
    setCatName('');
    setCatStation('bar');
    setShowCatModal(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditCat(cat);
    setCatName(cat.name);
    setCatStation(cat.prepStation as 'bar' | 'kitchen');
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
    await loadCategories();
  };

  const openAddProduct = () => {
    setEditProd(null);
    setProdName('');
    setProdPrice('');
    setProdCostPrice('');
    setProdUnit('bottle');
    setProdStock('0');
    setShowProdModal(true);
  };

  const openEditProduct = (prod: Product) => {
    setEditProd(prod);
    setProdName(prod.name);
    setProdPrice(String(prod.price / 100));
    setProdCostPrice(String(prod.costPrice / 100));
    setProdUnit(prod.unit);
    setProdStock(String(prod.stockQty));
    setShowProdModal(true);
  };

  const handleSaveProduct = async () => {
    if (!prodName.trim() || !selectedCatId) return;
    const price = toCents(parseFloat(prodPrice) || 0);
    const costPrice = toCents(parseFloat(prodCostPrice) || 0);

    if (editProd) {
      await updateProduct(editProd.id, {
        name: prodName.trim(),
        price,
        costPrice,
        unit: prodUnit,
      });
    } else {
      await createProduct({
        name: prodName.trim(),
        categoryId: selectedCatId,
        price,
        costPrice,
        stockQty: parseInt(prodStock, 10) || 0,
        unit: prodUnit,
      });
    }
    setShowProdModal(false);
    await handleSelectCategory(selectedCatId);
  };

  const handleToggleProduct = async (prod: Product) => {
    await updateProduct(prod.id, { isActive: !prod.isActive });
    if (selectedCatId) await handleSelectCategory(selectedCatId);
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row items-center justify-between px-4 pt-2 pb-1">
        <Text className="text-xl font-bold text-primary">Menu</Text>
        <View className="flex-row">
          <TouchableOpacity className="bg-primary px-3 py-2 rounded-lg mr-2" onPress={openAddCategory}>
            <Text className="text-white text-sm font-medium">+ Category</Text>
          </TouchableOpacity>
          {selectedCatId && (
            <TouchableOpacity className="bg-accent px-3 py-2 rounded-lg" onPress={openAddProduct}>
              <Text className="text-white text-sm font-medium">+ Product</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="bg-white border-b border-gray-200">
        <View className="flex-row p-2">
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              className={`px-4 py-2 rounded-lg mr-2 ${selectedCatId === cat.id ? 'bg-primary' : 'bg-gray-100'}`}
              onPress={() => handleSelectCategory(cat.id)}
              onLongPress={() => openEditCategory(cat)}
            >
              <Text className={`font-medium ${selectedCatId === cat.id ? 'text-white' : 'text-gray-700'}`}>
                {cat.name}
              </Text>
              <Text className={`text-xs ${selectedCatId === cat.id ? 'text-gray-200' : 'text-gray-400'}`}>
                {cat.prepStation}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Product List */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
          <Text className="text-gray-400 mt-2">Loading...</Text>
        </View>
      ) : (
        <ScrollView className="flex-1 p-4">
          {products.length === 0 ? (
            <Text className="text-gray-400 text-center mt-8">No products in this category. Tap "+ Product" to add one.</Text>
          ) : (
            products.map((prod) => (
              <TouchableOpacity
                key={prod.id}
                className="bg-white rounded-xl p-4 mb-2 border border-gray-100 flex-row items-center justify-between"
                onPress={() => openEditProduct(prod)}
              >
                <View className="flex-1">
                  <Text className="text-base font-medium text-primary">{prod.name}</Text>
                  <Text className="text-xs text-gray-500">
                    Cost: {formatKES(prod.costPrice)} · Stock: {prod.stockQty} {prod.unit}s
                  </Text>
                </View>
                <Text className="text-base font-bold text-primary mr-3">{formatKES(prod.price)}</Text>
              </TouchableOpacity>
            ))
          )}
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

            <Text className="text-sm font-medium text-gray-600 mb-2">Prep Station</Text>
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
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-4">
              {editProd ? 'Edit Product' : 'Add Product'}
            </Text>

            <Text className="text-sm font-medium text-gray-600 mb-1">Name</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={prodName}
              onChangeText={setProdName}
              placeholder="Product name"
              placeholderTextColor="#9ca3af"
              autoFocus
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
      </Modal>
    </SafeAreaView>
  );
}
