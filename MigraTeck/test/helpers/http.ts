export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  text: string;
  body: T | null;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | undefined;
  json?: unknown | undefined;
  form?: URLSearchParams | undefined;
  headers?: Record<string, string> | undefined;
  withOrigin?: boolean | undefined;
}

function parseSetCookie(cookieHeader: string): { name: string; value: string } | null {
  const first = cookieHeader.split(";", 1)[0] ?? "";
  const separatorIndex = first.indexOf("=");

  if (separatorIndex < 1) {
    return null;
  }

  return {
    name: first.slice(0, separatorIndex),
    value: first.slice(separatorIndex + 1),
  };
}

export class HttpClient {
  readonly baseUrl: string;
  private readonly cookies = new Map<string, string>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  hasCookie(name: string): boolean {
    return this.cookies.has(name);
  }

  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  hasCookieContaining(partialName: string): boolean {
    for (const name of this.cookies.keys()) {
      if (name.includes(partialName)) {
        return true;
      }
    }

    return false;
  }

  async get<T = unknown>(path: string, options?: Omit<RequestOptions, "method">): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  async post<T = unknown>(path: string, options?: Omit<RequestOptions, "method">): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "POST" });
  }

  async patch<T = unknown>(path: string, options?: Omit<RequestOptions, "method">): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "PATCH" });
  }

  async put<T = unknown>(path: string, options?: Omit<RequestOptions, "method">): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "PUT" });
  }

  async delete<T = unknown>(path: string, options?: Omit<RequestOptions, "method">): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const headers = new Headers(options.headers);
    const method = options.method || "GET";
    const shouldSendOrigin = options.withOrigin ?? method !== "GET";

    if (shouldSendOrigin) {
      headers.set("origin", this.baseUrl);
      headers.set("referer", `${this.baseUrl}/`);
    }

    const cookieHeader = Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");

    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }

    let body: string | undefined;

    if (options.form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      body = options.form.toString();
    }

    if (options.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.json);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "manual",
    });

    const setCookies = response.headers.getSetCookie();
    for (const cookieHeaderValue of setCookies) {
      const parsed = parseSetCookie(cookieHeaderValue);
      if (parsed) {
        this.cookies.set(parsed.name, parsed.value);
      }
    }

    const text = await response.text();
    let parsedBody: T | null = null;

    if (text) {
      try {
        parsedBody = JSON.parse(text) as T;
      } catch {
        parsedBody = null;
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      text,
      body: parsedBody,
    };
  }
}
