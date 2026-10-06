import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ScanPublic } from '@xeno/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { makeDevice } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { LatestScanCard } from './LatestScanCard';
import { ScanAnalyzeScreen } from './ScanAnalyzeScreen';
import { ScanHomeScreen } from './ScanHomeScreen';
import { ScanResultScreen } from './ScanResultScreen';
import { uploadAndScan } from './scanPhoto';

const mockStatus = jest.fn();
const mockList = jest.fn();
const mockGet = jest.fn();
const mockCreate = jest.fn();
const mockUploadUrl = jest.fn();
const mockDevices = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      devices: { list: () => mockDevices() },
      scans: {
        status: () => mockStatus(),
        list: (q: unknown) => mockList(q),
        get: (id: string) => mockGet(id),
        create: (b: unknown) => mockCreate(b),
        uploadUrl: (ct: string) => mockUploadUrl(ct),
        remove: jest.fn(),
      },
    },
  };
});

const mockCamera = jest.fn();
const mockCameraPerm = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: () => mockCameraPerm(),
  requestMediaLibraryPermissionsAsync: () => mockCameraPerm(),
  launchCameraAsync: (o: unknown) => mockCamera(o),
  launchImageLibraryAsync: (o: unknown) => mockCamera(o),
}));

const SCAN_ID = 'bbbbbbbbbbbbbbbbbbbbbbb1';
const scan = (over: Partial<ScanPublic> = {}): ScanPublic => ({
  id: SCAN_ID,
  createdAt: new Date().toISOString(),
  deviceId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
  deviceName: 'Xeno 1',
  imageUrl: 'https://api.test/v1/media/scans/u/x.jpg?sig=s',
  status: 'disease',
  category: 'fungal',
  severity: 'high',
  title: 'Late blight',
  crop: 'Tomato',
  condition: 'Late blight',
  confidence: 0.94,
  summary: 'A fast-spreading water mould.',
  treatment: ['Remove and bag every affected leaf.', 'Spray a fungicide made for late blight.'],
  prevention: ['Water the soil, not the leaves.'],
  sensorTips: [{ code: 'humid_air', tone: 'warning', message: 'Air humidity is 91 %.' }],
  conditions: { soilMoisture: 72, temperature: 21, humidity: 91, rain: false, at: new Date().toISOString() },
  alternatives: [{ label: 'Tomato · Early blight', confidence: 0.04 }],
  rawLabel: 'Tomato___Late_blight',
  model: { provider: 'generic', name: 'Leaf Doctor v1' },
  durationMs: 1200,
  ...over,
});
const READY = { ready: true, provider: 'generic', model: 'Leaf Doctor v1', minConfidence: 0.55, message: 'Connected to Leaf Doctor v1.' };

beforeEach(() => {
  [mockStatus, mockList, mockGet, mockCreate, mockUploadUrl, mockDevices, mockCamera, mockCameraPerm].forEach((m) => m.mockReset());
  jest.mocked(router.push).mockClear();
  jest.mocked(router.replace).mockClear();
  mockStatus.mockResolvedValue(READY);
  mockList.mockResolvedValue({ items: [], nextCursor: null });
  mockDevices.mockResolvedValue([makeDevice({ id: 'aaaaaaaaaaaaaaaaaaaaaaa1', name: 'Xeno 1' })]);
  mockCameraPerm.mockResolvedValue({ granted: true, canAskAgain: true });
});

