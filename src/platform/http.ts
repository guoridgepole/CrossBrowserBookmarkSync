/**
 * Cross-browser HTTP request helper.
 *
 * Firefox's `fetch()` does not reliably honour the extension host-permission
 * CORS bypass: even with a granted permission, a cross-origin `fetch()` can be
 * blocked by the same-origin policy (the request reaches the server and returns
 * e.g. 200, but reading the response fails with "CORS header
 * 'Access-Control-Allow-Origin' missing"). `XMLHttpRequest` uses a more mature
 * CORS-bypass code path in Firefox extensions and works reliably.
 *
 * Therefore: Firefox → XMLHttpRequest, other browsers (Chrome) → fetch.
 * Chrome's `fetch()` CORS bypass works correctly, so its behaviour is unchanged.
 */

/** Minimal response shape shared by fetch and XMLHttpRequest. */
export interface HttpResult {
  status: number;
  statusText: string;
  ok: boolean;
  text(): Promise<string>;
}

export interface HttpRequestInit {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Detect Firefox at runtime (safe when `navigator` is absent, e.g. in tests). */
function isFirefox(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /firefox/i.test(navigator.userAgent ?? '')
  );
}

/**
 * Perform an HTTP request, choosing the transport that reliably bypasses CORS
 * for extension host permissions on the current browser.
 */
export async function httpRequest(
  url: string,
  init: HttpRequestInit,
): Promise<HttpResult> {
  if (isFirefox()) {
    return xhrRequest(url, init);
  }

  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    text: () => response.text(),
  };
}

/** XMLHttpRequest-based request used on Firefox. */
function xhrRequest(url: string, init: HttpRequestInit): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method, url, true);

    if (init.headers) {
      for (const [key, value] of Object.entries(init.headers)) {
        xhr.setRequestHeader(key, value);
      }
    }

    xhr.onload = () => {
      resolve({
        status: xhr.status,
        statusText: xhr.statusText,
        ok: xhr.status >= 200 && xhr.status < 300,
        text: () => Promise.resolve(xhr.responseText),
      });
    };

    xhr.onerror = () => {
      reject(new TypeError('NetworkError when attempting to fetch resource.'));
    };

    xhr.send(init.body ?? null);
  });
}
