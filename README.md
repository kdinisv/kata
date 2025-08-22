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

### submitScan(input)

Отправляет объект на проверку.

- file: Buffer | Uint8Array | ArrayBuffer | Blob
- filename?: string — Имя файла в форме (по умолчанию "file.bin")
- scanId?: string — Если нужно задать свой идентификатор
- objectType?: "file" — Тип объекта (на текущий момент поддерживается "file")
- sensorInstanceId?: string

Возвращает: `{ status: number; scanId?: string }`

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

Известное ограничение: в некоторых версиях Node.js для корректной работы mTLS может потребоваться явная передача кастомного агента в вызовы fetch. Если у вас среда требует mTLS и вы сталкиваетесь с проблемой соединения, откройте issue — поможем с настройкой.

## Разработка

- Сборка: `npm run build`
- Перед публикацией выполняется сборка автоматически (`prepublishOnly`)

## Лицензия

MIT
