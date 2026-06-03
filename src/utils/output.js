export function shouldPrintJson(options = {}) {
  return Boolean(options.jsonOutput);
}

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function withJsonProgressOnStderr(options, fn) {
  if (!shouldPrintJson(options)) {
    return fn();
  }

  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => console.error(...args);
  console.warn = (...args) => console.error(...args);
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}
