/// <reference types="vite/client" />

/** 빌드마다 바뀌는 값. data/*.json 캐시를 끊는 데 쓴다. vite.config.ts 참고. */
declare const __BUILD_ID__: string;
