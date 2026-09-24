const mockUploadUrl = jest.fn();
const mockAttach = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      plants: {
        photoUploadUrl: (...a: unknown[]) => mockUploadUrl(...a),
        attachPhoto: (...a: unknown[]) => mockAttach(...a),
      },
    },
  };
});
jest.mock('expo-image-picker', () => ({}));

// eslint-disable-next-line import/first
import { uploadPlantPhoto } from './photoUpload';

describe('uploadPlantPhoto (pre-signed flow)', () => {
  beforeEach(() => {
    mockAttach.mockReset();
    mockUploadUrl.mockResolvedValue({
      photoId: 'plants/p1/abc.jpg',
      upload: { url: 'https://api.test/v1/media/plants/p1/abc.jpg?sig=x', method: 'PUT', headers: { 'content-type': 'image/jpeg' }, expiresAt: '' },
    });
    mockAttach.mockResolvedValue({ plant: { id: 'p1' }, report: null });
  });

  it('gets a signed URL, PUTs the bytes there, then attaches', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith('file://')) return { blob: async () => 'BLOB' } as unknown as Response;
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    await uploadPlantPhoto('p1', { uri: 'file:///photo.jpg', type: 'image/jpeg' }, true, fakeFetch);
    expect(mockUploadUrl).toHaveBeenCalledWith('p1', 'image/jpeg');
    expect(calls[1]).toMatchObject({ url: 'https://api.test/v1/media/plants/p1/abc.jpg?sig=x', init: { method: 'PUT', body: 'BLOB' } });
    expect(mockAttach).toHaveBeenCalledWith('p1', 'plants/p1/abc.jpg', true);
  });

  it('does not attach when the upload fails', async () => {
    const fakeFetch = (async (url: string) =>
      url.startsWith('file://') ? ({ blob: async () => 'B' } as unknown as Response) : new Response(null, { status: 403 })) as typeof fetch;
    await expect(uploadPlantPhoto('p1', { uri: 'file:///x.jpg', type: 'image/jpeg' }, false, fakeFetch)).rejects.toMatchObject({
      code: 'UPLOAD_FAILED',
    });
    expect(mockAttach).not.toHaveBeenCalled();
  });
});