describe('Scan tab', () => {
  it('takes a photo and opens the analyze step with it', async () => {
    mockCamera.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///leaf.jpg', mimeType: 'image/jpeg', fileSize: 900_000 }] });
    await renderWithProviders(<ScanHomeScreen />);
    expect(await screen.findByText('No scans yet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('scan-camera'));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({ pathname: '/scans/analyze', params: { uri: 'file:///leaf.jpg', type: 'image/jpeg' } }),
    );
    expect(mockCamera).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }));
  });

  it('explains how to fix a refused camera permission', async () => {
    mockCameraPerm.mockResolvedValue({ granted: false, canAskAgain: false });
    await renderWithProviders(<ScanHomeScreen />);
    await fireEvent.press(await screen.findByTestId('scan-camera'));
    expect(await screen.findByText('Camera access is off')).toBeOnTheScreen();
    expect(screen.getByText('Open settings')).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows when no model is connected, and lists recent scans', async () => {
    mockStatus.mockResolvedValue({ ...READY, ready: false, provider: null, model: null, message: 'No disease model is connected yet.' });
    mockList.mockResolvedValue({ items: [scan()], nextCursor: null });
    await renderWithProviders(<ScanHomeScreen />);
    expect(await screen.findByText('Disease model not connected')).toBeOnTheScreen();
    expect(await screen.findByText('Late blight')).toBeOnTheScreen();
    expect(screen.getByText('Act now')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`scan-row-${SCAN_ID}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/scans/[id]', params: { id: SCAN_ID } });
  });
});

describe('Analyze step', () => {
  it('uploads, analyses with the first garden linked, then shows the result', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ uri: 'file:///leaf.jpg', type: 'image/jpeg' });
    mockUploadUrl.mockResolvedValue({ photoId: 'scans/u/x.jpg', upload: { url: 'https://api.test/put', method: 'PUT', headers: {}, expiresAt: '' } });
    mockCreate.mockResolvedValue(scan());
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (url: string) =>
      url.startsWith('file://') ? ({ blob: async () => 'BLOB' } as unknown as Response) : new Response(null, { status: 201 }),
    ) as unknown as typeof fetch;
    try {
      await renderWithProviders(<ScanAnalyzeScreen />);
      await screen.findByTestId('scan-device-aaaaaaaaaaaaaaaaaaaaaaa1');
      await fireEvent.press(screen.getByTestId('scan-analyze-button'));
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/scans/[id]', params: { id: SCAN_ID } }));
      expect(mockCreate).toHaveBeenCalledWith({ photoId: 'scans/u/x.jpg', deviceId: 'aaaaaaaaaaaaaaaaaaaaaaa1' });
    } finally {
      global.fetch = realFetch;
    }
  });

  it('keeps the photo and shows the reason when the model fails', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ uri: 'file:///leaf.jpg', type: 'image/jpeg' });
    mockUploadUrl.mockRejectedValue(Object.assign(new Error('The disease model took too long to answer. Please try again.'), { name: 'ApiError' }));
    await renderWithProviders(<ScanAnalyzeScreen />);
    await fireEvent.press(await screen.findByTestId('scan-analyze-button'));
    expect(await screen.findByText('Scan failed')).toBeOnTheScreen();
    expect(screen.getByText('Try again')).toBeOnTheScreen();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('Result', () => {
  it('shows the diagnosis, confidence, steps and sensor tips', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: SCAN_ID });
    mockGet.mockResolvedValue(scan());
    await renderWithProviders(<ScanResultScreen />);
    expect(await screen.findByTestId('scan-title')).toHaveTextContent('Late blight');
    expect(screen.getByText('Tomato · Xeno 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Confidence: Very sure · 94 %')).toBeOnTheScreen();
    expect(screen.getByText('Remove and bag every affected leaf.')).toBeOnTheScreen();
    expect(screen.getByText('Prevent it next time')).toBeOnTheScreen();
    expect(screen.getByTestId('scan-tip-humid_air')).toBeOnTheScreen();
    expect(screen.getByText('91 %')).toBeOnTheScreen();
    expect(screen.getByText('Tomato · Early blight')).toBeOnTheScreen();
    expect(screen.getByText(/Analyzed by Leaf Doctor v1/)).toBeOnTheScreen();
  });

  it('a healthy leaf has no treatment section', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: SCAN_ID });
    mockGet.mockResolvedValue(scan({ status: 'healthy', severity: 'none', category: 'healthy', title: 'Healthy tomato leaf', treatment: [], sensorTips: [] }));
    await renderWithProviders(<ScanResultScreen />);
    expect(await screen.findByText('Healthy')).toBeOnTheScreen();
    expect(screen.queryByText('What to do now')).toBeNull();
    expect(screen.getByText('Keep it healthy')).toBeOnTheScreen();
  });
});

describe('Dashboard card', () => {
  it('invites a first scan', async () => {
    await renderWithProviders(<LatestScanCard now={Date.now()} />);
    expect(await screen.findByText('Check your plants for disease')).toBeOnTheScreen();
  });

  it('shows the latest scan and opens it', async () => {
    mockList.mockResolvedValue({ items: [scan()], nextCursor: null });
    await renderWithProviders(<LatestScanCard now={Date.now()} />);
    expect(await screen.findByText('Last plant scan')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('latest-scan'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/scans/[id]', params: { id: SCAN_ID } });
  });

  it('stays out of the way when scans can’t load', async () => {
    mockList.mockRejectedValue(new Error('offline'));
    await renderWithProviders(<LatestScanCard now={Date.now()} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.queryByText('Check your plants for disease')).toBeNull();
  });
});

describe('uploadAndScan', () => {
  it('does not ask the model when the upload fails', async () => {
    mockUploadUrl.mockResolvedValue({ photoId: 'scans/u/x.jpg', upload: { url: 'https://api.test/put', method: 'PUT', headers: {}, expiresAt: '' } });
    const fakeFetch = (async (url: string) =>
      url.startsWith('file://') ? ({ blob: async () => 'B' } as unknown as Response) : new Response(null, { status: 403 })) as typeof fetch;
    await expect(uploadAndScan({ uri: 'file:///x.jpg', type: 'image/jpeg' }, null, () => {}, fakeFetch)).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
