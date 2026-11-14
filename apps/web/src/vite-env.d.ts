/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** SWA login path for the owner's identity provider, for example /.auth/login/github. */
  readonly VITE_OWNER_LOGIN_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
