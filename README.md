# @kdinisv/kata-sdk

Минимальный клиент для Kaspersky Threat Attribution (KATA) под Node.js. Позволяет отправлять объекты на проверку и опрашивать статусы сканов.

- Поддерживаемая среда выполнения: Node.js >= 18.17 (встроенный fetch/undici)
- Типы: TypeScript готов «из коробки»
- Импорт: ESM и CommonJS

## Установка

```sh
npm i @kdinisv/kata-sdk
```

## Быстрый старт (ESM)

```ts
import { KataClient } from "@kdinisv/kata-sdk";
import { readFile } from "node:fs/promises";

const client = new KataClient({
  baseUrl: "https://kata.example.org:8443",
  sensorId: "SENSOR_ID",
  // Клиентские сертификаты (mTLS)
  cert: await readFile("./certs/client.crt", "utf8"),
  key: await readFile("./certs/client.key", "utf8"),
  // Корневой сертификат (если используется частный УЦ)
  ca: await readFile("./certs/ca.pem", "utf8"),
  // Не отключайте проверку в проде
  rejectUnauthorized: true,
  // Общий таймаут на операцию клиента (мс)
  timeoutMs: 120_000,
});

// 1) Отправка файла на проверку
const file = await readFile("./sample.bin");
const submit = await client.submitScan({ file, filename: "sample.bin" });
console.log("submitted:", submit);

// 2) Ожидание результата (с опросом)
if (submit.scanId) {
  const result = await client.waitForResult(submit.scanId, {
    pollIntervalMs: 5_000,
  });
  console.log("result:", result);
}
```

## Быстрый старт (CommonJS)

```js
const { KataClient } = require("@kdinisv/kata-sdk");
const fs = require("node:fs/promises");

(async () => {
  const client = new KataClient({
    baseUrl: "https://kata.example.org:8443",
    sensorId: "SENSOR_ID",
    cert: await fs.readFile("./certs/client.crt", "utf8"),
    key: await fs.readFile("./certs/client.key", "utf8"),
    ca: await fs.readFile("./certs/ca.pem", "utf8"),
  });

  const file = await fs.readFile("./sample.bin");
  const { scanId } = await client.submitScan({ file, filename: "sample.bin" });
  const result = scanId
    ? await client.waitForResult(scanId, { pollIntervalMs: 5000 })
    : undefined;

  console.log(result);
})();
```

## API

### new KataClient(options)

- baseUrl: string — Базовый URL KATA API
- sensorId: string — Идентификатор сенсора
- cert: string — Клиентский сертификат (PEM)
- key: string — Приватный ключ (PEM)
- ca?: string — Корневой/промежуточный сертификат(ы) (PEM)
- rejectUnauthorized?: boolean — Проверять сертификат сервера (по умолчанию true)
- timeoutMs?: number — Общий таймаут операций клиента (по умолчанию 30000)
- debug?: boolean | (..args)=>void — Включить детальные логи (или передать свой логгер). Также можно через env: KATA_SDK_DEBUG=1 или DEBUG=kata-sdk

### submitScan(input)

Отправляет объект на проверку.

- file: Buffer | Uint8Array | ArrayBuffer | Blob
- filename?: string — Имя файла в форме (по умолчанию "file.bin")
- scanId?: string — Если нужно задать свой идентификатор
- objectType?: "file" — Тип объекта (на текущий момент поддерживается "file")
- sensorInstanceId?: string

Возвращает: `{ status: number; scanId?: string; message?: string; ok?: boolean }`
— если сервер вернул простой текст `OK`, то `message: "OK"` и `ok: true`.

### getScans(params?)

Возвращает список записей о сканах.

- states?: ("detect" | "not detected" | "processing" | "timeout" | "error")[]
- sensorInstanceId?: string

Возвращает: `KataScanItem[]` где `KataScanItem = { scanId: string | number; state: KataScanState[] }`

### waitForResult(scanId, options?)

Ожидает появления терминального статуса для указанного `scanId`.

- options.pollIntervalMs?: number — Интервал опроса, по умолчанию 60000
- options.sensorInstanceId?: string

Возвращает: `KataScanItem | undefined` (undefined, если по таймауту не найден терминальный статус)

## Примеры

- Получить только завершённые с ошибкой или с детектом:

```ts
const scans = await client.getScans({ states: ["detect", "error"] });
```

- Передать собственный идентификатор скана:

```ts
const submit = await client.submitScan({ file, scanId: "my-scan-123" });
```

## Замечания по TLS/mTLS

- Библиотека создаёт Undici Agent с переданными `cert`, `key`, `ca`. В вашей среде должен быть доступ к закрытому ключу и сертификату клиента.
- Если используется частный УЦ, укажите `ca` или добавьте его в доверенные сертификаты Node.js.
- Не рекомендуется отключать проверку сертификатов (`rejectUnauthorized: false`) в продакшене.

Частая ошибка при частном УЦ:

```
TypeError: fetch failed
  cause: Error: unable to verify the first certificate (UNABLE_TO_VERIFY_LEAF_SIGNATURE)
```

Что проверить:

- Файл `ca.pem` действительно содержит корневой и все промежуточные сертификаты в цепочке сервера (PEM, можно склеить подряд).
- Хост и порт в `baseUrl` совпадают с теми, на которые выписан серверный сертификат (CN/SAN).
- Дата/время сервера/клиента корректны (не истёк ли сертификат).
- При необходимости, временно можно отключить проверку сертификата: `rejectUnauthorized: false` (только для диагностики!).

Дополнительно: Node учитывает переменные окружения для прокси/сертификатов:

- `NODE_EXTRA_CA_CERTS=path/to/ca.pem` — добавить УЦ глобально для процесса Node.
- `HTTPS_PROXY` / `HTTP_PROXY` — если доступ во внешний сегмент идёт через прокси.

В библиотеке используется `undici.fetch` и для каждого запроса передаётся кастомный TLS-агент с `cert`/`key`/`ca`, так что mTLS работает без глобальной настройки.

## Разработка

- Сборка: `npm run build`
- Перед публикацией выполняется сборка автоматически (`prepublishOnly`)

## Лицензия

MIT
