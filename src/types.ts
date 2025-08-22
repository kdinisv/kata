export type KataScanState =
  | "detect"
  | "not detected"
  | "processing"
  | "timeout"
  | "error";

/**
 * Ответ getScans: массив записей (сокращённо по PDF)
 * PDF указывает: type Response []Scans; { scanId: integer; state: array }
 * На практике удобно нормализовать тип.
 */
export interface KataScanItem {
  scanId: string | number; // в PDF integer, но иногда сервисы возвращают строку — допускаем оба
  state: KataScanState[]; // массив статусов для скана
}

export interface SubmitScanResult {
  status: number;
  scanId?: string;
}

export interface GetScansParams {
  states?: KataScanState[]; // фильтр по статусам
  sensorInstanceId?: string;
}
