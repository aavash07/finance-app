export type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;

export type ApiError = { code: string; detail: string };

export class FinanceKitClient {
  constructor(private readonly baseUrl: string, private readonly http: HttpClient = fetch) {}

  private url(path: string) {
    if (!this.baseUrl) throw new Error('FinanceKitClient missing baseUrl');
    const base = String(this.baseUrl).trim();
    const p = String(path || '').trim();
    return `${base.replace(/\/$/, '')}/api/v1/${p.replace(/^\//, '')}`;
  }

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
    image: any;
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

  async updateReceipt(id: number, patch: {
    merchant?: string; date_str?: string; category?: string; currency?: string;
    total?: string | number; subtotal?: string | number; tax_total?: string | number;
    discount_total?: string | number; fees_total?: string | number; tip_total?: string | number;
    items?: Array<{ desc: string; qty?: string | number; price?: string | number }>
  }, authHeaders?: Record<string, string>): Promise<any> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authHeaders) Object.assign(headers, authHeaders);
    const body: any = {};
    const keys = ['merchant','date_str','category','currency','total','subtotal','tax_total','discount_total','fees_total','tip_total','items'];
    for (const k of keys) if ((patch as any)[k] !== undefined) body[k] = (patch as any)[k];
    const targetUrl = this.url(`receipts/${id}`);
    try {
      const r = await this.http(targetUrl, { method: 'PATCH', headers, body: JSON.stringify(body) });
      let json: any = null;
      try { json = await r.json(); } catch (e) { json = { code: 'parse_error', detail: 'Response parse failed', raw: String(e) }; }
      if (!r.ok) {
        throw (json || { code: 'http_error', detail: `HTTP ${r.status}` });
      }
      return json;
    } catch (e: any) {
      // Surface network-level errors with context
      if (e?.detail || e?.code) throw e;
      const err: any = new Error(`Network error while PATCH ${targetUrl}: ${e?.message || e}`);
      err.code = 'network_error';
      err.detail = `Request failed: ${e?.message || e}`;
      err.url = targetUrl;
      throw err;
    }
  }
  async getReceipt(id: number, authHeaders?: Record<string,string>): Promise<any> {
    const r = await this.http(this.url(`receipts/${id}`), { headers: authHeaders });
    const j = await r.json();
    if (!r.ok) throw j;
    return j;
  }
}
export { mintGrantJWT, rsaOaepWrapDek } from './crypto';
