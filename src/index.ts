import {
  Agent as UndiciAgent,
  fetch as undiciFetch,
  FormData as UndiciFormData,
} from "undici";
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
  /**
   * Включить детальные debug-логи. Можно передать true или свою функцию логгирования.
   * Также можно включить через переменные окружения: KATA_SDK_DEBUG=1 или DEBUG=kata-sdk
   */
  debug?: boolean | ((...args: any[]) => void);
}

export class KataClient {
  private readonly base: string;
  private readonly sensorId: string;
  private readonly agent: UndiciAgent;
  private readonly timeoutMs: number;
  private readonly dbg: (...args: any[]) => void;

  constructor(opts: KataClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.sensorId = opts.sensorId;
    this.timeoutMs = opts.timeoutMs ?? 30_000;

    // Debug logger setup
    const env = (globalThis as any)?.process?.env;
    const envEnabled = !!(
      env?.KATA_SDK_DEBUG ||
      (env?.DEBUG && /\bkata-sdk\b/i.test(env.DEBUG))
    );
    const optDbg = (opts as any).debug;
    const enabled =
      optDbg === true || typeof optDbg === "function" || envEnabled;
    const targetFn: ((...args: any[]) => void) | undefined =
      typeof optDbg === "function"
        ? optDbg
        : console.debug?.bind(console) ?? console.log.bind(console);
    this.dbg = (...args: any[]) => {
      if (enabled) targetFn?.("[kata-sdk]", ...args);
    };

    this.agent = new UndiciAgent({
      connect: {
        cert: opts.cert,
        key: opts.key,
        ca: opts.ca,
        rejectUnauthorized: opts.rejectUnauthorized !== false,
      },
    });

    this.dbg("init", {
      base: this.base,
      sensorId: this.sensorId,
      timeoutMs: this.timeoutMs,
      tls: {
        hasCert: Boolean(opts.cert),
        hasKey: Boolean(opts.key),
        hasCA: Boolean(opts.ca),
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

    const form = new UndiciFormData();
    // Порядок: сначала скалярные поля, потом файл
    form.append("objectType", String(input.objectType ?? "file"));
    form.append("scanId", String(scanId));
    if (input.sensorInstanceId)
      form.append("sensorInstanceId", String(input.sensorInstanceId));
    const blob = toBlob(input.file);
    form.append("content", blob, input.filename ?? "file.bin");

    const url = `${this.base}/kata/scanner/v1/sensors/${this.sensorId}/scans`;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this.dbg("submitScan: POST", {
        url,
        scanId,
        filename: (input as any).filename,
        objectType: input.objectType ?? "file",
      });
      const res = await undiciFetch(url, {
        method: "POST",
        body: form as any,
        signal: controller.signal,
        dispatcher: this.agent,
      } as any);
      let message: string | undefined;
      const contentType = (res.headers as any)?.get?.("content-type") ?? "";
      try {
        if (String(contentType).includes("application/json")) {
          const j = await res.json();
          // Пытаемся извлечь возможные поля message/ok
          if (j && typeof j === "object") {
            message = (j as any).message ?? JSON.stringify(j);
          }
        } else {
          // Текстовый простой ответ (например, "OK")
          message = (await res.text())?.trim();
        }
      } catch {
        // игнорируем ошибки чтения тела, это не критично
      }
      this.dbg("submitScan: response", {
        status: res.status,
        contentType,
        message: message?.slice(0, 200),
      });
      return {
        status: res.status,
        scanId,
        message,
        ok: message?.toUpperCase() === "OK",
      };
    } finally {
      clearTimeout(id);
    }
  }

  async getScans(params: GetScansParams = {}): Promise<KataScanItem[]> {
    const asArrayState = (s: unknown): KataScanState[] => {
      if (Array.isArray(s)) return s as KataScanState[];
      if (typeof s === "string" && s.length) return [s as KataScanState];
      return [];
    };

    const normalize = (data: unknown): KataScanItem[] => {
      const toItems = (arr: any[]): KataScanItem[] =>
        arr.map((it) => ({
          scanId: it?.scanId,
          state: asArrayState(it?.state),
        }));
      if (Array.isArray(data)) return toItems(data as any[]);
      if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        const candidates = [
          obj.scans,
          obj.items,
          obj.response,
          obj.data,
          (obj as any).result,
        ];
        for (const c of candidates)
          if (Array.isArray(c)) return toItems(c as any[]);
      }
      throw new Error(
        `KATA getScans: unexpected response shape; expected array or {scans:[]}, got ${
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
      this.dbg("getScans: GET", { url });
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
          const items = normalize(data);
          this.dbg("getScans: response(non-json-type)", {
            status: res.status,
            contentType,
            count: items.length,
          });
          return items;
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
      const items = normalize(data);
      this.dbg("getScans: response", {
        status: res.status,
        contentType,
        count: items.length,
      });
      return items;
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

    this.dbg("waitForResult: start", {
      scanId: String(scanId),
      pollIntervalMs,
      timeoutMs: this.timeoutMs,
      states,
    });

    do {
      const items = await this.getScans({
        states,
        sensorInstanceId: options?.sensorInstanceId,
      });
      const hit = items.find((i) => String(i.scanId) === String(scanId));
      this.dbg("waitForResult: poll", {
        found: Boolean(hit),
        items: items.length,
        now: Date.now(),
        deadline,
      });
      if (hit && hit.state.some((s) => terminal.includes(s))) return hit;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    } while (Date.now() < deadline);

    return undefined;
  }
}
