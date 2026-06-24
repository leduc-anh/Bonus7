import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

if (UIManager && typeof UIManager.hasViewManagerConfig !== 'function') {
  const hasViewManagerConfig = (name) =>
    Boolean(UIManager.getViewManagerConfig?.(name));

  try {
    Object.defineProperty(UIManager, 'hasViewManagerConfig', {
      configurable: true,
      value: hasViewManagerConfig,
    });
  } catch {
    UIManager.hasViewManagerConfig = hasViewManagerConfig;
  }
}

const Maps = require('react-native-maps');
const MapView = Maps.default || Maps;
const { Marker } = Maps;

const STORAGE_KEY = '@photo-memory/items';
const PHOTO_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}captured-photos/`
  : null;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

async function loadStoredPhotos() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function persistPhotos(nextPhotos) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextPhotos));
}

async function ensurePhotoDirectory() {
  if (!PHOTO_DIR) {
    throw new Error('Không tìm thấy thư mục lưu ảnh của ứng dụng.');
  }

  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
  }
}

function getFileExtension(uri) {
  const cleanUri = uri.split('?')[0];
  const extension = cleanUri.includes('.') ? cleanUri.split('.').pop() : 'jpg';
  return extension && extension.length <= 5 ? extension : 'jpg';
}

async function copyPhotoToAppStorage(asset, id) {
  await ensurePhotoDirectory();
  const extension = getFileExtension(asset.uri);
  const destination = `${PHOTO_DIR}${id}.${extension}`;
  await FileSystem.copyAsync({ from: asset.uri, to: destination });
  return destination;
}

async function generateDescription(base64Image, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    return 'Chưa cấu hình EXPO_PUBLIC_GEMINI_API_KEY nên chưa thể tạo mô tả AI.';
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  'Hãy mô tả ngắn gọn bức ảnh này bằng tiếng Việt trong 1-2 câu, tập trung vào nội dung chính và bối cảnh.',
              },
              {
                inlineData: {
                  mimeType,
                  data: base64Image,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || 'Gemini không trả về mô tả.';
    throw new Error(message);
  }

  return (
    payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join('\n')
      .trim() || 'Gemini không nhận diện được nội dung ảnh.'
  );
}

function formatDate(value) {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getMapRegion(location) {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };
}

function getGoogleMapsUrl(location) {
  const { latitude, longitude } = location;
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function IconButton({ icon, label, onPress, variant = 'primary', disabled }) {
  const variantButtonStyle =
    variant === 'danger'
      ? styles.dangerButton
      : variant === 'ghost'
        ? styles.ghostButton
        : styles.primaryButton;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variantButtonStyle,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={variant === 'ghost' ? '#263238' : '#ffffff'}
      />
      <Text style={[styles.buttonText, variant === 'ghost' && styles.ghostButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function App() {
  const [photos, setPhotos] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [message, setMessage] = useState('');

  const selectedPhoto = useMemo(
    () => photos.find((photo) => photo.id === selectedId) || photos[0],
    [photos, selectedId]
  );

  useEffect(() => {
    let mounted = true;

    loadStoredPhotos()
      .then((items) => {
        if (!mounted) return;
        setPhotos(items);
        setSelectedId(items[0]?.id || null);
      })
      .catch((error) => setMessage(error.message))
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function requestPermissions() {
    const camera = await ImagePicker.requestCameraPermissionsAsync();
    if (!camera.granted) {
      throw new Error('Ứng dụng cần quyền camera để chụp ảnh.');
    }

    const location = await Location.requestForegroundPermissionsAsync();
    if (!location.granted) {
      throw new Error('Ứng dụng cần quyền vị trí để lưu nơi chụp ảnh.');
    }
  }

  async function handleCapture() {
    setIsCapturing(true);
    setMessage('');

    try {
      await requestPermissions();

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        base64: true,
        quality: 0.72,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      const id = `${Date.now()}`;
      const savedUri = await copyPhotoToAppStorage(asset, id);
      const description = await generateDescription(asset.base64, asset.mimeType);

      const nextPhoto = {
        id,
        uri: savedUri,
        createdAt: new Date().toISOString(),
        description,
        location: {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        },
      };
      const nextPhotos = [nextPhoto, ...photos];

      setPhotos(nextPhotos);
      setSelectedId(id);
      await persistPhotos(nextPhotos);
    } catch (error) {
      setMessage(error.message || 'Không thể chụp và lưu ảnh.');
    } finally {
      setIsCapturing(false);
    }
  }

  async function deletePhoto(photo) {
    const nextPhotos = photos.filter((item) => item.id !== photo.id);
    setPhotos(nextPhotos);
    setSelectedId(nextPhotos[0]?.id || null);
    await persistPhotos(nextPhotos);

    try {
      await FileSystem.deleteAsync(photo.uri, { idempotent: true });
    } catch {
      // Metadata is already removed; file cleanup can safely fail silently.
    }
  }

  function confirmDelete(photo) {
    if (Platform.OS === 'web') {
      deletePhoto(photo);
      return;
    }

    Alert.alert('Xoá ảnh', 'Bạn có chắc muốn xoá ảnh này khỏi lịch sử?', [
      { text: 'Huỷ', style: 'cancel' },
      { text: 'Xoá', style: 'destructive', onPress: () => deletePhoto(photo) },
    ]);
  }

  function openGoogleMaps(photo) {
    Linking.openURL(getGoogleMapsUrl(photo.location));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Photo Memory</Text>
            <Text style={styles.subtitle}>Chụp ảnh, lưu vị trí và tạo mô tả bằng Gemini</Text>
          </View>
          <View style={styles.counter}>
            <Text style={styles.counterNumber}>{photos.length}</Text>
            <Text style={styles.counterLabel}>ảnh</Text>
          </View>
        </View>

        <IconButton
          icon="camera"
          label={isCapturing ? 'Đang xử lý...' : 'Chụp ảnh mới'}
          onPress={handleCapture}
          disabled={isCapturing}
        />

        {message ? <Text style={styles.message}>{message}</Text> : null}

        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#1976d2" />
            <Text style={styles.emptyText}>Đang tải ảnh đã lưu...</Text>
          </View>
        ) : selectedPhoto ? (
          <View style={styles.detail}>
            <Image source={{ uri: selectedPhoto.uri }} style={styles.heroImage} />
            <View style={styles.detailBody}>
              <Text style={styles.metaText}>{formatDate(selectedPhoto.createdAt)}</Text>
              <Text style={styles.description}>{selectedPhoto.description}</Text>
              <View style={styles.locationRow}>
                <Ionicons name="location" size={17} color="#1565c0" />
                <Text style={styles.locationText}>
                  {selectedPhoto.location.latitude.toFixed(5)},{' '}
                  {selectedPhoto.location.longitude.toFixed(5)}
                </Text>
              </View>
            </View>

            <View style={styles.mapWrap}>
              <MapView
                key={selectedPhoto.id}
                style={styles.map}
                initialRegion={getMapRegion(selectedPhoto.location)}
              >
                <Marker
                  coordinate={selectedPhoto.location}
                  title="Vị trí chụp ảnh"
                  description={getGoogleMapsUrl(selectedPhoto.location)}
                />
              </MapView>
            </View>

            <Pressable
              accessibilityRole="link"
              onPress={() => openGoogleMaps(selectedPhoto)}
              style={styles.mapUrlBox}
            >
              <Ionicons name="link" size={16} color="#1565c0" />
              <Text selectable style={styles.mapUrlText}>
                {getGoogleMapsUrl(selectedPhoto.location)}
              </Text>
            </Pressable>

            <View style={styles.actions}>
              <IconButton
                icon="map"
                label="Mở Google Maps"
                variant="ghost"
                onPress={() => openGoogleMaps(selectedPhoto)}
              />
              <IconButton
                icon="trash"
                label="Xoá ảnh"
                variant="danger"
                onPress={() => confirmDelete(selectedPhoto)}
              />
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="images-outline" size={44} color="#78909c" />
            <Text style={styles.emptyTitle}>Chưa có ảnh nào</Text>
            <Text style={styles.emptyText}>Nhấn nút chụp ảnh để tạo bản ghi đầu tiên.</Text>
          </View>
        )}

        {photos.length > 0 ? (
          <View style={styles.gallery}>
            <Text style={styles.sectionTitle}>Lịch sử đã lưu</Text>
            {photos.map((photo) => (
              <Pressable
                key={photo.id}
                onPress={() => setSelectedId(photo.id)}
                style={[
                  styles.photoRow,
                  selectedPhoto?.id === photo.id && styles.selectedPhotoRow,
                ]}
              >
                <Image source={{ uri: photo.uri }} style={styles.thumbnail} />
                <View style={styles.photoRowBody}>
                  <Text style={styles.rowDate}>{formatDate(photo.createdAt)}</Text>
                  <Text numberOfLines={2} style={styles.rowDescription}>
                    {photo.description}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#607d8b" />
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  container: {
    padding: 18,
    paddingBottom: 36,
    gap: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    color: '#17212b',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: '#546e7a',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
    maxWidth: 260,
  },
  counter: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d7dee5',
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  counterNumber: {
    color: '#1976d2',
    fontSize: 20,
    fontWeight: '800',
  },
  counterLabel: {
    color: '#607d8b',
    fontSize: 12,
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  primaryButton: {
    backgroundColor: '#1976d2',
  },
  dangerButton: {
    backgroundColor: '#c62828',
  },
  ghostButton: {
    backgroundColor: '#ffffff',
    borderColor: '#cfd8dc',
    borderWidth: 1,
  },
  disabledButton: {
    opacity: 0.6,
  },
  pressedButton: {
    opacity: 0.82,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  ghostButtonText: {
    color: '#263238',
  },
  message: {
    backgroundColor: '#fff3e0',
    borderColor: '#ffcc80',
    borderRadius: 8,
    borderWidth: 1,
    color: '#7a4b00',
    lineHeight: 20,
    padding: 12,
  },
  detail: {
    backgroundColor: '#ffffff',
    borderColor: '#d7dee5',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  heroImage: {
    aspectRatio: 4 / 3,
    backgroundColor: '#dfe5eb',
    width: '100%',
  },
  detailBody: {
    gap: 8,
    padding: 14,
  },
  metaText: {
    color: '#607d8b',
    fontSize: 13,
    fontWeight: '700',
  },
  description: {
    color: '#17212b',
    fontSize: 16,
    lineHeight: 23,
  },
  locationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  locationText: {
    color: '#455a64',
    fontSize: 13,
  },
  mapWrap: {
    alignItems: 'center',
    backgroundColor: '#e8f1f6',
    borderTopColor: '#d7dee5',
    borderTopWidth: 1,
    height: 240,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  map: {
    height: '100%',
    width: '100%',
  },
  mapUrlBox: {
    alignItems: 'center',
    backgroundColor: '#eef6fc',
    borderTopColor: '#d7dee5',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  mapUrlText: {
    color: '#1565c0',
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  gallery: {
    gap: 10,
  },
  sectionTitle: {
    color: '#263238',
    fontSize: 18,
    fontWeight: '800',
  },
  photoRow: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d7dee5',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 10,
  },
  selectedPhotoRow: {
    borderColor: '#1976d2',
  },
  thumbnail: {
    backgroundColor: '#dfe5eb',
    borderRadius: 6,
    height: 68,
    width: 68,
  },
  photoRowBody: {
    flex: 1,
    gap: 4,
  },
  rowDate: {
    color: '#263238',
    fontSize: 13,
    fontWeight: '800',
  },
  rowDescription: {
    color: '#607d8b',
    fontSize: 13,
    lineHeight: 18,
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d7dee5',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    color: '#263238',
    fontSize: 18,
    fontWeight: '800',
  },
  emptyText: {
    color: '#607d8b',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
