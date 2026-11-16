/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_URL?: string
	readonly VITE_USE_SAME_ORIGIN_API?: string
	readonly VITE_DEV_BYPASS_AUTH?: string
	readonly VITE_AUTH_BYPASS?: string
	readonly VITE_AUTH_BYPASS_TOGGLE?: string
	/** Beat Wing base URL for the artist portal Partners tab; defaults to production. */
	readonly VITE_BEATWING_URL?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
