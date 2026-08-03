import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpRequest } from '@/platform/http';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpRequest transport selection', () => {
  it('uses fetch on non-Firefox browsers (e.g. Chrome)', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120.0' });
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: () => Promise.resolve('payload'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await httpRequest('http://example.com/dav/', {
      method: 'PROPFIND',
      headers: { Depth: '0' },
    });

    expect(mockFetch).toHaveBeenCalledWith('http://example.com/dav/', {
      method: 'PROPFIND',
      headers: { Depth: '0' },
      body: undefined,
    });
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(await result.text()).toBe('payload');
  });

  it('uses XMLHttpRequest on Firefox to bypass the fetch CORS issue', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Firefox/120.0' });

    const instances: any[] = [];
    class FakeXHR {
      status = 0;
      statusText = '';
      responseText = '';
      method = '';
      url = '';
      headers: Record<string, string> = {};
      onload: () => void = () => {};
      onerror: () => void = () => {};
      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader(key: string, value: string) {
        this.headers[key] = value;
      }
      send() {
        instances.push(this);
        // Simulate a successful PROPFIND response
        this.status = 207;
        this.statusText = 'Multi-Status';
        this.responseText = '<multistatus/>';
        this.onload();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    // fetch must NOT be used on Firefox
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await httpRequest('http://192.168.0.112:15212/dav/', {
      method: 'PROPFIND',
      headers: { Authorization: 'Basic abc', Depth: '0' },
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(instances).toHaveLength(1);
    expect(instances[0].method).toBe('PROPFIND');
    expect(instances[0].headers['Authorization']).toBe('Basic abc');
    expect(result.status).toBe(207);
    expect(result.ok).toBe(true);
    expect(await result.text()).toBe('<multistatus/>');
  });

  it('rejects with a network error when the Firefox XHR fails', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Firefox/120.0' });

    class FailingXHR {
      onload: () => void = () => {};
      onerror: () => void = () => {};
      open() {}
      setRequestHeader() {}
      send() {
        this.onerror();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FailingXHR);

    await expect(
      httpRequest('http://192.168.0.112:15212/dav/', { method: 'PROPFIND' }),
    ).rejects.toThrow(/NetworkError/);
  });
});
