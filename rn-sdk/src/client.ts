// Client helpers and re-exports

export type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;

export type ApiError = { code: string; detail: string };

export class FinanceKitClient {
  constructor(private readonly baseUrl: string, private readonly http: HttpClient = fetch) {}

  private url(path: string) { return `${this.baseUrl.replace(/\/$/, '')}/api/v1/${path.replace(/^\//, '')}`; }

  async getServerPublicKey(authHeaders?: Record<string, string>): Promise<{ algorithm: string; pem: string }> {
    const r = await this.http(this.url('crypto/server-public-key'), { headers: authHeaders });
    if (!r.ok) throw await r.json();
    return r.json();
  }

  async registerDevice(device_id: string, public_key_b64: string, authHeaders?: Record<string, string>): Promise<{ ok: boolean }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authHeaders) Object.assign(headers, authHeaders);
    const r = await this.http(this.url('device/register'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ device_id, public_key_b64 }),
    });
    if (!r.ok) throw await r.json();
    return r.json();
  }

  async ingestReceipt(params: {
    token: string;
    dek_wrap_srv: string;
    year: number; month: number; category: string;
    image: any; // React Native FormData-compatible (File/Blob or {uri,name,type})
    authHeaders?: Record<string, string>;
  }): Promise<{ receipt_id: number; data?: any; derived?: any } | ApiError> {
    const fd = new FormData();
    fd.append('token', params.token);
    fd.append('dek_wrap_srv', params.dek_wrap_srv);
    fd.append('year', String(params.year));
    fd.append('month', String(params.month));
    fd.append('category', params.category);
  fd.append('image', params.image);

    const r = await this.http(this.url('ingest/receipt'), {
      method: 'POST',
      body: fd,
      headers: params.authHeaders,
    });
    const body = await r.json();
    if (!r.ok) return body as ApiError;
    return body;
  }

  async decryptProcess(params: {
    token: string;
    dek_wrap_srv: string;
    targets: number[];
    authHeaders?: Record<string, string>;
  }): Promise<{ data?: any; processed_at?: string } | ApiError> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (params.authHeaders) Object.assign(headers, params.authHeaders);
    const r = await this.http(this.url('decrypt/process'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: params.token, dek_wrap_srv: params.dek_wrap_srv, targets: params.targets }),
    });
    const body = await r.json();
    if (!r.ok) return body as ApiError;
    return body;
  }
}
export { mintGrantJWT, rsaOaepWrapDek } from './crypto';
