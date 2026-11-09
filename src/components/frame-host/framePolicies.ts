export const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups-to-escape-sandbox";

export const FRAME_PERMISSIONS_POLICY = [
  "camera 'none'",
  "microphone 'none'",
  "geolocation 'none'",
  "payment 'none'",
  "usb 'none'",
].join("; ");

export const LOAD_TIMEOUT_MS = 8000;
