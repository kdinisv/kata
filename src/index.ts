import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import { randomUUID } from "node:crypto";
export type {
  KataScanItem,
  KataScanState,
  SubmitScanResult,
  GetScansParams,
} from "./types.js";
import type {
  KataScanItem,
  KataScanState,
  SubmitScanResult,
  GetScansParams,
} from "./types.js";

export interface KataClientOptions {
  baseUrl: string;
  sensorId: string;
  cert: string;
  key: string;
  ca?: string;
  rejectUnauthorized?: boolean;
  timeoutMs?: number;
}

export class KataClient {
  private readonly base: string;
  private readonly sensorId: string;
  private readonly agent: UndiciAgent;
  private readonly timeoutMs: number;

  constructor(opts: KataClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.sensorId = opts.sensorId;
    this.timeoutMs = opts.timeoutMs ?? 30_000;

    this.agent = new UndiciAgent({
      connect: {
        cert: opts.cert,
        key: opts.key,
        ca: opts.ca,
        rejectUnauthorized: opts.rejectUnauthorized !== false,
      },
    });
  }

  async submitScan(input: {
    file: Buffer | Uint8Array | ArrayBuffer | Blob;
    filename?: string;
    scanId?: string;
    objectType?: "file";
    sensorInstanceId?: string;
  }): Promise<SubmitScanResult> {
    const scanId = input.scanId ?? randomUUID();

    const toBlob = (data: Buffer | Uint8Array | ArrayBuffer | Blob): Blob => {
      if (data instanceof Blob) return data;
      if (data instanceof ArrayBuffer) return new Blob([data]);
      // Buffer или Uint8Array
      if (typeof Buffer !== "undefined" && (Buffer as any).isBuffer?.(data)) {
        const src = data as unknown as Uint8Array;
        const ab = new ArrayBuffer(src.byteLength);
        new Uint8Array(ab).set(src);
        return new Blob([ab]);
      }
      if (data instanceof Uint8Array) {
        const ab = new ArrayBuffer(data.byteLength);
        new Uint8Array(ab).set(data);
        return new Blob([ab]);
      }
      return new Blob([]);
    };

    const form = new FormData();
    const blob = toBlob(input.file);
    form.append("content", blob, input.filename ?? "file.bin");
    form.append("objectType", input.objectType ?? "file");
    form.append("scanId", scanId);
    if (input.sensorInstanceId)
      form.append("sensorInstanceId", input.sensorInstanceId);

    const url = `${this.base}/kata/scanner/v1/sensors/${this.sensorId}/scans`;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await undiciFetch(url, {
        method: "POST",
        body: form as any,
        signal: controller.signal,
        dispatcher: this.agent,
      } as any);
      return { status: res.status, scanId };
    } finally {
      clearTimeout(id);
    }
  }

  async getScans(params: GetScansParams = {}): Promise<KataScanItem[]> {
    const normalize = (data: unknown): KataScanItem[] => {
      if (Array.isArray(data)) return data as KataScanItem[];
      if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        const candidates = [
          obj.scans,
          obj.items,
          obj.response,
          obj.data,
          // иногда приходит { result: [...] }
          (obj as any).result,
        ];
        for (const c of candidates) if (Array.isArray(c)) return c as any;
      }
      throw new Error(
        `KATA getScans: unexpected response shape; expected array, got ${
          data === null ? "null" : typeof data
        }`
      );
    };

    const statesPart =
      params.states && params.states.length
        ? `state=${encodeURIComponent(params.states.join(","))}`
        : "";
    const sensorInstancePart = params.sensorInstanceId
      ? `sensorInstanceId=${encodeURIComponent(params.sensorInstanceId)}`
      : "";
    const query = [statesPart, sensorInstancePart].filter(Boolean).join("&");
    const url = `${this.base}/kata/scanner/v1/sensors/${
      this.sensorId
    }/scans/state${query ? `?${query}` : ""}`;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await undiciFetch(url, {
        method: "GET",
        signal: controller.signal,
        dispatcher: this.agent,
      } as any);
      if (res.status === 204) return [];
      if (!res.ok) throw new Error(`KATA getScans failed: HTTP ${res.status}`);
      const contentType = (res.headers as any)?.get?.("content-type") ?? "";
      if (!String(contentType).includes("application/json")) {
        // Попробуем всё равно распарсить JSON, иначе бросим понятную ошибку
        try {
          const data = await res.json();
          return normalize(data);
        } catch (e) {
          const text = await res.text();
          throw new Error(
            `KATA getScans: unexpected content-type ${contentType}; body starts with: ${text.slice(
              0,
              200
            )}`
          );
        }
      }
      const data = await res.json();
      return normalize(data);
    } finally {
      clearTimeout(id);
    }
  }

  async waitForResult(
    scanId: string | number,
    options?: { pollIntervalMs?: number; sensorInstanceId?: string }
  ): Promise<KataScanItem | undefined> {
    const pollIntervalMs = options?.pollIntervalMs ?? 60_000;
    const terminal: KataScanState[] = [
      "detect",
      "not detected",
      "error",
      "timeout",
    ];
    const deadline = Date.now() + this.timeoutMs;
    const states: KataScanState[] = ["processing", ...terminal];

    do {
      const items = await this.getScans({
        states,
        sensorInstanceId: options?.sensorInstanceId,
      });
      const hit = items.find((i) => String(i.scanId) === String(scanId));
      if (hit && hit.state.some((s) => terminal.includes(s))) return hit;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    } while (Date.now() < deadline);

    return undefined;
  }
}
