// Numbers that several modules must agree on, named once.

/** The canvas an AI thumbnail and every A/B variant is designed on (YouTube's own card size). */
export const THUMB_SIZE = Object.freeze({ w: 1280, h: 720 });

/** Largest upload accepted by the multer instance the routers share. */
export const UPLOAD_MAX_BYTES = 512 * 1024 * 1024;

/** Largest remote file /media/download will bring local. */
export const DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024;

/** Unsent WebSocket frames a client may accumulate before the hub starts dropping its frames. */
export const WS_MAX_BUFFERED = 4 * 1024 * 1024;
